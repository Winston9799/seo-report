"""
Pulls GA4 + Search Console data for each brand below and writes data/<brand>.json.

Incremental by design:
  - Months older than REFRESH_MONTHS are carried forward unchanged from whatever
    is already in the JSON file (read from the repo checkout), instead of being
    re-fetched every day. Only the most recent REFRESH_MONTHS get pulled fresh.
  - If a month is missing from the existing file for any reason (first run ever,
    or LOOKBACK_MONTHS was increased), it self-heals by fetching it anyway.
  - The most recent DAILY_DETAIL_MONTHS additionally get a full per-day
    breakdown of keywords/pages/countries/devices (not just totals), so the
    report page can do an exact day-vs-day comparison, not just month-vs-month.
    This is deliberately NOT kept for all 16 months — the data volume would be
    unreasonable for a static site. Once a month ages out of that window, its
    day-level detail is dropped (monthly totals are kept forever).

Runs both locally (for testing) and inside GitHub Actions, using a service
account key passed via the GOOGLE_SERVICE_ACCOUNT_JSON environment variable
(the full JSON contents, not a file path).
"""

import os
import json
import re
import calendar
from datetime import date, timedelta

# Google's official libraries for authenticating as the service account, and
# for talking to the Search Console API and the GA4 ("Analytics Data") API.
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

# ---------------------------------------------------------------------------
# CONFIG — edit this section for your own properties
# ---------------------------------------------------------------------------

# One entry per brand. "brand_keyword" drives the branded/non-branded split —
# any search query containing this text (case-insensitive) counts as branded.
BRANDS = [
    {
        "label": "Anzo",
        "color": "#b22333",
        "ga4_property_id": "480686179",
        "gsc_site_url": "sc-domain:anzocapital.com",
        "brand_keyword": "anzo capital",   # any query containing this = branded
        # These subdomains (portal login, file server) aren't real content —
        # excluded from every GSC row server-side, and every GA4 row by hostname,
        # before any total/keyword/page/country/device number is calculated.
        "exclude_page_regex": r"^https?://(my|files)\.anzocapital\.com(/|\?|$)",
        "exclude_ga4_hostnames": ["my.anzocapital.com", "files.anzocapital.com"],
    },
    {
        "label": "DLSM",
        "color": "#0156fc",
        "ga4_property_id": "474006416",
        "gsc_site_url": "sc-domain:dlsm.com",
        "brand_keyword": "dlsm",
    },
]

LOOKBACK_MONTHS = 16       # total months of MONTHLY-level history kept (Search Console's retention limit)
REFRESH_MONTHS = 3         # only these most-recent months get re-fetched each day; older ones are carried forward
DAILY_DETAIL_MONTHS = 3    # only these most-recent months get full per-day keyword/page/country/device detail
GSC_LAG_DAYS = 3           # Search Console data has a reporting lag of a couple of days

# How many rows to keep per bucket. Kept smaller for daily detail since it
# multiplies by ~30 days a month — a big number here directly inflates the
# JSON file size and how long the daily Action run takes.
TOP_N_KEYWORDS = 200       # per month, per branded/non-branded bucket
TOP_N_PAGES = 200
TOP_N_COUNTRIES = 30
TOP_N_DAILY_KEYWORDS = 40  # per day, per branded/non-branded bucket
TOP_N_DAILY_PAGES = 40
TOP_N_DAILY_COUNTRIES = 15

# Traffic from these regions is excluded from every number in the report —
# applied everywhere both APIs return a country, before any totals are summed.
EXCLUDE_GA4_COUNTRIES = ["China", "Hong Kong", "Macao", "Taiwan"]   # GA4's exact country names
EXCLUDE_GSC_COUNTRIES = ["chn", "hkg", "mac", "twn"]                # Search Console's ISO-3166-1 alpha-3 codes

# The minimum permissions the service account needs — read-only on both APIs.
SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
]

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_credentials():
    """Reads the service account key (as a JSON string, from the
    GOOGLE_SERVICE_ACCOUNT_JSON secret) and turns it into credentials both the
    GA4 client and the Search Console client can use."""
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw)
    return Credentials.from_service_account_info(info, scopes=SCOPES)


# ---------------------------------------------------------------------------
# Calendar month helpers
# ---------------------------------------------------------------------------

def shift_month(year, month, delta):
    """Moves a (year, month) pair forward or backward by `delta` months —
    e.g. shift_month(2026, 1, -1) returns (2025, 12). Used to walk backwards
    from the current month to build the lookback window."""
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def month_bounds(year, month):
    """Returns (first_day, last_day) as date objects for a given calendar month."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


# ---------------------------------------------------------------------------
# Search Console helpers
# ---------------------------------------------------------------------------

def gsc_query(service, site_url, dimensions, start, end, row_limit=25000, max_pages=6, exclude_page_regex=None):
    """Runs one Search Console searchAnalytics query and returns every row as
    a plain dict, e.g. {"query": "...", "country": "usa", "clicks": 5, ...}.

    Paginates automatically — a month with 'date' as an extra dimension can
    easily exceed the API's 25,000-row-per-call cap for a busy site, so this
    keeps requesting further pages (up to max_pages) until a page comes back
    with fewer rows than requested, meaning there's nothing left to fetch.

    exclude_page_regex, if given, excludes matching URLs SERVER-SIDE via the
    API's own filter — the "page" dimension doesn't need to be part of
    `dimensions` for this to work, so query/country/device pulls can exclude
    by URL without needing to add "page" as an extra grouping dimension."""
    all_rows = []
    start_row = 0
    for _ in range(max_pages):
        body = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "dimensions": dimensions,
            "rowLimit": row_limit,
            "startRow": start_row,
        }
        if exclude_page_regex:
            body["dimensionFilterGroups"] = [{
                "filters": [
                    {"dimension": "page", "operator": "excludingRegex", "expression": exclude_page_regex}
                ]
            }]
        resp = service.searchanalytics().query(siteUrl=site_url, body=body).execute()
        page_rows = resp.get("rows", [])
        for r in page_rows:
            # The API returns each dimension's value as a plain list ("keys"),
            # in the same order we asked for them — zip them back into a dict
            # keyed by dimension name so the rest of the script can just do
            # row["query"] / row["country"] / row["date"] etc.
            row = {dim: r["keys"][i] for i, dim in enumerate(dimensions)}
            row["clicks"] = r["clicks"]
            row["impressions"] = r["impressions"]
            row["position"] = r["position"]
            all_rows.append(row)
        if len(page_rows) < row_limit:
            break  # got fewer rows than the max — that was the last page
        start_row += row_limit
    return all_rows


def normalize_for_brand_match(s):
    """Strips spaces/hyphens/underscores and lowercases, so brand matching
    catches spacing variants of the same term — e.g. "anzo capital",
    "anzocapital", and "anzo-capital" all normalize to "anzocapital" and
    match each other. Without this, a literal substring check on
    brand_keyword would miss any query that just happens to be typed (or
    URL-slugged) without the space."""
    return re.sub(r"[\s\-_]+", "", s.lower())


def weighted_position(rows):
    """Average ranking position across a set of rows, weighted by impressions
    (a query with 10,000 impressions at position 3 should count for more than
    one with 5 impressions at position 3 — a plain average would treat them
    equally and give a misleading number)."""
    total_impr = sum(r["impressions"] for r in rows)
    if total_impr == 0:
        return 0
    return round(sum(r["position"] * r["impressions"] for r in rows) / total_impr, 1)


def summarize(rows):
    """Collapses a list of rows down into one totals dict: clicks, impressions,
    CTR, and impression-weighted average position. Used both for whole-month
    totals and for any smaller group (e.g. just the branded keywords)."""
    clicks = sum(r["clicks"] for r in rows)
    impressions = sum(r["impressions"] for r in rows)
    ctr = round(clicks / impressions, 4) if impressions else 0
    return {"clicks": clicks, "impressions": impressions, "ctr": ctr, "position": weighted_position(rows)}


def group_by(rows, key):
    """Buckets rows by one field (e.g. "query", "page", "country", "device")
    and summarizes each bucket — e.g. group_by(rows, "query") turns a big list
    of query+country rows into one row per unique query, with clicks/
    impressions/position totalled across every country."""
    groups = {}
    for r in rows:
        groups.setdefault(r[key], []).append(r)
    out = []
    for k, group_rows in groups.items():
        s = summarize(group_rows)
        s[key] = k
        out.append(s)
    return out


def group_by_date_then(rows, sub_key, top_n):
    """Same idea as group_by, but two levels deep: first splits rows by date,
    then within each date groups by sub_key (query/page/country/device) and
    keeps only the top N by clicks. Powers the per-day breakdown used for
    Day-vs-Day comparisons — rows must each already have a 'date' field.
    Returns {date: [top-N grouped-by-sub_key rows for that date]}."""
    by_date = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)
    out = {}
    for d, day_rows in by_date.items():
        out[d] = sorted(group_by(day_rows, sub_key), key=lambda x: x["clicks"], reverse=True)[:top_n]
    return out


# ---------------------------------------------------------------------------
# GA4 helpers
# ---------------------------------------------------------------------------

# GA4's channel-grouping dimension and the exact (case-sensitive) value that
# means "organic search" — used to restrict every GA4 number in the report
# to organic traffic only, same principle as the country/hostname exclusions.
GA4_ORGANIC_CHANNEL = "Organic Search"


def ga4_breakdown(client, property_id, start, end, dimension_name, metric_names, exclude_hostnames=None, top_n=30):
    """Generic GA4 breakdown puller: groups ORGANIC-SEARCH-ONLY traffic by
    one dimension (brandingInterest, eventName, pageTitle, userGender,
    operatingSystem, or deviceCategory), summing the given metric(s), with
    the same country/hostname exclusion and organic-channel filter as every
    other GA4 number in this file. Powers Interests, Key Events by Event
    Name, Page Title and Screen, Gender, Operating System, and Device
    Category — all "current period only" snapshots, same pattern as
    Position Distribution / CTR Opportunities on the Search Console side.

    userGender and brandingInterest are two of GA4's "potentially
    thresholded" dimensions — Google may suppress some rows entirely to
    prevent inferring individual users' demographics from small samples.
    That's a Google Analytics privacy safeguard, not a bug here — expect
    those two breakdowns in particular to sometimes total less than the
    site's overall traffic numbers."""
    exclude_hostnames = exclude_hostnames or []
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[
            Dimension(name=dimension_name),
            Dimension(name="country"),
            Dimension(name="hostName"),
            Dimension(name="sessionDefaultChannelGroup"),
        ],
        metrics=[Metric(name=m) for m in metric_names],
    )
    resp = client.run_report(request)
    totals = {}
    for row in resp.rows:
        if row.dimension_values[1].value in EXCLUDE_GA4_COUNTRIES:
            continue
        if row.dimension_values[2].value in exclude_hostnames:
            continue
        if row.dimension_values[3].value != GA4_ORGANIC_CHANNEL:
            continue
        key = row.dimension_values[0].value
        entry = totals.setdefault(key, {m: 0 for m in metric_names})
        for i, m in enumerate(metric_names):
            entry[m] += int(row.metric_values[i].value)
    out = [{"label": k, **v} for k, v in totals.items()]
    out.sort(key=lambda r: r[metric_names[-1]], reverse=True)  # sorts by the last (primary) metric
    return out[:top_n]


def ga4_totals(client, property_id, start, end, exclude_hostnames=None):
    """Total sessions/engagedSessions/bounceRate/newUsers/activeUsers/
    keyEvents for one GA4 property over a date range — ORGANIC SEARCH
    TRAFFIC ONLY (filtered on sessionDefaultChannelGroup), with excluded-
    country and excluded-hostname traffic also subtracted out first.

    bounceRate is deliberately NOT requested as a metric directly — it's a
    ratio, and GA4 would hand back a separate bounce rate per country/
    hostname/channel row. Averaging those per-row rates together (or just
    taking the last one) would give a mathematically wrong answer once rows
    are filtered out. Instead this pulls the raw counts (sessions,
    engagedSessions) and derives bounceRate itself AFTER summing — the same
    weighted-aggregation principle as weighted_position() above."""
    exclude_hostnames = exclude_hostnames or []
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[Dimension(name="country"), Dimension(name="hostName"), Dimension(name="sessionDefaultChannelGroup")],
        metrics=[
            Metric(name="sessions"),
            Metric(name="engagedSessions"),
            Metric(name="newUsers"),
            Metric(name="activeUsers"),
            Metric(name="keyEvents"),
        ],
    )
    resp = client.run_report(request)
    sessions = engaged_sessions = new_users = active_users = key_events = 0
    for row in resp.rows:
        if row.dimension_values[0].value in EXCLUDE_GA4_COUNTRIES:
            continue
        if row.dimension_values[1].value in exclude_hostnames:
            continue
        if row.dimension_values[2].value != GA4_ORGANIC_CHANNEL:
            continue
        sessions += int(row.metric_values[0].value)
        engaged_sessions += int(row.metric_values[1].value)
        new_users += int(row.metric_values[2].value)
        active_users += int(row.metric_values[3].value)
        key_events += int(row.metric_values[4].value)
    bounce_rate = round(1 - (engaged_sessions / sessions), 4) if sessions else 0
    return {
        "sessions": sessions,
        "engagedSessions": engaged_sessions,
        "bounceRate": bounce_rate,
        "newUsers": new_users,
        "activeUsers": active_users,
        "keyEvents": key_events,
    }


def ga4_daily_totals(client, property_id, start, end, exclude_hostnames=None):
    """Same as ga4_totals, but broken out by day instead of collapsed into
    one number — powers the day-by-day GA4 numbers in the Trend chart and the
    Day-vs-Day Executive Summary. Also organic-search-only; see ga4_totals
    for why bounceRate is derived per day rather than requested directly.
    Returns {iso_date: {"sessions": .., "engagedSessions": .., ...}}."""
    exclude_hostnames = exclude_hostnames or []
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[
            Dimension(name="date"),
            Dimension(name="country"),
            Dimension(name="hostName"),
            Dimension(name="sessionDefaultChannelGroup"),
        ],
        metrics=[
            Metric(name="sessions"),
            Metric(name="engagedSessions"),
            Metric(name="newUsers"),
            Metric(name="activeUsers"),
            Metric(name="keyEvents"),
        ],
    )
    resp = client.run_report(request)
    by_date = {}
    for row in resp.rows:
        if row.dimension_values[1].value in EXCLUDE_GA4_COUNTRIES:
            continue
        if row.dimension_values[2].value in exclude_hostnames:
            continue
        if row.dimension_values[3].value != GA4_ORGANIC_CHANNEL:
            continue
        raw_d = row.dimension_values[0].value  # GA4 returns dates as "YYYYMMDD"
        iso_d = f"{raw_d[0:4]}-{raw_d[4:6]}-{raw_d[6:8]}"  # reformat to "YYYY-MM-DD" to match Search Console's format
        entry = by_date.setdefault(iso_d, {"sessions": 0, "engagedSessions": 0, "newUsers": 0, "activeUsers": 0, "keyEvents": 0})
        entry["sessions"] += int(row.metric_values[0].value)
        entry["engagedSessions"] += int(row.metric_values[1].value)
        entry["newUsers"] += int(row.metric_values[2].value)
        entry["activeUsers"] += int(row.metric_values[3].value)
        entry["keyEvents"] += int(row.metric_values[4].value)
    # bounceRate has to be computed per day AFTER summing (see the docstring
    # on ga4_totals for why it can't just be requested as a metric directly).
    for entry in by_date.values():
        entry["bounceRate"] = round(1 - (entry["engagedSessions"] / entry["sessions"]), 4) if entry["sessions"] else 0
    return by_date


# ---------------------------------------------------------------------------
# Per-month snapshot
# ---------------------------------------------------------------------------

def build_month_snapshot(brand, gsc_service, ga4_client, year, month, cutoff_date, include_daily_detail):
    """Builds the full data object for one brand's one calendar month: overall
    totals, branded vs. non-branded split, top keywords/pages/countries/
    devices, a lightweight daily totals series, and — for recent months only —
    a full per-day breakdown. This is the main "does the work" function;
    everything else in this file exists to support or orchestrate this call."""
    start, end = month_bounds(year, month)
    end = min(end, cutoff_date)
    if start > end:
        return None  # too early in the month for any data to exist yet

    label = f"{calendar.month_abbr[month]} {year}"
    print(f"[{brand['label']}] {label}: {start} to {end} (daily_detail={include_daily_detail})")

    def clean(rows):
        # Applied to every Search Console pull below — drops excluded-country
        # rows before anything gets summed, so they never enter any total.
        return [r for r in rows if r["country"] not in EXCLUDE_GSC_COUNTRIES]

    exclude_page_regex = brand.get("exclude_page_regex")
    exclude_ga4_hostnames = brand.get("exclude_ga4_hostnames", [])

    # Ask for the "date" dimension too, but only for months inside the
    # daily-detail window — otherwise we'd be pulling (and paying the
    # pagination cost for) far more data than the monthly totals actually need.
    dims_suffix = ["date"] if include_daily_detail else []
    qc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["query", "country"] + dims_suffix, start, end, exclude_page_regex=exclude_page_regex))
    pc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["page", "country"] + dims_suffix, start, end, exclude_page_regex=exclude_page_regex))
    dc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["device", "country"] + dims_suffix, start, end, exclude_page_regex=exclude_page_regex))
    tc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["date", "country"], start, end, exclude_page_regex=exclude_page_regex))  # always cheap, always fetched

    # --- Whole-month totals ---
    summary = summarize(qc)

    # --- Branded vs. non-branded split ---
    # normalize_for_brand_match strips spaces/hyphens so "anzo capital",
    # "anzocapital", and "anzo-capital" are all treated as the same term.
    brand_kw = normalize_for_brand_match(brand["brand_keyword"])
    is_branded = lambda q: brand_kw in normalize_for_brand_match(q)

    branded_rows = [r for r in qc if is_branded(r["query"])]
    nonbranded_rows = [r for r in qc if not is_branded(r["query"])]
    branded_summary = summarize(branded_rows)
    nonbranded_summary = summarize(nonbranded_rows)
    branded_share_pct = round(branded_summary["clicks"] / summary["clicks"] * 100, 1) if summary["clicks"] else 0

    # --- Top-N tables for the month (what the "Branded keywords" / "Non-branded
    # keywords" / page-category / "Top countries" tables on the report read from) ---
    branded_keywords = sorted(group_by(branded_rows, "query"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_KEYWORDS]
    non_branded_keywords = sorted(group_by(nonbranded_rows, "query"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_KEYWORDS]
    pages = sorted(group_by(pc, "page"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_PAGES]
    countries = sorted(group_by(qc, "country"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_COUNTRIES]
    devices = sorted(group_by(dc, "device"), key=lambda r: r["clicks"], reverse=True)

    # --- Daily totals (lightweight, kept for ALL months — powers the Trend chart) ---
    daily_gsc = sorted(group_by(tc, "date"), key=lambda r: r["date"])
    ga4_daily = ga4_daily_totals(ga4_client, brand["ga4_property_id"], start, end, exclude_hostnames=exclude_ga4_hostnames)
    daily = []
    ga4_daily_default = {"sessions": 0, "engagedSessions": 0, "bounceRate": 0, "newUsers": 0, "activeUsers": 0, "keyEvents": 0}
    for row in daily_gsc:
        g = ga4_daily.get(row["date"], ga4_daily_default)
        daily.append({
            "date": row["date"],
            "clicks": row["clicks"],
            "impressions": row["impressions"],
            "ctr": row["ctr"],
            "position": row["position"],
            "sessions": g["sessions"],
            "engagedSessions": g["engagedSessions"],
            "bounceRate": g["bounceRate"],
            "newUsers": g["newUsers"],
            "activeUsers": g["activeUsers"],
            "keyEvents": g["keyEvents"],
        })

    # --- Daily DETAIL (expensive, only for recent months — powers day-vs-day tables) ---
    daily_detail = None
    if include_daily_detail:
        daily_branded = group_by_date_then(branded_rows, "query", TOP_N_DAILY_KEYWORDS)
        daily_nonbranded = group_by_date_then(nonbranded_rows, "query", TOP_N_DAILY_KEYWORDS)
        daily_pages = group_by_date_then(pc, "page", TOP_N_DAILY_PAGES)
        daily_countries = group_by_date_then(qc, "country", TOP_N_DAILY_COUNTRIES)
        daily_devices = group_by_date_then(dc, "device", 10)

        # Union of every date that shows up in any of the five breakdowns above
        # (a date might have branded-keyword data but no device data that day, etc.)
        all_dates = set(daily_branded) | set(daily_nonbranded) | set(daily_pages) | set(daily_countries) | set(daily_devices)
        daily_detail = {}
        for d in all_dates:
            daily_detail[d] = {
                "branded_keywords": daily_branded.get(d, []),
                "non_branded_keywords": daily_nonbranded.get(d, []),
                "pages": daily_pages.get(d, []),
                "countries": daily_countries.get(d, []),
                "devices": daily_devices.get(d, []),
            }

    ga4 = ga4_totals(ga4_client, brand["ga4_property_id"], start, end, exclude_hostnames=exclude_ga4_hostnames)

    # --- GA4 audience/behavior breakdowns (organic search only, current period) ---
    interests = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "brandingInterest", ["activeUsers"], exclude_hostnames=exclude_ga4_hostnames, top_n=20)
    key_events_raw = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "eventName", ["keyEvents"], exclude_hostnames=exclude_ga4_hostnames, top_n=50)
    key_events_by_name = [r for r in key_events_raw if r["keyEvents"] > 0]  # drop events that aren't marked as key events (0 count)
    page_titles = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "pageTitle", ["screenPageViews"], exclude_hostnames=exclude_ga4_hostnames, top_n=30)
    gender = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "userGender", ["newUsers", "activeUsers"], exclude_hostnames=exclude_ga4_hostnames, top_n=10)
    operating_systems = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "operatingSystem", ["activeUsers"], exclude_hostnames=exclude_ga4_hostnames, top_n=10)
    device_users = ga4_breakdown(ga4_client, brand["ga4_property_id"], start, end, "deviceCategory", ["newUsers", "activeUsers"], exclude_hostnames=exclude_ga4_hostnames, top_n=10)

    # This dict's shape is the contract the report page (app.js) expects —
    # if you rename or remove a key here, the matching code in app.js needs
    # the same change, or that part of the report will silently break.
    return {
        "year": year,
        "month": month,
        "label": label,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": summary,
        "branded_summary": branded_summary,
        "non_branded_summary": nonbranded_summary,
        "branded_share_pct": branded_share_pct,
        "branded_keywords": branded_keywords,
        "non_branded_keywords": non_branded_keywords,
        "pages": pages,
        "countries": countries,
        "devices": devices,
        "daily": daily,
        "daily_detail": daily_detail,   # null for months outside the detail window
        "ga4": ga4,
        "interests": interests,
        "key_events_by_name": key_events_by_name,
        "page_titles": page_titles,
        "gender": gender,
        "operating_systems": operating_systems,
        "device_users": device_users,
    }


# ---------------------------------------------------------------------------
# Incremental orchestration
# ---------------------------------------------------------------------------

def load_existing_months(path):
    """Reads whatever data/<brand>.json is already in the repo (from
    yesterday's run) and returns it as a {(year, month): month_dict} lookup,
    so build_brand_report can carry old months forward without re-fetching
    them. Returns an empty dict on the very first run, or if the file is
    somehow corrupted — either way, every month just gets fetched fresh."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        return {(m["year"], m["month"]): m for m in data.get("months", [])}
    except Exception as e:
        print(f"Could not read existing {path} ({e}) — treating as no prior data")
        return {}


def build_brand_report(brand, gsc_service, ga4_client, existing_months_by_key):
    """Builds the full report for one brand: walks backwards from the current
    month for LOOKBACK_MONTHS, deciding for each one whether to fetch it fresh
    or carry it forward unchanged from the existing file. This is what makes
    daily runs fast — see the module docstring at the top of this file for
    the reasoning."""
    today = date.today()
    cutoff_date = today - timedelta(days=GSC_LAG_DAYS)

    months = []
    for i in range(LOOKBACK_MONTHS):
        y, m = shift_month(today.year, today.month, -i)
        key = (y, m)
        within_refresh_window = i < REFRESH_MONTHS
        within_daily_detail_window = i < DAILY_DETAIL_MONTHS
        existing = existing_months_by_key.get(key)

        if within_refresh_window or existing is None:
            # Either this month is recent enough to always re-fetch, or we've
            # never seen it before (first run, or the file didn't have it for
            # some reason) — either way, pull it fresh from the APIs.
            snapshot = build_month_snapshot(
                brand, gsc_service, ga4_client, y, m, cutoff_date,
                include_daily_detail=within_daily_detail_window,
            )
            if snapshot:
                months.append(snapshot)
            elif existing:
                # The API returned nothing (e.g. too early in the month) but
                # we do have an older copy sitting in the file — keep that
                # rather than losing the month entirely.
                months.append(existing)
        else:
            # Old enough to skip re-fetching — reuse what's already on disk.
            if not within_daily_detail_window:
                existing["daily_detail"] = None  # drop stale day-level detail once it ages out
            months.append(existing)

    return {
        "brand": brand["label"],
        "color": brand["color"],
        "generated_at": today.isoformat(),
        "months": months,   # newest first
    }


def main():
    """Entry point: authenticate once, then build and write one JSON file per
    brand in BRANDS. This is what GitHub Actions (and you, if testing locally)
    actually runs."""
    creds = get_credentials()
    gsc_service = build("searchconsole", "v1", credentials=creds)
    ga4_client = BetaAnalyticsDataClient(credentials=creds)

    os.makedirs("data", exist_ok=True)
    for brand in BRANDS:
        out_path = f"data/{brand['label'].lower()}.json"
        existing_months_by_key = load_existing_months(out_path)
        report = build_brand_report(brand, gsc_service, ga4_client, existing_months_by_key)
        with open(out_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote {out_path} ({len(report['months'])} months)")


if __name__ == "__main__":
    main()

"""
Pulls GA4 + Search Console data for each brand below, one snapshot per
calendar month (as far back as Search Console retains data, ~16 months),
and writes data/<brand>.json. The report page lets you pick ANY two months
to compare (not just adjacent ones) — the comparison math happens in the
browser, not here. This script just archives each month's numbers.

Runs both locally (for testing) and inside GitHub Actions, using a service
account key passed via the GOOGLE_SERVICE_ACCOUNT_JSON environment variable
(the full JSON contents, not a file path).
"""

import os
import json
import calendar
from datetime import date, timedelta

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

# ---------------------------------------------------------------------------
# CONFIG — edit this section for your own properties
# ---------------------------------------------------------------------------
BRANDS = [
    {
        "label": "Anzo",
        "color": "#b22333",
        "ga4_property_id": "REPLACE_WITH_ANZO_GA4_PROPERTY_ID",
        "gsc_site_url": "sc-domain:anzocapital.com",
        "brand_keyword": "anzo capital",   # any query containing this = branded
    },
    {
        "label": "DLSM",
        "color": "#0156fc",
        "ga4_property_id": "REPLACE_WITH_DLSM_GA4_PROPERTY_ID",
        "gsc_site_url": "sc-domain:dlsm.com",
        "brand_keyword": "dlsm",
    },
]

LOOKBACK_MONTHS = 16     # how many calendar months back to archive (Search Console keeps ~16 months)
GSC_LAG_DAYS = 3         # Search Console data has a reporting lag of a couple of days

TOP_N_KEYWORDS = 200     # per month, per branded/non-branded bucket
TOP_N_PAGES = 200
TOP_N_COUNTRIES = 30

# Traffic from these regions is excluded from every number in the report
EXCLUDE_GA4_COUNTRIES = ["China", "Hong Kong", "Macao", "Taiwan"]   # GA4's exact country names
EXCLUDE_GSC_COUNTRIES = ["chn", "hkg", "mac", "twn"]                # Search Console's ISO-3166-1 alpha-3 codes

SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
]

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_credentials():
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw)
    return Credentials.from_service_account_info(info, scopes=SCOPES)


# ---------------------------------------------------------------------------
# Calendar month helpers
# ---------------------------------------------------------------------------

def shift_month(year, month, delta):
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def month_bounds(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


# ---------------------------------------------------------------------------
# Search Console helpers
# ---------------------------------------------------------------------------

def gsc_query(service, site_url, dimensions, start, end, row_limit=25000):
    body = {
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "dimensions": dimensions,
        "rowLimit": row_limit,
    }
    resp = service.searchanalytics().query(siteUrl=site_url, body=body).execute()
    rows = []
    for r in resp.get("rows", []):
        row = {dim: r["keys"][i] for i, dim in enumerate(dimensions)}
        row["clicks"] = r["clicks"]
        row["impressions"] = r["impressions"]
        row["position"] = r["position"]
        rows.append(row)
    return rows


def weighted_position(rows):
    total_impr = sum(r["impressions"] for r in rows)
    if total_impr == 0:
        return 0
    return round(sum(r["position"] * r["impressions"] for r in rows) / total_impr, 1)


def summarize(rows):
    clicks = sum(r["clicks"] for r in rows)
    impressions = sum(r["impressions"] for r in rows)
    ctr = round(clicks / impressions, 4) if impressions else 0
    return {"clicks": clicks, "impressions": impressions, "ctr": ctr, "position": weighted_position(rows)}


def group_by(rows, key):
    groups = {}
    for r in rows:
        groups.setdefault(r[key], []).append(r)
    out = []
    for k, group_rows in groups.items():
        s = summarize(group_rows)
        s[key] = k
        out.append(s)
    return out


# ---------------------------------------------------------------------------
# GA4 helper
# ---------------------------------------------------------------------------

def ga4_totals(client, property_id, start, end):
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="sessions"), Metric(name="activeUsers"), Metric(name="conversions")],
    )
    resp = client.run_report(request)
    sessions = active_users = conversions = 0
    for row in resp.rows:
        if row.dimension_values[0].value in EXCLUDE_GA4_COUNTRIES:
            continue
        sessions += int(row.metric_values[0].value)
        active_users += int(row.metric_values[1].value)
        conversions += int(row.metric_values[2].value)
    return {"sessions": sessions, "activeUsers": active_users, "conversions": conversions}


# ---------------------------------------------------------------------------
# Per-month snapshot
# ---------------------------------------------------------------------------

def build_month_snapshot(brand, gsc_service, ga4_client, year, month, cutoff_date):
    start, end = month_bounds(year, month)
    end = min(end, cutoff_date)
    if start > end:
        return None  # too early in the month for any data to exist yet

    label = f"{calendar.month_abbr[month]} {year}"
    print(f"[{brand['label']}] {label}: {start} to {end}")

    def clean(rows):
        return [r for r in rows if r["country"] not in EXCLUDE_GSC_COUNTRIES]

    qc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["query", "country"], start, end))
    pc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["page", "country"], start, end))
    dc = clean(gsc_query(gsc_service, brand["gsc_site_url"], ["device", "country"], start, end))

    summary = summarize(qc)

    brand_kw = brand["brand_keyword"].lower()
    is_branded = lambda q: brand_kw in q.lower()

    branded_rows = [r for r in qc if is_branded(r["query"])]
    nonbranded_rows = [r for r in qc if not is_branded(r["query"])]
    branded_summary = summarize(branded_rows)
    nonbranded_summary = summarize(nonbranded_rows)
    branded_share_pct = round(branded_summary["clicks"] / summary["clicks"] * 100, 1) if summary["clicks"] else 0

    branded_keywords = sorted(group_by(branded_rows, "query"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_KEYWORDS]
    non_branded_keywords = sorted(group_by(nonbranded_rows, "query"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_KEYWORDS]
    pages = sorted(group_by(pc, "page"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_PAGES]
    countries = sorted(group_by(qc, "country"), key=lambda r: r["clicks"], reverse=True)[:TOP_N_COUNTRIES]
    devices = sorted(group_by(dc, "device"), key=lambda r: r["clicks"], reverse=True)

    ga4 = ga4_totals(ga4_client, brand["ga4_property_id"], start, end)

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
        "ga4": ga4,
    }


def build_brand_report(brand, gsc_service, ga4_client):
    today = date.today()
    cutoff_date = today - timedelta(days=GSC_LAG_DAYS)

    months = []
    for i in range(LOOKBACK_MONTHS):
        y, m = shift_month(today.year, today.month, -i)
        snapshot = build_month_snapshot(brand, gsc_service, ga4_client, y, m, cutoff_date)
        if snapshot:
            months.append(snapshot)

    return {
        "brand": brand["label"],
        "color": brand["color"],
        "generated_at": today.isoformat(),
        "months": months,   # newest first
    }


def main():
    creds = get_credentials()
    gsc_service = build("searchconsole", "v1", credentials=creds)
    ga4_client = BetaAnalyticsDataClient(credentials=creds)

    os.makedirs("data", exist_ok=True)
    for brand in BRANDS:
        report = build_brand_report(brand, gsc_service, ga4_client)
        out_path = f"data/{brand['label'].lower()}.json"
        with open(out_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote {out_path} ({len(report['months'])} months)")


if __name__ == "__main__":
    main()

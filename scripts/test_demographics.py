"""
ONE-OFF DIAGNOSTIC — not part of the daily pipeline, doesn't touch data/*.json.

Tests whether GA4's userAgeBracket / userGender dimensions come back with
usable data for Anzo and DLSM, or whether they're empty/thresholded (Google
suppresses demographic rows when the underlying audience segment is too
small to protect user privacy — a real risk here since this data is already
sliced by organic-only + country-exclusions + per-brand).

Run via the "Test demographics (one-off)" GitHub Action (Actions tab ->
select it -> Run workflow). Output shows up in that run's log — no file is
written, nothing here affects the live report.
"""

import os
import json
from datetime import date, timedelta

from google.oauth2.service_account import Credentials
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

BRANDS = [
    {"label": "Anzo", "ga4_property_id": "480686179"},
    {"label": "DLSM", "ga4_property_id": "474006416"},
]

# Last 30 days — the widest recent window this pipeline normally works with,
# giving demographic thresholding the best realistic chance of clearing.
END = date.today() - timedelta(days=3)   # match the GSC lag window for consistency
START = END - timedelta(days=30)


def get_credentials():
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw)
    return Credentials.from_service_account_info(info, scopes=SCOPES)


def run_report(client, property_id, dimension_name):
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=START.isoformat(), end_date=END.isoformat())],
        dimensions=[Dimension(name=dimension_name), Dimension(name="sessionDefaultChannelGroup")],
        metrics=[Metric(name="activeUsers")],
    )
    return client.run_report(request)


def summarize(response, dimension_label):
    total_rows = len(response.rows)
    organic_rows = []
    not_set_users = 0
    total_users = 0
    for row in response.rows:
        dim_value = row.dimension_values[0].value
        channel = row.dimension_values[1].value
        users = int(row.metric_values[0].value)
        total_users += users
        if dim_value in ("(not set)", ""):
            not_set_users += users
        if channel == "Organic Search":
            organic_rows.append((dim_value, users))

    print(f"  Total rows returned: {total_rows}")
    print(f"  Total activeUsers across all rows: {total_users}")
    print(f"  activeUsers with {dimension_label} = '(not set)' (i.e. unknown/suppressed): {not_set_users}"
          f"  ({round(not_set_users / total_users * 100, 1) if total_users else 0}% of total)")
    print(f"  Rows where channel = 'Organic Search' specifically:")
    if not organic_rows:
        print("    (none — GA4 returned no organic-channel rows for this dimension at all)")
    else:
        organic_rows.sort(key=lambda r: -r[1])
        for value, users in organic_rows:
            print(f"    {value or '(not set)'}: {users} activeUsers")


def main():
    creds = get_credentials()
    client = BetaAnalyticsDataClient(credentials=creds)

    print(f"Date range tested: {START.isoformat()} to {END.isoformat()} (last 30 days, GSC-lag-adjusted)")
    print("=" * 70)

    for brand in BRANDS:
        print(f"\n### {brand['label']} — userAgeBracket ###")
        try:
            resp = run_report(client, brand["ga4_property_id"], "userAgeBracket")
            summarize(resp, "userAgeBracket")
        except Exception as e:
            print(f"  ERROR: {e}")

        print(f"\n### {brand['label']} — userGender ###")
        try:
            resp = run_report(client, brand["ga4_property_id"], "userGender")
            summarize(resp, "userGender")
        except Exception as e:
            print(f"  ERROR: {e}")

    print("\n" + "=" * 70)
    print("How to read this: if 'Organic Search' rows are missing entirely, or")
    print("the '(not set)' share is very high (>50-70%), the data isn't reliable")
    print("enough to build persona stats from — same failure mode that got the")
    print("old Interests/brandingInterest dimension removed previously.")


if __name__ == "__main__":
    main()

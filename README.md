# Anzo / DLSM SEO Report

An auto-updating GA4 + Search Console report, hosted for free on GitHub Pages.
Toggle between Anzo and DLSM (each with its own brand color), and compare
any month against any other month — not just adjacent ones.

## How it works
- `scripts/fetch_data.py` pulls GA4 + Search Console data for both brands, archiving one
  snapshot per calendar month (as far back as Search Console retains data, ~16 months),
  and writes `data/anzo.json` / `data/dlsm.json`.
- `.github/workflows/daily-update.yml` runs that script automatically every day via
  GitHub Actions and commits the refreshed JSON.
- `index.html` / `style.css` / `app.js` render the report from those JSON files — no
  build step, just plain files served by GitHub Pages. All the "vs. previous month"
  math happens live in the browser based on whichever two months you pick, so the
  data script never needs to re-run just because you changed the comparison.

## One-time setup
1. Edit `scripts/fetch_data.py` — fill in your real GA4 Property IDs in the `BRANDS`
   list near the top (also double check the `gsc_site_url` values match your verified
   Search Console properties).
2. Add a repository secret named `GOOGLE_SERVICE_ACCOUNT_JSON` containing the full
   contents of your service account's JSON key (Settings → Secrets and variables →
   Actions → New repository secret).
3. Enable GitHub Pages (Settings → Pages → deploy from the `main` branch, root folder).
4. Trigger the workflow once by hand (Actions tab → "Daily SEO report update" → Run
   workflow) to generate the first data files. This one pulls ~16 months of history
   per brand, so it takes a few minutes — that's expected.

After that, it updates itself every day. You don't need to touch it again unless you
want to:
- Change the schedule → edit the `cron` line in `.github/workflows/daily-update.yml`
- Change the excluded regions or a brand's keyword → top of `scripts/fetch_data.py`
- Use your real fonts → drop your existing `public/font/pingfang` and `public/font/sans`
  folders into `/font` at the repo root (see `font/README.md` for the exact file list)
- Change a brand's color → the `color` field in `scripts/fetch_data.py`'s `BRANDS` list
- Change the report's passphrase → `REPORT_PASSWORD` near the top of `app.js` (this is
  a light deterrent only, not real security — see the comment above it in the code)
- Change how many months get re-fetched daily / keep day-level detail → `REFRESH_MONTHS`
  and `DAILY_DETAIL_MONTHS` in `scripts/fetch_data.py`

## How the data script stays fast
Older months aren't re-downloaded every day — `fetch_data.py` reads whatever's already
in `data/<brand>.json`, only re-fetches the most recent `REFRESH_MONTHS` months, and
carries the rest forward unchanged. Full per-day keyword/page/country/device detail
(needed for the Day-vs-Day comparison mode) is only kept for the most recent
`DAILY_DETAIL_MONTHS` months, to keep file sizes reasonable — older months still have
full monthly totals, just not a day-by-day breakdown.

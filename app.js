// dataCache holds each brand's JSON after its first fetch, so switching
// between Anzo and DLSM doesn't re-download data you've already loaded.
const dataCache = {};
let currentBrand = "anzo";
let months = [];          // the loaded brand's months array, newest first

// A row is flagged as a "big swing" (colored background in tables) only if
// it moved at least this % AND has at least this many combined clicks across
// both periods — the baseline check stops a query going from 1 click to 3
// clicks (a 200% "swing") from being flagged as meaningful when it's just noise.
const SWING_THRESHOLD_PCT = 50;
const SWING_MIN_BASELINE = 10;

// ---------------------------------------------------------------------------
// Password gate — a light deterrent, NOT real security (this is a public
// static site; anyone who views page source can read REPORT_PASSWORD below).
// For genuine access control, put this behind Cloudflare Access or similar.
// ---------------------------------------------------------------------------

const REPORT_PASSWORD = "mkt11"; // <-- change this to your own passphrase before sharing the link

// Hides the password screen and reveals the actual report underneath it.
function unlockReport() {
  document.getElementById("password-gate").style.display = "none";
  document.getElementById("report-root").style.display = "block";
}

// Runs when the Unlock button is clicked (or Enter is pressed) — checks the
// typed passphrase, remembers success for this browser tab via
// sessionStorage so a reload within the same session skips the prompt.
function attemptUnlock() {
  const input = document.getElementById("password-input");
  if (input.value === REPORT_PASSWORD) {
    sessionStorage.setItem("seo_report_unlocked", "true");
    unlockReport();
  } else {
    document.getElementById("password-error").style.display = "block";
    input.value = "";
    input.focus();
  }
}

// Runs immediately on page load, before anything else — if this tab already
// unlocked the report earlier in the session, skip straight past the gate.
if (sessionStorage.getItem("seo_report_unlocked") === "true") {
  unlockReport();
}
document.getElementById("password-submit").addEventListener("click", attemptUnlock);
document.getElementById("password-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptUnlock();
});

// Eye-icon button: toggles the password field between masked (dots) and
// plain text, so you can actually see what you typed before submitting.
// Swaps the icon between a plain eye (click to reveal) and an eye with a
// line through it (click to hide again) to reflect the current state.
const EYE_ICON = `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>`;
const EYE_OFF_ICON = `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/>`;

document.getElementById("password-toggle").addEventListener("click", () => {
  const input = document.getElementById("password-input");
  const btn = document.getElementById("password-toggle");
  const icon = document.getElementById("password-eye-icon");
  const nowVisible = input.type === "password";
  input.type = nowVisible ? "text" : "password";
  icon.innerHTML = nowVisible ? EYE_OFF_ICON : EYE_ICON;
  btn.setAttribute("aria-label", nowVisible ? "Hide passphrase" : "Show passphrase");
  input.focus();
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

// Fetches data/<brand>.json (e.g. data/anzo.json), caching the result so
// switching brands back and forth doesn't keep re-downloading. The
// "?_=timestamp" on the URL stops the browser from serving a stale cached
// copy of the file itself. Returns null on any failure (missing file, bad
// JSON, etc.) so the caller can show an empty-state message instead of crashing.
async function loadBrand(brand) {
  if (dataCache[brand]) return dataCache[brand];
  try {
    const res = await fetch(`data/${brand}.json?_=${Date.now()}`);
    if (!res.ok) throw new Error("not found");
    const json = await res.json();
    dataCache[brand] = json;
    return json;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers — small, reused everywhere numbers/percentages are displayed
// ---------------------------------------------------------------------------

// 1234567 -> "1,234,567". Used for every raw count in the report (clicks,
// impressions, sessions, etc.)
function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US");
}

// 0.0234 -> "2.3%". Used for CTR and any other ratio stored as a decimal.
function fmtPct(n, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

// Standard "how much did this change" percentage: (new - old) / old * 100.
// Returns null (rendered as "—") when there's no baseline to compare against.
function pctChange(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

// Turns a raw percentage-change number into the colored "▲ 12.3%" /
// "▼ 8.0%" markup used throughout the KPI cards and every comparison table.
function fmtDelta(pct) {
  if (pct === null || pct === undefined) return `<span class="delta-flat">—</span>`;
  const cls = pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "delta-flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// Safely inserts arbitrary text (a search query, a page URL) into HTML
// without it being interpreted as markup — prevents a query containing "<"
// or "&" from breaking the page layout.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Reads the current live value of a CSS custom property (e.g. "--accent")
// as a plain color string — needed because Chart.js draws to a <canvas>,
// which can't understand "var(--accent)" the way regular CSS can.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ISO-3166-1 alpha-3 (lowercase, matching Search Console's country dimension) -> display name.
// Used so the Top Countries table shows "Singapore" instead of "sgp".
const COUNTRY_NAMES = {
  afg: "Afghanistan", alb: "Albania", dza: "Algeria", asm: "American Samoa", and: "Andorra",
  ago: "Angola", aia: "Anguilla", ata: "Antarctica", atg: "Antigua and Barbuda", arg: "Argentina",
  arm: "Armenia", abw: "Aruba", aus: "Australia", aut: "Austria", aze: "Azerbaijan",
  bhs: "Bahamas", bhr: "Bahrain", bgd: "Bangladesh", brb: "Barbados", blr: "Belarus",
  bel: "Belgium", blz: "Belize", ben: "Benin", bmu: "Bermuda", btn: "Bhutan",
  bol: "Bolivia", bih: "Bosnia and Herzegovina", bwa: "Botswana", bra: "Brazil", brn: "Brunei",
  bgr: "Bulgaria", bfa: "Burkina Faso", bdi: "Burundi", khm: "Cambodia", cmr: "Cameroon",
  can: "Canada", cpv: "Cabo Verde", cym: "Cayman Islands", caf: "Central African Republic", tcd: "Chad",
  chl: "Chile", chn: "China", col: "Colombia", com: "Comoros", cog: "Congo",
  cod: "DR Congo", cri: "Costa Rica", civ: "Côte d'Ivoire", hrv: "Croatia", cub: "Cuba",
  cyp: "Cyprus", cze: "Czechia", dnk: "Denmark", dji: "Djibouti", dma: "Dominica",
  dom: "Dominican Republic", ecu: "Ecuador", egy: "Egypt", slv: "El Salvador", gnq: "Equatorial Guinea",
  eri: "Eritrea", est: "Estonia", swz: "Eswatini", eth: "Ethiopia", fji: "Fiji",
  fin: "Finland", fra: "France", guf: "French Guiana", pyf: "French Polynesia", gab: "Gabon",
  gmb: "Gambia", geo: "Georgia", deu: "Germany", gha: "Ghana", gib: "Gibraltar",
  grc: "Greece", grl: "Greenland", grd: "Grenada", glp: "Guadeloupe", gum: "Guam",
  gtm: "Guatemala", gin: "Guinea", gnb: "Guinea-Bissau", guy: "Guyana", hti: "Haiti",
  hnd: "Honduras", hkg: "Hong Kong", hun: "Hungary", isl: "Iceland", ind: "India",
  idn: "Indonesia", irn: "Iran", irq: "Iraq", irl: "Ireland", isr: "Israel",
  ita: "Italy", jam: "Jamaica", jpn: "Japan", jor: "Jordan", kaz: "Kazakhstan",
  ken: "Kenya", kir: "Kiribati", kwt: "Kuwait", kgz: "Kyrgyzstan", lao: "Laos",
  lva: "Latvia", lbn: "Lebanon", lso: "Lesotho", lbr: "Liberia", lby: "Libya",
  lie: "Liechtenstein", ltu: "Lithuania", lux: "Luxembourg", mac: "Macao", mdg: "Madagascar",
  mwi: "Malawi", mys: "Malaysia", mdv: "Maldives", mli: "Mali", mlt: "Malta",
  mtq: "Martinique", mrt: "Mauritania", mus: "Mauritius", myt: "Mayotte", mex: "Mexico",
  mda: "Moldova", mco: "Monaco", mng: "Mongolia", mne: "Montenegro", msr: "Montserrat",
  mar: "Morocco", moz: "Mozambique", mmr: "Myanmar", nam: "Namibia", nru: "Nauru",
  npl: "Nepal", nld: "Netherlands", ncl: "New Caledonia", nzl: "New Zealand", nic: "Nicaragua",
  ner: "Niger", nga: "Nigeria", niu: "Niue", prk: "North Korea", mkd: "North Macedonia",
  nor: "Norway", omn: "Oman", pak: "Pakistan", plw: "Palau", pse: "Palestine",
  pan: "Panama", png: "Papua New Guinea", pry: "Paraguay", per: "Peru", phl: "Philippines",
  pol: "Poland", prt: "Portugal", pri: "Puerto Rico", qat: "Qatar", reu: "Réunion",
  rou: "Romania", rus: "Russia", rwa: "Rwanda", kna: "Saint Kitts and Nevis", lca: "Saint Lucia",
  vct: "Saint Vincent and the Grenadines", wsm: "Samoa", smr: "San Marino", stp: "São Tomé and Príncipe", sau: "Saudi Arabia",
  sen: "Senegal", srb: "Serbia", syc: "Seychelles", sle: "Sierra Leone", sgp: "Singapore",
  svk: "Slovakia", svn: "Slovenia", slb: "Solomon Islands", som: "Somalia", zaf: "South Africa",
  kor: "South Korea", ssd: "South Sudan", esp: "Spain", lka: "Sri Lanka", sdn: "Sudan",
  sur: "Suriname", swe: "Sweden", che: "Switzerland", syr: "Syria", twn: "Taiwan",
  tjk: "Tajikistan", tza: "Tanzania", tha: "Thailand", tls: "Timor-Leste", tgo: "Togo",
  ton: "Tonga", tto: "Trinidad and Tobago", tun: "Tunisia", tur: "Turkey", tkm: "Turkmenistan",
  tuv: "Tuvalu", uga: "Uganda", ukr: "Ukraine", are: "United Arab Emirates", gbr: "United Kingdom",
  usa: "United States", ury: "Uruguay", uzb: "Uzbekistan", vut: "Vanuatu", vat: "Vatican City",
  ven: "Venezuela", vnm: "Vietnam", vgb: "British Virgin Islands", vir: "U.S. Virgin Islands", yem: "Yemen",
  zmb: "Zambia", zwe: "Zimbabwe",
};

// Looks up a country code's display name; falls back to the uppercased raw
// code for anything not in the map above (shouldn't normally happen).
function countryName(code) {
  const c = String(code).toLowerCase();
  return COUNTRY_NAMES[c] || String(code).toUpperCase();
}

// ---------------------------------------------------------------------------
// Comparison helpers — any month vs any month (or any day vs any day)
// ---------------------------------------------------------------------------

// Turns an array of rows into a lookup object keyed by one field, e.g.
// indexBy(countries, "country") -> { usa: {...}, gbr: {...}, ... }. Used so
// the functions below can find "the matching row in the other period" in
// one step instead of scanning the whole array each time.
function indexBy(rows, key) {
  const map = {};
  rows.forEach(r => { map[r[key]] = r; });
  return map;
}

// Attaches "what was this in the comparison period" to every row of the
// CURRENT period's list. Rows that only exist in the current period (new
// this month) get a previous value of 0. Used for the Branded/Non-branded
// keyword tables, Top Pages, and Top Countries — anywhere the current
// period's top-N list is the source of truth and we just need deltas added.
function withDelta(currRows, compRows, key) {
  const compMap = indexBy(compRows, key);
  return currRows.map(r => {
    const c = compMap[r[key]] || { clicks: 0 };
    return {
      ...r,
      clicks_previous: c.clicks,
      clicks_change_pct: pctChange(r.clicks, c.clicks),
    };
  });
}

// Like withDelta, but for the "Top Keyword Movers" table specifically —
// unlike the tables above, a query that existed ONLY in the comparison
// period (and dropped to zero clicks now) still needs to show up, so this
// builds the UNION of both periods' keys rather than just decorating the
// current period's list. Also computes "status" (New/Lost badge) and
// "abs_change" (used as the default sort so the biggest swings, up or down,
// surface first).
function unionMovers(currRows, compRows, key, limit = 500) {
  const currMap = indexBy(currRows, key);
  const compMap = indexBy(compRows, key);
  const keys = new Set([...Object.keys(currMap), ...Object.keys(compMap)]);
  const merged = [];
  keys.forEach(k => {
    const c = currMap[k] || { clicks: 0, impressions: 0, ctr: 0, position: null };
    const p = compMap[k] || { clicks: 0 };
    const change = c.clicks - p.clicks;
    merged.push({
      [key]: k,
      clicks: c.clicks,
      impressions: c.impressions,
      ctr: c.ctr,
      position: c.position,
      clicks_previous: p.clicks,
      clicks_change: change,
      clicks_change_pct: pctChange(c.clicks, p.clicks),
      abs_change: Math.abs(change),
      status: (p.clicks === 0 && c.clicks > 0) ? "New" : (c.clicks === 0 && p.clicks > 0) ? "Lost" : "",
    });
  });
  return merged.sort((a, b) => b.abs_change - a.abs_change).slice(0, limit);
}

// Decides whether a table row should get the teal/orange "big swing"
// highlight — see the SWING_THRESHOLD_PCT / SWING_MIN_BASELINE comment above.
function swingRowClass(r) {
  const baseline = (r.clicks || 0) + (r.clicks_previous || 0);
  if (baseline < SWING_MIN_BASELINE) return "";
  if (r.clicks_change_pct === null || r.clicks_change_pct === undefined) return "";
  if (r.clicks_change_pct >= SWING_THRESHOLD_PCT) return "row-swing-up";
  if (r.clicks_change_pct <= -SWING_THRESHOLD_PCT) return "row-swing-down";
  return "";
}

// Renders the small green "New" / orange "Lost" pill next to a query in the
// Top Keyword Movers table (see unionMovers' "status" field above).
function statusBadge(status) {
  if (status === "New") return `<span class="badge badge-new">New</span>`;
  if (status === "Lost") return `<span class="badge badge-lost">Lost</span>`;
  return "";
}

// ---------------------------------------------------------------------------
// Day-vs-day support — builds a "day snapshot" shaped exactly like a month
// object, so all the existing render functions work unchanged in Day mode.
// Only available for days inside a month that has daily_detail (recent
// months only — see fetch_data.py).
// ---------------------------------------------------------------------------

// Given "2026-08-15", finds which loaded month object (Aug 2026) contains it.
function findMonthContainingDate(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return months.find(mo => mo.year === y && mo.month === m);
}

// Same math as the Python summarize() function, but run in the browser —
// used to total up a day's branded/non-branded keyword rows into one
// clicks/impressions/ctr/position summary, since the data script only stores
// the individual keyword rows for a day, not a pre-computed total.
function summarizeDayRows(rows) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const ctr = impressions ? clicks / impressions : 0;
  const posWeight = rows.reduce((s, r) => s + (r.position || 0) * r.impressions, 0);
  const position = impressions ? Math.round((posWeight / impressions) * 10) / 10 : 0;
  return { clicks, impressions, ctr, position };
}

// Scans every loaded month for dates that have full daily_detail archived,
// and returns them newest-first — this is what populates the two "Day"
// dropdowns in the header when Compare-by is switched to "Day".
function listAvailableDays() {
  const days = [];
  months.forEach(mo => {
    if (mo.daily_detail) {
      Object.keys(mo.daily_detail).forEach(d => days.push(d));
    }
  });
  return [...new Set(days)].sort().reverse(); // newest first
}

// "2026-07-31" -> "Jul 31, 2026". Used for both day-dropdown labels and the
// Trend chart's per-day legend labels in Day mode.
function fmtDateLabel(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Flattens every loaded month's lightweight daily totals (mo.daily) into one
// {date: {clicks, impressions, ...}} lookup spanning the whole loaded
// history — lets trailingWindow() below pull a date range that may cross a
// calendar month boundary without caring which month each day came from.
function buildDailyIndex() {
  const idx = {};
  months.forEach(mo => {
    (mo.daily || []).forEach(d => { idx[d.date] = d; });
  });
  return idx;
}

const TREND_DAY_WINDOW = 3; // how many trailing days the Trend chart shows in Day mode — e.g. picking Aug 30 shows Aug 28-30

// Builds a `days`-long daily series ENDING ON dateStr (inclusive) — e.g.
// trailingWindow("2026-07-31", 14) returns Jul 18 through Jul 31. This is
// what makes Day-mode comparisons always show genuinely different data:
// unlike using the enclosing month's full daily array (the original, buggy
// approach), two different selected days NEVER produce the same window,
// even if both fall in the same calendar month. Dates outside the archived
// range come back as null-valued points, which Chart.js simply skips.
function trailingWindow(dateStr, days, idx) {
  const end = new Date(dateStr + "T00:00:00");
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    series.push(idx[iso] || { date: iso, clicks: null, impressions: null, ctr: null, position: null, sessions: null });
  }
  return series;
}

// The key piece that makes Day mode work without duplicating every render
// function: takes one date string and reshapes that day's data into an
// object with the exact same fields a "month" object has (summary,
// branded_summary, branded_keywords, pages, countries, devices, ga4, ...).
// Every render function below can then be handed either a real month or one
// of these day snapshots and neither knows the difference. Returns null if
// this particular day doesn't have daily_detail archived (too old).
function buildDaySnapshot(dateStr) {
  const month = findMonthContainingDate(dateStr);
  if (!month || !month.daily_detail || !month.daily_detail[dateStr]) return null;
  const detail = month.daily_detail[dateStr];
  const dayTotals = (month.daily || []).find(d => d.date === dateStr) ||
    { clicks: 0, impressions: 0, ctr: 0, position: null, sessions: 0, engagedSessions: 0, bounceRate: 0, newUsers: 0, activeUsers: 0, keyEvents: 0 };

  const brandedSum = summarizeDayRows(detail.branded_keywords);
  const nonBrandedSum = summarizeDayRows(detail.non_branded_keywords);
  const totalClicks = brandedSum.clicks + nonBrandedSum.clicks || 1;

  return {
    label: dateStr,
    year: month.year,
    month: month.month,
    summary: { clicks: dayTotals.clicks, impressions: dayTotals.impressions, ctr: dayTotals.ctr, position: dayTotals.position },
    branded_summary: brandedSum,
    non_branded_summary: nonBrandedSum,
    branded_share_pct: Math.round((brandedSum.clicks / totalClicks) * 1000) / 10,
    branded_keywords: detail.branded_keywords,
    non_branded_keywords: detail.non_branded_keywords,
    pages: detail.pages,
    countries: detail.countries,
    devices: detail.devices,
    ga4: {
      sessions: dayTotals.sessions,
      engagedSessions: dayTotals.engagedSessions,
      bounceRate: dayTotals.bounceRate,
      newUsers: dayTotals.newUsers,
      activeUsers: dayTotals.activeUsers,
      keyEvents: dayTotals.keyEvents,
    },
  };
}

// ---------------------------------------------------------------------------
// Quarter-vs-quarter support — merges whichever archived months fall in
// each quarter into one combined snapshot, shaped the same way a month or
// day snapshot is, so every render function works unchanged here too.
// ---------------------------------------------------------------------------

// Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec.
function findQuarter(month) {
  return Math.ceil(month / 3);
}

// Scans every loaded month and returns the distinct quarters they fall
// into, newest first — populates the two Quarter dropdowns. A quarter
// still in progress (or with a gap from a month that hasn't been
// backfilled yet) still appears — it just merges whatever months ARE
// loaded for it, same principle as a partial "current month".
function listAvailableQuarters() {
  const seen = new Set();
  const quarters = [];
  months.forEach(mo => {
    const q = findQuarter(mo.month);
    const key = `${mo.year}-Q${q}`;
    if (!seen.has(key)) {
      seen.add(key);
      quarters.push({ year: mo.year, quarter: q, key, label: `Q${q} ${mo.year}` });
    }
  });
  return quarters.sort((a, b) => (b.year - a.year) || (b.quarter - a.quarter));
}

// Sums a list of {clicks, impressions, ctr, position} objects into one —
// clicks/impressions add directly, but ctr and position are RATIOS, so
// they're recomputed from the summed totals rather than added together
// (same weighted-aggregation principle used throughout fetch_data.py).
function sumSummaries(list) {
  const clicks = list.reduce((s, x) => s + (x.clicks || 0), 0);
  const impressions = list.reduce((s, x) => s + (x.impressions || 0), 0);
  const ctr = impressions ? clicks / impressions : 0;
  const posWeight = list.reduce((s, x) => s + (x.position || 0) * (x.impressions || 0), 0);
  const position = impressions ? Math.round((posWeight / impressions) * 10) / 10 : 0;
  return { clicks, impressions, ctr, position };
}

// Merges several months' worth of one row-list (keywords/pages/countries/
// devices/GA4 breakdowns — anything shaped as an array of objects sharing
// one identifying field) into a single combined list: matching rows (same
// query, same page, same country, ...) get their numeric fields summed
// across months, with ctr/position recomputed from the summed totals
// rather than summed directly, same as sumSummaries above. Re-sorts by
// sortKey (defaults to whatever the FIRST row's fields suggest is the
// primary metric) so the merged list comes out ranked, not just concatenated.
function mergeRowLists(lists, keyField, sortKey) {
  const merged = {};
  lists.forEach(list => {
    (list || []).forEach(row => {
      const k = row[keyField];
      if (!merged[k]) merged[k] = { [keyField]: k, _posWeight: 0, _imprForPos: 0 };
      const acc = merged[k];
      Object.keys(row).forEach(field => {
        if (field === keyField || field === "ctr" || field === "position") return;
        if (typeof row[field] !== "number") return;
        acc[field] = (acc[field] || 0) + row[field];
      });
      if (typeof row.position === "number" && typeof row.impressions === "number") {
        acc._posWeight += row.position * row.impressions;
        acc._imprForPos += row.impressions;
      }
    });
  });
  let out = Object.values(merged).map(acc => {
    const row = { ...acc };
    if (acc._imprForPos > 0) row.position = Math.round((acc._posWeight / acc._imprForPos) * 10) / 10;
    if (typeof row.clicks === "number" && typeof row.impressions === "number" && row.impressions > 0) {
      row.ctr = Math.round((row.clicks / row.impressions) * 10000) / 10000;
    }
    delete row._posWeight;
    delete row._imprForPos;
    return row;
  });
  const effectiveSortKey = sortKey || Object.keys(out[0] || {}).find(k => k !== keyField && typeof out[0][k] === "number");
  if (effectiveSortKey) out.sort((a, b) => (b[effectiveSortKey] || 0) - (a[effectiveSortKey] || 0));
  return out;
}

// Sums a quarter's worth of monthly GA4 totals. Sessions, engaged
// sessions, and key events are genuinely additive (no double-counting
// risk). New/active users are summed too, but — worth knowing — a user
// active in more than one month of the quarter gets counted once per
// month they were active in, not deduplicated into one true quarterly
// unique count. Getting a true dedup would need a separate live API call
// for the whole quarter's date range rather than merging monthly
// snapshots; summing is the honest, cheap approximation used here.
function sumGa4(list) {
  const sessions = list.reduce((s, x) => s + (x.sessions || 0), 0);
  const engagedSessions = list.reduce((s, x) => s + (x.engagedSessions || 0), 0);
  const newUsers = list.reduce((s, x) => s + (x.newUsers || 0), 0);
  const activeUsers = list.reduce((s, x) => s + (x.activeUsers || 0), 0);
  const keyEvents = list.reduce((s, x) => s + (x.keyEvents || 0), 0);
  const bounceRate = sessions ? Math.round((1 - engagedSessions / sessions) * 10000) / 10000 : 0;
  return { sessions, engagedSessions, bounceRate, newUsers, activeUsers, keyEvents };
}

// Sums the funnel's per-stage counts across a quarter's months — assumes
// every month has the same stages in the same order, which holds as long
// as funnel_stages in fetch_data.py hasn't changed mid-quarter.
function mergeFunnel(lists) {
  const first = lists.find(l => l && l.length > 0);
  if (!first) return [];
  return first.map((stage, i) => ({
    stage: stage.stage,
    count: lists.reduce((s, l) => s + ((l && l[i]) ? l[i].count : 0), 0),
  }));
}

// The main quarter-mode builder — merges every loaded month in
// (year, quarter) into one snapshot shaped exactly like a month object, so
// every render function downstream works completely unchanged whether
// it's handed a real month, a day snapshot, or this.
function buildQuarterSnapshot(year, quarter) {
  const quarterMonths = months.filter(mo => mo.year === year && findQuarter(mo.month) === quarter);
  if (quarterMonths.length === 0) return null;

  const branded_summary = sumSummaries(quarterMonths.map(m => m.branded_summary));
  const non_branded_summary = sumSummaries(quarterMonths.map(m => m.non_branded_summary));
  const totalClicks = branded_summary.clicks + non_branded_summary.clicks || 1;

  return {
    label: `Q${quarter} ${year}`,
    year,
    quarter,
    summary: sumSummaries(quarterMonths.map(m => m.summary)),
    branded_summary,
    non_branded_summary,
    branded_share_pct: Math.round((branded_summary.clicks / totalClicks) * 1000) / 10,
    branded_keywords: mergeRowLists(quarterMonths.map(m => m.branded_keywords), "query", "clicks"),
    non_branded_keywords: mergeRowLists(quarterMonths.map(m => m.non_branded_keywords), "query", "clicks"),
    pages: mergeRowLists(quarterMonths.map(m => m.pages), "page", "clicks"),
    countries: mergeRowLists(quarterMonths.map(m => m.countries), "country", "clicks"),
    devices: mergeRowLists(quarterMonths.map(m => m.devices), "device", "clicks"),
    key_events_by_name: mergeRowLists(quarterMonths.map(m => m.key_events_by_name || []), "label", "keyEvents"),
    page_titles: mergeRowLists(quarterMonths.map(m => m.page_titles || []), "label", "screenPageViews"),
    operating_systems: mergeRowLists(quarterMonths.map(m => m.operating_systems || []), "label", "activeUsers"),
    device_users: mergeRowLists(quarterMonths.map(m => m.device_users || []), "label", "activeUsers"),
    funnel: mergeFunnel(quarterMonths.map(m => m.funnel || [])),
    ga4: sumGa4(quarterMonths.map(m => m.ga4)),
    // Concatenated across however many months are actually loaded for this
    // quarter — feeds the Trend chart the same way a single month's own
    // .daily array would, just longer.
    daily: quarterMonths.flatMap(m => m.daily || []).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------------------------------------------------------------------
// Reusable interactive table: click a header to sort, type to search
// ---------------------------------------------------------------------------

// Builds one sortable/searchable table inside `container`. This one function
// powers every data table in the report (Movers, Branded/Non-branded
// keywords, Pages, Countries, CTR Opportunities) — each caller just passes
// its own column definitions and rows.
//
// `columns` is an array of {key, label, align, format, wrap, defaultDir}:
//   - key: which field on each row to read
//   - label: header text
//   - align: "num" right-aligns the column
//   - format: optional function to turn the raw value into display HTML
//   - wrap: allows long text (URLs, queries) to wrap instead of forcing width
//   - defaultDir: which direction to sort first when this column is clicked
//     (e.g. "asc" for Position, since a lower number is "better")
//
// `opts` controls the table as a whole: defaultSortKey/defaultSortDir (how
// it's sorted when first rendered), searchKey (which field the search box
// filters on), searchable (set false to hide the search box), rowClass (a
// function that returns a CSS class per row, used for swing highlighting),
// and pageSize (how many rows show before a "Show all" toggle appears —
// defaults to 30).
//
// IMPORTANT ordering: sorting and searching always run against the FULL
// row set first (see getRows() below); the page-size limit is applied as
// the very last step, only to decide how many of the already-sorted rows
// to display. That order matters — sorting only the visible slice would
// silently give wrong results the moment someone changes the sort column.
function createInteractiveTable(container, columns, allRows, opts = {}) {
  if (!container) return;
  let sortKey = opts.defaultSortKey || columns[0].key;
  let sortDir = opts.defaultSortDir || "desc";
  let search = "";
  let expanded = false;
  const PAGE_SIZE = opts.pageSize || 30;
  const searchable = opts.searchable !== false;
  const searchKey = opts.searchKey || columns[0].key;

  // Build the static shell once. Only the search input needs to survive
  // across re-renders (so it doesn't lose focus while typing) — everything
  // else inside gets rebuilt by renderHead()/renderBody() below. The table
  // sits in its own .table-scroll box so a too-wide table scrolls within
  // itself instead of stretching the whole page.
  container.innerHTML = `
    ${searchable ? `<input type="text" class="table-search" placeholder="Search…">` : ""}
    <div class="table-scroll"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    <div class="table-toggle" style="display:none;"></div>`;

  const theadRow = container.querySelector("thead tr");
  const tbody = container.querySelector("tbody");
  const scrollBox = container.querySelector(".table-scroll");
  const searchInput = searchable ? container.querySelector(".table-search") : null;
  const toggleEl = container.querySelector(".table-toggle");

  // Applies the current search text and sort column/direction to the FULL
  // allRows array, without mutating the original (so switching sort/search
  // back and forth never loses data). Page-size slicing happens later, in
  // renderBody() — never here.
  function getRows() {
    let rows = allRows;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => String(r[searchKey] ?? "").toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      // Missing values always sort to the bottom regardless of direction.
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === "string" || typeof bv === "string") {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }

  // (Re)draws the header row, including the sort-direction arrow, and wires
  // up click handlers on each header cell. Called once at startup and again
  // every time the user clicks a header (since the arrow needs to move).
  function renderHead() {
    theadRow.innerHTML = columns.map(c => {
      const isActive = c.key === sortKey;
      const arrowChar = isActive ? (sortDir === "asc" ? "▲" : "▼") : "⇅";
      const arrowCls = isActive ? "sort-arrow active" : "sort-arrow";
      return `<th class="${c.align === "num" ? "num" : ""}" data-key="${c.key}">${c.label} <span class="${arrowCls}">${arrowChar}</span></th>`;
    }).join("");
    theadRow.querySelectorAll("th[data-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        const col = columns.find(c => c.key === key);
        if (key === sortKey) {
          // Clicking the already-active column flips direction.
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          // Clicking a new column sorts by it, starting from that column's
          // preferred direction (falls back to descending).
          sortKey = key;
          sortDir = (col && col.defaultDir) || "desc";
        }
        renderHead();
        renderBody();
      });
    });
  }

  // (Re)draws just the table body — called on load, and again on every
  // search keystroke, sort click, or Show more/fewer click. Kept separate
  // from renderHead() so typing in the search box never touches (and never
  // steals focus from) the input element itself.
  //
  // Sorts/filters the FULL dataset via getRows(), THEN slices to PAGE_SIZE
  // rows for display (unless expanded) — in that order, always. Also draws
  // the "Show all N rows" / "Show fewer rows" toggle beneath the table when
  // there are more rows than fit on one page.
  function renderBody() {
    const sorted = getRows();
    const displayRows = expanded ? sorted : sorted.slice(0, PAGE_SIZE);

    if (displayRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center; color:var(--muted); padding:20px;">No matching rows</td></tr>`;
    } else {
      tbody.innerHTML = displayRows.map(r => {
        const rowClass = opts.rowClass ? opts.rowClass(r) : "";
        const cells = columns.map(c => {
          const raw = r[c.key];
          const val = c.format ? c.format(raw, r) : (raw ?? "—");
          const cls = [c.align === "num" ? "num" : "", c.wrap ? "query-cell" : ""].filter(Boolean).join(" ");
          return `<td class="${cls}">${val}</td>`;
        }).join("");
        return `<tr class="${rowClass}">${cells}</tr>`;
      }).join("");
    }

    if (sorted.length > PAGE_SIZE) {
      toggleEl.style.display = "block";
      toggleEl.innerHTML = expanded
        ? `<button class="table-toggle-btn">Show fewer rows</button>`
        : `<button class="table-toggle-btn">Show all ${sorted.length} rows</button>`;
      toggleEl.querySelector("button").addEventListener("click", () => {
        expanded = !expanded;
        scrollBox.classList.toggle("expanded", expanded);
        renderBody();
      });
    } else {
      toggleEl.style.display = "none";
      toggleEl.innerHTML = "";
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      search = e.target.value;
      renderBody();
    });
  }

  renderHead();
  renderBody();
}

// ---------------------------------------------------------------------------
// Trend chart (daily, current month vs. compare month, aligned by day-of-month)
// ---------------------------------------------------------------------------

// Kept outside the function so repeated calls can update the existing
// Chart.js chart in place instead of creating a new canvas each time.
let trendChart = null;

// Draws (or updates) the line chart at the top of the report. Takes each
// side's data as an already-built {series, label} pair, rather than a month
// object — this is deliberate: in Month mode the caller passes the month's
// own .daily array, and in Day mode it passes a trailingWindow() result, but
// renderTrendChart itself doesn't need to know or care which — it just
// plots two series against two labels, so it can never accidentally end up
// plotting the same underlying data twice under two different-looking labels.
// "2026-08-18" -> "Aug 18". Used for the Trend chart's x-axis labels.
function fmtShortDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderTrendChart(currSeries, currLabel, compSeries, compLabel) {
  const metric = document.getElementById("metric-select").value;
  const maxDays = Math.max(currSeries.length, compSeries.length, 1);

  // The x-axis shows the CURRENT period's actual calendar dates (e.g.
  // "Aug 18") rather than a generic "Day 1, Day 2, ..." position — real
  // dates are more useful than an abstract offset, especially in Day mode
  // where "Day 1 to Day 14" told you nothing about which days those
  // actually were. The two periods can still land on different real dates
  // at the same x position (Month/Quarter mode compares different actual
  // months), which is why each series ALSO carries its own real date into
  // the tooltip below — hovering always shows the true date for whichever
  // line you're looking at, even when it differs from the axis label.
  const labels = Array.from({ length: maxDays }, (_, i) => {
    const d = (currSeries[i] && currSeries[i].date) || (compSeries[i] && compSeries[i].date);
    return d ? fmtShortDate(d) : `Day ${i + 1}`;
  });

  const currValues = labels.map((_, i) => (currSeries[i] ? currSeries[i][metric] : null));
  const compValues = labels.map((_, i) => (compSeries[i] ? compSeries[i][metric] : null));
  const currDates = labels.map((_, i) => (currSeries[i] ? currSeries[i].date : null));
  const compDates = labels.map((_, i) => (compSeries[i] ? compSeries[i].date : null));

  // Read the live brand accent color so the chart's current-period line
  // always matches whichever brand is selected, without hardcoding a color.
  const accent = cssVar("--accent");
  const muted = cssVar("--muted");

  const ctx = document.getElementById("trend-chart").getContext("2d");
  const data = {
    labels,
    datasets: [
      {
        label: `${currLabel} (${metric})`,
        data: currValues,
        _dates: currDates,   // custom field, ignored by Chart.js's own rendering — read back out in the tooltip callback below
        borderColor: accent,
        backgroundColor: accent,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      },
      {
        label: `${compLabel} (${metric})`,
        data: compValues,
        _dates: compDates,
        borderColor: muted,
        backgroundColor: muted,
        borderWidth: 2,
        borderDash: [4, 3],   // dashed line distinguishes the comparison period even in black & white
        pointRadius: 0,
        tension: 0.25,
      },
    ],
  };

  if (trendChart) {
    // Chart already exists (brand switch or month/day change) — just feed
    // it new data rather than tearing down and rebuilding the canvas. The
    // tooltip callback below reads dates from context.dataset._dates at
    // hover-time, not from a closure, so it stays correct across updates
    // like this one rather than getting stuck on whatever data existed
    // when the chart was first created.
    trendChart.data = data;
    trendChart.update();
  } else {
    trendChart = new Chart(ctx, {
      type: "line",
      data,
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: { beginAtZero: metric !== "position" }, // position charts look wrong pinned to zero (lower is better)
          x: { ticks: { maxTicksLimit: 10 } },
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (context) => {
                const dateStr = context.dataset._dates && context.dataset._dates[context.dataIndex];
                const dateBit = dateStr ? ` (${fmtShortDate(dateStr)})` : "";
                return `${context.dataset.label}${dateBit}: ${context.formattedValue}`;
              },
            },
          },
        },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Executive summary + branded split
// ---------------------------------------------------------------------------

// Builds the markup for one KPI tile (e.g. "Total clicks / 1,234 / ▲ 5.2%").
function kpiCard(label, value, deltaPct) {
  return `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-delta">${fmtDelta(deltaPct)}</div>
    </div>`;
}

// Fills in the two rows of KPI tiles (Search Console totals, then GA4
// organic-search-only totals) and the "Aug 2026 vs. Jul 2026" note beneath
// the section heading.
function renderSummary(curr, comp) {
  const s = curr.summary, sp = comp.summary;
  document.getElementById("kpi-row").innerHTML = [
    kpiCard("Total clicks", fmtNum(s.clicks), pctChange(s.clicks, sp.clicks)),
    kpiCard("Total impressions", fmtNum(s.impressions), pctChange(s.impressions, sp.impressions)),
    kpiCard("Average CTR", fmtPct(s.ctr), pctChange(s.ctr, sp.ctr)),
    // Position is inverted: a DROP in the number (e.g. 5.0 -> 3.0) is an
    // IMPROVEMENT, so the raw pctChange is negated before it's handed to
    // fmtDelta — otherwise ranking better would show as a red down-arrow.
    kpiCard("Average position", s.position, sp.position ? -pctChange(s.position, sp.position) : null),
  ].join("");

  // All 6 of these come from fetch_data.py's ga4_totals(), which is
  // filtered to sessionDefaultChannelGroup == "Organic Search" — every
  // number here is organic-search traffic only, not the site's total traffic.
  const g = curr.ga4, gp = comp.ga4;
  document.getElementById("kpi-row-ga4").innerHTML = [
    kpiCard("Sessions (organic)", fmtNum(g.sessions), pctChange(g.sessions, gp.sessions)),
    kpiCard("Engaged sessions (organic)", fmtNum(g.engagedSessions), pctChange(g.engagedSessions, gp.engagedSessions)),
    // Bounce rate is also inverted like Position — a LOWER bounce rate is
    // an improvement, so the sign is flipped for a correctly colored arrow.
    kpiCard("Bounce rate (organic)", fmtPct(g.bounceRate), gp.bounceRate ? -pctChange(g.bounceRate, gp.bounceRate) : null),
    kpiCard("New users (organic)", fmtNum(g.newUsers), pctChange(g.newUsers, gp.newUsers)),
    kpiCard("Active users (organic)", fmtNum(g.activeUsers), pctChange(g.activeUsers, gp.activeUsers)),
    kpiCard("Key events (organic)", fmtNum(g.keyEvents), pctChange(g.keyEvents, gp.keyEvents)),
  ].join("");

  document.getElementById("period-note").textContent = `${curr.label} vs. ${comp.label}`;
}

// Draws the Branded vs. Non-branded split bar and its two-line legend.
// Only depends on the CURRENT period — this is a snapshot, not a comparison.
function renderSplit(curr) {
  const share = curr.branded_share_pct;
  document.getElementById("split-section").innerHTML = `
    <div class="split-bar">
      <div class="split-branded" style="width:${share}%"></div>
      <div class="split-nonbranded" style="width:${100 - share}%"></div>
    </div>
    <div class="split-legend">
      <div><span class="swatch" style="background:var(--accent)"></span>Branded — ${share}% (${fmtNum(curr.branded_summary.clicks)} clicks)</div>
      <div><span class="swatch" style="background:var(--secondary)"></span>Non-branded — ${(100 - share).toFixed(1)}% (${fmtNum(curr.non_branded_summary.clicks)} clicks)</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Visibility distribution (position buckets)
// ---------------------------------------------------------------------------

// Counts how many keywords fall into each ranking bucket (Top 3, 4-10,
// 11-20, 21+). Only counts keywords that have a position at all.
function computePositionDistribution(rows) {
  const buckets = [
    { label: "Top 3", test: p => p <= 3, count: 0, rows: [] },
    { label: "4–10", test: p => p > 3 && p <= 10, count: 0, rows: [] },
    { label: "11–20", test: p => p > 10 && p <= 20, count: 0, rows: [] },
    { label: "21+", test: p => p > 20, count: 0, rows: [] },
  ];
  let total = 0;
  rows.forEach(r => {
    if (r.position === null || r.position === undefined) return;
    total++;
    const b = buckets.find(b => b.test(r.position));
    if (b) { b.count++; b.rows.push(r); }
  });
  return { buckets, total: total || 1 };  // total||1 avoids a divide-by-zero if there's no data at all
}

// Columns for the expanded keyword list under each Visibility Distribution
// bucket — deliberately no "Δ" column (unlike keywordColumns elsewhere):
// this section only ever shows the CURRENT period, same as CTR
// Opportunities, so there's no comparison value to show.
const positionDetailColumns = [
  { key: "query", label: "Query", wrap: true, format: escapeHtml },
  { key: "type", label: "Type" },
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "CTR", align: "num", format: v => fmtPct(v) },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
];

// Draws the stacked distribution bar and legend under "Visibility distribution".
// Combines branded + non-branded keywords together — this section is about
// overall ranking health, not the branded/non-branded split (that's the
// section above it). Clicking a bucket (bar segment or legend row) expands
// a sortable/searchable table of exactly which keywords fall in that range,
// so the aggregate percentage isn't a dead end — clicking "again" on the
// same bucket collapses it back.
function renderPositionDistribution(curr) {
  const allKw = [
    ...curr.branded_keywords.map(r => ({ ...r, type: "Branded" })),
    ...curr.non_branded_keywords.map(r => ({ ...r, type: "Non-branded" })),
  ];
  const { buckets, total } = computePositionDistribution(allKw);
  const colors = ["var(--accent)", "var(--secondary)", "var(--muted)", "var(--border)"];

  const barHtml = buckets.map((b, i) => {
    const pct = (b.count / total) * 100;
    return `<div class="distribution-segment" data-bucket="${i}" style="width:${pct}%; background:${colors[i]};" title="${b.label}: ${b.count} (${pct.toFixed(1)}%) — click to see keywords"></div>`;
  }).join("");

  const legendHtml = buckets.map((b, i) => {
    const pct = (b.count / total) * 100;
    return `
      <div class="distribution-legend-item" data-bucket="${i}">
        <span class="swatch" style="background:${colors[i]}"></span>${b.label} — ${b.count} (${pct.toFixed(1)}%)
        <span class="expand-hint">▸ view keywords</span>
      </div>`;
  }).join("");

  document.getElementById("position-distribution").innerHTML = `
    <div class="distribution-bar">${barHtml}</div>
    <div class="split-legend" id="distribution-legend">${legendHtml}</div>
    <div id="position-distribution-detail" style="display:none; margin-top:16px;"></div>`;

  // Honesty note shown under the section heading: this is only "your top N
  // TRACKED keywords" (the top-200-per-bucket the data script kept), not
  // literally every keyword the site ranks for.
  document.getElementById("distribution-note").textContent = `Based on your top ${allKw.length} tracked keywords for ${curr.label} — click a range to see its keywords`;

  const detailContainer = document.getElementById("position-distribution-detail");
  let activeBucket = null;

  function showBucket(i) {
    const bucket = buckets[i];
    detailContainer.style.display = "block";
    detailContainer.innerHTML = `
      <div class="section-note" style="margin-bottom:8px;">${bucket.label} — ${bucket.count} keyword${bucket.count === 1 ? "" : "s"}</div>
      <div class="distribution-detail-table"></div>`;
    createInteractiveTable(detailContainer.querySelector(".distribution-detail-table"), positionDetailColumns, bucket.rows, {
      searchKey: "query", defaultSortKey: "clicks", defaultSortDir: "desc",
    });
  }

  document.querySelectorAll("#position-distribution [data-bucket]").forEach(el => {
    el.addEventListener("click", () => {
      const i = Number(el.dataset.bucket);
      if (activeBucket === i) {
        activeBucket = null;
        detailContainer.style.display = "none";
        detailContainer.innerHTML = "";
      } else {
        activeBucket = i;
        showBucket(i);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CTR opportunities
// ---------------------------------------------------------------------------

// Rough industry-average CTR-by-position benchmark. Approximate, for flagging
// underperformers — not a precise prediction. Positions past 10 fall back to
// broad estimates since click-through rates get small and noisy that far down.
function expectedCtr(position) {
  const curve = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.02 };
  const rounded = Math.round(position);
  if (curve[rounded] !== undefined) return curve[rounded];
  if (position <= 10) return 0.02;
  if (position <= 20) return 0.01;
  return 0.005;
}

// Finds queries getting fewer clicks than "typical" for their ranking
// position — i.e. actual CTR meaningfully below the expectedCtr() benchmark.
// Filters out very low-impression queries first (under 30) since CTR on a
// handful of impressions is mostly noise, not a real signal. Sorted by
// estimated extra clicks (the gap multiplied by impressions), so the
// biggest real-world opportunities surface first, not just the biggest
// percentage gaps on tiny queries.
function computeCtrOpportunities(rows) {
  return rows
    .filter(r => r.impressions >= 30 && r.position !== null && r.position !== undefined)
    .map(r => {
      const expected = expectedCtr(r.position);
      const gap = expected - r.ctr;
      return { ...r, expected_ctr: expected, ctr_gap: gap, est_extra_clicks: Math.round(gap * r.impressions) };
    })
    .filter(r => r.ctr_gap > 0)  // only keep genuine underperformers, not queries already beating the benchmark
    .sort((a, b) => b.est_extra_clicks - a.est_extra_clicks);
}

const ctrOppColumns = [
  { key: "query", label: "Query", wrap: true, format: escapeHtml },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "Actual CTR", align: "num", format: v => fmtPct(v) },
  { key: "expected_ctr", label: "Typical CTR", align: "num", format: v => fmtPct(v) },
  { key: "est_extra_clicks", label: "Est. extra clicks/mo", align: "num", format: fmtNum },
];

// Builds the CTR Opportunities table. Uses only the CURRENT period (this is
// "what needs attention right now", not a period-over-period comparison).
function renderCtrOpportunities(curr) {
  const allKw = [...curr.branded_keywords, ...curr.non_branded_keywords];
  const rows = computeCtrOpportunities(allKw);
  createInteractiveTable(document.getElementById("ctr-opportunities-table"), ctrOppColumns, rows, {
    searchKey: "query",
    defaultSortKey: "est_extra_clicks",
    defaultSortDir: "desc",
  });
}

// ---------------------------------------------------------------------------
// GA4 audience/behavior breakdowns (organic search only, current period)
// ---------------------------------------------------------------------------

// Kept outside the render functions so repeated calls update in place.
let deviceUsersChart = null;
let osChart = null;

// "mobile" -> "Mobile" — GA4 returns these category values lowercase; OS
// names (e.g. "iOS", "Android") come back already nicely capitalized and
// are used as-is.
function capitalize(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
}

// Draws (or updates) one donut chart from a GA4 breakdown array (each row
// shaped like {label, activeUsers, ...} — see ga4_breakdown() in
// fetch_data.py), PLUS a matching custom legend list underneath it showing
// "Label — count (pct%)" for every segment. Chart.js's own built-in legend
// is turned off deliberately — it doesn't show values/percentages, and its
// wrapping varies with how many segments a chart has, which is what made
// the 4 cards look inconsistent with each other before. Building the
// legend by hand keeps every card's formatting identical regardless of how
// many segments it has.
function drawDonutChart(existingChart, canvasId, legendId, rows, metricKey, labelFormatter) {
  const palette = [cssVar("--accent"), cssVar("--secondary"), cssVar("--positive"), cssVar("--negative"), cssVar("--muted"), cssVar("--border")];
  const total = rows.reduce((s, r) => s + (r[metricKey] || 0), 0) || 1;
  const chartData = {
    labels: rows.map(r => (labelFormatter ? labelFormatter(r.label) : r.label)),
    datasets: [{
      data: rows.map(r => r[metricKey]),
      backgroundColor: rows.map((_, i) => palette[i % palette.length]),
      borderWidth: 0,
    }],
  };

  if (existingChart) {
    existingChart.data = chartData;
    existingChart.update();
  } else {
    existingChart = new Chart(document.getElementById(canvasId).getContext("2d"), {
      type: "doughnut",
      data: chartData,
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
      },
    });
  }

  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = rows.map((r, i) => {
      const label = labelFormatter ? labelFormatter(r.label) : r.label;
      const val = r[metricKey] || 0;
      const pct = ((val / total) * 100).toFixed(1);
      return `<div class="donut-legend-item"><span class="swatch" style="background:${palette[i % palette.length]}"></span>${escapeHtml(label)} — ${fmtNum(val)} (${pct}%)</div>`;
    }).join("");
  }

  return existingChart;
}

// Device Category supports a New Users / Active Users toggle (the <select>
// next to its heading); Operating System only ever shows Active Users,
// matching what was asked for.
function renderDeviceUsersChart(curr) {
  const metric = document.getElementById("device-users-metric-select").value;
  deviceUsersChart = drawDonutChart(deviceUsersChart, "device-users-chart", "device-users-legend", curr.device_users || [], metric, capitalize);
}

function renderOsChart(curr) {
  osChart = drawDonutChart(osChart, "os-chart", "os-legend", curr.operating_systems || [], "activeUsers");
}

// Page Title/Screen and Key Events by Name reuse the same sortable/
// searchable table component as the rest of the report (see
// createInteractiveTable above) — current period only, same as the donuts.
const pageTitleColumns = [
  { key: "label", label: "Page title", wrap: true, format: escapeHtml },
  { key: "screenPageViews", label: "Views", align: "num", format: fmtNum },
  { key: "keyEvents", label: "Key events", align: "num", format: fmtNum },
];
function renderPageTitles(curr) {
  createInteractiveTable(document.getElementById("page-titles-table"), pageTitleColumns, curr.page_titles || [], {
    searchKey: "label", defaultSortKey: "screenPageViews", defaultSortDir: "desc",
  });
}

const keyEventColumns = [
  { key: "label", label: "Event name", wrap: true, format: escapeHtml },
  { key: "keyEvents", label: "Key events", align: "num", format: fmtNum },
];
function renderKeyEventsByName(curr) {
  createInteractiveTable(document.getElementById("key-events-table"), keyEventColumns, curr.key_events_by_name || [], {
    searchKey: "label", defaultSortKey: "keyEvents", defaultSortDir: "desc",
  });
}

// Hand-built funnel (Chart.js has no native funnel chart type) — Anzo only;
// hidden entirely for any brand with no funnel data (e.g. DLSM, which has
// no funnel_stages configured in fetch_data.py, so curr.funnel is just []).
// Builds the markup for ONE funnel (used for both the single-funnel case
// and each half of the side-by-side case below) — a period label, then
// each stage's bar, count, % of top-of-funnel, and drop-off from the
// previous stage.
function buildFunnelColumnHtml(rows, periodLabel) {
  if (!rows || rows.length === 0) {
    return `<div class="funnel-column"><div class="funnel-column-label">${escapeHtml(periodLabel)}</div><div class="funnel-empty">No funnel data for this period</div></div>`;
  }
  const top = rows[0].count || 1;
  const stagesHtml = rows.map((stage, i) => {
    const funnelPct = (stage.count / top) * 100;
    const barWidth = Math.max(funnelPct, 4); // keeps very small bars visibly present rather than a sliver
    const prevCount = i > 0 ? rows[i - 1].count : null;
    const dropoffPct = prevCount ? ((prevCount - stage.count) / prevCount) * 100 : null;
    const arrow = i > 0 ? `<div class="funnel-arrow">▼</div>` : "";
    const dropoffHtml = dropoffPct !== null
      ? `<span class="funnel-dropoff">Drop-off: <b>${dropoffPct.toFixed(1)}%</b></span>`
      : "";
    return `
      ${arrow}
      <div>
        <div class="funnel-stage-head">
          <span class="funnel-stage-name">${escapeHtml(stage.stage)}</span>
          <span class="funnel-stage-count">${fmtNum(stage.count)}</span>
        </div>
        <div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:${barWidth}%">${funnelPct.toFixed(1)}%</div></div>
        <div class="funnel-stage-meta">
          <span>Funnel: <b>${funnelPct.toFixed(1)}%</b> of ${escapeHtml(rows[0].stage)}</span>
          ${dropoffHtml}
        </div>
      </div>`;
  }).join("");
  return `<div class="funnel-column"><div class="funnel-column-label">${escapeHtml(periodLabel)}</div>${stagesHtml}</div>`;
}

// Shows ONE funnel when curr and comp are the same period (comparing a
// period to itself would just be two identical funnels side by side), and
// TWO side-by-side funnels — current period vs. compare period — whenever
// they differ, so you can visually compare drop-off between two different
// months/days/quarters directly. Hidden entirely (Anzo only) if neither
// side has any funnel data at all.
function renderFunnel(curr, comp) {
  const wrapper = document.getElementById("funnel-wrapper");
  const navLink = document.getElementById("nav-link-funnel");
  const currRows = curr.funnel || [];
  const compRows = comp.funnel || [];

  if (currRows.length === 0 && compRows.length === 0) {
    wrapper.style.display = "none";
    if (navLink) navLink.style.display = "none";
    return;
  }
  wrapper.style.display = "";
  if (navLink) navLink.style.display = "";

  const container = document.getElementById("funnel-container");
  const samePeriod = curr.label === comp.label;

  if (samePeriod) {
    container.className = "funnel-single";
    container.innerHTML = buildFunnelColumnHtml(currRows, curr.label);
  } else {
    container.className = "funnel-split";
    container.innerHTML = buildFunnelColumnHtml(currRows, curr.label) + buildFunnelColumnHtml(compRows, comp.label);
  }
}

// ---------------------------------------------------------------------------
// Keyword / page / country tables
// ---------------------------------------------------------------------------

const moversColumns = [
  { key: "query", label: "Query", wrap: true, format: escapeHtml },
  { key: "status", label: "", format: statusBadge },
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "clicks_change_pct", label: "Δ", align: "num", format: fmtDelta },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "CTR", align: "num", format: v => fmtPct(v) },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
];

// Builds the Top Keyword Movers table — the union of both periods' keyword
// lists (see unionMovers), so a query that disappeared entirely still shows
// up as a "Lost" row instead of silently vanishing.
function renderMovers(curr, comp) {
  const currAll = [...curr.branded_keywords, ...curr.non_branded_keywords];
  const compAll = [...comp.branded_keywords, ...comp.non_branded_keywords];
  const rows = unionMovers(currAll, compAll, "query");
  createInteractiveTable(document.getElementById("movers-table"), moversColumns, rows, {
    searchKey: "query",
    defaultSortKey: "abs_change",
    defaultSortDir: "desc",
    rowClass: swingRowClass,
  });
}

const keywordColumns = [
  { key: "query", label: "Query", wrap: true, format: escapeHtml },
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "clicks_change_pct", label: "Δ", align: "num", format: fmtDelta },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "CTR", align: "num", format: v => fmtPct(v) },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
];

// Builds the side-by-side Branded Keywords / Non-Branded Keywords tables.
// Unlike Movers, these use withDelta (current period's list, decorated with
// deltas) rather than a union — a query that fell out of the top-200 doesn't
// belong in "this period's branded keywords" table.
function renderKeywordSplitTables(curr, comp) {
  const brandedWithDelta = withDelta(curr.branded_keywords, comp.branded_keywords, "query");
  const nonBrandedWithDelta = withDelta(curr.non_branded_keywords, comp.non_branded_keywords, "query");
  createInteractiveTable(document.getElementById("branded-table"), keywordColumns, brandedWithDelta, {
    searchKey: "query", defaultSortKey: "clicks", defaultSortDir: "desc", rowClass: swingRowClass,
  });
  createInteractiveTable(document.getElementById("nonbranded-table"), keywordColumns, nonBrandedWithDelta, {
    searchKey: "query", defaultSortKey: "clicks", defaultSortDir: "desc", rowClass: swingRowClass,
  });
}

const pageColumns = [
  { key: "page", label: "Page", wrap: true, format: escapeHtml },
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "clicks_change_pct", label: "Δ", align: "num", format: fmtDelta },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "CTR", align: "num", format: v => fmtPct(v) },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
];

// Dynamic sections are matched by URL pattern; anything left over falls into "Static Pages".
// Adjust these patterns if they don't match your actual URL structure.
const PAGE_CATEGORIES = [
  { key: "blog", label: "Blog", test: p => /\/blog\b/i.test(p) },
  { key: "market-analysis", label: "Market Analysis", test: p => /market[-_]?analysis/i.test(p) },
  { key: "notifications", label: "Notifications", test: p => /notification/i.test(p) },
  { key: "help-centre", label: "Help Center", test: p => /help[-_]?cent(re|er)/i.test(p) },
];

// Runs a page URL through PAGE_CATEGORIES in order and returns the first
// match; anything matching none of them is bucketed as "Static Pages".
function categorizePage(page) {
  for (const cat of PAGE_CATEGORIES) {
    if (cat.test(page)) return cat;
  }
  return { key: "static", label: "Static Pages" };
}

// Builds the whole "Pages by category" area: groups this period's pages by
// PAGE_CATEGORIES, then for each category that actually has pages, creates a
// section with two side-by-side tables (sorted by impressions and by clicks
// respectively) — this whole block of HTML is regenerated from scratch each
// time, since the number of categories present can change between periods.
function renderPagesByCategory(curr, comp) {
  const rows = withDelta(curr.pages, comp.pages, "page");
  const groups = {};
  rows.forEach(r => {
    const cat = categorizePage(r.page);
    (groups[cat.key] = groups[cat.key] || { label: cat.label, rows: [] }).rows.push(r);
  });

  // Dynamic categories first in the defined order, "Static Pages" always last.
  const orderedKeys = ["static", ...PAGE_CATEGORIES.map(c => c.key)];
  const container = document.getElementById("pages-by-category");
  container.innerHTML = "";

  orderedKeys.forEach(key => {
    const group = groups[key];
    if (!group || group.rows.length === 0) return;  // skip categories with no pages this period

    const section = document.createElement("section");
    section.innerHTML = `
      <div class="section-head"><h2>Pages — ${group.label}</h2></div>
      <div class="two-col">
        <div>
          <div class="section-note" style="margin-bottom:8px;">By impressions</div>
          <div class="pages-cat-impr"></div>
        </div>
        <div>
          <div class="section-note" style="margin-bottom:8px;">By clicks</div>
          <div class="pages-cat-clicks"></div>
        </div>
      </div>`;
    container.appendChild(section);

    // Same underlying rows, just sorted differently by default — the user
    // can still re-sort either table by any column afterwards.
    createInteractiveTable(section.querySelector(".pages-cat-impr"), pageColumns, group.rows, {
      searchKey: "page", defaultSortKey: "impressions", defaultSortDir: "desc", rowClass: swingRowClass,
    });
    createInteractiveTable(section.querySelector(".pages-cat-clicks"), pageColumns, group.rows, {
      searchKey: "page", defaultSortKey: "clicks", defaultSortDir: "desc", rowClass: swingRowClass,
    });
  });
}

// Two Chart.js instances (kept outside the render function, same pattern as
// trendChart, so repeated calls update in place instead of rebuilding).
let countryImpressionsChart = null;
let countryClicksChart = null;

// Draws (or updates) one vertical bar chart of the top 10 countries by
// whichever metric is passed in, tallest bar on the left (standard
// leaderboard order — for a vertical bar chart, Chart.js plots array index 0
// as the leftmost bar, so a plain descending sort already reads correctly
// left-to-right with no reversal needed).
function drawCountryBarChart(existingChart, canvasId, rows, metricKey) {
  const top10 = [...rows].sort((a, b) => b[metricKey] - a[metricKey]).slice(0, 10);
  const accent = cssVar("--accent");
  const chartData = {
    labels: top10.map(r => countryName(r.country)),
    datasets: [{ data: top10.map(r => r[metricKey]), backgroundColor: accent }],
  };

  if (existingChart) {
    existingChart.data = chartData;
    existingChart.update();
    return existingChart;
  }
  return new Chart(document.getElementById(canvasId).getContext("2d"), {
    type: "bar",
    data: chartData,
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

// Renders both country bar charts from the CURRENT period only (a snapshot,
// like Position Distribution and CTR Opportunities — not a comparison).
function renderCountryCharts(curr) {
  countryImpressionsChart = drawCountryBarChart(countryImpressionsChart, "country-impressions-chart", curr.countries, "impressions");
  countryClicksChart = drawCountryBarChart(countryClicksChart, "country-clicks-chart", curr.countries, "clicks");
}

const countryColumns = [
  { key: "country_name", label: "Country" },  // sorts/searches by the full display name, not the raw code
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "clicks_change_pct", label: "Δ", align: "num", format: fmtDelta },
  { key: "impressions", label: "Impressions", align: "num", format: fmtNum },
  { key: "ctr", label: "CTR", align: "num", format: v => fmtPct(v) },
  { key: "position", label: "Position", align: "num", defaultDir: "asc" },
];

// Builds the Top Countries table. Adds a "country_name" field (via
// countryName()) onto each row before handing it to the table component, so
// sorting/searching operate on "Singapore" rather than the raw code "sgp".
function renderCountries(curr, comp) {
  const rows = withDelta(curr.countries, comp.countries, "country").map(r => ({
    ...r,
    country_name: countryName(r.country),
  }));
  createInteractiveTable(document.getElementById("countries-table"), countryColumns, rows, {
    searchKey: "country_name", defaultSortKey: "clicks", defaultSortDir: "desc", rowClass: swingRowClass,
  });
}

// Draws the Device Split bar list (Mobile/Desktop/Tablet). Not sortable or
// searchable — there are only ever a handful of devices, so a plain list of
// bars is clearer than a full interactive table. Only depends on the current
// period (no comparison shown here).
// Kept outside the render function so repeated calls update in place.
let deviceSplitChart = null;

// Now a donut, matching the other 3 charts in the Device & Audience row —
// this one is Search Console clicks by device (the others are GA4 users).
function renderDeviceSplit(curr) {
  const rows = (curr.devices || []).map(r => ({ label: r.device, clicks: r.clicks }));
  deviceSplitChart = drawDonutChart(deviceSplitChart, "device-split-chart", "device-split-legend", rows, "clicks", capitalize);
}

// ---------------------------------------------------------------------------
// Orchestration — ties everything above together and reacts to user input
// ---------------------------------------------------------------------------

// Replaces the whole report with a plain message when a brand has no data
// yet (e.g. right after setup, before the first Action run has completed).
// Also resets the header's period pickers to a neutral "no data" state so
// they don't sit there showing stale options from a previously-loaded brand.
function showEmptyState(brandLabel) {
  document.querySelector(".container").innerHTML = `
    <div class="empty-state">
      No data yet for ${brandLabel}. Once the daily GitHub Action runs (or you trigger it manually from the Actions tab), this page will populate automatically.
    </div>`;

  ["month-current", "month-compare", "day-current", "day-compare", "quarter-current", "quarter-compare"].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = `<option>No data yet</option>`;
    el.disabled = true;
  });
  document.getElementById("period-note").textContent = "";
  document.getElementById("meta-line").textContent = `No data yet for ${brandLabel}`;
}

// The main re-render entry point — called whenever ANY control changes
// (brand tab, Month/Day toggle, either dropdown, the metric picker). Figures
// out which two periods are currently selected (reading either the month
// dropdowns or the day dropdowns depending on the toggle), then calls every
// render function in turn. Every section of the report ultimately traces
// back to this one function running.
// Scroll-spy: highlights whichever side-nav link corresponds to the
// section currently at the top of the viewport. Walks the nav links in
// document order and keeps the LAST one whose section top has already
// been scrolled past — that's always the section you're currently
// "inside". Skips sections that don't exist or are hidden (offsetParent
// is null for display:none elements — e.g. the funnel section on DLSM),
// so a hidden section's stale position can never wrongly match. Runs on
// every scroll (so it stays live during both manual scrolling AND the
// smooth-scroll animation a nav click triggers — no separate click
// handler needed, this one mechanism covers both), and once after every
// renderAll() too, since switching brand or period can shift section
// positions (e.g. DLSM's page is shorter without the funnel section).
function updateActiveNavLink() {
  const navLinks = document.querySelectorAll(".side-nav a");
  if (navLinks.length === 0) return;
  // This offset MUST match the section[id] { scroll-margin-top: 130px; }
  // value in style.css exactly — a mismatch here (this used to be 120)
  // means a section can finish scrolling into its "landed" position while
  // still not quite counting as scrolled-past by this check, leaving the
  // PREVIOUS nav link highlighted instead of the one just clicked.
  const scrollPos = window.scrollY + 130;
  let current = null;
  navLinks.forEach(a => {
    const id = a.getAttribute("href").slice(1);
    const el = document.getElementById(id);
    if (!el || el.offsetParent === null) return;
    if (el.offsetTop <= scrollPos) current = a;
  });
  navLinks.forEach(a => a.classList.remove("active"));
  if (current) current.classList.add("active");
}

window.addEventListener("scroll", updateActiveNavLink, { passive: true });

function renderAll() {
  const mode = document.getElementById("compare-mode").value;
  let curr, comp, currTrendSeries, currTrendLabel, compTrendSeries, compTrendLabel;

  if (mode === "day") {
    const d1 = document.getElementById("day-current").value;
    const d2 = document.getElementById("day-compare").value;
    curr = buildDaySnapshot(d1);
    comp = buildDaySnapshot(d2);
    // Each side gets its OWN trailing window (TREND_DAY_WINDOW days) ending on that exact
    // selected day — never the enclosing month's full array. That's what
    // guarantees Jul 31 vs Jul 3 (same month) still show genuinely
    // different data instead of the bug where both sides silently plotted
    // the same month and the legend showed two identical labels.
    if (d1 && d2) {
      const idx = buildDailyIndex();
      currTrendSeries = trailingWindow(d1, TREND_DAY_WINDOW, idx);
      compTrendSeries = trailingWindow(d2, TREND_DAY_WINDOW, idx);
      currTrendLabel = fmtDateLabel(d1);
      compTrendLabel = fmtDateLabel(d2);
    }
  } else if (mode === "quarter") {
    const [y1, q1] = document.getElementById("quarter-current").value.split("-Q").map(Number);
    const [y2, q2] = document.getElementById("quarter-compare").value.split("-Q").map(Number);
    curr = buildQuarterSnapshot(y1, q1);
    comp = buildQuarterSnapshot(y2, q2);
    if (curr && comp) {
      // Same idea as Month mode — feed the Trend chart the full merged
      // .daily series for each quarter, just longer than a single month's.
      currTrendSeries = curr.daily;
      compTrendSeries = comp.daily;
      currTrendLabel = curr.label;
      compTrendLabel = comp.label;
    }
  } else {
    const currIdx = Number(document.getElementById("month-current").value);
    const compIdx = Number(document.getElementById("month-compare").value);
    curr = months[currIdx];
    comp = months[compIdx];
    if (curr && comp) {
      currTrendSeries = curr.daily || [];
      compTrendSeries = comp.daily || [];
      currTrendLabel = curr.label;
      compTrendLabel = comp.label;
    }
  }
  // Bail out quietly if anything couldn't be resolved (e.g. Day mode
  // selected before any daily_detail exists yet, or no quarter selectable
  // yet) rather than rendering with half-missing data.
  if (!curr || !comp || !currTrendSeries || !compTrendSeries) return;

  renderTrendChart(currTrendSeries, currTrendLabel, compTrendSeries, compTrendLabel);
  renderSummary(curr, comp);
  renderDeviceUsersChart(curr);
  renderOsChart(curr);
  renderPageTitles(curr);
  renderKeyEventsByName(curr);
  renderFunnel(curr, comp);
  renderSplit(curr);
  renderPositionDistribution(curr);
  renderCtrOpportunities(curr);
  renderMovers(curr, comp);
  renderKeywordSplitTables(curr, comp);
  renderPagesByCategory(curr, comp);
  renderCountryCharts(curr);
  renderCountries(curr, comp);
  renderDeviceSplit(curr);
  updateActiveNavLink();
}

// Fills the two Month dropdowns from the currently loaded brand's month
// list, defaulting to "most recent month" vs. "the one before it".
function populateMonthPickers() {
  const currentSel = document.getElementById("month-current");
  const compareSel = document.getElementById("month-compare");
  currentSel.disabled = false;
  compareSel.disabled = false;
  const options = months.map((m, i) => `<option value="${i}">${m.label}</option>`).join("");
  currentSel.innerHTML = options;
  compareSel.innerHTML = options;
  currentSel.value = 0;
  compareSel.value = months.length > 1 ? 1 : 0;
}

// Fills the two Day dropdowns from whichever dates actually have daily_detail
// archived (see listAvailableDays), defaulting to the two most recent days.
// Shows a placeholder if no daily detail exists at all yet.
function populateDayPickers() {
  const days = listAvailableDays();
  const currentSel = document.getElementById("day-current");
  const compareSel = document.getElementById("day-compare");
  currentSel.disabled = false;
  compareSel.disabled = false;
  if (days.length === 0) {
    currentSel.innerHTML = `<option value="">No daily detail yet</option>`;
    compareSel.innerHTML = currentSel.innerHTML;
    return;
  }
  const options = days.map(d => `<option value="${d}">${fmtDateLabel(d)}</option>`).join("");
  currentSel.innerHTML = options;
  compareSel.innerHTML = options;
  currentSel.value = days[0];
  compareSel.value = days.length > 1 ? days[1] : days[0];
}

// Fills the two Quarter dropdowns from every quarter any loaded month
// falls into, defaulting to "most recent quarter" vs. "the one before it"
// (e.g. Q3 2026 vs. Q2 2026).
function populateQuarterPickers() {
  const quarters = listAvailableQuarters();
  const currentSel = document.getElementById("quarter-current");
  const compareSel = document.getElementById("quarter-compare");
  currentSel.disabled = false;
  compareSel.disabled = false;
  if (quarters.length === 0) {
    currentSel.innerHTML = `<option value="">No data yet</option>`;
    compareSel.innerHTML = currentSel.innerHTML;
    return;
  }
  const options = quarters.map(q => `<option value="${q.key}">${q.label}</option>`).join("");
  currentSel.innerHTML = options;
  compareSel.innerHTML = options;
  currentSel.value = quarters[0].key;
  compareSel.value = quarters.length > 1 ? quarters[1].key : quarters[0].key;
}

// Per-brand hero banner config — purely a static branding asset, not
// fetched data, so it lives here rather than in data/<brand>.json. Video
// needs 3 attributes to reliably autoplay across browsers (muted,
// playsinline, and autoplay itself — Safari in particular won't autoplay
// video with sound, or without playsinline on mobile). Switching a brand
// from image to video later (e.g. once DLSM has one) is just editing this
// one object — no HTML/CSS changes needed, renderHero() below already
// handles both types.
// Both brands work identically: video is tried first, falling back to the
// image if the video file doesn't exist, falling back to hiding the whole
// section if NEITHER exists. Set video (or image) to null/omit it entirely
// for a brand that doesn't have one yet — the fallback chain below handles
// every combination (video-only, image-only, both, or neither) the same way.
const HERO_MEDIA = {
  anzo: { video: "media/anzo-hero.mp4", image: "media/anzo-hero.jpg" },
  dlsm: { video: "media/dlsm-hero.mp4", image: "media/dlsm-hero.jpg" },
};

// Tries video, falls back to image on error, falls back to hiding the
// section entirely if the image ALSO errors (or was never configured) —
// so every combination in HERO_MEDIA "just works" without needing to know
// in advance which files actually exist.
function renderHero(brand) {
  const container = document.getElementById("hero-media");
  const section = container.closest("section");
  const media = HERO_MEDIA[brand];

  // Browsers cache video/image files aggressively by URL — without this,
  // replacing anzo-hero.mp4 with a new video (same filename) could leave
  // visitors seeing the OLD cached one for a long time. This query param
  // changes once per calendar day, so a replaced file is guaranteed to
  // show up within a day, while repeat page loads on the SAME day still
  // benefit from normal caching instead of re-downloading a multi-MB
  // video every single time.
  const cacheBust = new Date().toISOString().slice(0, 10);

  function showImageOrHide() {
    if (media && media.image) {
      container.innerHTML = `<img src="${media.image}?v=${cacheBust}" alt="${brand.toUpperCase()} banner">`;
      container.querySelector("img").addEventListener("error", () => { section.style.display = "none"; });
    } else {
      section.style.display = "none";
    }
  }

  if (!media || (!media.video && !media.image)) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  if (media.video) {
    container.innerHTML = `
      <video autoplay muted loop playsinline>
        <source src="${media.video}?v=${cacheBust}" type="video/mp4">
      </video>`;
    container.querySelector("video").addEventListener("error", showImageOrHide);
  } else {
    showImageOrHide();
  }
}

// Runs whenever the selected brand changes (including on first page load):
// fetches that brand's JSON, sets the header's accent color and title to
// match, rebuilds all three sets of dropdowns, and triggers the first render.
async function renderBrand(brand) {
  renderHero(brand); // updates immediately, independent of whether the report data below loads successfully

  const data = await loadBrand(brand);
  if (!data || !data.months || data.months.length === 0) {
    showEmptyState(brand.toUpperCase());
    return;
  }

  months = data.months;
  document.documentElement.style.setProperty("--accent", data.color);
  document.getElementById("brand-title").textContent = `${data.brand.toUpperCase()} — SEO Dashboard`;
  document.getElementById("meta-line").textContent = `Data last refreshed ${data.generated_at}`;

  populateMonthPickers();
  populateDayPickers();
  populateQuarterPickers();
  renderAll();
}

// Clicking Anzo/DLSM in the header switches the active tab's styling and
// reloads the whole report for that brand.
// Clicking a brand tab acts like a "home" link, same as landing on this
// page fresh: resets Compare-by back to Month mode (in case you'd
// switched to Day or Quarter), and scrolls to the top — not just a brand
// swap, a full reset back to the default view.
document.getElementById("brand-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-brand]");
  if (!btn) return;
  document.querySelectorAll("#brand-tabs button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentBrand = btn.dataset.brand;

  document.getElementById("compare-mode").value = "month";
  document.getElementById("month-controls").style.display = "flex";
  document.getElementById("day-controls").style.display = "none";
  document.getElementById("quarter-controls").style.display = "none";

  window.scrollTo({ top: 0, behavior: "smooth" });
  renderBrand(currentBrand);
});

// Switching the Compare-by dropdown between "Month" and "Day" swaps which
// pair of dropdowns is visible, then re-renders using whichever is now shown.
document.getElementById("compare-mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  document.getElementById("month-controls").style.display = mode === "month" ? "flex" : "none";
  document.getElementById("day-controls").style.display = mode === "day" ? "flex" : "none";
  document.getElementById("quarter-controls").style.display = mode === "quarter" ? "flex" : "none";
  renderAll();
});

// Any change to either period picker, in either mode, or to the Trend
// chart's metric dropdown, just re-runs the whole render — simpler and
// plenty fast enough than trying to update only the affected section.
document.getElementById("month-current").addEventListener("change", renderAll);
document.getElementById("month-compare").addEventListener("change", renderAll);
document.getElementById("day-current").addEventListener("change", renderAll);
document.getElementById("day-compare").addEventListener("change", renderAll);
document.getElementById("quarter-current").addEventListener("change", renderAll);
document.getElementById("quarter-compare").addEventListener("change", renderAll);
document.getElementById("metric-select").addEventListener("change", renderAll);
document.getElementById("device-users-metric-select").addEventListener("change", renderAll);

// Kicks everything off on page load.
renderBrand(currentBrand);

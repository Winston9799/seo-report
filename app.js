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

const REPORT_PASSWORD = "changeme"; // <-- change this to your own passphrase before sharing the link

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

const TREND_DAY_WINDOW = 14; // how many trailing days the Trend chart shows in Day mode

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
    { clicks: 0, impressions: 0, ctr: 0, position: null, sessions: 0, activeUsers: 0, conversions: 0 };

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
    ga4: { sessions: dayTotals.sessions, activeUsers: dayTotals.activeUsers, conversions: dayTotals.conversions },
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
function renderTrendChart(currSeries, currLabel, compSeries, compLabel) {
  const metric = document.getElementById("metric-select").value;
  // The two series can have different lengths (Month mode: 28-31 days;
  // Day mode: always TREND_DAY_WINDOW), so the x-axis is "Day 1, Day 2, ..."
  // rather than actual calendar dates — that's what lets two differently-
  // dated windows line up at the same x position for comparison.
  const maxDays = Math.max(currSeries.length, compSeries.length, 1);
  const labels = Array.from({ length: maxDays }, (_, i) => `Day ${i + 1}`);

  const currValues = labels.map((_, i) => (currSeries[i] ? currSeries[i][metric] : null));
  const compValues = labels.map((_, i) => (compSeries[i] ? compSeries[i][metric] : null));

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
        borderColor: accent,
        backgroundColor: accent,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      },
      {
        label: `${compLabel} (${metric})`,
        data: compValues,
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
    // it new data rather than tearing down and rebuilding the canvas.
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
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
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
// totals) and the "Aug 2026 vs. Jul 2026" note beneath the section heading.
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

  const g = curr.ga4, gp = comp.ga4;
  document.getElementById("kpi-row-ga4").innerHTML = [
    kpiCard("Sessions (GA4)", fmtNum(g.sessions), pctChange(g.sessions, gp.sessions)),
    kpiCard("Active users (GA4)", fmtNum(g.activeUsers), pctChange(g.activeUsers, gp.activeUsers)),
    kpiCard("Conversions (GA4)", fmtNum(g.conversions), pctChange(g.conversions, gp.conversions)),
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
    { label: "Top 3", test: p => p <= 3, count: 0 },
    { label: "4–10", test: p => p > 3 && p <= 10, count: 0 },
    { label: "11–20", test: p => p > 10 && p <= 20, count: 0 },
    { label: "21+", test: p => p > 20, count: 0 },
  ];
  let total = 0;
  rows.forEach(r => {
    if (r.position === null || r.position === undefined) return;
    total++;
    const b = buckets.find(b => b.test(r.position));
    if (b) b.count++;
  });
  return { buckets, total: total || 1 };  // total||1 avoids a divide-by-zero if there's no data at all
}

// Draws the stacked distribution bar and legend under "Visibility distribution".
// Combines branded + non-branded keywords together — this section is about
// overall ranking health, not the branded/non-branded split (that's the
// section above it).
function renderPositionDistribution(curr) {
  const allKw = [...curr.branded_keywords, ...curr.non_branded_keywords];
  const { buckets, total } = computePositionDistribution(allKw);
  const colors = ["var(--accent)", "var(--secondary)", "var(--muted)", "var(--border)"];

  const barHtml = buckets.map((b, i) => {
    const pct = (b.count / total) * 100;
    return `<div style="width:${pct}%; background:${colors[i]};" title="${b.label}: ${b.count} (${pct.toFixed(1)}%)"></div>`;
  }).join("");

  const legendHtml = buckets.map((b, i) => {
    const pct = (b.count / total) * 100;
    return `<div><span class="swatch" style="background:${colors[i]}"></span>${b.label} — ${b.count} (${pct.toFixed(1)}%)</div>`;
  }).join("");

  document.getElementById("position-distribution").innerHTML = `
    <div class="distribution-bar">${barHtml}</div>
    <div class="split-legend">${legendHtml}</div>`;

  // Honesty note shown under the section heading: this is only "your top N
  // TRACKED keywords" (the top-200-per-bucket the data script kept), not
  // literally every keyword the site ranks for.
  document.getElementById("distribution-note").textContent = `Based on your top ${allKw.length} tracked keywords for ${curr.label}`;
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
  const orderedKeys = [...PAGE_CATEGORIES.map(c => c.key), "static"];
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

const countryColumns = [
  { key: "country_name", label: "Country" },  // sorts/searches by the full display name, not the raw code
  { key: "clicks", label: "Clicks", align: "num", format: fmtNum },
  { key: "clicks_change_pct", label: "Δ", align: "num", format: fmtDelta },
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
function renderDeviceSplit(curr) {
  const rows = curr.devices;
  const max = Math.max(...rows.map(r => r.clicks), 1);
  const html = rows.map(r => `
    <div class="device-row">
      <div>${r.device.charAt(0) + r.device.slice(1).toLowerCase()}</div>
      <div class="device-bar-track"><div class="device-bar-fill" style="width:${(r.clicks / max) * 100}%"></div></div>
      <div class="num">${fmtNum(r.clicks)}</div>
    </div>`).join("");
  document.getElementById("device-split").innerHTML = `<div class="device-list">${html}</div>`;
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

  ["month-current", "month-compare", "day-current", "day-compare"].forEach(id => {
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
function renderAll() {
  const mode = document.getElementById("compare-mode").value;
  let curr, comp, currTrendSeries, currTrendLabel, compTrendSeries, compTrendLabel;

  if (mode === "day") {
    const d1 = document.getElementById("day-current").value;
    const d2 = document.getElementById("day-compare").value;
    curr = buildDaySnapshot(d1);
    comp = buildDaySnapshot(d2);
    // Each side gets its OWN 14-day trailing window ending on that exact
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
  // selected before any daily_detail exists yet) rather than rendering with
  // half-missing data.
  if (!curr || !comp || !currTrendSeries || !compTrendSeries) return;

  renderTrendChart(currTrendSeries, currTrendLabel, compTrendSeries, compTrendLabel);
  renderSummary(curr, comp);
  renderSplit(curr);
  renderPositionDistribution(curr);
  renderCtrOpportunities(curr);
  renderMovers(curr, comp);
  renderKeywordSplitTables(curr, comp);
  renderPagesByCategory(curr, comp);
  renderCountries(curr, comp);
  renderDeviceSplit(curr);
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

// Runs whenever the selected brand changes (including on first page load):
// fetches that brand's JSON, sets the header's accent color and title to
// match, rebuilds both sets of dropdowns, and triggers the first render.
async function renderBrand(brand) {
  const data = await loadBrand(brand);
  if (!data || !data.months || data.months.length === 0) {
    showEmptyState(brand.toUpperCase());
    return;
  }

  months = data.months;
  document.documentElement.style.setProperty("--accent", data.color);
  document.getElementById("brand-title").textContent = `${data.brand.toUpperCase()} — SEO Report`;
  document.getElementById("meta-line").textContent = `Data last refreshed ${data.generated_at}`;

  populateMonthPickers();
  populateDayPickers();
  renderAll();
}

// Clicking Anzo/DLSM in the header switches the active tab's styling and
// reloads the whole report for that brand.
document.getElementById("brand-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-brand]");
  if (!btn) return;
  document.querySelectorAll("#brand-tabs button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentBrand = btn.dataset.brand;
  renderBrand(currentBrand);
});

// Switching the Compare-by dropdown between "Month" and "Day" swaps which
// pair of dropdowns is visible, then re-renders using whichever is now shown.
document.getElementById("compare-mode").addEventListener("change", (e) => {
  const isDay = e.target.value === "day";
  document.getElementById("month-controls").style.display = isDay ? "none" : "flex";
  document.getElementById("day-controls").style.display = isDay ? "flex" : "none";
  renderAll();
});

// Any change to either period picker, in either mode, or to the Trend
// chart's metric dropdown, just re-runs the whole render — simpler and
// plenty fast enough than trying to update only the affected section.
document.getElementById("month-current").addEventListener("change", renderAll);
document.getElementById("month-compare").addEventListener("change", renderAll);
document.getElementById("day-current").addEventListener("change", renderAll);
document.getElementById("day-compare").addEventListener("change", renderAll);
document.getElementById("metric-select").addEventListener("change", renderAll);

// Kicks everything off on page load.
renderBrand(currentBrand);

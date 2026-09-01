const dataCache = {};
let currentBrand = "anzo";
let months = [];          // the loaded brand's months array, newest first

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

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
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

function fmtPct(n, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function pctChange(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

function fmtDelta(pct) {
  if (pct === null || pct === undefined) return `<span class="delta-flat">—</span>`;
  const cls = pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "delta-flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Comparison helpers — this is where "any month vs any month" happens
// ---------------------------------------------------------------------------

function indexBy(rows, key) {
  const map = {};
  rows.forEach(r => { map[r[key]] = r; });
  return map;
}

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

function unionMovers(currRows, compRows, key, limit = 20) {
  const currMap = indexBy(currRows, key);
  const compMap = indexBy(compRows, key);
  const keys = new Set([...Object.keys(currMap), ...Object.keys(compMap)]);
  const merged = [];
  keys.forEach(k => {
    const c = currMap[k] || { clicks: 0, impressions: 0, ctr: 0, position: null };
    const p = compMap[k] || { clicks: 0 };
    merged.push({
      [key]: k,
      clicks: c.clicks,
      impressions: c.impressions,
      ctr: c.ctr,
      position: c.position,
      clicks_previous: p.clicks,
      clicks_change: c.clicks - p.clicks,
      clicks_change_pct: pctChange(c.clicks, p.clicks),
    });
  });
  return merged.sort((a, b) => Math.abs(b.clicks_change) - Math.abs(a.clicks_change)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function kpiCard(label, value, deltaPct) {
  return `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-delta">${fmtDelta(deltaPct)}</div>
    </div>`;
}

function renderSummary(curr, comp) {
  const s = curr.summary, sp = comp.summary;
  document.getElementById("kpi-row").innerHTML = [
    kpiCard("Total clicks", fmtNum(s.clicks), pctChange(s.clicks, sp.clicks)),
    kpiCard("Total impressions", fmtNum(s.impressions), pctChange(s.impressions, sp.impressions)),
    kpiCard("Average CTR", fmtPct(s.ctr), pctChange(s.ctr, sp.ctr)),
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

function renderSplit(curr) {
  const share = curr.branded_share_pct;
  const html = `
    <div class="split-bar">
      <div class="split-branded" style="width:${share}%"></div>
      <div class="split-nonbranded" style="width:${100 - share}%"></div>
    </div>
    <div class="split-legend">
      <div><span class="swatch" style="background:var(--accent)"></span>Branded — ${share}% (${fmtNum(curr.branded_summary.clicks)} clicks)</div>
      <div><span class="swatch" style="background:var(--secondary)"></span>Non-branded — ${(100 - share).toFixed(1)}% (${fmtNum(curr.non_branded_summary.clicks)} clicks)</div>
    </div>`;
  document.getElementById("split-section").innerHTML = html;
}

function keywordTable(rows) {
  const body = rows.map(r => `
    <tr>
      <td class="query-cell">${escapeHtml(r.query)}</td>
      <td class="num">${fmtNum(r.clicks)}</td>
      <td class="num">${fmtDelta(r.clicks_change_pct)}</td>
      <td class="num">${fmtNum(r.impressions)}</td>
      <td class="num">${fmtPct(r.ctr)}</td>
      <td class="num">${r.position ?? "—"}</td>
    </tr>`).join("");
  return `
    <table>
      <thead><tr><th>Query</th><th class="num">Clicks</th><th class="num">Δ</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Position</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderMovers(curr, comp) {
  const currAll = [...curr.branded_keywords, ...curr.non_branded_keywords];
  const compAll = [...comp.branded_keywords, ...comp.non_branded_keywords];
  document.getElementById("movers-table").innerHTML = keywordTable(unionMovers(currAll, compAll, "query"));
}

function renderKeywordSplitTables(curr, comp) {
  const brandedWithDelta = withDelta(curr.branded_keywords, comp.branded_keywords, "query").slice(0, 20);
  const nonBrandedWithDelta = withDelta(curr.non_branded_keywords, comp.non_branded_keywords, "query").slice(0, 20);
  document.getElementById("branded-table").innerHTML = keywordTable(brandedWithDelta);
  document.getElementById("nonbranded-table").innerHTML = keywordTable(nonBrandedWithDelta);
}

function renderPages(curr, comp) {
  const rows = withDelta(curr.pages, comp.pages, "page").slice(0, 20);
  const body = rows.map(r => `
    <tr>
      <td class="page-cell">${escapeHtml(r.page)}</td>
      <td class="num">${fmtNum(r.clicks)}</td>
      <td class="num">${fmtDelta(r.clicks_change_pct)}</td>
      <td class="num">${fmtNum(r.impressions)}</td>
      <td class="num">${fmtPct(r.ctr)}</td>
      <td class="num">${r.position ?? "—"}</td>
    </tr>`).join("");
  document.getElementById("pages-table").innerHTML = `
    <table>
      <thead><tr><th>Page</th><th class="num">Clicks</th><th class="num">Δ</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Position</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderCountries(curr, comp) {
  const rows = withDelta(curr.countries, comp.countries, "country").slice(0, 15);
  const body = rows.map(r => `
    <tr>
      <td>${r.country.toUpperCase()}</td>
      <td class="num">${fmtNum(r.clicks)}</td>
      <td class="num">${fmtDelta(r.clicks_change_pct)}</td>
      <td class="num">${fmtPct(r.ctr)}</td>
      <td class="num">${r.position ?? "—"}</td>
    </tr>`).join("");
  document.getElementById("countries-table").innerHTML = `
    <table>
      <thead><tr><th>Country</th><th class="num">Clicks</th><th class="num">Δ</th><th class="num">CTR</th><th class="num">Position</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

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

function showEmptyState(brandLabel) {
  document.querySelector(".container").innerHTML = `
    <div class="empty-state">
      No data yet for ${brandLabel}. Once the daily GitHub Action runs (or you trigger it manually from the Actions tab), this page will populate automatically.
    </div>`;
}

function renderAll() {
  const currIdx = Number(document.getElementById("month-current").value);
  const compIdx = Number(document.getElementById("month-compare").value);
  const curr = months[currIdx];
  const comp = months[compIdx];
  if (!curr || !comp) return;

  renderSummary(curr, comp);
  renderSplit(curr);
  renderMovers(curr, comp);
  renderKeywordSplitTables(curr, comp);
  renderPages(curr, comp);
  renderCountries(curr, comp);
  renderDeviceSplit(curr);
}

function populateMonthPickers() {
  const currentSel = document.getElementById("month-current");
  const compareSel = document.getElementById("month-compare");
  const options = months.map((m, i) => `<option value="${i}">${m.label}</option>`).join("");
  currentSel.innerHTML = options;
  compareSel.innerHTML = options;
  currentSel.value = 0;
  compareSel.value = months.length > 1 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Brand switching
// ---------------------------------------------------------------------------

async function renderBrand(brand) {
  const data = await loadBrand(brand);
  if (!data || !data.months || data.months.length === 0) {
    showEmptyState(brand.toUpperCase());
    return;
  }

  months = data.months;
  document.documentElement.style.setProperty("--accent", data.color);
  document.getElementById("brand-title").textContent = `${data.brand} — SEO Report`;
  document.getElementById("meta-line").textContent = `Data last refreshed ${data.generated_at}`;

  populateMonthPickers();
  renderAll();
}

document.getElementById("brand-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-brand]");
  if (!btn) return;
  document.querySelectorAll("#brand-tabs button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentBrand = btn.dataset.brand;
  renderBrand(currentBrand);
});

document.getElementById("month-current").addEventListener("change", renderAll);
document.getElementById("month-compare").addEventListener("change", renderAll);

renderBrand(currentBrand);

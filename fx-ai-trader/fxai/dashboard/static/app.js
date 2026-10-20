"use strict";
// fxai dashboard client. All server data is rendered with textContent (never
// innerHTML), so log/calendar text cannot inject markup.

const CSRF = document.querySelector('meta[name="csrf-token"]').content;
const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const n = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? "-" : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (v, d = 2) => (v == null ? "-" : (v > 0 ? "+" : "") + fmt(v, d));
const ago = (s) => (s == null ? "-" : s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
const tone = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");  // zero stays neutral
const shortTime = (iso) => (iso ? iso.replace("T", " ").slice(0, 19) : "-");

// status badge: color is never alone - icon glyph + label
const ICON = { good: "✓", warning: "!", serious: "!", critical: "✕", neutral: "•" };
function badge(state, label) {
  return el("span", { class: `badge st-${state}` }, el("span", { class: "dot", "aria-hidden": "true" }),
    el("span", { "aria-hidden": "true", text: ICON[state] }), label);
}

function table(cols, rows) {
  if (!rows.length) return el("p", { class: "empty", text: "Nothing to show" });
  const head = el("tr", null, cols.map((c) => el("th", { class: c.num ? "num" : "", text: c.label })));
  const body = rows.map((r) => el("tr", null, cols.map((c) => {
    const v = c.get(r);
    const td = el("td", { class: (c.num ? "num " : "") + (c.cls ? c.cls(r) : "") });
    if (v instanceof Node) td.append(v); else td.textContent = v == null ? "-" : String(v);
    return td;
  })));
  return el("table", null, el("thead", null, head), el("tbody", null, body));
}

function kv(pairs) {
  return el("dl", { class: "kv" }, pairs.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", null, v instanceof Node ? v : String(v ?? "-"))]));
}

function replace(id, node) { const host = $(id); host.replaceChildren(node); }

// ------------------------------------------------------------------ tiles
function meterTile(label, value, sub, frac, warnAt = 0.5, critAt = 0.8) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const cls = f >= critAt ? "meter crit" : f >= warnAt ? "meter warn" : "meter";
  const fill = el("span");
  fill.style.width = `${(f * 100).toFixed(1)}%`;  // CSSOM, allowed under the strict CSP (style attributes are not)
  return el("div", { class: "tile" }, el("div", { class: "label", text: label }), el("div", { class: "value", text: value }),
    el("div", { class: "sub", text: sub }),
    el("div", { class: cls, role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(f * 100)), "aria-label": label },
      fill));
}
function tile(label, value, sub, cls) {
  return el("div", { class: "tile" }, el("div", { class: "label", text: label }),
    el("div", { class: "value " + (cls || ""), text: value }), el("div", { class: "sub", text: sub || "" }));
}

// ------------------------------------------------------------------ equity chart
function niceTicks(min, max, n = 4) {
  const pad = Math.max(1, Math.abs(max) * 0.002);  // flat or near-flat series: keep a readable band
  if (max - min < pad) { min -= pad; max += pad; }
  const span = max - min;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(v);
  return out;
}

function drawEquity(points) {
  const host = $("equity-chart");
  host.replaceChildren();
  if (!points.length) { host.append(el("p", { class: "empty", text: "No equity history yet (recorded once per minute while the EA is connected)" })); return; }
  const W = 1000, H = 260, L = 64, R = 12, T = 12, B = 26;
  const xs = points.map((p) => Date.parse(p.ts)), ys = points.map((p) => p.equity);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": "Account equity over time" });
  for (const t of ticks) {
    svg.append(s("line", { class: t === y0 ? "baseline" : "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
    const lab = s("text", { class: "tick", x: L - 8, y: Y(t) + 4, "text-anchor": "end" }); lab.textContent = fmt(t, 0); svg.append(lab);
  }
  for (const [t, anchor] of [[x0, "start"], [x1, "end"]]) {
    const lab = s("text", { class: "tick", x: X(t), y: H - 6, "text-anchor": anchor }); lab.textContent = shortTime(new Date(t).toISOString()).slice(0, 16); svg.append(lab);
  }
  svg.append(s("path", { class: "line", d: points.map((p, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("") }));
  const cross = s("line", { class: "cross", y1: T, y2: H - B, x1: -10, x2: -10 });
  const dot = s("circle", { class: "marker", r: 4, cx: -10, cy: -10 });
  svg.append(cross, dot);
  const tip = $("tooltip");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
    let i = 0, best = Infinity;
    xs.forEach((x, k) => { const d = Math.abs(x - t); if (d < best) { best = d; i = k; } });
    cross.setAttribute("x1", X(xs[i])); cross.setAttribute("x2", X(xs[i]));
    dot.setAttribute("cx", X(xs[i])); dot.setAttribute("cy", Y(ys[i]));
    tip.replaceChildren(el("div", { text: shortTime(points[i].ts) + " UTC" }), el("strong", { text: "Equity " + fmt(ys[i]) }),
      el("div", { text: `Balance ${fmt(points[i].balance)} · daily loss ${fmt(points[i].daily_loss_pct, 2)}%` }));
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 220)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); dot.setAttribute("cy", -10); });
  host.append(svg);
  const last = points[points.length - 1], first = points[0];
  $("equity-note").textContent = `${points.length} points · change ${signed(last.equity - first.equity)} since ${shortTime(first.ts)}`;
  replace("equity-table", table([
    { label: "Time (UTC)", get: (r) => shortTime(r.ts) }, { label: "Equity", num: true, get: (r) => fmt(r.equity) },
    { label: "Balance", num: true, get: (r) => fmt(r.balance) }, { label: "Floating", num: true, get: (r) => signed(r.floating) },
    { label: "Daily loss %", num: true, get: (r) => fmt(r.daily_loss_pct, 3) }, { label: "Open risk", num: true, get: (r) => fmt(r.open_risk) },
  ], points.slice(-60).reverse()));
}

// ------------------------------------------------------------------ render
function render(d) {
  const st = d.status || {};
  const svc = st.service || {}, br = st.bridge || {}, acct = st.account, pnl = st.pnl || {}, ex = st.exposure || {};
  const lim = st.limits || {}, ent = st.entries || {}, ea = st.ea || {};

  const badges = [];
  badges.push(badge(svc.mode === "live" ? "critical" : "good", (svc.mode || "?").toUpperCase() + (svc.live_enabled ? " (live enabled)" : "")));
  badges.push(d.service_running ? badge("good", "Service running") : badge("critical", `Service not running (status ${ago(d.status_age_s)} old)`));
  badges.push(br.healthy ? badge("good", "EA connected") : badge("critical", "EA/bridge: " + (br.detail || "no data")));
  if (acct) badges.push(badge(acct.is_demo ? "good" : "serious", acct.is_demo ? "Demo account" : "REAL account"));
  if (ea.trading_enabled === false) badges.push(badge("warning", "EA entries disabled"));
  $("badges").replaceChildren(...badges);

  const reasons = st.block_reasons || [];
  const banner = $("banner");
  banner.hidden = !reasons.length && d.service_running;
  if (!banner.hidden) {
    const items = reasons.slice();
    if (!d.service_running) items.unshift("Python service is not writing status - protective logic continues inside the EA");
    banner.replaceChildren(el("strong", null, "✕ New entries are blocked"), el("ul", null, items.map((r) => el("li", { text: r }))));
  }

  const tiles = [];
  if (acct) {
    tiles.push(tile("Equity", fmt(acct.equity), `${acct.currency} · balance ${fmt(acct.balance)}`));
    tiles.push(tile("Floating P&L", signed(pnl.floating), "open positions", tone(pnl.floating)));
    tiles.push(tile("Realized today", signed(pnl.realized_today), "closed trades (UTC date)", tone(pnl.realized_today)));
    tiles.push(tile("Daily P&L", signed(pnl.daily_pnl), `vs day start ${fmt(pnl.day_start_equity)}, net flows ${fmt(pnl.net_flows)}`, tone(pnl.daily_pnl)));
    tiles.push(meterTile("Daily loss vs limit", `${fmt(pnl.daily_loss_pct, 2)}%`, `limit ${fmt(pnl.daily_loss_limit_pct, 2)}%`, pnl.daily_loss_pct / pnl.daily_loss_limit_pct));
    tiles.push(meterTile("Entries today", `${ent.today ?? 0} / ${ent.cap ?? "-"}`, `failed ${ent.failed ?? 0} · mods ${ent.modifications ?? 0} · partial ${ent.partial_closes ?? 0}`, (ent.today || 0) / (ent.cap || 1), 0.75, 1.0));
    tiles.push(meterTile("Open stop-loss risk", `${fmt(ex.open_risk_pct, 2)}%`, `${fmt(ex.open_risk)} · max ${fmt(lim.max_total_risk_pct, 2)}%`, (ex.open_risk_pct || 0) / (lim.max_total_risk_pct || 1)));
    tiles.push(tile("Margin", acct.margin_level ? `${fmt(acct.margin_level, 0)}%` : "no margin used", `used ${fmt(acct.margin)} · free ${fmt(acct.free_margin)}`));
  } else {
    tiles.push(tile("Account", "no data", "waiting for the EA snapshot"));
  }
  $("tiles").replaceChildren(...tiles);

  drawEquity(d.equity || []);

  // decisions
  const dec = st.decisions || {};
  const decNodes = Object.entries(dec).map(([sym, x]) => el("div", { class: "decision" },
    el("div", { class: "head" }, el("strong", { text: sym }), el("span", { class: `act act-${x.action}`, text: x.action }),
      el("span", { class: "muted small", text: `${x.regime || ""} · bar ${shortTime(x.bar_close)}` })),
    el("ul", null, (x.reasons || []).map((r) => el("li", { text: r })))));
  replace("decisions", decNodes.length ? el("div", null, decNodes) : el("p", { class: "empty", text: "No decisions yet" }));

  replace("connection", kv([
    ["Bridge", br.healthy ? badge("good", "healthy") : badge("critical", br.detail || "unhealthy")],
    ["EA snapshot age", ago(br.state_age_s)], ["EA version", ea.version], ["Active instance", ea.master ? "yes" : "no"],
    ["EA entries enabled", ea.trading_enabled ? "yes" : "no"], ["Live allowed (EA)", ea.live_allowed ? "yes" : "no"],
    ["Python heartbeat seen by EA", ago(ea.py_heartbeat_age)], ["Broker", acct ? `${acct.company} / ${acct.server} #${acct.login}` : "-"],
    ["Service loop", `${fmt(svc.loop_ms, 1)} ms`], ["Last bridge error", br.last_error || "none"],
  ]));
  const q = st.quotes || {};
  replace("quotes", table([
    { label: "Symbol", get: (r) => r[0] }, { label: "Bid", num: true, get: (r) => r[1].bid }, { label: "Ask", num: true, get: (r) => r[1].ask },
    { label: "Spread (pts)", num: true, get: (r) => fmt(r[1].spread_pts, 1) },
    { label: "Quote age", num: true, get: (r) => ago(r[1].age_s), cls: (r) => (r[1].age_s > 30 ? "neg" : "") },
  ], Object.entries(q)));

  replace("positions", table([
    { label: "Ticket", get: (r) => r.ticket }, { label: "Symbol", get: (r) => r.symbol }, { label: "Side", get: (r) => r.side },
    { label: "Lots", num: true, get: (r) => fmt(r.volume, 2) }, { label: "Open", num: true, get: (r) => r.open_price },
    { label: "SL", num: true, get: (r) => (r.sl > 0 ? r.sl : "NONE"), cls: (r) => (r.sl > 0 ? "" : "neg") },
    { label: "TP", num: true, get: (r) => r.tp || "-" }, { label: "Net P&L", num: true, get: (r) => signed(r.profit), cls: (r) => tone(r.profit) },
    { label: "Opened (UTC)", get: (r) => shortTime(r.open_time) }, { label: "Owner", get: (r) => (r.system ? "system" : "manual (untouched)") },
  ], st.positions || []));
  const ccy = Object.entries(ex.by_currency || {}).map(([k, v]) => `${k} ${signed(v)}`).join(" · ");
  $("exposure-note").textContent = ccy ? `Net stop-risk by currency: ${ccy}` : "";

  replace("limits", kv([
    ["Risk per trade", `${fmt(lim.risk_per_trade_pct, 2)}%`], ["Max total open risk", `${fmt(lim.max_total_risk_pct, 2)}%`],
    ["Max open positions", lim.max_open_positions], ["Max daily loss", `${fmt(lim.max_daily_loss_pct, 2)}%`],
    ["Max entries per day", lim.max_entries_per_day],
    ["Daily-loss policy", d.config.risk.daily_loss_policy], ["Emergency-stop policy", d.config.risk.emergency_stop_policy],
    ["Max per currency", `${fmt(d.config.risk.max_currency_risk_pct, 2)}%`],
    ["Break-even / trailing", `${d.config.exits.breakeven_enabled ? d.config.exits.breakeven_trigger_r + "R" : "off"} / ${d.config.exits.trailing_enabled ? "on" : "off"}`],
  ]));
  renderLimitInputs(lim, d.hard_limits);

  const m = st.models || {}, ml = m.ml || {}, llm = m.llm || {}, news = st.news || {};
  replace("models", kv([
    ["Strategy", `${svc.strategy} (${svc.decision_tf} entries / ${svc.trend_tf} trend)`],
    ["ML meta-filter", ml.enabled ? (ml.version ? `${ml.version} · ${ml.calibrated ? "calibrated probability" : "uncalibrated score"}` : ml.error) : "disabled"],
    ["LLM review", llm.mode === "off" ? "off" : `${llm.mode} · ${llm.model} · ${llm.calls_24h}/${llm.max_calls} calls · $${fmt(llm.cost_24h_usd, 3)}/${fmt(llm.max_cost_usd, 2)} (24h)${llm.error ? " · " + llm.error : ""}`],
    ["Economic calendar", news.provider === "none" ? badge("warning", "not configured - news filter inactive") : (news.active ? badge("good", `${news.events} events`) : badge("serious", news.detail))],
    ["Model registry", (d.models || []).map((x) => `${x.version} (${x.status})`).join(", ") || "no models"],
  ]));

  replace("trades", table([
    { label: "Ticket", get: (r) => r.ticket }, { label: "Symbol", get: (r) => r.symbol }, { label: "Side", get: (r) => r.side },
    { label: "Lots", num: true, get: (r) => fmt(r.volume, 2) }, { label: "Opened", get: (r) => shortTime(r.open_time) },
    { label: "Closed", get: (r) => shortTime(r.close_time) }, { label: "Net", num: true, get: (r) => signed(r.net_profit), cls: (r) => tone(r.net_profit) },
    { label: "R", num: true, get: (r) => (r.r_multiple == null ? "-" : signed(r.r_multiple, 2)) }, { label: "Status", get: (r) => r.status },
  ], d.trades || []));

  const evCols = [
    { label: "Time (UTC)", get: (r) => shortTime(r.ts) }, { label: "Level", get: (r) => r.level, cls: (r) => (["error", "critical"].includes(r.level) ? "neg" : "") },
    { label: "Source", get: (r) => r.source }, { label: "Code", get: (r) => r.code }, { label: "Message", get: (r) => r.message },
  ];
  replace("errors", table(evCols, d.errors || []));
  replace("events", table(evCols, d.events || []));
  replace("history", table([
    { label: "Decided (UTC)", get: (r) => shortTime(r.ts) }, { label: "Symbol", get: (r) => r.symbol }, { label: "Bar close", get: (r) => shortTime(r.bar_time) },
    { label: "Action", get: (r) => r.action }, { label: "Regime", get: (r) => r.regime },
    { label: "Reason", get: (r) => (r.reasons || []).filter((x) => /WAIT:|BUY:|SELL:|risk|LLM|ML/.test(x)).slice(-1)[0] || (r.reasons || [])[0] || "" },
  ], d.decisions || []));
}

let limitsRendered = false;
function renderLimitInputs(lim, hard) {
  if (limitsRendered) return;
  limitsRendered = true;
  const labels = { risk_per_trade_pct: "Risk per trade %", max_total_risk_pct: "Max total risk %", max_open_positions: "Max open positions",
    max_daily_loss_pct: "Max daily loss %", max_entries_per_day: "Max entries per day" };
  $("limits-inputs").replaceChildren(...Object.entries(labels).map(([k, label]) =>
    el("label", null, `${label} (max ${hard[k]})`, el("input", { name: k, type: "number", step: "any", min: "0", max: String(hard[k]), value: String(lim[k] ?? "") }))));
}

// ------------------------------------------------------------------ actions
async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}

document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", async () => {
  const action = b.dataset.action, params = {};
  if (action === "estop") {
    params.policy = b.dataset.policy;
    if (!confirm(params.policy === "close_all" ? "EMERGENCY STOP: block entries and CLOSE all system positions?" : "EMERGENCY STOP: block entries and keep positions with their stops?")) return;
  } else if (action === "estop_clear") {
    const w = prompt("Type CLEAR to remove the emergency stop");
    if (w !== "CLEAR") return;
    params.confirm = "CLEAR";
  } else if (action === "close_all" && !confirm("Close all system positions at market?")) return;
  try { const j = await post("/api/control", { action, params }); $("control-msg").textContent = `${action}: ${j.note}`; }
  catch (e) { $("control-msg").textContent = `${action} refused: ${e.message}`; }
}));

$("limits-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = {};
  for (const inp of e.target.querySelectorAll("input")) if (inp.value !== "") params[inp.name] = Number(inp.value);
  try { const j = await post("/api/control", { action: "set_limits", params }); $("control-msg").textContent = `limits: ${j.note}`; }
  catch (err) { $("control-msg").textContent = `limits refused: ${err.message}`; }
});

$("logout").addEventListener("click", async () => { await post("/api/logout"); window.location = "/login"; });

$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("fxai-theme", root.dataset.theme); } catch (_) { /* storage unavailable */ }
});
try { const t = localStorage.getItem("fxai-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* ignore */ }

async function refresh() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (r.status === 401) { window.location = "/login"; return; }
    render(await r.json());
  } catch (e) {
    $("badges").replaceChildren(badge("critical", "Dashboard cannot reach its server"));
  }
}
refresh();
setInterval(refresh, 2000);

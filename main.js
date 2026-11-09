/* ARK raw-asset deploy 2026-11-09. */
/* ARK Bot view-only dashboard — polls the FastAPI read model.
   Production auth uses Telegram initData only. No API token or API-base
   override is read from browser storage. */
"use strict";

const getTg = () => (window.Telegram && window.Telegram.WebApp) || null;
const API_BASE = location.hostname === "app.arksignal.pro"
  ? "https://api.arksignal.pro" : "";
const REQUEST_TIMEOUT_MS = 10000;

const POLL = { status: 15000, positions: 8000, pnl: 12000, spreads: 8000, risk: 20000 };
let pollTimer = null;
let pollGeneration = 0;
let requestInFlight = false;
let activeTab = "status";
let pnlPeriod = "24h";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt$ = (v) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
const fmtPct = (v) => (v == null ? "—" : v.toFixed(2) + "%");
const pnlClass = (v) => (v > 0 ? "up" : v < 0 ? "down" : "muted");
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function setConn(ok) {
  const dot = $("#conn-dot");
  dot.className = "dot " + (ok === null ? "" : ok ? "ok" : "bad");
}

async function api(path) {
  const tg = getTg();
  if (!tg || !tg.initData) {
    stopPolling();
    showAuth(true);
    throw new Error("401");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      headers: { "X-Telegram-Init-Data": tg.initData },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      stopPolling();
      showAuth(true);
      throw new Error("401");
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    setConn(true);
    showAuth(false);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function showAuth(show) {
  $("#auth-panel").classList.toggle("show", Boolean(show));
}

function renderError(el, msg) {
  el.innerHTML = '<div class="error-box">' + esc(msg || "Данные недоступны") + "</div>";
}

function tile(cls, k, v, sub) {
  return '<div class="tile ' + cls + '"><div class="t-k">' + k + '</div>'
    + '<div class="t-v">' + v + '</div>'
    + (sub ? '<div class="t-s">' + sub + '</div>' : '') + '</div>';
}

/* ---------------- Status ---------------- */
async function loadStatus() {
  try {
    const [status, signals, daily, intents] = await Promise.all([
      api("/api/v1/status"), api("/api/v1/signals?limit=5"),
      api("/api/v1/pnl/daily?days=1"), api("/api/v1/order-intents?limit=1")]);

    // Night-safety tiles (color carries the meaning, 2-3 words each).
    const age = status.heartbeat_age_s;
    const pulseCls = age == null ? "bad" : age < 120 ? "ok" : age <= 300 ? "warn" : "bad";
    const pulseTxt = age == null ? "Нет данных"
      : age < 90 ? "Обновлён " + age + " сек назад"
      : "Обновлён " + Math.round(age / 60) + " мин назад";
    const brk = status.api_breaker;
    const brkCls = brk === "open" ? "bad" : brk === "closed" ? "ok" : "warn";
    const brkTxt = brk === "open" ? "Торговля остановлена"
      : brk === "closed" ? "Торговля разрешена" : "Нет данных";
    const wo = status.watch_only;
    const modeCls = wo === true ? "info" : wo === false ? "ok" : "warn";
    const modeTxt = wo === true ? "Только наблюдает" : wo === false ? "Торгует" : "Нет данных";
    const modeSub = (status.bot_mode ? esc(String(status.bot_mode).toUpperCase()) : "")
      + (status.cycle_count != null ? " · цикл " + Number(status.cycle_count) : "");
    const ef = status.exchange_failures;
    const efCls = ef == null ? "warn" : ef === 0 ? "ok" : ef < 3 ? "warn" : "bad";
    const efTxt = ef == null ? "Нет данных" : ef === 0 ? "Биржа в норме" : "Сбоев: " + ef;
    // Если бот мёртв/heartbeat устарел, плитки из heartbeat.json показывают
    // вчерашнее состояние — гасим их в серое «Нет связи», чтобы зелёные
    // «Торгует / Биржа в норме» не вводили в заблуждение ночью.
    const dead = status.bot_active === false || age == null || age > 120;
    const _brkCls = dead ? "dead" : brkCls;
    const _brkTxt = dead ? "Нет связи" : brkTxt;
    const _modeCls = dead ? "dead" : modeCls;
    const _modeTxt = dead ? "Нет связи" : modeTxt;
    const _efCls = dead ? "dead" : efCls;
    const _efTxt = dead ? "Нет связи" : efTxt;
    const today = daily.items && daily.items.length ? daily.items[daily.items.length - 1] : null;
    const pnlTxt = today
      ? (today.daily_pnl >= 0 ? "+" : "−") + "$" + Math.abs(today.daily_pnl).toFixed(2) : "—";
    const pnlCls = today ? (today.daily_pnl >= 0 ? "ok" : "bad") : "warn";
    let actTxt = "Сделок пока нет";
    if (intents.items && intents.items.length) {
      const it = intents.items[0];
      actTxt = fmtTime(it.created_at) + " · " + esc(String(it.side).toUpperCase())
        + " " + esc(it.symbol);
    }
    $("#status-night").innerHTML = "<h2>Ночной контроль</h2>"
      + (status.paper === true
          ? '<div class="badge warn" style="font-size:14px; margin-bottom:10px">'
            + "📝 УЧЕБНЫЙ РЕЖИМ — реальные деньги не трогаются</div>"
          : "")
      + '<div class="tiles">'
      + tile(pulseCls, "Пульс бота", pulseTxt, status.emergency_stop ? "АВАРИЙНЫЙ СТОП" : "")
      + tile(_brkCls, "Защита API", _brkTxt, "")
      + tile(_modeCls, "Режим", _modeTxt, dead ? "" : modeSub)
      + tile(_efCls, "Биржа", _efTxt, "")
      + tile(pnlCls, "PnL сегодня", pnlTxt, today ? "Сделок: " + today.total_trades : "")
      + tile("info", "Активность", actTxt, "")
      + "</div>";
    const badge = status.bot_active
      ? '<span class="badge ok">АКТИВЕН</span>' : '<span class="badge bad">НЕ АКТИВЕН</span>';
    const uptimeH = Math.floor(status.uptime_seconds / 3600);
    const uptimeM = Math.floor((status.uptime_seconds % 3600) / 60);
    $("#status-health").innerHTML = "<h2>Состояние бота</h2>"
      + '<div class="big">' + badge + "</div>"
      + '<div class="row"><span class="k">Аптайм</span><span class="v mono">'
      + uptimeH + " ч " + uptimeM + " мин</span></div>"
      + '<div class="row"><span class="k">Последний heartbeat</span><span class="v mono">'
      + fmtTime(status.last_heartbeat) + "</span></div>"
      + '<div class="row"><span class="k">Риск-режим</span><span class="v">'
      + esc(status.risk_mode) + '</span></div>'
      + '<div class="row"><span class="k">Версия</span><span class="v mono">v'
      + esc(status.version) + "</span></div>";
    const ex = status.exchanges_connected.length
      ? status.exchanges_connected.map((e) =>
          '<div class="row"><span class="k">' + esc(e).toUpperCase()
          + '</span><span class="v"><span class="badge ok">подключена</span></span></div>').join("")
      : '<div class="empty">Нет активных подключений к биржам</div>';
    $("#status-exchanges").innerHTML = "<h2>Биржи</h2>" + ex;
    $("#status-signals").innerHTML = "<h2>Последние сигналы</h2>" + (signals.items.length
      ? signals.items.map((s) =>
          '<div class="row"><span class="k mono">' + esc(s.symbol) + "</span>"
          + '<span class="v"><span class="badge ' + (s.side === "buy" ? "ok" : "bad") + '">'
          + esc(s.side).toUpperCase() + "</span> "
          + '<span class="muted mono">' + fmtTime(s.timestamp) + "</span></span></div>").join("")
      : '<div class="empty">Сигналов пока нет</div>');
  } catch (e) {
    setConn(false);
    if (e.message !== "401") {
      renderError($("#status-night"), "Не удалось загрузить статус");
      renderError($("#status-health"), "Не удалось загрузить статус");
      renderError($("#status-exchanges"), "—");
      renderError($("#status-signals"), "—");
    }
  }
}

/* ---------------- Positions ---------------- */
async function loadPositions() {
  const exchange = $("#pos-exchange").value;
  try {
    const data = await api("/api/v1/positions" + (exchange ? "?exchange=" + exchange : ""));
    $("#pos-count").textContent = "Всего: " + data.total;
    $("#positions-list").innerHTML = data.items.length
      ? data.items.map((p) =>
          '<div class="card"><div class="row"><span class="mono" style="font-weight:700">'
          + esc(p.symbol) + '</span><span class="v"><span class="badge '
          + (p.side === "long" ? "ok" : "bad") + '">' + esc(p.side).toUpperCase() + "</span> "
          + '<span class="badge info">' + esc(p.exchange) + "</span></span></div>"
          + '<div class="row"><span class="k">Количество</span><span class="v mono">'
          + esc(p.quantity) + "</span></div>"
          + '<div class="row"><span class="k">Вход → Текущая</span><span class="v mono">'
          + esc(p.entry_price) + " → " + esc(p.current_price) + "</span></div>"
          + '<div class="row"><span class="k">Нереализ. PnL</span><span class="v mono '
          + pnlClass(p.unrealized_pnl) + '">' + fmt$(p.unrealized_pnl) + " ("
          + fmtPct(p.unrealized_pnl_pct) + ")</span></div></div>").join("")
      : '<div class="card"><div class="empty">Открытых позиций нет</div></div>';
  } catch (e) {
    setConn(false);
    $("#pos-count").textContent = "—";
    if (e.message !== "401") renderError($("#positions-list"), "Не удалось загрузить позиции");
  }
}

/* ---------------- PnL ---------------- */
async function loadPnl() {
  try {
    const [pnl, daily] = await Promise.all([
      api("/api/v1/pnl?period=" + pnlPeriod), api("/api/v1/pnl/daily?days=7")]);
    $("#pnl-overall").innerHTML = "<h2>PnL · " + esc(pnlPeriod) + "</h2>"
      + '<div class="big ' + pnlClass(pnl.total_pnl) + '">' + fmt$(pnl.total_pnl) + "</div>"
      + '<div class="row"><span class="k">Реализованный</span><span class="v mono '
      + pnlClass(pnl.realized_pnl) + '">' + fmt$(pnl.realized_pnl) + "</span></div>"
      + '<div class="row"><span class="k">Нереализованный</span><span class="v mono '
      + pnlClass(pnl.unrealized_pnl) + '">' + fmt$(pnl.unrealized_pnl) + "</span></div>"
      + '<div class="row"><span class="k">Сделок / Win-rate</span><span class="v mono">'
      + pnl.total_trades + " / " + fmtPct(pnl.win_rate) + "</span></div>"
      + '<div class="row"><span class="k">Средний выигрыш / проигрыш</span><span class="v mono">'
      + fmt$(pnl.avg_win) + " / " + fmt$(pnl.avg_loss) + "</span></div>"
      + '<div class="row"><span class="k">Макс. просадка</span><span class="v mono down">'
      + fmt$(pnl.max_drawdown) + "</span></div>"
      + '<div class="row"><span class="k">Sharpe</span><span class="v mono">'
      + Number(pnl.sharpe_ratio ?? 0).toFixed(2) + "</span></div>"
      + '<div class="row"><span class="k">ROI</span><span class="v mono '
      + pnlClass(pnl.roi_pct) + '">' + fmtPct(pnl.roi_pct) + "</span></div>";
    const max = Math.max(...daily.items.map((d) => Math.abs(d.daily_pnl)), 0.01);
    $("#pnl-daily").innerHTML = "<h2>PnL по дням</h2>" + (daily.items.length
      ? '<div class="bars">' + daily.items.map((d) =>
          '<div class="bar-wrap"><div class="bar ' + (d.daily_pnl >= 0 ? "pos" : "neg")
          + '" style="height:' + Math.max(2, Math.abs(d.daily_pnl) / max * 90) + 'px" title="'
          + esc(d.date) + ": " + fmt$(d.daily_pnl) + '"></div>'
          + '<div class="bar-label">' + esc(d.date.slice(5)) + "</div></div>").join("") + "</div>"
      : '<div class="empty">Данных по дням пока нет</div>');
  } catch (e) {
    setConn(false);
    if (e.message !== "401") {
      renderError($("#pnl-overall"), "Не удалось загрузить PnL");
      renderError($("#pnl-daily"), "—");
    }
  }
}

/* ---------------- Spreads ---------------- */
async function loadSpreads() {
  const min = $("#spread-min").value;
  try {
    const data = await api("/api/v1/spreads?min_spread_pct=" + min);
    $("#spread-updated").textContent = "Обновлено: " + fmtTime(data.timestamp);
    $("#spreads-table").innerHTML = data.items.length
      ? '<table><thead><tr><th>Пара</th><th>Spot</th><th>Fut</th><th>Спред</th></tr></thead><tbody>'
        + data.items.map((s) =>
          "<tr><td class='mono'>" + esc(s.symbol) + "</td><td class='mono'>"
          + esc(s.spot_price ?? "—") + "</td><td class='mono'>" + esc(s.futures_price ?? "—")
          + "</td><td class='mono " + pnlClass(s.spread_pct) + "'>"
          + fmtPct(s.spread_pct) + "</td></tr>").join("") + "</tbody></table>"
      : '<div class="empty">Спредов выше порога нет</div>';
  } catch (e) {
    setConn(false);
    $("#spread-updated").textContent = "Обновлено: —";
    if (e.message !== "401") renderError($("#spreads-table"), "Не удалось загрузить спреды");
  }
}

/* ---------------- Risk ---------------- */
async function loadRisk() {
  try {
    const [risk, intents] = await Promise.all([
      api("/api/v1/risk"), api("/api/v1/order-intents?limit=5")]);
    const level = { low: ["НИЗКИЙ", "ok"], moderate: ["УМЕРЕННЫЙ", "warn"], high: ["ВЫСОКИЙ", "bad"] }[risk.risk_level] || ["—", "info"];
    $("#risk-overall").innerHTML = "<h2>Риск-метрики</h2>"
      + '<div class="big"><span class="badge ' + level[1] + '">' + level[0] + "</span></div>"
      + '<div class="row"><span class="k">Экспозиция</span><span class="v mono">'
      + fmt$(risk.total_exposure_usd) + (risk.max_allowed_exposure
        ? " / " + fmt$(risk.max_allowed_exposure) : "") + "</span></div>"
      + '<div class="row"><span class="k">Позиции</span><span class="v mono">'
      + esc(risk.positions_count) + (risk.max_positions ? " / " + esc(risk.max_positions) : "") + "</span></div>"
      + '<div class="row"><span class="k">Дневной убыток</span><span class="v mono '
      + pnlClass(risk.daily_loss_usd) + '">' + fmt$(risk.daily_loss_usd)
      + (risk.daily_loss_limit ? " / лимит " + fmt$(risk.daily_loss_limit) : "") + "</span></div>"
      + '<div class="row"><span class="k">Circuit breaker</span><span class="v">'
      + (risk.circuit_breaker_triggered ? '<span class="badge bad">СРАБОТАЛ</span>'
        : '<span class="badge ok">норма</span>') + "</span></div>"
      + (risk.warnings.length
        ? '<div class="row"><span class="k">Предупреждения</span><span class="v down">'
          + risk.warnings.map(esc).join(", ") + "</span></div>" : "");
    $("#risk-intents").innerHTML = "<h2>Последние ордер-интенты</h2>" + (intents.items.length
      ? intents.items.map((i) =>
          '<div class="row"><span class="k mono">' + esc(i.symbol) + " · " + esc(i.exchange)
          + '</span><span class="v"><span class="badge '
          + ({ ack: "ok", done: "ok", sent: "info", unknown: "warn" }[i.status] || "info") + '">'
          + esc(i.status) + "</span> "
          + '<span class="muted mono">' + fmtTime(i.created_at) + "</span></span></div>").join("")
      : '<div class="empty">Интентов пока нет</div>');
  } catch (e) {
    setConn(false);
    if (e.message !== "401") {
      renderError($("#risk-overall"), "Не удалось загрузить риск-метрики");
      renderError($("#risk-intents"), "—");
    }
  }
}

/* ---------------- orchestration ---------------- */
const loaders = { status: loadStatus, positions: loadPositions, pnl: loadPnl, spreads: loadSpreads, risk: loadRisk };

async function runPolling(generation) {
  if (requestInFlight || document.hidden || generation !== pollGeneration) return;
  requestInFlight = true;
  try {
    await loaders[activeTab]();
  } finally {
    requestInFlight = false;
    if (generation === pollGeneration && !document.hidden) {
      pollTimer = setTimeout(() => runPolling(generation), POLL[activeTab]);
    }
  }
}
function startPolling(tab) {
  stopPolling();
  runPolling(pollGeneration);
}
function stopPolling() {
  pollGeneration += 1;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll("nav button").forEach((b) => {
    const selected = b.dataset.tab === tab;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("active", p.id === "tab-" + tab));
  startPolling(tab);
}
function refreshAll() {
  const btn = $("#refresh-btn");
  btn.classList.add("spin");
  setTimeout(() => btn.classList.remove("spin"), 700);
  startPolling(activeTab);
}

const tabButtons = Array.from(document.querySelectorAll("nav button"));
tabButtons.forEach((b, index) => {
  b.addEventListener("click", () => {
    switchTab(b.dataset.tab);
    const tg = getTg();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
  });
  b.addEventListener("keydown", (event) => {
    let target = null;
    if (event.key === "ArrowRight") target = (index + 1) % tabButtons.length;
    if (event.key === "ArrowLeft") target = (index - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = tabButtons.length - 1;
    if (target !== null) {
      event.preventDefault();
      switchTab(tabButtons[target].dataset.tab);
      tabButtons[target].focus();
    }
  });
});
$("#refresh-btn").addEventListener("click", refreshAll);
$("#pos-exchange").addEventListener("change", () => startPolling("positions"));
$("#spread-min").addEventListener("change", () => startPolling("spreads"));

["1h", "24h", "7d", "30d", "all"].forEach((p) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn ghost";
  b.style.minHeight = "44px";
  b.textContent = p;
  if (p === pnlPeriod) { b.classList.add("primary"); b.classList.remove("ghost"); }
  b.addEventListener("click", () => {
    pnlPeriod = p;
    document.querySelectorAll("#pnl-periods .btn").forEach((x) => {
      const on = x.textContent === p;
      x.classList.toggle("primary", on);
      x.classList.toggle("ghost", !on);
    });
    startPolling("pnl");
  });
  $("#pnl-periods").appendChild(b);
});

window.addEventListener("offline", () => $("#offline-banner").classList.add("show"));
window.addEventListener("online", () => {
  $("#offline-banner").classList.remove("show");
  startPolling(activeTab);
});
if (!navigator.onLine) $("#offline-banner").classList.add("show");
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling(); else startPolling(activeTab);
});
window.addEventListener("pagehide", stopPolling);

function boot() {
  const tg = getTg();
  if (tg) { tg.ready(); tg.expand(); }
  const authenticated = Boolean(tg && tg.initData);
  showAuth(!authenticated);
  if (authenticated) switchTab("status");
  else setConn(null);
}

// Inside Telegram the URL hash carries tgWebAppData (or the WebView exposes
// TelegramWebviewProxy): only then pull the official script from telegram.org.
// In a plain browser no doomed external request is made at all.
const insideTelegram = location.hash.includes("tgWebAppData") ||
  "TelegramWebviewProxy" in window;
if (insideTelegram && !getTg()) {
  const script = document.createElement("script");
  script.src = "https://telegram.org/js/telegram-web-app.js";
  script.onload = boot;
  script.onerror = boot; // degrade to token auth if telegram.org is unreachable
  document.head.appendChild(script);
} else {
  boot();
}

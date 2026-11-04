const translations = await (await fetch("./translations.json")).json();
const api = window.deck;
let state = await api.snapshot(),
  view = "monitors",
  filter = "all",
  query = "",
  group = "",
  page = 0,
  eventsQuery = "",
  eventsFilter = "",
  toastTimer,
  sound;
const $ = (selector) => document.querySelector(selector);
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const t = (key, values = {}) =>
  String(
    translations[state.settings.language]?.[key] || translations.en[key] || key,
  ).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
const paths = {
  pulse: "M2 12h5l3-8 4 16 3-8h5",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  events: "M4 5h16M4 12h16M4 19h10",
  tools: "m14 6 4 4M4 20l8-8M12 5a5 5 0 0 0 7 7l-3-3 3-3a5 5 0 0 0-7-1Z",
  settings:
    "M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2 1-4Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  plus: "M12 5v14M5 12h14",
  play: "m8 5 11 7-11 7V5Z",
  pause: "M8 5v14M16 5v14",
  search: "M17 17l4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  down: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
  up: "M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  minus: "M5 12h14",
  max: "M5 5h14v14H5z",
  server: "M4 3h16v7H4z M4 14h16v7H4z M7 6h1M7 17h1",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
  port: "M4 5h16v10h-4v5H8v-5H4V5ZM8 8v4m4-4v4m4-4v4",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 2",
  bell: "M6 16V9a6 6 0 0 1 12 0v7l2 2H4l2-2Zm4 5h4",
  edit: "m4 16 11-11 4 4L8 20H4v-4Zm9-9 4 4",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  link: "M14 3h7v7m0-7L10 14M9 4H4v16h16v-5",
  shield: "m12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6l8-3Zm-4 9 3 3 5-6",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6m0-10v1",
  copy: "M8 8h12v13H8zM16 8V3H3v13h5",
  sound: "M4 9h4l5-4v14l-5-4H4V9Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.pulse}"/></svg>`;
const btn = (action, label, symbol, cls = "", attrs = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ""}${e(label)}</button>`;
const ibtn = (action, label, symbol, id = "") =>
  `<button type="button" class="icon-button" data-action="${action}" data-id="${e(id)}" title="${e(label)}" aria-label="${e(label)}">${icon(symbol)}</button>`;
const date = (at, short = false) =>
  at
    ? new Date(at).toLocaleString(
        state.settings.language === "ru" ? "ru-RU" : "en-GB",
        short ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : {},
      )
    : t("never");
const groupName = (s) =>
  s === "Без группы" || s === "Ungrouped" ? t("ungrouped") : s;
const showToast = (message) => {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 4500);
};
const safe = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch((error) => showToast(error.message));
function detail(m) {
  const d = m.detail || "";
  if (/^ssh[A-Z]/.test(d)) return t(d);
  if (/^HTTP \d+$/.test(d)) return d;
  const keys = {
    "Ответ ICMP": "icmpOK",
    "Нет ответа ICMP": "icmpNoReply",
    "Не удалось выполнить ping": "probeFailed",
    "Проверка не выполнена": "probeFailed",
    "Не удалось выполнить проверку": "probeFailed",
    "Тайм-аут соединения": "tcpTimeout",
    "Тайм-аут HTTP": "httpTimeout",
    "HTTP-соединение недоступно": "httpFailed",
    "Ошибка SSL-сертификата": "sslFailed",
    "Некорректный редирект": "redirectFailed",
    "Неподдерживаемый редирект": "redirectUnsupported",
    "ICMP недоступен или адрес не найден": "icmpNoReply",
  };
  if (/^Порт \d+ открыт$/.test(d)) return t("tcpOpen", { port: m.port });
  if (/^Нет соединения с портом \d+$/.test(d))
    return t("tcpClosed", { port: m.port });
  return keys[d] ? t(keys[d]) : d;
}
function statusText(m) {
  if (!m.enabled) return t("disabled");
  return m.status === "up"
    ? t(m.type + "Responding")
    : m.type === "ssh" && m.status === "down"
      ? t("sshNotResponding")
      : t(m.status);
}
function eventText(event) {
  return event.code
    ? t("event." + event.code, event.values || {})
    : event.message;
}
function playSound(melody, volume) {
  sound?.pause();
  sound = new Audio(`../assets/sounds/${String(melody).padStart(2, "0")}.wav`);
  sound.volume = volume / 100;
  sound
    .play()
    .catch(() =>
      showToast(
        state.settings.language === "ru"
          ? "Не удалось воспроизвести звук."
          : "Could not play the alert sound.",
      ),
    );
}
function shell() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.lang = state.settings.language;
  $("#app").innerHTML =
    `<div class="shell"><div class="titlebar"><span>PulseDeck <span class="muted"> / NETWORK TOOLS</span></span><div class="window-buttons">${ibtn("minimize", t("minimize"), "minus")}${ibtn("maximize", t("maximize"), "max")}${ibtn("close-window", t("hide"), "close")}</div></div><aside class="sidebar"><div class="brand"><img src="../assets/icon.svg" alt=""><div><strong>PulseDeck</strong><small>NETWORK TOOLS</small></div></div><div class="eyebrow nav-caption">${e(t("workspace"))}</div><nav class="nav">${[
      ["monitors", "monitor", "grid"],
      ["events", "events", "events"],
      ["tools", "tools", "tools"],
      ["settings", "settings", "settings"],
    ]
      .map(
        ([id, label, symbol]) =>
          `<button data-view="${id}" class="${view === id ? "active" : ""}">${icon(symbol)}${e(t(label))}${id === "monitors" ? '<span id="nav-count" class="nav-count"></span>' : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="side-bottom"><div class="local-card"><span class="dot"></span>${e(t("local"))}<br><span>PulseDeck ${e(state.version)}</span></div>${btn("github", t("github"), "link", "ghost")}</div></aside><main class="main"><div class="content" id="content"></div></main></div>`;
  renderView();
}
function heading(title, subtitle, actions = "") {
  return `<header class="page-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="head-actions">${actions}</div></header>`;
}
function renderView() {
  for (const el of document.querySelectorAll("[data-view]"))
    el.classList.toggle("active", el.dataset.view === view);
  const content = $("#content");
  if (view === "monitors") {
    content.innerHTML = `${heading(t("overview"), t("subtitle"), '<span id="start-control"></span>')}${state.warning ? `<div class="banner-warning">${e(t("warningToken"))}</div>` : ""}<div class="summary" id="summary"></div><div id="check-scope" class="check-scope hidden"></div><div class="section-bar"><div class="section-title"><h2>${e(t("all"))}</h2><span class="badge" id="list-count"></span></div><div class="section-buttons">${btn("export", t("export"), "up", "ghost small")}${btn("import", t("import"), "down", "ghost small")}${btn("add", t("add"), "plus", "small")}</div></div><div class="toolbar"><div class="search-box">${icon("search")}<input id="search" aria-label="${e(t("search"))}" placeholder="${e(t("search"))}" value="${e(query)}"></div><div class="filters">${["all", "up", "down"].map((s) => `<button data-filter="${s}" class="${filter === s ? "active" : ""}">${e(t(s))}</button>`).join("")}</div><select id="groups" aria-label="${e(t("group"))}"></select></div><div id="monitor-list" class="table-wrap"></div><div id="live-footer" class="status-footer"></div><p class="bottom-note">${e(t("sleep"))}</p>`;
    renderLive();
  } else if (view === "events") {
    content.innerHTML = `${heading(t("activityTitle"), t("activitySubtitle"), btn("export-events", t("exportCsv"), "up"))}<div class="toolbar"><div class="search-box">${icon("search")}<input id="event-search" aria-label="${e(t("eventSearch"))}" placeholder="${e(t("eventSearch"))}" value="${e(eventsQuery)}"></div><select id="event-filter" aria-label="${e(t("allEvents"))}">${["", "success", "warning", "error", "info"].map((v) => `<option value="${v}" ${v === eventsFilter ? "selected" : ""}>${e(t(v || "allEvents"))}</option>`).join("")}</select></div><div id="event-list" class="event-list"></div>`;
    renderEvents();
  } else if (view === "tools") {
    content.innerHTML = `${heading(t("toolsTitle"), t("toolsSubtitle"))}<div class="tool-grid">${[
      ["dns", "globe", "dnsTitle", "dnsText"],
      ["tls", "shield", "tlsTitle", "tlsText"],
      ["tcp", "port", "tcpTitle", "tcpText"],
      ["ssh", "shield", "sshTitle", "sshText"],
    ]
      .map(
        ([id, symbol, title, text]) =>
          `<section class="panel"><div class="tool-icon">${icon(symbol)}</div><h2>${e(t(title))}</h2><p>${e(t(text))}</p><form data-tool="${id}"><label class="field">${e(t(["tcp", "ssh"].includes(id) ? "address" : "address"))}<input name="address" required placeholder="${["tcp", "ssh"].includes(id) ? "192.0.2.10" : "example.com"}"></label>${["tcp", "ssh"].includes(id) ? `<label class="field">${e(t("port"))}<input name="port" type="number" min="1" max="65535" value="${id === "ssh" ? 22 : 443}" required></label>` : ""}<button class="primary" type="submit">${icon("search")}${e(t(id === "dns" ? "lookup" : "check"))}</button></form><div class="tool-result hidden" id="result-${id}"></div></section>`,
      )
      .join("")}</div><p class="bottom-note">${e(t("pingHelp"))}</p>`;
  } else {
    renderSettings();
    renderUpdates();
  }
  $("#nav-count").textContent = state.monitors.length;
}
function stats() {
  const list = state.monitors;
  const up = list.filter((m) => m.enabled && m.status === "up").length;
  const down = list.filter((m) => m.enabled && m.status === "down").length;
  const total = list.reduce((sum, m) => sum + m.total, 0),
    passed = list.reduce((sum, m) => sum + m.passed, 0);
  return [
    [
      t("total"),
      String(list.length).padStart(2, "0"),
      t("hosts"),
      "server",
      "",
    ],
    [
      t("up"),
      String(up).padStart(2, "0"),
      `${t("down")}: ${down}`,
      "pulse",
      "up",
    ],
    [
      t("successRate"),
      total ? ((passed / total) * 100).toFixed(1) + "<small>%</small>" : "—",
      t("samples"),
      "shield",
      "",
    ],
    [
      t("avgLatency"),
      (() => {
        const ms = list.filter((m) => m.enabled && m.latency != null);
        return ms.length
          ? Math.round(ms.reduce((sum, m) => sum + m.latency, 0) / ms.length) +
              `<small>${e(t("ms"))}</small>`
          : "—";
      })(),
      t("latest"),
      "clock",
      "",
    ],
  ]
    .map(
      ([label, val, note, sym, cls]) =>
        `<div class="stat"><div class="stat-head"><span>${e(label)}</span>${icon(sym)}</div><div class="stat-value ${cls}">${val}</div><div class="stat-note">${e(note)}</div></div>`,
    )
    .join("");
}
function bars(history) {
  const values = history.slice(-24);
  return `<div class="history-bars" aria-label="${e(t("history"))}">${Array.from({ length: 24 - values.length }, () => "<i></i>").join("")}${values.map((h) => `<i class="${h.ok ? "ok" : "fail"}" title="${e(date(h.at))}: ${h.ok ? h.ms + " " + t("ms") : t("down")}"></i>`).join("")}</div>`;
}
function radar() {
  return '<svg class="radar" viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="51" stroke="currentColor" opacity=".15"/><circle cx="60" cy="60" r="36" stroke="currentColor" opacity=".22"/><circle cx="60" cy="60" r="21" stroke="currentColor" opacity=".3"/><path d="M60 9v102M9 60h102" stroke="currentColor" opacity=".12"/><path d="M60 60 96 24a51 51 0 0 1 15 36Z" fill="currentColor" opacity=".1"/><path d="m23 66 21 0 10-23 15 40 10-23h18" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="85" cy="29" r="3" fill="currentColor"/><circle cx="31" cy="86" r="2" fill="currentColor" opacity=".5"/></svg>';
}
function renderLive() {
  $("#nav-count").textContent = state.monitors.length;
  if (view === "events") return renderEvents();
  if (view === "settings") return renderUpdates();
  if (view !== "monitors") return;
  $("#start-control").innerHTML = btn(
    state.running ? "stop" : "start",
    t(state.running ? "pause" : "start"),
    state.running ? "pause" : "play",
    state.running ? "" : "primary",
  );
  $("#summary").innerHTML = stats();
  const limited = state.monitors.some((m) => ["ping", "tcp"].includes(m.type));
  $("#check-scope").classList.toggle("hidden", !limited);
  $("#check-scope").textContent = t("checkScope");
  $("#list-count").textContent = state.monitors.length;
  const groups = [...new Set(state.monitors.map((m) => m.group))].sort();
  $("#groups").innerHTML =
    `<option value="">${e(t("allGroups"))}</option>${groups.map((g) => `<option value="${e(g)}" ${g === group ? "selected" : ""}>${e(groupName(g))}</option>`).join("")}`;
  const list = state.monitors.filter(
    (m) =>
      (!group || m.group === group) &&
      (filter === "all" || (m.enabled && m.status === filter)) &&
      `${m.name} ${m.address} ${m.group}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(list.length / 50));
  page = Math.min(page, pages - 1);
  const visible = list.slice(page * 50, (page + 1) * 50);
  if (!state.monitors.length)
    $("#monitor-list").innerHTML =
      `<div class="empty">${radar()}<h2>${e(t("emptyTitle"))}</h2><p>${e(t("emptyText"))}</p>${btn("add", t("addFirst"), "plus", "primary")}<small>${e(t("emptyNote"))}</small></div>`;
  else
    $("#monitor-list").innerHTML =
      `<table><colgroup><col width="31%"><col width="19%"><col width="10%"><col width="17%"><col width="11%"><col width="12%"></colgroup><thead><tr>${["name", "status", "latency", "history", "checked", "actions"].map((k) => `<th>${e(t(k))}</th>`).join("")}</tr></thead><tbody>${visible.map((m) => `<tr><td><div class="host-cell"><div class="host-symbol">${icon(m.type === "http" ? "globe" : m.type === "tcp" ? "port" : "server")}</div><div class="host-info"><button data-action="detail" data-id="${m.id}" class="host-title">${e(m.name)}</button><div class="host-sub" title="${e(m.address)}">${e(m.address)}${["tcp", "ssh"].includes(m.type) ? ":" + m.port : ""}</div></div></div></td><td><div class="status-text ${m.enabled ? m.status : ""}"><span class="dot"></span>${e(statusText(m))}</div><div class="status-detail" title="${e(detail(m))}">${e(state.running && m.enabled && typeof m.lastOk === "boolean" && m.checkedAt && m.streak < state.settings.confirmations && ((m.lastOk && m.status !== "up") || (!m.lastOk && m.status !== "down")) ? t("pendingState", { count: m.streak, total: state.settings.confirmations }) : detail(m) || m.type.toUpperCase())}</div></td><td class="latency-value">${m.latency == null ? "—" : Math.round(m.latency) + " <small>" + e(t("ms")) + "</small>"}</td><td>${bars(m.history)}</td><td class="mono muted">${m.checkedAt ? e(date(m.checkedAt, true)) : "—"}</td><td><div class="row-actions">${ibtn("toggle", t(m.enabled ? "disable" : "enable"), m.enabled ? "pause" : "play", m.id)}${ibtn("edit", t("edit"), "edit", m.id)}${ibtn("remove", t("delete"), "trash", m.id)}</div></td></tr>`).join("")}</tbody></table>${!visible.length ? `<div class="no-matches">${e(t("emptyFilter"))}</div>` : ""}<div class="table-footer"><span>${e(t("pagination", { from: list.length ? page * 50 + 1 : 0, to: Math.min((page + 1) * 50, list.length), total: list.length }))}</span><span class="pagination-buttons">${btn("prev-page", t("previous"), null, "ghost small", page === 0 ? "disabled" : "")}${btn("next-page", t("nextPage"), null, "ghost small", page >= pages - 1 ? "disabled" : "")}</span></div>`;
  renderFooter();
}
function renderFooter() {
  if (!$("#live-footer")) return;
  const status = !state.running
    ? t("idle")
    : state.busy
      ? t("checking", {
          done: state.completed,
          total: state.monitors.filter((m) => m.enabled).length,
        })
      : t("next", {
          seconds: Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000)),
        });
  $("#live-footer").innerHTML =
    `<span><i class="dot ${state.running ? "up" : ""}"></i>${e(status)}<span class="muted">· ${e(t("intervalNote", { seconds: state.settings.interval }))}</span></span><span>${icon("bell")}${e(state.pending ? t("telegramQueued", { count: state.pending }) : t(state.settings.telegram ? "telegramOn" : "telegramOff"))}</span>`;
}
function renderEvents() {
  if (!$("#event-list")) return;
  const list = state.events.filter(
    (v) =>
      (!eventsFilter || v.level === eventsFilter) &&
      eventText(v).toLowerCase().includes(eventsQuery.toLowerCase()),
  );
  $("#event-list").innerHTML = list.length
    ? list
        .map(
          (v) =>
            `<div class="event-row"><div class="event-icon ${e(v.level)}">${icon(v.level === "success" ? "check" : v.level === "warning" || v.level === "error" ? "info" : "clock")}</div><div><p>${e(eventText(v))}</p><time>${e(date(v.at))}</time></div></div>`,
        )
        .join("")
    : `<div class="no-matches">${e(t("noEvents"))}</div>`;
}
const checkField = (name, checked, title, help = "") =>
  `<label class="check-field"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span>${e(t(title))}${help ? `<small>${e(t(help))}</small>` : ""}</span></label>`;
function renderUpdates() {
  const el = $("#app-updates");
  if (!el) return;
  const u = state.appUpdate || { status: "development" };
  const size = (bytes) =>
    ((bytes || 0) / 1048576).toFixed(2) +
    (state.settings.language === "ru" ? " МБ" : " MB");
  const busy = ["checking", "downloading", "applying"].includes(u.status);
  const text =
    u.status === "error"
      ? t(u.error)
      : t("update." + u.status, {
          version: u.version || state.version,
          size: size(u.downloadBytes),
          done: size(u.downloaded),
        });
  el.innerHTML = `<div class="update-heading"><h2>${e(t("updates"))}</h2><span class="muted">PulseDeck ${e(state.version)}</span></div><p>${e(t("updateHelp"))}</p><p class="${u.status === "error" ? "error" : ""}" role="status">${e(text)}</p>${u.status === "downloading" ? `<progress max="${u.downloadBytes || 1}" value="${u.downloaded || 0}" aria-label="${e(t("updateDownload"))}"></progress>` : ""}<div class="update-actions">${btn("check-update", t("updateCheck"), "down", "", busy || u.status === "development" ? "disabled" : "")}${u.status === "available" ? btn("download-update", t("updateDownload"), "down", "primary") : ""}${u.status === "ready" ? btn("apply-update", t("updateApply"), "check", "primary") : ""}</div>`;
}
function renderSettings() {
  const s = state.settings;
  $("#content").innerHTML =
    `${heading(t("settingsTitle"), t("settingsSubtitle"))}<section class="panel update-panel" id="app-updates"></section><form id="settings-form"><div class="settings-grid"><div class="stack"><section class="panel"><h2>${e(t("general"))}</h2><div class="fields"><label class="field">${e(t("language"))}<select name="language"><option value="ru" ${s.language === "ru" ? "selected" : ""}>Русский</option><option value="en" ${s.language === "en" ? "selected" : ""}>English</option></select></label><label class="field">${e(t("theme"))}<select name="theme"><option value="dark" ${s.theme === "dark" ? "selected" : ""}>${e(t("dark"))}</option><option value="light" ${s.theme === "light" ? "selected" : ""}>${e(t("light"))}</option></select></label></div><div class="separator"></div>${checkField("autoStart", state.autoStart, "autoStart", "autoStartHelp")}${checkField("resume", s.resume, "resume", "resumeHelp")}</section><section class="panel"><h2>${e(t("checks"))}</h2><div class="fields">${[
      ["interval", 5, 3600],
      ["timeout", 1, 30],
      ["confirmations", 1, 5],
      ["concurrency", 1, 32],
    ]
      .map(
        ([name, min, max]) =>
          `<label class="field">${e(t(name))}<input name="${name}" type="number" min="${min}" max="${max}" value="${s[name]}" required></label>`,
      )
      .join(
        "",
      )}</div><p class="helper">${e(t("confirmHelp"))}</p></section><section class="panel"><div class="about-brand"><img src="../assets/icon.svg" alt="PulseDeck"><div><h2>PulseDeck</h2><small>${e(t("version", { version: state.version }))}</small></div></div><p class="panel-description">${e(t("shortDescription"))}</p><p class="helper">${e(t("license"))}</p>${btn("releases", t("releases"), "link", "ghost small")}</section></div><div class="stack"><section class="panel"><h2>${e(t("alerts"))}</h2>${checkField("firstAlert", s.firstAlert, "firstAlert")}${checkField("lossAlert", s.lossAlert, "lossAlert")}${checkField("desktop", s.desktop, "desktop")}${checkField("sound", s.sound, "sound")}<div class="separator"></div><label class="field">${e(t("melody"))}<select name="melody">${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}" ${s.melody === i + 1 ? "selected" : ""}>${String(i + 1).padStart(2, "0")} · ${e(t("melody" + (i + 1)))}</option>`).join("")}</select></label><label class="field">${e(t("volume"))}<span class="volume-row"><input name="volume" type="range" min="0" max="100" value="${s.volume}"><output id="volume-output">${s.volume}%</output></span></label><div class="sound-buttons">${btn("preview-sound", t("preview"), "sound", "small")}${btn("stop-sound", t("stopSound"), "pause", "ghost small")}</div><p class="helper">${e(t("volumeHelp"))}</p></section><section class="panel"><h2>${e(t("telegramTitle"))}</h2><p class="panel-description">${e(t("telegramText"))}</p>${checkField("telegram", s.telegram, "telegramEnable")}<div class="separator"></div><label class="field">${e(t("botToken"))}<input name="token" type="password" autocomplete="new-password" spellcheck="false" placeholder="${e(t(state.hasToken ? "tokenSaved" : "tokenPlaceholder"))}"></label><label class="field">${e(t("chatId"))}<span class="inline"><input name="chatId" value="${e(s.chatId)}" placeholder="123456789">${btn("find-chat", t("findChat"), null, "small")}</span></label><select id="chat-choices" class="hidden" aria-label="${e(t("chooseChat"))}"></select><div class="inline">${btn("test-telegram", t("testAlert"), "bell", "small")}${btn("botfather", t("botfather"), "link", "ghost small")}</div>${state.hasToken ? checkField("clearToken", false, "forgetToken") : ""}<p class="helper">${e(t("telegramHelp"))}</p></section></div></div><div class="settings-actions"><button class="primary" type="submit">${icon("check")}${e(t("saveSettings"))}</button><span id="settings-error" class="form-error"></span></div><p class="privacy-note">${e(t("privacy"))}</p></form>`;
}
function modal(title, body, wide = false) {
  const dialog = $("#dialog");
  dialog.classList.toggle("wide", wide);
  dialog.innerHTML = `<div class="dialog-head"><h2>${e(title)}</h2>${ibtn("close-modal", t("close"), "close")}</div><div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}
function editModal(m = {}) {
  let type = m.type || "ssh";
  modal(
    t(m.id ? "editTitle" : "addTitle"),
    `<form id="monitor-form"><input type="hidden" name="id" value="${e(m.id || "")}"><input type="hidden" name="type" value="${type}"><div class="type-tabs">${["ssh", "http", "ping", "tcp"].map((value) => `<button type="button" data-monitor-type="${value}" class="${type === value ? "active" : ""}">${icon(value === "ping" ? "pulse" : value === "tcp" ? "port" : value === "ssh" ? "shield" : "globe")}${value === "http" ? "HTTP / HTTPS" : value.toUpperCase()}</button>`).join("")}</div><label class="field"><span id="address-label">${e(t(type === "http" ? "url" : "address"))}</span><input name="address" required value="${e(m.address || "")}" placeholder="${type === "http" ? "https://example.com" : "192.0.2.10"}" spellcheck="false"></label><div class="fields"><label class="field">${e(t("displayName"))}<input name="name" maxlength="100" value="${e(m.name || "")}" placeholder="${e(t("namePlaceholder"))}"></label><label class="field">${e(t("group"))}<input name="group" maxlength="60" value="${e(m.group || "")}" placeholder="${e(t("groupPlaceholder"))}"></label><label class="field ${!["tcp", "ssh"].includes(type) ? "hidden" : ""}" id="port-field">${e(t("port"))}<input name="port" type="number" min="1" max="65535" value="${m.port || (type === "ssh" ? 22 : 443)}"></label></div><p class="helper" id="check-help">${e(t(type + "Help"))}</p><div id="form-error" class="form-error"></div><div class="dialog-actions">${btn("close-modal", t("cancel"), null, "ghost")}<button type="submit" class="primary">${e(t("save"))}</button></div></form>`,
  );
  $("#monitor-form").dataset.enabled = m.enabled === false ? "false" : "true";
}
function detailModal(m) {
  const samples = m.history.filter((v) => v.ok).map((v) => v.ms);
  const max = samples.length ? Math.max(...samples, 1) : 1;
  const jitter =
    samples.length > 1
      ? Math.round(
          samples
            .slice(1)
            .reduce((sum, n, i) => sum + Math.abs(n - samples[i]), 0) /
            (samples.length - 1),
        )
      : null;
  let segments = [],
    current = [];
  m.history.forEach((v, i) => {
    if (v.ok)
      current.push(
        `${(i / Math.max(1, m.history.length - 1)) * 450},${100 - (v.ms / max) * 85}`,
      );
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  modal(
    m.name,
    `<p class="mono">${e(m.address)}${["tcp", "ssh"].includes(m.type) ? ":" + m.port : ""} · ${m.type.toUpperCase()} · ${e(groupName(m.group))}</p><div class="status-text ${m.status}"><span class="dot"></span>${e(statusText(m))}<span class="muted">${e(detail(m))}</span></div><svg class="sparkline" viewBox="0 0 450 115" preserveAspectRatio="none" aria-label="${e(t("history"))}">${segments.map((points) => `<polyline points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="2"/>`).join("")}</svg><div class="history-caption"><span>${e(t("last120"))}</span><span>${e(t("ms"))}</span></div><div class="detail-grid">${[
      [t("passed"), m.passed],
      [t("failed"), m.total - m.passed],
      [
        t("minmax"),
        samples.length
          ? Math.min(...samples) + " / " + Math.max(...samples) + " " + t("ms")
          : "—",
      ],
      [t("jitter"), jitter == null ? "—" : jitter + " " + t("ms")],
      [t("lastSeen"), date(m.seenAt)],
      [t("lastChanged"), date(m.changedAt)],
    ]
      .map(
        ([label, val]) =>
          `<div><small>${e(label)}</small><strong>${e(val)}</strong></div>`,
      )
      .join(
        "",
      )}</div><p class="helper">${e(t("sampleNote"))}</p><div class="dialog-actions">${btn("copy", t("copyAddress"), "copy", "ghost", `data-id="${m.id}"`)}${btn("close-modal", t("close"), null, "primary")}</div>`,
  );
}
function bulkModal() {
  modal(
    t("bulkTitle"),
    `<p>${e(t("bulkText"))}</p><form id="import-form"><label class="field">${e(t("paste"))}<textarea name="text" required placeholder="192.0.2.10;Production;Servers&#10;https://example.com;Website;Web"></textarea></label><div id="form-error" class="form-error"></div><div class="dialog-actions">${btn("import-file", t("fromFile"), "down", "ghost")}<button type="submit" class="primary">${e(t("import"))}</button></div></form>`,
  );
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.view) {
    view = target.dataset.view;
    renderView();
    return;
  }
  if (target.dataset.filter) {
    filter = target.dataset.filter;
    page = 0;
    for (const el of document.querySelectorAll("[data-filter]"))
      el.classList.toggle("active", el.dataset.filter === filter);
    renderLive();
    return;
  }
  if (target.dataset.monitorType) {
    const type = target.dataset.monitorType;
    const form = $("#monitor-form");
    const previousType = form.elements.type.value;
    if (!["tcp", "ssh"].includes(previousType))
      form.elements.port.value = type === "ssh" ? "22" : "443";
    form.elements.type.value = type;
    for (const el of document.querySelectorAll("[data-monitor-type]"))
      el.classList.toggle("active", el.dataset.monitorType === type);
    $("#port-field").classList.toggle("hidden", !["tcp", "ssh"].includes(type));
    $("#check-help").textContent = t(type + "Help");
    $("#address-label").textContent = t(type === "http" ? "url" : "address");
    form.elements.address.placeholder =
      type === "http" ? "https://example.com" : "192.0.2.10";
    return;
  }
  const action = target.dataset.action,
    m = state.monitors.find((row) => row.id === target.dataset.id);
  if (!action) return;
  safe(async () => {
    if (["check-update", "download-update", "apply-update"].includes(action)) {
      const method = {
        "check-update": "checkUpdate",
        "download-update": "downloadUpdate",
        "apply-update": "applyUpdate",
      }[action];
      await api[method]();
      state = await api.snapshot();
      renderUpdates();
    } else if (action === "start" || action === "stop") {
      state = await api[action]();
      renderLive();
    } else if (action === "add" || action === "edit") editModal(m);
    else if (action === "detail") detailModal(m);
    else if (action === "close-modal") $("#dialog").close();
    else if (action === "toggle") {
      state = await api.upsert({ ...m, enabled: !m.enabled });
      renderLive();
    } else if (action === "remove")
      modal(
        t("removeTitle"),
        `<p>${e(t("removeText", { name: m.name }))}</p><div class="dialog-actions">${btn("close-modal", t("cancel"), null, "ghost")}${btn("confirm-remove", t("delete"), "trash", "danger", `data-id="${m.id}"`)}</div>`,
      );
    else if (action === "confirm-remove") {
      state = await api.remove(m.id);
      $("#dialog").close();
      renderLive();
    } else if (action === "import") bulkModal();
    else if (action === "import-file") {
      const result = await api.importFile();
      if (result) {
        $("#dialog").close();
        state = await api.snapshot();
        renderLive();
        showToast(t("imported", result));
      }
    } else if (action === "export" || action === "export-events") {
      if (await api[action === "export" ? "exportList" : "exportEvents"]())
        showToast(t("exported"));
    } else if (action === "prev-page" || action === "next-page") {
      page += action === "prev-page" ? -1 : 1;
      renderLive();
    } else if (["github", "releases", "botfather"].includes(action))
      await api.link(action);
    else if (["minimize", "maximize", "close-window"].includes(action))
      await api.window(action === "close-window" ? "close" : action);
    else if (action === "copy") {
      await navigator.clipboard.writeText(m.address);
      showToast(t("copied"));
    } else if (action === "preview-sound") {
      const form = $("#settings-form");
      playSound(
        Number(form.elements.melody.value),
        Number(form.elements.volume.value),
      );
    } else if (action === "stop-sound") sound?.pause();
    else if (action === "find-chat" || action === "test-telegram") {
      const form = $("#settings-form"),
        data = {
          token: form.elements.token.value,
          chatId: form.elements.chatId.value,
        };
      target.disabled = true;
      try {
        if (action === "test-telegram") {
          await api.testTelegram(data);
          showToast(t("testSent"));
        } else {
          const chats = await api.findChats(data.token);
          if (!chats.length) showToast(t("chatMissing"));
          else if (chats.length === 1) {
            form.elements.chatId.value = chats[0].id;
            showToast(t("chatFound", { name: chats[0].name }));
          } else {
            $("#chat-choices").classList.remove("hidden");
            $("#chat-choices").innerHTML =
              `<option value="">${e(t("chooseChat"))}</option>${chats.map((c) => `<option value="${e(c.id)}">${e(c.name)} (${e(c.id)})</option>`).join("")}`;
          }
        }
      } finally {
        target.disabled = false;
      }
    }
  });
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    query = event.target.value;
    page = 0;
    renderLive();
  }
  if (event.target.id === "event-search") {
    eventsQuery = event.target.value;
    renderEvents();
  }
  if (event.target.name === "volume") {
    $("#volume-output").textContent = event.target.value + "%";
    if (sound) sound.volume = Number(event.target.value) / 100;
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "groups") {
    group = event.target.value;
    page = 0;
    renderLive();
  }
  if (event.target.id === "event-filter") {
    eventsFilter = event.target.value;
    renderEvents();
  }
  if (event.target.id === "chat-choices")
    $("#settings-form").elements.chatId.value = event.target.value;
  if (event.target.name === "theme")
    document.documentElement.dataset.theme = event.target.value;
});
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector("[type=submit]");
  const values = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  const errorEl = form.querySelector(".form-error");
  if (errorEl) errorEl.textContent = "";
  try {
    if (form.getAttribute("id") === "monitor-form") {
      state = await api.upsert({
        ...values,
        enabled: form.dataset.enabled !== "false",
      });
      $("#dialog").close();
      renderLive();
    } else if (form.getAttribute("id") === "import-form") {
      const result = await api.importText(values.text);
      state = await api.snapshot();
      $("#dialog").close();
      renderLive();
      showToast(t("imported", result));
    } else if (form.getAttribute("id") === "settings-form") {
      for (const name of [
        "autoStart",
        "resume",
        "firstAlert",
        "lossAlert",
        "desktop",
        "telegram",
        "sound",
        "clearToken",
      ])
        values[name] = Boolean(form.elements[name]?.checked);
      state = await api.settings(values);
      shell();
      showToast(t("saved"));
    } else if (form.dataset.tool) {
      const type = form.dataset.tool,
        el = $("#result-" + type);
      el.classList.remove("hidden");
      el.textContent = t("working");
      try {
        const result = await api.diagnose({ ...values, type });
        if (type === "dns") {
          const list = result.filter((row) => row.records.length);
          el.innerHTML = list.length
            ? list
                .map(
                  (row) =>
                    `<strong>${row.type}</strong><pre>${e(row.records.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n"))}</pre>`,
                )
                .join("")
            : e(t("noRecords"));
        } else if (type === "tls")
          el.innerHTML = `<span class="${result.trusted ? "success" : "warning"}">${e(t(result.trusted ? "valid" : "notTrusted"))}</span><div class="result-label">${e(t("subject"))}</div>${e(result.subject)}<div class="result-label">${e(t("issuer"))}</div>${e(result.issuer)}<div class="result-label">${e(t("expires"))}</div>${e(date(Date.parse(result.to)))}<br><strong>${e(t("daysLeft", { days: result.days }))}</strong>`;
        else
          el.innerHTML = `<span class="${result.ok ? "success" : "error"}">${e(type === "ssh" ? detail(result) : t(result.ok ? "tcpOpen" : "tcpClosed", { port: values.port }))}</span>${result.ok ? "<br>" + result.latency + " " + e(t("ms")) : ""}`;
      } catch (error) {
        el.textContent = error.message;
      }
    }
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message;
    else showToast(error.message);
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
});
api.onUpdate((next) => {
  state = next;
  renderLive();
});
api.onAlert(() => {
  if (state.settings.sound)
    playSound(state.settings.melody, state.settings.volume);
});
setInterval(renderFooter, 1000);
shell();

const { randomUUID } = require("node:crypto");
const { isIP } = require("node:net");

const defaults = {
  interval: 15,
  timeout: 3,
  confirmations: 2,
  concurrency: 12,
  firstAlert: true,
  lossAlert: false,
  desktop: true,
  telegram: false,
  chatId: "",
  theme: "dark",
  language: "ru",
  resume: true,
  sound: true,
  volume: 80,
  melody: 1,
};
function host(value) {
  const s = String(value || "").trim();
  if (isIP(s)) return s;
  if (
    s.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      s,
    )
  )
    return s.toLowerCase();
  throw Error("Введите IP-адрес или доменное имя без пробелов и протокола.");
}
function cleanMonitor(input) {
  const type = ["ping", "tcp", "http", "ssh"].includes(input.type)
    ? input.type
    : "ping";
  let address = String(input.address || "").trim();
  if (type === "http") {
    let u;
    try {
      u = new URL(address);
    } catch {
      throw Error("Укажите полный адрес сайта: https://example.com");
    }
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      !u.hostname
    )
      throw Error("Нужен HTTP/HTTPS-адрес без логина и пароля.");
    u.hash = "";
    address = u.href;
  } else address = host(address);
  const port = Number(input.port ?? (type === "ssh" ? 22 : 443));
  if (
    ["tcp", "ssh"].includes(type) &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw Error("Порт должен быть от 1 до 65535.");
  return {
    id:
      typeof input.id === "string" && /^[a-zA-Z0-9-]{1,60}$/.test(input.id)
        ? input.id
        : randomUUID(),
    name:
      String(input.name || address)
        .trim()
        .slice(0, 100) || address,
    address,
    type,
    port,
    group:
      String(input.group || "Без группы")
        .trim()
        .slice(0, 60) || "Без группы",
    enabled: input.enabled !== false,
  };
}
function cleanSettings(input) {
  const result = { ...defaults };
  for (const [key, min, max] of [
    ["interval", 5, 3600],
    ["timeout", 1, 30],
    ["confirmations", 1, 5],
    ["concurrency", 1, 32],
    ["volume", 0, 100],
    ["melody", 1, 20],
  ]) {
    const n = Number(input[key] ?? defaults[key]);
    if (!Number.isInteger(n) || n < min || n > max)
      throw Error(`${key}: допустимо от ${min} до ${max}.`);
    result[key] = n;
  }
  for (const key of [
    "firstAlert",
    "lossAlert",
    "desktop",
    "telegram",
    "resume",
    "sound",
  ])
    result[key] = input[key] == null ? defaults[key] : Boolean(input[key]);
  result.theme = input.theme === "light" ? "light" : "dark";
  result.language = input.language === "en" ? "en" : "ru";
  result.chatId = String(input.chatId || "").trim();
  if (result.chatId && !/^-?\d{1,20}$/.test(result.chatId))
    throw Error(
      "Chat ID должен быть числом. Для группы он может начинаться с минуса.",
    );
  return result;
}
function freshState() {
  return {
    status: "unknown",
    streak: 0,
    lastOk: null,
    total: 0,
    passed: 0,
    history: [],
    checkedAt: null,
    seenAt: null,
    changedAt: null,
    latency: null,
    detail: "",
  };
}
function applyResult(state, result, settings, now = Date.now()) {
  const previous = state.status;
  state.streak = state.lastOk === result.ok ? state.streak + 1 : 1;
  state.lastOk = result.ok;
  state.checkedAt = now;
  state.total++;
  if (result.ok) {
    state.passed++;
    state.seenAt = now;
  }
  state.latency = result.ok ? result.latency : null;
  state.detail = result.detail;
  state.history.push({ at: now, ok: result.ok, ms: state.latency });
  if (state.history.length > 120) state.history.shift();
  if (state.streak < settings.confirmations) return null;
  state.status = result.ok ? "up" : "down";
  if (state.status === previous) return null;
  state.changedAt = now;
  return {
    kind: result.ok
      ? previous === "up"
        ? null
        : previous === "unknown"
          ? "first"
          : "recovered"
      : previous === "up"
        ? "lost"
        : "unreachable",
    at: now,
  };
}
async function pool(items, limit, worker) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) await worker(items[cursor++]);
    }),
  );
}
function parseImport(text) {
  if (text.trim().startsWith("[") || text.trim().startsWith("{")) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.monitors;
    if (!Array.isArray(list)) throw Error("В JSON нужен массив monitors.");
    return list.map((row) => cleanMonitor({ ...row, id: undefined }));
  }
  return text
    .split(/\r?\n/)
    .filter((s) => s.trim() && !s.trim().startsWith("#"))
    .map((line) => {
      const [address, name, group] = line.split(";").map((s) => s.trim());
      return cleanMonitor({
        address,
        name,
        group,
        type: /^https?:\/\//i.test(address) ? "http" : "ping",
      });
    });
}
function shouldAlert(event, settings) {
  return (
    event.kind === "recovered" ||
    (event.kind === "first" && settings.firstAlert) ||
    (event.kind === "lost" && settings.lossAlert)
  );
}
module.exports = {
  defaults,
  host,
  cleanMonitor,
  cleanSettings,
  freshState,
  applyResult,
  pool,
  parseImport,
  shouldAlert,
};

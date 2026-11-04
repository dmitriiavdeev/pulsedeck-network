const fs = require("node:fs");
const path = require("node:path");
const {
  defaults,
  cleanMonitor,
  cleanSettings,
  freshState,
} = require("./core.cjs");
function emptyData() {
  return {
    version: 1,
    monitors: [],
    states: {},
    events: [],
    pending: [],
    settings: { ...defaults },
    secret: "",
    wanted: false,
  };
}
class Storage {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "pulsedeck.json");
  }
  load() {
    if (!fs.existsSync(this.file)) return emptyData();
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      throw Error(
        "Не удалось прочитать настройки. Исходный файл сохранён. Проверьте pulsedeck.json в папке данных приложения.",
      );
    }
    const data = emptyData();
    data.monitors = (raw.monitors || []).map(cleanMonitor);
    if (new Set(data.monitors.map((m) => m.id)).size !== data.monitors.length)
      throw Error("В файле настроек повторяются идентификаторы серверов.");
    data.settings = cleanSettings(raw.settings || {});
    data.secret = typeof raw.secret === "string" ? raw.secret : "";
    data.wanted = Boolean(raw.wanted);
    data.events = Array.isArray(raw.events) ? raw.events.slice(0, 1000) : [];
    data.pending = Array.isArray(raw.pending) ? raw.pending.slice(0, 200) : [];
    for (const m of data.monitors) {
      const saved = raw.states?.[m.id];
      data.states[m.id] = {
        ...freshState(),
        ...(saved || {}),
        streak: 0,
        lastOk: null,
        history: Array.isArray(saved?.history) ? saved.history.slice(-120) : [],
      };
    }
    return data;
  }
  save(data) {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(data), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temp, this.file);
  }
}
module.exports = { Storage, emptyData };

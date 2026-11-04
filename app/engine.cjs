const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { freshState, applyResult, pool, shouldAlert } = require("./core.cjs");

class Engine extends EventEmitter {
  constructor(data, probe) {
    super();
    this.data = data;
    this.probe = probe;
    this.running = false;
    this.busy = false;
    this.epoch = 0;
    this.nextAt = null;
    this.duration = 0;
    this.completed = 0;
    for (const m of data.monitors) data.states[m.id] ||= freshState();
  }
  log(message, level = "info", monitorId = null, code = "", values = {}) {
    this.data.events.unshift({
      id: randomUUID(),
      at: Date.now(),
      message,
      level,
      monitorId,
      code,
      values,
    });
    this.data.events.length = Math.min(this.data.events.length, 1000);
    this.emit("change");
  }
  start() {
    if (this.running) return;
    if (!this.data.monitors.some((m) => m.enabled))
      throw Error("Сначала добавьте хотя бы один включённый адрес.");
    this.running = true;
    this.data.wanted = true;
    this.epoch++;
    for (const state of Object.values(this.data.states)) {
      state.streak = 0;
      state.lastOk = null;
    }
    this.log("Мониторинг запущен", "info", null, "started");
    this.emit("save");
    this.cycle(this.epoch);
  }
  stop(quiet = false) {
    this.running = false;
    this.data.wanted = false;
    this.epoch++;
    this.busy = false;
    this.nextAt = null;
    clearTimeout(this.timer);
    if (!quiet) this.log("Мониторинг приостановлен", "info", null, "stopped");
    this.emit("change");
    this.emit("save");
  }
  async cycle(epoch) {
    if (!this.running || epoch !== this.epoch) return;
    this.busy = true;
    this.completed = 0;
    const started = Date.now();
    this.emit("change");
    const alerts = [];
    const settings = { ...this.data.settings };
    const monitors = this.data.monitors.filter((m) => m.enabled);
    await pool(monitors, settings.concurrency, async (monitor) => {
      if (epoch !== this.epoch) return;
      let result;
      try {
        result = await this.probe(monitor, settings.timeout * 1000);
      } catch {
        result = { ok: false, latency: null, detail: "Проверка не выполнена" };
      }
      if (epoch !== this.epoch) return;
      const event = applyResult(this.data.states[monitor.id], result, settings);
      this.completed++;
      if (event) {
        const message = `${monitor.name}: ${event.kind === "lost" ? "связь пропала" : event.kind === "unreachable" ? "нет ответа" : event.kind === "recovered" ? "связь восстановлена" : "получен первый ответ"}`;
        this.log(
          message,
          result.ok ? "success" : "warning",
          monitor.id,
          monitor.type === "ssh" ? "ssh." + event.kind : event.kind,
          { name: monitor.name },
        );
        if (shouldAlert(event, settings))
          alerts.push({
            ...event,
            name: monitor.name,
            message,
            address: monitor.address,
            type: monitor.type,
            port: monitor.port,
            latency: result.latency,
          });
      }
      this.emit("change");
    });
    if (epoch !== this.epoch) return;
    this.duration = Date.now() - started;
    this.busy = false;
    this.nextAt = Date.now() + settings.interval * 1000;
    if (alerts.length) this.emit("alerts", alerts);
    this.emit("save");
    this.emit("change");
    this.timer = setTimeout(() => this.cycle(epoch), settings.interval * 1000);
  }
  replace(monitors, settings) {
    const wasRunning = this.running;
    if (wasRunning) this.stop(true);
    const old = new Map(this.data.monitors.map((m) => [m.id, m]));
    const states = {};
    for (const m of monitors) {
      const before = old.get(m.id);
      states[m.id] =
        before &&
        before.address === m.address &&
        before.port === m.port &&
        before.type === m.type
          ? this.data.states[m.id]
          : freshState();
    }
    this.data.monitors = monitors;
    this.data.settings = settings;
    this.data.states = states;
    this.emit("save");
    this.emit("change");
    if (wasRunning && monitors.some((m) => m.enabled)) this.start();
  }
  snapshot() {
    return {
      running: this.running,
      busy: this.busy,
      nextAt: this.nextAt,
      duration: this.duration,
      completed: this.completed,
      monitors: this.data.monitors.map((m) => ({
        ...m,
        ...this.data.states[m.id],
      })),
      settings: this.data.settings,
      events: this.data.events,
      pending: this.data.pending.length,
    };
  }
}
module.exports = { Engine };

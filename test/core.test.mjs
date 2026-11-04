import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const {
  defaults,
  cleanMonitor,
  cleanSettings,
  freshState,
  applyResult,
  shouldAlert,
  pool,
  parseImport,
} = require("../app/core.cjs");
const { Engine } = require("../app/engine.cjs");
const { Storage, emptyData } = require("../app/storage.cjs");
const ok = { ok: true, latency: 12, detail: "Success" },
  down = { ok: false, latency: null, detail: "TimedOut" };

test("confirm recovery and loss, suppress one-off failures and repeated up alerts", () => {
  const state = freshState();
  assert.equal(applyResult(state, down, defaults, 1), null);
  assert.equal(applyResult(state, down, defaults, 2).kind, "unreachable");
  assert.equal(applyResult(state, ok, defaults, 3), null);
  assert.equal(applyResult(state, ok, defaults, 4).kind, "recovered");
  assert.equal(applyResult(state, ok, defaults, 5), null);
  assert.equal(applyResult(state, down, defaults, 6), null);
  assert.equal(applyResult(state, ok, defaults, 7), null);
  assert.equal(state.status, "up");
  assert.equal(applyResult(state, down, defaults, 8), null);
  assert.equal(applyResult(state, down, defaults, 9).kind, "lost");
  assert.equal(state.total, 9);
  assert.equal(state.passed, 4);
});
test("first availability alerts are optional; initial failures never notify", () => {
  const state = freshState();
  applyResult(state, ok, defaults);
  const event = applyResult(state, ok, defaults);
  assert.equal(event.kind, "first");
  assert.equal(shouldAlert(event, defaults), true);
  assert.equal(shouldAlert(event, { ...defaults, firstAlert: false }), false);
  assert.equal(
    shouldAlert({ kind: "unreachable" }, { ...defaults, lossAlert: true }),
    false,
  );
  assert.equal(shouldAlert({ kind: "lost" }, defaults), false);
});
test("history has a bounded length while counters preserve all samples", () => {
  const state = freshState();
  for (let i = 0; i < 500; i++) applyResult(state, ok, defaults, i);
  assert.equal(state.history.length, 120);
  assert.equal(state.total, 500);
  assert.equal(state.passed, 500);
});
test("unlimited monitor list uses bounded worker concurrency", async () => {
  let active = 0,
    peak = 0,
    completed = 0;
  await pool(
    Array.from({ length: 1000 }, (_, i) => i),
    12,
    async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      completed++;
    },
  );
  assert.equal(completed, 1000);
  assert.equal(peak, 12);
  assert.equal(
    parseImport(
      Array.from({ length: 1000 }, (_, i) => `host-${i}.example.com`).join(
        "\n",
      ),
    ).length,
    1000,
  );
});
test("validate addresses without allowing shell arguments or URL credentials", () => {
  for (const address of [
    "127.0.0.1",
    "::1",
    "example.com",
    "host-2.example.com",
  ])
    assert.equal(cleanMonitor({ address }).address, address);
  for (const address of [
    "127.0.0.1 & calc",
    "-n 100",
    "https://example.com",
    "a\nb",
    "",
  ])
    assert.throws(() => cleanMonitor({ address }));
  for (const address of [
    "file:///etc/passwd",
    "https://user:secret@example.com",
  ])
    assert.throws(() => cleanMonitor({ type: "http", address }));
  assert.throws(() =>
    cleanMonitor({ type: "tcp", address: "localhost", port: 70000 }),
  );
  assert.equal(
    cleanMonitor({ type: "http", address: "https://example.com/#x" }).address,
    "https://example.com/",
  );
});
test("validate settings and retain separate notification switches", () => {
  const settings = cleanSettings({
    ...defaults,
    sound: false,
    desktop: false,
    telegram: true,
    chatId: "-10012345678",
    language: "en",
    volume: 100,
    melody: 20,
  });
  assert.equal(settings.sound, false);
  assert.equal(settings.desktop, false);
  assert.equal(settings.telegram, true);
  assert.equal(settings.language, "en");
  assert.throws(() => cleanSettings({ melody: 21 }));
  assert.throws(() => cleanSettings({ interval: 0 }));
  assert.throws(() => cleanSettings({ chatId: "not-a-chat" }));
});
test("import JSON strips untrusted metadata and assigns fresh identities", () => {
  const list = parseImport(
    JSON.stringify({
      monitors: [
        {
          id: "old",
          name: "Server",
          address: "::1",
          type: "tcp",
          port: 22,
          token: "secret",
        },
      ],
    }),
  );
  assert.notEqual(list[0].id, "old");
  assert.equal(list[0].token, undefined);
  assert.equal(list[0].port, 22);
  const lines = parseImport(
    "# comment\n192.0.2.1;One;Example\nhttps://example.com;Web;Example",
  );
  assert.equal(lines[1].type, "http");
  assert.equal(lines[0].group, "Example");
});
test("stopping a check cycle discards in-flight results and alerts", async () => {
  const data = emptyData();
  data.monitors = [cleanMonitor({ address: "localhost" })];
  let finish;
  const engine = new Engine(
    data,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let alerts = 0;
  engine.on("alerts", () => alerts++);
  engine.start();
  engine.stop();
  finish(ok);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(data.states[data.monitors[0].id].total, 0);
  assert.equal(alerts, 0);
  assert.equal(engine.running, false);
});
test("changing an address clears old history; renaming preserves it", async () => {
  const data = emptyData();
  const monitor = cleanMonitor({ address: "localhost" });
  data.monitors = [monitor];
  const engine = new Engine(data, async () => ok);
  applyResult(data.states[monitor.id], ok, defaults);
  engine.replace([{ ...monitor, name: "Changed" }], data.settings);
  assert.equal(data.states[monitor.id].total, 1);
  engine.replace([{ ...monitor, address: "127.0.0.1" }], data.settings);
  assert.equal(data.states[monitor.id].total, 0);
});
test("atomic settings round trip and corrupted data is preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pulsedeck-storage-"));
  try {
    const store = new Storage(directory),
      data = emptyData();
    data.monitors = [cleanMonitor({ address: "127.0.0.1" })];
    data.secret = "encrypted-test-value";
    store.save(data);
    assert.equal(store.load().monitors.length, 1);
    assert.equal(store.load().secret, data.secret);
    await writeFile(store.file, "broken");
    assert.throws(() => store.load());
    assert.equal(await readFile(store.file, "utf8"), "broken");
  } finally {
    await rm(directory, { recursive: true });
  }
});

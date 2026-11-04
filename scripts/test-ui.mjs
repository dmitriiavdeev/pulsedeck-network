import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import net from "node:net";
import { root, prepare } from "./prepare.mjs";
const require = createRequire(import.meta.url);
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error("Timed out waiting for the expected application state.");
}
await prepare();
const data = join(root, "test-results", "ui-" + Date.now());
await mkdir(data, { recursive: true });
const env = { ...process.env, PULSEDECK_TEST: "1", PULSEDECK_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: require("electron"),
  args: [join(root, "app")],
  env,
  timeout: 30000,
});
const errors = [];
try {
  const window = await application.firstWindow();
  window.on("pageerror", (error) => errors.push(error.message));
  window.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await window.waitForSelector('[data-action="add"]');
  await window.click('[data-action="add"]');
  assert.equal(
    await window.locator("#monitor-form input[name=type]").inputValue(),
    "ssh",
  );
  assert.equal(
    await window.locator("#monitor-form input[name=port]").inputValue(),
    "22",
  );
  await window.click("[data-monitor-type=ping]");
  await window.fill("#monitor-form input[name=address]", "127.0.0.1");
  await window.fill("#monitor-form input[name=name]", "Local loopback");
  await window.click("#monitor-form [type=submit]");
  await window.waitForSelector(".host-title");
  assert.equal(
    await window.locator(".host-title").innerText(),
    "Local loopback",
  );
  await window.click("[data-view=settings]");
  assert.equal(await window.locator("[name=autoStart]").isChecked(), false);
  await window.selectOption("[name=language]", "en");
  await window.selectOption("[name=theme]", "light");
  await window.locator("[name=desktop]").uncheck();
  await window.locator("[name=sound]").uncheck();
  await window.fill("[name=confirmations]", "1");
  await window.fill("[name=interval]", "5");
  await window.click("#settings-form [type=submit]");
  await window.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(await window.locator("h1").innerText(), "Make it yours");
  assert.equal(await window.locator("[name=melody] option").count(), 20);
  await window.selectOption("[name=melody]", "20");
  await window.locator("[name=volume]").fill("0");
  await window.click("[data-action=preview-sound]");
  await window.click("#settings-form [type=submit]");
  await window.click("[data-view=monitors]");
  await window.click("[data-action=start]");
  await until(() =>
    window.evaluate(
      async () => (await window.deck.snapshot()).monitors[0].status === "up",
    ),
  );
  await window.screenshot({ path: join(data, "live-light.png") });
  await window.click("[data-action=close-window]");
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await until(() =>
    window.evaluate(
      async () => (await window.deck.snapshot()).monitors[0].total >= 2,
    ),
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  await window.click("[data-action=stop]");
  await window.click("[data-view=tools]");
  const listener = net.createServer((socket) => socket.end());
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  try {
    await window.fill("[data-tool=tcp] input[name=address]", "127.0.0.1");
    await window.fill(
      "[data-tool=tcp] input[name=port]",
      String(listener.address().port),
    );
    await window.click("[data-tool=tcp] [type=submit]");
    await window.waitForSelector("#result-tcp .success");
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  await window.click("[data-view=settings]");
  await window.selectOption("[name=language]", "ru");
  await window.selectOption("[name=theme]", "dark");
  await window.click("#settings-form [type=submit]");
  await window.waitForFunction(() => document.documentElement.lang === "ru");
  assert.equal(await window.locator("h1").innerText(), "Как удобно вам");
  const fakeToken = "123456789:" + "x".repeat(35);
  await window.fill("[name=token]", fakeToken);
  await window.click("#settings-form [type=submit]");
  await until(() =>
    window.evaluate(async () => (await window.deck.snapshot()).hasToken),
  );
  const snapshot = await window.evaluate(() => window.deck.snapshot());
  assert.equal(snapshot.settings.sound, false);
  assert.equal(snapshot.settings.desktop, false);
  assert.equal(snapshot.settings.volume, 0);
  const cspViolations = await window.evaluate(() => ({
    node: typeof window.require,
    isolated: typeof window.process,
  }));
  assert.deepEqual(cspViolations, { node: "undefined", isolated: "undefined" });
  assert.equal(
    await window.locator("#app-updates h2").innerText(),
    "Обновления",
  );
  const sshSockets = new Set();
  let sshHealthy = false;
  const sshServer = net.createServer((socket) => {
    sshSockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sshSockets.delete(socket));
    socket.on("data", () => {
      if (sshHealthy) socket.end("SSH-2.0-UI_fixture\r\n");
    });
  });
  await new Promise((resolve) => sshServer.listen(0, "127.0.0.1", resolve));
  try {
    await window.click("[data-view=monitors]");
    await window.click("[data-action=add]");
    await window.fill("#monitor-form input[name=address]", "127.0.0.1");
    await window.fill("#monitor-form input[name=name]", "SSH fixture");
    await window.fill(
      "#monitor-form input[name=port]",
      String(sshServer.address().port),
    );
    await window.click("#monitor-form [type=submit]");
    await window.waitForSelector('.host-title:text-is("SSH fixture")');
    await window.click("[data-action=start]");
    await until(() =>
      window.evaluate(
        async () =>
          (await window.deck.snapshot()).monitors.find(
            (m) => m.name === "SSH fixture",
          )?.status === "down",
      ),
    );
    await until(async () =>
      /SSH не отвечает/.test(
        await window
          .locator("tr", {
            has: window.locator('.host-title:text-is("SSH fixture")'),
          })
          .innerText(),
      ),
    );
    assert.match(
      await window
        .locator("tr", {
          has: window.locator('.host-title:text-is("SSH fixture")'),
        })
        .innerText(),
      /SSH не отвечает/,
    );
    sshHealthy = true;
    await until(() =>
      window.evaluate(
        async () =>
          (await window.deck.snapshot()).monitors.find(
            (m) => m.name === "SSH fixture",
          )?.status === "up",
      ),
    );
    await until(async () =>
      /SSH отвечает/.test(
        await window
          .locator("tr", {
            has: window.locator('.host-title:text-is("SSH fixture")'),
          })
          .innerText(),
      ),
    );
    assert.match(
      await window
        .locator("tr", {
          has: window.locator('.host-title:text-is("SSH fixture")'),
        })
        .innerText(),
      /SSH отвечает/,
    );
    assert.ok(
      await window.evaluate(async () =>
        (await window.deck.snapshot()).events.some(
          (event) => event.code === "ssh.recovered",
        ),
      ),
    );
    await window.click("[data-action=stop]");
  } finally {
    for (const socket of sshSockets) socket.destroy();
    await new Promise((resolve) => sshServer.close(resolve));
  }
  assert.deepEqual(errors, []);
  console.log(
    "UI passed: add monitor, live ICMP, background checks after close, TCP tool, RU/EN, dark/light, 20 sounds, notification toggles, isolated renderer.",
  );
} catch (error) {
  const window = await application.firstWindow();
  await window.screenshot({ path: join(data, "failure.png") }).catch(() => {});
  console.error("Page errors:", errors);
  console.error(
    "Body:",
    (await window.locator("body").innerText()).slice(0, 1000),
  );
  throw error;
} finally {
  await application.close();
}
const saved = JSON.parse(await readFile(join(data, "pulsedeck.json"), "utf8"));
assert.equal(saved.monitors.length, 2);
assert.ok(saved.states[saved.monitors[0].id].total >= 2);
assert.ok(saved.secret);
assert.equal(
  JSON.stringify(saved).includes("123456789:" + "x".repeat(35)),
  false,
);
console.log("Settings and history persisted. Test profile: " + data);

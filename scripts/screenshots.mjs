import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, prepare } from "./prepare.mjs";
const require = createRequire(import.meta.url);
const { emptyData } = require("../app/storage.cjs");
const {
  cleanMonitor,
  freshState,
  applyResult,
  defaults,
} = require("../app/core.cjs");
await prepare();
const directory = join(root, "test-results", "screenshots-" + Date.now());
const output = join(root, "docs/screenshots");
await mkdir(directory, { recursive: true });
await mkdir(output, { recursive: true });
const data = emptyData();
data.settings.language = "en";
data.settings.sound = false;
data.settings.desktop = false;
const examples = [
  {
    name: "Gateway",
    address: "192.0.2.1",
    type: "ping",
    group: "Core network",
    base: 12,
  },
  {
    name: "Production API",
    address: "https://api.example.com/health",
    type: "http",
    group: "Production",
    base: 48,
  },
  {
    name: "Storefront",
    address: "https://shop.example.com",
    type: "http",
    group: "Production",
    base: 62,
  },
  {
    name: "Database",
    address: "192.0.2.24",
    type: "tcp",
    port: 5432,
    group: "Production",
    base: 17,
  },
  {
    name: "Backup storage",
    address: "192.0.2.40",
    type: "ping",
    group: "Storage",
    base: 31,
    down: true,
  },
  {
    name: "Staging SSH",
    address: "198.51.100.12",
    type: "tcp",
    port: 22,
    group: "Development",
    base: 22,
  },
  {
    name: "Documentation",
    address: "https://docs.example.com",
    type: "http",
    group: "Development",
    base: 39,
  },
];
const now = Date.now();
for (let i = 0; i < examples.length; i++) {
  const entry = examples[i],
    monitor = cleanMonitor(entry),
    state = freshState();
  for (let n = 0; n < 120; n++) {
    const ok = !(entry.down && n > 108) && !(i === 2 && n >= 103 && n <= 105);
    applyResult(
      state,
      {
        ok,
        latency: ok
          ? entry.base + Math.round(Math.sin(n * 1.3 + i) * 5 + 5)
          : null,
        detail:
          monitor.type === "http"
            ? "HTTP 200"
            : monitor.type === "tcp"
              ? `Порт ${monitor.port} открыт`
              : ok
                ? "Ответ ICMP"
                : "Нет ответа ICMP",
      },
      defaults,
      now - (119 - n) * 15000,
    );
  }
  data.monitors.push(monitor);
  data.states[monitor.id] = state;
}
data.events = [
  {
    id: "demo-1",
    at: now - 20000,
    message: "",
    level: "success",
    code: "recovered",
    values: { name: "Storefront" },
  },
  {
    id: "demo-2",
    at: now - 160000,
    message: "",
    level: "warning",
    code: "lost",
    values: { name: "Backup storage" },
  },
  {
    id: "demo-3",
    at: now - 360000,
    message: "",
    level: "info",
    code: "started",
    values: {},
  },
];
await writeFile(join(directory, "pulsedeck.json"), JSON.stringify(data));
const env = {
  ...process.env,
  PULSEDECK_TEST: "1",
  PULSEDECK_TEST_DATA: directory,
};
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: require("electron"),
  args: [join(root, "app")],
  env,
});
try {
  const window = await application.firstWindow();
  await window.waitForSelector(".host-title");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 1020),
  );
  await window.screenshot({ path: join(output, "overview-en.png") });
  await window.click("[data-view=tools]");
  await window.screenshot({ path: join(output, "tools-en.png") });
  await window.click("[data-view=settings]");
  await window.selectOption("[name=language]", "ru");
  await window.selectOption("[name=theme]", "light");
  await window.click("#settings-form [type=submit]");
  await window.waitForFunction(() => document.documentElement.lang === "ru");
  await window.waitForSelector("#toast:not(.visible)");
  await window.click("[data-view=monitors]");
  await window.screenshot({ path: join(output, "overview-ru.png") });
  await window.click("[data-view=settings]");
  await window.selectOption("[name=theme]", "dark");
  await window.click("#settings-form [type=submit]");
  await window.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await window.waitForSelector("#toast:not(.visible)");
  await window.locator(".main").evaluate((el) => (el.scrollTop = 0));
  await window.screenshot({ path: join(output, "settings-ru.png") });
  console.log(
    "Captured real application windows with documentation-only example data.",
  );
} finally {
  await application.close();
}

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  dialog,
  shell,
  safeStorage,
  powerMonitor,
} = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { cleanMonitor, cleanSettings, parseImport } = require("./core.cjs");
const { Engine } = require("./engine.cjs");
const { Storage } = require("./storage.cjs");
const probes = require("./probes.cjs");
const telegram = require("./telegram.cjs");
const { t, errorText } = require("./locale.cjs");

const testing = process.env.PULSEDECK_TEST === "1";
const profile =
  testing && process.env.PULSEDECK_TEST_DATA
    ? process.env.PULSEDECK_TEST_DATA
    : join(app.getPath("appData"), "PulseDeck");
app.setName("PulseDeck");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppUserModelId("io.github.dmitriiavdeev.pulsedeck");
const page = pathToFileURL(join(__dirname, "ui/index.html")).href;
const icon = join(__dirname, "assets/icon.png");
const helper = app.isPackaged
  ? join(process.resourcesPath, "app.asar.unpacked/native/PingProbe.exe")
  : join(__dirname, "native/PingProbe.exe");
let main,
  tray,
  engine,
  storage,
  token = "",
  quitting = false,
  saveTimer,
  updateTimer,
  deliveryTimer,
  sending = false,
  resumed = false;
let startupWarning = "";
const tr = (key, values) =>
  t(
    engine?.data.settings.language ||
      (app.getLocale().startsWith("ru") ? "ru" : "en"),
    key,
    values,
  );
function trayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr("trayOpen"), click: show },
      {
        label: tr("trayToggle"),
        click: () => {
          try {
            engine.running ? engine.stop() : engine.start();
          } catch {
            show();
          }
        },
      },
      { type: "separator" },
      {
        label: tr("trayQuit"),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function show() {
  if (main) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
}
function snapshot() {
  return {
    ...engine.snapshot(),
    hasToken: Boolean(token),
    autoStart: testing
      ? false
      : app.getLoginItemSettings({
          path: app.getPath("exe"),
          args: ["--background"],
        }).openAtLogin,
    version: app.getVersion(),
    warning: startupWarning,
  };
}
function update() {
  if (!updateTimer)
    updateTimer = setTimeout(() => {
      updateTimer = null;
      if (main && !main.isDestroyed())
        main.webContents.send("pulsedeck:update", snapshot());
    }, 200);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      storage.save(engine.data);
    } catch {
      engine.log(
        "Не удалось сохранить настройки на диск.",
        "error",
        null,
        "saveFailed",
      );
    }
  }, 300);
}
function register(name, handler) {
  ipcMain.handle("pulsedeck:" + name, async (event, data) => {
    if (
      event.sender !== main.webContents ||
      event.senderFrame !== main.webContents.mainFrame ||
      event.senderFrame.url !== page
    )
      return { ok: false, error: "Запрос отклонён." };
    try {
      return { ok: true, value: await handler(data) };
    } catch (e) {
      return {
        ok: false,
        error: errorText(e.message, engine.data.settings.language),
      };
    }
  });
}
function notification(alerts) {
  const settings = engine.data.settings;
  const message = (a) => tr("event." + a.kind, { name: a.name });
  if (settings.sound) main.webContents.send("pulsedeck:alert");
  if (settings.desktop && Notification.isSupported()) {
    try {
      const n = new Notification({
        title: tr("alertTitle"),
        body:
          alerts.slice(0, 3).map(message).join("\n") +
          (alerts.length > 3
            ? "\n" + tr("alertMore", { count: alerts.length - 3 })
            : ""),
        icon,
        silent: true,
      });
      n.on("click", show);
      n.show();
    } catch {
      /* A disabled Windows notification service must not stop checks. */
    }
  }
  if (settings.telegram && token && settings.chatId) {
    let text = tr("alertTelegram") + "\n";
    const enqueue = () =>
      engine.data.pending.push({
        id: randomUUID(),
        text,
        tries: 0,
        nextAt: 0,
        at: Date.now(),
      });
    for (const a of alerts) {
      const line = `\n${message(a)}\n${a.address}${a.type === "tcp" ? ":" + a.port : ""} · ${a.type.toUpperCase()}${a.latency != null ? " · " + a.latency + " " + tr("ms") : ""}\n${new Date(a.at).toLocaleString(settings.language === "ru" ? "ru-RU" : "en-GB")}\n`;
      if (text.length + line.length > 3500) {
        enqueue();
        text = tr("alertTelegram") + "\n";
      }
      text += line;
    }
    enqueue();
    if (engine.data.pending.length > 200) {
      engine.data.pending.splice(0, engine.data.pending.length - 200);
      engine.log("Очередь Telegram переполнена.", "warning", null, "queueFull");
    }
    save();
    update();
    deliver();
  }
}
async function deliver() {
  if (
    sending ||
    !engine ||
    !token ||
    !engine.data.settings.telegram ||
    !engine.data.settings.chatId
  )
    return;
  const entry = engine.data.pending[0];
  if (!entry || entry.nextAt > Date.now()) return;
  sending = true;
  try {
    await telegram.send(token, engine.data.settings.chatId, entry.text);
    engine.data.pending = engine.data.pending.filter((e) => e.id !== entry.id);
    engine.log(
      "Уведомление доставлено в Telegram",
      "success",
      null,
      "delivered",
    );
  } catch (e) {
    entry.tries++;
    entry.nextAt =
      Date.now() + Math.min(300000, 15000 * 2 ** Math.min(entry.tries - 1, 5));
    if (entry.tries === 1 || entry.tries % 5 === 0)
      engine.log(e.message, "warning", null, "retry", {
        message: errorText(e.message, engine.data.settings.language),
      });
  } finally {
    sending = false;
    save();
    update();
  }
}
function addMany(text) {
  const incoming = parseImport(text);
  const keys = new Set(
    engine.data.monitors.map((m) => `${m.type}|${m.address}|${m.port}`),
  );
  const added = [];
  for (const row of incoming) {
    const key = `${row.type}|${row.address}|${row.port}`;
    if (!keys.has(key)) {
      keys.add(key);
      added.push(row);
    }
  }
  engine.replace([...engine.data.monitors, ...added], engine.data.settings);
  engine.log(
    `Импортировано адресов: ${added.length}.`,
    "info",
    null,
    "imported",
    { added: added.length, skipped: incoming.length - added.length },
  );
  return { added: added.length, skipped: incoming.length - added.length };
}
function bind() {
  register("snapshot", snapshot);
  register("start", () => {
    engine.start();
    return snapshot();
  });
  register("stop", () => {
    engine.stop();
    return snapshot();
  });
  register("upsert", (input) => {
    const m = cleanMonitor(input);
    const list = [...engine.data.monitors];
    const index = list.findIndex((row) => row.id === m.id);
    if (index < 0) list.push(m);
    else list[index] = m;
    engine.replace(list, engine.data.settings);
    return snapshot();
  });
  register("remove", (id) => {
    engine.replace(
      engine.data.monitors.filter((row) => row.id !== id),
      engine.data.settings,
    );
    return snapshot();
  });
  register("importText", (text) => addMany(String(text)));
  register("importFile", async () => {
    const choice = await dialog.showOpenDialog(main, {
      title: tr("import"),
      filters: [
        { name: "JSON / TXT / CSV", extensions: ["json", "txt", "csv"] },
      ],
      properties: ["openFile"],
    });
    if (choice.canceled) return null;
    if (fs.statSync(choice.filePaths[0]).size > 20 * 1024 * 1024)
      throw Error("Файл больше 20 МБ. Разделите список на несколько файлов.");
    return addMany(
      fs.readFileSync(choice.filePaths[0], "utf8").replace(/^\uFEFF/, ""),
    );
  });
  register("exportList", async () => {
    const choice = await dialog.showSaveDialog(main, {
      defaultPath: "pulsedeck-monitors.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!choice.canceled)
      fs.writeFileSync(
        choice.filePath,
        JSON.stringify(
          {
            version: 1,
            monitors: engine.data.monitors.map(({ id, ...m }) => m),
          },
          null,
          2,
        ),
      );
    return !choice.canceled;
  });
  register("exportEvents", async () => {
    const choice = await dialog.showSaveDialog(main, {
      defaultPath: "pulsedeck-events.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    const cell = (v) =>
      '"' +
      String(v)
        .replace(/^[=+\-@]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    if (!choice.canceled)
      fs.writeFileSync(
        choice.filePath,
        "\uFEFFВремя;Уровень;Событие\r\n" +
          engine.data.events
            .map((e) =>
              [new Date(e.at).toISOString(), e.level, e.message]
                .map(cell)
                .join(";"),
            )
            .join("\r\n"),
      );
    return !choice.canceled;
  });
  register("settings", async (input) => {
    const settings = cleanSettings(input);
    let newToken = token;
    if (input.clearToken) newToken = "";
    if (input.token?.trim())
      newToken = telegram.validateToken(input.token.trim());
    if (settings.telegram && (!newToken || !settings.chatId))
      throw Error("Для Telegram нужны токен бота и chat ID.");
    if (newToken && !safeStorage.isEncryptionAvailable())
      throw Error("Windows не предоставила защиту для токена.");
    const encrypted = newToken
      ? safeStorage.encryptString(newToken).toString("base64")
      : "";
    if (newToken !== token || settings.chatId !== engine.data.settings.chatId)
      engine.data.pending = [];
    token = newToken;
    engine.data.secret = encrypted;
    if (!testing)
      app.setLoginItemSettings({
        openAtLogin: Boolean(input.autoStart),
        path: app.getPath("exe"),
        args: ["--background"],
        name: "io.github.dmitriiavdeev.pulsedeck",
      });
    engine.replace(engine.data.monitors, settings);
    storage.save(engine.data);
    trayMenu();
    return snapshot();
  });
  register("findChats", async (value) =>
    telegram.chats(value?.trim() || token),
  );
  register("testTelegram", async (input) => {
    const chatId = String(input.chatId || "").trim();
    if (!/^-?\d{1,20}$/.test(chatId)) throw Error("Укажите chat ID.");
    await telegram.send(
      input.token?.trim() || token,
      chatId,
      tr("testMessage"),
    );
    return true;
  });
  register("diagnose", async (input) => {
    if (input.type === "dns") return probes.lookup(input.address);
    if (input.type === "tls") return probes.certificate(input.address);
    if (input.type === "tcp") {
      const m = cleanMonitor({
        type: "tcp",
        address: input.address,
        port: input.port,
      });
      return probes.tcp(m.address, m.port, 5000);
    }
    throw Error("Неизвестный инструмент.");
  });
  register("window", (action) => {
    if (action === "minimize") main.minimize();
    else if (action === "maximize")
      main.isMaximized() ? main.unmaximize() : main.maximize();
    else if (action === "close") main.close();
  });
  register("link", (key) => {
    const urls = {
      github: "https://github.com/dmitriiavdeev/pulsedeck-network",
      releases: "https://github.com/dmitriiavdeev/pulsedeck-network/releases",
      botfather: "https://t.me/BotFather",
    };
    if (urls[key]) return shell.openExternal(urls[key]);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_, argv) => {
    if (argv.includes("--quit-for-update")) {
      quitting = true;
      app.quit();
    } else show();
  });
  app
    .whenReady()
    .then(() => {
      if (process.argv.includes("--quit-for-update")) {
        quitting = true;
        return app.quit();
      }
      Menu.setApplicationMenu(null);
      storage = new Storage(profile);
      let data;
      try {
        data = storage.load();
        if (!fs.existsSync(storage.file)) {
          const languageArg = process.argv.find((v) =>
            /^--language=(ru|en)$/.test(v),
          );
          data.settings.language = languageArg
            ? languageArg.split("=")[1]
            : app.getLocale().startsWith("ru")
              ? "ru"
              : "en";
        }
      } catch (e) {
        dialog.showErrorBox(
          "PulseDeck",
          errorText(e.message, app.getLocale().startsWith("ru") ? "ru" : "en"),
        );
        quitting = true;
        return app.quit();
      }
      if (data.secret) {
        try {
          token = safeStorage.decryptString(Buffer.from(data.secret, "base64"));
        } catch {
          startupWarning =
            "Не удалось расшифровать токен Telegram. Укажите его снова в настройках.";
          data.settings.telegram = false;
        }
      }
      engine = new Engine(data, (m, timeout) =>
        probes.probe(m, timeout, helper),
      );
      engine.on("change", update);
      engine.on("save", save);
      engine.on("alerts", notification);
      main = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 980,
        minHeight: 680,
        title: "PulseDeck",
        frame: false,
        backgroundColor: "#101714",
        icon,
        show: false,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      main.webContents.on("will-navigate", (event) => event.preventDefault());
      main.webContents.session.setPermissionRequestHandler((_, __, callback) =>
        callback(false),
      );
      main.webContents.session.setPermissionCheckHandler(() => false);
      main.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      main.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          main.hide();
          if (!resumed && engine.data.settings.desktop) {
            tray.displayBalloon({
              title: tr("trayTitle"),
              content: tr("trayText"),
              noSound: true,
            });
            resumed = true;
          }
        }
      });
      main.once("ready-to-show", () => {
        if (!process.argv.includes("--background") || !data.monitors.length)
          show();
      });
      bind();
      main.webContents.once("did-finish-load", () => {
        if (
          !testing &&
          data.wanted &&
          data.settings.resume &&
          data.monitors.some((m) => m.enabled)
        )
          engine.start();
      });
      main.loadFile(join(__dirname, "ui/index.html"));
      tray = new Tray(icon);
      tray.setToolTip("PulseDeck · Network Tools");
      tray.on("double-click", show);
      tray.on("click", show);
      trayMenu();
      powerMonitor.on("suspend", () => {
        const wanted = engine.running;
        engine.stop(true);
        engine.data.wanted = wanted;
        engine.log("Сон компьютера", "info", null, "sleep");
      });
      powerMonitor.on("resume", () => {
        if (engine.data.wanted) {
          engine.log("Компьютер проснулся", "info", null, "wake");
          engine.start();
        }
      });
      deliveryTimer = setInterval(deliver, 2000);
    })
    .catch(() => {
      dialog.showErrorBox(
        "PulseDeck",
        app.getLocale().startsWith("ru")
          ? "Не удалось запустить приложение. Попробуйте переустановить PulseDeck."
          : "Could not start the application. Try reinstalling PulseDeck.",
      );
      quitting = true;
      app.quit();
    });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(deliveryTimer);
    clearTimeout(saveTimer);
    clearTimeout(updateTimer);
    if (engine) {
      const wanted = engine.running || engine.data.wanted;
      engine.stop(true);
      engine.data.wanted = wanted;
      clearTimeout(saveTimer);
      clearTimeout(updateTimer);
      try {
        storage.save(engine.data);
      } catch {}
    }
    tray?.destroy();
  });
}

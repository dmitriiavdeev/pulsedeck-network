const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "snapshot",
  "start",
  "stop",
  "upsert",
  "remove",
  "importText",
  "importFile",
  "exportList",
  "exportEvents",
  "settings",
  "findChats",
  "testTelegram",
  "diagnose",
  "window",
  "link",
  "checkUpdate",
  "downloadUpdate",
  "applyUpdate",
];
const api = Object.fromEntries(
  methods.map((method) => [
    method,
    async (data) => {
      const result = await ipcRenderer.invoke("pulsedeck:" + method, data);
      if (!result.ok) throw Error(result.error);
      return result.value;
    },
  ]),
);
api.onUpdate = (callback) => {
  const listener = (_, value) => callback(value);
  ipcRenderer.on("pulsedeck:update", listener);
  return () => ipcRenderer.removeListener("pulsedeck:update", listener);
};
api.onAlert = (callback) => {
  const listener = () => callback();
  ipcRenderer.on("pulsedeck:alert", listener);
  return () => ipcRenderer.removeListener("pulsedeck:alert", listener);
};
contextBridge.exposeInMainWorld("deck", api);

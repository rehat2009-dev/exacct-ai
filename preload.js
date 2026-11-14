const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exacct", {
  get: () => ipcRenderer.invoke("cfg:get"),
  set: patch => ipcRenderer.invoke("cfg:set", patch),
  reset: () => ipcRenderer.invoke("cfg:reset"),
  pickIcon: () => ipcRenderer.invoke("icon:pick"),
  win: act => ipcRenderer.send("win", act),
  onCfg: fn => ipcRenderer.on("cfg", (_e, c) => fn(c)),
  onNav: fn => ipcRenderer.on("nav", (_e, n) => fn(n))
});

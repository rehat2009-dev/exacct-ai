const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = ["state", "nav", "loading", "history", "toast", "drawer", "cols"];
contextBridge.exposeInMainWorld("exacct", {
  call: (ch, ...args) => ipcRenderer.invoke("x", ch, ...args),
  on: (ch, fn) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); }
});

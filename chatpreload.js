// Lets the Expecct chat page talk to the app: log in with the browser, open an AI, ask an AI.
const { contextBridge, ipcRenderer } = require("electron");
let token = null, listener = null;
ipcRenderer.on("puter-token", (_e, t) => { if (listener) listener(t); else token = t; });
contextBridge.exposeInMainWorld("expecctDesktop", {
  login: () => ipcRenderer.invoke("xc", "login"),
  open: ai => ipcRenderer.invoke("xc", "open", ai),
  ask: (ai, text) => ipcRenderer.invoke("xc", "ask", ai, text),
  version: () => ipcRenderer.invoke("xc", "version"),
  onToken: fn => { listener = fn; if (token) { const t = token; token = null; fn(t); } }
});

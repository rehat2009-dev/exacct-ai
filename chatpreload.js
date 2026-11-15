// Lets the Expecct chat and agent pages talk to the app.
const { contextBridge, ipcRenderer } = require("electron");
let token = null, listener = null;
ipcRenderer.on("puter-token", (_e, t) => { if (listener) listener(t); else token = t; });
const call = (ch, ...a) => ipcRenderer.invoke("xc", ch, ...a);
contextBridge.exposeInMainWorld("expecctDesktop", {
  login: () => call("login"),
  loginIn: id => call("loginIn", id),
  copyLogin: () => call("copyLogin"),
  open: ai => call("open", ai),
  ask: (ai, text) => call("ask", ai, text),
  version: () => call("version"),
  onToken: fn => { listener = fn; if (token) { const t = token; token = null; fn(t); } },
  // the agent: works on files in your project folder and runs commands (only on the Agent page)
  agent: {
    info: () => call("agentInfo"),
    pickFolder: () => call("pickFolder"),
    tool: (name, args) => call("tool", name, args),
    stop: () => call("agentStop"),
    undo: () => call("agentUndo"),
    setAutoRun: on => call("setAutoRun", !!on),
    listFiles: () => call("listFiles"),
    notes: () => call("notes"),
    pickFiles: () => call("pickFiles"),
    git: (action, arg) => call("git", action, arg)
  }
});

// Exacct AI 2 - your AI in its own window
const { app, BrowserWindow, WebContentsView, ipcMain, screen, Tray, Menu, nativeImage,
        globalShortcut, shell, dialog, session, clipboard, net, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const pkg = require("./package.json");

const AIS = {
  chatgpt: { label: "ChatGPT", color: "#10a37f", url: "https://chatgpt.com/", hosts: ["chatgpt.com", "openai.com"], chat: /^\/c\/[\w-]+/ },
  claude:  { label: "Claude",  color: "#d97757", url: "https://claude.ai/new", hosts: ["claude.ai", "anthropic.com"], chat: /^\/chat\/[\w-]+/ },
  gemini:  { label: "Gemini",  color: "#4f8cff", url: "https://gemini.google.com/app", hosts: ["gemini.google.com"], chat: /^\/app\/\w+/ }
};
const AI_KEYS = Object.keys(AIS);
const TOP = 52, DRAWER = 372, COLH = 30, ASKH = 54;
const SITE = "https://rehat2009-dev.github.io/exacct-ai/";
const HOTKEY = "CommandOrControl+Shift+Space";
const isMac = process.platform === "darwin";
const FIXED = { mini: [380, 580], small: [460, 700], medium: [860, 760], large: [1200, 860], xl: [1500, 960] };
const SIZE_NAMES = { mini: "Mini", small: "Small", medium: "Medium", large: "Large", xl: "Extra large", focus: "Focus", tall: "Tall side", left: "Left half", right: "Right half", left3: "Left third", right3: "Right third", top: "Top half", bottom: "Bottom half", full: "Full screen", custom: "Custom" };

const defaultAi = AIS[pkg.exacctAi] ? pkg.exacctAi : "chatgpt";
const DEFAULTS = {
  ai: defaultAi, name: "Exacct AI",
  size: "medium", position: "center", x: null, y: null, width: 860, height: 760,
  alwaysOnTop: false, opacity: 100, zoom: 100,
  accent: "#8b5cf6", theme: "aurora", icon: null,
  hotkey: true, startup: false, closeToTray: false, resume: true, keepSignedIn: true,
  welcomed: false, mini: null, lastUrl: {},
  split: 1, ai2: null, goal: 0, goalDay: "", autoHide: false
};
const DEFAULT_PROMPTS = [
  { id: "p1", title: "Explain simply", text: "Explain this in simple words, like I'm 12:\n\n" },
  { id: "p2", title: "Fix my text", text: "Fix the spelling and grammar in this text and keep my style:\n\n" },
  { id: "p3", title: "Summarize", text: "Summarize this in 5 short bullet points:\n\n" },
  { id: "p4", title: "Translate to Norwegian", text: "Translate this to Norwegian:\n\n" },
  { id: "p5", title: "Give me ideas", text: "Give me 10 creative ideas for:\n\n" },
  { id: "p6", title: "Write code", text: "Write clean code with short comments that does this:\n\n" }
];

// ---------- storage ----------
const file = n => path.join(app.getPath("userData"), n);
function readJson(n, fallback) { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return fallback; } }
function writeJson(n, v) { try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(v)); } catch (e) { console.error(e); } }
let cfg = { ...DEFAULTS };
let data = { history: [], stats: {}, prompts: DEFAULT_PROMPTS };
const timers = {};
const later = (k, fn, ms) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms || 500); };
const saveCfg = () => later("cfg", () => writeJson("settings.json", cfg));
const saveData = () => later("data", () => writeJson("data.json", data));

// ---------- state ----------
let win, tray;
const views = {};
const ui = { drawer: false, welcome: false, ask: false };
let placing = false, focused = null, update = null, dialogOpen = false;

const UA = () => app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\sexacct-ai\/\S+/i, "");
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
const toast = t => send("toast", t);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const dayKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const onHost = (ai, url) => { try { const h = new URL(url).hostname; return AIS[ai].hosts.some(d => h === d || h.endsWith("." + d)); } catch { return false; } };

function publicState() {
  return {
    cfg, isMac, hotkeyLabel: isMac ? "⌘ ⇧ Space" : "Ctrl + Shift + Space",
    ais: AI_KEYS.map(k => ({ id: k, label: AIS[k].label, color: AIS[k].color })),
    sizeNames: SIZE_NAMES, history: data.history, stats: data.stats, prompts: data.prompts,
    focused: focused || cfg.ai, cols: visibleAIs(), update
  };
}

function iconImage(size) {
  let img = cfg.icon ? nativeImage.createFromDataURL(cfg.icon) : nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  return img.resize({ width: size, height: size, quality: "best" });
}

// ---------- window layout ----------
function visibleAIs() {
  if (cfg.split >= 3) return AI_KEYS.slice();
  if (cfg.split === 2) {
    let b = cfg.ai2;
    if (!AIS[b] || b === cfg.ai) b = AI_KEYS.find(k => k !== cfg.ai);
    return [cfg.ai, b];
  }
  return [cfg.ai];
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const drawerW = ui.drawer ? (w < 760 ? w : DRAWER) : 0;
  const list = visibleAIs();
  list.forEach(k => getView(k));
  const head = TOP + (ui.ask ? ASKH : 0);
  const top = head + (list.length > 1 ? COLH : 0);
  const avail = Math.max(0, w - drawerW), n = list.length;
  const colW = Math.floor((avail - (n - 1)) / n);
  const cols = [];
  for (const k of AI_KEYS) {
    const v = views[k];
    if (!v) continue;
    const i = list.indexOf(k);
    const show = !ui.welcome && i > -1 && avail > 0;
    v.setVisible(show);
    if (show) {
      const x = i * (colW + 1), width = i === n - 1 ? avail - x : colW;
      v.setBounds({ x, y: top, width, height: Math.max(0, h - top) });
      cols.push({ ai: k, x, width });
    }
  }
  cols.sort((a, b) => a.x - b.x);
  send("cols", { cols, top: head, focused: focused || cfg.ai });
}

function presetBounds(size, wa) {
  const W = wa.width, H = wa.height, X = wa.x, Y = wa.y, r = Math.round;
  switch (size) {
    case "left": return { x: X, y: Y, width: r(W / 2), height: H };
    case "right": return { x: X + r(W / 2), y: Y, width: W - r(W / 2), height: H };
    case "left3": return { x: X, y: Y, width: r(W / 3), height: H };
    case "right3": return { x: X + W - r(W / 3), y: Y, width: r(W / 3), height: H };
    case "top": return { x: X, y: Y, width: W, height: r(H / 2) };
    case "bottom": return { x: X, y: Y + r(H / 2), width: W, height: H - r(H / 2) };
    case "tall": return { x: X + W - 520, y: Y, width: 520, height: H };
    case "focus": { const w = r(W * 0.7), h = r(H * 0.84); return { x: X + r((W - w) / 2), y: Y + r((H - h) / 2), width: w, height: h }; }
    case "full": return { x: X, y: Y, width: W, height: H };
  }
  return null;
}

function placeWindow() {
  if (!win) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  let b = presetBounds(cfg.size, wa);
  if (!b) {
    let [w, h] = FIXED[cfg.size] || [cfg.width, cfg.height];
    w = clamp(w, 360, wa.width); h = clamp(h, 420, wa.height);
    const visible = cfg.x != null && screen.getAllDisplays().some(d => {
      const a = d.workArea; return cfg.x + 60 > a.x && cfg.x + 60 < a.x + a.width && cfg.y + 20 > a.y && cfg.y + 20 < a.y + a.height;
    });
    if (cfg.position === "custom" && visible) b = { x: cfg.x, y: cfg.y, width: w, height: h };
    else {
      const m = 16, p = cfg.position === "custom" ? "center" : cfg.position;
      const col = { tl: "l", ml: "l", bl: "l", tr: "r", mr: "r", br: "r" }[p] || "c";
      const row = { tl: "t", tc: "t", tr: "t", bl: "b", bc: "b", br: "b" }[p] || "m";
      const x = col === "l" ? wa.x + m : col === "r" ? wa.x + wa.width - w - m : wa.x + Math.round((wa.width - w) / 2);
      const y = row === "t" ? wa.y + m : row === "b" ? wa.y + wa.height - h - m : wa.y + Math.round((wa.height - h) / 2);
      b = { x, y, width: w, height: h };
    }
  }
  placing = true;
  if (win.isMaximized()) win.unmaximize();
  win.setBounds(b);
  later("placing", () => { placing = false; }, 800);
  layout();
}

function setZoom(z) {
  cfg.zoom = clamp(Math.round(z), 50, 200);
  for (const k of AI_KEYS) if (views[k]) views[k].webContents.setZoomFactor(cfg.zoom / 100);
  saveCfg(); send("state", publicState()); toast("Text size " + cfg.zoom + "%");
}

function applySettings(opts) {
  if (!win) return;
  win.setTitle(cfg.name);
  win.setAlwaysOnTop(!!cfg.alwaysOnTop, "floating");
  win.setOpacity(clamp(cfg.opacity, 40, 100) / 100);
  if (!isMac) win.setIcon(iconImage(256));
  if (isMac && app.dock) app.dock.setIcon(iconImage(512));
  if (tray) { tray.setImage(iconImage(isMac ? 18 : 16)); tray.setToolTip(cfg.name); buildTray(); }
  globalShortcut.unregisterAll();
  if (cfg.hotkey) globalShortcut.register(HOTKEY, toggleWindow);
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.startup }); } catch {}
  if (opts && opts.place) placeWindow();
  send("state", publicState());
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide(); else { win.show(); win.focus(); }
}

function toggleMini() {
  if (cfg.mini) { Object.assign(cfg, cfg.mini); cfg.mini = null; }
  else {
    cfg.mini = { size: cfg.size, position: cfg.position, x: cfg.x, y: cfg.y, width: cfg.width, height: cfg.height, alwaysOnTop: cfg.alwaysOnTop };
    cfg.size = "mini"; cfg.position = "br"; cfg.alwaysOnTop = true;
  }
  saveCfg(); applySettings({ place: true });
  toast(cfg.mini ? "Mini mode on" : "Mini mode off");
}

// ---------- AI views ----------
function record(ai, wc) {
  const url = wc.getURL();
  if (!onHost(ai, url)) return;
  cfg.lastUrl[ai] = url; saveCfg();
  let u; try { u = new URL(url); } catch { return; }
  if (!AIS[ai].chat.test(u.pathname)) return;
  let title = (wc.getTitle() || "").replace(/\s*[-|–]\s*(Claude|ChatGPT|Google Gemini|Gemini)\s*$/i, "").trim();
  if (!title || /^(ChatGPT|Claude|Gemini|Google Gemini|New chat)$/i.test(title)) title = null;
  const key = u.origin + u.pathname;
  let e = data.history.find(h => h.url === key);
  if (e) { data.history.splice(data.history.indexOf(e), 1); if (title) e.title = title; e.time = Date.now(); }
  else e = { ai, url: key, title: title || AIS[ai].label + " chat", time: Date.now() };
  data.history.unshift(e);
  if (data.history.length > 400) data.history.length = 400;
  saveData(); send("history", data.history);
}

function getView(ai) {
  if (views[ai]) return views[ai];
  const v = new WebContentsView({ webPreferences: { partition: "persist:exacct", contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  v.setBackgroundColor("#09090b");
  v.setVisible(false);
  win.contentView.addChildView(v);
  const wc = v.webContents;
  wc.setUserAgent(UA());
  wc.setWindowOpenHandler(({ url }) => {
    let h = ""; try { h = new URL(url).hostname; } catch {}
    const login = ["accounts.google.com", "login.microsoftonline.com", "appleid.apple.com", "auth.openai.com", "auth0.openai.com"].some(d => h === d || h.endsWith("." + d));
    if (login || onHost(ai, url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: "persist:exacct" } } };
    shell.openExternal(url); return { action: "deny" };
  });
  const nav = () => { if (ai === cfg.ai) send("nav", { canBack: wc.navigationHistory.canGoBack() }); record(ai, wc); };
  wc.on("did-navigate", nav);
  wc.on("did-navigate-in-page", nav);
  wc.on("page-title-updated", () => record(ai, wc));
  wc.on("did-start-loading", () => { if (ai === cfg.ai) send("loading", true); });
  wc.on("did-stop-loading", () => { if (ai === cfg.ai) send("loading", false); });
  wc.on("did-finish-load", () => wc.setZoomFactor(cfg.zoom / 100));
  wc.on("before-input-event", onKeys);
  wc.on("focus", () => { if (focused !== ai) { focused = ai; send("state", publicState()); layout(); } });
  const last = cfg.resume && cfg.lastUrl[ai];
  wc.loadURL(last && onHost(ai, last) ? last : AIS[ai].url, { userAgent: UA() });
  views[ai] = v;
  return v;
}

function switchAI(ai) {
  if (!AIS[ai]) return;
  if (cfg.split < 3) {
    if (cfg.split === 2 && visibleAIs()[1] === ai) cfg.ai2 = cfg.ai;
    cfg.ai = ai;
  }
  focused = ai; saveCfg();
  const v = getView(ai);
  layout();
  send("state", publicState());
  send("nav", { canBack: v.webContents.navigationHistory.canGoBack() });
  send("loading", v.webContents.isLoading());
  if (!ui.drawer) v.webContents.focus();
  if (tray) buildTray();
}

function current() {
  const k = visibleAIs().includes(focused) ? focused : cfg.ai;
  return views[k] && views[k].webContents;
}

function setSplit(n) {
  cfg.split = clamp(n, 1, 3);
  if (cfg.split === 2 && (!AIS[cfg.ai2] || cfg.ai2 === cfg.ai)) cfg.ai2 = AI_KEYS.find(k => k !== cfg.ai);
  saveCfg();
  const [w] = win.getContentSize();
  if (w < cfg.split * 400) H.set({ size: cfg.split === 3 ? "full" : "large" });
  layout(); send("state", publicState());
  toast(cfg.split === 1 ? "One AI" : cfg.split + " AIs side by side");
}

function cycleSecond() {
  const opts = AI_KEYS.filter(k => k !== cfg.ai);
  cfg.ai2 = opts[(opts.indexOf(visibleAIs()[1]) + 1) % opts.length];
  saveCfg(); layout(); send("state", publicState());
}

// types a message into an AI page and sends it
const PAGE_SEND = function (t) {
  return new Promise(function (done) {
    const sels = ["#prompt-textarea", "div.ProseMirror[contenteditable=\"true\"]", "rich-textarea [contenteditable=\"true\"]", "div[contenteditable=\"true\"]", "textarea"];
    const sendSels = ["button[data-testid=\"send-button\"]", "button[aria-label=\"Send message\"]", "button[aria-label=\"Send prompt\"]", "button.send-button", "button[aria-label*=\"Send\" i]"];
    let tries = 0;
    (function look() {
      let el = null;
      for (const s of sels) { el = Array.from(document.querySelectorAll(s)).find(e => e.offsetParent !== null); if (el) break; }
      if (!el) { if (++tries > 50) return done(false); return setTimeout(look, 300); }
      el.focus();
      if (el.tagName === "TEXTAREA") {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        set.call(el, t); el.dispatchEvent(new Event("input", { bubbles: true }));
      } else document.execCommand("insertText", false, t);
      setTimeout(function () {
        let btn = null;
        for (const s of sendSels) { btn = Array.from(document.querySelectorAll(s)).find(b => b.offsetParent !== null && !b.disabled); if (btn) break; }
        if (btn) { btn.click(); done("clicked"); } else done("enter");
      }, 600);
    })();
  });
};

function sendTo(ai, text) {
  const wc = getView(ai).webContents;
  return new Promise(res => {
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      wc.executeJavaScript("(" + PAGE_SEND.toString() + ")(" + JSON.stringify(text) + ")", true)
        .then(r => {
          if (r === "enter") ["keyDown", "char", "keyUp"].forEach(type => wc.sendInputEvent({ type, keyCode: type === "char" ? "\r" : "Enter" }));
          res(r);
        })
        .catch(() => res(false));
    };
    wc.once("did-stop-loading", () => setTimeout(go, 800));
    setTimeout(go, 20000);
    wc.loadURL(AIS[ai].url, { userAgent: UA() }).catch(() => {});
  });
}

async function askAll(text) {
  text = String(text || "").trim();
  if (!text) return;
  if (cfg.split < 3) setSplit(3);
  toast("Asking ChatGPT, Claude and Gemini");
  const r = await Promise.all(AI_KEYS.map(k => sendTo(k, text)));
  if (r.some(x => !x)) toast("Log in to all three first");
}

function insertPrompt(text) {
  clipboard.writeText(text);
  const wc = current();
  const pasteHint = "Copied - press " + (isMac ? "⌘V" : "Ctrl+V") + " to paste";
  if (!wc) { toast(pasteHint); return false; }
  const fn = function (t) {
    const sels = ["#prompt-textarea", "div.ProseMirror[contenteditable=\"true\"]", "rich-textarea [contenteditable=\"true\"]", "div[contenteditable=\"true\"]", "textarea"];
    let el = null;
    for (const s of sels) { el = Array.from(document.querySelectorAll(s)).find(e => e.offsetParent !== null); if (el) break; }
    if (!el) return false;
    el.focus();
    if (el.tagName === "TEXTAREA") {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(el, el.value + t); el.dispatchEvent(new Event("input", { bubbles: true }));
    } else document.execCommand("insertText", false, t);
    return true;
  };
  return wc.executeJavaScript("(" + fn.toString() + ")(" + JSON.stringify(text) + ")", true)
    .then(ok => { wc.focus(); toast(ok ? "Added to your chat" : pasteHint); return ok; })
    .catch(() => { toast(pasteHint); return false; });
}

function onKeys(e, input) {
  if (input.type !== "keyDown") return;
  const mod = isMac ? input.meta : input.control;
  if (!mod) return;
  const k = String(input.key).toLowerCase();
  const stop = () => e.preventDefault();
  if (input.alt) {
    const snap = { arrowleft: "left", arrowright: "right", arrowup: "full" }[k];
    if (snap) { stop(); H.set({ size: snap }); }
    else if (k === "arrowdown") { stop(); toggleMini(); }
    return;
  }
  if (!input.shift && ["1", "2", "3"].includes(k)) { stop(); switchAI(AI_KEYS[+k - 1]); }
  else if (input.shift && k === "h") { stop(); send("drawer", "chats"); }
  else if (input.shift && k === "p") { stop(); send("drawer", "prompts"); }
  else if (input.shift && k === "l") { stop(); send("drawer", "layout"); }
  else if (input.shift && k === "m") { stop(); toggleMini(); }
  else if (input.shift && k === "o") { stop(); H.act("home"); }
  else if (!input.shift && (k === "=" || k === "+")) { stop(); setZoom(cfg.zoom + 10); }
  else if (!input.shift && k === "-") { stop(); setZoom(cfg.zoom - 10); }
  else if (!input.shift && k === "0") { stop(); setZoom(100); }
}

// keep people signed in: session cookies are saved as 30-day cookies
function keepCookies() {
  const ses = session.fromPartition("persist:exacct");
  ses.cookies.on("changed", (_e, c, _cause, removed) => {
    if (removed || !c.session || !cfg.keepSignedIn) return;
    const host = String(c.domain || "").replace(/^\./, "");
    if (!host) return;
    const d = { url: "https://" + host + (c.path || "/"), name: c.name, value: c.value, path: c.path || "/", secure: c.secure, httpOnly: c.httpOnly,
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 };
    if (!c.hostOnly && !c.name.startsWith("__Host-")) d.domain = c.domain;
    if (c.sameSite && c.sameSite !== "unspecified") d.sameSite = c.sameSite;
    ses.cookies.set(d).catch(() => {});
  });
  return ses;
}

// ---------- IPC ----------
const H = {
  state: () => publicState(),
  set: patch => {
    patch = patch || {};
    const before = { ai: cfg.ai, zoom: cfg.zoom };
    for (const k of Object.keys(patch)) if (k in DEFAULTS && k !== "lastUrl") cfg[k] = patch[k];
    cfg.name = String(cfg.name || "Exacct AI").slice(0, 40);
    const place = ["size", "position", "width", "height"].some(k => k in patch);
    if (place) { cfg.mini = null; if (cfg.position === "custom" && "size" in patch) cfg.position = "center"; }
    saveCfg();
    applySettings({ place });
    if (cfg.ai !== before.ai) switchAI(cfg.ai);
    if (cfg.zoom !== before.zoom) setZoom(cfg.zoom);
    if ("size" in patch) toast(SIZE_NAMES[cfg.size] || "Size changed");
    return publicState();
  },
  switch: ai => switchAI(ai),
  split: n => setSplit(n),
  cycleSecond: () => cycleSecond(),
  focusCol: ai => { if (!views[ai]) return; focused = ai; views[ai].webContents.focus(); send("state", publicState()); layout(); },
  askAll: text => askAll(text),
  pinHistory: url => { const e = data.history.find(h => h.url === url); if (e) { e.pinned = !e.pinned; saveData(); send("history", data.history); } },
  openUpdate: () => shell.openExternal(SITE),
  act: a => {
    const wc = current();
    if (a === "back" && wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (a === "reload" && wc) wc.reload();
    if (a === "home" && wc) wc.loadURL(AIS[cfg.ai].url, { userAgent: UA() });
    if (a === "min") win.minimize();
    if (a === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
    if (a === "close") win.close();
    if (a === "pin") { cfg.alwaysOnTop = !cfg.alwaysOnTop; saveCfg(); applySettings(); toast(cfg.alwaysOnTop ? "Stays on top" : "Normal window"); }
    if (a === "mini") toggleMini();
    if (a === "zoomIn") setZoom(cfg.zoom + 10);
    if (a === "zoomOut") setZoom(cfg.zoom - 10);
  },
  open: (ai, url) => { if (!AIS[ai] || !onHost(ai, url)) return; switchAI(ai); views[ai].webContents.loadURL(url, { userAgent: UA() }); },
  usePrompt: text => insertPrompt(String(text || "")),
  savePrompts: list => { if (Array.isArray(list)) data.prompts = list.slice(0, 100); saveData(); return data.prompts; },
  clearHistory: () => { data.history = []; saveData(); send("history", data.history); },
  removeHistory: url => { data.history = data.history.filter(h => h.url !== url); saveData(); send("history", data.history); },
  pickIcon: async () => {
    dialogOpen = true;
    const r = await dialog.showOpenDialog(win, { title: "Choose an icon", properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "ico", "webp"] }] });
    dialogOpen = false;
    if (r.canceled || !r.filePaths[0]) return null;
    const img = nativeImage.createFromPath(r.filePaths[0]);
    return img.isEmpty() ? null : img.resize({ width: 256, height: 256, quality: "best" }).toDataURL();
  },
  ui: s => {
    Object.assign(ui, s || {});
    layout();
    if (!ui.drawer && !ui.welcome) { const wc = current(); if (wc) wc.focus(); }
  },
  reset: () => {
    const keep = { welcomed: true, lastUrl: cfg.lastUrl };
    cfg = { ...DEFAULTS, ...keep };
    saveCfg(); applySettings({ place: true }); switchAI(cfg.ai);
    return publicState();
  }
};
ipcMain.handle("x", (e, ch, ...a) => { if (!win || e.sender !== win.webContents || !H[ch]) return null; return H[ch](...a); });

// ---------- updates ----------
function newer(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
}
function checkUpdate() {
  net.fetch("https://raw.githubusercontent.com/rehat2009-dev/exacct-ai/main/package.json", { cache: "no-store" })
    .then(r => r.json())
    .then(p => { if (p && newer(p.version, pkg.version)) { update = p.version; send("state", publicState()); } })
    .catch(() => {});
}

// ---------- tray ----------
function buildTray() {
  const sizes = ["mini", "small", "medium", "large", "left", "right", "full"];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show / hide " + cfg.name, click: toggleWindow },
    { type: "separator" },
    ...AI_KEYS.map(k => ({ label: AIS[k].label, type: "radio", checked: cfg.ai === k, click: () => { win.show(); switchAI(k); } })),
    { type: "separator" },
    { label: "Size", submenu: sizes.map(s => ({ label: SIZE_NAMES[s], type: "radio", checked: cfg.size === s, click: () => H.set({ size: s }) })) },
    { label: "Mini mode", type: "checkbox", checked: !!cfg.mini, click: toggleMini },
    { label: "Keep on top", type: "checkbox", checked: !!cfg.alwaysOnTop, click: () => H.act("pin") },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// ---------- app ----------
function createWindow() {
  win = new BrowserWindow({
    width: 860, height: 760, minWidth: 360, minHeight: 420, show: false,
    frame: isMac, titleBarStyle: isMac ? "hiddenInset" : undefined,
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#09090b", title: cfg.name,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  win.loadFile(path.join(__dirname, "ui.html"));
  win.webContents.on("before-input-event", onKeys);
  getView(cfg.ai);
  win.on("resize", layout);
  const remember = () => {
    if (placing || !win || win.isFullScreen() || win.isMaximized()) return;
    later("bounds", () => {
      const b = win.getBounds();
      cfg.x = b.x; cfg.y = b.y; cfg.width = b.width; cfg.height = b.height;
      cfg.size = "custom"; cfg.position = "custom"; cfg.mini = null;
      saveCfg(); send("state", publicState());
    });
  };
  win.on("moved", remember);
  win.on("resized", remember);
  win.on("blur", () => {
    if (!cfg.autoHide || dialogOpen) return;
    setTimeout(() => { if (win && !win.isDestroyed() && !BrowserWindow.getFocusedWindow()) win.hide(); }, 250);
  });
  win.on("close", e => { if (!app.isQuitting && cfg.closeToTray) { e.preventDefault(); win.hide(); } });
  win.once("ready-to-show", () => { placeWindow(); win.show(); });
  win.webContents.on("did-finish-load", () => applySettings({ place: false }));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    cfg = { ...DEFAULTS, ...readJson("settings.json", {}) };
    cfg.lastUrl = cfg.lastUrl || {};
    data = { history: [], stats: {}, prompts: DEFAULT_PROMPTS, ...readJson("data.json", {}) };
    if (!AIS[cfg.ai]) cfg.ai = defaultAi;
    const ses = keepCookies();
    tray = new Tray(iconImage(isMac ? 18 : 16));
    tray.setToolTip(cfg.name);
    tray.on("click", toggleWindow);
    buildTray();
    createWindow();
    setTimeout(checkUpdate, 6000);
    // time used: counts 15 s at a time while the window is in front
    setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible() || !win.isFocused()) return;
      const d = dayKey();
      data.stats[d] = data.stats[d] || {};
      const who = focused || cfg.ai;
      data.stats[d][who] = (data.stats[d][who] || 0) + 15;
      if (cfg.goal > 0 && cfg.goalDay !== d) {
        const total = Object.values(data.stats[d]).reduce((a, b) => a + b, 0);
        if (total >= cfg.goal * 60) {
          cfg.goalDay = d; saveCfg();
          const msg = "You used AI for " + (cfg.goal >= 60 ? cfg.goal / 60 + " h" : cfg.goal + " min") + " today";
          toast(msg);
          if (Notification.isSupported()) new Notification({ title: cfg.name, body: msg, icon: iconImage(128) }).show();
        }
      }
      const keys = Object.keys(data.stats).sort();
      while (keys.length > 60) delete data.stats[keys.shift()];
      saveData();
    }, 15000);
    app.on("before-quit", () => {
      app.isQuitting = true;
      writeJson("settings.json", cfg); writeJson("data.json", data);
      ses.cookies.flushStore().catch(() => {});
    });
  });
  app.on("activate", () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => app.quit());
}

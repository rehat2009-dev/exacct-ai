// Expecct 3 - your AI in its own window
const { app, BrowserWindow, WebContentsView, ipcMain, screen, Tray, Menu, nativeImage,
        globalShortcut, shell, dialog, session, clipboard, net, Notification, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const pkg = require("./package.json");

const AIS = {
  chatgpt: { label: "ChatGPT", color: "#10a37f", url: "https://chatgpt.com/", hosts: ["chatgpt.com", "openai.com"], chat: /^\/c\/[\w-]+/ },
  claude:  { label: "Claude",  color: "#d97757", url: "https://claude.ai/new", hosts: ["claude.ai", "anthropic.com"], chat: /^\/chat\/[\w-]+/ },
  gemini:  { label: "Gemini",  color: "#4f8cff", url: "https://gemini.google.com/app", hosts: ["gemini.google.com"], chat: /^\/app\/\w+/ }
};
const AI_KEYS = Object.keys(AIS);
const isMac = process.platform === "darwin";
const TOP = 44, DRAWER = 340, COLH = 30, ASKH = 54, GAP = 0, NOTICEH = 52;
const railW = w => (w < 520 ? 52 : 68);
const SITE = "https://rehat2009-dev.github.io/exacct-ai/";
const REL = process.env.EXPECCT_REL || "https://github.com/rehat2009-dev/exacct-ai/releases/download/latest/";
const BRAND = "Expecct";
// the chat lives on the Expecct website, so it works the same in the app and in a browser
const CHAT_URL = process.env.EXPECCT_CHAT || SITE + "app/?desktop=1";
const CHAT_ORIGIN = new URL(CHAT_URL).origin;
const LOGIN_URL = process.env.EXPECCT_LOGIN || SITE + "app/login.html";
const AGENT_URL = process.env.EXPECCT_AGENT || SITE + "app/agent.html?desktop=1";
const SCHEME = "expecct";
const HOTKEY = "CommandOrControl+Shift+Space";
const FIXED = { mini: [380, 580], small: [460, 700], medium: [860, 760], large: [1200, 860], xl: [1500, 960] };
const SIZE_NAMES = { mini: "Mini", small: "Small", medium: "Medium", large: "Large", xl: "Extra large", focus: "Focus", tall: "Tall side", left: "Left half", right: "Right half", left3: "Left third", right3: "Right third", top: "Top half", bottom: "Bottom half", full: "Full screen", custom: "Custom" };

const defaultAi = AIS[pkg.exacctAi] ? pkg.exacctAi : "chatgpt";

// each app (ChatGPT, Claude, Gemini) keeps its own settings, so all three can run at once.
// The first time, settings and sign-ins are copied over from the old "Exacct AI" app.
if (process.env.EXPECCT_DATA) app.setPath("userData", process.env.EXPECCT_DATA);
else if (app.isPackaged) {
  const dir = path.join(app.getPath("appData"), "Expecct " + AIS[defaultAi].label);
  const old = path.join(app.getPath("appData"), "Exacct AI");
  const skip = /[\\/](Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|CacheStorage|Crashpad|SingletonLock|SingletonSocket|SingletonCookie|lockfile)$/;
  try { if (!fs.existsSync(dir) && fs.existsSync(old)) fs.cpSync(old, dir, { recursive: true, filter: f => !skip.test(f) }); } catch (e) { console.error(e); }
  app.setPath("userData", dir);
}

// look like a normal browser so sign-in pages work
const CHROME_MAJOR = String(process.versions.chrome || "130").split(".")[0];
const OS_PART = isMac ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64";
const CHROME_UA = "Mozilla/5.0 (" + OS_PART + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + CHROME_MAJOR + ".0.0.0 Safari/537.36";
const isGoogleLogin = url => { try { return new URL(url).hostname === "accounts.google.com"; } catch { return false; } };
app.userAgentFallback = CHROME_UA;

// who is signed in (checked from cookies)
const AUTH = {
  chatgpt: { check: "https://chatgpt.com/", ok: c => c.name.startsWith("__Secure-next-auth.session-token"), login: "https://chatgpt.com/auth/login", domains: ["chatgpt.com", "openai.com"] },
  claude: { check: "https://claude.ai/", ok: c => c.name === "sessionKey", login: "https://claude.ai/login", domains: ["claude.ai", "anthropic.com"] },
  gemini: { check: "https://gemini.google.com/", ok: c => ["SID", "__Secure-1PSID", "__Secure-3PSID"].includes(c.name), login: "https://accounts.google.com/ServiceLogin?continue=" + encodeURIComponent("https://gemini.google.com/app"), domains: ["google.com"] }
};
const DEFAULTS = {
  ai: defaultAi, name: BRAND,
  size: "medium", position: "center", x: null, y: null, width: 860, height: 760,
  alwaysOnTop: false, opacity: 100, zoom: 100,
  accent: "#8b5cf6", theme: "aurora", icon: null,
  hotkey: true, startup: false, closeToTray: false, resume: true, keepSignedIn: true,
  welcomed: false, mini: null, lastUrl: {},
  split: 1, ai2: null, goal: 0, goalDay: "", autoHide: false, chatMode: true, page: "chat", workspace: "", autoRun: false
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
let chatView = null, agentView = null, loginState = null, pendingToken = null;
const ui = { drawer: false, welcome: false, ask: false };
let placing = false, focused = null, dialogOpen = false, findText = "";
let upd = null, updFile = null, updApp = null, signed = {};

const UA = () => CHROME_UA;
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
const toast = t => send("toast", t);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const dayKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const onHost = (ai, url) => { try { const h = new URL(url).hostname; return AIS[ai].hosts.some(d => h === d || h.endsWith("." + d)); } catch { return false; } };

function publicState() {
  return {
    cfg, isMac, hotkeyLabel: isMac ? "⌘ ⇧ Space" : "Ctrl + Shift + Space",
    ais: AI_KEYS.map(k => ({ id: k, label: AIS[k].label, color: AIS[k].color, icon: (data.icons || {})[k] || null })),
    sizeNames: SIZE_NAMES, history: data.history, stats: data.stats, prompts: data.prompts,
    focused: focused || cfg.ai, cols: visibleAIs(), chatMode: !!cfg.chatMode, page: cfg.chatMode ? (cfg.page === "agent" ? "agent" : "chat") : null, update: upd, signed, version: pkg.version, dark: nativeTheme.shouldUseDarkColors
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
  const rail = railW(w);
  const drawerW = ui.drawer ? (w - rail - DRAWER < 320 ? w - rail : DRAWER) : 0;
  const left = rail + drawerW;
  if (cfg.chatMode) {
    const c = cfg.page === "agent" ? getAgent() : getChat();
    const other = c === chatView ? agentView : chatView;
    if (other) other.setVisible(false);
    for (const k of AI_KEYS) if (views[k]) views[k].setVisible(false);
    const show = !ui.welcome && w - left > 0;
    c.setVisible(show);
    if (show) c.setBounds({ x: left, y: TOP, width: w - left, height: Math.max(0, h - TOP) });
    send("cols", { cols: [], top: TOP, left, focused: "chat" });
    return;
  }
  if (chatView) chatView.setVisible(false);
  if (agentView) agentView.setVisible(false);
  const list = visibleAIs();
  list.forEach(k => getView(k));
  const head = TOP + (ui.ask ? ASKH : 0) + (ui.notice ? NOTICEH : 0);
  const top = head + (list.length > 1 ? COLH : 0);
  const avail = Math.max(0, w - left), n = list.length;
  const colW = Math.floor((avail - (n - 1)) / n);
  const cols = [];
  for (const k of AI_KEYS) {
    const v = views[k];
    if (!v) continue;
    const i = list.indexOf(k);
    const show = !ui.welcome && i > -1 && avail > 0;
    v.setVisible(show);
    if (show) {
      const x = left + i * (colW + 1), width = i === n - 1 ? left + avail - x : colW;
      // the chat area sits like a rounded card, with a small gap on the right and bottom
      const right = i === n - 1 ? GAP : 0;
      v.setBounds({ x, y: top, width: Math.max(0, width - right), height: Math.max(0, h - top - GAP) });
      cols.push({ ai: k, x, width });
    }
  }
  cols.sort((a, b) => a.x - b.x);
  send("cols", { cols, top: head, left, focused: focused || cfg.ai });
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
  if (chatView) chatView.webContents.setZoomFactor(cfg.zoom / 100);
  if (agentView) agentView.webContents.setZoomFactor(cfg.zoom / 100);
  saveCfg(); send("state", publicState()); toast("Text size " + cfg.zoom + "%");
}

function applySettings(opts) {
  if (!win) return;
  win.setTitle(cfg.name);
  win.setAlwaysOnTop(!!cfg.alwaysOnTop, "floating");
  if (!faded && !fadeTimer) win.setOpacity(fullOpacity());
  applyTheme();
  if (!isMac) win.setIcon(iconImage(256));
  if (isMac && app.dock) app.dock.setIcon(iconImage(512));
  if (tray) { tray.setImage(iconImage(isMac ? 18 : 16)); tray.setToolTip(cfg.name); buildTray(); }
  globalShortcut.unregisterAll();
  if (cfg.hotkey) globalShortcut.register(HOTKEY, toggleWindow);
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.startup }); } catch {}
  if (opts && opts.place) placeWindow();
  send("state", publicState());
}

// ---------- smooth open / close ----------
let fadeTimer = null, faded = false, closing = false, closingDone = false;
const fullOpacity = () => clamp(cfg.opacity, 40, 100) / 100;
function fade(to, ms) {
  return new Promise(res => {
    clearInterval(fadeTimer); fadeTimer = null;
    if (!win || win.isDestroyed() || process.platform === "linux") { res(); return; }
    const from = win.getOpacity(), t0 = Date.now();
    fadeTimer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(fadeTimer); fadeTimer = null; res(); return; }
      const p = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      win.setOpacity(from + (to - from) * e);
      if (p >= 1) { clearInterval(fadeTimer); fadeTimer = null; res(); }
    }, 8);
  });
}
function showWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible() || faded) {
    win.setOpacity(0); win.show(); win.focus(); faded = false;
    fade(fullOpacity(), 200);
  } else { win.show(); win.focus(); }
}
async function hideWin(then) {
  if (!win || win.isDestroyed() || !win.isVisible()) { if (then) then(); return; }
  await fade(0, 170);
  faded = true;
  if (then) then(); else win.hide();
}
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused() && !faded) hideWin(); else showWin();
}

// ---------- light / dark ----------
function applyTheme() {
  if (nativeTheme.themeSource !== "dark") nativeTheme.themeSource = "dark";
  const bg = "#09090b";
  if (win && !win.isDestroyed()) win.setBackgroundColor(bg);
  for (const k of AI_KEYS) if (views[k]) views[k].setBackgroundColor(bg);
  if (chatView) chatView.setBackgroundColor(bg);
  if (agentView) agentView.setBackgroundColor(bg);
  if (win && !win.isDestroyed() && lastDark !== nativeTheme.shouldUseDarkColors) { lastDark = nativeTheme.shouldUseDarkColors; send("state", publicState()); }
}
let lastDark = null;

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

const LOGIN_HOSTS = ["accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "auth.openai.com", "auth0.openai.com"];
const openExt = url => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };

// shared setup for AI pages and their sign-in popups
function setupContents(wc, ai) {
  wc.setUserAgent(UA());
  // Google does not allow signing in inside apps. When it says no, offer a real browser window instead.
  const checkGoogle = () => {
    const url = wc.getURL();
    if (!isGoogleLogin(url)) return;
    if (/\/rejected/.test(url)) { googleBlocked(ai, wc); return; }
    wc.executeJavaScript("document.body ? document.body.innerText.slice(0, 3000) : ''", true).then(t => {
      if (/may not be secure|muligens ikke sikker|kanskje ikke sikker|möglicherweise nicht sicher|n'est peut-être pas sécurisé|puede que no sea seguro/i.test(t || "")) googleBlocked(ai, wc);
    }).catch(() => {});
  };
  wc.on("did-finish-load", checkGoogle);
  wc.on("did-navigate-in-page", checkGoogle);
  wc.setWindowOpenHandler(({ url }) => {
    let h = ""; try { h = new URL(url).hostname; } catch {}
    const login = LOGIN_HOSTS.some(d => h === d || h.endsWith("." + d));
    if (login || onHost(ai, url)) return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, backgroundColor: "#ffffff", webPreferences: { partition: "persist:exacct" } } };
    openExt(url); return { action: "deny" };
  });
  wc.on("did-create-window", child => {
    child.setMenuBarVisibility(false);
    setupContents(child.webContents, ai);
    child.on("closed", () => later("authcheck", checkAuth, 800));
  });
  wc.on("before-input-event", onKeys);
  wc.on("context-menu", (_e, p) => contextMenu(wc, p));
}

function contextMenu(wc, p) {
  const t = [], sel = String(p.selectionText || "").trim(), sep = { type: "separator" };
  if (p.misspelledWord && p.dictionarySuggestions && p.dictionarySuggestions.length) {
    p.dictionarySuggestions.slice(0, 5).forEach(s => t.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    t.push(sep);
  }
  if (p.linkURL) t.push({ label: "Open link in browser", click: () => openExt(p.linkURL) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) }, sep);
  if (p.mediaType === "image" && p.srcURL) t.push({ label: "Copy image", click: () => wc.copyImageAt(p.x, p.y) }, { label: "Save image", click: () => wc.downloadURL(p.srcURL) }, sep);
  if (p.isEditable) {
    const f = p.editFlags || {};
    t.push({ label: "Cut", enabled: !!f.canCut, click: () => wc.cut() }, { label: "Copy", enabled: !!f.canCopy, click: () => wc.copy() },
      { label: "Paste", enabled: !!f.canPaste, click: () => wc.paste() }, { label: "Select all", click: () => wc.selectAll() });
  } else if (sel) t.push({ label: "Copy", click: () => wc.copy() });
  if (sel) {
    const q = sel.slice(0, 4000);
    t.push(sep, { label: "Ask about this", submenu: [
      ...AI_KEYS.map(k => ({ label: AIS[k].label, click: () => askOne(k, q) })), sep,
      { label: "All 3 at once", click: () => askAll(q) }] });
  }
  if (!t.length) {
    t.push({ label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: "Reload", click: () => wc.reload() }, sep, { label: "New chat", click: () => H.act("home") });
  }
  while (t.length && t[t.length - 1].type === "separator") t.pop();
  Menu.buildFromTemplate(t).popup({ window: win });
}

function getView(ai) {
  if (views[ai]) return views[ai];
  const v = new WebContentsView({ webPreferences: { partition: "persist:exacct", contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  v.setBackgroundColor("#09090b");
  v.setVisible(false);
  win.contentView.addChildView(v);
  const wc = v.webContents;
  setupContents(wc, ai);
  wc.on("found-in-page", (_e, r) => { if (r.finalUpdate) send("found", { active: r.activeMatchOrdinal, total: r.matches }); });
  const nav = () => { if (ai === cfg.ai) send("nav", { canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward() }); record(ai, wc); };
  wc.on("did-navigate", nav);
  wc.on("did-navigate-in-page", nav);
  wc.on("page-title-updated", () => record(ai, wc));
  wc.on("page-favicon-updated", (_e, favs) => { if (onHost(ai, wc.getURL()) || wc.getURL().startsWith("data:")) loadIcon(ai, favs); });
  wc.on("did-start-loading", () => { if (ai === cfg.ai) send("loading", true); });
  wc.on("did-stop-loading", () => { if (ai === cfg.ai) send("loading", false); });
  wc.on("did-finish-load", () => wc.setZoomFactor(cfg.zoom / 100));
  wc.on("focus",() => { if (focused !== ai) { focused = ai; send("state", publicState()); layout(); } });
  const last = cfg.resume && cfg.lastUrl[ai];
  wc.loadURL(last && onHost(ai, last) ? last : AIS[ai].url, { userAgent: UA() });
  views[ai] = v;
  return v;
}

// ---------- chat (answers right inside Expecct) ----------
function getChat() { if (!chatView) chatView = makePage(CHAT_URL); return chatView; }
function getAgent() { if (!agentView) agentView = makePage(AGENT_URL); return agentView; }
function makePage(PAGE_URL) {
  const v = new WebContentsView({ webPreferences: { partition: "persist:exacct", contextIsolation: true, sandbox: true, preload: path.join(__dirname, "chatpreload.js"), backgroundThrottling: false } });
  v.setBackgroundColor("#09090b");
  v.setVisible(false);
  win.contentView.addChildView(v);
  const wc = v.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    let h = ""; try { h = new URL(url).hostname; } catch {}
    // "Log in here": Puter's own sign-in window
    if (h === "puter.com" || h.endsWith(".puter.com")) return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: "#ffffff", parent: win } };
    openExt(url); return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => { try { if (new URL(url).origin !== CHAT_ORIGIN) { e.preventDefault(); openExt(url); } } catch { e.preventDefault(); } });
  wc.on("did-create-window", child => child.setMenuBarVisibility(false));
  wc.on("before-input-event", onKeys);
  wc.on("context-menu", (_e, p) => contextMenu(wc, p));
  wc.on("did-finish-load", () => { wc.setZoomFactor(cfg.zoom / 100); if (pendingToken) deliverToken(); });
  wc.on("did-fail-load", (_e, code, _d, url, main) => { if (main && code !== -3) setTimeout(() => { if (!wc.isDestroyed()) wc.loadURL(PAGE_URL).catch(() => {}); }, 4000); });
  wc.loadURL(PAGE_URL).catch(() => {});
  return v;
}
function openChat(page) {
  cfg.chatMode = true; cfg.page = page === "agent" ? "agent" : "chat"; saveCfg();
  ui.notice = false;
  layout(); send("state", publicState());
  const c = cfg.page === "agent" ? getAgent() : getChat(); if (!ui.drawer) c.webContents.focus();
  if (tray) buildTray();
}
function registerScheme() {
  try {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(SCHEME);
  } catch (e) { console.error(e); }
}
// "Log in with browser": your browser opens the Expecct website, you log in there,
// and the website sends you back to the app with a key for the chat.
function startLogin() {
  loginState = crypto.randomBytes(18).toString("hex");
  writeJson("login.json", { state: loginState, time: Date.now() });
  registerScheme();
  shell.openExternal(LOGIN_URL + "?state=" + loginState);
  return true;
}
function handleLink(url) {
  let u; try { u = new URL(url); } catch { return; }
  if (u.protocol !== SCHEME + ":" || (u.hostname || u.pathname.replace(/^\/+/, "")).replace(/\/$/, "") !== "auth") return;
  const saved = loginState ? { state: loginState, time: Date.now() } : readJson("login.json", {});
  const state = u.searchParams.get("state"), token = u.searchParams.get("token") || "";
  if (!saved.state || state !== saved.state || Date.now() - (saved.time || 0) > 30 * 60 * 1000) { toast("That login link is old – press Log in again"); return; }
  if (!/^[\w.~+\/=-]{10,4000}$/.test(token)) { toast("Login didn't work – try again"); return; }
  loginState = null; writeJson("login.json", {});
  pendingToken = token;
  if (!win) return;
  showWin(); openChat(cfg.page);
  deliverToken();
}
function deliverToken() {
  const pages = [chatView, agentView].filter(Boolean);
  if (!pendingToken || !pages.length || pages.some(v => v.webContents.isLoading())) return;
  for (const v of pages) v.webContents.send("puter-token", pendingToken);
  pendingToken = null;
  toast("You're logged in");
}
const linkIn = argv => (argv || []).find(a => typeof a === "string" && a.toLowerCase().startsWith(SCHEME + "://"));
const CH = {
  login: () => startLogin(),
  open: ai => { if (AIS[ai]) switchAI(ai); },
  ask: (ai, text) => { if (AIS[ai]) askOne(ai, String(text || "").slice(0, 20000)); },
  version: () => pkg.version
};
ipcMain.handle("xc", (e, ch, ...a) => {
  const fromChat = chatView && e.sender === chatView.webContents, fromAgent = agentView && e.sender === agentView.webContents;
  if (!fromChat && !fromAgent) return null;
  try { if (new URL(e.senderFrame.url).origin !== CHAT_ORIGIN) return null; } catch { return null; }
  if (CH[ch]) return CH[ch](...a);
  if (fromAgent && AG[ch]) return AG[ch](...a);   // file and command tools: only for the Agent page
  return null;
});

// ---------- agent (like Codex): looks around, writes files and runs commands ----------
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", "Library"]);
let agentProc = null, agentBackups = [], sessionAllow = false;
const ws = () => cfg.workspace && fs.existsSync(cfg.workspace) ? cfg.workspace : "";
function where(p, mustBeInside) {
  const base = ws() || app.getPath("home");
  const abs = path.resolve(base, String(p || ".").replace(/^~(?=$|[\\/])/, app.getPath("home")));
  if (mustBeInside) {
    if (!ws()) throw new Error("No project folder chosen. Ask the user to press 'Choose a project folder'.");
    const rel = path.relative(ws(), abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("You can only change files inside the project folder: " + ws());
  }
  return abs;
}
const isText = buf => !buf.subarray(0, 4000).includes(0);
const cut = (t, n) => (t.length > n ? t.slice(0, n) + "\n… (" + (t.length - n) + " more characters cut)" : t);
function backup(file) {
  let prev = null; try { prev = fs.readFileSync(file); } catch {}
  agentBackups.push({ file, prev });
}
async function askToRun(what, detail) {
  if (cfg.autoRun || sessionAllow) return true;
  if (win) showWin();
  const r = await dialog.showMessageBox(win, { type: "question", title: "Expecct Agent", message: what, detail,
    buttons: ["Allow", "Allow all this session", "Always allow (Auto-run)", "Don't allow"], defaultId: 0, cancelId: 3, noLink: true });
  if (r.response === 1) sessionAllow = true;
  if (r.response === 2) { cfg.autoRun = true; saveCfg(); }
  return r.response < 3;
}
function runCommand(command, timeoutS) {
  const cwd = ws() || app.getPath("home");
  const ms = clamp(Number(timeoutS) || 120, 5, 900) * 1000;
  return new Promise(res => {
    let out = "", done = false;
    const sh = isMac ? (process.env.SHELL || "/bin/zsh") : true;
    const p = spawn(command, { cwd, shell: sh, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    agentProc = p;
    const add = d => { out += d.toString(); if (out.length > 400000) out = out.slice(-200000); };
    p.stdout.on("data", add); p.stderr.on("data", add);
    const finish = (code, note) => {
      if (done) return; done = true; clearTimeout(timer); if (agentProc === p) agentProc = null;
      const tailOut = out.length > 14000 ? "… (start cut)\n" + out.slice(-14000) : out;
      res({ ok: code === 0, text: (note ? note + "\n" : "") + "exit code " + code + "\n" + (tailOut.trim() || "(no output)") });
    };
    const timer = setTimeout(() => { killProc(p); finish(-1, "Stopped after " + ms / 1000 + " s (timeout)."); }, ms);
    p.on("error", e => finish(-1, "Could not start: " + e.message));
    p.on("close", code => finish(code == null ? -1 : code));
  });
}
function killProc(p) {
  if (!p || p.exitCode != null) return;
  try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }); else p.kill("SIGTERM"); } catch {}
}
function walkSearch(dir, re, out, depth) {
  if (out.length >= 200 || depth > 12) return;
  let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    if (out.length >= 200) return;
    const f = path.join(dir, it.name);
    if (it.isDirectory()) { if (!SKIP_DIRS.has(it.name) && !it.name.startsWith(".")) walkSearch(f, re, out, depth + 1); continue; }
    try {
      const st = fs.statSync(f); if (st.size > 1500000) continue;
      const buf = fs.readFileSync(f); if (!isText(buf)) continue;
      buf.toString("utf8").split(/\r?\n/).forEach((line, i) => { if (out.length < 200 && re.test(line)) out.push(path.relative(ws() || dir, f) + ":" + (i + 1) + ": " + line.trim().slice(0, 200)); });
    } catch {}
  }
}
const TOOLS = {
  list_dir: a => {
    const d = where(a.path);
    const items = fs.readdirSync(d, { withFileTypes: true }).slice(0, 400).map(it => {
      if (it.isDirectory()) return it.name + "/";
      let size = ""; try { size = " (" + fs.statSync(path.join(d, it.name)).size + " B)"; } catch {}
      return it.name + size;
    });
    return d + "\n" + (items.join("\n") || "(empty)");
  },
  read_file: a => {
    const f = where(a.path), buf = fs.readFileSync(f);
    if (!isText(buf)) return f + " is a binary file (" + buf.length + " bytes).";
    return cut(buf.toString("utf8"), 80000);
  },
  search_files: a => {
    let re; try { re = new RegExp(String(a.pattern || ""), "i"); } catch { re = new RegExp(String(a.pattern || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
    const out = []; walkSearch(where(a.path || "."), re, out, 0);
    return out.length ? out.join("\n") + (out.length >= 200 ? "\n(first 200 matches)" : "") : "No matches.";
  },
  write_file: a => {
    const f = where(a.path, true);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    backup(f); fs.writeFileSync(f, String(a.content == null ? "" : a.content));
    return "Saved " + path.relative(ws(), f) + " (" + Buffer.byteLength(String(a.content || "")) + " bytes)";
  },
  edit_file: a => {
    const f = where(a.path, true), old = String(a.old_text || ""), txt = fs.readFileSync(f, "utf8");
    if (!old) throw new Error("old_text is empty");
    const n = txt.split(old).length - 1;
    if (n !== 1) throw new Error(n ? "old_text appears " + n + " times – give more surrounding text" : "old_text was not found in the file");
    backup(f); fs.writeFileSync(f, txt.replace(old, () => String(a.new_text == null ? "" : a.new_text)));
    return "Edited " + path.relative(ws(), f);
  },
  run_command: async a => {
    const cmd = String(a.command || "").trim(); if (!cmd) throw new Error("Empty command");
    if (!(await askToRun("Run this command?", cmd + "\n\nin " + (ws() || app.getPath("home"))))) return { ok: false, text: "The user said no to running this command." };
    return runCommand(cmd, a.timeout_seconds);
  },
  open_path: async a => {
    const f = where(a.path);
    if (!fs.existsSync(f)) throw new Error("Not found: " + f);
    if (/\.(exe|bat|cmd|ps1|sh|command|app|msi|vbs|jar)$/i.test(f) && !(await askToRun("Open this program?", f))) return { ok: false, text: "The user said no." };
    const err = await shell.openPath(f);
    if (err) throw new Error(err);
    return "Opened " + f;
  }
};
const AG = {
  agentInfo: () => ({ platform: process.platform === "win32" ? "Windows" : isMac ? "macOS" : "Linux", home: app.getPath("home"), workspace: ws(), autoRun: !!cfg.autoRun }),
  pickFolder: async () => {
    dialogOpen = true;
    const r = await dialog.showOpenDialog(win, { title: "Choose a project folder", properties: ["openDirectory", "createDirectory"], defaultPath: ws() || app.getPath("documents") });
    dialogOpen = false;
    if (r.canceled || !r.filePaths[0]) return null;
    cfg.workspace = r.filePaths[0]; agentBackups = []; saveCfg();
    return cfg.workspace;
  },
  tool: async (name, args) => {
    if (!TOOLS[name]) return { ok: false, text: "Unknown tool " + name };
    try {
      const r = await TOOLS[name](args && typeof args === "object" ? args : {});
      return typeof r === "string" ? { ok: true, text: r } : r;
    } catch (e) { return { ok: false, text: String(e && e.message || e) }; }
  },
  agentStop: () => { killProc(agentProc); return true; },
  agentUndo: () => {
    let n = 0;
    while (agentBackups.length) {
      const b = agentBackups.pop();
      try { if (b.prev == null) fs.rmSync(b.file, { force: true }); else fs.writeFileSync(b.file, b.prev); n++; } catch {}
    }
    return n;
  },
  // the page can only turn Auto-run OFF; turning it on needs the app's own window
  setAutoRun: async on => {
    if (!on) { cfg.autoRun = false; sessionAllow = false; saveCfg(); return false; }
    if (cfg.autoRun) return true;
    const r = await dialog.showMessageBox(win, { type: "warning", title: "Expecct Agent", message: "Let the agent run commands without asking?", detail: "It can then run any command on this computer by itself. You can turn it off again any time.", buttons: ["Turn on", "Cancel"], defaultId: 1, cancelId: 1, noLink: true });
    if (r.response === 0) { cfg.autoRun = true; saveCfg(); }
    return !!cfg.autoRun;
  }
};

function switchAI(ai) {
  if (!AIS[ai]) return;
  if (cfg.chatMode) { cfg.chatMode = false; if (chatView) chatView.setVisible(false); if (agentView) agentView.setVisible(false); }
  if (cfg.split < 3) {
    if (cfg.split === 2 && visibleAIs()[1] === ai) cfg.ai2 = cfg.ai;
    cfg.ai = ai;
  }
  focused = ai; saveCfg();
  const v = getView(ai);
  layout();
  send("state", publicState());
  send("nav", { canBack: v.webContents.navigationHistory.canGoBack(), canFwd: v.webContents.navigationHistory.canGoForward() });
  send("loading", v.webContents.isLoading());
  if (!ui.drawer) v.webContents.focus();
  if (tray) buildTray();
}

function current() {
  if (cfg.chatMode) { const pv = cfg.page === "agent" ? agentView : chatView; if (pv) return pv.webContents; }
  const k = visibleAIs().includes(focused) ? focused : cfg.ai;
  return views[k] && views[k].webContents;
}

function setSplit(n) {
  cfg.chatMode = false;
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

async function askOne(ai, text) {
  if (!visibleAIs().includes(ai)) switchAI(ai); else { focused = ai; send("state", publicState()); }
  const r = await sendTo(ai, text);
  if (!r) toast("Sign in to " + AIS[ai].label + " first");
}

async function askAll(text) {
  text = String(text || "").trim();
  if (!text) return;
  if (cfg.chatMode) { cfg.chatMode = false; saveCfg(); }
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
  const k = String(input.key).toLowerCase();
  const stop = () => e.preventDefault();
  if (!mod && input.alt && k === "arrowleft") { stop(); H.act("back"); return; }
  if (!mod) return;
  if (!input.shift && !input.alt && k === "r") { stop(); H.act("reload"); return; }
  if (!input.shift && !input.alt && k === "n") { stop(); H.act("home"); toast("New chat"); return; }
  if (!input.shift && !input.alt && k === "f") { stop(); send("find", true); if (win) win.webContents.focus(); return; }
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

// ---------- AI icons ----------
// Each AI shows its own site icon, the same one a browser shows in the tab.
// It is taken from the site itself and saved, so it shows up right away next time.
async function loadIcon(ai, urls) {
  data.icons = data.icons || {};
  const list = (urls || []).filter(u => /^https?:/i.test(u));
  // prefer png/svg over .ico
  list.sort((a, b) => (/\.ico(\?|$)/i.test(a) ? 1 : 0) - (/\.ico(\?|$)/i.test(b) ? 1 : 0));
  for (const u of list) {
    try {
      const r = await ses().fetch(u, { cache: "no-cache" });
      const type = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!r.ok || !/^image\//.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 300000) continue;
      const url = "data:" + type + ";base64," + buf.toString("base64");
      if (data.icons[ai] !== url) { data.icons[ai] = url; saveData(); send("state", publicState()); }
      return true;
    } catch {}
  }
  return false;
}
function loadMissingIcons() {
  data.icons = data.icons || {};
  for (const k of AI_KEYS) if (!data.icons[k]) loadIcon(k, [new URL(AIS[k].url).origin + "/favicon.ico"]);
}

// ---------- sign in / out ----------
const ses = () => session.fromPartition("persist:exacct");
async function checkAuth() {
  const next = {};
  for (const k of AI_KEYS) {
    try { next[k] = (await ses().cookies.get({ url: AUTH[k].check })).some(AUTH[k].ok); } catch { next[k] = null; }
  }
  if (JSON.stringify(next) !== JSON.stringify(signed)) { signed = next; send("state", publicState()); }
}
function signIn(ai) {
  if (!AIS[ai]) return;
  switchAI(ai);
  views[ai].webContents.loadURL(AUTH[ai].login).catch(() => {});
}
// "Use email": opens the sign-in page, presses "Log in" if needed and puts the cursor in the email box
const EMAIL_STEP = `(function(){
  function vis(e){ return e && e.offsetParent !== null && !e.disabled; }
  var inp = Array.prototype.slice.call(document.querySelectorAll('input[type=email],input[name=email],input[name=username],input[autocomplete=email],input[autocomplete=username],input#email,input#email-input')).find(vis);
  if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.style.outline = '3px solid #8b5cf6'; inp.style.outlineOffset = '2px'; return 'focused'; }
  var b = Array.prototype.slice.call(document.querySelectorAll('button,a')).find(function(x){
    var t = (x.textContent || '').trim();
    return vis(x) && (x.getAttribute('data-testid') === 'login-button' || /^(log in|logg inn|sign in|logg på|continue with email|fortsett med e-post)$/i.test(t));
  });
  if (b) { b.click(); return 'clicked'; }
  return 'wait';
})()`;
let emailRun = 0;
async function emailLogin(ai) {
  if (!AIS[ai]) return;
  const run = ++emailRun;
  ui.notice = false; layout();
  switchAI(ai);
  const wc = views[ai].webContents;
  toast("Type your email – don't press Google");
  wc.loadURL(AUTH[ai].login).catch(() => {});
  const end = Date.now() + 25000;
  let pause = 0;
  while (Date.now() < end && run === emailRun && !wc.isDestroyed()) {
    await new Promise(r => setTimeout(r, pause || 700)); pause = 0;
    if (wc.isLoading()) continue;
    let r = "wait";
    try { r = await wc.executeJavaScript(EMAIL_STEP, true); } catch {}
    if (r === "focused") { wc.focus(); return true; }
    if (r === "clicked") pause = 1800;
  }
  return false;
}

async function signOut(ai) {
  if (!AIS[ai]) return;
  const s = ses();
  const all = await s.cookies.get({});
  for (const c of all) {
    const d = String(c.domain || "").replace(/^\./, "");
    if (AUTH[ai].domains.some(x => d === x || d.endsWith("." + x)))
      await s.cookies.remove((c.secure ? "https://" : "http://") + d + (c.path || "/"), c.name).catch(() => {});
  }
  await s.clearStorageData({ origin: new URL(AIS[ai].url).origin, storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"] }).catch(() => {});
  delete cfg.lastUrl[ai]; saveCfg();
  if (views[ai]) views[ai].webContents.loadURL(AIS[ai].url).catch(() => {});
  await checkAuth();
  toast("Signed out of " + AIS[ai].label);
}

// files the AI makes go straight to Downloads
function setupDownloads(s) {
  s.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const name = item.getFilename() || "download", ext = path.extname(name), base = path.basename(name, ext);
    let p = path.join(dir, name), i = 1;
    while (fs.existsSync(p)) p = path.join(dir, base + " (" + i++ + ")" + ext);
    item.setSavePath(p);
    toast("Downloading " + path.basename(p));
    item.once("done", (_e2, st) => {
      if (st === "completed") { toast("Saved in Downloads"); if (isMac && app.dock) app.dock.downloadFinished(p); }
      else if (st !== "cancelled") toast("Download failed");
    });
  });
  // microphone (voice chat), notifications and copy buttons
  const OK = ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"];
  s.setPermissionRequestHandler((_wc, perm, cb) => cb(OK.includes(perm)));
  s.setPermissionCheckHandler((_wc, perm) => OK.includes(perm));
}

// ---------- Google sign-in ----------
function googleBlocked(ai, wc) {
  const main = views[ai] && views[ai].webContents === wc;
  if (!main) { const w = BrowserWindow.fromWebContents(wc); if (w && w !== win) w.close(); }
  else if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  ui.notice = ai; layout();
  send("notice", { ai, label: AIS[ai].label });
  if (win) showWin();
}
// Opens the AI in Chrome or Edge as its own app window, where Google sign-in works.
function findBrowser() {
  const env = process.env, list = process.platform === "win32" ? [
    path.join(env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    path.join(env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    path.join(env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    path.join(env.PROGRAMFILES || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe")
  ] : isMac ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return list.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}
function openAppWindow(ai) {
  const url = AIS[ai].url, exe = findBrowser();
  if (!exe) { shell.openExternal(url); return "browser"; }
  const b = win ? win.getBounds() : { x: 100, y: 100, width: 900, height: 760 };
  spawn(exe, ["--app=" + url, "--window-size=" + b.width + "," + b.height, "--window-position=" + b.x + "," + b.y], { detached: true, stdio: "ignore" }).unref();
  return path.basename(exe).replace(/\.exe$/i, "");
}

// ---------- find in page ----------
function find(text, back) {
  const wc = current(); if (!wc) return;
  text = String(text || "");
  if (!text) { wc.stopFindInPage("clearSelection"); findText = ""; send("found", null); return; }
  wc.findInPage(text, { forward: !back, findNext: text !== findText });
  findText = text;
}

// ---------- IPC ----------
const H = {
  state: () => publicState(),
  set: patch => {
    patch = patch || {};
    const before = { ai: cfg.ai, zoom: cfg.zoom };
    for (const k of Object.keys(patch)) if (k in DEFAULTS && k !== "lastUrl") cfg[k] = patch[k];
    cfg.name = String(cfg.name || BRAND).slice(0, 40);
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
  update: a => {
    if (a === "check") return checkUpdate(true);
    if (a === "restart" && installUpdate(true)) { app.isQuitting = true; app.quit(); return; }
    shell.openExternal(SITE + "#download");
  },
  find: (text, back) => find(text, back),
  findStop: () => { find(""); const wc = current(); if (wc) wc.focus(); },
  signIn: ai => signIn(ai),
  emailLogin: ai => emailLogin(ai),
  signOut: ai => signOut(ai),
  askOne: (ai, text) => askOne(ai, String(text || "").trim()),
  openAppWindow: ai => { if (!AIS[ai]) return; ui.notice = false; layout(); const r = openAppWindow(ai); toast("Opening " + AIS[ai].label + " in its own window"); return r; },
  closeNotice: () => { ui.notice = false; layout(); },
  chat: page => openChat(page),
  act: a => {
    const wc = current();
    if (cfg.chatMode && current() && (a === "home" || a === "reload" || a === "back")) {
      const pv = current();
      if (a === "home") pv.executeJavaScript("var b=document.getElementById('newBtn')||document.getElementById('newTask'); if (b) b.click();", true).catch(() => {});
      if (a === "reload") pv.reload();
      return;
    }
    if (a === "back" && wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (a === "forward" && wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (a === "reload" && wc) wc.reload();
    if (a === "home" && wc) wc.loadURL(AIS[cfg.ai].url, { userAgent: UA() });
    if (a === "min") { if (isMac) win.minimize(); else hideWin(() => win.minimize()); }
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
// New versions download by themselves and install when you restart (or quit) the app.
const ASSET = process.env.EXPECCT_ASSET || { win32: "Expecct-" + AIS[defaultAi].label + "-Windows.exe", darwin: "Expecct-" + AIS[defaultAi].label + "-Mac.zip" }[process.platform];
const sendState = () => send("state", publicState());
function macBundle() {
  if (!isMac) return null;
  const b = path.resolve(process.execPath, "../../..");
  if (!b.endsWith(".app") || b.startsWith("/Volumes/") || b.includes("/AppTranslocation/")) return null;
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); fs.accessSync(b, fs.constants.W_OK); return b; } catch { return null; }
}
async function checkUpdate(manual) {
  if (upd && ["downloading", "ready", "installing"].includes(upd.status)) { if (manual) toast(upd.status === "ready" ? "Update ready - restart" : "Downloading update"); return; }
  try {
    const info = await (await net.fetch(REL + "version.json", { cache: "no-store" })).json();
    if (!info || !newer(info.version, pkg.version)) { if (manual) toast("You have the newest version"); return; }
    if (!ASSET || (!app.isPackaged && !process.env.EXPECCT_ASSET) || (isMac && !macBundle())) { upd = { version: info.version, status: "manual" }; sendState(); return; }
    upd = { version: info.version, status: "downloading", pct: 0 }; sendState();
    const dir = path.join(app.getPath("temp"), "expecct-update");
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, ASSET);
    const res = await net.fetch(REL + ASSET, { cache: "no-store" });
    if (!res.ok || !res.body) throw new Error("http " + res.status);
    const total = +res.headers.get("content-length") || 0, hash = crypto.createHash("sha256"), out = fs.createWriteStream(f);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const b = Buffer.from(value); hash.update(b); got += b.length;
      if (!out.write(b)) await new Promise(r => out.once("drain", r));
      const pct = total ? Math.floor(got / total * 100) : 0;
      if (pct >= upd.pct + 5) { upd.pct = pct; sendState(); }
    }
    await new Promise((r, j) => { out.on("error", j); out.end(r); });
    const want = info.files && info.files[ASSET];
    if (!want || hash.digest("hex") !== want) throw new Error("checksum");
    if (isMac) {
      await new Promise((r, j) => execFile("/usr/bin/ditto", ["-x", "-k", f, dir], e => e ? j(e) : r()));
      const a = fs.readdirSync(dir).find(n => n.endsWith(".app"));
      if (!a) throw new Error("no app in zip");
      updApp = path.join(dir, a);
    }
    updFile = f; upd = { version: info.version, status: "ready" }; sendState();
    toast("Update ready - restart to use it");
  } catch (e) {
    console.error("update:", e && e.message);
    if (upd && upd.status === "downloading") { upd = { version: upd.version, status: "manual" }; sendState(); }
    if (manual) toast("Could not update right now");
  }
}
function installUpdate(relaunch) {
  if (!upd || upd.status !== "ready") return false;
  try {
    if (process.platform === "win32") {
      spawn(updFile, ["--updated", "/S"].concat(relaunch ? ["--force-run"] : []), { detached: true, stdio: "ignore" }).unref();
    } else if (isMac) {
      const b = macBundle(); if (!b || !updApp) return false;
      const script = 'while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done; ' +
        'if mv "$OLD" "$OLD.old"; then if mv "$NEW" "$OLD"; then rm -rf "$OLD.old"; else mv "$OLD.old" "$OLD"; fi; fi; ' +
        'xattr -dr com.apple.quarantine "$OLD" 2>/dev/null; if [ "$RUN" = 1 ]; then open "$OLD"; fi';
      spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore", env: { ...process.env, PID: String(process.pid), OLD: b, NEW: updApp, RUN: relaunch ? "1" : "0" } }).unref();
    } else return false;
  } catch (e) { console.error(e); return false; }
  upd.status = "installing";
  return true;
}

// ---------- tray ----------
function buildTray() {
  const sizes = ["mini", "small", "medium", "large", "left", "right", "full"];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show / hide " + cfg.name, click: toggleWindow },
    { type: "separator" },
    { label: "Chat", type: "radio", checked: !!cfg.chatMode && cfg.page !== "agent", click: () => { showWin(); openChat("chat"); } },
    { label: "Agent", type: "radio", checked: !!cfg.chatMode && cfg.page === "agent", click: () => { showWin(); openChat("agent"); } },
    ...AI_KEYS.map(k => ({ label: AIS[k].label, type: "radio", checked: !cfg.chatMode && cfg.ai === k, click: () => { showWin(); switchAI(k); } })),
    { type: "separator" },
    { label: "Size", submenu: sizes.map(s => ({ label: SIZE_NAMES[s], type: "radio", checked: cfg.size === s, click: () => H.set({ size: s }) })) },
    { label: "Mini mode", type: "checkbox", checked: !!cfg.mini, click: toggleMini },
    { label: "Keep on top", type: "checkbox", checked: !!cfg.alwaysOnTop, click: () => H.act("pin") },
    { type: "separator" },
    { label: "Check for updates", click: () => checkUpdate(true) },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// ---------- app ----------
function createWindow() {
  win = new BrowserWindow({
    width: 860, height: 760, minWidth: 360, minHeight: 420, show: false,
    frame: isMac, titleBarStyle: isMac ? "hiddenInset" : undefined,
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#09090b",
    title: cfg.name,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  win.loadFile(path.join(__dirname, "ui.html"));
  win.webContents.on("before-input-event", onKeys);
  if (cfg.chatMode) { if (cfg.page === "agent") getAgent(); else getChat(); } else getView(cfg.ai);
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
  win.on("focus", () => send("winfocus", true));
  win.on("blur", () => {
    send("winfocus", false);
    if (!cfg.autoHide || dialogOpen) return;
    setTimeout(() => { if (win && !win.isDestroyed() && !BrowserWindow.getFocusedWindow()) hideWin(); }, 250);
  });
  // closing fades the window out first, then quits (or hides to the tray)
  win.on("close", e => {
    if (closingDone) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    hideWin(() => {
      closing = false;
      if (!app.isQuitting && cfg.closeToTray) { win.hide(); return; }
      closingDone = true; app.isQuitting = true; app.quit();
    });
  });
  win.on("restore", () => { if (faded) { faded = false; fade(fullOpacity(), 200); } });
  win.once("ready-to-show", () => { placeWindow(); faded = true; win.setOpacity(0); showWin(); });
  win.webContents.on("did-finish-load", () => applySettings({ place: false }));
}

// links like expecct://auth?... come here (Mac: open-url, Windows: a second start of the app)
let earlyLink = linkIn(process.argv);
app.on("open-url", (e, url) => { e.preventDefault(); if (win) handleLink(url); else earlyLink = url; });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => { showWin(); const l = linkIn(argv); if (l) handleLink(l); });
  app.whenReady().then(() => {
    cfg = { ...DEFAULTS, ...readJson("settings.json", {}) };
    cfg.lastUrl = cfg.lastUrl || {};
    data = { history: [], stats: {}, prompts: DEFAULT_PROMPTS, ...readJson("data.json", {}) };
    if (!AIS[cfg.ai]) cfg.ai = defaultAi;
    if (!cfg.name || cfg.name === "Exacct AI") cfg.name = BRAND;
    if (!["aurora", "midnight", "black"].includes(cfg.theme)) cfg.theme = "aurora";
    if (cfg.accent === "#0a84ff") cfg.accent = DEFAULTS.accent;
    applyTheme();
    nativeTheme.on("updated", applyTheme);
    const ses = keepCookies();
    setupDownloads(ses);
    ses.cookies.on("changed", () => later("authcheck", checkAuth, 1200));
    tray = new Tray(iconImage(isMac ? 18 : 16));
    tray.setToolTip(cfg.name);
    tray.on("click", toggleWindow);
    buildTray();
    createWindow();
    registerScheme();
    if (earlyLink) { const l = earlyLink; earlyLink = null; win.webContents.once("did-finish-load", () => handleLink(l)); }
    checkAuth();
    setTimeout(loadMissingIcons, 1500);
    setTimeout(() => checkUpdate(false), 8000);
    setInterval(() => checkUpdate(false), 4 * 60 * 60 * 1000);
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
    app.on("before-quit", e => {
      if (!closingDone && win && !win.isDestroyed() && win.isVisible() && !faded) {
        e.preventDefault(); app.isQuitting = true;
        if (!closing) { closing = true; hideWin(() => { closingDone = true; app.quit(); }); }
        return;
      }
      closingDone = true;
      app.isQuitting = true;
      if (upd && upd.status === "ready") installUpdate(false);
      writeJson("settings.json", cfg); writeJson("data.json", data);
      ses.cookies.flushStore().catch(() => {});
    });
  });
  app.on("activate", () => showWin());
  app.on("will-quit", () => { globalShortcut.unregisterAll(); if (tray && !tray.isDestroyed()) tray.destroy(); });
  app.on("window-all-closed", () => app.quit());
}

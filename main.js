// Exacct AI – your AI in its own window
const { app, BrowserWindow, WebContentsView, ipcMain, screen, Tray, Menu, nativeImage,
        globalShortcut, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const pkg = require("./package.json");

const AIS = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/", hosts: ["chatgpt.com", "openai.com", "auth.openai.com"] },
  claude:  { label: "Claude",  url: "https://claude.ai/new", hosts: ["claude.ai", "anthropic.com"] },
  gemini:  { label: "Gemini",  url: "https://gemini.google.com/app", hosts: ["gemini.google.com", "google.com"] }
};
const SIZES = { small: [420, 640], medium: [820, 720], large: [1200, 860] };
const BAR = 44;
const HOTKEY = "CommandOrControl+Shift+Space";
const isMac = process.platform === "darwin";

const defaultAi = AIS[pkg.exacctAi] ? pkg.exacctAi : "chatgpt";
const DEFAULTS = {
  ai: defaultAi,
  name: "Exacct AI",
  size: "medium", width: 820, height: 720,
  position: "center",           // tl,tc,tr,ml,center,mr,bl,bc,br or "custom"
  x: null, y: null,
  alwaysOnTop: false,
  opacity: 100,
  accent: "#8b5cf6",
  icon: null,                   // data URL of the custom icon
  hotkey: true,
  startup: false
};

const cfgFile = () => path.join(app.getPath("userData"), "settings.json");
let cfg = { ...DEFAULTS };
function loadCfg() {
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch { cfg = { ...DEFAULTS }; }
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); }
}

let win, view, settingsWin, tray;
// Present as a normal Chrome so sign-in pages accept the window
const UA = () => app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\sexacct-ai\/\S+/i, "");

function iconImage(size = 256) {
  let img = cfg.icon ? nativeImage.createFromDataURL(cfg.icon) : nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  return img.resize({ width: size, height: size, quality: "best" });
}

function layout() {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, h - BAR) });
}

function placeWindow() {
  const display = screen.getDisplayMatching(win.getBounds());
  const wa = display.workArea;
  let w, h;
  if (cfg.size === "full") { w = wa.width; h = wa.height; }
  else if (SIZES[cfg.size]) [w, h] = SIZES[cfg.size];
  else { w = cfg.width; h = cfg.height; }
  w = Math.min(Math.max(360, w), wa.width); h = Math.min(Math.max(400, h), wa.height);
  win.setSize(w, h);
  const m = 16;
  const col = { l: wa.x + m, c: wa.x + Math.round((wa.width - w) / 2), r: wa.x + wa.width - w - m };
  const row = { t: wa.y + m, m: wa.y + Math.round((wa.height - h) / 2), b: wa.y + wa.height - h - m };
  const map = { tl: ["l", "t"], tc: ["c", "t"], tr: ["r", "t"], ml: ["l", "m"], center: ["c", "m"], mr: ["r", "m"], bl: ["l", "b"], bc: ["c", "b"], br: ["r", "b"] };
  if (cfg.size === "full") win.setPosition(wa.x, wa.y);
  else if (cfg.position === "custom" && cfg.x != null) win.setPosition(cfg.x, cfg.y);
  else { const [cx, ry] = map[cfg.position] || map.center; win.setPosition(col[cx], row[ry]); }
  layout();
}

function applySettings({ reload = false, place = true } = {}) {
  if (!win) return;
  win.setTitle(cfg.name);
  win.setAlwaysOnTop(!!cfg.alwaysOnTop, "floating");
  win.setOpacity(Math.min(1, Math.max(0.4, cfg.opacity / 100)));
  const ic = iconImage(256);
  if (!isMac) win.setIcon(ic);
  if (isMac && app.dock) app.dock.setIcon(ic);
  if (tray) { tray.setImage(iconImage(isMac ? 18 : 16)); tray.setToolTip(cfg.name); buildTrayMenu(); }
  if (place) placeWindow();
  if (reload) view.webContents.loadURL(AIS[cfg.ai].url, { userAgent: UA() });
  globalShortcut.unregisterAll();
  if (cfg.hotkey) globalShortcut.register(HOTKEY, toggleWindow);
  app.setLoginItemSettings({ openAtLogin: !!cfg.startup });
  win.webContents.send("cfg", publicCfg());
}

function publicCfg() { return { ...cfg, aiLabel: AIS[cfg.ai].label, ais: Object.fromEntries(Object.entries(AIS).map(([k, v]) => [k, v.label])), hotkeyLabel: isMac ? "⌘ ⇧ Space" : "Ctrl + Shift + Space", isMac }; }

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide(); else { win.show(); win.focus(); }
}

function allowedHost(url) {
  try {
    const h = new URL(url).hostname;
    const all = [...AIS[cfg.ai].hosts, "accounts.google.com", "login.microsoftonline.com", "appleid.apple.com", "auth0.openai.com"];
    return all.some(d => h === d || h.endsWith("." + d));
  } catch { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 820, height: 720, minWidth: 360, minHeight: 400, show: false,
    frame: isMac, titleBarStyle: isMac ? "hiddenInset" : undefined,
    trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: "#09090b", title: cfg.name,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  win.loadFile(path.join(__dirname, "bar.html"));

  view = new WebContentsView({ webPreferences: { partition: "persist:exacct", contextIsolation: true, sandbox: true } });
  view.setBackgroundColor("#09090b");
  win.contentView.addChildView(view);
  view.webContents.setUserAgent(UA());
  view.webContents.loadURL(AIS[cfg.ai].url, { userAgent: UA() });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedHost(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: "persist:exacct" } } };
    shell.openExternal(url); return { action: "deny" };
  });
  view.webContents.on("did-navigate", () => win.webContents.send("nav", { canBack: view.webContents.navigationHistory.canGoBack() }));
  view.webContents.on("did-navigate-in-page", () => win.webContents.send("nav", { canBack: view.webContents.navigationHistory.canGoBack() }));

  win.on("resize", layout);
  let moveTimer;
  const remember = () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isFullScreen() || cfg.size === "full") return;
      const b = win.getBounds();
      cfg.x = b.x; cfg.y = b.y; cfg.width = b.width; cfg.height = b.height;
      saveCfg();
    }, 400);
  };
  win.on("moved", () => { cfg.position = "custom"; remember(); });
  win.on("resized", () => { if (cfg.size !== "full") cfg.size = "custom"; remember(); });
  win.on("close", e => { if (!app.isQuitting && cfg.hotkey) { e.preventDefault(); win.hide(); } });
  win.once("ready-to-show", () => { win.show(); });
  win.webContents.on("did-finish-load", () => { applySettings({ place: true }); });
}

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 760, resizable: true, minimizable: false, maximizable: false,
    parent: win, title: cfg.name + " · Settings", backgroundColor: "#09090b", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  if (!isMac) settingsWin.setIcon(iconImage(256));
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
}

function buildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show / hide " + cfg.name, click: toggleWindow },
    { label: "Settings…", click: openSettings },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// ---- IPC ----
ipcMain.handle("cfg:get", () => publicCfg());
ipcMain.handle("cfg:set", (_e, patch) => {
  const before = cfg.ai;
  const allowed = Object.keys(DEFAULTS);
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) cfg[k] = patch[k];
  if (!AIS[cfg.ai]) cfg.ai = before;
  cfg.name = String(cfg.name || "Exacct AI").slice(0, 40);
  const place = ["size", "width", "height", "position"].some(k => k in patch);
  saveCfg();
  applySettings({ reload: cfg.ai !== before, place });
  if (settingsWin) settingsWin.setTitle(cfg.name + " · Settings");
  return publicCfg();
});
ipcMain.handle("cfg:reset", () => { cfg = { ...DEFAULTS }; saveCfg(); applySettings({ reload: true }); return publicCfg(); });
ipcMain.handle("icon:pick", async () => {
  const r = await dialog.showOpenDialog(settingsWin || win, { title: "Choose an icon", properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "ico", "webp"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const img = nativeImage.createFromPath(r.filePaths[0]);
  if (img.isEmpty()) return null;
  return img.resize({ width: 256, height: 256, quality: "best" }).toDataURL();
});
ipcMain.on("win", (_e, act) => {
  if (!win) return;
  if (act === "settings") openSettings();
  if (act === "min") win.minimize();
  if (act === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
  if (act === "close") win.close();
  if (act === "back" && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
  if (act === "reload") view.webContents.reload();
  if (act === "home") view.webContents.loadURL(AIS[cfg.ai].url, { userAgent: UA() });
  if (act === "pin") { cfg.alwaysOnTop = !cfg.alwaysOnTop; saveCfg(); applySettings({ place: false }); }
});

// ---- app ----
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    loadCfg();
    app.setName(cfg.name);
    tray = new Tray(iconImage(isMac ? 18 : 16));
    tray.setToolTip(cfg.name);
    tray.on("click", toggleWindow);
    buildTrayMenu();
    createWindow();
  });
  app.on("activate", () => { if (win) { win.show(); win.focus(); } });
  app.on("before-quit", () => { app.isQuitting = true; });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => { if (!isMac) app.quit(); });
}

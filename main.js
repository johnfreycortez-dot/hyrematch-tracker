// HyreMatch Tracker: a small window and a tray icon. All counting is in lib/engine.js.
const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, desktopCapturer, safeStorage, shell, nativeImage, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');
const { createEngine, TICK } = require('./lib/engine');
const { createApi, DEFAULT_URL } = require('./lib/api');

// HYREMATCH_API is for testing from the source only. The installed app always talks to hyrematch.com.
const API_URL = (!app.isPackaged && process.env.HYREMATCH_API) || DEFAULT_URL;
const SITE = 'https://hyrematch.com/candidate';
let win = null, tray = null, quitting = false, session = '', email = '';

// Starts with the computer (2.0.2), quietly near the clock, so it is already running when the person clocks in.
// Installed app only. The person can turn it off in the tray menu; their choice is kept.
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) || {}; } catch (e) { return {}; } };
const autoStartOn = () => loadPrefs().autoStart !== false;
function setAutoStart(on) {
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...loadPrefs(), autoStart: !!on })); } catch (e) { /* keeps the old choice */ }
  applyAutoStart();
}
function applyAutoStart() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: autoStartOn(), args: ['--hidden'] }); } catch (e) { /* not allowed on this computer: they open it themselves */ }
}
function startedAtLogin() {
  if (process.argv.includes('--hidden')) return true; // Windows
  try { return process.platform === 'darwin' && !!app.getLoginItemSettings().wasOpenedAtLogin; } catch (e) { return false; }
}

// The sign-in is kept encrypted by the operating system (Windows DPAPI / macOS Keychain), never as plain text.
const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');
function loadSession() {
  try {
    const raw = fs.readFileSync(sessionFile());
    const o = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
    session = o.session || ''; email = o.email || '';
  } catch (e) { session = ''; email = ''; }
}
function saveSession() {
  try {
    if (!session) { fs.rmSync(sessionFile(), { force: true }); return; }
    const text = JSON.stringify({ session, email });
    fs.writeFileSync(sessionFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'), { mode: 0o600 });
  } catch (e) { /* signed in for this run only */ }
}

const call = createApi({ url: API_URL, getSession: () => session, onRenew: next => { session = next; saveSession(); } });

// One JPEG per monitor (up to `max`), each 1280 px wide and kept under about 400 KB.
// Only called when this person's client uses screen monitoring (see lib/engine.js).
async function capture(max = 3) {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return [];
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } });
  const out = [];
  for (const src of sources.slice(0, max)) {
    const img = src && src.thumbnail;
    if (!img || img.isEmpty()) continue;
    let jpg = img.toJPEG(55);
    if (jpg.length > 400 * 1024) jpg = img.toJPEG(30);
    if (jpg.length <= 440 * 1024) out.push(jpg.toString('base64'));
  }
  return out;
}

const engine = createEngine({
  now: () => Date.now(),
  idleSeconds: () => powerMonitor.getSystemIdleTime(),
  capture,
  call,
  onChange: () => push(),
});

function state() {
  const s = engine.status();
  const needsScreenAccess = !!(s.view && s.view.shots && process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted');
  return { signedIn: !!session, email, version: app.getVersion(), needsScreenAccess, ...s };
}
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', state());
  if (tray) tray.setToolTip('HyreMatch Tracker' + (engine.status().tracking ? ' · tracking' : ' · not tracking'));
}

function createWindow() {
  win = new BrowserWindow({
    show: !(tray && startedAtLogin()), // started with the computer: stays near the clock until opened
    width: 380, height: 700, resizable: false, maximizable: false, fullscreenable: false, title: 'HyreMatch Tracker', backgroundColor: '#F7F5F0',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://hyrematch.com/')) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Closing the window keeps the app running near the clock (so it is ready when they clock in). Quit is in the tray menu.
  win.on('close', e => { if (!quitting && (tray || engine.status().tracking)) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open HyreMatch Tracker', click: () => { if (win) { win.show(); win.focus(); } } },
      { label: 'Open My work (clock in / out)', click: () => shell.openExternal(SITE) },
      { type: 'separator' },
      ...(app.isPackaged ? [{ label: 'Start with the computer', type: 'checkbox', checked: autoStartOn(), click: item => setAutoStart(item.checked) }, { type: 'separator' }] : []),
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  } catch (e) { tray = null; }
}

// Signs out only when the server says the sign-in is no longer valid. Being offline never signs anyone out.
function expired() { if (session && engine.status().authLost) { session = ''; saveSession(); engine.signOut(); push(); } }

ipcMain.handle('state', () => state());
ipcMain.handle('code.send', async (_e, mail) => { await call('code.send', { email: String(mail || '').trim() }); return true; });
ipcMain.handle('code.verify', async (_e, mail, code) => {
  const r = await call('code.verify', { email: String(mail || '').trim(), code: String(code || '') });
  session = r.session; email = String(mail || '').trim().toLowerCase(); saveSession();
  await engine.refresh();
  return state();
});
ipcMain.handle('accept', async () => { await engine.accept(); return state(); });
ipcMain.handle('refresh', async () => { await engine.refresh(); return state(); });
ipcMain.handle('signout', async () => { await engine.stop(); session = ''; email = ''; saveSession(); engine.signOut(); return state(); });
ipcMain.handle('open', (_e, what) => shell.openExternal(what === 'screen' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' : SITE));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    loadSession();
    applyAutoStart();
    createTray();
    createWindow();
    if (session) await engine.refresh();
    setInterval(() => {
      engine.tick().catch(() => {}).then(expired); // counts, and checks in with the server every 2 minutes
    }, TICK * 1000);
    setInterval(() => { if (session) engine.refresh().catch(() => {}).then(expired); }, 60000);
    powerMonitor.on('suspend', () => { engine.stop(); });
    powerMonitor.on('resume', () => { if (session) engine.refresh().catch(() => {}); });
  });
  app.on('before-quit', e => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    Promise.race([engine.stop(), new Promise(r => setTimeout(r, 4000))]).finally(() => app.exit(0)); // send what was counted, then quit
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (win) win.show(); });
}

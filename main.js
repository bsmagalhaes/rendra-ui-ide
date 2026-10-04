/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// When Rendra IDE is started from inside a Claude Code session it inherits that session's
// markers. Passed on to DevCode terminals, they make a `claude` launched there think it is a
// child session and turn transcript saving off — so those sessions would never be counted.
// Only per-session markers are dropped; user-configured CLAUDE_CODE_* settings are kept.
for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT']) {
  delete process.env[k];
}
const { execFile } = require('child_process');
const Store = require('electron-store');
const { Worker } = require('worker_threads');

// Session scans run in a long-lived worker thread (see src/scan-worker.js)
let scanWorker = null;
let scanSeq = 0;
const scanWaiters = new Map();
function scan(settings) {
  if (!scanWorker) {
    scanWorker = new Worker(path.join(__dirname, 'src', 'scan-worker.js'));
    scanWorker.on('message', ({ id, data, error }) => {
      const w = scanWaiters.get(id);
      if (!w) return;
      scanWaiters.delete(id);
      error ? w.reject(new Error(error)) : w.resolve(data);
    });
    scanWorker.on('error', err => {
      for (const w of scanWaiters.values()) w.reject(err);
      scanWaiters.clear();
      scanWorker = null; // recreated on the next scan
    });
  }
  const id = ++scanSeq;
  return new Promise((resolve, reject) => {
    scanWaiters.set(id, { resolve, reject });
    scanWorker.postMessage({ id, settings });
  });
}
const accountsMod = require('./src/accounts');
const { currentAccount } = accountsMod;
const { registerDevCode } = require('./src/devcode');
const { createGitUpdater } = require('./src/git-updater');
const { selectUpdateSource, initialState, canInstall } = require('./src/update-source');

// ── App identity + data migration ──────────────────────────────────────────
// The app is Rendra IDE; its data folder was "tokenmeter" before the rename. On the first run
// the old folder is copied (settings, workspaces, prices, scan cache, UI state) so nothing is
// lost; Chromium caches are skipped. Must run before any store touches userData.
{
  app.setName('Rendra IDE');
  // RENDRA_DATA_DIR: separate data folder for demos (npm run docs:images) and tests
  const custom = process.env.RENDRA_DATA_DIR;
  const appData = custom ? null : app.getPath('appData');
  const newDir = custom || path.join(appData, 'Rendra IDE');
  app.setPath('userData', newDir);
  const oldDir = appData && path.join(appData, 'tokenmeter');
  if (oldDir && !fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    const skip = /[\\/](Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Shared Dictionary|blob_storage)([\\/]|$)/i;
    try { fs.cpSync(oldDir, newDir, { recursive: true, filter: src => !skip.test(src.slice(oldDir.length)) }); } catch { /* start fresh */ }
  }
}

// Settings file: rendra-config.json (older versions used tokenmeter-config.json, copied once)
{
  const dir = app.getPath('userData');
  const cur = path.join(dir, 'rendra-config.json'), legacy = path.join(dir, 'tokenmeter-config.json');
  if (!fs.existsSync(cur) && fs.existsSync(legacy)) { try { fs.copyFileSync(legacy, cur); } catch { /* start fresh */ } }
}
const store = new Store({ name: 'rendra-config' });

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let lastUsageData = null;

const DEFAULT_SETTINGS = {
  refreshInterval: 60,

  claudePath: '',
  geminiPath: '',
  openAtLogin: false,
  dailyCostAlert: 0,
  limitsSource: 'statusline', // 'api' only when the user opts in
  conptyDll: true, // Windows: ConPTY embarcado do node-pty; false volta ao do sistema (terminais abertos depois)
};

function fmtTokensTray(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');
const WINDOW_ICON = process.platform === 'win32' ? path.join(__dirname, 'assets', 'icon.ico') : ICON_PNG;

function createTrayImage() {
  return nativeImage.createFromPath(ICON_PNG).resize({ width: 16, height: 16 });
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip('Rendra IDE');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir Rendra IDE', click: () => mainWindow?.show() },
    { label: 'Atualizar', click: () => runScan() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow?.show());
}

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 580,
    minHeight: 480,
    frame: false,
    icon: WINDOW_ICON,
    backgroundColor: '#07070d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !process.env.RENDRA_E2E_HIDDEN,
    },
    show: false,
    paintWhenInitiallyHidden: true,
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (process.env.RENDRA_E2E_HIDDEN) {
      // Só nos testes automáticos: janela fora da tela, sem foco, para não atrapalhar quem usa a máquina
      mainWindow.setBounds({ x: -10000, y: 0, width: 1920, height: 1080 }); // tamanho real, só longe da tela
      mainWindow.showInactive();
      return;
    }
    if (process.platform === 'darwin') {
      // macOS: fill the screen's work area (menu bar and Dock stay visible) without the
      // maximized/full-screen state, which isn't how Mac apps normally open
      const { screen } = require('electron');
      mainWindow.setBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea);
    } else {
      mainWindow.maximize(); // Windows / Linux: always open maximized
    }
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; if (quitAfterClose) app.quit(); }); // macOS keeps running without windows
  devcode.guardWindowClose(mainWindow); // asks to save DevCode files before closing
}

async function runScan() {
  const settings = getSettings();
  try {
    const data = await scan({
      ...settings,
      filters: store.get('filters', { days: 90, projects: [] }),
      cacheFile: path.join(app.getPath('userData'), 'scan-cache.json'),
      pricingFile: USER_PRICING,
      aliasesFile: path.join(app.getPath('userData'), 'project-aliases.json'),
    });
    lastUsageData = data;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-updated', data);
    }
    if (tray) {
      const todayTokens = data.claude?.daily?.[data.claude.daily.length - 1]?.totalTokens || 0;
      tray.setToolTip(`Rendra IDE · Hoje: ${fmtTokensTray(todayTokens)} tokens`);
    }
    return data;
  } catch (e) {
    console.error('Scan error:', e);
    return lastUsageData;
  }
}

function startRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  const settings = getSettings();
  const intervalMs = (settings.refreshInterval || 60) * 1000;
  refreshTimer = setInterval(runScan, intervalMs);
}

// IPC handlers
ipcMain.handle('get-usage-data', async () => {
  return await runScan();
});

ipcMain.handle('get-settings', () => getSettings());

ipcMain.handle('save-settings', (_e, newSettings) => {
  store.set('settings', { ...getSettings(), ...newSettings });
  startRefreshTimer();
  return true;
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());
// só http(s): o terminal e as páginas passam texto de fora (src/terminal-env.js)
ipcMain.handle('open-external', (_e, url) => {
  const seguro = require('./src/terminal-env').urlWebSegura(url);
  return seguro ? shell.openExternal(seguro) : false;
});
// Rendra Browser: janela isolada (src/rendra-browser.js); mesmo filtro http(s) do navegador padrão
ipcMain.handle('open-rendra-browser', (_e, url) => {
  const rb = require('./src/rendra-browser');
  return !!rb.criarRendraBrowser(require('electron'), url, { oculta: !!process.env.RENDRA_E2E_HIDDEN });
});

// Janela nova ou navegação que ninguém pediu (window.open do terminal/addon, link com target, location.href) nunca
// acontece: o único caminho de abertura é o clique confirmado (open-external ou Rendra Browser). As páginas do
// Rendra Browser têm política própria (src/rendra-browser.js) e ficam de fora deste filtro.
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const rb = require('./src/rendra-browser');
  const navegaSo = (e, url) => {
    if (wc.session === require('electron').session.fromPartition(rb.PARTICAO)) return;
    if (!rb.navegacaoDoAppPermitida(url, wc.getURL())) e.preventDefault();
  };
  wc.on('will-navigate', navegaSo);
  wc.on('will-redirect', navegaSo);
});

ipcMain.handle('set-filters', async (_e, filters) => {
  store.set('filters', {
    days: parseInt(filters?.days) || 90,
    projects: Array.isArray(filters?.projects) ? filters.projects.map(String) : [],
  });
  return await runScan();
});

// ── Claude account & plan limits (see src/accounts.js) ─────────────────────
// Limits source: 'statusline' (default; Claude Code hands the limits to its statusline command)
// or 'api' (opt-in in Settings; reads every limit with the local Claude Code login)
ipcMain.handle('claude-account', () => currentAccount(getSettings().limitsSource));
// Only the statusline file (no credentials, no network): the title bar reads it every 60 s
ipcMain.handle('limits:statusline', () => accountsMod.statuslineLimits());
// Canal leve da barra de título (a cada 60 s): identidade e limites por provedor e ambiente, sem
// credenciais, sem rede e sem tokens (ver src/provider-snapshot.js). wsl: false = só o sistema local;
// wsl: true = as distros em execução (a barra pede as duas e mostra o local sem esperar o WSL).
// Nunca rejeita: o Electron registra no console a rejeição de um ipcMain.handle.
ipcMain.handle('provider:snapshot', async (_e, opts) => {
  try {
    return await require('./src/provider-snapshot').snapshotProvedores({ wsl: !!opts?.wsl }, {
      homeIde: accountsMod.HOME,
      codexHome: require('./src/codex-parser').codexHome,
      statuslineLimits: accountsMod.statuslineLimits,
      contaClaudeDoHome: accountsMod.contaClaudeDoHome,
      lerContaCodex: require('./src/codex-account').lerContaCodex,
      limitesLeves: require('./src/codex-limits').limitesLeves,
      wslRoots: () => require('./src/wsl-roots').wslRoots(),
      pulaWsl: !!(process.env.RENDRA_HOME || process.env.RENDRA_NO_WSL),
    });
  } catch { return []; }
});
ipcMain.handle('limits:bridge-status', () => accountsMod.statuslineStatus());
ipcMain.handle('limits:bridge-install', () => accountsMod.installStatusline(path.join(__dirname, 'src', 'statusline.sh')));
ipcMain.handle('limits:bridge-uninstall', () => accountsMod.uninstallStatusline());

// ── DevCode tab: explorer, editor files, terminals (see src/devcode.js) ─────
const devcode = registerDevCode({ ipcMain, dialog, store, getWindow: () => mainWindow });

// ── Prices (Preços page) ───────────────────────────────────────────────────
// The user's table lives in pricing-user.json (app data folder) and overrides the bundled
// pricing.json. Saving or fetching re-runs the scan so every cost is recalculated.
const USER_PRICING = path.join(app.getPath('userData'), 'pricing-user.json');
const pricingSync = require('./src/pricing-sync');

function readPricing() {
  const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8'));
  let user = null;
  try { user = JSON.parse(fs.readFileSync(USER_PRICING, 'utf8')); } catch { /* none yet */ }
  // a table that came from the feed is superseded once an app update ships the same or newer one
  const newer = (a, b) => ['claude', 'codex'].every(w => (a?.[w] || '') >= (b?.[w] || ''));
  if (user?.origin === 'feed' && newer(bundled.updatedAt, user.updatedAt)) user = null;
  return {
    custom: !!user && user.origin !== 'feed',
    origin: user ? user.origin || 'manual' : 'bundled',
    sources: pricingSync.SOURCES,
    claude: user?.claude?.length ? user.claude : bundled.claude,
    codex: user?.codex?.length ? user.codex : bundled.codex,
    codexCreditUsd: user && 'codexCreditUsd' in user ? user.codexCreditUsd : bundled.codexCreditUsd ?? null,
    webSearchPer1k: user?.webSearchPer1k ?? bundled.webSearchPer1k ?? 10,
    updatedAt: user ? (user.updatedAt || {}) : (bundled.updatedAt || {}),
  };
}

function writePricing(data) {
  const clean = rows => (rows || []).filter(r => r && r.pattern).map(r => {
    const o = { label: String(r.label || r.pattern), pattern: String(r.pattern).toLowerCase().trim() };
    for (const k of ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead', 'fastInput', 'fastOutput', 'cachedInput']) {
      const v = parseFloat(r[k]);
      if (Number.isFinite(v) && v >= 0) o[k] = v;
    }
    return o;
  });
  const rate = parseFloat(data.codexCreditUsd);
  fs.writeFileSync(USER_PRICING, JSON.stringify({
    claude: clean(data.claude),
    codex: clean(data.codex),
    codexCreditUsd: Number.isFinite(rate) && rate > 0 ? rate : null,
    webSearchPer1k: Number.isFinite(parseFloat(data.webSearchPer1k)) ? parseFloat(data.webSearchPer1k) : 10,
    updatedAt: data.updatedAt || {},
    origin: data.origin === 'feed' ? 'feed' : 'manual',
  }, null, 2));
}

ipcMain.handle('pricing:get', () => readPricing());
ipcMain.handle('pricing:save', async (_e, data) => {
  writePricing({ ...readPricing(), ...data, origin: 'manual' }); // edited by hand on the Preços page
  await runScan();
  return readPricing();
});
ipcMain.handle('pricing:reset', async () => {
  try { fs.unlinkSync(USER_PRICING); } catch { /* already default */ }
  await runScan();
  return readPricing();
});
// ── Price feed: pricing.json published in the Rendra IDE GitHub repo ───────
// The app never reads the vendors' sites: the maintainer runs `npm run prices:update` and pushes
// pricing.json; every install checks that file when it opens and offers newer prices.
const BRAND = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).rendra || {};
const feedConfigured = () => !!BRAND.pricingFeed;

async function fetchFeed() {
  const res = await fetch(BRAND.pricingFeed, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await res.json();
  if (!Array.isArray(feed.claude) || !Array.isArray(feed.codex)) throw new Error('arquivo de preços inválido');
  return feed;
}

// Which tables of the feed are newer than the ones in use (dates are YYYY-MM-DD)
async function checkFeed() {
  if (!feedConfigured()) return { configured: false };
  try {
    const feed = await fetchFeed();
    const cur = readPricing();
    const newer = ['claude', 'codex'].filter(w => (feed.updatedAt?.[w] || '') > (cur.updatedAt?.[w] || ''));
    return { configured: true, newer, remote: feed.updatedAt || {}, current: cur.updatedAt || {} };
  } catch (e) {
    return { configured: true, error: e.message, newer: [] };
  }
}

ipcMain.handle('pricing:check-feed', () => checkFeed());

// ── Updates ─────────────────────────────────────────────────────────────────
// Copies installed with git clone + npm install (how Rendra IDE is distributed) update through
// src/git-updater.js. Packaged builds, if they are ever published, use electron-updater with
// GitHub Releases. Either way settings, workspaces, prices and caches live in the user data
// folder, which updates never touch.
const gitUpdater = createGitUpdater({
  root: __dirname,
  dataDir: app.getPath('userData'),
  currentVersion: app.getVersion(),
  send: sendUpdate,
});
const updateSource = selectUpdateSource({
  isPackaged: app.isPackaged,
  windowsStore: !!process.windowsStore,
  isClone: gitUpdater.isClone,
});
let updateState = initialState(updateSource);
let quitAfterClose = false;
function sendUpdate(state) {
  updateState = state;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', state);
}
function initAutoUpdate() {
  if (updateSource === 'git') { gitUpdater.start(); return; }
  if (updateSource !== 'updater') return; // store: a Store atualiza; none: sem origem
  const repo = BRAND.githubRepo || '';
  if (!repo) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', info => sendUpdate({ state: 'downloading', version: info.version }));
  autoUpdater.on('download-progress', p => sendUpdate({ ...updateState, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', e => sendUpdate({ state: 'error', error: e.message }));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline: try later */ });
  setTimeout(check, 10000);
  setInterval(check, 6 * 60 * 60 * 1000);
  ipcMain.removeHandler('update:install');
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall()); // the unsaved-files guard still asks
}
ipcMain.handle('update:status', () => updateState);
ipcMain.handle('update:check', () => updateSource === 'git' || updateSource === 'none' ? gitUpdater.check() : updateState);
ipcMain.handle('update:last-result', () => gitUpdater.lastResult());
// git clones: quit through the normal close (asks to save edited files); the helper runs on quit
ipcMain.handle('update:install', () => canInstall(updateSource)
  ? gitUpdater.install(() => { quitAfterClose = true; app.quit(); })
  : { ok: true, noop: true });
app.on('will-quit', () => gitUpdater.onQuit());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('pricing:apply-feed', async () => {
  try {
    const feed = await fetchFeed();
    const cur = readPricing();
    // the user's own settings (credit value, web search rate) are kept
    writePricing({ ...cur, claude: feed.claude, codex: feed.codex, updatedAt: feed.updatedAt || {}, origin: 'feed' });
    await runScan();
    return { ok: true, pricing: readPricing() };
  } catch (e) {
    return { ok: false, error: e.message, pricing: readPricing() };
  }
});

// ── About page: changelog and licenses ─────────────────────────────────────
// Third-party notices are read from the packages actually shipped (production dependency tree)
function shippedPackages() {
  const seen = new Map();
  const walk = name => {
    if (seen.has(name)) return;
    const dir = path.join(__dirname, 'node_modules', name);
    let pj;
    try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return; }
    const licenseFile = fs.readdirSync(dir).find(f => /^(licen[cs]e|copying)/i.test(f));
    seen.set(name, {
      name, version: pj.version,
      license: typeof pj.license === 'string' ? pj.license : (pj.license?.type || 'ver pacote'),
      homepage: pj.homepage || (typeof pj.repository === 'string' ? pj.repository : pj.repository?.url) || '',
      licenseFile: licenseFile ? path.join(dir, licenseFile) : null,
    });
    for (const d of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies })) walk(d);
  };
  const root = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  for (const d of Object.keys(root.dependencies || {})) walk(d);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

ipcMain.handle('about:get', () => {
  const read = f => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { return ''; } };
  const pkg = JSON.parse(read('package.json'));
  return {
    version: pkg.version,
    site: pkg.rendra?.site || '',
    author: pkg.author,
    repo: pkg.rendra?.githubRepo ? `https://github.com/${pkg.rendra.githubRepo}` : '',
    electron: process.versions.electron,
    changelog: read('CHANGELOG.md'),
    license: read('LICENSE'),
    packages: shippedPackages().map(({ licenseFile, ...p }) => ({ ...p, hasText: !!licenseFile })),
  };
});

// Full license text of one shipped package, or of RTK (not shipped: downloaded from its repo)
ipcMain.handle('about:license-text', (_e, name) => {
  if (name === 'rtk') { try { return fs.readFileSync(path.join(__dirname, 'licenses', 'RTK-LICENSE.txt'), 'utf8'); } catch { return ''; } }
  const p = shippedPackages().find(x => x.name === name);
  try { return p?.licenseFile ? fs.readFileSync(p.licenseFile, 'utf8') : ''; } catch { return ''; }
});

// ── Environment setup: Git Bash, RTK, WSL (see src/setup.js) ────────────────
// Offered automatically on first launch (right after installing) and from Settings.
const setup = require('./src/setup');
ipcMain.handle('setup:check', () => setup.check());
ipcMain.handle('setup:state', () => ({ dismissed: !!store.get('setup.dismissed') }));
ipcMain.handle('setup:dismiss', () => { store.set('setup.dismissed', true); return true; });
ipcMain.handle('setup:install', async (_e, items = []) => {
  const log = msg => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('setup:log', msg); };
  const steps = {
    git: () => setup.installGit(log),
    rtk: () => setup.installRtk(log),
    'rtk-hook': () => setup.enableRtkHook(log),
    wsl: () => setup.installWsl(log),
  };
  const results = {};
  for (const key of ['git', 'rtk', 'rtk-hook', 'wsl'].filter(k => items.includes(k))) {
    try {
      results[key] = await steps[key]();
      log(`✔ ${key} concluído`);
    } catch (e) {
      results[key] = { ok: false, error: e.message };
      log(`✖ ${key}: ${e.message}`);
    }
  }
  return { results, status: await setup.check() };
});
app.on('before-quit', () => devcode.killAll());

// ── RTK (Rust Token Killer) ────────────────────────────────────────────────
// Comandos permitidos na UI e o estado por ambiente e agente: src/rtk-status.js
// Só nos testes de ponta a ponta (janela escondida e home falso): o `rtk` é um script que devolve
// dados fictícios (scripts/e2e-rtk-fake.js), executado pelo próprio Electron como Node. Sem as duas
// variáveis, RENDRA_E2E_RTK_BIN é ignorada.
const e2eRtk = process.env.RENDRA_E2E_HIDDEN && process.env.RENDRA_HOME && process.env.RENDRA_E2E_RTK_BIN || null;
const execRtkFile = (file, args, opts, cb) => (e2eRtk && file === e2eRtk
  ? execFile(process.execPath, [e2eRtk, ...args], { ...opts, env: { ...opts.env, ELECTRON_RUN_AS_NODE: '1' } }, cb)
  : execFile(file, args, opts, cb));

function rtkBinary() {
  if (e2eRtk) return e2eRtk;
  const local = path.join(require('os').homedir(), '.local', 'bin', process.platform === 'win32' ? 'rtk.exe' : 'rtk');
  return fs.existsSync(local) ? local : 'rtk';
}

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function runRtk(args, timeout = 60000) {
  return new Promise(resolve => {
    execRtkFile(rtkBinary(), args, {
      timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0' },
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        missing: err?.code === 'ENOENT',
        output: stripAnsi(stdout) + (stderr ? '\n' + stripAnsi(stderr) : ''),
      });
    });
  });
}

const { createRtkEnv } = require('./src/rtk-env');
const { createRtkStatus } = require('./src/rtk-status');
const { createRtkInstall } = require('./src/rtk-install');
const { createRtkEnable } = require('./src/rtk-enable');
const { registerRtkIpc } = require('./src/rtk-ipc');
const rtkEnv = createRtkEnv(e2eRtk ? { rtkPath: async () => e2eRtk, execFile: execRtkFile } : {});
const rtkInstall = createRtkInstall({ env: rtkEnv });
const rtkStatus = createRtkStatus({
  env: rtkEnv,
  runRtk,
  hostWarnings: agents => (e2eRtk ? [] : rtkInstall.hostWarnings(agents)), // no e2e não se consulta o PATH real
  // o campo `codex` de antes (instalação e AGENTS.md), que a página ainda lê
  codexLegacy: async () => {
    const codexHome = process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex');
    // o Codex também pode estar numa distro WSL (terminal WSL): vale a que tiver instalação
    const wsl = process.env.RENDRA_HOME || process.env.RENDRA_NO_WSL ? { codex: [] } : await require('./src/wsl-roots').wslRoots();
    return require('./src/codex-rtk').codexRtkState(codexHome, wsl.codex);
  },
});
registerRtkIpc({
  ipcMain,
  env: rtkEnv,
  status: rtkStatus,
  install: rtkInstall,
  enable: createRtkEnable({ env: rtkEnv, inspect: rtkStatus.inspect }),
  log: msg => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('setup:log', msg); },
});

ipcMain.handle('show-notification', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  startRefreshTimer();
  initAutoUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

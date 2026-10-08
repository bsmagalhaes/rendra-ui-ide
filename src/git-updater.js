/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Updates for copies installed with `git clone` + `npm install` (the way Rendra IDE is distributed).
// The app compares its version with package.json on the remote branch; a new version appears when
// the maintainer publishes one (version bump + tag), not on every commit. Installing closes the app
// through the normal window close (which asks to save edited files) and hands off to
// scripts/apply-update.js, which runs `git pull --ff-only` + `npm install` after the app has exited
// (native modules and electron.exe are locked while it runs) and reopens it. User data lives in
// the app data folder, which updates never touch.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const run = (cmd, args, cwd, timeout = 60000) => new Promise(resolve => {
  execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }));
});

// 1.10.0 > 1.9.3; pre-release tags are ignored
function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('-')[0].split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

// Section "## X.Y.Z · date" of a CHANGELOG, without its heading
function changelogSection(md, version) {
  const lines = String(md || '').split(/\r?\n/);
  const start = lines.findIndex(l => new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

function createGitUpdater({ root, dataDir, currentVersion, send }) {
  const resultFile = path.join(dataDir, 'update-result.json');
  const isClone = fs.existsSync(path.join(root, '.git'));
  let state = { state: 'idle', mode: isClone ? 'git' : 'none' };
  let pending = false;
  const set = s => { state = { mode: 'git', ...s }; send(state); };

  async function check() {
    if (!isClone || pending) return state;
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root)).out || 'main';
    const fetched = await run('git', ['fetch', '--quiet', 'origin', branch], root);
    if (!fetched.ok) return state; // offline or no remote: try again later
    const remotePkg = await run('git', ['show', `origin/${branch}:package.json`], root);
    let version = null;
    try { version = JSON.parse(remotePkg.out).version; } catch { return state; }
    if (compareVersions(version, currentVersion) <= 0) { set({ state: 'idle' }); return state; }
    const log = await run('git', ['show', `origin/${branch}:CHANGELOG.md`], root);
    const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=no'], root)).out;
    set({ state: 'available', version, branch, notes: changelogSection(log.out, version), localChanges: !!dirty });
    return state;
  }

  // Called by the renderer ("Nova versão" button): quit the app; the helper finishes the job
  function install(closeApp) {
    if (state.state !== 'available') return { ok: false, error: 'Nenhuma atualização disponível' };
    const node = findOnPath('node');
    if (!node) return { ok: false, error: 'Node.js não encontrado no PATH. Atualize pelo terminal: git pull e npm install' };
    pending = { node };
    closeApp();
    return { ok: true };
  }

  // app 'will-quit': start the helper only if the window really closed (the user may cancel)
  function onQuit() {
    if (!pending) return;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(pending.node, [path.join(root, 'scripts', 'apply-update.js'),
      '--root', root, '--pid', String(process.pid), '--result', resultFile], {
      cwd: root, env, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    pending = false;
  }

  // Outcome of the last update, shown once on the next start
  function lastResult() {
    try {
      const r = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      fs.unlinkSync(resultFile);
      return r;
    } catch { return null; }
  }

  function start() {
    if (!isClone) return;
    setTimeout(check, 10000);
    setInterval(check, 6 * 60 * 60 * 1000);
  }

  return { check, install, onQuit, lastResult, start, status: () => state, get isClone() { return isClone; } };
}

module.exports = { createGitUpdater, compareVersions, changelogSection };

/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: adaptador de ambiente. Um "ambiente" é o sistema onde um agente roda: o host da IDE
// (Windows, Linux ou macOS) ou uma distro WSL em execução. Tudo o que o RTK precisa passa por
// aqui: executar um programa, ler e gravar arquivo, achar o `rtk`. Nunca acorda distro parada.
// Na distro, o programa roda por `wsl.exe -d <distro> -e <programa> <args...>`: argumento por
// argumento, sem shell no meio (nada é interpolado em script).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const DISTRO_OK = /^[A-Za-z0-9._-]+$/;
const RUN_TIMEOUT = 8000;
const HOME_TTL = 60000;
const LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function createRtkEnv(deps = {}) {
  const platform = deps.platform || process.platform;
  const procEnv = deps.env || process.env;
  // RENDRA_HOME: home falso de demonstração e testes (o mesmo que accounts.js e scanner.js usam)
  const homedir = deps.homedir || (() => procEnv.RENDRA_HOME || os.homedir());
  const fsx = deps.fs || fs;
  const now = deps.now || Date.now;
  const exec = deps.execFile || execFile;
  const listDistros = deps.listWslDistros || ((...a) => require('./setup').listWslDistros(...a));
  const toWslUnc = deps.toWslUnc || ((...a) => require('./devcode').toWslUnc(...a));
  const hostRtkPath = deps.rtkPath || (() => require('./setup').rtkPath());
  const homes = new Map(); // distro -> { home, at }

  const HOST = { id: 'host', kind: 'host', label: LABEL[platform] || platform, platform, running: true };

  // O host sempre; as distros só no Windows e sem RENDRA_HOME / RENDRA_NO_WSL (mesmo desligamento
  // da varredura WSL em main.js). docker-desktop já vem filtrada de listWslDistros.
  async function listEnvironments() {
    const out = [HOST];
    if (platform !== 'win32' || procEnv.RENDRA_HOME || procEnv.RENDRA_NO_WSL) return out;
    let distros = null;
    try { distros = await listDistros(4000); } catch { distros = null; }
    for (const d of distros || []) {
      if (!DISTRO_OK.test(d.name)) continue;
      out.push({
        id: d.name, kind: 'wsl', label: d.name, name: d.name, platform: 'linux',
        state: d.state, running: d.state === 'Running', version: d.version, isDefault: !!d.isDefault,
      });
    }
    return out;
  }

  // O id vem do renderer: só vale o que listEnvironments devolve, e nome de distro é conferido
  // antes de entrar em argv ou caminho UNC.
  async function resolveEnvironment(id) {
    if (typeof id !== 'string' || !id) return null;
    if (id === 'host') return HOST;
    if (!DISTRO_OK.test(id)) return null;
    return (await listEnvironments()).find(e => e.kind === 'wsl' && e.id === id) || null;
  }

  // ── Execução ───────────────────────────────────────────────────────────────
  function spawn(file, args, { env: extra, timeout = RUN_TIMEOUT } = {}) {
    return new Promise(resolve => {
      exec(file, args, {
        windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
        env: { ...procEnv, NO_COLOR: '1', CLICOLOR: '0', ...(file === 'wsl.exe' ? {} : extra) },
      }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        const timedOut = !!(err.killed && err.signal) || err.code === 'ETIMEDOUT';
        resolve({
          ok: false, code: err.code ?? 1, missing: err.code === 'ENOENT', timedOut,
          state: timedOut ? 'error' : undefined,
          stdout: String(stdout || ''), stderr: String(stderr || ''),
        });
      });
    });
  }

  // run(env, [programa, ...args], { env: {K: V}, timeout })
  async function run(e, argv, opts = {}) {
    if (!Array.isArray(argv) || !argv.length) throw new Error('argv vazio');
    if (e.kind === 'host') return spawn(argv[0], argv.slice(1), opts);
    if (!e.running) return { ok: false, state: 'wsl-off', stdout: '', stderr: '' };
    if (!DISTRO_OK.test(e.name)) throw new Error('nome de distro inválido');
    const vars = Object.entries(opts.env || {}).map(([k, v]) => `${k}=${v}`);
    const args = ['-d', e.name, '-e', ...(vars.length ? ['env', ...vars] : []), ...argv];
    return spawn('wsl.exe', args, { timeout: opts.timeout });
  }

  // ── Pastas do ambiente ─────────────────────────────────────────────────────
  async function homeOf(e) {
    if (e.kind === 'host') return homedir();
    const c = homes.get(e.name);
    if (c && now() - c.at < HOME_TTL) return c.home;
    const r = await run(e, ['sh', '-c', 'printf %s "$HOME"']);
    if (!r.ok) return null;
    const home = r.stdout.trim();
    if (!home.startsWith('/')) return null;
    homes.set(e.name, { home, at: now() });
    return home;
  }

  // { platform, home, claudeDir, codexDir } do ambiente (null se a distro não responder)
  async function agentDirs(e) {
    const home = await homeOf(e);
    if (!home) return null;
    if (e.kind === 'host') {
      const p = platform === 'win32' ? path.win32 : path.posix;
      return {
        platform, home,
        claudeDir: procEnv.CLAUDE_CONFIG_DIR || p.join(home, '.claude'),
        codexDir: procEnv.CODEX_HOME || p.join(home, '.codex'),
      };
    }
    return { platform: 'linux', home, claudeDir: `${home}/.claude`, codexDir: `${home}/.codex` };
  }

  // Pasta que o Codex põe na chave de hooks.state: com CODEX_HOME ele canoniza o caminho (junção, link,
  // caixa real do disco, barras; sem o prefixo de caminho longo); sem CODEX_HOME usa <home>/.codex como está.
  // Distro WSL: a IDE não conhece o CODEX_HOME de lá, então vale a pasta padrão.
  async function codexKeyDir(e, dirs) {
    if (e.kind !== 'host' || !procEnv.CODEX_HOME) return dirs.codexDir;
    try {
      const real = (fsx.realpathSync.native || fsx.realpathSync)(dirs.codexDir);
      return platform === 'win32' ? real.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '') : real;
    } catch { return dirs.codexDir; }
  }

  // O `rtk` do ambiente: <home>/.local/bin/rtk; se faltar, o que o PATH da distro achar
  async function findRtk(e) {
    if (e.kind === 'host') return (await hostRtkPath()) || null;
    if (!e.running) return null;
    const home = await homeOf(e);
    if (!home) return null;
    const local = `${home}/.local/bin/rtk`;
    if (await exists(e, local)) return local;
    const r = await run(e, ['sh', '-c', 'command -v rtk']);
    const found = r.ok ? r.stdout.trim().split(/\r?\n/)[0] : '';
    return found.startsWith('/') ? found : null;
  }

  // ── Arquivos: host por fs; distro pelo UNC (arquivo pequeno; sqlite nunca) ──
  const fsPath = (e, p) => (e.kind === 'host' ? p : toWslUnc(e.name, p));
  const guard = e => (e.kind === 'wsl' && !e.running ? { ok: false, state: 'wsl-off' } : null);

  async function exists(e, p) {
    if (guard(e)) return false;
    try { return fsx.existsSync(fsPath(e, p)); } catch { return false; }
  }
  async function readFile(e, p) {
    const g = guard(e);
    if (g) return { ...g, text: null };
    try { return { ok: true, text: fsx.readFileSync(fsPath(e, p), 'utf8') }; }
    catch (err) { return { ok: false, text: null, missing: err.code === 'ENOENT', error: err.message }; }
  }
  async function stat(e, p) {
    if (guard(e)) return null;
    try { const s = fsx.statSync(fsPath(e, p)); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; }
  }
  async function mkdirp(e, p) {
    const g = guard(e);
    if (g) return g;
    try { fsx.mkdirSync(fsPath(e, p), { recursive: true }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  }
  async function rename(e, from, to) {
    const g = guard(e);
    if (g) return g;
    try { fsx.renameSync(fsPath(e, from), fsPath(e, to)); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  }
  async function remove(e, p) {
    const g = guard(e);
    if (g) return g;
    try { fsx.rmSync(fsPath(e, p), { force: true }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  }
  // Grava e relê para conferir (escrita por UNC nunca é dada como certa); em falha devolve o erro
  // sem tentar outro caminho.
  async function writeFile(e, p, text, { mode } = {}) {
    const g = guard(e);
    if (g) return g;
    try {
      fsx.mkdirSync(path.dirname(fsPath(e, p)), { recursive: true });
      fsx.writeFileSync(fsPath(e, p), text, mode ? { mode } : undefined);
      // texto ou binário (Buffer): a releitura é do mesmo tipo
      const bin = Buffer.isBuffer(text);
      const back = bin ? fsx.readFileSync(fsPath(e, p)) : fsx.readFileSync(fsPath(e, p), 'utf8');
      if (bin ? !back.equals(text) : back !== text) return { ok: false, error: `O arquivo ${p} foi gravado, mas ao reler o conteúdo não confere.` };
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  return {
    HOST, listEnvironments, resolveEnvironment, run, homeOf, agentDirs, codexKeyDir, findRtk,
    exists, readFile, stat, mkdirp, rename, remove, writeFile, fsPath,
  };
}

module.exports = { createRtkEnv, DISTRO_OK };

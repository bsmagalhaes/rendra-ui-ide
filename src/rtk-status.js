/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: leitura do estado por ambiente (host e distros WSL) e por agente (Claude Code, Codex).
// Cada agente grava num banco próprio (RTK_DB_PATH); a leitura é `rtk gain --all --format json`
// com o banco do agente, executada pelo `rtk` do próprio ambiente (sem sqlite, sem UNC para banco).
// A leitura nunca cria arquivo: se o banco do agente não existe, devolve zeros sem chamar o rtk.

const path = require('path');
const P = require('./rtk-paths');
const C = require('./rtk-config');
const { plannedFiles, TRUST_MSG } = require('./rtk-enable');

// Somente leitura. Nada que apague ou configure (gain --reset, init -g): ativar é o canal rtk-enable.
const RTK_COMMANDS = {
  gain:      ['gain'],
  graph:     ['gain', '--graph'],
  history:   ['gain', '--history'],
  quota:     ['gain', '--quota'],
  periods:   ['gain', '--all'],
  failures:  ['gain', '--failures'],
  session:   ['session'],
  discover:  ['discover', '--all'],
  economics: ['cc-economics'],
  init:      ['init', '--show'],
  config:    ['config'],
  version:   ['--version'],
};

const ZERO_GAIN = () => ({
  summary: { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, avg_savings_pct: 0, total_time_ms: 0, avg_time_ms: 0 },
  daily: [], weekly: [], monthly: [],
});

// Rows of the "By Command" table in `rtk gain` text output (só existe no texto, F48)
function parseRtkByCommand(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\.\s+(.+?)\s{2,}(\d+)\s+([\d.]+[KMB]?)\s+([\d.]+)%\s+(\S+)/);
    if (m) rows.push({ command: m[1], count: +m[2], saved: m[3], pct: +m[4], time: m[5] });
  }
  return rows;
}

// Chips de "Status da instalação": só Claude Code e Codex, por sistema, montados dos dados que a IDE
// já tem (hook, caminho absoluto, banco no env, aprovação do Codex). Nada de OpenCode, Cursor nem
// CLAUDE.md local, e nada vem do texto do `rtk init --show`.
const AGENT_NAME = { claude: 'Claude Code', codex: 'Codex' };
function buildChecks(environments) {
  const out = [];
  for (const e of environments || []) {
    if (e.state !== 'ok' || !e.agents) continue;
    for (const agent of ['claude', 'codex']) {
      const a = e.agents[agent];
      if (!a || (!a.installed && !a.hook)) continue;
      const nome = `${AGENT_NAME[agent]} (${e.label})`;
      if (!a.hook) { out.push({ ok: false, text: `${nome}: RTK não ativado` }); continue; }
      if (!a.hookAbsolute || !a.dbEnvConfigured) { out.push({ ok: false, text: `${nome}: ativação incompleta` }); continue; }
      if (agent === 'claude') { out.push({ ok: true, text: `${nome}: RTK ativo` }); continue; }
      if (a.trust === 'trusted') out.push({ ok: true, text: `${nome}: RTK ativo e aprovado` });
      else if (a.trust === 'modified') out.push({ ok: false, text: `${nome}: hook alterado, falta aprovar` });
      else out.push({ ok: false, text: `${nome}: falta aprovar o hook` });
    }
  }
  return out;
}

const stripAnsi = s => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// deps: env (createRtkEnv), processEnv, runRtk (host: usado por rtk-run e pelas peças só do host),
//       codexLegacy (() => campo `codex` de antes, ver src/codex-rtk.js)
function createRtkStatus(deps) {
  const { env, runRtk } = deps;
  const procEnv = deps.processEnv || process.env;

  const emptyAgents = () => ({
    claude: { installed: false, hook: false, hookAbsolute: false, dbEnvConfigured: false, dbPath: null, gain: ZERO_GAIN(), error: null },
    codex: {
      installed: false, hook: false, hookAbsolute: false, dbEnvConfigured: false, dbPath: null, trust: null,
      gain: ZERO_GAIN(), error: null,
    },
  });

  async function readGain(e, rtk, dbPath) {
    // `rtk gain` com RTK_DB_PATH inexistente cria pastas e banco vazio (F47): a leitura não pode criar arquivo
    if (!(await env.exists(e, dbPath))) return { gain: ZERO_GAIN(), error: null };
    const r = await env.run(e, [rtk, 'gain', '--all', '--format', 'json'], { env: { RTK_DB_PATH: dbPath }, timeout: 15000 });
    if (!r.ok) return { gain: ZERO_GAIN(), error: r.timedOut ? 'tempo esgotado ao ler o banco' : (stripAnsi(r.stderr || r.stdout).trim().split('\n').pop() || 'falha ao ler o banco') };
    try {
      const g = JSON.parse(r.stdout);
      if (!g || typeof g !== 'object' || !g.summary) throw new Error('sem summary');
      return { gain: g, error: null };
    } catch { return { gain: ZERO_GAIN(), error: 'resposta do rtk gain não é um JSON válido' }; }
  }

  async function inspect(e) {
    const out = {
      id: e.id, kind: e.kind, label: e.label, state: 'ok', version: null, versionText: null,
      needsUpdate: false, rtk: null, agents: emptyAgents(),
    };
    if (e.kind === 'wsl' && !e.running) return { ...out, state: 'wsl-off', agents: {} };
    const dirs = await env.agentDirs(e);
    if (!dirs) return { ...out, state: 'error', error: 'Não foi possível ler a pasta pessoal do sistema.' };
    const rtk = await env.findRtk(e);
    if (!rtk) return { ...out, state: 'missing' };
    out.rtk = rtk;
    const v = await env.run(e, [rtk, '--version'], { timeout: 8000 });
    if (!v.ok) return { ...out, state: v.missing ? 'missing' : 'error', error: v.timedOut ? 'tempo esgotado' : undefined };
    out.versionText = stripAnsi(v.stdout).trim();
    out.version = P.parseRtkVersion(out.versionText);
    out.needsUpdate = !!out.version && P.compareVersions(out.version, P.RTK_MIN) < 0;

    const p = dirs.platform === 'win32' ? path.win32 : path.posix;
    const pathEnv = e.kind === 'host' ? procEnv : {};
    const o = { platform: dirs.platform, env: pathEnv, home: dirs.home };
    const settingsPath = p.join(dirs.claudeDir, 'settings.json');
    const hooksPath = p.join(dirs.codexDir, 'hooks.json');
    const tomlPath = p.join(dirs.codexDir, 'config.toml');
    const [settings, hooks, toml] = await Promise.all([
      env.readFile(e, settingsPath), env.readFile(e, hooksPath), env.readFile(e, tomlPath),
    ]);
    const settingsText = settings.text || '';
    const hooksText = hooks.text || '';
    const tomlText = toml.text || '';

    const [claudeHere, codexHere] = await Promise.all([env.exists(e, dirs.claudeDir), env.exists(e, dirs.codexDir)]);
    const claudeDb = P.claudeDbPath(o);
    const codexDb = P.codexDbPath(o);
    const [cg, xg] = await Promise.all([readGain(e, rtk, claudeDb), readGain(e, rtk, codexDb)]);
    const keyPath = p.join(await env.codexKeyDir(e, dirs), 'hooks.json');
    const trust = C.codexHookTrust(hooksText, tomlText, keyPath);
    out.agents = {
      claude: {
        installed: claudeHere,
        hook: C.hasRtkHook(settingsText, 'claude'),
        hookAbsolute: C.isAbsoluteHook(settingsText, 'claude'),
        dbEnvConfigured: C.claudeDbEnv(settingsText) === claudeDb,
        dbPath: claudeDb, gain: cg.gain, error: cg.error,
        files: plannedFiles('claude', dirs, pathEnv),
      },
      codex: {
        installed: codexHere,
        hook: C.hasRtkHook(hooksText, 'codex'),
        hookAbsolute: C.isAbsoluteHook(hooksText, 'codex'),
        dbEnvConfigured: C.codexDbEnv(tomlText) === codexDb,
        trust: trust.state === 'no-hook' ? null : trust.state,
        trustMessage: trust.state === 'modified' || trust.state === 'untrusted' ? TRUST_MSG : null,
        dbPath: codexDb, gain: xg.gain, error: xg.error,
        files: plannedFiles('codex', dirs, pathEnv),
      },
    };
    return out;
  }

  // Ambientes em paralelo; um que falha não derruba os outros
  async function status() {
    const envs = await env.listEnvironments();
    const environments = await Promise.all(envs.map(e => inspect(e).catch(err => ({
      id: e.id, kind: e.kind, label: e.label, state: 'error', error: err.message, version: null, needsUpdate: false, agents: {},
    }))));
    const host = environments.find(x => x.kind === 'host');
    // avisos do host (cópia do WinGet defasada): só orientam, nunca mexem
    if (host && deps.hostWarnings) host.warnings = await Promise.resolve(deps.hostWarnings(host.agents)).catch(() => []);
    const base = { environments, min: P.RTK_MIN };
    if (!host || host.state === 'missing') {
      return { ...base, installed: false, missing: true, output: '', codex: deps.codexLegacy ? await deps.codexLegacy() : undefined };
    }
    // Peça só do host: a tabela "By Command" (só texto, só Claude, F48)
    const gainText = await runRtk(['gain']);
    const checks = buildChecks(environments);
    return {
      ...base,
      installed: true,
      version: host.versionText,
      checks,
      byCommand: parseRtkByCommand(gainText.output),
      codex: deps.codexLegacy ? await deps.codexLegacy() : undefined,
    };
  }

  async function run(key) {
    const args = RTK_COMMANDS[key];
    if (!args) return { ok: false, output: `Comando não permitido: ${key}` };
    const res = await runRtk(args, key === 'discover' ? 180000 : 60000);
    return { ...res, command: 'rtk ' + args.join(' ') };
  }

  return { status, run, inspect };
}

module.exports = { createRtkStatus, RTK_COMMANDS, parseRtkByCommand, ZERO_GAIN, buildChecks };

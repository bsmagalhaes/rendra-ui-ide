/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: ativar um agente (Claude Code ou Codex) em um ambiente (host ou distro WSL).
// Ordem: confere versão, tira cópia de cada arquivo que vai ser tocado, roda `rtk init`, aplica
// os ajustes da IDE (hook com caminho absoluto, banco por agente), confere e devolve o estado.
// Se qualquer passo falhar depois da primeira escrita, restaura o que esta execução gravou.

const crypto = require('crypto');
const path = require('path');
const P = require('./rtk-paths');
const C = require('./rtk-config');

const sha = t => (t == null ? null : crypto.createHash('sha256').update(t).digest('hex'));
const pad = n => String(n).padStart(2, '0');
const stampOf = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
const sameStat = (a, b) => (!a && !b) || (!!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs);
const TRUST_MSG = 'O Codex ainda precisa da sua aprovação para usar o RTK: abra o Codex, digite /hooks, entre em PreToolUse com Enter, deixe o hook do RTK selecionado e aperte t.';

class EnableError extends Error {}

// Arquivos que `rtk init -g` e a IDE podem tocar, por agente (correção 6)
function plannedFiles(agent, dirs, procEnv = {}) {
  const p = dirs.platform === 'win32' ? path.win32 : path.posix;
  if (agent === 'claude') {
    const cfg = P.rtkConfigDir({ platform: dirs.platform, env: procEnv, home: dirs.home });
    return [
      p.join(dirs.claudeDir, 'settings.json'), p.join(dirs.claudeDir, 'RTK.md'),
      p.join(dirs.claudeDir, 'CLAUDE.md'), p.join(cfg, 'filters.toml'),
    ];
  }
  return ['hooks.json', 'config.toml', 'RTK.md', 'AGENTS.md'].map(n => p.join(dirs.codexDir, n));
}

// deps: env (createRtkEnv), processEnv, now, gitBash (() => Promise<bool>)
function createRtkEnable(deps) {
  const { env } = deps;
  const procEnv = deps.processEnv || process.env;
  const now = deps.now || Date.now;
  const gitBash = deps.gitBash || (async () => !!(await require('./setup').gitPath()));

  // Escreve só se o arquivo não mudou entre a leitura e a escrita (outra sessão do Codex mexe
  // no config.toml); grava em temporário e renomeia. Um retry; depois, erro sem sobrescrever.
  async function writeChecked(e, file, build) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s1 = await env.stat(e, file);
      const r = await env.readFile(e, file);
      if (!r.ok && !r.missing) throw new EnableError(`Não consegui ler ${file}: ${r.error || r.state}`);
      const out = build(r.ok ? r.text : null);
      if (!out.changed) return { ...out, wrote: false };
      const tmp = `${file}.rendra-tmp`;
      const w = await env.writeFile(e, tmp, out.text);
      if (!w.ok) throw new EnableError(`Não consegui gravar ${file}: ${w.error || w.state}`);
      if (!sameStat(s1, await env.stat(e, file))) { await env.remove(e, tmp); continue; }
      const rn = await env.rename(e, tmp, file);
      if (!rn.ok) { await env.remove(e, tmp); throw new EnableError(`Não consegui substituir ${file}: ${rn.error}`); }
      return { ...out, wrote: true };
    }
    throw new EnableError(`O arquivo ${file} mudou enquanto a IDE o alterava (outra sessão?). Nada foi sobrescrito; tente de novo.`);
  }

  async function backupName(e, file) {
    const base = `${file}.rendra-${stampOf(now())}.bak`;
    if (!(await env.exists(e, base))) return base;
    for (let i = 2; i < 100; i++) {
      const alt = base.replace(/\.bak$/, `-${i}.bak`);
      if (!(await env.exists(e, alt))) return alt;
    }
    throw new EnableError('Cópias de segurança demais para o mesmo instante.');
  }

  async function enable(e, agent, log = () => {}) {
    if (e.kind === 'wsl' && !e.running) return { ok: false, state: 'wsl-off', error: 'A distro está desligada. Abra-a e tente de novo; a IDE não acorda distros sozinha.' };
    const rtk = await env.findRtk(e);
    if (!rtk) return { ok: false, needsInstall: true, error: 'O RTK não está instalado neste sistema. Instale pelo botão de atualizar.' };
    const vr = await env.run(e, [rtk, '--version'], { timeout: 8000 });
    const ver = vr.ok ? P.parseRtkVersion(vr.stdout) : null;
    if (!ver || P.compareVersions(ver, P.RTK_MIN) < 0) {
      return { ok: false, needsUpdate: true, version: ver, error: `O RTK deste sistema é ${ver || 'desconhecido'}; é preciso ${P.RTK_MIN} ou mais. Atualize pelo botão de atualizar.` };
    }
    const dirs = await env.agentDirs(e);
    if (!dirs) return { ok: false, error: 'Não foi possível ler a pasta pessoal deste sistema.' };

    const files = plannedFiles(agent, dirs, e.kind === 'host' ? procEnv : {});
    const o = { platform: dirs.platform, env: e.kind === 'host' ? procEnv : {}, home: dirs.home };
    const claudeDb = P.claudeDbPath(o);
    const codexDb = P.codexDbPath(o);
    const dbPath = agent === 'claude' ? claudeDb : codexDb;
    const p = dirs.platform === 'win32' ? path.win32 : path.posix;
    const settingsPath = p.join(dirs.claudeDir, 'settings.json');
    const hooksPath = p.join(dirs.codexDir, 'hooks.json');
    const tomlPath = p.join(dirs.codexDir, 'config.toml');

    const pre = new Map();      // arquivo -> texto antes (null = não existia)
    const expected = new Map(); // arquivo -> hash do que esta execução deixou lá
    const backups = new Map();  // arquivo -> caminho da cópia
    const notes = [];

    const readAll = async () => {
      const m = new Map();
      for (const f of files) { const r = await env.readFile(e, f); m.set(f, r.ok ? r.text : null); }
      return m;
    };
    const rollback = async () => {
      const skipped = [];
      for (const [f, hash] of expected) {
        const cur = await env.readFile(e, f);
        if (sha(cur.ok ? cur.text : null) !== hash) { skipped.push(f); continue; }
        if (pre.get(f) == null) await env.remove(e, f);
        else await env.writeFile(e, f, pre.get(f));
      }
      return skipped;
    };

    try {
      // 1. cópia de segurança de cada arquivo que já existe, antes de qualquer alteração
      for (const [f, t] of await readAll()) pre.set(f, t);
      for (const [f, t] of pre) {
        if (t == null) continue;
        const bak = await backupName(e, f);
        const w = await env.writeFile(e, bak, t);
        if (!w.ok) throw new EnableError(`Não consegui guardar a cópia de segurança de ${f}: ${w.error || w.state}`);
        backups.set(f, bak);
      }

      // 2. rtk init
      const initArgs = agent === 'claude' ? ['init', '-g', '--auto-patch'] : ['init', '-g', '--codex'];
      log(`Ativando o RTK no ${agent === 'claude' ? 'Claude Code' : 'Codex'} (${e.label})…`);
      const init = await env.run(e, [rtk, ...initArgs], {
        env: agent === 'claude' ? { CLAUDE_CONFIG_DIR: dirs.claudeDir } : { CODEX_HOME: dirs.codexDir }, timeout: 60000,
      });
      const after = await readAll();
      for (const [f, t] of after) if (t !== pre.get(f)) expected.set(f, sha(t));
      if (!init.ok) throw new EnableError(`rtk init falhou: ${(init.stderr || init.stdout || '').trim().split('\n').pop() || 'sem mensagem'}`);

      const gb = e.kind === 'host' && dirs.platform === 'win32' ? await gitBash() : false;
      // 3. ajustes da IDE
      let trust = null;
      let tomlBlock = null;
      let keyPathCodex = null; // calculado uma vez, ao gravar o config.toml, e reaproveitado na conferência
      if (agent === 'claude') {
        const r = await writeChecked(e, settingsPath, t => C.patchClaudeSettings(t == null ? '{}' : t, { dbPath: claudeDb, absRtk: rtk, platform: dirs.platform, gitBash: gb }));
        notes.push(...r.notes.filter(n => !n.startsWith('env.RTK_DB_PATH')));
        if (r.wrote) expected.set(settingsPath, sha(r.text));
      } else {
        const r = await writeChecked(e, hooksPath, t => C.patchCodexHooks(t == null ? '{}' : t, rtk, { platform: dirs.platform, gitBash: gb }));
        notes.push(...r.notes);
        if (r.wrote) expected.set(hooksPath, sha(r.text));
        const mk = await env.mkdirp(e, P.codexDbDir(o));
        if (!mk.ok) throw new EnableError(`Não consegui criar a pasta do banco do Codex: ${mk.error || mk.state}`);
        // config.toml numa escrita só (uma leitura, uma checagem de concorrência, uma troca atômica):
        // banco do Codex no env, aprovação do hook do RTK (hash do hooks.json já final) e, quando
        // cabe, a pasta do banco em writable_roots. O rollback cobre tudo sem caso novo.
        const hooksFinal = (await env.readFile(e, hooksPath)).text || '';
        const keyPath = p.join(await env.codexKeyDir(e, dirs), 'hooks.json');
        keyPathCodex = keyPath;
        const targets = C.rtkTrustTargets(hooksFinal, keyPath);
        const t = await writeChecked(e, tomlPath, txt => {
          let cur = txt == null ? '' : txt;
          const a = C.patchCodexConfigToml(cur, codexDb);
          const out = { changed: a.changed, snippet: a.changed ? a.snippet : null, notes: [...a.notes] };
          cur = a.text;
          const b = C.applyCodexTrust(cur, targets);
          if (b.changed) { cur = b.text; out.changed = true; out.notes.push('O hook do RTK foi aprovado no Codex.'); }
          if (!b.recognized && targets.length) out.notes.push('O arquivo de configuração do Codex (config.toml) tem um trecho que a IDE não consegue alterar com segurança, então ela não mexeu nele. Aprove o hook do RTK dentro do Codex (digite /hooks). Mesmo aprovado, esta tela pode seguir dizendo que falta aprovar; o RTK funciona do mesmo jeito.');
          const w = C.patchWritableRoots(cur, P.codexDbDir(o), { platform: dirs.platform });
          if (w.changed) { cur = w.text; out.changed = true; out.notes.push('A pasta do banco do RTK foi liberada para o Codex gravar.'); }
          return { ...out, text: cur };
        });
        notes.push(...t.notes);
        if (t.wrote) { expected.set(tomlPath, sha(t.text)); tomlBlock = t.snippet; }
      }

      // 4. verificação
      const settingsNow = (await env.readFile(e, settingsPath)).text || '';
      const hooksNow = (await env.readFile(e, hooksPath)).text || '';
      const hookText = agent === 'claude' ? settingsNow : hooksNow;
      const kind = agent === 'claude' ? 'claude' : 'codex';
      if (!C.hasRtkHook(hookText, kind)) throw new EnableError('Depois do rtk init o hook do RTK não apareceu no arquivo de configuração.');
      const dbExisted = await env.exists(e, dbPath);
      const g = await env.run(e, [rtk, 'gain', '--all', '--format', 'json'], { env: { RTK_DB_PATH: dbPath }, timeout: 15000 });
      let gainOk = false;
      try { gainOk = !!JSON.parse(g.stdout).summary; } catch { /* abaixo */ }
      if (!g.ok || !gainOk) throw new EnableError('O rtk gain não respondeu com o banco do agente depois da ativação.');
      if (!dbExisted) notes.push(`Banco do ${agent === 'claude' ? 'Claude Code' : 'Codex'} criado em ${dbPath}.`);
      if (!C.isAbsoluteHook(hookText, kind)) notes.push('O hook ficou como o rtk init o gravou (sem caminho absoluto); veja a nota acima.');
      if (agent === 'codex') {
        trust = C.codexHookTrust(hooksNow, (await env.readFile(e, tomlPath)).text || '', keyPathCodex);
      }

      // 5. fecha: o que não mudou perde a cópia; o que mudou entra em changes[]
      const final = await readAll();
      const changes = [];
      for (const [f, t] of final) {
        if (t === pre.get(f)) {
          if (backups.has(f)) await env.remove(e, backups.get(f));
          continue;
        }
        const ch = { file: f, kind: pre.get(f) == null ? 'created' : 'modified', backup: backups.get(f) || null };
        if (f === tomlPath && tomlBlock) ch.added = tomlBlock;
        changes.push(ch);
      }
      const base = { ok: true, agent, env: e.id, changes, notes, trustMessage: null };
      if (agent === 'codex') { base.trust = trust.state; base.trustMessage = trust.state === 'trusted' ? null : TRUST_MSG; }
      return base;
    } catch (err) {
      const skipped = await rollback().catch(() => []);
      // cópia de um arquivo que voltou ao que era não tem mais serventia
      for (const [f, bak] of backups) {
        const cur = await env.readFile(e, f);
        if ((cur.ok ? cur.text : null) === pre.get(f)) { await env.remove(e, bak); backups.delete(f); }
      }
      const msg = err instanceof EnableError ? err.message : `Erro inesperado: ${err.message}`;
      const extra = skipped.length ? ` Não restaurei ${skipped.join(', ')} porque outra sessão mexeu neles depois.` : '';
      return { ok: false, error: msg + extra, rolledBack: Object.fromEntries([...expected.keys()].map(f => [f, !skipped.includes(f)])), backups: [...backups.values()] };
    }
  }

  return { enable, plannedFiles: (agent, dirs, procEnv) => plannedFiles(agent, dirs, procEnv) };
}

module.exports = { createRtkEnable, plannedFiles, TRUST_MSG };

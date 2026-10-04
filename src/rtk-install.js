/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: instalar e atualizar o binário por ambiente (host ou distro WSL), sempre >= RTK_MIN.
// O host usa setup.installRtk; a distro recebe o binário do asset certo para a arquitetura dela,
// gravado por UNC em arquivo temporário e posto no lugar por `mv` dentro da distro.

const fs = require('fs');
const path = require('path');
const P = require('./rtk-paths');

const PROFILE_MARK = '# added by Rendra IDE (RTK)';
const PROFILE_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

// Troca o binário sem nunca deixar o destino sem arquivo.
// Windows: um rtk.exe em uso (hook rodando) não aceita cópia por cima (EBUSY) nem remoção, mas
// aceita rename: o antigo vira rtk.exe.old-<instante>, o novo entra com o nome original e o
// .old é apagado quando der (um .old preso por EPERM é ignorado e limpo numa próxima troca).
// Linux e macOS: cópia ao lado e rename por cima (atômico).
function swapBinary(target, source, { fs: fsx = fs, platform = process.platform, now = Date.now } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const dir = p.dirname(target);
    const base = p.basename(target);
    let names = [];
    try { names = fsx.readdirSync(dir); } catch { /* pasta ainda não existe */ }
    for (const n of names.filter(x => x.startsWith(`${base}.old`))) {
      try { fsx.rmSync(p.join(dir, n), { force: true }); } catch { /* em uso: fica para depois */ }
    }
    let old = null;
    if (fsx.existsSync(target)) {
      old = `${target}.old-${now()}`;
      fsx.renameSync(target, old);
    }
    try {
      fsx.copyFileSync(source, target);
    } catch (e) {
      if (old) {
        try { fsx.rmSync(target, { force: true }); } catch { /* meia cópia presa */ }
        fsx.renameSync(old, target); // o destino volta a ter o binário antigo
      }
      throw e;
    }
    if (old) { try { fsx.rmSync(old, { force: true }); } catch { /* EPERM: o .old em uso fica */ } }
    return;
  }
  const tmp = `${target}.new-${now()}`;
  try {
    fsx.copyFileSync(source, tmp);
    fsx.chmodSync(tmp, 0o755);
    fsx.renameSync(tmp, target);
  } catch (e) {
    try { fsx.rmSync(tmp, { force: true }); } catch { /* nada a limpar */ }
    throw e;
  }
}

function createRtkInstall(deps) {
  const { env } = deps;
  const fsx = deps.fs || fs;
  const now = deps.now || Date.now;
  const setup = () => deps.setup || require('./setup');

  async function versionOf(e, rtk) {
    const r = await env.run(e, [rtk, '--version'], { timeout: 8000 });
    return r.ok ? P.parseRtkVersion(r.stdout) : null;
  }

  // Cópia do WinGet defasada (F63): só orienta, nunca mexe nela e a IDE nunca roda o winget.
  // Sem aviso quando o RTK gerenciado pela IDE vem primeiro no PATH e todo agente do host que tem
  // hook usa caminho absoluto (aí a cópia do WinGet nunca é a que os agentes executam). `agents` vem
  // do status do host; sem ele, nenhum agente conta contra. O PATH é o do processo da IDE, que pode
  // estar defasado em relação ao do usuário (risco aceito).
  const sameFile = (a, b) => String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
  async function hostWarnings(agents) {
    if (env.HOST.platform !== 'win32') return [];
    const w = await env.run(env.HOST, ['where.exe', 'rtk'], { timeout: 8000 });
    const paths = w.ok ? w.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
    const out = [];
    if (paths.length > 1) {
      const managed = await env.findRtk(env.HOST);
      const comHook = Object.values(agents || {}).filter(a => a && a.hook);
      if (managed && sameFile(paths[0], managed) && comHook.every(a => a.hookAbsolute)) return out;
      for (const x of paths.filter(q => /winget/i.test(q))) {
        const v = await versionOf(env.HOST, x);
        if (v && P.compareVersions(v, P.RTK_MIN) < 0) {
          out.push({ kind: 'winget', path: x, version: v, text: `Há um RTK ${v} antigo do WinGet no PATH, que pode ser usado no lugar do da IDE. Atualize ou remova essa cópia do WinGet.` });
        }
      }
    }
    return out;
  }

  async function installHost(e, log) {
    await setup().installRtk(log);
    const rtk = await env.findRtk(e);
    const v = rtk ? await versionOf(e, rtk) : null;
    if (!v || P.compareVersions(v, P.RTK_MIN) < 0) {
      return { ok: false, error: `O RTK instalado ainda é ${v || 'desconhecido'} (mínimo ${P.RTK_MIN}). Pode haver outro rtk antes no PATH.` };
    }
    return { ok: true, rtk, version: v, warnings: await hostWarnings() };
  }

  async function installDistro(e, log) {
    const home = await env.homeOf(e);
    if (!home) return { ok: false, error: `Não foi possível ler a pasta pessoal na distro ${e.name}.` };
    const un = await env.run(e, ['uname', '-m']);
    const arch = un.ok ? setup().archFromUname(un.stdout) : null;
    if (!arch) return { ok: false, error: `Arquitetura da distro não reconhecida (${un.stdout.trim() || 'sem resposta'}); não há pacote do RTK para ela.` };
    const asset = setup().rtkAssetName('linux', arch);
    const fetchRtk = deps.fetchRtk || ((...a) => setup().fetchRtkRelease(...a));
    const { found, tmp } = await fetchRtk(log, asset, 'rtk');
    const bin = `${home}/.local/bin`;
    const target = `${bin}/rtk`;
    const stage = `${bin}/.rtk-new-${now()}`;
    const cleanup = async () => { await env.remove(e, stage); };
    try {
      const data = fsx.readFileSync(found);
      const mk = await env.mkdirp(e, bin);
      if (!mk.ok) return { ok: false, error: `Não consegui criar ${bin} na distro: ${mk.error}` };
      const w = await env.writeFile(e, stage, data);
      if (!w.ok) { await cleanup(); return { ok: false, error: `Falha ao gravar o RTK na distro: ${w.error}` }; }
      const ch = await env.run(e, ['chmod', '+x', stage]);
      if (!ch.ok) { await cleanup(); return { ok: false, error: 'Não consegui tornar o RTK executável na distro.' }; }
      const mv = await env.run(e, ['mv', '-f', stage, target]);
      if (!mv.ok) { await cleanup(); return { ok: false, error: 'Não consegui colocar o RTK no lugar na distro.' }; }
    } finally {
      fsx.rmSync(tmp, { recursive: true, force: true });
    }
    const v = await versionOf(e, target);
    if (!v || P.compareVersions(v, P.RTK_MIN) < 0) return { ok: false, error: `O RTK instalado na distro respondeu ${v || 'nada'}; esperado ${P.RTK_MIN} ou mais.` };
    const pathEdited = await ensureDistroPath(e, home, log);
    return { ok: true, rtk: target, version: v, pathEdited, warnings: [] };
  }

  // `/bin/bash -lc` (como o Codex roda o comando reescrito, F33) precisa achar o rtk. Só mexe se falhar.
  async function ensureDistroPath(e, home, log) {
    const r = await env.run(e, ['bash', '-lc', 'command -v rtk']);
    if (r.ok && r.stdout.trim()) return false;
    const profile = `${home}/.profile`;
    const cur = await env.readFile(e, profile);
    const text = cur.ok ? cur.text : '';
    if (text.includes('.local/bin')) return false; // já há uma linha; vale a partir do próximo login
    const sep = text && !text.endsWith('\n') ? '\n' : '';
    const w = await env.writeFile(e, profile, `${text}${sep}\n${PROFILE_MARK}\n${PROFILE_LINE}\n`);
    if (!w.ok) throw new Error(`Não consegui atualizar o ~/.profile da distro: ${w.error}`);
    log(`  PATH atualizado em ~/.profile (${e.name})`);
    return true;
  }

  // e: ambiente já resolvido pelo main (resolveEnvironment)
  async function install(e, log = () => {}) {
    if (e.kind === 'wsl' && !e.running) return { ok: false, state: 'wsl-off', error: 'A distro está desligada. Abra-a e tente de novo; a IDE não acorda distros sozinha.' };
    const rtk = await env.findRtk(e);
    if (rtk) {
      const v = await versionOf(e, rtk);
      if (v && P.compareVersions(v, P.RTK_MIN) >= 0) {
        return { ok: true, upToDate: true, rtk, version: v, warnings: e.kind === 'host' ? await hostWarnings() : [] };
      }
    }
    try {
      return e.kind === 'host' ? await installHost(e, log) : await installDistro(e, log);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { install, hostWarnings };
}

module.exports = { swapBinary, createRtkInstall };

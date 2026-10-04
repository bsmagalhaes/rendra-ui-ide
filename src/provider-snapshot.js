/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Canal leve da barra de título: identidade e limites de cada combinação provedor + ambiente
// (Claude e Codex, no Windows e em cada distro WSL em execução). Roda a cada 60 s no processo
// principal, então:
//  - nunca usa currentAccount nem a rede: Claude lê só a statusline e o .claude.json;
//  - só devolve campos da lista branca (nenhum token sai daqui);
//  - leituras de distro são assíncronas e cada ambiente tem tempo limite (um ambiente lento some
//    daquela rodada sem derrubar os outros);
//  - nunca rejeita: a rejeição de um ipcMain.handle é registrada no console do Electron.
// O Windows e as distros vêm em chamadas separadas (wsl: false / true): a barra mostra o Windows
// sem esperar a descoberta do WSL (wsl.exe e UNC, até 6 s).
//
// Entrada devolvida: { id, provedor: 'claude'|'codex', ambiente: 'Windows'|'macOS'|'Linux'|<distro>, conta, limits, fetchedAt }
//   id estável e independente do rótulo: claude:local, codex:local, claude:wsl:<distro>, codex:wsl:<distro>
//   conta: { email, name, organization, plan, tier } ou null · limits: [{ kind, percent, resetsAt }] ou null
// Uma opção só existe quando tem conta OU limites.

const path = require('path');
const { ambientesWsl, juntaHome } = require('./wsl-ambientes');

const TEMPO_MS = 3000;
const NOME_HOST = { win32: 'Windows', darwin: 'macOS' }; // o sistema onde a IDE roda

function comTempo(promessa, ms) {
  let t;
  const limite = new Promise(r => { t = setTimeout(() => r(null), ms); });
  return Promise.race([Promise.resolve(promessa).catch(() => null), limite]).finally(() => clearTimeout(t));
}

const contaClaude = c => (c ? { email: c.email || '', name: c.name || '', organization: c.organization || '', plan: c.plan || '', tier: c.tier || '' } : null);
const contaCodex = c => (c ? { email: c.email || '', name: c.name || '', organization: c.organization || '', plan: c.plan || '', tier: '' } : null);

function entrada(id, provedor, ambiente, conta, lim) {
  const limits = lim?.limits?.length ? lim.limits.map(l => ({ kind: l.kind, percent: l.percent, resetsAt: l.resetsAt ?? null })) : null;
  if (!conta && !limits) return null;
  return { id, provedor, ambiente, conta, limits, fetchedAt: limits ? (lim.fetchedAt ?? null) : null };
}

// deps: homeIde, codexHome(), statuslineLimits(), contaClaudeDoHome(home), lerContaCodex(dir),
//       limitesLeves(sessionsDir), wslRoots(), pulaWsl, tempoMs
async function snapshotProvedores({ wsl = false } = {}, deps) {
  const tempo = deps.tempoMs ?? TEMPO_MS;
  const host = deps.nomeHost || NOME_HOST[process.platform] || 'Linux';
  const out = [];
  const tarefas = [];
  const adiciona = (id, provedor, ambiente, conta, limites) => tarefas.push(
    Promise.all([comTempo(conta, tempo), comTempo(limites, tempo)])
      .then(([c, l]) => entrada(id, provedor, ambiente, provedor === 'claude' ? contaClaude(c) : contaCodex(c), l)));

  try {
    if (!wsl) {
      let statusline = null;
      try { statusline = deps.statuslineLimits(); } catch { /* sem leitura */ }
      adiciona('claude:local', 'claude', host, deps.contaClaudeDoHome(deps.homeIde), statusline);
      const cdir = deps.codexHome();
      adiciona('codex:local', 'codex', host, deps.lerContaCodex(cdir), deps.limitesLeves(path.join(cdir, 'sessions')));
    } else if (!deps.pulaWsl) {
      const roots = await deps.wslRoots();
      for (const a of ambientesWsl(roots)) {
        const cdir = juntaHome(a.home, '.codex');
        adiciona(`claude:wsl:${a.distro}`, 'claude', a.distro, deps.contaClaudeDoHome(a.home), null);
        adiciona(`codex:wsl:${a.distro}`, 'codex', a.distro, deps.lerContaCodex(cdir), deps.limitesLeves(a.codexSessions || juntaHome(cdir, 'sessions')));
      }
    }
  } catch { /* descoberta falhou: devolve o que houver */ }

  const prontas = await Promise.all(tarefas);
  const ids = new Set();
  for (const e of prontas) {
    if (!e || ids.has(e.id)) continue; // dois homes da mesma distro: vale o primeiro com conta ou limites
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

module.exports = { snapshotProvedores };

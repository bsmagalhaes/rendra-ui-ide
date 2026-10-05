/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Vida dos terminais da IDE do ponto de vista dos processos: o que registrar quando um terminal abre e como
// encerrar a árvore dele (ou a de todos) ao fechar o terminal, sair da IDE ou a janela cair. Quem encerra de
// verdade é src/encerrar-proc.js; o registro em disco (src/registro-terminais.js) cobre a morte à força.
//
// Fechar a IDE é como no VS Code: tudo que nasceu de um terminal dela morre (inclusive dentro do WSL), o que
// saiu da sessão por `setsid` (tmux, daemons) e qualquer processo que a IDE não iniciou ficam como estão.

const A = require('./agentes-proc');
const E = require('./encerrar-proc');

// pty: { pid, kill() }. info: { token, distro|null }
function criarCiclo({ registro, env = process.env, plataforma = process.platform, prazos = E.PRAZOS, deps = {} } = {}) {
  const terminais = new Map(); // id -> { pty, token, ambiente, distro }
  const sandbox = !!env.RENDRA_HOME;
  const listarPids = deps.listarPids || (pids => A.listarProcessosWindows({ filtro: pids.map(p => `ProcessId=${p}`).join(' OR '), timeout: 8000 }));
  const descobrir = deps.descobrirLider || E.descobrirLider;
  const arvores = deps.encerrarArvoresWindows || E.encerrarArvoresWindows;
  const sessoes = deps.encerrarSessoesPorMarca || E.encerrarSessoesPorMarca;

  // A foto da árvore de processos custa 1 a 2 s no Windows (PowerShell + CIM). `prepararSaida` a tira antes de a janela
  // fechar (o before-quit), em paralelo com a guarda de arquivos não salvos, e o encerramento a reaproveita se for recente.
  const listarTudo = deps.listarTudo || (() => A.listarProcessosWindows({ timeout: 6000 }));
  let fotoCache = null;
  const VALIDADE_FOTO_MS = 15000;
  function prepararSaida() {
    if (plataforma !== 'win32' || ![...terminais.values()].some(t => t.ambiente === 'win')) return;
    fotoCache = { t: Date.now(), p: Promise.resolve().then(listarTudo).catch(() => null) };
  }
  const fotoParaEncerrar = async () => {
    const c = fotoCache;
    fotoCache = null;
    if (c && Date.now() - c.t < VALIDADE_FOTO_MS) { const f = await c.p; if (f) return f; }
    return listarTudo();
  };

  const ambienteDe = distro => (distro ? 'wsl' : plataforma === 'win32' ? 'win' : 'posix');

  // Completa o registro com a prova que só existe depois do shell nascer (hora de criação, SID e boot_id).
  // Em segundo plano: falhar aqui só tira a prova da varredura, nunca atrapalha o terminal.
  // O node-pty do Windows só preenche `pid` depois que o ConPTY sobe o shell: espera aparecer (até 10 s)
  async function pidPronto(t) {
    for (let i = 0; i < 200 && terminais.has(t.id); i++) {
      if (t.pty.pid > 1) return t.pty.pid;
      await new Promise(r => setTimeout(r, 50));
    }
    return t.pty.pid > 1 ? t.pty.pid : null;
  }

  async function completar(t) {
    try {
      if (!registro || !terminais.has(t.id)) return;
      if (t.ambiente === 'win') {
        const pid = await pidPronto(t);
        if (!pid) return;
        registro.atualizar(t.token, { ptyPid: pid });
        const l = await listarPids([pid]);
        const p = l && l.find(x => x.pid === pid);
        if (p && p.inicio) registro.atualizar(t.token, { ptyInicio: p.inicio });
      } else if (t.ambiente === 'wsl' && !sandbox) {
        const l = await descobrir({ distro: t.distro, token: t.token });
        if (l) registro.atualizar(t.token, { sid: l.sid, boot: l.boot });
      } else if (t.ambiente === 'posix' && plataforma === 'linux') {
        const l = await descobrir({ distro: null, token: t.token });
        if (l) registro.atualizar(t.token, { sid: l.sid, boot: l.boot });
      }
    } catch { /* sem prova a varredura descarta a entrada */ }
  }

  function registrar(id, pty, { token, distro = null } = {}) {
    const t = { id, pty, token, ambiente: ambienteDe(distro), distro };
    terminais.set(id, t);
    if (registro) {
      registro.adicionar({ token, ambiente: t.ambiente, distro, ptyPid: pty.pid, idePid: process.pid, criadoEm: Date.now() });
      completar(t);
    }
    return t;
  }

  function saiu(id) {
    const t = terminais.get(id);
    terminais.delete(id);
    if (t && registro) registro.remover(t.token);
  }

  // Encerra os terminais pedidos (todos, sem `ids`) e resolve quando morreram ou o teto acabou.
  async function encerrar(ids, { tetoMs = prazos.saida } = {}) {
    const alvo = [...terminais.values()].filter(t => !ids || ids.includes(t.id));
    if (!alvo.length) return { encerrados: 0 };
    for (const t of alvo) terminais.delete(t.id);
    const trabalho = (async () => {
      const win = alvo.filter(t => t.ambiente === 'win');
      const linux = alvo.filter(t => t.ambiente !== 'win');
      const feitos = [];
      // shell ainda sem pid (fechado no primeiro instante): não há árvore para achar, só o pty para fechar
      for (const t of win.filter(x => !(x.pty.pid > 1))) { try { t.pty.kill(); } catch { /* já saiu */ } }
      const comPid = win.filter(x => x.pty.pid > 1);
      if (comPid.length) {
        feitos.push(arvores(comPid.map(t => ({ pid: t.pty.pid, kill: () => t.pty.kill() })), { prazoMs: prazos.terminal, deps: { listar: fotoParaEncerrar } }).catch(() => { /* já saiu */ }));
      }
      const porDistro = new Map();
      for (const t of linux) {
        if (t.ambiente === 'wsl' && sandbox) continue; // sandbox nunca alcança a distro real
        if (t.ambiente === 'posix' && plataforma !== 'linux') { // Mac
          if (!(t.pty.pid > 1)) { try { t.pty.kill(); } catch { /* já saiu */ } continue; } // nunca process.kill(-0): sinaliza o próprio grupo: sem /proc, o grupo do shell recebe SIGHUP e depois SIGKILL
          feitos.push((async () => {
            try { process.kill(-t.pty.pid, 'SIGHUP'); } catch { /* sem grupo */ }
            await E.esperarMorte([t.pty.pid], prazos.terminal);
            try { process.kill(-t.pty.pid, 'SIGKILL'); } catch { /* já saiu */ }
            // o grupo só some quando o último zumbi é recolhido: espera (até 1 s) antes de devolver a quem vai instalar
            for (let i = 0; i < 20; i++) { try { process.kill(-t.pty.pid, 0); } catch { break; } await new Promise(r => setTimeout(r, 50)); }
          })());
          continue;
        }
        const reg = registro && registro.ler().find(e => e.token === t.token);
        const chave = t.distro || '';
        if (!porDistro.has(chave)) porDistro.set(chave, []);
        porDistro.get(chave).push({ token: t.token, sid: reg && reg.sid, boot: reg && reg.boot });
      }
      for (const [distro, entradas] of porDistro) {
        feitos.push(sessoes({ distro: distro || null, entradas, prazoMs: prazos.terminal }).catch(() => { /* distro indisponível */ }));
      }
      await Promise.all(feitos);
    })();
    // o pty (wsl.exe, shell) só fecha depois da sessão Linux: com o líder morto antes, a marca não achava mais a sessão
    const fechaPtys = () => { for (const t of alvo) if (t.ambiente !== 'win') { try { t.pty.kill(); } catch { /* já saiu */ } } };
    let teto;
    const limite = new Promise(r => { teto = setTimeout(r, tetoMs); });
    try { await Promise.race([trabalho, limite]); } finally { clearTimeout(teto); fechaPtys(); }
    if (registro) for (const t of alvo) registro.remover(t.token);
    return { encerrados: alvo.length };
  }

  return {
    registrar, saiu, encerrar, prepararSaida,
    tokens: () => [...terminais.values()].map(t => t.token),
    ptyPids: () => [...terminais.values()].map(t => t.pty.pid),
    tamanho: () => terminais.size,
  };
}

module.exports = { criarCiclo };

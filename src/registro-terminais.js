/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Registro dos terminais vivos da IDE em `userData/terminais-vivos.json`. Serve a um caso só: a IDE morreu à
// força (instalador, queda, taskkill) e o `before-quit` não rodou. Ao abrir de novo, a IDE varre o registro e
// encerra o que sobrou dos terminais dela, e só isso:
//   Windows: o PID do shell e a hora de criação dele (FILETIME). Com o shell vivo e a mesma hora de criação, a
//            árvore inteira é dele; com o shell morto e nenhum processo com aquele PID, os órfãos são os processos
//            que apontam para ele e nasceram depois dele. PID ocupado por outro processo (hora diferente): intocável.
//   Linux, WSL e Mac: a marca RENDRA_TERM (token aleatório de 64 bits) mais o SID e o boot_id do líder. Quem
//            sobrou na sessão com a marca morre; a distro que reiniciou (boot_id diferente) não é tocada.
// Entrada sem prova (a IDE caiu no primeiro segundo, antes da hora de criação ser lida) só é descartada.

const fs = require('fs');
const path = require('path');
const E = require('./encerrar-proc');
const A = require('./agentes-proc');

const NOME_ARQUIVO = 'terminais-vivos.json';

function criarRegistro({ dir, fsMod = fs } = {}) {
  const arquivo = path.join(dir, NOME_ARQUIVO);
  const ler = () => {
    try {
      const j = JSON.parse(fsMod.readFileSync(arquivo, 'utf8'));
      return Array.isArray(j) ? j.filter(e => e && typeof e === 'object' && E.TOKEN.test(e.token || '')) : [];
    } catch { return []; }
  };
  const gravar = lista => {
    try {
      const tmp = `${arquivo}.${process.pid}.tmp`;
      fsMod.mkdirSync(dir, { recursive: true });
      fsMod.writeFileSync(tmp, JSON.stringify(lista));
      fsMod.renameSync(tmp, arquivo); // atômico: uma queda no meio nunca deixa o JSON cortado
    } catch { /* sem registro a IDE funciona igual; só perde a varredura da próxima abertura */ }
  };
  return {
    arquivo,
    ler,
    adicionar(e) { gravar([...ler().filter(x => x.token !== e.token), e]); },
    atualizar(token, patch) { const l = ler(); const i = l.findIndex(x => x.token === token); if (i >= 0) { l[i] = { ...l[i], ...patch }; gravar(l); } },
    remover(token) { const l = ler(); if (l.some(x => x.token === token)) gravar(l.filter(x => x.token !== token)); },
    limpar() { gravar([]); },
  };
}

// Órfãos de uma entrada do Windows na foto de processos: [{ pid, t }]
function orfaosDaEntrada(foto, e) {
  if (!Number.isInteger(e.ptyPid) || e.ptyPid <= 1 || !e.ptyInicio) return [];
  const dono = foto.find(p => p.pid === e.ptyPid);
  if (dono && dono.inicio !== e.ptyInicio) return []; // PID reaproveitado por outro processo: nada é nosso
  const raiz = dono ? [dono] : foto.filter(p => p.ppid === e.ptyPid && p.inicio != null && BigInt(p.inicio) > BigInt(e.ptyInicio));
  const out = new Map();
  for (const r of raiz) for (const n of E.arvoreDaFoto(foto, r.pid)) out.set(n.pid, n);
  return [...out.values()];
}

// deps (testes): listar, matar, vivo, encerrarSessoes, distroRodando
async function varrer({ registro, env = process.env, plataforma = process.platform, prazoMs = E.PRAZOS.terminal, deps = {} } = {}) {
  const entradas = registro.ler();
  const resultado = { varridas: entradas.length, encerrados: [], ignoradas: 0 };
  if (!entradas.length) return resultado;
  const sandbox = !!env.RENDRA_HOME;
  const matar = deps.matar || (pid => { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } });
  const vivoFn = deps.vivo || E.vivo;
  const win = entradas.filter(e => e.ambiente === 'win');
  const linux = entradas.filter(e => e.ambiente === 'wsl' || e.ambiente === 'posix');

  if (win.length && plataforma === 'win32') {
    const foto = (await (deps.listar || (() => A.listarProcessosWindows({ timeout: 8000 })))()) || [];
    const alvos = new Map();
    for (const e of win) for (const n of orfaosDaEntrada(foto, e)) alvos.set(n.pid, n);
    for (const n of alvos.values()) { matar(n.pid); resultado.encerrados.push(n.pid); }
    if (alvos.size) await E.esperarMorte([...alvos.keys()], 1500, vivoFn);
  }

  const porDistro = new Map();
  for (const e of linux) {
    if (e.ambiente === 'wsl' && sandbox) { resultado.ignoradas++; continue; } // sandbox nunca alcança a distro real
    const chave = e.ambiente === 'wsl' ? e.distro : null;
    if (!porDistro.has(chave)) porDistro.set(chave, []);
    porDistro.get(chave).push({ token: e.token, sid: e.sid, boot: e.boot });
  }
  const encerrarSessoes = deps.encerrarSessoes || E.encerrarSessoesPorMarca;
  for (const [distro, ents] of porDistro) {
    if (distro && deps.distroRodando && !(await deps.distroRodando(distro))) continue; // distro parada: nada sobreviveu e a VM não é acordada
    if (!distro && plataforma !== 'linux') continue; // Mac: sem /proc, a varredura por marca não se aplica
    const r = await encerrarSessoes({ distro, entradas: ents, prazoMs });
    if (r) resultado.encerrados.push(...r.hup, ...r.kill);
  }
  registro.limpar();
  return resultado;
}

module.exports = { criarRegistro, varrer, orfaosDaEntrada, NOME_ARQUIVO };

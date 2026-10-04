/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Seletor de conversas do terminal novo: junta o ambiente do terminal (Windows ou uma distro), as raízes onde
// o Claude Code e o Codex gravam as sessões nesse ambiente, a detecção dos provedores e as duas listagens.
// Nunca mistura ambientes: Windows lê as pastas do Windows (RENDRA_HOME, CODEX_HOME e settings.claudePath
// valem como no scanner) e a distro lê só a raiz UNC dela, montada na hora (a distro acabou de ser acordada
// pelo pty:create; o cache de 60 s do wslRoots poderia ter sido tirado com ela parada).
// A resposta tem só { provedores, sessoes: [{ provedor, id, titulo, quando }], mais }, mais `aviso: 'deteccao'` quando a detecção falhou.

const os = require('os');
const path = require('path');
const E = require('../renderer/sessoes-escolha');
const { comLimite } = require('./sessoes-io');
const { listarClaude } = require('./sessoes-claude');
const { listarCodex } = require('./sessoes-codex');
const { detectar } = require('./provedores-instalados');
const { varre, uncPadrao } = require('./wsl-roots');

const VAZIO = () => ({ provedores: { claude: false, codex: false }, sessoes: [], mais: false });

// Raízes do Claude e do Codex dentro de UMA distro (todos os homes dela: /root e /home/*). Limite de 6 s.
async function raizesDaDistro(distro, { uncRoot = uncPadrao, timeoutMs = 6000 } = {}) {
  const out = { claude: [], codex: [] };
  await comLimite(timeoutMs, async () => {
    const r = await varre(uncRoot(distro));
    out.claude.push(...r.claude);
    out.codex.push(...r.codex);
  });
  return out;
}

function raizesWindows(settings, env) {
  const home = env.RENDRA_HOME || os.homedir();
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  return {
    claude: [{ projects: (settings && settings.claudePath) || path.join(home, '.claude', 'projects') }],
    codex: [{ sessions: path.join(codexHome, 'sessions') }],
  };
}

// amb: { tipo, distro, cwd } de ambienteDoTerminal (o main o monta a partir de wslFor, nunca do renderer)
// deps (testes): env, detectar, raizesWsl, listarClaude, listarCodex
async function listar({ amb, todas = false, settings = {}, distroRodando = true, deps = {} } = {}) {
  if (!amb || !amb.cwd) return VAZIO();
  const env = deps.env || process.env;
  let raizes;
  if (amb.tipo === 'wsl') {
    if (env.RENDRA_HOME) return VAZIO(); // sandbox/demo nunca alcança a distro real (como o wslRoots)
    if (!distroRodando) return VAZIO(); // não acorda a VM
    const r = await (deps.raizesWsl || raizesDaDistro)(amb.distro);
    raizes = { claude: r.claude.map(projects => ({ projects })), codex: r.codex.map(sessions => ({ sessions })) };
  } else if (amb.tipo === 'windows') {
    raizes = raizesWindows(settings, env);
  } else return VAZIO();

  const [provedores, c, x] = await Promise.all([
    (deps.detectar || detectar)({ amb, distroRodando }),
    (deps.listarClaude || listarClaude)({ cwd: amb.cwd, raizes: raizes.claude, todas }),
    (deps.listarCodex || listarCodex)({ cwd: amb.cwd, raizes: raizes.codex, todas }),
  ]);
  const prov = { claude: !!provedores.claude, codex: !!provedores.codex };
  // nenhum provedor respondeu, mas há conversas gravadas aqui: a detecção provavelmente falhou (PATH do app
  // diferente do shell, distro lenta). Não some com a lista em silêncio: avisa, e o painel ainda oferece o terminal.
  if (!prov.claude && !prov.codex && (c.total || 0) + (x.total || 0) > 0) return { provedores: prov, sessoes: [], mais: false, aviso: 'deteccao' };
  const itens = [...(prov.claude ? c.itens : []), ...(prov.codex ? x.itens : [])];
  const total = (prov.claude ? c.total : 0) + (prov.codex ? x.total : 0);
  const ordenadas = E.ordenarRecentes(itens);
  return {
    provedores: prov,
    sessoes: E.visiveis(ordenadas, todas).map(({ provedor, id, titulo, quando }) => ({ provedor, id, titulo, quando })),
    mais: !todas && total > E.VISIVEIS,
  };
}

module.exports = { listar, raizesDaDistro, raizesWindows };

/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Deriva os ambientes WSL (distro + home) a partir do que wslRoots devolve, sem mudar wslRoots:
//   claude: <raiz>\home\<u>\.claude\projects  ou  <raiz>\root\.claude\projects
//   codex:  <raiz>\home\<u>\.codex\sessions   ou  <raiz>\root\.codex\sessions
// home = dois níveis acima do caminho; distro = nome da raiz (4º segmento do UNC
// \\wsl.localhost\<distro>\...). Só homes que já têm .claude/projects ou .codex/sessions entram
// (limitação de wslRoots): um home com .claude.json e sem projetos não aparece.

const path = require('path');

const lib = p => (p.includes('\\') ? path.win32 : path);

function homeEDistro(caminho) {
  const p = lib(caminho);
  const home = p.dirname(p.dirname(caminho));
  const pai = p.dirname(home);
  const raiz = p.basename(pai) === 'home' ? p.dirname(pai) : pai; // /root fica direto na raiz
  return { home, distro: p.basename(raiz) };
}

// roots: { claude: [...], codex: [...] } → [{ distro, home, claude: boolean, codexSessions: string|null }]
function ambientesWsl(roots = {}) {
  const porHome = new Map();
  const ambiente = caminho => {
    const { home, distro } = homeEDistro(caminho);
    if (!porHome.has(home)) porHome.set(home, { distro, home, claude: false, codexSessions: null });
    return porHome.get(home);
  };
  for (const c of roots.claude || []) ambiente(c).claude = true;
  for (const x of roots.codex || []) ambiente(x).codexSessions = x;
  return [...porHome.values()];
}

// junta partes a um home com o separador do próprio caminho (UNC do Windows ou posix)
const juntaHome = (home, ...partes) => lib(home).join(home, ...partes);

module.exports = { ambientesWsl, homeEDistro, juntaHome };

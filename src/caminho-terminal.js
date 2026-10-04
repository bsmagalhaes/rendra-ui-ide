/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Resolução dos caminhos que aparecem no terminal: do texto para os caminhos absolutos possíveis, na
// ordem de tentativa. Puro (sem fs, sem Electron), testável no node. Quem confere existência e se o
// caminho está dentro das pastas abertas é o main (src/devcode.js). Nada aqui monta texto para shell.
const path = require('path');

const TEM_CONTROLE = /[\u0000-\u001f\u007f]/;

// opts: { cwd, root, isWin, distro (WSL do terminal/workspace ou null), home }
function candidatosDoCaminho(texto, opts = {}) {
  if (typeof texto !== 'string' || !texto || texto.length > 1024 || TEM_CONTROLE.test(texto)) return [];
  const { cwd, root, isWin, distro, home } = opts;
  const p = isWin ? path.win32 : path.posix;
  const bases = [...new Set([cwd, root].filter(Boolean))];
  const relativo = alvo => bases.map(b => p.resolve(b, alvo));

  if (isWin) {
    const win = texto.replace(/\//g, '\\');
    if (/^[A-Za-z]:\\/.test(win)) return [p.resolve(win)];
    let m;
    if ((m = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(texto))) return [p.resolve(`${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}`)];
    if (texto.startsWith('~/') || texto.startsWith('~\\')) return distro || !home ? [] : [p.resolve(home, win.slice(2))];
    if (texto.startsWith('/')) {
      if (distro) return [p.resolve(`\\\\wsl.localhost\\${distro}${win}`)];
      if ((m = /^\/([A-Za-z])\/(.*)$/.exec(texto))) return [p.resolve(`${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`)]; // Git Bash: /c/Users/...
      return [];
    }
    return relativo(win);
  }
  if (texto.startsWith('~/')) return home ? [p.resolve(home, texto.slice(2))] : [];
  if (texto.startsWith('/')) return [p.resolve(texto)];
  return relativo(texto.replace(/\\/g, '/'));
}

module.exports = { candidatosDoCaminho };

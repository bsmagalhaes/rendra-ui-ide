/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Estado do Codex para a página do RTK: o Codex pode estar instalado no Windows e/ou dentro de uma
// distro WSL (onde o terminal WSL o roda). As pastas das distros vêm de src/wsl-roots.js: cada
// `<home>/.codex/sessions` descoberto lá aponta para o `<home>/.codex` da distro.
const fs = require('fs');
const path = require('path');

const lê = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const temRtk = home => fs.existsSync(path.join(home, 'RTK.md')) || /\bRTK\b|rtk\.md/i.test(lê(path.join(home, 'AGENTS.md')));

// winHome: .codex do Windows; wslCodexSessions: pastas `.codex/sessions` das distros (wslRoots().codex)
function codexRtkState(winHome, wslCodexSessions = []) {
  const wslHomes = wslCodexSessions.map(s => path.dirname(s));
  const homes = [winHome, ...wslHomes].filter((h, i, a) => a.indexOf(h) === i);
  const found = homes.filter(h => fs.existsSync(h));
  const configured = found.filter(temRtk);
  return {
    installed: found.length > 0,
    configured: configured.length > 0,
    home: (configured[0] || found[0] || winHome),
    homes: found,
  };
}

module.exports = { codexRtkState };

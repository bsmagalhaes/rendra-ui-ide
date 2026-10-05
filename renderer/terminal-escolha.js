/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Escolha do shell ao abrir um novo terminal: Windows ou WSL. Carregado no renderer
// (window.RendraTermEscolha) e nos testes (require).
//
// Com uma opção só (sem WSL, macOS, Linux) o terminal abre direto; com duas ou mais, a IDE mostra um
// menu pequeno. Cada opção traz o `shell` que vai para o pty:create.
(function (root) {
  // shellWindows: { key, label } do shell padrão escolhido na lista. wslInfo: resposta de dev:wsl-info.
  function opcoesDeTerminal(shellWindows, wslInfo) {
    const base = shellWindows || { key: 'powershell', label: 'PowerShell' };
    const opcoes = [{ shell: base.key, label: `Windows (${base.label})` }];
    const distros = wslInfo && wslInfo.available && Array.isArray(wslInfo.distros) ? wslInfo.distros : [];
    for (const d of distros) opcoes.push({ shell: `wsl:${d.name}`, label: `WSL (${d.name})` });
    return opcoes;
  }

  // Pasta do Windows vista de dentro do WSL: "C:\a\b" vira "/mnt/c/a/b". null se não for caminho de unidade.
  function caminhoNoWsl(winPath) {
    const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(String(winPath || ''));
    if (!m) return null;
    const resto = m[2].replace(/[\\/]+/g, '/').replace(/\/$/, '');
    return `/mnt/${m[1].toLowerCase()}${resto ? '/' + resto : ''}`;
  }

  const api = { opcoesDeTerminal, caminhoNoWsl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraTermEscolha = api;
})(typeof window !== 'undefined' ? window : this);

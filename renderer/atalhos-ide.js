/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Atalhos de teclado da IDE (novo terminal, abrir pasta, trocar de aba do editor). Módulo puro, carregado no
// renderer (window.RendraAtalhosIde) e nos testes (require). A escuta e as ações ficam em devcode.js.
//
// Regras (decisões do dono):
//   - Novo terminal: Ctrl+Shift+T (Cmd+Shift+T no macOS).
//   - Abrir pasta: Ctrl+O (Cmd+O no macOS) só com o foco FORA do terminal; dentro do terminal o Ctrl+O vai ao
//     programa (o Claude Code usa para o transcript). No macOS o Cmd+O não é de nenhum programa: vale em todo lugar.
//   - Trocar de aba do editor: Ctrl+Tab (volta com Ctrl+Shift+Tab) nos três sistemas (Cmd+Tab é do macOS).
(function (root) {
  // Ação do atalho, ou null. `foraDoTerminal` diz se o foco está fora do xterm (só o Ctrl+O depende disso).
  // Vale para keydown; o repeat também devolve a ação (o chamador consome a tecla mas não repete a ação).
  function acaoDeAtalhoIde(ev, plataforma, { foraDoTerminal = false } = {}) {
    if (!ev || ev.type !== 'keydown') return null;
    const mac = plataforma === 'darwin';
    const { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta } = ev;
    if (alt) return null;
    if (ev.code === 'Tab') return ctrl && !meta ? (shift ? 'aba-anterior' : 'proxima-aba') : null;
    if (ev.code === 'KeyT') {
      if (mac) return meta && shift && !ctrl ? 'novo-terminal' : null;
      return ctrl && shift && !meta ? 'novo-terminal' : null;
    }
    if (ev.code === 'KeyO' && !shift) {
      if (mac) return meta && !ctrl ? 'abrir-pasta' : null;
      return ctrl && !meta && foraDoTerminal ? 'abrir-pasta' : null;
    }
    return null;
  }

  // Próxima aba (passo +1) ou anterior (-1), em círculo. Sem abas, ou com uma só, ou sem aba ativa na lista: null.
  function proximaAba(abas, ativa, passo) {
    if (!Array.isArray(abas) || abas.length < 2) return null;
    const i = abas.indexOf(ativa);
    if (i < 0) return null;
    return abas[(i + (passo < 0 ? -1 : 1) + abas.length) % abas.length];
  }

  const api = { acaoDeAtalhoIde, proximaAba };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraAtalhosIde = api;
})(typeof window !== 'undefined' ? window : this);

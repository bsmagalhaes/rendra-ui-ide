/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Configurações: estado da caixa "Terminal moderno do Windows (ConPTY embarcado)". Carregado no
// renderer (window.RendraConptyUi) e nos testes (require). Sem DOM.
//
// Vem marcada por padrão: só um false gravado explicitamente a desmarca.
(function (root) {
  function conptyMarcado(settings) {
    return !settings || settings.conptyDll !== false;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { conptyMarcado };
  else root.RendraConptyUi = { conptyMarcado };
})(typeof window !== 'undefined' ? window : this);

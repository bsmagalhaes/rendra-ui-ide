/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Painel do editor da IDE (coluna da direita): regras puras do estado "escondido". Carregado no
// renderer (window.RendraEditorPanel) e nos testes (require). Sem DOM.
//
// Eventos: 'alternar' (botão do cabeçalho dos terminais), 'esconder' (✕ da coluna), 'mostrar',
// 'arquivo-aberto' (o usuário abriu um arquivo: o painel reaparece) e 'arquivo-restaurado'
// (abas reabertas no arranque: o painel fica como estava).
(function (root) {
  function proximo(escondido, evento) {
    const atual = escondido === true;
    switch (evento) {
      case 'alternar': return !atual;
      case 'esconder': return true;
      case 'mostrar':
      case 'arquivo-aberto': return false;
      default: return atual; // 'arquivo-restaurado' e qualquer evento desconhecido
    }
  }

  function rotuloBotao(escondido) {
    return escondido === true
      ? { texto: 'Mostrar editor', pressionado: false }
      : { texto: 'Esconder editor', pressionado: true };
  }

  const api = { proximo, rotuloBotao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraEditorPanel = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Pasta selecionada do explorador (o destino do Colar e do soltar). Funções puras (UMD, testáveis no node).
// Regras: clique em pasta seleciona a pasta (e o devcode.js alterna expandir); clique em arquivo seleciona a pasta que o
// contém; clique em área vazia limpa a seleção (o destino volta a ser a raiz). A seleção vive em ws.selecionado (um
// caminho), por isso sobrevive ao renderTree que o watcher dispara.
// Carregado no renderer (window.RendraSelecaoArvore) e nos testes (require).
(function (root) {
  const paiDeSimples = p => String(p).replace(/[\\/][^\\/]+[\\/]?$/, '');

  // Nova seleção depois de um clique. alvo: null (área vazia) | { ehPasta, caminho }
  function aoClicar(alvo, { raiz, paiDe = paiDeSimples } = {}) {
    if (!alvo) return null;
    if (alvo.ehPasta) return alvo.caminho;
    const pai = paiDe(alvo.caminho);
    return pai || raiz || null;
  }

  // Pasta onde o Colar cai: a selecionada, se ainda existe na árvore (ehPasta confere), senão a raiz do projeto
  function destinoDaSelecao({ selecionado, raiz, ehPasta }) {
    if (selecionado && (selecionado === raiz || (typeof ehPasta === 'function' && ehPasta(selecionado)))) return selecionado;
    return raiz;
  }

  // Tipo do dataTransfer do arraste de itens da árvore: próprio, nunca text/plain (soltar no Monaco ou no xterm não insere texto)
  const TIPO_ARVORE = 'application/x-rendra-arvore';

  const api = { aoClicar, destinoDaSelecao, TIPO_ARVORE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraSelecaoArvore = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Itens do menu do botão direito no explorador, por alvo: função pura (UMD, testável no node). O devcode.js só desenha e
// executa. `alvo`: 'arquivo' | 'pasta' | 'vazio' (área vazia = a raiz). Cada item tem `k` (a ação) e `rotulo`; { sep: true }
// separa os grupos. Excluir fica sempre por último.
(function (root) {
  const NOVO = [{ k: 'file', rotulo: 'Novo arquivo' }, { k: 'dir', rotulo: 'Nova pasta' }];

  const EXCLUIR = { k: 'excluir', rotulo: 'Excluir' };

  function itensDoMenu(alvo) {
    if (alvo === 'arquivo') return [{ k: 'visualizar', rotulo: 'Visualizar' }, { sep: true }, ...NOVO, { sep: true }, EXCLUIR];
    if (alvo === 'pasta') return [...NOVO, { sep: true }, EXCLUIR];
    return [...NOVO]; // a área vazia é a raiz do projeto: nunca excluída
  }

  const api = { itensDoMenu };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraMenuExplorador = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Itens do menu do botão direito no explorador, por alvo: função pura (UMD, testável no node). O devcode.js só desenha e
// executa. `alvo`: 'arquivo' | 'pasta' | 'vazio' (área vazia = a raiz). Cada item tem `k` (a ação) e `rotulo`; { sep: true }
// separa os grupos. Excluir fica sempre por último.
(function (root) {
  const NOVO = [{ k: 'file', rotulo: 'Novo arquivo' }, { k: 'dir', rotulo: 'Nova pasta' }];

  const EXCLUIR = { k: 'excluir', rotulo: 'Excluir' };
  const COPIAR_RECORTAR = [{ k: 'copiar', rotulo: 'Copiar' }, { k: 'recortar', rotulo: 'Recortar' }];
  const COLAR = { k: 'colar', rotulo: 'Colar' };

  // podeColar: há o que colar (uma ação interna pendente do mesmo projeto, ou arquivos copiados no sistema)
  function itensDoMenu(alvo, { podeColar = false } = {}) {
    if (alvo === 'arquivo') return [{ k: 'visualizar', rotulo: 'Visualizar' }, { sep: true }, ...COPIAR_RECORTAR, { sep: true }, ...NOVO, { sep: true }, EXCLUIR];
    if (alvo === 'pasta') return [...NOVO, { sep: true }, ...COPIAR_RECORTAR, ...(podeColar ? [COLAR] : []), { sep: true }, EXCLUIR];
    return [...NOVO, ...(podeColar ? [{ sep: true }, COLAR] : [])]; // a área vazia é a raiz do projeto: nunca excluída nem copiada
  }

  const api = { itensDoMenu };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraMenuExplorador = api;
})(typeof window !== 'undefined' ? window : this);

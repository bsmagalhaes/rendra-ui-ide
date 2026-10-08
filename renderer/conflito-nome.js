/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Fila de decisões de "nome repetido" ao colar, mover ou soltar: Substituir / Manter os dois, com a caixa "Aplicar a todos".
// Função pura (UMD, testável no node): o devcode.js só pergunta, item por item, o que esta fila pede. Cancelar interrompe os
// itens que ainda não têm decisão; as decisões já dadas valem.
// Carregado no renderer (window.RendraConflitoNome) e nos testes (require).
(function (root) {
  const ESCOLHAS = new Set(['substituir', 'manter-ambos']);

  // conflitos: [{ origem, nome, existente }] como o main devolve
  const novaFila = conflitos => ({ itens: (conflitos || []).slice(), decisoes: {}, aplicarATodos: null, cancelado: false });

  // O próximo item que ainda precisa de resposta, ou null (acabou, ou Cancelar)
  const proximo = fila => (fila.cancelado ? null : fila.itens.find(i => !(i.origem in fila.decisoes)) || null);

  // Quantos itens ainda esperam resposta depois do atual: a caixa "Aplicar a todos" só aparece quando restam mais
  const restantes = fila => (fila.cancelado ? 0 : fila.itens.filter(i => !(i.origem in fila.decisoes)).length - 1);

  // resposta: { choice: 'substituir' | 'manter-ambos' | 'cancel', marcado: boolean }. Devolve a fila nova (não muta a antiga).
  function responder(fila, item, resposta) {
    if (!resposta || resposta.choice === 'cancel' || !ESCOLHAS.has(resposta.choice)) return { ...fila, decisoes: { ...fila.decisoes }, cancelado: true };
    const decisoes = { ...fila.decisoes, [item.origem]: resposta.choice };
    let aplicarATodos = fila.aplicarATodos;
    if (resposta.marcado) {
      aplicarATodos = resposta.choice;
      for (const i of fila.itens) if (!(i.origem in decisoes)) decisoes[i.origem] = resposta.choice;
    }
    return { ...fila, decisoes, aplicarATodos, cancelado: false };
  }

  // Origens com decisão e o que foi cancelado: o que o renderer manda de volta ao main
  const resultado = fila => ({ origens: fila.itens.filter(i => i.origem in fila.decisoes).map(i => i.origem), decisoes: { ...fila.decisoes }, cancelado: fila.cancelado });

  const api = { novaFila, proximo, restantes, responder, resultado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraConflitoNome = api;
})(typeof window !== 'undefined' ? window : this);

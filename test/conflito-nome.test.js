const test = require('node:test');
const assert = require('node:assert');
const C = require('../renderer/conflito-nome');

const itens = ['a', 'b', 'c'].map(n => ({ origem: `/o/${n}`, nome: n, existente: `/d/${n}` }));

test('a fila pede um item por vez, na ordem, até acabar', () => {
  let f = C.novaFila(itens);
  assert.strictEqual(C.proximo(f).nome, 'a');
  assert.strictEqual(C.restantes(f), 2);
  f = C.responder(f, C.proximo(f), { choice: 'substituir', marcado: false });
  assert.strictEqual(C.proximo(f).nome, 'b');
  assert.strictEqual(C.restantes(f), 1);
  f = C.responder(f, C.proximo(f), { choice: 'manter-ambos', marcado: false });
  f = C.responder(f, C.proximo(f), { choice: 'substituir', marcado: false });
  assert.strictEqual(C.proximo(f), null);
  assert.deepStrictEqual(C.resultado(f), { origens: ['/o/a', '/o/b', '/o/c'], decisoes: { '/o/a': 'substituir', '/o/b': 'manter-ambos', '/o/c': 'substituir' }, cancelado: false });
});

test('"Aplicar a todos" decide os itens que restam com a mesma escolha e acaba a fila', () => {
  let f = C.novaFila(itens);
  f = C.responder(f, C.proximo(f), { choice: 'manter-ambos', marcado: false });
  f = C.responder(f, C.proximo(f), { choice: 'substituir', marcado: true });
  assert.strictEqual(C.proximo(f), null);
  assert.deepStrictEqual(C.resultado(f).decisoes, { '/o/a': 'manter-ambos', '/o/b': 'substituir', '/o/c': 'substituir' });
  assert.strictEqual(f.aplicarATodos, 'substituir');
});

test('Cancelar interrompe os itens sem decisão; as decisões já dadas ficam', () => {
  let f = C.novaFila(itens);
  f = C.responder(f, C.proximo(f), { choice: 'substituir', marcado: false });
  f = C.responder(f, C.proximo(f), { choice: 'cancel', marcado: true }); // a caixa marcada não vale no Cancelar
  assert.strictEqual(C.proximo(f), null);
  assert.strictEqual(C.restantes(f), 0);
  assert.deepStrictEqual(C.resultado(f), { origens: ['/o/a'], decisoes: { '/o/a': 'substituir' }, cancelado: true });
});

test('resposta inválida cancela; a fila antiga não é mutada; fila vazia não pede nada', () => {
  const f0 = C.novaFila(itens);
  const f1 = C.responder(f0, C.proximo(f0), { choice: 'apagar-tudo' });
  assert.strictEqual(f1.cancelado, true);
  assert.deepStrictEqual(f0.decisoes, {});
  assert.strictEqual(f0.cancelado, false);
  assert.strictEqual(C.proximo(C.novaFila([])), null);
  assert.strictEqual(C.proximo(C.novaFila(undefined)), null);
});

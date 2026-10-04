// Reordenar abas (renderer/reordenar-abas.js): movimento por arraste (antes/depois) e por passo, pontas, mesmo lugar,
// item ativo acompanhando, o tipo próprio do arraste e o anúncio.
const test = require('node:test');
const assert = require('node:assert');
const { moverPara, moverPorDelta, indiceDe, anuncio, aceitaArraste, TIPO } = require('../renderer/reordenar-abas');

test('arraste: o terceiro vai para antes do primeiro', () => {
  const r = moverPara(['a', 'b', 'c'], 2, 0, false);
  assert.deepStrictEqual(r.lista, ['c', 'a', 'b']);
  assert.strictEqual(r.indice, 0);
  assert.strictEqual(r.mudou, true);
});

test('arraste: o primeiro vai para depois do último, e o do meio para depois do primeiro', () => {
  assert.deepStrictEqual(moverPara(['a', 'b', 'c'], 0, 2, true).lista, ['b', 'c', 'a']);
  assert.strictEqual(moverPara(['a', 'b', 'c'], 0, 2, true).indice, 2);
  assert.deepStrictEqual(moverPara(['a', 'b', 'c', 'd'], 2, 0, true).lista, ['a', 'c', 'b', 'd']);
});

test('arraste: soltar no mesmo lugar não muda nada (sobre si, antes do seguinte, depois do anterior)', () => {
  const l = ['a', 'b', 'c'];
  for (const [de, alvo, depois] of [[1, 1, false], [1, 1, true], [1, 2, false], [1, 0, true]]) {
    const r = moverPara(l, de, alvo, depois);
    assert.strictEqual(r.mudou, false, `de ${de} alvo ${alvo} depois ${depois}`);
    assert.deepStrictEqual(r.lista, l);
    assert.strictEqual(r.indice, de);
  }
});

test('arraste: índices inválidos, lista vazia e de 1 item não mudam nada e não lançam', () => {
  assert.strictEqual(moverPara([], 0, 0, false).mudou, false);
  assert.strictEqual(moverPara(['a'], 0, 0, true).mudou, false);
  assert.strictEqual(moverPara(['a', 'b'], 5, 0, false).mudou, false);
  assert.strictEqual(moverPara(['a', 'b'], 0, -1, false).mudou, false);
  assert.strictEqual(moverPara(['a', 'b'], 0.5, 1, false).mudou, false);
  assert.strictEqual(moverPara(undefined, 0, 0, false).mudou, false);
});

test('a lista original nunca é alterada', () => {
  const l = ['a', 'b', 'c'];
  moverPara(l, 2, 0, false);
  moverPorDelta(l, 1, 1);
  assert.deepStrictEqual(l, ['a', 'b', 'c']);
});

test('passo: direita e esquerda no meio, e travado nas pontas (sem dar a volta)', () => {
  assert.deepStrictEqual(moverPorDelta(['a', 'b', 'c'], 1, 1).lista, ['a', 'c', 'b']);
  assert.strictEqual(moverPorDelta(['a', 'b', 'c'], 1, 1).indice, 2);
  assert.deepStrictEqual(moverPorDelta(['a', 'b', 'c'], 1, -1).lista, ['b', 'a', 'c']);
  assert.strictEqual(moverPorDelta(['a', 'b', 'c'], 1, -1).indice, 0);
  const ini = moverPorDelta(['a', 'b', 'c'], 0, -1);
  assert.strictEqual(ini.mudou, false); assert.strictEqual(ini.indice, 0);
  const fim = moverPorDelta(['a', 'b', 'c'], 2, 1);
  assert.strictEqual(fim.mudou, false); assert.strictEqual(fim.indice, 2);
  assert.strictEqual(moverPorDelta(['a'], 0, 1).mudou, false);
  assert.strictEqual(moverPorDelta(['a', 'b'], 0, 2).mudou, false);
  assert.strictEqual(moverPorDelta(['a', 'b'], 7, 1).mudou, false);
});

test('o item de referência (o ativo) é acompanhado pelo índice novo', () => {
  const projetos = ['p1', 'p2', 'p3'];
  const ativo = 'p2';
  const r = moverPara(projetos, 2, 0, false);
  assert.strictEqual(indiceDe(r.lista, ativo), 2); // o ativo andou de 1 para 2, o movido ficou em 0
  assert.strictEqual(r.lista[r.indice], 'p3');
});

test('anúncio: posição de 1 a N em português', () => {
  assert.strictEqual(anuncio('Projeto A', 0, 3), 'Projeto A movida para a posição 1 de 3');
  assert.strictEqual(anuncio('x', 2, 3), 'x movida para a posição 3 de 3');
});

test('arraste só vale com o tipo próprio da IDE e na mesma barra', () => {
  assert.strictEqual(TIPO, 'application/x-rendra-aba');
  const est = { barra: 'projetos', id: 1 };
  assert.strictEqual(aceitaArraste([TIPO], est, 'projetos'), true);
  assert.strictEqual(aceitaArraste(['text/plain'], est, 'projetos'), false); // texto de fora (o nome de um arquivo, por exemplo)
  assert.strictEqual(aceitaArraste([TIPO], est, 'terminais'), false);
  assert.strictEqual(aceitaArraste([TIPO], null, 'projetos'), false);
  assert.strictEqual(aceitaArraste(undefined, est, 'projetos'), false);
});

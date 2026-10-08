const test = require('node:test');
const assert = require('node:assert');
const { itensDoMenu } = require('../renderer/menu-explorador');

const rotulos = alvo => itensDoMenu(alvo).filter(i => !i.sep).map(i => i.rotulo);

test('pasta e área vazia mantêm Novo arquivo e Nova pasta', () => {
  assert.deepStrictEqual(rotulos('pasta'), ['Novo arquivo', 'Nova pasta']);
  assert.deepStrictEqual(rotulos('vazio'), ['Novo arquivo', 'Nova pasta']);
});

test('arquivo ganha Visualizar e mantém os itens de criar (a pasta nasce na pasta do arquivo)', () => {
  assert.deepStrictEqual(rotulos('arquivo'), ['Visualizar', 'Novo arquivo', 'Nova pasta']);
});

test('cada item tem uma ação única', () => {
  for (const alvo of ['arquivo', 'pasta', 'vazio']) {
    const ks = itensDoMenu(alvo).filter(i => !i.sep).map(i => i.k);
    assert.strictEqual(new Set(ks).size, ks.length);
  }
});

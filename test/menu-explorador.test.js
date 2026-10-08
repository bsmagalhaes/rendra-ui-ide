const test = require('node:test');
const assert = require('node:assert');
const { itensDoMenu } = require('../renderer/menu-explorador');

const rotulos = alvo => itensDoMenu(alvo).filter(i => !i.sep).map(i => i.rotulo);

test('a área vazia (a raiz do projeto) só tem os itens de criar e nunca Excluir', () => {
  assert.deepStrictEqual(rotulos('vazio'), ['Novo arquivo', 'Nova pasta']);
});

test('pasta mantém Novo arquivo e Nova pasta e tem Excluir por último', () => {
  assert.deepStrictEqual(rotulos('pasta'), ['Novo arquivo', 'Nova pasta', 'Excluir']);
});

test('arquivo ganha Visualizar, mantém os itens de criar (a pasta nasce na pasta do arquivo) e Excluir por último', () => {
  assert.deepStrictEqual(rotulos('arquivo'), ['Visualizar', 'Novo arquivo', 'Nova pasta', 'Excluir']);
});

test('cada item tem uma ação única', () => {
  for (const alvo of ['arquivo', 'pasta', 'vazio']) {
    const ks = itensDoMenu(alvo).filter(i => !i.sep).map(i => i.k);
    assert.strictEqual(new Set(ks).size, ks.length);
  }
});

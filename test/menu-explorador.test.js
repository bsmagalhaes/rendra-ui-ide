const test = require('node:test');
const assert = require('node:assert');
const { itensDoMenu } = require('../renderer/menu-explorador');

const rotulos = (alvo, estado) => itensDoMenu(alvo, estado).filter(i => !i.sep).map(i => i.rotulo);

test('a área vazia (a raiz do projeto) só tem os itens de criar, ganha Colar quando há o que colar e nunca Excluir', () => {
  assert.deepStrictEqual(rotulos('vazio'), ['Novo arquivo', 'Nova pasta']);
  assert.deepStrictEqual(rotulos('vazio', { podeColar: true }), ['Novo arquivo', 'Nova pasta', 'Colar']);
});

test('pasta: criar, Copiar, Recortar, Colar só quando há o que colar, e Excluir por último', () => {
  assert.deepStrictEqual(rotulos('pasta'), ['Novo arquivo', 'Nova pasta', 'Copiar', 'Recortar', 'Excluir']);
  assert.deepStrictEqual(rotulos('pasta', { podeColar: true }), ['Novo arquivo', 'Nova pasta', 'Copiar', 'Recortar', 'Colar', 'Excluir']);
});

test('arquivo: Visualizar, Copiar, Recortar, os itens de criar (a pasta nasce na pasta do arquivo) e Excluir por último; nunca Colar', () => {
  assert.deepStrictEqual(rotulos('arquivo'), ['Visualizar', 'Copiar', 'Recortar', 'Novo arquivo', 'Nova pasta', 'Excluir']);
  assert.deepStrictEqual(rotulos('arquivo', { podeColar: true }), ['Visualizar', 'Copiar', 'Recortar', 'Novo arquivo', 'Nova pasta', 'Excluir']);
});

test('cada item tem uma ação única', () => {
  for (const alvo of ['arquivo', 'pasta', 'vazio']) {
    const ks = itensDoMenu(alvo, { podeColar: true }).filter(i => !i.sep).map(i => i.k);
    assert.strictEqual(new Set(ks).size, ks.length);
  }
});

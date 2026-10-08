const test = require('node:test');
const assert = require('node:assert');
const S = require('../renderer/selecao-arvore');

const raiz = 'C:\\p';

test('clique em pasta seleciona a pasta; em arquivo, a pasta que o contém; em área vazia, limpa', () => {
  assert.strictEqual(S.aoClicar({ ehPasta: true, caminho: 'C:\\p\\sub' }, { raiz }), 'C:\\p\\sub');
  assert.strictEqual(S.aoClicar({ ehPasta: false, caminho: 'C:\\p\\sub\\a.txt' }, { raiz }), 'C:\\p\\sub');
  assert.strictEqual(S.aoClicar({ ehPasta: false, caminho: 'C:\\p\\a.txt' }, { raiz }), 'C:\\p');
  assert.strictEqual(S.aoClicar({ ehPasta: false, caminho: '/p/sub/a.txt' }, { raiz: '/p' }), '/p/sub');
  assert.strictEqual(S.aoClicar(null, { raiz }), null);
});

test('destino do Colar: a pasta selecionada, ou a raiz quando não há seleção ou ela sumiu', () => {
  const existe = new Set(['C:\\p\\sub']);
  const ehPasta = p => existe.has(p);
  assert.strictEqual(S.destinoDaSelecao({ selecionado: 'C:\\p\\sub', raiz, ehPasta }), 'C:\\p\\sub');
  assert.strictEqual(S.destinoDaSelecao({ selecionado: null, raiz, ehPasta }), raiz);
  assert.strictEqual(S.destinoDaSelecao({ selecionado: 'C:\\p\\sumiu', raiz, ehPasta }), raiz);
  assert.strictEqual(S.destinoDaSelecao({ selecionado: raiz, raiz, ehPasta }), raiz);
  assert.strictEqual(S.destinoDaSelecao({ selecionado: 'C:\\p\\sub', raiz }), raiz, 'sem como conferir, não arrisca');
});

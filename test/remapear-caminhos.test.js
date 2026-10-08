const test = require('node:test');
const assert = require('node:assert');
const { contem, remapear } = require('../renderer/remapear-caminhos');

test('contem respeita a fronteira do separador: a/b não contém a/bc', () => {
  assert.ok(contem('C:\\p\\a', 'C:\\p\\a'));
  assert.ok(contem('C:\\p\\a', 'C:\\p\\a\\b.txt'));
  assert.ok(contem('C:\\p\\a', 'C:\\p\\a\\b\\c.txt'));
  assert.ok(!contem('C:\\p\\a', 'C:\\p\\ab'));
  assert.ok(!contem('C:\\p\\a', 'C:\\p\\ab\\c.txt'));
  assert.ok(!contem('C:\\p\\a\\b', 'C:\\p\\a'));
  assert.ok(contem('/p/a', '/p/a/b'));
  assert.ok(!contem('/p/a', '/p/ab'));
  assert.ok(!contem('', '/p'));
});

test('contem aceita barras misturadas e barra no fim', () => {
  assert.ok(contem('C:/p/a/', 'C:\\p\\a\\b.txt'));
  assert.ok(contem('C:\\p\\a\\', 'C:/p/a/b'));
});

test('a caixa vale por plataforma: insensível só quando pedido', () => {
  assert.ok(!contem('C:\\P\\A', 'c:\\p\\a\\b'));
  assert.ok(contem('C:\\P\\A', 'c:\\p\\a\\b', { insensivel: true }));
  assert.ok(!contem('C:\\P\\Ab', 'c:\\p\\a\\b', { insensivel: true }));
});

test('contem enxerga também a chave de aba vista:<caminho>', () => {
  assert.ok(contem('C:\\p\\a', 'vista:C:\\p\\a\\x.md'));
  assert.ok(!contem('C:\\p\\a', 'vista:C:\\p\\ab\\x.md'));
});

test('remapear troca só o prefixo e mantém o resto como veio', () => {
  assert.strictEqual(remapear('C:\\p\\a', 'C:\\p\\novo', 'C:\\p\\a\\b\\c.txt'), 'C:\\p\\novo\\b\\c.txt');
  assert.strictEqual(remapear('C:\\p\\a', 'C:\\q\\a', 'C:\\p\\a'), 'C:\\q\\a');
  assert.strictEqual(remapear('/p/a', '/p/b/a', '/p/a/x/y'), '/p/b/a/x/y');
  assert.strictEqual(remapear('C:\\p\\a.txt', 'C:\\p\\sub\\a.txt', 'C:\\p\\a.txt'), 'C:\\p\\sub\\a.txt');
});

test('remapear não toca em quem está fora, nem no irmão de nome parecido', () => {
  assert.strictEqual(remapear('C:\\p\\a', 'C:\\p\\z', 'C:\\p\\ab\\c.txt'), 'C:\\p\\ab\\c.txt');
  assert.strictEqual(remapear('C:\\p\\a', 'C:\\p\\z', 'C:\\outro\\a\\c.txt'), 'C:\\outro\\a\\c.txt');
});

test('remapear preserva o prefixo vista: e a caixa original do resto, mesmo insensível', () => {
  assert.strictEqual(remapear('C:\\p\\a', 'C:\\p\\z', 'vista:C:\\p\\a\\L.md'), 'vista:C:\\p\\z\\L.md');
  assert.strictEqual(remapear('C:\\P\\A', 'C:\\p\\z', 'c:\\p\\a\\Leia.md', { insensivel: true }), 'C:\\p\\z\\Leia.md');
});

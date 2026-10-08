const test = require('node:test');
const assert = require('node:assert');
const { escolherOrigemDoColar } = require('../renderer/precedencia-colar');

test('sem ação interna, vale o clipboard do sistema', () => {
  assert.strictEqual(escolherOrigemDoColar({ interna: null, assinaturaAgora: 'x', wsId: 1 }), 'so');
});

test('ação interna e clipboard do sistema igual: vale a interna', () => {
  assert.strictEqual(escolherOrigemDoColar({ interna: { wsId: 1, assinatura: 'x' }, assinaturaAgora: 'x', wsId: 1 }), 'interna');
});

test('o usuário copiou outros arquivos no sistema depois: vale o do sistema', () => {
  assert.strictEqual(escolherOrigemDoColar({ interna: { wsId: 1, assinatura: 'x' }, assinaturaAgora: 'y', wsId: 1 }), 'so');
});

test('a interna de outro projeto não vale aqui', () => {
  assert.strictEqual(escolherOrigemDoColar({ interna: { wsId: 2, assinatura: 'x' }, assinaturaAgora: 'x', wsId: 1 }), 'outro-projeto');
  assert.strictEqual(escolherOrigemDoColar({ interna: { wsId: 2, assinatura: 'x' }, assinaturaAgora: 'z', wsId: 1 }), 'so');
});

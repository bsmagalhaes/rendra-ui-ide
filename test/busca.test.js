// Núcleo puro da busca (src/busca.js): casamento por linha, palavra inteira, regex, limites e regras de pasta.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/busca');

const achar = (conteudo, opcoes, extra) => {
  const m = B.montarMatcher({ termo: 'x', ...opcoes });
  assert.ok(m.ok, m.erro);
  return B.buscarNoTexto(conteudo, m, extra);
};

test('literal ignora maiúsculas por padrão e diferenciar respeita a caixa', () => {
  assert.deepStrictEqual(achar('Gato\ngato\nGATO', { termo: 'gato' }).map(o => o.linha), [1, 2, 3]);
  assert.deepStrictEqual(achar('Gato\ngato\nGATO', { termo: 'gato', diferenciar: true }).map(o => o.linha), [2]);
});

test('o termo literal escapa a expressão: "a.c" não casa "abc"', () => {
  assert.deepStrictEqual(achar('abc\na.c', { termo: 'a.c' }).map(o => o.linha), [2]);
});

test('palavra inteira: cat não casa em concatenar nem em cat_2, casa em "um cat."', () => {
  const r = achar('concatenar\ncat_2\num cat.\ncatálogo\n(cat)', { termo: 'cat', palavra: true });
  assert.deepStrictEqual(r.map(o => o.linha), [3, 5]);
});

test('regex com grupo e alternância', () => {
  const r = achar('foo123\nbar9\nbaz', { termo: '(foo|bar)\\d+', regex: true });
  assert.deepStrictEqual(r.map(o => o.trecho), ['foo123', 'bar9']);
  assert.deepStrictEqual(r[0].marcas, [[0, 6]]);
});

test('regex inválida devolve { ok: false, erro } sem lançar', () => {
  assert.deepStrictEqual(B.montarMatcher({ termo: '(', regex: true }), { ok: false, erro: 'Expressão regular inválida' });
  assert.strictEqual(B.montarMatcher({ termo: '' }).ok, false);
});

test('regex que casa vazio não gera ocorrência', () => {
  assert.deepStrictEqual(achar('abc\n\nxyz', { termo: 'z*', regex: true }).map(o => o.linha), [3]);
  assert.deepStrictEqual(achar('abc', { termo: 'x*', regex: true }), []);
});

test('linha e coluna a partir de 1, com \\r\\n, \\r isolado e BOM', () => {
  const r = achar('﻿um\r\ndois alvo\rtres\nquatro alvo', { termo: 'alvo' });
  assert.deepStrictEqual(r.map(o => [o.linha, o.coluna]), [[2, 6], [4, 8]]);
  assert.strictEqual(achar('﻿alvo', { termo: 'alvo' })[0].coluna, 1);
});

test('trecho longo vem cortado em 200 caracteres com a marca dentro do trecho', () => {
  const linha = `${'.'.repeat(300)}ALVO${'.'.repeat(300)}`;
  const [o] = achar(linha, { termo: 'alvo' });
  assert.ok(o.trecho.length <= 200);
  assert.strictEqual(o.coluna, 301);
  assert.strictEqual(o.marcas.length, 1);
  assert.strictEqual(o.trecho.slice(o.marcas[0][0], o.marcas[0][1]), 'ALVO');
});

test('o trecho é aparado e as marcas acompanham o recuo', () => {
  const [o] = achar('      const alvo = 1;   ', { termo: 'alvo' });
  assert.strictEqual(o.trecho, 'const alvo = 1;');
  assert.strictEqual(o.trecho.slice(o.marcas[0][0], o.marcas[0][1]), 'alvo');
  assert.strictEqual(o.coluna, 13);
});

test('até 5 marcas por linha e parada em maxOcorrencias', () => {
  assert.strictEqual(achar('a a a a a a a a', { termo: 'a' })[0].marcas.length, 5);
  assert.strictEqual(achar('a\na\na\na', { termo: 'a' }, { maxOcorrencias: 2 }).length, 2);
});

test('casaNome: substring sem diferenciar maiúsculas', () => {
  assert.ok(B.casaNome('Relatorio-Final.PDF', 'final'));
  assert.ok(!B.casaNome('relatorio.pdf', 'final'));
  assert.ok(!B.casaNome('x', ''));
});

test('ehTexto: byte nulo nos primeiros 8000 bytes é binário', () => {
  assert.ok(B.ehTexto(Buffer.from('texto simples')));
  assert.ok(!B.ehTexto(Buffer.from([65, 0, 66])));
  const longo = Buffer.concat([Buffer.alloc(8000, 65), Buffer.from([0])]);
  assert.ok(B.ehTexto(longo));
});

test('ignorarPasta: .git sempre; node_modules só fora de repositório', () => {
  assert.ok(B.ignorarPasta('.git', { git: true }) && B.ignorarPasta('.git', { git: false }));
  assert.ok(B.ignorarPasta('node_modules', { git: false }));
  assert.ok(!B.ignorarPasta('node_modules', { git: true }));
  assert.ok(!B.ignorarPasta('src', { git: false }));
});

test('limitar só reduz: valor maior que o padrão é rebaixado; UNC tem 20 s', () => {
  assert.deepStrictEqual(B.limitar({}), { ocorrencias: 500, arquivos: 200, tempoMs: 10000, bytesArquivo: 1048576 });
  assert.strictEqual(B.limitar({ ocorrencias: 999999, arquivos: 9999, tempoMs: 99999, bytesArquivo: 1e12 }).ocorrencias, 500);
  assert.strictEqual(B.limitar({ tempoMs: 99999 }).tempoMs, 10000);
  assert.strictEqual(B.limitar({ tempoMs: 99999 }, { unc: true }).tempoMs, 20000);
  assert.strictEqual(B.limitar({ ocorrencias: 3, tempoMs: 50 }).ocorrencias, 3);
  assert.strictEqual(B.limitar({ ocorrencias: -1, arquivos: 'x' }).ocorrencias, 500);
});

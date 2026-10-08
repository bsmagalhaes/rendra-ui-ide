const test = require('node:test');
const assert = require('node:assert');
const { temArquivos, assinatura } = require('../src/clip-arquivos');

const item = (types, lista) => ({ types, getType: async t => { if (t === 'text/uri-list' && lista != null) return { text: async () => lista }; throw new Error('sem'); } });
const falso = ({ itens = [], texto = '' } = {}) => ({ read: async () => itens, readText: async () => texto });

test('temArquivos reconhece a lista de arquivos do sistema (Windows, Linux, macOS)', async () => {
  assert.strictEqual(await temArquivos(falso({ itens: [item(['text/uri-list', 'electron application/osclipboard;format="FileName"'])] })), true);
  assert.strictEqual(await temArquivos(falso({ itens: [item(['electron application/osclipboard;format="FileNameW"'])] })), true);
  assert.strictEqual(await temArquivos(falso({ itens: [item(['electron application/osclipboard;format="public.file-url"'])] })), true);
  assert.strictEqual(await temArquivos(falso({ itens: [item(['electron application/osclipboard;format="x-special/gnome-copied-files"'])] })), true);
});

test('temArquivos é falso para texto, imagem e clipboard vazio', async () => {
  assert.strictEqual(await temArquivos(falso({ itens: [item(['text/plain', 'text/html'])] })), false);
  assert.strictEqual(await temArquivos(falso({ itens: [item(['image/png'])] })), false);
  assert.strictEqual(await temArquivos(falso()), false);
});

test('nunca lança: clipboard que quebra vira "sem arquivos" e assinatura estável', async () => {
  const quebrado = { read: async () => { throw new Error('x'); }, readText: async () => { throw new Error('y'); } };
  assert.strictEqual(await temArquivos(quebrado), false);
  assert.match(await assinatura(quebrado), /^[0-9a-f]{40}$/);
  assert.strictEqual(await assinatura(quebrado), await assinatura(quebrado));
  assert.strictEqual(await temArquivos({}), false);
  assert.match(await assinatura({}), /^[0-9a-f]{40}$/);
});

test('a assinatura muda com o texto, com os tipos e com a LISTA de arquivos (copiar outros arquivos)', async () => {
  const base = await assinatura(falso({ itens: [item(['text/uri-list'], 'file:///c:/a.txt')] }));
  assert.strictEqual(await assinatura(falso({ itens: [item(['text/uri-list'], 'file:///c:/a.txt')] })), base);
  assert.notStrictEqual(await assinatura(falso({ itens: [item(['text/uri-list'], 'file:///c:/b.txt')] })), base, 'outros arquivos');
  assert.notStrictEqual(await assinatura(falso({ itens: [item(['text/plain'])], texto: 'oi' })), base, 'outro tipo');
  assert.notStrictEqual(await assinatura(falso({ itens: [item(['text/plain'])], texto: 'oi' })), await assinatura(falso({ itens: [item(['text/plain'])], texto: 'tchau' })), 'outro texto');
});

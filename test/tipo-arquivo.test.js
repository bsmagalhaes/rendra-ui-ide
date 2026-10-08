const test = require('node:test');
const assert = require('node:assert');
const T = require('../renderer/tipo-arquivo');

test('tipoDe separa imagem, áudio, vídeo, PDF e texto pela extensão, sem diferenciar maiúsculas', () => {
  const casos = {
    'a.png': 'imagem', 'FOTO.JPG': 'imagem', 'x.jpeg': 'imagem', 'x.gif': 'imagem', 'x.webp': 'imagem', 'x.bmp': 'imagem', 'x.ico': 'imagem', 'x.avif': 'imagem',
    'a.mp3': 'audio', 'a.WAV': 'audio', 'a.ogg': 'audio', 'a.oga': 'audio', 'a.m4a': 'audio', 'a.aac': 'audio', 'a.flac': 'audio', 'a.opus': 'audio',
    'v.mp4': 'video', 'v.m4v': 'video', 'v.webm': 'video', 'v.ogv': 'video', 'v.MOV': 'video',
    'doc.pdf': 'pdf', 'DOC.PDF': 'pdf',
  };
  for (const [nome, tipo] of Object.entries(casos)) assert.strictEqual(T.tipoDe(nome), tipo, nome);
});

test('SVG, HTML, Markdown, mkv, binários e extensão desconhecida ficam como texto; sem extensão também', () => {
  for (const n of ['a.svg', 'a.html', 'a.htm', 'a.md', 'a.txt', 'a.mkv', 'a.zip', 'a.exe', 'Makefile', '.env', '.gitignore', 'a.', '', 'dir.png/arquivo']) {
    assert.strictEqual(T.tipoDe(n), 'texto', JSON.stringify(n));
  }
  assert.strictEqual(T.tipoDe('C:\\p\\sub.png\\leia'), 'texto');
  assert.strictEqual(T.tipoDe('C:\\p\\foto.PNG'), 'imagem');
});

test('mimeDe só devolve os tipos de mídia e PDF; nunca HTML nem SVG', () => {
  assert.strictEqual(T.mimeDe('a.png'), 'image/png');
  assert.strictEqual(T.mimeDe('a.mp4'), 'video/mp4');
  assert.strictEqual(T.mimeDe('a.mp3'), 'audio/mpeg');
  assert.strictEqual(T.mimeDe('a.pdf'), 'application/pdf');
  for (const n of ['a.svg', 'a.html', 'a.htm', 'a.js', 'a.txt', 'a.mkv', 'semextensao']) assert.strictEqual(T.mimeDe(n), null, n);
});

test('vistaDe diz como o Visualizar mostra o arquivo de texto', () => {
  assert.strictEqual(T.vistaDe('a.md'), 'markdown');
  assert.strictEqual(T.vistaDe('A.MARKDOWN'), 'markdown');
  assert.strictEqual(T.vistaDe('a.svg'), 'svg');
  assert.strictEqual(T.vistaDe('a.html'), 'html');
  assert.strictEqual(T.vistaDe('a.htm'), 'html');
  assert.strictEqual(T.vistaDe('a.js'), 'texto');
});

test('a chave de aba de visualização carrega o prefixo e volta ao caminho', () => {
  const k = T.chaveVista('C:\\p\\a.md');
  assert.strictEqual(k, 'vista:C:\\p\\a.md');
  assert.ok(T.ehChaveVista(k));
  assert.ok(!T.ehChaveVista('C:\\p\\a.md'));
  assert.strictEqual(T.caminhoDaChave(k), 'C:\\p\\a.md');
  assert.strictEqual(T.caminhoDaChave('C:\\p\\a.md'), 'C:\\p\\a.md');
});

test('urlMidia codifica o caminho inteiro num só segmento do esquema da mídia', () => {
  const u = T.urlMidia('C:\\p q\\a b.png');
  assert.ok(u.startsWith('rendra-midia://arquivo/'));
  assert.strictEqual(decodeURIComponent(new URL(u).pathname.slice(1)), 'C:\\p q\\a b.png');
});

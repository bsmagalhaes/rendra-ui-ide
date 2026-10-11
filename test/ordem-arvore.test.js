// Ordem da árvore do explorador (src/ordem-arvore.js): pastas com ponto, demais pastas, arquivos com ponto, demais arquivos.
const test = require('node:test');
const assert = require('node:assert');
const { ordenarEntradas, compararEntradas } = require('../src/ordem-arvore');

const d = name => ({ name, isDir: true });
const f = name => ({ name, isDir: false });
const nomes = lista => ordenarEntradas(lista).map(e => e.name);

test('a ordem do dono: pastas com ponto, demais pastas, arquivos com ponto, demais arquivos', () => {
  const lista = [f('README.md'), d('src'), f('.gitignore'), f('b.txt'), d('.github'), f('Zeta.txt'), f('.env'), d('a')];
  assert.deepStrictEqual(nomes(lista), ['.github', 'a', 'src', '.env', '.gitignore', 'b.txt', 'README.md', 'Zeta.txt']);
});

test('dentro de cada grupo vale o nome, sem diferenciar maiúsculas e acentos, e o ponto inicial não conta', () => {
  const lista = [f('é.txt'), f('E.txt'), f('d.txt'), f('.b'), f('.A'), d('.vscode'), d('.github'), d('Zoo'), d('árvore'), d('beta')];
  assert.deepStrictEqual(nomes(lista), ['.github', '.vscode', 'árvore', 'beta', 'Zoo', '.A', '.b', 'd.txt', 'E.txt', 'é.txt']);
});

test('o .env fica no bloco dos ocultos (começa com ponto), antes dos arquivos comuns', () => {
  const r = nomes([f('app.js'), f('.env'), f('.env.local')]);
  assert.deepStrictEqual(r, ['.env', '.env.local', 'app.js']);
});

test('nomes que só diferem na caixa têm ordem fixa, não a do readdir', () => {
  const um = nomes([f('readme.md'), f('README.md')]);
  const outro = nomes([f('README.md'), f('readme.md')]);
  assert.deepStrictEqual(um, outro);
});

test('não altera a lista recebida e compararEntradas é antissimétrica', () => {
  const lista = [f('b'), d('a')];
  nomes(lista);
  assert.deepStrictEqual(lista.map(e => e.name), ['b', 'a']);
  assert.strictEqual(Math.sign(compararEntradas(d('a'), f('b'))), -Math.sign(compararEntradas(f('b'), d('a'))));
});

// dev:list (handler real): a ordem da árvore na pasta de verdade, a forma da resposta e o confinamento.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');

test.after(limpar);

test('dev:list devolve a ordem do dono, sem .git, no formato { name, path, isDir }', async () => {
  const raiz = pasta();
  for (const d of ['.github', 'src', 'a', '.git']) fs.mkdirSync(path.join(raiz, d));
  for (const f of ['.env', '.gitignore', 'README.md', 'b.txt', 'Zeta.txt']) fs.writeFileSync(path.join(raiz, f), 'x');
  const { call } = montar([raiz]);
  const lista = await call('dev:list', raiz);
  assert.deepStrictEqual(lista.map(e => e.name), ['.github', 'a', 'src', '.env', '.gitignore', 'b.txt', 'README.md', 'Zeta.txt']);
  assert.ok(!lista.some(e => e.name === '.git'));
  assert.deepStrictEqual(Object.keys(lista[0]).sort(), ['isDir', 'name', 'path']);
  assert.strictEqual(lista[0].path, path.join(raiz, '.github'));
  assert.strictEqual(lista[0].isDir, true);
  assert.strictEqual(lista[3].isDir, false);
});

test('dev:list fora das pastas abertas devolve { error }', async () => {
  const raiz = pasta();
  const fora = pasta();
  const { call } = montar([raiz]);
  const r = await call('dev:list', fora);
  assert.deepStrictEqual(r, { error: 'Caminho fora das pastas abertas' });
});

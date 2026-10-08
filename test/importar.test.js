// Importação do sistema (Ctrl+V de arquivos copiados no Explorer e soltar na árvore): o main só aceita um id que ele mesmo
// emitiu (a lista nasce no preload, pelo webUtils); nenhum caminho em texto vindo do renderer vira origem.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');

test.after(limpar);

const escreve = (raiz, mapa) => { for (const [rel, c] of Object.entries(mapa)) { const p = path.join(raiz, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); if (c === null) fs.mkdirSync(p, { recursive: true }); else fs.writeFileSync(p, c); } };

test('registrar devolve só { id, nomes } e ignora o que não é caminho absoluto', async () => {
  const raiz = pasta(), fora = pasta();
  escreve(fora, { 'a.txt': 'A' });
  const t = montar(raiz);
  assert.strictEqual(await t.call('dev:import-registrar', []), null);
  assert.strictEqual(await t.call('dev:import-registrar', ['relativo.txt', '', 42, null, 'a\0b']), null);
  assert.strictEqual(await t.call('dev:import-registrar', 'texto solto'), null);
  const r = await t.call('dev:import-registrar', [path.join(fora, 'a.txt'), 'relativo.txt', path.join(fora, 'a.txt')]);
  assert.deepStrictEqual(Object.keys(r).sort(), ['id', 'nomes']);
  assert.deepStrictEqual(r.nomes, ['a.txt']);
  assert.match(r.id, /^[0-9a-f-]{36}$/);
});

test('importa arquivo e pasta com subpastas de fora do projeto; a origem fica intacta', async () => {
  const raiz = pasta(), fora = pasta();
  escreve(raiz, { 'dest': null });
  escreve(fora, { 'a.txt': 'A', 'pasta/x.txt': 'X', 'pasta/sub/y.txt': 'Y', 'pasta/vazia': null });
  const t = montar(raiz);
  const { id } = await t.call('dev:import-registrar', [path.join(fora, 'a.txt'), path.join(fora, 'pasta')]);
  const r = await t.call('dev:import', { id, destino: path.join(raiz, 'dest') });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.itens.map(i => i.ok), [true, true]);
  assert.strictEqual(r.id, null, 'sem pendentes: o id acaba');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'A');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'pasta', 'sub', 'y.txt'), 'utf8'), 'Y');
  assert.ok(fs.statSync(path.join(raiz, 'dest', 'pasta', 'vazia')).isDirectory());
  assert.strictEqual(fs.readFileSync(path.join(fora, 'pasta', 'x.txt'), 'utf8'), 'X', 'a origem não é tocada');
});

test('caminho em texto, id inexistente e id já usado são recusados e nada é gravado', async () => {
  const raiz = pasta(), fora = pasta();
  escreve(raiz, { 'dest': null });
  escreve(fora, { 'segredo.txt': 'S' });
  const t = montar(raiz);
  for (const args of [
    { id: path.join(fora, 'segredo.txt'), destino: path.join(raiz, 'dest') },
    { id: 'nao-existe', destino: path.join(raiz, 'dest') },
    { origens: [path.join(fora, 'segredo.txt')], destino: path.join(raiz, 'dest') },
    { destino: path.join(raiz, 'dest') }, undefined, null, 'x',
  ]) {
    const r = await t.call('dev:import', args);
    assert.strictEqual(r.ok, false);
  }
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest')), []);
  const { id } = await t.call('dev:import-registrar', [path.join(fora, 'segredo.txt')]);
  assert.strictEqual((await t.call('dev:import', { id, destino: path.join(raiz, 'dest') })).ok, true);
  const de_novo = await t.call('dev:import', { id, destino: path.join(raiz, 'dest') });
  assert.strictEqual(de_novo.ok, false, 'o id é de uso único');
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest')), ['segredo.txt']);
});

test('destino fora das pastas abertas é recusado e a lista continua valendo para outra tentativa', async () => {
  const raiz = pasta(), fora = pasta(), outro = pasta();
  escreve(raiz, { 'dest': null });
  escreve(fora, { 'a.txt': 'A' });
  const t = montar(raiz);
  const { id } = await t.call('dev:import-registrar', [path.join(fora, 'a.txt')]);
  const r = await t.call('dev:import', { id, destino: outro });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /fora das pastas abertas/);
  assert.deepStrictEqual(fs.readdirSync(outro), []);
  assert.strictEqual((await t.call('dev:import', { id, destino: path.join(raiz, 'dest') })).ok, true);
});

test('conflito: o item fica pendente com o mesmo id; a decisão resolve; Cancelar encerra o id', async () => {
  const raiz = pasta(), fora = pasta();
  escreve(raiz, { 'dest/a.txt': 'VELHO', 'dest/c.txt': 'C-VELHO' });
  escreve(fora, { 'a.txt': 'NOVO', 'b.txt': 'B', 'c.txt': 'C-NOVO' });
  const t = montar(raiz);
  const a = path.join(fora, 'a.txt'), c = path.join(fora, 'c.txt');
  const { id } = await t.call('dev:import-registrar', [a, path.join(fora, 'b.txt'), c]);
  let r = await t.call('dev:import', { id, destino: path.join(raiz, 'dest') });
  assert.deepStrictEqual(r.itens.map(i => !!i.conflito), [true, false, true]);
  assert.strictEqual(r.id, id);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'VELHO');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'b.txt'), 'utf8'), 'B');
  r = await t.call('dev:import', { id, destino: path.join(raiz, 'dest'), decisoes: { [a]: 'substituir', [c]: 'manter-ambos' } });
  assert.deepStrictEqual(r.itens.map(i => i.ok), [true, true]);
  assert.strictEqual(r.id, null);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'NOVO');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'c.txt'), 'utf8'), 'C-VELHO');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'c (2).txt'), 'utf8'), 'C-NOVO');
  // Cancelar
  escreve(fora, { 'd.txt': 'D' });
  escreve(raiz, { 'dest/d.txt': 'D-VELHO' });
  const reg = await t.call('dev:import-registrar', [path.join(fora, 'd.txt')]);
  assert.strictEqual((await t.call('dev:import', { id: reg.id, destino: path.join(raiz, 'dest') })).itens[0].conflito, true);
  await t.call('dev:import-cancelar', reg.id);
  assert.strictEqual((await t.call('dev:import', { id: reg.id, destino: path.join(raiz, 'dest') })).ok, false);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'd.txt'), 'utf8'), 'D-VELHO');
});

test('recusa uma origem que contém o destino (colar a pasta do projeto dentro de uma subpasta dela)', async () => {
  const raiz = pasta();
  escreve(raiz, { 'x.txt': 'x', 'sub/y.txt': 'y' });
  const t = montar(raiz);
  const { id } = await t.call('dev:import-registrar', [raiz]);
  const r = await t.call('dev:import', { id, destino: path.join(raiz, 'sub') });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /dentro dela mesma/);
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'sub')), ['y.txt']);
});

test('importar não seguir links de dentro: o destino ganha o LINK, não o conteúdo apontado', async (c) => {
  const raiz = pasta(), fora = pasta(), alvo = pasta();
  escreve(raiz, { 'dest': null });
  escreve(alvo, { 'segredo.txt': 'S' });
  escreve(fora, { 'p/ok.txt': 'ok' });
  try { fs.symlinkSync(alvo, path.join(fora, 'p', 'ponte'), 'junction'); } catch { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  const { id } = await t.call('dev:import-registrar', [path.join(fora, 'p')]);
  const r = await t.call('dev:import', { id, destino: path.join(raiz, 'dest') });
  assert.strictEqual(r.itens[0].ok, true);
  assert.ok(fs.lstatSync(path.join(raiz, 'dest', 'p', 'ponte')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(alvo, 'segredo.txt'), 'utf8'), 'S');
});

test('importar com substituir recusa o destino que é a raiz de outra pasta aberta; a raiz fica intacta', async () => {
  const base = pasta(), fora = pasta();
  escreve(base, { 'sub/f.txt': 'F-RAIZ-B' });
  escreve(fora, { 'sub/novo.txt': 'N' });
  const t = montar([base, path.join(base, 'sub')]);
  const origem = path.join(fora, 'sub');
  const { id } = await t.call('dev:import-registrar', [origem]);
  const r = await t.call('dev:import', { id, destino: base, decisoes: { [origem]: 'substituir' } });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /pasta aberta como projeto/);
  assert.strictEqual(fs.readFileSync(path.join(base, 'sub', 'f.txt'), 'utf8'), 'F-RAIZ-B');
  assert.ok(!fs.existsSync(path.join(base, 'sub', 'novo.txt')));
});

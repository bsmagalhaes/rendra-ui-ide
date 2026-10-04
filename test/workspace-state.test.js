// Estado "painel do editor escondido" por workspace: passa pelos handlers reais de gravação e carga
// (src/devcode.js) com um ipcMain e um store falsos, e o teste afirma o que ficou gravado no store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerDevCode } = require('../src/devcode');

function montar(inicial) {
  const handlers = new Map();
  const dados = new Map(inicial ? [['devcode.workspaces', inicial]] : []);
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: k => dados.get(k), set: (k, v) => dados.set(k, v), delete: k => dados.delete(k) };
  registerDevCode({ ipcMain, dialog: {}, store, getWindow: () => null });
  return {
    gravar: data => handlers.get('dev:save-workspaces')({}, data),
    carregar: () => handlers.get('dev:load-workspaces')({}),
    gravado: () => dados.get('devcode.workspaces'),
  };
}

const pastas = [];
const pasta = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-ws-')); pastas.push(p); return p; };
test.after(() => pastas.forEach(p => fs.rmSync(p, { recursive: true, force: true })));

test('gravar guarda editorHidden por workspace, sem mexer nos outros campos', () => {
  const a = pasta(), b = pasta();
  const t = montar();
  t.gravar({ list: [
    { name: 'A', cols: 2, root: a, groups: [], editorHidden: true },
    { name: 'B', root: b, groups: [{ tabs: ['x.txt'], active: 'x.txt' }] },
  ], active: 1 });
  const g = t.gravado();
  assert.strictEqual(g.list[0].editorHidden, true);
  assert.strictEqual(g.list[1].editorHidden, false);
  assert.deepStrictEqual(g.list[0], { name: 'A', custom: false, cols: 2, root: a, wsl: null, groups: [], editorHidden: true });
  assert.deepStrictEqual(g.list[1], { name: 'B', custom: false, cols: 1, root: b, wsl: null, groups: [{ tabs: ['x.txt'], active: 'x.txt' }], editorHidden: false });
  assert.strictEqual(g.active, 1);
});

test('carregar devolve o editorHidden que foi gravado', async () => {
  const a = pasta(), b = pasta();
  const t = montar();
  t.gravar({ list: [{ name: 'A', root: a, groups: [], editorHidden: true }, { name: 'B', root: b, groups: [] }], active: 0 });
  const r = await t.carregar();
  assert.deepStrictEqual(r.list.map(w => w.editorHidden), [true, false]);
});

test('store da versão antiga (sem o campo) carrega com editorHidden falso e o resto igual', async () => {
  const a = pasta();
  const antigo = { list: [
    { name: 'Loja', custom: true, cols: 3, root: a, wsl: null, groups: [{ tabs: ['a.ts', 'b.ts'], active: 'b.ts' }] },
    { name: 'Api', custom: false, cols: 1, root: a, wsl: null, groups: [] },
  ], active: 1 };
  const r = await montar(antigo).carregar();
  assert.deepStrictEqual(r.list.map(w => w.editorHidden), [false, false]);
  assert.deepStrictEqual(r.list.map(w => [w.name, w.custom, w.cols, w.groups]), [
    ['Loja', true, 3, [{ tabs: ['a.ts', 'b.ts'], active: 'b.ts' }]],
    ['Api', false, 1, []],
  ]);
  assert.strictEqual(r.active, 1);
});

test('o estado escondido não depende de a pasta ainda existir', async () => {
  const gone = path.join(os.tmpdir(), 'rendra-ws-pasta-que-nao-existe-1234');
  const r = await montar({ list: [{ name: 'Sumiu', root: gone, groups: [], editorHidden: true }], active: 0 }).carregar();
  assert.strictEqual(r.list[0].root, null);
  assert.deepStrictEqual(r.list[0].groups, []);
  assert.strictEqual(r.list[0].editorHidden, true);
});

test('só o booleano true conta: "true", 1, objeto e nulo viram falso na gravação e na carga', async () => {
  const a = pasta();
  const t = montar();
  const estranhos = ['true', 1, {}, null, undefined, 0, false];
  t.gravar({ list: estranhos.map((v, i) => ({ name: `w${i}`, root: a, groups: [], editorHidden: v })), active: 0 });
  assert.deepStrictEqual(t.gravado().list.map(w => w.editorHidden), estranhos.map(() => false));
  const r = await montar({ list: estranhos.map((v, i) => ({ name: `w${i}`, root: a, groups: [], editorHidden: v })), active: 0 }).carregar();
  assert.deepStrictEqual(r.list.map(w => w.editorHidden), estranhos.map(() => false));
});

test('a ordem dos projetos e das abas do editor vai e volta como foi gravada, sem mudar o contrato', async () => {
  const a = pasta(), b = pasta(), c = pasta();
  const t = montar();
  // ordem depois de arrastar: C, A, B; abas do editor do projeto A: z, x, y (com y ativa); `active` é o índice na lista
  const entrada = { list: [
    { name: 'C', custom: true, cols: 1, root: c, wsl: null, groups: [], editorHidden: false },
    { name: 'A', custom: true, cols: 2, root: a, wsl: null, groups: [{ tabs: ['z.txt', 'x.txt', 'y.txt'], active: 'y.txt' }, { tabs: ['k.txt'], active: 'k.txt' }], editorHidden: false },
    { name: 'B', custom: true, cols: 1, root: b, wsl: null, groups: [], editorHidden: false },
  ], active: 1 };
  t.gravar(entrada);
  assert.deepStrictEqual(t.gravado(), entrada, 'o que ficou gravado é a ordem recebida, com os mesmos campos');
  const r = await t.carregar();
  assert.deepStrictEqual(r.list.map(w => w.name), ['C', 'A', 'B']);
  assert.deepStrictEqual(r.list[1].groups, [{ tabs: ['z.txt', 'x.txt', 'y.txt'], active: 'y.txt' }, { tabs: ['k.txt'], active: 'k.txt' }]);
  assert.strictEqual(r.active, 1);
  assert.deepStrictEqual(Object.keys(r.list[0]).sort(), ['cols', 'custom', 'editorHidden', 'groups', 'name', 'root'], 'nenhum campo de ordem ou de id foi acrescentado (o wsl nulo não volta, como antes)');
  assert.deepStrictEqual(Object.keys(t.gravado().list[0]).sort(), ['cols', 'custom', 'editorHidden', 'groups', 'name', 'root', 'wsl']);
});

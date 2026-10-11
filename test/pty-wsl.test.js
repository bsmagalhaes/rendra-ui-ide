// pty:create com shell "wsl:<nome>": o nome vem do renderer e só vale se for uma distribuição
// instalada (listWslDistros). Passa pelo handler real, com a lista de distros e o node-pty falsos,
// e o teste afirma se o wsl.exe chegou a ser iniciado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerDevCode } = require('../src/devcode');
const { argsCmdUnc, caminhoNoWsl, VAR_PASTA_CMD } = require('../renderer/terminal-escolha');

function montar(distros) {
  const handlers = new Map();
  const lancados = [];
  let listagens = 0;
  const ptyFalso = {
    spawn: (file, args) => { lancados.push({ file, args }); return { onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }; },
  };
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: (k, d) => d, set() {}, delete() {} };
  registerDevCode({
    ipcMain, dialog: {}, store, getWindow: () => null,
    deps: { listWslDistros: async () => { listagens++; return distros.map(name => ({ name, state: 'Running', version: 2, isDefault: false })); }, loadPty: () => ptyFalso, wakeWslDistro: async () => true },
  });
  return { criar: shell => handlers.get('pty:create')({}, { cols: 80, rows: 24, shell }), lancados, listagens: () => listagens };
}

test('wsl:<nome> de uma distro instalada abre o wsl.exe nela', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu', 'Debian']);
  const r = await t.criar('wsl:Ubuntu');
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(t.lancados.length, 1);
  assert.strictEqual(t.lancados[0].file, 'wsl.exe');
  assert.deepStrictEqual(t.lancados[0].args.slice(0, 2), ['-d', 'Ubuntu']);
});

test('wsl:<nome> fora da lista é recusado e nada é iniciado', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu']);
  for (const nome of ['Outra', 'Ubuntu -u root', '--exec calc', '', 'ubuntu2']) {
    const r = await t.criar(`wsl:${nome}`);
    assert.ok(r.error, `recusa wsl:${nome}`);
    assert.match(r.error, /WSL/);
  }
  assert.strictEqual(t.lancados.length, 0);
});

test('o nome da distro vale sem diferenciar maiúsculas e usa o nome da lista', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu']);
  const r = await t.criar('wsl:ubuntu');
  assert.strictEqual(r.error, undefined);
  assert.deepStrictEqual(t.lancados[0].args.slice(0, 2), ['-d', 'Ubuntu']);
});

test('distro conhecida reaproveita a lista em cache; nome fora da lista confere de novo e recusa', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu']);
  await t.criar('wsl:Ubuntu');
  await t.criar('wsl:ubuntu');
  assert.strictEqual(t.listagens(), 1);
  const r = await t.criar('wsl:Outra');
  assert.ok(r.error);
  assert.strictEqual(t.listagens(), 2);
  assert.strictEqual(t.lancados.length, 2);
});

// ── o shell decide o ambiente do terminal; o projeto só traduz a pasta (D1, D3, D4) ──────────────────────────────
// Pelo handler real pty:create, com workspaces carregados por dev:load-workspaces, a lista de distros, o node-pty e o
// registro falsos: o teste afirma o que foi lançado (arquivo, argumentos, pasta, ambiente), o que o terminal devolve
// e o que o registro gravou. A pasta real que o shell mostra fica nos e2e.
const win = { skip: process.platform !== 'win32' };
const UNC = '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj';
const sistema = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-pty-')); sistema.push(p); return p; };
test.after(() => sistema.forEach(p => fs.rmSync(p, { recursive: true, force: true })));

function montarProjeto({ workspaces = [], distros = ['Ubuntu', 'Debian'], pastasExistentes = () => true } = {}) {
  const handlers = new Map(); const lancados = []; const registros = []; const acordadas = [];
  const ptyFalso = { spawn: (file, args, opts) => { lancados.push({ file, args, cwd: opts.cwd, env: opts.env }); return { pid: 4242, onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }; } };
  registerDevCode({
    ipcMain: { handle: (n, f) => handlers.set(n, f), on() {}, once() {}, removeHandler() {} }, dialog: {},
    store: { get: (k, d) => (k === 'devcode.workspaces' ? { list: workspaces, active: 0 } : d), set() {}, delete() {} }, getWindow: () => null,
    deps: {
      listWslDistros: async () => distros.map(name => ({ name, state: 'Running', version: 2, isDefault: false })),
      loadPty: () => ptyFalso, wakeWslDistro: async d => { acordadas.push(d); return true; }, isDir: pastasExistentes,
      registro: { adicionar: e => registros.push(e), atualizar() {}, remover() {} }, env: { RENDRA_HOME: 'sandbox' }, ciclo: { listarPids: async () => [] },
    },
  });
  handlers.get('dev:load-workspaces')({});
  return { criar: a => handlers.get('pty:create')({}, { cols: 80, rows: 24, ...a }), lancados, registros, acordadas };
}

test('PowerShell em projeto do WSL abre no Windows, na pasta UNC, registrado como terminal do Windows (D3, R6)', win, async () => {
  const salvo = process.env.WSLENV; delete process.env.WSLENV; // a máquina de teste pode estar dentro de um terminal da IDE
  const t = montarProjeto({ workspaces: [{ root: UNC }] });
  let r;
  try { r = await t.criar({ cwd: UNC, shell: 'powershell' }); } finally { if (salvo !== undefined) process.env.WSLENV = salvo; }
  assert.strictEqual(r.error, undefined);
  assert.match(t.lancados[0].file, /(powershell|pwsh)\.exe$/i);
  assert.strictEqual(t.lancados[0].cwd, UNC);
  assert.ok(!/RENDRA_TERM\/u/.test(t.lancados[0].env.WSLENV || ''), 'terminal do Windows não leva a marca pelo WSLENV');
  assert.deepStrictEqual({ shellKey: r.shellKey, distro: r.distro, cwd: r.cwd }, { shellKey: 'powershell', distro: null, cwd: UNC });
  assert.deepStrictEqual(t.registros.map(e => [e.ambiente, e.distro]), [['win', null]], 'encerrado por árvore de PID, não por marca na distro');
  assert.deepStrictEqual(t.acordadas, ['Ubuntu'], 'a pasta UNC só responde com a distro de pé');
});

test('terminal wsl:<distro> em projeto do Windows: pasta de unidade vira /mnt/<letra>, montagem personalizada do workspace vale', win, async () => {
  const dir = temp(); fs.mkdirSync(path.join(dir, 'sub'));
  const t = montarProjeto({ workspaces: [{ root: dir }], pastasExistentes: () => true });
  const r = await t.criar({ cwd: dir, shell: 'wsl:Ubuntu' });
  assert.deepStrictEqual(t.lancados[0].args, ['-d', 'Ubuntu', '--cd', caminhoNoWsl(path.resolve(dir))]);
  assert.strictEqual(t.lancados[0].file, 'wsl.exe');
  assert.deepStrictEqual({ shellKey: r.shellKey, distro: r.distro }, { shellKey: 'wsl', distro: 'Ubuntu' });
  assert.deepStrictEqual(t.registros.map(e => [e.ambiente, e.distro]), [['wsl', 'Ubuntu']]);
  assert.match(t.lancados[0].env.WSLENV, /RENDRA_TERM\/u/);
  const via = montarProjeto({ workspaces: [{ root: dir, wsl: { distro: 'Ubuntu', linuxPath: '/mnt/personalizado/proj' } }] });
  await via.criar({ cwd: dir, shell: 'wsl:Ubuntu' });
  await via.criar({ cwd: path.join(dir, 'sub'), shell: 'wsl:Ubuntu' });
  assert.strictEqual(via.lancados[0].args[3], '/mnt/personalizado/proj');
  assert.strictEqual(via.lancados[1].args[3], '/mnt/personalizado/proj/sub');
  await via.criar({ cwd: dir, shell: 'wsl:Debian' }); // outra distro: a unidade em /mnt, não a montagem da primeira
  assert.strictEqual(via.lancados[2].args[3], caminhoNoWsl(path.resolve(dir)));
});

test('PowerShell em projeto montado no WSL (via Windows) abre no Windows: o projeto nunca força o wsl.exe', win, async () => {
  const dir = temp();
  const t = montarProjeto({ workspaces: [{ root: dir, wsl: { distro: 'Ubuntu', linuxPath: '/mnt/personalizado/proj' } }] });
  const r = await t.criar({ cwd: dir, shell: 'powershell' });
  assert.match(t.lancados[0].file, /(powershell|pwsh)\.exe$/i);
  assert.strictEqual(t.lancados[0].cwd, path.resolve(dir));
  assert.strictEqual(r.distro, null);
  assert.deepStrictEqual(t.registros.map(e => e.ambiente), ['win']);
  assert.deepStrictEqual(t.acordadas, [], 'nada de WSL envolvido, nada é acordado');
});

test('terminal wsl:<distro> em projeto UNC: a mesma distro usa o linuxPath, outra distro cai em ~', win, async () => {
  const t = montarProjeto({ workspaces: [{ root: UNC }] });
  await t.criar({ cwd: UNC, shell: 'wsl:Ubuntu' });
  assert.deepStrictEqual(t.lancados[0].args, ['-d', 'Ubuntu', '--cd', '/home/u/proj']);
  await t.criar({ cwd: UNC, shell: 'wsl:Debian' });
  assert.deepStrictEqual(t.lancados[1].args, ['-d', 'Debian', '--cd', '~'], 'a pasta de uma distro não existe na outra');
  assert.strictEqual(t.lancados[0].cwd, os.homedir(), 'o wsl.exe recebe a pasta Linux por --cd, o spawn fica no home');
  assert.strictEqual(t.lancados[1].cwd, os.homedir());
  assert.deepStrictEqual(t.registros.map(e => [e.ambiente, e.distro]), [['wsl', 'Ubuntu'], ['wsl', 'Debian']], 'a distro do registro é a do SHELL, não a do projeto');
  assert.deepStrictEqual(t.acordadas, ['Ubuntu', 'Debian']);
});

test('wsl:<distro forjada> é recusada em todos os ramos: projeto UNC, projeto montado e sem pasta', win, async () => {
  const dir = temp();
  const t = montarProjeto({ workspaces: [{ root: UNC }, { root: dir, wsl: { distro: 'Ubuntu', linuxPath: '/mnt/c/x' } }] });
  for (const cwd of [UNC, dir, undefined]) {
    for (const nome of ['Forjada', 'Ubuntu -u root', '--exec calc']) {
      const r = await t.criar({ cwd, shell: `wsl:${nome}` });
      assert.match(r.error || '', /Distribuição WSL .* não encontrada/, `${cwd} ${nome}`);
    }
  }
  assert.strictEqual(t.lancados.length, 0);
  assert.deepStrictEqual(t.acordadas, []);
});

test('CMD em projeto UNC com pasta de unidade (/mnt/<letra>): abre nela, sem pushd, e devolve a pasta do projeto', win, async () => {
  const uncMnt = '\\\\wsl.localhost\\Ubuntu\\mnt\\c\\proj';
  const t = montarProjeto({ workspaces: [{ root: uncMnt }] });
  const r = await t.criar({ cwd: uncMnt, shell: 'cmd' });
  assert.strictEqual(t.lancados[0].file, 'cmd.exe');
  assert.strictEqual(t.lancados[0].cwd, 'C:\\proj');
  assert.deepStrictEqual(t.lancados[0].args, []);
  assert.strictEqual(t.lancados[0].env[VAR_PASTA_CMD], undefined);
  assert.strictEqual(r.cwd, uncMnt, 'a resposta mantém a pasta do projeto (dentro das raízes): é a base dos links relativos');
  // a unidade não existe: cai no pushd
  const sem = montarProjeto({ workspaces: [{ root: uncMnt }], pastasExistentes: p => !/^C:/i.test(p) });
  await sem.criar({ cwd: uncMnt, shell: 'cmd' });
  assert.strictEqual(sem.lancados[0].args, argsCmdUnc());
});

test('CMD em projeto UNC sem unidade: linha de comando constante, o caminho vai por variável de ambiente (A1)', win, async () => {
  const hostis = [UNC, '\\\\wsl.localhost\\Ubuntu\\home\\u\\%PATH%', '\\\\wsl.localhost\\Ubuntu\\home\\u\\a&calc', '\\\\wsl.localhost\\Ubuntu\\home\\u\\a b^c', '\\\\wsl.localhost\\Ubuntu\\home\\u\\!x! (y)', '\\\\wsl.localhost\\Ubuntu\\home\\u\\a"b'];
  for (const pasta of hostis) {
    const t = montarProjeto({ workspaces: [{ root: pasta }] });
    const r = await t.criar({ cwd: pasta, shell: 'cmd' });
    const l = t.lancados[0];
    assert.strictEqual(l.file, 'cmd.exe');
    assert.strictEqual(l.args, argsCmdUnc(), pasta);
    assert.strictEqual(typeof l.args, 'string');
    assert.ok(!l.args.includes('proj') && !l.args.includes('wsl.localhost') && !l.args.includes('calc'), 'o caminho não entra na linha de comando');
    assert.strictEqual(l.env[VAR_PASTA_CMD], pasta.includes('"') ? '' : pasta, 'o caminho vai pela variável de ambiente deste spawn (aspas nunca vão)');
    assert.strictEqual(l.cwd, os.homedir());
    assert.strictEqual(r.cwd, pasta);
  }
});

test('terminal sem shell no pedido segue como antes: o primeiro shell do Windows na pasta do projeto', win, async () => {
  const dir = temp();
  const t = montarProjeto({ workspaces: [{ root: dir }] });
  const r = await t.criar({ cwd: dir });
  assert.match(t.lancados[0].file, /(powershell|pwsh)\.exe$/i);
  assert.strictEqual(t.lancados[0].cwd, path.resolve(dir));
  assert.strictEqual(r.distro, null);
});

test('terminal wsl:<distro> sem pasta (página Terminal): abre no ~ da distro, com o spawn no home', win, async () => {
  const t = montarProjeto();
  const r = await t.criar({ shell: 'wsl:Ubuntu' });
  assert.deepStrictEqual(t.lancados[0].args, ['-d', 'Ubuntu', '--cd', '~']);
  assert.strictEqual(t.lancados[0].cwd, os.homedir());
  assert.deepStrictEqual({ shellKey: r.shellKey, distro: r.distro, cwd: r.cwd }, { shellKey: 'wsl', distro: 'Ubuntu', cwd: os.homedir() });
  assert.deepStrictEqual(t.acordadas, ['Ubuntu']);
});

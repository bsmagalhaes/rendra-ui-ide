// Links do terminal e o ambiente do pty. O teste de ambiente passa pelo handler real pty:create
// (node-pty falso) e afirma o env com que o processo foi iniciado.
const test = require('node:test');
const assert = require('node:assert');
const { urlWebSegura, ambientePty } = require('../src/terminal-env');
const { registerDevCode } = require('../src/devcode');

test('urlWebSegura aceita só http e https', () => {
  assert.strictEqual(urlWebSegura('https://claude.ai/oauth/authorize?code=true&client_id=x'), 'https://claude.ai/oauth/authorize?code=true&client_id=x');
  assert.strictEqual(urlWebSegura('http://localhost:3000/cb'), 'http://localhost:3000/cb');
  for (const ruim of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ms-settings:privacy',
    'vscode://file/x', 'ftp://exemplo.com/a', 'smb://host/share', 'https://', '//exemplo.com', 'exemplo.com', '', null, undefined, 42,
    'https://a.com/\r\ncalc', 'https://banco.com@mal.com/', 'https://user:senha@exemplo.com/', 'https://a.com/' + 'x'.repeat(9000)]) {
    assert.strictEqual(urlWebSegura(ruim), null, String(ruim).slice(0, 40));
  }
});

test('ambientePty: BROWSER e WSLENV só no WSL', () => {
  const base = { PATH: 'x', WSLENV: 'FOO/p' };
  const lin = ambientePty(base, { wsl: false });
  assert.strictEqual(lin.BROWSER, undefined);
  assert.strictEqual(lin.WSLENV, 'FOO/p');
  assert.strictEqual(lin.TERM, 'xterm-256color');
  const w = ambientePty(base, { wsl: true });
  assert.match(w.BROWSER, /wsl-abrir-url\.sh$/); // script da IDE de um argumento, nunca o explorer.exe
  assert.ok(!/explorer/i.test(w.BROWSER));
  assert.strictEqual(w.WSLENV, 'FOO/p:BROWSER/p'); // /p: o WSL converte o caminho do Windows para /mnt/...
  assert.strictEqual(ambientePty({}, { wsl: true }).WSLENV, 'BROWSER/p');
});

test('ambientePty: WSLENV do usuário com BROWSER/u vira BROWSER/p (o caminho precisa ser convertido)', () => {
  const w = ambientePty({ WSLENV: 'A/u:browser/u:B/p' }, { wsl: true });
  assert.strictEqual(w.WSLENV, 'A/u:BROWSER/p:B/p');
});

test('ambientePty respeita BROWSER já definido e não duplica o WSLENV', () => {
  assert.strictEqual(ambientePty({ BROWSER: 'meu-navegador' }, { wsl: true }).BROWSER, 'meu-navegador');
  assert.strictEqual(ambientePty({ Browser: 'x' }, { wsl: true }).BROWSER, undefined);
  assert.strictEqual(ambientePty({ WSLENV: 'BROWSER/p' }, { wsl: true }).WSLENV, 'BROWSER/p');
});

function montar() {
  const handlers = new Map(); const lancados = [];
  const ptyFalso = { spawn: (file, args, opts) => { lancados.push({ file, args, env: opts.env }); return { onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }; } };
  registerDevCode({
    ipcMain: { handle: (n, f) => handlers.set(n, f), on() {}, once() {}, removeHandler() {} }, dialog: {},
    store: { get: (k, d) => d, set() {}, delete() {} }, getWindow: () => null,
    deps: { listWslDistros: async () => [{ name: 'Ubuntu', state: 'Running', version: 2, isDefault: false }], loadPty: () => ptyFalso, wakeWslDistro: async () => true },
  });
  return { criar: a => handlers.get('pty:create')({}, { cols: 80, rows: 24, ...a }), lancados };
}

test('pty:create no WSL leva BROWSER, e o terminal do Windows não', { skip: process.platform !== 'win32' }, async () => {
  const salvo = { b: process.env.BROWSER, w: process.env.WSLENV };
  delete process.env.BROWSER; delete process.env.WSLENV;
  try {
    const t = montar();
    await t.criar({ shell: 'wsl:Ubuntu' });
    await t.criar({ shell: 'cmd' });
    assert.strictEqual(t.lancados[0].file, 'wsl.exe');
    assert.match(t.lancados[0].env.BROWSER, /wsl-abrir-url\.sh$/);
    assert.match(t.lancados[0].env.WSLENV, /(^|:)BROWSER\/p$/);
    assert.strictEqual(t.lancados[1].env.BROWSER, undefined);
    assert.strictEqual(t.lancados[1].env.WSLENV, undefined);
  } finally {
    if (salvo.b !== undefined) process.env.BROWSER = salvo.b;
    if (salvo.w !== undefined) process.env.WSLENV = salvo.w;
  }
});

test('ambientePty: a marca RENDRA_TERM vai ao pty e, no WSL, atravessa pelo WSLENV sem duplicar', () => {
  const tok = 'ab'.repeat(8);
  assert.strictEqual(ambientePty({}, { wsl: false, marca: tok }).RENDRA_TERM, tok);
  const w = ambientePty({ WSLENV: 'X/u' }, { wsl: true, marca: tok });
  assert.strictEqual(w.RENDRA_TERM, tok);
  assert.deepStrictEqual(w.WSLENV.split(':').sort(), ['BROWSER/p', 'RENDRA_TERM/u', 'X/u']);
  // BROWSER já definido pelo usuário: a marca ainda atravessa
  assert.ok(ambientePty({ BROWSER: 'b' }, { wsl: true, marca: tok }).WSLENV.split(':').includes('RENDRA_TERM/u'));
  assert.deepStrictEqual(ambientePty({ WSLENV: 'RENDRA_TERM/u' }, { wsl: true, marca: tok }).WSLENV.split(':').filter(i => i.startsWith('RENDRA_TERM')), ['RENDRA_TERM/u']);
  // marca fora do formato (token de 16 a 64 hex) é ignorada: nada de dado externo no ambiente
  assert.strictEqual(ambientePty({}, { wsl: true, marca: 'x; calc' }).RENDRA_TERM, undefined);
  // sem marca, nada muda para quem chama como antes
  assert.strictEqual(ambientePty({}, { wsl: true }).RENDRA_TERM, undefined);
});

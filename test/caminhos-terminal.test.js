// Caminhos de arquivo no terminal: o reconhecedor (candidatos, positivos e negativos), a resolução para
// caminhos absolutos (Windows, WSL, relativos) e o handler real dev:resolve-path, que só aceita o que
// existe dentro das pastas abertas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acharCaminhos } = require('../renderer/caminhos-terminal');
const { candidatosDoCaminho } = require('../src/caminho-terminal');
const { registerDevCode } = require('../src/devcode');

const textos = linha => acharCaminhos(linha).map(a => a.texto);

test('reconhece caminhos relativos, absolutos Windows e Linux, com :linha e :coluna', () => {
  const esperado = {
    'veja docs/superpowers/specs/2026-10-03-modulo-vitrine-visao-macro-design.md agora': ['docs/superpowers/specs/2026-10-03-modulo-vitrine-visao-macro-design.md'],
    'erro em ./src/app.js:12:5 e ../x/y.ts:7': ['./src/app.js:12:5', '../x/y.ts:7'],
    'abri D:\\SOEs\\Rendra-UI\\CLAUDE.md. Feito': ['D:\\SOEs\\Rendra-UI\\CLAUDE.md'],
    'C:/Users/x/a.json:3': ['C:/Users/x/a.json:3'],
    'em /mnt/d/proj/src/a.js:40 e /home/bruno/p/b.py': ['/mnt/d/proj/src/a.js:40', '/home/bruno/p/b.py'],
    '"src\\util\\x.js"': ['src\\util\\x.js'],
    '(docs/a.md)': ['docs/a.md'],
    'pasta src/renderer/ e ./docs': ['src/renderer/', './docs'],
    'config em ./.github/workflows/ci.yml, ok': ['./.github/workflows/ci.yml'],
    '--file=docs/a.md': ['docs/a.md'],
  };
  for (const [linha, tokens] of Object.entries(esperado)) assert.deepStrictEqual(textos(linha), tokens, linha);
  const [a] = acharCaminhos('x ./src/app.js:12:5 y');
  assert.deepStrictEqual({ caminho: a.caminho, linha: a.linha, coluna: a.coluna, start: a.start, end: a.end }, { caminho: './src/app.js', linha: 12, coluna: 5, start: 2, end: 19 });
  assert.strictEqual(acharCaminhos('a docs/x.md:9')[0].coluna, null);
});

test('não reconhece URLs, palavras soltas, datas, e-mails nem texto sem barra ou extensão', () => {
  for (const linha of [
    'https://exemplo.com/a/b.html', 'http://localhost:3000/x/y.js:10', 'file:///C:/x/a.txt', 'ftp://h/a/b.txt', '//cdn.exemplo.com/a.js',
    'ssh://git@host/a/b.git', '\\\\servidor\\share\\a.txt',
    'palavra solta README.md', 'a.b.c', 'v1.2.3', 'and/or', 'input/output', '10/03/2026', '12:30:45', 'usuario@exemplo.com',
    'www.exemplo.com/a/b.html', 'a@b.com/x/y.md', 'git@github.com:user/repo.git', 'user@host:/home/x/a.txt', 'a.txt:Zone.Identifier', 'docs/a.txt:Zone.Identifier', 'C:\\x\\a.txt:ads',
    '@scope/pacote', 'a/b', 'C:', '/', '/x', '', '   ',
  ]) {
    assert.deepStrictEqual(textos(linha), [], linha);
  }
  // a URL dentro de uma frase não vira caminho, mas o caminho ao lado vira
  assert.deepStrictEqual(textos('abra https://a.com/x/y.md e docs/y.md'), ['docs/y.md']);
  assert.deepStrictEqual(textos(null), []);
});

test('mantém caminhos legítimos com @ depois da primeira barra e unidade com sufixo', () => {
  assert.deepStrictEqual(textos('node_modules/@types/node/index.d.ts:3 C:\\a\\b.js:4:2'), ['node_modules/@types/node/index.d.ts:3', 'C:\\a\\b.js:4:2']);
});

test('limita candidatos por linha e ignora token gigante', () => {
  assert.strictEqual(acharCaminhos(Array.from({ length: 50 }, (_, i) => `a/f${i}.js`).join(' ')).length, 20);
  assert.deepStrictEqual(acharCaminhos('a/' + 'x'.repeat(500) + '.js'), []);
});

test('candidatosDoCaminho: Windows, WSL e relativos', () => {
  const w = { isWin: true, cwd: 'D:\\proj\\sub', root: 'D:\\proj', home: 'C:\\Users\\b' };
  assert.deepStrictEqual(candidatosDoCaminho('docs/a.md', w), ['D:\\proj\\sub\\docs\\a.md', 'D:\\proj\\docs\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('..\\x\\a.md', w), ['D:\\proj\\x\\a.md', 'D:\\x\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('d:/proj/a.md', w), ['d:\\proj\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/mnt/d/proj/src/a.js', w), ['D:\\proj\\src\\a.js']);
  assert.deepStrictEqual(candidatosDoCaminho('/c/Users/b/a.md', w), ['C:\\Users\\b\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/home/b/p/a.md', w), []);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', w), ['C:\\Users\\b\\a.md']);
  const unc = '\\\\wsl.localhost\\Ubuntu\\home\\b\\p';
  const wsl = { isWin: true, distro: 'Ubuntu', cwd: unc, root: unc, home: 'C:\\Users\\b' };
  assert.deepStrictEqual(candidatosDoCaminho('/home/b/p/a.md', wsl), [unc + '\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('src/a.md', wsl), [unc + '\\src\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', wsl), []);
  const l = { isWin: false, cwd: '/home/b/p/sub', root: '/home/b/p', home: '/home/b' };
  assert.deepStrictEqual(candidatosDoCaminho('./x/a.md', l), ['/home/b/p/sub/x/a.md', '/home/b/p/x/a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/opt/a.md', l), ['/opt/a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', l), ['/home/b/a.md']);
});

test('candidatosDoCaminho recusa entrada inválida', () => {
  for (const ruim of [null, undefined, 3, '', 'a/b\u0000.js', 'a/b\n.js', 'a/' + 'x'.repeat(2000) + '.js']) assert.deepStrictEqual(candidatosDoCaminho(ruim, { isWin: true, root: 'D:\\p' }), []);
});

// ── handler real ──────────────────────────────────────────────────────────────
const pastas = [];
const pasta = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-cam-')); pastas.push(p); return p; };
test.after(() => pastas.forEach(p => fs.rmSync(p, { recursive: true, force: true })));

function montar(raiz, deps = {}) {
  const handlers = new Map();
  const dados = new Map([['devcode.workspaces', { list: [{ name: 'w', root: raiz }], active: 0 }]]);
  registerDevCode({ ipcMain: { handle: (n, f) => handlers.set(n, f), on() {}, once() {}, removeHandler() {} }, dialog: {}, store: { get: k => dados.get(k), set: (k, v) => dados.set(k, v), delete: k => dados.delete(k) }, getWindow: () => null, deps });
  handlers.get('dev:load-workspaces')({});
  const f = (texto, cwd, root, shell) => handlers.get('dev:resolve-path')({}, { texto, cwd, root, shell });
  f.ler = file => handlers.get('dev:read')({}, file);
  return f;
}

test('dev:resolve-path: arquivo e pasta existentes dentro da pasta aberta; inexistente, fora e inválido não', async () => {
  const raiz = pasta(), fora = pasta();
  fs.mkdirSync(path.join(raiz, 'docs', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'specs', 'a.md'), 'x');
  fs.writeFileSync(path.join(raiz, 'b.txt'), 'x');
  fs.writeFileSync(path.join(fora, 'c.txt'), 'x');
  const resolve = montar(raiz);
  assert.deepStrictEqual(await resolve('docs/specs/a.md', raiz, raiz), { path: path.join(raiz, 'docs', 'specs', 'a.md'), isDir: false });
  assert.deepStrictEqual(await resolve('./b.txt', path.join(raiz, 'docs'), raiz), { path: path.join(raiz, 'b.txt'), isDir: false }); // cai na raiz
  assert.deepStrictEqual(await resolve('../b.txt', path.join(raiz, 'docs'), raiz), { path: path.join(raiz, 'b.txt'), isDir: false });
  assert.deepStrictEqual(await resolve('docs/specs/', raiz, raiz), { path: path.join(raiz, 'docs', 'specs'), isDir: true });
  assert.deepStrictEqual(await resolve(path.join(raiz, 'b.txt'), raiz, raiz), { path: path.join(raiz, 'b.txt'), isDir: false });
  assert.strictEqual(await resolve('docs/nao-existe.md', raiz, raiz), null);
  assert.strictEqual(await resolve(path.join(fora, 'c.txt'), raiz, raiz), null, 'fora das pastas abertas');
  assert.strictEqual(await resolve('../' + path.basename(fora) + '/c.txt', raiz, raiz), null, 'escapa pela raiz');
  assert.deepStrictEqual(await resolve('b.txt', fora, raiz), { path: path.join(raiz, 'b.txt'), isDir: false }, 'cwd fora da pasta aberta é ignorado, vale a raiz');
  assert.strictEqual(await resolve('b.txt', fora, fora), null, 'raiz e cwd fora das pastas abertas');
  for (const ruim of [null, undefined, 42, '', 'a/b\u0000.txt']) assert.strictEqual(await resolve(ruim, raiz, raiz), null);
});

test('dev:resolve-path: junção dentro da pasta aberta apontando para fora não vira link (arquivo nem pasta)', async () => {
  const raiz = pasta(), fora = pasta();
  fs.mkdirSync(path.join(fora, 'sub'));
  fs.writeFileSync(path.join(fora, 'segredo.txt'), 'SEGREDO');
  fs.symlinkSync(fora, path.join(raiz, 'jun'), 'junction');
  fs.writeFileSync(path.join(raiz, 'ok.txt'), 'x');
  fs.mkdirSync(path.join(raiz, 'real'));
  fs.symlinkSync(path.join(raiz, 'real'), path.join(raiz, 'interna'), 'junction'); // junção que fica dentro: continua valendo
  fs.writeFileSync(path.join(raiz, 'real', 'i.txt'), 'x');
  const resolve = montar(raiz);
  assert.strictEqual(await resolve('jun/segredo.txt', raiz, raiz), null);
  assert.strictEqual(await resolve('jun/', raiz, raiz), null);
  assert.strictEqual(await resolve('jun/sub/', raiz, raiz), null);
  assert.strictEqual(await resolve(path.join(raiz, 'jun', 'segredo.txt'), raiz, raiz), null);
  assert.deepStrictEqual(await resolve('ok.txt', raiz, raiz), { path: path.join(raiz, 'ok.txt'), isDir: false });
  assert.deepStrictEqual(await resolve('interna/i.txt', raiz, raiz), { path: path.join(raiz, 'interna', 'i.txt'), isDir: false });
});

test('dev:resolve-path: stat lento passa do tempo limite e não vira link nem trava', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'x');
  const resolve = montar(raiz, { statTimeoutMs: 40 });
  const orig = fs.promises.stat;
  fs.promises.stat = alvo => new Promise(r => setTimeout(() => r(orig(alvo)), 400));
  try {
    const t0 = Date.now();
    assert.strictEqual(await resolve('a.txt', raiz, raiz), null);
    assert.ok(Date.now() - t0 < 300, 'respondeu no tempo limite, sem esperar o stat');
  } finally { fs.promises.stat = orig; }
  assert.deepStrictEqual(await resolve('a.txt', raiz, raiz), { path: path.join(raiz, 'a.txt'), isDir: false });
});

test('dev:resolve-path: caminho Linux /mnt/<letra>/ vira o arquivo do Windows', { skip: process.platform !== 'win32' }, async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'm.txt'), 'x');
  const resolve = montar(raiz);
  const linux = '/mnt/' + raiz[0].toLowerCase() + '/' + raiz.slice(3).replace(/\\/g, '/') + '/m.txt';
  assert.deepStrictEqual(await resolve(linux, raiz, raiz), { path: path.join(raiz, 'm.txt'), isDir: false });
  assert.strictEqual(await resolve('/home/ninguem/m.txt', raiz, raiz), null);
});

test('dev:read: não segue junção para fora da pasta aberta; leitura normal e junção interna seguem', async () => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'segredo.txt'), 'SEGREDO');
  fs.symlinkSync(fora, path.join(raiz, 'jun'), 'junction');
  fs.mkdirSync(path.join(raiz, 'real'));
  fs.writeFileSync(path.join(raiz, 'real', 'i.txt'), 'interno');
  fs.symlinkSync(path.join(raiz, 'real'), path.join(raiz, 'interna'), 'junction');
  fs.writeFileSync(path.join(raiz, 'ok.txt'), 'normal');
  const { ler } = montar(raiz);
  const r = await ler(path.join(raiz, 'jun', 'segredo.txt'));
  assert.ok(r.error && !r.content, 'pela junção para fora: recusado');
  assert.deepStrictEqual(await ler(path.join(raiz, 'ok.txt')), { content: 'normal' });
  assert.deepStrictEqual(await ler(path.join(raiz, 'interna', 'i.txt')), { content: 'interno' });
  assert.ok((await ler(path.join(fora, 'segredo.txt'))).error, 'fora léxico: recusado');
  assert.ok((await ler(path.join(raiz, 'nao-existe.txt'))).error);
});

test('dev:resolve-path com o shell do terminal: o link segue o ambiente do terminal, não o do projeto', { skip: process.platform !== 'win32' }, async () => {
  const uncRaiz = '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj';
  const alvo = uncRaiz + '\\a.txt';
  let listagens = 0;
  const listWslDistros = async () => { listagens++; return ['Ubuntu', 'Debian'].map(name => ({ name, state: 'Running', version: 2, isDefault: false })); };
  const resolve = montar(uncRaiz, { listWslDistros });
  // só o arquivo do projeto existe (a pasta UNC é de mentira: nenhuma distro é tocada)
  const { stat, realpath } = fs.promises;
  fs.promises.stat = async p => { if (p === alvo) return { isDirectory: () => false, isFile: () => true }; throw new Error('ENOENT'); };
  fs.promises.realpath = async p => p;
  try {
    assert.deepStrictEqual(await resolve('/home/u/proj/a.txt', uncRaiz, uncRaiz, 'wsl:Ubuntu'), { path: alvo, isDir: false }, 'terminal da mesma distro: vira link');
    assert.strictEqual(await resolve('/home/u/proj/a.txt', uncRaiz, uncRaiz, 'wsl:Debian'), null, 'terminal de outra distro: o caminho não aponta para o arquivo do projeto');
    assert.strictEqual(await resolve('/c/x', uncRaiz, uncRaiz, 'gitbash'), null, '/c/x do Git Bash não vira UNC da distro do projeto');
    assert.strictEqual(await resolve('/home/u/proj/a.txt', uncRaiz, uncRaiz, 'powershell'), null, 'terminal Windows: sem distro');
    assert.deepStrictEqual(await resolve('/home/u/proj/a.txt', uncRaiz, uncRaiz), { path: alvo, isDir: false }, 'sem shell: o ambiente do projeto, como sempre');
    assert.strictEqual(await resolve('/home/u/proj/a.txt', uncRaiz, uncRaiz, 'wsl:Forjada'), null, 'distro forjada: sem distro');
    assert.strictEqual(listagens, 1, 'o caminho quente só usa o cache da lista de distros: nunca `wsl -l -v` por link');
  } finally { fs.promises.stat = stat; fs.promises.realpath = realpath; }
});

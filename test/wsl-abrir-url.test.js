// Abrir link no terminal WSL: o BROWSER da IDE é um script de um argumento que entrega a URL inteira
// ao navegador do Windows. Prova de resultado: no WSL real, com o ambiente que a IDE monta, roda o
// executável apontado por BROWSER com uma URL cheia de = & % , e confere o que chegou ao destino,
// que aqui é um registrador no lugar do rundll32.exe (nenhum navegador nem janela abre).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambientePty } = require('../src/terminal-env');

const SCRIPT = path.join(__dirname, '..', 'src', 'wsl-abrir-url.sh');
const URL_TESTE = 'https://claude.ai/oauth/authorize?code=true&client_id=a1-b2&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile%2Cuser%3Ainference&code_challenge=x_y-z&code_challenge_method=S256&state=q%2Fw=e';

test('o script existe, usa #!/bin/sh e termina linhas só com LF', () => {
  const t = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(t.startsWith('#!/bin/sh\n'));
  assert.ok(!t.includes('\r'));
  assert.ok(!/explorer\.exe|cmd(\.exe)?\s+\/c|start\s/i.test(t.replace(/^#.*$/gm, '')), 'sem explorer, sem cmd /c start');
  assert.match(t, /rundll32\.exe url\.dll,FileProtocolHandler "\$1"/);
});

test('.gitattributes força LF no script (o git do Windows converteria para CRLF e o shebang quebraria)', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', '.gitattributes'), 'utf8');
  assert.match(a, /^src\/\*\.sh\s+text\s+eol=lf\s*$/m);
});

test('o script fica fora do asar no app instalado', () => {
  const b = require('../package.json').build;
  assert.ok(b.asarUnpack.includes('src/**'));
  const { caminhoAbridorUrl } = require('../src/terminal-env');
  assert.strictEqual(caminhoAbridorUrl('C:\\App\\resources\\app.asar\\src'), 'C:\\App\\resources\\app.asar.unpacked\\src\\wsl-abrir-url.sh');
  assert.strictEqual(caminhoAbridorUrl('/opt/app/resources/app.asar/src'), '/opt/app/resources/app.asar.unpacked/src/wsl-abrir-url.sh');
});

const URL_ESPACO = 'https://exemplo.com/a b?x=1&y=2 3,%41';

function distroWsl() {
  try {
    const saida = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 20000, windowsHide: true });
    return saida.split(/\r?\n/).map(s => s.replace(/\0/g, '').trim()).find(n => n && !/^docker-desktop/i.test(n)) || null;
  } catch { return null; }
}
const distro = process.platform === 'win32' ? distroWsl() : null;

test('no WSL real, a URL chega inteira ao destino pelo BROWSER da IDE', { skip: !distro && 'sem WSL' }, () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-url-'));
  try {
    const bin = path.join(sandbox, 'bin'); fs.mkdirSync(bin);
    const registro = path.join(sandbox, 'registro.txt');
    // registrador no lugar do rundll32.exe: grava cada argumento recebido, um por linha
    fs.writeFileSync(path.join(bin, 'rundll32.exe'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$RENDRA_REGISTRO"; done\n');
    const env = ambientePty({
      ...process.env, RENDRA_HOME: sandbox, RENDRA_TESTE_BIN: bin, RENDRA_REGISTRO: registro, RENDRA_URL: URL_TESTE, RENDRA_URL2: URL_ESPACO,
      WSLENV: 'RENDRA_TESTE_BIN/p:RENDRA_REGISTRO/p:RENDRA_URL/u:RENDRA_URL2/u',
    }, { wsl: true });
    const cmd = 'test -x "$BROWSER" && PATH="$RENDRA_TESTE_BIN:$PATH" "$BROWSER" "$RENDRA_URL" && PATH="$RENDRA_TESTE_BIN:$PATH" "$BROWSER" "$RENDRA_URL2"; echo "saida=$?"';
    const out = execFileSync('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', cmd], { env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.match(out, /saida=0/, out);
    const linhas = fs.readFileSync(registro, 'utf8').split('\n').filter(Boolean);
    assert.deepStrictEqual(linhas, ['url.dll,FileProtocolHandler', URL_TESTE, 'url.dll,FileProtocolHandler', URL_ESPACO]);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

// Ramo de reserva do script (rundll32.exe fora do PATH) e código de saída. O diretório de reserva é
// trocado por um do sandbox (RENDRA_WIN_SYS32): o rundll32.exe de verdade nunca roda.
function rodarScript({ sys32Tem, saida }) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-url-'));
  try {
    const sys32 = path.join(sandbox, 'sys32'); fs.mkdirSync(sys32);
    const registro = path.join(sandbox, 'registro.txt');
    if (sys32Tem) fs.writeFileSync(path.join(sys32, 'rundll32.exe'), `#!/bin/sh\nfor a in "$@"; do printf '%s\n' "$a" >> "$RENDRA_REGISTRO"; done\nexit ${saida}\n`);
    const env = ambientePty({ ...process.env, RENDRA_HOME: sandbox, RENDRA_WIN_SYS32: sys32, RENDRA_REGISTRO: registro, RENDRA_URL: URL_TESTE,
      WSLENV: 'RENDRA_WIN_SYS32/p:RENDRA_REGISTRO/p:RENDRA_URL/u' }, { wsl: true });
    const cmd = 'PATH=/usr/bin:/bin "$BROWSER" "$RENDRA_URL"; echo "saida=$?"';
    const out = execFileSync('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', cmd], { env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    return { codigo: Number(/saida=(\d+)/.exec(out)[1]), linhas: fs.existsSync(registro) ? fs.readFileSync(registro, 'utf8').split('\n').filter(Boolean) : [] };
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

test('rundll32.exe fora do PATH: o script usa o diretório de reserva e entrega a URL', { skip: !distro && 'sem WSL' }, () => {
  const r = rodarScript({ sys32Tem: true, saida: 0 });
  assert.deepStrictEqual(r, { codigo: 0, linhas: ['url.dll,FileProtocolHandler', URL_TESTE] });
});

test('o código de saída do destino volta ao chamador (o Claude Code trata ≠ 0 como falha)', { skip: !distro && 'sem WSL' }, () => {
  assert.strictEqual(rodarScript({ sys32Tem: true, saida: 3 }).codigo, 3);
  assert.notStrictEqual(rodarScript({ sys32Tem: false, saida: 0 }).codigo, 0); // sem rundll32.exe em lugar nenhum
});

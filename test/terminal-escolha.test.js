const test = require('node:test');
const assert = require('node:assert');
const { opcoesDeTerminal, shellsDoSeletor, caminhoNoWsl, caminhoNoWindows, argsCmdUnc, comandoEntrarNaPasta, CHAVE_BASH_WSL, VAR_PASTA_CMD, MSG_CMD_UNC } = require('../renderer/terminal-escolha');

const ps = { key: 'powershell', label: 'PowerShell' };
const gb = { key: 'gitbash', label: 'Git Bash' };
const cmd = { key: 'cmd', label: 'CMD' };
const comGit = [ps, gb, cmd];
const semGit = [ps, cmd];
const um = { available: true, distros: [{ name: 'Ubuntu', isDefault: true }] };
const dois = { available: true, distros: [{ name: 'Ubuntu', isDefault: true }, { name: 'Debian' }] };
const sem = { available: false, distros: [] };

test('PowerShell e CMD abrem direto no Windows, também com WSL e em projeto do WSL (D3)', () => {
  for (const shell of ['powershell', 'cmd']) {
    for (const distroProjeto of [null, 'Ubuntu']) {
      const r = opcoesDeTerminal({ shell, wslInfo: dois, shells: comGit, distroProjeto, plataforma: 'win32' });
      assert.strictEqual(r.direto, shell);
      assert.deepStrictEqual(r.opcoes, []);
    }
  }
});

test('Bash com Git Bash e distros pergunta: Git Bash (Windows) e uma opção por distro, nessa ordem', () => {
  const r = opcoesDeTerminal({ shell: 'gitbash', wslInfo: dois, shells: comGit, distroProjeto: null, plataforma: 'win32' });
  assert.strictEqual(r.direto, null);
  assert.deepStrictEqual(r.opcoes.map(o => o.label), ['Git Bash (Windows)', 'Bash (WSL Ubuntu)', 'Bash (WSL Debian)']);
  assert.deepStrictEqual(r.opcoes.map(o => o.shell), ['gitbash', 'wsl:Ubuntu', 'wsl:Debian']);
});

test('o foco cai no ambiente do projeto: Git Bash em projeto Windows, a distro dele em projeto WSL', () => {
  const base = { shell: 'gitbash', wslInfo: dois, shells: comGit, plataforma: 'win32' };
  assert.strictEqual(opcoesDeTerminal({ ...base, distroProjeto: null }).foco, 0);
  assert.strictEqual(opcoesDeTerminal({ ...base, distroProjeto: 'Ubuntu' }).foco, 1);
  assert.strictEqual(opcoesDeTerminal({ ...base, distroProjeto: 'Debian' }).foco, 2);
  assert.strictEqual(opcoesDeTerminal({ ...base, distroProjeto: 'debian' }).foco, 2); // sem diferenciar caixa
  assert.strictEqual(opcoesDeTerminal({ ...base, distroProjeto: 'Outra' }).foco, 0); // distro que não existe mais
});

test('só um dos dois existe: abre direto (Git Bash sem distros; uma distro sem Git Bash)', () => {
  assert.strictEqual(opcoesDeTerminal({ shell: 'gitbash', wslInfo: sem, shells: comGit, plataforma: 'win32' }).direto, 'gitbash');
  assert.strictEqual(opcoesDeTerminal({ shell: 'gitbash', wslInfo: null, shells: comGit, plataforma: 'win32' }).direto, 'gitbash');
  assert.strictEqual(opcoesDeTerminal({ shell: CHAVE_BASH_WSL, wslInfo: um, shells: shellsDoSeletor(semGit, um, 'win32'), plataforma: 'win32' }).direto, 'wsl:Ubuntu');
});

test('sem Git Bash e com várias distros: menu só com as distros, a do projeto focada', () => {
  const shells = shellsDoSeletor(semGit, dois, 'win32');
  const r = opcoesDeTerminal({ shell: CHAVE_BASH_WSL, wslInfo: dois, shells, distroProjeto: 'Debian', plataforma: 'win32' });
  assert.strictEqual(r.direto, null);
  assert.deepStrictEqual(r.opcoes.map(o => o.label), ['Bash (WSL Ubuntu)', 'Bash (WSL Debian)']);
  assert.strictEqual(r.foco, 1);
  assert.strictEqual(opcoesDeTerminal({ shell: CHAVE_BASH_WSL, wslInfo: dois, shells, distroProjeto: null, plataforma: 'win32' }).foco, 0); // a padrão do WSL
});

test('seletor da barra: a entrada Bash só nasce no Windows, sem Git Bash e com distro (chave que não colide com o bash do Mac/Linux)', () => {
  assert.deepStrictEqual(shellsDoSeletor(semGit, dois, 'win32').map(s => s.key), ['powershell', CHAVE_BASH_WSL, 'cmd']);
  assert.strictEqual(CHAVE_BASH_WSL, 'bash-wsl');
  assert.deepStrictEqual(shellsDoSeletor(comGit, dois, 'win32').map(s => s.key), ['powershell', 'gitbash', 'cmd']);
  assert.deepStrictEqual(shellsDoSeletor(semGit, sem, 'win32').map(s => s.key), ['powershell', 'cmd']);
  const posix = [{ key: 'zsh', label: 'Zsh' }, { key: 'bash', label: 'Bash' }];
  assert.deepStrictEqual(shellsDoSeletor(posix, dois, 'linux'), posix);
});

test('macOS e Linux: o shell escolhido abre direto, sem menu (D5)', () => {
  const posix = [{ key: 'zsh', label: 'Zsh' }, { key: 'bash', label: 'Bash' }];
  for (const plataforma of ['darwin', 'linux']) {
    const r = opcoesDeTerminal({ shell: 'bash', wslInfo: dois, shells: posix, distroProjeto: null, plataforma });
    assert.strictEqual(r.direto, 'bash');
    assert.deepStrictEqual(r.opcoes, []);
  }
  assert.strictEqual(opcoesDeTerminal({ shell: 'bash', wslInfo: sem, shells: posix, plataforma: 'linux' }).direto, 'bash');
});

test('seletor vazio ou valor que não está na lista cai no primeiro shell', () => {
  assert.strictEqual(opcoesDeTerminal({ shell: '', wslInfo: dois, shells: comGit, plataforma: 'win32' }).direto, 'powershell');
  assert.strictEqual(opcoesDeTerminal({ shell: 'zsh', wslInfo: dois, shells: comGit, plataforma: 'win32' }).direto, 'powershell');
});

test('caminho do Windows visto de dentro do WSL', () => {
  assert.strictEqual(caminhoNoWsl('C:\\projetos\\exemplo'), '/mnt/c/projetos/exemplo');
  assert.strictEqual(caminhoNoWsl('D:/a/b/'), '/mnt/d/a/b');
  assert.strictEqual(caminhoNoWsl('C:\\'), '/mnt/c');
  assert.strictEqual(caminhoNoWsl('\\\\wsl.localhost\\Ubuntu\\home'), null);
  assert.strictEqual(caminhoNoWsl(''), null);
});

test('caminho do WSL visto do Windows: só /mnt/<letra> vira unidade', () => {
  assert.strictEqual(caminhoNoWindows('/mnt/c/projetos/exemplo'), 'C:\\projetos\\exemplo');
  assert.strictEqual(caminhoNoWindows('/mnt/d'), 'D:\\');
  assert.strictEqual(caminhoNoWindows('/mnt/d/'), 'D:\\');
  for (const nao of ['/home/u/proj', '/mnt/wsl/x', '/mnt/c2/x', '/mnt', '/mnt/', '/x/mnt/c', '', null, undefined]) assert.strictEqual(caminhoNoWindows(nao), null, String(nao));
});

test('argsCmdUnc: linha constante, o caminho nunca entra nela (injeção e expansão no CMD)', () => {
  const linha = argsCmdUnc();
  assert.strictEqual(typeof linha, 'string'); // string pronta: o node-pty a entrega sem alterar
  assert.strictEqual(argsCmdUnc(), linha);
  assert.ok(linha.startsWith('/V:OFF /k pushd "%' + VAR_PASTA_CMD + '%" || echo '));
  assert.ok(linha.endsWith(MSG_CMD_UNC));
  assert.doesNotMatch(MSG_CMD_UNC, /[&|<>()^%!"]/); // a mensagem não tem metacaractere do CMD
  // nenhuma pasta (espaço, &, %PATH%, ^, !x!, ', parênteses) altera a linha: a função nem recebe o caminho
  for (const pasta of ['\\\\wsl.localhost\\U\\a b', '\\\\wsl.localhost\\U\\a&b', '\\\\wsl.localhost\\U\\%PATH%', '\\\\wsl.localhost\\U\\a^b', '\\\\wsl.localhost\\U\\!x!', "\\\\wsl.localhost\\U\\it's", '\\\\wsl.localhost\\U\\(x)']) {
    assert.ok(!argsCmdUnc(pasta).includes(pasta.slice(2)), pasta);
  }
});

const raizUnc = { root: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj', wsl: { distro: 'Ubuntu', linuxPath: '/home/u/proj' } };
const raizUncMnt = { root: '\\\\wsl.localhost\\Ubuntu\\mnt\\c\\proj', wsl: { distro: 'Ubuntu', linuxPath: '/mnt/c/proj' } };
const raizWin = { root: 'C:\\proj', wsl: null };
const raizMontada = { root: 'C:\\proj', wsl: { distro: 'Ubuntu', linuxPath: '/mnt/personalizado/proj', viaWindows: true } };

test('comandoEntrarNaPasta: PowerShell e Git Bash como sempre', () => {
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'powershell', root: raizWin }), "Set-Location -LiteralPath 'C:\\proj'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'powershell', root: { root: "C:\\it's" } }), "Set-Location -LiteralPath 'C:\\it''s'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'powershell', root: raizUnc }), "Set-Location -LiteralPath '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'gitbash', root: raizWin }), 'cd "$(cygpath -u \'C:\\proj\')"\r');
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'zsh', root: { root: '/Users/u/p' } }), "cd '/Users/u/p'\r");
});

test('comandoEntrarNaPasta: CMD usa cd /d na unidade, a unidade do /mnt/<letra> do UNC, ou pushd com a mensagem da D4', () => {
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'cmd', root: raizWin }), 'cd /d "C:\\proj"\r');
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'cmd', root: raizUncMnt }), 'cd /d "C:\\proj"\r'); // D4: caminho de unidade antes do pushd
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'cmd', root: raizUnc }), `pushd "${raizUnc.root}" || echo ${MSG_CMD_UNC}\r`);
  // "%", "!" e aspas no caminho nunca viram comando: cai na mensagem
  for (const ruim of ['%PATH%', 'a!b!', 'a"b']) {
    const r = comandoEntrarNaPasta({ shellKey: 'cmd', root: { root: `\\\\wsl.localhost\\Ubuntu\\home\\${ruim}`, wsl: { distro: 'Ubuntu', linuxPath: `/home/${ruim}` } } });
    assert.strictEqual(r, `echo ${MSG_CMD_UNC}\r`, ruim);
  }
  // & ^ ( ) ficam entre aspas e valem como texto
  assert.ok(comandoEntrarNaPasta({ shellKey: 'cmd', root: { root: '\\\\wsl.localhost\\Ubuntu\\a&b^(c)', wsl: { distro: 'Ubuntu', linuxPath: '/a&b^(c)' } } }).startsWith('pushd "\\\\wsl.localhost\\Ubuntu\\a&b^(c)" || echo '));
});

test('comandoEntrarNaPasta: terminal WSL usa o linuxPath da distro do projeto, o wslpath na pasta do Windows e ~ em UNC de outra distro', () => {
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'Ubuntu', root: raizUnc }), "cd '/home/u/proj'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'ubuntu', root: raizUnc }), "cd '/home/u/proj'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'Ubuntu', root: raizMontada }), "cd '/mnt/personalizado/proj'\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'Debian', root: raizUnc }), 'cd ~\r');
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'Ubuntu', root: raizWin }), "cd \"$(wslpath 'C:\\proj')\"\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'wsl', distro: 'Debian', root: raizMontada }), "cd \"$(wslpath 'C:\\proj')\"\r");
  assert.strictEqual(comandoEntrarNaPasta({ shellKey: 'powershell', root: null }), '');
});

const test = require('node:test');
const assert = require('node:assert');
const E = require('../renderer/sessoes-escolha');

const UUID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

test('idValido aceita só uuid estrito', () => {
  assert.strictEqual(E.idValido(UUID), true);
  for (const ruim of [UUID + ';', UUID.slice(0, 35), UUID + 'a', `${UUID.slice(0, 8)} ${UUID.slice(9)}`, '$(calc)'.padEnd(36, 'a'),
    '-'.repeat(36), UUID.toUpperCase(), '', null, undefined, 42, `${UUID}\n`, 'a;b'.padEnd(36, '0')]) {
    assert.strictEqual(E.idValido(ruim), false, `recusa ${JSON.stringify(ruim)}`);
  }
});

test('comandoRetomar e comandoNovo: textos fixos; id ruim lança', () => {
  assert.strictEqual(E.comandoRetomar('claude', UUID), `claude --resume ${UUID}\r`);
  assert.strictEqual(E.comandoRetomar('codex', UUID), `codex resume ${UUID}\r`);
  assert.throws(() => E.comandoRetomar('claude', `${UUID};calc`));
  assert.throws(() => E.comandoRetomar('claude', '-'.repeat(36)));
  assert.throws(() => E.comandoRetomar('bash', UUID));
  assert.match(E.comandoNovo('claude'), /^claude --session-id [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\r$/);
  assert.strictEqual(E.comandoNovo('codex'), 'codex\r');
  assert.throws(() => E.comandoNovo('rm'));
});

test('comandoNovo do Claude: --session-id com uuid v4 novo a cada chamada (não cai na função claude() do .bashrc)', () => {
  const a = E.comandoNovo('claude'), b = E.comandoNovo('claude');
  const id = c => c.replace(/^claude --session-id /, '').replace(/\r$/, '');
  assert.ok(E.idValido(id(a)), 'o id gerado passa em idValido');
  assert.ok(E.idValido(id(b)));
  assert.notStrictEqual(id(a), id(b), 'dois cliques, dois ids');
  assert.strictEqual(E.comandoNovo('codex'), 'codex\r', 'codex continua sem argumento');
});

test('mesmaPasta: sem caixa no Windows e em /mnt, com caixa no Linux nativo', () => {
  assert.ok(E.mesmaPasta('D:\\SOEs\\X', 'd:\\soes\\x'));
  assert.ok(E.mesmaPasta('D:\\SOEs\\X\\', 'D:/SOEs/X'));
  assert.ok(E.mesmaPasta('/mnt/d/SOEs/V', '/mnt/d/soes/v'));
  assert.ok(!E.mesmaPasta('/home/u/Pasta', '/home/u/pasta'));
  assert.ok(E.mesmaPasta('/home/u/Pasta', '/home/u/Pasta/'));
  assert.ok(!E.mesmaPasta('/mnt/d/a', '/mnt/d/ab'));
  assert.ok(!E.mesmaPasta('', '/mnt/d/a'));
  assert.ok(!E.mesmaPasta(null, undefined));
});

test('tituloCurto: primeira linha, espaços colapsados, até 80 caracteres', () => {
  const longo = 'a'.repeat(200);
  const t = E.tituloCurto(longo);
  assert.ok(t.length <= 80, `tem ${t.length}`);
  assert.ok(t.endsWith('…'));
  assert.ok(longo.startsWith(t.slice(0, -1)), 'só o início do texto');
  assert.strictEqual(E.tituloCurto('primeira linha\nsegunda linha secreta'), 'primeira linha');
  assert.strictEqual(E.tituloCurto('  a   b \t c  '), 'a b c');
  assert.strictEqual(E.tituloCurto('\n\n  depois das vazias'), 'depois das vazias');
  assert.strictEqual(E.tituloCurto(''), '');
  assert.strictEqual(E.tituloCurto(null), '');
});

test('dataBr: DD/MM/AAAA HH:mm em 24 horas', () => {
  assert.strictEqual(E.dataBr(new Date(2026, 9, 3, 7, 5).getTime()), '03/10/2026 07:05');
  assert.strictEqual(E.dataBr(new Date(2026, 0, 31, 23, 59).getTime()), '31/01/2026 23:59');
  assert.strictEqual(E.dataBr(NaN), '');
});

test('ordenarRecentes: da mais nova para a mais antiga, sem alterar a entrada', () => {
  const ent = [{ id: 'a', quando: 1 }, { id: 'c', quando: 3 }, { id: 'b', quando: 2 }];
  assert.deepStrictEqual(E.ordenarRecentes(ent).map(s => s.id), ['c', 'b', 'a']);
  assert.deepStrictEqual(ent.map(s => s.id), ['a', 'c', 'b']);
});

test('escolherTitulo: título salvo, depois início da conversa, depois histórico, depois rótulo', () => {
  assert.strictEqual(E.escolherTitulo({ customTitle: 'Salvo', primeiraMensagem: 'Início', historico: 'Hist' }), 'Salvo');
  assert.strictEqual(E.escolherTitulo({ primeiraMensagem: 'Início', historico: 'Hist' }), 'Início');
  assert.strictEqual(E.escolherTitulo({ primeiraMensagem: '  ', historico: 'Hist' }), 'Hist');
  assert.strictEqual(E.escolherTitulo({}), 'Conversa sem título');
  assert.ok(E.escolherTitulo({ primeiraMensagem: 'x'.repeat(300) }).length <= 80);
});

test('visiveis: 10 primeiras ou todas', () => {
  const s = Array.from({ length: 25 }, (_, i) => ({ id: String(i), quando: i }));
  const o = E.ordenarRecentes(s);
  assert.strictEqual(E.visiveis(o, false).length, 10);
  assert.strictEqual(E.visiveis(o, false)[0].quando, 24);
  assert.strictEqual(E.visiveis(o, true).length, 25);
});

test('opcoesNovaSessao: 0, 1 ou 2 provedores', () => {
  assert.deepStrictEqual(E.opcoesNovaSessao({ claude: false, codex: false }), []);
  assert.deepStrictEqual(E.opcoesNovaSessao({ claude: true, codex: false }).map(o => o.label), ['Nova conversa no Claude', 'Só o terminal']);
  assert.deepStrictEqual(E.opcoesNovaSessao({ claude: false, codex: true }).map(o => o.label), ['Nova conversa no Codex', 'Só o terminal']);
  const dois = E.opcoesNovaSessao({ claude: true, codex: true });
  assert.deepStrictEqual(dois.map(o => o.label), ['Nova conversa no Claude', 'Nova conversa no Codex', 'Só o terminal']);
  assert.deepStrictEqual(dois.map(o => o.provedor), ['claude', 'codex', null]);
});

test('ambienteDoTerminal: a regra única dos três casos', () => {
  const wslVia = { distro: 'Ubuntu-24.04', linuxPath: '/mnt/d/SOEs/V' };
  assert.deepStrictEqual(E.ambienteDoTerminal({ cwd: 'D:\\SOEs\\V', wsl: wslVia, shell: 'powershell' }), { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/mnt/d/SOEs/V' });
  assert.deepStrictEqual(E.ambienteDoTerminal({ cwd: '\\\\wsl.localhost\\U\\home\\u\\p', wsl: { distro: 'U', linuxPath: '/home/u/p' }, shell: 'powershell' }), { tipo: 'wsl', distro: 'U', cwd: '/home/u/p' });
  assert.deepStrictEqual(E.ambienteDoTerminal({ cwd: 'D:\\SOEs\\X', wsl: null, shell: 'wsl:Ubuntu-24.04' }), { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/mnt/d/SOEs/X' });
  assert.deepStrictEqual(E.ambienteDoTerminal({ cwd: 'D:\\SOEs\\X', wsl: null, shell: 'powershell' }), { tipo: 'windows', distro: null, cwd: 'D:\\SOEs\\X' });
  assert.strictEqual(E.ambienteDoTerminal({ cwd: null, wsl: null, shell: 'powershell' }), null);
  assert.strictEqual(E.ambienteDoTerminal({ cwd: '', wsl: null, shell: 'wsl:U' }), null);
  assert.strictEqual(E.ambienteDoTerminal({ cwd: '\\\\servidor\\x', wsl: null, shell: 'wsl:U' }), null, 'sem caminho de unidade não há como ver no WSL');
});

test('fimDePrompt: prompts reais com cores, cursor e OSC de título', () => {
  assert.ok(E.fimDePrompt('banner\r\nuser@host:~$ '));
  assert.ok(E.fimDePrompt('PS C:\\x> '));
  assert.ok(E.fimDePrompt('\x1b[32mroot@h\x1b[0m:\x1b[34m/\x1b[0m# '));
  assert.ok(E.fimDePrompt('x\r\n\x1b]0;user@host: ~\x07user@host:~$ \x1b[?2004h'));
  assert.ok(E.fimDePrompt('x\r\n\x1b]0;título\x1b\\PS C:\\> \x1b[5 q\x1b[?25h'));
  assert.ok(E.fimDePrompt('MINGW64 ~/x\r\n$ '));
  assert.ok(E.fimDePrompt('C:\\Users\\u>'));
  assert.ok(E.fimDePrompt('abc\rPS C:\\> \r\n\r\n'));
});

test('fimDePrompt recusa banner sem terminador e linha de texto com mais saída depois', () => {
  assert.ok(!E.fimDePrompt(''));
  assert.ok(!E.fimDePrompt('Microsoft Windows [Version 10]\r\nCopyright (c)'));
  assert.ok(!E.fimDePrompt('carregando nvm...'));
  assert.ok(!E.fimDePrompt('<!-- comentário -->'));
  assert.ok(!E.fimDePrompt('x --> \r\ncarregando...'));
  assert.ok(!E.fimDePrompt('\x1b]0;título que termina em >\x07'));
});

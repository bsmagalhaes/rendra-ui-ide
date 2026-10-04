// Conteúdo da página "Comandos" (renderer/comandos-conteudo.js): estrutura, texto e coerência com a decisão de tecla
// que a IDE realmente executa (terminal-keys.js e atalhos-ide.js).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../renderer/comandos-conteudo');
const { acaoDeTecla } = require('../renderer/terminal-keys');
const { acaoDeAtalhoIde } = require('../renderer/atalhos-ide');

const PLAT = { windows: 'win32', macos: 'darwin', linux: 'linux' };
const todas = [];
for (const sistema of C.SISTEMAS) for (const agente of C.AGENTES) todas.push({ sistema, agente, c: C.conteudo({ sistema, agente }) });
const texto = c => JSON.stringify(c);

test('as 6 combinações de sistema e agente devolvem os três blocos, não vazios, na mesma ordem', () => {
  assert.strictEqual(todas.length, 6);
  for (const { c } of todas) {
    assert.deepStrictEqual(c.blocos.map(b => b.id), ['terminal', 'agente', 'ide']);
    for (const b of c.blocos) assert.ok(b.itens.length > 0, `bloco ${b.id} vazio`);
  }
});

test('todo item de comando do agente tem comando, o que faz e equivalente no outro agente preenchidos', () => {
  for (const { sistema, agente, c } of todas) {
    const bloco = c.blocos.find(b => b.id === 'agente');
    assert.ok(bloco.itens.length >= 10);
    for (const i of bloco.itens) {
      for (const campo of ['comando', 'oQueFaz', 'equivalente']) {
        assert.ok(typeof i[campo] === 'string' && i[campo].trim().length > 0, `${sistema}/${agente}/${i.id}: ${campo} vazio`);
      }
    }
  }
});

test('todo item de atalho tem título, teclas e o que faz', () => {
  for (const { sistema, agente, c } of todas) {
    for (const b of c.blocos.filter(x => x.id !== 'agente')) {
      for (const i of b.itens) {
        assert.ok(i.titulo && i.oQueFaz, `${sistema}/${agente}/${i.id}: sem título ou texto`);
        assert.ok(Array.isArray(i.teclas) && i.teclas.length > 0 && i.teclas.every(t => Array.isArray(t) && t.length > 0), `${sistema}/${agente}/${i.id}: teclas`);
      }
    }
  }
});

test('nenhum texto tem travessão', () => {
  for (const { sistema, agente, c } of todas) assert.ok(!/[—–]/.test(texto(c)), `travessão em ${sistema}/${agente}`);
});

test('as versões conferidas das duas CLIs estão presentes', () => {
  assert.deepStrictEqual(C.VERSOES, { claude: '2.1.287', codex: '0.157.1' });
  for (const { c } of todas) assert.deepStrictEqual(c.versoes, C.VERSOES);
});

test('o macOS mostra Cmd e Option; Windows e Linux não', () => {
  for (const { sistema, c } of todas) {
    const t = texto(c);
    if (sistema === 'macos') {
      assert.ok(t.includes('"Cmd"') && t.includes('Option'), 'o macOS não cita Cmd e Option');
      assert.ok(t.includes('"Control"'), 'o macOS não cita o Control');
    } else {
      assert.ok(!/Cmd|Option|Control\b/.test(t), `${sistema} cita tecla do Mac`);
    }
  }
});

test('o Windows tem a nota do terminal WSL; Linux e macOS não', () => {
  for (const { sistema, c } of todas) {
    const notas = c.blocos.find(b => b.id === 'terminal').notas.join(' ');
    if (sistema === 'windows') assert.match(notas, /WSL/);
    else assert.ok(!/WSL/.test(notas));
  }
});

test('rolar cita a roda, Alt (ou Option) mais rápido, Shift+PageUp e Shift+PageDown', () => {
  for (const { sistema, c } of todas) {
    const rolar = c.blocos[0].itens.find(i => i.id === 'rolar');
    const rot = C.rotulo(rolar.teclas);
    assert.match(rot, /Shift\+PageUp/);
    assert.match(rot, /Shift\+PageDown/);
    assert.match(rot, sistema === 'macos' ? /Option\+Roda do mouse/ : /Alt\+Roda do mouse/);
  }
});

test('abrir pasta é Ctrl+O (Cmd+O no macOS), só fora do terminal no Windows e no Linux; não existe Ctrl+Shift+O', () => {
  for (const { sistema, c } of todas) {
    const i = c.blocos.find(b => b.id === 'ide').itens.find(x => x.id === 'abrir-pasta');
    assert.strictEqual(C.rotulo(i.teclas), sistema === 'macos' ? 'Cmd+O' : 'Ctrl+O');
    assert.ok(/programa/.test(i.oQueFaz), 'não diz que o Ctrl+O/Control+O vai ao programa');
    if (sistema !== 'macos') assert.match(i.oQueFaz, /fora do terminal/);
    assert.ok(!/Shift\+O/.test(texto(c)), 'cita Ctrl+Shift+O');
  }
});

test('novo terminal e troca de aba por sistema', () => {
  for (const { sistema, c } of todas) {
    const ide = Object.fromEntries(c.blocos.find(b => b.id === 'ide').itens.map(i => [i.id, C.rotulo(i.teclas)]));
    assert.strictEqual(ide['novo-terminal'], sistema === 'macos' ? 'Cmd+Shift+T' : 'Ctrl+Shift+T');
    assert.strictEqual(ide['proxima-aba'], sistema === 'macos' ? 'Control+Tab' : 'Ctrl+Tab');
    assert.strictEqual(ide['aba-anterior'], sistema === 'macos' ? 'Control+Shift+Tab' : 'Ctrl+Shift+Tab');
  }
});

test('reordenar abas: arrastar e Ctrl+Shift+Seta esquerda ou direita, por sistema, para projetos, terminais e editor', () => {
  for (const { sistema, c } of todas) {
    const item = c.blocos.find(b => b.id === 'ide').itens.find(i => i.id === 'reordenar');
    const ctrl = sistema === 'macos' ? 'Control' : 'Ctrl';
    assert.strictEqual(item.titulo, 'Reordenar abas');
    assert.deepStrictEqual(item.teclas.map(t => C.rotulo([t])), ['Arrastar a aba', `${ctrl}+Shift+Seta esquerda`, `${ctrl}+Shift+Seta direita`]);
    assert.match(item.oQueFaz, /projeto, de um terminal ou de um arquivo do editor/);
    assert.match(item.oQueFaz, /marcando por palavra/);
  }
  const renomear = C.conteudo({ sistema: 'windows', agente: 'claude' }).blocos.find(b => b.id === 'ide').itens.find(i => i.id === 'renomear');
  assert.match(renomear.oQueFaz, /terminal ou de um workspace/, 'o editor não renomeia: o item de renomear continua só para terminais e projetos');
});

test('a lista traz os atalhos antigos da IDE (F40 a F42) e nada além', () => {
  const ids = C.conteudo({ sistema: 'windows', agente: 'claude' }).blocos.find(b => b.id === 'ide').itens.map(i => i.id);
  assert.deepStrictEqual(ids, ['novo-terminal', 'abrir-pasta', 'proxima-aba', 'aba-anterior', 'salvar', 'fechar-aba', 'dividir', 'atualizar', 'abrir-link', 'renomear', 'reordenar', 'esc', 'enter']);
});

test('a ordem dos itens é igual entre chamadas', () => {
  for (const { sistema, agente } of todas) {
    assert.deepStrictEqual(C.conteudo({ sistema, agente }), C.conteudo({ sistema, agente }));
    assert.deepStrictEqual(C.conteudo({ sistema, agente }).blocos.map(b => b.itens.map(i => i.id)), C.conteudo({ sistema, agente }).blocos.map(b => b.itens.map(i => i.id)));
  }
});

test('sistema ou agente inválido lança erro', () => {
  assert.throws(() => C.conteudo({ sistema: 'beos', agente: 'claude' }));
  assert.throws(() => C.conteudo({ sistema: 'windows', agente: 'gemini' }));
  assert.throws(() => C.conteudo());
});

test('o interromper explica 1, 2 e 3 toques, a janela de 2 segundos e o texto marcado', () => {
  for (const { c } of todas) {
    const i = c.blocos[0].itens.find(x => x.id === 'interromper');
    const t = [i.oQueFaz, ...i.detalhes].join(' ');
    assert.match(t, /3 vezes em até 2 segundos/);
    assert.match(t, /1 toque: depois de 1 segundo a IDE cola/);
    assert.match(t, /2 toques: aparece o aviso/);
    assert.match(t, /texto marcado/);
  }
});

test('comandos conferidos: equivalentes entre Claude Code e Codex', () => {
  const claude = C.conteudo({ sistema: 'linux', agente: 'claude' }).blocos[1].itens;
  const codex = C.conteudo({ sistema: 'linux', agente: 'codex' }).blocos[1].itens;
  const por = (lista, id) => lista.find(i => i.id === id);
  // o comando de um é o equivalente do outro
  for (const i of claude) assert.strictEqual(por(codex, i.id).equivalente, i.comando);
  assert.match(por(claude, 'retomar').comando, /claude -c/);
  assert.match(por(codex, 'retomar').comando, /codex resume --last/);
  assert.match(por(claude, 'sair').comando, /\/exit/);
  assert.match(por(codex, 'sair').comando, /\/quit/);
  assert.strictEqual(por(claude, 'compactar').comando, '/compact');
});

// ── coerência com o que a IDE realmente faz ─────────────────────────────────────────────────────────────
const MODS = { Ctrl: 'ctrlKey', Control: 'ctrlKey', Shift: 'shiftKey', Alt: 'altKey', Option: 'altKey', Cmd: 'metaKey' };
const CODIGO = { Tab: 'Tab', Backspace: 'Backspace', Delete: 'Backspace', PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Enter' };
// ["Ctrl","Shift","V"] vira um evento; devolve null para combinações que não são tecla (mouse, 3 vezes...)
function eventoDe(combo) {
  const teclas = combo.filter(t => t !== '(3 vezes)');
  const ev = { type: 'keydown', repeat: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  const ultima = teclas[teclas.length - 1];
  for (const t of teclas.slice(0, -1)) { if (!MODS[t]) return null; ev[MODS[t]] = true; }
  if (/^[A-Z]$/.test(ultima)) ev.code = `Key${ultima}`;
  else if (CODIGO[ultima]) ev.code = CODIGO[ultima];
  else return null;
  ev.key = ultima;
  return ev;
}
const combosDe = (sistema, id, agente = 'claude') => (C.rotuloDeTecla(id, sistema, agente) || []).map(eventoDe).filter(Boolean);

test('coerência: as teclas de colar texto, copiar, interromper, limpar, quebrar linha e apagar palavra são as que o handler decide', () => {
  const esperado = {
    windows: { 'colar-texto': ['colar', 'colar'], 'copiar-teclado': ['copiar-selecao'], interromper: ['ctrlc'], 'limpar-tela': ['deixar'], 'quebrar-linha': ['enviar'], 'apagar-palavra': ['deixar', 'deixar'] },
    linux: { 'colar-texto': ['colar', 'colar'], 'copiar-teclado': ['copiar-selecao'], interromper: ['ctrlc'], 'limpar-tela': ['deixar'], 'quebrar-linha': ['enviar'], 'apagar-palavra': ['deixar'] },
    macos: { 'colar-texto': ['nativo'], 'copiar-teclado': ['deixar'], interromper: ['ctrlc'], 'limpar-tela': ['deixar'], 'quebrar-linha': ['enviar'], 'apagar-palavra': ['deixar'] },
  };
  for (const sistema of C.SISTEMAS) {
    for (const [id, tipos] of Object.entries(esperado[sistema])) {
      const evs = combosDe(sistema, id);
      assert.strictEqual(evs.length, tipos.length, `${sistema}/${id}: ${evs.length} teclas`);
      evs.forEach((ev, n) => assert.strictEqual(acaoDeTecla(ev, PLAT[sistema], 'powershell').tipo, tipos[n], `${sistema}/${id} tecla ${n}`));
    }
  }
});

test('coerência: colar imagem cita a tecla que a IDE trata como colar imagem (Windows, Linux) ou deixa passar como Ctrl+V (macOS)', () => {
  // Claude Code
  assert.deepStrictEqual(combosDe('windows', 'colar-imagem').map(ev => acaoDeTecla(ev, 'win32', 'powershell').tipo), ['colar-imagem']);
  assert.deepStrictEqual(combosDe('linux', 'colar-imagem').map(ev => acaoDeTecla(ev, 'linux', 'bash').tipo), ['colar', 'colar-imagem']);
  assert.deepStrictEqual(combosDe('macos', 'colar-imagem').map(ev => acaoDeTecla(ev, 'darwin', 'zsh').tipo), ['deixar']);
  // Codex: sempre Ctrl+V (Control+V no macOS)
  assert.deepStrictEqual(combosDe('windows', 'colar-imagem', 'codex').map(ev => acaoDeTecla(ev, 'win32', 'powershell').tipo), ['colar']);
  assert.deepStrictEqual(combosDe('macos', 'colar-imagem', 'codex').map(ev => acaoDeTecla(ev, 'darwin', 'zsh').tipo), ['deixar']);
});

test('coerência: as teclas da IDE são as que o reconhecedor de atalhos devolve', () => {
  const alvo = { 'novo-terminal': 'novo-terminal', 'abrir-pasta': 'abrir-pasta', 'proxima-aba': 'proxima-aba', 'aba-anterior': 'aba-anterior' };
  for (const sistema of C.SISTEMAS) {
    for (const [id, acao] of Object.entries(alvo)) {
      const evs = combosDe(sistema, id);
      assert.strictEqual(evs.length, 1, `${sistema}/${id}`);
      assert.strictEqual(acaoDeAtalhoIde(evs[0], PLAT[sistema], { foraDoTerminal: true }), acao, `${sistema}/${id}`);
    }
  }
});

test('coerência: o Ctrl+O listado não vira atalho da IDE dentro do terminal (Windows e Linux)', () => {
  for (const sistema of ['windows', 'linux']) {
    const [ev] = combosDe(sistema, 'abrir-pasta');
    assert.strictEqual(acaoDeTecla(ev, PLAT[sistema], 'bash').tipo, 'deixar');
  }
});

test('coerência: Ctrl+Shift+T e Ctrl+Tab listados valem também com o foco no terminal', () => {
  for (const sistema of C.SISTEMAS) {
    for (const id of ['novo-terminal', 'proxima-aba', 'aba-anterior']) {
      const [ev] = combosDe(sistema, id);
      assert.strictEqual(acaoDeTecla(ev, PLAT[sistema], 'bash').tipo, 'atalho-ide', `${sistema}/${id}`);
    }
  }
});

// Roda do mouse: "linhas por vez" do Windows no terminal e no Monaco (renderer/wheel-lines.js). Lógica pura, sem DOM.
const test = require('node:test');
const assert = require('node:assert');
const { novoEstado, linhasDaRoda, decidirRamo, sequenciaDeSetas, copiasExtras, pixelsDeLinhas } = require('../renderer/wheel-lines');

const WIN = { plataforma: 'win32', linhasPagina: 24 };
// entalhe real do Chromium no Windows: deltaY em pixels (N linhas x 100/3), wheelDeltaY fixo em 120
const ent = (deltaY, extra = {}) => ({ deltaY, deltaX: 0, deltaMode: 0, wheelDeltaY: deltaY < 0 ? 120 : -120, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...extra });
const roda = (est, e, ctx = WIN) => linhasDaRoda(est, e, ctx);

test('T1: um entalhe medido (deltaY -499,99) rola 15 linhas para cima, sem resto', () => {
  const r = roda(novoEstado(), ent(-499.99));
  assert.strictEqual(r.linhas, -15);
  assert.strictEqual(r.estado.resto, 0);
});
test('T1: Windows em 3 linhas (deltaY 100) rola 3 para baixo', () => {
  assert.strictEqual(roda(novoEstado(), ent(100)).linhas, 3);
});
test('T1: três entalhes seguidos de -499,99 somam -45', () => {
  let est = novoEstado(), total = 0;
  for (let i = 0; i < 3; i++) { const r = roda(est, ent(-499.99)); est = r.estado; total += r.linhas; }
  assert.strictEqual(total, -45);
});

test('T2: trackpad (deltaY 10, wheelDeltaY -12) não é entalhe: null, comportamento atual', () => {
  assert.strictEqual(roda(novoEstado(), ent(10, { wheelDeltaY: -12 })).linhas, null);
  assert.strictEqual(roda(novoEstado(), ent(10, { wheelDeltaY: 0 })).linhas, null);
  assert.strictEqual(roda(novoEstado(), ent(10, { wheelDeltaY: undefined })).linhas, null);
  assert.strictEqual(roda(novoEstado(), ent(10, { wheelDeltaY: -130 })).linhas, null, 'não é múltiplo de 120');
});
test('T2: entalhes fracionários acumulam sem pular nem travar', () => {
  let est = novoEstado(); const lista = [];
  for (let i = 0; i < 4; i++) { const r = roda(est, ent(50)); est = r.estado; lista.push(r.linhas); } // 1,5 linha por entalhe
  assert.deepStrictEqual(lista, [1, 2, 1, 2]);
  assert.strictEqual(lista.reduce((a, b) => a + b), 6); // 4 x 1,5
});
test('T2/9: inverter o sentido zera o resíduo', () => {
  let r = roda(novoEstado(), ent(50));            // 1 linha, resto 0,5
  assert.strictEqual(r.linhas, 1);
  assert.ok(r.estado.resto > 0.4);
  r = roda(r.estado, ent(-100 / 3));              // 1 linha para cima: se o resíduo +0,5 compensasse, daria 0
  assert.strictEqual(r.linhas, -1);
  assert.strictEqual(r.estado.resto, 0);
});
test('9: o estado é por instância: um estado não vaza no outro', () => {
  const a = roda(novoEstado(), ent(50));
  const b = roda(novoEstado(), ent(50));
  assert.strictEqual(a.linhas, b.linhas);
  assert.strictEqual(a.estado.resto, b.estado.resto);
});

test('T3: deltaMode 1 usa deltaY como linhas', () => {
  assert.strictEqual(roda(novoEstado(), { deltaY: 3, deltaMode: 1 }).linhas, 3);
  assert.strictEqual(roda(novoEstado(), { deltaY: -3, deltaMode: 1 }).linhas, -3);
});
test('T3: deltaMode 2 rola uma página por entalhe, com sinal', () => {
  assert.strictEqual(roda(novoEstado(), { deltaY: 1, deltaMode: 2 }).linhas, 24);
  assert.strictEqual(roda(novoEstado(), { deltaY: -1, deltaMode: 2 }).linhas, -24);
});

test('T4: Mac e Linux devolvem null para o evento que no Windows dá 15', () => {
  const e = ent(499.99);
  assert.strictEqual(roda(novoEstado(), e).linhas, 15);
  for (const p of ['darwin', 'linux']) assert.strictEqual(roda(novoEstado(), e, { plataforma: p, linhasPagina: 24 }).linhas, null);
  assert.strictEqual(roda(novoEstado(), { deltaY: 3, deltaMode: 1 }, { plataforma: 'darwin', linhasPagina: 24 }).linhas, null);
});
test('T4: Ctrl, Shift, Meta, deltaX e deltaY zero devolvem null', () => {
  for (const extra of [{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }, { deltaX: 4 }]) assert.strictEqual(roda(novoEstado(), ent(499.99, extra)).linhas, null);
  assert.strictEqual(roda(novoEstado(), ent(0, { wheelDeltaY: 0 })).linhas, null);
});
test('T4: Alt multiplica por 5 (rolagem rápida)', () => {
  assert.strictEqual(roda(novoEstado(), ent(499.99, { altKey: true })).linhas, 75);
  assert.strictEqual(roda(novoEstado(), ent(100, { altKey: true })).linhas, 15);
});

test('2: decidirRamo cobre as combinações, com o mouse valendo em qualquer buffer e o x10 sem roda', () => {
  const d = (tipoBuffer, modoMouse) => decidirRamo({ tipoBuffer, modoMouse });
  assert.strictEqual(d('normal', 'none'), 'scroll');
  assert.strictEqual(d('alternate', 'none'), 'setas');
  assert.strictEqual(d('normal', 'vt200'), 'mouse');
  assert.strictEqual(d('alternate', 'vt200'), 'mouse');
  for (const m of ['drag', 'any']) { assert.strictEqual(d('normal', m), 'mouse'); assert.strictEqual(d('alternate', m), 'mouse'); }
  assert.strictEqual(d('normal', 'x10'), 'scroll');
  assert.strictEqual(d('alternate', 'x10'), 'setas');
});

test('T6/5: setas repetidas N vezes, respeitando o modo de cursor (DECCKM)', () => {
  assert.strictEqual(sequenciaDeSetas(-15, false), '\x1b[A'.repeat(15));
  assert.strictEqual(sequenciaDeSetas(3, false), '\x1b[B'.repeat(3));
  assert.strictEqual(sequenciaDeSetas(-4, true), '\x1bOA'.repeat(4));
  assert.strictEqual(sequenciaDeSetas(2, true), '\x1bOB'.repeat(2));
  assert.strictEqual(sequenciaDeSetas(0, true), '');
});

test('T7/6: relatórios de mouse: o original mais N-1 cópias', () => {
  assert.strictEqual(copiasExtras(-15), 14);
  assert.strictEqual(copiasExtras(3), 2);
  assert.strictEqual(copiasExtras(1), 0);
  assert.strictEqual(copiasExtras(0), 0);
});

test('T8/8: linhas viram pixels pela altura de linha do editor', () => {
  assert.strictEqual(pixelsDeLinhas(15, 19), 285);
  assert.strictEqual(pixelsDeLinhas(-3, 19), -57);
});

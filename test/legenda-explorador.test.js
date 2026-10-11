// Legenda do explorador (renderer/legenda-explorador.js): só usa classes que existem no CSS, cobre os estados pedidos pelo
// dono e o emblema da árvore continua igual.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../renderer/legenda-explorador');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const classesDe = i => [`k-${L.fileKind(i.nome, i.ehPasta)}`, i.ehPasta ? 'dir' : 'file', i.submodulo && 'submodule', i.codigo && `st-${i.codigo}`, i.linha, i.recortado && 'recortado'].filter(Boolean);

test('toda classe que a amostra usa existe no styles.css (a legenda não pode divergir da árvore)', () => {
  for (const i of L.itens()) {
    for (const c of classesDe(i)) {
      if (c === 'file') continue; // .file é só marcador de linha, sem regra própria
      assert.ok(new RegExp(`\\.${c}\\b`).test(css), `${i.id}: classe .${c} não existe no CSS`);
    }
  }
});

test('cobre o que o dono pediu: novo, modificado, pasta modificada, apagado, não salvo, submódulo, submódulo modificado, oculto, ignorado, recortado', () => {
  const ids = L.itens().map(i => i.id);
  for (const id of ['novo', 'modificado', 'pasta-modificada', 'apagado', 'nao-salvo', 'submodulo', 'submodulo-modificado', 'oculto', 'pasta-oculta', 'ignorado', 'recortado', 'aberto', 'selecionado']) {
    assert.ok(ids.includes(id), `falta ${id}`);
  }
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('nenhuma amostra repete a mesma combinação de classes e de ícone (json, yaml e engrenagem diferem pelo ícone)', () => {
  const vistos = new Map();
  for (const i of L.itens()) {
    const icone = ['json', 'yml'].includes(i.nome.split('.').pop()) ? i.nome.split('.').pop() : '';
    const chave = [...classesDe(i).sort(), icone].join(' ');
    assert.ok(!vistos.has(chave), `${i.id} repete ${vistos.get(chave)}`);
    vistos.set(chave, i.id);
  }
});

test('cada linha tem rótulo e texto, o texto nomeia a cor ou o ícone e nada tem travessão', () => {
  for (const i of L.itens()) {
    assert.ok(i.rotulo && i.texto && i.nome && i.grupo, i.id);
    assert.ok(!/[\u2013\u2014]/.test(i.texto + i.rotulo), `${i.id}: travessão`);
  }
  const oculto = L.itens().find(i => i.id === 'oculto').texto;
  assert.match(oculto, /\.env/);
  assert.match(oculto, /engrenagem/);
});

test('o fileKind da amostra é o da árvore: .env é configuração, ponto sem configuração é oculto', () => {
  assert.strictEqual(L.fileKind('.env', false), 'config');
  assert.strictEqual(L.fileKind('.npmrc', false), 'config');
  assert.strictEqual(L.fileKind('.DS_Store', false), 'hidden');
  assert.strictEqual(L.fileKind('.github', true), 'hidden-dir');
  assert.strictEqual(L.fileKind('README.md', false), 'llm');
  assert.strictEqual(L.fileKind('a.txt', false), 'file');
  assert.strictEqual(L.fileKind('src', true), 'dir');
});

test('emblema: vazio sem código e para I; ● para pasta e para E; a letra nos demais', () => {
  assert.strictEqual(L.emblema('', false), '');
  assert.strictEqual(L.emblema(undefined, true), '');
  assert.strictEqual(L.emblema('I', false), '');
  assert.strictEqual(L.emblema('I', true), '');
  assert.strictEqual(L.emblema('M', true), '●');
  assert.strictEqual(L.emblema('E', false), '●');
  assert.strictEqual(L.emblema('M', false), 'M');
  assert.strictEqual(L.emblema('U', false), 'U');
  assert.strictEqual(L.emblema('D', false), 'D');
  assert.strictEqual(L.emblema('A', false), 'A');
});

test('os dois cinzas continuam distintos no CSS: ignorado e oculto', () => {
  const cor = re => (css.match(re) || [])[1];
  const ignorado = cor(/\.dev-node\.st-I \.dev-node-name[^{]*\{\s*color:\s*(#[0-9a-f]+)/i);
  const oculto = cor(/\.dev-node\.k-hidden \.dev-node-name\s*\{\s*color:\s*(#[0-9a-f]+)/i);
  assert.ok(ignorado && oculto, `não achei as cores: ${ignorado} ${oculto}`);
  assert.notStrictEqual(ignorado.toLowerCase(), oculto.toLowerCase());
});

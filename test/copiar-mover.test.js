// dev:copy e dev:move: os handlers reais do registerDevCode; o teste afirma a árvore inteira do disco antes e depois.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');

test.after(limpar);

// árvore do disco como { 'rel/caminho': conteudo | null (pasta) }
function arvore(raiz) {
  const out = {};
  const anda = (dir, rel) => {
    for (const nome of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, nome), r = rel ? `${rel}/${nome}` : nome;
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out[r] = `->${path.basename(fs.readlinkSync(p))}`;
      else if (st.isDirectory()) { out[r] = null; anda(p, r); } else out[r] = fs.readFileSync(p, 'utf8');
    }
  };
  anda(raiz, '');
  return out;
}
const escreve = (raiz, mapa) => { for (const [rel, c] of Object.entries(mapa)) { const p = path.join(raiz, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); if (c === null) fs.mkdirSync(p, { recursive: true }); else fs.writeFileSync(p, c); } };
const linkDir = (alvo, link) => { try { fs.symlinkSync(alvo, link, 'junction'); return true; } catch { return false; } };
const ok = r => { assert.strictEqual(r.ok, true, JSON.stringify(r)); return r; };

test('copia arquivo e pasta com conteúdo: a origem fica e o destino ganha tudo', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'A', 'p/x.txt': 'X', 'p/q/y.txt': 'Y', 'dest': null });
  const t = montar(raiz);
  const r = ok(await t.call('dev:copy', { origens: [path.join(raiz, 'a.txt'), path.join(raiz, 'p')], destino: path.join(raiz, 'dest') }));
  assert.deepStrictEqual(r.itens.map(i => [i.ok, path.relative(raiz, i.destino).replace(/\\/g, '/')]), [[true, 'dest/a.txt'], [true, 'dest/p']]);
  assert.deepStrictEqual(arvore(raiz), {
    'a.txt': 'A', 'p': null, 'p/x.txt': 'X', 'p/q': null, 'p/q/y.txt': 'Y',
    'dest': null, 'dest/a.txt': 'A', 'dest/p': null, 'dest/p/x.txt': 'X', 'dest/p/q': null, 'dest/p/q/y.txt': 'Y',
  });
});

test('move arquivo e pasta: a origem some e o destino ganha tudo', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'A', 'p/x.txt': 'X', 'p/q/y.txt': 'Y', 'dest': null });
  const t = montar(raiz);
  ok(await t.call('dev:move', { origens: [path.join(raiz, 'a.txt'), path.join(raiz, 'p')], destino: path.join(raiz, 'dest') }));
  assert.deepStrictEqual(arvore(raiz), { 'dest': null, 'dest/a.txt': 'A', 'dest/p': null, 'dest/p/x.txt': 'X', 'dest/p/q': null, 'dest/p/q/y.txt': 'Y' });
});

test('recusa origem ou destino fora das pastas abertas e não grava nada', async () => {
  const raiz = pasta(), fora = pasta();
  escreve(raiz, { 'a.txt': 'A', 'dest': null });
  escreve(fora, { 'f.txt': 'F', 'dfora': null });
  const t = montar(raiz);
  const antesR = arvore(raiz), antesF = arvore(fora);
  for (const modo of ['dev:copy', 'dev:move']) {
    let r = await t.call(modo, { origens: [path.join(fora, 'f.txt')], destino: path.join(raiz, 'dest') });
    assert.strictEqual(r.itens[0].ok, false, modo);
    assert.match(r.itens[0].error, /fora das pastas abertas/);
    r = await t.call(modo, { origens: [path.join(raiz, 'a.txt')], destino: path.join(fora, 'dfora') });
    assert.strictEqual(r.ok, false, modo);
    assert.match(r.error, /fora das pastas abertas/);
    r = await t.call(modo, { origens: [path.join(raiz, '..', path.basename(fora), 'f.txt')], destino: path.join(raiz, 'dest') });
    assert.strictEqual(r.itens[0].ok, false);
  }
  assert.deepStrictEqual(arvore(raiz), antesR);
  assert.deepStrictEqual(arvore(fora), antesF);
});

test('pasta de destino que é junção para fora: recusada, nada é gravado lá', async (c) => {
  const raiz = pasta(), fora = pasta();
  escreve(raiz, { 'a.txt': 'A' });
  if (!linkDir(fora, path.join(raiz, 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  for (const modo of ['dev:copy', 'dev:move']) {
    const r = await t.call(modo, { origens: [path.join(raiz, 'a.txt')], destino: path.join(raiz, 'ponte') });
    assert.strictEqual(r.ok, false, modo);
  }
  assert.deepStrictEqual(fs.readdirSync(fora), []);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'a.txt'), 'utf8'), 'A');
});

test('mover um link que aponta para fora anda COMO LINK: o alvo de fora fica intacto', async (c) => {
  const raiz = pasta(), fora = pasta();
  escreve(fora, { 'x.txt': 'de fora' });
  escreve(raiz, { 'dest': null });
  if (!linkDir(fora, path.join(raiz, 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  ok(await t.call('dev:move', { origens: [path.join(raiz, 'ponte')], destino: path.join(raiz, 'dest') }));
  assert.ok(!fs.existsSync(path.join(raiz, 'ponte')));
  assert.ok(fs.lstatSync(path.join(raiz, 'dest', 'ponte')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(fora, 'x.txt'), 'utf8'), 'de fora');
});

test('copiar um link de topo que sai das pastas abertas é recusado (realDentro); o conteúdo de fora não entra', async (c) => {
  const raiz = pasta(), fora = pasta();
  escreve(fora, { 'segredo.txt': 'S' });
  escreve(raiz, { 'dest': null });
  if (!linkDir(fora, path.join(raiz, 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  const r = await t.call('dev:copy', { origens: [path.join(raiz, 'ponte')], destino: path.join(raiz, 'dest') });
  assert.strictEqual(r.itens[0].ok, false);
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest')), []);
});

test('copiar pasta com link para fora dentro: o destino contém o LINK, não o conteúdo de fora', async (c) => {
  const raiz = pasta(), fora = pasta();
  escreve(fora, { 'segredo.txt': 'S' });
  escreve(raiz, { 'p/ok.txt': 'ok', 'dest': null });
  if (!linkDir(fora, path.join(raiz, 'p', 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  ok(await t.call('dev:copy', { origens: [path.join(raiz, 'p')], destino: path.join(raiz, 'dest') }));
  assert.ok(fs.lstatSync(path.join(raiz, 'dest', 'p', 'ponte')).isSymbolicLink(), 'o link continua link');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'p', 'ok.txt'), 'utf8'), 'ok');
  assert.strictEqual(fs.readFileSync(path.join(fora, 'segredo.txt'), 'utf8'), 'S');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'p', 'ponte', 'segredo.txt'), 'utf8'), 'S', 'o link ainda aponta para o mesmo alvo');
  fs.rmSync(path.join(raiz, 'dest', 'p', 'ponte')); // desfaz só o link: o alvo de fora não pode sumir
  assert.strictEqual(fs.readFileSync(path.join(fora, 'segredo.txt'), 'utf8'), 'S');
});

test('pasta para dentro dela mesma e mover para a própria pasta são recusados, com a origem intacta', async () => {
  const raiz = pasta();
  escreve(raiz, { 'p/x.txt': 'X', 'p/sub': null, 'a.txt': 'A' });
  const t = montar(raiz);
  const antes = arvore(raiz);
  for (const [modo, dest] of [['dev:move', 'p'], ['dev:move', 'p/sub'], ['dev:copy', 'p'], ['dev:copy', 'p/sub']]) {
    const r = await t.call(modo, { origens: [path.join(raiz, 'p')], destino: path.join(raiz, ...dest.split('/')) });
    assert.strictEqual(r.itens[0].ok, false, `${modo} ${dest}`);
    assert.match(r.itens[0].error, /dentro dela mesma/);
  }
  const r = await t.call('dev:move', { origens: [path.join(raiz, 'a.txt')], destino: raiz });
  assert.match(r.itens[0].error, /já está nesta pasta/);
  assert.deepStrictEqual(arvore(raiz), antes);
});

test('a raiz de uma pasta aberta e o que a contém não podem ser movidos (raízes aninhadas)', async () => {
  const base = pasta();
  escreve(base, { 'sub/f.txt': 'f', 'x/y/z.txt': 'z', 'dest': null });
  const sub = path.join(base, 'sub'), y = path.join(base, 'x', 'y');
  const t = montar([base, sub, y]);
  const antes = arvore(base);
  for (const alvo of [sub, path.join(base, 'x'), y]) {
    const r = await t.call('dev:move', { origens: [alvo], destino: path.join(base, 'dest') });
    assert.strictEqual(r.itens[0].ok, false, alvo);
    assert.match(r.itens[0].error, /pasta aberta como projeto/);
  }
  assert.deepStrictEqual(arvore(base), antes);
});

test('conflito sem decisão: nada é gravado e o item volta como conflito', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'NOVO', 'dest/a.txt': 'VELHO', 'dest/b.txt': 'B', 'b.txt': 'B2' });
  const t = montar(raiz);
  const r = ok(await t.call('dev:copy', { origens: [path.join(raiz, 'a.txt'), path.join(raiz, 'b.txt')], destino: path.join(raiz, 'dest') }));
  assert.strictEqual(r.itens[0].conflito, true);
  assert.strictEqual(r.itens[0].existente, path.join(raiz, 'dest', 'a.txt'));
  assert.strictEqual(r.itens[1].conflito, true);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'VELHO');
});

test('decisões: substituir troca e manter-ambos cria "nome (2)"', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'NOVO-A', 'b.txt': 'NOVO-B', 'c.txt': 'NOVO-C', 'dest/a.txt': 'VELHO-A', 'dest/b.txt': 'VELHO-B', 'dest/c.txt': 'VELHO-C' });
  const t = montar(raiz);
  const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map(n => path.join(raiz, n));
  // c.txt fica sem decisão: continua como conflito e nada é gravado para ele
  const r = ok(await t.call('dev:copy', { origens: [a, b, c], destino: path.join(raiz, 'dest'), decisoes: { [a]: 'substituir', [b]: 'manter-ambos' } }));
  assert.strictEqual(r.itens[2].conflito, true);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'NOVO-A');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'b.txt'), 'utf8'), 'VELHO-B');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'b (2).txt'), 'utf8'), 'NOVO-B');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'c.txt'), 'utf8'), 'VELHO-C');
  assert.ok(!fs.existsSync(path.join(raiz, 'dest', 'c (2).txt')));
  assert.deepStrictEqual(Object.keys(arvore(raiz)).filter(k => k.startsWith('dest/')).sort(), ['dest/a.txt', 'dest/b (2).txt', 'dest/b.txt', 'dest/c.txt']);
});

test('substituir pasta TROCA a pasta inteira: o que só existia no destino some (nunca mescla)', async () => {
  const raiz = pasta();
  escreve(raiz, { 'p/novo.txt': 'N', 'dest/p/velho.txt': 'V', 'dest/p/comum.txt': 'VELHO', 'p/comum.txt': 'NOVO' });
  const t = montar(raiz);
  const p = path.join(raiz, 'p');
  ok(await t.call('dev:copy', { origens: [p], destino: path.join(raiz, 'dest'), decisoes: { [p]: 'substituir' } }));
  assert.deepStrictEqual(Object.keys(arvore(raiz)).filter(k => k.startsWith('dest/')).sort(), ['dest/p', 'dest/p/comum.txt', 'dest/p/novo.txt']);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'p', 'comum.txt'), 'utf8'), 'NOVO');
  // e mover com substituir: a origem sai e o destino é a pasta da origem, sem mescla
  escreve(raiz, { 'm/so-na-origem.txt': 'O', 'dest2/m/so-no-destino.txt': 'D' });
  const m = path.join(raiz, 'm');
  ok(await t.call('dev:move', { origens: [m], destino: path.join(raiz, 'dest2'), decisoes: { [m]: 'substituir' } }));
  assert.ok(!fs.existsSync(m));
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest2', 'm')), ['so-na-origem.txt']);
});

test('substituir nunca destrói a origem: copiar a/x para a, e mover a/x/x para a', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a/x': 'ARQUIVO-X' });
  const t = montar(raiz);
  const a = path.join(raiz, 'a'), x = path.join(a, 'x');
  // copiar o arquivo para a própria pasta: o destino é a origem
  let r = await t.call('dev:copy', { origens: [x], destino: a, decisoes: { [x]: 'substituir' } });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /Não dá para substituir/);
  assert.strictEqual(fs.readFileSync(x, 'utf8'), 'ARQUIVO-X');
  // "manter os dois" é o caminho seguro
  r = ok(await t.call('dev:copy', { origens: [x], destino: a, decisoes: { [x]: 'manter-ambos' } }));
  assert.strictEqual(fs.readFileSync(path.join(a, 'x (2)'), 'utf8'), 'ARQUIVO-X');
  // mover a/y/y para a, com a/y já existindo: o destino (a/y) é ancestral da origem (a/y/y)
  fs.rmSync(a, { recursive: true, force: true });
  escreve(raiz, { 'a/y/y': 'FOLHA', 'a/y/outro.txt': 'O' });
  const y = path.join(a, 'y'), yy = path.join(y, 'y');
  r = await t.call('dev:move', { origens: [yy], destino: a, decisoes: { [yy]: 'substituir' } });
  assert.strictEqual(r.itens[0].ok, false);
  assert.strictEqual(fs.readFileSync(yy, 'utf8'), 'FOLHA');
  assert.strictEqual(fs.readFileSync(path.join(y, 'outro.txt'), 'utf8'), 'O');
});

test('falha no meio de um substituir deixa o destino antigo intacto e sem lixo temporário', async () => {
  const raiz = pasta();
  escreve(raiz, { 'p/a.txt': 'A', 'p/b.txt': 'B', 'dest/p/velho.txt': 'VELHO' });
  const p = path.join(raiz, 'p');
  let chamadas = 0;
  const copyQueFalha = async (...args) => { if (++chamadas === 2) throw new Error('disco cheio injetado'); return fs.promises.copyFile(...args); };
  const t = montar(raiz, { deps: { fsx: { copyFile: copyQueFalha } } });
  const r = await t.call('dev:copy', { origens: [p], destino: path.join(raiz, 'dest'), decisoes: { [p]: 'substituir' } });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /disco cheio/);
  assert.deepStrictEqual(Object.keys(arvore(raiz)).filter(k => k.startsWith('dest')).sort(), ['dest', 'dest/p', 'dest/p/velho.txt']);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'p', 'velho.txt'), 'utf8'), 'VELHO');
});

test('conflito que surgiu depois da pergunta vira erro "já existe", nunca sobrescrita', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'NOVO', 'dest': null });
  const a = path.join(raiz, 'a.txt');
  // o item "a.txt" não existia no destino na hora de planejar; aparece antes da cópia (injetado no copyFile)
  const copyQueCorre = async (src, dst, modo) => { fs.writeFileSync(dst, 'APARECEU-POR-FORA'); return fs.promises.copyFile(src, dst, modo); };
  const t = montar(raiz, { deps: { fsx: { copyFile: copyQueCorre } } });
  const r = await t.call('dev:copy', { origens: [a], destino: path.join(raiz, 'dest') });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /EEXIST|already exists|já existe/i);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'APARECEU-POR-FORA');
  // e uma decisão para OUTRO item nunca autoriza sobrescrever este
  fs.rmSync(path.join(raiz, 'dest', 'a.txt'));
  const t2 = montar(raiz);
  fs.writeFileSync(path.join(raiz, 'dest', 'a.txt'), 'VELHO');
  const r2 = await t2.call('dev:copy', { origens: [a], destino: path.join(raiz, 'dest'), decisoes: { [path.join(raiz, 'outra.txt')]: 'substituir' } });
  assert.strictEqual(r2.itens[0].conflito, true);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'VELHO');
});

test('EXDEV: mover copia e só depois apaga a origem; se a cópia falha no meio, a origem permanece', async () => {
  const raiz = pasta();
  escreve(raiz, { 'p/a.txt': 'A', 'p/q/b.txt': 'B', 'dest': null });
  const p = path.join(raiz, 'p');
  const exdev = async () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
  let t = montar(raiz, { deps: { fsx: { rename: exdev } } });
  ok(await t.call('dev:move', { origens: [p], destino: path.join(raiz, 'dest') }));
  assert.ok(!fs.existsSync(p));
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'p', 'q', 'b.txt'), 'utf8'), 'B');
  // falha na cópia: a origem fica e o destino parcial é limpo
  escreve(raiz, { 'r/a.txt': 'A', 'dest3': null });
  const r = path.join(raiz, 'r');
  t = montar(raiz, { deps: { fsx: { rename: exdev, copyFile: async () => { throw new Error('queda no meio'); } } } });
  const res = await t.call('dev:move', { origens: [r], destino: path.join(raiz, 'dest3') });
  assert.strictEqual(res.itens[0].ok, false);
  assert.match(res.itens[0].error, /queda no meio/);
  assert.strictEqual(fs.readFileSync(path.join(r, 'a.txt'), 'utf8'), 'A');
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest3')), []);
});

test('um item com erro não impede os outros (relatório por item)', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'A', 'b.txt': 'B', 'dest': null });
  const t = montar(raiz);
  const r = ok(await t.call('dev:copy', { origens: [path.join(raiz, 'a.txt'), path.join(raiz, 'nao-existe.txt'), path.join(raiz, 'b.txt')], destino: path.join(raiz, 'dest') }));
  assert.deepStrictEqual(r.itens.map(i => !!i.ok), [true, false, true]);
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, 'dest')).sort(), ['a.txt', 'b.txt']);
});

test('entradas inválidas: lista vazia, decisão desconhecida e destino que não é pasta', async () => {
  const raiz = pasta();
  escreve(raiz, { 'a.txt': 'A', 'dest/a.txt': 'V' });
  const t = montar(raiz);
  assert.strictEqual((await t.call('dev:copy', { origens: [], destino: raiz })).ok, false);
  assert.strictEqual((await t.call('dev:copy', undefined)).ok, false);
  assert.strictEqual((await t.call('dev:copy', { origens: [path.join(raiz, 'a.txt')], destino: path.join(raiz, 'a.txt') })).ok, false);
  const a = path.join(raiz, 'a.txt');
  const r = await t.call('dev:copy', { origens: [a], destino: path.join(raiz, 'dest'), decisoes: { [a]: 'apagar-tudo' } });
  assert.strictEqual(r.itens[0].ok, false);
  assert.match(r.itens[0].error, /Decisão inválida/);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dest', 'a.txt'), 'utf8'), 'V');
});

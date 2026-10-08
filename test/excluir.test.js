// dev:delete: o handler real do registerDevCode, com a Lixeira trocada por uma função que MOVE o item para uma pasta de
// teste (assim o teste afirma o disco: o item sumiu do lugar e está na "lixeira", em vez de "o callback foi chamado").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');

test.after(limpar);

function comLixeira(raizes, { falha } = {}) {
  const lixo = pasta();
  const chamadas = [];
  const trashItem = async p => {
    chamadas.push(p);
    if (falha) throw new Error(falha);
    await fs.promises.rename(p, path.join(lixo, `${chamadas.length}-${path.basename(p)}`));
  };
  return { t: montar(raizes, { deps: { trashItem } }), lixo, chamadas };
}
const linkDir = (alvo, link) => { try { fs.symlinkSync(alvo, link, 'junction'); return true; } catch { return false; } };

test('arquivo da pasta aberta vai para a lixeira e some do lugar', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'conteudo');
  const { t, lixo } = comLixeira(raiz);
  assert.deepStrictEqual(await t.call('dev:delete', path.join(raiz, 'a.txt')), { ok: true });
  assert.ok(!fs.existsSync(path.join(raiz, 'a.txt')));
  assert.strictEqual(fs.readFileSync(path.join(lixo, '1-a.txt'), 'utf8'), 'conteudo');
});

test('pasta com conteúdo é um item só: vai inteira para a lixeira', async () => {
  const raiz = pasta();
  fs.mkdirSync(path.join(raiz, 'p', 'q'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'p', 'x.txt'), 'x');
  fs.writeFileSync(path.join(raiz, 'p', 'q', 'y.txt'), 'y');
  const { t, lixo, chamadas } = comLixeira(raiz);
  assert.strictEqual((await t.call('dev:delete', path.join(raiz, 'p'))).ok, true);
  assert.strictEqual(chamadas.length, 1);
  assert.ok(!fs.existsSync(path.join(raiz, 'p')));
  assert.strictEqual(fs.readFileSync(path.join(lixo, '1-p', 'q', 'y.txt'), 'utf8'), 'y');
});

test('recusa item fora das pastas abertas, com .. e sem chamar a lixeira', async () => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'segredo.txt'), 's');
  const { t, chamadas } = comLixeira(raiz);
  for (const alvo of [path.join(fora, 'segredo.txt'), path.join(raiz, '..', path.basename(fora), 'segredo.txt'), fora]) {
    const r = await t.call('dev:delete', alvo);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /fora das pastas abertas/);
  }
  assert.strictEqual(chamadas.length, 0);
  assert.strictEqual(fs.readFileSync(path.join(fora, 'segredo.txt'), 'utf8'), 's');
});

test('pasta pai que é junção para fora: recusado, o arquivo de fora fica intacto', async (c) => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'x.txt'), 'de fora');
  if (!linkDir(fora, path.join(raiz, 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const { t, chamadas } = comLixeira(raiz);
  const r = await t.call('dev:delete', path.join(raiz, 'ponte', 'x.txt'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(chamadas.length, 0);
  assert.strictEqual(fs.readFileSync(path.join(fora, 'x.txt'), 'utf8'), 'de fora');
});

test('link que aponta para fora é excluído COMO LINK: o alvo continua intacto no disco', async (c) => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'x.txt'), 'de fora');
  if (!linkDir(fora, path.join(raiz, 'ponte'))) { c.skip('sem permissão para criar link'); return; }
  const { t, chamadas } = comLixeira(raiz);
  const r = await t.call('dev:delete', path.join(raiz, 'ponte'));
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(chamadas[0], path.join(raiz, 'ponte'));
  assert.ok(!fs.existsSync(path.join(raiz, 'ponte')), 'o link saiu do projeto');
  assert.strictEqual(fs.readFileSync(path.join(fora, 'x.txt'), 'utf8'), 'de fora', 'o alvo do link não foi tocado');
});

test('link quebrado também sai (não lança ENOENT)', async (c) => {
  const raiz = pasta(), alvo = pasta();
  if (!linkDir(alvo, path.join(raiz, 'quebrado'))) { c.skip('sem permissão para criar link'); return; }
  fs.rmSync(alvo, { recursive: true, force: true });
  const { t } = comLixeira(raiz);
  assert.deepStrictEqual(await t.call('dev:delete', path.join(raiz, 'quebrado')), { ok: true });
  assert.throws(() => fs.lstatSync(path.join(raiz, 'quebrado')));
});

test('a raiz de uma pasta aberta e o que a contém nunca são excluídos; raízes aninhadas', async () => {
  const base = pasta();
  fs.mkdirSync(path.join(base, 'sub', 'dentro'), { recursive: true });
  fs.mkdirSync(path.join(base, 'x', 'y'), { recursive: true });
  fs.writeFileSync(path.join(base, 'sub', 'dentro', 'f.txt'), 'f');
  const sub = path.join(base, 'sub'), y = path.join(base, 'x', 'y');
  const { t, chamadas } = comLixeira([base, sub, y]);
  for (const alvo of [base, sub, path.join(base, 'x'), y]) {
    const r = await t.call('dev:delete', alvo);
    assert.strictEqual(r.ok, false, alvo);
    assert.match(r.error, /pasta aberta como projeto/);
  }
  assert.strictEqual(chamadas.length, 0);
  assert.ok(fs.existsSync(path.join(sub, 'dentro', 'f.txt')) && fs.existsSync(y));
  // dentro de uma raiz aninhada continua valendo
  assert.strictEqual((await t.call('dev:delete', path.join(sub, 'dentro'))).ok, true);
});

test('item que não existe mais e Lixeira que falha: erro legível, nada muda', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'a');
  let r = await comLixeira(raiz).t.call('dev:delete', path.join(raiz, 'nada.txt'));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /não existe mais/);
  const { t, chamadas } = comLixeira(raiz, { falha: 'Failed to perform delete operation' });
  r = await t.call('dev:delete', path.join(raiz, 'a.txt'));
  assert.deepStrictEqual(r, { ok: false, error: 'Não foi possível mover para a Lixeira: Failed to perform delete operation' });
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'a.txt'), 'utf8'), 'a', 'o arquivo continua lá: nunca apaga de vez');
});

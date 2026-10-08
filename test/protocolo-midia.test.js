// Protocolo de mídia: cada pedido passa pelo manipulador real do registerDevCode (guard + realDentro), e o teste afirma
// os bytes, os cabeçalhos e a recusa, não que uma função foi chamada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');
const { registrarProtocoloMidia, lerFaixa } = require('../src/protocolo-midia');
const { urlMidia } = require('../renderer/tipo-arquivo');

test.after(limpar);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pedir = (t, caminho, { method = 'GET', range } = {}) =>
  t.devcode.manipuladorMidia(new Request(urlMidia(caminho), { method, headers: range ? { range } : {} }));
const pedirUrl = (t, url) => t.devcode.manipuladorMidia(new Request(url));

test('serve os bytes do arquivo da pasta aberta, com o tipo certo e nosniff', async () => {
  const raiz = pasta();
  const grande = Buffer.concat([PNG, Buffer.alloc(5000, 7)]);
  fs.writeFileSync(path.join(raiz, 'a.png'), grande);
  const t = montar(raiz);
  const r = await pedir(t, path.join(raiz, 'a.png'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('accept-ranges'), 'bytes');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(grande));
});

test('Range: devolve só a faixa pedida (206) e recusa a faixa fora do arquivo (416)', async () => {
  const raiz = pasta();
  const dados = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  fs.writeFileSync(path.join(raiz, 'v.mp4'), dados);
  const t = montar(raiz);
  const f = path.join(raiz, 'v.mp4');
  let r = await pedir(t, f, { range: 'bytes=100-199' });
  assert.strictEqual(r.status, 206);
  assert.strictEqual(r.headers.get('content-range'), 'bytes 100-199/1000');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(dados.subarray(100, 200)));
  r = await pedir(t, f, { range: 'bytes=900-' });
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(dados.subarray(900)));
  r = await pedir(t, f, { range: 'bytes=-10' });
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(dados.subarray(990)));
  r = await pedir(t, f, { range: 'bytes=0-' });
  assert.strictEqual(r.status, 206);
  assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 1000);
  r = await pedir(t, f, { range: 'bytes=5000-6000' });
  assert.strictEqual(r.status, 416);
  assert.strictEqual(r.headers.get('content-range'), 'bytes */1000');
  r = await pedir(t, f, { range: 'bytes=abc' });
  assert.strictEqual(r.status, 416);
});

test('lerFaixa trata faixa aberta, final além do arquivo e valores inválidos', () => {
  assert.deepStrictEqual(lerFaixa('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepStrictEqual(lerFaixa('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(lerFaixa('bytes=-30', 100), { start: 70, end: 99 });
  assert.deepStrictEqual(lerFaixa('bytes=-500', 100), { start: 0, end: 99 });
  for (const ruim of ['bytes=', 'bytes=-', 'bytes=-0', 'bytes=50-10', 'bytes=100-', 'items=0-1', 'bytes=0-1,5-6']) assert.strictEqual(lerFaixa(ruim, 100), null, ruim);
});

test('HEAD devolve os cabeçalhos sem corpo', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.mp3'), Buffer.alloc(321, 1));
  const t = montar(raiz);
  const r = await pedir(t, path.join(raiz, 'a.mp3'), { method: 'HEAD' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-length'), '321');
  assert.strictEqual((await r.arrayBuffer()).byteLength, 0);
  assert.strictEqual((await pedir(t, path.join(raiz, 'a.mp3'), { method: 'POST' })).status, 405);
});

test('recusa arquivo fora das pastas abertas, mesmo existindo', async () => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'segredo.png'), PNG);
  const t = montar(raiz);
  assert.strictEqual((await pedir(t, path.join(fora, 'segredo.png'))).status, 403);
  // por dentro da raiz com ..
  assert.strictEqual((await pedir(t, path.join(raiz, '..', path.basename(fora), 'segredo.png'))).status, 403);
});

test('endereços malformados são recusados: relativo, %2e%2e, %5c solto, vazio, outro host, dupla codificação', async () => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(raiz, 'a.png'), PNG);
  fs.writeFileSync(path.join(fora, 'x.png'), PNG);
  const t = montar(raiz);
  const status = async url => (await pedirUrl(t, url)).status;
  assert.strictEqual(await status('rendra-midia://arquivo/'), 400);
  assert.strictEqual(await status('rendra-midia://arquivo/a.png'), 400); // relativo
  assert.strictEqual(await status('rendra-midia://arquivo/%2e%2e'), 400);
  assert.strictEqual(await status('rendra-midia://arquivo/%2e%2e/%2e%2e/x.png'), 400);
  assert.strictEqual(await status('rendra-midia://arquivo/..%5c..%5cx.png'), 400);
  assert.strictEqual(await status('rendra-midia://arquivo/%E0%A4%A'), 400); // %-sequência inválida
  assert.strictEqual(await status('rendra-midia://outro/a.png'), 404);
  // decodifica uma vez só: %255c continua sendo "%5c" literal, nome que não existe
  assert.notStrictEqual(await status(`rendra-midia://arquivo/${encodeURIComponent(path.join(raiz, 'a.png')).replace(/%5C/g, '%255C')}`), 200);
  // o endereço certo funciona
  assert.strictEqual(await status(urlMidia(path.join(raiz, 'a.png'))), 200);
  // prefixo da raiz com caminho diferente: <raiz>-irmao não é <raiz>
  const irmao = `${raiz}-irmao`;
  fs.mkdirSync(irmao);
  fs.writeFileSync(path.join(irmao, 'x.png'), PNG);
  assert.strictEqual((await pedir(t, path.join(irmao, 'x.png'))).status, 403);
  fs.rmSync(irmao, { recursive: true, force: true });
});

test('a caixa do caminho segue a regra do sistema (igual no Windows e no macOS, diferente no Linux)', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.png'), PNG);
  const t = montar(raiz);
  const trocado = path.join(raiz.toUpperCase(), 'A.PNG');
  const r = await pedir(t, trocado);
  if (process.platform === 'linux') assert.notStrictEqual(r.status, 200);
  else assert.strictEqual(r.status, 200);
});

test('só serve mídia e PDF: HTML, SVG, texto e mkv são recusados mesmo dentro da pasta', async () => {
  const raiz = pasta();
  for (const n of ['a.html', 'a.htm', 'a.svg', 'a.txt', 'a.js', 'a.mkv', 'semextensao']) fs.writeFileSync(path.join(raiz, n), 'x');
  fs.writeFileSync(path.join(raiz, 'ok.pdf'), '%PDF-1.4');
  const t = montar(raiz);
  for (const n of ['a.html', 'a.htm', 'a.svg', 'a.txt', 'a.js', 'a.mkv', 'semextensao']) assert.strictEqual((await pedir(t, path.join(raiz, n))).status, 403, n);
  const pdf = await pedir(t, path.join(raiz, 'ok.pdf'));
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
});

test('arquivo que não existe e pasta com nome de mídia dão 404', async () => {
  const raiz = pasta();
  fs.mkdirSync(path.join(raiz, 'pasta.png'));
  const t = montar(raiz);
  assert.strictEqual((await pedir(t, path.join(raiz, 'nada.png'))).status, 404);
  assert.strictEqual((await pedir(t, path.join(raiz, 'pasta.png'))).status, 404);
});

test('junção que sai das pastas abertas é recusada (o caminho real é conferido)', async (c) => {
  const raiz = pasta(), fora = pasta();
  fs.writeFileSync(path.join(fora, 'x.png'), PNG);
  try { fs.symlinkSync(fora, path.join(raiz, 'ponte'), 'junction'); } catch { c.skip('sem permissão para criar link'); return; }
  const t = montar(raiz);
  assert.strictEqual((await pedir(t, path.join(raiz, 'ponte', 'x.png'))).status, 403);
});

test('registrarProtocoloMidia usa só a sessão padrão e nunca uma partição (o Rendra Browser fica sem o protocolo)', () => {
  const chamadas = [];
  const sessao = { protocol: { handle: (esquema, fn) => chamadas.push(['padrao', esquema, fn]) } };
  const electron = { session: { defaultSession: sessao, fromPartition: () => { throw new Error('nunca uma partição'); } } };
  const fn = () => {};
  registrarProtocoloMidia(electron, fn);
  assert.deepStrictEqual(chamadas, [['padrao', 'rendra-midia', fn]]);
});

test('a CSP libera o esquema só para imagem, mídia e quadro, e continua sem rede nem blob', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1].replace(/\s+/g, ' ');
  assert.match(csp, /img-src 'self' data: rendra-midia:;/);
  assert.match(csp, /media-src rendra-midia:;/);
  assert.match(csp, /frame-src rendra-midia:;/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /frame-src[^;]*(blob:|https?:)/);
  assert.doesNotMatch(csp, /object-src/);
});

test('dev:read marca o erro de binário, para o explorador dizer que o tipo não abre', async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.bin'), Buffer.from([1, 2, 0, 3]));
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'oi');
  const t = montar(raiz);
  const r = await t.call('dev:read', path.join(raiz, 'a.bin'));
  assert.strictEqual(r.binario, true);
  assert.match(r.error, /binário/);
  assert.deepStrictEqual(await t.call('dev:read', path.join(raiz, 'a.txt')), { content: 'oi' });
});

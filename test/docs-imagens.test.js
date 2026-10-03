// Regra 9 do guarda-chuva: cada imagem de vitrine (site e README) no formato mais leve sem perda visível
// (.webp, .png ou .jpg), com width/height e lazy; a og-image fica PNG ou JPG (robôs sociais não leem WebP direito).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('docs/images só tem webp, png ou jpg e todas as referências existem', () => {
  assert.deepStrictEqual(fs.readdirSync(path.join(DOCS, 'images')).filter(f => !/\.(webp|png|jpg)$/.test(f)), []);
  const refs = [
    ...html.matchAll(/images\/([a-z0-9-]+\.(?:webp|png|jpg))/g),
    ...readme.matchAll(/docs\/images\/([a-z0-9-]+\.(?:webp|png|jpg))/g),
    // lista IMAGES do site: ['id', 'Título', 'texto', 'ext']
    ...[...html.matchAll(/\['([a-z0-9-]+)', '[^\n]*?', '(webp|png|jpg)'\],/g)].map(m => [null, `${m[1]}.${m[2]}`]),
  ];
  assert.ok(refs.length >= 16);
  for (const m of refs) assert.ok(fs.existsSync(path.join(DOCS, 'images', m[1])), m[1]);
});

test('o site e o README apontam para a mesma extensão de cada imagem', () => {
  const lista = Object.fromEntries([...html.matchAll(/\['([a-z0-9-]+)', '[^\n]*?', '(webp|png|jpg)'\],/g)].map(m => [m[1], m[2]]));
  assert.ok(Object.keys(lista).length >= 7);
  for (const m of readme.matchAll(/docs\/images\/([a-z0-9-]+)\.(webp|png|jpg)/g)) assert.strictEqual(m[2], lista[m[1]], m[0]);
  const hero = html.match(/hero-shot" src="images\/([a-z0-9-]+)\.(webp|png|jpg)"/);
  assert.strictEqual(hero[2], lista[hero[1]]);
});

test('imagens do HTML têm width e height; só a primeira dobra não é lazy', () => {
  const imgs = [...html.matchAll(/<img [^>]*src="images\/[^>]*>/g)].map(m => m[0]);
  assert.ok(imgs.length >= 3);
  for (const t of imgs) {
    assert.match(t, /width="\d+"/, t);
    assert.match(t, /height="\d+"/, t);
    if (!t.includes('hero-shot')) assert.match(t, /loading="lazy"/, t);
  }
  // a galeria é montada por script: o template também leva width, height e lazy
  const tpl = html.match(/<img src="images\/\$\{id\}\.\$\{ext\}"[^>]*>/);
  assert.ok(tpl, 'template da galeria sem a extensão por imagem');
  assert.match(tpl[0], /loading="lazy"/);
  assert.match(tpl[0], /width="\d+"/);
  assert.match(tpl[0], /height="\d+"/);
});

test('og-image é PNG ou JPG, nunca WebP, e o arquivo existe', () => {
  const refs = [...html.matchAll(/og-image\.([a-z]+)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2);
  for (const ext of refs) assert.match(ext, /^(png|jpg)$/);
  assert.ok(fs.existsSync(path.join(DOCS, `og-image.${refs[0]}`)));
  assert.strictEqual(new Set(refs).size, 1, 'og:image e JSON-LD apontam extensões diferentes');
});

test('o gerador escolhe o candidato aceitável mais leve e nunca perde texto', async () => {
  const sharp = require('sharp');
  const { imagemMaisLeve } = require('../scripts/imagem-mais-leve');
  // tela sintética: fundo liso com linhas finas de "texto" (barras de 1px) e uma faixa com degradê
  const w = 400, h = 200;
  const buf = Buffer.alloc(w * h * 3, 20);
  for (let y = 10; y < 100; y += 6) for (let x = 10; x < 300; x++) { const o = (y * w + x) * 3; buf[o] = 240; buf[o + 1] = 101; buf[o + 2] = 10; }
  for (let y = 120; y < 200; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 3; buf[o] = x % 256; buf[o + 1] = (x * 3) % 256; buf[o + 2] = y; }
  const png = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const r = await imagemMaisLeve(png);
  const menor = Math.min(...r.tried.filter(t => !Number.isFinite(t.psnr) || t.psnr >= 45).map(t => t.bytes));
  assert.strictEqual(r.buffer.length, menor);
  assert.ok(['webp', 'png'].includes(r.ext));
  const social = await imagemMaisLeve(png, 'social');
  assert.ok(['png', 'jpg'].includes(social.ext));
});

const test = require('node:test');
const assert = require('node:assert');
const M = require('../renderer/markdown-vista');

test('título, parágrafo, negrito, itálico e código inline', () => {
  assert.strictEqual(M.render('# Título'), '<h1>Título</h1>');
  assert.strictEqual(M.render('###### Seis'), '<h6>Seis</h6>');
  assert.strictEqual(M.render('um **forte** e *leve* e `cod`'), '<p>um <b>forte</b> e <i>leve</i> e <code>cod</code></p>');
  assert.strictEqual(M.render('linha um\nlinha dois\n\noutro'), '<p>linha um linha dois</p><p>outro</p>');
  assert.strictEqual(M.render(''), '');
  assert.strictEqual(M.render(null), '');
});

test('listas com marcador, numeradas e aninhadas', () => {
  assert.strictEqual(M.render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(M.render('1. um\n2. dois'), '<ol><li>um</li><li>dois</li></ol>');
  assert.strictEqual(M.render('- a\n  - b\n  - c\n- d'), '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>');
});

test('bloco de código com cerca escapa o conteúdo e não interpreta Markdown dentro', () => {
  const h = M.render('```js\nconst a = "<b>x</b>"; // **não**\n```');
  assert.strictEqual(h, '<pre><code class="lang-js">const a = &quot;&lt;b&gt;x&lt;/b&gt;&quot;; // **não**</code></pre>');
});

test('citação, linha horizontal e tabela GFM', () => {
  assert.strictEqual(M.render('> dica\n> mais'), '<blockquote><p>dica mais</p></blockquote>');
  assert.strictEqual(M.render('---'), '<hr>');
  const t = M.render('| a | b |\n|---|:-:|\n| 1 | **2** |');
  assert.strictEqual(t, '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><b>2</b></td></tr></tbody></table>');
});

test('HTML cru e vetores de script saem como texto escapado', () => {
  const vetores = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)" onclick="x()">oi</a>',
    '<iframe src="data:text/html,<script>1</script>"></iframe>',
    '<div onmouseover="x()">z</div>',
    '"><svg onload=alert(1)>',
  ];
  for (const v of vetores) {
    const h = M.render(v);
    assert.doesNotMatch(h, /<script|<img|<iframe|<svg|<div|<a href="javascript/i, v);
    assert.match(h, /&lt;/);
  }
});

test('links: só http(s) e mailto viram link (data-url); javascript:, data:, relativo e vbscript são texto inerte', () => {
  assert.strictEqual(M.render('[site](https://exemplo.com/a?b=1&c=2)'), '<p><a href="#" data-url="https://exemplo.com/a?b=1&amp;c=2">site</a></p>');
  assert.match(M.render('[m](mailto:a@b.com)'), /data-url="mailto:a@b.com"/);
  for (const alvo of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', './outro.md', '../x', 'arquivo.txt', 'file:///C:/x']) {
    const h = M.render(`[clique](${alvo})`);
    assert.doesNotMatch(h, /<a\b|href=|data-url/, alvo);
    assert.match(h, /<span class="md-link-inerte">clique<\/span>/, alvo);
  }
  // aspas no endereço não fecham o atributo
  const h = M.render('[x](https://e.com/"onmouseover="alert(1))');
  assert.doesNotMatch(h, /"onmouseover="/);
});

test('imagem local só entra pelo urlLocal; http(s), javascript: e data: viram texto alternativo', () => {
  const ctx = { urlLocal: alvo => (alvo === 'foto.png' ? 'rendra-midia://arquivo/x' : null) };
  assert.strictEqual(M.render('![minha foto](foto.png)', ctx), '<p><img class="md-img" src="rendra-midia://arquivo/x" alt="minha foto" loading="lazy"></p>');
  assert.strictEqual(M.render('![fora](../nao.png)', ctx), '<p><span class="md-img-alt">fora</span></p>');
  assert.match(M.render('![web](https://e.com/a.png)', ctx), /<span class="md-img-alt">web \(<a href="#" data-url="https:\/\/e.com\/a.png">https:\/\/e.com\/a.png<\/a>\)<\/span>/);
  for (const alvo of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/x.png']) {
    const h = M.render(`![x](${alvo})`, { urlLocal: () => null });
    assert.doesNotMatch(h, /<img/, alvo);
  }
  assert.doesNotMatch(M.render('![x](foto.png)'), /<img/); // sem ctx.urlLocal nada local carrega
  // o texto alternativo com aspas e tags não fecha o atributo
  assert.doesNotMatch(M.render('![a" onerror="x](foto.png)', ctx), /onerror="x/);
});

test('caminhoLocal resolve relativo ao .md, normaliza .. e recusa esquemas', () => {
  assert.strictEqual(M.caminhoLocal('C:\\p\\docs', 'img/a.png'), 'C:\\p\\docs\\img\\a.png');
  assert.strictEqual(M.caminhoLocal('C:\\p\\docs', '../a.png'), 'C:\\p\\a.png');
  assert.strictEqual(M.caminhoLocal('/home/u/docs', './img/a%20b.png'), '/home/u/docs/img/a b.png');
  assert.strictEqual(M.caminhoLocal('/home/u/docs', '/abs/a.png'), '/abs/a.png');
  assert.strictEqual(M.caminhoLocal('C:\\p', 'D:\\x\\a.png'), 'D:\\x\\a.png');
  assert.strictEqual(M.caminhoLocal('\\\\wsl.localhost\\Ubuntu\\home', 'a.png'), '\\\\wsl.localhost\\Ubuntu\\home\\a.png');
  for (const ruim of ['http://x/a.png', 'javascript:1', 'data:image/png;base64,AAA', 'file:///etc/passwd', '', 'a\0b.png']) assert.strictEqual(M.caminhoLocal('/h', ruim), null, ruim);
});

test('link com parênteses no endereço não deixa sobra de texto', () => {
  assert.strictEqual(M.render('[inerte](javascript:alert(1))'), '<p><span class="md-link-inerte">inerte</span></p>');
  assert.strictEqual(M.render('[w](https://pt.wikipedia.org/wiki/A_(b))'), '<p><a href="#" data-url="https://pt.wikipedia.org/wiki/A_(b)">w</a></p>');
});

// Fiação estática da página "Comandos" (padrão test/rtk-ui.test.js): botão da barra lateral, página, scripts, rota,
// rodapé sem item flutuando, acessibilidade e contraste. O efeito real (cliques, troca de sistema e de agente, capturas) fica
// em scripts/e2e-teclas-comandos.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const html = ler('renderer/index.html');
const css = ler('renderer/styles.css');
const app = ler('renderer/app.js');
const pagina = ler('renderer/comandos.js');

test('o botão Comandos fica na barra lateral, depois de Nova versão e antes de Novidades e Sobre', () => {
  const iUpdate = html.indexOf('id="nav-update"');
  const iCmd = html.indexOf('data-page="comandos"');
  const iNov = html.indexOf('data-page="novidades"');
  const iSobre = html.indexOf('data-page="sobre"');
  assert.ok(iUpdate > 0 && iCmd > iUpdate && iNov > iCmd && iSobre > iNov, `ordem: ${iUpdate} ${iCmd} ${iNov} ${iSobre}`);
  const botao = html.slice(html.lastIndexOf('<button', iCmd), html.indexOf('</button>', iCmd));
  assert.match(botao, /class="nav-tab nav-tab-bottom"/);
  assert.match(botao, /<svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(botao, /<span>Comandos<\/span>/);
});

test('só um item do rodapé leva margin-top: auto: Novidades e Sobre vêm logo abaixo do Comandos', () => {
  assert.match(css, /\.nav-tab-bottom \{ margin-top: auto;/);
  assert.match(css, /\.nav-tab-bottom ~ \.nav-tab-bottom \{ margin-top: 0; \}/);
  // o botão Nova versão tem o seu próprio auto e o item seguinte a ele deixa de ter
  assert.match(css, /\.nav-update:not\(\[hidden\]\) \+ \.nav-tab-bottom \{ margin-top: 0; \}/);
  // Sobre não é nav-tab-bottom: não pode ganhar um segundo auto
  assert.ok(!/data-page="sobre"[^>]*nav-tab-bottom/.test(html));
});

test('a página existe com cabeçalho no padrão das outras e o corpo que o comandos.js preenche', () => {
  const i = html.indexOf('<div class="page" id="page-comandos">');
  assert.ok(i > 0);
  const bloco = html.slice(i, html.indexOf('<!-- /page-comandos -->'));
  assert.match(bloco, /<div class="page-header">/);
  assert.match(bloco, /<h1 class="page-title">Comandos<\/h1>/);
  assert.match(bloco, /id="comandos-versoes"/);
  assert.match(bloco, /id="comandos-body"/);
  // divs balanceados dentro da página
  assert.strictEqual((bloco.match(/<div\b/g) || []).length, (bloco.match(/<\/div>/g) || []).length);
});

test('os scripts estão carregados na ordem: atalhos-ide antes do terminal-keys e do devcode; wheel-lines antes do devcode; conteúdo antes da página, depois do about', () => {
  const pos = n => html.indexOf(`<script src="${n}"></script>`);
  for (const n of ['atalhos-ide.js', 'terminal-keys.js', 'wheel-lines.js', 'devcode.js', 'about.js', 'comandos-conteudo.js', 'comandos.js']) assert.ok(pos(n) > 0, `${n} ausente`);
  assert.ok(pos('atalhos-ide.js') < pos('terminal-keys.js') && pos('atalhos-ide.js') < pos('devcode.js'));
  assert.ok(pos('wheel-lines.js') < pos('devcode.js'), 'wheel-lines.js antes do devcode.js');
  assert.ok(pos('about.js') < pos('comandos-conteudo.js') && pos('comandos-conteudo.js') < pos('comandos.js'));
});

test('navigate abre a página Comandos e a página não é dev-mode', () => {
  assert.match(app, /if \(pageId === 'comandos'\) window\.comandosPage\?\.open\(\);/);
  assert.match(app, /classList\.toggle\('dev-mode', pageId === 'devcode' \|\| pageId === 'terminal'\)/);
});

test('acessibilidade: seletores como grupos com aria-pressed, teclas em kbd, títulos de seção ligados e botão com foco visível', () => {
  assert.match(pagina, /role="group" aria-label="Sistema"/);
  assert.match(pagina, /role="group" aria-label="Agente"/);
  assert.match(pagina, /aria-pressed="\$\{estado\[grupo\] === valor\}"/);
  assert.match(pagina, /<kbd class="kbd">/);
  assert.match(pagina, /<section class="cmd-secao" aria-labelledby="cmd-h-\$\{b\.id\}">/);
  assert.match(pagina, /<h2 class="section-heading" id="cmd-h-\$\{b\.id\}">/);
  assert.match(pagina, /class="cmd-mais" aria-hidden="true"/);
  assert.match(css, /\.cmd-chip:focus-visible \{ outline: 2px solid var\(--orange\)/);
  assert.match(css, /^\.kbd \{/m);
  // botões nativos: Tab e Enter/Espaço funcionam sem código; o desenho devolve o foco ao botão acionado
  assert.match(pagina, /<button type="button" class="cmd-chip/);
  assert.match(pagina, /\?\.focus\(\)/);
});

test('todo texto que vem do conteúdo passa por esc() antes de entrar no HTML', () => {
  const ocorrencias = [...pagina.matchAll(/\b(i\.(titulo|oQueFaz|comando|equivalente|id|agenteDoEquivalente|nota)|b\.(titulo|id))/g)];
  assert.ok(ocorrencias.length >= 8);
  for (const m of ocorrencias) {
    const antes = pagina.slice(Math.max(0, m.index - 4), m.index);
    if (/^ \?/.test(pagina.slice(m.index + m[0].length, m.index + m[0].length + 3))) continue; // condição, não saída
    // b.id também aparece em comparações e em atributos de id, que são constantes do módulo de conteúdo
    if (/^b\.id/.test(m[0]) && !/esc\($/.test(antes)) continue;
    assert.ok(antes === 'esc(', `${m[0]} sem esc() (contexto: ${pagina.slice(Math.max(0, m.index - 30), m.index + 20)})`);
  }
  // os botões dos seletores escapam o texto dentro da própria função
  assert.match(pagina, />\$\{esc\(texto\)\}<\/button>/);
  // listas montadas com map: cada item também passa por esc()
  assert.match(pagina, /i\.detalhes\.map\(d => `<li>\$\{esc\(d\)\}<\/li>`\)/);
  assert.match(pagina, /\(b\.notas \|\| \[\]\)\.map\(n => `<p class="cmd-nota cmd-nota-bloco">\$\{esc\(n\)\}<\/p>`\)/);
});

// ── contraste (WCAG): texto das cores novas sobre o fundo em que aparece, mínimo 4,5:1 ──────────────────────
const variavel = nome => css.match(new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`))[1];
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('contraste mínimo 4,5:1 nos textos da página (a página usa --text-muted e --text, nunca --text-dim)', () => {
  const pares = [['text-muted', 'surface'], ['text-muted', 'bg'], ['text', 'surface'], ['text', 'surface2'], ['text-muted', 'surface2']];
  for (const [fg, bg] of pares) {
    const r = contraste(variavel(fg), variavel(bg));
    assert.ok(r >= 4.5, `--${fg} sobre --${bg}: ${r.toFixed(2)}:1`);
  }
  const ini = css.indexOf('/* ── PÁGINA COMANDOS ── */');
  const bloco = css.slice(ini, css.indexOf('/* Novidades da versão', ini));
  assert.ok(!/--text-dim/.test(bloco), 'a página usa --text-dim (3,4:1 sobre a superfície, abaixo de 4,5:1)');
  assert.ok(contraste(variavel('text-dim'), variavel('surface')) < 4.5); // registro: é por isso que não é usada
});

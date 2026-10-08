/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Markdown do menu Visualizar: módulo puro (UMD, testável no node) que devolve HTML. Escapa TUDO primeiro, como o md() do
// about.js: o HTML cru de dentro do .md aparece como texto, então não há o que sanitizar. Cobre títulos, parágrafos, listas
// com marcador e numeradas, blocos de código com cercas, código inline, negrito, itálico, citação, linha horizontal, tabela
// GFM simples, links e imagens. Links só http(s) e mailto (abrem no navegador externo por data-url); link relativo é texto
// inerte e javascript: nunca vira link. Imagem local (relativa ao .md ou absoluta) só entra se o ctx.urlLocal devolver o
// endereço do protocolo confinado; imagem http(s) nunca carrega (aparece o texto alternativo com o link).
// Carregado no renderer (window.RendraMarkdownVista) e nos testes (require).
(function (root) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ABSOLUTA_WEB = /^(https?:|mailto:)/i;
  const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;
  const UNIDADE_WINDOWS = /^[a-z]:[\\/]/i;

  // Caminho local de um alvo de imagem do .md: relativo à pasta do .md ou absoluto; null para qualquer outro esquema
  function caminhoLocal(baseDir, alvo) {
    let a = String(alvo).trim();
    try { a = decodeURI(a); } catch { /* fica como veio */ }
    if (!a || a.includes('\0')) return null;
    if (TEM_ESQUEMA.test(a) && !UNIDADE_WINDOWS.test(a)) return null; // http:, data:, javascript:, file:...
    if (a.startsWith('//')) return null; // sem esquema, mas é endereço da web
    const absoluta = UNIDADE_WINDOWS.test(a) || /^[\\/]/.test(a);
    const sep = String(baseDir).includes('\\') ? '\\' : '/';
    const bruto = (absoluta ? a : `${baseDir}${sep}${a}`).replace(/\\/g, '/');
    // normaliza . e .. sem sair da raiz do próprio caminho (UNC, unidade ou /)
    const m = /^(\/\/[^/]+\/[^/]+|[a-z]:|\/)?(.*)$/i.exec(bruto);
    const prefixo = m[1] || '';
    const partes = [];
    for (const p of m[2].split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') { if (partes.length) partes.pop(); continue; }
      partes.push(p);
    }
    const resultado = `${prefixo}${prefixo === '/' ? '' : '/'}${partes.join('/')}`;
    return sep === '\\' ? resultado.replace(/\//g, '\\') : resultado;
  }

  function linkExterno(url, textoHtml) {
    return ABSOLUTA_WEB.test(url) ? `<a href="#" data-url="${esc(url)}">${textoHtml}</a>` : `<span class="md-link-inerte">${textoHtml}</span>`;
  }

  function imagem(alt, alvo, ctx) {
    const url = String(alvo).trim();
    if (/^https?:/i.test(url)) return `<span class="md-img-alt">${esc(alt)} (${linkExterno(url, esc(url))})</span>`;
    const local = ctx.urlLocal ? ctx.urlLocal(url) : null;
    if (local) return `<img class="md-img" src="${esc(local)}" alt="${esc(alt)}" loading="lazy">`;
    return `<span class="md-img-alt">${esc(alt)}</span>`;
  }

  function inline(bruto, ctx) {
    const guardados = [];
    const guarda = html => { guardados.push(html); return `\u0000${guardados.length - 1}\u0000`; };
    let s = String(bruto).replace(/\u0000/g, '');
    s = s.replace(/`([^`]+)`/g, (_, c) => guarda(`<code>${esc(c)}</code>`));
    // o endereço aceita um nível de parênteses (javascript:alert(1)), como o CommonMark
    s = s.replace(/!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g, (_, alt, alvo) => guarda(imagem(alt, alvo, ctx)));
    s = s.replace(/\[([^\]]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g, (_, txt, alvo) => guarda(linkExterno(alvo.trim(), inline(txt, ctx))));
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/\*([^*\s][^*]*)\*/g, '<i>$1</i>').replace(/(^|[\s(])_([^_\s][^_]*)_(?=$|[\s).,;:!?])/g, '$1<i>$2</i>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => guardados[+i]);
  }

  const celulas = linha => linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const ehSeparadorTabela = linha => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(linha) && linha.includes('-') && (linha.includes('|') || /^\s*:?-+:?\s*$/.test(linha));
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

  // text → HTML. ctx: { urlLocal(alvo) → endereço do protocolo de mídia ou null }
  function render(text, ctx = {}) {
    const linhas = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < linhas.length) {
      const linha = linhas[i];
      if (!linha.trim()) { i++; continue; }
      // cerca de código
      const cerca = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(linha);
      if (cerca) {
        const fim = new RegExp(`^\\s*${cerca[1][0]}{${cerca[1].length},}\\s*$`);
        const corpo = [];
        i++;
        while (i < linhas.length && !fim.test(linhas[i])) corpo.push(linhas[i++]);
        i++;
        out.push(`<pre><code${cerca[2] ? ` class="lang-${esc(cerca[2].replace(/[^\w+#.-]/g, ''))}"` : ''}>${esc(corpo.join('\n'))}</code></pre>`);
        continue;
      }
      const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(linha);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2], ctx)}</h${h[1].length}>`); i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(linha)) { out.push('<hr>'); i++; continue; }
      if (/^\s{0,3}>/.test(linha)) {
        const q = [];
        while (i < linhas.length && /^\s{0,3}>/.test(linhas[i])) q.push(linhas[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push(`<blockquote>${render(q.join('\n'), ctx)}</blockquote>`);
        continue;
      }
      if (linha.includes('|') && i + 1 < linhas.length && ehSeparadorTabela(linhas[i + 1]) && linhas[i + 1].includes('|')) {
        const cab = celulas(linha);
        i += 2;
        const corpo = [];
        while (i < linhas.length && linhas[i].trim() && linhas[i].includes('|')) corpo.push(celulas(linhas[i++]));
        out.push(`<table><thead><tr>${cab.map(c => `<th>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${corpo.map(l => `<tr>${cab.map((_, k) => `<td>${inline(l[k] || '', ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (ITEM.test(linha)) {
        // lista (um nível de aninhamento por recuo): junta os itens consecutivos
        const itens = [];
        while (i < linhas.length && (ITEM.test(linhas[i]) || (linhas[i].trim() && /^\s{2,}\S/.test(linhas[i]) && itens.length))) {
          const m = ITEM.exec(linhas[i]);
          if (m) itens.push({ recuo: m[1].replace(/\t/g, '    ').length, ordenada: /\d/.test(m[2][0]), texto: m[3] });
          else itens[itens.length - 1].texto += ` ${linhas[i].trim()}`;
          i++;
        }
        const monta = (de, ate, recuoBase) => {
          const ordenada = itens[de].ordenada;
          let html = `<${ordenada ? 'ol' : 'ul'}>`;
          let k = de;
          while (k < ate) {
            let fimFilhos = k + 1;
            while (fimFilhos < ate && itens[fimFilhos].recuo > itens[k].recuo) fimFilhos++;
            html += `<li>${inline(itens[k].texto, ctx)}${fimFilhos > k + 1 ? monta(k + 1, fimFilhos, itens[k + 1].recuo) : ''}</li>`;
            k = fimFilhos;
          }
          return `${html}</${ordenada ? 'ol' : 'ul'}>`;
        };
        out.push(monta(0, itens.length, itens[0].recuo));
        continue;
      }
      // parágrafo: linhas seguidas até uma linha em branco ou outro bloco
      const par = [];
      while (i < linhas.length && linhas[i].trim() && !/^\s*(`{3,}|~{3,})/.test(linhas[i]) && !/^\s{0,3}#{1,6}\s/.test(linhas[i]) && !/^\s{0,3}>/.test(linhas[i]) && !ITEM.test(linhas[i])) par.push(linhas[i++].trim());
      if (!par.length) { par.push(linhas[i++].trim()); }
      out.push(`<p>${inline(par.join(' '), ctx)}</p>`);
    }
    return out.join('');
  }

  const api = { render, caminhoLocal, inline: (t, c) => inline(t, c || {}) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraMarkdownVista = api;
})(typeof window !== 'undefined' ? window : this);

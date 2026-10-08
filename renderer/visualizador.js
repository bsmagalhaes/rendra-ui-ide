/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Visualizador das abas do editor que não são texto editável: imagem, áudio, vídeo e PDF (o conteúdo vem do protocolo de
// mídia confinado, nunca de file:). Só monta o elemento; quem guarda as abas, o foco e o teclado é o devcode.js.
// window.RendraVisualizador.criar({ tipo, caminho, nome }) -> { el, pausar(), soltar() }
(function (root) {
  const T = root.RendraTipoArquivo;
  const MENSAGEM_ERRO = 'Não foi possível abrir este arquivo';

  const noDe = (tag, classe, texto) => {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  };

  function liberarMidia(m) {
    try { m.pause(); } catch { /* sem player */ }
    m.removeAttribute('src');
    try { m.load(); } catch { /* nada a liberar */ }
  }

  // texto UTF-8 em base64, para o data: do SVG (btoa só aceita Latin-1)
  const base64 = texto => { let bin = ''; new TextEncoder().encode(texto).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
  const pastaDe = caminho => String(caminho).replace(/[\\/][^\\/]*$/, '');

  function criar({ tipo, caminho, nome, texto }) {
    const el = noDe('div', `dev-viewer dev-viewer-${tipo}`);
    el.tabIndex = 0;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', `${nome} (visualização)`);
    el.dataset.caminho = caminho;
    let midia = null;
    const erro = msg => { el.replaceChildren(noDe('div', 'dev-viewer-msg', msg || MENSAGEM_ERRO)); midia = null; };
    const url = T.urlMidia(caminho);
    if (tipo === 'imagem') {
      const img = noDe('img', 'dev-viewer-img');
      img.alt = nome;
      img.addEventListener('error', () => erro());
      img.src = url;
      el.appendChild(img);
    } else if (tipo === 'audio' || tipo === 'video') {
      midia = noDe(tipo, 'dev-viewer-player');
      midia.controls = true;
      midia.preload = 'metadata';
      midia.addEventListener('error', () => erro());
      midia.src = url;
      if (tipo === 'audio') el.appendChild(noDe('div', 'dev-viewer-nome', nome));
      el.appendChild(midia);
    } else if (tipo === 'markdown') {
      // Markdown já escapado (RendraMarkdownVista); as imagens locais só entram pelo protocolo confinado
      const M = root.RendraMarkdownVista;
      const base = pastaDe(caminho);
      const pagina = noDe('div', 'dev-md');
      pagina.innerHTML = M.render(texto, { urlLocal: alvo => { const p = M.caminhoLocal(base, alvo); return p && T.mimeDe(p) ? T.urlMidia(p) : null; } });
      // imagem que não carrega (fora das pastas abertas, apagada): aparece o texto alternativo
      pagina.addEventListener('error', e => {
        if (e.target.tagName !== 'IMG') return;
        e.target.replaceWith(noDe('span', 'md-img-alt', e.target.alt));
      }, true);
      pagina.addEventListener('click', e => {
        const a = e.target.closest('a[data-url]');
        if (a) { e.preventDefault(); root.rendra.openExternal(a.dataset.url); }
      });
      el.appendChild(pagina);
    } else if (tipo === 'svg') {
      // SVG só como imagem (nunca no documento): o script de dentro não roda
      const img = noDe('img', 'dev-viewer-img');
      img.alt = nome;
      img.addEventListener('error', () => erro('Não foi possível mostrar este SVG'));
      img.src = `data:image/svg+xml;base64,${base64(String(texto ?? ''))}`;
      el.appendChild(img);
    } else if (tipo === 'html') {
      // HTML sem nenhum token no sandbox (sem scripts, sem formulário, sem navegação do quadro de cima); entra por propriedade
      const f = noDe('iframe', 'dev-viewer-html');
      f.title = nome;
      f.setAttribute('sandbox', '');
      f.srcdoc = String(texto ?? '');
      el.appendChild(f);
    } else if (tipo === 'pdf') {
      const f = noDe('iframe', 'dev-viewer-pdf');
      f.title = nome;
      f.src = url;
      el.appendChild(f);
    } else {
      erro('Este tipo de arquivo não abre na IDE');
    }
    return {
      el,
      // ao trocar de aba o som e o vídeo param
      pausar() { el.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch { /* sem player */ } }); },
      // ao fechar a aba o arquivo é liberado (o Windows não deixa excluir um arquivo que o player ainda segura)
      soltar() { el.querySelectorAll('video, audio').forEach(liberarMidia); el.querySelectorAll('iframe').forEach(f => { f.src = 'about:blank'; }); el.remove(); },
    };
  }

  root.RendraVisualizador = { criar };
})(window);

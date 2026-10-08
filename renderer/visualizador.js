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

  function criar({ tipo, caminho, nome }) {
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

/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Modal de Novidades, aberto na primeira abertura depois de atualizar o app. Carregado no renderer
// (window.RendraNovidades) e nos testes (require). As regras são puras; abrir() mexe no DOM.
//
// O modal só fecha pelo botão "Fechar": não fecha por tempo, nem ao clicar fora, nem por Esc. A
// versão só é gravada como vista nesse clique, então quem fechou o app sem ler vê o modal de novo.
(function (root) {
  // Abre quando já houve uma versão vista e ela difere da atual (instalação nova não abre)
  function deveAbrir(visto, atual) {
    return !!visto && !!atual && String(visto) !== String(atual);
  }

  // Trecho "## X.Y.Z · data" do CHANGELOG, sem o título
  function secao(md, versao) {
    const linhas = String(md || '').split(/\r?\n/);
    const ini = linhas.findIndex(l => new RegExp('^##\\s+' + String(versao).replace(/\./g, '\\.') + '(\\s|$)').test(l));
    if (ini < 0) return '';
    let fim = linhas.findIndex((l, i) => i > ini && /^##\s/.test(l));
    if (fim < 0) fim = linhas.length;
    return linhas.slice(ini + 1, fim).join('\n').trim();
  }

  // Mostra o modal com o HTML das notas; `aoFechar` roda só no clique em "Fechar"
  function abrir({ versao, html, aoFechar }) {
    const overlay = document.getElementById('novidades-overlay');
    const botao = document.getElementById('novidades-fechar');
    document.getElementById('novidades-titulo').textContent = `Novidades da versão ${versao}`;
    document.getElementById('novidades-corpo').innerHTML = html;
    overlay.classList.add('visible');
    // Nada por baixo do modal reage a Esc ou a Tab enquanto ele está aberto
    const teclas = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'Tab') { e.preventDefault(); botao.focus(); }
    };
    document.addEventListener('keydown', teclas, true);
    botao.onclick = () => {
      document.removeEventListener('keydown', teclas, true);
      overlay.classList.remove('visible');
      botao.onclick = null;
      if (aoFechar) aoFechar();
    };
    botao.focus();
  }

  const api = { deveAbrir, secao, abrir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraNovidades = api;
})(typeof window !== 'undefined' ? window : this);

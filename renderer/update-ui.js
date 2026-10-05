/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Decide o que a interface mostra para cada estado da atualização (botão "Nova versão", título e
// texto de progresso). Carregado no renderer (window.RendraUpdateUi) e nos testes (require); sem DOM.
// Nos modos store e none (Microsoft Store e pasta sem origem) nada aparece: a Store atualiza sozinha.
(function (root) {
  const VAZIO = { mostrarBotao: false, titulo: '', mostrarStatus: false, textoStatus: '' };

  function updateUi(s) {
    if (!s || s.mode === 'store' || s.mode === 'none') return VAZIO;
    if (s.state === 'available' || s.state === 'ready') {
      return {
        mostrarBotao: true,
        titulo: s.state === 'ready'
          ? `Versão ${s.version} baixada: clique para reiniciar e atualizar`
          : `Versão ${s.version} disponível: clique para atualizar`,
        mostrarStatus: false,
        textoStatus: '',
      };
    }
    if (s.state === 'downloading') {
      return {
        mostrarBotao: false,
        titulo: '',
        mostrarStatus: true,
        textoStatus: `Baixando a versão ${s.version}${s.percent != null ? ` · ${s.percent}%` : ''}…`,
      };
    }
    return VAZIO;
  }

  // O confirm() com notas e aviso de alterações locais é só do clone (git pull)
  function precisaConfirmar(s) {
    return !!s && s.mode === 'git';
  }

  const api = { updateUi, precisaConfirmar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraUpdateUi = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Quem vence no Ctrl+V do explorador: a área interna (Copiar/Recortar do menu do explorador) ou o clipboard do sistema
// (arquivos copiados no Explorer/Finder). Regra: vale a interna quando o clipboard do sistema NÃO mudou desde a ação interna
// (a assinatura gravada na hora do Copiar/Recortar é igual à de agora); senão vale a do sistema. A área interna só vale no
// mesmo workspace. Função pura (UMD, testável no node).
// Carregado no renderer (window.RendraPrecedenciaColar) e nos testes (require).
(function (root) {
  // interna: { wsId, assinatura } ou null. Devolve 'interna' | 'so' | 'outro-projeto'
  function escolherOrigemDoColar({ interna, assinaturaAgora, wsId }) {
    if (!interna || interna.assinatura !== assinaturaAgora) return 'so';
    return interna.wsId === wsId ? 'interna' : 'outro-projeto';
  }

  const api = { escolherOrigemDoColar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraPrecedenciaColar = api;
})(typeof window !== 'undefined' ? window : this);

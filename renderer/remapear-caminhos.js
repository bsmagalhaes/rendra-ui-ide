/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Caminhos que contêm outros e caminhos que mudam de lugar (excluir ou mover uma pasta com abas abertas). Função pura:
// o explorador usa a mesma regra para abas, seleção, pastas expandidas e a área interna de copiar/recortar.
// Carregado no renderer (window.RendraRemapear) e nos testes (require).
(function (root) {
  const PREFIXO_VISTA = 'vista:';
  // a chave de aba "vista:<caminho>" é o caminho com um prefixo: as duas formas entram na mesma regra
  const separa = p => { const s = String(p); return s.startsWith(PREFIXO_VISTA) ? [PREFIXO_VISTA, s.slice(PREFIXO_VISTA.length)] : ['', s]; };
  const unifica = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const chave = (p, insensivel) => (insensivel ? unifica(p).toLowerCase() : unifica(p));

  // `filho` é o próprio `pai` ou está dentro dele. a/b não contém a/bc (a comparação respeita a fronteira do separador).
  function contem(pai, filho, { insensivel = false } = {}) {
    const a = chave(separa(pai)[1], insensivel), b = chave(separa(filho)[1], insensivel);
    if (!a) return false;
    return b === a || b.startsWith(a + '/');
  }

  // Novo caminho de `p` quando `de` passa a ser `para` (arquivo ou pasta). Fora de `de`, devolve `p` como veio.
  // A parte que sobra de `p` mantém o texto original; só o prefixo troca. O prefixo "vista:" é preservado.
  function remapear(de, para, p, { insensivel = false } = {}) {
    const [pref, resto] = separa(p);
    if (!contem(de, resto, { insensivel })) return p;
    const deLen = unifica(separa(de)[1]).length;
    const cauda = resto.replace(/\/+$/, '').replace(/\\+$/, '');
    return pref + String(para).replace(/[\\/]+$/, '') + cauda.slice(deLen);
  }

  const api = { contem, remapear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraRemapear = api;
})(typeof window !== 'undefined' ? window : this);

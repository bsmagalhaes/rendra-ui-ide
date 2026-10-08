/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Nome para "Manter os dois": "nome (2).ext", "nome (3).ext"... até achar um nome livre. Função pura (UMD, como o
// novo-item.js): o main a usa na hora da cópia (é ele que sabe o que existe no disco) e os testes a exercitam direto.
// Sem extensão ou pasta: "nome (2)". Arquivo que começa com ponto: ".env (2)". Várias extensões: "a.tar (2).gz".
// Carregado no processo principal e nos testes (require) e no renderer (window.RendraNomeLivre).
(function (root) {
  function dividir(nome, ehPasta) {
    if (ehPasta) return [nome, ''];
    const i = nome.lastIndexOf('.');
    return i > 0 ? [nome.slice(0, i), nome.slice(i)] : [nome, ''];
  }

  // existentes: nomes que já estão na pasta. Com `insensivel` (Windows e macOS) a comparação ignora a caixa.
  function nomeLivre(nome, existentes, { ehPasta = false, insensivel = false } = {}) {
    const chave = s => (insensivel ? s.toLowerCase() : s);
    const ocupados = new Set((existentes || []).map(chave));
    const [base, ext] = dividir(String(nome), ehPasta);
    const raiz = base.replace(/ \(\d+\)$/, ''); // "a (2)" vira "a (3)", não "a (2) (2)"
    for (let n = 2; n < 100000; n++) {
      const candidato = `${raiz} (${n})${ext}`;
      if (!ocupados.has(chave(candidato))) return candidato;
    }
    throw new Error('Não foi possível achar um nome livre');
  }

  const api = { nomeLivre };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraNomeLivre = api;
})(typeof window !== 'undefined' ? window : this);

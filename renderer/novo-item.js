/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Nome de arquivo ou pasta novo, criado pelo menu do explorador. Carregado no renderer
// (window.RendraNovoItem), no processo principal e nos testes (require): a mesma regra vale na
// tela, que mostra a mensagem, e no IPC, que é quem protege o disco.
(function (root) {
  // Mensagem de erro (pt-BR) ou null se o nome serve. `existentes`: nomes já presentes na pasta;
  // com `insensivel` (Windows e macOS) a comparação ignora maiúsculas.
  function validarNome(nome, existentes = [], { insensivel = false } = {}) {
    const n = String(nome ?? '').trim();
    if (!n) return 'Digite um nome';
    if (/[\\/]/.test(n)) return 'O nome não pode ter / nem \\';
    if (n === '.' || n === '..') return 'Nome inválido';
    // espaços inseparáveis entre os caracteres: o toast estreito não deixa um "|" sozinho na linha
    if (/[:*?"<>|]/.test(n)) return `O nome não pode ter caracteres reservados do Windows: ${[':', '*', '?', '"', '<', '>', '|'].join(' ')}`;
    const chave = s => (insensivel ? s.toLowerCase() : s);
    if (existentes.some(e => chave(e) === chave(n))) return `"${n}" já existe nesta pasta`;
    return null;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { validarNome };
  else root.RendraNovoItem = { validarNome };
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.9.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Ordem das entradas do explorador (decisão do dono): pastas que começam com ".", depois as demais pastas, depois
// arquivos que começam com "." e por último os demais arquivos; dentro de cada grupo, por nome. Módulo puro (CommonJS).

const grupoDe = e => (e.isDir ? 0 : 2) + (e.name.startsWith('.') ? 0 : 1);

// Compara sem o ponto inicial (não depende de como a ICU trata pontuação), sem diferenciar maiúsculas nem acentos;
// o nome cru desempata, para a ordem não depender da ordem do readdir (README.md e readme.md no Linux).
function compararEntradas(a, b) {
  const g = grupoDe(a) - grupoDe(b);
  if (g) return g;
  const na = a.name.replace(/^\./, ''), nb = b.name.replace(/^\./, '');
  const c = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
  if (c) return c;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

const ordenarEntradas = lista => [...lista].sort(compararEntradas);

module.exports = { compararEntradas, ordenarEntradas, grupoDe };

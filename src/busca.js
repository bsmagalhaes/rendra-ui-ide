/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Núcleo puro da busca do explorador (CommonJS, sem fs): casamento por linha, limites e regras de pasta.
// Usado pelo worker (src/busca-worker.js) e pelo handler `dev:search` (src/devcode.js).

const LIMITES = {
  ocorrencias: 500, // linhas com ocorrência na busca de texto
  arquivos: 200, // arquivos com ocorrência (ou nomes achados)
  tempoMs: 10000,
  tempoUncMs: 20000, // projeto em \\wsl.localhost: o fs no share é lento
  bytesArquivo: 1024 * 1024, // arquivo de texto lido até 1 MB
};
const TERMO_MIN = 2;
const TERMO_MAX = 500;
const MAX_MARCAS = 5;
const MAX_TRECHO = 200;

// Pedido pode REDUZIR um limite (testes), nunca aumentar: vale o menor entre o pedido e o padrão.
function limitar(pedido, { unc = false } = {}) {
  const padrao = { ...LIMITES, tempoMs: unc ? LIMITES.tempoUncMs : LIMITES.tempoMs };
  const out = {};
  for (const k of ['ocorrencias', 'arquivos', 'tempoMs', 'bytesArquivo']) {
    const v = pedido && Number(pedido[k]);
    out[k] = Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), padrao[k]) : padrao[k];
  }
  return out;
}

// Caractere de palavra: letras latinas (com acento), dígitos e "_". Classe explícita em vez da flag u, que rejeitaria
// expressões comuns do usuário.
const PALAVRA = 'A-Za-z0-9_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF';
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Só COMPILA: nunca executa a expressão aqui (a execução é do worker, que pode ser terminado). Nunca lança.
function montarMatcher({ termo, diferenciar = false, palavra = false, regex = false } = {}) {
  if (typeof termo !== 'string' || !termo) return { ok: false, erro: 'Digite um termo' };
  const flags = diferenciar ? 'g' : 'gi';
  let corpo = regex ? termo : escapar(termo);
  try {
    if (regex) new RegExp(termo, flags); // valida a expressão do usuário sozinha, para a mensagem apontar para ela
    if (palavra) corpo = `(?<![${PALAVRA}])(?:${corpo})(?![${PALAVRA}])`;
    const re = new RegExp(corpo, flags);
    return { ok: true, marcas: linha => marcasDaLinha(re, linha) };
  } catch {
    return { ok: false, erro: 'Expressão regular inválida' };
  }
}

// Até MAX_MARCAS pares [inicio, fim]; ocorrência de largura zero é ignorada.
function marcasDaLinha(re, linha) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while (out.length < MAX_MARCAS && (m = re.exec(linha))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Busca por nome: só o nome do arquivo, substring, sem diferenciar maiúsculas.
const casaNome = (nome, termo) => !!termo && String(nome).toLowerCase().includes(String(termo).toLowerCase());

// Texto: sem byte nulo nos primeiros 8000 bytes (a mesma regra do dev:read).
const ehTexto = buf => !buf.subarray(0, 8000).includes(0);

// Pastas que a busca não entra quando percorre por fs. Em repositório a lista vem do git (respeita o .gitignore).
function ignorarPasta(nome, { git = false } = {}) {
  if (nome === '.git') return true;
  return !git && nome === 'node_modules';
}

// Uma ocorrência por LINHA (com até MAX_MARCAS marcas); linha e coluna a partir de 1. Linhas separadas como o Monaco
// (\r\n, \r ou \n); o BOM do começo não desloca a coluna. Para depois de `maxOcorrencias` (o chamador passa o restante + 1).
function buscarNoTexto(conteudo, matcher, { maxOcorrencias = Infinity } = {}) {
  const out = [];
  const linhas = String(conteudo).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (let i = 0; i < linhas.length && out.length < maxOcorrencias; i++) {
    const linha = linhas[i];
    if (!linha) continue;
    const marcas = matcher.marcas(linha);
    if (!marcas.length) continue;
    out.push({ linha: i + 1, coluna: marcas[0][0] + 1, ...recortar(linha, marcas) });
  }
  return out;
}

// Trecho aparado e limitado a MAX_TRECHO, com a janela em volta da primeira marca e as marcas reajustadas.
function recortar(linha, marcas) {
  const sobra = linha.length - linha.trimStart().length;
  let ini = sobra;
  let fim = linha.length;
  if (fim - ini > MAX_TRECHO) {
    ini = Math.max(sobra, Math.min(marcas[0][0] - 60, linha.length - MAX_TRECHO));
    fim = ini + MAX_TRECHO;
  }
  const trecho = linha.slice(ini, fim).trimEnd();
  const ajustadas = marcas
    .map(([a, b]) => [Math.max(a, ini) - ini, Math.min(b, fim) - ini])
    .filter(([a, b]) => b > a && a < trecho.length)
    .map(([a, b]) => [a, Math.min(b, trecho.length)]);
  return { trecho, marcas: ajustadas };
}

module.exports = { LIMITES, TERMO_MIN, TERMO_MAX, MAX_MARCAS, MAX_TRECHO, limitar, montarMatcher, casaNome, ehTexto, ignorarPasta, buscarNoTexto };

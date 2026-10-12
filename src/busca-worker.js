/*! Rendra IDE v1.9.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Busca do explorador numa thread à parte: expressão regular do usuário pode ser catastrófica e o fs síncrono num share
// parado trava; o processo principal faz `terminate()` ao estourar o tempo e responde com o que já recebeu.
// Entrada (workerData): { raiz, raizReal, lista | null, modo: 'texto' | 'nome', opcoes, limites, git }.
// A raiz já foi conferida pelo main (guard + realpath). Saída: { tipo: 'arquivo', caminho, ocorrencias } por arquivo com
// achado (caminho relativo à raiz), e uma final { tipo: 'fim', pulados, parcial }.

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const { montarMatcher, casaNome, ehTexto, ignorarPasta, buscarNoTexto } = require('./busca');

const { raiz, raizReal, lista, modo, opcoes, limites, git } = workerData;
const INSENSIVEL = process.platform !== 'linux';
const norm = p => (INSENSIVEL ? path.resolve(p).toLowerCase() : path.resolve(p));
const baseReal = norm(raizReal);
const dentro = real => { const a = norm(real); return a === baseReal || a.startsWith(baseReal.endsWith(path.sep) ? baseReal : baseReal + path.sep); };

// realpath da PASTA do arquivo, uma vez por pasta (share UNC lento): o arquivo só vale se a pasta real está dentro da raiz
// real. O lstat da folha não basta: um arquivo rastreado sob uma pasta trocada por link depois seria lido de fora.
const cachePasta = new Map();
function pastaDentro(dir) {
  if (cachePasta.has(dir)) return cachePasta.get(dir);
  let ok = false;
  try { ok = dentro(fs.realpathSync(dir)); } catch { ok = false; }
  cachePasta.set(dir, ok);
  return ok;
}

const matcher = modo === 'texto' ? montarMatcher(opcoes) : null;
let pulados = 0;
let parcial = null;
let arquivos = 0;
let total = 0;

// Devolve false quando a busca deve parar (teto atingido).
function processar(rel) {
  const abs = path.join(raiz, rel);
  if (!pastaDentro(path.dirname(abs))) return true;
  let st;
  try { st = fs.lstatSync(abs); } catch { return true; }
  if (!st.isFile()) return true; // link, junção, pasta (gitlink de submódulo) e o que não é arquivo comum
  if (modo === 'nome') {
    if (!casaNome(path.basename(rel), opcoes.termo)) return true;
    if (arquivos >= limites.arquivos) { parcial = 'arquivos'; return false; }
    arquivos++;
    parentPort.postMessage({ tipo: 'arquivo', caminho: rel, ocorrencias: [] });
    return true;
  }
  if (st.size > limites.bytesArquivo) { pulados++; return true; }
  let buf;
  try { buf = fs.readFileSync(abs); } catch { return true; }
  if (!ehTexto(buf)) { pulados++; return true; }
  const restante = limites.ocorrencias - total;
  let achados = buscarNoTexto(buf.toString('utf8'), matcher, { maxOcorrencias: restante + 1 });
  if (!achados.length) return true;
  if (arquivos >= limites.arquivos) { parcial = 'arquivos'; return false; }
  let parar = false;
  if (achados.length > restante) { achados = achados.slice(0, restante); parcial = 'ocorrencias'; parar = true; }
  if (achados.length) {
    arquivos++;
    total += achados.length;
    parentPort.postMessage({ tipo: 'arquivo', caminho: rel, ocorrencias: achados });
  }
  return !parar;
}

// Sem lista (fora de repositório): percorre pulando .git e node_modules e sem entrar em link.
function percorrer(dirRel) {
  let entradas;
  try { entradas = fs.readdirSync(path.join(raiz, dirRel), { withFileTypes: true }); } catch { return true; }
  entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of entradas) {
    if (d.isSymbolicLink()) continue;
    const rel = dirRel ? path.join(dirRel, d.name) : d.name;
    if (d.isDirectory()) {
      if (ignorarPasta(d.name, { git })) continue;
      if (!percorrer(rel)) return false;
    } else if (d.isFile()) {
      if (!processar(rel)) return false;
    }
  }
  return true;
}

if (lista) { for (const rel of lista) if (!processar(rel)) break; } else percorrer('');
parentPort.postMessage({ tipo: 'fim', pulados, parcial });

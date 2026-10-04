/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Leitura barata e limitada para o seletor de conversas (Claude Code e Codex): só o início ou o fim de um
// arquivo, sempre assíncrona (um UNC de distro WSL pode travar) e com tempo total. Nada daqui lança.

const fs = require('fs');

// Primeiros `bytes` do arquivo. { texto, cheio } (cheio = a leitura encheu o limite, o fim pode estar cortado)
async function lerInicio(file, bytes, fsp = fs.promises) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return { texto: buf.toString('utf8', 0, bytesRead), cheio: bytesRead === bytes };
  } catch { return null; } finally { try { await fh?.close(); } catch { /* já fechado */ } }
}

// Últimos `max` bytes (ou o arquivo inteiro, se menor), sem a primeira linha quando ela ficou cortada
async function lerFim(file, max, fsp = fs.promises) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const inicio = Math.max(0, size - max);
    const buf = Buffer.alloc(size - inicio);
    const { bytesRead } = await fh.read(buf, 0, buf.length, inicio);
    const texto = buf.toString('utf8', 0, bytesRead);
    return inicio > 0 ? texto.slice(texto.indexOf('\n') + 1) : texto;
  } catch { return null; } finally { try { await fh?.close(); } catch { /* já fechado */ } }
}

// Roda `trabalho` até `ms`; quem chama guarda o que já tem em variáveis de fora e as lê depois
async function comLimite(ms, trabalho) {
  let t;
  const limite = new Promise(r => { t = setTimeout(r, ms); }); // sem unref: mantém o laço vivo se o UNC pendurar
  try { await Promise.race([Promise.resolve().then(trabalho).catch(() => { /* devolve o parcial */ }), limite]); } finally { clearTimeout(t); }
}

// Executa `fn` sobre `itens` em lotes de `n`, parando quando `vivo()` fica falso
async function emLotes(itens, n, vivo, fn) {
  for (let i = 0; i < itens.length && vivo(); i += n) await Promise.all(itens.slice(i, i + n).map(fn));
}

// Linhas JSON de um texto, ignorando as que não fecham (quebradas ou cortadas)
function linhasJson(texto, descartaUltima) {
  const linhas = String(texto || '').split('\n');
  if (descartaUltima) linhas.pop();
  const out = [];
  for (const l of linhas) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o && typeof o === 'object') out.push(o); } catch { /* linha quebrada */ }
  }
  return out;
}

module.exports = { lerInicio, lerFim, comLimite, emLotes, linhasJson };

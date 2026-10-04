/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Limites do Codex para a barra de título, em leitura leve (a cada 60 s, por ambiente).
// Não usa aggregateCodex (varre 90 dias e calcula custo): lista os rollouts dos últimos 8 dias
// (a janela é semanal), ordena por mtime decrescente (o nome traz a data de INÍCIO da sessão, e a
// sessão vive horas), lê só o final de cada arquivo e para no primeiro que tem rate_limits.
// O resultado de cada rollout fica em cache por caminho + mtime + tamanho. Tudo assíncrono
// (fs.promises): no UNC do WSL uma leitura síncrona travaria a janela.

const fs = require('fs');
const path = require('path');
const { parseRolloutText, janela } = require('./codex-parser');

const DIAS = 8;
const CAUDA = 1024 * 1024; // bytes lidos do final de cada rollout
const CACHE_MAX = 64;
let cache = new Map(); // `${caminho}|${mtimeMs}|${size}` -> { limits, at }
const _limpaCache = () => { cache = new Map(); };

// As sessões ficam em AAAA/MM/DD (data de INÍCIO). Antes de qualquer stat, descarta as pastas de
// ano, mês e dia cujo fim já passou do corte (com 2 dias de folga: fuso e sessão que atravessa a
// meia-noite). Nome fora do padrão numérico é percorrido, por segurança.
const FOLGA = 2 * 86400000;
function dentroDoCorte(nome, nivel, partes, corte) {
  if (!/^\d+$/.test(nome) || nivel > 2) return true;
  const n = Number(nome);
  const fim = nivel === 0 ? Date.UTC(n + 1, 0, 1)
    : nivel === 1 ? Date.UTC(partes[0], n, 1)
    : Date.UTC(partes[0], partes[1] - 1, n + 1);
  return fim + FOLGA >= corte;
}

async function recentes(dir, corte, out = [], nivel = 0, partes = []) {
  let entradas;
  try { entradas = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dentroDoCorte(e.name, nivel, partes, corte)) await recentes(p, corte, out, nivel + 1, [...partes, Number(e.name)]);
    } else if (e.name.endsWith('.jsonl')) {
      try {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs >= corte) out.push({ p, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* sumiu */ }
    }
  }
  return out;
}

async function lerCauda(arquivo, size, cauda) {
  const fh = await fs.promises.open(arquivo, 'r');
  try {
    const tam = Math.min(size, cauda);
    const buf = Buffer.alloc(tam);
    await fh.read(buf, 0, tam, size - tam);
    return buf.toString('utf8');
  } finally { await fh.close(); }
}

// 10080 min vira weekly_all e 300 vira session; qualquer outra janela (ou nula) fica de fora.
// Quem é "primary" não é assumido: vale a duração da janela.
function normalizaLimitesCodex(l) {
  if (!l) return [];
  const itens = [];
  for (const w of [l.primary, l.secondary]) {
    if (!w || !Number.isFinite(w.percent)) continue;
    const kind = w.windowMinutes === 10080 ? 'weekly_all' : w.windowMinutes === 300 ? 'session' : null;
    if (kind) itens.push({ kind, percent: w.percent, resetsAt: w.resetsAt ?? null });
  }
  return itens; // a ordem de exibição é de estadoConsumo
}

// sessionsDir: pasta `sessions` de UM ambiente. deps (testes): ler(arquivo, size), cauda, agora.
// → { limits: [{ kind, percent, resetsAt }], fetchedAt } (limits vazio se não há leitura)
async function limitesLeves(sessionsDir, deps = {}) {
  const corte = (deps.agora ?? Date.now()) - DIAS * 86400000;
  const ler = deps.ler || ((f, size) => lerCauda(f, size, deps.cauda || CAUDA));
  const arquivos = (await recentes(sessionsDir, corte)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const a of arquivos) {
    const chave = `${a.p}|${a.mtimeMs}|${a.size}`;
    let r = cache.get(chave);
    if (!r) {
      try {
        const lido = parseRolloutText(await ler(a.p, a.size), { soLimites: true });
        const l = lido.limits;
        r = { limits: l ? { primary: janela(l.primary), secondary: janela(l.secondary) } : null, at: lido.limitsAt };
      } catch { r = { limits: null, at: 0 }; }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(chave, r);
    }
    if (r.limits) return { limits: normalizaLimitesCodex(r.limits), fetchedAt: r.at || null };
  }
  return { limits: [], fetchedAt: null };
}

module.exports = { limitesLeves, normalizaLimitesCodex, _limpaCache };

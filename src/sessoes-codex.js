/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Conversas do Codex de uma pasta, para o seletor do terminal novo. Percorre
// sessions/AAAA/MM/DD/rollout-<ISO>-<uuid>.jsonl do ambiente do terminal e lê só a primeira linha
// (session_meta: id, cwd, timestamp), com tempo total limitado e cache em memória por caminho+mtime+tamanho
// (o session_meta não muda). Não lê SQLite. Nada além de { provedor, id, titulo, quando } sai daqui, e nada é
// gravado em disco. Quem escolhe as raízes (Windows ou uma distro) é o chamador; nunca mistura ambientes.

const fs = require('fs');
const path = require('path');
const E = require('../renderer/sessoes-escolha');
const { lerInicio, lerFim, comLimite, emLotes, linhasJson } = require('./sessoes-io');

const ROLLOUT = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const META_MAX = 64 * 1024;
const INDICE_MAX = 8 * 1024 * 1024;
const CACHE_MAX = 20000;
const cache = new Map(); // caminho|mtime|tamanho -> { id, cwd, quando, sub } | null
const _limpaCache = () => cache.clear();

const preenchido = v => (v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);

function daPayload(p, mtimeMs) {
  if (!p || typeof p !== 'object') return null;
  const sub = preenchido(p.subagent) || preenchido(p.thread_spawn) || preenchido(p.source && p.source.subagent);
  const ts = Date.parse(p.timestamp);
  return { id: p.id, cwd: p.cwd, quando: Number.isFinite(ts) ? ts : mtimeMs, sub };
}

// A primeira linha pode passar da janela (o payload tem campos grandes): id, cwd e timestamp saem do prefixo
function doPrefixo(texto, mtimeMs) {
  if (!/"type"\s*:\s*"session_meta"/.test(texto)) return null;
  const p = texto.indexOf('"payload"');
  if (p < 0) return null;
  const resto = texto.slice(p);
  const str = re => { const m = re.exec(resto); if (!m) return null; try { return JSON.parse(m[1]); } catch { return null; } };
  const id = str(/"id"\s*:\s*("(?:[^"\\]|\\.)*")/);
  const cwd = str(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/);
  const ts = Date.parse(str(/"timestamp"\s*:\s*("(?:[^"\\]|\\.)*")/));
  if (!id || !cwd) return null;
  return { id, cwd, quando: Number.isFinite(ts) ? ts : mtimeMs, sub: /"subagent"\s*:\s*(?!null|false|"")/.test(resto) };
}

async function lerMeta(file, st, fsp) {
  const chave = `${file}|${st.mtimeMs}|${st.size}`;
  if (cache.has(chave)) return cache.get(chave);
  const ini = await lerInicio(file, META_MAX, fsp);
  if (!ini) return null; // falha de leitura não entra no cache
  let meta = null;
  const nl = ini.texto.indexOf('\n');
  if (nl >= 0 || !ini.cheio) {
    const [o] = linhasJson(nl >= 0 ? ini.texto.slice(0, nl) : ini.texto);
    meta = o && o.type === 'session_meta' ? daPayload(o.payload, st.mtimeMs) : null;
  } else {
    meta = doPrefixo(ini.texto, st.mtimeMs);
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(chave, meta);
  return meta;
}

// Arquivos rollout-*.jsonl sob `dir`, pastas e nomes em ordem decrescente (os mais novos primeiro)
async function arquivos(dir, fsp, vivo, prof = 0, out = []) {
  if (prof > 4 || !vivo()) return out;
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  ents.sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const e of ents) {
    if (e.isDirectory()) await arquivos(path.join(dir, e.name), fsp, vivo, prof + 1, out);
    else if (e.isFile()) { const m = ROLLOUT.exec(e.name); if (m) out.push({ file: path.join(dir, e.name), id: m[1] }); }
  }
  return out;
}

async function titulos(home, ids, fsp) {
  const out = new Map();
  const hist = await lerFim(path.join(home, 'history.jsonl'), INDICE_MAX, fsp);
  for (const o of linhasJson(hist)) {
    if (typeof o.session_id === 'string' && ids.has(o.session_id) && !out.has(o.session_id) && typeof o.text === 'string') out.set(o.session_id, o.text);
  }
  if ([...ids].some(i => !out.has(i))) {
    const idx = await lerFim(path.join(home, 'session_index.jsonl'), INDICE_MAX, fsp);
    for (const o of linhasJson(idx)) {
      if (typeof o.id === 'string' && ids.has(o.id) && !out.has(o.id) && typeof o.thread_name === 'string') out.set(o.id, o.thread_name);
    }
  }
  return out;
}

// raizes: [{ sessions }] do ambiente do terminal (history.jsonl e session_index.jsonl ficam ao lado de sessions)
// -> { itens: [{ provedor, id, titulo, quando }], total }
async function listarCodex({ cwd, raizes = [], limite = E.VISIVEIS, todas = false, tempoMs = 6000, deps = {} } = {}) {
  if (!cwd || !raizes.length) return { itens: [], total: 0 };
  const fsp = deps.fsp || fs.promises;
  const fim = Date.now() + tempoMs;
  const vivo = () => Date.now() < fim;
  const achados = new Map(); // id -> { id, quando, sessions }
  let escolhidos = [], total = 0;
  const tit = new Map(); // sessions -> Map(id -> texto)

  await comLimite(tempoMs, async () => {
    for (const r of raizes) {
      const lista = await arquivos(r.sessions, fsp, vivo);
      await emLotes(lista, 16, vivo, async ({ file, id }) => {
        try {
          const meta = await lerMeta(file, await fsp.stat(file), fsp);
          if (!meta || meta.sub || meta.id !== id || !E.idValido(id) || !E.mesmaPasta(meta.cwd, cwd)) return;
          const antigo = achados.get(id);
          if (!antigo || meta.quando > antigo.quando) achados.set(id, { id, quando: meta.quando, sessions: r.sessions });
        } catch { /* sumiu ou ilegível */ }
      });
    }
    const ordem = E.ordenarRecentes([...achados.values()]);
    total = ordem.length;
    escolhidos = todas ? ordem : ordem.slice(0, limite);
    for (const sessions of new Set(escolhidos.map(s => s.sessions))) {
      if (!vivo()) break;
      tit.set(sessions, await titulos(path.dirname(sessions), new Set(escolhidos.filter(s => s.sessions === sessions).map(s => s.id)), fsp));
    }
  });

  if (!escolhidos.length && achados.size) escolhidos = E.ordenarRecentes([...achados.values()]).slice(0, todas ? undefined : limite);
  return {
    itens: escolhidos.map(s => ({ provedor: 'codex', id: s.id, quando: s.quando, titulo: E.escolherTitulo({ historico: tit.get(s.sessions)?.get(s.id) }) })),
    total: Math.max(total, achados.size),
  };
}

module.exports = { listarCodex, _limpaCache };

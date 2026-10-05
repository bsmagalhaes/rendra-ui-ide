/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Conversas do Claude Code de uma pasta, para o seletor do terminal novo. Lê só o que a lista mostra:
// `stat` de todos os <uuid>.jsonl da pasta do projeto, e os primeiros 16 KB dos mais recentes (os demais
// só quando se pede "todas"). Nunca usa parseClaudeJsonl (lê o arquivo inteiro). Nada além de
// { provedor, id, titulo, quando } sai daqui, e nada é gravado em disco. Quem escolhe as raízes (Windows ou
// uma distro) é o chamador; este módulo nunca mistura ambientes.

const fs = require('fs');
const path = require('path');
const E = require('../renderer/sessoes-escolha');
const { lerInicio, lerFim, comLimite, emLotes, linhasJson } = require('./sessoes-io');

const ARQUIVO = /^(.+)\.jsonl$/;
const HISTORICO_MAX = 8 * 1024 * 1024;

// Nome da pasta do projeto: todo caractere fora de [A-Za-z0-9] vira "-" (F11)
const pastaCodificada = cwd => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');

// Texto da mensagem do usuário (string, ou o primeiro bloco de texto de um array); vazio para meta do CLI
function textoDaMensagem(o) {
  if (!o || o.isMeta) return '';
  const c = o.message && o.message.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b && b.type === 'text' && typeof b.text === 'string') || {}).text : '';
  if (typeof t !== 'string') return '';
  const s = t.trimStart();
  return /^(<command-|<local-command|Caveat:)/.test(s) ? '' : t;
}

function cabecalho({ texto, cheio }) {
  let customTitle = '', primeira = '';
  for (const o of linhasJson(texto, cheio)) {
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') customTitle = o.customTitle;
    else if (!primeira && o.type === 'user') primeira = textoDaMensagem(o);
  }
  return { customTitle, primeira };
}

// display da primeira linha de cada sessionId, só dos ids pedidos (casa só por sessionId, sem filtrar project)
async function lerHistorico(file, ids, fsp) {
  const texto = await lerFim(file, HISTORICO_MAX, fsp);
  const out = new Map();
  if (!texto) return out;
  for (const o of linhasJson(texto)) {
    if (typeof o.sessionId === 'string' && ids.has(o.sessionId) && !out.has(o.sessionId) && typeof o.display === 'string') out.set(o.sessionId, o.display);
  }
  return out;
}

// raizes: [{ projects }] do ambiente do terminal (a pasta do histórico é a irmã de `projects`).
// -> { itens: [{ provedor, id, titulo, quando }], total }
async function listarClaude({ cwd, raizes = [], limite = E.VISIVEIS, todas = false, tempoMs = 6000, bytes = 16384, deps = {} } = {}) {
  if (!cwd || !raizes.length) return { itens: [], total: 0 };
  const fsp = deps.fsp || fs.promises;
  const fim = Date.now() + tempoMs;
  const vivo = () => Date.now() < fim;
  const cod = pastaCodificada(cwd);
  const semCaixa = E.caixaInsensivel(cwd);
  const candidatos = new Map(); // id -> { id, file, quando, projects }
  let total = 0;
  const lidos = []; // { id, quando, projects, customTitle, primeira }
  const hist = new Map(); // arquivo de histórico -> Map(sessionId -> display)

  await comLimite(tempoMs, async () => {
    for (const r of raizes) {
      let nomes;
      try { nomes = await fsp.readdir(r.projects); } catch { continue; }
      for (const nome of nomes.filter(n => n === cod || (semCaixa && n.toLowerCase() === cod.toLowerCase()))) {
        const dir = path.join(r.projects, nome);
        let ents;
        try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
        const arqs = ents.filter(e => e.isFile()).map(e => ({ e, m: ARQUIVO.exec(e.name) })).filter(x => x.m && E.idValido(x.m[1]));
        await emLotes(arqs, 32, vivo, async ({ e, m }) => {
          try {
            const st = await fsp.stat(path.join(dir, e.name));
            const antigo = candidatos.get(m[1]);
            if (!antigo || st.mtimeMs > antigo.quando) candidatos.set(m[1], { id: m[1], file: path.join(dir, e.name), quando: st.mtimeMs, projects: r.projects });
          } catch { /* sumiu */ }
        });
      }
    }
    const ordem = E.ordenarRecentes([...candidatos.values()]);
    total = ordem.length;
    await emLotes(todas ? ordem : ordem.slice(0, limite), 8, vivo, async c => {
      const ini = await lerInicio(c.file, bytes, fsp);
      if (ini) lidos.push({ ...c, ...cabecalho(ini) });
    });
    const sem = lidos.filter(l => !l.customTitle && !l.primeira);
    for (const projects of new Set(sem.map(l => l.projects))) {
      if (!vivo()) break;
      const arq = path.join(path.dirname(projects), 'history.jsonl');
      hist.set(projects, await lerHistorico(arq, new Set(sem.filter(l => l.projects === projects).map(l => l.id)), fsp));
    }
  });

  const itens = E.ordenarRecentes(lidos.map(l => ({
    provedor: 'claude', id: l.id, quando: l.quando,
    titulo: E.escolherTitulo({ customTitle: l.customTitle, primeiraMensagem: l.primeira, historico: hist.get(l.projects)?.get(l.id) }),
  })));
  return { itens, total };
}

module.exports = { listarClaude, pastaCodificada };

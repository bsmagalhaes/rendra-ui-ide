/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Reads the official price pages and turns their tables into pricing entries.
//   Claude: https://platform.claude.com/docs/pt-BR/about-claude/pricing  (USD per 1M tokens)
//   Codex:  https://learn.chatgpt.com/docs/pricing                        (credits per 1M tokens)
// Tables are located by their column headers, not their position, so the parser survives the
// pages being reordered. If a page changes shape, it throws and the user edits prices by hand.

const SOURCES = {
  claude: 'https://platform.claude.com/docs/pt-BR/about-claude/pricing',
  codex: 'https://learn.chatgpt.com/docs/pricing',
};

const decode = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// [{ heading, rows: [[cell…]…] }] for every <table>, with the closest heading above it
function tablesOf(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 20000), m.index);
    const heads = [...before.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)];
    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)]
      .map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => decode(c[1])));
    out.push({ heading: heads.length ? decode(heads[heads.length - 1][1]) : '', rows });
  }
  return out;
}

const num = s => {
  const m = String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// "Claude Opus 5.5 For long-running…" → { label: "Claude Opus 5.5", pattern: "claude-opus-5-5" }
// Claude 3.x ids put the version first ("Claude Haiku 3.5" → "claude-3-5-haiku")
function claudeModel(cell) {
  const m = cell.match(/Claude\s+([A-Za-z]+)\s+(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const family = m[1].toLowerCase();
  const ver = m[2].replace('.', '-');
  const pattern = m[2].startsWith('3') ? `claude-${ver}-${family}` : `claude-${family}-${ver}`;
  return { label: `Claude ${m[1]} ${m[2]}`, pattern };
}

function parseClaude(html) {
  const tables = tablesOf(html);
  const main = tables.find(t => t.rows.some(r => r.join(' ').match(/5m writes/i) && r.join(' ').match(/1h writes/i)));
  if (!main) throw new Error('Tabela de preços dos modelos não encontrada na página da Anthropic');
  const entries = [];
  for (const r of main.rows) {
    if (r.length < 6) continue;
    const model = claudeModel(r[0]);
    if (!model) continue;
    const [input, output, cacheWrite, cacheWrite1h, cacheRead] = r.slice(1, 6).map(num);
    if ([input, output, cacheWrite, cacheWrite1h, cacheRead].some(v => v == null)) continue;
    entries.push({ ...model, input, output, cacheWrite, cacheWrite1h, cacheRead });
  }
  if (entries.length < 3) throw new Error('Não foi possível ler os preços dos modelos Claude');

  // Fast mode table (3 columns: model, input, output); a row may list several models
  const fast = tables.find(t => /r[aá]pido|fast/i.test(t.heading) && t.rows.some(r => r.length === 3));
  for (const r of fast?.rows || []) {
    if (r.length !== 3) continue;
    const [fi, fo] = [num(r[1]), num(r[2])];
    if (fi == null || fo == null) continue;
    for (const part of r[0].split('/')) {
      const model = claudeModel(part);
      const e = model && entries.find(x => x.pattern === model.pattern);
      if (e) { e.fastInput = fi; e.fastOutput = fo; }
    }
  }
  return entries;
}

function parseCodex(html) {
  const tables = tablesOf(html);
  const t = tables.find(x => x.rows.some(r => /credits per 1m tokens/i.test(r[0] || '')));
  if (!t) throw new Error('Tabela de créditos por token não encontrada na página do Codex');
  const entries = [];
  for (const r of t.rows) {
    if (r.length < 4 || /credits per 1m/i.test(r[0])) continue;
    const [input, cachedInput, output] = r.slice(1, 4).map(num);
    if ([input, cachedInput, output].some(v => v == null)) continue;
    const label = r[0].trim();
    const pattern = label.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, '-');
    entries.push({ label, pattern, input, cachedInput, output });
  }
  if (entries.length < 2) throw new Error('Não foi possível ler os créditos por token do Codex');
  return entries;
}

async function fetchPrices(which) {
  const url = SOURCES[which];
  if (!url) throw new Error(`Fonte desconhecida: ${which}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 RendraIDE' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`A página respondeu HTTP ${res.status}`);
  const html = await res.text();
  return { url, entries: which === 'claude' ? parseClaude(html) : parseCodex(html) };
}

module.exports = { fetchPrices, parseClaude, parseCodex, SOURCES };

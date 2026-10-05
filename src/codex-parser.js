/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Codex CLI (OpenAI) usage from its local session logs:
//   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl   (or $CODEX_HOME/sessions)
// Each line is { timestamp, type, payload }. Usage arrives as
//   type "event_msg", payload.type "token_count", payload.info.{total_token_usage,last_token_usage}
// with payload.rate_limits (primary/secondary windows). The model and folder come from
// "turn_context" / "session_meta" lines. Codex repeats token_count with unchanged totals,
// so per-turn usage is taken as the growth of total_token_usage (last_token_usage as fallback).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { calcCodexCredits, codexCreditUsd } = require('./pricer');

const LOOKBACK_DAYS = 90;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function listRollouts(dir, cutoff, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listRollouts(p, cutoff, out);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= cutoff) out.push(p); } catch { /* vanished */ }
    }
  }
  return out;
}

const usageOf = u => ({
  input: u?.input_tokens || 0,
  cached: u?.cached_input_tokens || 0,
  output: u?.output_tokens || 0,
  reasoning: u?.reasoning_output_tokens || 0,
});
const minus = (a, b) => ({ input: a.input - b.input, cached: a.cached - b.cached, output: a.output - b.output, reasoning: a.reasoning - b.reasoning });
const isZero = u => !u.input && !u.cached && !u.output && !u.reasoning;

function parseRollout(file) {
  return parseRolloutText(fs.readFileSync(file, 'utf8'));
}

// text: o conteúdo (ou o final) de um rollout. soLimites: só o rate_limits mais recente, sem somar
// uso (leitura leve da barra de título, que lê só o final do arquivo)
function parseRolloutText(text, { soLimites = false } = {}) {
  const records = [];
  let model = 'unknown';
  let cwd = null;
  let prevTotal = null;
  let limits = null;
  let limitsAt = 0;
  for (const line of text.split('\n')) {
    if (!line || (!line.includes('token_count') && !line.includes('turn_context') && !line.includes('session_meta'))) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {};
    if (o.type === 'session_meta') { cwd = p.cwd || cwd; continue; }
    if (o.type === 'turn_context') { model = p.model || model; cwd = p.cwd || cwd; continue; }
    if (o.type !== 'event_msg' || p.type !== 'token_count') continue;
    const ts = Date.parse(o.timestamp) || 0;
    if (p.rate_limits && ts >= limitsAt) { limits = p.rate_limits; limitsAt = ts; }
    if (soLimites || !p.info) continue;
    const total = usageOf(p.info.total_token_usage);
    let delta;
    if (prevTotal && total.input >= prevTotal.input && total.output >= prevTotal.output) delta = minus(total, prevTotal);
    else delta = usageOf(p.info.last_token_usage); // first event, or totals reset
    prevTotal = total;
    if (isZero(delta)) continue; // repeated snapshot
    records.push({ ts, model, ...delta });
  }
  return { records, cwd, limits, limitsAt };
}

// janela de limite do Codex: resets_at vem em segundos
const janela = w => w && ({ percent: w.used_percent ?? 0, windowMinutes: w.window_minutes ?? null, resetsAt: w.resets_at ? w.resets_at * 1000 : null });

function dayKey(ts) { return new Date(ts).toLocaleDateString('en-CA'); }

// opts.home: pasta .codex do Windows (padrão: CODEX_HOME ou ~/.codex); opts.extraSessionDirs: pastas
// `sessions` de outros ambientes onde o terminal roda o Codex (distros WSL). Um arquivo de
// sessão (nome rollout-<data>-<id>.jsonl) que aparece em mais de um lugar conta uma vez só.
function aggregateCodex(opts = {}) {
  const home = opts.home || codexHome();
  const sessionsDir = path.join(home, 'sessions');
  const extras = (opts.extraSessionDirs || []).filter(d => fs.existsSync(d));
  if (!fs.existsSync(sessionsDir) && !extras.length) return { available: false, home };
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  const vistos = new Set();
  const files = [sessionsDir, ...extras].flatMap(d => listRollouts(d, cutoff))
    .filter(f => { const k = path.basename(f); if (vistos.has(k)) return false; vistos.add(k); return true; });

  const daily = new Map();
  const models = new Map();
  const projects = new Map();
  const sessions = [];
  const totals = { input: 0, cached: 0, output: 0, reasoning: 0, cost: 0 };
  // cost = tokens x per-token price. Codex publishes prices in credits per 1M tokens; with a
  // US$-per-credit value set on the Preços page the cost is shown in US$, otherwise in credits
  const rate = codexCreditUsd();
  const unit = rate ? 'USD' : 'credits';
  let limits = null;
  let limitsAt = 0;

  for (const file of files) {
    let parsed;
    try { parsed = parseRollout(file); } catch { continue; }
    if (parsed.limits && parsed.limitsAt >= limitsAt) { limits = parsed.limits; limitsAt = parsed.limitsAt; }
    if (!parsed.records.length) continue;
    const project = parsed.cwd ? path.basename(parsed.cwd) || parsed.cwd : '(sem pasta)';
    const s = { project, input: 0, output: 0, cost: 0, model: 'unknown', lastTs: 0, file };
    for (const r of parsed.records) {
      if (r.ts < cutoff) continue;
      // cached input is billed separately (cheaper) and is part of input_tokens
      const cost = calcCodexCredits(r.model, r.input, r.cached, r.output) * (rate || 1);
      totals.input += r.input; totals.cached += r.cached; totals.output += r.output; totals.reasoning += r.reasoning; totals.cost += cost;
      const d = daily.get(dayKey(r.ts)) || { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 };
      d.inputTokens += r.input; d.outputTokens += r.output; d.totalTokens += r.input + r.output; d.estimatedCostUSD += cost;
      daily.set(dayKey(r.ts), d);
      const m = models.get(r.model) || { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 };
      m.inputTokens += r.input; m.outputTokens += r.output; m.estimatedCostUSD += cost;
      models.set(r.model, m);
      s.input += r.input; s.output += r.output; s.cost += cost; s.model = r.model; s.lastTs = Math.max(s.lastTs, r.ts);
    }
    if (!s.lastTs) continue;
    sessions.push(s);
    const pr = projects.get(project) || { name: project, sessionCount: 0, totalTokens: 0, estimatedCostUSD: 0 };
    pr.sessionCount++; pr.totalTokens += s.input + s.output; pr.estimatedCostUSD += s.cost;
    projects.set(project, pr);
  }

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    days.push({ date: key, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, ...(daily.get(key) || { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 }) });
  }

  return {
    available: sessions.length > 0,
    home,
    totalSessions: sessions.length,
    totalInputTokens: totals.input,
    totalCachedInputTokens: totals.cached,
    totalOutputTokens: totals.output,
    totalReasoningTokens: totals.reasoning,
    totalTokens: totals.input + totals.output,
    estimatedCostUSD: totals.cost, // in costUnit
    costUnit: unit,
    daily: days,
    modelBreakdown: Object.fromEntries(models),
    projectBreakdown: [...projects.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    recentSessions: sessions.sort((a, b) => b.lastTs - a.lastTs).slice(0, 10)
      .map(s => ({ project: s.project, mtime: s.lastTs, totalTokens: s.input + s.output, model: s.model })),
    limits: limits ? { primary: janela(limits.primary), secondary: janela(limits.secondary), at: limitsAt } : null,
  };
}

module.exports = { aggregateCodex, parseRollout, parseRolloutText, janela, codexHome };

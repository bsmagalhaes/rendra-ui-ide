/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Cost calculation for Claude Code and Codex usage.
//
// Prices come from pricing.json (bundled defaults) overridden by the user's table saved from the
// "Preços" page (pricing-user.json in the app data folder, set with setPricingFile). The user file
// is re-read whenever it changes, so edits apply to the next scan without restarting.
//
// Claude (USD per 1M tokens), per https://platform.claude.com/docs/pt-BR/about-claude/pricing:
//   input · output · cacheWrite (5-minute write, 1.25x input) · cacheWrite1h (1-hour write, 2x input)
//   cacheRead (hits/refreshes) · fastInput/fastOutput (fast mode) · webSearchPer1k (server web search)
// Codex (credits per 1M tokens), per https://learn.chatgpt.com/docs/pricing:
//   input · cachedInput · output; optional codexCreditUsd converts credits to USD.

const fs = require('fs');
const path = require('path');

const M = 1_000_000;
const BUNDLED = path.join(__dirname, '..', 'pricing.json');
let userFile = null;
let table = null;
let loadedFrom = null; // `${file}:${mtime}` of what's in `table`

// Called by the scan worker before every scan: the table is always re-read, so a save on the
// Preços page applies to the very next calculation (an mtime check alone proved unreliable
// right after the write on Windows)
function setPricingFile(file) {
  userFile = file;
  table = null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadPricing() {
  let key = 'bundled';
  if (userFile) {
    try { key = `${userFile}:${fs.statSync(userFile).mtimeMs}`; } catch { key = 'bundled'; }
  }
  if (table && loadedFrom === key) return table;
  const bundled = readJson(BUNDLED) || {};
  const user = key === 'bundled' ? null : readJson(userFile);
  table = {
    claude: user?.claude?.length ? user.claude : (bundled.claude || []),
    codex: user?.codex?.length ? user.codex : (bundled.codex || []),
    codexCreditUsd: user && 'codexCreditUsd' in user ? user.codexCreditUsd : (bundled.codexCreditUsd ?? null),
    webSearchPer1k: user?.webSearchPer1k ?? bundled.webSearchPer1k ?? 10,
  };
  loadedFrom = key;
  return table;
}

// Longest pattern contained in the model id wins ("claude-opus-5-5" beats "claude-opus-5")
function bestMatch(entries, modelName) {
  const model = String(modelName || '').toLowerCase().replace(/[\s_]+/g, '-');
  let best = null;
  for (const e of entries) {
    if (e.pattern === 'default') continue;
    if (model.includes(e.pattern) && (!best || e.pattern.length > best.pattern.length)) best = e;
  }
  return best || entries.find(e => e.pattern === 'default') || null;
}

function getClaudePrice(modelName) {
  return bestMatch(loadPricing().claude, modelName) || { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
}

// Cost of one Claude API response as recorded by Claude Code
function calcClaudeRecordCost(rec) {
  const p = getClaudePrice(rec.model);
  const fast = rec.fast && p.fastInput != null;
  // fast mode: cache multipliers apply on top of the fast input rate
  const inRate = fast ? p.fastInput : p.input;
  const outRate = fast && p.fastOutput != null ? p.fastOutput : p.output;
  const scale = p.input ? inRate / p.input : 1;
  const write5m = (p.cacheWrite ?? p.input * 1.25) * scale;
  const write1h = (p.cacheWrite1h ?? p.input * 2) * scale;
  const read = (p.cacheRead ?? p.input * 0.1) * scale;
  const w1h = Math.min(rec.cacheWrite1hTokens || 0, rec.cacheWriteTokens || 0);
  const w5m = (rec.cacheWriteTokens || 0) - w1h;
  return (rec.inputTokens / M) * inRate
    + (rec.outputTokens / M) * outRate
    + ((rec.cacheReadTokens || 0) / M) * read
    + (w5m / M) * write5m
    + (w1h / M) * write1h
    + ((rec.webSearches || 0) / 1000) * loadPricing().webSearchPer1k;
}

// Kept for callers that only have the four token counts (treated as 5-minute cache writes)
function calcClaudeCost(modelName, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) {
  return calcClaudeRecordCost({ model: modelName, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });
}

// How much cache reads saved vs paying full input price
function calcCacheSavings(modelName, cacheReadTokens) {
  const p = getClaudePrice(modelName);
  const read = p.cacheRead ?? p.input * 0.1;
  return (cacheReadTokens / M) * (p.input - read);
}

// Codex: returns credits (input_tokens already includes cached_input_tokens)
function getCodexPrice(modelName) {
  return bestMatch(loadPricing().codex, modelName) || { input: 125, cachedInput: 12.5, output: 750 };
}

function calcCodexCredits(modelName, inputTokens, cachedInputTokens, outputTokens) {
  const p = getCodexPrice(modelName);
  const cached = Math.min(cachedInputTokens, inputTokens);
  return ((inputTokens - cached) / M) * p.input + (cached / M) * (p.cachedInput ?? p.input) + (outputTokens / M) * p.output;
}

const codexCreditUsd = () => {
  const v = loadPricing().codexCreditUsd;
  return typeof v === 'number' && v > 0 ? v : null;
};

// Gemini support is dormant (UI hidden); keep its simple table
function calcGeminiCost(modelName, inputTokens, outputTokens) {
  const bundled = readJson(BUNDLED) || {};
  const p = bestMatch(bundled.gemini || [], modelName) || { input: 0.075, output: 0.3 };
  return (inputTokens / M) * p.input + (outputTokens / M) * p.output;
}

module.exports = {
  setPricingFile, loadPricing, getClaudePrice, getCodexPrice,
  calcClaudeRecordCost, calcClaudeCost, calcCacheSavings, calcCodexCredits, codexCreditUsd, calcGeminiCost,
};

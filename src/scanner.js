/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
const path = require('path');
const { aggregateClaude } = require('./claude-parser');
const { aggregateGemini } = require('./gemini-parser');
const { aggregateCodex } = require('./codex-parser');
const { wslRoots } = require('./wsl-roots');

function getToday(daily) {
  if (!daily || daily.length === 0) return { tokens: 0, cost: 0 };
  const todayKey = new Date().toLocaleDateString('en-CA');
  const entry = daily.find(d => d.date === todayKey);
  return entry ? { tokens: entry.totalTokens, cost: entry.estimatedCostUSD } : { tokens: 0, cost: 0 };
}

// deps (testes): home, codexHome, wslRoots (injeta raízes WSL falsas)
async function scan(settings, deps = {}) {
  // RENDRA_HOME: demo home for npm run docs:images; otherwise USERPROFILE on Windows, $HOME elsewhere
  const userProfile = process.env.RENDRA_HOME || deps.home || require('os').homedir();
  const claudeDir = settings?.claudePath || path.join(userProfile, '.claude', 'projects');
  const geminiDir = settings?.geminiPath || path.join(userProfile, '.gemini');

  const start = Date.now();
  // o terminal pode ser WSL: as sessões das distros entram junto com as do Windows (demo/RENDRA_HOME não)
  const wsl = process.env.RENDRA_HOME || process.env.RENDRA_NO_WSL ? { claude: [], codex: [] } : await (deps.wslRoots || wslRoots)();

  let claude, gemini;
  try { claude = aggregateClaude(claudeDir, settings?.filters, settings?.claudePath ? [] : wsl.claude); } catch (e) {
    claude = { available: false, dataNote: `Scan error: ${e.message}` };
  }
  try { gemini = aggregateGemini(geminiDir); } catch (e) {
    gemini = { available: false, dataNote: `Scan error: ${e.message}` };
  }
  let codex;
  try { codex = aggregateCodex({ extraSessionDirs: wsl.codex, ...(deps.codexHome ? { home: deps.codexHome } : {}) }); } catch (e) {
    codex = { available: false, dataNote: `Scan error: ${e.message}` };
  }

  const claudeToday = getToday(claude.daily);
  const geminiToday = getToday(gemini.daily);

  const combined = {
    totalTokens: (claude.totalTokens || 0) + (gemini.totalTokens || 0),
    estimatedCostUSD: (claude.estimatedCostUSD || 0) + (gemini.estimatedCostUSD || 0),
    activeCLIs: [claude.available, gemini.available].filter(Boolean).length,
    todayTokens: claudeToday.tokens + geminiToday.tokens,
    todayCost: claudeToday.cost + geminiToday.cost,
  };

  return {
    timestamp: Date.now(),
    scanDurationMs: Date.now() - start,
    claude,
    gemini,
    codex,
    combined,
  };
}

module.exports = { scan };

/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Currently logged-in Claude Code account and its plan limits.
//
// Claude Code keeps the login in two places:
//   ~/.claude/.credentials.json → { claudeAiOauth: { accessToken, subscriptionType, ... } }
//   ~/.claude.json              → { oauthAccount: { emailAddress, organizationName, ... } }
// Limits come from the same usage endpoint Claude Code's /usage screen reads, authenticated
// with the local OAuth token. Both files are re-read on every call, so a `/login` with another
// account shows up on the next refresh.

const fs = require('fs');
const path = require('path');

const HOME = process.env.RENDRA_HOME || require('os').homedir(); // RENDRA_HOME: demo home (npm run docs:images)
const CRED_FILE = path.join(HOME, '.claude', '.credentials.json');
const CONFIG_FILE = path.join(HOME, '.claude.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function describe(oauthAccount, cred) {
  return {
    email: oauthAccount.emailAddress || '',
    name: oauthAccount.displayName || oauthAccount.fullName || '',
    organization: oauthAccount.organizationName || '',
    role: oauthAccount.organizationRole || '',
    plan: cred?.subscriptionType || '',
    tier: cred?.rateLimitTier || oauthAccount.userRateLimitTier || '',
  };
}

// Identidade de um home qualquer (o da IDE ou o de uma distro WSL, lido pelo UNC). Assíncrona
// (fs.promises): um UNC lento não congela o processo principal. Devolve só campos da lista
// branca; o token das credenciais nunca sai daqui (só subscriptionType e rateLimitTier).
const readJsonAsync = async file => { try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return null; } };

async function contaClaudeDoHome(home) {
  const oauth = (await readJsonAsync(path.join(home, '.claude.json')))?.oauthAccount;
  if (!oauth) return null;
  const cred = (await readJsonAsync(path.join(home, '.claude', '.credentials.json')))?.claudeAiOauth || null;
  const { email, name, organization, plan, tier } = describe(oauth, cred);
  return { email, name, organization, plan, tier };
}

// The usage endpoint is rate limited (HTTP 429). Keep the last good answer per account and
// serve it when a request is too soon, refused or fails, instead of blanking the card.
const MIN_INTERVAL_MS = 60 * 1000;
let lastGood = null;     // { accountKey, limits, fetchedAt }
let blockedUntil = 0;    // honour Retry-After after a 429

function cachedFor(accountKey, note) {
  if (lastGood?.accountKey !== accountKey) return null;
  return { limits: lastGood.limits, fetchedAt: lastGood.fetchedAt, error: null, note };
}

async function fetchLimits(cred, accountKey) {
  if (!cred?.accessToken) return { limits: null, error: 'Sem login ativo no Claude Code' };
  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    return { limits: null, error: 'Token expirado. Abra o Claude Code para renovar.' };
  }
  const now = Date.now();
  if (lastGood?.accountKey === accountKey && now - lastGood.fetchedAt < MIN_INTERVAL_MS) {
    return cachedFor(accountKey, null);
  }
  if (now < blockedUntil) {
    return cachedFor(accountKey, 'servidor pediu uma pausa nas consultas')
      || { limits: null, error: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' };
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after'), 10);
      blockedUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 5 * 60 * 1000);
      return cachedFor(accountKey, 'servidor pediu uma pausa nas consultas')
        || { limits: null, error: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' };
    }
    if (!res.ok) {
      return cachedFor(accountKey, `falha ao atualizar (HTTP ${res.status})`)
        || { limits: null, error: `Não foi possível ler os limites (HTTP ${res.status})` };
    }
    const body = await res.json();
    const limits = (body.limits || []).map(l => ({
      kind: l.kind,
      percent: l.percent ?? 0,
      severity: l.severity || 'normal',
      resetsAt: l.resets_at ? Date.parse(l.resets_at) : null,
      model: l.scope?.model?.display_name || null,
    }));
    lastGood = { accountKey, limits, fetchedAt: Date.now() };
    return { limits, fetchedAt: lastGood.fetchedAt, error: null, note: null };
  } catch {
    return cachedFor(accountKey, 'sem conexão')
      || { limits: null, error: 'Sem conexão para ler os limites' };
  }
}

// Windows/Linux keep the OAuth token in ~/.claude/.credentials.json; macOS keeps it in the
// login Keychain under "Claude Code-credentials" (same JSON shape)
function readCredentials() {
  const fromFile = readJson(CRED_FILE)?.claudeAiOauth;
  if (fromFile || process.platform !== 'darwin') return fromFile || null;
  try {
    const out = require('child_process').execFileSync('security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', timeout: 5000 });
    return JSON.parse(out.trim())?.claudeAiOauth || null;
  } catch {
    return null;
  }
}

// ── Limits via the Claude Code statusline (default, official channel) ───────
// Claude Code sends the statusline command a JSON with `rate_limits` (five_hour / seven_day).
// src/statusline.sh saves it to ~/.rendra-ide/claude-status.json and chains the user's previous
// statusline, so no credential is ever touched. It covers the 5-hour and weekly limits and is
// refreshed while Claude Code is running.
const BRIDGE_DIR = path.join(HOME, '.rendra-ide');
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const BRIDGE_COMMAND = 'sh "$HOME/.rendra-ide/statusline.sh"';
const isBridge = sl => typeof sl?.command === 'string' && sl.command.includes('.rendra-ide/statusline.sh');

function statuslineStatus() {
  const settings = readJson(SETTINGS_FILE) || {};
  let lastAt = null;
  try { lastAt = fs.statSync(path.join(BRIDGE_DIR, 'claude-status.json')).mtimeMs; } catch { /* never ran */ }
  return { installed: isBridge(settings.statusLine), lastAt };
}

function writeJsonSafe(file, data) {
  const tmp = `${file}.rendra-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function installStatusline(scriptSource) {
  fs.mkdirSync(BRIDGE_DIR, { recursive: true });
  fs.copyFileSync(scriptSource, path.join(BRIDGE_DIR, 'statusline.sh'));
  const settings = readJson(SETTINGS_FILE) || {};
  const prev = settings.statusLine;
  if (prev && !isBridge(prev)) {
    // keep the user's own statusline running after ours, and remember it for uninstall
    fs.writeFileSync(path.join(BRIDGE_DIR, 'statusline-previous.json'), JSON.stringify(prev, null, 2));
    if (prev.type === 'command' && prev.command) fs.writeFileSync(path.join(BRIDGE_DIR, 'statusline-chain.sh'), `${prev.command}\n`);
  }
  if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.rendra-bak`);
  writeJsonSafe(SETTINGS_FILE, { ...settings, statusLine: { type: 'command', command: BRIDGE_COMMAND, ...(prev?.padding != null && { padding: prev.padding }) } });
  return statuslineStatus();
}

function uninstallStatusline() {
  const settings = readJson(SETTINGS_FILE) || {};
  if (isBridge(settings.statusLine)) {
    const prev = readJson(path.join(BRIDGE_DIR, 'statusline-previous.json'));
    const next = { ...settings };
    if (prev) next.statusLine = prev; else delete next.statusLine;
    writeJsonSafe(SETTINGS_FILE, next);
  }
  for (const f of ['statusline-chain.sh', 'statusline-previous.json']) fs.rmSync(path.join(BRIDGE_DIR, f), { force: true });
  return statuslineStatus();
}

// resets_at may come as unix seconds, milliseconds or an ISO string
const toMs = v => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) || null : null);

function statuslineLimits() {
  const file = path.join(BRIDGE_DIR, 'claude-status.json');
  const data = readJson(file);
  const rl = data?.rate_limits;
  if (!rl) {
    const st = statuslineStatus();
    return { limits: null, error: st.installed
      ? 'Aguardando o Claude Code: os limites aparecem assim que uma sessão do Claude Code atualizar a statusline'
      : 'Ative a leitura de limites para ver os limites do seu plano', needsBridge: !st.installed };
  }
  let fetchedAt = null;
  try { fetchedAt = fs.statSync(file).mtimeMs; } catch { /* gone */ }
  const limits = [];
  if (rl.five_hour) limits.push({ kind: 'session', percent: Math.round(rl.five_hour.used_percentage ?? 0), resetsAt: toMs(rl.five_hour.resets_at) });
  if (rl.seven_day) limits.push({ kind: 'weekly_all', percent: Math.round(rl.seven_day.used_percentage ?? 0), resetsAt: toMs(rl.seven_day.resets_at) });
  if (rl.spend_limit) limits.push({ kind: 'spend', label: 'Limite de gasto', percent: Math.round(rl.spend_limit.used_percentage ?? 0), resetsAt: toMs(rl.spend_limit.resets_at) });
  return { limits, fetchedAt, error: null, source: 'statusline' };
}

// mode 'statusline' (default): official statusline channel · mode 'api': opt-in, reads all limits
// (including per-model weekly ones) from the usage endpoint with the local Claude Code login
async function currentAccount(mode = 'statusline') {
  const oauthAccount = readJson(CONFIG_FILE)?.oauthAccount || null;
  const cred = readCredentials();
  const account = oauthAccount ? describe(oauthAccount, cred) : null;
  if (mode !== 'api') return { account, ...statuslineLimits() };
  const accountKey = `${oauthAccount?.accountUuid || ''}:${oauthAccount?.organizationUuid || ''}`;
  return { account, ...(await fetchLimits(cred, accountKey)), source: 'api' };
}

module.exports = { currentAccount, contaClaudeDoHome, HOME, statuslineLimits, statuslineStatus, installStatusline, uninstallStatusline };

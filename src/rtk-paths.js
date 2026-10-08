/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: caminhos dos bancos por agente, versão mínima e citação do comando do hook.
// Tudo puro (recebe plataforma, ambiente e home): nada aqui toca o disco nem executa o rtk.
// O banco do Claude é o caminho padrão do RTK; o do Codex fica numa subpasta própria, para o
// `writable_roots` do Codex liberar só ela sem abrir o banco do Claude.

const path = require('path');

const RTK_MIN = '0.50.0';

const pathOf = platform => (platform === 'win32' ? path.win32 : path.posix);

// Pasta de dados padrão do RTK (dirs::data_local_dir()/rtk); RTK_DB_PATH não entra aqui
function rtkDataDir({ platform = process.platform, env = process.env, home } = {}) {
  const p = pathOf(platform);
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'rtk');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'rtk');
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'rtk');
}
// Pasta de configuração do RTK (dirs::config_dir()/rtk): onde `rtk init -g` grava filters.toml
function rtkConfigDir({ platform = process.platform, env = process.env, home } = {}) {
  const p = pathOf(platform);
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'rtk');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'rtk');
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'rtk');
}
const claudeDbPath = o => pathOf(o.platform || process.platform).join(rtkDataDir(o), 'history.db');
const codexDbDir = o => pathOf(o.platform || process.platform).join(rtkDataDir(o), 'codex');
const codexDbPath = o => pathOf(o.platform || process.platform).join(codexDbDir(o), 'history.db');

// ── Versão ───────────────────────────────────────────────────────────────────
function parseRtkVersion(text) {
  const m = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(String(text || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}
function compareVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ── Comando do hook ──────────────────────────────────────────────────────────
// Devolve { command, note }: command nulo quando o caminho não pode ser citado com segurança.
// Windows: barras normais e, sem espaço, sem aspas (Git Bash, sh, PowerShell e cmd executam, e o
// shell_split do RTK reconhece). Com espaço só se grava a forma entre aspas se o Git Bash existe.
// Linux e WSL: caminho absoluto; `"`, `$`, crase ou barra invertida são recusados (não se tenta citar).
function hookCommand(absRtk, kind, platform = process.platform, { gitBash = false } = {}) {
  const win = platform === 'win32';
  const raw = String(absRtk || '');
  const abs = win ? /^[A-Za-z]:[\\/]/.test(raw) : raw.startsWith('/');
  if (!abs) return { command: null, note: 'O caminho do RTK precisa ser absoluto para o hook.' };
  const p = win ? raw.split('\\').join('/') : raw;
  if (/["$`]/.test(p) || (!win && p.includes('\\'))) {
    return { command: null, note: 'O caminho do RTK tem caractere que não dá para citar no hook (aspas, $, crase ou barra invertida).' };
  }
  const simples = /^[A-Za-z0-9_.:/+@,-]+$/.test(p);
  if (simples) return { command: `${p} hook ${kind}`, note: null };
  if (win && !gitBash) {
    return { command: null, note: 'O caminho do RTK tem espaço e o Git Bash não foi encontrado; o hook entre aspas só funciona nele.' };
  }
  return { command: `"${p}" hook ${kind}`, note: null };
}

// Divide como shell POSIX (o que o shell_split do RTK faz): aspas simples e duplas, barra
// invertida fora de aspas escapa; dentro de aspas duplas só escapa `"`, barra, `$` e crase.
function shellSplit(cmd) {
  const out = [];
  let cur = '';
  let has = false;
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && '"\\$`'.includes(cmd[i + 1])) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\') { cur += cmd[++i] ?? ''; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (q) return null;
  if (cur || has) out.push(cur);
  return out;
}

// Critério de `is_rtk_hook_command` (F45): três tokens [binário, "hook", agente], basename rtk ou rtk.exe
function isRtkHookCommand(cmd, kind) {
  const t = shellSplit(String(cmd || ''));
  if (!t || t.length !== 3) return false;
  const base = t[0].split(/[\\/]/).pop();
  return (base === 'rtk' || base === 'rtk.exe') && t[1] === 'hook' && t[2] === kind;
}

module.exports = {
  RTK_MIN, rtkDataDir, rtkConfigDir, claudeDbPath, codexDbDir, codexDbPath,
  parseRtkVersion, compareVersions,
  hookCommand, isRtkHookCommand, shellSplit,
};

/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Agentes (Claude Code, Codex) vivos no ambiente de um terminal: quem eles são e que conversa seguram.
// Três partes: reconhecimento puro de um processo (nunca por substring), leitura de processos por ambiente
// (Windows por CIM, Linux e WSL por /proc num único `sh`, Mac por `ps`) e a junção das duas.
//
// Id da conversa: só por token exato na linha de comando (`--resume <id>`, `-r <id>`, `--resume=<id>`,
// `--session-id <id>`, `codex resume <id>`) ou, para `claude --continue`/sem argumento, pelo metadado do próprio
// processo em `~/.claude/sessions/<pid>.json` (pid, sessionId, procStart, pidDomain: nunca o conteúdo da
// conversa). O arquivo só vale se o PID está vivo, o `procStart` confere com o início do processo e o
// `pidDomain` é o desta máquina. Sem prova, o processo fica com `id: null` e nunca é encerrado.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const E = require('../renderer/sessoes-escolha');

const NOME_DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEP = '\u001f';
const IMG_CLAUDE = /^claude(\.exe)?$/i;
const IMG_CODEX = /^codex(\.exe)?$/i;
const IMG_NODE = /^(node|nodejs|electron)(\.exe)?$/i;
const CLI_CLAUDE = /[\\/]@anthropic-ai[\\/]claude-code[\\/](?:cli|bin[\\/]claude)(?:\.m?js)?$/i;
const CLI_CODEX = /[\\/]@openai[\\/]codex[\\/]bin[\\/]codex(?:\.m?js)?$/i;
// subcomandos do claude que não abrem conversa; do codex, só `resume` e a TUI sem subcomando seguram uma
const CLAUDE_SEM_CONVERSA = new Set(['mcp', 'config', 'doctor', 'update', 'upgrade', 'install', 'migrate-installer', 'setup-token', 'plugin', 'plugins', 'api-key', 'agents', 'auth']);
const CODEX_SEM_CONVERSA = new Set(['app-server', 'mcp-server', 'mcp', 'exec', 'login', 'logout', 'proto', 'completion', 'debug', 'apply', 'sandbox', 'cloud', 'features']);

const baseNome = p => String(p || '').split(/[\\/]/).pop();

// Divide a linha de comando do Windows como o CommandLineToArgvW (aspas duplas e barras antes de aspas)
function dividirLinha(linha) {
  const out = [];
  const s = String(linha || '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let arg = '', aspas = false;
    while (i < s.length && (aspas || !/\s/.test(s[i]))) {
      let barras = 0;
      while (s[i] === '\\') { barras++; i++; }
      if (s[i] === '"') {
        arg += '\\'.repeat(Math.floor(barras / 2));
        if (barras % 2) { arg += '"'; i++; } else { aspas = !aspas; i++; }
      } else {
        arg += '\\'.repeat(barras);
        if (i < s.length && (aspas || !/\s/.test(s[i]))) { arg += s[i]; i++; }
      }
    }
    out.push(arg);
  }
  return out;
}

// { provedor, id, fork } de um processo { nome, args }, ou null se não é um agente que segura conversa
function reconhecer({ nome, args } = {}) {
  if (!Array.isArray(args) || !args.length) return null;
  const base = baseNome(args[0] || nome).toLowerCase();
  let provedor = null, resto = [];
  if (IMG_CLAUDE.test(base)) { provedor = 'claude'; resto = args.slice(1); }
  else if (IMG_CODEX.test(base)) { provedor = 'codex'; resto = args.slice(1); }
  else if (IMG_NODE.test(base)) {
    // o script é o primeiro argumento que não é opção do node: um `node cadeia.js ... cli.js` não é o agente
    const k = args.findIndex((a, i) => i > 0 && !a.startsWith('-'));
    if (k > 0 && CLI_CLAUDE.test(args[k])) { provedor = 'claude'; resto = args.slice(k + 1); }
    else if (k > 0 && CLI_CODEX.test(args[k])) { provedor = 'codex'; resto = args.slice(k + 1); }
    else return null;
  } else return null;

  if (provedor === 'claude') {
    const primeiro = resto.find(a => !a.startsWith('-'));
    if (primeiro && CLAUDE_SEM_CONVERSA.has(primeiro) && resto.indexOf(primeiro) === 0) return null;
    let resume = null, sessionId = null, fork = false;
    for (let k = 0; k < resto.length; k++) {
      const a = resto[k], prox = resto[k + 1];
      if (a === '--fork-session') fork = true;
      else if ((a === '--resume' || a === '-r') && E.idValido(prox)) resume = prox;
      else if (a.startsWith('--resume=') && E.idValido(a.slice(9))) resume = a.slice(9);
      else if (a === '--session-id' && E.idValido(prox)) sessionId = prox;
      else if (a.startsWith('--session-id=') && E.idValido(a.slice(13))) sessionId = a.slice(13);
    }
    // --fork-session grava uma conversa nova: o id do --resume não fica em uso por este processo
    const id = sessionId || (fork ? null : resume);
    return { provedor, id, fork };
  }

  const sub = resto.find(a => !a.startsWith('-'));
  if (sub && CODEX_SEM_CONVERSA.has(sub)) return null;
  if (sub === 'resume') {
    const depois = resto.slice(resto.indexOf('resume') + 1).find(a => !a.startsWith('-'));
    return { provedor, id: E.idValido(depois) ? depois : null, fork: false };
  }
  return { provedor, id: null, fork: false };
}

// ── Leitura de processos ────────────────────────────────────────────────────

// Windows: todos os processos (ou só os de certos nomes) com pai, linha de comando e início em FILETIME
const PS_LISTA = filtro => `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; `
  + `Get-CimInstance Win32_Process${filtro ? ` -Filter "${filtro}"` : ''} | ForEach-Object { [pscustomobject]@{ p=[int]$_.ProcessId; pp=[int]$_.ParentProcessId; n=$_.Name; c=$_.CommandLine; `
  + `t=$(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { $null }) } } | ConvertTo-Json -Compress`;

function executar(file, args, { timeout = 8000, execFileFn = execFile, env } = {}) {
  return new Promise(resolve => {
    try {
      execFileFn(file, args, { windowsHide: true, timeout, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}) },
        (err, stdout) => resolve(err ? null : String(stdout || '')));
    } catch { resolve(null); }
  });
}

function parsearWindows(texto) {
  let dados;
  try { dados = JSON.parse(String(texto || '').trim() || '[]'); } catch { return []; }
  if (!Array.isArray(dados)) dados = [dados];
  return dados.filter(d => d && Number.isInteger(d.p)).map(d => ({
    pid: d.p, ppid: Number.isInteger(d.pp) ? d.pp : 0, nome: String(d.n || ''), args: dividirLinha(d.c), inicio: d.t == null ? null : String(d.t), sid: null, token: null,
  }));
}

async function listarProcessosWindows({ filtro = '', execFileFn, timeout } = {}) {
  const cmd = Buffer.from(PS_LISTA(filtro), 'utf16le').toString('base64');
  const out = await executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', cmd], { execFileFn, timeout });
  return out == null ? null : parsearWindows(out);
}

// Linux e WSL: uma chamada de `sh` lê tudo de /proc (stat de todos de uma vez, nunca um fork por processo),
// a marca RENDRA_TERM só dos líderes de sessão, e os metadados `~/.claude/sessions/*.json`.
const SCRIPT_LISTA = String.raw`
printf 'B\t%s\n' "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
printf 'M\t%s\n' "$(cat /etc/machine-id 2>/dev/null)"
tab=$(cat /proc/[0-9]*/stat 2>/dev/null | awk '{pid=$1; c=$2; gsub(/[()]/,"",c); sub(/.*\) /,""); print "T\t" pid "\t" $2 "\t" $4 "\t" $20 "\t" c}')
printf '%s\n' "$tab"
cands=$(grep -laz -E 'claude|codex' /proc/[0-9]*/cmdline 2>/dev/null | sed 's#/proc/\([0-9]*\)/cmdline#\1#')
lide=$(printf '%s\n' "$tab" | awk -F'\t' '$2==$4 {print $2}')
for p in $cands $lide; do
  printf 'P\t%s\t%s\t%s\n' "$p" "$(tr '\0' '\037' < /proc/$p/cmdline 2>/dev/null | tr '\n\t' '  ')" "$(tr '\0' '\n' < /proc/$p/environ 2>/dev/null | sed -n 's/^RENDRA_TERM=//p')"
done
lersessoes() { for f in "$@"; do [ -f "$f" ] && printf 'S\t%s\n' "$(tr -d '\n' < "$f")"; done; true; }
lersessoes "$HOME"/.claude/sessions/*.json
[ -z "$RENDRA_SANDBOX" ] && lersessoes /root/.claude/sessions/*.json /home/*/.claude/sessions/*.json
true
`;

// Entrada: a saída do SCRIPT_LISTA. Saída: { procs, sessoes, bootId, machineId }
function parsearLinux(texto) {
  const procs = new Map();
  const sessoes = [];
  let bootId = '', machineId = '';
  for (const linha of String(texto || '').split('\n')) {
    const c = linha.split('\t');
    if (c[0] === 'B') bootId = (c[1] || '').trim();
    else if (c[0] === 'M') machineId = (c[1] || '').trim();
    else if (c[0] === 'T' && /^\d+$/.test(c[1])) procs.set(+c[1], { pid: +c[1], ppid: +c[2], sid: +c[3], inicio: c[4], nome: c[5] || '', args: [], token: null });
    else if (c[0] === 'P' && procs.has(+c[1])) {
      const p = procs.get(+c[1]);
      p.args = (c[2] || '').split(SEP).filter(Boolean);
      if (p.args.length) p.nome = baseNome(p.args[0]);
      p.token = (c[3] || '').trim() || null;
    } else if (c[0] === 'S') {
      try { const j = JSON.parse(c.slice(1).join('\t')); if (j && typeof j === 'object') sessoes.push(j); } catch { /* arquivo cortado: ignora */ }
    }
  }
  return { procs: [...procs.values()], sessoes, bootId, machineId };
}

async function listarProcessosLinux({ distro, execFileFn, timeout, sandboxHome } = {}) {
  const out = distro
    ? await executar('wsl.exe', ['-d', distro, '-e', 'sh', '-c', SCRIPT_LISTA], { execFileFn, timeout })
    : await executar('sh', ['-c', SCRIPT_LISTA], { execFileFn, timeout, env: sandboxHome ? { ...process.env, HOME: sandboxHome, RENDRA_SANDBOX: '1' } : undefined });
  return out == null ? null : parsearLinux(out);
}

// Mac: `ps` não dá início nem metadado de sessão; só a linha de comando (detecção por argumento)
async function listarProcessosMac({ execFileFn, timeout } = {}) {
  const out = await executar('ps', ['-axo', 'pid=,ppid=,command='], { execFileFn, timeout });
  if (out == null) return null;
  const procs = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) { const args = m[3].split(/\s+/).filter(Boolean); procs.push({ pid: +m[1], ppid: +m[2], nome: baseNome(args[0]), args, inicio: null, sid: null, token: null }); }
  }
  return { procs, sessoes: [], bootId: '', machineId: '' };
}

function lerSessoesLocais(home) {
  const dir = path.join(home, '.claude', 'sessions');
  const out = [];
  let nomes = [];
  try { nomes = fs.readdirSync(dir); } catch { return out; }
  for (const n of nomes) {
    if (!/^\d+\.json$/.test(n)) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (j && typeof j === 'object') out.push(j); } catch { /* ignora */ }
  }
  return out;
}

// Instantâneo do ambiente: { plataforma: 'win32'|'linux'|'darwin', procs, sessoes, bootId, machineId, host }
// amb: { tipo: 'windows'|'wsl', distro }; "windows" quer dizer "o sistema local" (Linux e Mac nativos incluídos)
async function listarProcessos(amb, { env = process.env, plataforma = process.platform, timeout, execFileFn, filtroWindows = '' } = {}) {
  if (amb && amb.tipo === 'wsl') {
    if (typeof amb.distro !== 'string' || !NOME_DISTRO.test(amb.distro)) return null;
    const r = await listarProcessosLinux({ distro: amb.distro, execFileFn, timeout });
    return r && { ...r, plataforma: 'linux', host: null };
  }
  if (plataforma === 'win32') {
    const procs = await listarProcessosWindows({ filtro: filtroWindows, execFileFn, timeout });
    if (!procs) return null;
    const home = env.RENDRA_HOME || os.homedir();
    return { plataforma, procs, sessoes: lerSessoesLocais(home), bootId: '', machineId: '', host: os.hostname() };
  }
  if (plataforma === 'linux') {
    const r = await listarProcessosLinux({ execFileFn, timeout, sandboxHome: env.RENDRA_HOME });
    return r && { ...r, plataforma, host: null };
  }
  if (plataforma === 'darwin') {
    const r = await listarProcessosMac({ execFileFn, timeout });
    return r && { ...r, plataforma, host: null };
  }
  return null;
}

// ── Junção ──────────────────────────────────────────────────────────────────

const TOLERANCIA_FILETIME = 20_000_000; // 2 s em unidades de 100 ns (CIM tem microssegundos)

// O `.json` de sessão vale para este processo?
function sessaoValida(j, proc, snap) {
  if (!j || Number(j.pid) !== proc.pid || !E.idValido(j.sessionId)) return false;
  const dom = String(j.pidDomain || '');
  if (snap.plataforma === 'win32') {
    if (dom.toLowerCase() !== `win32:${String(snap.host || '').toLowerCase()}`) return false;
    const a = Number(j.procStart), b = Number(proc.inicio);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= TOLERANCIA_FILETIME;
  }
  if (snap.plataforma === 'linux') {
    if (!dom.startsWith('linux:')) return false;
    if (snap.machineId && !dom.includes(snap.machineId)) return false;
    return !!proc.inicio && String(j.procStart) === String(proc.inicio);
  }
  return false; // Mac: sem prova de início, o metadado não vale
}

// Agentes do instantâneo: [{ pid, ppid, provedor, id, cwd, inicio, sid, comArgumento }]
function agentesDoInstantaneo(snap) {
  if (!snap || !Array.isArray(snap.procs)) return [];
  const porPid = new Map();
  for (const j of snap.sessoes || []) if (j && Number.isInteger(Number(j.pid))) porPid.set(Number(j.pid), j);
  const out = [];
  for (const p of snap.procs) {
    const r = reconhecer(p);
    if (!r) continue;
    let id = r.id, cwd = null, comArgumento = !!r.id;
    const j = porPid.get(p.pid);
    const valida = r.provedor === 'claude' && sessaoValida(j, p, snap);
    if (valida) { cwd = typeof j.cwd === 'string' ? j.cwd : null; if (!id) id = j.sessionId; }
    out.push({ pid: p.pid, ppid: p.ppid, provedor: r.provedor, id: id || null, cwd, inicio: p.inicio, sid: p.sid, comArgumento, fork: r.fork });
  }
  return out;
}

// Donos de uma conversa, só do que o escopo da IDE aceita:
//   claude: qualquer processo (de dentro da IDE ou de fora)
//   codex: só os que nasceram de um terminal da IDE (a trava do Codex é dele e o daemon é compartilhado)
function sidsDaIde(snap, tokens) {
  const set = new Set(tokens || []);
  const porToken = new Map();
  for (const p of snap.procs || []) {
    if (!p.token || !set.has(p.token) || p.sid !== p.pid) continue;
    const a = porToken.get(p.token);
    if (!a || Number(p.inicio) < Number(a.inicio)) porToken.set(p.token, p); // o líder é o mais antigo (um tmux filho tem início maior)
  }
  return new Set([...porToken.values()].map(p => p.sid));
}

function descendentesDe(procs, raizes) {
  const filhos = new Map();
  for (const p of procs) { if (!filhos.has(p.ppid)) filhos.set(p.ppid, []); filhos.get(p.ppid).push(p); }
  const vistos = new Set(), fila = [...raizes];
  while (fila.length) {
    const pai = fila.shift();
    for (const f of filhos.get(pai) || []) if (!vistos.has(f.pid)) { vistos.add(f.pid); fila.push(f.pid); }
  }
  return vistos;
}

function donosDaIde(snap, agentes, { tokens = [], ptyPids = [] } = {}) {
  if (snap.plataforma === 'linux') {
    const sids = sidsDaIde(snap, tokens);
    return new Set(agentes.filter(a => sids.has(a.sid)).map(a => a.pid));
  }
  const desc = descendentesDe(snap.procs, ptyPids);
  return new Set(agentes.filter(a => desc.has(a.pid)).map(a => a.pid));
}

function donosDaConversa(snap, { provedor, id, tokens, ptyPids }) {
  const todos = agentesDoInstantaneo(snap).filter(a => a.provedor === provedor && a.id === id);
  if (provedor === 'claude') return todos;
  const dentro = donosDaIde(snap, todos, { tokens, ptyPids });
  return todos.filter(a => dentro.has(a.pid));
}

// Em sandbox (RENDRA_HOME) só valem conversas que existem na pasta falsa: o Claude real do dono nunca entra.
function idsDoSandbox(home, env = process.env) {
  const ids = new Set();
  const projetos = path.join(home, '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(projetos)) {
      try { for (const f of fs.readdirSync(path.join(projetos, d))) { const m = /^([0-9a-f-]{36}).jsonl$/.exec(f); if (m) ids.add(m[1]); } } catch { /* não é pasta */ }
    }
  } catch { /* sem projetos */ }
  // rollouts do Codex: sessions/AAAA/MM/DD/rollout-<data>-<id>.jsonl
  const varre = (dir, nivel) => {
    let nomes = [];
    try { nomes = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const n of nomes) {
      if (n.isDirectory() && nivel < 3) varre(path.join(dir, n.name), nivel + 1);
      else { const m = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).jsonl$/.exec(n.name); if (m) ids.add(m[1]); }
    }
  };
  varre(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'sessions'), 0);
  return ids;
}

// Lista os agentes vivos do ambiente, já com a regra de sandbox. { agentes, snap } ou null (falha na leitura).
async function detectarAgentes({ amb, env = process.env, listar = listarProcessos, tokens = [], ptyPids = [] } = {}) {
  const sandbox = !!env.RENDRA_HOME;
  if (!amb) return null;
  if (sandbox && amb.tipo === 'wsl') return { agentes: [], snap: null, donosIde: new Set() }; // sandbox nunca alcança a distro real
  // foto COMPLETA: a descendência do terminal passa por conhost, cmd.exe, bash, npx (o shim claude.cmd), que um filtro por nome
  // de imagem cortaria; os agentes são filtrados depois, por reconhecer()
  const snap = await listar(amb, { env });
  if (!snap) return null;
  let agentes = agentesDoInstantaneo(snap);
  if (sandbox) {
    const validos = idsDoSandbox(env.RENDRA_HOME, env);
    agentes = agentes.filter(a => a.id && validos.has(a.id));
  }
  return { agentes, snap, donosIde: donosDaIde(snap, agentes, { tokens, ptyPids }) };
}

module.exports = {
  reconhecer, dividirLinha, parsearWindows, parsearLinux, listarProcessos, listarProcessosWindows, listarProcessosLinux,
  sessaoValida, agentesDoInstantaneo, donosDaConversa, donosDaIde, sidsDaIde, descendentesDe, detectarAgentes, idsDoSandbox,
  SCRIPT_LISTA, executar,
};

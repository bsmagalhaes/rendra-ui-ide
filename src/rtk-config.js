/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: escritores de configuração dos agentes. Tudo puro (texto entra, texto sai): nada aqui
// toca o disco. Quem lê, aplica e grava de forma atômica é src/rtk-enable.js.
// JSON (settings.json do Claude, hooks.json do Codex): reserializa com a indentação detectada.
// TOML (config.toml do Codex): só por acréscimo de texto, nunca reserializa.

const crypto = require('crypto');
const { hookCommand, isRtkHookCommand } = require('./rtk-paths');

// ── JSON ─────────────────────────────────────────────────────────────────────
function detectIndent(text) {
  const m = /^([ \t]+)\S/m.exec(String(text));
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : m[1].length;
}
function parseJson(text) {
  try {
    const v = JSON.parse(String(text || ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function dumpJson(obj, original) {
  const eol = /\r\n/.test(original) ? '\r\n' : '\n';
  let out = JSON.stringify(obj, null, detectIndent(original));
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return /\r?\n$/.test(original) ? out + eol : out;
}
const preToolUse = obj => (Array.isArray(obj?.hooks?.PreToolUse) ? obj.hooks.PreToolUse : []);

// Todas as entradas de hook do RTK para o agente: [{ group, hook, g, i }]
function rtkHookEntries(obj, kind) {
  const out = [];
  preToolUse(obj).forEach((group, g) => {
    (Array.isArray(group?.hooks) ? group.hooks : []).forEach((hook, i) => {
      if (hook && isRtkHookCommand(hook.command, kind)) out.push({ group, hook, g, i });
    });
  });
  return out;
}
const isAbsCommand = cmd => /^"?([A-Za-z]:[\\/]|\/)/.test(String(cmd || '').trim());

function hasRtkHook(jsonText, kind) {
  const obj = parseJson(jsonText);
  return !!obj && rtkHookEntries(obj, kind).length > 0;
}
function isAbsoluteHook(jsonText, kind) {
  const obj = parseJson(jsonText);
  const e = obj ? rtkHookEntries(obj, kind) : [];
  return e.length > 0 && e.every(x => isAbsCommand(x.hook.command));
}

// Troca o comando de cada hook do RTK pelo absoluto. Só reescreve se o texto do comando mudar.
function patchHookCommand(obj, kind, absRtk, opts) {
  const entries = rtkHookEntries(obj, kind);
  const notes = [];
  if (!entries.length) {
    notes.push(`Hook do RTK para o ${kind === 'codex' ? 'Codex' : 'Claude Code'} não encontrado; ative o RTK primeiro (rtk init).`);
    return { hookChanged: false, notes };
  }
  const want = hookCommand(absRtk, kind, opts.platform, { gitBash: !!opts.gitBash });
  if (!want.command) {
    notes.push(`${want.note} O hook foi mantido como está.`);
    return { hookChanged: false, notes };
  }
  let hookChanged = false;
  for (const e of entries) {
    if (e.hook.command !== want.command) { e.hook.command = want.command; hookChanged = true; }
  }
  return { hookChanged, notes };
}

// settings.json do Claude: comando absoluto no grupo do RTK e env.RTK_DB_PATH. Não cria o grupo.
function patchClaudeSettings(jsonText, { dbPath, absRtk, platform = process.platform, gitBash = false } = {}) {
  const obj = parseJson(jsonText);
  if (!obj) return { text: jsonText, changed: false, hookChanged: false, notes: ['settings.json do Claude ilegível; nada foi alterado.'] };
  const { hookChanged, notes } = patchHookCommand(obj, 'claude', absRtk, { platform, gitBash });
  let envChanged = false;
  if (dbPath) {
    if (!obj.env || typeof obj.env !== 'object' || Array.isArray(obj.env)) obj.env = {};
    if (obj.env.RTK_DB_PATH !== dbPath) { obj.env.RTK_DB_PATH = dbPath; envChanged = true; }
  }
  const changed = hookChanged || envChanged;
  if (envChanged) notes.push(`env.RTK_DB_PATH = ${dbPath}`);
  return { text: changed ? dumpJson(obj, jsonText) : jsonText, changed, hookChanged, notes };
}
const claudeDbEnv = jsonText => {
  const v = parseJson(jsonText)?.env?.RTK_DB_PATH;
  return typeof v === 'string' ? v : null;
};

// hooks.json do Codex: comando absoluto na entrada do RTK. Não cria entrada (quem cria é `rtk init -g --codex`).
function patchCodexHooks(jsonText, absRtk, { platform = process.platform, gitBash = false } = {}) {
  const obj = parseJson(jsonText);
  if (!obj) return { text: jsonText, changed: false, hookChanged: false, notes: ['hooks.json do Codex ilegível; nada foi alterado.'] };
  const { hookChanged, notes } = patchHookCommand(obj, 'codex', absRtk, { platform, gitBash });
  return { text: hookChanged ? dumpJson(obj, jsonText) : jsonText, changed: hookChanged, hookChanged, notes };
}

// ── TOML ─────────────────────────────────────────────────────────────────────
// Literal ('...') guarda a barra invertida do Windows como está; com `'` ou controle, string básica escapada.
function tomlString(s) {
  const v = String(s);
  if (!/['\u0000-\u001f\u007f]/.test(v)) return `'${v}'`;
  const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${esc}"`;
}
const untoml = (q, body) => (q === '"' ? body.replace(/\\(["\\])/g, '$1') : body);

function envSnippet(dbPath) {
  return `[shell_environment_policy]\nset = { RTK_DB_PATH = ${tomlString(dbPath)} }`;
}

// config.toml do Codex: acrescenta `[shell_environment_policy] set = { RTK_DB_PATH = ... }` ao fim.
// Se a tabela já existe (em qualquer forma), não edita: devolve o trecho para o usuário aplicar.
function patchCodexConfigToml(tomlText, dbPath) {
  const text = String(tomlText || '');
  const snippet = envSnippet(dbPath);
  if (/shell_environment_policy/.test(text)) {
    const m = /\bRTK_DB_PATH\s*=\s*(['"])(.*?)\1/.exec(text);
    if (m && untoml(m[1], m[2]) === dbPath) {
      return { text, changed: false, snippet: null, notes: ['config.toml já tem o RTK_DB_PATH do Codex certo.'] };
    }
    return {
      text, changed: false, snippet,
      notes: ['config.toml já tem shell_environment_policy; não foi editado. Aplique à mão, juntando ao que já existe:\n' + snippet],
    };
  }
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const body = snippet.split('\n').join(eol) + eol;
  let sep = '';
  if (text.length) sep = text.endsWith('\n') ? eol : eol + eol;
  return {
    text: text + sep + body, changed: true, snippet,
    notes: [`Acrescentado ao fim do config.toml:\n${snippet}`],
  };
}
const codexDbEnv = tomlText => {
  if (!/\[shell_environment_policy\]|shell_environment_policy\s*\./.test(String(tomlText || ''))) return null;
  const m = /\bRTK_DB_PATH\s*=\s*(['"])(.*?)\1/.exec(String(tomlText));
  return m ? untoml(m[1], m[2]) : null;
};

// ── Hash de confiança do hook (mesmo cálculo do Codex: hooks/src/engine/discovery.rs) ──
// JSON canônico (chaves ordenadas em todos os níveis), compacto, SHA-256 sobre UTF-8.
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  }
  return v;
}
// Identidade do hook: evento, matcher do grupo e o handler normalizado (timeout 600 quando ausente,
// mínimo 1; campos ausentes não entram). Caminho do arquivo e índices ficam só na chave.
function codexHookIdentityJson(group, handler, event = 'pre_tool_use') {
  const t = handler.timeout != null && Number.isFinite(+handler.timeout) ? Math.trunc(+handler.timeout) : 600;
  const h = { type: 'command', command: handler.command, timeout: Math.max(1, t), async: handler.async === true };
  if (handler.statusMessage != null) h.statusMessage = handler.statusMessage;
  if (handler.additionalContextLimit != null && handler.additionalContextLimit !== 2500) h.additionalContextLimit = handler.additionalContextLimit;
  const id = { event_name: event, hooks: [h] };
  if (group && group.matcher != null) id.matcher = group.matcher;
  return JSON.stringify(canonical(id));
}
function codexHookHash(group, handler, event) {
  return 'sha256:' + crypto.createHash('sha256').update(Buffer.from(codexHookIdentityJson(group, handler, event), 'utf8')).digest('hex');
}

// ── Confiança do hook no Codex ───────────────────────────────────────────────
// A IDE não tem parser TOML: só lê e edita as formas que o próprio Codex grava
// (`[hooks.state.'<chave>']` ou `[hooks.state."<chave>"]`). Qualquer outra forma de `hooks.state`
// (inline, pontilhada, com espaços, escape raro, string multilinha) conta como não reconhecida:
// nada é editado, para nunca gerar tabela duplicada nem TOML inválido (o Codex deixaria de
// carregar o config.toml inteiro).
const splitLines = text => String(text || '').split(/(\r?\n)/); // linha, separador, linha, ...

// Marca as linhas que estão dentro de string multilinha (não são lidas como cabeçalho nem chave)
// Primeiro delimitador multilinha da linha que está fora de string de uma linha e de comentário
function findMultiOpen(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '#') return null;
    if (c === '"' || c === "'") {
      if (s.startsWith(c.repeat(3), i)) return { delim: c.repeat(3), at: i };
      i++;
      while (i < s.length && s[i] !== c) { if (c === '"' && s[i] === '\\') i++; i++; }
    }
  }
  return null;
}

function lineInfo(parts) {
  const out = [];
  let delim = null;
  for (let k = 0; k < parts.length; k += 2) {
    const s = parts[k];
    let skip = false;
    let start = false;
    if (delim) { skip = true; if (s.includes(delim)) delim = null; }
    else {
      const m = findMultiOpen(s);
      if (m) { skip = true; start = true; if (s.indexOf(m.delim, m.at + 3) < 0) delim = m.delim; }
    }
    out.push({ idx: k, s, skip, start });
  }
  return out;
}

// Valor de uma string TOML básica só com os escapes \\ e \" (outro escape: null)
function decodeBasic(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const n = body[++i];
    if (n !== '\\' && n !== '"') return null;
    out += n;
  }
  return out;
}
const STATE_HDR = /^\[hooks\.state\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]\s*(?:#.*)?$/;
const STATE_HDR_LOOSE = /^\[\[?\s*["']?hooks["']?\s*\.\s*["']?state/;
const HASH_LINE = /^trusted_hash\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/;

// { recognized, entries: Map(chave decodificada -> { hash|null, header, hashLine }) }
function readHookState(text) {
  const info = lineInfo(splitLines(text));
  const entries = new Map();
  let recognized = true;
  let sec = { kind: 'root' };
  info.forEach((ln, n) => {
    if (ln.skip) { if (ln.start && /^\s*["']?(?:hooks|state|trusted_hash)["']?\s*[=.]/.test(ln.s)) recognized = false; return; }
    const t = ln.s.trim();
    if (!t || t.startsWith('#')) return;
    if (t.startsWith('[')) {
      const m = STATE_HDR.exec(t);
      if (m) {
        const key = m[1] != null ? m[1] : decodeBasic(m[2]);
        if (key == null || entries.has(key)) { recognized = false; sec = { kind: 'bad' }; return; }
        entries.set(key, { hash: null, header: n, hashLine: -1 });
        sec = { kind: 'entry', key };
      } else if (/^\[hooks\.state\]\s*(?:#.*)?$/.test(t)) sec = { kind: 'statehdr' };
      else if (/^\[\s*["']?hooks["']?\s*\]\s*(?:#.*)?$/.test(t)) sec = { kind: 'hooks' };
      else if (STATE_HDR_LOOSE.test(t)) { recognized = false; sec = { kind: 'bad' }; }
      else sec = { kind: 'other' };
      return;
    }
    if (sec.kind === 'root' && /^["']?hooks["']?\s*(?:=|\.\s*["']?state)/.test(t)) recognized = false;
    else if (sec.kind === 'statehdr') recognized = false;
    else if (sec.kind === 'hooks' && /^["']?state["']?\s*[=.]/.test(t)) recognized = false;
    else if (sec.kind === 'entry') {
      const h = HASH_LINE.exec(t);
      if (h) { const e = entries.get(sec.key); e.hash = h[1] != null ? h[1] : h[2]; e.hashLine = n; }
      else if (/^trusted_hash\b/.test(t)) recognized = false;
    }
  });
  return { recognized, entries };
}

// Grava `trusted_hash` (só ele; `enabled` ausente conta como ligado) para a chave. Troca o hash na
// tabela da chave, se existir; senão acrescenta a tabela ao fim. Forma não reconhecida: não edita.
function upsertHookTrust(tomlText, key, hash) {
  const text = String(tomlText || '');
  const st = readHookState(text);
  if (!st.recognized || /[\u0000-\u001f\u007f]/.test(key)) return { text, changed: false, recognized: false };
  const e = st.entries.get(key);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const line = `trusted_hash = "${hash}"`;
  if (e) {
    if (e.hash === hash) return { text, changed: false, recognized: true };
    const parts = splitLines(text);
    const info = lineInfo(parts);
    if (e.hashLine >= 0) {
      const at = info[e.hashLine].idx;
      parts[at] = /^\s*/.exec(parts[at])[0] + line;
    } else parts.splice(info[e.header].idx + 1, 0, eol, line);
    return { text: parts.join(''), changed: true, recognized: true };
  }
  let sep = '';
  if (text.length) sep = text.endsWith('\n') ? eol : eol + eol;
  const block = `[hooks.state.${tomlString(key)}]${eol}${line}${eol}`;
  return { text: text + sep + block, changed: true, recognized: true };
}

// Entradas do RTK no hooks.json: chave exata do Codex (caminho, evento, grupo, índice) e hash do handler
function rtkTrustTargets(hooksJsonText, hooksJsonPath) {
  const obj = parseJson(hooksJsonText);
  if (!obj) return [];
  return rtkHookEntries(obj, 'codex').map(e => ({
    key: `${hooksJsonPath}:pre_tool_use:${e.g}:${e.i}`, hash: codexHookHash(e.group, e.hook), g: e.g, i: e.i,
  }));
}

// Aprova só as entradas do RTK (nunca outro handler, nunca "trust all"). recognized:false = nada editado.
function applyCodexTrust(tomlText, targets) {
  let text = String(tomlText || '');
  let changed = false;
  for (const t of targets) {
    const r = upsertHookTrust(text, t.key, t.hash);
    if (!r.recognized) return { text: String(tomlText || ''), changed: false, recognized: false };
    if (r.changed) { text = r.text; changed = true; }
  }
  return { text, changed, recognized: true };
}

// ── writable_roots do sandbox do Codex ───────────────────────────────────────
// O RTK grava o banco do Codex numa pasta própria; no Linux e no WSL, em `workspace-write`, essa
// pasta precisa estar nas raízes graváveis. A IDE só acrescenta o caminho em formas simples e só
// quando o `sandbox_mode` do usuário já é `workspace-write` na raiz do arquivo; nunca altera o
// `sandbox_mode` e nunca mexe no Windows (lá o modo efetivo é somente leitura, sem efeito).
const ROOTS_LINE = /^writable_roots\s*=\s*\[(.*)\]\s*(?:#.*)?$/;

// Valores de um array de strings simples numa linha; null se houver outra coisa dentro
function simpleStringArray(inner) {
  const items = [];
  const re = /\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*(?:,|$)/y;
  let pos = 0;
  const body = inner.trim();
  if (!body) return items;
  re.lastIndex = 0;
  while (pos < inner.length) {
    re.lastIndex = pos;
    const m = re.exec(inner);
    if (!m || m[0].length === 0) return /^\s*$/.test(inner.slice(pos)) ? items : null;
    const v = m[1] != null ? m[1] : decodeBasic(m[2]);
    if (v == null) return null;
    items.push(v);
    pos = re.lastIndex;
  }
  return items;
}

function patchWritableRoots(tomlText, dir, { platform = process.platform } = {}) {
  const text = String(tomlText || '');
  const none = { text, changed: false };
  if (platform === 'win32' || !dir) return none;
  const parts = splitLines(text);
  const info = lineInfo(parts);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let atRoot = true;
  let workspaceWrite = false;
  let headerAt = -1;
  let mentions = 0;
  info.forEach((ln, n) => {
    const t = ln.s.trim();
    if (t.startsWith('#')) return;
    if (/sandbox_workspace_write/.test(ln.s)) {
      mentions++;
      if (!ln.skip && /^\[sandbox_workspace_write\]\s*(?:#.*)?$/.test(t)) headerAt = n;
    }
    if (ln.skip) return;
    if (t.startsWith('[')) {
      atRoot = false;
      if (/^\[\[?\s*["']?permissions\b/.test(t)) workspaceWrite = null; // modo efetivo vem de outro lugar
      return;
    }
    if (!atRoot || !t) return;
    if (/^sandbox_mode\s*=\s*(["'])workspace-write\1\s*(?:#.*)?$/.test(t) && workspaceWrite !== null) workspaceWrite = true;
    if (/^(?:profile|default_permissions)\s*=/.test(t)) workspaceWrite = null;
  });
  if (workspaceWrite !== true) return none;
  const quoted = tomlString(dir);

  if (mentions === 0) {
    let sep = '';
    if (text.length) sep = text.endsWith('\n') ? eol : eol + eol;
    return { text: `${text}${sep}[sandbox_workspace_write]${eol}writable_roots = [${quoted}]${eol}`, changed: true };
  }
  if (mentions !== 1 || headerAt < 0) return none; // inline, pontilhada, repetida: não se edita

  let end = info.length;
  for (let n = headerAt + 1; n < info.length; n++) {
    if (!info[n].skip && info[n].s.trim().startsWith('[')) { end = n; break; }
  }
  const rootLines = [];
  for (let n = headerAt + 1; n < end; n++) {
    if (!info[n].skip && /^["']?writable_roots/.test(info[n].s.trim())) rootLines.push(n);
    else if (info[n].skip && /writable_roots/.test(info[n].s)) return none;
  }
  if (!rootLines.length) {
    parts.splice(info[headerAt].idx + 1, 0, eol, `writable_roots = [${quoted}]`);
    return { text: parts.join(''), changed: true };
  }
  if (rootLines.length !== 1) return none;
  const ln = info[rootLines[0]];
  const m = ROOTS_LINE.exec(ln.s.trim());
  if (!m) return none; // multilinha, comentário dentro do array, chave entre aspas
  const items = simpleStringArray(m[1]);
  if (!items) return none;
  if (items.includes(dir)) return none;
  const inner = m[1];
  const lead = /^\s*/.exec(inner)[0];
  const trail = /\s*$/.exec(inner)[0];
  const core = inner.trim();
  const joined = !core ? quoted : core.endsWith(',') ? `${core} ${quoted}` : `${core}, ${quoted}`;
  const at = ln.idx;
  const indent = /^\s*/.exec(parts[at])[0];
  const tail = /\]\s*(#.*)?$/.exec(parts[at].trimEnd());
  const comment = tail && tail[1] ? ` ${tail[1]}` : '';
  parts[at] = `${indent}writable_roots = [${lead}${joined}${trail}]${comment}`;
  return { text: parts.join(''), changed: true };
}

const WORST = ['trusted', 'modified', 'untrusted'];
// trusted: o hash gravado é o do comando atual; modified: há chave e o hash difere (ou o hook mudou);
// untrusted: sem entrada (ou config.toml em forma que a IDE não lê). Vale o pior entre as entradas do RTK.
function codexHookTrust(hooksJsonText, tomlText, hooksJsonPath) {
  const targets = rtkTrustTargets(hooksJsonText, hooksJsonPath);
  if (!targets.length) return { state: 'no-hook', key: null, entries: [] };
  const st = readHookState(tomlText);
  const entries = targets.map(t => {
    const e = st.recognized ? st.entries.get(t.key) : null;
    const state = !e || e.hash == null ? 'untrusted' : e.hash === t.hash ? 'trusted' : 'modified';
    return { key: t.key, state };
  });
  const state = WORST[Math.max(...entries.map(x => WORST.indexOf(x.state)))];
  return { state, key: targets[0].key, entries };
}

module.exports = {
  hasRtkHook, isAbsoluteHook, patchClaudeSettings, claudeDbEnv, patchCodexHooks,
  patchCodexConfigToml, codexDbEnv, codexHookTrust, detectIndent, codexHookHash, codexHookIdentityJson,
  patchWritableRoots, readHookState, upsertHookTrust, applyCodexTrust, rtkTrustTargets, rtkHookEntries,
};

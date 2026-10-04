/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Encerramento de processos da IDE. Duas regras guiam tudo: só morre o que nasceu de um terminal da IDE (ou o
// agente da conversa escolhida), e nada é encontrado por nome.
//
//   Windows: foto da árvore (pid, pai, hora de criação) ANTES do fechamento gracioso (depois que o shell morre,
//            os filhos perdem o elo); gracioso = o `kill()` do pty (fecha a pseudoconsole); forçado = o PID da foto
//            que ainda vive com a mesma hora de criação. Elo pai-filho só vale se o filho nasceu depois do pai.
//   Linux/WSL/Mac: cada terminal leva a marca RENDRA_TERM=<token> no ambiente. O líder de sessão com a marca (o
//            mais antigo: um tmux iniciado depois tem início maior) dá o SID, e a sessão inteira recebe SIGHUP e,
//            passado o prazo, SIGKILL. Quem saiu da sessão por `setsid` (tmux, daemons) não é alcançado, de
//            propósito (como no VS Code). Com SID registrado e líder morto (queda da IDE), só morre quem tem o
//            mesmo SID e a mesma marca, e só se a distro não reiniciou (boot_id).
//   Agente de uma conversa (R3): SIGTERM, prazo, SIGKILL, só no PID do agente, conferindo o início do processo.

const { execFile } = require('child_process');
const A = require('./agentes-proc');

// prazos (ms); os testes trocam por injeção
// `saida` era 3000: no Windows a foto da árvore (PowerShell + CIM) leva 1 a 1,4 s e o prazo gracioso mais 1 s, medido
const PRAZOS = { agente: 1500, terminal: 1000, saida: 5000 };

// o `${` do shell não pode aparecer cru num template do JS: nos scripts ele é escrito `@{`
const DOLAR_CHAVE = String.fromCharCode(36, 123);
const sh = texto => texto.split('@{').join(DOLAR_CHAVE);
const dormir = ms => new Promise(r => setTimeout(r, ms));
const NOME_DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOKEN = /^[0-9a-f]{16,64}$/;

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function esperarMorte(pids, ms, vivoFn = vivo) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (!pids.some(vivoFn)) return true;
    await dormir(40);
  }
  return !pids.some(vivoFn);
}

// ── Windows ─────────────────────────────────────────────────────────────────

// Árvore da raiz na foto: [{ pid, t }] (a raiz inclusa). Filho só entra se nasceu depois do pai.
function arvoreDaFoto(procs, raiz) {
  const porPid = new Map(procs.map(p => [p.pid, p]));
  const filhos = new Map();
  for (const p of procs) { if (!filhos.has(p.ppid)) filhos.set(p.ppid, []); filhos.get(p.ppid).push(p); }
  const out = [], vistos = new Set();
  const r = porPid.get(raiz);
  const fila = r ? [r] : [];
  if (r) vistos.add(r.pid);
  while (fila.length) {
    const pai = fila.shift();
    out.push({ pid: pai.pid, t: pai.inicio });
    for (const f of filhos.get(pai.pid) || []) {
      if (vistos.has(f.pid) || f.pid === pai.pid) continue;
      if (pai.inicio != null && f.inicio != null && BigInt(f.inicio) < BigInt(pai.inicio)) continue; // PID do pai reaproveitado
      vistos.add(f.pid);
      fila.push(f);
    }
  }
  return out;
}

// entradas: [{ pid, kill }] (kill = fechar o pty). deps: listar (foto completa), listarPids (foto dos pids), matar, vivo
async function encerrarArvoresWindows(entradas, { prazoMs = PRAZOS.terminal, deps = {} } = {}) {
  const listar = deps.listar || (() => A.listarProcessosWindows({ timeout: 6000 }));
  const listarPids = deps.listarPids || (pids => A.listarProcessosWindows({ filtro: pids.map(p => `ProcessId=${p}`).join(' OR '), timeout: 6000 }));
  const matar = deps.matar || (pid => { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } });
  const vivoFn = deps.vivo || vivo;
  // pid 0 ou 1 nunca: `process.kill(0)` sinaliza o grupo do próprio processo (o node-pty ainda não tem o pid de um shell recém-aberto)
  const lista = entradas.filter(e => e && Number.isInteger(e.pid) && e.pid > 1);
  if (!lista.length) return { arvores: [], forcados: [] };
  const foto = (await listar()) || [];
  const arvores = lista.map(e => {
    const a = arvoreDaFoto(foto, e.pid);
    return a.length ? a : [{ pid: e.pid, t: null }]; // sem foto: ao menos a raiz
  });
  const todos = arvores.flat();
  // A segunda foto (hora de criação de quem está na árvore) é tirada JUNTO com o prazo gracioso, não depois dele: no Windows
  // cada consulta custa mais de 1 s e a saída da IDE tem teto. Quem sobrar do prazo só é forçado se esteve nesta foto com a
  // mesma hora de criação da primeira; quem não aparece nela (morreu e o PID foi reaproveitado) não é tocado.
  const verificacao = Promise.resolve(listarPids(todos.map(n => n.pid))).catch(() => null);
  for (const e of lista) { try { e.kill?.(); } catch { /* já saiu */ } }
  await esperarMorte(todos.map(n => n.pid), prazoMs, vivoFn);
  const vivos = todos.filter(n => vivoFn(n.pid));
  const forcados = [];
  if (vivos.length) {
    const agora = (await verificacao) || [];
    const porPid = new Map(agora.map(p => [p.pid, p]));
    for (const n of vivos) {
      const p = porPid.get(n.pid);
      if (!p) continue; // não estava vivo na segunda foto: não é o processo da primeira
      if (n.t != null && p.inicio != null && n.t !== p.inicio) continue; // PID reaproveitado: não é mais o nosso
      matar(n.pid); forcados.push(n.pid);
    }
    await esperarMorte(forcados, 1000, vivoFn);
  }
  return { arvores: arvores.map(a => a.map(n => n.pid)), forcados };
}

// ── Linux, WSL e Mac nativo (sessão por marca) ──────────────────────────────

const SCRIPT_ENCERRAR = sh(String.raw`
GRACE=$1; shift
ents="$*"
boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
snap() { cat /proc/[0-9]*/stat 2>/dev/null | awk '{pid=$1; sub(/.*\) /,""); print pid, $4, $20}'; }
marca() { tr '\0' '\n' < /proc/$1/environ 2>/dev/null | sed -n 's/^RENDRA_TERM=//p'; }
cand=$(grep -laz '^RENDRA_TERM=' /proc/[0-9]*/environ 2>/dev/null | sed 's#/proc/\([0-9]*\)/environ#\1#')
tab=$(snap)
alvos=""
for e in $ents; do
  tok=@{e%%:*}; r=@{e#*:}; sid=@{r%%:*}; bt=@{r#*:}
  if [ -n "$bt" ] && [ "$bt" != "$boot" ]; then continue; fi
  estrito=0
  if [ -z "$sid" ]; then
    best=""; bst=""
    for p in $cand; do
      [ "$(marca $p)" = "$tok" ] || continue
      set -- $(printf '%s\n' "$tab" | awk -v p=$p '$1==p {print $2, $3}')
      [ "$1" = "$p" ] || continue
      if [ -z "$best" ] || [ "$2" -lt "$bst" ]; then best=$p; bst=$2; fi
    done
    sid=$best
  else
    lider=$(printf '%s\n' "$tab" | awk -v p=$sid '$1==p && $2==p {print $1}')
    if [ -z "$lider" ] || [ "$(marca $sid)" != "$tok" ]; then estrito=1; fi
  fi
  [ -n "$sid" ] || { printf '?\t%s\n' "$tok"; continue; }
  printf 'S\t%s\n' "$sid"
  for l in $(printf '%s\n' "$tab" | awk -v s=$sid '$2==s {print $1 ":" $3}'); do
    p=@{l%%:*}; st=@{l#*:}
    [ "$p" != "$$" ] || continue
    if [ "$estrito" = 1 ]; then [ "$(marca $p)" = "$tok" ] || continue; fi
    alvos="$alvos $p:$sid:$st"
  done
done
for a in $alvos; do kill -HUP @{a%%:*} 2>/dev/null; printf 'H\t%s\n' "@{a%%:*}"; done
[ -n "$alvos" ] && sleep "$GRACE"
tab2=$(snap)
for a in $alvos; do
  p=@{a%%:*}; r=@{a#*:}; sid=@{r%%:*}; st=@{r#*:}
  igual=$(printf '%s\n' "$tab2" | awk -v p=$p -v s=$sid -v t=$st '$1==p && $2==s && $3==t {print "1"}')
  [ "$igual" = 1 ] && { kill -KILL $p 2>/dev/null; printf 'K\t%s\n' "$p"; }
done
true
`);

const SCRIPT_DESCOBRIR = sh(String.raw`
tok=$1
boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
best=""; bst=""
for p in $(grep -laz "^RENDRA_TERM=$tok\$" /proc/[0-9]*/environ 2>/dev/null | sed 's#/proc/\([0-9]*\)/environ#\1#'); do
  st=$(cat /proc/$p/stat 2>/dev/null) || continue
  set -- $(printf '%s\n' "$st" | awk '{pid=$1; sub(/.*\) /,""); print pid, $4, $20}')
  [ "$1" = "$2" ] || continue
  if [ -z "$best" ] || [ "$3" -lt "$bst" ]; then best=$1; bst=$3; fi
done
printf 'L\t%s\t%s\n' "$best" "$boot"
`);

const SCRIPT_AGENTE = sh(String.raw`
GRACE=$1; shift
for a in "$@"; do
  p=@{a%%:*}; st=@{a#*:}
  cur=$(cat /proc/$p/stat 2>/dev/null | awk '{sub(/.*\) /,""); print $20}')
  [ "$cur" = "$st" ] && { kill -TERM $p 2>/dev/null; printf 'T\t%s\n' "$p"; }
done
sleep "$GRACE"
for a in "$@"; do
  p=@{a%%:*}; st=@{a#*:}
  cur=$(cat /proc/$p/stat 2>/dev/null | awk '{sub(/.*\) /,""); print $20}')
  [ "$cur" = "$st" ] && { kill -KILL $p 2>/dev/null; printf 'K\t%s\n' "$p"; }
done
true
`);

const paraSegundos = ms => (Math.max(0, ms) / 1000).toFixed(2);

function rodar(distro, script, args, { timeout, execFileFn = execFile } = {}) {
  const [file, a] = distro
    ? ['wsl.exe', ['-d', distro, '-e', 'sh', '-c', script, 'sh', ...args]]
    : ['sh', ['-c', script, 'sh', ...args]];
  return A.executar(file, a, { timeout, execFileFn });
}

// entradas: [{ token, sid?, boot? }]. Resolve { sids, hup, kill } (listas de PIDs sinalizados) ou null se o ambiente falhou.
async function encerrarSessoesPorMarca({ distro = null, entradas, prazoMs = PRAZOS.terminal, execFileFn } = {}) {
  if (distro != null && !NOME_DISTRO.test(distro)) return null;
  const itens = (entradas || []).filter(e => e && TOKEN.test(e.token || ''));
  if (!itens.length) return { sids: [], hup: [], kill: [] };
  const args = itens.map(e => `${e.token}:${Number.isInteger(e.sid) ? e.sid : ''}:${/^[0-9a-f-]{36}$/.test(e.boot || '') ? e.boot : ''}`);
  const out = await rodar(distro, SCRIPT_ENCERRAR, [paraSegundos(prazoMs), ...args], { timeout: prazoMs + 8000, execFileFn });
  if (out == null) return null;
  const r = { sids: [], hup: [], kill: [] };
  for (const l of out.split('\n')) {
    const c = l.split('\t');
    if (c[0] === 'S') r.sids.push(+c[1]);
    else if (c[0] === 'H') r.hup.push(+c[1]);
    else if (c[0] === 'K') r.kill.push(+c[1]);
  }
  return r;
}

// Depois de abrir o terminal: SID do líder e boot_id, para o registro sobreviver à queda da IDE
async function descobrirLider({ distro = null, token, execFileFn } = {}) {
  if (!TOKEN.test(token || '') || (distro != null && !NOME_DISTRO.test(distro))) return null;
  const out = await rodar(distro, SCRIPT_DESCOBRIR, [token], { timeout: 8000, execFileFn });
  const m = out && /^L\t(\d*)\t([0-9a-f-]*)$/m.exec(out);
  if (!m || !m[1]) return null;
  return { sid: +m[1], boot: m[2] };
}

// ── Agente de uma conversa (R3) ─────────────────────────────────────────────

// alvos: [{ pid, inicio }] de agentes já reconhecidos (nunca o pai, nunca por nome). Resolve os PIDs encerrados.
async function encerrarAgentes({ amb, alvos, prazoMs = PRAZOS.agente, execFileFn, deps = {} } = {}) {
  const lista = (alvos || []).filter(a => Number.isInteger(a.pid) && a.pid > 1);
  if (!lista.length) return { encerrados: [] };
  if (amb && amb.tipo === 'wsl') {
    if (!NOME_DISTRO.test(amb.distro || '')) return { encerrados: [] };
    const out = await rodar(amb.distro, SCRIPT_AGENTE, [paraSegundos(prazoMs), ...lista.map(a => `${a.pid}:${a.inicio}`)], { timeout: prazoMs + 8000, execFileFn });
    if (out == null) return { encerrados: [], falhou: true };
    const sinalizados = new Set();
    for (const l of out.split('\n')) { const c = l.split('\t'); if (c[0] === 'T' || c[0] === 'K') sinalizados.add(+c[1]); }
    return { encerrados: [...sinalizados] };
  }
  const matar = deps.matar || ((pid, sinal) => { try { process.kill(pid, sinal); return true; } catch { return false; } });
  const vivoFn = deps.vivo || vivo;
  const sinalizados = [];
  for (const a of lista) if (matar(a.pid, 'SIGTERM')) sinalizados.push(a.pid); // no Windows o SIGTERM do Node já termina o processo
  if (!sinalizados.length) return { encerrados: [] };
  await esperarMorte(sinalizados, prazoMs, vivoFn);
  for (const pid of sinalizados) if (vivoFn(pid)) matar(pid, 'SIGKILL');
  await esperarMorte(sinalizados, 1000, vivoFn);
  return { encerrados: sinalizados };
}

// Encerra só o agente que segura a conversa (R3). `tokens`/`ptyPids` dizem o que é "da IDE" (o Codex de fora fica).
// Nunca o pai (bash, tmux), nunca por nome, nunca um id nulo. Resolve { encerrados, donos } ou null se a leitura falhou.
async function encerrarDonoDaConversa({ amb, provedor, id, env = process.env, tokens = [], ptyPids = [], prazoMs, deps = {} } = {}) {
  if (!id || (provedor !== 'claude' && provedor !== 'codex')) return { encerrados: [], donos: [] };
  const det = await (deps.detectar || A.detectarAgentes)({ amb, env, tokens, ptyPids, listar: deps.listar });
  if (!det) return null;
  const validos = new Set(det.agentes.map(a => a.pid));
  const donos = det.snap ? A.donosDaConversa(det.snap, { provedor, id, tokens, ptyPids }).filter(d => validos.has(d.pid)) : [];
  if (!donos.length) return { encerrados: [], donos: [] };
  const r = await (deps.encerrarAgentes || encerrarAgentes)({ amb, alvos: donos.map(d => ({ pid: d.pid, inicio: d.inicio })), prazoMs, deps: deps.proc });
  return { encerrados: r.encerrados, donos: donos.map(d => d.pid), falhou: !!r.falhou };
}

module.exports = {
  PRAZOS, vivo, esperarMorte, arvoreDaFoto, encerrarArvoresWindows, encerrarSessoesPorMarca, descobrirLider, encerrarAgentes,
  encerrarDonoDaConversa, SCRIPT_ENCERRAR, SCRIPT_DESCOBRIR, SCRIPT_AGENTE, TOKEN,
};

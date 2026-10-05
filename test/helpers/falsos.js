// Processos falsos dos testes de sessões: cada um é criado pelo teste, registrado aqui e só os registrados
// podem ser encerrados na limpeza (nunca por nome). O "claude" falso tem a forma que o reconhecedor aceita
// (node executando .../@anthropic-ai/claude-code/cli.js) e, como o real, não segura o arquivo da conversa aberto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const criados = new Set();

function sandbox(prefixo = 'rendra-t-sess-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);\n"); // vive até ser encerrado
  const cliCodex = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(cliCodex), { recursive: true });
  fs.writeFileSync(cliCodex, 'setInterval(() => {}, 1000);\n');
  const isca = path.join(dir, 'outro', 'app.js');
  fs.mkdirSync(path.dirname(isca), { recursive: true });
  fs.writeFileSync(isca, 'setInterval(() => {}, 1000);\n');
  // filho que ignora o encerramento gracioso e gera neto (árvore de um terminal)
  const arvore = path.join(dir, 'arvore.js');
  fs.writeFileSync(arvore, [
    "const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');",
    "const out = process.argv[2];",
    "const teimoso = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });",
    "const comum = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });",
    "fs.writeFileSync(out, JSON.stringify({ teimoso: teimoso.pid, comum: comum.pid }));",
    "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);",
  ].join('\n'));
  // "bash" falso: gera o claude falso como filho (o pai e o avô do agente têm que sobreviver ao encerramento do agente)
  const cadeia = path.join(dir, 'cadeia.js');
  fs.writeFileSync(cadeia, [
    "const { spawn } = require('child_process'); const fs = require('fs');",
    "const [out, cli, ...resto] = process.argv.slice(2);",
    "const f = spawn(process.execPath, [cli, ...resto], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });",
    "fs.writeFileSync(out, JSON.stringify({ filho: f.pid }));",
    "setInterval(() => {}, 1000);",
  ].join('\n'));
  // rc do dono (`claude --continue || claude`): quando o agente morre, o shell o abre de novo
  const ressuscita = path.join(dir, 'ressuscita.js');
  fs.writeFileSync(ressuscita, [
    "const { spawn } = require('child_process'); const fs = require('fs');",
    "const [out, cli, ...resto] = process.argv.slice(2); const pids = [];",
    "function sobe() { const f = spawn(process.execPath, [cli, ...resto], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' }); pids.push(f.pid); fs.writeFileSync(out, JSON.stringify({ pids })); f.on('exit', () => setTimeout(sobe, 150)); }",
    "sobe(); setInterval(() => {}, 1000);",
  ].join('\n'));
  return { dir, cli, cliCodex, isca, arvore, cadeia, ressuscita, limpa: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* em uso */ } } };
}

function lancar(args, opts = {}) {
  const p = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true, detached: !WIN, ...opts });
  p.on('error', () => {});
  criados.add(p.pid);
  return p;
}

const claudeFalso = (sb, extra = []) => lancar([sb.cli, ...extra]);
const codexFalso = (sb, extra = []) => lancar([sb.cliCodex, ...extra]);
const iscaFalsa = (sb, extra = []) => lancar([sb.isca, ...extra]);

// zumbi não conta como vivo (Linux: estado Z; macOS: ps): já morreu, falta só o pai ou o init recolher
const zumbi = pid => {
  try {
    if (process.platform === 'linux') return /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (process.platform === 'darwin') return /^Z/.test(require('child_process').execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim());
  } catch { /* sem processo */ }
  return false;
};
const vivo = pid => { try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; } return !zumbi(pid); };
async function esperar(cond, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return true; await new Promise(r => setTimeout(r, 50)); }
  return !!(await cond());
}

// só os PIDs que este processo de teste criou (ou que um filho dele registrou com `adotar`)
const adotar = pid => { if (Number.isInteger(pid)) criados.add(pid); };
function encerrarTodos() {
  for (const pid of criados) { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } }
  criados.clear();
}

module.exports = { WIN, sandbox, lancar, claudeFalso, codexFalso, iscaFalsa, vivo, esperar, adotar, encerrarTodos, criados };

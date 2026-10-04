// Canal dev:agent-encerrar-dono (retomar uma conversa, R3 e R2) pelo handler real do devcode, com agentes falsos REAIS:
// o efeito é de SO (agente morto, bash e tmux vivos). O pedido traz só { shell, cwd, provedor, id }; nenhum PID.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { registerDevCode } = require('../src/devcode');
const A = require('../src/agentes-proc');
const F = require('./helpers/falsos');

const ID1 = crypto.randomUUID();
const ID2 = crypto.randomUUID();
const ver = F.WIN || process.platform === 'linux' ? {} : { skip: 'Mac: só por argumento' };

test.afterEach(() => F.encerrarTodos());

function montar(sb, ids, { pty } = {}) {
  const home = path.join(sb.dir, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  for (const id of ids) fs.writeFileSync(path.join(home, '.claude', 'projects', 'p', `${id}.jsonl`), '{}\n');
  const proj = path.join(sb.dir, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const handlers = new Map();
  const ipcMain = { handle: (n, fn) => handlers.set(n, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: (k, d) => (k === 'devcode.workspaces' ? { list: [{ root: proj }], active: 0 } : d), set() {}, delete() {} };
  const dev = registerDevCode({
    ipcMain, dialog: {}, store, getWindow: () => null,
    deps: {
      listWslDistros: async () => [], wakeWslDistro: async () => true, loadPty: () => pty || { spawn() { throw new Error('sem pty'); } },
      env: { ...process.env, RENDRA_HOME: home }, esperaReaberturaMs: 400, prazos: { agente: 300, terminal: 300, saida: 5000 },
    },
  });
  handlers.get('dev:load-workspaces')();
  const pedir = (extra = {}) => handlers.get('dev:agent-encerrar-dono')({}, { shell: 'powershell', cwd: proj, provedor: 'claude', id: ID1, ...extra });
  return { pedir, dev, criarPty: () => handlers.get('pty:create')({}, { cols: 80, rows: 24, cwd: proj }), home, proj };
}

async function cadeia(sb, id) {
  const out = path.join(sb.dir, `cad-${crypto.randomBytes(4).toString('hex')}.json`);
  const tmux = F.iscaFalsa(sb);
  const bash = F.lancar([sb.cadeia, out, sb.cli, '--resume', id]);
  assert.ok(await F.esperar(() => fs.existsSync(out), 15000));
  const claude = JSON.parse(fs.readFileSync(out, 'utf8')).filho;
  F.adotar(claude);
  await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === claude); }, 15000);
  return { tmux, bash, claude };
}

test('retomar: encerra o claude de fora que segura a conversa; bash, tmux e outra conversa ficam', ver, async () => {
  const sb = F.sandbox();
  try {
    const t = montar(sb, [ID1, ID2]);
    const dono = await cadeia(sb, ID1);
    const outra = F.claudeFalso(sb, ['--resume', ID2]);
    await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === outra.pid); }, 15000);
    const r = await t.pedir();
    assert.deepStrictEqual({ ok: r.ok, encerrados: r.encerrados, reaberto: r.reaberto }, { ok: true, encerrados: 1, reaberto: false });
    assert.ok(await F.esperar(() => !F.vivo(dono.claude), 5000), 'o agente morreu');
    assert.ok(F.vivo(dono.bash.pid) && F.vivo(dono.tmux.pid), 'bash e tmux falsos vivos');
    assert.ok(F.vivo(outra.pid), 'a outra conversa segue');
  } finally { sb.limpa(); }
});

test('rc que reabre o agente (`claude --continue || claude`): a IDE avisa e para, sem matar em laço', ver, async () => {
  const sb = F.sandbox();
  try {
    const t = montar(sb, [ID1]);
    const out = path.join(sb.dir, 'res.json');
    const rc = F.lancar([sb.ressuscita, out, sb.cli, '--resume', ID1]);
    assert.ok(await F.esperar(() => fs.existsSync(out), 15000));
    await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === JSON.parse(fs.readFileSync(out, 'utf8')).pids[0]); }, 15000);
    const r = await t.pedir();
    const pids = JSON.parse(fs.readFileSync(out, 'utf8')).pids;
    pids.forEach(F.adotar);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reaberto, true, 'o agente foi reaberto pelo rc');
    assert.strictEqual(r.encerrados, 1, 'um só encerramento: sem laço');
    const vivos = pids.filter(F.vivo);
    assert.ok(vivos.length >= 1, 'o agente reaberto está vivo, a IDE não o persegue');
    assert.ok(F.vivo(rc.pid));
    await new Promise(r2 => setTimeout(r2, 800));
    const depois = JSON.parse(fs.readFileSync(out, 'utf8')).pids;
    assert.strictEqual(depois.length, pids.length, 'depois da resposta nada mais foi encerrado');
  } finally { sb.limpa(); }
});

test('pedido forjado: id inválido, provedor desconhecido e PID vindo do renderer não encerram nada', ver, async () => {
  const sb = F.sandbox();
  try {
    const t = montar(sb, [ID1, ID2]);
    const vitima = F.claudeFalso(sb, ['--resume', ID2]);
    await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === vitima.pid); }, 15000);
    for (const extra of [{ id: 'x; calc' }, { id: null }, { id: `${ID1}\n${ID2}` }, { provedor: 'outro' }, { provedor: 'claude; calc' }, { cwd: os.tmpdir() }, { cwd: undefined }]) {
      const r = await t.pedir(extra);
      assert.strictEqual(r.ok, false, JSON.stringify(extra));
      assert.strictEqual(r.encerrados, 0);
    }
    const r = await t.pedir({ id: ID1, pid: vitima.pid, pids: [vitima.pid], alvo: vitima.pid });
    assert.deepStrictEqual({ ok: r.ok, encerrados: r.encerrados }, { ok: true, encerrados: 0 }, 'ninguém segura o ID1: o pid do pedido é ignorado');
    assert.ok(F.vivo(vitima.pid));
  } finally { sb.limpa(); }
});

test('R2 dentro da IDE: o agente do terminal anterior morre, o shell dele fica; conferir distingue dono de fora', ver, async () => {
  const sb = F.sandbox();
  try {
    const out = path.join(sb.dir, 'ide.json');
    let shell;
    const pty = {
      spawn(file, args, opts) {
        shell = spawn(process.execPath, [sb.cadeia, out, sb.cli, '--resume', ID1], { env: opts.env, stdio: 'ignore', windowsHide: true, detached: !F.WIN });
        shell.on('error', () => {}); F.adotar(shell.pid);
        return { pid: shell.pid, onData() {}, write() {}, resize() {}, onExit: cb => shell.on('exit', c => cb({ exitCode: c })), kill: () => { try { shell.kill(); } catch { /* já saiu */ } } };
      },
    };
    const t = montar(sb, [ID1], { pty });
    const a = await t.criarPty();
    assert.ok(a.id && !a.error);
    assert.ok(await F.esperar(() => fs.existsSync(out), 15000));
    const claudeDaIde = JSON.parse(fs.readFileSync(out, 'utf8')).filho; F.adotar(claudeDaIde);
    await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === claudeDaIde); }, 15000);
    const c1 = await t.pedir({ conferir: true });
    assert.strictEqual(c1.reaberto, false, 'só o agente do terminal da IDE segura: nada de fora');
    const fora = F.claudeFalso(sb, ['--session-id', ID1]);
    await F.esperar(async () => { const s = await A.listarProcessos({ tipo: 'windows' }); return s && s.procs.some(p => p.pid === fora.pid); }, 15000);
    assert.strictEqual((await t.pedir({ conferir: true })).reaberto, true, 'agora há um dono de fora da IDE');
    const r = await t.pedir();
    assert.strictEqual(r.encerrados, 2, 'os dois donos (o do terminal anterior e o de fora) são encerrados');
    assert.ok(await F.esperar(() => !F.vivo(claudeDaIde) && !F.vivo(fora.pid), 5000));
    assert.ok(F.vivo(shell.pid), 'o shell do terminal anterior continua vivo');
    await t.dev.killAll();
  } finally { sb.limpa(); }
});

test('distro WSL inexistente: nada é feito (só no Windows, onde wsl: existe)', { skip: !F.WIN }, async () => {
  const sb = F.sandbox();
  try {
    const t = montar(sb, [ID1]);
    const r = await t.pedir({ shell: 'wsl:Qualquer' });
    assert.strictEqual(r.ok, false); // distro inexistente: nada é feito
    assert.strictEqual(r.encerrados, 0);
  } finally { sb.limpa(); }
});

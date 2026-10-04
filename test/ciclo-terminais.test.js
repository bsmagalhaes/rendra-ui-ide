// Vida dos terminais (T3, T5): pelo handler real do devcode, com um node-pty falso que cria árvores de processos
// REAIS. O efeito é o do SO: processo morto ou vivo, registro em disco. Só os PIDs criados pelo teste são tocados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { registerDevCode } = require('../src/devcode');
const { criarCiclo } = require('../src/ciclo-terminais');
const { criarRegistro } = require('../src/registro-terminais');
const F = require('./helpers/falsos');

test.afterEach(() => F.encerrarTodos());

// node-pty falso: "o shell" é um node que gera o neto teimoso e o neto comum (como um shell com agentes dentro)
function ptyDeArvore(sb, estado) {
  return {
    spawn(file, args, opts) {
      const out = path.join(sb.dir, `t-${crypto.randomBytes(4).toString('hex')}.json`);
      const filho = spawn(process.execPath, [sb.arvore, out], { env: opts.env, stdio: 'ignore', windowsHide: true, detached: !F.WIN });
      filho.on('error', () => {});
      F.adotar(filho.pid);
      const saida = [];
      estado.lancados.push({ filho, out, env: opts.env });
      return {
        pid: filho.pid,
        onData() {}, write() {}, resize() {},
        onExit: cb => { filho.on('exit', code => { saida.push(code); cb({ exitCode: code }); }); },
        kill: () => { try { filho.kill(); } catch { /* já saiu */ } }, // como o do node-pty: só o processo raiz
      };
    },
  };
}

function montar({ userData, env } = {}) {
  const sb = F.sandbox();
  const handlers = new Map();
  const estado = { lancados: [] };
  const ipcMain = { handle: (n, fn) => handlers.set(n, fn), on: (n, fn) => handlers.set(`on:${n}`, fn), once() {}, removeHandler() {} };
  const store = { get: (k, d) => d, set() {}, delete() {} };
  const dev = registerDevCode({
    ipcMain, dialog: {}, store, getWindow: () => null, userData,
    deps: { listWslDistros: async () => [], loadPty: () => ptyDeArvore(sb, estado), wakeWslDistro: async () => true, env, prazos: { agente: 300, terminal: 300, saida: 5000 } },
  });
  return {
    sb, dev, estado,
    criar: () => handlers.get('pty:create')({}, { cols: 80, rows: 24 }),
    matar: id => handlers.get('pty:kill')({}, id),
    async neto(i) {
      const l = estado.lancados[i];
      assert.ok(await F.esperar(() => fs.existsSync(l.out), 15000), 'o shell falso subiu os netos');
      await new Promise(r => setTimeout(r, 150));
      const n = JSON.parse(fs.readFileSync(l.out, 'utf8'));
      F.adotar(n.teimoso); F.adotar(n.comum);
      return n;
    },
  };
}

const todosMortos = (...pids) => F.esperar(() => pids.every(p => !F.vivo(p)), 10000);

test('fechar a IDE (killAll) encerra a árvore de cada terminal; o processo de fora fica; o registro é limpo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-ud-'));
  const t = montar({ userData: dir, env: {} });
  try {
    const a = await t.criar(), b = await t.criar();
    assert.ok(a.id && b.id && !a.error, 'terminais abertos');
    const na = await t.neto(0), nb = await t.neto(1);
    const fora = F.iscaFalsa(t.sb);
    const reg = criarRegistro({ dir });
    assert.strictEqual(reg.ler().length, 2, 'os dois terminais estão no registro');
    const marcas = t.estado.lancados.map(l => l.env.RENDRA_TERM);
    assert.ok(marcas.every(m => /^[0-9a-f]{16}$/.test(m)) && marcas[0] !== marcas[1], 'cada terminal leva a própria marca');
    if (F.WIN) assert.ok(await F.esperar(() => reg.ler().every(e => e.ptyInicio), 15000), 'a hora de criação entra no registro');
    const t0 = Date.now();
    await t.dev.killAll();
    assert.ok(Date.now() - t0 < 6000);
    const pais = t.estado.lancados.map(l => l.filho.pid);
    assert.ok(await todosMortos(...pais, na.teimoso, na.comum, nb.teimoso, nb.comum), 'shell e netos morreram');
    assert.ok(F.vivo(fora.pid), 'o processo que a IDE não iniciou segue vivo');
    assert.deepStrictEqual(reg.ler(), []);
  } finally { t.sb.limpa(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fechar um terminal (pty:kill) encerra a árvore dele e só dele', async () => {
  const t = montar({ env: {} });
  try {
    const a = await t.criar(), b = await t.criar();
    const na = await t.neto(0), nb = await t.neto(1);
    await t.matar(a.id);
    assert.ok(await todosMortos(t.estado.lancados[0].filho.pid, na.teimoso, na.comum), 'a árvore do terminal fechado morreu');
    assert.ok(F.vivo(t.estado.lancados[1].filho.pid) && F.vivo(nb.teimoso) && F.vivo(nb.comum), 'o outro terminal segue intacto');
    await t.dev.killAll();
    assert.ok(await todosMortos(t.estado.lancados[1].filho.pid, nb.teimoso, nb.comum));
    assert.ok(b.id);
  } finally { t.sb.limpa(); }
});

test('terminal que já saiu sozinho sai do registro e fechar de novo não quebra', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-ud-'));
  const t = montar({ userData: dir, env: {} });
  try {
    const a = await t.criar();
    const n = await t.neto(0);
    t.estado.lancados[0].filho.kill();
    assert.ok(await F.esperar(() => criarRegistro({ dir }).ler().length === 0, 8000), 'o onExit tira a entrada do registro');
    assert.strictEqual(await t.matar(a.id), true);
    assert.strictEqual(await t.dev.killAll(), 0);
    F.encerrarTodos();
    assert.ok(n);
  } finally { t.sb.limpa(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── ciclo com dependências falsas: WSL, sandbox e teto ──────────────────────
function pty(pid) { return { pid, kill() { this.fechado = true; } }; }

test('WSL fora do sandbox: a sessão Linux é encerrada por marca, com o SID e o boot_id do registro', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-ud-'));
  try {
    const registro = criarRegistro({ dir });
    const chamadas = [];
    const ciclo = criarCiclo({ registro, env: {}, deps: {
      descobrirLider: async () => ({ sid: 4321, boot: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }),
      encerrarSessoesPorMarca: async a => { chamadas.push(a); return { sids: [], hup: [], kill: [] }; },
    } });
    const p = pty(111);
    const tok = 'ab'.repeat(8);
    ciclo.registrar(1, p, { token: tok, distro: 'Ubuntu-24.04' });
    assert.ok(await F.esperar(() => registro.ler()[0]?.sid === 4321, 5000), 'SID do líder registrado');
    await ciclo.encerrar();
    assert.strictEqual(p.fechado, true, 'o wsl.exe também foi fechado');
    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].distro, 'Ubuntu-24.04');
    assert.deepStrictEqual(chamadas[0].entradas, [{ token: tok, sid: 4321, boot: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }]);
    assert.deepStrictEqual(registro.ler(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('WSL em sandbox (RENDRA_HOME): fecha só o pty; a distro real nunca é alcançada', async () => {
  let chamou = false, descobriu = false;
  const ciclo = criarCiclo({ registro: null, env: { RENDRA_HOME: '/x' }, deps: {
    descobrirLider: async () => { descobriu = true; return null; },
    encerrarSessoesPorMarca: async () => { chamou = true; return null; },
  } });
  const p = pty(222);
  ciclo.registrar(1, p, { token: 'cd'.repeat(8), distro: 'Ubuntu-24.04' });
  await ciclo.encerrar();
  assert.strictEqual(p.fechado, true);
  assert.strictEqual(chamou, false);
  assert.strictEqual(descobriu, false);
});

test('o teto de tempo vale: um encerramento que trava não segura a saída da IDE', async () => {
  const ciclo = criarCiclo({ registro: null, env: {}, plataforma: 'linux', deps: {
    encerrarSessoesPorMarca: () => new Promise(() => {}),
    descobrirLider: async () => null,
  } });
  ciclo.registrar(1, pty(333), { token: 'ef'.repeat(8), distro: 'Ubuntu-24.04' });
  const t0 = Date.now();
  await ciclo.encerrar(undefined, { tetoMs: 200 });
  assert.ok(Date.now() - t0 < 1500);
  assert.deepStrictEqual(await ciclo.encerrar(), { encerrados: 0 });
});

test('tokens e PIDs dos terminais da IDE (escopo do Codex): só os vivos', () => {
  const ciclo = criarCiclo({ registro: null, env: {}, deps: {} });
  ciclo.registrar(1, pty(10), { token: '01'.repeat(8) });
  ciclo.registrar(2, pty(20), { token: '02'.repeat(8) });
  ciclo.saiu(1);
  assert.deepStrictEqual(ciclo.tokens(), ['02'.repeat(8)]);
  assert.deepStrictEqual(ciclo.ptyPids(), [20]);
});

test('shell recém-aberto sem pid (node-pty do Windows): só fecha o pty, nunca sinaliza o pid 0', async () => {
  const chamadas = [];
  const sinais = [];
  const real = process.kill;
  process.kill = (pid, sinal) => { sinais.push([pid, sinal]); };
  try {
    const ciclo = criarCiclo({ registro: null, env: {}, plataforma: 'win32', deps: { encerrarArvoresWindows: async e => { chamadas.push(e); return {}; } } });
    const p = pty(0);
    ciclo.registrar(1, p, { token: '12'.repeat(8) });
    await ciclo.encerrar();
    assert.strictEqual(p.fechado, true);
    assert.deepStrictEqual(chamadas, [], 'sem pid não há árvore');
  } finally { process.kill = real; }
  assert.deepStrictEqual(sinais, []);
  // e o encerrador de árvores recusa pid 0 e 1 por conta própria
  const E = require('../src/encerrar-proc');
  const r = await E.encerrarArvoresWindows([{ pid: 0, kill() {} }, { pid: 1, kill() {} }], { prazoMs: 10 });
  assert.deepStrictEqual(r, { arvores: [], forcados: [] });
});

test('o pid que o node-pty preenche depois entra no registro com a hora de criação', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-ud-'));
  try {
    const registro = criarRegistro({ dir });
    const ciclo = criarCiclo({ registro, env: {}, plataforma: 'win32', deps: { listarPids: async pids => pids.map(p => ({ pid: p, inicio: '12345' })) } });
    const p = pty(0);
    ciclo.registrar(1, p, { token: '34'.repeat(8) });
    setTimeout(() => { p.pid = 4242; }, 150);
    assert.ok(await F.esperar(() => registro.ler()[0]?.ptyInicio === '12345', 5000));
    assert.strictEqual(registro.ler()[0].ptyPid, 4242);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a foto da árvore tirada em prepararSaida (before-quit) é reaproveitada no encerramento; foto velha não', async () => {
  let fotos = 0;
  const arvores = async (entradas, { deps }) => { await deps.listar(); return {}; };
  const ciclo = criarCiclo({ registro: null, env: {}, plataforma: 'win32', deps: { listarTudo: async () => { fotos++; return []; }, encerrarArvoresWindows: arvores } });
  ciclo.registrar(1, pty(500), { token: '56'.repeat(8) });
  ciclo.prepararSaida();
  await ciclo.encerrar();
  assert.strictEqual(fotos, 1, 'uma foto só: a do before-quit');
  // sem prepararSaida (atualizador, pty:kill), a foto é tirada na hora
  ciclo.registrar(2, pty(501), { token: '78'.repeat(8) });
  await ciclo.encerrar();
  assert.strictEqual(fotos, 2);
  // sem terminal do Windows, prepararSaida não gasta nada
  const lixo = criarCiclo({ registro: null, env: {}, plataforma: 'win32', deps: { listarTudo: async () => { fotos++; return []; } } });
  lixo.prepararSaida();
  assert.strictEqual(fotos, 2);
});

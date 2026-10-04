// Registro de terminais e varredura ao abrir (T5): a IDE morreu à força e o before-quit não rodou. O efeito é
// conferido pelo SO com árvores falsas criadas pelo teste; só os PIDs do helper podem ser encerrados na limpeza.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const R = require('../src/registro-terminais');
const A = require('../src/agentes-proc');
const F = require('./helpers/falsos');

const win = { skip: !F.WIN && 'só no Windows' };
const linux = { skip: process.platform !== 'linux' && 'só no Linux' };

test.afterEach(() => F.encerrarTodos());

const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-reg-'));

async function arvoreFalsa(sb) {
  const out = path.join(sb.dir, `arvore-${crypto.randomBytes(4).toString('hex')}.json`);
  const pai = F.lancar([sb.arvore, out]);
  assert.ok(await F.esperar(() => fs.existsSync(out), 15000), 'a árvore falsa subiu');
  await new Promise(r => setTimeout(r, 150));
  const { teimoso, comum } = JSON.parse(fs.readFileSync(out, 'utf8'));
  F.adotar(teimoso); F.adotar(comum);
  const inicio = (await A.listarProcessosWindows()).find(p => p.pid === pai.pid).inicio;
  return { pai, teimoso, comum, inicio };
}
const todosMortos = (...pids) => F.esperar(() => pids.every(p => !F.vivo(p)), 8000);

test('registro: grava e lê de forma atômica; JSON cortado ou entrada sem token válido vira lista vazia', () => {
  const dir = pastaTemp();
  try {
    const reg = R.criarRegistro({ dir });
    const t1 = 'a'.repeat(16), t2 = 'b'.repeat(16);
    reg.adicionar({ token: t1, ambiente: 'win', ptyPid: 10 });
    reg.adicionar({ token: t2, ambiente: 'wsl', distro: 'Ubuntu' });
    reg.atualizar(t2, { sid: 55, boot: 'x' });
    assert.deepStrictEqual(reg.ler().map(e => [e.token, e.sid]), [[t1, undefined], [t2, 55]]);
    reg.remover(t1);
    assert.deepStrictEqual(reg.ler().map(e => e.token), [t2]);
    assert.deepStrictEqual(fs.readdirSync(dir), [R.NOME_ARQUIVO], 'nenhum .tmp sobra');
    fs.writeFileSync(reg.arquivo, '[{"token":"aaaaaaaaaaaaaaaa"'); // cortado
    assert.deepStrictEqual(reg.ler(), []);
    fs.writeFileSync(reg.arquivo, JSON.stringify([{ token: 'x; calc' }, null, 3, { token: t1 }]));
    assert.deepStrictEqual(reg.ler().map(e => e.token), [t1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shell vivo e hora de criação conferida: a árvore inteira morre; o irmão de fora, não', win, async () => {
  const sb = F.sandbox(), dir = pastaTemp();
  try {
    const t = await arvoreFalsa(sb);
    const irmao = F.iscaFalsa(sb);
    const reg = R.criarRegistro({ dir });
    reg.adicionar({ token: 'c'.repeat(16), ambiente: 'win', ptyPid: t.pai.pid, ptyInicio: t.inicio, idePid: 1 });
    const r = await R.varrer({ registro: reg });
    assert.ok(await todosMortos(t.pai.pid, t.comum, t.teimoso), 'os três morreram');
    assert.ok(F.vivo(irmao.pid), 'o irmão segue vivo');
    assert.ok(r.encerrados.includes(t.comum));
    assert.deepStrictEqual(reg.ler(), [], 'o registro é limpo');
  } finally { sb.limpa(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shell já morto: os órfãos que apontam para ele e nasceram depois dele morrem', win, async () => {
  const sb = F.sandbox(), dir = pastaTemp();
  try {
    const t = await arvoreFalsa(sb);
    const irmao = F.iscaFalsa(sb);
    t.pai.kill();
    assert.ok(await F.esperar(() => !F.vivo(t.pai.pid)));
    assert.ok(F.vivo(t.comum) && F.vivo(t.teimoso), 'órfãos vivos (como depois de uma queda)');
    const reg = R.criarRegistro({ dir });
    reg.adicionar({ token: 'd'.repeat(16), ambiente: 'win', ptyPid: t.pai.pid, ptyInicio: t.inicio });
    await R.varrer({ registro: reg });
    assert.ok(await todosMortos(t.comum, t.teimoso));
    assert.ok(F.vivo(irmao.pid));
  } finally { sb.limpa(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PID reaproveitado (hora de criação diferente): o processo segue vivo e o registro é limpo', win, async () => {
  const sb = F.sandbox(), dir = pastaTemp();
  try {
    const t = await arvoreFalsa(sb);
    const reg = R.criarRegistro({ dir });
    reg.adicionar({ token: 'e'.repeat(16), ambiente: 'win', ptyPid: t.pai.pid, ptyInicio: String(BigInt(t.inicio) - 5000000000n) });
    await R.varrer({ registro: reg });
    await new Promise(r => setTimeout(r, 400));
    assert.ok(F.vivo(t.pai.pid) && F.vivo(t.comum) && F.vivo(t.teimoso), 'nada foi tocado');
    assert.deepStrictEqual(reg.ler(), []);
  } finally { sb.limpa(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('entrada de processo inexistente ou sem prova só limpa o registro', win, async () => {
  const dir = pastaTemp();
  try {
    const reg = R.criarRegistro({ dir });
    reg.adicionar({ token: 'f'.repeat(16), ambiente: 'win', ptyPid: 2147483000, ptyInicio: '1' });
    reg.adicionar({ token: '1'.repeat(16), ambiente: 'win', ptyPid: process.pid }); // sem hora de criação: sem prova
    const mortos = [];
    const r = await R.varrer({ registro: reg, deps: { matar: pid => mortos.push(pid) } });
    assert.deepStrictEqual(mortos, []);
    assert.deepStrictEqual(r.encerrados, []);
    assert.deepStrictEqual(reg.ler(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('WSL: em sandbox a distro real nunca é tocada; distro parada não é acordada; boot antigo vai ao script', async () => {
  const dir = pastaTemp();
  try {
    const reg = R.criarRegistro({ dir });
    const e = { token: '2'.repeat(16), ambiente: 'wsl', distro: 'Ubuntu-24.04', sid: 77, boot: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    const chamadas = [];
    const encerrarSessoes = async a => { chamadas.push(a); return { sids: [], hup: [], kill: [] }; };
    reg.adicionar(e);
    const sandbox = await R.varrer({ registro: reg, env: { RENDRA_HOME: '/x' }, deps: { encerrarSessoes } });
    assert.strictEqual(sandbox.ignoradas, 1);
    assert.strictEqual(chamadas.length, 0);
    reg.adicionar(e);
    await R.varrer({ registro: reg, env: {}, deps: { encerrarSessoes, distroRodando: async () => false } });
    assert.strictEqual(chamadas.length, 0, 'a VM parada não é acordada');
    reg.adicionar(e);
    await R.varrer({ registro: reg, env: {}, deps: { encerrarSessoes, distroRodando: async () => true } });
    assert.strictEqual(chamadas.length, 1);
    assert.deepStrictEqual(chamadas[0].entradas, [{ token: e.token, sid: 77, boot: e.boot }]);
    assert.strictEqual(chamadas[0].distro, 'Ubuntu-24.04');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Linux: o líder morreu, a sessão com a mesma marca e SID é varrida; sem a marca, o processo da sessão fica', linux, async () => {
  const dir = pastaTemp();
  const { spawn } = require('child_process');
  try {
    const token = crypto.randomBytes(8).toString('hex');
    const lider = spawn('sh', ['-c', 'sleep 800 & (env -u RENDRA_TERM sleep 801) & wait'], { env: { ...process.env, RENDRA_TERM: token }, detached: true, stdio: 'ignore' });
    F.adotar(lider.pid);
    await new Promise(r => setTimeout(r, 800));
    const snap = await A.listarProcessos({ tipo: 'windows' });
    const sessao = snap.procs.filter(p => p.sid === lider.pid);
    sessao.forEach(p => F.adotar(p.pid));
    const cmd = pid => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(String.fromCharCode(0)).join(' ').trim(); } catch { return ''; } };
    const comMarca = sessao.find(p => cmd(p.pid) === 'sleep 800');
    const semMarca = sessao.find(p => cmd(p.pid) === 'sleep 801');
    assert.ok(comMarca && semMarca);
    process.kill(lider.pid, 'SIGKILL'); // a queda: o líder some, os filhos ficam
    await new Promise(r => setTimeout(r, 300));
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const reg = R.criarRegistro({ dir });
    reg.adicionar({ token, ambiente: 'posix', sid: lider.pid, boot });
    await R.varrer({ registro: reg, prazoMs: 300 });
    assert.ok(await todosMortos(comMarca.pid), 'o processo com a marca morreu');
    assert.ok(F.vivo(semMarca.pid), 'sem a marca, com o líder morto, ele não é provadamente nosso e fica');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

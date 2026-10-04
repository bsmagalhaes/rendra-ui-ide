// Encerramento (T2, T8): o efeito é conferido pelo SO (processo vivo ou morto), com árvores falsas criadas pelo teste.
// Nada aqui toca em processo que o teste não criou; a limpeza só alcança os PIDs registrados no helper.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('../src/encerrar-proc');
const A = require('../src/agentes-proc');
const F = require('./helpers/falsos');

// ids únicos por execução: os arquivos de teste rodam em paralelo e nenhum pode enxergar o processo falso do outro
const ID1 = crypto.randomUUID();
const ID2 = crypto.randomUUID();
const ID3 = crypto.randomUUID();
const win = { skip: !F.WIN && 'só no Windows' };
const linux = { skip: process.platform !== 'linux' && 'só no Linux' };

test.afterEach(() => F.encerrarTodos());

async function arvoreFalsa(sb) {
  const out = path.join(sb.dir, `arvore-${crypto.randomBytes(4).toString('hex')}.json`);
  const pai = F.lancar([sb.arvore, out]);
  assert.ok(await F.esperar(() => fs.existsSync(out), 15000), 'a árvore falsa subiu');
  await new Promise(r => setTimeout(r, 150));
  const { teimoso, comum } = JSON.parse(fs.readFileSync(out, 'utf8'));
  F.adotar(teimoso); F.adotar(comum);
  return { pai, teimoso, comum };
}

// ── T2: árvore do terminal ──────────────────────────────────────────────────
test('o defeito original: fechar só o processo do terminal deixa os netos vivos', win, async () => {
  const sb = F.sandbox();
  try {
    const t = await arvoreFalsa(sb);
    t.pai.kill(); // o `p.kill()` antigo: só a raiz
    assert.ok(await F.esperar(() => !F.vivo(t.pai.pid)));
    await new Promise(r => setTimeout(r, 500));
    assert.ok(F.vivo(t.comum) && F.vivo(t.teimoso), 'os netos ficam órfãos e vivos');
  } finally { sb.limpa(); }
});

test('encerra a árvore inteira (neto teimoso e neto comum) e deixa o irmão de fora vivo', win, async () => {
  const sb = F.sandbox();
  try {
    const t = await arvoreFalsa(sb);
    const irmao = F.iscaFalsa(sb);
    const r = await E.encerrarArvoresWindows([{ pid: t.pai.pid, kill: () => t.pai.kill() }], { prazoMs: 300 });
    assert.ok(await F.esperar(() => !F.vivo(t.pai.pid) && !F.vivo(t.comum) && !F.vivo(t.teimoso), 5000), 'os três morreram');
    assert.ok(F.vivo(irmao.pid), 'o irmão fora da árvore segue vivo');
    assert.ok(r.forcados.includes(t.comum) && r.forcados.includes(t.teimoso));
  } finally { sb.limpa(); }
});

test('PID reaproveitado: a hora de criação diferente da foto impede o encerramento forçado', win, async () => {
  const sb = F.sandbox();
  try {
    const t = await arvoreFalsa(sb);
    const real = async pids => (await A.listarProcessosWindows({ filtro: pids.map(p => `ProcessId=${p}`).join(' OR ') })).map(p => ({ ...p, inicio: '1' }));
    await E.encerrarArvoresWindows([{ pid: t.pai.pid, kill: () => t.pai.kill() }], { prazoMs: 200, deps: { listarPids: real } });
    await new Promise(r => setTimeout(r, 300));
    assert.ok(F.vivo(t.comum) && F.vivo(t.teimoso), 'com a hora de criação trocada, os "reaproveitados" não são tocados');
  } finally { sb.limpa(); }
});

test('arvoreDaFoto: filho nascido antes do pai (PID reaproveitado) fica fora', () => {
  const foto = [
    { pid: 10, ppid: 1, inicio: '1000' }, { pid: 11, ppid: 10, inicio: '1100' }, { pid: 12, ppid: 10, inicio: '900' },
    { pid: 13, ppid: 11, inicio: '1200' }, { pid: 99, ppid: 1, inicio: '5000' },
  ];
  assert.deepStrictEqual(E.arvoreDaFoto(foto, 10).map(n => n.pid), [10, 11, 13]);
  assert.deepStrictEqual(E.arvoreDaFoto(foto, 777), []);
});

test('sem os netos vivos nada é forçado; entrada inválida é ignorada', win, async () => {
  const r = await E.encerrarArvoresWindows([{ pid: 'x' }, null], { prazoMs: 50 });
  assert.deepStrictEqual(r, { arvores: [], forcados: [] });
});

// ── T2 no Linux (sessão por marca) ──────────────────────────────────────────
test('sessão por marca: mata o líder e a sessão (inclusive quem ignora SIGHUP); o que saiu por setsid e o de fora ficam', linux, async () => {
  const token = crypto.randomBytes(8).toString('hex');
  const outro = crypto.randomBytes(8).toString('hex');
  const { spawn } = require('child_process');
  const sess = tok => spawn('sh', ['-c', "sleep 700 & (trap '' HUP; exec sleep 701) & setsid sleep 702 & wait"], { env: { ...process.env, RENDRA_TERM: tok }, detached: true, stdio: 'ignore' });
  const lider = sess(token), alheio = sess(outro);
  F.adotar(lider.pid); F.adotar(alheio.pid);
  await new Promise(r => setTimeout(r, 800));
  const snap = await A.listarProcessos({ tipo: 'windows' });
  const filhos = ppid => snap.procs.filter(p => p.ppid === ppid || p.sid === ppid);
  const meus = filhos(lider.pid), alheios = filhos(alheio.pid);
  meus.forEach(p => F.adotar(p.pid)); alheios.forEach(p => F.adotar(p.pid));
  const r = await E.encerrarSessoesPorMarca({ entradas: [{ token }], prazoMs: 300 });
  assert.ok(r.sids.includes(lider.pid));
  await new Promise(r2 => setTimeout(r2, 300));
  const dentro = meus.filter(p => p.sid === lider.pid);
  assert.ok(dentro.length >= 3, 'líder, sleep 700 e sleep 701 estavam na sessão');
  for (const p of dentro) assert.ok(!F.vivo(p.pid), `pid ${p.pid} da sessão morreu`);
  const saiu = meus.find(p => p.args.join(' ') === 'sleep 702');
  assert.ok(saiu && F.vivo(saiu.pid), 'o que saiu da sessão (tmux) segue vivo');
  for (const p of alheios) assert.ok(F.vivo(p.pid), 'a sessão com outra marca segue viva');
});

test('descobrirLider e recusas: token e distro inválidos nunca chegam ao shell', async () => {
  assert.strictEqual(await E.descobrirLider({ token: 'x; calc' }), null);
  assert.strictEqual(await E.descobrirLider({ distro: 'a b', token: 'a'.repeat(16) }), null);
  assert.strictEqual(await E.encerrarSessoesPorMarca({ distro: '--exec', entradas: [{ token: 'a'.repeat(16) }] }), null);
  assert.deepStrictEqual(await E.encerrarSessoesPorMarca({ entradas: [{ token: '$(calc)' }, { token: '' }] }), { sids: [], hup: [], kill: [] });
});

test('a marca registrada num boot antigo não encerra nada (distro reiniciada)', async () => {
  const chamadas = [];
  const execFileFn = (file, args, opts, cb) => { chamadas.push(args); cb(null, ''); };
  const r = await E.encerrarSessoesPorMarca({ distro: 'Ubuntu', entradas: [{ token: 'a'.repeat(16), sid: 55, boot: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }], execFileFn, prazoMs: 100 });
  assert.deepStrictEqual(r, { sids: [], hup: [], kill: [] });
  assert.match(chamadas[0].join(' '), /bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/); // o boot_id vai ao script, que compara com o atual
  assert.strictEqual(chamadas[0][0], '-d');
  assert.ok(chamadas[0].includes('sh') && chamadas[0].includes('-e'), 'sem shell de login nem expansão de dado externo');
});

// ── T8: só o agente da conversa ─────────────────────────────────────────────
const ver = F.WIN || process.platform === 'linux' ? {} : { skip: 'Mac: só por argumento' };

function homeFalsa(sb, claude = [], codex = []) {
  const home = path.join(sb.dir, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex', 'sessions', '2026', '10', '04'), { recursive: true });
  for (const id of claude) fs.writeFileSync(path.join(home, '.claude', 'projects', 'p', `${id}.jsonl`), '{}\n');
  for (const id of codex) fs.writeFileSync(path.join(home, '.codex', 'sessions', '2026', '10', '04', `rollout-2026-10-04T00-00-00-${id}.jsonl`), '{}\n');
  return home;
}
const envSb = home => ({ ...process.env, RENDRA_HOME: home, CODEX_HOME: path.join(home, '.codex') });
const amb = { tipo: 'windows' };

// "tmux" falso (pai), "bash" falso (filho dele), e o claude falso (neto)
async function cadeiaDeAgente(sb, id) {
  const out = path.join(sb.dir, `cad-${crypto.randomBytes(4).toString('hex')}.json`);
  const tmux = F.iscaFalsa(sb);
  const bash = F.lancar([sb.cadeia, out, sb.cli, '--resume', id]);
  assert.ok(await F.esperar(() => fs.existsSync(out), 15000));
  const claude = JSON.parse(fs.readFileSync(out, 'utf8')).filho;
  F.adotar(claude);
  return { tmux, bash, claude };
}

test('encerra só o agente da conversa: o bash e o tmux falsos continuam vivos (reproduz P1)', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [ID1, ID2]);
    const alvo = await cadeiaDeAgente(sb, ID1);
    const outraConversa = F.claudeFalso(sb, ['--resume', ID2]);
    await F.esperar(async () => (await A.detectarAgentes({ amb, env: envSb(home) })).agentes.some(a => a.pid === alvo.claude && a.pid && outraConversa.pid), 20000);
    const r = await E.encerrarDonoDaConversa({ amb, provedor: 'claude', id: ID1, env: envSb(home), prazoMs: 300 });
    assert.deepStrictEqual(r.donos, [alvo.claude]);
    assert.ok(await F.esperar(() => !F.vivo(alvo.claude), 5000), 'o agente da conversa morreu');
    assert.ok(F.vivo(alvo.bash.pid), 'o bash falso (pai) segue vivo');
    assert.ok(F.vivo(alvo.tmux.pid), 'o tmux falso segue vivo');
    assert.ok(F.vivo(outraConversa.pid), 'o agente de outra conversa segue vivo');
  } finally { sb.limpa(); }
});

test('dois processos para o mesmo id morrem; --continue com metadado válido também', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [ID1]);
    const a = F.claudeFalso(sb, ['--resume', ID1]);
    const b = F.claudeFalso(sb, ['--session-id', ID1]);
    const c = F.claudeFalso(sb, ['--continue']);
    let inicioC;
    await F.esperar(async () => { const s = await A.listarProcessos(amb); inicioC = s && s.procs.find(p => p.pid === c.pid)?.inicio; return !!inicioC && s.procs.some(p => p.pid === a.pid) && s.procs.some(p => p.pid === b.pid); }, 20000);
    const machine = fs.existsSync('/etc/machine-id') ? fs.readFileSync('/etc/machine-id', 'utf8').trim() : 'x';
    fs.writeFileSync(path.join(home, '.claude', 'sessions', `${c.pid}.json`), JSON.stringify({
      pid: c.pid, sessionId: ID1, cwd: sb.dir, procStart: inicioC, pidDomain: F.WIN ? `win32:${require('os').hostname()}` : `linux:${machine}:pid:[1]`,
    }));
    const r = await E.encerrarDonoDaConversa({ amb, provedor: 'claude', id: ID1, env: envSb(home), prazoMs: 300 });
    assert.deepStrictEqual([...r.donos].sort(), [a.pid, b.pid, c.pid].sort());
    assert.ok(await F.esperar(() => !F.vivo(a.pid) && !F.vivo(b.pid) && !F.vivo(c.pid), 5000));
  } finally { sb.limpa(); }
});

test('codex de fora da IDE nunca é encerrado; o de dentro (descendente do terminal da IDE) é', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [], [ID3]);
    const termDaIde = F.iscaFalsa(sb); const token = crypto.randomBytes(8).toString('hex'); // o "terminal da IDE" leva a marca (Linux) e é o pai do shell (Windows)
    const dentroPid = await (async () => {
      const out = path.join(sb.dir, 'cx.json');
      const shell = F.lancar([sb.cadeia, out, sb.cliCodex, 'resume', ID3], { env: { ...process.env, RENDRA_TERM: token } });
      assert.ok(await F.esperar(() => fs.existsSync(out), 15000));
      const filho = JSON.parse(fs.readFileSync(out, 'utf8')).filho; F.adotar(filho);
      return { shell, filho };
    })();
    const fora = F.codexFalso(sb, ['resume', ID3]);
    await F.esperar(async () => { const s = await A.listarProcessos(amb); return s && s.procs.some(p => p.pid === fora.pid) && s.procs.some(p => p.pid === dentroPid.filho); }, 20000);
    const r = await E.encerrarDonoDaConversa({ amb, provedor: 'codex', id: ID3, env: envSb(home), tokens: [token], ptyPids: [dentroPid.shell.pid], prazoMs: 300 });
    assert.deepStrictEqual(r.donos, [dentroPid.filho]);
    assert.ok(await F.esperar(() => !F.vivo(dentroPid.filho), 5000));
    assert.ok(F.vivo(fora.pid), 'o codex de fora da IDE segue vivo');
    assert.ok(F.vivo(dentroPid.shell.pid) && F.vivo(termDaIde.pid));
    const sem = await E.encerrarDonoDaConversa({ amb, provedor: 'codex', id: ID3, env: envSb(home), tokens: [], ptyPids: [], prazoMs: 100 });
    assert.deepStrictEqual(sem.encerrados, []); // sem terminal da IDE, nada do Codex é seu
    assert.ok(F.vivo(fora.pid));
  } finally { sb.limpa(); }
});

test('id nulo, provedor desconhecido e leitura que falha não encerram nada', async () => {
  assert.deepStrictEqual(await E.encerrarDonoDaConversa({ amb, provedor: 'claude', id: null }), { encerrados: [], donos: [] });
  assert.deepStrictEqual(await E.encerrarDonoDaConversa({ amb, provedor: 'outro', id: ID1 }), { encerrados: [], donos: [] });
  assert.strictEqual(await E.encerrarDonoDaConversa({ amb, provedor: 'claude', id: ID1, deps: { detectar: async () => null } }), null);
  let chamou = false;
  const r = await E.encerrarDonoDaConversa({ amb, provedor: 'claude', id: ID1, deps: { detectar: async () => ({ agentes: [], snap: { procs: [], sessoes: [], plataforma: 'win32' } }), encerrarAgentes: async () => { chamou = true; return { encerrados: [] }; } } });
  assert.deepStrictEqual(r, { encerrados: [], donos: [] });
  assert.strictEqual(chamou, false);
});

test('PID reaproveitado entre a leitura e o sinal: o início conferido no script impede o SIGTERM (WSL)', async () => {
  const chamadas = [];
  const execFileFn = (file, args, opts, cb) => { chamadas.push({ file, args }); cb(null, ''); };
  const r = await E.encerrarAgentes({ amb: { tipo: 'wsl', distro: 'Ubuntu-24.04' }, alvos: [{ pid: 1234, inicio: '999' }, { pid: 1, inicio: '1' }, { pid: 'x', inicio: '2' }], prazoMs: 100, execFileFn });
  assert.deepStrictEqual(r.encerrados, []);
  assert.strictEqual(chamadas.length, 1);
  assert.ok(chamadas[0].args.includes('1234:999') && !chamadas[0].args.some(a => /^1:1$/.test(a)), 'pid 1 e pid inválido nunca vão ao script');
  assert.match(chamadas[0].args.find(a => a.includes('kill -TERM')), /\[ "\$cur" = "\$st" \]/); // só sinaliza se o início confere
});

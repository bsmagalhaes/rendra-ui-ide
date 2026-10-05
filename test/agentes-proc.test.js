// Detector de agentes vivos (T6): reconhecimento puro, leitura de /proc e do metadado de sessão, e o efeito pelo SO
// com processos falsos criados pelo teste (nunca o claude real, nunca por nome).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const A = require('../src/agentes-proc');
const F = require('./helpers/falsos');

// ids únicos por execução: os arquivos de teste rodam em paralelo e nenhum pode enxergar o processo falso do outro
const ID1 = crypto.randomUUID();
const ID2 = crypto.randomUUID();
const ID3 = crypto.randomUUID();

test.afterEach(() => F.encerrarTodos());

const r = (...args) => A.reconhecer({ nome: '', args });

test('reconhece o agente só pela imagem e pelo id em token exato', () => {
  assert.deepStrictEqual(r('claude', '--resume', ID1), { provedor: 'claude', id: ID1, fork: false });
  assert.strictEqual(r('/usr/bin/claude', '-r', ID1).id, ID1);
  assert.strictEqual(r('claude', `--resume=${ID1}`).id, ID1);
  assert.strictEqual(r('claude', '--session-id', ID2).id, ID2);
  assert.strictEqual(r('C:\\Users\\x\\claude.exe', '--resume', ID1).id, ID1);
  assert.strictEqual(r('node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', ID1).id, ID1);
  assert.strictEqual(r('C:\\Program Files\\nodejs\\node.exe', 'C:\\n\\node_modules\\@anthropic-ai\\claude-code\\cli.js', '--session-id', ID3).id, ID3);
  assert.strictEqual(r('claude', '--continue').id, null);
  assert.strictEqual(r('claude').provedor, 'claude');
  assert.strictEqual(r('claude', '--resume', 'nao-e-uuid').id, null);
});

test('--fork-session não deixa o id original em uso; as iscas reais não são agentes', () => {
  assert.strictEqual(r('claude', '--resume', ID1, '--fork-session').id, null);
  assert.strictEqual(r('claude', '--fork-session', '--session-id', ID2, '--resume', ID1).id, ID2);
  // isca 1: o servidor tmux tem "claude" no argv (nome de sessão), mas a imagem é tmux
  assert.strictEqual(r('tmux', 'new-session', '-d', '-s', 'claude', '-n', 'code', '-c', '/home/bruno'), null);
  // isca 2: bash com o id da conversa dentro de um caminho
  assert.strictEqual(r('bash', '-c', `cd /tmp/claude-1000/-mnt-d-SOEs/${ID1}/scratchpad && ls`), null);
  assert.strictEqual(r('node', '/app/server.js', '--resume', ID1), null);
  assert.strictEqual(r('node', '/tmp/cadeia.js', '/n/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', ID1), null); // o cli.js tem que ser o script
  assert.strictEqual(r('claude', 'mcp', 'serve'), null);
  assert.strictEqual(r('claude', 'update'), null);
});

test('codex: só `codex resume <id>` tem id; o daemon compartilhado e o host não são agentes', () => {
  assert.deepStrictEqual(r('codex', 'resume', ID1), { provedor: 'codex', id: ID1, fork: false });
  assert.strictEqual(r('codex', 'resume', '--last').id, null);
  assert.strictEqual(r('codex').id, null);
  assert.strictEqual(r('codex', '--resume', ID1).id, null); // retomar no Codex nunca é --resume
  assert.strictEqual(r('codex', 'app-server', '--listen', 'unix:///tmp/x.sock'), null);
  assert.strictEqual(r('codex-code-mode-host', '--x'), null);
  assert.strictEqual(r('codex', 'mcp-server'), null);
});

test('divide a linha de comando do Windows como o CommandLineToArgvW', () => {
  assert.deepStrictEqual(A.dividirLinha('"C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\cli.js" --resume ' + ID1),
    ['C:\\Program Files\\nodejs\\node.exe', 'C:\\a b\\cli.js', '--resume', ID1]);
  assert.deepStrictEqual(A.dividirLinha('a "b \\"c\\"" d'), ['a', 'b "c"', 'd']);
  assert.deepStrictEqual(A.dividirLinha(''), []);
});

// ── /proc de exemplo ────────────────────────────────────────────────────────
const US = '\u001f';
const MID = '97974d14ab3743af9415e61ab15665d4';
const AMOSTRA = [
  'B\tbbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  `M\t${MID}`,
  'T\t285\t223\t285\t5000\ttmux: server', 'T\t286\t285\t286\t5001\tbash', 'T\t1565722\t1562793\t1562793\t22337449\tclaude',
  'T\t1681991\t286\t286\t77777\tclaude', 'T\t1686475\t1\t1686475\t900\tbash', 'T\t4494\t1\t4494\t10\tcodex',
  `P\t285\ttmux${US}new-session${US}-d${US}-s${US}claude\t`,
  `P\t1565722\tclaude${US}--resume${US}${ID1}\t`,
  `P\t1681991\tclaude${US}--continue\t`,
  `P\t1686475\tbash${US}-c${US}cd /tmp/claude-1000/x/${ID2}/scratchpad\t`,
  `P\t4494\tcodex${US}app-server${US}--listen${US}unix:///tmp/s.sock\t`,
  `S\t${JSON.stringify({ pid: 1565722, sessionId: ID1, cwd: '/mnt/d/x', procStart: '22337449', pidDomain: `linux:${MID}:pid:[4026532219]` })}`,
  `S\t${JSON.stringify({ pid: 1681991, sessionId: ID2, cwd: '/home/b', procStart: '77777', pidDomain: `linux:${MID}:pid:[4026532219]` })}`,
].join('\n');

test('lê o /proc de exemplo: só os agentes, id por argumento ou pelo metadado válido', () => {
  const snap = { ...A.parsearLinux(AMOSTRA), plataforma: 'linux', host: null };
  const ag = A.agentesDoInstantaneo(snap);
  assert.deepStrictEqual(ag.map(a => [a.pid, a.provedor, a.id, a.comArgumento]).sort((a, b) => a[0] - b[0]),
    [[1565722, 'claude', ID1, true], [1681991, 'claude', ID2, false]]);
  assert.strictEqual(ag.find(a => a.pid === 1681991).cwd, '/home/b');
});

test('metadado inválido não dá id: início diferente, outra máquina, PID de outro processo, uuid ruim', () => {
  const base = { ...A.parsearLinux(AMOSTRA), plataforma: 'linux', host: null };
  const com = j => ({ ...base, sessoes: [{ pid: 1681991, sessionId: ID2, cwd: '/x', procStart: '77777', pidDomain: `linux:${MID}:pid:[1]`, ...j }] });
  const id = s => A.agentesDoInstantaneo(s).find(a => a.pid === 1681991).id;
  assert.strictEqual(id(com({})), ID2);
  assert.strictEqual(id(com({ procStart: '77778' })), null); // PID reaproveitado
  assert.strictEqual(id(com({ pidDomain: 'win32:tiago' })), null);
  assert.strictEqual(id(com({ pidDomain: 'linux:outramaquina:pid:[1]' })), null);
  assert.strictEqual(id(com({ pid: 999 })), null);
  assert.strictEqual(id(com({ sessionId: 'x; rm -rf /' })), null);
  assert.strictEqual(id(com({ sessionId: undefined })), null);
  assert.strictEqual(id({ ...base, sessoes: [null, 3, { pid: 'x' }] }), null); // lixo no diretório não lança
});

test('donos da conversa: claude de qualquer lugar; codex só os que nasceram de um terminal da IDE', () => {
  const tok = 'a'.repeat(16);
  const base = A.parsearLinux([
    'T\t100\t1\t100\t10\tbash', 'T\t101\t100\t100\t11\tcodex', 'T\t200\t1\t200\t20\tbash', 'T\t201\t200\t200\t21\tcodex',
    'T\t300\t100\t300\t30\ttmux', 'T\t301\t300\t301\t31\tcodex', 'T\t400\t1\t400\t5\tclaude',
    `P\t100\tbash\t${tok}`, `P\t101\tcodex${US}resume${US}${ID1}\t`, 'P\t200\tbash\t', `P\t201\tcodex${US}resume${US}${ID1}\t`,
    `P\t300\ttmux\t${tok}`, `P\t301\tcodex${US}resume${US}${ID1}\t`, `P\t400\tclaude${US}--resume${US}${ID2}\t`,
  ].join('\n'));
  const snap = { ...base, plataforma: 'linux', host: null };
  const codex = A.donosDaConversa(snap, { provedor: 'codex', id: ID1, tokens: [tok], ptyPids: [] }).map(a => a.pid);
  assert.deepStrictEqual(codex, [101]); // 201 é de fora; 301 está num tmux (sessão própria) iniciado depois do líder
  const claude = A.donosDaConversa(snap, { provedor: 'claude', id: ID2, tokens: [], ptyPids: [] }).map(a => a.pid);
  assert.deepStrictEqual(claude, [400]);
});

// ── efeito pelo SO, com processos falsos ────────────────────────────────────
const ver = F.WIN || process.platform === 'linux' ? {} : { skip: 'leitura de processos do Mac é só por argumento' };

async function inicioDe(pid) {
  const snap = await A.listarProcessos({ tipo: 'windows' });
  return snap && snap.procs.find(p => p.pid === pid)?.inicio;
}

function homeFalsa(sb, ids) {
  const home = path.join(sb.dir, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  for (const id of ids) fs.writeFileSync(path.join(home, '.claude', 'projects', 'p', `${id}.jsonl`), '{}\n');
  return home;
}

test('processos reais: três claude falsos e uma isca; mapa id para PIDs exato, sem falso positivo', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [ID1, ID2, ID3]);
    const a = F.claudeFalso(sb, ['--resume', ID1]);
    const b = F.claudeFalso(sb, ['--session-id', ID2]);
    const c = F.claudeFalso(sb, ['--continue']);
    const isca = F.iscaFalsa(sb, ['--resume', ID1, ID3]);
    let inicioC;
    await F.esperar(async () => (inicioC = await inicioDe(c.pid)), 15000);
    assert.ok(inicioC, 'o falso sem id aparece na leitura de processos');
    // o claude real grava este arquivo; o falso não segura a conversa aberta, como o real
    fs.writeFileSync(path.join(home, '.claude', 'sessions', `${c.pid}.json`), JSON.stringify({
      pid: c.pid, sessionId: ID3, cwd: sb.dir, procStart: inicioC, pidDomain: F.WIN ? `win32:${os.hostname()}` : `linux:${fs.existsSync('/etc/machine-id') ? fs.readFileSync('/etc/machine-id', 'utf8').trim() : 'x'}:pid:[1]`,
    }));
    const t0 = Date.now();
    const res = await A.detectarAgentes({ amb: { tipo: 'windows' }, env: { ...process.env, RENDRA_HOME: home } });
    const mapa = {};
    for (const x of res.agentes) if ([a.pid, b.pid, c.pid, isca.pid].includes(x.pid)) (mapa[x.id] ||= []).push(x.pid);
    assert.deepStrictEqual(mapa, { [ID1]: [a.pid], [ID2]: [b.pid], [ID3]: [c.pid] });
    assert.ok(!res.agentes.some(x => x.pid === isca.pid), 'a isca com o id no argv não é agente');
    assert.ok(Date.now() - t0 < 15000);
  } finally { sb.limpa(); }
});

test('metadado de PID reaproveitado no processo real não vale (procStart diferente)', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [ID3]);
    const c = F.claudeFalso(sb, ['--continue']);
    let inicioC;
    await F.esperar(async () => (inicioC = await inicioDe(c.pid)), 15000);
    fs.writeFileSync(path.join(home, '.claude', 'sessions', `${c.pid}.json`), JSON.stringify({
      pid: c.pid, sessionId: ID3, cwd: sb.dir, procStart: String(BigInt(inicioC) + 900000000n), pidDomain: F.WIN ? `win32:${os.hostname()}` : 'linux:x:pid:[1]',
    }));
    const res = await A.detectarAgentes({ amb: { tipo: 'windows' }, env: { ...process.env, RENDRA_HOME: home } });
    assert.ok(!res.agentes.some(x => x.pid === c.pid && x.id), 'sem prova de início, o processo fica sem id');
  } finally { sb.limpa(); }
});

test('sandbox (RENDRA_HOME): só valem conversas que existem na pasta falsa; WSL nunca', ver, async () => {
  const sb = F.sandbox();
  try {
    const home = homeFalsa(sb, [ID1]);
    const meu = F.claudeFalso(sb, ['--resume', ID1]);
    const real = F.claudeFalso(sb, ['--resume', ID2]); // um "claude real do dono": id fora da pasta falsa
    await F.esperar(async () => !!(await inicioDe(meu.pid)) && !!(await inicioDe(real.pid)), 15000);
    const res = await A.detectarAgentes({ amb: { tipo: 'windows' }, env: { ...process.env, RENDRA_HOME: home } });
    const pids = res.agentes.map(x => x.pid);
    assert.ok(pids.includes(meu.pid));
    assert.ok(!pids.includes(real.pid));
    const w = await A.detectarAgentes({ amb: { tipo: 'wsl', distro: 'Qualquer' }, env: { RENDRA_HOME: home }, listar: async () => { throw new Error('não deve listar'); } });
    assert.deepStrictEqual(w.agentes, []);
  } finally { sb.limpa(); }
});

test('leitura que falha devolve null (o seletor segue sem a marca) e nome de distro hostil é recusado', async () => {
  const res = await A.detectarAgentes({ amb: { tipo: 'windows' }, env: {}, listar: async () => null });
  assert.strictEqual(res, null);
  assert.strictEqual(await A.listarProcessos({ tipo: 'wsl', distro: 'x; calc' }), null);
  assert.strictEqual(await A.listarProcessos({ tipo: 'wsl', distro: '--exec' }), null);
});

// ── leitura por ambiente com o execFile injetado (nada roda na máquina) ─────
const executa = saida => (file, args, opts, cb) => { executa.chamadas.push({ file, args }); cb(null, saida); };
executa.chamadas = [];

test('Mac: só a linha de comando do `ps`; o metadado de sessão não vale sem prova de início', async () => {
  executa.chamadas.length = 0;
  const ps = [`  901   1 /usr/local/bin/node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume ${ID1}`, '  902   1 /usr/local/bin/node /x/cli.js --continue', '  903   1 claude --continue', 'lixo'].join('\n');
  const snap = await A.listarProcessos({ tipo: 'windows' }, { plataforma: 'darwin', env: {}, execFileFn: executa(ps) });
  assert.strictEqual(executa.chamadas[0].file, 'ps');
  const ag = A.agentesDoInstantaneo({ ...snap, sessoes: [{ pid: 903, sessionId: ID2, procStart: '1', pidDomain: 'darwin:x' }] });
  assert.deepStrictEqual(ag.map(a => [a.pid, a.id]), [[901, ID1], [903, null]]);
  assert.strictEqual(await A.listarProcessos({ tipo: 'windows' }, { plataforma: 'darwin', env: {}, execFileFn: (f, a, o, cb) => cb(new Error('x')) }), null);
  assert.strictEqual(await A.listarProcessos({ tipo: 'windows' }, { plataforma: 'freebsd', env: {} }), null);
});

test('Linux e WSL: um `sh` lê o /proc; o WSL vai por wsl.exe -d <distro> -e sh -c; no sandbox o HOME é o da pasta falsa', async () => {
  executa.chamadas.length = 0;
  const nativo = await A.listarProcessos({ tipo: 'windows' }, { plataforma: 'linux', env: { RENDRA_HOME: '/tmp/falso' }, execFileFn: executa(AMOSTRA) });
  assert.strictEqual(executa.chamadas[0].file, 'sh');
  assert.strictEqual(nativo.procs.length, 6);
  const wsl = await A.listarProcessos({ tipo: 'wsl', distro: 'Ubuntu-24.04' }, { env: {}, execFileFn: executa(AMOSTRA) });
  assert.deepStrictEqual(executa.chamadas[1].args.slice(0, 5), ['-d', 'Ubuntu-24.04', '-e', 'sh', '-c']);
  assert.strictEqual(wsl.plataforma, 'linux');
  assert.strictEqual(wsl.machineId, MID);
});

test('Windows: lê os metadados de sessão da pasta do home (só arquivos <pid>.json válidos)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-sess-home-'));
  try {
    const s = path.join(dir, '.claude', 'sessions');
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(path.join(s, '10.json'), JSON.stringify({ pid: 10, sessionId: ID1 }));
    fs.writeFileSync(path.join(s, '11.json'), '{cortado');
    fs.writeFileSync(path.join(s, 'nao-e-pid.json'), JSON.stringify({ pid: 12 }));
    fs.writeFileSync(path.join(s, '10.abc.key'), 'x');
    const ps = JSON.stringify([{ p: 10, pp: 1, n: 'claude.exe', c: '"C:/x/claude.exe" --continue', t: '5' }]);
    const snap = await A.listarProcessos({ tipo: 'windows' }, { plataforma: 'win32', env: { RENDRA_HOME: dir }, execFileFn: executa(ps) });
    assert.deepStrictEqual(snap.sessoes.map(x => x.pid), [10]);
    assert.strictEqual(snap.procs[0].inicio, '5');
    assert.strictEqual(A.parsearWindows('nao é json').length, 0);
    assert.deepStrictEqual(A.parsearWindows(JSON.stringify({ p: 3, pp: 1, n: 'x', c: null, t: null })).map(p => p.pid), [3]); // um só processo vem como objeto
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a descendência do terminal usa a foto completa: pty, conhost, cmd.exe, conhost, node (shim claude.cmd) é da IDE', async () => {
  const procs = [
    { pid: 100, ppid: 1, nome: 'electron.exe', args: ['electron.exe'], inicio: '1' },
    { pid: 200, ppid: 100, nome: 'pwsh.exe', args: ['pwsh.exe'], inicio: '2' }, // o shell do pty
    { pid: 201, ppid: 200, nome: 'conhost.exe', args: ['conhost.exe'], inicio: '3' },
    { pid: 202, ppid: 201, nome: 'cmd.exe', args: ['cmd.exe', '/c', 'claude.cmd', '--resume', ID1], inicio: '4' },
    { pid: 203, ppid: 202, nome: 'conhost.exe', args: ['conhost.exe'], inicio: '5' },
    { pid: 204, ppid: 203, nome: 'node.exe', args: ['node.exe', 'C:/n/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', ID1], inicio: '6' },
    { pid: 300, ppid: 1, nome: 'node.exe', args: ['node.exe', 'C:/n/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', ID1], inicio: '7' }, // de fora
  ];
  const filtros = [];
  const listar = async (amb, op) => { filtros.push(op.filtroWindows); return { plataforma: 'win32', host: 'h', procs, sessoes: [] }; };
  const r = await A.detectarAgentes({ amb: { tipo: 'windows' }, env: {}, listar, tokens: [], ptyPids: [200] });
  assert.deepStrictEqual(filtros, [undefined], 'sem filtro por nome de imagem');
  assert.ok(r.donosIde.has(204), 'o agente atrás do cmd.exe e do conhost é da IDE');
  assert.ok(!r.donosIde.has(300), 'o de fora não é');
  const donos = A.donosDaConversa(r.snap, { provedor: 'claude', id: ID1, tokens: [], ptyPids: [200] }).map(d => d.pid).sort();
  assert.deepStrictEqual(donos, [204, 300]);
});

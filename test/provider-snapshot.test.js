// Canal leve da barra: identidade e limites por provedor e ambiente. Tudo com dados fictícios em
// pasta temporária e deps injetadas (sem WSL real, sem rede, sem credenciais do usuário).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { snapshotProvedores } = require('../src/provider-snapshot');
const { contaClaudeDoHome } = require('../src/accounts');
const { lerContaCodex } = require('../src/codex-account');
const codexLimits = require('../src/codex-limits');
const { _limpaCache } = codexLimits;
const { wslRoots, _limpaCache: limpaWsl } = require('../src/wsl-roots');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const escreve = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); };
const authCodex = (dir, org) => escreve(path.join(dir, 'auth.json'), {
  tokens: { id_token: `x.${b64({ email: 'cx@exemplo.test', name: 'Cx Demo', 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', organizations: [{ title: org, is_default: true }] } })}.y`, access_token: 'SENTINELA-ACESSO', refresh_token: 'SENTINELA-RENOVA' },
});
// Relógio fixo: o rollout é fabricado na pasta 2026/10/03 e limitesLeves poda por data (8 dias),
// então nada aqui pode depender de Date.now().
const AGORA = Date.UTC(2026, 9, 3, 12);
const limitesLeves = (dir, deps) => codexLimits.limitesLeves(dir, { agora: AGORA, ...deps });
const resetSeg = Math.floor((AGORA + 86400000) / 1000);
const rolloutCodex = (sessionsDir, pct) => {
  const f = path.join(sessionsDir, '2026', '10', '03', 'rollout-x.jsonl');
  escreve(f, JSON.stringify({ timestamp: new Date(AGORA).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: pct, window_minutes: 10080, resets_at: resetSeg }, secondary: null } } }) + '\n');
};
const depsBase = (extra = {}) => ({
  homeIde: '/nao-usado', codexHome: () => '/nao-usado', statuslineLimits: () => ({ limits: null }),
  contaClaudeDoHome: async () => null, lerContaCodex: async () => null, limitesLeves: async () => ({ limits: [], fetchedAt: null }),
  wslRoots: async () => ({ claude: [], codex: [] }), nomeHost: 'Windows', pulaWsl: false, tempoMs: 200, ...extra,
});
const claudeConta = { email: 'ana@exemplo.test', name: 'Ana', organization: 'Empresa Demo', plan: 'max', tier: 't' };

test.beforeEach(() => { _limpaCache(); limpaWsl(); });

test('Windows: Claude com conta e limites da statusline, Codex com conta e o semanal', async () => {
  const r = await snapshotProvedores({ wsl: false }, depsBase({
    statuslineLimits: () => ({ limits: [{ kind: 'session', percent: 42, resetsAt: 1 }, { kind: 'weekly_all', percent: 27, resetsAt: 2 }], fetchedAt: 1000 }),
    contaClaudeDoHome: async () => claudeConta,
    lerContaCodex: async () => ({ email: 'cx@exemplo.test', name: 'Cx', organization: 'Org Cx', plan: 'pro' }),
    limitesLeves: async () => ({ limits: [{ kind: 'weekly_all', percent: 9, resetsAt: 3 }], fetchedAt: 2000 }),
  }));
  assert.deepStrictEqual(r.map(e => [e.id, e.provedor, e.ambiente]), [['claude:local', 'claude', 'Windows'], ['codex:local', 'codex', 'Windows']]);
  assert.deepStrictEqual(r[0].limits.map(l => l.percent), [42, 27]);
  assert.strictEqual(r[0].fetchedAt, 1000);
  assert.strictEqual(r[0].conta.organization, 'Empresa Demo');
  assert.deepStrictEqual(r[1].limits, [{ kind: 'weekly_all', percent: 9, resetsAt: 3 }]);
  assert.strictEqual(r[1].fetchedAt, 2000);
});

test('uma opção entra com conta OU limites: sem login mas com statusline, e login sem limites; nada, nada', async () => {
  const semLogin = await snapshotProvedores({}, depsBase({ statuslineLimits: () => ({ limits: [{ kind: 'session', percent: 42, resetsAt: 1 }], fetchedAt: 5 }) }));
  assert.deepStrictEqual(semLogin.map(e => e.id), ['claude:local']);
  assert.strictEqual(semLogin[0].conta, null);
  const semLimites = await snapshotProvedores({}, depsBase({ contaClaudeDoHome: async () => claudeConta }));
  assert.deepStrictEqual(semLimites.map(e => e.id), ['claude:local']);
  assert.strictEqual(semLimites[0].limits, null);
  assert.deepStrictEqual(await snapshotProvedores({}, depsBase()), []);
});

test('o canal não usa currentAccount nem rede: só as funções de leitura injetadas', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'provider-snapshot.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/currentAccount|fetch\(|https?:\/\//.test(src), 'sem currentAccount, fetch ou URL no código');
});

test('wsl: false nunca descobre distros; wsl: true com RENDRA_HOME/RENDRA_NO_WSL (pulaWsl) devolve vazio sem descobrir', async () => {
  let chamadas = 0;
  const wslRootsEspiao = async () => { chamadas++; return { claude: [], codex: [] }; };
  await snapshotProvedores({ wsl: false }, depsBase({ wslRoots: wslRootsEspiao }));
  assert.strictEqual(chamadas, 0);
  assert.deepStrictEqual(await snapshotProvedores({ wsl: true }, depsBase({ wslRoots: wslRootsEspiao, pulaWsl: true })), []);
  assert.strictEqual(chamadas, 0);
});

test('distros: uma opção por provedor e distro, com id estável; Claude sem limites, Codex com o semanal', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-snap-'));
  const ub = path.join(base, 'Ubuntu-24.04', 'home', 'ana');
  escreve(path.join(ub, '.claude', 'projects', 'p', 's.jsonl'), '{}\n');
  escreve(path.join(ub, '.claude.json'), { oauthAccount: { emailAddress: 'wsl@exemplo.test', organizationName: 'Org WSL' } });
  authCodex(path.join(ub, '.codex'), 'Org Codex WSL');
  rolloutCodex(path.join(ub, '.codex', 'sessions'), 12);
  const deps = depsBase({
    contaClaudeDoHome, lerContaCodex, limitesLeves,
    wslRoots: () => wslRoots({ platform: 'win32', ttl: 0, listDistros: async () => [{ name: 'Ubuntu-24.04', state: 'Running' }], uncRoot: n => path.join(base, n) }),
  });
  const r = await snapshotProvedores({ wsl: true }, deps);
  assert.deepStrictEqual(r.map(e => [e.id, e.ambiente]), [['claude:wsl:Ubuntu-24.04', 'Ubuntu-24.04'], ['codex:wsl:Ubuntu-24.04', 'Ubuntu-24.04']]);
  assert.strictEqual(r[0].conta.organization, 'Org WSL');
  assert.strictEqual(r[0].limits, null, 'sem ponte da statusline no WSL: só identidade');
  assert.strictEqual(r[1].conta.organization, 'Org Codex WSL');
  assert.deepStrictEqual(r[1].limits.map(l => [l.kind, l.percent]), [['weekly_all', 12]]);
});

test('privacidade: o retorno não traz token nem campo fora da lista branca', async () => {
  const r = await snapshotProvedores({}, depsBase({
    contaClaudeDoHome: async () => ({ ...claudeConta, accessToken: 'SENTINELA-A', refreshToken: 'SENTINELA-B' }),
    lerContaCodex: async () => ({ email: 'a@b.c', name: null, organization: null, plan: null, id_token: 'SENTINELA-C' }),
    limitesLeves: async () => ({ limits: [{ kind: 'weekly_all', percent: 1, resetsAt: 1, token: 'SENTINELA-D' }], fetchedAt: 1 }),
  }));
  assert.ok(!JSON.stringify(r).includes('SENTINELA'), JSON.stringify(r));
  assert.deepStrictEqual(Object.keys(r[0].conta).sort(), ['email', 'name', 'organization', 'plan', 'tier']);
});

test('ambiente lento some da rodada sem derrubar os outros; descoberta que falha não rejeita', async () => {
  const lento = () => new Promise(() => {}); // nunca resolve
  const inicio = Date.now();
  const r = await snapshotProvedores({}, depsBase({
    contaClaudeDoHome: async () => claudeConta,
    lerContaCodex: lento, limitesLeves: lento,
  }));
  assert.ok(Date.now() - inicio < 2000, 'respeitou o tempo limite');
  assert.deepStrictEqual(r.map(e => e.id), ['claude:local']);
  await assert.doesNotReject(snapshotProvedores({ wsl: true }, depsBase({ wslRoots: async () => { throw new Error('wsl.exe caiu'); } })));
  assert.deepStrictEqual(await snapshotProvedores({ wsl: true }, depsBase({ wslRoots: async () => { throw new Error('x'); } })), []);
});

test('dois homes da mesma distro: vale o primeiro com conta ou limites (id único)', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-snap2-'));
  escreve(path.join(base, 'Deb', 'root', '.claude', 'projects', 'p', 's.jsonl'), '{}\n');
  escreve(path.join(base, 'Deb', 'home', 'ana', '.claude', 'projects', 'p', 's.jsonl'), '{}\n');
  escreve(path.join(base, 'Deb', 'home', 'ana', '.claude.json'), { oauthAccount: { emailAddress: 'a@exemplo.test', organizationName: 'Org Ana' } });
  const r = await snapshotProvedores({ wsl: true }, depsBase({
    contaClaudeDoHome,
    wslRoots: () => wslRoots({ platform: 'win32', ttl: 0, listDistros: async () => [{ name: 'Deb', state: 'Running' }], uncRoot: n => path.join(base, n) }),
  }));
  assert.deepStrictEqual(r.map(e => e.id), ['claude:wsl:Deb']);
  assert.strictEqual(r[0].conta.organization, 'Org Ana');
});

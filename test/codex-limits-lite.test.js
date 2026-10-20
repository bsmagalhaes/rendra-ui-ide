// Limites do Codex pelo canal leve da barra: só os rollouts mais recentes (por mtime), parando no
// primeiro com rate_limits, e só a janela semanal (10080 min) ou de 5 horas (300 min) aparece.
// Rollouts fabricados em pasta temporária; nada do usuário é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codexLimits = require('../src/codex-limits');
const { normalizaLimitesCodex, _limpaCache } = codexLimits;

const DIA = 86400000;
// Relógio fixo: as pastas AAAA/MM/DD dos rollouts são fabricadas em 2026/10/03 e `limitesLeves` poda por data,
// então o teste não pode depender de Date.now() (virava vermelho quando o dia real passava de 8 dias).
const AGORA = Date.UTC(2026, 9, 3, 12);
const limitesLeves = (dir, deps) => codexLimits.limitesLeves(dir, { agora: AGORA, ...deps });
const iso = ms => new Date(ms).toISOString();

function sessions() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-codex-lim-'));
  fs.mkdirSync(path.join(dir, '2026', '10', '03'), { recursive: true });
  return dir;
}
const evento = (ts, rate_limits) => JSON.stringify({ timestamp: iso(ts), type: 'event_msg', payload: { type: 'token_count', info: null, ...(rate_limits === undefined ? {} : { rate_limits }) } });
const janela = (percent, minutos, resetsEmSeg) => ({ used_percent: percent, window_minutes: minutos, resets_at: resetsEmSeg });
function rollout(dir, nome, linhas, mtimeMs) {
  const f = path.join(dir, '2026', '10', '03', nome);
  fs.writeFileSync(f, linhas.join('\n') + '\n');
  const m = new Date(mtimeMs);
  fs.utimesSync(f, m, m);
  return f;
}
const resetSeg = Math.floor((AGORA + 2 * DIA) / 1000);

test.beforeEach(() => _limpaCache());

test('janela de 10080 min vira um único weekly_all, em ms, e nenhum session', async () => {
  const dir = sessions();
  const ts = AGORA - 5 * 60000;
  rollout(dir, 'rollout-a.jsonl', [evento(ts, { primary: janela(37.4, 10080, resetSeg), secondary: null })], AGORA - 60000);
  const r = await limitesLeves(dir);
  assert.deepStrictEqual(r.limits, [{ kind: 'weekly_all', percent: 37.4, resetsAt: resetSeg * 1000 }]);
  assert.strictEqual(r.fetchedAt, ts, 'fetchedAt é o timestamp do evento');
});

test('janela de 300 min vira session; primary e secondary juntos dão os dois', async () => {
  const dir = sessions();
  rollout(dir, 'rollout-a.jsonl', [evento(AGORA, { primary: janela(10, 300, resetSeg), secondary: janela(20, 10080, resetSeg) })], AGORA);
  const r = await limitesLeves(dir);
  assert.deepStrictEqual(r.limits.map(l => [l.kind, l.percent]), [['session', 10], ['weekly_all', 20]]);
  const so300 = normalizaLimitesCodex({ primary: { percent: 5, windowMinutes: 300, resetsAt: 1 }, secondary: null, at: 1 });
  assert.deepStrictEqual(so300.map(l => l.kind), ['session']);
});

test('qualquer outra janela (60 min, nula, sem minutos) é descartada', async () => {
  const dir = sessions();
  rollout(dir, 'rollout-a.jsonl', [evento(AGORA, { primary: janela(50, 60, resetSeg), secondary: null })], AGORA);
  assert.deepStrictEqual((await limitesLeves(dir)).limits, []);
  assert.deepStrictEqual(normalizaLimitesCodex({ primary: { percent: 1, windowMinutes: null }, secondary: null }), []);
  assert.deepStrictEqual(normalizaLimitesCodex(null), []);
});

test('vale o rollout de mtime mais recente, mesmo com nome mais antigo, e a leitura para no primeiro com rate_limits', async () => {
  const dir = sessions();
  // o nome (data do ISO) é mais NOVO no "velho", mas o mtime do outro é mais recente
  rollout(dir, 'rollout-2026-10-03T23-00-00-zzz.jsonl', [evento(AGORA - 3 * DIA, { primary: janela(11, 10080, resetSeg), secondary: null })], AGORA - 3 * DIA);
  rollout(dir, 'rollout-2026-10-01T00-00-00-aaa.jsonl', [evento(AGORA - 60000, { primary: janela(66, 10080, resetSeg), secondary: null })], AGORA - 60000);
  const lidos = [];
  const ler = async f => { lidos.push(path.basename(f)); return fs.readFileSync(f, 'utf8'); };
  const r = await limitesLeves(dir, { ler });
  assert.strictEqual(r.limits[0].percent, 66);
  assert.deepStrictEqual(lidos, ['rollout-2026-10-01T00-00-00-aaa.jsonl'], 'parou no primeiro com rate_limits');
});

test('o rollout mais novo sem rate_limits cai para o seguinte', async () => {
  const dir = sessions();
  rollout(dir, 'rollout-novo.jsonl', [evento(AGORA, undefined)], AGORA);
  rollout(dir, 'rollout-antigo.jsonl', [evento(AGORA - 2 * DIA, { primary: janela(44, 10080, resetSeg), secondary: null })], AGORA - 2 * DIA);
  const r = await limitesLeves(dir);
  assert.strictEqual(r.limits[0].percent, 44);
  assert.strictEqual(r.fetchedAt, AGORA - 2 * DIA);
});

test('sem rollout, ou sem pasta, devolve limites vazios e não erro', async () => {
  assert.deepStrictEqual(await limitesLeves(sessions()), { limits: [], fetchedAt: null });
  assert.deepStrictEqual(await limitesLeves(path.join(os.tmpdir(), 'rendra-nao-existe-xyz')), { limits: [], fetchedAt: null });
});

test('rollout com mtime fora da janela de 8 dias não é lido (nunca os 90 dias)', async () => {
  const dir = sessions();
  rollout(dir, 'rollout-velho.jsonl', [evento(AGORA - 30 * DIA, { primary: janela(99, 10080, resetSeg), secondary: null })], AGORA - 30 * DIA);
  const lidos = [];
  const r = await limitesLeves(dir, { ler: async f => { lidos.push(f); return fs.readFileSync(f, 'utf8'); } });
  assert.deepStrictEqual(lidos, [], 'o arquivo de 30 dias nem foi aberto');
  assert.deepStrictEqual(r.limits, []);
});

test('o resultado de um rollout fica em cache por caminho, mtime e tamanho: só relê o que mudou', async () => {
  const dir = sessions();
  const f = rollout(dir, 'rollout-a.jsonl', [evento(AGORA, { primary: janela(30, 10080, resetSeg), secondary: null })], AGORA - 1000);
  let leituras = 0;
  const ler = async x => { leituras++; return fs.readFileSync(x, 'utf8'); };
  await limitesLeves(dir, { ler });
  await limitesLeves(dir, { ler });
  assert.strictEqual(leituras, 1, 'segunda chamada vem do cache');
  fs.appendFileSync(f, evento(AGORA + 1000, { primary: janela(31, 10080, resetSeg), secondary: null }) + '\n');
  const r = await limitesLeves(dir, { ler });
  assert.strictEqual(leituras, 2, 'o arquivo cresceu: relê');
  assert.strictEqual(r.limits[0].percent, 31);
});

test('lê só o final do arquivo grande, e a linha cortada no início é ignorada', async () => {
  const dir = sessions();
  const enchimento = JSON.stringify({ timestamp: iso(AGORA), type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(2000) } });
  const linhas = [evento(AGORA - 3600000, { primary: janela(1, 10080, resetSeg), secondary: null })];
  for (let i = 0; i < 300; i++) linhas.push(enchimento);
  linhas.push(evento(AGORA, { primary: janela(77, 10080, resetSeg), secondary: null }));
  rollout(dir, 'rollout-grande.jsonl', linhas, AGORA);
  const r = await limitesLeves(dir, { cauda: 64 * 1024 });
  assert.strictEqual(r.limits[0].percent, 77);
});

test('pastas AAAA/MM/DD fora do corte nem são listadas nem têm stat (poda antes de qualquer stat)', async () => {
  const dir = sessions();
  const velha = path.join(dir, '2025', '01', '15');
  const velhoMes = path.join(dir, '2026', '07', '04');
  fs.mkdirSync(velha, { recursive: true });
  fs.mkdirSync(velhoMes, { recursive: true });
  for (const d of [velha, velhoMes]) fs.writeFileSync(path.join(d, 'rollout-x.jsonl'), '{}\n');
  const recente = rollout(dir, 'rollout-a.jsonl', [evento(AGORA, { primary: janela(12, 10080, resetSeg), secondary: null })], AGORA);
  const stats = [], lists = [];
  const stat = fs.promises.stat, readdir = fs.promises.readdir;
  fs.promises.stat = async (p, ...r) => { stats.push(String(p)); return stat(p, ...r); };
  fs.promises.readdir = async (p, ...r) => { lists.push(String(p)); return readdir(p, ...r); };
  let r;
  try {
    r = await limitesLeves(dir, { agora: AGORA });
  } finally { fs.promises.stat = stat; fs.promises.readdir = readdir; }
  assert.strictEqual(r.limits[0].percent, 12);
  assert.ok(stats.includes(recente), 'a pasta do dia dentro do corte é lida');
  assert.ok(!stats.some(p => p.includes(path.join('2025', '01')) || p.includes(path.join('2026', '07'))), 'nenhum stat nas pastas antigas ');
  assert.ok(!lists.some(p => p.includes(path.join('2025', '01')) || p.includes(path.join('2026', '07'))), 'pastas antigas nem listadas');
});

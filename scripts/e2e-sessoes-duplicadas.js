// Prova de ponta a ponta das sessões duplicadas: app real (Electron) em sandbox, janela oculta (RENDRA_E2E_HIDDEN=1),
// RENDRA_DATA_DIR e RENDRA_HOME falsos, `claude` falso no PATH do app (um node executando .../@anthropic-ai/claude-code/cli.js,
// como o shim do npm no Windows). Nunca o Claude real, nunca o tmux nem o ~/.bashrc do dono.
// A verificação é do SO: processo vivo ou morto (lido de novo da tabela de processos), nunca "o callback foi chamado".
// REGRA DE SEGURANÇA: só encerra PID que este script criou (registrado em test/helpers/falsos.js ou o Electron dele);
// nada por nome. O WSL real só entra no cenário 7, com árvores criadas pelo próprio teste e marca (token) única.
// Fora do npm test: abre o Electron várias vezes. Uso: node scripts/e2e-sessoes-duplicadas.js [--saida=<pasta>]
// Cenários (E2E_SO=1,2,...): 1 trava de instância única, 2 retomar/R2/R3/rc/seletor, 3 fechar por "Sair" e por
// janela fechada, 4 renderer morto, 5 varredura do registro ao abrir, 6 sair com guarda de arquivos não salvos
// cancelada, 7 WSL real (árvores do teste na distro), 8 reproduz o relato (três agentes sob um tmux falso).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const E = require('../renderer/sessoes-escolha');
const A = require('../src/agentes-proc');
const R = require('../src/registro-terminais');
const Enc = require('../src/encerrar-proc');
const { pastaCodificada } = require('../src/sessoes-claude');
const F = require('../test/helpers/falsos');

const ROOT = path.join(__dirname, '..');
const argSaida = (process.argv.find(a => a.startsWith('--saida=')) || '').slice(8);
const SAIDA = path.resolve(argSaida || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-sessoes-duplicadas'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const linha = o => JSON.stringify(o) + '\n';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WIN = process.platform === 'win32';
if (!WIN) { console.log('Este e2e roda no Windows (o shim claude.cmd e o ConPTY do app). Nada a fazer aqui.'); process.exit(0); }

// ── Sandbox ─────────────────────────────────────────────────────────────────
// 6 conversas fictícias do Claude na pasta `demo`, a mais nova primeiro (ids 1..6)
function sandbox() {
  const sb = F.sandbox('rendra-e2e-sessdup-');
  const home = path.join(sb.dir, 'home'), data = path.join(sb.dir, 'data'), bin = path.join(sb.dir, 'bin');
  const demo = path.join(home, 'projetos', 'demo');
  fs.mkdirSync(demo, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
  const log = path.join(sb.dir, 'args.log');
  // o claude falso do terminal: grava os argumentos, não segura a conversa aberta (como o real) e vive até ser encerrado
  escreve(sb.cli, `const fs = require('fs'); const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, 'claude ' + a.join(' ') + '\\n');
console.log('FAKE-CLAUDE-RODOU ' + a.join(' '));
process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);\n`);
  escreve(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${sb.cli}" %*\r\n`);
  const base = Date.parse('2026-10-01T00:00:00Z');
  const projC = path.join(home, '.claude', 'projects', pastaCodificada(demo));
  const convs = [];
  for (let i = 1; i <= 6; i++) {
    const id = uuid(i), quando = base + (7 - i) * 3600e3, f = path.join(projC, `${id}.jsonl`);
    escreve(f, linha({ type: 'user', message: { role: 'user', content: `Conversa ${i}: assunto fictício ${i}` }, sessionId: id, cwd: demo, timestamp: new Date(quando).toISOString() }));
    fs.utimesSync(f, quando / 1000, quando / 1000);
    convs.push({ id, titulo: `Conversa ${i}: assunto fictício ${i}`, quando });
  }
  escreve(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'voce@exemplo.com', displayName: 'Você', organizationName: 'Empresa Demo' } }));
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: demo, groups: [] }], active: 0 } },
  }, null, 2));
  return { ...sb, home, data, bin, log, demo, convs };
}

// ── Processos (leitura do SO) ───────────────────────────────────────────────
const foto = async () => (await A.listarProcessos({ tipo: 'windows' }, { env: process.env })) || { procs: [], sessoes: [] };
const vivo = pid => F.vivo(pid);
async function esperaMorte(pids, ms = 12000) { return F.esperar(() => pids.every(p => !vivo(p)), ms); }
// agentes (claude falsos) de uma conversa, na tabela de processos agora
async function donosDe(id) { const s = await foto(); return A.agentesDoInstantaneo(s).filter(a => a.provedor === 'claude' && a.id === id); }
const emArvore = (snap, raiz) => A.descendentesDe(snap.procs, [raiz]);

// ── CDP e app ───────────────────────────────────────────────────────────────
function cliente(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pend = {}; let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (!pend[m.id]) return; m.error ? pend[m.id].reject(new Error(m.error.message)) : pend[m.id].resolve(m.result); delete pend[m.id]; };
  const pronto = new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pend[i] = { resolve, reject }; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression, extra = {}) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || ''}`.slice(0, 400));
    return r.result?.value;
  };
  return { ws, send, ev, pronto };
}
async function alvo(porta, tipo, ms = 40000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => !tipo || x.type === tipo); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}
const REQ = `((process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null))`;

function envDoApp(sb, extra = {}) {
  const reais = n => [n, `${n}.exe`, `${n}.cmd`, `${n}.bat`];
  const PATH = [sb.bin, ...(process.env.Path || process.env.PATH || '').split(path.delimiter).filter(d => d && !['claude', 'codex'].some(n => reais(n).some(f => fs.existsSync(path.join(d, f)))))].join(path.delimiter);
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex'), ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env.Path = PATH;
  return env;
}

// espera=false: não espera o workspace (instância que deve sair, ou que vai cair)
async function abrir(sb, { semUi = false, extraEnv } = {}) {
  const porta = 9500 + Math.floor(Math.random() * 300), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env: envDoApp(sb, extraEnv), stdio: 'ignore' });
  F.adotar(proc.pid);
  const app = { proc, pid: proc.pid, saiu: false, codigo: null };
  proc.on('exit', c => { app.saiu = true; app.codigo = c; });
  console.log(`  electron pid ${proc.pid}`);
  if (semUi) return app;
  const tMain = await alvo(portaMain);
  if (!tMain) throw new Error('inspector do main inacessível');
  app.main = cliente(tMain.webSocketDebuggerUrl); await app.main.pronto;
  const req = REQ;
  for (let i = 0; i < 100; i++) {
    const ok = await app.main.ev(`(() => { const m = ${req}('electron').ipcMain; return m.listeners('pty:write').length > 0 && !!(m._invokeHandlers && m._invokeHandlers.get && m._invokeHandlers.get('dev:agent-sessions')); })()`, { includeCommandLineAPI: true }).catch(() => false);
    if (ok) break;
    await sleep(300);
  }
  // espia as escritas no pty (o que o painel escreveu no shell)
  await app.main.ev(`(() => { const { ipcMain } = ${req}('electron'); globalThis.__escritas = [];
    const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write');
    ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push({ t: Date.now(), data: m && m.data }); for (const l of ls) l(e, m); }); return true; })()`, { includeCommandLineAPI: true });
  const tPag = await alvo(porta, 'page');
  if (!tPag) throw new Error('o app não abriu');
  app.porta = porta;
  app.pag = cliente(tPag.webSocketDebuggerUrl); await app.pag.pronto;
  app.send = app.pag.send; app.ev = app.pag.ev;
  await app.send('Page.enable');
  await app.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  app.espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await app.ev(expr)) return true; } catch { /* carregando */ } await sleep(120); } throw new Error(`tempo esgotado: ${msg}`); };
  app.escritas = async () => JSON.parse(await app.main.ev('JSON.stringify(globalThis.__escritas)')).filter(x => typeof x.data === 'string' && !x.data.startsWith(String.fromCharCode(27)));
  app.paginas = async () => (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).filter(x => x.type === 'page').length;
  app.fechar = async () => {
    try { app.pag.ws.close(); app.main.ws.close(); } catch { /* fechado */ }
    // a árvore do Electron DESTE teste (o PID é o que o script criou); os agentes dele já morreram ou são do teste
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* já encerrou */ }
    await sleep(1200);
  };
  await app.espera(`!!document.querySelector('.ws.active')`, 40000, 'workspace ativo');
  return app;
}

const sairDoApp = async (app, expr) => {
  await app.main.ev(expr, { includeCommandLineAPI: true }).catch(() => { /* a conexão cai com o app */ });
  try { app.pag.ws.close(); app.main.ws.close(); } catch { /* fechado */ }
};

// ── Passos da tela ──────────────────────────────────────────────────────────
const ULTIMO = `[...document.querySelectorAll('.ws.active .term-pane')].at(-1)`;
const PROMPT = a => `((${a}) ? [...(${a}).querySelectorAll('.xterm-rows > div')] : []).some(d => /[>$#]\\s*$/.test(d.textContent.replace(/\\u00a0/g, ' ').trimEnd()))`;
const termN = (n, esc = '.ws.active') => `[...document.querySelectorAll('${esc} .term-pane')][${n}]`;
const nTerm = app => app.ev(`document.querySelectorAll('.ws.active .term-pane').length`);
async function novoTerminal(app) {
  const antes = await nTerm(app);
  await app.ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
  await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === ${antes + 1}`, 20000, 'terminal aberto');
  const a = termN(antes);
  await app.espera(PROMPT(a), 30000, 'prompt do shell');
  return { sel: a, indice: antes };
}
const esperaPainel = (app, a, ms = 20000) => app.espera(`!!(${a})?.querySelector('.term-agentes')`, ms, 'painel de conversas');
const itemDe = (a, id, convs) => { const c = convs.find(x => x.id === id); return `[...(${a}).querySelectorAll('.term-agentes-item')].find(b => b.querySelector('.term-agentes-tit').textContent === ${JSON.stringify(c.titulo)})`; };
const textoTerm = (app, a) => app.ev(`[...(${a}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);
const lerLog = sb => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const fotografa = async (app, nome) => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const { data } = await app.send('Page.captureScreenshot', { format: 'png' });
  const arq = path.join(SAIDA, `${nome}.png`);
  fs.writeFileSync(arq, Buffer.from(data, 'base64'));
  console.log(`  captura: ${arq}`);
};
// "claude de fora": a cadeia tmux falso, bash falso, claude falso (como P1). Devolve os três PIDs.
async function agenteDeFora(sb, id, { rc = false } = {}) {
  const out = path.join(sb.dir, `fora-${Math.random().toString(16).slice(2)}.json`);
  const tmux = F.iscaFalsa(sb);
  const bash = F.lancar([rc ? sb.ressuscita : sb.cadeia, out, sb.cli, '--resume', id]);
  if (!await F.esperar(() => fs.existsSync(out), 20000)) throw new Error('agente de fora não subiu');
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  const claude = rc ? j.pids[0] : j.filho;
  F.adotar(claude);
  await F.esperar(async () => (await donosDe(id)).some(a => a.pid === claude), 20000);
  return { tmux, bash, claude, out };
}
const adotaRc = out => { try { JSON.parse(fs.readFileSync(out, 'utf8')).pids.forEach(F.adotar); } catch { /* sem arquivo */ } };

// ── Cenário 1: trava de instância única (T1) ────────────────────────────────
async function trava() {
  console.log('\n[1] trava de instância única: a segunda IDE na mesma pasta de dados sai e a primeira segue respondendo');
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    afirma(await app.paginas() === 1, 'uma janela na primeira instância');
    const segunda = await abrir(sb, { semUi: true });
    afirma(await F.esperar(() => segunda.saiu, 30000), 'a segunda instância terminou sozinha');
    afirma(segunda.codigo === 0, `com código de saída 0 (${segunda.codigo})`);
    await sleep(800);
    afirma(await app.ev('1 + 1') === 2, 'a primeira instância continua respondendo');
    afirma(await app.paginas() === 1, 'continua uma janela só (a segunda não abriu a dela)');
    afirma(!app.saiu, 'a primeira instância continua viva');
  } catch (e) { afirma(false, `cenário 1 abortou: ${e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 2: retomar, R2, R3, rc, seletor (T9, T10, T11) ──────────────────
async function retomar() {
  console.log('\n[2] retomar conversa: encerra o agente de fora, uma conversa por terminal, seletor marca "em uso"');
  const sb = sandbox();
  const [A1, B1, C1, D1] = sb.convs.map(c => c.id);
  let app;
  try {
    app = await abrir(sb);
    // o agente de fora (cadeia tmux falso, bash falso, claude falso) segura a conversa 1; outro, a 2
    const foraA = await agenteDeFora(sb, A1);
    const foraB = await agenteDeFora(sb, B1);
    const solto = F.claudeFalso(sb, ['--resume', C1]); // conversa 3 em outro processo, que ninguém vai retomar
    await F.esperar(async () => (await donosDe(C1)).length === 1, 20000);

    // T11: o seletor marca as conversas em uso e explica
    let t1 = await novoTerminal(app);
    await esperaPainel(app, t1.sel);
    const marcas = await app.ev(`[...(${t1.sel}).querySelectorAll('.term-agentes-item')].map(b => ({ tit: b.querySelector('.term-agentes-tit').textContent, uso: b.querySelector('.term-agentes-uso')?.textContent || null, linha: b.querySelector('.term-agentes-uso-linha')?.textContent || null, visivel: b.offsetParent !== null }))`);
    const marca = c => marcas.find(m => m.tit === sb.convs.find(x => x.id === c).titulo);
    afirma(marca(A1).uso === 'em uso' && marca(A1).linha === 'A sessão anterior será encerrada ao abrir', `a conversa 1 (segurada por um agente de fora) mostra "em uso" e a linha explicativa`);
    afirma(marca(B1).uso === 'em uso' && marca(C1).uso === 'em uso', 'as conversas 2 e 3 também estão marcadas');
    afirma(marca(D1).uso === null && marca(D1).linha === null, 'a conversa 4, livre, não tem a marca');
    const cores = await app.ev(`(() => { const b = (${itemDe(t1.sel, A1, sb.convs)}); const f = e => getComputedStyle(e).color; return { uso: f(b.querySelector('.term-agentes-uso')), linha: f(b.querySelector('.term-agentes-uso-linha')), fundo: getComputedStyle(b.closest('.term-agentes')).backgroundColor }; })()`);
    const lum = rgb => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const razao = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
    afirma(razao(cores.uso, cores.fundo) >= 4.5 && razao(cores.linha, cores.fundo) >= 4.5, `contraste mínimo 4,5:1 na marca (${razao(cores.uso, cores.fundo).toFixed(1)}) e na linha (${razao(cores.linha, cores.fundo).toFixed(1)})`);
    await fotografa(app, 'seletor-em-uso');

    // T10: escolher a conversa 1 carrega ela: o agente de fora morre, o resto do tmux/bash fica, e roda um só agente dela
    await app.ev(`(${itemDe(t1.sel, A1, sb.convs)}).click()`);
    afirma(await esperaMorte([foraA.claude]), 'o claude de fora da conversa 1 foi encerrado (processo morto no SO)');
    afirma(vivo(foraA.bash.pid) && vivo(foraA.tmux.pid), 'o bash e o tmux falsos dele seguem vivos');
    afirma(vivo(foraB.claude) && vivo(solto.pid), 'o claude da conversa 2 e o da conversa 3 seguem vivos');
    await app.espera(`!(${t1.sel})?.querySelector('.term-agentes')`, 30000, 'painel fecha depois da escrita');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t1.sel}.textContent)`, 30000, 'o agente falso rodou no terminal 1');
    let w = (await app.escritas()).filter(x => x.data === `claude --resume ${A1}\r`);
    afirma(w.length === 1, `o terminal escreveu exatamente "claude --resume <id>" uma vez (${w.length})`);
    afirma(!(await app.escritas()).some(x => /^claude(\r| --session-id)/.test(x.data)), 'nenhuma conversa nova foi aberta (nem claude puro, nem --session-id)');
    afirma(lerLog(sb).filter(l => l === `claude --resume ${A1}`).length === 2, 'o executável falso recebeu --resume <id> duas vezes no total: a do agente de fora e uma só do terminal da IDE');
    let donos = await donosDe(A1);
    afirma(donos.length === 1, `existe um único agente na conversa 1 (${donos.length})`);
    const snap1 = await foto();
    afirma(emArvore(snap1, app.pid).has(donos[0].pid), 'e ele nasceu de um terminal da IDE');
    const pidT1 = donos[0].pid;

    // R2: o terminal 2 retoma a mesma conversa: o agente do terminal 1 é encerrado, o shell dele fica, e a razão aparece
    const t2 = await novoTerminal(app);
    await esperaPainel(app, t2.sel);
    const uso2 = await app.ev(`!!(${itemDe(t2.sel, A1, sb.convs)}).querySelector('.term-agentes-uso')`);
    afirma(uso2, 'a conversa 1, agora segurada por um terminal da IDE, também aparece como "em uso"');
    await app.ev(`(${itemDe(t2.sel, A1, sb.convs)}).click()`);
    afirma(await esperaMorte([pidT1]), 'o agente do terminal 1 morreu (processo morto no SO)');
    await app.espera(`!(${t2.sel})?.querySelector('.term-agentes')`, 30000, 'painel do terminal 2 fecha');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t2.sel}.textContent)`, 30000, 'agente rodando no terminal 2');
    await app.espera(`/Conversa retomada em outro terminal/.test(${termN(t1.indice)}.textContent)`, 15000, 'motivo no terminal 1');
    afirma(true, 'o terminal 1 mostra "Conversa retomada em outro terminal" no DOM');
    donos = await donosDe(A1);
    const snap2 = await foto();
    afirma(donos.length === 1 && emArvore(snap2, app.pid).has(donos[0].pid), 'só um agente na conversa 1, o do terminal 2 (vence o mais recente)');
    afirma(await app.ev(`${PROMPT(termN(t1.indice))}`), 'o shell do terminal 1 continua vivo, com o prompt na tela');
    await fotografa(app, 'terminal-anterior-com-motivo');
    const pidT2 = donos[0].pid;

    // caso B: conversas diferentes em terminais diferentes convivem
    const t3 = await novoTerminal(app);
    await esperaPainel(app, t3.sel);
    await app.ev(`(${itemDe(t3.sel, D1, sb.convs)}).click()`);
    await app.espera(`!(${t3.sel})?.querySelector('.term-agentes')`, 30000, 'painel do terminal 3 fecha');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t3.sel}.textContent)`, 30000, 'agente da conversa 4 no terminal 3');
    const dD = await donosDe(D1);
    afirma(dD.length === 1 && vivo(pidT2), 'conversas diferentes (1 no terminal 2 e 4 no terminal 3): os dois agentes vivos');

    // caso C: ordem inversa, o último a iniciar é o que fica
    const t4 = await novoTerminal(app);
    await esperaPainel(app, t4.sel);
    await app.ev(`(${itemDe(t4.sel, A1, sb.convs)}).click()`);
    afirma(await esperaMorte([pidT2]), 'caso C: o terminal 4 retoma a conversa 1 e o agente do terminal 2 morre');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t4.sel}.textContent)`, 30000, 'agente no terminal 4');
    afirma((await donosDe(A1)).length === 1 && (await donosDe(D1)).length === 1 && vivo(dD[0].pid), 'um agente por conversa; o da conversa 4 intacto');

    // rc do dono: `claude --continue || claude` reabre o agente que a IDE encerrou. A IDE avisa no terminal e não escreve --resume.
    const foraC = await agenteDeFora(sb, sb.convs[4].id, { rc: true });
    const t5 = await novoTerminal(app);
    await esperaPainel(app, t5.sel);
    const antesEsc = (await app.escritas()).length;
    await app.ev(`(${itemDe(t5.sel, sb.convs[4].id, sb.convs)}).click()`);
    await app.espera(`/reaberta por outro processo/.test(${t5.sel}.textContent)`, 30000, 'aviso de reabertura no terminal 5');
    adotaRc(foraC.out);
    afirma(true, 'rc que reabre o agente: o terminal 5 avisa "reaberta por outro processo fora da IDE"');
    afirma((await app.escritas()).slice(antesEsc).every(x => !x.data.includes(sb.convs[4].id)), 'e a IDE não escreveu --resume (sem laço de encerramento)');
    afirma((await donosDe(sb.convs[4].id)).some(a => vivo(a.pid)), 'o agente reaberto pelo rc segue vivo');
    await fotografa(app, 'rc-reabriu-o-agente');

    // fechar a IDE por "Sair" (tray): o que nasceu dos terminais morre; o que a IDE não iniciou fica
    const dentro = [];
    const sf = await foto();
    for (const a of A.agentesDoInstantaneo(sf)) if (a.provedor === 'claude' && emArvore(sf, app.pid).has(a.pid)) dentro.push(a.pid);
    afirma(dentro.length === 2, `agentes que nasceram de terminais da IDE antes de sair (conversas 1 e 4): ${dentro.length}`);
    const tmuxes = [foraA.tmux.pid, foraA.bash.pid, foraB.tmux.pid, foraB.bash.pid, foraB.claude, solto.pid];
    await sairDoApp(app, `${REQ}('electron').app.quit()`);
    afirma(await F.esperar(() => app.saiu, 40000), 'a IDE saiu depois de "Sair"');
    afirma(await esperaMorte(dentro, 8000), 'todo agente que nasceu de um terminal da IDE morreu (processo morto no SO)');
    afirma(tmuxes.every(vivo), 'tmux, bash e agentes que a IDE não iniciou seguem vivos');
    const resto = await foto();
    afirma(![...A.descendentesDe(resto.procs, [app.pid])].some(p => vivo(p)), 'nenhum descendente do Electron sobrou');
  } catch (e) { afirma(false, `cenário 2 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 3: fechar a janela (window-all-closed) e terminal individual (T3) ─
async function fecharJanela() {
  console.log('\n[3] fechar a janela (window-all-closed) e fechar um terminal pelo botão');
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    const t1 = await novoTerminal(app), t2 = await novoTerminal(app);
    for (const t of [t1, t2]) { await esperaPainel(app, t.sel); await app.ev(`${t.sel}.querySelector('[data-nova="claude"]').click()`); await app.espera(`!(${t.sel})?.querySelector('.term-agentes')`, 30000, 'painel fecha'); }
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t1.sel}.textContent) && /FAKE-CLAUDE-RODOU/.test(${t2.sel}.textContent)`, 30000, 'dois agentes novos rodando');
    const solto = F.claudeFalso(sb, ['--resume', sb.convs[5].id]);
    await sleep(500);
    let sf = await foto();
    let dentro = A.agentesDoInstantaneo(sf).filter(a => a.provedor === 'claude' && emArvore(sf, app.pid).has(a.pid)).map(a => a.pid);
    afirma(dentro.length === 2, `dois agentes dentro dos terminais (${dentro.length})`);
    // fechar o terminal 2 pelo botão: só a árvore dele
    await app.ev(`(() => { const t = [...document.querySelectorAll('.ws.active .term-tab')][1]; t.querySelector('[data-act=close]').click(); return true; })()`);
    await sleep(500);
    if (await app.ev(`document.getElementById('save-overlay').classList.contains('visible')`)) await app.ev(`document.querySelector('#save-actions .btn-primary').click()`);
    await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === 1`, 15000, 'terminal 2 fechado');
    sf = await foto();
    const restantes = A.agentesDoInstantaneo(sf).filter(a => a.provedor === 'claude' && emArvore(sf, app.pid).has(a.pid)).map(a => a.pid);
    afirma(restantes.length === 1 && dentro.includes(restantes[0]), 'fechar o terminal 2 pelo botão matou o agente dele e só dele');
    dentro = restantes;
    // o evento `quit` precisa continuar saindo (o electron-updater instala o pacote baixado nele)
    const marcaQuit = path.join(sb.dir, 'quit-emitido.txt');
    await app.main.ev(`(() => { ${REQ}('electron').app.on('quit', () => ${REQ}('fs').writeFileSync(${JSON.stringify(marcaQuit)}, '1')); return true; })()`, { includeCommandLineAPI: true });
    // fechar a janela: window-all-closed -> sair
    await sairDoApp(app, `${REQ}('electron').BrowserWindow.getAllWindows()[0].close()`);
    afirma(await F.esperar(() => app.saiu, 40000), 'a IDE saiu ao fechar a janela');
    afirma(fs.existsSync(marcaQuit), 'o evento quit foi emitido na saída (o electron-updater instala nele)');
    afirma(await esperaMorte(dentro, 8000), 'o agente do terminal restante morreu (processo morto no SO)');
    afirma(vivo(solto.pid), 'o claude falso que o teste iniciou fora da IDE segue vivo');
  } catch (e) { afirma(false, `cenário 3 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 4: renderer morto (T4) ──────────────────────────────────────────
async function rendererMorto() {
  console.log('\n[4] o renderer morre: os terminais são encerrados');
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    const t1 = await novoTerminal(app);
    await esperaPainel(app, t1.sel); await app.ev(`${t1.sel}.querySelector('[data-nova="claude"]').click()`);
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t1.sel}.textContent)`, 30000, 'agente rodando');
    const solto = F.claudeFalso(sb, ['--resume', sb.convs[5].id]);
    const sf = await foto();
    const dentro = A.agentesDoInstantaneo(sf).filter(a => a.provedor === 'claude' && emArvore(sf, app.pid).has(a.pid)).map(a => a.pid);
    afirma(dentro.length === 1, 'um agente dentro do terminal');
    await app.main.ev(`${REQ}('electron').BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()`, { includeCommandLineAPI: true });
    afirma(await esperaMorte(dentro, 20000), 'com o renderer morto, o agente do terminal morreu (processo morto no SO)');
    afirma(vivo(solto.pid) && !app.saiu, 'o claude de fora e o processo principal seguem vivos');
  } catch (e) { afirma(false, `cenário 4 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 5: varredura ao abrir depois de morte à força (T5) ──────────────
async function varredura() {
  console.log('\n[5] a IDE morreu à força: ao reabrir, a varredura encerra a árvore registrada e só ela');
  const sb = sandbox();
  let app;
  try {
    // árvore falsa de um "terminal de uma IDE morta": shell, neto teimoso, neto comum; um irmão de fora e um processo com PID "reaproveitado"
    const out = path.join(sb.dir, 'arvore.json');
    const pai = F.lancar([sb.arvore, out]);
    await F.esperar(() => fs.existsSync(out), 20000); await sleep(300);
    const { teimoso, comum } = JSON.parse(fs.readFileSync(out, 'utf8')); F.adotar(teimoso); F.adotar(comum);
    const irmao = F.iscaFalsa(sb);
    const reaproveitado = F.iscaFalsa(sb);
    const s0 = await foto();
    const inicio = pid => s0.procs.find(p => p.pid === pid)?.inicio;
    const reg = R.criarRegistro({ dir: sb.data });
    reg.adicionar({ token: 'a1'.repeat(8), ambiente: 'win', ptyPid: pai.pid, ptyInicio: inicio(pai.pid), idePid: 1 });
    reg.adicionar({ token: 'b2'.repeat(8), ambiente: 'win', ptyPid: reaproveitado.pid, ptyInicio: String(BigInt(inicio(reaproveitado.pid)) - 5000000000n), idePid: 1 }); // hora de criação diferente
    reg.adicionar({ token: 'c3'.repeat(8), ambiente: 'win', ptyPid: 2147483000, ptyInicio: '1', idePid: 1 }); // processo que não existe
    app = await abrir(sb);
    afirma(await esperaMorte([pai.pid, teimoso, comum], 20000), 'a árvore registrada (shell, neto teimoso, neto comum) morreu ao abrir');
    afirma(vivo(irmao.pid), 'o irmão de fora segue vivo');
    afirma(vivo(reaproveitado.pid), 'o processo cujo PID foi reaproveitado (hora de criação diferente) segue vivo');
    afirma(reg.ler().every(e => !['a1'.repeat(8), 'b2'.repeat(8), 'c3'.repeat(8)].includes(e.token)), 'o registro antigo foi limpo');
    // um terminal novo entra no registro com a hora de criação e sai quando fecha
    const t1 = await novoTerminal(app);
    afirma(await F.esperar(() => reg.ler().length === 1 && !!reg.ler()[0].ptyInicio, 20000), 'o terminal novo entra no registro com a hora de criação');
    await app.ev(`(() => { const t = [...document.querySelectorAll('.ws.active .term-tab')].at(-1); t.querySelector('[data-act=close]').click(); return true; })()`);
    await sleep(500);
    if (await app.ev(`document.getElementById('save-overlay').classList.contains('visible')`)) await app.ev(`document.querySelector('#save-actions .btn-primary').click()`);
    afirma(await F.esperar(() => reg.ler().length === 0, 20000), 'e sai do registro quando o terminal fecha');
    afirma(!!t1, 'terminal fechado');
  } catch (e) { afirma(false, `cenário 5 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 6: a guarda de arquivos não salvos cancela a saída (V7) ─────────
async function guardaCancelada() {
  console.log('\n[6] sair com arquivo não salvo e escolher "Cancelar": os terminais NÃO morrem (o encerramento vem depois da guarda)');
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    const t1 = await novoTerminal(app);
    await esperaPainel(app, t1.sel); await app.ev(`${t1.sel}.querySelector('[data-nova="claude"]').click()`);
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t1.sel}.textContent)`, 30000, 'agente rodando');
    const sf = await foto();
    const dentro = A.agentesDoInstantaneo(sf).filter(a => a.provedor === 'claude' && emArvore(sf, app.pid).has(a.pid)).map(a => a.pid);
    afirma(dentro.length === 1, 'um agente dentro do terminal');
    // a janela diz ao main que há arquivo sujo e a caixa de diálogo responde "Cancelar" (índice 2)
    await app.main.ev(`(() => { const { dialog, BrowserWindow, ipcMain } = ${REQ}('electron');
      dialog.showMessageBox = async () => ({ response: 2 });
      const w = BrowserWindow.getAllWindows()[0];
      const send = w.webContents.send.bind(w.webContents);
      w.webContents.send = (canal, ...a) => { if (canal === 'app:query-dirty') { setTimeout(() => ipcMain.emit('app:query-dirty:reply', {}, ['a.txt']), 0); return; } return send(canal, ...a); };
      return true; })()`, { includeCommandLineAPI: true });
    await app.main.ev(`${REQ}('electron').BrowserWindow.getAllWindows()[0].close()`, { includeCommandLineAPI: true });
    await sleep(4000);
    afirma(!app.saiu && dentro.every(vivo), 'a saída foi cancelada: a IDE segue aberta e o agente do terminal está vivo');
    // agora sai de verdade
    await app.main.ev(`(() => { const { dialog } = ${REQ}('electron'); dialog.showMessageBox = async () => ({ response: 1 }); return true; })()`, { includeCommandLineAPI: true });
    await sairDoApp(app, `${REQ}('electron').BrowserWindow.getAllWindows()[0].close()`);
    afirma(await F.esperar(() => app.saiu, 40000), 'saindo de verdade ("Sair sem salvar"), a IDE fecha');
    afirma(await esperaMorte(dentro, 8000), 'e agora o agente do terminal morre');
  } catch (e) { afirma(false, `cenário 6 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 7: WSL real, só com árvores criadas pelo teste (B5) ─────────────
async function wslReal() {
  const distro = process.env.RENDRA_E2E_WSL_DISTRO || 'Ubuntu-24.04';
  console.log(`\n[7] WSL real (${distro}): árvores criadas pelo teste, marca única; nada além disso é tocado`);
  let existe = false;
  try { existe = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 15000 }).replace(/\0/g, '').split(/\r?\n/).map(s => s.trim()).includes(distro); } catch { /* sem WSL */ }
  if (!existe) { console.log(`  (pulado: a distro ${distro} não existe nesta máquina)`); return; }
  const crypto = require('crypto');
  const token = crypto.randomBytes(8).toString('hex'), outro = crypto.randomBytes(8).toString('hex');
  const env = marca => ({ ...process.env, RENDRA_TERM: marca, WSLENV: ['RENDRA_TERM/u', process.env.WSLENV].filter(Boolean).join(':') });
  // "terminal": sh líder com um neto comum, um neto que ignora SIGHUP, e um "tmux" que sai da sessão por setsid
  const script = "sleep 31337 & (trap '' HUP; exec sleep 31338) & setsid sleep 31339 & wait";
  const sobe = marca => { const p = spawn('wsl.exe', ['-d', distro, '-e', 'sh', '-c', script], { env: env(marca), stdio: 'ignore', windowsHide: true }); F.adotar(p.pid); return p; };
  const meus = [];
  try {
    const p1 = sobe(token), p2 = sobe(outro);
    await sleep(3000);
    const snap = await A.listarProcessos({ tipo: 'wsl', distro });
    const linhas = pid => snap.procs.filter(p => p.sid === pid || p.pid === pid);
    const lider = snap.procs.find(p => p.token === token && p.pid === p.sid);
    const lider2 = snap.procs.find(p => p.token === outro && p.pid === p.sid);
    afirma(!!lider && !!lider2, 'os dois "terminais" falsos têm líder de sessão com a marca no WSL');
    const cmd = pid => execFileSync('wsl.exe', ['-d', distro, '-e', 'sh', '-c', `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null`], { encoding: 'utf8' }).trim();
    const viva = pid => { try { return execFileSync('wsl.exe', ['-d', distro, '-e', 'sh', '-c', `[ -d /proc/${pid} ] && echo 1`], { encoding: 'utf8' }).trim() === '1'; } catch { return false; } };
    // os pids de sleep 31337..31339 que pertencem a cada marca
    const sessao = l => snap.procs.filter(p => p.sid === l.pid);
    const doTeste = [...sessao(lider), ...sessao(lider2)];
    const nossos = new Set();
    for (const p of doTeste) nossos.add(p.pid);
    // o setsid (tmux falso) tem sid próprio: ache pelo pai (o líder) e pelo comando
    for (const p of snap.procs) if ((p.ppid === lider.pid || p.ppid === lider2.pid) && p.sid === p.pid) nossos.add(p.pid);
    meus.push(...nossos);
    const comandos = {}; for (const pid of nossos) comandos[pid] = cmd(pid);
    const saiu1 = [...nossos].find(pid => /sleep 31339/.test(comandos[pid]) && snap.procs.find(p => p.pid === pid)?.ppid === lider.pid);
    afirma(!!saiu1, 'o "tmux" falso (sleep por setsid) da primeira marca existe e está fora da sessão do líder');
    const dentro1 = sessao(lider).map(p => p.pid), dentro2 = sessao(lider2).map(p => p.pid);
    const r = await Enc.encerrarSessoesPorMarca({ distro, entradas: [{ token }], prazoMs: 400 });
    afirma(r && r.sids.includes(lider.pid), 'o encerramento achou a sessão pelo líder com a marca');
    await sleep(600);
    afirma(dentro1.every(pid => !viva(pid)), 'a sessão da primeira marca (líder, neto comum, neto que ignora SIGHUP) morreu no WSL');
    afirma(viva(saiu1), 'o "tmux" falso (saiu da sessão por setsid) segue vivo, como no VS Code');
    afirma(dentro2.every(viva), 'a sessão da outra marca (outro "terminal") segue intacta');
    // limpeza: só os PIDs deste teste, por PID, dentro da distro (nunca por nome)
    void p1; void p2;
  } catch (e) { afirma(false, `cenário 7 abortou: ${e.stack || e.message}`); }
  finally {
    if (meus.length) { try { execFileSync('wsl.exe', ['-d', distro, '-e', 'sh', '-c', `kill -KILL ${meus.join(' ')} 2>/dev/null; true`], { stdio: 'ignore', timeout: 15000 }); } catch { /* já saíram */ } }
    F.encerrarTodos();
  }
}

// ── Cenário 8: o relato (três agentes sob um tmux falso, IDE abre a pasta) ──
async function relato() {
  console.log('\n[8] o relato: agentes de uma sessão tmux falsa vivos, a IDE abre a mesma pasta e retoma a conversa');
  const sb = sandbox();
  let app;
  try {
    const ids = sb.convs.map(c => c.id);
    const tmux = F.iscaFalsa(sb); // o "servidor tmux" (pai de tudo)
    const a1 = await agenteDeFora(sb, ids[0]); // `claude --continue` do tmux (aqui com o id da conversa, que o metadado do Claude real daria)
    const a2 = await agenteDeFora(sb, ids[1]);
    const a3 = await agenteDeFora(sb, ids[2]);
    app = await abrir(sb);
    const t1 = await novoTerminal(app);
    await esperaPainel(app, t1.sel);
    await app.ev(`(${itemDe(t1.sel, ids[0], sb.convs)}).click()`);
    afirma(await esperaMorte([a1.claude]), 'a conversa retomada: o agente de fora (a sessão tmux) foi encerrado');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${t1.sel}.textContent)`, 30000, 'agente no terminal da IDE');
    afirma((await donosDe(ids[0])).length === 1, 'depois de retomar, existe um único agente na conversa');
    afirma([tmux.pid, a1.tmux.pid, a1.bash.pid, a2.claude, a3.claude, a2.bash.pid, a3.bash.pid].every(vivo), 'o tmux falso, os shells e os agentes das outras conversas seguem vivos');
    await sairDoApp(app, `${REQ}('electron').app.quit()`);
    afirma(await F.esperar(() => app.saiu, 40000), 'a IDE saiu');
    const sobrou = await donosDe(ids[0]);
    if (sobrou.length) { const sn = await foto(); console.log('  sobrou:', JSON.stringify(sobrou.map(x => { const p = sn.procs.find(q => q.pid === x.pid), pai = sn.procs.find(q => q.pid === x.ppid); return { pid: x.pid, ppid: x.ppid, args: p && p.args.slice(-3), pai: pai && [pai.nome, pai.args.slice(-2)], ide: app.pid }; }))); }
    afirma(sobrou.length === 0, 'ao fechar a IDE nada iniciado por ela sobrou');
    afirma([tmux.pid, a2.claude, a3.claude].every(vivo), 'e o que ela não iniciou continua como estava');
  } catch (e) { afirma(false, `cenário 8 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

// ── Cenário 9: sair sem nenhum terminal (a saída não pode travar) ───────────
async function sairSemTerminal() {
  console.log('\n[9] sair sem nenhum terminal aberto: a IDE termina sozinha');
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    const t0 = Date.now();
    await sairDoApp(app, `${REQ}('electron').app.quit()`);
    afirma(await F.esperar(() => app.saiu, 30000), `a IDE saiu (${Date.now() - t0} ms, código ${app.codigo})`);
  } catch (e) { afirma(false, `cenário 9 abortou: ${e.stack || e.message}`); }
  finally { if (app) await app.fechar(); F.encerrarTodos(); sb.limpa(); }
}

(async () => {
  const so = process.env.E2E_SO || '123456789';
  if (so.includes('1')) await trava();
  if (so.includes('2')) await retomar();
  if (so.includes('3')) await fecharJanela();
  if (so.includes('4')) await rendererMorto();
  if (so.includes('5')) await varredura();
  if (so.includes('6')) await guardaCancelada();
  if (so.includes('7')) await wslReal();
  if (so.includes('8')) await relato();
  if (so.includes('9')) await sairSemTerminal();
  F.encerrarTodos();
  console.log(falhas.length ? `\n✗ ${falhas.length} falha(s):\n  - ${falhas.join('\n  - ')}` : '\n✓ tudo certo');
  process.exit(falhas.length ? 1 : 0);
})();

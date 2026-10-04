// Prova de ponta a ponta do seletor de conversas do terminal novo: app real em sandbox, janela oculta
// (RENDRA_E2E_HIDDEN=1), home/dados/CODEX_HOME falsos e conversas FICTÍCIAS de Claude e Codex (nada real é lido).
// `claude` e `codex` são executáveis falsos no PATH do app (respondem `--version` e registram os argumentos);
// a escrita no pty é espiada no main (--inspect) embrulhando o listener de `pty:write`.
// Fora do npm test: abre o Electron e leva minutos. Uso: node scripts/e2e-seletor-sessoes.js [--saida=<pasta>].
// Sai com 1 se algo falhar. Três instâncias do app (o cache de detecção dura 60 s): dois provedores, só o Claude, nenhum.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const E = require('../renderer/sessoes-escolha');
const { pastaCodificada } = require('../src/sessoes-claude');

const ROOT = path.join(__dirname, '..');
const argSaida = (process.argv.find(a => a.startsWith('--saida=')) || '').slice(8);
const SAIDA = path.resolve(argSaida || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-seletor'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const linha = o => JSON.stringify(o) + '\n';
const uuid = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
const WIN = process.platform === 'win32';

// ── Sandbox ─────────────────────────────────────────────────────────────────
// bins: { claude, codex } (executáveis falsos no PATH). sessoes: conversas fictícias da pasta `demo`.
function sandbox({ bins, sessoes = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-seletor-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), bin = path.join(dir, 'bin');
  const demo = path.join(home, 'projetos', 'demo'), vazia = path.join(home, 'projetos', 'vazia');
  fs.mkdirSync(demo, { recursive: true }); fs.mkdirSync(vazia, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
  const log = path.join(dir, 'args.log');
  for (const nome of ['claude', 'codex']) {
    if (!bins[nome]) continue;
    if (WIN) escreve(path.join(bin, `${nome}.cmd`), `@echo off\r\nif "%~1"=="--version" (echo 9.9.9& exit /b 0)\r\necho ${nome} %*>>"${log}"\r\necho FAKE-${nome.toUpperCase()}-RODOU %*\r\n`);
    else { escreve(path.join(bin, nome), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi\necho ${nome} "$@" >> "${log}"\necho FAKE-${nome.toUpperCase()}-RODOU "$@"\n`); fs.chmodSync(path.join(bin, nome), 0o755); }
  }
  const esperadas = [];
  if (sessoes) {
    const base = Date.parse('2026-10-01T00:00:00Z');
    const projC = path.join(home, '.claude', 'projects', pastaCodificada(demo));
    for (let i = 1; i <= 7; i++) {
      const id = uuid('8000', i), quando = base + 2 * i * 3600e3;
      const f = path.join(projC, `${id}.jsonl`);
      escreve(f, linha({ type: 'last-prompt', leafUuid: 'x', sessionId: id }) + linha({ type: 'user', message: { role: 'user', content: `Conversa Claude ${i}: assunto fictício ${i}` }, sessionId: id, cwd: demo, timestamp: new Date(quando).toISOString() }));
      fs.utimesSync(f, quando / 1000, quando / 1000);
      esperadas.push({ provedor: 'claude', id, titulo: `Conversa Claude ${i}: assunto fictício ${i}`, quando });
    }
    // arquivos hostis: nome com metacaractere, fora de uuid, subagente e memory/ (nunca podem aparecer nem ser escritos)
    escreve(path.join(projC, '$(calc).jsonl'), linha({ type: 'user', message: { content: 'HOSTIL-A' } }));
    escreve(path.join(projC, `${uuid('8000', 99)};calc.jsonl`), linha({ type: 'user', message: { content: 'HOSTIL-B' } }));
    escreve(path.join(projC, uuid('8000', 7), 'subagents', `${uuid('8000', 98)}.jsonl`), linha({ type: 'user', message: { content: 'HOSTIL-C' } }));
    escreve(path.join(projC, 'memory', `${uuid('8000', 97)}.jsonl`), linha({ type: 'user', message: { content: 'HOSTIL-D' } }));
    const sessC = path.join(home, '.codex', 'sessions', '2026', '10', '03');
    for (let j = 1; j <= 5; j++) {
      const id = uuid('9000', j), quando = base + (2 * j + 1) * 3600e3, iso = new Date(quando).toISOString();
      escreve(path.join(sessC, `rollout-2026-10-03T00-00-0${j}-${id}.jsonl`), linha({ timestamp: iso, type: 'session_meta', payload: { id, cwd: demo, timestamp: iso, originator: 'codex_cli', cli_version: '0.157.1', source: 'cli' } }));
      escreve(path.join(home, '.codex', 'history.jsonl'), (fs.existsSync(path.join(home, '.codex', 'history.jsonl')) ? fs.readFileSync(path.join(home, '.codex', 'history.jsonl'), 'utf8') : '') + linha({ session_id: id, ts: 1, text: `Conversa Codex ${j}: tarefa fictícia ${j}` }));
      esperadas.push({ provedor: 'codex', id, titulo: `Conversa Codex ${j}: tarefa fictícia ${j}`, quando });
    }
    const idMau = `${uuid('9000', 50)};calc`;
    escreve(path.join(sessC, `rollout-2026-10-03T00-00-59-${uuid('9000', 51)}.jsonl`), linha({ type: 'session_meta', payload: { id: idMau, cwd: demo, timestamp: new Date(base).toISOString() } }));
    escreve(path.join(sessC, `rollout-2026-10-03T00-00-58-${uuid('9000', 52)}.jsonl`), linha({ type: 'session_meta', payload: { id: uuid('9000', 52), cwd: path.join(home, 'projetos', 'outra'), timestamp: new Date(base).toISOString() } }));
  }
  escreve(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'voce@exemplo.com', displayName: 'Você', organizationName: 'Empresa Demo' } }));
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: demo, groups: [] }, { name: 'vazia', custom: false, cols: 1, root: vazia, groups: [] }], active: 0 } },
  }, null, 2));
  const ordenadas = E.ordenarRecentes(esperadas);
  return { dir, home, data, bin, log, demo, esperadas: ordenadas, limpa: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* em uso */ } } };
}

// ── CDP ─────────────────────────────────────────────────────────────────────
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
async function alvo(porta, tipo) {
  for (let i = 0; i < 80; i++) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => !tipo || x.type === tipo); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}

async function abrir(sb) {
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  // PATH: a pasta dos executáveis falsos primeiro, e o PATH real sem as pastas que têm um claude/codex de verdade
  // (PATH mínimo não serve: o ConPTY não acha o PowerShell). Assim `where claude`/`where codex` só acham os falsos.
  const reais = n => [n, `${n}.exe`, `${n}.cmd`, `${n}.bat`];
  const sep = path.delimiter;
  const PATH = [sb.bin, ...(process.env.Path || process.env.PATH || '').split(sep).filter(d => d && !['claude', 'codex'].some(n => reais(n).some(f => fs.existsSync(path.join(d, f)))))].join(sep);
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k]; // no Windows a chave é `Path`: uma só, para o override valer
  env[WIN ? 'Path' : 'PATH'] = PATH;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`  electron pid ${proc.pid}`);
  const app = { proc };
  const tMain = await alvo(portaMain);
  if (!tMain) throw new Error('inspector do main inacessível');
  app.main = cliente(tMain.webSocketDebuggerUrl); await app.main.pronto;
  // o main só registra os canais quando termina de subir: espera os dois existirem antes de embrulhar
  const req = `((process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null))('electron').ipcMain`;
  for (let i = 0; i < 100; i++) {
    const pronto = await app.main.ev(`(() => { const m = ${req}; return m.listeners('pty:write').length > 0 && !!(m._invokeHandlers && m._invokeHandlers.get && m._invokeHandlers.get('dev:agent-sessions')); })()`, { includeCommandLineAPI: true }).catch(() => false);
    if (pronto) break;
    await sleep(300);
  }
  // espia pty:write e deixa o dev:agent-sessions com atraso ajustável (para provar "digitou antes da resposta")
  const r = await app.main.ev(`(() => {
    const req = (process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null);
    const { ipcMain } = req('electron');
    globalThis.__escritas = []; globalThis.__atraso = 0;
    const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write');
    ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push({ t: Date.now(), data: m && m.data }); for (const l of ls) l(e, m); });
    let atraso = 'sem _invokeHandlers';
    const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get && ipcMain._invokeHandlers.get('dev:agent-sessions');
    if (h) { ipcMain._invokeHandlers.set('dev:agent-sessions', async (...a) => { if (globalThis.__atraso) await new Promise(r => setTimeout(r, globalThis.__atraso)); return h(...a); }); atraso = 'ok'; }
    return JSON.stringify({ ls: ls.length, atraso });
  })()`, { includeCommandLineAPI: true });
  app.espiao = JSON.parse(r);
  const tPag = await alvo(porta, 'page');
  if (!tPag) throw new Error('o app não abriu');
  app.pag = cliente(tPag.webSocketDebuggerUrl); await app.pag.pronto;
  const { send, ev } = app.pag;
  app.send = send; app.ev = ev;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  app.espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { /* carregando */ } await sleep(120); } throw new Error(`tempo esgotado: ${msg}`); };
  // as respostas automáticas do xterm (DA, foco, cores) começam com ESC e não contam: só texto de verdade
  app.escritas = async () => JSON.parse(await app.main.ev('JSON.stringify(globalThis.__escritas)')).filter(x => typeof x.data === 'string' && !x.data.startsWith(''));
  app.atraso = ms => app.main.ev(`globalThis.__atraso = ${ms}`);
  app.fechar = async () => {
    try { app.pag.ws.close(); app.main.ws.close(); } catch { /* fechado */ }
    try { if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch { /* já encerrou */ }
    await sleep(1500);
  };
  await app.espera(`!!document.querySelector('.ws.active')`, 40000, 'workspace ativo');
  return app;
}

// ── Passos reutilizáveis ────────────────────────────────────────────────────
const ULTIMO = `[...document.querySelectorAll('.ws.active .term-pane')].at(-1)`;
const ULTIMO_PAGINA = `[...document.querySelectorAll('#term-page .term-pane')].at(-1)`;
const PROMPT = alvo => `((${alvo}) ? [...(${alvo}).querySelectorAll('.xterm-rows > div')] : []).some(d => /[>$#]\\s*$/.test(d.textContent.replace(/\\u00a0/g, ' ').trimEnd()))`;
const nTerm = (app, esc = '.ws.active') => app.ev(`document.querySelectorAll('${esc} .term-pane').length`);

async function novoTerminal(app, { pagina = false } = {}) {
  const esc = pagina ? '#term-page' : '.ws.active';
  const antes = await nTerm(app, esc);
  await app.ev(`(() => { const el = [...document.querySelectorAll('${esc} [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
  await app.espera(`document.querySelectorAll('${esc} .term-pane').length === ${antes + 1}`, 20000, 'terminal aberto');
  const alvo = pagina ? ULTIMO_PAGINA : ULTIMO;
  try { await app.espera(PROMPT(alvo), 30000, 'prompt do shell'); } catch (e) {
    console.log('  linhas do terminal:', JSON.stringify(await app.ev(`((${alvo}) ? [...(${alvo}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent).filter(Boolean) : 'sem painel')`)));
    throw e;
  }
  return alvo;
}
const painel = (app, alvo) => app.ev(`!!(${alvo})?.querySelector('.term-agentes')`);
const itens = (app, alvo) => app.ev(`[...((${alvo})?.querySelectorAll('.term-agentes-item') || [])].map(b => ({ provedor: b.dataset.provedor, titulo: b.querySelector('.term-agentes-tit').textContent, data: b.querySelector('.term-agentes-data').textContent }))`);
const botoes = (app, alvo) => app.ev(`[...((${alvo})?.querySelectorAll('.term-agentes-nova') || [])].map(b => b.textContent)`);
const textoTerm = (app, alvo) => app.ev(`[...(${alvo}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);
const esperaPainel = (app, alvo, ms = 15000) => app.espera(`!!(${alvo})?.querySelector('.term-agentes')`, ms, 'painel de conversas');
async function fecharUltimo(app, esc = '.ws.active') {
  await app.ev(`(() => { const t = [...document.querySelectorAll('${esc} .term-tab')].at(-1); t.querySelector('[data-act=close]').click(); return true; })()`);
  await sleep(400);
  if (await app.ev(`document.getElementById('save-overlay').classList.contains('visible')`)) await app.ev(`document.querySelector('#save-actions .btn-primary').click()`);
  await sleep(500);
}
const tecla = async (app, key, code, vk) => { for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk }); };
const lerLog = sb => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const fotografa = async (app, nome) => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const { data } = await app.send('Page.captureScreenshot', { format: 'png' });
  const arq = path.join(SAIDA, `${nome}.png`);
  fs.writeFileSync(arq, Buffer.from(data, 'base64'));
  console.log(`  captura: ${arq}`);
};

// ── Cenários ────────────────────────────────────────────────────────────────
async function dois() {
  console.log('\n[1] dois provedores instalados, pasta com 12 conversas (7 Claude, 5 Codex)');
  const sb = sandbox({ bins: { claude: true, codex: true } });
  let app;
  try {
    app = await abrir(sb);
    afirma(app.espiao.atraso === 'ok' && app.espiao.ls >= 1, `espião de pty:write e atraso do canal instalados no main: ${JSON.stringify(app.espiao)}`);

    // painel, ordem, "Ver todas"
    let alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    const lista = await itens(app, alvo);
    const esperado10 = sb.esperadas.slice(0, 10);
    afirma(lista.length === 10, `o painel mostra 10 conversas (${lista.length})`);
    afirma(JSON.stringify(lista.map(i => i.titulo)) === JSON.stringify(esperado10.map(i => i.titulo)), 'as 10 mais novas, da mais nova para a mais antiga, misturando os dois provedores');
    afirma(JSON.stringify(lista.map(i => i.provedor)) === JSON.stringify(esperado10.map(i => i.provedor)), 'ícone/provedor de cada linha confere');
    afirma(lista.every((i, k) => i.data === E.dataBr(esperado10[k].quando)), `data DD/MM/AAAA HH:mm em cada linha (ex.: ${lista[0].data})`);
    afirma(!lista.some(i => /HOSTIL|calc/.test(i.titulo)), 'arquivos hostis (nome com ;, $(), subagente, memory/, rollout com id inválido) não aparecem');
    afirma(JSON.stringify(await botoes(app, alvo)) === JSON.stringify(['Nova conversa no Claude', 'Nova conversa no Codex', 'Só o terminal']), 'três botões de nova sessão');
    afirma(await app.ev(`!!(${alvo}).querySelector('[data-act="todas"]')`), '"Ver todas" no fim da lista');
    await fotografa(app, 'painel-10-conversas');
    // clique real (mousePressed/mouseReleased) na aba do terminal com o painel aberto: o foco fica dentro do painel e o
    // xterm não volta a receber teclas (o clique, sem o preventDefault do mousedown, foca no `click`)
    const caixaAba = await app.ev(`(() => { const r = [...document.querySelectorAll('.ws.active .term-tab .term-pane-name')].at(-1).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: caixaAba.x, y: caixaAba.y });
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: caixaAba.x, y: caixaAba.y, button: 'left', buttons: 1, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: caixaAba.x, y: caixaAba.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    afirma(await app.ev(`!!document.activeElement.closest('.term-agentes') && !!(${alvo}).querySelector('.term-agentes')`), 'clique real na aba com o painel aberto: o foco fica dentro do painel de conversas e o painel continua aberto');
    await app.ev(`(${alvo}).querySelector('[data-act="todas"]').click()`);
    await app.espera(`(${alvo}).querySelectorAll('.term-agentes-item').length === 12`, 15000, '12 conversas depois de "Ver todas"');
    afirma(true, '"Ver todas" expõe as 12');
    afirma(!(await app.ev(`!!(${alvo}).querySelector('[data-act="todas"]')`)), '"Ver todas" some depois de usado');
    await app.ev(`(${alvo}).querySelector('.term-agentes-lista').scrollTop = 0`);
    await fotografa(app, 'painel-12-conversas');

    // clique numa do Claude: texto exato, uma vez só, depois do prompt
    const alvoClaude = sb.esperadas.find(s => s.provedor === 'claude');
    const tPrompt = Date.now();
    await app.ev(`[...(${alvo}).querySelectorAll('.term-agentes-item')].find(b => b.dataset.provedor === 'claude' && b.querySelector('.term-agentes-tit').textContent === ${JSON.stringify(alvoClaude.titulo)}).click()`);
    await app.espera(`!(${alvo})?.querySelector('.term-agentes')`, 15000, 'painel some depois da escrita');
    let w = await app.escritas();
    const esperadoCmd = `claude --resume ${alvoClaude.id}\r`;
    afirma(w.filter(x => x.data === esperadoCmd).length === 1, `escrita exata e única no pty: ${JSON.stringify(esperadoCmd)}`);
    afirma(w.every(x => !/calc|;/.test(x.data)), 'nenhuma escrita com texto hostil');
    afirma(w.find(x => x.data === esperadoCmd).t >= tPrompt, 'a escrita veio depois de o prompt estar na tela (o clique só ocorre com o prompt visível)');
    afirma(w.find(x => x.data === esperadoCmd).t - tPrompt < 6000, 'escrita disparada pelo prompt, não pelo tempo limite de 8 s');
    await app.espera(`/FAKE-CLAUDE-RODOU/.test(${alvo}.textContent)`, 15000, 'o comando rodou no terminal');
    await sleep(600);
    afirma(lerLog(sb).filter(l => l === `claude --resume ${alvoClaude.id}`).length === 1, 'o executável falso recebeu --resume <uuid> uma vez');
    await fecharUltimo(app);

    // clique numa do Codex
    alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    const alvoCodex = sb.esperadas.find(s => s.provedor === 'codex');
    await app.ev(`[...(${alvo}).querySelectorAll('.term-agentes-item')].find(b => b.dataset.provedor === 'codex' && b.querySelector('.term-agentes-tit').textContent === ${JSON.stringify(alvoCodex.titulo)}).click()`);
    await app.espera(`!(${alvo})?.querySelector('.term-agentes')`, 15000, 'painel some (codex)');
    w = await app.escritas();
    afirma(w.filter(x => x.data === `codex resume ${alvoCodex.id}\r`).length === 1, 'codex resume <uuid>\\r escrito uma vez');
    await app.espera(`/FAKE-CODEX-RODOU/.test(${alvo}.textContent)`, 15000, 'codex falso rodou');
    await fecharUltimo(app);

    // Esc fecha o painel e não escreve nada
    const antes = (await app.escritas()).length;
    alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    afirma(await app.ev(`document.activeElement?.closest('.term-agentes') !== null`), 'o foco está dentro do painel (as teclas não vão ao shell)');
    await tecla(app, 'Escape', 'Escape', 27);
    await app.espera(`!(${alvo})?.querySelector('.term-agentes')`, 5000, 'Esc fecha o painel');
    afirma((await app.escritas()).length === antes, 'Esc fecha o painel e não escreve nada no pty');
    await fecharUltimo(app);

    // "Só o terminal"
    alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    await app.ev(`(${alvo}).querySelector('[data-nova="terminal"]').click()`);
    await app.espera(`!(${alvo})?.querySelector('.term-agentes')`, 5000, '"Só o terminal" fecha o painel');
    afirma((await app.escritas()).length === antes, '"Só o terminal" não escreve nada');
    await fecharUltimo(app);

    // Nova conversa no Claude / no Codex
    for (const prov of ['claude', 'codex']) {
      alvo = await novoTerminal(app);
      await esperaPainel(app, alvo);
      await app.ev(`(${alvo}).querySelector('[data-nova="${prov}"]').click()`);
      await app.espera(`!(${alvo})?.querySelector('.term-agentes')`, 15000, `nova ${prov}`);
      afirma((await app.escritas()).filter(x => x.data === `${prov}\r`).length === 1, `"Nova conversa no ${prov}" escreve ${prov}\\r uma vez`);
      await fecharUltimo(app);
    }

    // digitar antes da resposta: sem painel
    await app.atraso(2500);
    alvo = await novoTerminal(app);
    await app.ev(`(${alvo}).querySelector('.xterm-helper-textarea')?.focus()`);
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', text: 'x', windowsVirtualKeyCode: 88 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 });
    await sleep(4500);
    afirma(!(await painel(app, alvo)), 'quem digitou antes da resposta fica sem painel');
    await app.atraso(0);
    await fecharUltimo(app);

    // workspace sem conversas: só as opções de nova sessão
    await app.ev(`document.querySelectorAll('.ws-tab')[1].click()`);
    await sleep(600);
    alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    afirma((await itens(app, alvo)).length === 0 && !(await app.ev(`!!(${alvo}).querySelector('.term-agentes-lista')`)), 'pasta sem conversa: sem lista');
    afirma(JSON.stringify(await botoes(app, alvo)) === JSON.stringify(['Nova conversa no Claude', 'Nova conversa no Codex', 'Só o terminal']), 'pasta sem conversa: só as opções de nova sessão');
    await fotografa(app, 'painel-pasta-sem-conversa');
    await app.ev(`(${alvo}).querySelector('[data-nova="terminal"]').click()`);
    await fecharUltimo(app);
    await app.ev(`document.querySelectorAll('.ws-tab')[0].click()`);
    await sleep(400);

    // terminal avulso (página Terminal, sem pasta): sem painel
    await app.ev(`document.querySelector('[data-page="terminal"]').click()`);
    await sleep(700);
    const nAntes = (await app.escritas()).length;
    alvo = await novoTerminal(app, { pagina: true });
    await sleep(4000);
    afirma(!(await painel(app, alvo)), 'terminal avulso (sem pasta): sem painel e sem lista');
    afirma((await app.escritas()).length === nAntes, 'terminal avulso não recebe escrita nenhuma');
  } catch (e) { afirma(false, `cenário 1 abortou: ${e.message}`); }
  finally { if (app) await app.fechar(); sb.limpa(); }
}

async function soClaude() {
  console.log('\n[2] só o Claude instalado (o codex falso não existe no PATH)');
  const sb = sandbox({ bins: { claude: true, codex: false } });
  let app;
  try {
    app = await abrir(sb);
    const alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    afirma(JSON.stringify(await botoes(app, alvo)) === JSON.stringify(['Nova conversa no Claude', 'Só o terminal']), 'dois botões: Claude e só o terminal');
    const lista = await itens(app, alvo);
    afirma(lista.length === 7 && lista.every(i => i.provedor === 'claude'), `a lista tem só as 7 conversas do Claude (${lista.length})`);
    afirma(!(await app.ev(`!!(${alvo}).querySelector('[data-act="todas"]')`)), 'com até 10 conversas não há "Ver todas"');
    await app.ev(`(${alvo}).querySelector('[data-nova="terminal"]').click()`);
    await sleep(300);
    afirma((await app.escritas()).length === 0, 'nada escrito no pty');
  } catch (e) { afirma(false, `cenário 2 abortou: ${e.message}`); }
  finally { if (app) await app.fechar(); sb.limpa(); }
}

async function nenhum() {
  console.log('\n[3] nenhum provedor instalado e nenhuma conversa gravada: o terminal abre direto');
  const sb = sandbox({ bins: { claude: false, codex: false }, sessoes: false });
  let app;
  try {
    app = await abrir(sb);
    const alvo = await novoTerminal(app);
    await sleep(5000);
    afirma(!(await painel(app, alvo)), 'sem painel quando nenhum provedor responde --version');
    afirma((await app.escritas()).length === 0, 'nada escrito no pty');
    afirma(await app.ev(`${PROMPT(alvo)}`), 'o terminal segue normal, com o prompt na tela');
  } catch (e) { afirma(false, `cenário 3 abortou: ${e.message}`); }
  finally { if (app) await app.fechar(); sb.limpa(); }
}

async function deteccaoFalha() {
  console.log('\n[4] conversas gravadas mas nenhum provedor responde (PATH do app diferente do shell): aviso e só o terminal');
  const sb = sandbox({ bins: { claude: false, codex: false } });
  let app;
  try {
    app = await abrir(sb);
    const alvo = await novoTerminal(app);
    await esperaPainel(app, alvo);
    afirma(JSON.stringify(await botoes(app, alvo)) === JSON.stringify(['Só o terminal']), 'só o botão "Só o terminal"');
    afirma((await itens(app, alvo)).length === 0, 'sem lista de conversas');
    afirma(await app.ev(`/Não deu para conferir/.test((${alvo}).querySelector('.term-agentes-aviso')?.textContent || '')`), 'aviso curto para leigo no painel');
    await app.ev(`(${alvo}).querySelector('[data-nova="terminal"]').click()`);
    await sleep(300);
    afirma(!(await painel(app, alvo)) && (await app.escritas()).length === 0, 'o painel fecha e nada é escrito no pty');
  } catch (e) { afirma(false, `cenário 4 abortou: ${e.message}`); }
  finally { if (app) await app.fechar(); sb.limpa(); }
}

(async () => {
  const so = process.env.E2E_SO || '1234';
  if (so.includes('1')) await dois();
  if (so.includes('2')) await soClaude();
  if (so.includes('3')) await nenhum();
  if (so.includes('4')) await deteccaoFalha();
  console.log(falhas.length ? `\n✗ ${falhas.length} falha(s):\n  - ${falhas.join('\n  - ')}` : '\n✓ tudo certo');
  process.exit(falhas.length ? 1 : 0);
})();

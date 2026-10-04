// Prova de ponta a ponta de reordenar as abas (projetos, terminais e editor) com MOUSE REAL e TECLADO REAL via CDP:
// app em sandbox (pasta temporária com home e dados falsos), janela fora da tela e sem foco (RENDRA_E2E_HIDDEN=1).
// O arraste usa Input.setInterceptDrags + Input.dispatchMouseEvent + Input.dispatchDragEvent (o caminho que passa pelo
// mousedown real e pelo início do arraste do Chromium). O cenário `controle` prova que esse mecanismo move um elemento
// sem handler nenhum de mousedown: se ele falhar, o problema é o mecanismo, não a aba.
// Fora do `npm test`: abre o Electron. Uso:
//   node scripts/e2e-reordenar-abas.js [--cenario=controle,terminais,...] [--saida=<pasta>]
// Sai com código 1 se qualquer asserção falhar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const arg = nome => (process.argv.find(a => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-abas'));
const ESCOLHIDOS = arg('cenario') ? arg('cenario').split(',').map(s => s.trim()).filter(Boolean) : null;

const falhas = [];
let cenarioAtual = '';
function afirma(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); return true; }
  falhas.push(`[${cenarioAtual}] ${msg}`);
  console.log(`  ✗ ${msg}`);
  return false;
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escreve = (arquivo, texto) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, texto); };
const lerConfig = sb => JSON.parse(fs.readFileSync(path.join(sb.data, 'rendra-config.json'), 'utf8'));

// ── Sandbox ─────────────────────────────────────────────────────────────────
// opts.projetos: nomes dos projetos (padrão p1, p2, p3); opts.grupos: { p1: [{ tabs: ['@a.txt'], active: '@a.txt' }] }
function criarSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-abas-'));
  const home = path.join(dir, 'home');
  const data = path.join(dir, 'data');
  const projeto = path.join(home, 'projetos', 'demo');
  for (const n of ['a', 'b', 'c', 'd']) escreve(path.join(projeto, `${n}.txt`), `arquivo ${n} palavra um dois\n`);
  const caminho = t => (t[0] === '@' ? path.join(projeto, t.slice(1)) : t);
  const nomes = opts.projetos || ['p1', 'p2', 'p3'];
  const list = nomes.map(name => ({
    name, custom: true, cols: 3, root: projeto,
    groups: (opts.grupos?.[name] || []).map(g => ({ tabs: g.tabs.map(caminho), active: caminho(g.active) })),
  }));
  escreve(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'voce@exemplo.com', displayName: 'Você', organizationName: 'Empresa Demo' } }));
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list, active: opts.ativo || 0 } },
  }, null, 2));
  return { dir, home, data, projeto };
}

// ── App em execução, controlado por CDP ─────────────────────────────────────
async function conectar(porta) {
  let alvos = [];
  for (let i = 0; i < 80; i++) {
    try { alvos = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); if (alvos.some(t => t.type === 'page')) break; } catch { /* iniciando */ }
    await sleep(500);
  }
  const pagina = alvos.find(t => t.type === 'page');
  if (!pagina) throw new Error('o app não abriu');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  const pendentes = {};
  const eventos = [];
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method) { eventos.push(m); return; }
    if (!pendentes[m.id]) return;
    if (m.error) pendentes[m.id].reject(new Error(m.error.message)); else pendentes[m.id].resolve(m.result);
    delete pendentes[m.id];
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pendentes[i] = { resolve, reject };
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expressao => {
    const r = await send('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || ''}`.slice(0, 400));
    return r.result?.value;
  };
  return { ws, send, ev, eventos };
}

async function abrir(sb) {
  const porta = 9400 + Math.floor(Math.random() * 400);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`], { cwd: ROOT, env, stdio: 'ignore' });
  const { ws, send, ev, eventos } = await conectar(porta);
  const app = { sb, proc, ws, send, ev, eventos };
  sb.appAtual = app;
  app.espera = async (expr, ms = 20000, msg = expr) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await ev(expr)) return true; } catch { /* página ainda carregando */ }
      await sleep(120);
    }
    throw new Error(`tempo esgotado esperando: ${msg}`);
  };
  app.fechar = async () => {
    try { ws.close(); } catch { /* fechado */ }
    try { if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch { /* já encerrou */ }
    await sleep(1500);
  };
  app.reiniciar = async () => { await app.fechar(); return abrir(sb); };
  app.foto = async nome => {
    fs.mkdirSync(SAIDA, { recursive: true });
    await ev(`(() => { let s = document.getElementById('e2e-oculta'); if (!s) { s = document.createElement('style'); s.id = 'e2e-oculta'; document.head.appendChild(s); } s.textContent = '.xterm-screen{visibility:hidden !important}'; })()`);
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await ev(`document.getElementById('e2e-oculta')?.remove()`);
    const arq = path.join(SAIDA, `${nome}.png`);
    fs.writeFileSync(arq, Buffer.from(data, 'base64'));
    console.log(`  captura: ${arq}`);
    return arq;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.espera(`!!document.querySelector('.ws.active')`, 40000, 'workspace ativo');
  // conta os dragstart reais (o Chromium só dispara quando o arraste nativo começa)
  await ev(`(() => { window.__dragstarts = 0; window.__evlog = []; document.addEventListener('dragstart', () => { window.__dragstarts++; }, true); ['dragstart', 'dragend', 'dragenter', 'dragover', 'drop', 'dragleave'].forEach(t => document.addEventListener(t, e => window.__evlog.push(t + ':' + (e.target.className || e.target.nodeName)), true)); return true; })()`);
  return app;
}

async function comApp(opts, fn) {
  const sb = criarSandbox(opts);
  let app = null;
  try {
    app = await abrir(sb);
    await fn(app, sb);
  } finally {
    const atual = sb.appAtual || app;
    if (atual) await atual.fechar();
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

// ── Mouse e arraste reais ───────────────────────────────────────────────────
const caixa = (app, seletor, n = 0) => app.ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(seletor)})[${n}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const centro = c => ({ x: Math.round(c.x + c.w / 2), y: Math.round(c.y + c.h / 2) });
const mouse = (app, type, x, y, extra = {}) => app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

// Clique de verdade (pressed + released) no centro do elemento; devolve o ponto
async function cliqueReal(app, seletor, n = 0, { clickCount = 1, botao = 'left', dx = null } = {}) {
  const c = await caixa(app, seletor, n);
  if (!c) throw new Error(`não achei para clicar: ${seletor}[${n}]`);
  const { x: cx, y } = centro(c);
  const x = dx === null ? cx : Math.round(c.x + dx); // dx: distância da borda esquerda (para clicar numa palavra e não no vazio)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: botao, buttons: botao === 'left' ? 1 : 4, clickCount });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: botao, buttons: 0, clickCount });
  return { x, y };
}

// Arraste nativo: mouse pressionado na origem, movido aos poucos até o destino; o Chromium inicia o arraste e o
// CDP o intercepta (Input.dragIntercepted); depois dragEnter/dragOver/drop no destino.
// origem/destino: { sel, n }. lado: 'antes' (quarto esquerdo do alvo) ou 'depois' (quarto direito).
// opts.noMeio: função chamada depois do dragOver e antes do drop. opts.soltar=false deixa o arraste no ar
// (devolve `concluir()`); opts.soltarEm = {x,y} solta num ponto qualquer (por exemplo sobre o Monaco).
async function arrasta(app, origem, destino, { lado = 'antes', noMeio = null, soltar = true, soltarEm = null } = {}) {
  const o = await caixa(app, origem.sel, origem.n || 0);
  if (!o) throw new Error(`origem do arraste não existe: ${origem.sel}`);
  let alvo;
  if (soltarEm) alvo = soltarEm;
  else {
    const d = await caixa(app, destino.sel, destino.n || 0);
    if (!d) throw new Error(`destino do arraste não existe: ${destino.sel}`);
    alvo = { x: Math.round(d.x + d.w * (lado === 'antes' ? 0.25 : 0.75)), y: Math.round(d.y + d.h / 2) };
  }
  const p0 = centro(o);
  app.eventos.length = 0;
  await app.ev('window.__dragstarts = 0');
  await app.send('Input.setInterceptDrags', { enabled: true });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y });
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
  const passos = 8;
  let dados = null;
  for (let i = 1; i <= passos; i++) {
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p0.x + (alvo.x - p0.x) * i / passos), y: Math.round(p0.y + (alvo.y - p0.y) * i / passos), button: 'left', buttons: 1 });
    await sleep(40);
    dados = app.eventos.find(e => e.method === 'Input.dragIntercepted')?.params.data || dados;
    if (dados) break;
  }
  for (let i = 0; i < 20 && !dados; i++) { await sleep(50); dados = app.eventos.find(e => e.method === 'Input.dragIntercepted')?.params.data; }
  const resultado = { iniciou: !!dados, dragstarts: await app.ev('window.__dragstarts'), dados };
  const fim = async () => {
    if (dados) {
      await app.send('Input.dispatchDragEvent', { type: 'drop', x: alvo.x, y: alvo.y, data: dados });
    }
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: alvo.x, y: alvo.y, button: 'left', buttons: 0, clickCount: 1 });
    await app.send('Input.setInterceptDrags', { enabled: false });
    await sleep(250);
  };
  if (!dados) { await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: alvo.x, y: alvo.y, button: 'left', buttons: 0, clickCount: 1 }); await app.send('Input.setInterceptDrags', { enabled: false }); return resultado; }
  await app.send('Input.dispatchDragEvent', { type: 'dragEnter', x: alvo.x, y: alvo.y, data: dados });
  for (let k = 0; k < 2; k++) { await app.send('Input.dispatchDragEvent', { type: 'dragOver', x: alvo.x, y: alvo.y, data: dados }); await sleep(30); }
  if (noMeio) {
    await noMeio();
    // o mouse de verdade continua mandando dragover: sem ele o Chromium não solta sobre um elemento que acabou de ser recriado
    for (let k = 0; k < 2; k++) { await app.send('Input.dispatchDragEvent', { type: 'dragOver', x: alvo.x, y: alvo.y, data: dados }); await sleep(30); }
  }
  resultado.concluir = fim;
  if (soltar) await fim();
  return resultado;
}

// ── Passos reutilizáveis ────────────────────────────────────────────────────
async function novoTerminal(app, escopo = '.ws.active') {
  const antes = await app.ev(`document.querySelectorAll('${escopo} .term-pane').length`);
  await app.ev(`(() => { const el = [...document.querySelectorAll('${escopo} [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
  await app.espera(`document.querySelectorAll('${escopo} .term-pane').length === ${antes + 1}`, 20000, 'terminal aberto');
  // o nome só chega depois que o pty abre
  await app.espera(`[...document.querySelectorAll('${escopo} .term-pane-name')].every(n => n.textContent && n.textContent !== '…')`, 20000, 'nome do terminal');
}
const nomesTerminais = (app, escopo = '.ws.active') => app.ev(`[...document.querySelectorAll('${escopo} .term-tab .term-pane-name')].map(n => n.textContent)`);
// marca cada aba e cada pane com o índice atual: depois do movimento a ordem das marcas nas abas e nos panes tem de ser a mesma
const marcaTerminais = (app, escopo = '.ws.active') => app.ev(`(() => { document.querySelectorAll('${escopo} .term-tab').forEach((t, i) => { t.dataset.e2e = i; }); document.querySelectorAll('${escopo} .term-pane').forEach((p, i) => { p.dataset.e2e = i; }); return true; })()`);
const ordemMarcas = (app, escopo = '.ws.active') => app.ev(`({ abas: [...document.querySelectorAll('${escopo} .term-tab')].map(t => +t.dataset.e2e), panes: [...document.querySelectorAll('${escopo} .term-pane')].map(p => +p.dataset.e2e) })`);
const nomesProjetos = app => app.ev(`[...document.querySelectorAll('#ws-tabs .ws-tab-name')].map(n => n.textContent)`);
const sombra = (app, seletor, n = 0) => app.ev(`getComputedStyle(document.querySelectorAll(${JSON.stringify(seletor)})[${n}]).boxShadow`);
const restos = app => app.ev(`document.querySelectorAll('.dragging, .drop-before, .drop-after').length`);
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);

// ── CENÁRIOS ────────────────────────────────────────────────────────────────
const CENARIOS = {};

// Controle positivo (correção 5): o mesmo mecanismo move um div draggable injetado, sem preventDefault nenhum
CENARIOS.controle = async () => {
  await comApp({ projetos: ['p1'] }, async app => {
    await app.ev(`(() => {
      const c = document.createElement('div'); c.id = 'ctl'; c.style.cssText = 'position:fixed;left:300px;top:200px;width:300px;height:40px;z-index:99999;display:flex;background:#222;color:#fff';
      c.innerHTML = '<div id="ctl-a" draggable="true" style="flex:1;border:1px solid #888">A</div><div id="ctl-b" draggable="true" style="flex:1;border:1px solid #888">B</div><div id="ctl-c" draggable="true" style="flex:1;border:1px solid #888">C</div>';
      document.body.appendChild(c);
      let arrastado = null;
      c.addEventListener('dragstart', e => { arrastado = e.target.closest('[draggable]'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-controle', 'x'); });
      c.addEventListener('dragover', e => { e.preventDefault(); });
      c.addEventListener('drop', e => { e.preventDefault(); const alvo = e.target.closest('[draggable]'); if (arrastado && alvo && alvo !== arrastado) c.insertBefore(arrastado, alvo); });
      return true;
    })()`);
    const r = await arrasta(app, { sel: '#ctl-c' }, { sel: '#ctl-a' }, { lado: 'antes' });
    console.log(`  caminho CDP: dragIntercepted ${r.iniciou ? 'sim' : 'não'}, dragstart ${r.dragstarts}`);
    afirma(r.iniciou && r.dragstarts === 1, 'o controle (div draggable sem preventDefault) inicia o arraste: dragstart disparou e o CDP interceptou');
    const ordem = await app.ev(`[...document.querySelectorAll('#ctl > div')].map(d => d.textContent)`);
    afirma(igual(ordem, ['C', 'A', 'B']), `o controle foi movido pelo mecanismo CDP (ordem ${ordem.join(',')})`);
  });
};

// T1 + T5: arraste real das abas dos terminais (no projeto e na página Terminal)
CENARIOS.terminais = async () => {
  await comApp({ projetos: ['p1', 'p2'] }, async app => {
    await novoTerminal(app); await novoTerminal(app); await novoTerminal(app);
    const antes = await nomesTerminais(app);
    afirma(antes.length === 3 && new Set(antes).size === 3, `três terminais com nomes distintos (${antes.join(' | ')})`);
    await marcaTerminais(app);
    const r = await arrasta(app, { sel: '.ws.active .term-tab', n: 2 }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
    afirma(r.iniciou && r.dragstarts === 1, `o arraste da aba do terminal começa (dragstart ${r.dragstarts}, interceptado ${r.iniciou})`);
    const depois = await nomesTerminais(app);
    afirma(igual(depois, [antes[2], antes[0], antes[1]]), `a ordem das abas mudou: ${depois.join(' | ')}`);
    afirma(igual(await ordemMarcas(app), { abas: [2, 0, 1], panes: [2, 0, 1] }), 'a grade acompanha as abas (panes na mesma ordem)');
    afirma(igual([...depois].sort(), [...antes].sort()), 'os nomes não mudaram');
    afirma((await restos(app)) === 0, 'nenhuma classe .dragging/.drop-* sobra depois de soltar');

    // lado "depois": a primeira aba (agora a do terminal 3) vai para depois da última
    await arrasta(app, { sel: '.ws.active .term-tab', n: 0 }, { sel: '.ws.active .term-tab', n: 2 }, { lado: 'depois' });
    afirma(igual(await nomesTerminais(app), [antes[0], antes[1], antes[2]]), `lado "depois": ${(await nomesTerminais(app)).join(' | ')}`);
    afirma(igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }), 'e a grade acompanha de novo');

    // o clique simples (sem arrasto) segue focando o terminal e não reordena
    await app.ev('window.__dragstarts = 0');
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 1);
    afirma(igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }) && (await app.ev('window.__dragstarts')) === 0, 'um clique simples não reordena nem inicia arraste');

    // renomear terminal: com o input aberto a aba não é arrastável e o mouse marca o texto (nada de arraste)
    await cliqueReal(app, '.ws.active .term-tab [data-act="rename"]', 1);
    await app.espera(`!!document.querySelector('.ws.active .term-tab input.term-rename')`, 5000, 'input de renomear terminal');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .term-tab')[1].draggable === false`), 'renomear terminal: a aba deixa de ser arrastável enquanto o input está aberto');
    await app.send('Input.insertText', { text: 'terminal-comprido' });
    const selR = await marcaNoInput(app, '.ws.active .term-tab input.term-rename');
    afirma(!!selR && selR.dragstarts === 0 && selR.b > selR.a, `renomear terminal: o mouse marca o texto do input sem iniciar arraste (seleção ${selR?.a}-${selR?.b}, dragstarts ${selR?.dragstarts})`);
    // com o texto todo selecionado, arrastar a partir do input é o arraste NATIVO do texto: não pode reordenar a aba
    await app.ev(`document.querySelector('.ws.active .term-tab input.term-rename').select()`);
    await arrasta(app, { sel: '.ws.active .term-tab input.term-rename' }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }) && (await restos(app)) === 0, 'renomear terminal: arrastar o texto selecionado do input até outra aba não move a aba');
    await app.ev(`document.querySelector('.ws.active .term-tab input.term-rename')?.focus()`);
    await tecla(app, 'Escape', 'Escape', 27);
    await app.espera(`!document.querySelector('.ws.active .term-tab input.term-rename')`, 5000, 'fim do renomear terminal');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .term-tab')[1].draggable === true`), 'renomear terminal: ao terminar a aba volta a ser arrastável');
    await arrasta(app, { sel: '.ws.active .term-tab', n: 1 }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await ordemMarcas(app), { abas: [1, 0, 2], panes: [1, 0, 2] }), 'e depois de renomear o arraste da aba volta a funcionar');
    await arrasta(app, { sel: '.ws.active .term-tab', n: 0 }, { sel: '.ws.active .term-tab', n: 1 }, { lado: 'depois' });
    afirma(igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }), 'e a ordem volta a 0, 1, 2');

    // soltar a aba do terminal sobre o xterm não digita nada no shell (tipo próprio do arraste, nunca text/plain)
    const xterm = await caixa(app, '.ws.active .term-pane .xterm-screen', 1);
    const textoXterm = () => app.ev(`[...document.querySelectorAll('.ws.active .term-pane')].map(p => p.querySelector('.xterm-rows').textContent).join('|')`);
    const rowsAntes = await textoXterm();
    const rx = await arrasta(app, { sel: '.ws.active .term-tab', n: 0 }, null, { soltarEm: { x: Math.round(xterm.x + xterm.w / 2), y: Math.round(xterm.y + xterm.h / 2) } });
    await sleep(700);
    afirma(rx.iniciou && (await textoXterm()) === rowsAntes, 'soltar a aba do terminal sobre o xterm não escreve nada no terminal (texto dos terminais igual)');
    afirma(igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }), 'e a ordem não mudou');

    // as barras não aceitam arraste umas das outras (projeto sobre terminal e terminal sobre projeto)
    await arrasta(app, { sel: '#ws-tabs .ws-tab', n: 1 }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await nomesProjetos(app), ['p1', 'p2']) && igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }), 'a aba de projeto solta na barra de terminais é recusada (nada mudou)');
    await arrasta(app, { sel: '.ws.active .term-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await nomesProjetos(app), ['p1', 'p2']) && igual(await ordemMarcas(app), { abas: [0, 1, 2], panes: [0, 1, 2] }), 'a aba de terminal solta na barra de projetos é recusada (nada mudou)');
    afirma((await restos(app)) === 0, 'nenhuma classe sobra depois das recusas');

    // painel de conversas (onde o claude/codex existem): o painel e o foco ficam certos depois do movimento
    const comPainel = await app.ev(`!!document.querySelectorAll('.ws.active .term-pane')[2].querySelector('.term-agentes')`);
    if (comPainel) {
      await arrasta(app, { sel: '.ws.active .term-tab', n: 2 }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
      afirma(await app.ev(`!!document.querySelectorAll('.ws.active .term-pane')[0].querySelector('.term-agentes') && !!document.activeElement.closest('.term-agentes')`), '(R7) com o painel de conversas aberto o painel anda com o terminal e o foco fica dentro dele');
      await arrasta(app, { sel: '.ws.active .term-tab', n: 0 }, { sel: '.ws.active .term-tab', n: 2 }, { lado: 'depois' });
    } else console.log('  (sem painel de conversas nesta máquina: o caso fica em scripts/e2e-seletor-sessoes.js)');

    // terminal morto: dispensa o painel, digita exit e arrasta a aba riscada
    await dispensaPainel(app, 2);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 2);
    await app.send('Input.insertText', { text: 'exit' });
    await tecla(app, 'Enter', 'Enter', 13);
    await app.espera(`document.querySelectorAll('.ws.active .term-tab')[2].classList.contains('dead')`, 20000, 'terminal morto');
    await marcaTerminais(app);
    await arrasta(app, { sel: '.ws.active .term-tab', n: 2 }, { sel: '.ws.active .term-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await ordemMarcas(app), { abas: [2, 0, 1], panes: [2, 0, 1] }) && (await app.ev(`document.querySelectorAll('.ws.active .term-tab')[0].classList.contains('dead')`)), '(F20) a aba de um terminal morto também reordena e continua riscada');
  });
};

// Correção 6: sem o preventDefault do mousedown, o foco ao clicar na aba do terminal continua certo, com mouse real
// (o foco com o painel de conversas aberto fica em scripts/e2e-seletor-sessoes.js, que tem as conversas fictícias)
const MODAL = '#settings-overlay.visible, #save-overlay.visible, #setup-overlay.visible, #novidades-overlay.visible, .dev-term-menu, .dev-ctx-menu';
const tecla = async (app, key, code, vk, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers });
};
const focoNoPane = (app, n, escopo = '.ws.active') => app.ev(`(() => { const a = document.activeElement; return !!a && a.classList.contains('xterm-helper-textarea') && a.closest('.term-pane') === document.querySelectorAll('${escopo} .term-pane')[${n}]; })()`);
// área de transferência de mentira na página: nada toca a do dono da máquina
const stubClipboard = app => app.ev(`(() => { window.__clip = []; navigator.clipboard.writeText = async t => { window.__clip.push(t); }; navigator.clipboard.readText = async () => ''; return true; })()`);

async function dispensaPainel(app, n, escopo = '.ws.active') {
  const pane = `document.querySelectorAll('${escopo} .term-pane')[${n}]`;
  // o painel chega depois do prompt (só existe onde o claude ou o codex estão instalados): espera um pouco por ele
  for (let i = 0; i < 40 && !(await app.ev(`!!${pane}.querySelector('.term-agentes')`)); i++) await sleep(100);
  if (await app.ev(`!!${pane}.querySelector('.term-agentes')`)) {
    await app.ev(`${pane}.querySelector('.term-agentes button').focus()`);
    await tecla(app, 'Escape', 'Escape', 27);
    await app.espera(`!${pane}.querySelector('.term-agentes')`, 5000, 'painel dispensado');
  }
}

CENARIOS.foco = async () => {
  await comApp({ projetos: ['p1'] }, async app => {
    await novoTerminal(app); await novoTerminal(app);
    await stubClipboard(app);
    // quem tem o claude instalado vê o painel de conversas em terminal novo: digitar uma tecla o dispensa (o foco com o
    // painel aberto é provado em scripts/e2e-seletor-sessoes.js)
    for (const n of [0, 1]) await dispensaPainel(app, n);
    await marcaTerminais(app);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 0);
    afirma(await focoNoPane(app, 0), '(a) clique real na aba 1: o foco vai para o xterm do terminal 1');
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 1);
    afirma(await focoNoPane(app, 1), '(a) clique real na aba 2: o foco vai para o xterm do terminal 2');
    afirma((await app.ev('window.__dragstarts')) === 0, 'um clique simples não inicia arraste');
    // (c) selecionar uma palavra no terminal 2 (arraste do mouse no prompt) e clicar nas abas: a seleção fica
    const lin = await caixa(app, '.ws.active .term-pane[data-e2e="1"] .xterm-rows > div', 0);
    const ly = Math.round(lin.y + lin.h / 2);
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(lin.x + 8), y: ly });
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(lin.x + 8), y: ly, button: 'left', buttons: 1, clickCount: 1 });
    for (const dx of [30, 60, 90, 120]) { await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(lin.x + dx), y: ly, button: 'left', buttons: 1 }); await sleep(30); }
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(lin.x + 120), y: ly, button: 'left', buttons: 0, clickCount: 1 });
    await app.espera(`document.querySelectorAll('.ws.active .term-pane[data-e2e="1"] .xterm-selection div').length > 0`, 5000, 'seleção no terminal 2');
    await app.espera('window.__clip.length >= 1', 5000, 'cópia ao marcar').catch(() => { });
    afirma((await app.ev('window.__clip.length')) >= 1, '(c) a palavra foi marcada e copiada (na área de mentira)');
    const copias = await app.ev('window.__clip.length');
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 1);
    afirma((await app.ev(`document.querySelectorAll('.ws.active .term-pane[data-e2e="1"] .xterm-selection div').length`)) > 0, '(c) clicar na aba do terminal marcado não limpa a seleção');
    afirma((await app.ev('window.__clip.length')) === copias, '(c) clicar na aba não copia de novo');
    // (c) Ctrl+C de 3 toques: o toque pendente não se perde por clicar na aba
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 0);
    await tecla(app, 'c', 'KeyC', 67, 2);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 0);
    await tecla(app, 'c', 'KeyC', 67, 2);
    await sleep(200);
    const aviso = await app.ev(`(() => { const a = document.querySelector('.ws.active .term-pane[data-e2e="0"] .term-aviso'); return { visivel: a.classList.contains('visible'), texto: a.textContent }; })()`);
    afirma(aviso.visivel && /mais 1 vez/.test(aviso.texto), `(c) o segundo toque do Ctrl+C depois de clicar na aba segue a contagem (aviso "${aviso.texto}")`);
    // (d) nenhum diálogo (confirmação de link, salvar) abre só por clicar na aba
    afirma(!(await app.ev(`!!document.querySelector(${JSON.stringify(MODAL)})`)), '(d) clicar na aba não abre confirmação nem diálogo');
  });
};

// Espera o debounce do persist e devolve a lista gravada (nomes) e o índice ativo, ou null se não bateu a tempo
async function esperaConfig(sb, cond, ms = 6000) {
  const fim = Date.now() + ms;
  let w = null;
  while (Date.now() < fim) {
    try { w = lerConfig(sb).devcode?.workspaces; if (w && cond(w)) return w; } catch { /* gravando */ }
    await sleep(150);
  }
  return null;
}
const ativoDosProjetos = app => app.ev(`document.querySelector('#ws-tabs .ws-tab.active .ws-tab-name')?.textContent`);
// o `.ws` ativo é o do projeto ativo: a posição dele em #ws-host é a da ordem de CRIAÇÃO (a ordem dos nós não muda)
const wsAtivoIdx = app => app.ev(`[...document.querySelectorAll('#ws-host > .ws')].indexOf(document.querySelector('#ws-host > .ws.active'))`);
const nomesDe = async app => (await nomesProjetos(app)).join(', ');

// Marca parte do texto de um input com o mouse (pressed, moved, released) e devolve a seleção e os dragstarts
async function marcaNoInput(app, seletor) {
  const ci = await caixa(app, seletor);
  const y = Math.round(ci.y + ci.h / 2);
  await app.ev('window.__dragstarts = 0');
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(ci.x + 12), y });
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(ci.x + 12), y, button: 'left', buttons: 1, clickCount: 1 });
  for (const dx of [30, 50, 70]) { await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(ci.x + dx), y, button: 'left', buttons: 1 }); await sleep(30); }
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(ci.x + 70), y, button: 'left', buttons: 0, clickCount: 1 });
  return app.ev(`(() => { const i = document.querySelector(${JSON.stringify(seletor)}); return i ? { a: i.selectionStart, b: i.selectionEnd, n: i.value.length, dragstarts: window.__dragstarts } : null; })()`);
}
const duploClique = async (app, seletor, n = 0) => {
  const pt = centro(await caixa(app, seletor, n));
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
  for (const k of [1, 2]) {
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: k });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: k });
  }
};

// T3: projetos (ordem persistida e restaurada, ativo intacto, renomear e fechar depois do arraste)
CENARIOS.projetos = async () => {
  await comApp({ projetos: ['p1', 'p2', 'p3'], ativo: 1 }, async (app, sb) => {
    afirma(igual(await nomesProjetos(app), ['p1', 'p2', 'p3']) && (await ativoDosProjetos(app)) === 'p2', 'partida: p1, p2, p3 com p2 ativo');
    const idxAntes = await wsAtivoIdx(app);
    const r = await arrasta(app, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' });
    afirma(r.iniciou && r.dragstarts === 1, `o arraste da aba de projeto começa (dragstart ${r.dragstarts})`);
    afirma(igual(await nomesProjetos(app), ['p3', 'p1', 'p2']), `p3 arrastado para antes de p1: ${await nomesDe(app)}`);
    afirma((await ativoDosProjetos(app)) === 'p2' && (await wsAtivoIdx(app)) === idxAntes, 'o projeto ativo continua p2 e o painel ativo é o mesmo');
    afirma((await restos(app)) === 0, 'nenhuma classe .dragging/.drop-* sobra');
    const gravado = await esperaConfig(sb, w => igual(w.list.map(x => x.name), ['p3', 'p1', 'p2']));
    afirma(!!gravado && gravado.active === 2, `a ordem foi gravada em rendra-config.json (${gravado ? gravado.list.map(x => x.name).join(', ') : 'não gravou'}, ativo ${gravado?.active})`);

    // lado "depois": o primeiro vai para depois do último
    await arrasta(app, { sel: '#ws-tabs .ws-tab', n: 0 }, { sel: '#ws-tabs .ws-tab', n: 2 }, { lado: 'depois' });
    afirma(igual(await nomesProjetos(app), ['p1', 'p2', 'p3']), `p3 para depois de p2 (lado "depois"): ${await nomesDe(app)}`);
    await arrasta(app, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' }); // volta a p3, p1, p2
    await esperaConfig(sb, w => igual(w.list.map(x => x.name), ['p3', 'p1', 'p2']));

    // reabre o app: ordem e projeto ativo restaurados
    const app2 = await app.reiniciar();
    afirma(igual(await nomesProjetos(app2), ['p3', 'p1', 'p2']), `depois de reabrir: ${await nomesDe(app2)}`);
    afirma((await ativoDosProjetos(app2)) === 'p2', 'depois de reabrir: p2 continua o projeto ativo');

    // soltar sobre outra aba não ativa ninguém; um clique simples ativa
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 0 }, { sel: '#ws-tabs .ws-tab', n: 2 }, { lado: 'antes' }); // p3 antes de p2: p1, p3, p2
    afirma(igual(await nomesProjetos(app2), ['p1', 'p3', 'p2']) && (await ativoDosProjetos(app2)) === 'p2', 'soltar sobre a aba do projeto ativo não mudou o ativo');
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 1 }, { lado: 'antes' }); // p2 antes de p3: p1, p2, p3
    afirma((await ativoDosProjetos(app2)) === 'p2', 'arrastar a aba ativa também não troca de projeto');
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' }); // p3 antes de p1: p3, p1, p2
    afirma((await ativoDosProjetos(app2)) === 'p2', 'soltar sobre uma aba inativa não a ativa');
    await cliqueReal(app2, '#ws-tabs .ws-tab .ws-tab-name', 1); // p1
    afirma((await ativoDosProjetos(app2)) === 'p1', '(9a) um clique simples depois do arraste ativa o projeto');

    // renderWsTabs no meio do arraste (um clique programático ativa p2 e refaz as abas): ordem final certa, nada preso
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, {
      lado: 'antes',
      noMeio: () => app2.ev(`document.querySelectorAll('#ws-tabs .ws-tab')[2].click()`), // ativa p2: renderWsTabs apaga a aba de origem
    });
    if (process.env.DBG) console.log('  DBG', JSON.stringify(await app2.ev('window.__evlog.slice(-25)')));
    afirma(igual(await nomesProjetos(app2), ['p2', 'p3', 'p1']), `(3) com as abas redesenhadas no meio do arraste a ordem final está certa: ${await nomesDe(app2)}`);
    afirma((await restos(app2)) === 0, '(3) nenhuma classe .dragging/.drop-* sobrou');
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' });
    afirma(igual(await nomesProjetos(app2), ['p1', 'p2', 'p3']), `(3) o arraste seguinte também funciona (nada ficou preso): ${await nomesDe(app2)}`);

    // renomear com duplo clique depois do arraste e marcar o texto com o mouse dentro do input (a aba não arrasta)
    await duploClique(app2, '#ws-tabs .ws-tab .ws-tab-name', 0);
    await app2.espera(`!!document.querySelector('#ws-tabs input.ws-rename')`, 5000, 'input de renomear');
    afirma(await app2.ev(`document.querySelector('#ws-tabs .ws-tab:has(input.ws-rename)').draggable === false`), '(4) durante o renomear a aba não é arrastável');
    await app2.send('Input.insertText', { text: 'projeto-comprido' });
    const sel = await marcaNoInput(app2, '#ws-tabs input.ws-rename');
    afirma(!!sel && sel.b > sel.a && sel.dragstarts === 0, `(4) o mouse marca parte do texto dentro do input (${sel ? `${sel.a} a ${sel.b} de ${sel.n}` : 'input sumiu'}) sem arrastar a aba`);
    await tecla(app2, 'Enter', 'Enter', 13);
    await app2.espera(`!document.querySelector('#ws-tabs input.ws-rename')`, 5000, 'fim do renomear');
    afirma(igual(await nomesProjetos(app2), ['projeto-comprido', 'p2', 'p3']), `o nome novo vale na aba depois do arraste: ${await nomesDe(app2)}`);

    // (9b) o botão do meio e o × fecham a aba certa (procurada pelo id, não pelo índice de antes do arraste)
    await arrasta(app2, { sel: '#ws-tabs .ws-tab', n: 2 }, { sel: '#ws-tabs .ws-tab', n: 0 }, { lado: 'antes' }); // p3, projeto-comprido, p2
    await cliqueReal(app2, '#ws-tabs .ws-tab', 1, { botao: 'middle' });
    await app2.espera(`document.querySelectorAll('#ws-tabs .ws-tab').length === 2`, 5000, 'fechou pelo botão do meio');
    afirma(igual(await nomesProjetos(app2), ['p3', 'p2']), `(9b) o botão do meio fechou a aba do meio (projeto-comprido): ${await nomesDe(app2)}`);
    await cliqueReal(app2, '#ws-tabs .ws-tab .ws-tab-close', 0);
    await app2.espera(`document.querySelectorAll('#ws-tabs .ws-tab').length === 1`, 5000, 'fechou pelo ×');
    afirma(igual(await nomesProjetos(app2), ['p2']), `(9b) o × fechou a primeira aba (p3): ${await nomesDe(app2)}`);
  });
};

const abasEditor = (app, g = 0) => app.ev(`[...(document.querySelectorAll('.ws.active .dev-group')[${g}]?.querySelectorAll('.dev-tab .dev-tab-name') || [])].map(n => n.textContent)`);
const ativaEditor = (app, g = 0) => app.ev(`document.querySelectorAll('.ws.active .dev-group')[${g}]?.querySelector('.dev-tab.active .dev-tab-name')?.textContent ?? null`);
const base = p => p.split(/[\\/]/).pop();
const ctrlTab = async (app, shift = false) => {
  for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 10 : 2 });
  await sleep(150);
};
const linhasDoEditor = (app, g = 0) => app.ev(`document.querySelectorAll('.ws.active .dev-group')[${g}]?.querySelector('.view-lines')?.textContent ?? null`);

// T4: abas do editor (arrasto no mesmo grupo, ordem em groups[].tabs, sem renomear, recusa entre grupos)
CENARIOS.editor = async () => {
  await comApp({ projetos: ['p1'], grupos: { p1: [{ tabs: ['@a.txt', '@b.txt', '@c.txt'], active: '@a.txt' }] } }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'três abas do editor restauradas');
    afirma(igual(await abasEditor(app), ['a.txt', 'b.txt', 'c.txt']) && (await ativaEditor(app)) === 'a.txt', 'partida: a, b, c com a ativa');
    // o persist() pendente da restauração das abas (debounce de 300 ms) disparava DEPOIS do arraste e gravava a ordem nova por acaso:
    // espera a gravação da restauração acabar, para que só o persist() da reordenação possa gravar a ordem nova
    await sleep(1200);
    afirma(igual(lerConfig(sb).devcode.workspaces.list[0].groups[0].tabs.map(base), ['a.txt', 'b.txt', 'c.txt']), 'antes do arraste o arquivo de config ainda tem a ordem a, b, c');
    const r = await arrasta(app, { sel: '.ws.active .dev-tab', n: 2 }, { sel: '.ws.active .dev-tab', n: 0 }, { lado: 'antes' });
    afirma(r.iniciou && r.dragstarts === 1, `o arraste da aba do editor começa (dragstart ${r.dragstarts})`);
    afirma(igual(await abasEditor(app), ['c.txt', 'a.txt', 'b.txt']), `c arrastada para antes de a: ${(await abasEditor(app)).join(', ')}`);
    afirma((await ativaEditor(app)) === 'a.txt', 'a aba ativa continua a.txt (guardada por caminho)');
    afirma((await restos(app)) === 0, 'nenhuma classe .dragging/.drop-* sobra');
    const gravado = await esperaConfig(sb, w => igual(w.list[0].groups[0]?.tabs.map(base), ['c.txt', 'a.txt', 'b.txt']), 3000); // logo após o arraste, sem outra ação no meio
    afirma(!!gravado && base(gravado.list[0].groups[0].active) === 'a.txt', `a ordem foi gravada em groups[].tabs (${gravado ? gravado.list[0].groups[0].tabs.map(base).join(', ') : 'não gravou'})`);

    // sem renomear: duplo clique no nome não abre input
    await duploClique(app, '.ws.active .dev-tab .dev-tab-name', 1);
    await sleep(300);
    afirma(!(await app.ev(`!!document.querySelector('.ws.active .dev-tab input')`)), '(9c) o duplo clique na aba do editor não abre input de renomear');

    // (9d) Ctrl+Tab percorre as abas na ordem nova (c, a, b), em círculo
    await ctrlTab(app);
    const n1 = await ativaEditor(app);
    await ctrlTab(app);
    const n2 = await ativaEditor(app);
    await ctrlTab(app, true);
    const n3 = await ativaEditor(app);
    afirma(n1 === 'b.txt' && n2 === 'c.txt' && n3 === 'b.txt', `(9d) Ctrl+Tab segue a ordem nova (c, a, b): vai a b e a c, depois Ctrl+Shift+Tab volta (${n1}, ${n2}, ${n3})`);

    // renderTabs no meio do arraste (clique programático na aba do meio refaz o innerHTML): ordem final certa
    await arrasta(app, { sel: '.ws.active .dev-tab', n: 2 }, { sel: '.ws.active .dev-tab', n: 0 }, {
      lado: 'antes',
      noMeio: () => app.ev(`document.querySelectorAll('.ws.active .dev-tab')[1].click()`),
    });
    afirma(igual(await abasEditor(app), ['b.txt', 'c.txt', 'a.txt']), `(3) com as abas redesenhadas no meio do arraste a ordem final está certa: ${(await abasEditor(app)).join(', ')}`);
    afirma((await restos(app)) === 0, '(3) nenhuma classe .dragging/.drop-* sobrou');

    // (9b) × e botão do meio fecham a aba certa depois do arraste
    await cliqueReal(app, '.ws.active .dev-tab', 1, { botao: 'middle' });
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 2`, 5000, 'fechou pelo botão do meio');
    afirma(igual(await abasEditor(app), ['b.txt', 'a.txt']), `(9b) o botão do meio fechou c.txt, a do meio: ${(await abasEditor(app)).join(', ')}`);
    await cliqueReal(app, '.ws.active .dev-tab .dev-tab-close', 0);
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 1`, 5000, 'fechou pelo ×');
    afirma(igual(await abasEditor(app), ['a.txt']), `(9b) o × fechou b.txt, a primeira: ${(await abasEditor(app)).join(', ')}`);
  });

  // a ordem volta depois de reabrir o app
  await comApp({ projetos: ['p1'], grupos: { p1: [{ tabs: ['@a.txt', '@b.txt', '@c.txt'], active: '@b.txt' }] } }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'três abas restauradas');
    await arrasta(app, { sel: '.ws.active .dev-tab', n: 0 }, { sel: '.ws.active .dev-tab', n: 2 }, { lado: 'depois' }); // a para depois de c: b, c, a
    afirma(igual(await abasEditor(app), ['b.txt', 'c.txt', 'a.txt']), `a para depois de c (lado "depois"): ${(await abasEditor(app)).join(', ')}`);
    await esperaConfig(sb, w => igual(w.list[0].groups[0]?.tabs.map(base), ['b.txt', 'c.txt', 'a.txt']));
    const app2 = await app.reiniciar();
    await app2.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'abas restauradas depois de reabrir');
    afirma(igual(await abasEditor(app2), ['b.txt', 'c.txt', 'a.txt']) && (await ativaEditor(app2)) === 'b.txt', `depois de reabrir: ordem ${(await abasEditor(app2)).join(', ')}, ativa ${await ativaEditor(app2)}`);
  });

  // dois grupos: a aba de um não é aceita no outro; soltar sobre o Monaco não insere texto
  await comApp({ projetos: ['p1'], grupos: { p1: [{ tabs: ['@a.txt', '@b.txt'], active: '@a.txt' }, { tabs: ['@c.txt', '@d.txt'], active: '@c.txt' }] } }, async app => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-group').length === 2 && document.querySelectorAll('.ws.active .dev-tab').length === 4`, 40000, 'dois grupos');
    afirma(igual(await abasEditor(app, 0), ['a.txt', 'b.txt']) && igual(await abasEditor(app, 1), ['c.txt', 'd.txt']), 'partida: grupo 1 (a, b) e grupo 2 (c, d)');
    await arrasta(app, { sel: '.ws.active .dev-tab', n: 0 }, { sel: '.ws.active .dev-tab', n: 2 }, { lado: 'antes' }); // a (grupo 1) sobre c (grupo 2)
    afirma(igual(await abasEditor(app, 0), ['a.txt', 'b.txt']) && igual(await abasEditor(app, 1), ['c.txt', 'd.txt']), 'a aba de um grupo soltada no outro é recusada: nada mudou');
    afirma((await restos(app)) === 0, 'e nenhuma classe sobrou');
    const antes = await linhasDoEditor(app, 0);
    const host = await caixa(app, '.ws.active .dev-group .dev-editor-host', 0);
    const r = await arrasta(app, { sel: '.ws.active .dev-tab', n: 1 }, null, { soltarEm: { x: Math.round(host.x + host.w / 2), y: Math.round(host.y + host.h / 2) } });
    await sleep(400);
    afirma(r.iniciou, 'a aba do editor foi arrastada e solta sobre o Monaco');
    afirma((await linhasDoEditor(app, 0)) === antes && !(await app.ev(`!!document.querySelector('.ws.active .dev-tab.dirty')`)), 'soltar a aba sobre o Monaco não insere o nome nem o caminho no arquivo (conteúdo igual, nenhuma aba suja)');
    afirma(igual(await abasEditor(app, 0), ['a.txt', 'b.txt']), 'e a ordem do grupo continua a mesma');
    await arrasta(app, { sel: '.ws.active .dev-tab', n: 3 }, { sel: '.ws.active .dev-tab', n: 2 }, { lado: 'antes' }); // d antes de c no grupo 2
    afirma(igual(await abasEditor(app, 1), ['d.txt', 'c.txt']) && igual(await abasEditor(app, 0), ['a.txt', 'b.txt']), `dentro do grupo 2 o arraste funciona: ${(await abasEditor(app, 1)).join(', ')}`);
  });
};

// T5: a página Terminal usa as mesmas funções (ws = terminalPage): o arraste vale lá e não mistura com os projetos
CENARIOS['pagina-terminal'] = async () => {
  await comApp({ projetos: ['p1'] }, async app => {
    await app.ev(`document.querySelector('[data-page="terminal"]').click()`);
    await app.espera(`document.querySelector('#page-terminal.active')`, 10000, 'página Terminal');
    await novoTerminal(app, '#term-page'); await novoTerminal(app, '#term-page'); await novoTerminal(app, '#term-page');
    const antes = await nomesTerminais(app, '#term-page');
    await marcaTerminais(app, '#term-page');
    const r = await arrasta(app, { sel: '#term-page .term-tab', n: 2 }, { sel: '#term-page .term-tab', n: 0 }, { lado: 'antes' });
    afirma(r.iniciou && r.dragstarts === 1, `o arraste começa na página Terminal (dragstart ${r.dragstarts})`);
    afirma(igual(await nomesTerminais(app, '#term-page'), [antes[2], antes[0], antes[1]]), `ordem das abas: ${(await nomesTerminais(app, '#term-page')).join(' | ')}`);
    afirma(igual(await ordemMarcas(app, '#term-page'), { abas: [2, 0, 1], panes: [2, 0, 1] }), 'a grade da página Terminal acompanha as abas');
    afirma((await restos(app)) === 0, 'nenhuma classe sobra');
    // nada gravado: terminais não são persistidos
    afirma(!JSON.stringify(lerConfig(app.sb)).includes(antes[0]), 'nenhum nome de terminal foi gravado no rendra-config.json (a ordem vale só na sessão)');
  });
};

const setaCS = (app, dir) => tecla(app, dir === 'esq' ? 'ArrowLeft' : 'ArrowRight', dir === 'esq' ? 'ArrowLeft' : 'ArrowRight', dir === 'esq' ? 37 : 39, 10); // Ctrl+Shift
const foca = (app, seletor, n) => app.ev(`document.querySelectorAll(${JSON.stringify(seletor)})[${n}].focus()`);
const ativoEh = (app, js) => app.ev(`(() => { const a = document.activeElement; return !!a && (${js}); })()`);
const anuncio = app => app.ev(`document.getElementById('anuncio-abas').textContent`);
const esperaAnuncio = async (app, re, ms = 3000) => { try { await app.espera(`${re}.test(document.getElementById('anuncio-abas').textContent)`, ms); return true; } catch { return false; } };

// T6: abas focáveis (role=tab, tabindex 0, aria-selected, aria-label), região viva única e Ctrl+Shift+Seta só com o foco numa aba
CENARIOS.teclado = async () => {
  await comApp({ projetos: ['p1', 'p2', 'p3'], ativo: 1, grupos: { p2: [{ tabs: ['@a.txt', '@b.txt', '@c.txt'], active: '@a.txt' }] } }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'abas do editor');
    await novoTerminal(app); await novoTerminal(app); await novoTerminal(app);
    for (const n of [0, 1, 2]) await dispensaPainel(app, n);
    await marcaTerminais(app);

    // ── estrutura acessível ──
    const est = await app.ev(`(() => {
      const tabs = s => [...document.querySelectorAll(s)];
      const regiao = document.getElementById('anuncio-abas');
      return {
        listas: ['#ws-tabs', '.ws.active .dev-term-tabs', '.ws.active .dev-tabs'].map(s => document.querySelector(s)?.getAttribute('role')),
        todasTab: ['#ws-tabs .ws-tab', '.ws.active .term-tab', '.ws.active .dev-tab'].map(s => tabs(s).length > 0 && tabs(s).every(e => e.getAttribute('role') === 'tab' && e.tabIndex === 0 && e.hasAttribute('aria-label') && e.hasAttribute('aria-selected'))),
        selProjetos: tabs('#ws-tabs .ws-tab[aria-selected="true"]').map(e => e.querySelector('.ws-tab-name').textContent),
        selEditor: tabs('.ws.active .dev-tab[aria-selected="true"]').map(e => e.querySelector('.dev-tab-name').textContent),
        rotulos: tabs('#ws-tabs .ws-tab').map(e => e.getAttribute('aria-label')),
        vivas: document.querySelectorAll('#anuncio-abas').length,
        regiaoFora: !regiao.closest('[role=tablist]') && regiao.getAttribute('aria-live') === 'polite',
        botoes: [...tabs('.ws.active .term-tab button'), ...tabs('#ws-tabs .ws-tab-close'), ...tabs('.ws.active .dev-tab-close')].every(b => !!b.getAttribute('aria-label')),
      };
    })()`);
    afirma(igual(est.listas, ['tablist', 'tablist', 'tablist']), 'as três barras são role=tablist');
    afirma(igual(est.todasTab, [true, true, true]), 'toda aba das três barras tem role=tab, tabindex 0, aria-label e aria-selected');
    afirma(igual(est.selProjetos, ['p2']) && igual(est.selEditor, ['a.txt']), `aria-selected: projeto ativo (${est.selProjetos}) e aba ativa do grupo (${est.selEditor})`);
    afirma(igual(est.rotulos, ['p1', 'p2', 'p3']), 'o aria-label de cada aba de projeto é o nome');
    afirma(est.vivas === 1 && est.regiaoFora, 'existe uma só região aria-live="polite", fora das tablist');
    afirma(est.botoes, 'os botões ✎ e ✕ dentro das abas têm aria-label em português');

    // ── Tab alcança as abas ──
    await foca(app, '#ws-tabs .ws-tab', 0);
    await tecla(app, 'Tab', 'Tab', 9);
    afirma(await ativoEh(app, `a.classList.contains('ws-tab') && a.querySelector('.ws-tab-name').textContent === 'p2'`), 'a tecla Tab leva o foco da primeira aba de projeto à segunda');
    await tecla(app, 'Tab', 'Tab', 9, 8);
    afirma(await ativoEh(app, `a.classList.contains('ws-tab') && a.querySelector('.ws-tab-name').textContent === 'p1'`), 'Shift+Tab volta');

    // ── projetos: Ctrl+Shift+Seta ──
    await foca(app, '#ws-tabs .ws-tab', 1); // p2
    await setaCS(app, 'dir');
    afirma(igual(await nomesProjetos(app), ['p1', 'p3', 'p2']), `Ctrl+Shift+Seta direita na aba do meio: ${await nomesDe(app)}`);
    afirma(await ativoEh(app, `a.classList.contains('ws-tab') && a.querySelector('.ws-tab-name').textContent === 'p2'`), 'o foco continua na aba movida (p2)');
    afirma(await esperaAnuncio(app, '/^p2 movida para a posição 3 de 3$/'), `a região viva anuncia: "${await anuncio(app)}"`);
    afirma((await ativoDosProjetos(app)) === 'p2', 'mover não troca o projeto ativo');
    await setaCS(app, 'dir');
    afirma(igual(await nomesProjetos(app), ['p1', 'p3', 'p2']), 'na ponta direita não faz nada');
    await setaCS(app, 'esq');
    await setaCS(app, 'esq');
    afirma(igual(await nomesProjetos(app), ['p2', 'p1', 'p3']), `duas vezes à esquerda: ${await nomesDe(app)}`);
    await setaCS(app, 'esq');
    afirma(igual(await nomesProjetos(app), ['p2', 'p1', 'p3']), 'na ponta esquerda não faz nada');
    const grav = await esperaConfig(sb, w => igual(w.list.map(x => x.name), ['p2', 'p1', 'p3']));
    afirma(!!grav && grav.active === 0, `a ordem pelo teclado foi gravada (${grav ? grav.list.map(x => x.name).join(', ') : 'não gravou'}, ativo ${grav?.active})`);

    // ── terminais ──
    await foca(app, '.ws.active .term-tab', 1);
    await setaCS(app, 'dir');
    afirma(igual(await ordemMarcas(app), { abas: [0, 2, 1], panes: [0, 2, 1] }), 'terminais: Ctrl+Shift+Seta direita na aba do meio troca a ordem das abas e da grade');
    afirma(await ativoEh(app, `a.classList.contains('term-tab') && a.dataset.e2e === '1'`), 'o foco fica na aba do terminal movido (não vai para o xterm)');
    afirma(await esperaAnuncio(app, '/movida para a posição 3 de 3$/'), `terminais: a região viva anuncia "${await anuncio(app)}"`);
    await setaCS(app, 'dir');
    afirma(igual(await ordemMarcas(app), { abas: [0, 2, 1], panes: [0, 2, 1] }), 'terminais: na ponta não faz nada');

    // ── abas do editor ──
    await foca(app, '.ws.active .dev-tab', 1);
    await setaCS(app, 'dir');
    afirma(igual(await abasEditor(app), ['a.txt', 'c.txt', 'b.txt']), `editor: Ctrl+Shift+Seta direita na aba do meio: ${(await abasEditor(app)).join(', ')}`);
    afirma(await ativoEh(app, `a.classList.contains('dev-tab') && a.querySelector('.dev-tab-name').textContent === 'b.txt'`), 'o foco continua na aba movida (b.txt)');
    afirma(await esperaAnuncio(app, '/^b\\.txt movida para a posição 3 de 3$/'), `editor: a região viva anuncia "${await anuncio(app)}"`);
    afirma((await ativaEditor(app)) === 'a.txt', 'a aba ativa do editor segue a mesma');
    const gravE = await esperaConfig(sb, w => igual(w.list.find(x => x.name === 'p2')?.groups[0]?.tabs.map(base), ['a.txt', 'c.txt', 'b.txt']));
    afirma(!!gravE, 'a ordem das abas do editor pelo teclado foi gravada');

    // ── o terminal e o Monaco continuam com o Ctrl+Shift+Seta ──
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 0);
    afirma(await focoNoPane(app, 0), 'foco no xterm do primeiro terminal');
    await app.send('Input.insertText', { text: '$k=[Console]::ReadKey($true); "KEY:$($k.Key):$($k.Modifiers)"' });
    await tecla(app, 'Enter', 'Enter', 13);
    await sleep(800);
    const abasAntes = await ordemMarcas(app);
    await setaCS(app, 'esq');
    await app.espera(`/KEY:LeftArrow:/.test(document.querySelector('.ws.active .term-pane').querySelector('.xterm-rows').textContent)`, 8000, 'o shell recebeu a tecla').catch(() => { });
    const saida = await app.ev(`document.querySelector('.ws.active .term-pane').querySelector('.xterm-rows').textContent.replace(/\\u00a0/g, ' ')`);
    afirma(/KEY:LeftArrow:.*Shift.*Control|KEY:LeftArrow:.*Control.*Shift/.test(saida), 'Ctrl+Shift+Seta esquerda com o foco no xterm chega ao shell (ReadKey leu LeftArrow com Shift e Control)');
    afirma(igual(await ordemMarcas(app), abasAntes) && igual(await nomesProjetos(app), ['p2', 'p1', 'p3']), 'e com o foco no xterm nenhuma aba se moveu');
    await app.ev(`document.querySelector('.ws.active .monaco-editor textarea').focus()`); // o foco do Monaco, como o usuário o deixa ao editar
    await app.espera(`!!document.activeElement.closest('.monaco-editor')`, 5000, 'foco no Monaco');
    await tecla(app, 'Home', 'Home', 36);
    const abasEd = await abasEditor(app);
    await setaCS(app, 'dir');
    await sleep(200);
    afirma((await app.ev(`document.querySelectorAll('.ws.active .dev-group .selected-text').length`)) > 0, 'no Monaco, Ctrl+Shift+Seta direita seleciona a palavra (o editor não perdeu a tecla)');
    afirma(igual(await abasEditor(app), abasEd), 'e as abas do editor não se moveram');

    // ── (9e) com o foco no input do renomear a tecla não move nada ──
    await duploClique(app, '#ws-tabs .ws-tab .ws-tab-name', 0);
    await app.espera(`!!document.querySelector('#ws-tabs input.ws-rename')`, 5000, 'input de renomear');
    await setaCS(app, 'dir');
    const valores = await app.ev("[...document.querySelectorAll('#ws-tabs .ws-tab')].map(t => t.querySelector('.ws-tab-name')?.textContent ?? t.querySelector('input').value)");
    afirma(igual(valores, ['p2', 'p1', 'p3']), `(9e) com o input do renomear em foco o atalho não move a aba (${valores.join(', ')})`);
    afirma(await app.ev("!!document.querySelector('#ws-tabs input.ws-rename')"), '(9e) o input do renomear continua aberto');
    // (R-e) o nome vem do usuário: nunca vira HTML no aria-label nem na região viva
    await app.send('Input.insertText', { text: '"><b>x</b>' });
    await tecla(app, 'Enter', 'Enter', 13);
    await app.espera(`!document.querySelector('#ws-tabs input.ws-rename')`, 5000, 'fim do renomear');
    await foca(app, '#ws-tabs .ws-tab', 0);
    await setaCS(app, 'dir');
    afirma(await esperaAnuncio(app, '/^"><b>x<\\/b> movida para a posição 2 de 3$/'), `(R-e) o nome com HTML aparece como texto na região viva: ${await anuncio(app)}`);
    afirma(!(await app.ev(`!!document.querySelector('#ws-tabs b, #anuncio-abas b')`)) && (await app.ev(`document.querySelectorAll('#ws-tabs .ws-tab')[1].getAttribute('aria-label')`)) === '"><b>x</b>', '(R-e) nenhum elemento <b> foi criado e o aria-label é o texto puro');
  });

  // a ordem de projetos feita pelo teclado volta depois de reabrir
  await comApp({ projetos: ['p1', 'p2', 'p3'], ativo: 0 }, async (app, sb) => {
    await foca(app, '#ws-tabs .ws-tab', 0);
    await setaCS(app, 'dir');
    await setaCS(app, 'dir');
    await esperaConfig(sb, w => igual(w.list.map(x => x.name), ['p2', 'p3', 'p1']));
    const app2 = await app.reiniciar();
    afirma(igual(await nomesProjetos(app2), ['p2', 'p3', 'p1']) && (await ativoDosProjetos(app2)) === 'p1', `teclado + reabrir: ${await nomesDe(app2)}, ativo ${await ativoDosProjetos(app2)}`);
  });
};

// Enter e Espaço ativam a aba focada nas três barras (como o clique); botão direito e do meio na aba do terminal focam o
// terminal (como na main); a aba do editor focada continua focada quando renderTabs refaz a barra (R-b)
CENARIOS.ativar = async () => {
  await comApp({ projetos: ['p1', 'p2', 'p3'], ativo: 1, grupos: { p2: [{ tabs: ['@a.txt', '@b.txt', '@c.txt'], active: '@a.txt' }] } }, async app => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'abas do editor');
    await novoTerminal(app); await novoTerminal(app);
    for (const n of [0, 1]) await dispensaPainel(app, n);
    const espaco = a => tecla(a, ' ', 'Space', 32);

    // editor
    await foca(app, '.ws.active .dev-tab', 1);
    await tecla(app, 'Enter', 'Enter', 13);
    afirma((await ativaEditor(app)) === 'b.txt', 'editor: Enter na aba focada (b.txt) a ativa');
    await foca(app, '.ws.active .dev-tab', 2);
    await espaco(app);
    afirma((await ativaEditor(app)) === 'c.txt', 'editor: Espaço na aba focada (c.txt) a ativa');

    // terminais (o foco vai ao terminal, como no clique)
    await foca(app, '.ws.active .term-tab', 1);
    await tecla(app, 'Enter', 'Enter', 13);
    afirma(await focoNoPane(app, 1), 'terminais: Enter na aba focada leva o foco ao terminal dela');
    await foca(app, '.ws.active .term-tab', 0);
    await espaco(app);
    afirma(await focoNoPane(app, 0), 'terminais: Espaço na aba focada leva o foco ao terminal dela');

    // botão do meio e botão direito na aba do terminal focam o terminal (comportamento da main)
    await foca(app, '.ws.active .dev-tab', 0);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 1, { botao: 'middle' });
    afirma(await focoNoPane(app, 1), 'terminais: o botão do meio na aba foca o terminal');
    await foca(app, '.ws.active .dev-tab', 0);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 0, { botao: 'right' });
    afirma(await focoNoPane(app, 0), 'terminais: o botão direito na aba foca o terminal');

    // (R-b) renderTabs com uma aba do editor focada devolve o foco à mesma aba
    await foca(app, '.ws.active .dev-tab', 1);
    await app.ev(`(() => { const m = monaco.editor.getModels().find(x => x.uri.path.endsWith('b.txt')); m.applyEdits([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' }]); return true; })()`);
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab')[1].classList.contains('dirty')`, 5000, 'aba b.txt suja (renderTabs rodou)');
    afirma(await ativoEh(app, `a.classList.contains('dev-tab') && a.querySelector('.dev-tab-name').textContent === 'b.txt'`), '(R-b) a edição refez a barra e o foco continuou na mesma aba do editor (b.txt)');

    // projetos (por último: ativar outro projeto troca o .ws ativo)
    await foca(app, '#ws-tabs .ws-tab', 2);
    await tecla(app, 'Enter', 'Enter', 13);
    afirma((await ativoDosProjetos(app)) === 'p3', 'projetos: Enter na aba focada (p3) a ativa');
    await foca(app, '#ws-tabs .ws-tab', 0);
    await espaco(app);
    afirma((await ativoDosProjetos(app)) === 'p1', 'projetos: Espaço na aba focada (p1) a ativa');
  });
};

// T7: o mesmo indicador de soltar nas três barras (linha laranja à esquerda ou à direita; aba ativa soma a linha de cima)
CENARIOS.indicador = async () => {
  await comApp({ projetos: ['p1', 'p2', 'p3'], ativo: 1, grupos: { p2: [{ tabs: ['@a.txt', '@b.txt', '@c.txt'], active: '@a.txt' }] } }, async app => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 3`, 40000, 'abas do editor');
    await novoTerminal(app); await novoTerminal(app); await novoTerminal(app);
    for (const n of [0, 1, 2]) await dispensaPainel(app, n);
    await cliqueReal(app, '.ws.active .term-tab .term-pane-name', 1); // terminal 2 em foco: tem a linha laranja de cima
    await app.espera(`document.querySelectorAll('.ws.active .term-tab')[1].classList.contains('focused')`, 5000, 'terminal 2 em foco');
    await cliqueReal(app, '.ws.active .dev-tab .dev-tab-name', 0); // a.txt ativa (o grupo fica em foco)
    await sleep(300);

    const LARANJA = 'rgb(232, 101, 10)';
    const lerAlvo = (seletor, n) => app.ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(seletor)})[${n}]; const cs = getComputedStyle(e); return { classes: e.className, sombra: cs.boxShadow }; })()`);
    const lerOrigem = (seletor, n) => app.ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(seletor)})[${n}]; return { classes: e.className, opacidade: getComputedStyle(e).opacity, cursor: getComputedStyle(e).cursor }; })()`);
    const caso = async (nome, seletor, de, para, lado, { ativaCima, preparo = null }) => {
      const r = await arrasta(app, { sel: seletor, n: de }, { sel: seletor, n: para }, { lado, soltar: false });
      afirma(r.iniciou, `${nome}: o arraste está no ar (dragover sobre a aba alvo)`);
      if (preparo) await preparo();
      const alvo = await lerAlvo(seletor, para);
      const classe = lado === 'antes' ? 'drop-before' : 'drop-after';
      afirma(alvo.classes.includes(classe), `${nome}: a aba alvo tem .${classe}`);
      const lateral = lado === 'antes' ? '2px 0px 0px 0px inset' : '-2px 0px 0px 0px inset';
      afirma(alvo.sombra.includes(LARANJA) && alvo.sombra.includes(lateral), `${nome}: sombra laranja do lado certo (${alvo.sombra})`);
      if (ativaCima) afirma(alvo.sombra.includes('0px 2px 0px 0px inset'), `${nome}: a aba que já tem a linha laranja de cima a mantém junto com a de soltar`);
      const origem = await lerOrigem(seletor, de);
      afirma(origem.classes.includes('dragging') && origem.opacidade === '0.4' && origem.cursor === 'grab', `${nome}: a aba arrastada fica a 40% (classe .dragging, opacidade ${origem.opacidade}, cursor ${origem.cursor})`);
      await app.foto(`indicador-${nome}`);
      await r.concluir();
      afirma((await restos(app)) === 0, `${nome}: depois de soltar nenhuma aba mantém .dragging/.drop-*`);
    };
    // projetos: alvo inativo (p1, "antes") e alvo ativo (p2, "depois"); a ordem volta a cada passo
    await caso('projetos-antes', '#ws-tabs .ws-tab', 2, 0, 'antes', { ativaCima: false });
    await caso('projetos-ativo', '#ws-tabs .ws-tab', 0, 2, 'depois', { ativaCima: true }); // o alvo é a aba ativa (p2, agora na posição 2)
    // terminais: o mousedown da aba de origem tira o foco do xterm, então o foco é devolvido ao terminal alvo no meio do arraste
    await caso('terminais', '.ws.active .term-tab', 2, 1, 'depois', {
      ativaCima: true,
      preparo: async () => { await app.ev("document.querySelectorAll('.ws.active .term-pane')[1].querySelector('.xterm-helper-textarea').focus()"); await sleep(200); },
    });
    // editor: alvo é a aba ativa do grupo em foco (a.txt)
    await caso('editor', '.ws.active .dev-tab', 2, 0, 'antes', { ativaCima: true });
  });
};

// ── Execução ────────────────────────────────────────────────────────────────
(async () => {
  const nomes = ESCOLHIDOS || Object.keys(CENARIOS);
  for (const nome of nomes) {
    if (!CENARIOS[nome]) { console.log(`cenário desconhecido: ${nome}`); falhas.push(`cenário desconhecido: ${nome}`); continue; }
    cenarioAtual = nome;
    console.log(`\n[${nome}]`);
    try { await CENARIOS[nome](); } catch (e) { afirma(false, `exceção: ${e.message}`); }
  }
  console.log(falhas.length ? `\n${falhas.length} falha(s):\n${falhas.map(f => ` - ${f}`).join('\n')}` : '\ntudo certo');
  process.exit(falhas.length ? 1 : 0);
})();

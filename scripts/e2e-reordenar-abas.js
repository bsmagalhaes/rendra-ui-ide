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
  await ev(`(() => { window.__dragstarts = 0; document.addEventListener('dragstart', () => { window.__dragstarts++; }, true); return true; })()`);
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
  if (noMeio) await noMeio();
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

// Prova de ponta a ponta da roda do mouse: 1 entalhe rola as "linhas por vez" do Windows no terminal (buffer normal, tela
// alternativa sem mouse, com mouse) e no editor Monaco. App real em sandbox, janela oculta (RENDRA_E2E_HIDDEN=1). Só Windows.
// Dois tipos de prova: (1) WM_MOUSEWHEEL real (delta 120) postado por PostMessage no HWND da janela deste teste (achado pelo
// processo Electron que o script iniciou, nunca pelo título, que é igual ao da IDE em uso; o cursor e a configuração do Windows
// não são tocados, WheelScrollLines só é lido); (2) WheelEvent sintético com deltaY escolhido (5 e 15 linhas), que não depende da
// máquina. A área de transferência é substituída por um contador na página. Fora do npm test.
// Uso: node scripts/e2e-rolagem-roda.js [--raiz=<pasta do app>] [--saida=<pasta>] [--medidas=<arquivo json>]. Sai com 1 se falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const RAIZ = path.resolve(arg('raiz') || path.join(__dirname, '..'));
const MEDIDAS = arg('medidas');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const medidas = {};

if (process.platform !== 'win32') { console.log('e2e da roda: só no Windows, nada a fazer aqui.'); process.exit(0); }

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-roda-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  const longo = path.join(projeto, 'longo.txt');
  fs.mkdirSync(projeto, { recursive: true });
  fs.writeFileSync(longo, Array.from({ length: 1000 }, (_, i) => `linha ${i + 1} palavra${String(i + 1).padStart(4, '0')}`).join('\n') + '\n');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: projeto, groups: [{ tabs: [longo], active: longo }] }], active: 0 } },
  }, null, 2));
  return { dir, home, data, projeto };
}

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

async function alvos(porta, tipo) {
  for (let i = 0; i < 80; i++) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => !tipo || x.type === tipo); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}

// "Linhas por vez" configuradas no Windows (só leitura): número, ou -1 (uma página por vez)
function linhasDoWindows() {
  try {
    const t = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WheelScrollLines'], { encoding: 'utf8' });
    const m = t.match(/WheelScrollLines\s+REG_SZ\s+(-?\d+)/);
    return m ? Number(m[1]) : 3;
  } catch { return 3; }
}

// WM_MOUSEWHEEL (0x020A) postado no HWND: wParam = delta<<16 | teclas, lParam = y<<16 | x (coordenadas da tela)
function postaRoda(hwnd, x, y, delta, vezes) {
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);';
$h = [System.IntPtr]::new(${hwnd}L); $x = ${Math.round(x)}; $y = ${Math.round(y)}; $d = ${delta};
$w = [System.IntPtr]::new((([int64]($d -band 0xFFFF)) -shl 16)); $l = [System.IntPtr]::new((([int64]($y -band 0xFFFF)) -shl 16) -bor ([int64]($x -band 0xFFFF)));
for ($i = 0; $i -lt ${vezes}; $i++) { [void][W.U]::PostMessage($h, 0x020A, $w, $l); Start-Sleep -Milliseconds 250 }`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
}

(async () => {
  const sb = sandbox();
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(__dirname, '..', 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const reais = n => [n, n + '.exe', n + '.cmd', n + '.bat'];
  const PATH = (process.env.Path || process.env.PATH || '').split(path.delimiter).filter(d => d && !['claude', 'codex'].some(n => reais(n).some(f => fs.existsSync(path.join(d, f))))).join(path.delimiter);
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env.Path = PATH;
  const proc = spawn(electron, [RAIZ, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: RAIZ, env, stdio: 'ignore' });
  console.log(`electron pid ${proc.pid} (raiz ${RAIZ})`);
  let pagina, main;
  try {
    const nWin = linhasDoWindows();
    console.log(`  WheelScrollLines do Windows (só leitura): ${nWin}`);
    medidas.linhasDoWindows = nWin;

    // main: HWND e geometria da janela deste teste (a única janela do processo que o script iniciou) e espião do pty:write
    const tMain = await alvos(portaMain);
    if (!tMain) throw new Error('inspector do main inacessível');
    main = cliente(tMain.webSocketDebuggerUrl); await main.pronto;
    const mev = e => main.ev(e, { includeCommandLineAPI: true });
    const REQ = `((process.mainModule && process.mainModule.require) || require)`;
    for (let i = 0; i < 60; i++) { const ok = await mev(`${REQ}('electron').BrowserWindow.getAllWindows().length > 0 && ${REQ}('electron').ipcMain.listeners('pty:write').length > 0`).catch(() => false); if (ok) break; await sleep(500); }
    const hwnd = await mev(`String(${REQ}('electron').BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0))`);
    afirma(/^\d+$/.test(hwnd) && hwnd !== '0', `HWND da janela do próprio teste obtido pelo processo (${hwnd})`);
    await mev(`(() => { const { ipcMain } = ${REQ}('electron'); globalThis.__escritas = []; const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write'); ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push(m && m.data); globalThis.__ptyId = m && m.id; for (const l of ls) l(e, m); }); return true; })()`);
    const escritas = async () => JSON.parse(await mev('JSON.stringify(globalThis.__escritas)')).filter(x => typeof x === 'string').join('');
    const zeraEscritas = () => mev('globalThis.__escritas.length = 0');
    // ponto da tela (pixels físicos) de um ponto do conteúdo da janela (DIP)
    const naTela = async (cx, cy) => JSON.parse(await mev(`(() => { const { BrowserWindow, screen } = ${REQ}('electron'); const w = BrowserWindow.getAllWindows()[0]; const b = w.getContentBounds(); return JSON.stringify(screen.dipToScreenPoint({ x: Math.round(b.x + ${cx}), y: Math.round(b.y + ${cy}) })); })()`));

    const tPag = await alvos(porta, 'page');
    if (!tPag) throw new Error('o app não abriu');
    pagina = cliente(tPag.webSocketDebuggerUrl); await pagina.pronto;
    const { send, ev } = pagina;
    await send('Page.enable');
    const espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { } await sleep(150); } throw new Error(`tempo esgotado: ${msg}`); };
    await espera(`!!document.querySelector('.ws.active')`, 30000, 'workspace ativo');
    await espera(`window.monaco && monaco.editor.getEditors().length > 0 && !!monaco.editor.getEditors()[0].getModel()`, 30000, 'editor com o arquivo longo');
    await ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
    await sleep(500);
    if (await ev(`!!document.querySelector('.dev-term-menu')`)) await ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
    await espera(`!![...document.querySelectorAll('.ws.active .xterm-rows > div')].some(d => /[>$]/.test(d.textContent))`, 30000, 'prompt do shell');
    await sleep(800);
    // a área de transferência real nunca é usada: copiar ao marcar vira um contador
    await ev(`window.__clip = 0; navigator.clipboard.writeText = async () => { window.__clip++; }; true`);

    const T = `.ws.active .term-pane-body`;
    const corpo = await ev(`(() => { const r = document.querySelector('${T} .xterm-screen').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
    await mouse('mousePressed', corpo.x + corpo.w / 2, corpo.y + corpo.h / 2, { button: 'left', clickCount: 1 });
    await mouse('mouseReleased', corpo.x + corpo.w / 2, corpo.y + corpo.h / 2, { button: 'left', clickCount: 1 });
    const enter = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); };
    const digita = async (t, ms = 900) => { await send('Input.insertText', { text: t }); await enter(); await sleep(ms); };
    // modos do terminal (tela alternativa, DECCKM, mouse): a saída é injetada no xterm pelo canal pty:data do main, porque o ConPTY
    // consome o DECCKM e não o repassa; assim o xterm recebe exatamente a sequência que um programa enviaria
    const modo = async seqs => {
      const data = seqs.map(s => `\x1b[${s}`).join('');
      await mev(`(() => { const { BrowserWindow } = ${REQ}('electron'); BrowserWindow.getAllWindows()[0].webContents.send('pty:data', { id: globalThis.__ptyId, data: ${JSON.stringify(data)} }); return true; })()`);
      await sleep(300);
    };

    // medidas no terminal: primeira linha visível "linha N" (o buffer tem "linha 1..1000")
    const primeira = () => ev(`(() => { for (const d of document.querySelectorAll('${T} .xterm-rows > div')) { const m = d.textContent.replace(/\\u00a0/g, ' ').match(/^linha (\\d+)$/); if (m) return Number(m[1]); } return null; })()`);
    // WheelEvent sintético: wheelDeltaY entra por defineProperty (é o campo legado que o Chromium fixa em 120 por entalhe)
    const sintetica = (sel, { dy, wy, ctrl = false, shift = false, alt = false, modoDelta = 0 }) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect(); const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, deltaY: ${dy}, deltaMode: ${modoDelta}, ctrlKey: ${ctrl}, shiftKey: ${shift}, altKey: ${alt} }); Object.defineProperty(e, 'wheelDeltaY', { value: ${wy} }); el.dispatchEvent(e); return e.defaultPrevented; })()`);
    const SCR = `${T} .xterm-screen`;
    const PX = 100 / 3;
    const TRACKPAD_ANTES = -3;
    const mede = async (fn) => { const a = await primeira(); await fn(); await sleep(450); const b = await primeira(); return a === null || b === null ? null : b - a; };

    // ── (a) terminal, buffer normal ─────────────────────────────────────────────────────────
    console.log('(a) terminal, buffer normal');
    await digita('1..1000 | % { "linha $_" }', 2500);
    await espera(`[...document.querySelectorAll('${T} .xterm-rows > div')].some(d => /PS .*>/.test(d.textContent))`, 20000, 'fim da saída');
    medidas.sintetico5 = await mede(() => sintetica(SCR, { dy: -5 * PX, wy: 120 }));
    afirma(medidas.sintetico5 === -5, `sintético de 5 linhas para cima rola 5 linhas (${medidas.sintetico5})`);
    medidas.sintetico15 = await mede(() => sintetica(SCR, { dy: -15 * PX, wy: 120 }));
    afirma(medidas.sintetico15 === -15, `sintético de 15 linhas para cima rola 15 linhas (${medidas.sintetico15})`);
    medidas.sintetico15baixo = await mede(() => sintetica(SCR, { dy: 15 * PX, wy: -120 }));
    afirma(medidas.sintetico15baixo === 15, `sintético de 15 linhas para baixo rola 15 linhas (${medidas.sintetico15baixo})`);
    medidas.altSintetico3 = await mede(() => sintetica(SCR, { dy: -3 * PX, wy: 120, alt: true }));
    afirma(medidas.altSintetico3 === -15, `Alt multiplica por 5 (3 linhas com Alt: ${medidas.altSintetico3})`);
    // regressões: o que não é entalhe de roda comum segue o comportamento do xterm (valores medidos no código anterior)
    medidas.ctrl = await mede(() => sintetica(SCR, { dy: -15 * PX, wy: 120, ctrl: true }));
    medidas.shift = await mede(() => sintetica(SCR, { dy: -15 * PX, wy: 120, shift: true }));
    // trackpad: 10 eventos pequenos (deltaY 10, wheelDeltaY 12): o xterm soma cerca de 50 px (3 linhas) e a conta nova não interfere
    medidas.trackpad = await mede(async () => { for (let k = 0; k < 10; k++) await sintetica(SCR, { dy: -10, wy: 12 }); });
    console.log(`  Ctrl ${medidas.ctrl}, Shift ${medidas.shift}, trackpad (deltaY 10) ${medidas.trackpad}`);
    afirma(medidas.ctrl === -3, `Ctrl+roda segue o xterm, como antes (-3 linhas; medido ${medidas.ctrl})`);
    afirma(medidas.shift === 0, `Shift+roda segue o xterm, como antes (0 linha; medido ${medidas.shift})`);
    afirma(medidas.trackpad === TRACKPAD_ANTES, `trackpad sintético (10 eventos de deltaY 10) segue o xterm, como antes (${TRACKPAD_ANTES} linhas; medido ${medidas.trackpad})`);
    // seleção continua marcada depois de rolar
    const y0 = corpo.y + corpo.h / 2;
    await mouse('mousePressed', corpo.x + 20, y0, { button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', corpo.x + 20 + k * 25, y0, { button: 'left', buttons: 1 }); await sleep(30); }
    await mouse('mouseReleased', corpo.x + 220, y0, { button: 'left', clickCount: 1 }); await sleep(300);
    const nSel = () => ev(`document.querySelectorAll('${T} .xterm-selection div').length`);
    const sel0 = await nSel();
    await sintetica(SCR, { dy: -5 * PX, wy: 120 }); await sleep(400);
    const sel1 = await nSel();
    afirma(sel0 > 0 && sel1 > 0, `a seleção marcada continua marcada depois de rolar (${sel0} antes, ${sel1} depois)`);
    await mouse('mousePressed', corpo.x + 5, corpo.y + 5, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', corpo.x + 5, corpo.y + 5, { button: 'left', clickCount: 1 });
    // roda real
    if (nWin >= 1) {
      const p = await naTela(corpo.x + corpo.w / 2, corpo.y + corpo.h / 2);
      medidas.real1 = await mede(() => postaRoda(hwnd, p.x, p.y, 120, 1));
      afirma(medidas.real1 === -nWin, `roda real: 1 entalhe rola ${nWin} linhas, as do Windows (${medidas.real1})`);
      medidas.real3 = await mede(() => postaRoda(hwnd, p.x, p.y, 120, 3));
      afirma(medidas.real3 === -3 * nWin, `roda real: 3 entalhes rolam ${3 * nWin} linhas (${medidas.real3})`);
    } else console.log('  roda real não comparada: o Windows está em "uma página por vez" (WheelScrollLines <= 0)');

    // ── (b) tela alternativa sem mouse ──────────────────────────────────────────────────────
    console.log('(b) tela alternativa sem mouse');
    await modo(['?1049h']);
    await zeraEscritas();
    await sintetica(SCR, { dy: -15 * PX, wy: 120 }); await sleep(300);
    let w = await escritas();
    medidas.setas15 = (w.match(/\x1b\[A/g) || []).length;
    afirma(medidas.setas15 === 15, `sintético de 15 linhas manda 15 setas ESC [ A (${medidas.setas15})`);
    await zeraEscritas();
    await sintetica(SCR, { dy: 5 * PX, wy: -120 }); await sleep(300);
    w = await escritas();
    afirma((w.match(/\x1b\[B/g) || []).length === 5, `sintético de 5 linhas para baixo manda 5 setas ESC [ B (${(w.match(/\x1b\[B/g) || []).length})`);
    await modo(['?1h']);
    await zeraEscritas();
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await sleep(300);
    w = await escritas();
    afirma(w === '\x1bOA', `o DECCKM está ligado no xterm (a seta do teclado manda ESC O A): ${JSON.stringify(w)}`);
    await zeraEscritas();
    await sintetica(SCR, { dy: -4 * PX, wy: 120 }); await sleep(300);
    w = await escritas();
    afirma((w.match(/\x1bOA/g) || []).length === 4 && !/\x1b\[A/.test(w), `com o modo de cursor de aplicação (DECCKM) são ESC O A, 4 vezes (${JSON.stringify(w)})`);
    await zeraEscritas();
    if (nWin >= 1) {
      await zeraEscritas();
      const p = await naTela(corpo.x + corpo.w / 2, corpo.y + corpo.h / 2);
      postaRoda(hwnd, p.x, p.y, 120, 1); await sleep(300);
      w = await escritas();
      medidas.setasReal = (w.match(/\x1bOA/g) || []).length;
      afirma(medidas.setasReal === nWin, `roda real: 1 entalhe manda ${nWin} setas (${medidas.setasReal})`);
    }
    await modo(['?1l', '?1049l']);

    // ── (c) com modo de mouse ───────────────────────────────────────────────────────────────
    console.log('(c) com modo de mouse (SGR)');
    const relatorios = t => (t.match(/\x1b\[<6[45];\d+;\d+M/g) || []).length;
    for (const [rotulo, pre] of [['tela alternativa', ['?1049h']], ['buffer normal', []]]) {
      await modo([...pre, '?1000h', '?1006h']);
      await zeraEscritas();
      await sintetica(SCR, { dy: -15 * PX, wy: 120 }); await sleep(400);
      let n = relatorios(await escritas());
      medidas[`mouse15 ${rotulo}`] = n;
      afirma(n === 15, `${rotulo}: sintético de 15 linhas manda 15 relatórios de roda, sem recursão (${n})`);
      await zeraEscritas();
      await sintetica(SCR, { dy: -PX, wy: 120 }); await sleep(400);
      n = relatorios(await escritas());
      afirma(n === 1, `${rotulo}: 1 linha por vez (deltaY 33) manda 1 relatório (${n})`);
      await zeraEscritas();
      await sintetica(SCR, { dy: 5 * PX, wy: -120 }); await sleep(400);
      n = (await escritas().then(t => (t.match(/\x1b\[<65;\d+;\d+M/g) || []).length));
      afirma(n === 5, `${rotulo}: 5 linhas para baixo mandam 5 relatórios de roda para baixo (${n})`);
      if (nWin >= 1) {
        await zeraEscritas();
        const p = await naTela(corpo.x + corpo.w / 2, corpo.y + corpo.h / 2);
        postaRoda(hwnd, p.x, p.y, 120, 1); await sleep(400);
        n = relatorios(await escritas());
        medidas[`mouseReal ${rotulo}`] = n;
        afirma(n === nWin, `${rotulo}: roda real, 1 entalhe manda ${nWin} relatórios (${n})`);
      }
      await modo(['?1000l', '?1006l', ...pre.map(s => s.replace('h', 'l'))]);
    }
    // x10 não informa a roda: segue como buffer normal (rola o histórico)
    await modo(['?9h']);
    medidas.x10 = await mede(() => sintetica(SCR, { dy: -5 * PX, wy: 120 }));
    afirma(medidas.x10 === -5, `modo X10 (sem roda) rola o histórico como o buffer normal (${medidas.x10})`);
    await modo(['?9l']);

    // ── (d) Monaco ──────────────────────────────────────────────────────────────────────────
    console.log('(d) editor Monaco');
    const ED = `.ws.active .dev-editor-host .view-lines`;
    const ed = `monaco.editor.getEditors()[0]`;
    const lh = await ev(`${ed}.getOption(monaco.editor.EditorOption.lineHeight)`);
    const topo = () => ev(`${ed}.getScrollTop()`);
    const medeEd = async fn => { const a = await topo(); await fn(); await sleep(350); return ((await topo()) - a) / lh; };
    await ev(`${ed}.setScrollTop(5000)`); await sleep(200);
    medidas.edSint5 = await medeEd(() => sintetica(ED, { dy: -5 * PX, wy: 120 }));
    afirma(medidas.edSint5 === -5, `sintético de 5 linhas rola 5 linhas no editor (${medidas.edSint5}, altura de linha ${lh}px)`);
    medidas.edSint15 = await medeEd(() => sintetica(ED, { dy: -15 * PX, wy: 120 }));
    afirma(medidas.edSint15 === -15, `sintético de 15 linhas rola 15 linhas no editor (${medidas.edSint15})`);
    medidas.edSint15baixo = await medeEd(() => sintetica(ED, { dy: 15 * PX, wy: -120 }));
    afirma(medidas.edSint15baixo === 15, `sintético de 15 linhas para baixo rola 15 linhas no editor (${medidas.edSint15baixo})`);
    medidas.edCtrl = await medeEd(() => sintetica(ED, { dy: -15 * PX, wy: 120, ctrl: true }));
    medidas.edShift = await medeEd(() => sintetica(ED, { dy: -15 * PX, wy: 120, shift: true }));
    medidas.edTrack = await medeEd(() => sintetica(ED, { dy: -10, wy: -12 }));
    console.log(`  (informativo) editor sem a conta nova: Ctrl ${medidas.edCtrl}, Shift ${medidas.edShift}, trackpad ${medidas.edTrack}`);
    const igual = (a, b) => Math.abs(a - b) < 0.01;
    afirma(igual(medidas.edCtrl, -2.7778) && medidas.edShift === 0 && igual(medidas.edTrack, 0.2778), `Ctrl, Shift e trackpad seguem o Monaco, como antes (-2,78; 0; 0,28 linha; medido ${medidas.edCtrl}, ${medidas.edShift}, ${medidas.edTrack})`);
    if (nWin >= 1) {
      const r = await ev(`(() => { const r = document.querySelector('.ws.active .dev-editor-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      const p = await naTela(r.x, r.y);
      medidas.edReal1 = await medeEd(() => postaRoda(hwnd, p.x, p.y, 120, 1));
      afirma(medidas.edReal1 === -nWin, `roda real: 1 entalhe rola ${nWin} linhas no editor (${medidas.edReal1})`);
    }
    // lista de sugestões aberta: a roda rola a lista, não o editor
    await ev(`(() => { const e = ${ed}; e.focus(); const n = e.getModel().getLineCount(); e.executeEdits('e2e', [{ range: new monaco.Range(n, 1, n, 1), text: 'pal' }]); e.setPosition({ lineNumber: n, column: 4 }); e.revealLine(n); e.trigger('e2e', 'editor.action.triggerSuggest', {}); return true; })()`);
    const listaAberta = await espera(`!!document.querySelector('.ws.active .suggest-widget.visible .monaco-list-row')`, 8000, 'lista de sugestões').then(() => true).catch(() => false);
    afirma(listaAberta, 'a lista de sugestões do Monaco abriu');
    if (listaAberta) {
      const top = () => ev(`document.querySelector('.ws.active .suggest-widget .monaco-list-rows').style.top`);
      const topLista0 = await top();
      const antes = await topo();
      await sintetica('.ws.active .suggest-widget .monaco-list-rows', { dy: 5 * PX, wy: -120 }); await sleep(400);
      const depois = await topo();
      afirma(depois === antes, `rolar sobre a lista de sugestões não rola o editor (${antes} -> ${depois})`);
      afirma(await top() !== topLista0, `rolar sobre a lista de sugestões rola a lista (top ${topLista0} -> ${await top()})`);
    }
    await ev(`${ed}.trigger('e2e', 'hideSuggestWidget', {}); true`);

    // foto do terminal e do editor para olhar
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const saida = path.resolve(arg('saida') || path.join(os.tmpdir(), 'rendra-e2e-roda'));
    fs.mkdirSync(saida, { recursive: true }); fs.writeFileSync(path.join(saida, 'rolagem-roda.png'), Buffer.from(data, 'base64'));
    console.log(`  foto: ${path.join(saida, 'rolagem-roda.png')}`);
  } catch (e) {
    falhas.push(`erro: ${e.message}`); console.log(`  ✗ erro: ${e.message}`);
  } finally {
    try { pagina?.ws.close(); main?.ws.close(); } catch { }
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { }
    await sleep(1200);
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { }
  }
  console.log(`MEDIDAS ${JSON.stringify(medidas)}`);
  if (MEDIDAS) fs.writeFileSync(MEDIDAS, JSON.stringify(medidas, null, 2));
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ${falhas.join('\n- ')}` : '\nTudo conferido.');
  process.exit(falhas.length ? 1 : 0);
})();

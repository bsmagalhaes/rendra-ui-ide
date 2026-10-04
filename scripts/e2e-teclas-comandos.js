// Prova de ponta a ponta das teclas do terminal e da página "Comandos": app real em sandbox, janela oculta
// (RENDRA_E2E_HIDDEN=1), home e dados em pasta temporária. A área de transferência é a do sistema, preparada
// e lida pelo main (--inspect) só durante a execução; a escrita no pty é espiada no main embrulhando o listener
// de `pty:write` (nada de produção muda). Tempo real: os timers de 1 s e 2 s do Ctrl+C são o objeto da prova.
// Fora do npm test: abre o Electron e leva minutos.
// Uso: node scripts/e2e-teclas-comandos.js [--saida=<pasta das capturas>] [--caso=T1,T2]. Sai com 1 se algo falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-teclas'));
const FILTRO = arg('caso') ? arg('caso').split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const puladas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const pula = (caso, motivo) => { console.log(`  - pulado: ${motivo}`); puladas.push(`${caso}: ${motivo}`); };
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const WIN = process.platform === 'win32';
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

// PNG sólido gerado sem dependências (para colocar uma imagem na área de transferência)
function pngBase64(w, h) {
  const zlib = require('zlib');
  const crc32 = buf => { let crc = 0xffffffff; for (const b of buf) { let c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const pedaco = (tipo, dados) => { const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo), dados]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = []; for (let y = 0; y < h; y++) { linhas.push(Buffer.from([0])); linhas.push(Buffer.alloc(w * 3, 0xe8)); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco('IHDR', ihdr), pedaco('IDAT', zlib.deflateSync(Buffer.concat(linhas))), pedaco('IEND', Buffer.alloc(0))]).toString('base64');
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-teclas-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  escreve(path.join(projeto, 'a.txt'), 'arquivo a\n');
  escreve(path.join(projeto, 'b.txt'), 'arquivo b\n');
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: projeto, groups: [] }], active: 0 } },
  }, null, 2));
  return { dir, home, data, projeto, limpa: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* em uso */ } } };
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

// ── App ─────────────────────────────────────────────────────────────────────
const REQ = `((process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null))`;
async function abrir(sb) {
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`  electron pid ${proc.pid}`);
  sb.proc = proc; // se abrir() falhar, o executor ainda encerra este processo (e só ele)
  const app = { proc, porta };
  const tMain = await alvo(portaMain);
  if (!tMain) throw new Error('inspector do main inacessível');
  app.main = cliente(tMain.webSocketDebuggerUrl); await app.main.pronto;
  const mev = (expr) => app.main.ev(expr, { includeCommandLineAPI: true });
  app.mev = mev;
  // o main só registra os canais quando termina de subir
  for (let i = 0; i < 100; i++) {
    const pronto = await mev(`(() => { const m = ${REQ}('electron').ipcMain; return m.listeners('pty:write').length > 0 && !!(m._invokeHandlers && m._invokeHandlers.get && m._invokeHandlers.get('dev:open-folder')); })()`).catch(() => false);
    if (pronto) break;
    await sleep(300);
  }
  // Isolamento do dono: a área de transferência real é guardada agora e devolvida em fechar(); e o terminal WSL nunca lê
  // o ~/.bashrc do dono (que abre sessões tmux): o spawn do wsl.exe ganha `-e bash --noprofile --norc -i`.
  await mev(`(async () => {
    const { clipboard } = ${REQ}('electron');
    globalThis.__areaOriginal = [];
    for (const item of await clipboard.read()) { const tipos = {}; for (const t of item.types) tipos[t] = Buffer.from(await (await item.getType(t)).arrayBuffer()); globalThis.__areaOriginal.push(tipos); }
    const pty = ${REQ}(${JSON.stringify(path.join(ROOT, 'node_modules', '@lydell', 'node-pty'))}); const spawnOriginal = pty.spawn;
    pty.spawn = (file, args, opts) => spawnOriginal.call(pty, file, /wsl(\\.exe)?$/i.test(String(file)) ? [...args, '-e', 'bash', '--noprofile', '--norc', '-i'] : args, opts);
    return true;
  })()`);
  app.restauraArea = () => mev(`(async () => {
    const { clipboard, ClipboardItem } = ${REQ}('electron'); const o = globalThis.__areaOriginal; if (!o) return false;
    clipboard.clear();
    if (o.length) await clipboard.write(o.map(tipos => new ClipboardItem(Object.fromEntries(Object.entries(tipos).map(([t, buf]) => [t, new Blob([buf], { type: t })])))));
    return true;
  })()`);
  // espia pty:write (bytes entregues ao programa) e dev:open-folder (sem diálogo real: devolve cancelado)
  const r = await mev(`(() => {
    const { ipcMain } = ${REQ}('electron');
    globalThis.__escritas = []; globalThis.__abrirPasta = 0;
    const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write');
    ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push({ t: Date.now(), data: m && m.data }); for (const l of ls) l(e, m); });
    const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get && ipcMain._invokeHandlers.get('dev:open-folder');
    if (h) ipcMain._invokeHandlers.set('dev:open-folder', async () => { globalThis.__abrirPasta++; return null; });
    return JSON.stringify({ ls: ls.length, abrirPasta: !!h });
  })()`);
  app.espiao = JSON.parse(r);
  const tPag = await alvo(porta, 'page');
  if (!tPag) throw new Error('o app não abriu');
  app.pag = cliente(tPag.webSocketDebuggerUrl); await app.pag.pronto;
  const { send, ev } = app.pag;
  app.send = send; app.ev = ev;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  // janela oculta: sem isso o navigator.clipboard.readText rejeita com "Document is not focused"
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  app.espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { /* carregando */ } await sleep(120); } throw new Error(`tempo esgotado: ${msg}`); };
  // bytes entregues ao pty; as respostas automáticas do xterm (DA, foco, cores) começam com ESC e não contam como digitação
  app.escritas = async () => JSON.parse(await mev('JSON.stringify(globalThis.__escritas)')).filter(x => typeof x.data === 'string');
  app.zeraEscritas = () => mev('globalThis.__escritas.length = 0');
  app.abrirPasta = () => mev('globalThis.__abrirPasta');
  app.areaTexto = t => mev(`${REQ}('electron').clipboard.writeText(${JSON.stringify(t)})`);
  // só imagem (PNG gerado aqui, 8x8) na área de transferência do sistema, pela API do Electron 44
  app.areaImagem = () => mev(`(async () => { const { clipboard, ClipboardItem } = ${REQ}('electron'); clipboard.clear(); await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from('${pngBase64(8, 8)}', 'base64')], { type: 'image/png' }) })]); return true; })()`);
  // texto e imagem juntos na área de transferência (como ao copiar de um editor ou de uma página)
  app.areaTextoEImagem = t => mev(`(async () => { const { clipboard, ClipboardItem } = ${REQ}('electron'); clipboard.clear(); await clipboard.write([new ClipboardItem({ 'text/plain': ${JSON.stringify(t)}, 'image/png': new Blob([Buffer.from('${pngBase64(8, 8)}', 'base64')], { type: 'image/png' }) })]); return true; })()`);
  app.lerArea = () => mev(`${REQ}('electron').clipboard.readText()`);
  app.fechar = async () => {
    try { await app.restauraArea(); } catch { /* o main já caiu */ }
    try { app.pag.ws.close(); app.main.ws.close(); } catch { /* fechado */ }
    try { if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch { /* já encerrou */ }
    await sleep(1500);
  };
  await app.espera(`!!document.querySelector('.ws.active') && !!window.RendraComandos`, 40000, 'workspace ativo e página Comandos carregada');
  return app;
}

// ── Passos reutilizáveis ────────────────────────────────────────────────────
const ULTIMO = `[...document.querySelectorAll('.ws.active .term-pane')].at(-1)`;
const PROMPT = alvoEl => `((${alvoEl}) ? [...(${alvoEl}).querySelectorAll('.xterm-rows > div')] : []).some(d => /[>$#]\\s*$/.test(d.textContent.replace(/\\u00a0/g, ' ').trimEnd()))`;
// texto do terminal; `junto` une as linhas (uma linha longa do prompt quebra no meio da palavra)
const textoTerm = (app, alvoEl = ULTIMO) => app.ev(`[...(${alvoEl}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);

// manterPainel: deixa aberto o painel de conversas (aparece quando há Claude Code ou Codex instalados); por padrão
// escolhe "Só o terminal", como o usuário faria, para o terminal receber teclas
async function novoTerminal(app, { manterPainel = false, shell = null } = {}) {
  if (shell) {
    const v = await app.ev(`(() => { const s = document.querySelector('.ws.active .dev-shell-select'); if (![...s.options].some(o => o.value === '${shell}')) return null; s.value = '${shell}'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
    if (v !== shell) throw new Error(`shell ${shell} indisponível (opções: ${await app.ev(`[...document.querySelector('.ws.active .dev-shell-select').options].map(o => o.value).join(',')`)})`);
  }
  const antes = await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`);
  await app.ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
  await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === ${antes + 1}`, 20000, 'terminal aberto');
  await app.espera(PROMPT(ULTIMO), 30000, 'prompt do shell');
  const painel = await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 6000).catch(() => false);
  if (painel && !manterPainel) { await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`); await sleep(300); }
  await sleep(600);
  return ULTIMO;
}
async function foco(app, alvoEl = ULTIMO) {
  const r = await app.ev(`(() => { const r = (${alvoEl}).querySelector('.term-pane-body').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  for (const type of ['mousePressed', 'mouseReleased']) await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(200);
  await app.ev(`(${alvoEl}).querySelector('.xterm-helper-textarea').focus()`); // garante o foco do xterm
  await sleep(100);
  return r;
}
// tecla com modificadores: { key, code, vk, mods: ['ctrl', 'shift'] }
async function tecla(app, { key, code, vk, mods = [], text }, { repete = false, soBaixo = false } = {}) {
  const modifiers = mods.reduce((a, m) => a | MOD[m], 0);
  await app.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text, autoRepeat: repete });
  if (!soBaixo) await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
}
const CTRL_V = { key: 'v', code: 'KeyV', vk: 86, mods: ['ctrl'] };
const CTRL_C = { key: 'c', code: 'KeyC', vk: 67, mods: ['ctrl'] };
const digita = async (app, t) => { await app.send('Input.insertText', { text: t }); };
const enter = async app => { for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined }); };
const fotografa = async (app, nome) => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const { data } = await app.send('Page.captureScreenshot', { format: 'png' });
  const arq = path.join(SAIDA, `${nome}.png`);
  fs.writeFileSync(arq, Buffer.from(data, 'base64'));
  console.log(`  captura: ${arq}`);
};

// ── Casos (cada tarefa acrescenta o seu) ────────────────────────────────────
const casos = [];
const caso = (nome, fn) => casos.push({ nome, fn });

caso('T1', async app => {
  console.log('\n[T1] Ctrl+V cola o texto da área de transferência real (antes falhava: availableFormats inexistente)');
  await novoTerminal(app);
  await foco(app);
  const marca = `colado-t1-${Date.now() % 100000}`;
  await app.areaTexto(`echo ${marca}`);
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\u00a0/g, ' ')).join('').includes('echo ${marca}')`, 8000, 'texto colado no prompt').catch(() => { });
  afirma((await textoTerm(app)).split('\n').join('').includes(`echo ${marca}`), `Ctrl+V colou "${marca}" no prompt do terminal`);
  const esc = await app.escritas();
  afirma(esc.some(x => x.data.includes(`echo ${marca}`)), 'o texto colado chegou ao pty');
  afirma(!esc.some(x => x.data === '\x16'), 'com texto na área de transferência, nenhum \\x16 é enviado');
  // só imagem na área de transferência: o canal clip:has-image (corrigido) detecta e o \x16 vai ao programa
  await app.areaImagem();
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await sleep(600);
  const esc2 = await app.escritas();
  afirma(esc2.some(x => x.data === '\x16'), 'só imagem na área de transferência: o Ctrl+V entrega \\x16 ao programa');
});

const LOOP = 'for($i=0;$i -lt 900;$i++){ Write-Output "tick$i"; Start-Sleep -Milliseconds 200 }';
const ultimoTick = async app => { const m = [...(await textoTerm(app)).matchAll(/tick(\d+)/g)].map(x => +x[1]); return m.length ? Math.max(...m) : -1; };
const avisoVisivel = app => app.ev(`(() => { const a = (${ULTIMO}).querySelector('.term-aviso'); return a && a.classList.contains('visible') ? a.textContent : null; })()`);
const bytes03 = async app => (await app.escritas()).filter(x => x.data.includes('\x03')).length;

caso('T4', async app => {
  console.log('\n[T4] Ctrl+C: 1 toque cola depois de 1 s, 2 avisam, 3 interrompem (tempo real, PowerShell com laço em andamento)');
  await novoTerminal(app);
  await foco(app);
  const marca = `colado-ctrlc-${Date.now() % 100000}`;
  await app.areaTexto(marca);
  await digita(app, LOOP); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => /tick3/.test(d.textContent))`, 15000, 'laço rodando');

  // 1 toque: nenhum \x03; antes de 1 s nada é colado; depois de 1 s o texto da área de transferência chega ao pty
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(500);
  let esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03')), '1 toque: nenhum \\x03 chega ao programa');
  afirma(!esc.some(x => x.data.includes(marca)), '1 toque, aos 500 ms: ainda não colou');
  await sleep(900);
  esc = await app.escritas();
  afirma(esc.some(x => x.data.includes(marca)), '1 toque, depois de 1 s: colou o texto da área de transferência');
  afirma(!esc.some(x => x.data.includes('\x03')), '1 toque: continua sem \\x03 depois da colagem');
  const t1 = await ultimoTick(app);
  await sleep(700);
  afirma(await ultimoTick(app) > t1, 'o programa seguiu rodando depois de 1 toque');

  // 2 toques: aviso na tela, sem colar, sem \x03; o aviso some em até 2 s; o programa segue
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(300);
  await tecla(app, CTRL_C);
  await sleep(150);
  const av = await avisoVisivel(app);
  afirma(av === 'aperte mais 1 vez para interromper', `2 toques: aviso "aperte mais 1 vez para interromper" no terminal (${JSON.stringify(av)})`);
  await fotografa(app, 'aviso-ctrl-c');
  await sleep(1200); // 1,65 s desde o primeiro toque: já passou de 1 s e o aviso continua, sem colar
  afirma(await avisoVisivel(app) !== null, 'o aviso continua visível aos 1,65 s');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes(marca)), '2 toques: a colagem foi cancelada (nada colado)');
  await sleep(900); // 2,55 s
  afirma(await avisoVisivel(app) === null, 'sem o 3º toque o aviso some em até 2 s');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03') || x.data.includes(marca)), '2 toques e silêncio: nada foi enviado ao programa');
  const t2 = await ultimoTick(app);
  await sleep(700);
  afirma(await ultimoTick(app) > t2, 'o programa segue rodando depois dos 2 toques');

  // 3 toques em menos de 2 s: um só \x03, o laço para, o prompt volta, o aviso some
  await app.zeraEscritas();
  await tecla(app, CTRL_C); await sleep(250);
  await tecla(app, CTRL_C); await sleep(250);
  await tecla(app, CTRL_C);
  await sleep(1200);
  afirma(await bytes03(app) === 1, `3 toques: exatamente um \\x03 chega ao programa (${await bytes03(app)})`);
  afirma(await avisoVisivel(app) === null, '3 toques: o aviso some');
  const t3 = await ultimoTick(app);
  await sleep(900);
  afirma(await ultimoTick(app) === t3, 'o laço parou de rodar (interrompido)');
  const txt = await textoTerm(app);
  afirma(txt.lastIndexOf('PS ') > txt.lastIndexOf(`tick${t3}`), 'o prompt do PowerShell voltou depois do último tick');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes(marca)), '3 toques: nada foi colado');

  // segurar a tecla (autoRepeat) não conta como três toques
  await digita(app, LOOP); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => /tick2/.test(d.textContent))`, 15000, 'laço rodando de novo');
  await app.zeraEscritas();
  await tecla(app, CTRL_C, { soBaixo: true });
  for (let k = 0; k < 6; k++) { await tecla(app, CTRL_C, { repete: true, soBaixo: true }); await sleep(60); }
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
  await sleep(300);
  afirma(await bytes03(app) === 0, 'tecla segurada (repeat) não envia \\x03 nem conta como três toques');
  await sleep(2300);
  // interrompe o laço para deixar o terminal limpo
  await tecla(app, CTRL_C); await sleep(200); await tecla(app, CTRL_C); await sleep(200); await tecla(app, CTRL_C); await sleep(800);
});

caso('T4m', async app => {
  console.log('\n[T4m] Ctrl+C de 1 toque: com o overlay "Abrir link?" (ou outro modal) aberto na hora de colar, nada é colado');
  await novoTerminal(app);
  await foco(app);
  const marca = `colado-modal-${Date.now() % 100000}`;
  await app.areaTexto(marca);
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(300);
  await app.ev(`document.getElementById('save-overlay').classList.add('visible'); true`); // o modal abre dentro do segundo de espera
  await sleep(1300);
  let esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes(marca)), 'modal aberto: a colagem agendada não foi feita');
  afirma(!esc.some(x => x.data.includes('\x03')), 'modal aberto: nenhum \x03 chega ao programa');
  await app.ev(`document.getElementById('save-overlay').classList.remove('visible'); true`);
  await foco(app);
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(1400);
  esc = await app.escritas();
  afirma(esc.some(x => x.data.includes(marca)), 'sem o modal, o mesmo toque cola como sempre');
});

caso('T4p', async app => {
  console.log('\n[T4p] painel de conversas aberto: nenhuma escrita direta nova (Ctrl+C, colar, Alt+V) e o clique na aba não devolve o foco ao xterm');
  await novoTerminal(app, { manterPainel: true });
  const tem = await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 6000).catch(() => false);
  if (!tem) { pula('T4p', 'o painel de conversas não abriu (nenhum Claude Code ou Codex instalado nesta máquina)'); return; }
  const marca = `painel-${Date.now() % 100000}`;
  await app.areaTexto(marca);
  // clique na aba: o foco fica no painel
  const aba = await app.ev(`(() => { const r = (${ULTIMO.replace('.term-pane', '.term-pane')}) && document.querySelector('.ws.active .term-tab:last-of-type .term-pane-name').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await app.send('Input.dispatchMouseEvent', { type, x: aba.x, y: aba.y, button: 'left', clickCount: 1 });
  await sleep(300);
  const foc = await app.ev(`(() => { const a = document.activeElement; return { xterm: !!a.closest('.xterm'), painel: !!a.closest('.term-agentes') }; })()`);
  afirma(!foc.xterm && foc.painel, `clicar na aba com o painel aberto leva o foco ao painel, não ao xterm (${JSON.stringify(foc)})`);
  // mesmo forçando o foco no xterm, as teclas novas não escrevem no pty
  await app.ev(`(${ULTIMO}).querySelector('.xterm-helper-textarea').focus()`);
  await app.zeraEscritas();
  for (let k = 0; k < 3; k++) { await tecla(app, CTRL_C); await sleep(200); }
  await tecla(app, CTRL_V);
  await tecla(app, { key: 'v', code: 'KeyV', vk: 86, mods: ['alt'] });
  await sleep(1400);
  const esc = await app.escritas();
  const proibidos = esc.filter(x => x.data.includes('\x03') || x.data.includes('\x16') || x.data.includes('\x1bv') || x.data.includes(marca));
  afirma(proibidos.length === 0, `com o painel aberto: nenhum \\x03, \\x16, ESC v nem colagem chega ao pty (${JSON.stringify(proibidos)})`);
  await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);
  await sleep(300);
});

// posição (em px) de uma coluna de uma linha do terminal cuja linha inteira (sem espaços nas pontas) é `texto`
async function pontoNaLinha(app, texto) {
  return app.ev(`(() => {
    const nb = s => s.replace(/\\u00a0/g, ' ');
    const rows = [...(${ULTIMO}).querySelectorAll('.xterm-rows > div')];
    const row = rows.filter(r => nb(r.textContent).trim() === ${JSON.stringify(texto)}).at(-1);
    if (!row) return null;
    const sp = [...row.children].find(s => nb(s.textContent).includes(${JSON.stringify(texto)}));
    const r = sp.getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, cel: r.width / sp.textContent.length, dentro: nb(sp.textContent).indexOf(${JSON.stringify(texto)}) };
  })()`);
}
const mouse = (app, type, x, y, extra = {}) => app.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
// arrasta do meio da coluna `c0` até o meio da coluna `c1` (colunas dentro do texto), devagar, como a mão
async function arrasta(app, p, c0, c1) {
  const x = c => p.x + p.cel * (p.dentro + c);
  await mouse(app, 'mouseMoved', x(c0) + p.cel * 0.25, p.y);
  await mouse(app, 'mousePressed', x(c0) + p.cel * 0.25, p.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await mouse(app, 'mouseMoved', x(c0) + p.cel * 0.25 + (x(c1) - x(c0)) * k / 8, p.y, { button: 'left', buttons: 1 }); await sleep(30); }
  await mouse(app, 'mouseReleased', x(c1) + p.cel * 0.25, p.y, { button: 'left', buttons: 0, clickCount: 1 });
}
const toastAtual = app => app.ev(`(() => { const t = document.getElementById('toast'); return { texto: t.textContent, visivel: t.classList.contains('visible') }; })()`);
const realce = app => app.ev(`[...(${ULTIMO}).querySelectorAll('.xterm-selection div')].length`);

caso('T5', async app => {
  console.log('\n[T5] copiar ao marcar: marcar com o mouse copia, o realce fica e aparece "Copiado"; Ctrl+C com texto marcado só confirma');
  await novoTerminal(app);
  await foco(app);
  const LINHA = 'alfa-beta-gama-delta';
  await digita(app, `Write-Output "${LINHA}"`); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => d.textContent.replace(/\\u00a0/g, ' ').trim() === ${JSON.stringify(LINHA)})`, 10000, 'saída do comando');
  await sleep(500);
  const p = await pontoNaLinha(app, LINHA);
  afirma(!!p, 'achou a linha de saída no terminal');
  await app.areaTexto('antes-de-marcar');
  await app.ev(`window.__escritasClip = 0; (() => { const o = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = t => { window.__escritasClip++; return o(t); }; })(); true`);
  await app.ev(`document.getElementById('toast').classList.remove('visible')`);
  await app.zeraEscritas();
  await arrasta(app, p, 5, 14);
  await sleep(900);
  const copiado = await app.lerArea();
  afirma(copiado === 'beta-gama', `marcar "beta-gama" com o mouse copiou para a área de transferência (veio ${JSON.stringify(copiado)})`);
  afirma(await app.ev('window.__escritasClip') === 1, `um arraste copia uma vez só (${await app.ev('window.__escritasClip')} cópias)`);
  afirma(await realce(app) > 0, `o realce da seleção continua na tela (${await realce(app)} blocos)`);
  const to = await toastAtual(app);
  afirma(to.texto === 'Copiado' && to.visivel, `aviso discreto "Copiado" visível (${JSON.stringify(to)})`);
  await fotografa(app, 'copiado-ao-marcar');
  afirma(!(await app.escritas()).some(x => x.data.includes('beta-gama')), 'copiar não escreve nada no programa');

  // Ctrl+C com texto marcado: copia de novo, mostra "Copiado", não cola, não conta toque, não envia \x03
  await app.areaTexto('outro-texto-da-area');
  await app.ev(`document.getElementById('toast').classList.remove('visible')`);
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(300);
  afirma(await app.lerArea() === 'beta-gama', 'Ctrl+C com texto marcado devolve a seleção à área de transferência');
  const to2 = await toastAtual(app);
  afirma(to2.texto === 'Copiado' && to2.visivel, `Ctrl+C com texto marcado mostra "Copiado" (${JSON.stringify(to2)})`);
  await sleep(1400);
  const esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03') || x.data.includes('beta-gama') || x.data.includes('outro-texto')), `Ctrl+C com texto marcado não envia \\x03 nem cola, nem 1 s depois (${JSON.stringify(esc.map(x => x.data))})`);
  afirma(await realce(app) > 0, 'o realce segue depois do Ctrl+C');
  afirma(await avisoVisivel(app) === null, 'Ctrl+C com texto marcado não conta toque: nada de aviso de interromper');

  // limpar a seleção e marcar o mesmo texto de novo copia de novo
  await mouse(app, 'mousePressed', p.x + p.cel * 40, p.y - 60, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse(app, 'mouseReleased', p.x + p.cel * 40, p.y - 60, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  await app.areaTexto('limpou');
  await arrasta(app, p, 5, 14);
  await sleep(900);
  afirma(await app.lerArea() === 'beta-gama', 'depois de limpar, marcar o mesmo texto copia de novo');
});

const cliqueDireito = async (app, x, y) => {
  await mouse(app, 'mouseMoved', x, y);
  await mouse(app, 'mousePressed', x, y, { button: 'right', buttons: 2, clickCount: 1 });
  await mouse(app, 'mouseReleased', x, y, { button: 'right', buttons: 0, clickCount: 1 });
};
const centroDoTerminal = app => app.ev(`(() => { const r = (${ULTIMO}).querySelector('.term-pane-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const dadosEscritos = async app => (await app.escritas()).map(x => x.data).join('');

caso('T6', async app => {
  console.log('\n[T6] Ctrl+V e clique direito colam na hora (Git Bash, com bracketed paste); texto vence imagem; só imagem entrega \\x16');
  try { await novoTerminal(app, { shell: 'gitbash' }); } catch (e) { pula('T6', `Git Bash indisponível (${e.message})`); return; }
  await foco(app);
  // 1) Ctrl+V com duas linhas: bracketed paste, a primeira linha não executa antes da hora
  await app.areaTexto('linha-um\nlinha-dois');
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await sleep(900);
  let d = await dadosEscritos(app);
  afirma(d.includes('\x1b[200~linha-um\rlinha-dois\x1b[201~'), `Ctrl+V entrega o texto de duas linhas dentro do bracketed paste (${JSON.stringify(d.slice(0, 80))})`);
  let txt = (await textoTerm(app)).split('\n').join('');
  afirma(/linha-um/.test(txt) && /linha-dois/.test(txt), 'as duas linhas aparecem no prompt');
  afirma(!/command not found|comando/.test(txt), 'a primeira linha não foi executada antes da hora');
  // 2) Ctrl+Shift+V também cola
  await app.areaTexto('csv-ok');
  await app.zeraEscritas();
  await tecla(app, { key: 'V', code: 'KeyV', vk: 86, mods: ['ctrl', 'shift'] });
  await sleep(500);
  afirma((await dadosEscritos(app)).includes('csv-ok'), 'Ctrl+Shift+V cola o texto');
  // 3) texto e imagem juntos: o texto vence, nenhum \x16
  await app.areaTextoEImagem('texto-com-imagem');
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await sleep(600);
  d = await dadosEscritos(app);
  afirma(d.includes('texto-com-imagem') && !d.includes('\x16'), `texto e imagem na área de transferência: cola o texto e não manda \\x16 (${JSON.stringify(d.slice(0, 60))})`);
  // 4) só imagem: \x16 ao programa
  await app.areaImagem();
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await sleep(600);
  afirma((await dadosEscritos(app)).includes('\x16'), 'só imagem: o Ctrl+V entrega \\x16 ao programa');

  // 5) clique direito: terminal novo, texto marcado com o mouse, área de transferência trocada, clique direito cola
  await novoTerminal(app, { shell: 'gitbash' });
  await foco(app);
  const LINHA = 'alfa-beta-gama-delta';
  await digita(app, `echo ${LINHA}`); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => d.textContent.replace(/\\u00a0/g, ' ').trim() === ${JSON.stringify(LINHA)})`, 10000, 'saída do echo');
  await sleep(400);
  const p = await pontoNaLinha(app, LINHA);
  await arrasta(app, p, 5, 14);
  await sleep(700);
  afirma(await app.lerArea() === 'beta-gama', 'o texto marcado foi copiado ao marcar');
  await app.areaTexto('colado-direito');
  await app.zeraEscritas();
  const c = await centroDoTerminal(app);
  await cliqueDireito(app, c.x, c.y + 120);
  await sleep(700);
  afirma((await dadosEscritos(app)).includes('colado-direito'), 'clique direito cola o texto da área de transferência na hora, mesmo com texto marcado');
  afirma(await app.lerArea() === 'colado-direito', 'o clique direito não copiou a seleção por cima da área de transferência');
  // clique direito com duas linhas: bracketed paste, nada executa
  await app.areaTexto('rc-um\nrc-dois');
  await app.zeraEscritas();
  await cliqueDireito(app, c.x, c.y + 120);
  await sleep(700);
  d = await dadosEscritos(app);
  afirma(d.includes('\x1b[200~rc-um\rrc-dois\x1b[201~'), `clique direito com duas linhas usa bracketed paste (${JSON.stringify(d.slice(0, 60))})`);
  txt = (await textoTerm(app)).split('\n').join('');
  afirma(/rc-dois/.test(txt) && !/command not found/.test(txt), 'as duas linhas ficam no prompt, nada foi executado');
  // clique direito só com imagem: não escreve nada
  await app.areaImagem();
  await app.zeraEscritas();
  await cliqueDireito(app, c.x, c.y + 120);
  await sleep(500);
  afirma(!(await dadosEscritos(app)).includes('\x16'), 'clique direito só com imagem não manda \\x16 (só o Ctrl+V cola imagem)');
});

caso('T10', async app => {
  console.log('\n[T10] atalhos da IDE: Ctrl+Shift+T novo terminal, Ctrl+Tab aba do editor, Ctrl+O abrir pasta (só fora do terminal)');
  await novoTerminal(app);
  await foco(app);
  const nTerm = () => app.ev(`document.querySelectorAll('.ws.active .term-pane').length`);
  const respondeEscolha = async () => { // com WSL instalado o app pergunta onde abrir: escolhe o botão principal (Windows)
    await sleep(500);
    if (await app.ev(`document.getElementById('save-overlay').classList.contains('visible')`)) await app.ev(`document.querySelector('#save-actions .btn-primary').click()`);
    if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
    await sleep(500);
  };
  // 1) Ctrl+Shift+T com o foco no terminal: abre outro terminal e nada vira bytes
  const antes = await nTerm();
  await app.zeraEscritas();
  await tecla(app, { key: 'T', code: 'KeyT', vk: 84, mods: ['ctrl', 'shift'] });
  await respondeEscolha();
  await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === ${antes + 1}`, 20000, 'novo terminal');
  afirma(await nTerm() === antes + 1, `Ctrl+Shift+T com o foco no terminal abriu um terminal novo (${antes} para ${await nTerm()})`);
  afirma(!(await app.escritas()).some(x => x.data === '\x14' || x.data === '\x1b[84;6u'), 'a tecla não virou bytes no terminal');
  await app.espera(PROMPT(ULTIMO), 30000, 'prompt do terminal novo');
  const painelAberto = await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 4000).catch(() => false);
  if (painelAberto) await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);
  await sleep(400);

  // 2) Ctrl+Shift+T com o foco fora do terminal (explorador)
  await app.ev(`document.querySelector('.ws.active .dev-tree').focus?.(); document.activeElement.blur?.(); true`);
  const antes2 = await nTerm();
  await tecla(app, { key: 'T', code: 'KeyT', vk: 84, mods: ['ctrl', 'shift'] });
  await respondeEscolha();
  await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === ${antes2 + 1}`, 20000, 'terminal pelo foco fora');
  afirma(await nTerm() === antes2 + 1, 'Ctrl+Shift+T com o foco fora do terminal também abre um terminal');
  await app.espera(PROMPT(ULTIMO), 30000, 'prompt');
  if (await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 4000).catch(() => false)) await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);

  // 3) Ctrl+Tab com dois arquivos abertos alterna a aba ativa do editor
  await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === 'a.txt').click()`);
  await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 1`, 30000, 'a.txt aberto (Monaco carregando)');
  await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === 'b.txt').click()`);
  await app.espera(`document.querySelectorAll('.ws.active .dev-tab').length === 2`, 15000, 'b.txt aberto');
  const ativa = () => app.ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent`);
  afirma(await ativa() === 'b.txt', `b.txt é a aba ativa (${await ativa()})`);
  await tecla(app, { key: 'Tab', code: 'Tab', vk: 9, mods: ['ctrl'] });
  await sleep(300);
  afirma(await ativa() === 'a.txt', `Ctrl+Tab vai para a próxima aba, em círculo (${await ativa()})`);
  await tecla(app, { key: 'Tab', code: 'Tab', vk: 9, mods: ['ctrl', 'shift'] });
  await sleep(300);
  afirma(await ativa() === 'b.txt', `Ctrl+Shift+Tab volta (${await ativa()})`);
  // com o foco no terminal o Ctrl+Tab também troca a aba e não escreve no terminal
  await foco(app);
  await app.zeraEscritas();
  await tecla(app, { key: 'Tab', code: 'Tab', vk: 9, mods: ['ctrl'] });
  await sleep(300);
  afirma(await ativa() === 'a.txt', 'Ctrl+Tab com o foco no terminal troca a aba do editor');
  afirma(!(await app.escritas()).some(x => x.data === '\t' || x.data.includes('\x1b[9;5u')), 'o Ctrl+Tab não vira bytes no terminal');

  // 4) Ctrl+O: com o foco no editor abre a pasta; com o foco no terminal vai ao programa
  const abrir0 = await app.abrirPasta();
  await app.ev(`document.querySelector('.ws.active .monaco-editor textarea')?.focus(); true`);
  await tecla(app, { key: 'o', code: 'KeyO', vk: 79, mods: ['ctrl'] });
  await respondeEscolha();
  afirma(await app.abrirPasta() === abrir0 + 1, `Ctrl+O com o foco no editor aciona o abrir pasta (${abrir0} para ${await app.abrirPasta()})`);
  const abrir1 = await app.abrirPasta();
  await foco(app);
  await app.zeraEscritas();
  await tecla(app, { key: 'o', code: 'KeyO', vk: 79, mods: ['ctrl'] });
  await respondeEscolha();
  await sleep(300);
  afirma(await app.abrirPasta() === abrir1, 'Ctrl+O com o foco no terminal não abre pasta');
  afirma((await app.escritas()).some(x => x.data === '\x0f'), 'Ctrl+O com o foco no terminal entrega \\x0f ao programa');
  // 5) Ctrl+Shift+O não é da IDE: não abre pasta
  await app.ev(`document.querySelector('.ws.active .monaco-editor textarea')?.focus(); true`);
  await tecla(app, { key: 'O', code: 'KeyO', vk: 79, mods: ['ctrl', 'shift'] });
  await respondeEscolha();
  afirma(await app.abrirPasta() === abrir1, 'Ctrl+Shift+O não abre pasta (o Monaco mantém o "Ir para símbolo")');
});

caso('T7', async app => {
  console.log('\n[T7] Alt+V cola imagem: bytes entregues ao pty por sistema e shell (a prova com o Claude Code real está no relatório)');
  const altV = { key: 'v', code: 'KeyV', vk: 86, mods: ['alt'] };
  const bytesDoAltV = async () => { await app.zeraEscritas(); await tecla(app, altV); await sleep(500); return (await app.escritas()).map(x => x.data).filter(d => d === '\x1bv' || d === '\x16'); };
  await app.areaImagem();
  // Print real do Windows (Win+Shift+S) é bitmap (CF_BITMAP/DIB), não PNG: o PowerShell/.NET grava esse formato a partir de
  // uma imagem gerada no sandbox. A área de transferência original volta em app.fechar().
  if (WIN) {
    const arq = path.join(os.tmpdir(), `rendra-e2e-bitmap-${process.pid}.png`);
    fs.writeFileSync(arq, Buffer.from(pngBase64(8, 8), 'base64'));
    try {
      const formatos = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $i=[System.Drawing.Image]::FromFile('${arq}'); $b=New-Object System.Drawing.Bitmap($i); $d=New-Object System.Windows.Forms.DataObject; $d.SetImage($b); [System.Windows.Forms.Clipboard]::SetDataObject($d,$true); ([System.Windows.Forms.Clipboard]::GetDataObject().GetFormats() -join ',')`], { encoding: 'utf8' }).trim();
      console.log(`  formatos gravados (bitmap do Windows): ${formatos}`);
      afirma(/Bitmap|DeviceIndependentBitmap/.test(formatos) && !/(^|,)PNG(,|$)/.test(formatos), 'a área de transferência tem só bitmap (sem o formato PNG), como num print do Windows');
      await novoTerminal(app, { shell: 'powershell' });
      await foco(app);
      await app.zeraEscritas();
      await tecla(app, CTRL_V);
      await sleep(700);
      afirma((await dadosEscritos(app)).includes('\x16'), 'Ctrl+V com só um bitmap do Windows reconhece a imagem e entrega \\x16 ao programa');
      await app.zeraEscritas();
      await tecla(app, altV);
      await sleep(500);
      afirma((await app.escritas()).some(x => x.data === '\x1bv'), 'Alt+V com só um bitmap do Windows entrega ESC v');
    } finally { try { fs.rmSync(arq, { force: true }); } catch { /* em uso */ } }
    await app.areaImagem();
  }
  for (const shell of ['powershell', 'gitbash']) {
    try { await novoTerminal(app, { shell }); } catch (e) { pula('T7', `${shell} indisponível (${e.message})`); continue; }
    await foco(app);
    afirma(JSON.stringify(await bytesDoAltV()) === JSON.stringify(['\x1bv']), `Alt+V no ${shell} (Windows nativo) entrega ESC v, o Alt+V do Claude Code`);
  }
  // WSL: a segunda opção do menu de novo terminal
  const temWsl = await app.ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`).then(async () => { await sleep(700); return app.ev(`!!document.querySelector('.dev-term-menu button[data-i="1"]')`); });
  if (!temWsl) { if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`); pula('T7', 'WSL indisponível: sem a opção de terminal WSL'); return; }
  await app.ev(`document.querySelector('.dev-term-menu button[data-i="1"]').click()`);
  await app.espera(PROMPT(ULTIMO), 40000, 'prompt do WSL');
  if (await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 4000).catch(() => false)) await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);
  await foco(app);
  afirma(JSON.stringify(await bytesDoAltV()) === JSON.stringify(['\x16']), 'Alt+V no WSL entrega Ctrl+V (\\x16), que o Claude Code liga lá');
});

// linhas do terminal (sem espaços nas pontas), do prompt para baixo
const linhasDoTerminal = async app => (await textoTerm(app)).split('\n').map(l => l.trim()).filter(Boolean);

caso('T8', async app => {
  console.log('\n[T8] apagar a palavra: Alt+Backspace (Git Bash, WSL) e Ctrl+Backspace (PowerShell), com as teclas reais da IDE');
  const BACK = { key: 'Backspace', code: 'Backspace', vk: 8 };
  // 1) Git Bash: "echo alfa beta", Alt+Backspace, " gama", Enter: a saída do comando é "alfa gama"
  const rodaBash = async (rotulo, abrir) => {
    try { await abrir(); } catch (e) { pula('T8', `${rotulo} indisponível (${e.message})`); return; }
    await foco(app);
    await digita(app, 'echo alfa beta'); await sleep(200);
    await app.zeraEscritas();
    await tecla(app, { ...BACK, mods: ['alt'] });
    await sleep(300);
    afirma((await app.escritas()).some(x => x.data === '\x1b\x7f'), `${rotulo}: Alt+Backspace entrega ESC DEL ao programa`);
    await digita(app, ' gama'); await enter(app);
    await sleep(900);
    const l = await linhasDoTerminal(app);
    afirma(l.includes('alfa gama'), `${rotulo}: a saída do comando é "alfa gama" (a palavra anterior foi apagada)`);
  };
  await rodaBash('Git Bash', () => novoTerminal(app, { shell: 'gitbash' }));
  await rodaBash('WSL', async () => {
    await app.ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
    await sleep(700);
    if (!(await app.ev(`!!document.querySelector('.dev-term-menu button[data-i="1"]')`))) { if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`); throw new Error('sem a opção WSL'); }
    await app.ev(`document.querySelector('.dev-term-menu button[data-i="1"]').click()`);
    await app.espera(PROMPT(ULTIMO), 40000, 'prompt do WSL');
    if (await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 4000).catch(() => false)) await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);
    await sleep(400);
  });
  // 2) PowerShell 5.1: Ctrl+Backspace apaga a palavra; Alt+Backspace não (insere um ^H e nada é apagado)
  await novoTerminal(app, { shell: 'powershell' });
  await foco(app);
  await digita(app, 'Write-Output alfa beta'); await sleep(200);
  await app.zeraEscritas();
  await tecla(app, { ...BACK, mods: ['ctrl'] });
  await sleep(300);
  afirma((await app.escritas()).some(x => x.data === '\x08'), 'PowerShell: Ctrl+Backspace entrega BS (0x08) ao programa');
  await digita(app, ' gama'); await enter(app);
  await sleep(1200);
  let l = await linhasDoTerminal(app);
  const iSaida = l.lastIndexOf('alfa');
  afirma(iSaida >= 0 && l[iSaida + 1] === 'gama' && !l.slice(iSaida).includes('beta'), `PowerShell: Ctrl+Backspace apagou "beta" (saída: ${JSON.stringify(l.slice(Math.max(iSaida, 0), iSaida + 3))})`);
  await digita(app, 'Write-Output alfa beta'); await sleep(200);
  await tecla(app, { ...BACK, mods: ['alt'] });
  await sleep(300);
  await digita(app, ' gama'); await enter(app);
  await sleep(1200);
  l = await linhasDoTerminal(app);
  const j = l.lastIndexOf('alfa');
  afirma(j >= 0 && l.slice(j, j + 3).join(',') === 'alfa,beta,gama', `PowerShell 5.1: o Alt+Backspace NÃO apaga a palavra (saída: ${JSON.stringify(l.slice(j, j + 3))}); por isso a página indica Ctrl+Backspace`);
});

caso('T12', async app => {
  console.log('\n[T12] página Comandos: botão acima de Novidades sem flutuar, troca de sistema e de agente, capturas');
  await app.espera(`!!document.querySelector('.nav-tab[data-page="comandos"]')`, 10000, 'botão Comandos');
  await app.ev(`document.querySelector('.nav-tab[data-page="comandos"]').click()`);
  await app.espera(`document.getElementById('page-comandos').classList.contains('active')`, 5000, 'página aberta');
  const ativa = await app.ev(`({ pagina: document.querySelector('.page.active')?.id, botao: document.querySelector('.nav-tab.active')?.dataset.page, devMode: document.body.classList.contains('dev-mode') })`);
  afirma(ativa.pagina === 'page-comandos' && ativa.botao === 'comandos' && !ativa.devMode, `clicar no botão abre a página Comandos (${JSON.stringify(ativa)})`);
  const sistemaPadrao = await app.ev(`document.querySelector('.cmd-chip.active[data-sistema]')?.dataset.sistema`);
  afirma(sistemaPadrao === 'windows', `abre no sistema do computador (${sistemaPadrao})`);
  const v = await app.ev(`document.getElementById('comandos-versoes').textContent`);
  afirma(v === 'Conferido nas versões Claude Code 2.1.287 e Codex 0.157.1', `subtítulo com as versões conferidas (${v})`);

  // folga do rótulo de cada item da barra (o Comandos encostava na borda); medida pelo texto, não pelo botão
  const folgas = await app.ev(`[...document.querySelectorAll('#activity-bar .nav-tab:not([hidden])')].map(b => { const sp = b.querySelector('span'); const r = document.createRange(); r.selectNodeContents(sp); const t = r.getBoundingClientRect(), a = b.getBoundingClientRect(); return { pagina: b.dataset.page || b.id, esq: Math.round((t.left - a.left) * 10) / 10, dir: Math.round((a.right - t.right) * 10) / 10 }; })`);
  console.log('  folgas do rótulo (esq/dir, px): ' + folgas.map(f => f.pagina + ' ' + f.esq + '/' + f.dir).join(', '));
  const cmd = folgas.find(f => f.pagina === 'comandos'), term = folgas.find(f => f.pagina === 'terminal');
  afirma(cmd.esq >= term.esq - 0.2 && cmd.dir >= term.dir - 0.2 && Math.abs(cmd.esq - cmd.dir) < 0.5, 'o rótulo COMANDOS tem folga igual dos dois lados e ao menos a do item mais apertado (Terminal)');

  // rodapé da barra: Comandos, Novidades e Sobre juntos, no fundo, sem flutuar no meio; com e sem o botão Nova versão
  const rodape = () => app.ev(`(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; }; const nav = document.getElementById('activity-bar').getBoundingClientRect(); const u = document.getElementById('nav-update'); return { cmd: r('.nav-tab[data-page="comandos"]'), nov: r('.nav-tab[data-page="novidades"]'), sobre: r('.nav-tab[data-page="sobre"]'), precos: r('.nav-tab[data-page="precos"]'), navBottom: Math.round(nav.bottom), update: u.hidden ? null : { top: Math.round(u.getBoundingClientRect().top), bottom: Math.round(u.getBoundingClientRect().bottom) } }; })()`);
  let g = await rodape();
  afirma(g.cmd.bottom <= g.nov.top && g.nov.top - g.cmd.bottom <= 10 && g.sobre.top - g.nov.bottom <= 10, `Comandos, Novidades e Sobre ficam juntos (folgas ${g.nov.top - g.cmd.bottom} e ${g.sobre.top - g.nov.bottom} px)`);
  afirma(g.navBottom - g.sobre.bottom <= 12, `o grupo fica no fundo da barra (Sobre a ${g.navBottom - g.sobre.bottom} px do fim)`);
  afirma(g.cmd.top - g.precos.bottom > 60, `Comandos não fica colado nos itens de cima: sobra espaço livre acima (${g.cmd.top - g.precos.bottom} px)`);
  await fotografa(app, 'comandos-barra-sem-update');
  await app.ev(`document.getElementById('nav-update').hidden = false`);
  await sleep(200);
  g = await rodape();
  afirma(!!g.update && g.update.bottom <= g.cmd.top && g.cmd.top - g.update.bottom <= 12, `com "Nova versão" visível, ela vem logo acima do Comandos (folga ${g.cmd.top - g.update.bottom} px) e nada flutua no meio`);
  afirma(g.cmd.bottom <= g.nov.top && g.nov.top - g.cmd.bottom <= 10 && g.sobre.top - g.nov.bottom <= 10, 'com "Nova versão" visível, o grupo do rodapé continua junto');
  await fotografa(app, 'comandos-barra-com-update');
  await app.ev(`document.getElementById('nav-update').hidden = true`);

  // conteúdo por sistema e por agente
  const kbds = id => app.ev(`[...document.querySelectorAll('.cmd-card[data-id="${id}"] .cmd-teclas')].map(e => [...e.querySelectorAll('.cmd-combo')].map(c => [...c.querySelectorAll('kbd')].map(k => k.textContent).join('+')).join(' | ')).join('')`);
  const titulos = () => app.ev(`[...document.querySelectorAll('#comandos-body .section-heading')].map(h => h.textContent)`);
  const troca = async (grupo, valor) => { await app.ev(`document.querySelector('.cmd-chip[data-${grupo}="${valor}"]').click()`); await sleep(150); };
  await app.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 2300, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  afirma(JSON.stringify(await titulos()) === JSON.stringify(['Atalhos do terminal', 'Comandos do Claude Code', 'Atalhos da IDE']), 'três seções: terminal, comandos do Claude Code, IDE');
  afirma(await kbds('colar-texto') === 'Ctrl+V | Ctrl+Shift+V | Clique direito', `Windows: colar texto = ${await kbds('colar-texto')}`);
  afirma(await kbds('colar-imagem') === 'Alt+V', `Windows com Claude Code: colar imagem = ${await kbds('colar-imagem')}`);
  afirma(await kbds('novo-terminal') === 'Ctrl+Shift+T' && await kbds('abrir-pasta') === 'Ctrl+O', 'Windows: novo terminal Ctrl+Shift+T e abrir pasta Ctrl+O');
  afirma(await kbds('reordenar') === 'Arrastar a aba | Ctrl+Shift+Seta esquerda | Ctrl+Shift+Seta direita', `Windows: reordenar abas = ${await kbds('reordenar')}`);
  afirma(await app.ev(`/Reordenar abas/.test(document.querySelector('.cmd-card[data-id="reordenar"]').textContent) && /projeto, de um terminal ou de um arquivo do editor/.test(document.getElementById('comandos-body').textContent)`), 'Windows: o card Reordenar abas cita projetos, terminais e arquivos do editor');
  afirma(await app.ev(`document.getElementById('comandos-body').textContent.includes('WSL')`), 'Windows: a nota do terminal WSL aparece');
  await fotografa(app, 'comandos-windows-claude');
  await troca('sistema', 'macos');
  afirma(await kbds('colar-texto') === 'Cmd+V | Clique direito' && await kbds('interromper') === 'Control+C', `macOS: colar texto = ${await kbds('colar-texto')}, interromper = ${await kbds('interromper')}`);
  afirma(await kbds('novo-terminal') === 'Cmd+Shift+T' && await kbds('proxima-aba') === 'Control+Tab' && await kbds('abrir-pasta') === 'Cmd+O', 'macOS: Cmd+Shift+T, Control+Tab e Cmd+O');
  afirma(await kbds('reordenar') === 'Arrastar a aba | Control+Shift+Seta esquerda | Control+Shift+Seta direita', `macOS: reordenar abas = ${await kbds('reordenar')}`);
  afirma(!(await app.ev(`document.getElementById('comandos-body').textContent.includes('WSL')`)), 'macOS: sem a nota do WSL');
  await fotografa(app, 'comandos-macos-claude');
  await troca('sistema', 'linux');
  afirma(await kbds('colar-imagem') === 'Ctrl+V | Alt+V' && await kbds('copiar-teclado') === 'Ctrl+Shift+C', `Linux: colar imagem = ${await kbds('colar-imagem')}, copiar = ${await kbds('copiar-teclado')}`);
  await fotografa(app, 'comandos-linux-claude');
  await troca('agente', 'codex');
  afirma(JSON.stringify(await titulos()) === JSON.stringify(['Atalhos do terminal', 'Comandos do Codex', 'Atalhos da IDE']), 'trocar o agente muda a seção de comandos');
  afirma(await app.ev(`document.getElementById('comandos-body').textContent.includes('codex resume --last')`), 'Codex: mostra codex resume --last');
  afirma(await kbds('colar-imagem') === 'Ctrl+V', `Codex: colar imagem = ${await kbds('colar-imagem')}`);
  afirma(await app.ev(`document.querySelector('.cmd-chip.active[data-sistema]').dataset.sistema === 'linux' && document.querySelector('.cmd-chip.active[data-agente]').dataset.agente === 'codex'`), 'os dois seletores guardam a escolha');
  await fotografa(app, 'comandos-linux-codex');
  // teclado: o botão ganha foco visível e o Enter aciona (botões nativos)
  await app.ev(`document.querySelector('.cmd-chip[data-sistema="windows"]').focus()`);
  const foc = await app.ev(`(() => { const b = document.activeElement; return { pressed: b.getAttribute('aria-pressed'), outline: getComputedStyle(b).outlineStyle }; })()`);
  await tecla(app, { key: 'Enter', code: 'Enter', vk: 13, text: '\r' });
  await sleep(200);
  afirma(foc.pressed === 'false' && await app.ev(`document.querySelector('.cmd-chip.active[data-sistema]').dataset.sistema`) === 'windows', 'Enter no botão do sistema o ativa (aria-pressed muda) e o foco volta a ele');
  afirma(await app.ev(`document.activeElement?.dataset?.sistema`) === 'windows', 'o foco continua no botão acionado depois do novo desenho');
  await app.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
});

// ── Execução ────────────────────────────────────────────────────────────────
// cada caso roda num app novo e numa sandbox nova: sem terminais, arquivos e estado herdados do caso anterior
(async () => {
  for (const c of casos) {
    if (FILTRO && !FILTRO.some(f => c.nome === f)) continue;
    const sb = sandbox();
    let app;
    try {
      app = await abrir(sb);
      afirma(app.espiao.ls >= 1 && app.espiao.abrirPasta, `espiões instalados no main: ${JSON.stringify(app.espiao)}`);
      await c.fn(app);
    } catch (e) {
      afirma(false, `${c.nome} lançou: ${e.stack || e.message}`);
    } finally {
      if (app) await app.fechar();
      else if (sb.proc) { try { if (WIN) execFileSync('taskkill', ['/PID', String(sb.proc.pid), '/T', '/F'], { stdio: 'ignore' }); else sb.proc.kill(); } catch { /* já encerrou */ } }
      sb.limpa();
    }
  }

  console.log(`\n${falhas.length ? 'FALHOU' : 'OK'}: ${falhas.length} falha(s), ${puladas.length} pulado(s)`);
  for (const p of puladas) console.log(`  pulado: ${p}`);
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(falhas.length ? 1 : 0);
})();

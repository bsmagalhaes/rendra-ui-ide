// Prova de ponta a ponta do ConPTY embarcado: app real em sandbox, janela oculta (RENDRA_E2E_HIDDEN=1), com a opção
// no padrão e desligada. Em cada terminal (PowerShell e WSL) o programa consulta a cor de fundo (OSC 11) e mede em
// quanto tempo a resposta do xterm.js (pelo IPC do app) chega ao programa: o Codex espera 250 ms. Também confere
// acentos, o redimensionamento e a caixa da opção nas Configurações. Só no Windows, fora do npm test.
// Uso: node scripts/e2e-conpty.js [--saida=<pasta das fotos>]. Sai com 1 se falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argSaida = (process.argv.find(a => a.startsWith('--saida=')) || '').slice(8);
const SAIDA = path.resolve(argSaida || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-conpty'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
if (process.platform !== 'win32') { console.log('Só no Windows.'); process.exit(0); }

function sandbox(conptyDll) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-conpty-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  escreve(path.join(projeto, 'a.txt'), 'a\n');
  const settings = { refreshInterval: 600 };
  if (conptyDll !== undefined) settings.conptyDll = conptyDll;
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: projeto, groups: [] }], active: 0 } },
  }, null, 2));
  return { dir, home, data, projeto };
}

function cliente(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pend = {}; let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (!pend[m.id]) return; m.error ? pend[m.id].reject(new Error(m.error.message)) : pend[m.id].resolve(m.result); delete pend[m.id]; };
  const pronto = new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pend[i] = { resolve, reject }; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || ''}`.slice(0, 400));
    return r.result?.value;
  };
  return { ws, send, ev, pronto };
}

async function alvo(porta) {
  for (let i = 0; i < 80; i++) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => x.type === 'page'); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}

// Consulta OSC 11 e mede a resposta dentro do próprio programa (ida e volta completa pelo app)
const SONDA = {
  PowerShell: String.raw`$e=[char]27; [Console]::Out.Write("$e]11;?$e\"); $sw=[Diagnostics.Stopwatch]::StartNew(); $r=''; while($sw.ElapsedMilliseconds -lt 250 -and -not $r.EndsWith("$e\")){ if([Console]::KeyAvailable){$r+=[Console]::ReadKey($true).KeyChar}else{Start-Sleep -Milliseconds 2} }; "RES lat=$($sw.ElapsedMilliseconds) len=$($r.Length) ok=$($r.EndsWith("$e\"))"`,
  WSL: String.raw`stty raw -echo; printf '\033]11;?\033\\'; s=$(date +%s%N); IFS= read -r -s -t 0.25 -d '\' r; rc=$?; e=$(date +%s%N); stty sane; echo "RES lat=$(((e-s)/1000000)) len=$(printf %s "$r"|wc -c) rc=$rc"`,
};

async function rodada(dll) {
  const rotulo = dll === undefined ? 'padrão (sem a configuração gravada)' : dll ? 'conptyDll ligado' : 'conptyDll desligado';
  console.log(`\n== ${rotulo} ==`);
  const sb = sandbox(dll);
  const porta = 9400 + Math.floor(Math.random() * 400);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`electron pid ${proc.pid}`);
  let pagina;
  const esperado = dll !== false;
  try {
    const t = await alvo(porta);
    if (!t) throw new Error('o app não abriu');
    pagina = cliente(t.webSocketDebuggerUrl); await pagina.pronto;
    const { send, ev } = pagina;
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { } await sleep(150); } throw new Error(`tempo esgotado: ${msg}`); };
    await espera(`!!document.querySelector('.ws.active')`, 30000, 'workspace ativo');

    // Configurações: a caixa reflete a opção
    await ev(`document.getElementById('btn-settings').click()`);
    await sleep(400);
    const marcada = await ev(`document.getElementById('s-conpty').checked`);
    afirma(marcada === esperado, `Configurações: caixa do terminal moderno ${marcada ? 'marcada' : 'desmarcada'} (esperado ${esperado ? 'marcada' : 'desmarcada'})`);
    fs.mkdirSync(SAIDA, { recursive: true });
    const foto = async nome => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(SAIDA, nome); fs.writeFileSync(f, Buffer.from(data, 'base64')); console.log(`  foto: ${f}`); };
    if (dll === undefined) await foto('configuracoes.png');
    await ev(`document.getElementById('s-cancel').click()`);
    await sleep(300);

    for (const alvoShell of ['PowerShell', 'WSL']) {
      // o seletor da barra escolhe o terminal: PowerShell abre direto; o Bash pergunta entre Git Bash e as distros
      await ev(`(() => { const s = document.querySelector('.ws.active .dev-shell-select'); const ks = ${alvoShell === 'WSL' ? "['gitbash', 'bash-wsl']" : "['powershell']"}; const k = ks.find(x => [...s.options].some(o => o.value === x)); if (k) { s.value = k; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
      const antes = await ev(`document.querySelectorAll('.ws.active .term-pane').length`); // antes do clique: sem menu o terminal já nasce com ele
      await ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
      await sleep(600);
      const rotulos = await ev(`[...document.querySelectorAll('.dev-term-menu button')].map(b => b.textContent.trim())`);
      if (rotulos.length) {
        const i = rotulos.findIndex(l => (alvoShell === 'WSL' ? /wsl|ubuntu/i : /powershell/i).test(l));
        if (!afirma(i >= 0, `menu de terminal tem ${alvoShell}: ${JSON.stringify(rotulos)}`)) continue;
        await ev(`document.querySelector('.dev-term-menu button[data-i="${i}"]').click()`);
      }
      const painel = `[...document.querySelectorAll('.ws.active .term-pane')].pop()`;
      await espera(`document.querySelectorAll('.ws.active .term-pane').length > ${antes}`, 20000, 'terminal aberto');
      await espera(`[...${painel}.querySelectorAll('.xterm-rows > div')].some(d => /[>$#]/.test(d.textContent))`, 30000, `prompt do ${alvoShell}`);
      await sleep(1200);
      const corpo = await ev(`(() => { const r = ${painel}.querySelector('.term-pane-body').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: corpo.x + corpo.w / 2, y: corpo.y + corpo.h / 2, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: corpo.x + corpo.w / 2, y: corpo.y + corpo.h / 2, button: 'left', clickCount: 1 });
      await sleep(200);
      const enter = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); };
      const digita = async txt => { await send('Input.insertText', { text: txt }); await enter(); };
      const texto = () => ev(`[...${painel}.querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);

      await digita(SONDA[alvoShell]);
      let res = null;
      const fim = Date.now() + 15000;
      while (Date.now() < fim && !res) { await sleep(300); res = (await texto()).match(/RES lat=(\d+) len=(\d+) (?:ok=(\w+)|rc=(\d+))/); }
      if (!afirma(!!res, `${alvoShell}: a sonda respondeu`)) { console.log((await texto()).slice(-600)); continue; }
      const lat = +res[1], len = +res[2];
      const chegou = len > 20;
      console.log(`  ${alvoShell}: lat=${lat} ms, bytes de resposta lidos=${len}`);
      if (esperado) afirma(chegou && lat < 250, `${alvoShell}: resposta do OSC 11 chegou em ${lat} ms (< 250 ms)`);
      else afirma(!chegou && lat >= 240, `${alvoShell}: com a opção desligada a consulta não é respondida (${lat} ms, ${len} bytes)`);

      // acentos e Unicode, nos dois sentidos
      await digita(alvoShell === 'WSL' ? 'echo "ação ção ✓ ñ"' : 'Write-Output "ação ção ✓ ñ"');
      await sleep(900);
      const linhas = (await texto()).split('\n').map(l => l.trim());
      afirma(linhas.includes('ação ção ✓ ñ'), `${alvoShell}: acentos e Unicode íntegros na saída`);

      // redimensionar: a largura que o programa vê acompanha a janela
      if (alvoShell === 'WSL') {
        const colunas = async () => { await digita('tput cols'); await sleep(1200); return +((await texto()).match(/^(\d+)$/gm) || []).pop(); };
        const a = await colunas();
        await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(1500);
        const b = await colunas();
        afirma(a > 0 && b > 0 && b < a, `WSL: redimensionar muda as colunas vistas pelo programa (${a} -> ${b})`);
        await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(800);
        if (esperado) await foto('terminal-wsl-conpty.png');
      }
    }
  } catch (e) {
    falhas.push(`erro (${rotulo}): ${e.message}`); console.log(`  ✗ erro: ${e.message}`);
  } finally {
    try { pagina?.ws.close(); } catch { }
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { }
    await sleep(1200);
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { }
  }
}

(async () => {
  await rodada(undefined);
  await rodada(false);
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ${falhas.join('\n- ')}` : '\nTudo conferido.');
  process.exit(falhas.length ? 1 : 0);
})();

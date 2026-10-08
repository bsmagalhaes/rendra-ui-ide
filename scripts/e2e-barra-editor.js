// Prova de ponta a ponta da barra de consumo do Claude Code (barra de título) e do painel do editor
// recolhível da IDE, com o app real rodando em sandbox: uma pasta temporária com home falso
// (RENDRA_HOME) e dados falsos (RENDRA_DATA_DIR). Nada do usuário é lido nem gravado.
// Fora do `npm test`: abre o Electron e leva minutos (o cenário `ritmo` espera o timer de 60 s).
// A janela abre fora da tela e sem foco (RENDRA_E2E_HIDDEN=1, ligado pelo próprio script).
//
//   node scripts/e2e-barra-editor.js                        todos os cenários
//   node scripts/e2e-barra-editor.js --cenario=normal,velho  só esses
//   node scripts/e2e-barra-editor.js --saida=<pasta>        onde gravar as capturas
//                                                           (ou RENDRA_E2E_OUT; padrão: pasta temporária)
// Sai com código diferente de zero se qualquer asserção falhar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Argumentos ──────────────────────────────────────────────────────────────
const arg = nome => (process.argv.find(a => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT
  || path.join(os.tmpdir(), `rendra-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const ESCOLHIDOS = arg('cenario') ? arg('cenario').split(',').map(s => s.trim()).filter(Boolean) : null;

// ── Asserções ───────────────────────────────────────────────────────────────
const falhas = [];
let cenarioAtual = '';
function afirma(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); return true; }
  falhas.push(`[${cenarioAtual}] ${msg}`);
  console.log(`  ✗ ${msg}`);
  return false;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

// ── Contraste (WCAG) ────────────────────────────────────────────────────────
function rgbDe(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`cor não reconhecida: ${css}`);
  const [r, g, b, a] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { r, g, b, a: a === undefined ? 1 : a };
}
function luminancia({ r, g, b }) {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(css1, css2) {
  const l1 = luminancia(rgbDe(css1)), l2 = luminancia(rgbDe(css2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
const DIA = 86400000;
const escreve = (arquivo, texto) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, texto); };

// Dados fictícios do Codex: JWT fabricado com tokens sentinela (nenhum deles pode aparecer na tela)
const SENT = ['SENT-E2E-ACESSO-7781', 'SENT-E2E-RENOVA-4420', 'SENT-E2E-CONTA-9035', 'SENT-E2E-OPENAI-1188'];
const CODEX_DEMO = { email: 'codex.demo@exemplo.com', nome: 'Pessoa Codex', org: 'Org Codex Demo', plano: 'pro' };
const HOST = { win32: 'Windows', darwin: 'macOS' }[process.platform] || 'Linux';
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function escreverAuthCodex(sb) {
  const payload = {
    email: CODEX_DEMO.email, name: CODEX_DEMO.nome,
    'https://api.openai.com/auth': {
      chatgpt_plan_type: CODEX_DEMO.plano,
      organizations: [{ id: 'o1', is_default: false, role: 'member', title: 'Outra Org Demo' }, { id: 'o2', is_default: true, role: 'owner', title: CODEX_DEMO.org }],
    },
  };
  escreve(path.join(sb.home, '.codex', 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt', OPENAI_API_KEY: SENT[3],
    tokens: { id_token: `${b64url({ alg: 'none' })}.${b64url(payload)}.assinatura-falsa`, access_token: SENT[0], refresh_token: SENT[1], account_id: SENT[2] },
    last_refresh: new Date().toISOString(),
  }));
}
// Um rollout fictício com só a janela semanal (10080 min), como o Codex deste usuário; `idadeMs` é a
// idade do evento (o fetchedAt da barra) e do arquivo
function escreverCodexLimites(sb, { pct = 9, idadeMs = 60000 } = {}) {
  const agora = Date.now();
  const quando = new Date(agora - idadeMs);
  const arquivo = path.join(sb.home, '.codex', 'sessions', '2026', '10', '03', 'rollout-e2e-demo.jsonl');
  escreve(arquivo, JSON.stringify({
    timestamp: quando.toISOString(), type: 'event_msg',
    payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: pct, window_minutes: 10080, resets_at: Math.floor((agora + 3.2 * DIA) / 1000) }, secondary: null, plan_type: CODEX_DEMO.plano } },
  }) + '\n');
  fs.utimesSync(arquivo, quando, quando);
}

// opts: status ({ five, seven } | null), idadeMs, semRateLimits, conta (padrão true), contaClaude ({ email, org, nome }),
// semCodex, codexPct, codexIdadeMs, settings, workspaces
function criarSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-'));
  const home = path.join(dir, 'home');
  const data = path.join(dir, 'data');
  const projeto = path.join(home, 'projetos', 'demo');
  escreve(path.join(projeto, 'a.txt'), 'primeiro arquivo\nlinha dois\n');
  escreve(path.join(projeto, 'b.txt'), 'segundo arquivo\n');
  escreve(path.join(projeto, 'sub', 'c.txt'), 'terceiro arquivo\n');
  for (const [nome, texto] of Object.entries(opts.arquivos || {})) escreve(path.join(projeto, nome), texto);
  const sb = { dir, home, data, projeto, statusFile: path.join(home, '.rendra-ide', 'claude-status.json') };

  if (opts.conta !== false) {
    escreve(path.join(home, '.claude.json'), JSON.stringify({
      oauthAccount: {
        emailAddress: opts.contaClaude?.email || 'voce@exemplo.com', displayName: opts.contaClaude?.nome || 'Você',
        organizationName: opts.contaClaude?.org || 'Empresa Demo',
      },
    }));
    if (!opts.semCredenciais) {
      escreve(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
        claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
      }));
    }
    escreve(path.join(home, '.claude', 'settings.json'), JSON.stringify({
      statusLine: { type: 'command', command: 'sh "$HOME/.rendra-ide/statusline.sh"' },
    }, null, 2));
  }
  if (!opts.semCodex) {
    escreverAuthCodex(sb);
    escreverCodexLimites(sb, { pct: opts.codexPct ?? 9, idadeMs: opts.codexIdadeMs ?? 60000 });
  }
  if (opts.semRateLimits) escreve(sb.statusFile, JSON.stringify({ model: { display_name: 'Demo' } }));
  else if (opts.status) escreverStatus(sb, opts.status, opts.idadeMs || 0);

  const workspaces = (opts.workspaces || [{ name: 'demo', cols: 2 }]).map(w => ({
    name: w.name, custom: false, cols: w.cols || 1, root: projeto,
    // '@a.txt' vira o caminho do arquivo dentro do projeto de demonstração
    groups: (w.groups || []).map(g => ({ tabs: g.tabs.map(t => (t[0] === '@' ? path.join(projeto, t.slice(1)) : t)), active: g.active && g.active[0] === '@' ? path.join(projeto, g.active.slice(1)) : g.active })),
    ...(w.editorHidden === undefined ? {} : { editorHidden: w.editorHidden }),
  }));
  const config = {
    settings: { refreshInterval: 600, ...(opts.settings || {}) },
    filters: { days: 30, projects: [] },
    setup: { dismissed: true },
    devcode: { workspaces: { list: workspaces, active: opts.ativo || 0 } },
  };
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify(config, null, 2));
  return sb;
}

// O `fetchedAt` do app é o mtime do arquivo: a idade do dado é a idade do arquivo
function escreverStatus(sb, { five, seven }, idadeMs = 0) {
  const agora = Date.now();
  const rate_limits = {};
  if (five !== undefined) rate_limits.five_hour = { used_percentage: five, resets_at: Math.floor((agora + 2.5 * 3600000) / 1000) };
  if (seven !== undefined) rate_limits.seven_day = { used_percentage: seven, resets_at: Math.floor((agora + 3.2 * DIA) / 1000) };
  escreve(sb.statusFile, JSON.stringify({ rate_limits }));
  const quando = new Date(agora - idadeMs);
  fs.utimesSync(sb.statusFile, quando, quando);
}
const apagarStatus = sb => { try { fs.rmSync(sb.statusFile); } catch { /* já não existe */ } };
const lerConfig = sb => JSON.parse(fs.readFileSync(path.join(sb.data, 'rendra-config.json'), 'utf8'));

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
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
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
  return { ws, send, ev };
}

async function abrir(sb, { w = 1920, h = 1080, semTerminal = false } = {}) {
  const porta = 9400 + Math.floor(Math.random() * 400);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  // O home real continua (shells e Chromium precisam dele); o app lê o home falso via RENDRA_HOME
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`], { cwd: ROOT, env, stdio: 'ignore' });
  const { ws, send, ev } = await conectar(porta);
  const app = { sb, proc, ws, send, ev, w, h, semTerminal, porta };
  sb.appAtual = app;

  app.tamanho = async (nw, nh) => {
    app.w = nw; app.h = nh;
    await send('Emulation.setDeviceMetricsOverride', { width: nw, height: nh, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
  };
  // Espera a expressão ficar verdadeira (em JS da página)
  app.espera = async (expr, ms = 20000, msg = expr) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await ev(expr)) return true; } catch { /* página ainda carregando */ }
      await sleep(150);
    }
    throw new Error(`tempo esgotado esperando: ${msg}`);
  };
  app.clica = async seletor => {
    const ok = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(seletor)})].find(e => e.offsetParent !== null) || document.querySelector(${JSON.stringify(seletor)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`não achei para clicar: ${seletor}`);
  };
  // Retângulo do primeiro elemento que casa (null se não existe)
  app.caixa = seletor => ev(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
  app.estilo = (seletor, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(seletor)}))[${JSON.stringify(prop)}]`);
  app.texto = seletor => ev(`document.querySelector(${JSON.stringify(seletor)})?.textContent ?? null`);
  app.pagina = async nome => { await app.clica(`[data-page=${nome}]`); await sleep(700); };
  // Captura com o texto dos terminais escondido (o perfil do shell imprime caminhos com o nome do usuário)
  app.digita = text => send('Input.insertText', { text });
  app.tecla = async (key, { ctrl } = {}) => {
    const base = { key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), modifiers: ctrl ? 2 : 0 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  app.foto = async (nome, clip) => {
    fs.mkdirSync(SAIDA, { recursive: true });
    await ev(`(() => { let s = document.getElementById('e2e-oculta'); if (!s) { s = document.createElement('style'); s.id = 'e2e-oculta'; document.head.appendChild(s); } s.textContent = '.xterm-screen{visibility:hidden !important}'; })()`);
    await sleep(350);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    await ev(`document.getElementById('e2e-oculta')?.remove()`);
    const arquivo = path.join(SAIDA, `${nome}.png`);
    fs.writeFileSync(arquivo, Buffer.from(data, 'base64'));
    console.log(`  📷 ${arquivo}`);
    return arquivo;
  };
  app.fechar = async () => {
    try { ws.close(); } catch { /* fechado */ }
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill();
    } catch { /* já encerrou */ }
    await sleep(1500);
  };
  // Reinicia o app com o MESMO diretório de dados (não pelo botão fechar: o processo é morto)
  app.reiniciar = async () => {
    const { w: ow, h: oh } = app;
    await app.fechar();
    const novo = await abrir(sb, { w: ow, h: oh, semTerminal: app.semTerminal });
    return novo;
  };

  await app.tamanho(w, h);
  await app.espera(`!!document.querySelector('.ws.active')`, 30000, 'workspace ativo');
  // Nenhum terminal abre sozinho: os cenários que medem terminais pedem um, como o usuário faria
  if (!semTerminal) await abrirTerminal(app);
  await sleep(800);
  return app;
}

// Clica em "novo terminal" (no workspace ativo ou na página Terminal); se a máquina tiver WSL aparece o
// menu, e a primeira opção é sempre o Windows
async function abrirTerminal(app, escopo = '.ws.active') {
  await app.clica(`${escopo} [data-act="new-term"]`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.clica('.dev-term-menu button[data-i="0"]');
  await app.espera(`!!document.querySelector('${escopo} .term-pane')`, 20000, 'terminal aberto');
}

async function comApp(opts, fn) {
  const sb = criarSandbox(opts);
  let app = null;
  try {
    app = await abrir(sb, { ...opts.janela, semTerminal: opts.semTerminal });
    await fn(app, sb);
  } finally {
    // o app pode ter sido reiniciado dentro do cenário: fecha o último
    const atual = sb.appAtual || app;
    if (atual) await atual.fechar();
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { /* temp, o sistema limpa depois */ }
  }
}

// ── CENÁRIOS ────────────────────────────────────────────────────────────────
const CENARIOS = {};

// A barra existe na estrutura, no lugar certo, e fica escondida sem dado (sem Claude Code, conta sem
// plano, ponte não instalada)
async function estruturaEscondida(app) {
  const info = await app.ev(`(() => {
    const barra = document.getElementById('consumo-bar');
    if (!barra) return null;
    const r = barra.getBoundingClientRect();
    return {
      pai: barra.parentElement?.id,
      antes: barra.previousElementSibling?.className,
      depois: barra.nextElementSibling?.className,
      display: getComputedStyle(barra).display,
      largura: r.width,
    };
  })()`);
  if (!afirma(!!info, '#consumo-bar existe no DOM')) return;
  afirma(info.pai === 'title-bar', '#consumo-bar está dentro de #title-bar');
  afirma(info.antes === 'app-name', 'vem logo depois de .app-name');
  afirma(info.depois === 'title-bar-right', 'vem logo antes de .title-bar-right');
  afirma(info.display === 'none' && info.largura === 0, `não está visível (display ${info.display}, largura ${info.largura})`);
}

// Reescrito de propósito (antes: "sem dado, a barra some"): com conta e sem limites a barra mostra a
// conta e "sem dados"; só some quando não há conta nem limites
CENARIOS['sem-dado'] = async () => {
  const contaSemDados = async (app, nome) => {
    await barraVisivel(app);
    await sleep(500);
    const b = await lerBarra(app);
    afirma(b.visivel && b.itens.length === 0, `${nome}: a barra fica visível, sem item de limite`);
    afirma(b.semDados, `${nome}: mostra "sem dados"`);
    afirma(b.nome.visivel && b.nome.texto === 'Empresa Demo', `${nome}: organização "${b.nome.texto}"`);
    afirma(b.email.visivel && b.email.texto === 'voce@exemplo.com', `${nome}: e-mail "${b.email.texto}"`);
    afirma(b.title.includes('Sem dados de limite'), `${nome}: tooltip ${JSON.stringify(b.title)}`);
    afirma(!b.select.visivel, `${nome}: uma opção só, sem seletor`);
  };
  // 1) nunca houve Claude Code: nenhum claude-status.json (a conta existe)
  await comApp({ status: null, semCodex: true }, app => contaSemDados(app, 'sem claude-status.json'));
  // 2) conta sem plano: o arquivo existe mas sem rate_limits
  await comApp({ semRateLimits: true, semCodex: true }, app => contaSemDados(app, 'sem rate_limits'));
  // 3) sem conta e sem limites: a barra continua escondida
  await comApp({ conta: false, status: null, semCodex: true }, async app => {
    await sleep(1800);
    await estruturaEscondida(app);
  });
};

// ── Barra de consumo: leitura e ajudantes ───────────────────────────────────
const COR = { verde: 'rgb(76, 175, 117)', laranja: 'rgb(232, 101, 10)', vermelho: 'rgb(229, 72, 77)', muted: 'rgb(176, 176, 176)', dim: 'rgb(112, 112, 112)' };
const LER_BARRA = `(() => {
  const b = document.getElementById('consumo-bar');
  if (!b) return null;
  const cs = e => getComputedStyle(e);
  const r = b.getBoundingClientRect();
  const vis = e => !!e && !e.hidden && cs(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  const caixa = e => { const x = e.getBoundingClientRect(); return { x: x.x, r: x.right, w: x.width, h: x.height }; };
  const sel = document.getElementById('consumo-provedor'), nome = document.getElementById('consumo-nome');
  const email = document.getElementById('consumo-email'), sd = document.getElementById('consumo-semdados');
  return {
    visivel: !b.hidden && cs(b).display !== 'none' && r.width > 0,
    title: b.title, texto: b.textContent, aria: b.getAttribute('aria-label'), compacto: b.classList.contains('compacto'),
    rect: { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right },
    fundo: cs(document.getElementById('title-bar')).backgroundColor,
    select: { visivel: vis(sel), opcoes: [...sel.options].map(o => o.textContent), ids: [...sel.options].map(o => o.value), valor: sel.value,
      cor: cs(sel).color, fundo: cs(sel).backgroundColor, rect: caixa(sel), title: sel.title },
    nome: { visivel: vis(nome), texto: nome.textContent, cor: cs(nome).color, rect: caixa(nome), cortado: nome.scrollWidth > nome.clientWidth, reticencias: cs(nome).textOverflow === 'ellipsis' },
    email: { visivel: vis(email), texto: email.textContent, cor: cs(email).color, rect: caixa(email), cortado: email.scrollWidth > email.clientWidth, reticencias: cs(email).textOverflow === 'ellipsis' },
    semDados: vis(sd), semDadosCor: cs(sd).color,
    itens: [...b.querySelectorAll('.consumo-item')].filter(i => !i.hidden).map(i => {
      const pb = i.querySelector('[role=progressbar]'), fill = i.querySelector('.consumo-fill');
      const rot = i.querySelector('.consumo-rotulo'), pct = i.querySelector('.consumo-pct');
      return {
        rotulo: rot.textContent, pct: pct.textContent, classe: i.className,
        now: pb.getAttribute('aria-valuenow'), min: pb.getAttribute('aria-valuemin'), max: pb.getAttribute('aria-valuemax'),
        label: pb.getAttribute('aria-label'), valuetext: pb.getAttribute('aria-valuetext'),
        fillW: fill.getBoundingClientRect().width, trilhoW: pb.getBoundingClientRect().width,
        fillBg: cs(fill).backgroundColor, trilhoBg: cs(pb).backgroundColor, pctCor: cs(pct).color, rotCor: cs(rot).color,
      };
    }),
  };
})()`;
const lerBarra = app => app.ev(LER_BARRA);
const barraVisivel = app => app.espera(`(() => { const b = document.getElementById('consumo-bar'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; })()`, 20000, 'barra de consumo visível');
const barraEscondida = (app, ms = 20000) => app.espera(`(() => { const b = document.getElementById('consumo-bar'); return !!b && (b.hidden || b.getBoundingClientRect().width === 0); })()`, ms, 'barra de consumo escondida');
const barraTem = (app, pcts, ms = 20000) => app.espera(`[...document.querySelectorAll('#consumo-bar .consumo-item:not([hidden]) .consumo-pct')].map(e => e.textContent).join(',') === ${JSON.stringify(pcts.join(','))}`, ms, `barra mostrando ${pcts.join(', ')}`);
const atualiza = app => app.clica('#btn-refresh');
// escolhe uma opção do seletor como o usuário faria (muda o valor e dispara change)
const selecionar = async (app, id) => {
  await app.ev(`(() => { const s = document.getElementById('consumo-provedor'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(500);
};
const horaLocal = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

CENARIOS['normal'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 60000, janela: { w: 1366, h: 768 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-bar').title.includes('Empresa Demo')`, 20000, 'tooltip com a conta');
    await sleep(800); // transição da largura (0,4 s)
    const b = await lerBarra(app);
    afirma(b.itens.map(i => i.rotulo).join('|') === '5 Horas|Semanal', `rótulos: ${b.itens.map(i => i.rotulo).join(' | ')}`);
    afirma(b.itens.map(i => i.pct).join('|') === '42%|27%', `percentuais: ${b.itens.map(i => i.pct).join(' | ')}`);
    afirma(b.itens.map(i => i.now).join('|') === '42|27', 'aria-valuenow 42 e 27');
    afirma(b.itens.every(i => i.min === '0' && i.max === '100'), 'aria-valuemin 0 e aria-valuemax 100');
    afirma(b.itens.map(i => i.label).join('|') === 'Limite de 5 horas|Limite semanal', `aria-label: ${b.itens.map(i => i.label).join(' | ')}`);
    afirma(perto(b.itens[0].fillW, b.itens[0].trilhoW * 0.42, 1) && perto(b.itens[1].fillW, b.itens[1].trilhoW * 0.27, 1),
      `preenchimento ${b.itens[0].fillW.toFixed(1)} de ${b.itens[0].trilhoW} px (42%) e ${b.itens[1].fillW.toFixed(1)} (27%)`);
    afirma(b.itens.every(i => i.fillBg === COR.verde), `cor do preenchimento é o verde (${b.itens[0].fillBg})`);
    afirma(b.title.includes('Empresa Demo') && b.title.includes('Max 5x') && b.title.includes('Reinicia em'), `tooltip: ${JSON.stringify(b.title)}`);
    // reescrito de propósito (antes: nunca e-mail na barra): agora o e-mail inteiro aparece, com a organização
    afirma(b.title.includes('voce@exemplo.com') && b.texto.includes('voce@exemplo.com'), 'tooltip e barra trazem o e-mail completo (fictício)');
    afirma(b.nome.visivel && b.nome.texto === 'Empresa Demo' && b.email.visivel && b.email.texto === 'voce@exemplo.com' && !b.email.cortado,
      `organização "${b.nome.texto}" e e-mail "${b.email.texto}" inteiros à vista`);
    afirma(b.title.includes(`Ambiente: ${HOST}`), `tooltip com o ambiente (${HOST})`);
    afirma(b.aria === 'Consumo do plano do Claude Code', `aria-label do grupo: ${b.aria}`);
    afirma(b.select.visivel && b.select.opcoes.join('|') === `Claude (${HOST})|Codex (${HOST})` && b.select.valor === 'claude:local',
      `seletor com ${b.select.opcoes.join(' | ')}, aberto em ${b.select.valor}`);
    await app.foto('normal-1366x768');
    // regressão da página Claude: um limite normal continua sem classe de nível
    await app.pagina('claude');
    const fills = await app.ev(`[...document.querySelectorAll('#limits-list .limit-fill')].map(e => e.className.trim())`);
    afirma(fills.join('|') === 'limit-fill|limit-fill', `página Claude sem classe de nível em 42% e 27%: ${JSON.stringify(fills)}`);
  });
};

CENARIOS['niveis'] = async () => {
  await comApp({ status: { five: 75, seven: 95 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    await sleep(800);
    const b = await lerBarra(app);
    afirma(b.itens[0].fillBg === COR.laranja, `75% é laranja (${b.itens[0].fillBg})`);
    afirma(b.itens[1].fillBg === COR.vermelho, `95% é vermelho (${b.itens[1].fillBg})`);
    afirma(b.itens.map(i => i.classe.includes('warn') + '/' + i.classe.includes('danger')).join('|') === 'true/false|false/true', `classes: ${b.itens.map(i => i.classe).join(' | ')}`);
    await app.pagina('claude');
    const pag = await app.ev(`[...document.querySelectorAll('#limits-list .limit-row')].map(r => ({ fill: r.querySelector('.limit-fill').className.trim(), pct: r.querySelector('.limit-pct').className.trim(), texto: r.querySelector('.limit-pct').textContent }))`);
    afirma(pag.length === 2 && pag[0].fill === 'limit-fill warn' && pag[1].fill === 'limit-fill danger', `página Claude: ${JSON.stringify(pag.map(p => p.fill))}`);
    afirma(pag[0].pct === 'limit-pct warn' && pag[1].pct === 'limit-pct danger', `página Claude, percentuais: ${JSON.stringify(pag.map(p => p.pct))}`);
    await app.foto('niveis-pagina-claude-75-95');
    await app.pagina('devcode');
    await app.foto('niveis-ide-75-95');
  });
};

CENARIOS['velho'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 20 * 60000, codexIdadeMs: 20 * 60000, janela: { w: 1366, h: 768 } }, async (app, sb) => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-bar').title.includes('Empresa Demo')`, 20000, 'tooltip com a conta');
    await sleep(800);
    const mtime = fs.statSync(sb.statusFile).mtimeMs;
    const hora = horaLocal(mtime);
    const b = await lerBarra(app);
    afirma(b.itens.map(i => i.pct).join('|') === '42%|27%', 'os percentuais continuam à vista');
    afirma(b.itens.every(i => i.pctCor === COR.muted), `percentual em cinza (${b.itens[0].pctCor})`);
    afirma(b.itens.every(i => i.fillBg === COR.muted), `preenchimento sem a cor de nível (${b.itens[0].fillBg})`);
    afirma(b.itens.every(i => i.classe.includes('stale')), 'classe stale nos dois itens');
    afirma(b.title.includes(`lido às ${hora}`), `tooltip com a hora da leitura (${hora}): ${JSON.stringify(b.title)}`);
    afirma(b.itens.every(i => i.valuetext.endsWith(`, lido às ${hora}`)), `aria-valuetext: ${JSON.stringify(b.itens[0].valuetext)}`);
    await app.foto('velho-1366x768');
    // o Codex segue a mesma regra de 15 minutos: o evento do rollout tem 20 minutos
    await selecionar(app, 'codex:local');
    const horaCodex = horaLocal(fs.statSync(path.join(sb.home, '.codex', 'sessions', '2026', '10', '03', 'rollout-e2e-demo.jsonl')).mtimeMs);
    const c = await lerBarra(app);
    afirma(c.itens.length === 1 && c.itens[0].rotulo === 'Semanal' && c.itens[0].classe.includes('stale'), 'Codex: o semanal fica em cinza (stale)');
    afirma(c.itens[0].pctCor === COR.muted && c.itens[0].fillBg === COR.muted, 'Codex: percentual e preenchimento em cinza');
    afirma(c.title.includes(`lido às ${horaCodex}`), `Codex: tooltip com a hora do evento (${horaCodex}): ${JSON.stringify(c.title)}`);
    await app.foto('velho-codex-1366x768');
  });
};

CENARIOS['contraste'] = async () => {
  await comApp({ status: { five: 50, seven: 50 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await sleep(800);
    const verifica = async nome => {
      const b = await lerBarra(app);
      afirma(b.itens.length === 2, `${nome}: dois itens`);
      afirma(contraste(b.nome.cor, b.fundo) >= 4.5, `${nome}: organização ${contraste(b.nome.cor, b.fundo).toFixed(1)}:1 (mínimo 4,5)`);
      afirma(contraste(b.email.cor, b.fundo) >= 4.5, `${nome}: e-mail ${contraste(b.email.cor, b.fundo).toFixed(1)}:1 (mínimo 4,5)`);
      afirma(contraste(b.select.cor, b.select.fundo) >= 4.5, `${nome}: seletor ${contraste(b.select.cor, b.select.fundo).toFixed(1)}:1 (mínimo 4,5)`);
      for (const i of b.itens) {
        const cr = contraste(i.rotCor, b.fundo), cp = contraste(i.pctCor, b.fundo), cf = contraste(i.fillBg, i.trilhoBg);
        afirma(cr >= 4.5, `${nome}, ${i.rotulo}: rótulo ${cr.toFixed(1)}:1 (mínimo 4,5)`);
        afirma(cp >= 4.5, `${nome}, ${i.rotulo}: percentual ${cp.toFixed(1)}:1 (mínimo 4,5)`);
        afirma(cf >= 3, `${nome}, ${i.rotulo}: preenchimento sobre o trilho ${cf.toFixed(1)}:1 (mínimo 3)`);
      }
    };
    await verifica('ok');
    escreverStatus(sb, { five: 75, seven: 75 }, 30000);
    await atualiza(app); await barraTem(app, ['75%', '75%'], 15000); await sleep(600);
    await verifica('warn');
    escreverStatus(sb, { five: 95, seven: 95 }, 30000);
    await atualiza(app); await barraTem(app, ['95%', '95%'], 15000); await sleep(600);
    await verifica('danger');
    escreverStatus(sb, { five: 95, seven: 95 }, 20 * 60000);
    await atualiza(app);
    await app.espera(`document.querySelector('#consumo-bar .consumo-item').classList.contains('stale')`, 15000, 'estado antigo');
    await sleep(600);
    await verifica('stale');
    // sem limites o texto "sem dados" também passa no contraste
    apagarStatus(sb);
    await atualiza(app);
    await app.espera(`!document.getElementById('consumo-semdados').hidden`, 15000, 'texto sem dados');
    const sd = await lerBarra(app);
    afirma(contraste(sd.semDadosCor, sd.fundo) >= 4.5, `sem dados: ${contraste(sd.semDadosCor, sd.fundo).toFixed(1)}:1 (mínimo 4,5)`);
  });
};

CENARIOS['refresh'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    // longe do tick de 60 s: assim só o clique em ↻ pode explicar a mudança
    await app.espera(`(() => { const m = performance.now() % 60000; return m > 12000 && m < 40000; })()`, 60000, 'meio do intervalo do timer');
    escreverStatus(sb, { five: 63, seven: 27 }, 30000);
    const t0 = Date.now();
    await atualiza(app);
    await barraTem(app, ['63%', '27%'], 6000);
    afirma(Date.now() - t0 < 6000, `a barra mudou ${Date.now() - t0} ms depois do clique em ↻, sem esperar o timer`);
  });
};

CENARIOS['ritmo'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    // 1) o dado muda sem ninguém clicar em nada: o timer de 60 s traz o novo valor
    escreverStatus(sb, { five: 88, seven: 27 }, 30000);
    let t = Date.now();
    await barraTem(app, ['88%', '27%'], 70000);
    afirma(true, `a barra passou a 88% sozinha, em ${Math.round((Date.now() - t) / 1000)} s`);
    await sleep(700);
    afirma((await lerBarra(app)).itens[0].fillBg === COR.laranja, '88% ficou laranja');
    // 2) o dado some: os limites somem e a conta fica com "sem dados" (a barra só some sem conta)
    apagarStatus(sb);
    t = Date.now();
    await barraTem(app, [], 70000);
    afirma((await lerBarra(app)).semDados, `os limites sumiram sozinhos sem o arquivo, em ${Math.round((Date.now() - t) / 1000)} s, e a barra diz "sem dados"`);
    // 3) o dado volta: a barra volta
    escreverStatus(sb, { five: 10, seven: 20 }, 30000);
    t = Date.now();
    await barraTem(app, ['10%', '20%'], 70000);
    afirma(true, `a barra voltou sozinha com o arquivo, em ${Math.round((Date.now() - t) / 1000)} s`);
    // 4) o Codex também chega pelo timer de 60 s (canal leve), sem ↻ e sem esperar o scan
    await selecionar(app, 'codex:local');
    await barraTem(app, ['9%']);
    escreverCodexLimites(sb, { pct: 61 });
    t = Date.now();
    await barraTem(app, ['61%'], 70000);
    afirma(true, `o Codex passou a 61% sozinho, em ${Math.round((Date.now() - t) / 1000)} s`);
  });
};

CENARIOS['larguras'] = async () => {
  await comApp({ status: { five: 100, seven: 100 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    for (const [w, h] of [[1920, 1080], [1366, 768], [960, 720], [580, 480]]) {
      await app.tamanho(w, h);
      await sleep(600);
      const m = await app.ev(`(() => {
        const r = s => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.x, r: x.right, y: x.y, b: x.bottom, w: x.width, h: x.height }; };
        return { nome: r('.app-name'), barra: r('#consumo-bar'), dir: r('.title-bar-right'), titulo: r('#title-bar'), grade: r('.ws.active .dev-term-grid'),
                 compacto: document.getElementById('consumo-bar').classList.contains('compacto'),
                 itens: [...document.querySelectorAll('#consumo-bar .consumo-item')].map(i => { const x = i.getBoundingClientRect(); return { y: x.y, h: x.height }; }),
                 rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      })()`);
      const tag = `${w}x${h}`;
      afirma(m.barra.x >= m.nome.r && m.barra.r <= m.dir.x, `${tag}: a barra (${m.barra.x.toFixed(0)}..${m.barra.r.toFixed(0)}) cabe entre o nome (fim ${m.nome.r.toFixed(0)}) e os botões (início ${m.dir.x.toFixed(0)}); ${m.barra.w.toFixed(0)} px, sobram ${(m.dir.x - m.nome.r - m.barra.w).toFixed(0)} px`);
      const lb = await lerBarra(app);
      afirma(lb.itens.length === 2 && lb.select.visivel, `${tag}: os dois itens de limite e o seletor continuam à vista`);
      afirma(!m.compacto || (!lb.nome.visivel && !lb.email.visivel), `${tag}: nome ${lb.nome.visivel ? 'visível' : 'oculto'}, e-mail ${lb.email.visivel ? 'visível' : 'oculto'}, seletor ${m.compacto ? 'compacto: ' + lb.select.opcoes.join(' | ') : 'completo: ' + lb.select.opcoes.join(' | ')}, barra ${m.barra.w.toFixed(0)} px`);
      if (w >= 1366) afirma(lb.nome.visivel && lb.email.visivel && !lb.email.cortado, `${tag}: organização e e-mail inteiros`);
      if (w === 580) afirma(m.compacto && !lb.email.visivel && !lb.nome.visivel && lb.select.opcoes.join('|') === 'Claude|Codex', `${tag}: seletor compacto (${lb.select.opcoes.join(' | ')}), sem e-mail e sem nome, os dois itens permanecem`);
      afirma(m.itens.every(i => i.h <= 20 && perto(i.y, m.itens[0].y, 1)), `${tag}: cada item numa linha só (altura ${m.itens.map(i => i.h.toFixed(0)).join('/')})`);
      afirma(m.titulo.h <= 41, `${tag}: a barra de título continua com ${m.titulo.h.toFixed(0)} px`);
      afirma(perto(m.grade.h, h - 128, 2), `${tag}: a grade de terminais mantém ${m.grade.h.toFixed(0)} px (altura ${h} - 128)`);
      afirma(!m.rolagem, `${tag}: sem rolagem horizontal`);
      await app.foto(`larguras-${tag}`);
    }
  });
};

// Seletor de provedor + ambiente: aparece com 2 ou mais opções, some com uma só. O e2e roda com
// RENDRA_HOME falso, então a descoberta de WSL é pulada e só existem as opções do sistema local; os
// rótulos com distro e o caso de 3 opções ficam nos testes unitários (consumo, claude-account-env)
CENARIOS['seletor'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 1366, h: 768 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções no seletor');
    const b = await lerBarra(app);
    afirma(b.select.visivel, 'com Claude e Codex o seletor existe');
    afirma(b.select.opcoes.join('|') === `Claude (${HOST})|Codex (${HOST})`, `rótulos exatos: ${b.select.opcoes.join(' | ')}`);
    afirma(b.select.ids.join('|') === 'claude:local|codex:local', `ids estáveis: ${b.select.ids.join(' | ')}`);
    afirma(b.select.valor === 'claude:local', 'primeira vez: Claude');
    await app.foto('seletor-2-opcoes-1366x768');
  });
  // só o Claude: sem seletor, a barra mostra só a conta
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, semCodex: true, janela: { w: 1366, h: 768 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-nome').textContent === 'Empresa Demo'`, 20000, 'organização na barra');
    const b = await lerBarra(app);
    afirma(!b.select.visivel, 'com uma opção só o seletor não aparece');
    afirma(b.nome.visivel && b.email.visivel && b.itens.length === 2, 'a conta e os dois itens continuam à vista');
    await app.foto('seletor-1-opcao-1366x768');
  });
};

CENARIOS['troca-provedor'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, codexPct: 9, janela: { w: 1366, h: 768 } }, async (app, sb) => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções');
    await selecionar(app, 'codex:local');
    await sleep(800);
    let b = await lerBarra(app);
    afirma(b.nome.texto === CODEX_DEMO.org && b.email.texto === CODEX_DEMO.email, `Codex: organização "${b.nome.texto}" (a padrão, não a primeira) e e-mail "${b.email.texto}"`);
    afirma(b.itens.map(i => i.rotulo).join('|') === 'Semanal' && b.itens[0].pct === '9%', `Codex: só o item Semanal, ${b.itens.map(i => i.pct).join(', ')}`);
    afirma(b.aria === 'Consumo do plano do Codex', `aria-label do grupo: ${b.aria}`);
    afirma(b.title.includes('Pro') && b.title.includes(CODEX_DEMO.email) && b.title.includes(`Ambiente: ${HOST}`), `tooltip do Codex: ${JSON.stringify(b.title)}`);
    afirma(b.select.valor === 'codex:local', 'o seletor mostra Codex');
    await app.foto('troca-provedor-codex-1366x768');
    // o dado do Codex muda e ↻ traz o novo valor, sem esperar o scan
    escreverCodexLimites(sb, { pct: 55 });
    await atualiza(app);
    await barraTem(app, ['55%'], 8000);
    afirma(true, 'Codex: depois de ↻ a barra mostra 55%');
    await selecionar(app, 'claude:local');
    b = await lerBarra(app);
    afirma(b.itens.map(i => i.rotulo).join('|') === '5 Horas|Semanal' && b.itens.map(i => i.pct).join('|') === '42%|27%', 'de volta ao Claude: 5 Horas e Semanal, 42% e 27%');
    afirma(b.nome.texto === 'Empresa Demo' && b.email.texto === 'voce@exemplo.com' && b.aria === 'Consumo do plano do Claude Code', 'de volta ao Claude: organização, e-mail e aria do Claude');
  });
};

CENARIOS['persistencia-provedor'] = async () => {
  const preservadas = { refreshInterval: 600, claudePath: 'C:\\falso\\claude.exe', dailyCostAlert: 7, limitsSource: 'statusline' };
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, settings: { claudePath: preservadas.claudePath, dailyCostAlert: 7 }, janela: { w: 1366, h: 768 } }, async (app, sb) => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções');
    afirma(!('provedorBarra' in lerConfig(sb).settings), 'abrir o app não grava a escolha');
    await selecionar(app, 'codex:local');
    await sleep(800);
    const cfg = lerConfig(sb).settings;
    afirma(cfg.provedorBarra === 'codex:local', `escolher grava o id (${cfg.provedorBarra})`);
    // porta de verdade: o merge de save-settings preserva as outras chaves
    afirma(Object.entries(preservadas).every(([k, v]) => cfg[k] === v), `as outras configurações seguem intactas: ${JSON.stringify(Object.fromEntries(Object.keys(preservadas).map(k => [k, cfg[k]])))}`);
    // reabrir com o mesmo home: a barra abre em Codex
    const novo = await app.reiniciar();
    await barraVisivel(novo);
    await novo.espera(`document.getElementById('consumo-provedor').value === 'codex:local'`, 20000, 'abriu no Codex');
    const b = await lerBarra(novo);
    afirma(b.select.valor === 'codex:local' && b.nome.texto === CODEX_DEMO.org && b.itens.map(i => i.rotulo).join('|') === 'Semanal', 'depois de reabrir a barra abre em Codex');
    afirma(lerConfig(sb).settings.provedorBarra === 'codex:local', 'reabrir não regravou outro valor');
  });
  // escolha lembrada que não existe mais (distro parada): usa o padrão e NÃO sobrescreve a escolha
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, settings: { provedorBarra: 'codex:wsl:Sumiu' }, janela: { w: 1366, h: 768 } }, async (app, sb) => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções');
    await sleep(1500);
    const b = await lerBarra(app);
    afirma(b.select.valor === 'claude:local', `opção lembrada ausente: abre no padrão (${b.select.valor})`);
    afirma(lerConfig(sb).settings.provedorBarra === 'codex:wsl:Sumiu', 'e a escolha lembrada continua gravada, intacta');
  });
};

// A barra nunca leva token ao renderer: nenhum dos valores sentinela de auth.json aparece no DOM
CENARIOS['seguranca-codex'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 1366, h: 768 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções');
    await selecionar(app, 'codex:local');
    await sleep(800);
    const dump = await app.ev(`(() => {
      const attrs = [...document.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.name + '=' + a.value)).join('\\n');
      return document.documentElement.outerHTML + '\\n' + document.body.innerText + '\\n' + attrs;
    })()`);
    afirma((await lerBarra(app)).email.texto === CODEX_DEMO.email, 'controle: o e-mail do Codex está na barra (o leitor funcionou)');
    for (const t of SENT) afirma(!dump.includes(t), `o DOM, os title e os aria não contêm o sentinela ${t.slice(0, 14)}…`);
    afirma(!/access_token|refresh_token|id_token/.test(dump), 'nenhuma chave de token aparece no DOM');
    // pela porta do IPC: nenhum valor sentinela sai nem do canal
    const ipc = await app.ev(`Promise.all([window.rendra.providerSnapshot({ wsl: false }), window.rendra.providerSnapshot({ wsl: true })]).then(r => JSON.stringify(r))`);
    afirma(ipc.includes(CODEX_DEMO.email), 'controle: o canal devolve o e-mail do Codex');
    for (const t of SENT) afirma(!ipc.includes(t), `o retorno do canal provider:snapshot não contém ${t.slice(0, 14)}…`);
    afirma(!/access_token|refresh_token|id_token|accessToken/.test(ipc), 'o retorno do canal não tem chave de token');
  });
};

// E-mail e nome longos (32 e 30 caracteres): o espaço que falta tira primeiro o e-mail (antes, com
// reticências), depois o nome, por fim o seletor vira compacto; nada empurra os botões. Os cortes
// ficam registrados no log (dependem da fonte), a asserção é sobre a ordem e o encaixe
CENARIOS['email-largura'] = async () => {
  const contaClaude = { email: 'maria.fernanda.souza@empresa.com', org: 'Organização Demonstração Ltda', nome: 'Maria Fernanda' };
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, contaClaude, janela: { w: 1920, h: 1080 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-provedor').options.length === 2`, 20000, 'duas opções');
    await app.espera(`document.getElementById('consumo-email').textContent.includes('@')`, 20000, 'e-mail na barra');
    const larguras = [1920, 1366, 1100, 1000, 960, 900, 860, 820, 780, 740, 700, 660, 620, 580];
    const linhas = [];
    for (const w of larguras) {
      await app.tamanho(w, 720);
      await sleep(500);
      const b = await lerBarra(app);
      const m = await app.ev(`(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { nomeR: r('.app-name').right, dirX: r('.title-bar-right').x, rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth, tituloH: r('#title-bar').height }; })()`);
      linhas.push({ w, reticencias: b.email.reticencias && b.nome.reticencias, email: b.email.visivel, emailCortado: b.email.cortado, nome: b.nome.visivel, nomeCortado: b.nome.cortado, compacto: b.compacto, sel: b.select.opcoes.join(' | ') });
      afirma(b.rect.x >= m.nomeR - 0.5 && b.rect.r <= m.dirX + 0.5, `${w}: a barra (${b.rect.x.toFixed(0)}..${b.rect.r.toFixed(0)}) cabe entre o nome do app (${m.nomeR.toFixed(0)}) e os botões (${m.dirX.toFixed(0)})`);
      afirma(b.itens.length === 2 && !m.rolagem && m.tituloH <= 41, `${w}: os dois itens à vista, sem rolagem, título com ${m.tituloH.toFixed(0)} px`);
      afirma(!b.email.visivel || b.nome.visivel, `${w}: o e-mail só aparece com o nome (o e-mail sai primeiro)`);
      afirma(!b.nome.visivel || !b.compacto, `${w}: o nome só aparece com o seletor completo (o seletor compacta por último)`);
      console.log(`    ${w}: e-mail ${b.email.visivel ? (b.email.cortado ? 'com reticências' : 'inteiro') : 'oculto'}, nome ${b.nome.visivel ? (b.nome.cortado ? 'com reticências' : 'inteiro') : 'oculto'}, seletor ${b.compacto ? 'compacto' : 'completo'}, barra ${b.rect.w.toFixed(0)} px`);
    }
    const por = w => linhas.find(l => l.w === w);
    afirma(por(1920).email && !por(1920).emailCortado && por(1920).nome && !por(1920).nomeCortado, '1920: e-mail e nome inteiros');
    afirma(linhas.some(l => l.email && l.emailCortado && l.reticencias), 'em alguma largura o e-mail aparece encurtado, com text-overflow: ellipsis (reticências)');
    afirma(linhas.some(l => !l.email && l.nome), 'em alguma largura só o nome sobra (e-mail fora)');
    afirma(linhas.some(l => !l.email && !l.nome && !l.compacto), 'em alguma largura só o seletor completo sobra (nome fora)');
    afirma(por(580).compacto && !por(580).email && !por(580).nome && por(580).sel === 'Claude | Codex', `580: seletor compacto (${por(580).sel}), sem nome e sem e-mail`);
    await app.tamanho(580, 720);
    await sleep(500);
    await app.foto('email-largura-580x720');
    await app.tamanho(960, 720);
    await sleep(500);
    await app.foto('email-largura-960x720');
  });
};

CENARIOS['outras-paginas'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    for (const pagina of ['devcode', 'terminal', 'claude', 'rtk', 'codex', 'precos', 'novidades', 'sobre']) {
      await app.pagina(pagina);
      const b = await lerBarra(app);
      afirma(b.visivel && b.itens.length === 2, `página ${pagina}: a barra continua visível`);
    }
  });
};

// D-A: a barra lê só o arquivo da statusline, mesmo no modo `api` das Configurações e sem login
CENARIOS['modo-api'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, semCredenciais: true, settings: { limitsSource: 'api' } }, async app => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    afirma(true, 'no modo api, sem login, a barra mostra 42% e 27% (lê só a statusline)');
    await app.pagina('claude');
    await app.espera(`document.getElementById('limits-list').textContent.includes('Sem login ativo no Claude Code')`, 15000, 'card da página Claude sem login');
    afirma(true, 'a página Claude, pelo canal claude-account, diz "Sem login ativo no Claude Code" (sem rede)');
  });
};

// ── Painel do editor: leitura e ajudantes ───────────────────────────────────
const LER_PAINEL = `(() => {
  const ws = document.querySelector('.ws.active');
  const r = e => { if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height, r: x.right, b: x.bottom }; };
  const ed = ws.querySelector('.dev-editors');
  const sp = ws.querySelector('.dev-splitter[data-split=editor]');
  const btn = ws.querySelector('[data-acao=alternar-editor]');
  const ativo = document.activeElement;
  const paineis = [...ws.querySelectorAll('.term-pane')];
  return {
    escondido: ws.classList.contains('editor-hidden'),
    ed: r(ed), edDisplay: getComputedStyle(ed).display, spDisplay: getComputedStyle(sp).display,
    terms: r(ws.querySelector('.dev-terms')),
    corpo: r(ws.querySelector('.term-pane-body')), tela: r(ws.querySelector('.term-pane-body .xterm-screen')),
    host: r(ws.querySelector('.dev-editor-host')), monaco: r(ws.querySelector('.monaco-editor')),
    abas: [...ws.querySelectorAll('.dev-tab')].map(t => ({ nome: t.querySelector('.dev-tab-name').textContent, sujo: t.classList.contains('dirty'), marca: t.querySelector('.dev-tab-close').textContent, ativa: t.classList.contains('active') })),
    botao: btn && { pressed: btn.getAttribute('aria-pressed'), title: btn.title, label: btn.getAttribute('aria-label') },
    temX: !!ws.querySelector('[data-acao=esconder-editor]'),
    modal: document.getElementById('save-overlay').classList.contains('visible'),
    noEditor: !!ativo.closest('.dev-editors'), ativoTag: ativo.tagName,
    ativoPainel: paineis.findIndex(p => p.contains(ativo)),
    focadoPainel: paineis.findIndex(p => p.classList.contains('focused')),
    primeiroPainel: 0,
    wsW: r(ws).w,
  };
})()`;
const lerPainel = app => app.ev(LER_PAINEL);
const esperaFrames = () => sleep(500);
const abrirArquivo = async (app, nome) => {
  await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(nome)})?.click()`);
  await app.espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === ${JSON.stringify(nome)})`, 15000, `aba ${nome} ativa`);
  await app.espera(`!!document.querySelector('.ws.active .monaco-editor')`, 15000, 'Monaco criado');
  await sleep(300);
};
const alternarEditor = async app => { await app.clica('.ws.active [data-acao="alternar-editor"]'); await esperaFrames(); };
const textoDoModelo = (app, nome) => app.ev(`window.monaco?.editor.getModels().find(m => m.uri.path.endsWith('/${nome}'))?.getValue() ?? null`);
const esperaConfig = async (sb, cond, ms = 6000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { try { if (cond(lerConfig(sb).devcode.workspaces)) return true; } catch { /* arquivo sendo gravado */ } await sleep(200); }
  return false;
};
const sobra = p => p.corpo.w - p.tela.w; // folga à direita do xterm dentro do painel

CENARIOS['painel-esconde'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await abrirArquivo(app, 'a.txt');
    await app.digita('x');
    await sleep(300);
    const antes = await lerPainel(app);
    afirma(!antes.escondido && antes.ed.w > 400, `painel visível com ${antes.ed.w.toFixed(0)} px`);
    afirma(antes.abas.length === 1 && antes.abas[0].nome === 'a.txt' && antes.abas[0].sujo && antes.abas[0].marca === '●', `aba a.txt com ● (${JSON.stringify(antes.abas)})`);
    afirma(antes.botao.pressed === 'true' && antes.botao.title === 'Esconder editor' && antes.botao.label === 'Esconder editor', `botão: ${JSON.stringify(antes.botao)}`);
    await app.foto('painel-visivel-1920x1080');

    // 1) botão do cabeçalho dos terminais esconde
    await alternarEditor(app);
    const depois = await lerPainel(app);
    afirma(depois.escondido && depois.edDisplay === 'none' && depois.ed.w === 0, `coluna do editor sumiu (display ${depois.edDisplay}, ${depois.ed.w} px)`);
    afirma(depois.spDisplay === 'none', 'o splitter do editor também sumiu (não dá para arrastar)');
    afirma(depois.abas.length === 1 && depois.abas[0].nome === 'a.txt' && depois.abas[0].sujo && depois.abas[0].marca === '●', 'a aba a.txt e o ● continuam no DOM: nada foi fechado');
    afirma(!depois.modal, 'nenhuma pergunta de salvar apareceu');
    afirma(await textoDoModelo(app, 'a.txt') === 'xprimeiro arquivo\nlinha dois\n', 'o texto digitado continua no modelo do Monaco');
    afirma(depois.terms.w > 1350 && antes.terms.w < 950, `terminais foram de ${antes.terms.w.toFixed(0)} para ${depois.terms.w.toFixed(0)} px`);
    afirma(depois.tela.w > antes.tela.w + 350 && sobra(depois) < 24, `xterm reajustado: tela ${antes.tela.w.toFixed(0)} -> ${depois.tela.w.toFixed(0)} px, folga ${sobra(depois).toFixed(0)} px`);
    afirma(depois.botao.pressed === 'false' && depois.botao.title === 'Mostrar editor' && depois.botao.label === 'Mostrar editor', `botão: ${JSON.stringify(depois.botao)}`);
    await app.foto('painel-escondido-1920x1080');

    // 2) o mesmo botão mostra de volta, na largura salva
    await alternarEditor(app);
    const volta = await lerPainel(app);
    afirma(!volta.escondido && perto(volta.ed.w, antes.ed.w, 2), `coluna voltou com ${volta.ed.w.toFixed(0)} px (antes ${antes.ed.w.toFixed(0)})`);
    afirma(volta.abas[0]?.sujo && volta.abas[0].marca === '●', 'a aba a.txt continua com ●');
    afirma(await textoDoModelo(app, 'a.txt') === 'xprimeiro arquivo\nlinha dois\n', 'o texto digitado continua intacto');
    afirma(volta.monaco && volta.monaco.w > 100 && volta.monaco.h > 100 && perto(volta.monaco.w, volta.host.w, 2) && perto(volta.monaco.h, volta.host.h, 2),
      `Monaco ${volta.monaco?.w.toFixed(0)}x${volta.monaco?.h.toFixed(0)} px, igual ao host ${volta.host.w.toFixed(0)}x${volta.host.h.toFixed(0)}`);
    afirma(perto(volta.terms.w, antes.terms.w, 2) && sobra(volta) < 24, `terminais voltaram a ${volta.terms.w.toFixed(0)} px, folga ${sobra(volta).toFixed(0)} px`);

    const iconeEsconder = await app.ev(`(() => { const b = document.querySelector('.ws.active [data-acao="esconder-editor"]'); return { texto: b.textContent.trim(), svg: !!b.querySelector('svg'), title: b.title }; })()`);
    afirma(iconeEsconder.texto === '' && iconeEsconder.svg && iconeEsconder.title === 'Esconder painel do editor', `Esconder painel usa seta, não ✕ (${JSON.stringify(iconeEsconder)})`);

    // 3) o ✕ da coluna esconde, e o foco vai para um terminal (nunca para o editor escondido)
    await app.ev(`document.querySelector('.ws.active [data-acao="esconder-editor"]').focus()`);
    afirma((await lerPainel(app)).noEditor, 'antes: o foco está no ✕, dentro da coluna do editor');
    await app.clica('.ws.active [data-acao="esconder-editor"]');
    await esperaFrames();
    const viaX = await lerPainel(app);
    afirma(viaX.escondido && viaX.ed.w === 0, 'o ✕ escondeu a coluna');
    afirma(!viaX.noEditor && viaX.ativoTag !== 'BODY' && viaX.ativoPainel === 0 && viaX.focadoPainel === 0,
      `foco em vez disso no primeiro terminal vivo (activeElement ${viaX.ativoTag}, painel ${viaX.ativoPainel}, .focused ${viaX.focadoPainel})`);
    await app.foto('painel-escondido-via-x');

    // 4) se o foco já estava no botão do cabeçalho, ele fica lá (uso por teclado)
    await app.ev(`document.querySelector('.ws.active [data-acao="alternar-editor"]').focus()`);
    await app.clica('.ws.active [data-acao="alternar-editor"]');
    await esperaFrames();
    const mostrou = await lerPainel(app);
    afirma(!mostrou.escondido, 'o botão mostrou de novo');
    afirma(await app.ev(`document.activeElement === document.querySelector('.ws.active [data-acao="alternar-editor"]')`), 'o foco ficou no botão');
  });
};

CENARIOS['painel-reabre'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await abrirArquivo(app, 'a.txt');
    const inicial = await lerPainel(app);
    await alternarEditor(app);
    afirma((await lerPainel(app)).escondido, 'painel escondido');
    // abrir outro arquivo pelo explorador reabre o painel, na largura salva
    await abrirArquivo(app, 'b.txt');
    await sleep(500);
    const p = await lerPainel(app);
    afirma(!p.escondido && perto(p.ed.w, inicial.ed.w, 2), `o painel reapareceu com ${p.ed.w.toFixed(0)} px (salva: ${inicial.ed.w.toFixed(0)})`);
    afirma(p.abas.some(a => a.nome === 'b.txt' && a.ativa), `aba b.txt ativa (${JSON.stringify(p.abas.map(a => a.nome))})`);
    afirma(p.noEditor, 'o foco está no editor (o arquivo foi aberto para editar)');
    afirma(p.monaco && p.monaco.w > 100 && p.monaco.h > 100 && perto(p.monaco.w, p.host.w, 2), `Monaco ${p.monaco?.w.toFixed(0)}x${p.monaco?.h.toFixed(0)} px`);
    afirma(p.botao.pressed === 'true', 'o botão voltou ao estado "esconder"');
    await app.foto('painel-reabre-1920x1080');
  });
  // desde "nunca abriu arquivo": Monaco ainda nem foi carregado
  await comApp({ workspaces: [{ name: 'demo', cols: 2, editorHidden: true }] }, async app => {
    const zero = await lerPainel(app);
    afirma(zero.escondido && zero.ed.w === 0 && zero.abas.length === 0, 'começa escondido, sem abas');
    await app.clica('.ws.active .dev-node.file .dev-node-name');
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 15000, 'aba aberta');
    await app.espera(`!!document.querySelector('.ws.active .monaco-editor')`, 15000, 'Monaco criado');
    await sleep(600);
    const p = await lerPainel(app);
    afirma(!p.escondido && p.ed.w > 400, `abrir um arquivo reabriu o painel (${p.ed.w.toFixed(0)} px)`);
    afirma(p.monaco && p.monaco.w > 100 && p.monaco.h > 100 && perto(p.monaco.w, p.host.w, 2) && perto(p.monaco.h, p.host.h, 2), `editor renderizado com ${p.monaco?.w.toFixed(0)}x${p.monaco?.h.toFixed(0)} px`);
  });
};

CENARIOS['painel-arranque'] = async () => {
  await comApp({}, async (app, sb) => {
    await abrirArquivo(app, 'a.txt');
    await alternarEditor(app);
    afirma(await esperaConfig(sb, w => w.list[0].editorHidden === true && w.list[0].groups[0]?.tabs.length === 1), 'o store gravou o painel escondido com a aba aberta');
    await sleep(500);
    const novo = await app.reiniciar();
    await novo.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba restaurada');
    await sleep(800);
    const p = await lerPainel(novo);
    afirma(p.escondido && p.ed.w === 0, 'reabriu com o painel ESCONDIDO');
    afirma(p.abas.length === 1 && p.abas[0].nome === 'a.txt', 'a aba a.txt foi restaurada por baixo');
    afirma(p.terms.w > 1350 && sobra(p) < 24, `terminais ocupando o espaço (${p.terms.w.toFixed(0)} px, folga ${sobra(p).toFixed(0)})`);
    await alternarEditor(novo);
    const m = await lerPainel(novo);
    afirma(!m.escondido && m.ed.w > 400, `mostrar: coluna com ${m.ed.w.toFixed(0)} px`);
    afirma(m.monaco && m.monaco.w > 100 && m.monaco.h > 100 && perto(m.monaco.w, m.host.w, 2) && perto(m.monaco.h, m.host.h, 2),
      `Monaco criado escondido agora com ${m.monaco?.w.toFixed(0)}x${m.monaco?.h.toFixed(0)} px (host ${m.host.w.toFixed(0)}x${m.host.h.toFixed(0)})`);
    await novo.foto('painel-arranque-mostrado');
  });
};

CENARIOS['persistencia'] = async () => {
  // 1) store da versão antiga (sem o campo): abre com os dois visíveis e as abas restauradas
  await comApp({ workspaces: [
    { name: 'A', cols: 2, groups: [{ tabs: ['@a.txt'], active: '@a.txt' }], editorHidden: undefined },
    { name: 'B', cols: 1, groups: [{ tabs: ['@b.txt'], active: '@b.txt' }] },
  ] }, async (app, sb) => {
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba do primeiro workspace');
    const p1 = await lerPainel(app);
    afirma(!p1.escondido && p1.ed.w > 400 && p1.abas[0]?.nome === 'a.txt', 'store antigo: o primeiro abre com o painel visível e a aba restaurada');
    await alternarEditor(app);
    afirma(await esperaConfig(sb, w => w.list[0].editorHidden === true && w.list[1].editorHidden === false), 'gravou editorHidden: true no primeiro e false no segundo');
    await app.clica('.ws-tab:nth-child(2)');
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 15000, 'aba do segundo workspace');
    await sleep(600);
    const p2 = await lerPainel(app);
    afirma(!p2.escondido && p2.ed.w > 400 && p2.abas[0]?.nome === 'b.txt', 'o estado é por workspace: o segundo continua visível');
    await sleep(500);
    const novo = await app.reiniciar();
    await novo.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba restaurada depois de reiniciar');
    await sleep(600);
    // o app reabre no workspace que estava ativo (o segundo); confere os dois
    const seg = await lerPainel(novo);
    afirma(!seg.escondido, 'depois de reiniciar, o segundo (ativo) abre visível');
    await novo.clica('.ws-tab:nth-child(1)');
    await sleep(800);
    const pri = await lerPainel(novo);
    afirma(pri.escondido && pri.abas[0]?.nome === 'a.txt', 'depois de reiniciar, o primeiro abre escondido, com a aba restaurada');
  });
  // 2) B3: um workspace escondido e nunca ativado na sessão não perde o estado na primeira gravação
  await comApp({ workspaces: [
    { name: 'A', cols: 1, groups: [{ tabs: ['@a.txt'], active: '@a.txt' }], editorHidden: false },
    { name: 'B', cols: 1, groups: [{ tabs: ['@b.txt'], active: '@b.txt' }], editorHidden: true },
  ], ativo: 0 }, async (app, sb) => {
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba do workspace ativo');
    await sleep(1500); // bem mais que os 300 ms do debounce do persist
    const w = lerConfig(sb).devcode.workspaces;
    afirma(w.list[0].editorHidden === false && w.list[1].editorHidden === true, `sem clicar em B, o store segue com B escondido (${JSON.stringify(w.list.map(x => x.editorHidden))})`);
    await app.clica('.ws-tab:nth-child(2)');
    await app.espera(`document.querySelector('.ws.active .dev-tab')?.textContent.includes('b.txt')`, 15000, 'workspace B ativo');
    await sleep(600);
    const p = await lerPainel(app);
    afirma(p.escondido && p.ed.w === 0, 'ao abrir B, o painel dele está escondido');
    await sleep(1000);
    const w2 = lerConfig(sb).devcode.workspaces;
    afirma(w2.list[1].editorHidden === true, 'e continua gravado como escondido');
  });
};

CENARIOS['painel-por-workspace'] = async () => {
  await comApp({ workspaces: [{ name: 'A', cols: 2 }, { name: 'B', cols: 2 }] }, async app => {
    await alternarEditor(app); // esconde o painel do A
    const a1 = await lerPainel(app);
    afirma(a1.escondido, 'A: escondido');
    await app.clica('.ws-tab:nth-child(2)');
    await sleep(800);
    const b = await lerPainel(app);
    afirma(!b.escondido && b.ed.w > 400 && b.botao.pressed === 'true', `B: continua visível (${b.ed.w.toFixed(0)} px)`);
    await app.clica('.ws-tab:nth-child(1)');
    await sleep(800);
    const a2 = await lerPainel(app);
    afirma(a2.escondido && a2.ed.w === 0 && a2.botao.pressed === 'false', 'A: voltou escondido');
    afirma(a2.terms.w > 1350 && sobra(a2) < 24, `A: terminais com o layout certo ao voltar (${a2.terms.w.toFixed(0)} px, folga ${sobra(a2).toFixed(0)})`);
  });
};

CENARIOS['painel-terminal'] = async () => {
  await comApp({}, async app => {
    const ide = await app.ev(`document.querySelectorAll('.ws.active [data-acao="alternar-editor"]').length`);
    afirma(ide === 1, 'na IDE o botão existe');
    await app.pagina('terminal');
    await abrirTerminal(app, '#page-terminal');
    const n = await app.ev(`document.querySelectorAll('#page-terminal [data-acao="alternar-editor"], #term-page [data-acao="alternar-editor"]').length`);
    afirma(n === 0, 'na página Terminal o botão não existe');
    const acoes = await app.ev(`[...document.querySelectorAll('#term-page .dev-panel-actions > *')].map(e => e.tagName + (e.dataset.act ? ':' + e.dataset.act : ''))`);
    afirma(acoes.join(',') === 'DIV,SELECT,BUTTON:new-term', `cabeçalho dos terminais da página Terminal igual ao de antes: ${acoes.join(',')}`);
  });
};

CENARIOS['painel-janela-minima'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 580, h: 480 } }, async app => {
    await abrirArquivo(app, 'a.txt');
    await alternarEditor(app);
    const p = await lerPainel(app);
    const rolagem = await app.ev(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
    afirma(p.escondido && p.ed.w === 0, 'a 580x480 o painel escondeu');
    afirma(!rolagem, 'sem rolagem horizontal');
    afirma(perto(p.terms.r, 580, 2), `os terminais chegam até a borda direita (${p.terms.r.toFixed(0)} de 580)`);
    afirma(sobra(p) < 24, `xterm reajustado (folga ${sobra(p).toFixed(0)} px)`);
    await app.foto('painel-escondido-580x480');
    await alternarEditor(app);
    await app.foto('painel-visivel-580x480');
  });
};

CENARIOS['painel-sem-atalho'] = async () => {
  await comApp({}, async app => {
    await abrirArquivo(app, 'a.txt');
    const antes = await lerPainel(app);
    for (const tecla of ['b', 'j']) {
      await app.tecla(tecla, { ctrl: true });
      await sleep(300);
    }
    const depois = await lerPainel(app);
    afirma(antes.escondido === depois.escondido && !depois.escondido, 'Ctrl+B e Ctrl+J não mexem no painel');
  });
};

CENARIOS['painel-x-no-canto'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 1366, h: 768 } }, async app => {
    await abrirArquivo(app, 'a.txt');
    await app.clica('.ws.active [data-act="split"]'); // dois quadros: o ✕ novo fica no canto do último
    await app.espera(`document.querySelectorAll('.ws.active .dev-group').length === 2`, 10000, 'segundo quadro');
    await sleep(500);
    const c = await app.ev(`(() => {
      const r = e => { const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, r: x.right, b: x.bottom }; };
      const x = document.querySelector('.ws.active [data-acao="esconder-editor"]');
      const grupos = [...document.querySelectorAll('.ws.active .dev-group')];
      const botoes = grupos.flatMap(g => [...g.querySelectorAll('.dev-group-actions .dev-icon-btn')].map(b => ({ acao: b.dataset.act, ...r(b) })));
      const ed = document.querySelector('.ws.active .dev-editors').getBoundingClientRect();
      return { x: r(x), botoes, ed: { x: ed.x, y: ed.y, r: ed.right } };
    })()`);
    const inter = (a, b) => !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
    afirma(c.botoes.length === 4 && c.botoes.every(b => !inter(c.x, b)), `o ✕ novo não cobre Dividir nem Fechar quadro (${c.botoes.length} botões conferidos)`);
    afirma(c.x.r <= c.ed.r + 0.5 && c.x.y >= c.ed.y - 0.5 && c.ed.r - c.x.r < 12, `o ✕ está no canto superior direito da coluna (${c.x.r.toFixed(0)} de ${c.ed.r.toFixed(0)})`);
    await app.foto('painel-canto-x-1366x768', { x: Math.round(c.ed.x), y: Math.round(c.ed.y) - 34, width: Math.round(c.ed.r - c.ed.x), height: 90, scale: 2 });
  });
};

CENARIOS['terminal-manual'] = async () => {
  await comApp({ semTerminal: true }, async (app, sb) => {
    await sleep(1500);
    const vazio = () => app.ev(`(() => {
      const ws = document.querySelector('.ws.active');
      const e = ws.querySelector('.dev-term-empty');
      const b = e.querySelector('button');
      return { panes: ws.querySelectorAll('.term-pane').length, visivel: !e.hidden && e.offsetParent !== null, botao: b.textContent.trim(), titulo: e.textContent.includes('Nenhum terminal aberto') };
    })()`);
    let v = await vazio();
    afirma(v.panes === 0 && v.visivel && v.botao === 'Novo terminal' && v.titulo, `ao abrir a IDE não há terminal e o estado vazio aparece (${JSON.stringify(v)})`);
    await app.foto('terminal-vazio');
    // página Terminal também começa vazia
    await app.pagina('terminal');
    await sleep(800);
    const pag = await app.ev(`({ panes: document.querySelectorAll('#term-page .term-pane').length, vazio: !document.querySelector('#term-page .dev-term-empty').hidden })`);
    afirma(pag.panes === 0 && pag.vazio, `a página Terminal não abre terminal sozinha (${JSON.stringify(pag)})`);
    await app.pagina('devcode');
    await abrirTerminal(app);
    afirma(await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`) === 1, 'o botão do estado do cabeçalho abre exatamente um terminal');
    afirma(await app.ev(`document.querySelector('.ws.active .dev-term-empty').hidden`), 'com terminal aberto, o estado vazio some');
    // o menu: com WSL aparecem Windows e as distros; sem WSL o terminal abriu direto, sem menu
    await app.clica('.ws.active [data-act="new-term"]');
    await sleep(700);
    const menu = await app.ev(`[...document.querySelectorAll('.dev-term-menu button')].map(b => b.textContent)`);
    if (menu.length) {
      afirma(/^Windows \(.+\)$/.test(menu[0]) && menu.slice(1).every(t => /^WSL \(.+\)$/.test(t)), `menu de escolha: ${JSON.stringify(menu)}`);
      await app.foto('terminal-menu');
      await app.tecla('Escape');
      await sleep(200);
      afirma(await app.ev(`!document.querySelector('.dev-term-menu')`), 'Esc fecha o menu');
    } else {
      afirma(await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`) === 2, 'sem WSL: o clique abre o terminal direto, sem menu');
    }
  });
};

// Botão direito no explorador: Novo arquivo e Nova pasta, com o campo de nome inline. Afirma o que
// ficou no disco, o que a árvore mostra e que o arquivo novo abriu no editor.
CENARIOS['explorador-criar'] = async () => {
  await comApp({ semTerminal: true, workspaces: [{ name: 'demo', cols: 1 }] }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-node').length >= 3`, 20000, 'árvore carregada');
    const botaoDireito = async (x, y) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    };
    const centro = async nome => app.ev(`(() => { const n = [...document.querySelectorAll('.ws.active .dev-node')].find(e => e.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(nome)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const enter = async () => {
      const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: '\r' });
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    const esc = async () => {
      const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    const menuItens = () => app.ev(`[...document.querySelectorAll('.dev-ctx-menu button')].map(b => b.textContent)`);
    const escolhe = async rotulo => { await app.ev(`[...document.querySelectorAll('.dev-ctx-menu button')].find(b => b.textContent === ${JSON.stringify(rotulo)}).click()`); await app.espera(`!!document.querySelector('.dev-novo-input')`, 5000, 'campo de nome'); };
    const digita = async nome => { await app.digita(nome); await enter(); };
    const noDisco = (...p) => fs.existsSync(path.join(sb.projeto, ...p));
    const nomesDaArvore = () => app.ev(`[...document.querySelectorAll('.ws.active .dev-node .dev-node-name')].map(e => e.textContent)`);

    // 1) botão direito numa pasta: o arquivo nasce dentro dela, abre no editor e a pasta mostra o item
    let c = await centro('sub');
    await botaoDireito(c.x, c.y);
    await app.espera(`!!document.querySelector('.dev-ctx-menu')`, 5000, 'menu de contexto');
    const itens = await menuItens();
    afirma(JSON.stringify(itens) === JSON.stringify(['Novo arquivo', 'Nova pasta']), `menu: ${JSON.stringify(itens)}`);
    await escolhe('Novo arquivo');
    afirma(await app.ev(`document.activeElement?.classList.contains('dev-novo-input')`), 'o campo de nome está com o foco');
    await app.foto('explorador-campo-nome');
    await digita('novo.txt');
    await app.espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === 'novo.txt')`, 15000, 'novo.txt aberto no editor');
    afirma(noDisco('sub', 'novo.txt') && fs.readFileSync(path.join(sb.projeto, 'sub', 'novo.txt'), 'utf8') === '', 'sub/novo.txt criado vazio no disco');
    afirma((await nomesDaArvore()).includes('novo.txt'), 'novo.txt aparece na árvore (dentro de sub)');
    afirma(await app.ev(`!document.querySelector('.dev-novo-input')`), 'o campo some depois de criar');

    // 2) botão direito num arquivo: a pasta nasce na pasta do arquivo (a.txt está na raiz)
    c = await centro('a.txt');
    await botaoDireito(c.x, c.y);
    await app.espera(`!!document.querySelector('.dev-ctx-menu')`, 5000, 'menu de contexto');
    const itensArquivo = await menuItens();
    afirma(JSON.stringify(itensArquivo) === JSON.stringify(['Visualizar', 'Novo arquivo', 'Nova pasta']), `menu do arquivo: ${JSON.stringify(itensArquivo)}`);
    await escolhe('Nova pasta');
    await digita('pasta1');
    await app.espera(`[...document.querySelectorAll('.ws.active .dev-node.dir .dev-node-name')].some(e => e.textContent === 'pasta1')`, 15000, 'pasta1 na árvore');
    afirma(noDisco('pasta1') && fs.statSync(path.join(sb.projeto, 'pasta1')).isDirectory(), 'pasta1 criada na pasta do arquivo (raiz)');

    // 3) área vazia: cria na raiz do workspace
    const t = await app.caixa('.ws.active .dev-tree');
    await botaoDireito(Math.round(t.x + t.w / 2), Math.round(t.b - 6));
    await app.espera(`!!document.querySelector('.dev-ctx-menu')`, 5000, 'menu de contexto na área vazia');
    const itensVazio = await menuItens();
    afirma(JSON.stringify(itensVazio) === JSON.stringify(['Novo arquivo', 'Nova pasta']), `menu da área vazia: ${JSON.stringify(itensVazio)}`);
    await escolhe('Novo arquivo');
    await digita('raiz.txt');
    await app.espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === 'raiz.txt')`, 15000, 'raiz.txt aberto');
    afirma(noDisco('raiz.txt'), 'raiz.txt criado na raiz do workspace');
    afirma((await nomesDaArvore()).includes('raiz.txt'), 'raiz.txt aparece na árvore');

    // 4) nome inválido: toast, o campo continua e nada é gravado; Esc cancela
    const antes = fs.readdirSync(sb.projeto).sort().join(',');
    for (const [nome, trecho] of [['a.txt', 'já existe'], ['x/y', 'não pode ter'], ['..', 'inválido'], ['a:b.txt', 'caracteres reservados'], ['q?.txt', 'caracteres reservados']]) {
      c = await centro('b.txt');
      await botaoDireito(c.x, c.y);
      await app.espera(`!!document.querySelector('.dev-ctx-menu')`, 5000, 'menu de contexto');
      await escolhe('Novo arquivo');
      await digita(nome);
      await sleep(300);
      const toast = await app.ev(`document.getElementById('toast').textContent`);
      afirma(toast.includes(trecho), `nome ${JSON.stringify(nome)} recusado com o toast "${toast}"`);
      afirma(await app.ev(`!!document.querySelector('.dev-novo-input')`), 'o campo continua aberto');
      await esc();
      await app.espera(`!document.querySelector('.dev-novo-input')`, 5000, 'Esc cancela');
    }
    afirma(fs.readdirSync(sb.projeto).sort().join(',') === antes, 'nenhum item foi criado pelos nomes inválidos');
    await app.foto('explorador-criar-final');
  });
};

// Botão verde "Nova versão" no rodapé da barra lateral: só existe quando há versão nova, e o clique
// dispara o fluxo de atualização que já existia (o confirm do git pull; aqui o confirm é falso e
// registra a mensagem, então nada é atualizado de verdade).
CENARIOS['atualizacao'] = async () => {
  await comApp({ semTerminal: true }, async app => {
    const estado = s => app.ev(`renderUpdate(${JSON.stringify(s)})`);
    const visivel = () => app.ev(`(() => { const b = document.getElementById('nav-update'); return !!b && !b.hidden && b.offsetParent !== null; })()`);
    await estado({ state: 'idle' });
    afirma(!(await visivel()), 'sem versão nova: o botão não aparece');
    afirma(!/Atualizar agora/.test(await app.texto('#status-strip')), 'a barra de status não oferece mais "Atualizar agora"');

    await estado({ state: 'available', mode: 'git', version: '9.9.9', notes: '### Teste\n- item novo' });
    afirma(await visivel(), 'com versão nova: o botão aparece');
    afirma((await app.texto('#nav-update')).trim() === 'Nova versão', `rótulo "${(await app.texto('#nav-update')).trim()}"`);
    const bg = await app.estilo('#nav-update', 'backgroundColor');
    const verde = await app.ev(`(() => { const e = document.createElement('i'); e.style.color = getComputedStyle(document.documentElement).getPropertyValue('--green'); document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
    afirma(bg === verde, `fundo verde (${bg})`);
    const pos = await app.ev(`(() => { const b = document.getElementById('nav-update'), n = document.querySelector('.nav-tab[data-page=novidades]'), bar = document.getElementById('activity-bar'); const rb = b.getBoundingClientRect(), rn = n.getBoundingClientRect(), rr = bar.getBoundingClientRect(); return { pai: b.parentElement.id, antes: rb.bottom <= rn.top + 1, dentro: rb.left >= rr.left && rb.right <= rr.right, cabe: b.scrollWidth <= b.clientWidth, sobra: rr.bottom - rn.bottom }; })()`);
    afirma(pos.pai === 'activity-bar' && pos.antes && pos.dentro, 'o botão fica na barra lateral, logo acima de Novidades');
    afirma(pos.cabe, 'o rótulo cabe no botão');
    await app.foto('atualizacao-botao', await app.caixa('#activity-bar').then(c => ({ x: 0, y: Math.max(0, c.b - 260), width: 260, height: 260 })));

    await app.ev(`window.__confirmou = null; window.confirm = m => { window.__confirmou = m; return false; }`);
    await app.clica('#nav-update');
    await sleep(300);
    const msg = await app.ev('window.__confirmou');
    afirma(!!msg && msg.includes('9.9.9'), 'o clique dispara o fluxo de atualização (confirmação da versão 9.9.9)');

    await estado({ state: 'idle' });
    afirma(!(await visivel()), 'a versão nova some quando o estado volta a idle');
  });
};

// Primeira abertura depois de atualizar: modal de Novidades que só fecha pelo botão Fechar
CENARIOS['novidades'] = async () => {
  await comApp({ semTerminal: true }, async app => {
    const visivel = () => app.ev(`document.getElementById('novidades-overlay').classList.contains('visible')`);
    const vista = () => app.ev(`localStorage.getItem('app.lastSeenVersion')`);
    const versao = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    await sleep(1500);
    afirma(!(await visivel()), 'instalação nova (sem versão vista): o modal não abre');
    afirma(await vista() === versao, 'a versão atual fica gravada como vista');

    // simula a atualização: a versão vista é uma anterior; reabre a página como num novo arranque
    await app.ev(`localStorage.setItem('app.lastSeenVersion', '0.0.1')`);
    await app.send('Page.reload');
    await app.espera(`document.getElementById('novidades-overlay')?.classList.contains('visible')`, 30000, 'modal de Novidades aberto');
    afirma((await app.texto('#novidades-titulo')).includes(versao), `título cita a versão: "${await app.texto('#novidades-titulo')}"`);
    afirma((await app.texto('#novidades-corpo')).trim().length > 20, 'o modal mostra as notas da versão');
    afirma(await vista() === '0.0.1', 'abrir o modal não grava a versão como vista');
    await app.foto('novidades-modal');

    // clique fora, Esc e tempo: continua aberto
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 6, y: 6, button: 'left', buttons: 1, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 6, y: 6, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
    afirma(await visivel(), 'clicar fora não fecha');
    const esc = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', ...esc });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...esc });
    await sleep(400);
    afirma(await visivel(), 'Esc não fecha');
    await sleep(8000);
    afirma(await visivel(), 'passados 8 segundos continua aberto');
    afirma(await vista() === '0.0.1', 'sem clicar em Fechar a versão não é gravada');

    // só o botão fecha
    await app.clica('#novidades-fechar');
    await sleep(500);
    afirma(!(await visivel()), 'o botão Fechar fecha');
    afirma(await vista() === versao, 'Fechar grava a versão como vista');

    // mostra só uma vez por versão
    await app.send('Page.reload');
    await app.espera(`!!document.querySelector('.ws.active')`, 30000, 'app recarregado');
    await sleep(3000);
    afirma(!(await visivel()), 'na abertura seguinte o modal não volta');
  });
};

// Realce do .env (renderer/dotenv-lang.js): o arquivo fictício abre com a linguagem dotenv, cada classe
// de token tem a sua cor, o contraste fica acima de 4,5:1 e o texto não é alterado (só cor).
const ENV_FICTICIO = [
  '# banco de dados (fictício)',
  'export API_URL="https://exemplo.test/${HOST}/v1"  # produção',
  'DB_HOST=localhost',
  "SEGREDO='valor-ficticio # com cerquilha'",
  'PORT=3000 # porta',
  'CAMINHO=${HOME}/app',
  '',
].join('\n');
CENARIOS['realce-env'] = async () => {
  await comApp({ arquivos: { '.env': ENV_FICTICIO, '.env.local': 'A=1\n', 'environment.js': 'const A = 1;\n' } }, async app => {
    await abrirArquivo(app, '.env');
    const lang = nome => app.ev(`window.monaco.editor.getModels().find(m => m.uri.path.endsWith('/${nome}'))?.getLanguageId() ?? null`);
    afirma(await lang('.env') === 'dotenv', '.env abre com a linguagem dotenv');
    await abrirArquivo(app, '.env.local');
    afirma(await lang('.env.local') === 'dotenv', '.env.local abre com a linguagem dotenv');
    await abrirArquivo(app, 'environment.js');
    afirma(await lang('environment.js') === 'javascript', 'environment.js continua javascript');
    await abrirArquivo(app, '.env');
    await sleep(600);
    const tipos = await app.ev(`(() => { const t = window.monaco.editor.tokenize(${JSON.stringify(ENV_FICTICIO)}, 'dotenv'); return t.map(l => l.map(x => x.type)); })()`);
    const usados = new Set(tipos.flat());
    for (const t of ['comment.dotenv', 'keyword.export.dotenv', 'variable.name.dotenv', 'delimiter.dotenv', 'string.value.dotenv', 'variable.interp.dotenv'])
      afirma(usados.has(t), `token ${t} aparece no .env fictício`);
    // cores reais na tela: chave, valor e comentário diferentes entre si, todos legíveis sobre o fundo
    const cores = await app.ev(`(() => {
      const fundo = getComputedStyle(document.querySelector('.ws.active .monaco-editor .monaco-editor-background')).backgroundColor;
      const linhas = [...document.querySelectorAll('.ws.active .monaco-editor .view-line')];
      const spans = linhas.flatMap(l => [...l.querySelectorAll('span > span')]);
      const cor = txt => { const s = spans.find(e => e.textContent.replace(/ /g, " ").startsWith(txt)); return s ? getComputedStyle(s).color : null; };
      return { fundo, chave: cor('DB_HOST'), valor: cor('localhost'), comentario: cor('# banco'), igual: cor('=') };
    })()`);
    afirma(cores.chave && cores.valor && cores.comentario && cores.igual, `spans coloridos achados ${JSON.stringify(cores)}`);
    if (cores.chave && cores.valor && cores.comentario && cores.igual) {
      afirma(new Set([cores.chave, cores.valor, cores.comentario]).size === 3, 'chave, valor e comentário têm cores diferentes');
      for (const k of ['chave', 'valor', 'comentario', 'igual'])
        afirma(contraste(cores[k], cores.fundo) >= 4.5, `contraste de ${k} >= 4,5:1`);
    }
    afirma(await textoDoModelo(app, '.env') === ENV_FICTICIO, 'o texto do arquivo não foi alterado (nada é mascarado)');
    const c = await app.caixa('.ws.active .dev-editors');
    await app.foto('realce-env', { x: c.x, y: c.y, width: c.w, height: c.h });
  });
};

// Mídia no explorador (Fase 1): imagem, áudio, vídeo e PDF abrem numa aba do grupo com visualizador, por um protocolo
// próprio confinado; outro binário diz que não abre; Ctrl+W/Ctrl+S, troca de aba, persistência e a CSP.
const FIXTURES_MIDIA = path.join(ROOT, 'test', 'fixtures', 'midia');
const midia = nome => fs.readFileSync(path.join(FIXTURES_MIDIA, nome));
CENARIOS['midia-abas'] = async () => {
  const arquivos = { 'foto.png': midia('teste.png'), 'som.mp3': midia('teste.mp3'), 'clipe.mp4': midia('teste.mp4'), 'doc.pdf': midia('teste.pdf'), 'falso.zip': midia('falso.zip') };
  await comApp({ semTerminal: true, arquivos, workspaces: [{ name: 'demo', cols: 1 }] }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-node').length >= 5`, 20000, 'árvore carregada');
    const clicaNo = nome => app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(nome)})?.click()`);
    const abaAtiva = () => app.ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent ?? null`);
    const abrirMidia = async nome => { await clicaNo(nome); await app.espera(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent === ${JSON.stringify(nome)}`, 15000, `aba ${nome}`); };
    const painel = async nome => { const c = await app.caixa('.ws.active .dev-editors'); return app.foto(nome, { x: c.x, y: c.y, width: c.w, height: c.h }); };
    const visivel = sel => app.ev(`(() => { const e = document.querySelector('.ws.active .dev-viewer:not([hidden]) ${sel}'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    const hashDoDisco = nome => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(sb.projeto, nome))).digest('hex');

    // imagem
    const hashPng = hashDoDisco('foto.png');
    await abrirMidia('foto.png');
    await app.espera(`document.querySelector('.ws.active .dev-viewer:not([hidden]) img')?.naturalWidth > 0`, 10000, 'imagem carregada');
    const img = await app.ev(`(() => { const i = document.querySelector('.ws.active .dev-viewer:not([hidden]) img'); return { w: i.naturalWidth, src: i.src.slice(0, 24) }; })()`);
    afirma(img.w === 120 && img.src.startsWith('rendra-midia://'), `imagem 120 px pelo protocolo da mídia (${JSON.stringify(img)})`);
    afirma(await visivel('img'), 'a imagem está visível e com tamanho');
    await painel('midia-imagem');

    // Ctrl+S na aba de mídia não grava nada
    await app.tecla('s', { ctrl: true });
    await sleep(400);
    afirma(hashDoDisco('foto.png') === hashPng, 'Ctrl+S na aba de imagem não altera o arquivo no disco');

    // áudio
    await abrirMidia('som.mp3');
    await app.espera(`Number.isFinite(document.querySelector('.ws.active .dev-viewer:not([hidden]) audio')?.duration)`, 10000, 'duração do áudio');
    const aud = await app.ev(`(() => { const a = document.querySelector('.ws.active .dev-viewer:not([hidden]) audio'); return { dur: a.duration, ctl: a.controls }; })()`);
    afirma(aud.dur > 0.5 && aud.ctl, `áudio com controles e duração ${aud.dur.toFixed(2)} s`);
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-viewer:not([hidden])').length === 1`), 'só um visualizador visível por vez');
    await painel('midia-audio');

    // vídeo: toca e a troca de aba o pausa
    await abrirMidia('clipe.mp4');
    await app.espera(`document.querySelector('.ws.active .dev-viewer:not([hidden]) video')?.readyState >= 2`, 10000, 'vídeo carregado');
    const vid = await app.ev(`(() => { const v = document.querySelector('.ws.active .dev-viewer:not([hidden]) video'); return { w: v.videoWidth, h: v.videoHeight, dur: v.duration }; })()`);
    afirma(vid.w === 128 && vid.h === 96 && vid.dur > 0.5, `vídeo ${vid.w}x${vid.h} de ${vid.dur.toFixed(1)} s`);
    // seek (usa Range): o tempo muda e o vídeo continua legível
    const seek = await app.ev(`new Promise(res => { const v = document.querySelector('.ws.active .dev-viewer:not([hidden]) video'); v.addEventListener('seeked', () => res({ t: v.currentTime, rs: v.readyState }), { once: true }); v.currentTime = 0.6; setTimeout(() => res({ t: -1 }), 4000); })`);
    afirma(seek.t > 0.5 && seek.rs >= 2, `seek no vídeo funciona (${JSON.stringify(seek)})`);
    await app.ev(`document.querySelector('.ws.active .dev-viewer:not([hidden]) video').play().catch(() => {})`);
    await sleep(300);
    await painel('midia-video');
    await abrirMidia('som.mp3');
    afirma(await app.ev(`[...document.querySelectorAll('.ws.active video')].every(v => v.paused)`), 'trocar de aba pausa o vídeo');
    afirma(await app.ev(`[...document.querySelectorAll('.ws.active .dev-viewer')].filter(e => !e.hidden).length === 1`), 'o vídeo da aba anterior fica escondido');

    // PDF
    await abrirMidia('doc.pdf');
    await app.espera(`!!document.querySelector('.ws.active .dev-viewer:not([hidden]) iframe')`, 10000, 'iframe do PDF');
    await sleep(2500);
    afirma(await visivel('iframe'), 'o PDF está num iframe visível');
    await painel('midia-pdf');

    // outro binário: a mensagem diz que não abre, sem aba nova
    const abasAntes = await app.ev(`document.querySelectorAll('.ws.active .dev-tab').length`);
    await clicaNo('falso.zip');
    await sleep(500);
    const toast = await app.ev(`document.getElementById('toast').textContent`);
    afirma(toast.includes('Este tipo de arquivo não abre na IDE'), `zip: "${toast}"`);
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-tab').length`) === abasAntes, 'o zip não abre aba');

    // de volta ao texto: o Monaco reaparece com o modelo certo
    await abrirMidia('a.txt');
    await app.espera(`document.querySelector('.ws.active .monaco-editor') && getComputedStyle(document.querySelector('.ws.active .monaco-editor')).visibility !== 'hidden'`, 10000, 'Monaco visível');
    afirma(await textoDoModelo(app, 'a.txt') === 'primeiro arquivo\nlinha dois\n', 'a aba de texto mostra o arquivo certo depois da mídia');
    afirma(await app.ev(`!document.querySelector('.ws.active .dev-editor-host.com-vista')`), 'sem a marca de visualização no grupo');
    await abrirMidia('foto.png');
    afirma(await app.ev(`getComputedStyle(document.querySelector('.ws.active .monaco-editor')).visibility === 'hidden'`), 'com a mídia ativa o Monaco fica escondido atrás do visualizador');

    // persistência: as abas de mídia voltam depois de reiniciar
    await sleep(600);
    await abrirMidia('foto.png');
    await sleep(600);
    const grupos = lerConfig(sb).devcode.workspaces.list[0].groups;
    afirma(grupos[0].tabs.some(t => t.endsWith('foto.png')) && grupos[0].tabs.some(t => t.endsWith('clipe.mp4')), `a configuração guarda as abas de mídia (${grupos[0].tabs.map(t => path.basename(t)).join(', ')})`);
    const app2 = await app.reiniciar();
    await app2.espera(`[...document.querySelectorAll('.ws.active .dev-tab .dev-tab-name')].some(e => e.textContent === 'foto.png')`, 30000, 'aba foto.png restaurada');
    afirma(await app2.ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent`) === 'foto.png', 'a aba ativa restaurada é a foto.png');
    await app2.espera(`document.querySelector('.ws.active .dev-viewer:not([hidden]) img')?.naturalWidth > 0`, 15000, 'imagem restaurada carregou');

    // arquivo apagado entre sessões: some em silêncio
    const app3 = await (async () => { fs.rmSync(path.join(sb.projeto, 'clipe.mp4')); return app2.reiniciar(); })();
    await app3.espera(`[...document.querySelectorAll('.ws.active .dev-tab .dev-tab-name')].some(e => e.textContent === 'foto.png')`, 30000, 'abas restauradas');
    afirma(await app3.ev(`![...document.querySelectorAll('.ws.active .dev-tab .dev-tab-name')].some(e => e.textContent === 'clipe.mp4')`), 'a aba do vídeo apagado não volta');

    // Ctrl+W com o foco no visualizador fecha a aba
    await app3.espera(`document.activeElement?.classList.contains('dev-viewer') || !!document.querySelector('.ws.active .dev-viewer:not([hidden])')`, 10000, 'visualizador na tela');
    await app3.ev(`document.querySelector('.ws.active .dev-viewer:not([hidden])').focus()`);
    const abaAntesDeFechar = await app3.ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent`);
    await app3.tecla('w', { ctrl: true });
    await app3.espera(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent !== ${JSON.stringify(abaAntesDeFechar)}`, 8000, 'Ctrl+W fechou a aba');
    afirma(await app3.ev(`![...document.querySelectorAll('.ws.active .dev-tab .dev-tab-name')].some(e => e.textContent === ${JSON.stringify(abaAntesDeFechar)})`), `Ctrl+W com o foco no visualizador fecha a aba ${abaAntesDeFechar}`);

    // CSP: continua sem rede, sem blob e sem script de fora
    const csp = await app3.ev(`(async () => {
      const r = {};
      r.fetchWeb = await fetch('https://example.com/').then(() => 'passou', () => 'bloqueado');
      r.fetchMidia = await fetch('rendra-midia://arquivo/x').then(() => 'passou', () => 'bloqueado');
      r.script = await new Promise(res => { const s = document.createElement('script'); s.src = 'https://exemplo.invalid/x.js'; s.onload = () => res('carregou'); s.onerror = () => res('bloqueado'); document.head.appendChild(s); });
      r.blobFrame = await new Promise(res => { const f = document.createElement('iframe'); const b = URL.createObjectURL(new Blob(['<p>x</p>'], { type: 'text/html' })); document.addEventListener('securitypolicyviolation', e => { if (e.violatedDirective.startsWith('frame-src')) res('bloqueado'); }, { once: true }); f.src = b; document.body.appendChild(f); setTimeout(() => res('sem violação'), 2500); });
      return r;
    })()`);
    afirma(csp.fetchWeb === 'bloqueado' && csp.fetchMidia === 'bloqueado', `fetch à web e ao protocolo bloqueados (${JSON.stringify(csp)})`);
    afirma(csp.script === 'bloqueado', 'script de fora não carrega');
    afirma(csp.blobFrame === 'bloqueado', 'iframe com blob: continua bloqueado');
  });
};

// Menu Visualizar (Fase 2): texto somente leitura, Markdown renderizado (imagem local pelo protocolo confinado), SVG como
// imagem e HTML renderizado sem scripts nem navegação; a aba de edição do mesmo arquivo é outra aba.
CENARIOS['visualizar'] = async () => {
  const md = [
    '# Título do leia', '', 'Um **negrito**, um *itálico* e `codigo`.', '', '- item um', '- item dois', '',
    '<script>document.title = "MD-EXECUTOU"</script>', '', '![foto local](foto.png)', '', '![de fora](../fora.png)', '', '[site](https://exemplo.com/a)', '[inerte](javascript:alert(1))', '',
  ].join('\n');
  const html = '<!doctype html><html><head><style>h1{color:#e8650a}</style><meta http-equiv="refresh" content="1;url=https://example.com/"></head><body style="background:#fff"><h1>PAGINA HTML</h1><script>document.title="HTML-EXECUTOU"</script>'
    + '<a href="https://example.com/" target="_top" style="position:absolute;left:10px;top:100px;width:150px;height:40px;background:#cde;display:block">link</a>'
    + '<form action="https://example.com/" style="position:absolute;left:10px;top:180px"><button style="width:150px;height:40px">enviar</button></form></body></html>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><script>document.title="SVG-EXECUTOU"</script><rect width="120" height="60" fill="#e8650a"/></svg>';
  const arquivos = { 'leia.md': md, 'pagina.html': html, 'desenho.svg': svg, 'notas.txt': 'linha um\nlinha dois\n', 'foto.png': midia('teste.png'), 'doc.pdf': midia('teste.pdf'), 'falso.zip': midia('falso.zip') };
  await comApp({ semTerminal: true, arquivos, workspaces: [{ name: 'demo', cols: 1 }] }, async (app, sb) => {
    await app.espera(`document.querySelectorAll('.ws.active .dev-node').length >= 7`, 20000, 'árvore carregada');
    const botaoDireito = async (x, y) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    };
    const centro = nome => app.ev(`(() => { const n = [...document.querySelectorAll('.ws.active .dev-node')].find(e => e.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(nome)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const visualizar = async nome => {
      const c = await centro(nome);
      await botaoDireito(c.x, c.y);
      await app.espera(`!!document.querySelector('.dev-ctx-menu')`, 5000, 'menu de contexto');
      const itens = await app.ev(`[...document.querySelectorAll('.dev-ctx-menu button')].map(b => b.textContent)`);
      afirma(itens[0] === 'Visualizar' && itens.includes('Novo arquivo') && itens.includes('Nova pasta'), `menu do arquivo ${nome}: ${JSON.stringify(itens)}`);
      await app.ev(`[...document.querySelectorAll('.dev-ctx-menu button')].find(b => b.textContent === 'Visualizar').click()`);
    };
    const abasAtivas = () => app.ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent ?? null`);
    const esperaAba = nome => app.espera(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name')?.textContent === ${JSON.stringify(nome)}`, 15000, `aba ${nome}`);
    const painel = async nome => { const c = await app.caixa('.ws.active .dev-editors'); return app.foto(nome, { x: c.x, y: c.y, width: c.w, height: c.h }); };
    const hash = nome => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(sb.projeto, nome))).digest('hex');
    const titulo = () => app.ev('document.title');

    // 1) texto somente leitura
    const hashNotas = hash('notas.txt');
    await visualizar('notas.txt');
    await esperaAba('notas.txt (visualização)');
    await app.espera(`!!document.querySelector('.ws.active .monaco-editor')`, 10000, 'Monaco');
    afirma(await app.ev(`document.querySelector('.ws.active .dev-tab.active').classList.contains('vista')`), 'a aba de visualização tem a classe .vista');
    await app.ev(`document.querySelector('.ws.active .monaco-editor textarea')?.focus()`);
    await app.digita('DIGITADO');
    await sleep(300);
    afirma(await app.ev(`window.monaco.editor.getModels().filter(m => m.uri.scheme === 'vista').every(m => !m.getValue().includes('DIGITADO'))`), 'digitar na visualização não muda o texto');
    afirma(await app.ev(`!document.querySelector('.ws.active .dev-tab.dirty')`), 'nenhuma aba marcada como alterada');
    await app.tecla('s', { ctrl: true });
    await sleep(400);
    afirma(hash('notas.txt') === hashNotas, 'Ctrl+S na visualização não grava nada (hash do disco igual)');
    await painel('visualizar-texto');
    // o mesmo arquivo aberto para editar: outra aba, sem erro, e a edição não marca a visualização
    await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === 'notas.txt').click()`);
    await esperaAba('notas.txt');
    afirma(await app.ev(`[...document.querySelectorAll('.ws.active .dev-tab .dev-tab-name')].map(e => e.textContent).filter(t => t.startsWith('notas.txt')).length`) === 2, 'duas abas: a de edição e a de visualização');
    await app.ev(`document.querySelector('.ws.active .monaco-editor textarea')?.focus()`);
    await app.digita('EDITADO');
    await sleep(400);
    afirma(await app.ev(`[...document.querySelectorAll('.ws.active .dev-tab')].filter(t => t.classList.contains('dirty')).map(t => t.querySelector('.dev-tab-name').textContent).join('|')`) === 'notas.txt', 'só a aba de edição fica alterada');
    afirma(await app.ev(`window.monaco.editor.getModels().find(m => m.uri.scheme === 'vista').getValue()`) === 'linha um\nlinha dois\n', 'a visualização continua com o texto do disco');
    await app.tecla('s', { ctrl: true });
    await sleep(500);
    afirma(fs.readFileSync(path.join(sb.projeto, 'notas.txt'), 'utf8').includes('EDITADO'), 'Ctrl+S na aba de edição grava');

    // 2) Markdown renderizado
    await visualizar('leia.md');
    await esperaAba('leia.md (visualização)');
    await app.espera(`!!document.querySelector('.ws.active .dev-viewer:not([hidden]) .dev-md h1')`, 10000, 'Markdown renderizado');
    afirma(await app.texto('.ws.active .dev-viewer:not([hidden]) .dev-md h1') === 'Título do leia', 'o # vira um título');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-md li').length === 2 && !!document.querySelector('.ws.active .dev-md b') && !!document.querySelector('.ws.active .dev-md i') && !!document.querySelector('.ws.active .dev-md code')`), 'lista, negrito, itálico e código');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-md script, .ws.active .dev-md [onerror]').length === 0 && document.querySelector('.ws.active .dev-md').textContent.includes('<script>')`), 'o <script> do .md aparece como texto, não como elemento');
    afirma(await titulo() === 'Rendra IDE', `o título da janela não mudou (${await titulo()})`);
    await app.espera(`document.querySelector('.ws.active .dev-md img.md-img')?.naturalWidth > 0`, 10000, 'imagem local carregou');
    afirma(await app.ev(`document.querySelector('.ws.active .dev-md img.md-img').src.startsWith('rendra-midia://')`), 'a imagem local vem pelo protocolo confinado');
    afirma(await app.ev(`[...document.querySelectorAll('.ws.active .dev-md .md-img-alt')].some(e => e.textContent === 'de fora')`), 'a imagem fora das pastas abertas vira texto alternativo');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-md a[data-url]').length === 1 && document.querySelector('.ws.active .dev-md a[data-url]').dataset.url === 'https://exemplo.com/a' && !!document.querySelector('.ws.active .dev-md .md-link-inerte')`), 'só o link http(s) é link; javascript: fica inerte');
    await painel('visualizar-markdown');

    // 3) SVG como imagem
    await visualizar('desenho.svg');
    await esperaAba('desenho.svg (visualização)');
    await app.espera(`document.querySelector('.ws.active .dev-viewer:not([hidden]) img')?.naturalWidth === 120`, 10000, 'SVG mostrado como imagem');
    afirma(await titulo() === 'Rendra IDE', 'o script do SVG não executou');
    afirma(await app.ev(`document.querySelector('.ws.active .dev-viewer:not([hidden]) img').src.startsWith('data:image/svg+xml;base64,')`), 'o SVG entra como imagem data:');
    await painel('visualizar-svg');
    // clique no SVG continua abrindo para editar
    await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === 'desenho.svg').click()`);
    await esperaAba('desenho.svg');
    afirma(await textoDoModelo(app, 'desenho.svg') === svg, 'o clique no SVG abre o texto no editor');

    // 4) HTML renderizado sem scripts, sem navegação
    await visualizar('pagina.html');
    await esperaAba('pagina.html (visualização)');
    await app.espera(`!!document.querySelector('.ws.active .dev-viewer:not([hidden]) iframe')`, 10000, 'iframe do HTML');
    const frame = await app.ev(`(() => { const f = document.querySelector('.ws.active .dev-viewer:not([hidden]) iframe'); return { sandbox: f.getAttribute('sandbox'), srcdoc: f.hasAttribute('srcdoc'), src: f.getAttribute('src') }; })()`);
    afirma(frame.sandbox === '' && frame.srcdoc && frame.src === null, `iframe sandbox="" com srcdoc (${JSON.stringify(frame)})`);
    await sleep(2200); // passa o tempo do meta refresh
    const urlAntes = await app.ev('location.href');
    const r = await app.ev(`(() => { const f = document.querySelector('.ws.active .dev-viewer:not([hidden]) iframe').getBoundingClientRect(); return { x: f.x, y: f.y }; })()`);
    for (const [dx, dy] of [[20, 120], [20, 200]]) {
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + dx, y: r.y + dy, button: 'left', clickCount: 1 });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + dx, y: r.y + dy, button: 'left', clickCount: 1 });
      await sleep(1000);
    }
    afirma(await app.ev('location.href') === urlAntes, 'a janela não navegou (link target=_top, formulário e meta refresh)');
    afirma(await titulo() === 'Rendra IDE', 'o script do HTML não executou');
    const alvos = await (await fetch(`http://127.0.0.1:${app.porta}/json`)).json();
    afirma(!alvos.some(a => /example\.com/.test(a.url)), `nenhum quadro foi para fora (${alvos.map(a => a.type).join(',')})`);
    await painel('visualizar-html');
    // e o clique no HTML continua abrindo para editar
    await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === 'pagina.html').click()`);
    await esperaAba('pagina.html');
    afirma(await textoDoModelo(app, 'pagina.html') === html, 'o clique no HTML abre o texto no editor');

    // 5) mídia e binário
    await visualizar('foto.png');
    await esperaAba('foto.png');
    afirma(await app.ev(`!document.querySelector('.ws.active .dev-tab.active.vista')`), 'Visualizar em imagem é igual ao clique (aba sem sufixo)');
    const abasAntes = await app.ev(`document.querySelectorAll('.ws.active .dev-tab').length`);
    await visualizar('falso.zip');
    await sleep(500);
    afirma((await app.ev(`document.getElementById('toast').textContent`)).includes('Este tipo de arquivo não abre na IDE'), 'zip: mensagem de que não abre');
    afirma(await app.ev(`document.querySelectorAll('.ws.active .dev-tab').length`) === abasAntes, 'nenhuma aba nova para o zip');

    // 6) visualização não persiste
    await sleep(600);
    const abas = lerConfig(sb).devcode.workspaces.list[0].groups[0].tabs;
    afirma(abas.length > 0 && abas.every(t => !t.startsWith('vista:')), `a configuração não guarda abas de visualização (${abas.map(t => path.basename(t)).join(', ')})`);
  });
};

// ── EXECUÇÃO ────────────────────────────────────────────────────────────────
async function main() {
  const nomes = ESCOLHIDOS || Object.keys(CENARIOS);
  for (const n of nomes) if (!CENARIOS[n]) { console.error(`cenário desconhecido: ${n} (existem: ${Object.keys(CENARIOS).join(', ')})`); process.exit(2); }
  for (const nome of nomes) {
    cenarioAtual = nome;
    console.log(`\n● ${nome}`);
    try { await CENARIOS[nome](); } catch (e) { falhas.push(`[${nome}] exceção: ${e.message}`); console.log(`  ✗ exceção: ${e.message}`); }
  }
  console.log(`\nCapturas em: ${SAIDA}`);
  if (falhas.length) {
    console.log(`\n✗ ${falhas.length} falha(s):\n${falhas.map(f => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\n✓ ${nomes.length} cenário(s) verde(s): ${nomes.join(', ')}`);
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });

// Regenerates docs/images/* (README and GitHub Pages) from the real app running on DEMO data:
// a temporary home with made-up Claude Code / Codex sessions, a demo project with git changes and
// a separate app data folder (RENDRA_DATA_DIR). The maintainer's own sessions, projects, e-mail,
// paths and settings never appear, and nothing of theirs is read or written.
// Run: npm run docs:images      (Windows, macOS or Linux; the app does not need to be closed)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { imagemMaisLeve } = require('./imagem-mais-leve');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const PORT = 9400 + Math.floor(Math.random() * 400);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-demo-'));
const HOME = path.join(SANDBOX, 'home');
const DATA = path.join(SANDBOX, 'data');
const DOCS = path.join(ROOT, 'docs');
const IMG_RE = '(?:webp|png|jpg)';
const W = 1920, H = 1080; // Padrão dos produtos Rendra: desktop em 1920x1080

// ── Deterministic demo data ─────────────────────────────────────────────────
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const DAY = 86400000;
const now = Date.now();

const PROJECTS = [
  { folder: '-home-dev-projetos-loja-online', weight: 5 },
  { folder: '-home-dev-projetos-api-pagamentos', weight: 4 },
  { folder: '-home-dev-projetos-app-agenda', weight: 3 },
  { folder: '-home-dev-projetos-site-institucional', weight: 2 },
  { folder: '-home-dev-projetos-painel-admin', weight: 2 },
  { folder: '-home-dev-projetos-automacoes', weight: 1 },
];
const MODELS = ['claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

function claudeSessions() {
  let n = 0;
  for (let d = 75; d >= 0; d--) {
    const weekday = new Date(now - d * DAY).getDay();
    const sessionsToday = weekday === 0 || weekday === 6 ? (rnd() < 0.5 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < sessionsToday; s++) {
      const proj = pick(PROJECTS.flatMap(p => Array(p.weight).fill(p)));
      const model = pick(MODELS);
      const hour = pick([9, 10, 10, 11, 14, 15, 15, 16, 17, 20, 21]);
      let t = now - d * DAY - (now % DAY) + hour * 3600000 + Math.floor(rnd() * 3600000);
      if (t > now) t = now - 60000 * (s + 1);
      const lines = [];
      const turns = 15 + Math.floor(rnd() * 60);
      for (let i = 0; i < turns; i++) {
        t += 20000 + Math.floor(rnd() * 90000);
        lines.push(JSON.stringify({
          type: 'assistant', timestamp: new Date(Math.min(t, now)).toISOString(), requestId: `req_${n}_${i}`,
          message: {
            id: `msg_${n}_${i}`, model, role: 'assistant',
            usage: {
              input_tokens: 5 + Math.floor(rnd() * 400),
              output_tokens: 150 + Math.floor(rnd() * 2500),
              cache_read_input_tokens: 20000 + Math.floor(rnd() * 90000),
              cache_creation_input_tokens: i === 0 ? 18000 : Math.floor(rnd() * 5000),
              cache_creation: { ephemeral_1h_input_tokens: i === 0 ? 18000 : 0 },
            },
          },
        }));
      }
      const file = path.join(HOME, '.claude', 'projects', proj.folder, `sessao-${String(n).padStart(4, '0')}.jsonl`);
      write(file, lines.join('\n') + '\n');
      const mtime = new Date(Math.min(t, now));
      fs.utimesSync(file, mtime, mtime);
      n++;
    }
  }
}

function codexSessions() {
  for (let d = 30; d >= 0; d -= 1 + Math.floor(rnd() * 3)) {
    const t0 = now - d * DAY - 3 * 3600000;
    const cwd = pick(['/home/dev/projetos/api-pagamentos', '/home/dev/projetos/automacoes', '/home/dev/projetos/loja-online']);
    const model = pick(['gpt-5.5', 'gpt-5.5', 'gpt-5.4-mini']);
    const lines = [
      { timestamp: new Date(t0).toISOString(), type: 'session_meta', payload: { cwd } },
      { timestamp: new Date(t0).toISOString(), type: 'turn_context', payload: { model, cwd } },
    ];
    const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    for (let i = 0; i < 12; i++) {
      total.input_tokens += 8000 + Math.floor(rnd() * 20000);
      total.cached_input_tokens += 5000 + Math.floor(rnd() * 15000);
      total.output_tokens += 500 + Math.floor(rnd() * 3000);
      lines.push({
        timestamp: new Date(t0 + i * 60000).toISOString(), type: 'event_msg',
        payload: {
          type: 'token_count', info: { total_token_usage: { ...total } },
          rate_limits: {
            primary: { used_percent: 34, window_minutes: 300, resets_at: Math.floor((now + 2.2 * 3600000) / 1000) },
            secondary: { used_percent: 18, window_minutes: 10080, resets_at: Math.floor((now + 4.5 * DAY) / 1000) },
          },
        },
      });
    }
    const dt = new Date(t0);
    const file = path.join(HOME, '.codex', 'sessions', String(dt.getFullYear()), String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0'), `rollout-${dt.toISOString().replace(/[:.]/g, '-')}.jsonl`);
    write(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    fs.utimesSync(file, dt, dt);
  }
}

function claudeAccountAndLimits() {
  write(path.join(HOME, '.claude.json'), JSON.stringify({
    oauthAccount: { emailAddress: 'voce@exemplo.com', displayName: 'Você', organizationName: 'Sua Empresa' },
  }));
  write(path.join(HOME, '.claude', 'settings.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'sh "$HOME/.rendra-ide/statusline.sh"' },
  }, null, 2));
  write(path.join(HOME, '.rendra-ide', 'claude-status.json'), JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: Math.floor((now + 2.5 * 3600000) / 1000) },
      seven_day: { used_percentage: 27, resets_at: Math.floor((now + 3.2 * DAY) / 1000) },
    },
  }));
}

// Codex account for the title-bar selector: a made-up auth.json (fake JWT, placeholder tokens). Never
// a real account: the e-mail and the organization are the same demo data used for Claude Code
function codexAccount() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    email: 'voce@exemplo.com', name: 'Você',
    'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', organizations: [{ id: 'org-demo', is_default: true, role: 'owner', title: 'Sua Empresa' }] },
  };
  write(path.join(HOME, '.codex', 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { id_token: `${b64({ alg: 'none' })}.${b64(payload)}.demo`, access_token: 'token-demo', refresh_token: 'token-demo', account_id: 'conta-demo' },
  }));
}

// A small project with git history and pending changes (colors in the explorer)
function demoProject() {
  const dir = path.join(HOME, 'projetos', 'loja-online');
  const files = {
    'package.json': JSON.stringify({ name: 'loja-online', version: '0.4.0', private: true, scripts: { dev: 'vite', build: 'vite build' } }, null, 2) + '\n',
    'README.md': '# Loja online\n\nCatálogo, carrinho e checkout.\n',
    '.gitignore': 'node_modules/\ndist/\n',
    'CLAUDE.md': '# Loja online\n\nRegras do projeto para o Claude Code.\n',
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport { App } from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    'src/App.tsx': "import { Catalogo } from './pages/Catalogo';\n\nexport function App() {\n  return <Catalogo />;\n}\n",
    'src/pages/Catalogo.tsx': "export function Catalogo() {\n  return <main className=\"catalogo\">Produtos</main>;\n}\n",
    'src/styles/global.css': ':root { --cor-primaria: #e8650a; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n',
    'src/lib/carrinho.ts': "export type Item = { id: string; preco: number; quantidade: number };\n\nexport const total = (itens: Item[]) =>\n  itens.reduce((soma, item) => soma + item.preco * item.quantidade, 0);\n",
    'tests/carrinho.test.ts': "import { total } from '../src/lib/carrinho';\n",
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  };
  for (const [f, text] of Object.entries(files)) write(path.join(dir, f), text);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@exemplo.com', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-q', '-m', 'inicio');
  write(path.join(dir, 'src/lib/carrinho.ts'), files['src/lib/carrinho.ts'] + "\nexport const frete = (cep: string) => (cep.startsWith('0') ? 0 : 19.9);\n");
  write(path.join(dir, 'src/pages/Checkout.tsx'), "import { total, frete } from '../lib/carrinho';\n\nexport function Checkout() {\n  return <section className=\"checkout\">Finalizar compra</section>;\n}\n");
  return dir;
}

function appData(project) {
  write(path.join(DATA, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 },
    filters: { days: 30, projects: [] },
    setup: { dismissed: true },
    devcode: {
      workspaces: {
        list: [
          { name: 'loja-online', custom: false, cols: 2, root: project, groups: [{ tabs: [path.join(project, 'src', 'lib', 'carrinho.ts')], active: path.join(project, 'src', 'lib', 'carrinho.ts') }] },
          { name: 'api-pagamentos', custom: true, cols: 1, root: project, groups: [] },
        ],
        active: 0,
      },
    },
  }, null, 2));
}

// ── Chrome DevTools Protocol ────────────────────────────────────────────────
async function connect() {
  let targets = [];
  for (let i = 0; i < 80; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch { /* starting */ }
    await sleep(500);
  }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('o app não abriu');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = {}; let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  return { ws, send, ev };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Points docs/index.html and README.md at the extension each image ended up with
function updateReferences(chosen) {
  const edit = (file, fn) => {
    const f = path.join(ROOT, file);
    const before = fs.readFileSync(f, 'utf8');
    const after = fn(before);
    if (after !== before) { fs.writeFileSync(f, after); console.log(`✓ ${file} atualizado`); }
  };
  edit(path.join('docs', 'index.html'), t => {
    for (const [name, ext] of Object.entries(chosen)) {
      if (name === 'og-image') t = t.replace(new RegExp(`og-image\\.${IMG_RE}`, 'g'), `og-image.${ext}`);
      else {
        t = t.replace(new RegExp(`(images/${name}\\.)${IMG_RE}`, 'g'), `$1${ext}`);
        t = t.replace(new RegExp(`(\\['${name}',[^\\n]*?), '${IMG_RE}'\\]`), `$1, '${ext}']`);
      }
    }
    return t;
  });
  edit('README.md', t => {
    for (const [name, ext] of Object.entries(chosen)) if (name !== 'og-image') t = t.replace(new RegExp(`(docs/images/${name}\\.)${IMG_RE}`, 'g'), `$1${ext}`);
    return t;
  });
}

async function main() {
  claudeSessions(); codexSessions(); claudeAccountAndLimits(); codexAccount();
  const project = demoProject();
  appData(project);
  fs.mkdirSync(OUT, { recursive: true });

  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
    // The real home stays (shells and Chromium need it); the app reads the demo home via RENDRA_HOME
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: DATA, RENDRA_HOME: HOME, CODEX_HOME: path.join(HOME, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: 'ignore' });
  const { ws, send, ev } = await connect();

  try {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    // Rule 9 of the Rendra umbrella: lightest format without visible loss. Chromium captures lossless PNG,
    // the generator compares candidates and writes the smallest; if it is not smaller than the file already
    // in the repository, that one stays. References in docs/index.html and README.md follow the extension.
    const chosen = {};
    const kb = n => `${(n / 1024).toFixed(1)} KB`;
    const keep = (name, ext, buffer, kind) => {
      const dir = kind === 'social' ? DOCS : OUT;
      const exts = kind === 'social' ? ['png', 'jpg'] : ['webp', 'png', 'jpg'];
      const old = exts.map(e => path.join(dir, `${name}.${e}`)).find(f => fs.existsSync(f));
      const oldBytes = old ? fs.statSync(old).size : Infinity;
      if (buffer.length >= oldBytes) {
        chosen[name] = path.extname(old).slice(1);
        console.log(`= ${name}.${chosen[name]} mantida (${kb(oldBytes)}, nova ${kb(buffer.length)})`);
        return;
      }
      if (old) fs.rmSync(old);
      fs.writeFileSync(path.join(dir, `${name}.${ext}`), buffer);
      chosen[name] = ext;
      console.log(`✓ ${name}.${ext} ${old ? kb(oldBytes) + ' -> ' : ''}${kb(buffer.length)}`);
    };
    const save = async (name, png, kind) => {
      const best = await imagemMaisLeve(png, kind);
      console.log(`  ${name}: ` + best.tried.map(t => `${t.mode} ${kb(t.bytes)}${Number.isFinite(t.psnr) ? ` (${t.psnr.toFixed(1)} dB)` : ''}`).join(' | '));
      keep(name, best.ext, best.buffer, kind);
    };
    const shot = async name => {
      await sleep(400);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await save(name, Buffer.from(data, 'base64'));
    };
    const go = async (page, wait = 1500) => { await ev(`document.querySelector('[data-page=${page}]').click()`); await sleep(wait); };
    for (let i = 0; i < 90 && !/sessões/.test(await ev("document.getElementById('cl-header-sub')?.textContent || ''")); i++) await sleep(1000);

    // IDE: explorer with git colors, two terminals, the edited file open
    // Short prompt: the demo folder path (temp dir, user name) stays out of the image
    const PROMPT = process.platform === 'win32' ? "function prompt { 'PS loja-online> ' }; Clear-Host" : "PS1='loja-online $ '; clear";
    const typeIn = async (page, i, text) => {
      await ev(`document.querySelectorAll('#${page} .xterm-helper-textarea')[${i}]?.focus()`);
      await send('Input.insertText', { text });
      // Enter como tecla de verdade: o "\r" dentro do texto inserido não executa a linha no PSReadLine
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
      await sleep(1800);
    };
    const telaDoTerminal = (page, i) => ev(`(document.querySelectorAll('#${page} .xterm-rows')[${i}]?.textContent || '')`);
    // Espera o perfil do shell terminar de carregar (o prompt aparece) antes de digitar
    const esperaPrompt = async (page, i) => {
      for (let t = 0; t < 60 && !/PS .*>|\$ /.test(await telaDoTerminal(page, i)); t++) await sleep(1000);
    };
    await go('devcode', 5000);
    const clickNode = async name => {
      await ev(`[...document.querySelectorAll('#page-devcode .dev-node')].find(n => n.offsetParent && n.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(name)})?.click()`);
      await sleep(700);
    };
    for (const name of ['src', 'lib', 'pages', 'Checkout.tsx']) await clickNode(name);
    // Nenhum terminal abre sozinho: abre dois, como o usuário faria (com WSL o botão mostra o menu, e Windows é o primeiro item)
    for (let n = 0; n < 2; n++) {
      await ev(`[...document.querySelectorAll('#page-devcode [data-act="new-term"]')].find(b => b.offsetParent)?.click()`);
      await sleep(600);
      await ev(`document.querySelector('.dev-term-menu button[data-i="0"]')?.click()`);
      await sleep(1500);
    }
    for (const [i, cmd] of [[0, 'git status --short'], [1, 'git log --oneline']]) {
      await esperaPrompt('page-devcode', i);
      await typeIn('page-devcode', i, PROMPT);
      await typeIn('page-devcode', i, cmd);
    }
    await shot('ide');

    await go('claude', 2500);
    await ev("document.getElementById('main-content').scrollTop = 0");
    await shot('claude');

    await go('codex', 2000); await shot('codex');
    await go('precos', 1500); await shot('precos');
    // No RTK screenshot: rtk reads its real home and savings database, not the demo sandbox
    await go('novidades', 1200); await shot('novidades');
    await go('sobre', 1200); await shot('sobre');
    await go('terminal', 1500);
    await ev(`document.querySelector('#term-page [data-act="new-term"]').click()`);
    await sleep(600);
    await ev(`document.querySelector('.dev-term-menu button[data-i="0"]')?.click()`);
    await sleep(2000);
    await esperaPrompt('page-terminal', 0);
    const tas = await ev("document.querySelectorAll('#page-terminal .xterm-helper-textarea').length");
    if (!tas) console.warn('! nenhum terminal na página Terminal');
    await typeIn('page-terminal', 0, PROMPT);
    await sleep(1500);
    await typeIn('page-terminal', 0, 'git --version');
    await shot('terminal');

    // Social image (Open Graph, 1200x630): name, tagline and the IDE screenshot
    const img = fs.readFileSync(path.join(OUT, `ide.${chosen.ide}`)).toString('base64');
    const icon = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
    const og = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#111;font-family:'Segoe UI',system-ui,sans-serif;color:#f2f2f2}
      .txt{position:absolute;left:72px;top:92px;width:480px}
      .logo{width:88px;height:88px}
      h1{font-size:64px;margin:28px 0 12px;letter-spacing:-1px}h1 span{color:#e8650a}
      p{font-size:25px;line-height:1.4;color:#c8c8c8;margin:0}
      .by{position:absolute;left:72px;bottom:56px;font-size:19px;color:#9a9a9a}
      .shot{position:absolute;left:600px;top:70px;width:900px;border-radius:12px;border:1px solid #333;box-shadow:0 20px 60px rgba(0,0,0,.6)}
    </style></head><body>
      <div class="txt"><div class="logo">${icon}</div><h1>Rendra <span>IDE</span></h1>
      <p>Terminais, editor e o consumo de tokens do Claude Code e do Codex, com custo por token.</p></div>
      <div class="by">MIT · github.com/bsmagalhaes/rendra-ui-ide</div>
      <img class="shot" src="data:image/${chosen.ide === 'jpg' ? 'jpeg' : chosen.ide};base64,${img}">
    </body></html>`;
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: og });
    await sleep(800);
    const { data: ogData } = await send('Page.captureScreenshot', { format: 'png' });
    await save('og-image', Buffer.from(ogData, 'base64'), 'social');
    updateReferences(chosen);
  } finally {
    ws.close();
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      else app.kill();
    } catch { /* already closed */ }
    await sleep(1500);
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* temp folder, removed later by the OS */ }
  }
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });

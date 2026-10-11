// e2e do explorador: ordem da árvore, legenda de cores e ícones, busca (Ctrl+Shift+F) e abrir o resultado. App real em
// sandbox (RENDRA_DATA_DIR, RENDRA_HOME), janela oculta (RENDRA_E2E_HIDDEN=1), teclas reais por CDP. Roda à mão, fora do
// npm test, e só encerra o PID que ele mesmo criou. Uso: node scripts/e2e-busca-explorador.js [--saida=<pasta das fotos>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argSaida = (process.argv.find(a => a.startsWith('--saida=')) || '').slice(8);
const SAIDA = path.resolve(argSaida || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-busca'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const WIN = process.platform === 'win32';
const REQ = `((process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null))`;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-busca-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  escreve(path.join(projeto, '.github', 'workflows', 'ci.yml'), 'name: ci\non: push\n');
  escreve(path.join(projeto, '.env'), 'CHAVE=1\n');
  escreve(path.join(projeto, '.gitignore'), 'ignorado.txt\ndist/\nnode_modules/\n');
  escreve(path.join(projeto, 'README.md'), '# Demo\nprojeto de demonstração\n');
  escreve(path.join(projeto, 'a.txt'), 'primeiro arquivo\nsegunda linha com alvoteste na raiz\n');
  escreve(path.join(projeto, 'docs', 'notas.md'), '# Notas\ntexto com ALVOTESTE aqui\noutra linha\n');
  escreve(path.join(projeto, 'src', 'app.js'), 'const a = 1;\n// ALVOTESTE na linha 2\nfunction concatenar() {}\nconst b = 2; // alvoteste de novo\n');
  escreve(path.join(projeto, 'src', 'util.js'), 'module.exports = 1;\n');
  escreve(path.join(projeto, 'grande.txt'), `${Array.from({ length: 650 }, (_, i) => `linha ${i} ALVOMUITO`).join('\n')}\n`);
  escreve(path.join(projeto, 'ignorado.txt'), 'ALVOTESTE ignorado pelo git\n');
  escreve(path.join(projeto, 'node_modules', 'pkg', 'i.js'), 'ALVOTESTE em node_modules\n');
  escreve(path.join(dir, 'fora', 'segredo.txt'), 'ALVOTESTE FORA da pasta aberta\n'); // alvo da junção que escapa
  const git = (...a) => execFileSync('git', ['-C', projeto, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  fs.symlinkSync(path.join(dir, 'fora'), path.join(projeto, 'jun'), 'junction');
  fs.appendFileSync(path.join(projeto, 'src', 'app.js'), '// modificado depois do commit\n'); // st-M no arquivo e na pasta
  escreve(path.join(projeto, 'novo.js'), 'novo\n'); // st-U
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
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

(async () => {
  const sb = sandbox();
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  // PATH sem as pastas que têm um claude/codex de verdade: o terminal novo abre direto no shell, sem o painel de conversas
  const reais = n => [n, n + '.exe', n + '.cmd', n + '.bat'];
  const PATH = (process.env.Path || process.env.PATH || '').split(path.delimiter).filter(d => d && !['claude', 'codex'].some(n => reais(n).some(f => fs.existsSync(path.join(d, f))))).join(path.delimiter);
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env[WIN ? 'Path' : 'PATH'] = PATH;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`electron pid ${proc.pid}`);
  fs.mkdirSync(SAIDA, { recursive: true });
  let pagina, main;
  try {
    const tMain = await alvos(portaMain);
    main = cliente(tMain.webSocketDebuggerUrl); await main.pronto;
    // espia pty:write (os bytes que chegam ao programa do terminal)
    for (let i = 0; i < 100; i++) {
      const ok = await main.ev(`(() => ${REQ}('electron').ipcMain.listeners('pty:write').length > 0)()`, { includeCommandLineAPI: true }).catch(() => false);
      if (ok) break; await sleep(300);
    }
    await main.ev(`(() => { const { ipcMain } = ${REQ}('electron'); globalThis.__escritas = []; const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write'); ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push(m && m.data); for (const l of ls) l(e, m); }); return true; })()`, { includeCommandLineAPI: true });
    const escritas = () => main.ev('JSON.stringify(globalThis.__escritas.filter(d => typeof d === "string" && !d.startsWith("\\x1b[")))').then(JSON.parse);
    const zeraEscritas = () => main.ev('globalThis.__escritas.length = 0');

    const tPag = await alvos(porta, 'page');
    pagina = cliente(tPag.webSocketDebuggerUrl); await pagina.pronto;
    const { send, ev } = pagina;
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { /* carregando */ } await sleep(120); } throw new Error(`tempo esgotado: ${msg}`); };
    const foto = async nome => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SAIDA, nome), Buffer.from(data, 'base64')); console.log(`  foto: ${nome}`); };
    const tecla = async (key, code, vk, modifiers = 0, text) => {
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
      await sleep(200);
    };
    const CTRL = 2, SHIFT = 8;
    const buscarAtalho = () => tecla('F', 'KeyF', 70, CTRL | SHIFT);
    const digita = async t => { await send('Input.insertText', { text: t }); };
    const clicaEm = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(250); };
    const painelAberto = () => ev(`!!document.querySelector('.ws.active .dev-busca.aberta')`);
    const resumo = () => ev(`document.querySelector('.ws.active .dev-busca-resumo').textContent`);
    const aviso = () => ev(`(() => { const a = document.querySelector('.ws.active .dev-busca-aviso'); return a.classList.contains('visivel') ? a.textContent : ''; })()`);
    const itens = () => ev(`[...document.querySelectorAll('.ws.active .dev-busca-lista .dev-busca-arq, .ws.active .dev-busca-lista .dev-busca-item')].map(e => e.className.includes('arq') ? 'A:' + e.querySelector('.dev-busca-arq-dir').textContent + '/' + e.querySelector('.dev-busca-arq-nome').textContent : 'I:' + e.textContent)`);
    const arquivosDaLista = async () => (await itens()).filter(x => x.startsWith('A:')).map(x => x.slice(2).replace(/^\//, ''));
    const limpaInput = async () => { await ev(`(() => { const i = document.querySelector('.ws.active .dev-busca-input'); i.focus(); i.select(); return true; })()`); await tecla('Backspace', 'Backspace', 8); };
    const digitaTermo = async t => { await limpaInput(); await digita(t); };
    const esperaResumo = async (re, ms = 15000) => { await espera(`${re}.test(document.querySelector('.ws.active .dev-busca-resumo').textContent)`, ms, `resumo ${re}`); return resumo(); };

    await espera(`document.querySelectorAll('.ws.active .dev-tree .dev-node').length > 5`, 40000, 'árvore carregada');
    await espera(`!!document.querySelector('.ws.active .dev-node.st-M')`, 20000, 'cores do git aplicadas');

    // 1) ordem da árvore
    console.log('\n[ordem]');
    const nomes = await ev(`[...document.querySelectorAll('.ws.active .dev-tree .dev-node')].filter(n => n.style.paddingLeft === '6px').map(n => n.querySelector('.dev-node-name').textContent)`);
    const semJun = nomes.filter(n => n !== 'jun');
    const esperado = ['.github', 'docs', 'node_modules', 'src', '.env', '.gitignore', 'a.txt', 'grande.txt', 'ignorado.txt', 'novo.js', 'README.md'];
    afirma(JSON.stringify(semJun) === JSON.stringify(esperado), `ordem: ${semJun.join(' | ')}`);
    afirma(!nomes.includes('.git'), '.git continua fora da árvore');
    afirma(nomes.includes('jun'), 'a junção aparece na árvore (só a busca não a segue)');

    // 2) cabeçalho na largura mínima do explorador (140 px) e botões novos
    console.log('\n[cabeçalho]');
    const cab = await ev(`(() => {
      const ws = document.querySelector('.ws.active'); ws.style.setProperty('--ex-w', '140px');
      const head = ws.querySelector('.dev-panel-head'); const bs = [...head.querySelectorAll('button')];
      const r = bs.map(b => b.getBoundingClientRect()); const t = head.querySelector('.dev-panel-title');
      return { n: bs.length, mesmaLinha: new Set(r.map(x => Math.round(x.top))).size === 1, larg: r.map(x => Math.round(x.width)), alturaCab: head.getBoundingClientRect().height, tituloOverflow: getComputedStyle(t).textOverflow, aria: bs.map(b => b.getAttribute('aria-label') || b.title) };
    })()`);
    afirma(cab.n === 5 && cab.mesmaLinha && cab.alturaCab <= 33, `cinco botões na mesma linha com 140 px: ${JSON.stringify(cab)}`);
    await foto('a-arvore-ordem-cabecalho-minimo.png');
    await ev(`document.querySelector('.ws.active').style.removeProperty('--ex-w')`);

    // 3) legenda
    console.log('\n[legenda]');
    await ev(`document.querySelector('.ws.active [data-act=legend]').focus()`);
    await tecla('Enter', 'Enter', 13, 0, '\r');
    await espera(`!!document.querySelector('.ws.active .dev-legenda.aberta')`, 5000, 'legenda aberta');
    afirma(await ev(`document.activeElement === document.querySelector('.ws.active .dev-legenda')`), 'o foco vai ao balão ao abrir');
    afirma(await ev(`document.querySelector('.ws.active [data-act=legend]').getAttribute('aria-expanded') === 'true'`), 'aria-expanded=true no botão');
    const nAm = await ev(`document.querySelectorAll('.ws.active .dev-legenda-amostra').length`);
    afirma(nAm === 19, `19 amostras na legenda (${nAm})`);
    const cores = await ev(`(() => {
      const arv = [...document.querySelectorAll('.ws.active .dev-tree .dev-node')];
      const chave = n => [...n.classList].filter(c => /^(k-|st-|dir$|file$|submodule$)/.test(c)).sort().join(' ');
      const cor = (n, s) => { const e = n.querySelector(s); return e ? getComputedStyle(e).color : ''; };
      const fam = n => getComputedStyle(n.querySelector('.dev-node-name')).fontFamily;
      const res = [];
      for (const a of document.querySelectorAll('.ws.active .dev-legenda-amostra')) {
        if (/\\b(active|selecionado|recortado)\\b/.test(a.className)) continue;
        const real = arv.find(n => chave(n) === chave(a) && !n.classList.contains('active') && !n.classList.contains('selecionado'));
        if (!real) continue;
        res.push({ chave: chave(a), nome: [cor(a, '.dev-node-name'), cor(real, '.dev-node-name')], icone: [cor(a, '.dev-node-icon'), cor(real, '.dev-node-icon')], badge: [cor(a, '.dev-node-badge'), cor(real, '.dev-node-badge')], emblema: [a.querySelector('.dev-node-badge').textContent, real.querySelector('.dev-node-badge').textContent], fonte: fam(a) === fam(real) });
      }
      return res;
    })()`);
    const iguais = cores.every(c => c.nome[0] === c.nome[1] && c.icone[0] === c.icone[1] && c.badge[0] === c.badge[1] && c.emblema[0] === c.emblema[1] && c.fonte);
    afirma(cores.length >= 8 && iguais, `${cores.length} amostras com cor de nome, de ícone, emblema e fonte iguais aos do nó real da árvore${iguais ? '' : ': ' + JSON.stringify(cores.filter(c => c.nome[0] !== c.nome[1] || c.icone[0] !== c.icone[1] || c.badge[0] !== c.badge[1] || c.emblema[0] !== c.emblema[1] || !c.fonte))}`);
    console.log('  chaves comparadas:', cores.map(c => c.chave).join(' | '));
    const dois = await ev(`(() => { const c = s => getComputedStyle(document.querySelector('.ws.active .dev-legenda-amostra' + s + ' .dev-node-name')).color; return [c('.st-I'), c('.k-hidden')]; })()`);
    afirma(dois[0] !== dois[1], `ignorado e oculto são dois cinzas distintos (${dois.join(' x ')})`);
    const textoOculto = await ev(`[...document.querySelectorAll('.ws.active .dev-legenda-texto')].map(t => t.textContent).find(t => /Arquivo oculto/.test(t))`);
    afirma(/\.env/.test(textoOculto) && /engrenagem/.test(textoOculto), 'o texto do oculto cita a exceção de configuração');
    afirma(await ev(`!!document.querySelector('.ws.active .dev-legenda-amostra.k-hidden-dir')`), 'a pasta oculta está na legenda');
    await ev(`document.querySelector('.ws.active .dev-legenda').scrollTop = 0`);
    await foto('e-legenda-aberta.png');
    await ev(`(() => { const l = document.querySelector('.ws.active .dev-legenda'); l.scrollTop = l.scrollHeight; return true; })()`);
    await sleep(200);
    await foto('e2-legenda-rolada-ate-o-fim.png');
    await ev(`document.querySelector('.ws.active .dev-legenda').scrollTop = 0`);
    await tecla('Escape', 'Escape', 27);
    afirma(!(await ev(`!!document.querySelector('.ws.active .dev-legenda.aberta')`)) && await ev(`document.activeElement === document.querySelector('.ws.active [data-act=legend]')`), 'Esc fecha e o foco volta ao botão "?"');
    await ev(`document.querySelector('.ws.active [data-act=legend]').click()`);
    await espera(`!!document.querySelector('.ws.active .dev-legenda.aberta')`, 3000, 'reabrir');
    const tree = await ev(`(() => { const r = document.querySelector('.ws.active .dev-tree').getBoundingClientRect(); return { x: r.x + r.width - 8, y: r.y + r.height - 20 }; })()`);
    await clicaEm(tree.x, tree.y);
    afirma(!(await ev(`!!document.querySelector('.ws.active .dev-legenda.aberta')`)), 'clique fora fecha o balão');
    await ev(`document.querySelector('.ws.active [data-act=legend]').click()`);
    await espera(`!!document.querySelector('.ws.active .dev-legenda.aberta')`, 3000, 'reabrir 2');
    await ev(`document.querySelector('.ws.active [data-act=legend]').click()`);
    afirma(!(await ev(`!!document.querySelector('.ws.active .dev-legenda.aberta')`)), 'o próprio botão fecha');

    // 4) painel fechado: sem rolagem horizontal, sem capturar clique, fora da ordem de Tab
    console.log('\n[painel fechado]');
    const fechado = await ev(`(() => {
      const p = document.querySelector('.ws.active .dev-busca'); const sobra = []; for (let e = p.parentElement.parentElement; e; e = e.parentElement) if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') sobra.push(e.className || e.tagName);
      const ws = document.querySelector('.ws.active').getBoundingClientRect();
      const sob = document.elementFromPoint(ws.right - 30, ws.top + 200);
      const input = p.querySelector('input'); input.focus();
      return { vis: getComputedStyle(p).visibility, sobra, sobCls: sob ? sob.className : null, sobDentro: !!(sob && sob.closest('.dev-busca-trilho')), inputFocavel: document.activeElement === input, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    })()`);
    afirma(fechado.vis === 'hidden' && !fechado.sobDentro && !fechado.inputFocavel && fechado.sobra.length === 0 && fechado.sw <= fechado.cw, `painel fechado: oculto, sem rolagem horizontal, sem capturar clique, campos fora do Tab (${JSON.stringify(fechado)})`);

    // 5) busca de texto
    console.log('\n[busca de texto]');
    await ev(`document.querySelector('.ws.active .dev-tree').focus()`);
    await buscarAtalho();
    await espera(`!!document.querySelector('.ws.active .dev-busca.aberta')`, 5000, 'painel aberto pelo Ctrl+Shift+F');
    afirma(await ev(`document.activeElement === document.querySelector('.ws.active .dev-busca-input')`), 'Ctrl+Shift+F abre o painel e foca o campo');
    afirma(/pelo menos 2 caracteres/.test(await resumo()), `ajuda do termo curto: "${await resumo()}"`);
    await digita('a');
    await sleep(700);
    afirma(/pelo menos 2 caracteres/.test(await resumo()) && (await itens()).length === 0, 'termo de 1 caractere mostra a ajuda e nenhum resultado');
    await limpaInput();
    await digita('ALVOTESTE');
    await esperaResumo(/ocorrências em/);
    const r1 = await resumo();
    const arq1 = await arquivosDaLista();
    afirma(JSON.stringify(arq1) === JSON.stringify(['a.txt', 'docs/notas.md', 'src/app.js']) || JSON.stringify(arq1.sort()) === JSON.stringify(['a.txt', 'docs/notas.md', 'src/app.js']), `texto acha em ${arq1.join(', ')} (${r1})`);
    afirma(!arq1.some(a => /ignorado|node_modules|segredo|jun/.test(a)), 'o arquivo ignorado, o de node_modules e o marcador da junção NÃO aparecem');
    afirma(/4 ocorrências em 3 arquivos/.test(r1), `resumo: ${r1}`);
    afirma(await ev(`document.querySelectorAll('.ws.active .dev-busca-trecho mark').length > 0 && [...document.querySelectorAll('.ws.active .dev-busca-trecho mark')].every(m => /alvoteste/i.test(m.textContent))`), 'o termo vem destacado em <mark>');
    await foto('b-busca-texto-resultados.png');
    // botões
    await ev(`document.querySelector('.ws.active [data-busca-opt=diferenciar]').click()`);
    await esperaResumo(/ocorrências? em/);
    afirma(/2 ocorrências em 2 arquivos/.test(await resumo()) && await ev(`document.querySelector('.ws.active [data-busca-opt=diferenciar]').getAttribute('aria-pressed') === 'true'`), `diferenciar maiúsculas muda o conjunto e o aria-pressed (${await resumo()})`);
    await ev(`document.querySelector('.ws.active [data-busca-opt=diferenciar]').click()`);
    await digitaTermo('conca');
    await esperaResumo(/ocorrência/);
    await ev(`document.querySelector('.ws.active [data-busca-opt=palavra]').click()`);
    await esperaResumo(/Nenhum resultado/);
    afirma(true, '"palavra inteira": conca não casa em concatenar');
    await ev(`document.querySelector('.ws.active [data-busca-opt=palavra]').click()`);
    await ev(`document.querySelector('.ws.active [data-busca-opt=regex]').click()`);
    await digitaTermo('(a');
    await esperaResumo(/Expressão regular inválida/);
    afirma(await ev(`document.querySelector('.ws.active .dev-busca-resumo').classList.contains('erro')`), 'regex inválida mostra a mensagem');
    await digitaTermo('conc(at)enar|ALVOT');
    await esperaResumo(/ocorrências? em/);
    afirma(/ocorrência/.test(await resumo()), `regex com grupo e alternância acha (${await resumo()})`);
    await ev(`document.querySelector('.ws.active [data-busca-opt=regex]').click()`);
    // parcial
    await digitaTermo('ALVOMUITO');
    await esperaResumo(/500 ocorrências/);
    afirma(/Parou em 500 ocorrências\. Refine o termo\./.test(await aviso()), `aviso de parcial visível: "${await aviso()}"`);
    await foto('c-busca-aviso-parcial.png');

    // 6) busca por nome
    console.log('\n[busca por nome]');
    await ev(`document.querySelector('.ws.active [data-busca-modo=nome]').click()`);
    await digitaTermo('NOTAS');
    await esperaResumo(/arquivo encontrado/);
    const nomesAch = await itens();
    afirma(nomesAch.length === 1 && /notas\.md/.test(nomesAch[0]), `nome: só notas.md, sem diferenciar maiúsculas (${nomesAch.join('; ')})`);
    afirma(await ev(`[...document.querySelectorAll('.ws.active [data-busca-opt]')].every(b => b.disabled)`), 'os três botões ficam desabilitados no modo nome');
    await digitaTermo('docs');
    await esperaResumo(/Nenhum resultado/);
    afirma(true, 'o nome não casa com o NOME DA PASTA (só o nome do arquivo)');
    await digitaTermo('.js');
    await esperaResumo(/arquivos encontrados/);
    afirma(/3 arquivos encontrados/.test(await resumo()), `nome ".js": app.js, util.js, novo.js (${await resumo()})`);
    await digitaTermo('NOTAS');
    await esperaResumo(/1 arquivo encontrado/);
    await foto('d-busca-nome.png');

    // 7) abrir o resultado
    console.log('\n[abrir o resultado]');
    await ev(`document.querySelector('.ws.active [data-busca-modo=texto]').click()`);
    await digitaTermo('ALVOTESTE');
    await esperaResumo(/4 ocorrências em 3 arquivos/);
    await limpaInput(); await digita('ALVOTESTE na linha');
    await esperaResumo(/1 ocorrência em 1 arquivo/);
    const alvoItem = await ev(`(() => { const b = document.querySelector('.ws.active .dev-busca-item'); const r = b.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2, txt: b.textContent }; })()`);
    console.log(`  item: ${alvoItem.txt}`);
    await clicaEm(alvoItem.x, alvoItem.y);
    await espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === 'app.js')`, 20000, 'aba app.js ativa');
    afirma(true, 'o clique abre o arquivo numa aba ativa');
    await espera(`(() => { const ed = window.monaco && monaco.editor.getEditors().find(e => (e.getModel()?.uri.path || '').endsWith('app.js')); return ed && ed.getPosition().lineNumber === 2; })()`, 8000, 'cursor na linha 2').catch(() => { });
    const pos = await ev(`(() => { const ed = monaco.editor.getEditors().find(e => (e.getModel()?.uri.path || '').endsWith('app.js')); const p = ed.getPosition(); return [p.lineNumber, p.column]; })()`);
    afirma(pos[0] === 2 && pos[1] === 4, `cursor na linha e na coluna do resultado (linha ${pos[0]}, coluna ${pos[1]})`);
    const sel = await ev(`(() => ({
      ativo: [...document.querySelectorAll('.ws.active .dev-tree .dev-node.file.active')].map(n => n.dataset.path.split(/[\\\\/]/).pop()),
      pastaSel: [...document.querySelectorAll('.ws.active .dev-tree .dev-node.dir.selecionado')].map(n => n.dataset.path.split(/[\\\\/]/).pop()),
      srcAberta: !!document.querySelector('.ws.active .dev-tree .dev-node.dir[data-path$="src"] .dev-node-chevron') && document.querySelector('.ws.active .dev-tree .dev-node.dir[data-path$="src"] .dev-node-chevron').textContent === '▾',
      painel: !!document.querySelector('.ws.active .dev-busca.aberta'),
      foco: !!document.activeElement.closest('.monaco-editor'),
    }))()`);
    afirma(JSON.stringify(sel.ativo) === '["app.js"]', `a árvore expandiu e o arquivo está ativo (${sel.ativo})`);
    afirma(JSON.stringify(sel.pastaSel) === '["src"]' && sel.srcAberta, `a pasta dele fica selecionada e aberta (${sel.pastaSel})`);
    afirma(!sel.painel && sel.foco, `o painel fechou e o foco está no editor (painel ${sel.painel}, foco no Monaco ${sel.foco})`);
    // a seleção sobrevive a uma mudança no disco (o watcher refaz a árvore)
    fs.writeFileSync(path.join(sb.projeto, 'src', 'util.js'), 'module.exports = 2;\n');
    await sleep(1800);
    const depois = await ev(`[...document.querySelectorAll('.ws.active .dev-tree .dev-node.dir.selecionado')].map(n => n.dataset.path.split(/[\\\\/]/).pop())`);
    afirma(JSON.stringify(depois) === '["src"]', `a seleção sobrevive ao dev:fs-changed (${depois})`);
    await foto('f-arquivo-aberto-e-selecionado.png');
    // arquivo na raiz: nada selecionado
    await ev(`(() => { const b = document.querySelector('.ws.active [data-act=search]'); b.click(); return true; })()`);
    await espera(`!!document.querySelector('.ws.active .dev-busca.aberta')`, 3000, 'reabrir pelo ícone');
    afirma(await ev(`document.querySelector('.ws.active .dev-busca-input').value === 'ALVOTESTE na linha'`) && /1 ocorrência/.test(await resumo()), 'reabrir mostra o último termo e os resultados');
    await ev(`document.querySelector('.ws.active [data-busca-modo=nome]').click()`);
    await digitaTermo('a.txt');
    await esperaResumo(/1 arquivo encontrado/);
    const itemA = await ev(`(() => { const b = document.querySelector('.ws.active .dev-busca-item'); const r = b.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; })()`);
    await clicaEm(itemA.x, itemA.y);
    await espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === 'a.txt')`, 20000, 'aba a.txt ativa');
    await sleep(400);
    afirma((await ev(`document.querySelectorAll('.ws.active .dev-tree .dev-node.selecionado').length`)) === 0, 'resultado na raiz: nenhuma pasta fica selecionada');

    // 8) teclado com o painel aberto
    console.log('\n[teclado]');
    await ev(`document.querySelector('.ws.active .dev-busca-input').value = ''`);
    await buscarAtalho();
    await espera(`!!document.querySelector('.ws.active .dev-busca.aberta')`, 3000, 'painel aberto de novo');
    const abaAntes = await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`);
    // foco no editor, painel aberto: Ctrl+Tab troca de aba
    await ev(`(() => { const ed = monaco.editor.getEditors().find(e => (e.getModel()?.uri.path || '').endsWith('a.txt')); ed.focus(); return true; })()`);
    await tecla('Tab', 'Tab', 9, CTRL);
    const abaDepois = await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`);
    afirma(abaDepois !== abaAntes && (await painelAberto()), `painel aberto, foco no editor: Ctrl+Tab troca de aba (${abaAntes} para ${abaDepois}) e o painel segue aberto`);
    await buscarAtalho();
    afirma(await ev(`document.activeElement === document.querySelector('.ws.active .dev-busca-input')`), 'com o foco no editor, Ctrl+Shift+F foca o campo da busca aberta');
    const abaMeio = await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`);
    await tecla('Tab', 'Tab', 9, CTRL);
    afirma((await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`)) === abaMeio, 'com o foco DENTRO do painel os atalhos da IDE não disparam (Ctrl+Tab)');
    // setas entre campo e itens
    await ev(`document.querySelector('.ws.active [data-busca-modo=texto]').click()`);
    await digitaTermo('ALVOTESTE');
    await esperaResumo(/4 ocorrências em 3 arquivos/);
    await ev(`document.querySelector('.ws.active .dev-busca-input').focus()`);
    await tecla('ArrowDown', 'ArrowDown', 40);
    afirma(await ev(`document.activeElement.classList.contains('dev-busca-item')`), 'seta para baixo vai do campo ao primeiro resultado');
    await tecla('ArrowUp', 'ArrowUp', 38);
    afirma(await ev(`document.activeElement === document.querySelector('.ws.active .dev-busca-input')`), 'seta para cima volta ao campo');
    await foto('g-painel-foco-visivel.png');
    // Esc fecha e devolve o foco a quem abriu (o editor, mesmo com a aba trocada: é a mesma instância do Monaco)
    await tecla('Escape', 'Escape', 27);
    afirma(!(await painelAberto()), 'Esc fecha o painel');
    afirma(await ev(`document.activeElement !== document.body && !!document.activeElement.closest('.ws.active')`), `o foco não se perde ao fechar (${await ev('document.activeElement.className || document.activeElement.tagName')})`);
    // aberta pelo ícone, o Esc devolve o foco ao ícone
    await ev(`document.querySelector('.ws.active [data-act=search]').focus()`);
    await tecla('Enter', 'Enter', 13, 0, '\r');
    await espera(`!!document.querySelector('.ws.active .dev-busca.aberta')`, 3000, 'painel aberto pelo ícone');
    await tecla('Escape', 'Escape', 27);
    afirma(!(await painelAberto()) && await ev(`document.activeElement === document.querySelector('.ws.active [data-act=search]')`), 'aberta pelo ícone, o Esc devolve o foco ao ícone');
    await ev(`monaco.editor.getEditors()[0].focus()`);
    await buscarAtalho();
    await espera(`!!document.querySelector('.ws.active .dev-busca.aberta')`, 3000, 'painel aberto do editor');
    await tecla('Escape', 'Escape', 27);
    afirma(!(await painelAberto()) && await ev(`!!document.activeElement.closest('.monaco-editor')`), 'Esc devolve o foco a quem abriu (o editor)');
    // fechado: Tab não entra no painel
    const tabDentro = await ev(`(() => { const p = document.querySelector('.ws.active .dev-busca'); return [...p.querySelectorAll('button, input')].some(e => { e.focus(); return document.activeElement === e; }); })()`);
    afirma(!tabDentro, 'painel fechado: nenhum campo ou botão recebe foco');
    // Ctrl+Tab volta a funcionar com o painel fechado
    const a1 = await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`);
    await ev(`monaco.editor.getEditors()[0].focus()`);
    await tecla('Tab', 'Tab', 9, CTRL);
    afirma((await ev(`document.querySelector('.ws.active .dev-tab.active .dev-tab-name').textContent`)) !== a1, 'Ctrl+Tab volta a funcionar com o painel fechado');
    // clique no editor sob a faixa do painel fechado chega ao Monaco
    const ponto = await ev(`(() => { const r = document.querySelector('.ws.active .dev-editors').getBoundingClientRect(); const ws = document.querySelector('.ws.active').getBoundingClientRect(); return { x: ws.right - 40, y: r.top + r.height / 2 }; })()`);
    const sob = await ev(`(() => { const e = document.elementFromPoint(${ponto.x}, ${ponto.y}); return e ? !!e.closest('.dev-editors') && !e.closest('.dev-busca-trilho') : false; })()`);
    afirma(sob, 'um clique sobre a faixa do painel fechado chega ao editor');

    // 9) terminal: o Ctrl+Shift+F na página IDE abre a busca e não vira bytes; o Esc do terminal segue do terminal
    console.log('\n[terminal]');
    await ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
    await sleep(500);
    if (await ev(`!!document.querySelector('.dev-term-menu')`)) await ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
    await espera(`!!document.querySelector('.ws.active .term-pane')`, 20000, 'terminal aberto');
    await espera(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].some(d => /[>$]/.test(d.textContent))`, 30000, 'prompt do shell');
    await sleep(800);
    const corpo = await ev(`(() => { const r = document.querySelector('.ws.active .term-pane-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await ev(`window.__kd = []; window.addEventListener('keydown', e => { if (e.code === 'KeyF' && e.ctrlKey && e.shiftKey) window.__kd.push(e.defaultPrevented); })`);
    await clicaEm(corpo.x, corpo.y);
    await zeraEscritas();
    await buscarAtalho();
    afirma(await painelAberto(), 'com o foco no terminal, Ctrl+Shift+F abre o painel de busca');
    afirma(JSON.stringify(await ev('window.__kd')) === '[true]' && !(await escritas()).some(d => d.includes('\x06')), `a tecla é consumida pela IDE e não vira bytes no terminal (defaultPrevented ${JSON.stringify(await ev('window.__kd'))}, bytes ${JSON.stringify(await escritas())})`);
    // painel aberto, foco no terminal: Esc é do terminal e o painel não fecha
    await clicaEm(corpo.x, corpo.y);
    await zeraEscritas();
    await tecla('Escape', 'Escape', 27);
    afirma(await painelAberto(), 'painel aberto e foco no terminal: o Esc não fecha o painel');
    afirma((await escritas()).some(d => d === '\x1b'), `o Esc chega ao terminal (${JSON.stringify(await escritas())})`);
    await ev(`document.querySelector('.ws.active .dev-busca-input').focus()`);
    await tecla('Escape', 'Escape', 27);
    afirma(!(await painelAberto()), 'com o foco no painel, o Esc fecha');
    // página Terminal: a tecla não é engolida (chega ao xterm como Ctrl+F)
    await ev(`document.querySelector('[data-page="terminal"]').click()`);
    await espera(`!!document.querySelector('#page-terminal.active')`, 10000, 'página Terminal');
    await ev(`(() => { const el = [...document.querySelectorAll('#term-page [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
    await sleep(500);
    if (await ev(`!!document.querySelector('.dev-term-menu')`)) await ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
    await espera(`!!document.querySelector('#term-page .term-pane')`, 20000, 'terminal da página Terminal');
    await espera(`[...document.querySelectorAll('#term-page .xterm-rows > div')].some(d => /[>$]/.test(d.textContent))`, 30000, 'prompt da página Terminal');
    await sleep(800);
    const corpo2 = await ev(`(() => { const r = document.querySelector('#term-page .term-pane-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await clicaEm(corpo2.x, corpo2.y);
    await zeraEscritas();
    await buscarAtalho();
    await sleep(300);
    afirma(JSON.stringify(await ev('window.__kd')) === '[true,false]', `na página Terminal o Ctrl+Shift+F NÃO é consumido (segue para o xterm): defaultPrevented ${JSON.stringify(await ev('window.__kd'))}`);
    afirma(!(await ev(`!!document.querySelector('.dev-busca.aberta')`)), 'e nenhum painel de busca abre');
    await ev(`document.querySelector('[data-page="devcode"]').click()`);
  } catch (e) {
    falhas.push(`erro: ${e.message}`); console.log(`  ✗ erro: ${e.stack || e.message}`);
  } finally {
    try { pagina?.ws.close(); main?.ws.close(); } catch { /* fechado */ }
    try { if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch { /* já encerrou */ }
    await sleep(1500);
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ${falhas.join('\n- ')}` : '\nTudo conferido.');
  process.exit(falhas.length ? 1 : 0);
})();

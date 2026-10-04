/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
/*! Rendra IDE | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Rendra Browser: janela própria e ISOLADA para ver uma página. A página roda sem preload, sem Node, em sandbox, numa
// sessão própria que não persiste, sem acesso ao IPC da IDE. Só http(s); permissões e downloads negados.
// A parte de decisão (opções, filtros) é pura e testada no node; só criarRendraBrowser toca o Electron.
const path = require('path');
const { urlWebSegura } = require('./terminal-env');

const PARTICAO = 'rendra-browser'; // sem "persist:" = sessão em memória, descartada ao fechar
const BARRA_ALTURA = 40;

// webPreferences da página visitada: nada da IDE chega aqui (sem preload, sem nodeIntegration).
function prefsPagina() {
  return { partition: PARTICAO, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, spellcheck: false };
}
// A barra é conteúdo local da IDE (não da web), com um preload mínimo próprio (voltar/avançar/recarregar/abrir).
function prefsBarra() {
  return { preload: path.join(__dirname, 'rendra-browser-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
}
// A janela hospedeira também não tem preload nem Node.
function opcoesJanela(oculta) {
  const o = {
    width: 1100, height: 760, minWidth: 480, minHeight: 360, backgroundColor: '#161616', title: 'Rendra Browser', autoHideMenuBar: true,
    show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  };
  if (oculta) { o.x = -10000; o.y = 0; }
  return o;
}

// Único filtro de URL: http/https sem usuário e senha (o mesmo do navegador padrão).
const urlPermitida = urlWebSegura;

// Janela filha / navegação pedida pela página: http(s) fica na mesma janela; o resto é negado.
function decideJanelaFilha(url) {
  return { action: 'deny', navegarPara: urlPermitida(url) };
}
// Permissões (câmera, microfone, notificações, geolocalização, etc.) e downloads: sempre negados.
const negaPermissao = (_wc, _permissao, cb) => { if (typeof cb === 'function') cb(false); return false; };
const negaVerificacao = () => false;

function configuraSessao(ses) {
  ses.setPermissionRequestHandler(negaPermissao);
  ses.setPermissionCheckHandler(negaVerificacao);
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}

// Navegação do app principal: só a própria página; janela ou navegação não pedida nunca acontece (o único caminho
// para links é o clique confirmado, que vai para open-external ou para o Rendra Browser).
function navegacaoDoAppPermitida(urlDestino, urlAtual) {
  return typeof urlDestino === 'string' && urlDestino === urlAtual;
}

// Navegação já concluída que viola "só http(s)" (about:blank). chrome-error: é a página de erro do Chromium (sem conteúdo).
function deveDesfazer(u) {
  return typeof u === 'string' && !urlPermitida(u) && !u.startsWith('chrome-error:');
}

const janelas = new Set();

function criarRendraBrowser(electron, url, { oculta = false } = {}) {
  const seguro = urlPermitida(url);
  if (!seguro) return null;
  const { BrowserWindow, WebContentsView, session, ipcMain, shell } = electron;
  const ses = session.fromPartition(PARTICAO);
  if (!ses.__rendraConfigurada) { configuraSessao(ses); ses.__rendraConfigurada = true; }

  const win = new BrowserWindow(opcoesJanela(oculta));
  win.removeMenu();
  const pagina = new WebContentsView({ webPreferences: prefsPagina() });
  const barra = new WebContentsView({ webPreferences: prefsBarra() });
  win.contentView.addChildView(pagina);
  win.contentView.addChildView(barra);
  const wc = pagina.webContents;
  const layout = () => {
    const { width, height } = win.getContentBounds();
    barra.setBounds({ x: 0, y: 0, width, height: BARRA_ALTURA });
    pagina.setBounds({ x: 0, y: BARRA_ALTURA, width, height: Math.max(0, height - BARRA_ALTURA) });
  };
  layout();
  win.on('resize', layout);

  const estado = () => {
    if (win.isDestroyed() || wc.isDestroyed()) return;
    const nav = wc.navigationHistory;
    const atual = wc.getURL() || seguro;
    win.setTitle(atual);
    if (!barra.webContents.isDestroyed()) barra.webContents.send('rb:estado', { url: atual, voltar: nav.canGoBack(), avancar: nav.canGoForward() });
  };
  const navega = destino => { const u = urlPermitida(destino); if (u) wc.loadURL(u).catch(() => {}); };
  wc.setWindowOpenHandler(({ url: u }) => { const d = decideJanelaFilha(u); if (d.navegarPara) setImmediate(() => navega(d.navegarPara)); return { action: 'deny' }; });
  const bloqueia = (e, u) => { if (!urlPermitida(u)) e.preventDefault(); };
  wc.on('will-navigate', bloqueia);
  wc.on('will-redirect', bloqueia);
  // about:blank disparado pela página (location.href) não passa pelo will-navigate: depois que acontece, volta para a
  // entrada anterior do histórico e apaga a entrada em branco; sem entrada anterior permitida, recarrega a inicial.
  wc.on('did-navigate', (_e, u) => {
    if (!deveDesfazer(u)) return;
    const h = wc.navigationHistory, ativo = h.getActiveIndex();
    const anterior = ativo > 0 ? h.getEntryAtIndex(ativo - 1) : null;
    if (anterior && urlPermitida(anterior.url)) {
      h.goToIndex(ativo - 1);
      wc.once('did-navigate', () => { try { h.removeEntryAtIndex(ativo); } catch { /* sem entrada */ } });
    } else wc.loadURL(seguro).catch(() => {});
  });
  wc.on('page-title-updated', e => e.preventDefault()); // o título da janela é sempre a URL
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-stop-loading']) wc.on(ev, estado);

  const idBarra = barra.webContents.id;
  const aoComando = (e, cmd) => {
    if (e.sender.id !== idBarra) return;
    if (cmd === 'voltar' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (cmd === 'avancar' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (cmd === 'recarregar') wc.reload();
    else if (cmd === 'abrir-padrao') { const u = urlPermitida(wc.getURL()); if (u) shell.openExternal(u); }
  };
  ipcMain.on('rb:comando', aoComando);
  barra.webContents.on('did-finish-load', estado);
  barra.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'rendra-browser-barra.html'));
  wc.loadURL(seguro).catch(() => {});

  janelas.add(win);
  win.on('closed', () => {
    janelas.delete(win); ipcMain.removeListener('rb:comando', aoComando);
    for (const c of [wc, barra.webContents]) if (!c.isDestroyed()) c.close(); // as views não morrem com a janela
  });
  win.once('ready-to-show', () => { if (oculta) win.showInactive(); else win.show(); });
  win.rendraBrowser = { wc, barra: barra.webContents };
  return win;
}

module.exports = { PARTICAO, BARRA_ALTURA, prefsPagina, prefsBarra, opcoesJanela, urlPermitida, decideJanelaFilha, negaPermissao, negaVerificacao, configuraSessao, navegacaoDoAppPermitida, deveDesfazer, criarRendraBrowser, janelas };

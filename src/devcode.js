/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// DevCode tab backend: workspaces (one folder each), file read/write and PTY terminals.
// File access is confined to the folders of the open workspaces; the renderer never touches fs.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const HIDDEN = new Set(['.git']);

const os = require('os');
const { caminhoNoWsl } = require('../renderer/terminal-escolha');
const { ambienteDoTerminal } = require('../renderer/sessoes-escolha');
const { validarNome } = require('../renderer/novo-item');
const { ambientePty } = require('./terminal-env');
const { candidatosDoCaminho } = require('./caminho-terminal');
const { temImagem } = require('./clip-imagem');
const { criarManipulador: criarManipuladorMidia } = require('./protocolo-midia');
const { criarOperacoes } = require('./arquivos-ops');
const crypto = require('crypto');
const { criarCiclo } = require('./ciclo-terminais');
const { criarRegistro } = require('./registro-terminais');
const { comLimite: aoTeto } = require('./sessoes-io'); // roda o trabalho até o teto e devolve o parcial
const agentesProc = require('./agentes-proc');
const encerrarProc = require('./encerrar-proc');
const { idValido } = require('../renderer/sessoes-escolha');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = os.homedir();
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
// Windows and macOS file systems are case-insensitive; Linux is not
const norm = p => (IS_WIN || IS_MAC ? p.toLowerCase() : p);

// Shells offered in the terminal panel (only the installed ones are listed)
function availableShells() {
  if (!IS_WIN) {
    // macOS / Linux: the user's login shell first, then the other common ones installed
    const login = process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash');
    const seen = new Set();
    return [login, '/bin/zsh', '/bin/bash', '/usr/bin/fish', '/opt/homebrew/bin/fish', '/usr/local/bin/fish']
      .filter(f => fs.existsSync(f) && !seen.has(path.basename(f)) && seen.add(path.basename(f)))
      .map(f => {
        const name = path.basename(f);
        return { key: name, label: name === 'zsh' ? 'Zsh' : name === 'bash' ? 'Bash' : name === 'fish' ? 'Fish' : name, file: f, args: ['-l'] };
      });
  }
  const pwsh7 = path.join(PROGRAM_FILES, 'PowerShell', '7', 'pwsh.exe');
  const gitBash = [path.join(PROGRAM_FILES, 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')]
    .find(p => fs.existsSync(p));
  const shells = [
    { key: 'powershell', label: 'PowerShell', file: fs.existsSync(pwsh7) ? pwsh7 : 'powershell.exe', args: ['-NoLogo'] },
  ];
  // --login -i: same startup as the Git Bash shortcut (profile, prompt, colors)
  if (gitBash) shells.push({ key: 'gitbash', label: 'Git Bash', file: gitBash, args: ['--login', '-i'] });
  shells.push({ key: 'cmd', label: 'CMD', file: 'cmd.exe', args: [] });
  return shells;
}

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ── WSL ──────────────────────────────────────────────────────────────────────
// A WSL workspace is a UNC folder (\\wsl.localhost\<distro>\...). Files go through that share;
// terminals and git run inside the distro, which is faster and avoids git's ownership errors.
const WSL_UNC = /^\\\\(wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
function wslInfoOf(p) {
  if (!IS_WIN) return null; // WSL only exists on Windows
  const m = WSL_UNC.exec(path.resolve(p));
  if (!m) return null;
  return { distro: m[2], linuxPath: (m[3] || '\\').replace(/\\/g, '/') };
}
const toWslUnc = (distro, linuxPath) => `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`;

function runWsl(args, timeout = 20000) {
  return new Promise(resolve => {
    // wsl.exe prints its own messages in UTF-16LE; commands run inside the distro print UTF-8
    execFile('wsl.exe', args, { windowsHide: true, encoding: 'buffer', timeout, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}
const utf16 = buf => (buf ? buf.toString('utf16le').replace(/\0/g, '') : '');

// A stopped distro can make wsl.exe fail with Wsl/Service/0x8007274c (service timeout) while
// the VM boots, especially with Docker Desktop running. Boot it first, retrying a few times.
async function wakeWslDistro(distro, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await runWsl(['-d', distro, '-e', 'true'], 60000)) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function listWslDistros() {
  if (!IS_WIN) return [];
  const out = utf16(await runWsl(['-l', '-v'], 10000));
  const distros = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const m = line.match(/^\s*(\*)?\s*(\S+)\s+(\S+)\s+(\d)\s*$/);
    if (!m || /^docker-desktop/i.test(m[2])) continue; // Docker's internal distros aren't for users
    distros.push({ name: m[2], state: m[3], version: +m[4], isDefault: !!m[1] });
  }
  return distros;
}

// ConPTY embarcado do node-pty (conpty.dll + OpenConsole.exe): repassa ao terminal as consultas de cor
// (OSC 10/11) que o ConPTY do sistema engole. Só existe no Windows; a opção "conptyDll" das Configurações
// (padrão ligada) volta ao ConPTY do sistema quando é false. Vale para terminais abertos depois.
function opcoesConpty(isWin, settings) {
  if (!isWin) return {};
  return { useConptyDll: settings?.conptyDll !== false };
}

// `deps` troca as dependências de sistema nos testes (wsl.exe e node-pty reais não entram neles)
// `userData`: pasta de dados do app (o registro de terminais vivos mora nela); sem ela não há registro
function registerDevCode({ ipcMain, dialog, store, getWindow, userData, deps = {} }) {
  const listDistros = deps.listWslDistros || listWslDistros;
  const wakeDistro = deps.wakeWslDistro || wakeWslDistro;
  const loadPty = deps.loadPty || (() => require('@lydell/node-pty'));
  const roots = new Set(); // lower-cased absolute folders the renderer may touch
  const ptys = new Map();
  const registro = deps.registro || (userData ? criarRegistro({ dir: userData }) : null);
  const ciclo = criarCiclo({ registro, env: deps.env || process.env, prazos: deps.prazos, deps: deps.ciclo });
  let nextPtyId = 1;
  let pty = null; // native module, loaded when the first terminal opens

  // Windows folders opened "in WSL": files stay on NTFS (fast), terminals run in the distro on
  // the /mnt/<drive>/… path. lower root → { distro, linuxPath }
  const wslMounted = new Map();

  const addRoot = (dir, viaWsl) => {
    const full = path.resolve(dir);
    roots.add(norm(full));
    if (viaWsl?.distro && viaWsl?.linuxPath) wslMounted.set(norm(full), { distro: viaWsl.distro, linuxPath: viaWsl.linuxPath });
    const mounted = wslMounted.get(norm(full));
    const wsl = wslInfoOf(full) || (mounted ? { ...mounted, viaWindows: true } : null);
    return { root: full, name: path.basename(full) || full, wsl };
  };

  // WSL target of any path: a \\wsl.localhost share, or a folder inside a WSL-mounted workspace
  const wslFor = p => {
    const direct = wslInfoOf(p);
    if (direct) return direct;
    const a = norm(path.resolve(p));
    for (const [r, m] of wslMounted) {
      if (a === r || a.startsWith(r + path.sep)) {
        const rel = path.resolve(p).slice(r.length).replace(/\\/g, '/');
        return { distro: m.distro, linuxPath: m.linuxPath + rel };
      }
    }
    return null;
  };

  // Linux path of a Windows folder, as the distro sees it (respects custom automount roots)
  async function wslPathOf(distro, winPath) {
    const out = (await runWsl(['-d', distro, '-e', 'wslpath', '-a', winPath.replace(/\\/g, '/')], 60000))?.toString('utf8').trim();
    if (out && out.startsWith('/')) return out;
    const m = /^([a-z]):\\?(.*)$/i.exec(winPath);
    return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : null;
  }

  // Windows paths are case-insensitive; compare normalised forms
  const inside = p => {
    const a = norm(path.resolve(p));
    for (const r of roots) {
      if (a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return true;
    }
    return false;
  };
  const inside0 = (p, r) => { const a = norm(path.resolve(p)), b = norm(path.resolve(r)); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  const guard = p => {
    if (!inside(p)) throw new Error('Caminho fora das pastas abertas');
    return path.resolve(p);
  };

  let wslCache = null;
  const wslInfo = (refresh = false) => {
    if (!wslCache || refresh) wslCache = listDistros().then(distros => ({ available: distros.length > 0, distros }));
    return wslCache;
  };
  ipcMain.handle('dev:wsl-info', () => wslInfo());

  // ── Windows folder "mounted" for a distro ──────────────────────────────────
  // The first time someone opens via WSL they can point at their Windows projects folder.
  // Linux already sees every drive under /mnt/<drive>; we remember the folder, start the WSL
  // open dialog there from then on, and add a ~/<Name> link so it's one `cd` away in Linux.
  const getMounts = () => store.get('devcode.wslMounts', {});

  ipcMain.handle('dev:wsl-mount-get', (_e, distro) => {
    const m = getMounts()[distro];
    return m && isDir(m.folder) ? m : null;
  });

  ipcMain.handle('dev:wsl-mount-set', async (_e, distro) => {
    const res = await dialog.showOpenDialog(getWindow(), {
      properties: ['openDirectory'],
      title: `Pasta do Windows com seus projetos (usada no WSL ${distro})`,
      defaultPath: HOME,
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const folder = path.resolve(res.filePaths[0]);
    const linuxPath = await wslPathOf(distro, folder);
    if (!linuxPath) return { error: 'Não foi possível localizar essa pasta dentro do Linux' };
    // ~/<Name> → /mnt/c/…, only if that name is free (never overwrite anything in the home)
    const name = (path.basename(folder) || 'windows').replace(/[^\w.-]/g, '_');
    const q = s => `'${s.replace(/'/g, "'\\''")}'`;
    const out = (await runWsl(['-d', distro, '-e', 'sh', '-c',
      `L="$HOME/${name}"; if [ -L "$L" ] || [ ! -e "$L" ]; then ln -sfn ${q(linuxPath)} "$L" && echo "$L"; fi`], 60000))?.toString('utf8').trim();
    const mount = { folder, linuxPath, link: out || null };
    store.set('devcode.wslMounts', { ...getMounts(), [distro]: mount });
    return mount;
  });

  // opts.distro → open "in WSL": starts in the mounted Windows folder (opts.useMount) or the
  // distro's Linux home. A Windows folder picked here becomes a WSL-mode workspace.
  ipcMain.handle('dev:open-folder', async (_e, opts = {}) => {
    let defaultPath;
    const mount = opts.distro && opts.useMount ? getMounts()[opts.distro] : null;
    if (mount && isDir(mount.folder)) defaultPath = mount.folder;
    else if (opts.distro) {
      const home = (await runWsl(['-d', opts.distro, '-e', 'sh', '-c', 'echo $HOME'], 60000))?.toString('utf8').trim();
      defaultPath = toWslUnc(opts.distro, home && home.startsWith('/') ? home : '/');
    }
    const res = await dialog.showOpenDialog(getWindow(), {
      properties: ['openDirectory'],
      title: opts.distro ? `Abrir projeto no WSL (${opts.distro})` : 'Abrir pasta',
      defaultPath,
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const picked = res.filePaths[0];
    if (opts.distro && !wslInfoOf(picked)) {
      const linuxPath = await wslPathOf(opts.distro, path.resolve(picked));
      if (linuxPath) return addRoot(picked, { distro: opts.distro, linuxPath });
    }
    return addRoot(picked);
  });

  // Workspaces persist as [{ name, root, cols, custom }]; folders that no longer exist are dropped
  ipcMain.handle('dev:load-workspaces', () => {
    let saved = store.get('devcode.workspaces');
    if (!saved) {
      const last = store.get('devcode.lastFolder'); // pre-workspace versions kept a single folder
      saved = { list: last ? [{ root: last }] : [], active: 0 };
    }
    const list = (saved.list || []).map(w => {
      // WSL folders aren't probed: touching the share would boot a stopped distro at startup
      const root = w.root && (wslInfoOf(w.root) || isDir(w.root)) ? addRoot(w.root, w.wsl) : null;
      // editorHidden: editor column hidden; older stores lack it (= visible) and it does not depend on the folder
      return { name: w.name || null, custom: !!w.custom, cols: w.cols || 1, root, groups: root ? (w.groups || []) : [], editorHidden: w.editorHidden === true };
    });
    return { list, active: saved.active || 0 };
  });

  ipcMain.handle('dev:save-workspaces', (_e, data) => {
    store.set('devcode.workspaces', {
      list: (data?.list || []).map(w => ({
        name: String(w.name || ''), custom: !!w.custom, cols: w.cols | 0 || 1, root: w.root || null,
        // Windows folder opened in WSL mode
        wsl: w.wsl?.distro && w.wsl?.linuxPath ? { distro: String(w.wsl.distro), linuxPath: String(w.wsl.linuxPath) } : null,
        // open editor tabs, restored on the next launch
        groups: (w.groups || []).map(g => ({ tabs: (g.tabs || []).map(String), active: g.active ? String(g.active) : null })),
        // editor column hidden (only the boolean true counts)
        editorHidden: w.editorHidden === true,
      })),
      active: data?.active | 0,
    });
    return true;
  });

  ipcMain.handle('dev:list', (_e, dir) => {
    try {
      const full = guard(dir);
      return fs.readdirSync(full, { withFileTypes: true })
        .filter(d => !HIDDEN.has(d.name))
        .map(d => ({ name: d.name, path: path.join(full, d.name), isDir: d.isDirectory() }))
        .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    } catch (e) {
      return { error: e.message };
    }
  });

  // Caminhos do terminal: confere se o texto aponta para um arquivo ou pasta que existe DENTRO das pastas
  // abertas (a mesma regra do guard). Só lê metadados com tempo limite (um WSL parado não trava nada) e
  // nunca abre nem executa: o renderer abre o resultado no editor ou revela a pasta na árvore.
  const STAT_TIMEOUT_MS = 1500;
  const comLimite = p => Promise.race([p, new Promise(r => setTimeout(() => r(null), deps.statTimeoutMs || STAT_TIMEOUT_MS))]);
  // realpath: o caminho REAL (depois de junção/symlink) também tem de estar dentro das pastas abertas.
  const realDentro = async alvo => {
    const real = await fs.promises.realpath(alvo);
    if (inside(real)) return true;
    for (const r of roots) { // a própria pasta aberta pode ser um link (ou ter nome curto 8.3): compara com o real dela
      const rr = await fs.promises.realpath(r).catch(() => null);
      if (rr && inside0(real, rr)) return true;
    }
    return false;
  };
  const statComLimite = alvo => comLimite((async () => {
    try {
      const st = await fs.promises.stat(alvo);
      return (await realDentro(alvo)) ? { isDir: st.isDirectory(), isFile: st.isFile() } : null;
    } catch { return null; }
  })());
  ipcMain.handle('dev:resolve-path', async (_e, { texto, cwd, root } = {}) => {
    try {
      const bases = [cwd, root].map(b => (typeof b === 'string' && b && inside(b) ? path.resolve(b) : null));
      const wsl = (bases[0] && wslFor(bases[0])) || (bases[1] && wslFor(bases[1])) || null;
      const lista = candidatosDoCaminho(texto, { cwd: bases[0], root: bases[1], isWin: IS_WIN, distro: wsl?.distro || null, home: HOME });
      for (const alvo of lista) {
        if (!inside(alvo)) continue;
        const st = await statComLimite(alvo);
        if (st && (st.isDir || st.isFile)) return { path: alvo, isDir: st.isDir };
      }
    } catch { /* sem link */ }
    return null;
  });

  ipcMain.handle('dev:read', async (_e, file) => {
    try {
      const full = guard(file);
      if (!(await comLimite(realDentro(full).catch(() => false)))) return { error: 'Caminho fora das pastas abertas' };
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES) return { error: 'Arquivo grande demais para abrir no editor (limite de 5 MB)' };
      const buf = fs.readFileSync(full);
      if (buf.subarray(0, 8000).includes(0)) return { error: 'Arquivo binário, não dá para abrir no editor', binario: true };
      return { content: buf.toString('utf8') };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('dev:write', (_e, file, content) => {
    try {
      fs.writeFileSync(guard(file), String(content), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Novo arquivo / nova pasta no explorador. Mesmo caminho do dev:write (fs sobre o caminho, que
  // também é o share \\wsl.localhost em workspace WSL). O nome é validado aqui também; a criação não
  // sobrescreve nada: 'wx' no arquivo e mkdir sem recursivo na pasta (EEXIST vira "já existe").
  const criarItem = (parent, name, criar) => {
    try {
      const dir = guard(parent);
      const erro = validarNome(name);
      if (erro) return { ok: false, error: erro };
      const alvo = path.join(dir, String(name).trim());
      if (!inside(alvo)) return { ok: false, error: 'Caminho fora das pastas abertas' };
      criar(alvo);
      return { ok: true, path: alvo };
    } catch (e) {
      return { ok: false, error: e.code === 'EEXIST' ? `"${String(name).trim()}" já existe nesta pasta` : e.message };
    }
  };
  ipcMain.handle('dev:create-file', (_e, parent, name) => criarItem(parent, name, alvo => fs.writeFileSync(alvo, '', { flag: 'wx' })));
  ipcMain.handle('dev:create-dir', (_e, parent, name) => criarItem(parent, name, alvo => fs.mkdirSync(alvo)));

  // Excluir (Lixeira), copiar, mover e importar: src/arquivos-ops.js. shell só entra na hora de excluir (deps.trashItem nos testes).
  const ops = criarOperacoes({
    guard, realDentro, inside0,
    raizes: () => roots,
    // e2e: RENDRA_E2E_LIXEIRA troca a Lixeira do sistema por uma pasta (a prova real do trashItem está nos spikes; o teste
    // não deve encher a Lixeira de quem usa a máquina)
    trashItem: deps.trashItem || (process.env.RENDRA_E2E_LIXEIRA
      ? async p => { await fs.promises.mkdir(process.env.RENDRA_E2E_LIXEIRA, { recursive: true }); await fs.promises.rename(p, path.join(process.env.RENDRA_E2E_LIXEIRA, `${Date.now()}-${path.basename(p)}`)); }
      : p => require('electron').shell.trashItem(p)),
  });
  ipcMain.handle('dev:delete', (_e, item) => ops.excluir(item));

  const send = (channel, payload) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send(channel, payload); } catch { /* page reloading or closing */ }
  };

  // ── Git status + live folder watching ─────────────────────────────────────
  // Windows folders use Windows git; WSL folders run git inside the distro on the Linux path
  const git = async (cwd, args) => {
    const wsl = wslInfoOf(cwd);
    if (wsl) {
      const out = await runWsl(['-d', wsl.distro, '-e', 'git', '-C', wsl.linuxPath, ...args], 20000);
      return out ? out.toString('utf8') : null;
    }
    return new Promise(resolve => {
      execFile('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 15000 },
        (err, stdout) => resolve(err ? null : stdout));
    });
  };

  // { isRepo, files: { lowerAbsPath: 'M'|'A'|'U'|'D'|'I' }, submodules: [lowerAbsPath] }
  async function gitStatus(root) {
    const wsl = wslInfoOf(root);
    const top = (await git(root, ['rev-parse', '--show-toplevel']))?.trim();
    if (!top) return { isRepo: false, files: {}, submodules: [] };
    // inside WSL the toplevel is a Linux path: map it back onto the \\wsl.localhost share
    const topDir = wsl ? toWslUnc(wsl.distro, top) : path.resolve(top);
    // --ignored lists ignored folders once (e.g. "node_modules/"), so the tree can grey them out
    const out = await git(root, ['status', '--porcelain=v1', '-z', '--ignore-submodules=none', '--ignored']) || '';
    const files = {};
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (entry.length < 4) continue;
      const xy = entry.slice(0, 2);
      let rel = entry.slice(3);
      if (xy[0] === 'R' || xy[0] === 'C') i++; // rename: next field is the old path
      const code = xy === '!!' ? 'I' : xy === '??' ? 'U' : xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : 'M';
      const isDirEntry = rel.endsWith('/');
      if (isDirEntry) rel = rel.slice(0, -1);
      files[norm(path.resolve(topDir, rel)) + (isDirEntry ? path.sep : '')] = code;
    }
    const modulesFile = wsl ? `${top}/.gitmodules` : path.join(topDir, '.gitmodules');
    const subs = await git(root, ['config', '--file', modulesFile, '--get-regexp', 'path']) || '';
    const submodules = subs.split('\n').filter(Boolean)
      .map(l => norm(path.resolve(topDir, l.split(' ').slice(1).join(' ').trim())));
    return { isRepo: true, files, submodules };
  }

  ipcMain.handle('dev:git-status', (_e, root) => (inside(root) ? gitStatus(path.resolve(root)) : null));

  // One recursive watcher per open folder; bursts of events (builds, git) collapse into one update
  const watchers = new Map(); // lower root → { watcher, timer }
  const NOISY = /[\\/](node_modules|\.git[\\/](objects|logs|refs|modules))([\\/]|$)/i;

  ipcMain.handle('dev:watch', (_e, root) => {
    if (!root || !inside(root)) return false;
    const key = norm(path.resolve(root));
    if (watchers.has(key)) return true;
    const notify = () => send('dev:fs-changed', { root: path.resolve(root) });
    // Changes made inside Linux never reach Windows' file watcher over the WSL share: poll instead
    if (wslInfoOf(root)) {
      const poll = setInterval(notify, 4000);
      watchers.set(key, { timer: null, watcher: { close: () => clearInterval(poll) } });
      return true;
    }
    try {
      const entry = { timer: null };
      entry.watcher = fs.watch(root, { recursive: true }, (_type, file) => {
        if (file && NOISY.test(path.sep + file)) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => send('dev:fs-changed', { root: path.resolve(root) }), 400);
      });
      entry.watcher.on('error', () => { watchers.delete(key); });
      watchers.set(key, entry);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('dev:unwatch', (_e, root) => {
    const key = root && norm(path.resolve(root));
    const entry = key && watchers.get(key);
    if (entry) { clearTimeout(entry.timer); entry.watcher.close(); watchers.delete(key); }
    return true;
  });

  // ── Terminals ─────────────────────────────────────────────────────────────

  ipcMain.handle('pty:shells', () => availableShells().map(({ key, label }) => ({ key, label })));

  // Lets the terminal tell an image paste (forward the key to the CLI) from a text paste
  ipcMain.handle('clip:has-image', () => {
    const { clipboard } = require('electron');
    return temImagem(clipboard);
  });

  ipcMain.handle('pty:create', async (_e, { cols, rows, cwd, shell: shellKey } = {}) => {
    try {
      pty = pty || loadPty();
      const home = HOME;
      const wsl = cwd && inside(cwd) ? wslFor(cwd) : null;
      if (wsl) await wakeDistro(wsl.distro); // on failure the terminal still opens and shows WSL's own error
      const dir = wsl ? path.resolve(cwd) : (cwd && isDir(cwd) && inside(cwd) ? path.resolve(cwd) : home);
      // WSL workspace → always a Linux login shell in the distro, started in the project folder
      const shells = availableShells();
      // Terminal pedido no WSL num projeto do Windows: wsl.exe na pasta do projeto vista de dentro da distro
      // O nome vem do renderer: só vale uma distribuição instalada (nunca vira argumento do wsl.exe sem conferir)
      let pedidoWsl = null;
      if (!wsl && IS_WIN && typeof shellKey === 'string' && shellKey.startsWith('wsl:')) {
        const pedido = shellKey.slice(4).trim().toLowerCase();
        const acha = info => info.distros.find(d => d.name.toLowerCase() === pedido);
        // lista em cache; só se o nome não está nela confere de novo (distro instalada depois de aberto o app)
        const distro = acha(await wslInfo()) || acha(await wslInfo(true));
        if (!distro) return { error: `Distribuição WSL "${shellKey.slice(4)}" não encontrada` };
        pedidoWsl = distro.name;
      }
      const sh = wsl
        ? { key: 'wsl', label: `WSL ${wsl.distro}`, file: 'wsl.exe', args: ['-d', wsl.distro, '--cd', wsl.linuxPath] }
        : pedidoWsl
          ? { key: 'wsl', label: `WSL ${pedidoWsl}`, file: 'wsl.exe', args: ['-d', pedidoWsl, '--cd', cwd && dir !== home ? (caminhoNoWsl(dir) || '~') : '~'] }
          : (shells.find(s => s.key === shellKey) || shells[0]);
      // marca do terminal: quem herda RENDRA_TERM nasceu dele, e é por ela que o fechamento acha a sessão Linux (WSL)
      const marca = crypto.randomBytes(8).toString('hex');
      const proc = pty.spawn(sh.file, sh.args, {
        name: 'xterm-256color',
        cols: Math.max(20, cols | 0 || 80),
        rows: Math.max(5, rows | 0 || 24),
        cwd: wsl ? home : dir, // wsl.exe gets the Linux folder via --cd
        // advertise a full-color terminal so CLIs (git, ls, npm, rtk…) emit colors and emoji
        env: ambientePty(process.env, { wsl: sh.key === 'wsl', marca }),
        ...opcoesConpty(IS_WIN, store.get('settings', {})),
      });
      const shell = sh.label;
      const id = nextPtyId++;
      ptys.set(id, proc);
      ciclo.registrar(id, proc, { token: marca, distro: sh.key === 'wsl' ? (wsl ? wsl.distro : pedidoWsl) : null });
      proc.onData(data => send('pty:data', { id, data }));
      proc.onExit(({ exitCode }) => { ptys.delete(id); ciclo.saiu(id); send('pty:exit', { id, exitCode }); });
      return { id, shell, shellKey: sh.key, cwd: dir };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Ambiente do terminal a partir de { shell, cwd }: sai das mesmas peças do pty:create (inside, wslFor e a lista de
  // distros), nunca de um objeto do renderer. Chamado depois do pty:create resolver: a distro já foi acordada e nada
  // aqui a acorda. Resolve { amb, distroRodando } ou { vazio: true, error? }.
  async function resolverAmbiente({ shell, cwd } = {}) {
    if (!cwd || typeof cwd !== 'string') return { vazio: true }; // terminal avulso: sem pasta, sem lista
    if (!inside(cwd)) return { vazio: true, error: 'Pasta fora das pastas abertas' };
    const wsl = wslFor(cwd);
    let shellKey = typeof shell === 'string' ? shell : '';
    if (!wsl && shellKey.startsWith('wsl:')) {
      if (!IS_WIN) shellKey = '';
      else {
        const pedido = shellKey.slice(4).trim().toLowerCase();
        const acha = info => info.distros.find(d => d.name.toLowerCase() === pedido);
        const distro = acha(await wslInfo()) || acha(await wslInfo(true));
        if (!distro) return { vazio: true, error: `Distribuição WSL "${shellKey.slice(4)}" não encontrada` };
        shellKey = `wsl:${distro.name}`;
      }
    }
    if (!wsl && !isDir(cwd)) return { vazio: true };
    const amb = ambienteDoTerminal({ cwd: path.resolve(cwd), wsl, shell: shellKey });
    if (!amb) return { vazio: true };
    let distroRodando = true;
    if (amb.tipo === 'wsl') {
      // o cache do wslInfo serve; só uma distro ainda não "Running" nele pede a lista nova (acabou de ser acordada)
      const acha = info => info.distros.find(x => x.name.toLowerCase() === String(amb.distro).toLowerCase());
      let d = acha(await wslInfo());
      if (!d || !/^running$/i.test(d.state)) d = acha(await wslInfo(true)) || d;
      if (!d) return { vazio: true };
      amb.distro = d.name;
      distroRodando = /^running$/i.test(d.state);
    }
    return { amb, distroRodando };
  }

  const detectarAgentes = deps.detectarAgentes || agentesProc.detectarAgentes;
  const escopoDaIde = () => ({ tokens: ciclo.tokens(), ptyPids: ciclo.ptyPids() });
  const TETO_EM_USO_MS = deps.tetoEmUsoMs || 3500;

  // Quais conversas têm um agente vivo agora, no ambiente do terminal: o Claude de qualquer lugar e o Codex que
  // nasceu de um terminal da IDE (o de fora tem trava própria). { ok, claude: Set, codex: Set }; ok falso = estouro
  // de tempo ou falha na leitura, e o seletor segue sem a marca.
  async function conversasEmUso(amb, distroRodando) {
    const r = { ok: false, claude: new Set(), codex: new Set() };
    if (amb.tipo === 'wsl' && !distroRodando) return { ...r, ok: true };
    await aoTeto(TETO_EM_USO_MS, async () => {
      const det = await detectarAgentes({ amb, env: deps.env || process.env, ...escopoDaIde() });
      if (!det) return;
      for (const a of det.agentes) {
        if (!a.id) continue;
        if (a.provedor === 'claude') r.claude.add(a.id);
        else if (det.donosIde.has(a.pid)) r.codex.add(a.id);
      }
      r.ok = true;
    });
    return r;
  }

  // Seletor de conversas do terminal novo. O pedido traz só { shell, cwd, todas }.
  // Cada conversa volta com `emUso` (um agente vivo a segura); `emUsoIndisponivel: true` quando a leitura falhou ou estourou.
  ipcMain.handle('dev:agent-sessions', async (_e, { shell, cwd, todas } = {}) => {
    const vazio = { provedores: { claude: false, codex: false }, sessoes: [], mais: false };
    try {
      const r = await resolverAmbiente({ shell, cwd });
      if (!r.amb) return r.error ? { ...vazio, error: r.error } : vazio;
      const { amb, distroRodando } = r;
      const emUsoP = conversasEmUso(amb, distroRodando).catch(() => ({ ok: false, claude: new Set(), codex: new Set() }));
      const lista = await (deps.sessoesAgentes || require('./sessoes-agentes')).listar({ amb, todas: todas === true, settings: store.get('settings', {}), distroRodando });
      if (!lista || !Array.isArray(lista.sessoes) || !lista.sessoes.length) return lista;
      const uso = await emUsoP;
      const sessoes = lista.sessoes.map(s => ({ ...s, emUso: !!(uso[s.provedor] && uso[s.provedor].has(s.id)) }));
      return uso.ok ? { ...lista, sessoes } : { ...lista, sessoes, emUsoIndisponivel: true };
    } catch {
      return vazio; // o painel não aparece e o terminal segue normal
    }
  });

  // Retomar uma conversa (R3): encerra o agente que a segura (de dentro da IDE ou de fora), só ele, nunca o shell, o tmux
  // ou outro agente. Recebe só { shell, cwd, provedor, id }: o id passa por idValido, o ambiente sai de resolverAmbiente
  // e nenhum PID vem do renderer. Com `conferir: true` só consulta: restou dono de FORA da IDE? (depois do --resume)
  // Resposta: { ok, encerrados, reaberto }. `reaberto` = outro processo segura a conversa (por exemplo o
  // `claude --continue || claude` de um rc que reabre o agente morto): quem chama avisa e para, sem matar em laço.
  const ESPERA_REABERTURA_MS = deps.esperaReaberturaMs ?? 1500;
  ipcMain.handle('dev:agent-encerrar-dono', async (_e, { shell, cwd, provedor, id, conferir } = {}) => {
    const falha = { ok: false, encerrados: 0, reaberto: false };
    try {
      if ((provedor !== 'claude' && provedor !== 'codex') || !idValido(id)) return falha;
      const r = await resolverAmbiente({ shell, cwd });
      if (!r.amb) return falha;
      const { amb, distroRodando } = r;
      if (amb.tipo === 'wsl' && !distroRodando) return { ok: true, encerrados: 0, reaberto: false };
      const env = deps.env || process.env;
      const donosAgora = async () => {
        const det = await detectarAgentes({ amb, env, ...escopoDaIde() });
        if (!det || !det.snap) return null;
        const validos = new Set(det.agentes.map(a => a.pid));
        return { det, donos: agentesProc.donosDaConversa(det.snap, { provedor, id, ...escopoDaIde() }).filter(d => validos.has(d.pid)) };
      };
      if (conferir) {
        const x = await donosAgora();
        if (!x) return { ok: true, encerrados: 0, reaberto: false };
        return { ok: true, encerrados: 0, reaberto: x.donos.some(d => !x.det.donosIde.has(d.pid)) };
      }
      const res = await (deps.encerrarDono || encerrarProc.encerrarDonoDaConversa)({ amb, provedor, id, env, ...escopoDaIde() });
      if (!res) return { ok: false, encerrados: 0, reaberto: false }; // leitura falhou: quem chama segue sem bloquear
      let reaberto = false;
      if (res.encerrados.length) {
        await new Promise(r2 => setTimeout(r2, ESPERA_REABERTURA_MS));
        const x = await donosAgora();
        reaberto = !!(x && x.donos.length);
      }
      return { ok: true, encerrados: res.encerrados.length, reaberto };
    } catch {
      return falha;
    }
  });

  ipcMain.on('pty:write', (_e, { id, data }) => ptys.get(id)?.write(data));
  ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
    const p = ptys.get(id);
    if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch { /* exited */ } }
  });
  // Fechar um terminal encerra a árvore dele (shell, netos, a sessão Linux no WSL), não só o processo raiz.
  // Só termina quando morreu (ou no teto de tempo): o renderer espera a resposta.
  ipcMain.handle('pty:kill', async (_e, id) => {
    const p = ptys.get(id);
    if (p) {
      ptys.delete(id);
      try { await ciclo.encerrar([id]); } catch { try { p.kill(); } catch { /* already gone */ } }
    }
    return true;
  });

  // Sair da IDE (bandeja, janela fechada, atualização, queda do renderer): encerra a árvore de todos os terminais e
  // espera. Resolve quando morreram ou no teto global; nunca lança.
  const killAll = async ({ tetoMs } = {}) => {
    for (const w of watchers.values()) { try { w.watcher.close(); } catch { /* ignore */ } }
    watchers.clear();
    const ids = [...ptys.keys()];
    ptys.clear();
    try { await ciclo.encerrar(undefined, tetoMs ? { tetoMs } : undefined); } catch { /* o que sobrar a varredura da próxima abertura encerra */ }
    return ids.length;
  };

  // ── Unsaved files on quit ─────────────────────────────────────────────────
  // The window close is held until the renderer reports its dirty files; then the user picks
  // Salvar e sair / Sair sem salvar / Cancelar. A silent or hung renderer never blocks quitting.
  const askRenderer = (channel, fallback, timeout = 4000) => new Promise(resolve => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return resolve(fallback);
    const reply = `${channel}:reply`;
    const timer = setTimeout(() => { ipcMain.removeAllListeners(reply); resolve(fallback); }, timeout);
    ipcMain.once(reply, (_e, data) => { clearTimeout(timer); resolve(data); });
    win.webContents.send(channel);
  });

  // Pergunta o que há de não salvo e deixa escolher; resolve true quando pode sair (nada sujo, salvou ou "sem salvar")
  async function confirmarSaida(win) {
    {
      const dirty = await askRenderer('app:query-dirty', []);
      if (dirty.length) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Salvar e sair', 'Sair sem salvar', 'Cancelar'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
          title: 'Alterações não salvas',
          message: dirty.length === 1
            ? `Salvar as alterações em ${dirty[0]} antes de sair?`
            : `Salvar as alterações em ${dirty.length} arquivos antes de sair?`,
          detail: dirty.length > 1 ? dirty.join('\n') : 'Sem salvar, as alterações serão perdidas.',
        });
        if (response === 2) return false;
        if (response === 0) {
          const res = await askRenderer('app:save-all', { ok: false, error: 'O editor não respondeu' }, 15000);
          if (!res.ok) {
            dialog.showErrorBox('Não foi possível salvar', res.error || 'Erro ao salvar os arquivos');
            return false;
          }
        }
      }
      return true;
    }
  }

  let guardaJaConfirmada = false; // o atualizador já perguntou: a janela fecha sem perguntar de novo
  function guardWindowClose(win) {
    let allowClose = false;
    win.on('close', async e => {
      if (allowClose || guardaJaConfirmada) return;
      e.preventDefault();
      if (!(await confirmarSaida(win))) return;
      allowClose = true;
      win.close();
    });
  }

  // Ao abrir (depois de a trava de instância única valer): encerra o que sobrou dos terminais de uma IDE que morreu à força.
  // Distro WSL parada não é acordada: se não está "Running", nada sobreviveu nela.
  const varrerAoAbrir = () => require('./registro-terminais').varrer({
    registro, env: deps.env || process.env,
    deps: { distroRodando: async distro => { const i = await wslInfo(); const d = i.distros.find(x => x.name.toLowerCase() === String(distro).toLowerCase()); return !!d && /^running$/i.test(d.state); } },
  }).catch(() => null);

  const confirmarSaidaDaIde = async () => { const w = getWindow(); if (!w || w.isDestroyed()) return true; const ok = await confirmarSaida(w); if (ok) guardaJaConfirmada = true; return ok; };

  // Atualização pelo instalador: guarda de arquivos não salvos, depois os terminais morrem, depois o instalador.
  // Se a saída não acontece (instalador erra ou não encerra a IDE), a guarda volta a valer na próxima vez que a janela fechar.
  const atualizarEInstalar = async instalar => {
    if (!(await confirmarSaidaDaIde())) return { ok: false, cancelado: true };
    await killAll({ tetoMs: 8000 }).catch(() => { /* a varredura da próxima abertura cobre o que sobrar */ });
    try {
      const r = await instalar();
      const t = setTimeout(() => { guardaJaConfirmada = false; }, deps.rearmeGuardaMs ?? 20000);
      if (t.unref) t.unref();
      return r;
    } catch (e) {
      guardaJaConfirmada = false;
      throw e;
    }
  };

  // Manipulador do protocolo de mídia (main.js o registra só na sessão padrão): cada pedido passa por guard + realDentro
  const manipuladorMidia = criarManipuladorMidia({ guard, realDentro, comLimite });

  return { killAll, guardWindowClose, confirmarSaidaDaIde, atualizarEInstalar, varrerAoAbrir, prepararSaida: () => ciclo.prepararSaida(), manipuladorMidia };
}

module.exports = { registerDevCode, toWslUnc, opcoesConpty };

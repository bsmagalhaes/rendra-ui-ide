/*! Rendra IDE v1.6.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// DevCode tab — a small VS Code-like workspace manager.
//
// Several workspaces live side by side as tabs (rename with double-click). Each one has:
//   left:   folder explorer (lazy tree)
//   middle: terminals in a 1–4 column grid, reorderable with ◀ ▶
//   right:  Monaco editor groups with tabs, shown once a file is opened (Ctrl+\ splits)
// Closing a tab, a workspace or the app with unsaved files asks Salvar / Não salvar / Cancelar.
// All file and process access goes through window.rendra.dev (main process).

(() => {
  const dev = window.rendra.dev;
  const $ = id => document.getElementById(id);
  const MAX_GROUPS = 3;
  const MONACO_BASE = '../node_modules/monaco-editor/min/vs';

  const workspaces = [];
  let activeWs = null;
  let nextWsId = 1;
  let initialized = false;
  let monaco = null;
  let monacoLoading = null;
  const files = new Map(); // path → { model, savedVersion, name } (shared by all workspaces)
  const ptyOwner = new Map(); // pty id → { ws, term }

  const toast = msg => (typeof showToast === 'function' ? showToast(msg) : console.log(msg));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const baseName = p => p.split(/[\\/]/).pop();
  const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  // ── Confirmation modal (save prompt, closing terminals/workspaces) ─────────
  // buttons: [{ choice, label, primary }]; Esc = 'cancel', Enter = the primary button
  function askChoice({ title, body, buttons }) {
    return new Promise(resolve => {
      const overlay = $('save-overlay');
      $('save-title').textContent = title;
      $('save-body').innerHTML = body;
      $('save-actions').innerHTML = buttons.map(b =>
        `<button class="btn ${b.primary ? 'btn-primary' : 'btn-secondary'}" data-choice="${b.choice}" type="button">${esc(b.label)}</button>`).join('');
      const primary = buttons.find(b => b.primary)?.choice || buttons[buttons.length - 1].choice;
      overlay.classList.add('visible');
      const done = choice => {
        overlay.classList.remove('visible');
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        resolve(choice);
      };
      const onClick = e => {
        const btn = e.target.closest('[data-choice]');
        if (btn) done(btn.dataset.choice);
        else if (e.target === overlay) done('cancel');
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); done('cancel'); }
        if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(primary); }
      };
      overlay.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
      overlay.querySelector(`[data-choice="${primary}"]`).focus();
    });
  }

  function askSave(names) {
    return askChoice({
      title: names.length === 1 ? 'Salvar alterações?' : `Salvar ${names.length} arquivos?`,
      body: names.length === 1
        ? `<b>${esc(names[0])}</b> tem alterações não salvas. Sem salvar, elas serão perdidas.`
        : `Estes arquivos têm alterações não salvas:<ul>${names.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`,
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'discard', label: 'Não salvar' },
        { choice: 'save', label: 'Salvar', primary: true },
      ],
    });
  }

  const askCloseTerminals = (title, body) => askChoice({
    title, body,
    buttons: [{ choice: 'cancel', label: 'Cancelar' }, { choice: 'close', label: 'Fechar', primary: true }],
  }).then(c => c === 'close');

  const isDirty = p => { const f = files.get(p); return !!f && f.model.getAlternativeVersionId() !== f.savedVersion; };

  async function saveFile(filePath, quiet) {
    const entry = files.get(filePath);
    if (!entry) return true;
    const res = await dev.write(filePath, entry.model.getValue());
    if (!res.ok) { toast(`Erro ao salvar ${entry.name}: ${res.error}`); return false; }
    entry.savedVersion = entry.model.getAlternativeVersionId();
    renderAllTabs();
    if (!quiet) toast(`${entry.name} salvo`);
    return true;
  }

  // Asks about the dirty ones among `paths`; resolves true when it is fine to close them
  async function confirmClose(paths) {
    const dirty = paths.filter(isDirty);
    if (!dirty.length) return true;
    const choice = await askSave(dirty.map(baseName));
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const p of dirty) if (!(await saveFile(p, true))) return false;
    }
    return true;
  }

  // Main process asks these before the window closes
  dev.onQueryDirty(() => [...files.keys()].filter(isDirty).map(baseName));
  dev.onSaveAll(async () => {
    for (const p of [...files.keys()].filter(isDirty)) {
      if (!(await saveFile(p, true))) return { ok: false, error: `Não foi possível salvar ${baseName(p)}` };
    }
    return { ok: true };
  });

  // ── Monaco (lazy AMD load on first file open) ──────────────────────────────
  function loadMonaco() {
    if (monaco) return Promise.resolve(monaco);
    if (monacoLoading) return monacoLoading;
    monacoLoading = new Promise((resolve, reject) => {
      // Workers can't importScripts from file://, so language services run on the main thread
      window.MonacoEnvironment = { getWorker: () => { throw new Error('no workers'); } };
      const s = document.createElement('script');
      s.src = `${MONACO_BASE}/loader.js`;
      s.onerror = () => reject(new Error('Não foi possível carregar o editor'));
      s.onload = () => {
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.require(['vs/editor/editor.main'], () => {
          monaco = window.monaco;
          window.RendraDotenv.registrar(monaco);
          monaco.editor.defineTheme('rendra', {
            base: 'vs-dark',
            inherit: true,
            rules: [{ token: 'comment', foreground: '707070', fontStyle: 'italic' }, ...window.RendraDotenv.REGRAS_TEMA],
            colors: {
              'editor.background': '#161616',
              'editor.foreground': '#e8e8e8',
              'editorLineNumber.foreground': '#4a4a4a',
              'editorLineNumber.activeForeground': '#b0b0b0',
              'editorCursor.foreground': '#e8650a',
              'editor.selectionBackground': '#e8650a40',
              'editor.lineHighlightBackground': '#1e1e1e',
              'editorIndentGuide.background1': '#262626',
              'editorWidget.background': '#1e1e1e',
              'editorWidget.border': '#3d3d3d',
              'minimap.background': '#161616',
              'scrollbarSlider.background': '#3d3d3d80',
            },
          });
          resolve(monaco);
        }, reject);
      };
      document.head.appendChild(s);
    });
    return monacoLoading;
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => dev.saveWorkspaces({
      list: workspaces.map(ws => ({
        name: ws.name, custom: ws.custom, cols: ws.cols, root: ws.root?.root || null,
        editorHidden: !!ws.editorHidden,
        wsl: ws.root?.wsl?.viaWindows ? { distro: ws.root.wsl.distro, linuxPath: ws.root.wsl.linuxPath } : null,
        // workspaces never activated this run keep the tabs they were restored with
        groups: ws.restore || ws.groups.map(g => ({ tabs: g.tabs, active: g.active })),
      })),
      active: Math.max(0, workspaces.indexOf(activeWs)),
    }), 300);
  }

  // Reopen the editor tabs a workspace had when the app was closed
  async function restoreTabs(ws) {
    const groups = (ws.restore || []).filter(g => g.tabs?.length);
    ws.restore = null;
    for (const g of groups) {
      let group = null;
      for (const p of g.tabs) {
        if (!group) {
          await openFile(ws, p, { newGroup: ws.groups.length > 0, restaurando: true });
          group = ws.groups.find(x => x.tabs.includes(p)) || null;
        } else {
          await openFile(ws, p, { group, restaurando: true });
        }
      }
      if (group && g.active && group.tabs.includes(g.active)) showInGroup(ws, group, g.active);
    }
  }

  function createWorkspace({ name, custom, cols, root, groups, editorHidden } = {}) {
    const ws = {
      id: nextWsId++,
      name: name || root?.name || `Workspace ${nextWsId - 1}`,
      custom: !!custom,
      cols: Math.min(Math.max(cols || 1, 1), 4),
      root: root || null,
      expanded: new Set(root ? [root.root] : []),
      groups: [],
      activeGroup: null,
      nextGroupId: 1,
      terms: [],
      termCount: 0,
      started: false,
      restore: groups && groups.length ? groups : null,
      editorHidden: editorHidden === true, // kept from creation so persist() never drops it for a workspace not activated yet
      git: null,
      el: null,
      refs: {},
    };
    buildWorkspaceDom(ws);
    workspaces.push(ws);
    renderWsTabs();
    watchWorkspace(ws);
    return ws;
  }

  function buildWorkspaceDom(ws) {
    const el = document.createElement('div');
    el.className = 'ws';
    // Default split: folders 25% · terminals 50% · editor 25% (all draggable)
    el.style.setProperty('--ex-w', lsGet('dev.layout.explorer', '25%'));
    el.style.setProperty('--ed-w', lsGet('dev.layout.editor', '25%'));
    el.innerHTML = `
      <aside class="dev-explorer">
        <div class="dev-panel-head">
          <span class="dev-panel-title">Explorador</span>
          <div class="dev-panel-actions">
            <button class="dev-icon-btn" data-act="open" title="Abrir pasta">📂</button>
            <button class="dev-icon-btn" data-act="refresh" title="Atualizar">↻</button>
            <button class="dev-icon-btn" data-act="collapse" title="Recolher tudo">⊟</button>
          </div>
        </div>
        <div class="dev-root-name"></div>
        <div class="dev-tree"></div>
      </aside>
      <div class="dev-splitter" data-split="explorer" title="Arraste para redimensionar"></div>
      ${terminalSectionHtml(true)}
      <div class="dev-splitter" data-split="editor" title="Arraste para redimensionar"></div>
      <section class="dev-editors"><div class="dev-editor-empty">Clique num arquivo do explorador para editar aqui</div><button class="dev-icon-btn dev-editor-hide" type="button" data-acao="esconder-editor" title="Esconder painel do editor" aria-label="Esconder painel do editor"><svg class="dev-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg></button></section>`;
    $('ws-host').appendChild(el);
    ws.el = el;
    ws.refs = {
      tree: el.querySelector('.dev-tree'),
      rootName: el.querySelector('.dev-root-name'),
      grid: el.querySelector('.dev-term-grid'),
      termTabs: el.querySelector('.dev-term-tabs'),
      editors: el.querySelector('.dev-editors'),
    };

    el.querySelector('[data-act=open]').addEventListener('click', () => pickFolder(ws));
    el.querySelector('[data-act=refresh]').addEventListener('click', () => renderTree(ws));
    el.querySelector('[data-act=collapse]').addEventListener('click', () => {
      if (!ws.root) return;
      ws.expanded = new Set([ws.root.root]);
      renderTree(ws);
    });
    wireTerminalSection(ws, el, persist);
    el.querySelector('[data-acao=alternar-editor]').addEventListener('click', () => setEditorHidden(ws, 'alternar'));
    el.querySelector('[data-acao=esconder-editor]').addEventListener('click', () => setEditorHidden(ws, 'esconder'));
    applyEditorHidden(ws);
    ws.refs.tree.addEventListener('click', e => onTreeClick(ws, e));
    ws.refs.tree.addEventListener('contextmenu', e => onTreeContextMenu(ws, e));
    el.querySelectorAll('.dev-splitter').forEach(sp => initSplitter(ws, sp));
    renderTree(ws);
    layoutTerminals(ws);
  }

  // Editor column of the IDE (right): hide/show. Hiding closes nothing (tabs, models and unsaved
  // text stay); the terminals take the space; opening a file shows it again.
  function applyEditorHidden(ws) {
    ws.el.classList.toggle('editor-hidden', ws.editorHidden);
    const r = RendraEditorPanel.rotuloBotao(ws.editorHidden);
    const btn = ws.el.querySelector('[data-acao=alternar-editor]');
    btn.setAttribute('aria-pressed', String(r.pressionado));
    btn.title = r.texto;
    btn.setAttribute('aria-label', r.texto);
  }

  function setEditorHidden(ws, evento) {
    const next = RendraEditorPanel.proximo(ws.editorHidden, evento);
    if (next === ws.editorHidden) return;
    ws.editorHidden = next;
    applyEditorHidden(ws);
    // focus must never stay in the editor that just disappeared
    if (next && ws.refs.editors.contains(document.activeElement)) {
      const t = ws.terms.find(x => x.alive);
      if (t) t.term.focus(); else ws.el.querySelector('[data-acao=alternar-editor]').focus();
    }
    // no explicit fit/layout: each terminal's ResizeObserver refits the xterm, and Monaco has automaticLayout
    persist();
  }

  // Terminal panel (tabs, 1–4 columns, shell picker, ＋): shared by DevCode workspaces and the
  // standalone Terminal page
  function terminalSectionHtml(withEditorToggle) {
    return `
      <section class="dev-terms">
        <div class="dev-panel-head">
          <span class="dev-panel-title">Terminais</span>
          <div class="dev-term-tabs"></div>
          <div class="dev-panel-actions">
            <div class="dev-cols" title="Colunas de terminais">
              ${[1, 2, 3, 4].map(n => `<button class="dev-col-btn" data-cols="${n}">${n}</button>`).join('')}
            </div>
            <select class="dev-shell-select" title="Shell dos novos terminais"></select>
            <button class="dev-icon-btn" data-act="new-term" title="Novo terminal">＋</button>
            ${withEditorToggle ? '<button class="dev-icon-btn" type="button" data-acao="alternar-editor">◨</button>' : ''}
          </div>
        </div>
        <div class="dev-term-grid"><div class="dev-term-empty"><span>Nenhum terminal aberto</span><button class="dev-term-empty-btn" type="button" data-act="new-term-empty">Novo terminal</button></div></div>
      </section>`;
  }

  function wireTerminalSection(ws, el, onColsChange) {
    el.querySelector('[data-act=new-term]').addEventListener('click', e => pedirNovoTerminal(ws, e.currentTarget));
    el.querySelector('[data-act=new-term-empty]').addEventListener('click', e => pedirNovoTerminal(ws, e.currentTarget));
    // Shell picker: shared default, remembered across restarts
    const shellSel = el.querySelector('.dev-shell-select');
    shellsReady.then(list => {
      shellSel.innerHTML = list.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
      shellSel.value = list.some(s => s.key === lsGet('dev.shell', '')) ? lsGet('dev.shell', '') : list[0]?.key;
    });
    shellSel.addEventListener('change', () => {
      lsSet('dev.shell', shellSel.value);
      document.querySelectorAll('.dev-shell-select').forEach(s => { s.value = shellSel.value; });
    });
    el.querySelectorAll('.dev-col-btn').forEach(b => b.addEventListener('click', () => {
      ws.cols = +b.dataset.cols;
      layoutTerminals(ws);
      onColsChange?.();
    }));
  }

  // ── Terminal page: terminals only, no folder, no Claude/Codex needed ──────
  // Reuses the workspace terminal machinery with a folder-less workspace (starts in home)
  let terminalPage = null;
  function activateTerminalPage() {
    if (!terminalPage) {
      const host = $('term-page');
      host.innerHTML = terminalSectionHtml();
      terminalPage = {
        id: 'terminal-page', name: 'Terminal', root: null, custom: true,
        cols: Math.min(Math.max(+lsGet('term.cols', '1') || 1, 1), 4),
        groups: [], terms: [], termCount: 0, el: host,
        refs: { grid: host.querySelector('.dev-term-grid'), termTabs: host.querySelector('.dev-term-tabs') },
      };
      wireTerminalSection(terminalPage, host, () => lsSet('term.cols', String(terminalPage.cols)));
      layoutTerminals(terminalPage);
      return;
    }
    requestAnimationFrame(() => terminalPage.terms.forEach(fitTerm));
  }

  function activateWorkspace(ws) {
    activeWs = ws;
    workspaces.forEach(w => w.el.classList.toggle('active', w === ws));
    renderWsTabs();
    if (!ws.started) {
      ws.started = true;
      if (ws.restore) restoreTabs(ws);
    }
    requestAnimationFrame(() => {
      ws.terms.forEach(t => fitTerm(t));
      ws.groups.forEach(g => g.editor.layout());
    });
    persist();
  }

  async function closeWorkspace(ws) {
    // Files open only in this workspace get the save prompt; shared ones stay open elsewhere
    const own = new Set(ws.groups.flatMap(g => g.tabs));
    const exclusive = [...own].filter(p => !workspaces.some(w => w !== ws && w.groups.some(g => g.tabs.includes(p))));
    const hasDirty = exclusive.some(isDirty);
    if (!(await confirmClose(exclusive))) return;
    // No unsaved files to ask about, but running terminals would be killed: confirm that instead
    const alive = ws.terms.filter(t => t.alive).length;
    if (!hasDirty && alive && !(await askCloseTerminals(
      `Fechar o workspace ${ws.name}?`,
      `${alive === 1 ? 'O terminal aberto será encerrado' : `Os ${alive} terminais abertos serão encerrados`}, junto com o que estiver rodando neles.`,
    ))) return;
    for (const t of [...ws.terms]) await killTerminal(ws, t);
    ws.groups.forEach(g => g.editor.dispose());
    exclusive.forEach(p => { files.get(p)?.model.dispose(); files.delete(p); });
    ws.el.remove();
    const idx = workspaces.indexOf(ws);
    workspaces.splice(idx, 1);
    unwatchIfUnused(ws.root?.root);
    if (!workspaces.length) createWorkspace();
    activateWorkspace(workspaces[Math.min(idx, workspaces.length - 1)]);
  }

  function renderWsTabs() {
    $('ws-tabs').innerHTML = workspaces.map(ws => `
      <div class="ws-tab${ws === activeWs ? ' active' : ''}" data-id="${ws.id}" title="${esc(ws.root?.root || 'Sem pasta')}${ws.root?.wsl ? ` · WSL ${esc(ws.root.wsl.distro)}: ${esc(ws.root.wsl.linuxPath)}` : ''}">
        ${ws.root?.wsl ? '<span class="ws-tab-badge">WSL</span>' : ''}
        <span class="ws-tab-name">${esc(ws.name)}</span>
        <span class="ws-tab-close" title="Fechar workspace">×</span>
      </div>`).join('');
  }

  function startRename(ws, tabEl) {
    const nameEl = tabEl.querySelector('.ws-tab-name');
    const input = document.createElement('input');
    input.className = 'ws-rename';
    input.value = ws.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = commit => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (commit && v) { ws.name = v; ws.custom = true; persist(); }
      renderWsTabs();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ── Explorer ───────────────────────────────────────────────────────────────
  // With WSL installed, ask Windows or WSL first; with several distros, ask which one
  async function chooseFolderTarget() {
    let info;
    try { info = await dev.wslInfo(); } catch { info = null; }
    if (!info?.available) return {};
    const where = await askChoice({
      title: 'Abrir pasta',
      body: 'Onde está o projeto? No WSL, o terminal e o Git rodam dentro do Linux.',
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'wsl', label: 'WSL (Linux)' },
        { choice: 'windows', label: 'Windows', primary: true },
      ],
    });
    if (where === 'cancel') return null;
    if (where === 'windows') return {};
    let distro = info.distros[0].name;
    if (info.distros.length > 1) {
      distro = await askChoice({
        title: 'Escolha a distribuição WSL',
        body: 'Há mais de uma distribuição Linux instalada.',
        buttons: [
          { choice: 'cancel', label: 'Cancelar' },
          ...info.distros.map(d => ({ choice: d.name, label: d.name + (d.isDefault ? ' (padrão)' : ''), primary: d.isDefault })),
        ],
      });
      if (distro === 'cancel') return null;
    }
    const mount = await ensureWslMount(distro);
    if (mount === false) return null;
    return { distro, useMount: !!mount };
  }

  // First WSL use per distro: offer to point at the Windows projects folder, which the Linux
  // side reaches at /mnt/<drive>/… (asked once; the dialog then always starts there)
  async function ensureWslMount(distro) {
    const existing = await dev.wslMountGet(distro);
    if (existing) return existing;
    if (lsGet(`dev.wslMountAsked.${distro}`, '')) return null;
    const choice = await askChoice({
      title: 'Seus projetos ficam no Windows?',
      body: `Escolha a pasta do Windows onde ficam seus projetos (por exemplo <b>C:\\Projetos</b>). ` +
        `Ela fica disponível dentro do Linux (${esc(distro)}) e, a partir de agora, ao abrir pelo WSL ` +
        `o DevCode já começa nela. Os arquivos continuam no Windows; o terminal roda no Linux.`,
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'linux', label: 'Meus projetos estão no Linux' },
        { choice: 'windows', label: 'Escolher pasta do Windows', primary: true },
      ],
    });
    if (choice === 'cancel') return false;
    lsSet(`dev.wslMountAsked.${distro}`, '1');
    if (choice === 'linux') return null;
    const mount = await dev.wslMountSet(distro);
    if (!mount) return null;
    if (mount.error) { toast(mount.error); return null; }
    toast(`Pasta montada no Linux em ${mount.linuxPath}${mount.link ? ` (atalho ${mount.link.replace(/^\/home\/[^/]+/, '~')})` : ''}`);
    return mount;
  }

  const sq = s => s.replace(/'/g, "''");
  // How each shell changes directory to a workspace folder (Windows path or WSL UNC share)
  function cdCommand(t, root) {
    const p = root.root;
    switch (t.shellKey) {
      case 'gitbash': return `cd "$(cygpath -u '${p.replace(/'/g, "'\\''")}')"\r`;
      case 'cmd': return `cd /d "${p}"\r`;
      case 'wsl': return root.wsl ? `cd '${root.wsl.linuxPath.replace(/'/g, "'\\''")}'\r` : `cd "$(wslpath '${p.replace(/'/g, "'\\''")}')"\r`;
      case 'powershell': return `Set-Location -LiteralPath '${sq(p)}'\r`;
      // macOS / Linux shells (zsh, bash, fish…)
      default: return `cd '${p.replace(/'/g, "'\\''")}'\r`;
    }
  }

  async function pickFolder(ws) {
    const target = await chooseFolderTarget();
    if (!target) return;
    if (target.distro) toast(`Abrindo o WSL ${target.distro}…`);
    const result = await dev.openFolder(target);
    if (!result) return;
    const previous = ws.root?.root;
    ws.root = result;
    unwatchIfUnused(previous);
    watchWorkspace(ws);
    ws.expanded = new Set([result.root]);
    if (!ws.custom) ws.name = result.name;
    renderWsTabs();
    await renderTree(ws);
    // Existing terminals follow the workspace into the new folder…
    ws.terms.filter(t => t.alive).forEach(t => dev.ptyWrite(t.id, cdCommand(t, result)));
    persist();
  }

  async function renderTree(ws) {
    const { tree, rootName } = ws.refs;
    if (!ws.root) {
      rootName.textContent = '';
      tree.innerHTML = `<div class="dev-empty"><p>Nenhuma pasta aberta.</p><button class="btn btn-primary" data-act="open-empty" type="button">Abrir pasta</button></div>`;
      tree.querySelector('[data-act=open-empty]').addEventListener('click', () => pickFolder(ws));
      return;
    }
    rootName.textContent = ws.root.name;
    rootName.title = ws.root.root;
    const frag = document.createDocumentFragment();
    await renderDir(ws, ws.root.root, 0, frag);
    const scroll = tree.scrollTop; // live refreshes must not jump the list
    ws.novoRecriando = true; // recriar a árvore tira o campo "novo item" do DOM: não é um cancelamento
    tree.innerHTML = '';
    tree.appendChild(frag);
    tree.scrollTop = scroll;
    mostrarCampoNovo(ws);
    ws.novoRecriando = false;
    decorateTree(ws);
  }

  // Watch the workspace folder: any change re-reads the tree and git status (debounced in main)
  function watchWorkspace(ws) {
    if (!ws.root) return;
    dev.watch(ws.root.root);
    refreshGit(ws);
  }
  function unwatchIfUnused(root) {
    if (root && !workspaces.some(w => w.root?.root === root)) dev.unwatch(root);
  }
  dev.onFsChanged(({ root }) => {
    workspaces.filter(w => w.root && lower(w.root.root) === lower(root)).forEach(async ws => {
      await renderTree(ws);
      await refreshGit(ws);
    });
  });

  async function renderDir(ws, dir, depth, parent) {
    const entries = await dev.list(dir);
    if (!Array.isArray(entries)) {
      const err = document.createElement('div');
      err.className = 'dev-tree-error';
      err.textContent = entries?.error || 'Erro ao ler a pasta';
      parent.appendChild(err);
      return;
    }
    const current = ws.activeGroup?.active;
    const subs = new Set(ws.git?.submodules || []);
    for (const e of entries) {
      const row = document.createElement('div');
      const kind = fileKind(e.name, e.isDir);
      const isSub = e.isDir && subs.has(lower(e.path));
      row.className = `dev-node k-${kind}${e.isDir ? ' dir' : ' file'}${isSub ? ' submodule' : ''}${e.path === current ? ' active' : ''}`;
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.dataset.path = e.path;
      row.dataset.dir = e.isDir ? '1' : '';
      row.dataset.kind = kind;
      const open = e.isDir && ws.expanded.has(e.path);
      // thin vertical guides, one per ancestor level, under each parent's chevron
      const guides = Array.from({ length: depth }, (_, i) => `<span class="dev-guide" style="left:${11 + i * 12}px"></span>`).join('');
      row.innerHTML = `${guides}
        <span class="dev-node-chevron">${e.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span class="dev-node-icon">${nodeIcon(kind, open, isSub, e.name)}</span>
        <span class="dev-node-name">${esc(e.name)}</span>
        <span class="dev-node-badge"></span>`;
      row.title = isSub ? `${e.path} (submódulo git)` : e.path;
      parent.appendChild(row);
      if (open) await renderDir(ws, e.path, depth + 1, parent);
    }
  }

  // Five kinds only: folder, hidden (dot-files), config, LLM/docs (markdown) and plain files
  const CONFIG_EXT = new Set(['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'env', 'cfg', 'conf', 'config', 'xml', 'lock', 'properties', 'editorconfig']);
  const LLM_EXT = new Set(['md', 'mdx', 'markdown', 'prompt']);
  function fileKind(name, isDirectory) {
    if (isDirectory) return name.startsWith('.') ? 'hidden-dir' : 'dir';
    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (LLM_EXT.has(ext)) return 'llm';
    if (CONFIG_EXT.has(ext) || /^\.env(\.|$)/.test(lower) || /rc$/.test(lower) && lower.startsWith('.')) return 'config';
    if (lower.startsWith('.')) return 'hidden';
    return 'file';
  }

  const SVG = {
    dir: '<path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z"/>',
    dirOpen: '<path d="M1.5 3.5h4l1.5 1.5h7v2H4l-2.5 6.5z"/><path d="M4 7h11.5l-2.5 6.5H1.5z"/>',
    file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
    config: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    llm: '<path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"/>',
    hidden: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/>',
    sub: '<path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z"/><circle cx="8" cy="9.2" r="1.6"/>',
  };
  SVG.md = '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>';
  const icon = key => `<svg class="dev-ico" viewBox="0 0 16 16" aria-hidden="true">${SVG[key]}</svg>`;
  const glyph = (text, cls) => `<span class="dev-glyph ${cls}">${text}</span>`;
  // VS Code-like: folders show only the chevron; files get a small glyph colored by kind
  function nodeIcon(kind, _open, isSubmodule, name = '') {
    if (kind === 'dir' || kind === 'hidden-dir') return isSubmodule ? icon('sub') : '';
    const ext = name.toLowerCase().split('.').pop();
    if (kind === 'config') {
      if (['json', 'jsonc', 'json5'].includes(ext)) return glyph('{}', 'g-json');
      if (['yml', 'yaml'].includes(ext)) return glyph('!', 'g-yaml');
      return icon('config');
    }
    if (kind === 'llm') return icon('md');
    if (kind === 'hidden') return glyph('◆', 'g-hidden');
    return icon('file');
  }

  // ── Live decorations: git status + unsaved editor files, propagated to parent folders ──
  // must match the main process: paths compare case-insensitively on Windows and macOS only
  const CASE_INSENSITIVE = window.rendra.platform !== 'linux';
  const lower = p => (CASE_INSENSITIVE ? p.toLowerCase() : p);
  const parentOf = p => p.replace(/[\\/][^\\/]+$/, '');
  const RANK = { I: 0.5, U: 1, A: 2, M: 3, D: 3, E: 4 }; // I = git-ignored, E = unsaved in the editor

  function computeDecorations(ws) {
    const deco = new Map(); // lower path → code
    const rootLower = ws.root ? lower(ws.root.root) : '';
    const bump = (p, code) => { if ((RANK[code] || 0) > (RANK[deco.get(p)] || 0)) deco.set(p, code); };
    const mark = (absLower, code) => {
      bump(absLower, code);
      if (code === 'I') return; // ignored paths never color their parents
      // ancestors inside the workspace take the change color too
      for (let d = parentOf(absLower); d.length >= rootLower.length && d.startsWith(rootLower); d = parentOf(d)) {
        bump(d, code === 'E' ? 'E' : 'M');
        if (d === rootLower) break;
      }
    };
    for (const [p, code] of Object.entries(ws.git?.files || {})) {
      const isDirEntry = p.endsWith('\\') || p.endsWith('/');
      mark(isDirEntry ? p.slice(0, -1) : p, code);
    }
    for (const p of files.keys()) if (isDirty(p)) mark(lower(p), 'E');
    return deco;
  }

  // Also used for untracked folders: everything under a "??" directory is new
  function inheritedCode(ws, pLower) {
    for (const [p, code] of Object.entries(ws.git?.files || {})) {
      if ((p.endsWith('\\') || p.endsWith('/')) && pLower.startsWith(p)) return code;
    }
    return null;
  }

  function decorateTree(ws) {
    const deco = computeDecorations(ws);
    const subs = new Set(ws.git?.submodules || []);
    ws.refs.tree.querySelectorAll('.dev-node').forEach(n => {
      const pl = lower(n.dataset.path);
      const code = deco.get(pl) || inheritedCode(ws, pl);
      n.classList.remove('st-M', 'st-A', 'st-U', 'st-D', 'st-E', 'st-I');
      if (code) n.classList.add(`st-${code}`);
      // VS Code style: folders get a dot, files the status letter; ignored paths no badge
      const badge = !code || code === 'I' ? '' : n.dataset.dir || code === 'E' ? '●' : code;
      n.querySelector('.dev-node-badge').textContent = badge;
      const isSub = subs.has(pl);
      if (isSub !== n.classList.contains('submodule')) {
        n.classList.toggle('submodule', isSub);
        n.querySelector('.dev-node-icon').innerHTML = nodeIcon(n.dataset.kind, ws.expanded.has(n.dataset.path), isSub, baseName(n.dataset.path));
      }
    });
  }

  async function refreshGit(ws) {
    if (!ws.root) { ws.git = null; return; }
    ws.git = await dev.gitStatus(ws.root.root);
    decorateTree(ws);
  }

  // ── Novo arquivo / nova pasta (botão direito no explorador) ──
  // Pasta onde nasce o item: a própria pasta clicada, a pasta do arquivo, ou a raiz em área vazia
  function onTreeContextMenu(ws, e) {
    e.preventDefault();
    if (!ws.root) return;
    const row = e.target.closest('.dev-node');
    const dir = !row ? ws.root.root : row.dataset.dir ? row.dataset.path : parentOf(row.dataset.path);
    document.querySelector('.dev-ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'dev-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button type="button" role="menuitem" data-k="file">Novo arquivo</button><button type="button" role="menuitem" data-k="dir">Nova pasta</button>`;
    document.body.appendChild(menu);
    menu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4))}px`;
    const fechar = () => { menu.remove(); document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', tecla, true); };
    const fora = ev => { if (!menu.contains(ev.target)) fechar(); };
    const tecla = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); fechar(); } };
    document.addEventListener('mousedown', fora, true);
    document.addEventListener('keydown', tecla, true);
    menu.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-k]');
      if (!b) return;
      fechar();
      iniciarNovoItem(ws, dir, b.dataset.k);
    });
    menu.querySelector('button').focus();
  }

  async function iniciarNovoItem(ws, dir, kind) {
    ws.novo = { dir, kind, valor: '' };
    if (dir !== ws.root.root) ws.expanded.add(dir); // a pasta abre para mostrar o campo
    await renderTree(ws);
  }

  // Campo de nome inline, no lugar onde o item vai nascer (abaixo da pasta, ou no topo da raiz).
  // Enter confirma, Esc cancela; nome inválido mostra o toast e mantém o campo aberto.
  function mostrarCampoNovo(ws) {
    const novo = ws.novo;
    if (!novo) return;
    const { tree } = ws.refs;
    const pai = novo.dir === ws.root.root ? null : [...tree.querySelectorAll('.dev-node')].find(n => n.dataset.path === novo.dir);
    if (novo.dir !== ws.root.root && !pai) { ws.novo = null; return; } // a pasta sumiu
    const row = document.createElement('div');
    row.className = 'dev-novo-row'; // fora de .dev-node: decorações e cliques da árvore não o enxergam
    row.style.paddingLeft = `${(pai ? parseInt(pai.style.paddingLeft, 10) + 12 : 6)}px`;
    const input = document.createElement('input');
    input.className = 'dev-novo-input';
    input.type = 'text';
    input.spellcheck = false;
    input.value = novo.valor;
    input.setAttribute('aria-label', novo.kind === 'dir' ? 'Nome da nova pasta' : 'Nome do novo arquivo');
    row.appendChild(input);
    if (pai) pai.after(row); else tree.prepend(row);
    input.focus();
    let ocupado = false;
    const cancelar = () => { if (ws.novo !== novo) return; ws.novo = null; row.remove(); };
    const confirmar = async () => {
      if (ocupado) return;
      ocupado = true;
      try {
        const nome = input.value.trim();
        const lista = await dev.list(novo.dir);
        const existentes = Array.isArray(lista) ? lista.map(x => x.name) : [];
        const erro = RendraNovoItem.validarNome(nome, existentes, { insensivel: CASE_INSENSITIVE });
        if (erro) { toast(erro); return; }
        const res = await (novo.kind === 'dir' ? dev.createDir(novo.dir, nome) : dev.createFile(novo.dir, nome));
        if (!res?.ok) { toast(res?.error || 'Não foi possível criar'); return; }
        ws.novo = null;
        await renderTree(ws);
        if (novo.kind === 'file') openFile(ws, res.path);
      } finally {
        ocupado = false;
      }
    };
    input.addEventListener('input', () => { novo.valor = input.value; });
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // as teclas não vão para atalhos globais nem para o terminal
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
    });
    // Sair do campo cancela. Ignora a perda de foco da janela inteira e a recriação da árvore.
    input.addEventListener('blur', () => { if (!ws.novoRecriando && !ocupado && document.hasFocus()) cancelar(); });
  }

  async function onTreeClick(ws, e) {
    const row = e.target.closest('.dev-node');
    if (!row) return;
    const p = row.dataset.path;
    if (row.dataset.dir) {
      if (ws.expanded.has(p)) ws.expanded.delete(p); else ws.expanded.add(p);
      await renderTree(ws);
    } else {
      openFile(ws, p);
    }
  }

  // Clique num caminho do terminal (já conferido pelo main): arquivo abre no editor e vai à linha; pasta é
  // revelada no explorador (expande os ancestrais, rola até ela e a destaca por um instante).
  async function abrirCaminhoDoTerminal(ws, alvo, linha, coluna) {
    if (!alvo.isDir) {
      await openFile(ws, alvo.path);
      const editor = ws.activeGroup?.editor;
      if (editor && ws.activeGroup.active === alvo.path && linha) {
        const pos = { lineNumber: linha, column: coluna || 1 };
        editor.setPosition(pos);
        editor.revealLineInCenter(linha);
        editor.focus();
      }
      return;
    }
    if (!ws.root) return;
    const partes = [];
    for (let d = alvo.path; ; d = d.replace(/[\\/][^\\/]*$/, '')) {
      partes.push(d);
      if (lower(d) === lower(ws.root.root) || !/[\\/]/.test(d.slice(1))) break;
      if (partes.length > 60) break;
    }
    partes.forEach(d => ws.expanded.add(d));
    await renderTree(ws);
    const no = [...ws.refs.tree.querySelectorAll('.dev-node')].find(n => n.dataset.path && lower(n.dataset.path) === lower(alvo.path));
    if (no) {
      no.scrollIntoView({ block: 'center' });
      no.classList.add('revelado');
      setTimeout(() => no.classList.remove('revelado'), 1800);
    }
  }

  function markActiveInTree(ws) {
    const current = ws.activeGroup?.active;
    ws.refs.tree.querySelectorAll('.dev-node.file').forEach(n => n.classList.toggle('active', n.dataset.path === current));
  }

  // ── Editor groups (right panel) ────────────────────────────────────────────
  function createGroup(ws) {
    const el = document.createElement('div');
    el.className = 'dev-group';
    el.innerHTML = `
      <div class="dev-tabs-bar">
        <div class="dev-tabs"></div>
        <div class="dev-group-actions">
          <button class="dev-icon-btn" data-act="split" title="Dividir à direita (Ctrl+\\)">⫿</button>
          <button class="dev-icon-btn" data-act="close-group" title="Fechar quadro">✕</button>
        </div>
      </div>
      <div class="dev-editor-host"></div>`;
    ws.refs.editors.appendChild(el);
    const group = { id: ws.nextGroupId++, el, tabsEl: el.querySelector('.dev-tabs'), tabs: [], active: null };
    group.editor = monaco.editor.create(el.querySelector('.dev-editor-host'), {
      theme: 'rendra',
      automaticLayout: true,
      fontFamily: "'Cascadia Code', Consolas, Menlo, 'SF Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      model: null,
    });
    group.editor.onDidFocusEditorText(() => setActiveGroup(ws, group));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => group.active && saveFile(group.active));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => closeTab(ws, group, group.active));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => splitActive(ws));
    el.addEventListener('mousedown', () => setActiveGroup(ws, group));
    el.querySelector('[data-act=split]').addEventListener('click', () => { setActiveGroup(ws, group); splitActive(ws); });
    el.querySelector('[data-act=close-group]').addEventListener('click', () => closeGroup(ws, group));
    group.tabsEl.addEventListener('click', e => {
      const tab = e.target.closest('.dev-tab');
      if (!tab) return;
      if (e.target.closest('.dev-tab-close')) closeTab(ws, group, tab.dataset.path);
      else showInGroup(ws, group, tab.dataset.path);
    });
    group.tabsEl.addEventListener('auxclick', e => {
      const tab = e.target.closest('.dev-tab');
      if (tab && e.button === 1) closeTab(ws, group, tab.dataset.path);
    });
    ws.groups.push(group);
    setActiveGroup(ws, group);
    return group;
  }

  function setActiveGroup(ws, group) {
    ws.activeGroup = group;
    ws.groups.forEach(g => g.el.classList.toggle('focused', g === group));
    markActiveInTree(ws);
  }

  async function openFile(ws, filePath, opts = {}) {
    try { await loadMonaco(); } catch (e) { toast(e.message); return; }
    if (!files.has(filePath)) {
      const res = await dev.read(filePath);
      if (res.error) { if (!opts.group && !opts.newGroup) toast(res.error); return; }
      const model = monaco.editor.createModel(res.content, window.RendraDotenv.linguagemPorNome(filePath), monaco.Uri.file(filePath));
      files.set(filePath, { model, savedVersion: model.getAlternativeVersionId(), name: baseName(filePath) });
      model.onDidChangeContent(() => renderAllTabs());
    }
    if (!opts.restaurando) setEditorHidden(ws, 'arquivo-aberto'); // file opened by the user: the panel comes back
    const group = opts.group || (opts.newGroup ? createGroup(ws) : (ws.activeGroup || ws.groups[0] || createGroup(ws)));
    if (!group.tabs.includes(filePath)) group.tabs.push(filePath);
    showInGroup(ws, group, filePath);
  }

  function showInGroup(ws, group, filePath) {
    const entry = files.get(filePath);
    if (!entry) return;
    group.active = filePath;
    group.editor.setModel(entry.model);
    setActiveGroup(ws, group);
    renderTabs(group);
    group.editor.focus();
    persist();
  }

  function renderTabs(group) {
    group.tabsEl.innerHTML = group.tabs.map(p => `
      <div class="dev-tab${p === group.active ? ' active' : ''}${isDirty(p) ? ' dirty' : ''}" data-path="${esc(p)}" title="${esc(p)}">
        <span class="dev-tab-name">${esc(files.get(p)?.name || baseName(p))}</span>
        <span class="dev-tab-close" title="Fechar (Ctrl+W)">${isDirty(p) ? '●' : '×'}</span>
      </div>`).join('');
  }
  // Runs on every edit: tab dots now, tree colors once per frame
  let decoFrame = 0;
  const renderAllTabs = () => {
    workspaces.forEach(ws => ws.groups.forEach(renderTabs));
    cancelAnimationFrame(decoFrame);
    decoFrame = requestAnimationFrame(() => workspaces.forEach(decorateTree));
  };

  const openElsewhere = (group, filePath) =>
    workspaces.some(w => w.groups.some(g => g !== group && g.tabs.includes(filePath)));

  async function closeTab(ws, group, filePath) {
    if (!filePath) return;
    const shared = openElsewhere(group, filePath);
    if (!shared && !(await confirmClose([filePath]))) return;
    const idx = group.tabs.indexOf(filePath);
    if (idx < 0) return;
    group.tabs.splice(idx, 1);
    if (!shared) { files.get(filePath)?.model.dispose(); files.delete(filePath); }
    if (!group.tabs.length) { removeGroup(ws, group); return; }
    if (group.active === filePath) showInGroup(ws, group, group.tabs[Math.max(0, idx - 1)]);
    else { renderTabs(group); persist(); }
    renderAllTabs(); // closing may drop an unsaved marker from the tree
  }

  async function closeGroup(ws, group) {
    const exclusive = group.tabs.filter(p => !openElsewhere(group, p));
    if (!(await confirmClose(exclusive))) return;
    exclusive.forEach(p => { files.get(p)?.model.dispose(); files.delete(p); });
    removeGroup(ws, group);
  }

  function removeGroup(ws, group) {
    group.editor.dispose();
    group.el.remove();
    ws.groups = ws.groups.filter(g => g !== group);
    persist();
    const next = ws.groups[ws.groups.length - 1] || null;
    ws.activeGroup = next;
    if (next) setActiveGroup(ws, next);
    else markActiveInTree(ws);
  }

  function splitActive(ws) {
    const from = ws.activeGroup;
    if (!from?.active) return;
    if (ws.groups.length >= MAX_GROUPS) { toast(`Máximo de ${MAX_GROUPS} quadros de editor`); return; }
    const group = createGroup(ws);
    group.tabs.push(from.active);
    showInGroup(ws, group, from.active);
  }

  // ── Terminals (middle panel, 1–4 column grid) ──────────────────────────────
  const shellsReady = dev.ptyShells().catch(() => [{ key: 'powershell', label: 'PowerShell' }]);

  // Git Bash (mintty) default palette; only the dark blues are lifted a little so they stay
  // readable on the dark background. Background is a soft black, just darker than the bars.
  const TERM_BG = '#171717';
  const TERM_THEME = {
    background: TERM_BG, foreground: '#d4d4d4', cursor: '#e8650a', cursorAccent: TERM_BG,
    selectionBackground: '#e8650a55',
    black: '#000000', red: '#bf0000', green: '#00bf00', yellow: '#bfbf00', blue: '#3b63e0',
    magenta: '#bf00bf', cyan: '#00bfbf', white: '#bfbfbf',
    brightBlack: '#606060', brightRed: '#ff4040', brightGreen: '#40ff40', brightYellow: '#ffff40',
    brightBlue: '#6d8dff', brightMagenta: '#ff40ff', brightCyan: '#40ffff', brightWhite: '#ffffff',
  };

  const fitTerm = t => { if (t.body.offsetParent) { try { t.fit.fit(); } catch { /* hidden */ } } };

  function layoutTerminals(ws) {
    const n = Math.max(ws.terms.length, 1);
    ws.refs.grid.querySelector('.dev-term-empty').hidden = ws.terms.length > 0;
    const cols = Math.min(ws.cols, n);
    ws.refs.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    ws.refs.grid.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, minmax(0, 1fr))`;
    ws.el.querySelectorAll('.dev-col-btn').forEach(b => b.classList.toggle('active', +b.dataset.cols === ws.cols));
    requestAnimationFrame(() => ws.terms.forEach(fitTerm));
  }

  // Botão "novo terminal": com Windows e WSL instalados, pergunta qual; com uma opção só, abre direto
  async function pedirNovoTerminal(ws, ancora) {
    if (ws.root?.wsl) { newTerminal(ws); return; } // projeto no WSL: o terminal já é o da distro
    let info = null;
    try { info = await dev.wslInfo(); } catch { info = null; }
    const lista = await shellsReady;
    const sel = ws.el.querySelector('.dev-shell-select');
    const padrao = lista.find(s => s.key === sel.value) || lista[0];
    const opcoes = RendraTermEscolha.opcoesDeTerminal(padrao, info);
    if (opcoes.length === 1) { newTerminal(ws); return; }
    document.querySelector('.dev-term-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'dev-term-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = opcoes.map((o, i) => `<button type="button" role="menuitem" data-i="${i}">${esc(o.label)}</button>`).join('');
    document.body.appendChild(menu);
    const r = ancora.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(4, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 4))}px`;
    const fechar = () => { menu.remove(); document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', tecla, true); };
    const fora = e => { if (!menu.contains(e.target)) fechar(); };
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    document.addEventListener('mousedown', fora, true);
    document.addEventListener('keydown', tecla, true);
    menu.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const o = opcoes[+b.dataset.i];
      fechar();
      newTerminal(ws, o.shell);
    });
    menu.querySelector('button').focus();
  }

  // ── Seletor de conversas dentro do terminal novo ───────────────────────────
  // Depois que o pty abre, a IDE lista as conversas do Claude Code e do Codex da pasta (só título e data) e
  // oferece iniciar uma nova no provedor instalado. O painel cobre o terminal (que já está vivo por baixo) até
  // uma escolha; Esc ou "Só o terminal" deixam o shell puro. Nenhum título vai para log.
  const ICONE_AGENTE = {
    claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>',
    codex: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M10 9.5L7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/></svg>',
  };
  const NOME_AGENTE = { claude: 'Claude Code', codex: 'Codex' };

  function itensSessoes(sessoes) {
    const SG = window.RendraSessoesEscolha;
    return sessoes.map((s, i) => `<li><button type="button" role="menuitem" class="term-agentes-item" data-i="${i}" data-provedor="${esc(s.provedor)}" title="${esc(NOME_AGENTE[s.provedor] || s.provedor)}">`
      + `<span class="term-agentes-ico ${esc(s.provedor)}">${ICONE_AGENTE[s.provedor] || ''}</span>`
      + `<span class="term-agentes-tit">${esc(s.titulo)}</span><span class="term-agentes-data">${esc(SG.dataBr(s.quando))}</span></button></li>`).join('');
  }

  // Escrita no pty só depois do primeiro prompt: o texto escrito antes dele pode se perder no ConPTY, e na
  // distro o .bashrc ainda pode estar rodando. Vale o que vier primeiro: o prompt na saída recente do pty
  // (fimDePrompt) ou o tempo limite. Dispara uma única vez; prompt já na tela escreve na hora.
  const ESPERA_PROMPT_MS = 8000;
  function escreverQuandoPronto(t, comando, aoEscrever) {
    let feito = false;
    let timer = null;
    const dispara = () => {
      if (feito) return;
      feito = true;
      clearTimeout(timer);
      t.aguardando = null;
      if (t.alive) dev.ptyWrite(t.id, comando);
      aoEscrever();
    };
    t.aguardando = { dispara, cancela: () => { feito = true; clearTimeout(timer); t.aguardando = null; } };
    timer = setTimeout(dispara, ESPERA_PROMPT_MS);
    if (window.RendraSessoesEscolha.fimDePrompt(t.recente)) dispara();
  }

  function montarSeletor(ws, t, shell, r) {
    const SG = window.RendraSessoesEscolha;
    const opcoes = SG.opcoesNovaSessao(r.provedores);
    const aviso = r.aviso === 'deteccao';
    if (!opcoes.length && !aviso) return; // nenhum provedor instalado: o terminal abre direto, como sempre
    let sessoes = r.sessoes || [];
    const el = document.createElement('div');
    el.className = 'term-agentes';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Conversas do terminal');
    el.innerHTML = `<div class="term-agentes-box">
      ${sessoes.length ? `<h4>Continuar uma conversa</h4><ul class="term-agentes-lista" role="menu">${itensSessoes(sessoes)}</ul>${r.mais ? '<button type="button" class="term-agentes-todas" data-act="todas">Ver todas</button>' : ''}` : ''}
      ${aviso ? '<p class="term-agentes-aviso" role="status">Não deu para conferir se o Claude Code ou o Codex estão instalados aqui, então as conversas não aparecem. Você pode usar o terminal normalmente.</p>' : '<h4>Nova conversa</h4>'}
      <div class="term-agentes-novas">${(aviso ? [{ provedor: null, label: 'Só o terminal' }] : opcoes).map(o => `<button type="button" class="term-agentes-nova" data-nova="${o.provedor || 'terminal'}">${esc(o.label)}</button>`).join('')}</div>
    </div>`;
    t.pane.appendChild(el);
    const fechar = () => {
      t.aguardando?.cancela();
      el.remove();
      t.painel = null;
      if (t.alive) t.term.focus();
    };
    t.painel = { el, fechar };
    el.addEventListener('keydown', e => {
      e.stopPropagation(); // as teclas ficam no painel, não vão ao shell
      if (e.key === 'Escape') { e.preventDefault(); fechar(); }
    });
    // o comando só chega ao shell pelas funções fixas de RendraSessoesEscolha (id uuid validado, ou "claude"/"codex")
    const iniciar = comando => {
      if (t.aguardando) return;
      el.classList.add('ocupado');
      el.querySelectorAll('button').forEach(b => { b.disabled = true; });
      escreverQuandoPronto(t, comando, fechar);
    };
    el.addEventListener('click', async e => {
      const nova = e.target.closest('button[data-nova]');
      if (nova && nova.dataset.nova === 'terminal') { fechar(); return; }
      if (nova) {
        let comando;
        try { comando = SG.comandoNovo(nova.dataset.nova); } catch { return; }
        iniciar(comando);
        return;
      }
      const item = e.target.closest('button.term-agentes-item');
      if (item) {
        const s = sessoes[+item.dataset.i];
        let comando;
        try { comando = SG.comandoRetomar(s && s.provedor, s && s.id); } catch { toast('Conversa inválida'); return; }
        iniciar(comando);
        return;
      }
      const todas = e.target.closest('button[data-act="todas"]');
      if (todas) {
        todas.disabled = true;
        let rr = null;
        try { rr = await dev.agentSessions({ shell, cwd: ws.root?.root, todas: true }); } catch { rr = null; }
        if (!t.painel) return;
        if (!rr || rr.error || !Array.isArray(rr.sessoes)) { toast('Não foi possível listar todas as conversas'); todas.disabled = false; return; }
        sessoes = rr.sessoes;
        const lista = el.querySelector('.term-agentes-lista');
        lista.innerHTML = itensSessoes(sessoes);
        lista.classList.add('todas');
        todas.remove();
      }
    });
    el.querySelector('button').focus();
  }

  async function abrirSeletor(ws, t, shell) {
    if (!ws.root?.root || !window.RendraSessoesEscolha) return; // terminal avulso (sem pasta): sem lista
    let r = null;
    try { r = await dev.agentSessions({ shell, cwd: ws.root.root }); } catch { r = null; }
    // quem digitou antes da resposta, ou o pty que já saiu, fica sem painel
    if (!r || r.error || !t.alive || t.digitou || !t.pane.isConnected) return;
    montarSeletor(ws, t, shell, r);
  }

  async function newTerminal(ws, shellEscolhido) {
    if (typeof Terminal === 'undefined') { toast('Terminal indisponível'); return; }
    // The terminal's name and controls live as a tab in the "Terminais" header row (one line
    // saved per terminal); the pane itself is only the terminal surface
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.innerHTML = '<div class="term-pane-body"></div>';
    ws.refs.grid.appendChild(pane);
    const tab = document.createElement('div');
    tab.className = 'term-tab';
    tab.draggable = true; // drag a tab onto another to reorder the terminals
    tab.title = 'Arraste para reordenar';
    tab.innerHTML = `
      <span class="term-pane-name">…</span>
      <button class="term-rename-btn" data-act="rename" title="Renomear terminal">✎</button>
      <button class="dev-icon-btn" data-act="close" title="Fechar terminal">✕</button>`;
    ws.refs.termTabs.appendChild(tab);
    const body = pane.querySelector('.term-pane-body');
    const term = new Terminal({
      theme: TERM_THEME,
      // emoji fonts as fallback so emoji render in color instead of boxes
      // per-OS monospace fonts, then color emoji fonts (Windows, macOS, Linux)
      fontFamily: "'Cascadia Mono', Consolas, Menlo, 'SF Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'",
      fontSize: 13,
      fontWeight: 'normal',
      fontWeightBold: 'normal',        // no bold glyphs: easier to read…
      drawBoldTextInBrightColors: true, // …bold still shows, as a brighter color (like mintty)
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      rightClickSelectsWord: false,    // o clique direito cola (no macOS o padrão do xterm seria selecionar a palavra)
      allowProposedApi: true,          // required by the unicode11 addon
      customGlyphs: true,              // pixel-perfect box drawing for tables
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    // Unicode 11 widths: emoji take two cells, so tables and prompts stay aligned
    if (window.Unicode11Addon) {
      term.loadAddon(new Unicode11Addon.Unicode11Addon());
      term.unicode.activeVersion = '11';
    }
    // Links do terminal: http(s) no texto e hyperlinks OSC 8. Ctrl+clique (Cmd+clique no Mac) abre direto no
    // navegador do sistema; o clique simples mostra a confirmação "Abrir no navegador?". Arrastar para
    // selecionar texto não conta como clique (distância entre o botão pressionado e o solto). O main recusa
    // tudo que não for http(s).
    let pressionado = null;
    body.addEventListener('mousedown', e => { pressionado = { x: e.clientX, y: e.clientY }; }, true);
    const abrirLink = (ev, url) => {
      if (ev && (ev.ctrlKey || ev.metaKey)) { window.rendra.openExternal(url); return; }
      if (pressionado && ev && Math.hypot(ev.clientX - pressionado.x, ev.clientY - pressionado.y) > 4) return;
      if ($('save-overlay').classList.contains('visible')) return;
      askChoice({
        title: 'Abrir link?',
        body: `<code class="link-url">${esc(url)}</code>`,
        buttons: [
          { choice: 'cancel', label: 'Cancelar' },
          { choice: 'rendra', label: 'Abrir no Rendra Browser' },
          { choice: 'open', label: 'Abrir no navegador padrão', primary: true },
        ],
      }).then(c => {
        if (c === 'open') window.rendra.openExternal(url);
        else if (c === 'rendra') window.rendra.openRendraBrowser(url);
        term.focus();
      });
    };
    const dicaLink = () => { body.title = /Mac/i.test(navigator.platform) ? 'Clique para abrir (Cmd+clique abre direto)' : 'Clique para abrir (Ctrl+clique abre direto)'; };
    const limpaDica = () => { body.title = ''; };
    if (window.WebLinksAddon) {
      term.loadAddon(new WebLinksAddon.WebLinksAddon(abrirLink, { hover: dicaLink, leave: limpaDica }));
    }
    // OSC 8 com esquema que não seja http(s) (file:, etc.) é descartado: sem hyperlink, sem sublinhado
    // tracejado; o texto continua aparecendo. O fim do link (URI vazia) e http(s) seguem para o xterm.
    term.parser.registerOscHandler(8, dados => {
      const uri = dados.slice(dados.indexOf(';') + 1);
      return uri !== '' && !/^https?:\/\//i.test(uri);
    });
    term.options.linkHandler = { activate: abrirLink, hover: dicaLink, leave: limpaDica, allowNonHttpProtocols: false };
    // Caminhos de arquivo no texto do terminal: só viram link se existirem dentro das pastas abertas (conferido no
    // main, com tempo limite, só para candidatos com "/" ou "\" e extensão) e abrem no editor da lateral, na
    // linha indicada (":12"); pasta é revelada no explorador. Nunca executa nada e não pede confirmação.
    const cacheCaminhos = new Map(); // "cwd|raiz|texto" -> { em, promessa }
    const resolverCaminho = texto => {
      const chave = `${t.cwd || ''}|${ws.root?.root || ''}|${texto}`;
      const hit = cacheCaminhos.get(chave);
      if (hit && Date.now() - hit.em < 30000) return hit.promessa;
      if (cacheCaminhos.size > 500) cacheCaminhos.clear();
      const promessa = dev.resolvePath(texto, t.cwd, ws.root?.root).catch(() => null);
      cacheCaminhos.set(chave, { em: Date.now(), promessa });
      return promessa;
    };
    const dicaCaminho = () => { body.title = 'Clique para abrir no editor'; };
    term.registerLinkProvider({
      provideLinks(y, callback) {
        if (!window.RendraCaminhos) { callback(undefined); return; }
        const buf = term.buffer.active;
        let ini = y - 1;
        while (ini > 0 && buf.getLine(ini)?.isWrapped) ini--;
        let texto = '';
        const mapa = []; // índice do caractere -> { x, y } (1-based)
        for (let l = ini; l < buf.length; l++) {
          const linha = buf.getLine(l);
          if (!linha || (l > ini && !linha.isWrapped)) break;
          for (let x = 0; x < term.cols; x++) {
            const cel = linha.getCell(x);
            if (!cel || cel.getWidth() === 0) continue;
            const ch = cel.getChars() || ' ';
            for (const c of ch) { texto += c; mapa.push({ x: x + 1, y: l + 1 }); }
          }
          if (texto.length > 4000) break;
        }
        const achados = window.RendraCaminhos.acharCaminhos(texto).filter(a => mapa[a.start]?.y <= y && y <= mapa[a.end - 1]?.y);
        if (!achados.length) { callback(undefined); return; }
        Promise.all(achados.map(a => resolverCaminho(a.caminho))).then(res => {
          const links = [];
          achados.forEach((a, i) => {
            const r = res[i];
            if (!r) return;
            links.push({
              range: { start: mapa[a.start], end: mapa[a.end - 1] },
              text: a.texto,
              activate: ev => {
                if (pressionado && ev && Math.hypot(ev.clientX - pressionado.x, ev.clientY - pressionado.y) > 4) return;
                if ($('save-overlay').classList.contains('visible')) return;
                abrirCaminhoDoTerminal(ws, r, a.linha, a.coluna);
              },
              hover: dicaCaminho,
              leave: limpaDica,
            });
          });
          callback(links.length ? links : undefined);
        });
      },
    });
    term.open(body);
    const t = { id: null, term, fit, pane, tab, body, alive: false, name: '', recente: '', digitou: false, painel: null, aguardando: null };
    // clicking the tab (outside its buttons) focuses that terminal
    // (com o painel de conversas aberto o foco vai para o painel: o xterm não pode voltar a receber teclas)
    // O foco vai no `click`, nunca no `mousedown` com preventDefault: um mousedown cancelado impede o Chromium de
    // iniciar o arraste nativo da aba. Depois de um arraste não há click, então o foco não muda por arrastar.
    tab.addEventListener('click', e => {
      if (e.target.closest('button, input')) return;
      if (t.painel) t.painel.el.querySelector('button')?.focus(); else term.focus();
    });
    ws.terms.push(t);
    layoutTerminals(ws);
    fitTerm(t);

    const shell = shellEscolhido || ws.el.querySelector('.dev-shell-select').value || lsGet('dev.shell', '');
    const res = await dev.ptyCreate({ cols: term.cols, rows: term.rows, cwd: ws.root?.root, shell });
    if (res.error) {
      term.write(`\r\n\x1b[31mNão foi possível abrir o terminal: ${res.error}\x1b[0m\r\n`);
      return;
    }
    t.id = res.id;
    t.cwd = res.cwd;
    t.alive = true;
    t.shellKey = res.shellKey;
    t.name = `${res.shell} ${++ws.termCount}`;
    tab.querySelector('.term-pane-name').textContent = t.name;
    ptyOwner.set(t.id, { ws, t });
    tab.querySelector('[data-act=rename]').addEventListener('click', () => renameTerminal(t));
    tab.querySelector('.term-pane-name').addEventListener('dblclick', () => renameTerminal(t));

    // com o painel aberto só a digitação do usuário fica retida; as respostas automáticas do xterm (DA, cursor) seguem
    let teclaDoUsuario = false;
    term.onKey(() => { teclaDoUsuario = true; }); // o onKey dispara antes do onData da mesma tecla
    term.onData(data => {
      const usuario = teclaDoUsuario; teclaDoUsuario = false;
      if (t.alive && !(t.painel && (usuario || !data.startsWith('\x1b')))) dev.ptyWrite(t.id, data);
    });
    term.onKey(() => { t.digitou = true; }); // só tecla do usuário (as respostas automáticas do xterm não contam)
    term.onResize(({ cols, rows }) => dev.ptyResize(t.id, cols, rows));
    // Teclas do terminal: a decisão é pura (RendraTermKeys.acaoDeTecla, por sistema) e este trecho só executa.
    // Ctrl+C nunca envia o \x03 do xterm: sem texto marcado, 1 toque cola o que está copiado depois de 1 s, 2 avisam
    // e o 3º dentro de 2 s interrompe (um só \x03 ao programa); com texto marcado só confirma "Copiado" (copiar é ao
    // marcar). Imagem para as CLIs (Claude Code, Codex), que leem a área de transferência sozinhas ao receber a tecla:
    // Alt+V ou Ctrl+V conforme o sistema (RendraTermKeys.bytesColarImagem). Com o painel de conversas aberto nenhuma
    // escrita direta vai ao pty, como a digitação (t.painel).
    const plataforma = window.rendra.platform;
    const podeEscrever = () => t.alive && !t.painel;
    const pasteText = () => navigator.clipboard.readText().then(x => { if (x && podeEscrever()) term.paste(x); });
    // Ctrl+V e Ctrl+Shift+V: texto vence (term.paste, com bracketed paste quando o programa pediu); só imagem manda o
    // Ctrl+V cru e a CLI pega a imagem. Erro de leitura ou do canal da imagem nunca bloqueia a colagem de texto.
    const colar = async () => {
      if (!podeEscrever()) return;
      let texto = '', imagem = false;
      try { texto = await navigator.clipboard.readText(); } catch { /* sem texto */ }
      try { imagem = await dev.clipboardHasImage(); } catch { /* sem imagem */ }
      if (!podeEscrever()) return;
      if (RendraTermKeys.decidirColagem(texto, imagem) === 'imagem') dev.ptyWrite(t.id, '\x16');
      else if (texto) term.paste(texto);
    };
    const aviso = document.createElement('div');
    aviso.className = 'term-aviso';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    pane.appendChild(aviso);
    // O leitor de tela só reanuncia uma região viva quando o texto muda: ao avisar, limpa e reescreve; ao sumir, tira o
    // texto e o aviso sai da árvore de acessibilidade (visibility no CSS).
    let timerAviso = null;
    const mostrarAviso = () => {
      clearTimeout(timerAviso);
      aviso.textContent = '';
      aviso.classList.add('visible');
      timerAviso = setTimeout(() => { aviso.textContent = 'aperte mais 1 vez para interromper'; }, 60);
    };
    const esconderAviso = () => { clearTimeout(timerAviso); aviso.classList.remove('visible'); aviso.textContent = ''; };
    t.ctrlC = RendraTermKeys.criarCtrlC({
      aoColar: () => { if (RendraTermKeys.podeColarDeCtrlC({ vivo: t.alive, painel: t.painel, modalAberto: modalAberto() })) pasteText().catch(() => { }); },
      aoAvisar: mostrarAviso,
      aoEsconder: esconderAviso,
      aoInterromper: () => { if (podeEscrever()) dev.ptyWrite(t.id, '\x03'); },
    });
    // Copiar ao marcar: o realce continua (a seleção não é limpa). Cada arraste dispara vários eventos de seleção,
    // então a cópia espera a seleção ficar parada por SELECAO_ESTAVEL ms e o botão do mouse estar solto.
    const SELECAO_ESTAVEL = 200;
    let timerSelecao = null, ultimoCopiado = '', botaoBaixo = false;
    const copiarMarcado = () => {
      timerSelecao = null;
      if (botaoBaixo) return; // o mouseup volta a agendar
      const texto = term.hasSelection() ? term.getSelection() : '';
      if (!texto) { ultimoCopiado = ''; return; } // seleção limpa: marcar o mesmo texto de novo copia de novo
      if (!RendraTermKeys.deveCopiar(texto, ultimoCopiado)) return;
      ultimoCopiado = texto;
      navigator.clipboard.writeText(texto).then(() => toast('Copiado'), () => { });
    };
    const agendarCopia = () => { clearTimeout(timerSelecao); timerSelecao = setTimeout(copiarMarcado, SELECAO_ESTAVEL); };
    const soltouMouse = () => { if (botaoBaixo) { botaoBaixo = false; agendarCopia(); } };
    term.onSelectionChange(agendarCopia);
    body.addEventListener('mousedown', ev => { if (ev.button === 0) botaoBaixo = true; });
    document.addEventListener('mouseup', soltouMouse, true);
    t.limparSelecao = () => { clearTimeout(timerSelecao); document.removeEventListener('mouseup', soltouMouse, true); };
    term.attachCustomKeyEventHandler(ev => {
      const a = RendraTermKeys.acaoDeTecla(ev, plataforma, t.shellKey, { temSelecao: term.hasSelection() });
      switch (a.tipo) {
        case 'enviar':
          ev.preventDefault();
          if (t.alive) dev.ptyWrite(t.id, a.bytes); // Shift+Enter: nova linha, sem enviar
          return false;
        case 'ctrlc':
          ev.preventDefault();
          if (!a.toque || !t.alive) return false;
          if (a.selecao) { navigator.clipboard.writeText(term.getSelection()).then(() => toast('Copiado'), () => { }); return false; }
          if (!t.painel) t.ctrlC.tocar();
          return false;
        case 'colar':
          ev.preventDefault();
          colar();
          return false;
        case 'colar-imagem':
          ev.preventDefault();
          if (podeEscrever()) dev.ptyWrite(t.id, a.bytes);
          return false;
        case 'copiar-selecao': {
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }
        case 'atalho-ide':
          ev.preventDefault(); // a escuta do document (captura) já executou a ação: aqui só não vira bytes
          return false;
        default:
          return true; // Cmd+V do macOS (colagem do browser), Control+V e Option do macOS, Alt+Backspace, Ctrl+L, Ctrl+O...
      }
    });
    // clique direito cola sempre, na hora, pelo term.paste (bracketed paste como o Ctrl+V); copiar é ao marcar
    body.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      pasteText().catch(() => { });
    });
    term.textarea?.addEventListener('focus', () => { pane.classList.add('focused'); tab.classList.add('focused'); });
    term.textarea?.addEventListener('blur', () => { pane.classList.remove('focused'); tab.classList.remove('focused'); });
    initTabDrag(ws, t);
    tab.querySelector('[data-act=close]').addEventListener('click', async () => {
      // a terminal whose process already ended closes without asking
      if (t.alive && !(await askCloseTerminals(
        `Fechar ${t.name}?`,
        'O terminal será encerrado, junto com qualquer comando que estiver rodando nele.',
      ))) return;
      killTerminal(ws, t);
    });
    new ResizeObserver(() => fitTerm(t)).observe(body);
    term.focus();
    abrirSeletor(ws, t, shell); // depois do pty:create: a distro já foi acordada
  }

  // Inline rename: the name becomes an input with its text selected, ready to type over
  function renameTerminal(t) {
    const nameEl = t.tab.querySelector('.term-pane-name');
    if (!nameEl) return; // already editing
    const input = document.createElement('input');
    input.className = 'term-rename';
    input.value = t.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = commit => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (commit && v) t.name = v;
      const span = document.createElement('span');
      span.className = 'term-pane-name';
      span.textContent = t.name;
      span.addEventListener('dblclick', () => renameTerminal(t));
      input.replaceWith(span);
      t.term.focus();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // keep keys away from the terminal and global shortcuts
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Moves terminal t to position `to` (tabs and grid panes follow the same order)
  function moveTerminalTo(ws, t, to) {
    const from = ws.terms.indexOf(t);
    if (from < 0 || to === from) return;
    ws.terms.splice(from, 1);
    ws.terms.splice(Math.max(0, Math.min(to, ws.terms.length)), 0, t);
    ws.terms.forEach(x => { ws.refs.grid.appendChild(x.pane); ws.refs.termTabs.appendChild(x.tab); }); // DOM order = grid order
    layoutTerminals(ws);
    t.term.focus();
  }

  // Drag & drop reorder: dropping on the left half of a tab puts it before, right half after
  let dragged = null;
  function initTabDrag(ws, t) {
    const { tab } = t;
    const clear = () => ws.refs.termTabs.querySelectorAll('.term-tab').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const after = e => { const r = tab.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
    tab.addEventListener('dragstart', e => {
      dragged = { ws, t };
      tab.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.name);
    });
    tab.addEventListener('dragend', () => { dragged = null; tab.classList.remove('dragging'); clear(); });
    tab.addEventListener('dragover', e => {
      if (!dragged || dragged.ws !== ws || dragged.t === t) return;
      e.preventDefault();
      clear();
      tab.classList.add(after(e) ? 'drop-after' : 'drop-before');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
    tab.addEventListener('drop', e => {
      if (!dragged || dragged.ws !== ws || dragged.t === t) return;
      e.preventDefault();
      const moving = dragged.t;
      const target = ws.terms.indexOf(t) + (after(e) ? 1 : 0);
      const from = ws.terms.indexOf(moving);
      clear();
      moveTerminalTo(ws, moving, from < target ? target - 1 : target);
    });
  }

  async function killTerminal(ws, t) {
    t.ctrlC?.cancelar(); // um toque de Ctrl+C pendente não cola em terminal fechado
    t.limparSelecao?.();
    if (t.id != null) { await dev.ptyKill(t.id); ptyOwner.delete(t.id); }
    t.term.dispose();
    t.pane.remove();
    t.tab.remove();
    ws.terms = ws.terms.filter(x => x !== t);
    layoutTerminals(ws);
  }

  dev.onPtyData(({ id, data }) => {
    const owner = ptyOwner.get(id);
    if (!owner) return;
    const t = owner.t;
    t.term.write(data);
    // janela curta da saída crua (2 KB) para achar o prompt, desde o primeiro dado
    t.recente = ((t.recente || '') + data).slice(-2048);
    if (t.aguardando && window.RendraSessoesEscolha.fimDePrompt(t.recente)) t.aguardando.dispara();
  });
  dev.onPtyExit(({ id, exitCode }) => {
    const owner = ptyOwner.get(id);
    if (!owner) return;
    owner.t.alive = false;
    owner.t.ctrlC?.cancelar();
    owner.t.pane.querySelector('.term-aviso')?.classList.remove('visible');
    owner.t.painel?.fechar();
    owner.t.pane.classList.add('dead');
    owner.t.tab.classList.add('dead');
    owner.t.term.write(`\r\n\x1b[90m[processo encerrado com código ${exitCode}]\x1b[0m\r\n`);
  });

  // ── Resizable panels ───────────────────────────────────────────────────────
  function initSplitter(ws, sp) {
    sp.addEventListener('mousedown', down => {
      down.preventDefault();
      const which = sp.dataset.split;
      const rect = ws.el.getBoundingClientRect();
      sp.classList.add('dragging');
      document.body.classList.add('dev-resizing');
      const move = ev => {
        if (which === 'explorer') {
          const w = Math.min(Math.max(ev.clientX - rect.left, 140), rect.width * 0.4);
          ws.el.style.setProperty('--ex-w', `${w}px`);
        } else {
          const w = Math.min(Math.max(rect.right - ev.clientX, 200), rect.width * 0.7);
          ws.el.style.setProperty('--ed-w', `${w}px`);
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        sp.classList.remove('dragging');
        document.body.classList.remove('dev-resizing');
        // New workspaces start with the last sizes used
        lsSet('dev.layout.explorer', ws.el.style.getPropertyValue('--ex-w'));
        lsSet('dev.layout.editor', ws.el.style.getPropertyValue('--ed-w'));
        ws.terms.forEach(fitTerm);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    $('ws-add').addEventListener('click', () => activateWorkspace(createWorkspace()));
    $('ws-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (!ws) return;
      if (e.target.closest('.ws-tab-close')) closeWorkspace(ws);
      else if (ws !== activeWs) activateWorkspace(ws);
    });
    $('ws-tabs').addEventListener('dblclick', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (ws && !e.target.closest('.ws-tab-close')) startRename(ws, tab);
    });
    $('ws-tabs').addEventListener('auxclick', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (ws && e.button === 1) closeWorkspace(ws);
    });

    const saved = await dev.loadWorkspaces();
    (saved.list.length ? saved.list : [{}]).forEach(w => createWorkspace(w));
    activateWorkspace(workspaces[Math.min(saved.active || 0, workspaces.length - 1)]);
  }

  // ── Atalhos da IDE: Ctrl+Shift+T (novo terminal), Ctrl+O (abrir pasta, só fora do terminal), Ctrl+Tab (aba do editor) ──
  // A decisão é pura (RendraAtalhosIde, por sistema); aqui ficam a guarda de contexto e a execução. A escuta é na fase de
  // captura do document: vale com o foco no explorador, no editor ou no terminal (o handler do xterm só não deixa a tecla
  // virar bytes). Só nas páginas IDE e Terminal, sem janela modal ou menu aberto e sem foco num campo de texto.
  const paginaAtiva = () => document.querySelector('.page.active')?.id || '';
  const modalAberto = () => !!document.querySelector('#settings-overlay.visible, #save-overlay.visible, #setup-overlay.visible, #novidades-overlay.visible, .dev-term-menu, .dev-ctx-menu');
  const wsDaPagina = () => (paginaAtiva() === 'page-devcode' ? activeWs : paginaAtiva() === 'page-terminal' ? terminalPage : null);
  document.addEventListener('keydown', ev => {
    const ws = wsDaPagina();
    if (!ws || modalAberto()) return;
    const alvo = ev.target;
    // campos de texto (renomear, novo item, filtros) ficam com a tecla; o xterm e o Monaco têm textarea própria e valem
    if (alvo.closest?.('input, select') || (alvo.tagName === 'TEXTAREA' && !alvo.closest('.xterm, .monaco-editor'))) return;
    const acao = RendraAtalhosIde.acaoDeAtalhoIde(ev, window.rendra.platform, { foraDoTerminal: !alvo.closest?.('.xterm') });
    if (!acao) return;
    if (acao === 'novo-terminal') {
      const ancora = [...ws.el.querySelectorAll('[data-act=new-term]')].find(e => e.offsetParent !== null);
      if (!ancora) return;
      ev.preventDefault();
      if (!ev.repeat) pedirNovoTerminal(ws, ancora);
    } else if (acao === 'abrir-pasta') {
      if (!ws.el.querySelector('[data-act=open]')) return; // a página Terminal não tem pasta: nada a fazer
      ev.preventDefault();
      if (!ev.repeat) pickFolder(ws);
    } else {
      ev.preventDefault();
      const grupo = ws.activeGroup;
      const proxima = grupo && RendraAtalhosIde.proximaAba(grupo.tabs, grupo.active, acao === 'proxima-aba' ? 1 : -1);
      if (proxima && !ev.repeat) showInGroup(ws, grupo, proxima);
    }
  }, true);

  window.devcode = {
    activate() {
      init();
      if (activeWs) requestAnimationFrame(() => {
        activeWs.terms.forEach(fitTerm);
        activeWs.groups.forEach(g => g.editor.layout());
      });
    },
    activateTerminalPage,
  };

  // DevCode is the start page
  if ($('page-devcode').classList.contains('active')) window.devcode.activate();
})();

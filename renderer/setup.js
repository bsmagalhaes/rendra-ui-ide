/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// "Configurar ambiente": checks Git Bash, RTK (+ its Claude Code hook) and WSL, and installs
// what's missing on request. Opens by itself on first launch when something is missing, and
// from Settings / the RTK tab at any time.

(() => {
  const api = window.rendra.setup;
  const $ = id => document.getElementById(id);
  let status = null;
  let running = false;

  const ITEMS = [
    {
      key: 'git',
      name: s => (s.platform === 'win32' ? 'Git Bash' : 'Git'),
      desc: s => (s.platform === 'win32' ? 'Git e o terminal Git Bash para Windows.'
        : s.platform === 'darwin' ? 'Git pelas Ferramentas de Linha de Comando da Apple.'
          : 'Git pelo gerenciador de pacotes da distribuição.'),
      ready: s => s.git.installed,
      detail: s => s.git.path,
    },
    {
      key: 'rtk', name: 'RTK · Rust Token Killer',
      desc: 'Filtra a saída dos comandos antes de chegar ao Claude, economizando tokens.',
      ready: s => s.rtk.installed,
      detail: s => s.rtk.version,
    },
    {
      key: 'rtk-hook', name: 'RTK ativo no Claude Code',
      desc: 'Liga o RTK ao Claude Code (rtk init -g).',
      ready: s => s.rtk.hook,
      detail: () => 'hook configurado',
      needs: 'rtk',
    },
    {
      key: 'wsl', name: 'WSL · Linux no Windows',
      desc: 'Instala o WSL com Ubuntu para abrir projetos no Linux. Pode exigir reiniciar o computador.',
      applies: s => s.wsl.applicable, // Windows only
      ready: s => s.wsl.ready,
      detail: s => s.wsl.distros.map(d => d.name).join(', '),
    },
  ];

  const val = (v, s) => (typeof v === 'function' ? v(s) : v);
  const itemsFor = s => ITEMS.filter(i => !i.applies || i.applies(s));
  const missing = s => itemsFor(s).filter(i => !i.ready(s));

  function render() {
    const box = $('setup-items');
    if (!status) { box.innerHTML = '<div class="limits-empty">Verificando…</div>'; return; }
    box.innerHTML = itemsFor(status).map(i => {
      const ok = i.ready(status);
      return `
        <label class="setup-item${ok ? ' ready' : ''}">
          <input type="checkbox" data-key="${i.key}" ${ok ? 'disabled' : 'checked'}>
          <div class="setup-item-text">
            <div class="setup-item-name">${val(i.name, status)}</div>
            <div class="setup-item-desc">${ok ? (i.detail(status) || 'instalado') : val(i.desc, status)}</div>
          </div>
          <span class="setup-badge ${ok ? 'ok' : 'todo'}">${ok ? 'Pronto' : 'Faltando'}</span>
        </label>`;
    }).join('');
    const todo = missing(status).length;
    $('setup-run').disabled = !todo || running;
    $('setup-run').textContent = todo ? 'Instalar selecionados' : 'Tudo pronto';
    $('setup-later').textContent = todo ? 'Agora não' : 'Fechar';
  }

  async function open() {
    $('setup-overlay').classList.add('visible');
    $('setup-log').textContent = '';
    status = null;
    render();
    status = await api.check();
    render();
  }

  function close() {
    if (running) return;
    $('setup-overlay').classList.remove('visible');
  }

  async function install() {
    const keys = [...document.querySelectorAll('#setup-items input:checked:not(:disabled)')].map(c => c.dataset.key);
    // the hook needs RTK itself: selecting the hook alone still installs RTK first if missing
    if (keys.includes('rtk-hook') && !status.rtk.installed && !keys.includes('rtk')) keys.unshift('rtk');
    if (keys.includes('rtk') && !status.rtk.hook && !keys.includes('rtk-hook')) keys.push('rtk-hook');
    if (!keys.length) return;
    running = true;
    render();
    $('setup-log').textContent = '';
    const res = await api.install(keys);
    running = false;
    status = res.status;
    render();
    if (res.results.wsl?.needsReboot) {
      $('setup-log').textContent += '\nReinicie o computador para concluir a instalação do WSL.';
    }
    if (res.results.rtk?.ok && typeof loadRtk === 'function') loadRtk(); // RTK tab picks it up now
    const failed = Object.entries(res.results).filter(([, r]) => !r.ok).map(([k]) => k);
    if (typeof showToast === 'function') {
      showToast(failed.length ? `Algumas instalações falharam: ${failed.join(', ')}` : 'Ambiente configurado');
    }
  }

  api.onLog(msg => {
    const log = $('setup-log');
    log.textContent += (log.textContent ? '\n' : '') + msg;
    log.scrollTop = log.scrollHeight;
  });

  $('setup-run').addEventListener('click', install);
  $('setup-later').addEventListener('click', async () => {
    if (status && missing(status).length) await api.dismiss(); // don't nag on every launch
    close();
  });
  $('setup-overlay').addEventListener('click', e => { if (e.target.id === 'setup-overlay') close(); });
  $('s-setup')?.addEventListener('click', () => {
    document.getElementById('settings-overlay')?.classList.remove('visible');
    open();
  });
  $('rtk-install')?.addEventListener('click', open);

  window.envSetup = { open };

  // First launch (right after installing): open by itself if something is missing
  setTimeout(async () => {
    const [st, s] = await Promise.all([api.state(), api.check()]);
    if (st.dismissed || !s.supported || !missing(s).length) return;
    status = s;
    $('setup-overlay').classList.add('visible');
    render();
  }, 2500);
})();

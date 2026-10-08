/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Rendra IDE renderer — UI logic, routing, chart rendering

const tm = window.rendra;

// ── State ──────────────────────────────────────────────────────────────────
let usageData = null;
let charts = {};
let currentSettings = null;
let alertFiredForDate = '';

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

function updateStatus(msg) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = msg;
}

// ── Formatting Helpers ─────────────────────────────────────────────────────
function fmtTokens(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace('.', ',') + 'K';
  return String(n);
}

function fmtCost(n) {
  if (n == null || isNaN(n)) n = 0;
  return '~US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRelTime(mtime) {
  const diff = Date.now() - mtime;
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min < 1)   return 'agora';
  if (min < 60)  return `há ${min} min`;
  if (hr < 24)   return `há ${hr} h`;
  return `há ${day} ${day === 1 ? 'dia' : 'dias'}`;
}

function fmtTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// "2026-09-25" → "25/09/2026"
function fmtDateBR(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function pct(val, total) {
  if (!total) return 0;
  return Math.min(100, (val / total) * 100);
}

// ── Navigation ─────────────────────────────────────────────────────────────
function navigate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${pageId}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');
  if (pageId === 'rtk' && !rtkLoaded) loadRtk();
  // DevCode takes the whole content area (no padding/scroll) and owns the keyboard
  // full-height pages (no padding/scroll, no idle dim, Ctrl+R free for the terminal)
  document.body.classList.toggle('dev-mode', pageId === 'devcode' || pageId === 'terminal');
  if (pageId === 'devcode') window.devcode?.activate();
  if (pageId === 'terminal') window.devcode?.activateTerminalPage();
  if (pageId === 'precos') window.pricingPage?.open();
  if (pageId === 'sobre') window.aboutPage?.open();
  if (pageId === 'novidades') window.changelogPage?.open();
  if (pageId === 'comandos') window.comandosPage?.open();
}

// ── Filters (projects + period) ────────────────────────────────────────────
let activeFilters = { days: 90, projects: [] };

function periodLabel(days) {
  return days === 1 ? 'hoje' : `${days} dias`;
}

function renderFilters(cl) {
  activeFilters = cl.filters || activeFilters;
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.days === activeFilters.days));
  document.querySelectorAll('.daily-heading').forEach(h => {
    h.textContent = `Atividade diária (${periodLabel(activeFilters.days)})`;
  });

  const sel = activeFilters.projects;
  document.getElementById('project-filter-value').textContent =
    !sel.length ? 'Todos' : sel.length === 1 ? sel[0] : `${sel.length} selecionados`;

  // Don't rebuild the list while the user is picking projects in the open panel
  if (document.getElementById('project-filter').classList.contains('open')) return;
  const list = document.getElementById('project-list');
  list.innerHTML = (cl.projects || []).map(p => `
    <label class="project-option" data-name="${escapeHtml(p.name.toLowerCase())}">
      <input type="checkbox" value="${escapeHtml(p.name)}"${sel.includes(p.name) ? ' checked' : ''}>
      <span>${escapeHtml(p.name)}</span>
      <span class="project-tokens">${fmtTokens(p.totalTokens)}</span>
    </label>`).join('');
  document.getElementById('project-all').checked = !sel.length;
}

async function applyFilters(next) {
  activeFilters = { ...activeFilters, ...next };
  updateStatus('* Filtrando…');
  const data = await tm.setFilters(activeFilters);
  if (data) render(data);
}

function initFilters() {
  const box = document.getElementById('project-filter');
  const all = document.getElementById('project-all');
  const list = document.getElementById('project-list');
  const boxes = () => [...list.querySelectorAll('input[type=checkbox]')];

  document.querySelectorAll('.period-btn').forEach(b =>
    b.addEventListener('click', () => applyFilters({ days: +b.dataset.days })));

  document.getElementById('project-filter-btn').addEventListener('click', e => {
    e.stopPropagation();
    box.classList.toggle('open');
    if (box.classList.contains('open')) document.getElementById('project-search').focus();
  });
  document.addEventListener('click', e => { if (!box.contains(e.target)) box.classList.remove('open'); });

  document.getElementById('project-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    list.querySelectorAll('.project-option').forEach(o => {
      o.style.display = o.dataset.name.includes(q) ? '' : 'none';
    });
  });

  // "Todos" and individual projects are mutually exclusive; nothing picked falls back to "Todos"
  all.addEventListener('change', () => { if (all.checked) boxes().forEach(b => { b.checked = false; }); });
  list.addEventListener('change', () => { all.checked = !boxes().some(b => b.checked); });

  document.getElementById('project-clear').addEventListener('click', () => {
    boxes().forEach(b => { b.checked = false; });
    all.checked = true;
  });
  document.getElementById('project-apply').addEventListener('click', () => {
    const picked = all.checked ? [] : boxes().filter(b => b.checked).map(b => b.value);
    box.classList.remove('open');
    applyFilters({ projects: picked });
  });
}

// ── Account & plan limits ──────────────────────────────────────────────────
function fmtPlan(plan, tier) {
  const p = plan ? plan[0].toUpperCase() + plan.slice(1) : '';
  const max = String(tier || '').match(/max_(\d+x)/i);
  return [p, max ? `Max ${max[1]}` : ''].filter(Boolean).join(' · ') || '—';
}

function fmtResetIn(ts) {
  if (!ts) return '';
  const min = Math.max(0, Math.round((ts - Date.now()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `Reinicia em ${d} d ${h} h`;
  if (h > 0) return `Reinicia em ${h} h ${m} min`;
  return `Reinicia em ${m} min`;
}

function limitName(l) {
  if (l.label) return l.label;
  if (l.kind === 'session') return 'Limite de 5 horas';
  if (l.kind === 'weekly_all') return 'Semanal · todos os modelos';
  if (l.kind === 'weekly_scoped') return `Semanal · ${l.model || 'modelo'}`;
  return l.kind;
}

async function loadAccount() {
  let res;
  try { res = await tm.claudeAccount(); } catch { return; }
  const acc = res?.account;
  document.getElementById('acc-org').textContent = acc ? (acc.organization || acc.name || '—') : 'Nenhuma conta conectada';
  document.getElementById('acc-email').textContent = acc?.email || '—';
  document.getElementById('acc-email').title = acc?.name || '';
  document.getElementById('acc-plan').textContent = acc ? fmtPlan(acc.plan, acc.tier) : '—';
  // the title bar shows the e-mail too (organization, e-mail and plan); the plan of the local Claude
  // account also comes from here (on macOS it lives in the Keychain, which the light channel never reads)
  planoClaudeLocal = acc ? fmtPlan(acc.plan, acc.tier).replace(/^—$/, '') : '';
  desenharBarraConsumo();

  const list = document.getElementById('limits-list');
  const updated = document.getElementById('limits-updated');
  if (!res?.limits) {
    list.innerHTML = `<div class="limits-empty">${escapeHtml(res?.error || 'Limites indisponíveis')}</div>` +
      (res?.needsBridge ? '<button class="btn btn-primary limits-enable" id="limits-enable" type="button">Ativar leitura de limites</button>' : '');
    updated.textContent = '';
    document.getElementById('limits-enable')?.addEventListener('click', enableLimitsBridge);
    return;
  }
  list.innerHTML = limitRowsHtml(res.limits);
  // statusline data is as fresh as the last Claude Code refresh
  const at = res.source === 'statusline'
    ? `lido do Claude Code às ${fmtTimestamp(res.fetchedAt || Date.now())}`
    : `atualizado às ${fmtTimestamp(res.fetchedAt || Date.now())}`;
  updated.textContent = res.note ? `${at} · ${res.note}` : at;
  updated.classList.toggle('stale', !!res.note);
}

// Installs the statusline bridge (src/statusline.sh) into ~/.claude/settings.json, keeping the
// user's current statusline running after it
async function enableLimitsBridge() {
  if (!confirm('Ativar a leitura de limites?\n\nO Rendra IDE vai configurar a statusline do Claude Code para registrar os limites de uso que o próprio Claude Code informa. Sua statusline atual continua funcionando. Nenhuma senha ou token é lido.')) return;
  try {
    await tm.limitsBridge.install();
    showToast('Leitura de limites ativada · os limites aparecem na próxima atualização do Claude Code');
  } catch (e) {
    showToast(`Não foi possível ativar: ${e.message}`);
  }
  loadAccount();
}

// ── Title-bar consumption bar (provider + environment selector, account, plan limits) ───
// Reads the light channel provider:snapshot (no credentials, no network, no tokens) every 60 s and
// on ↻: identity and limits of each provider + environment (Claude and Codex, local system and WSL
// distros). The local system is painted first; the WSL discovery (slow) arrives on its own.
// Rules live in renderer/consumo.js; this only paints the result. The chosen option is remembered
// in settings.provedorBarra and is written ONLY when the user changes the selector (an option that
// disappears for a round, e.g. a stopped distro, falls back to the default without overwriting it).
const provEntradas = { local: [], wsl: [] };
const provSeq = { local: 0, wsl: 0 };
let provLembrada = null;
let planoClaudeLocal = ''; // plano vindo de loadAccount (no macOS vem do Keychain, que o canal leve não lê)

const planoDaEntrada = e => {
  if (!e?.conta) return '';
  const p = fmtPlan(e.conta.plan, e.conta.tier).replace(/^—$/, '');
  return p || (e.id === 'claude:local' ? planoClaudeLocal : '');
};

let barraCompacta = false;
function rotulosDoSeletor(opcoes) {
  const sel = document.getElementById('consumo-provedor');
  [...sel.options].forEach(o => {
    const op = opcoes.find(x => x.id === o.value);
    if (op) { o.textContent = barraCompacta ? op.rotuloCompacto : op.rotulo; o.title = op.tooltipAmbiente; }
  });
  const atual = opcoes.find(x => x.id === sel.value);
  sel.title = atual ? atual.tooltipAmbiente : '';
}

// Opções do seletor: só recalcula quando as entradas ou a escolha lembrada mudam (ajustar a largura não muda nada)
let opcoesMemo = null;
function opcoesAtuais() {
  const m = opcoesMemo;
  if (m && m.local === provEntradas.local && m.wsl === provEntradas.wsl && m.lembrada === provLembrada) return m.valor;
  const valor = RendraConsumo.opcoesSeletor([...provEntradas.local, ...provEntradas.wsl], provLembrada);
  opcoesMemo = { local: provEntradas.local, wsl: provEntradas.wsl, lembrada: provLembrada, valor };
  return valor;
}

function desenharBarraConsumo() {
  const barra = document.getElementById('consumo-bar');
  const sel = document.getElementById('consumo-provedor');
  const escolha = opcoesAtuais();
  const entrada = [...provEntradas.local, ...provEntradas.wsl].find(e => e.id === escolha.selecionada) || null;
  const estado = RendraConsumo.estadoConsumo(entrada && { limits: entrada.limits, fetchedAt: entrada.fetchedAt }, Date.now(), {
    conta: entrada?.conta, plano: planoDaEntrada(entrada), ambiente: entrada?.ambiente, provedor: entrada?.provedor,
    fmtResetIn, fmtHora: fmtTimestamp,
  });
  if (!estado.visivel) {
    barra.hidden = true;
    barra.removeAttribute('title');
    return;
  }
  barra.hidden = false;
  barra.title = estado.tooltip;
  barra.setAttribute('aria-label', estado.ariaGrupo);

  // seletor: só existe com 2 ou mais opções; as opções só são refeitas se mudarem
  const ids = escolha.opcoes.map(o => o.id).join('|');
  if (sel.dataset.ids !== ids) {
    sel.dataset.ids = ids;
    sel.replaceChildren(...escolha.opcoes.map(o => { const op = document.createElement('option'); op.value = o.id; return op; }));
  }
  sel.value = escolha.selecionada;
  sel.hidden = !escolha.mostrarSeletor;
  rotulosDoSeletor(escolha.opcoes);

  document.getElementById('consumo-nome').textContent = estado.nome;
  document.getElementById('consumo-nome').hidden = !estado.nome;
  document.getElementById('consumo-email').textContent = estado.email;
  document.getElementById('consumo-email').hidden = !estado.email;
  document.getElementById('consumo-semdados').hidden = !estado.semDados;

  barra.querySelectorAll('.consumo-item').forEach(el => {
    const item = estado.itens.find(i => i.chave === el.dataset.kind);
    el.hidden = !item;
    if (!item) return;
    el.className = `consumo-item ${item.classe}`;
    el.querySelector('.consumo-rotulo').textContent = item.rotulo;
    el.querySelector('.consumo-pct').textContent = item.texto;
    el.querySelector('.consumo-fill').style.width = `${item.percent}%`;
    const pb = el.querySelector('[role=progressbar]');
    pb.setAttribute('aria-label', item.ariaRotulo);
    pb.setAttribute('aria-valuenow', String(item.percent));
    pb.setAttribute('aria-valuetext', item.ariaTexto);
  });
  ajustarBarraConsumo();
}

// Largura: mede e decide, em vez de cortes fixos (nome de organização, e-mail, distro e fonte variam).
// Ordem: tudo; e-mail encurtado com reticências (mínimo 90 px); sem e-mail, com o nome encurtado
// (mínimo 70 px); sem nome; por fim .compacto (seletor só com o provedor, trilho de 40 px, espaço de 8 px).
// Os limites nunca somem. O título nunca é empurrado: o espaço é o que sobra entre o nome do app e os botões.
const EMAIL_MIN = 90;
const NOME_MIN = 70;
function ajustarBarraConsumo() {
  const barra = document.getElementById('consumo-bar');
  if (barra.hidden) return;
  const tb = document.getElementById('title-bar');
  const nomeEl = document.getElementById('consumo-nome');
  const emailEl = document.getElementById('consumo-email');
  const opcoes = opcoesAtuais().opcoes;

  // espaço = largura útil do título menos tudo o que não é a barra (botões, nome do app), os espaços
  // entre os itens do título e a margem de 12 px que .title-bar-right ganha quando a barra aparece
  const espaco = () => {
    const cs = getComputedStyle(tb);
    const outros = [...tb.children].filter(c => c !== barra && c.getBoundingClientRect().width > 0);
    const soma = outros.reduce((t, c) => t + c.getBoundingClientRect().width, 0);
    return tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - soma - (parseFloat(cs.columnGap) || 0) * outros.length - 12;
  };
  const largura = () => barra.getBoundingClientRect().width;
  const cabe = () => largura() <= espaco();
  const aplica = (compacto, semEmail, semNome) => {
    barraCompacta = compacto;
    barra.classList.toggle('compacto', compacto);
    emailEl.style.display = semEmail ? 'none' : '';
    nomeEl.style.display = semNome ? 'none' : '';
    emailEl.style.maxWidth = '';
    nomeEl.style.maxWidth = '';
    rotulosDoSeletor(opcoes);
  };
  // encurta o elemento exatamente pelo que passa do espaço; falso se sobrar menos que o mínimo útil
  const encurta = (el, minimo) => {
    const w = el.getBoundingClientRect().width - (largura() - espaco());
    if (w < minimo) return false;
    el.style.maxWidth = `${Math.floor(w)}px`;
    return true;
  };

  aplica(false, false, false);
  if (cabe()) return;
  if (!emailEl.hidden && encurta(emailEl, EMAIL_MIN) && cabe()) return;
  aplica(false, true, false);
  if (cabe()) return;
  if (!nomeEl.hidden && encurta(nomeEl, NOME_MIN) && cabe()) return;
  aplica(false, true, true);
  if (cabe()) return;
  aplica(true, true, true);
}

async function atualizarBarraConsumo() {
  const buscar = async (wsl, chave) => {
    const meu = ++provSeq[chave];
    let r = [];
    try { r = await tm.providerSnapshot({ wsl }); } catch { r = []; }
    if (meu !== provSeq[chave]) return; // chegou uma resposta mais nova
    provEntradas[chave] = Array.isArray(r) ? r : [];
    desenharBarraConsumo();
  };
  await Promise.all([buscar(false, 'local'), buscar(true, 'wsl')]);
}

// Trocar no seletor é a única hora em que a escolha é gravada (merge raso em save-settings)
function escolherProvedorBarra(id) {
  provLembrada = id;
  tm.saveSettings({ provedorBarra: id });
  desenharBarraConsumo();
}

function limitRowsHtml(limits) {
  return (limits || []).map(l => {
    const nivel = RendraConsumo.nivelDe(l.percent);
    const level = nivel === 'ok' ? '' : nivel;
    return `
      <div class="limit-row">
        <span class="limit-name">${escapeHtml(limitName(l))}</span>
        <span class="limit-reset">${fmtResetIn(l.resetsAt)}</span>
        <span class="limit-pct ${level}">${l.percent}%</span>
        <div class="limit-bar"><div class="limit-fill ${level}" style="width:${Math.min(100, l.percent)}%"></div></div>
      </div>`;
  }).join('') || '<div class="limits-empty">Nenhum limite informado para esta conta</div>';
}

// ── RTK ────────────────────────────────────────────────────────────────────
let rtkLoaded = false;

function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Soma, linhas por sistema e textos vêm de renderer/rtk-agents.js (puro e testado); aqui só se monta a tela
const RA = window.RendraRtkAgents;
let rtkData = null;
const cssColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function renderRtkAgent(agent, agg, view) {
  const state = document.getElementById(`rtk-${agent}-state`);
  state.textContent = view.state;
  state.classList.toggle('ok', view.allActive);
  document.getElementById(`rtk-${agent}-total`).textContent = `${fmtTokens(agg.total.saved)} tokens economizados`;
  document.getElementById(`rtk-${agent}-tip`).textContent = RA.tooltipLines(agg).join('\n');
  document.getElementById(`rtk-${agent}-envs`).innerHTML = RA.rowsHtml(view);
  document.getElementById(`rtk-${agent}-warnings`).innerHTML = RA.warningsHtml(view.warnings);
}

async function loadRtk() {
  rtkLoaded = true;
  const data = await tm.rtkStatus();
  rtkData = data;
  const missing = document.getElementById('rtk-missing');
  const body = document.getElementById('rtk-body');
  if (!data?.installed) {
    missing.style.display = 'block';
    body.style.display = 'none';
    document.getElementById('rtk-header-sub').textContent = 'não instalado';
    return;
  }
  missing.style.display = 'none';
  body.style.display = 'block';
  document.getElementById('rtk-header-sub').textContent = data.version;

  const checks = document.getElementById('rtk-checks');
  checks.innerHTML = (data.checks || []).map(c =>
    `<span class="rtk-check${c.ok ? ' ok' : ''}">${escapeHtml(c.text)}</span>`).join('');

  // Um total por agente (soma dos sistemas) e, por sistema, o estado do RTK e as ações
  const envs = data.environments || [];
  const agents = RA.aggregateAgents(envs);
  for (const a of ['claude', 'codex']) renderRtkAgent(a, agents[a], RA.agentView(envs, a));
  document.getElementById('rtk-warnings').innerHTML = RA.warningsHtml(RA.globalWarnings(envs));

  // Cartões do topo: os dois agentes somados
  const sum = RA.combinedTotals(agents);
  document.getElementById('rtk-saved').textContent    = fmtTokens(sum.saved);
  document.getElementById('rtk-saved-sub').textContent = 'tokens que não entraram no contexto';
  document.getElementById('rtk-pct').textContent      = sum.pct.toFixed(1).replace('.', ',') + '%';
  document.getElementById('rtk-commands').textContent = sum.commands.toLocaleString('pt-BR');
  document.getElementById('rtk-input').textContent    = fmtTokens(sum.input);
  document.getElementById('rtk-output').textContent   = fmtTokens(sum.output);
  document.getElementById('rtk-time').textContent     = fmtDuration(sum.timeMs);
  document.getElementById('rtk-time-sub').textContent = `média de ${Math.round(sum.avgTimeMs)} ms por comando`;

  // Duas séries, com as cores dos tokens (--orange do Claude Code, --codex do Codex)
  const s = RA.chartSeries(agents);
  const bar = { borderRadius: 3, borderSkipped: false, maxBarThickness: 40 };
  makeBarChart('chart-rtk-daily', s.labels.slice(-30).map(d => fmtDateBR(d).slice(0, 5)), [
    { label: 'Claude Code', data: s.claude.slice(-30), backgroundColor: cssColor('--orange'), ...bar },
    { label: 'Codex', data: s.codex.slice(-30), backgroundColor: cssColor('--codex'), ...bar },
  ]);

  // "Por comando" só existe em texto e só para o Claude Code neste sistema (o JSON não o exporta)
  const tbody = document.getElementById('rtk-cmd-tbody');
  tbody.innerHTML = (data.byCommand || []).slice(0, 10).map(r => `
    <tr>
      <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.command)}">${escapeHtml(r.command)}</td>
      <td class="mono dim">${r.count}</td>
      <td class="mono dim">${escapeHtml(r.saved.replace('.', ','))}</td>
      <td class="mono dim">${r.pct.toFixed(1).replace('.', ',')}%</td>
      <td class="mono dim">${escapeHtml(r.time)}</td>
    </tr>`).join('') || '<tr><td class="dim" colspan="5">Sem dados ainda.</td></tr>';
}

// Instalar/atualizar o RTK e ativar um agente, por sistema (botões das linhas de cada agente)
function showRtkResult(cmd, text) {
  document.getElementById('rtk-term-cmd').textContent = `$ ${cmd}`;
  document.getElementById('rtk-term-out').textContent = text;
}

async function runRtkAction(btn) {
  const { rtkAction: kind, env: envId, agent } = btn.dataset;
  const env = (rtkData?.environments || []).find(e => e.id === envId);
  if (!env) return;
  if (kind === 'enable') {
    const files = env.agents?.[agent]?.files || [];
    if (!confirm(RA.confirmText(agent, env.label, files))) return;
  }
  document.querySelectorAll('.rtk-act').forEach(b => { b.disabled = true; });
  try {
    if (kind === 'install') {
      showRtkResult(`instalar RTK (${env.label})`, 'Instalando…');
      const res = await tm.rtkInstall(envId);
      showRtkResult(`instalar RTK (${env.label})`, RA.installText(res, env.label));
      showToast(res?.ok ? 'RTK instalado' : 'Não foi possível instalar o RTK');
    } else if (kind === 'enable') {
      showRtkResult(`rtk init (${env.label})`, 'Ativando…');
      const res = await tm.rtkEnable(envId, agent);
      showRtkResult(`rtk init (${env.label})`, RA.resultText(res, agent, env.label));
      showToast(res?.ok ? 'RTK ativado' : 'Não foi possível ativar o RTK');
    }
  } finally {
    await loadRtk();
  }
}

async function runRtkCommand(btn) {
  const out = document.getElementById('rtk-term-out');
  const cmd = document.getElementById('rtk-term-cmd');
  document.querySelectorAll('.rtk-btn').forEach(b => { b.disabled = true; });
  btn.classList.add('running');
  cmd.textContent = `$ executando…`;
  out.textContent = btn.dataset.rtk === 'discover'
    ? 'Analisando o histórico do Claude Code, isso pode levar até alguns minutos…'
    : 'Executando…';
  try {
    const res = await tm.rtkRun(btn.dataset.rtk);
    cmd.textContent = `$ ${res.command || 'rtk'}`;
    out.textContent = (res.output || '').trim() || '(sem saída)';
    if (!res.ok) out.textContent += '\n\n[o comando terminou com erro]';
  } finally {
    btn.classList.remove('running');
    document.querySelectorAll('.rtk-btn').forEach(b => { b.disabled = false; });
  }
}

// ── Chart Helpers ──────────────────────────────────────────────────────────
const chartDefaults = () => ({
  responsive: true,
  maintainAspectRatio: true,
  animation: { duration: 400 },
  plugins: { legend: { display: false }, tooltip: {
    backgroundColor: '#1e1e1e',
    borderColor: '#3d3d3d',
    borderWidth: 1,
    titleFont: { family: "'Space Mono', monospace", size: 9 },
    bodyFont:  { family: "'Space Mono', monospace", size: 10 },
    callbacks: { label: ctx => ` ${fmtTokens(ctx.raw)} tokens` },
  }},
  scales: {
    x: {
      stacked: true,
      grid: { color: '#2e2e2e' },
      ticks: { color: '#525252', font: { family: "'Space Mono', monospace", size: 9 } },
    },
    y: {
      stacked: true,
      grid: { color: '#2e2e2e' },
      ticks: {
        color: '#525252',
        font: { family: "'Space Mono', monospace", size: 9 },
        callback: v => fmtTokens(v),
      },
    },
  },
});

function makeBarChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (charts[canvasId]) { charts[canvasId].destroy(); }
  charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: chartDefaults(),
  });
  return charts[canvasId];
}

function dailyLabels(daily) { return daily.map(d => d.label); }

// ── Heatmap ────────────────────────────────────────────────────────────────
function renderHeatmap(heatmap) {
  const grid = document.getElementById('heatmap-grid');
  if (!grid || !heatmap || !heatmap.length) return;

  const maxTokens = Math.max(...heatmap.map(d => d.totalTokens), 1);
  grid.innerHTML = '';

  // Pad front so column 0 starts on the right day-of-week (Mon=0)
  const firstDow = (new Date(heatmap[0].date).getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) {
    const pad = document.createElement('div');
    pad.className = 'heatmap-cell';
    grid.appendChild(pad);
  }

  for (const day of heatmap) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    const t = day.totalTokens;
    if (t > 0) {
      const ratio = t / maxTokens;
      const level = ratio < 0.15 ? 1 : ratio < 0.40 ? 2 : ratio < 0.70 ? 3 : 4;
      cell.setAttribute('data-level', level);
    }
    cell.title = `${fmtDateBR(day.date)}: ${fmtTokens(t)} tokens`;
    grid.appendChild(cell);
  }
}

// ── Peak Hours ─────────────────────────────────────────────────────────────
function renderPeakHours(hourly) {
  const canvas = document.getElementById('chart-peak-hours');
  if (!canvas || !hourly) return;
  if (charts['chart-peak-hours']) charts['chart-peak-hours'].destroy();

  const maxH = Math.max(...hourly, 1);
  charts['chart-peak-hours'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: hourly.map((_, i) => i % 6 === 0 ? `${i}h` : ''),
      datasets: [{
        data: hourly,
        backgroundColor: hourly.map(v => `rgba(232,101,10,${(0.15 + (v / maxH) * 0.75).toFixed(2)})`),
        borderRadius: 2, borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e1e', borderColor: '#3d3d3d', borderWidth: 1,
          titleFont: { family: "'Space Mono', monospace", size: 9 },
          bodyFont:  { family: "'Space Mono', monospace", size: 10 },
          callbacks: {
            title: ctx => `${ctx[0].dataIndex}h às ${ctx[0].dataIndex + 1}h`,
            label: ctx => ` ${fmtTokens(ctx.raw)} tokens`,
          },
        },
      },
      scales: {
        x: { grid: { color: '#2e2e2e' }, ticks: { color: '#525252', font: { family: "'Space Mono', monospace", size: 9 } } },
        y: { grid: { color: '#2e2e2e' }, ticks: { color: '#525252', font: { family: "'Space Mono', monospace", size: 9 }, callback: v => fmtTokens(v) } },
      },
    },
  });
}

// ── Sparkline ──────────────────────────────────────────────────────────────
function drawSparkline(canvas, data) {
  if (!canvas || !data || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);

  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = i * step;
    const y = h - (data[i] / max) * h * 0.88 - 1;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(232,101,10,0.8)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo((data.length - 1) * step, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(232,101,10,0.12)';
  ctx.fill();
}

// ── Cost Alert ─────────────────────────────────────────────────────────────
function checkCostAlert(data) {
  if (!currentSettings) return;
  const threshold = parseFloat(currentSettings.dailyCostAlert) || 0;
  if (threshold <= 0) return;
  const daily = data.claude?.daily || [];
  if (!daily.length) return;
  const todayEntry = daily[daily.length - 1];
  const todayCost = todayEntry?.estimatedCostUSD || 0;
  if (todayCost >= threshold && alertFiredForDate !== todayEntry.date) {
    alertFiredForDate = todayEntry.date;
    showToast(`Alerta de custo diário: ${fmtCost(todayCost)} (limite: US$ ${threshold})`);
    tm.showNotification?.('Alerta do Rendra IDE',
      `O custo de hoje no Claude, ${fmtCost(todayCost)}, passou do limite de US$ ${threshold}`);
  }
}

// ── Render Claude Detail ───────────────────────────────────────────────────
function renderClaude(data) {
  const cl = data.claude;
  if (!cl) return;

  document.getElementById('cl-header-sub').textContent =
    `${cl.totalSessions || 0} sessões · ${fmtCost(cl.estimatedCostUSD)} estimado · ${periodLabel(cl.filters?.days || 90)}`;
  renderFilters(cl);

  // Last active session card
  const sessions = cl.recentSessions || [];
  const lastActiveCard = document.getElementById('cl-last-active');
  if (sessions.length > 0) {
    const s = sessions[0];
    document.getElementById('cl-last-project').textContent = s.project;
    document.getElementById('cl-last-time').textContent    = fmtRelTime(s.mtime);
    document.getElementById('cl-last-tokens').textContent  = fmtTokens(s.totalTokens) + ' tokens';
    document.getElementById('cl-last-model').textContent   = s.model.length > 30 ? s.model.slice(0, 28) + '…' : s.model;
    lastActiveCard.style.display = 'flex';
  } else {
    lastActiveCard.style.display = 'none';
  }

  // Insight cards
  document.getElementById('cl-cache-savings-total').textContent = fmtCost(cl.cacheSavingsUSD || 0);
  document.getElementById('cl-cost-projection').textContent     = fmtCost(cl.costProjection30d || 0);

  // Usage summary
  document.getElementById('cl-input').textContent       = fmtTokens(cl.totalInputTokens);
  document.getElementById('cl-output').textContent      = fmtTokens(cl.totalOutputTokens);
  document.getElementById('cl-cache-read').textContent  = fmtTokens(cl.totalCacheReadTokens);
  document.getElementById('cl-cache-write').textContent = fmtTokens(cl.totalCacheWriteTokens);
  document.getElementById('cl-cache-savings').textContent =
    `economia de ${fmtCost(cl.cacheSavingsUSD || 0)} vs. sem cache`;

  // Daily chart
  const daily = cl.daily || [];
  makeBarChart('chart-claude-daily', dailyLabels(daily), [
    { label: 'Entrada',  data: daily.map(d => d.inputTokens),  backgroundColor: 'rgba(212,162,122,0.5)',  borderRadius: 3, borderSkipped: false },
    { label: 'Saída', data: daily.map(d => d.outputTokens), backgroundColor: 'rgba(212,162,122,0.85)', borderRadius: 3, borderSkipped: false },
  ]);

  // Heatmap and peak hours
  renderHeatmap(cl.heatmap);
  renderPeakHours(cl.hourly);

  // Model breakdown table
  const modelBreakdown = cl.modelBreakdown || {};
  const totalClTokens = cl.totalTokens || 1;
  const tbody = document.getElementById('cl-model-tbody');
  tbody.innerHTML = '';
  const models = Object.entries(modelBreakdown).sort((a, b) =>
    (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens)
  );
  for (const [model, stats] of models) {
    const tokens = stats.inputTokens + stats.outputTokens;
    const share = pct(tokens, totalClTokens);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${model}">
        ${escapeHtml(model.length > 28 ? model.slice(0, 26) + '…' : model)}
      </td>
      <td class="mono dim">${fmtTokens(tokens)}</td>
      <td class="mono dim">${fmtCost(stats.estimatedCostUSD)}</td>
      <td>
        <div class="table-bar-track">
          <div class="table-bar-fill claude" style="width:${share}%"></div>
        </div>
        <span style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono)">${share.toFixed(1)}%</span>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Project breakdown table with sparklines
  const projects = cl.projectBreakdown || [];
  const ptbody = document.getElementById('cl-project-tbody');
  ptbody.innerHTML = '';
  for (const proj of projects) {
    const share = pct(proj.totalTokens, totalClTokens);
    const tr = document.createElement('tr');
    const canvasId = `spark-${proj.name.replace(/\W/g, '_')}`;
    tr.innerHTML = `
      <td class="mono">${proj.name}</td>
      <td class="mono dim">${proj.sessionCount}</td>
      <td class="mono dim">${fmtTokens(proj.totalTokens)}</td>
      <td class="mono dim">${fmtCost(proj.estimatedCostUSD)}</td>
      <td><canvas id="${canvasId}" class="sparkline-canvas" width="58" height="20"></canvas></td>
      <td>
        <div class="table-bar-track">
          <div class="table-bar-fill claude" style="width:${share}%"></div>
        </div>
        <span style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono)">${share.toFixed(1)}%</span>
      </td>
    `;
    ptbody.appendChild(tr);
    if (proj.sparkline) {
      drawSparkline(document.getElementById(canvasId), proj.sparkline);
    }
  }

  // Recent sessions
  const sessionsList = document.getElementById('cl-sessions-list');
  sessionsList.innerHTML = '';
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session-item';
    div.innerHTML = `
      <div class="session-project">${s.project}</div>
      <div class="session-time">${fmtRelTime(s.mtime)}</div>
      <div class="session-tokens">${fmtTokens(s.totalTokens)}</div>
      <div class="session-model">${s.model}</div>
    `;
    sessionsList.appendChild(div);
  }
}


// ── Render All ─────────────────────────────────────────────────────────────
// ── App updates ────────────────────────────────────────────────────────────
// git clones (how Rendra IDE is distributed): quando há versão nova aparece o botão verde "Nova
// versão" no rodapé da barra lateral; o clique pergunta e roda o fluxo existente (fecha o app, git
// pull + npm install e reabre). Packaged builds: o mesmo botão ("Reiniciar e atualizar" ao baixar) e
// o progresso do download na barra de status. A primeira abertura numa versão nova mostra o modal
// de Novidades, que só fecha pelo botão (renderer/novidades.js).
let updateInfo = null;
function renderUpdate(s) {
  updateInfo = s;
  const btn = document.getElementById('nav-update');
  const el = document.getElementById('update-status');
  const ui = RendraUpdateUi.updateUi(s);
  btn.hidden = !ui.mostrarBotao;
  if (ui.mostrarBotao) btn.title = ui.titulo;
  el.hidden = !ui.mostrarStatus;
  if (ui.mostrarStatus) el.textContent = ui.textoStatus;
}

async function installUpdate() {
  const s = updateInfo || {};
  if (RendraUpdateUi.precisaConfirmar(s)) {
    const notes = s.notes ? '\n\nNovidades:\n' + s.notes.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').slice(0, 700) : '';
    const warn = s.localChanges ? '\n\nAtenção: há alterações locais nos arquivos do Rendra IDE. Se elas conflitarem com a versão nova, a atualização é cancelada e nada é perdido.' : '';
    if (!confirm(`Atualizar o Rendra IDE para a versão ${s.version}?\n\nO app fecha (arquivos editados podem ser salvos antes), baixa a versão nova com git pull e npm install e abre de novo. Configurações, workspaces e preços não mudam.${warn}${notes}`)) return;
  }
  const res = await tm.update.install();
  if (res && res.ok === false) showToast(res.error);
}

const VERSAO_VISTA = 'app.lastSeenVersion';
async function initUpdates() {
  document.getElementById('nav-update').addEventListener('click', installUpdate);
  tm.update.onStatus(renderUpdate);
  renderUpdate(await tm.update.status());
  const last = await tm.update.lastResult?.();
  if (last && !last.ok) setTimeout(() => showToast(`Não foi possível atualizar: ${last.error}`), 1500);
  const version = await tm.appVersion();
  let seen = null;
  try { seen = localStorage.getItem(VERSAO_VISTA); } catch { /* ignore */ }
  const gravar = () => { try { localStorage.setItem(VERSAO_VISTA, version); } catch { /* ignore */ } };
  if (RendraNovidades.deveAbrir(seen, version)) {
    // about.js carrega depois deste arquivo: espera todos os scripts antes de montar as notas
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    // A versão só vira "vista" no clique em Fechar: sem ler, o modal volta na próxima abertura
    RendraNovidades.abrir({ versao: version, html: await window.changelogPage.notasHtml(version), aoFechar: gravar });
  } else if (!seen) {
    gravar(); // instalação nova: nada a mostrar, só lembra a versão
  }
}

// ── Codex CLI (OpenAI) ─────────────────────────────────────────────────────
function codexWindowName(w) {
  if (w.windowMinutes === 300) return 'Limite de 5 horas';
  if (w.windowMinutes === 10080) return 'Semanal';
  if (!w.windowMinutes) return 'Limite';
  return w.windowMinutes >= 1440 ? `Janela de ${Math.round(w.windowMinutes / 1440)} dias` : `Janela de ${Math.round(w.windowMinutes / 60)} h`;
}

// Codex costs are tokens x per-token price: credits, or US$ once a credit value is set in Preços
function fmtCodexCost(v, unit) {
  if (unit === 'USD') return fmtCost(v);
  return '~' + (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' créditos';
}

function renderCodex(data) {
  const cx = data.codex || { available: false };
  const on = !!cx.available;
  const status = document.getElementById('cx-status');
  status.textContent = on ? 'Conectado' : 'Não conectado';
  status.classList.toggle('on', on);
  document.getElementById('cx-missing').style.display = on ? 'none' : '';
  document.getElementById('cx-body').style.display = on ? '' : 'none';
  if (cx.home) document.getElementById('cx-home').textContent = `${cx.home}${window.rendra.platform === 'win32' ? '\\' : '/'}sessions`;
  document.getElementById('cx-header-sub').textContent = on
    ? `${cx.totalSessions} sessões · ${fmtCodexCost(cx.estimatedCostUSD, cx.costUnit)} estimado · 90 dias` : 'Codex CLI da OpenAI';
  if (!on) return;

  document.getElementById('cx-cost').textContent      = fmtCodexCost(cx.estimatedCostUSD, cx.costUnit);
  document.getElementById('cx-sessions').textContent  = cx.totalSessions;
  document.getElementById('cx-input').textContent     = fmtTokens(cx.totalInputTokens);
  document.getElementById('cx-cached').textContent    = fmtTokens(cx.totalCachedInputTokens);
  document.getElementById('cx-output').textContent    = fmtTokens(cx.totalOutputTokens);
  document.getElementById('cx-reasoning').textContent = fmtTokens(cx.totalReasoningTokens);

  // latest rate-limit snapshot Codex recorded (it arrives with each token_count event)
  const lim = cx.limits;
  const rows = lim ? [lim.primary, lim.secondary].filter(Boolean)
    .map(w => ({ kind: 'codex', label: codexWindowName(w), percent: Math.round(w.percent), resetsAt: w.resetsAt })) : [];
  document.getElementById('cx-limits-list').innerHTML = rows.length
    ? limitRowsHtml(rows) : '<div class="limits-empty">O Codex ainda não informou limites de uso</div>';
  document.getElementById('cx-limits-at').textContent = lim?.at
    ? `lido às ${fmtTimestamp(lim.at)}` : '';

  makeBarChart('chart-codex-daily', cx.daily.map(d => d.label), [
    { label: 'Entrada', data: cx.daily.map(d => d.inputTokens), backgroundColor: 'rgba(212,162,122,0.5)', borderRadius: 3, borderSkipped: false },
    { label: 'Saída', data: cx.daily.map(d => d.outputTokens), backgroundColor: 'rgba(212,162,122,0.85)', borderRadius: 3, borderSkipped: false },
  ]);

  document.getElementById('cx-model-tbody').innerHTML = Object.entries(cx.modelBreakdown)
    .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))
    .map(([m, s]) => `<tr><td class="mono">${escapeHtml(m)}</td><td class="mono dim">${fmtTokens(s.inputTokens + s.outputTokens)}</td><td class="mono dim">${fmtCodexCost(s.estimatedCostUSD, cx.costUnit)}</td></tr>`).join('');
  document.getElementById('cx-project-tbody').innerHTML = cx.projectBreakdown
    .map(p => `<tr><td class="mono">${escapeHtml(p.name)}</td><td class="mono dim">${p.sessionCount}</td><td class="mono dim">${fmtTokens(p.totalTokens)}</td><td class="mono dim">${fmtCodexCost(p.estimatedCostUSD, cx.costUnit)}</td></tr>`).join('');
  document.getElementById('cx-sessions-list').innerHTML = cx.recentSessions.map(s => `
    <div class="session-item">
      <div class="session-project">${escapeHtml(s.project)}</div>
      <div class="session-time">${fmtRelTime(s.mtime)}</div>
      <div class="session-tokens">${fmtTokens(s.totalTokens)}</div>
      <div class="session-model">${escapeHtml(s.model)}</div>
    </div>`).join('');
}

function render(data) {
  usageData = data;
  renderClaude(data);
  renderCodex(data);
  checkCostAlert(data);

  const ts = new Date(data.timestamp);
  document.getElementById('last-updated').textContent =
    `Atualizado às ${fmtTimestamp(ts)}`;

  const total = data.claude?.totalTokens || 0;
  const cost  = data.claude?.estimatedCostUSD || 0;
  updateStatus(`* ${fmtTokens(total)} tokens · ${fmtCost(cost)}`);
}

// ── Settings ───────────────────────────────────────────────────────────────
async function openSettings() {
  const settings = await tm.getSettings();
  document.getElementById('s-refresh').value      = settings.refreshInterval || 60;
  document.getElementById('s-claude-path').value  = settings.claudePath || '';
  document.getElementById('s-cost-alert').value   = settings.dailyCostAlert || 0;
  document.getElementById('s-limits-source').value = settings.limitsSource || 'statusline';
  document.getElementById('s-conpty').checked = window.RendraConptyUi.conptyMarcado(settings);
  document.getElementById('settings-overlay').classList.add('visible');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('visible');
}

async function saveSettings() {
  const settings = {
    refreshInterval: parseInt(document.getElementById('s-refresh').value),
    claudePath:      document.getElementById('s-claude-path').value.trim(),
    dailyCostAlert:  parseFloat(document.getElementById('s-cost-alert').value) || 0,
    limitsSource:    document.getElementById('s-limits-source').value,
    conptyDll:       document.getElementById('s-conpty').checked,
  };
  await tm.saveSettings(settings);
  currentSettings = settings;
  closeSettings();
  await refresh();
}

// ── Refresh ─────────────────────────────────────────────────────────────────
async function refresh() {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  updateStatus('* Lendo sessões…');
  atualizarBarraConsumo(); // the scan below takes seconds; the bar does not wait for it
  try {
    const data = await tm.getUsageData();
    if (data) render(data);
    if (rtkLoaded) await loadRtk();
    await loadAccount();
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Navigation (bottom nav + any data-page buttons)
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  // Title bar controls
  document.getElementById('btn-close').addEventListener('click', () => tm.windowClose());
  document.getElementById('btn-minimize').addEventListener('click', () => tm.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => tm.windowMaximize());
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  initFilters();
  initUpdates();

  // Title-bar consumption bar: the remembered provider + environment (written only when the user
  // changes the selector), the selector itself and the width rule
  try { provLembrada = (await tm.getSettings())?.provedorBarra || null; } catch { /* usa o padrão */ }
  document.getElementById('consumo-provedor').addEventListener('change', e => escolherProvedorBarra(e.target.value));
  new ResizeObserver(() => ajustarBarraConsumo()).observe(document.getElementById('title-bar'));

  // Account card + plan limits: now and every 5 minutes (the usage endpoint is rate limited)
  loadAccount();
  setInterval(loadAccount, 5 * 60000);
  atualizarBarraConsumo();
  setInterval(atualizarBarraConsumo, 60000);
  document.getElementById('limits-refresh').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '↻ Buscando…';
    try { await loadAccount(); } finally {
      btn.disabled = false;
      btn.textContent = '↻ Atualizar';
    }
  });

  // RTK command buttons
  document.querySelectorAll('.rtk-btn').forEach(btn => {
    btn.addEventListener('click', () => runRtkCommand(btn));
  });
  document.getElementById('rtk-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('rtk-term-out').textContent)
      .then(() => showToast('Saída copiada'));
  });
  // Install/update RTK and enable an agent per system: one delegated listener for the row buttons
  document.getElementById('page-rtk').addEventListener('click', e => {
    const btn = e.target.closest('[data-rtk-action]');
    if (btn && !btn.disabled) runRtkAction(btn);
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('s-cancel').addEventListener('click', closeSettings);
  document.getElementById('s-save').addEventListener('click', saveSettings);
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-overlay')) closeSettings();
  });

  document.addEventListener('keydown', e => {
    // In DevCode, Ctrl+R belongs to the terminal (history search) and the editor
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !document.body.classList.contains('dev-mode')) { e.preventDefault(); refresh(); }
  });

  // Push updates from main process
  tm.onUsageUpdated(data => { render(data); });

  // Load settings
  try {
    const settings = await tm.getSettings();
    currentSettings = settings;
  } catch { /* use default */ }

  // Initial data load. The app opens on DevCode, which doesn't need usage data, so the
  // multi-second first scan runs in the background instead of behind the loading overlay
  updateStatus('* Lendo sessões…');
  const loadingOverlay = document.getElementById('loading-overlay');
  loadingOverlay.classList.add('hidden');
  setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
  const data = await tm.getUsageData();
  if (data) render(data);
}

init();

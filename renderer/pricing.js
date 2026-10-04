/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// "Preços" page: per-token prices used by every cost in the app.
//   Claude Code → US$ per 1M tokens (input, output, 5-min / 1-hour cache writes, cache reads,
//                 fast mode), from platform.claude.com/docs/pt-BR/about-claude/pricing
//   Codex       → credits per 1M tokens (input, cached input, output), from
//                 learn.chatgpt.com/docs/pricing; an optional US$-per-credit value converts to US$
// New prices come from pricing.json in the Rendra IDE GitHub repo (checked when the app opens,
// maintained with `npm run prices:update`); the table also stays editable by hand.
// Saving writes the user's table and recalculates all costs.

(() => {
  const api = window.rendra.pricing;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = m => (typeof showToast === 'function' ? showToast(m) : console.log(m));

  const COLUMNS = {
    claude: [
      { key: 'input', label: 'Entrada' },
      { key: 'output', label: 'Saída' },
      { key: 'cacheWrite', label: 'Escrita cache 5 min' },
      { key: 'cacheWrite1h', label: 'Escrita cache 1 h' },
      { key: 'cacheRead', label: 'Leitura cache' },
      { key: 'fastInput', label: 'Rápido entrada', optional: true },
      { key: 'fastOutput', label: 'Rápido saída', optional: true },
    ],
    codex: [
      { key: 'input', label: 'Entrada' },
      { key: 'cachedInput', label: 'Entrada em cache' },
      { key: 'output', label: 'Saída' },
    ],
  };

  let data = null;       // what's saved
  let draft = null;      // what's on screen
  let which = 'claude';
  let dirty = false;

  const clone = o => JSON.parse(JSON.stringify(o));

  function setDirty(v) {
    dirty = v;
    $('price-save').disabled = !v;
    $('price-save').textContent = v ? 'Salvar' : 'Salvo';
  }

  function render() {
    document.querySelectorAll('.price-tab[data-which]').forEach(b => b.classList.toggle('active', b.dataset.which === which));
    const unit = which === 'claude' ? 'US$ por 1M de tokens' : 'créditos por 1M de tokens';
    const updated = draft.updatedAt?.[which];
    $('price-source').innerHTML =
      `Fonte: <a href="#" data-url="${esc(draft.sources[which])}">${esc(draft.sources[which].replace(/^https:\/\//, ''))}</a>` +
      ` · ${unit}${updated ? ` · atualizado em ${esc(updated.split('-').reverse().join('/'))}` : ''}` +
      `${draft.custom ? ' · <b>valores personalizados</b>' : ''}`;

    $('price-extra').innerHTML = which === 'claude'
      ? `<label class="price-field">Busca web (server tool) · US$ por 1.000 buscas
           <input type="number" min="0" step="any" data-extra="webSearchPer1k" value="${esc(draft.webSearchPer1k ?? 10)}"></label>`
      : `<label class="price-field">Valor de 1 crédito em US$ <span class="price-hint">(opcional: sem ele, o custo do Codex aparece em créditos)</span>
           <input type="number" min="0" step="any" placeholder="ex.: 0,04" data-extra="codexCreditUsd" value="${esc(draft.codexCreditUsd ?? '')}"></label>`;

    const cols = COLUMNS[which];
    const rows = draft[which] || [];
    $('price-table').innerHTML = `
      <thead><tr>
        <th>Modelo</th><th title="O custo usa a linha cujo padrão aparece no ID do modelo (o mais específico vence)">Padrão no ID</th>
        ${cols.map(c => `<th>${c.label}</th>`).join('')}<th></th>
      </tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr data-i="${i}">
          <td><input class="price-text" data-k="label" value="${esc(r.label)}"></td>
          <td><input class="price-text mono" data-k="pattern" value="${esc(r.pattern)}" ${r.pattern === 'default' ? 'disabled title="Usado para modelos sem linha própria"' : ''}></td>
          ${cols.map(c => `<td><input class="price-num" type="number" min="0" step="any" data-k="${c.key}" value="${r[c.key] ?? ''}" ${c.optional ? 'placeholder="—"' : ''}></td>`).join('')}
          <td>${r.pattern === 'default' ? '' : '<button class="dev-icon-btn" data-del title="Remover">✕</button>'}</td>
        </tr>`).join('')}</tbody>`;

    $('price-help').innerHTML = which === 'claude'
      ? 'Cada resposta do Claude Code é cobrada por token: entrada, saída (inclui o raciocínio), leitura de cache e escrita de cache, separando a de 5 minutos (1,25× a entrada) da de 1 hora (2× a entrada), que o Claude Code registra em cada mensagem. No modo rápido valem as colunas "Rápido". Vale a linha cujo <b>padrão</b> aparece no ID do modelo; a mais específica vence (claude-opus-5-5 antes de claude-opus-5).'
      : 'O Codex registra entrada, entrada em cache (parte da entrada, cobrada mais barata), saída e raciocínio (parte da saída). O custo é tokens × créditos por token desta tabela; informe o valor do crédito para ver em US$. Vale a linha cujo <b>padrão</b> aparece no ID do modelo.';
  }

  async function open() {
    data = await api.get();
    draft = clone(data);
    setDirty(false);
    render();
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  $('price-table').addEventListener('input', e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const row = draft[which][+tr.dataset.i];
    const k = e.target.dataset.k;
    if (e.target.type === 'number') {
      if (e.target.value === '') delete row[k];
      else row[k] = parseFloat(e.target.value);
    } else row[k] = e.target.value;
    setDirty(true);
  });
  $('price-extra').addEventListener('input', e => {
    const k = e.target.dataset.extra;
    if (!k) return;
    draft[k] = e.target.value === '' ? null : parseFloat(e.target.value);
    setDirty(true);
  });
  $('price-table').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    draft[which].splice(+del.closest('tr').dataset.i, 1);
    setDirty(true);
    render();
  });
  $('price-source').addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); window.rendra.openExternal(a.dataset.url); }
  });
  $('price-add').addEventListener('click', () => {
    const row = which === 'claude'
      ? { label: 'Novo modelo', pattern: 'claude-', input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 }
      : { label: 'Novo modelo', pattern: 'gpt-', input: 0, cachedInput: 0, output: 0 };
    const i = draft[which].findIndex(r => r.pattern === 'default');
    draft[which].splice(i < 0 ? draft[which].length : i, 0, row);
    setDirty(true);
    render();
  });

  document.querySelectorAll('.price-tab[data-which]').forEach(b => b.addEventListener('click', () => {
    which = b.dataset.which;
    render();
  }));

  // ── Actions ────────────────────────────────────────────────────────────────
  const busy = (btn, label, fn) => async () => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; if (btn.id === 'price-save') setDirty(dirty); }
  };

  $('price-save').addEventListener('click', busy($('price-save'), 'Salvando…', async () => {
    const bad = draft[which].find(r => !r.pattern || COLUMNS[which].some(c => !c.optional && !(r[c.key] >= 0)));
    if (bad) { toast(`Preencha todos os preços de "${bad.label || bad.pattern}"`); return; }
    data = await api.save({ claude: draft.claude, codex: draft.codex, codexCreditUsd: draft.codexCreditUsd, webSearchPer1k: draft.webSearchPer1k });
    draft = clone(data);
    setDirty(false);
    render();
    toast('Preços salvos · custos recalculados');
  }));

  // ── Price updates published by Rendra IDE (pricing.json in its GitHub repo) ─
  const fmtDate = d => (d ? d.split('-').reverse().join('/') : '—');
  function showFeedBanner(check) {
    const banner = $('price-banner');
    if (!check?.newer?.length) { banner.hidden = true; return; }
    const names = check.newer.map(w => (w === 'claude' ? 'Claude Code' : 'Codex')).join(' e ');
    $('price-banner-text').textContent = `Novos preços disponíveis para ${names} (tabela de ${fmtDate(check.remote[check.newer[0]])}).`;
    banner.hidden = false;
  }

  async function checkFeed({ quiet } = {}) {
    const res = await api.checkFeed();
    showFeedBanner(res);
    if (quiet) return res;
    if (!res.configured) toast('A atualização de preços ainda não está configurada nesta versão');
    else if (res.error) toast(`Não foi possível verificar os preços (${res.error})`);
    else if (!res.newer.length) toast('Os preços já estão atualizados');
    return res;
  }

  $('price-fetch').addEventListener('click', busy($('price-fetch'), 'Verificando…', () => checkFeed()));

  $('price-apply').addEventListener('click', busy($('price-apply'), 'Aplicando…', async () => {
    if (data.custom && !confirm('Você tem preços editados manualmente. Aplicar a tabela nova vai substituí-los. Continuar?')) return;
    const res = await api.applyFeed();
    data = res.pricing;
    draft = clone(data);
    setDirty(false);
    render();
    $('price-banner').hidden = res.ok;
    toast(res.ok ? 'Preços atualizados · custos recalculados' : `Não foi possível aplicar (${res.error})`);
  }));

  // checked every time the app opens; a toast points to this page when there's news
  setTimeout(async () => {
    const res = await checkFeed({ quiet: true });
    if (res?.newer?.length) toast('Novos preços disponíveis · veja a página Preços');
  }, 6000);

  $('price-reset').addEventListener('click', busy($('price-reset'), 'Restaurando…', async () => {
    if (!confirm('Voltar para os preços padrão do Rendra IDE? Seus valores personalizados serão apagados.')) return;
    data = await api.reset();
    draft = clone(data);
    setDirty(false);
    render();
    toast('Preços padrão restaurados · custos recalculados');
  }));

  window.pricingPage = { open };
})();

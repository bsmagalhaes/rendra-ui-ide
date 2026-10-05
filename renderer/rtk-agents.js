/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Página RTK: soma pura da economia por agente (Claude Code e Codex) entre os sistemas
// (Windows, Linux, distros WSL). Carregado no renderer (window.RendraRtkAgents) e nos testes
// (require). Sem DOM: recebe `environments` de `rtk-status` e devolve números, textos e HTML.
(function (root) {
  const AGENTS = ['claude', 'codex'];
  const num = v => (Number.isFinite(+v) ? +v : 0);
  const fmtInt = n => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // pct do RTK: saved / input * 100, 0 quando input é 0 (nunca média de médias)
  const pctOf = (saved, input) => (input > 0 ? (saved / input) * 100 : 0);

  const emptyTotal = () => ({ commands: 0, input: 0, output: 0, saved: 0, pct: 0, timeMs: 0, avgTimeMs: 0 });
  function finish(t) {
    t.pct = pctOf(t.saved, t.input);
    t.avgTimeMs = t.commands > 0 ? t.timeMs / t.commands : 0;
    return t;
  }

  function aggregateAgent(environments, agent) {
    const total = emptyTotal();
    const byDate = new Map();
    const perEnvironment = [];
    for (const e of environments || []) {
      const entry = { id: e.id, label: e.label, state: e.state, saved: 0, commands: 0, error: null };
      const a = e.state === 'ok' ? e.agents?.[agent] : null;
      if (a && a.error) entry.error = a.error;
      else if (a) {
        const s = a.gain?.summary || {};
        total.commands += num(s.total_commands);
        total.input += num(s.total_input);
        total.output += num(s.total_output);
        total.saved += num(s.total_saved);
        total.timeMs += num(s.total_time_ms);
        entry.saved = num(s.total_saved);
        entry.commands = num(s.total_commands);
        for (const d of a.gain?.daily || []) {
          const cur = byDate.get(d.date) || { date: d.date, saved: 0, commands: 0 };
          cur.saved += num(d.saved_tokens);
          cur.commands += num(d.commands);
          byDate.set(d.date, cur);
        }
      }
      perEnvironment.push(entry);
    }
    const daily = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return { total: finish(total), daily, perEnvironment };
  }

  function aggregateAgents(environments) {
    return Object.fromEntries(AGENTS.map(a => [a, aggregateAgent(environments, a)]));
  }

  // Cartões do topo: os dois agentes somados
  function combinedTotals(agents) {
    const t = emptyTotal();
    for (const a of AGENTS) {
      const x = agents[a].total;
      t.commands += x.commands; t.input += x.input; t.output += x.output; t.saved += x.saved; t.timeMs += x.timeMs;
    }
    return finish(t);
  }

  // Linhas do hover: uma por sistema
  function tooltipLines(agg) {
    return agg.perEnvironment.map(e => {
      if (e.state === 'wsl-off') return `${e.label}: WSL desligado`;
      if (e.state === 'missing') return `${e.label}: RTK ausente`;
      if (e.state !== 'ok' || e.error) return `${e.label}: erro ao ler`;
      return `${e.label}: ${fmtInt(e.saved)} tokens, ${fmtInt(e.commands)} comandos`;
    });
  }

  // Gráfico diário: união das datas, um vetor por agente (0 onde o agente não tem o dia)
  function chartSeries(agents) {
    const dates = [...new Set(AGENTS.flatMap(a => agents[a].daily.map(d => d.date)))].sort();
    const col = a => dates.map(d => agents[a].daily.find(x => x.date === d)?.saved || 0);
    return { labels: dates, claude: col('claude'), codex: col('codex') };
  }

  // ── Visão por agente: linhas por sistema, avisos e HTML (sem DOM) ───────────
  const NL = String.fromCharCode(10);
  const AGENT_NAME = { claude: 'Claude Code', codex: 'Codex' };
  // O Codex só relê o config.toml ao reiniciar: o texto de sucesso mantém o pedido de reinício
  const PRONTO_CODEX = 'Pronto, o Codex já pode usar o RTK. Se o Codex estiver aberto, feche e abra de novo.';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function rowOf(e, agent) {
    const base = { envId: e.id, label: e.label, action: null };
    const name = AGENT_NAME[agent];
    if (e.state === 'wsl-off') return { ...base, tone: 'off', text: 'WSL desligado' };
    if (e.state === 'missing') return { ...base, tone: 'warn', text: 'RTK ausente', action: { kind: 'install', label: 'Instalar RTK' } };
    if (e.state !== 'ok') return { ...base, tone: 'warn', text: 'erro ao ler' };
    if (e.needsUpdate) return { ...base, tone: 'warn', text: `RTK ${e.version} desatualizado`, action: { kind: 'install', label: 'Atualizar RTK' } };
    const a = e.agents && e.agents[agent];
    if (!a || !a.installed) return { ...base, tone: 'off', text: `${name} não instalado` };
    if (a.error) return { ...base, tone: 'warn', text: 'erro ao ler o banco' };
    if (!a.hook) return { ...base, tone: 'off', text: 'RTK não ativado', action: { kind: 'enable', label: 'Ativar' } };
    if (!a.hookAbsolute || !a.dbEnvConfigured) return { ...base, tone: 'warn', text: 'ativação incompleta', action: { kind: 'enable', label: 'Concluir ativação' } };
    return { ...base, tone: 'ok', text: 'RTK ativo' };
  }

  function agentView(environments, agent) {
    const envs = environments || [];
    const rows = envs.map(e => rowOf(e, agent));
    const warnings = [];
    for (const e of envs) {
      const a = e.state === 'ok' && e.agents && e.agents[agent];
      if (agent !== 'codex' || !a || !a.hook) continue;
      if (a.trust === 'modified' || a.trust === 'untrusted') warnings.push({ kind: 'trust', env: e.label, text: `${e.label}: ${a.trustMessage}` });
    }
    const active = rows.filter(r => r.tone === 'ok').length;
    const state = !rows.length ? '—' : active === rows.length ? 'RTK ativo'
      : active === 0 ? 'RTK não ativado' : `RTK ativo em ${active} de ${rows.length} sistemas`;
    return { agent, name: AGENT_NAME[agent], rows, warnings, state, allActive: rows.length > 0 && active === rows.length };
  }

  // Avisos do host que não são de um agente (cópia do WinGet defasada)
  function globalWarnings(environments) {
    return (environments || []).flatMap(e => (e.warnings || []).map(w => ({ kind: w.kind, text: w.text })));
  }

  function rowsHtml(view) {
    return view.rows.map(r => `<div class="rtk-env-row" data-env="${esc(r.envId)}">`
      + `<span class="rtk-env-label">${esc(r.label)}</span>`
      + `<span class="rtk-env-state ${r.tone}">${esc(r.text)}</span>`
      + (r.action ? `<button class="btn btn-primary rtk-act" type="button" data-rtk-action="${r.action.kind}" data-env="${esc(r.envId)}" data-agent="${view.agent}">${esc(r.action.label)}</button>` : '')
      + '</div>').join('');
  }

  function warningsHtml(list) {
    return list.map(w => `<div class="rtk-warn ${esc(w.kind)}">${esc(w.text)}</div>`).join('');
  }

  // Confirmação antes de ativar: todos os arquivos que serão tocados (correção 6)
  function confirmText(agent, envLabel, files) {
    const lista = (files || []).map(f => `- ${f}`).join(NL);
    const extra = agent === 'codex'
      ? 'Também registra no config.toml o banco do RTK para o Codex (RTK_DB_PATH) e a sua aprovação do hook do RTK, para o Codex não precisar perguntar (o que já existe nele não é mexido).'
      : 'Também define env.RTK_DB_PATH no settings.json.';
    return [
      `Ativar o RTK no ${AGENT_NAME[agent]} em ${envLabel}?`, '',
      'A IDE vai rodar "rtk init -g" e mexer nestes arquivos (os que já existem ganham uma cópia de segurança ao lado):',
      lista, '',
      `Depois troca o comando do hook por um com caminho absoluto. ${extra}`,
    ].join(NL);
  }

  // Texto mostrado no terminal da página depois de ativar
  function resultText(res, agent, envLabel) {
    if (!res || !res.ok) {
      const dica = res && res.needsUpdate ? `${NL}Use o botão Atualizar RTK deste sistema.`
        : res && res.needsInstall ? `${NL}Use o botão Instalar RTK deste sistema.` : '';
      const linhas = [`Não foi possível ativar o RTK no ${AGENT_NAME[agent]} em ${envLabel}: ${res && res.error ? res.error : 'sem resposta'}${dica}`];
      const rb = res && res.rolledBack ? Object.entries(res.rolledBack) : [];
      const voltou = rb.filter(([, ok]) => ok).map(([f]) => f);
      const ficou = rb.filter(([, ok]) => !ok).map(([f]) => f);
      if (voltou.length) linhas.push('', 'Desfeito (voltaram ao que eram):', ...voltou.map(f => `- ${f}`));
      if (ficou.length) linhas.push('', 'Não restaurados (outra sessão mexeu neles depois):', ...ficou.map(f => `- ${f}`));
      if (res && res.backups && res.backups.length) linhas.push('', 'Cópias de segurança que ficaram:', ...res.backups.map(f => `- ${f}`));
      return linhas.join(NL);
    }
    const linhas = [`RTK ativado no ${AGENT_NAME[agent]} em ${envLabel}.`, ''];
    for (const c of res.changes || []) {
      linhas.push(`- ${c.file} (${c.kind === 'created' ? 'criado' : 'alterado'})${c.backup ? `${NL}  cópia de segurança: ${c.backup}` : ''}`);
      if (c.added) linhas.push(c.added.split(NL).map(l => `    + ${l}`).join(NL));
    }
    if (!(res.changes || []).length) linhas.push('Nenhum arquivo precisou mudar.');
    for (const n of res.notes || []) linhas.push('', n);
    if (res.trustMessage) linhas.push('', res.trustMessage);
    else if (agent === 'codex' && res.trust === 'trusted') linhas.push('', PRONTO_CODEX);
    return linhas.join(NL);
  }

  // Texto mostrado no terminal da página depois de instalar ou atualizar o RTK num sistema
  function installText(res, envLabel) {
    if (!res || !res.ok) {
      const wsl = res && res.state === 'wsl-off' ? `${NL}A IDE não acorda distros; abra a distro e tente de novo.` : '';
      return `Não foi possível instalar o RTK em ${envLabel}: ${res && res.error ? res.error : 'sem resposta'}${wsl}`;
    }
    const linhas = [res.upToDate ? `O RTK de ${envLabel} já está na versão ${res.version}.` : `RTK ${res.version} instalado em ${envLabel}: ${res.rtk}`];
    if (res.pathEdited) linhas.push('O ~/.profile da distro recebeu o PATH do RTK; abra um terminal novo.');
    for (const w of res.warnings || []) linhas.push('', w.text);
    return linhas.join(NL);
  }

  const api = {
    aggregateAgents, combinedTotals, tooltipLines, chartSeries, fmtInt,
    agentView, globalWarnings, rowsHtml, warningsHtml, confirmText, resultText, installText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraRtkAgents = api;
})(typeof window !== 'undefined' ? window : this);

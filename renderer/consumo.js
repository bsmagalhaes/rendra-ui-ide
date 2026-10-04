/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Barra de consumo do Claude Code na barra de título: regras puras (nível de cor, percentual, dado
// antigo, tooltip). Carregado no renderer (window.RendraConsumo) e nos testes (require).
// Sem DOM e sem relógio: o instante atual e as funções de texto entram por parâmetro.
(function (root) {
  const LIMITE_ANTIGO_MS = 15 * 60 * 1000;
  const ITENS = [
    { chave: 'session', rotulo: '5 Horas', ariaRotulo: 'Limite de 5 horas' },
    { chave: 'weekly_all', rotulo: 'Semanal', ariaRotulo: 'Limite semanal' },
  ];

  const numeroValido = v => typeof v === 'number' && Number.isFinite(v);
  const limitar = v => Math.min(100, Math.max(0, v));

  // Mesma regra da página Claude: 70% laranja, 90% vermelho.
  function nivelDe(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warn';
    return 'ok';
  }

  function formatarPercentual(percent) {
    return `${Math.round(limitar(percent))}%`;
  }

  // res: { limits, fetchedAt } do provedor escolhido (a lista já vem normalizada: kind session ou
  // weekly_all). O Codex hoje só traz o semanal; um item ausente continua oculto.
  // deps: { conta: { organization, name, email }, plano, ambiente, provedor, fmtResetIn(ts), fmtHora(ts) }.
  // Nome exibido = organização; sem organização, o nome da pessoa. A barra aparece com limites OU
  // com conta (sem limites mostra a conta e "sem dados"); sem nenhum dos dois, some.
  function estadoConsumo(res, agora, deps = {}) {
    const c = deps.conta || {};
    const nome = c.organization || c.name || '';
    const email = c.email || '';
    const provedor = deps.provedor === 'codex' ? 'codex' : 'claude';
    const ariaGrupo = provedor === 'codex' ? 'Consumo do plano do Codex' : 'Consumo do plano do Claude Code';
    const limites = res && Array.isArray(res.limits) ? res.limits : [];

    const velho = !res || !numeroValido(res.fetchedAt) || agora - res.fetchedAt > LIMITE_ANTIGO_MS;
    const hora = res && numeroValido(res.fetchedAt) && deps.fmtHora ? deps.fmtHora(res.fetchedAt) : '';
    const lido = hora ? `lido às ${hora}` : '';

    const itens = [];
    const reinicios = [];
    for (const def of ITENS) {
      const limite = limites.find(l => l && l.kind === def.chave && numeroValido(l.percent));
      if (!limite) continue;
      const percent = Math.round(limitar(limite.percent));
      const nivel = nivelDe(percent);
      const texto = formatarPercentual(percent);
      itens.push({
        chave: def.chave, rotulo: def.rotulo, ariaRotulo: def.ariaRotulo, percent, texto, nivel,
        classe: velho ? 'stale' : nivel,
        ariaTexto: velho && lido ? `${texto}, ${lido}` : texto,
      });
      const reinicio = deps.fmtResetIn ? deps.fmtResetIn(limite.resetsAt) : '';
      if (reinicio) reinicios.push(`${def.rotulo}: ${reinicio}`);
    }
    if (!itens.length && !nome && !email) return { visivel: false, itens: [], tooltip: '', nome: '', email: '', semDados: false, provedor, ariaGrupo };

    const linhas = [];
    const quem = [nome, deps.plano].filter(Boolean).join(' · ');
    if (quem) linhas.push(quem);
    if (email) linhas.push(email);
    if (deps.ambiente) linhas.push(`Ambiente: ${deps.ambiente}`);
    if (itens.length) {
      linhas.push(...reinicios);
      if (velho) linhas.push(lido ? `Dado antigo, ${lido}` : 'Dado antigo');
    } else {
      linhas.push('Sem dados de limite');
    }
    return { visivel: true, itens, tooltip: linhas.join('\n'), nome, email, semDados: !itens.length, provedor, ariaGrupo };
  }

  // ── Seletor de provedor + ambiente ────────────────────────────────────────
  // entradas: lista do canal provider:snapshot ({ id, provedor, ambiente, conta, limits }). Uma
  // opção existe quando o ambiente tem conta OU limites (sem login, com a statusline, a barra
  // continua mostrando os limites). O id é estável (claude:local, codex:wsl:<distro>) e nunca
  // depende do rótulo; a escolha lembrada é só lida aqui: quem grava é o chamador, quando o
  // usuário troca no seletor (uma opção que some numa rodada não apaga a escolha).
  const NOME_PROVEDOR = { claude: 'Claude', codex: 'Codex' };
  const ORDEM_PROVEDOR = { claude: 0, codex: 1 };
  const ehLocal = id => !String(id).includes(':wsl:');

  function opcoesSeletor(entradas, lembrada) {
    const opcoes = (Array.isArray(entradas) ? entradas : [])
      .filter(e => e && e.id && NOME_PROVEDOR[e.provedor] && (e.conta || (Array.isArray(e.limits) && e.limits.length)))
      .sort((a, b) => (ORDEM_PROVEDOR[a.provedor] - ORDEM_PROVEDOR[b.provedor])
        || (ehLocal(b.id) - ehLocal(a.id)) || String(a.ambiente).localeCompare(String(b.ambiente)))
      .map(e => {
        const rotulo = `${NOME_PROVEDOR[e.provedor]} (${e.ambiente})`;
        return { id: e.id, rotulo, rotuloCompacto: NOME_PROVEDOR[e.provedor], tooltipAmbiente: rotulo };
      });
    const ids = opcoes.map(o => o.id);
    const selecionada = ids.includes(lembrada) ? lembrada
      : ids.includes('claude:local') ? 'claude:local'
      : (ids[0] || null);
    return { opcoes, selecionada, mostrarSeletor: opcoes.length >= 2 };
  }

  const api = { nivelDe, formatarPercentual, estadoConsumo, opcoesSeletor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraConsumo = api;
})(typeof window !== 'undefined' ? window : this);

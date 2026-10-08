/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Página "Comandos": atalhos do terminal, comandos do Claude Code e do Codex e atalhos da IDE, por sistema e por agente.
// O conteúdo vem de renderer/comandos-conteudo.js (puro e testado); aqui só ficam o desenho e os dois seletores.

(() => {
  const C = window.RendraComandos;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // O sistema abre no do computador (window.rendra.platform); o agente abre no Claude Code
  const sistemaDoComputador = () => ({ darwin: 'macos', linux: 'linux' }[window.rendra.platform] || 'windows');
  const estado = { sistema: sistemaDoComputador(), agente: 'claude' };

  // Uma tecla vira <kbd>; o sufixo entre parênteses ("(3 vezes)") vira texto comum
  const tecla = t => (/^\(/.test(t) ? `<span class="cmd-sufixo">${esc(t)}</span>` : `<kbd class="kbd">${esc(t)}</kbd>`);
  const combinacao = teclas => `<span class="cmd-combo">${teclas.map(tecla).join('<span class="cmd-mais" aria-hidden="true">+</span>')}</span>`;
  const alternativas = lista => lista.map(combinacao).join('<span class="cmd-ou">ou</span>');

  function cartaoDeAtalho(i) {
    const detalhes = (i.detalhes || []).length ? `<ul class="cmd-detalhes">${i.detalhes.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
    const nota = i.nota ? `<p class="cmd-nota">${esc(i.nota)}</p>` : '';
    return `<article class="cmd-card" data-id="${esc(i.id)}">
      <h3>${esc(i.titulo)}</h3>
      <div class="cmd-teclas">${alternativas(i.teclas)}</div>
      <p class="cmd-texto">${esc(i.oQueFaz)}</p>${detalhes}${nota}
    </article>`;
  }

  function cartaoDeComando(i) {
    return `<article class="cmd-card" data-id="${esc(i.id)}">
      <h3>${esc(i.oQueFaz)}</h3>
      <div class="cmd-teclas"><code class="cmd-code">${esc(i.comando)}</code></div>
      <p class="cmd-texto cmd-equiv"><span>No ${esc(i.agenteDoEquivalente)}:</span> <code class="cmd-code">${esc(i.equivalente)}</code></p>
    </article>`;
  }

  function secao(b) {
    const notas = (b.notas || []).map(n => `<p class="cmd-nota cmd-nota-bloco">${esc(n)}</p>`).join('');
    const cartoes = b.itens.map(i => (b.id === 'agente' ? cartaoDeComando(i) : cartaoDeAtalho(i))).join('');
    return `<section class="cmd-secao" aria-labelledby="cmd-h-${b.id}">
      <h2 class="section-heading" id="cmd-h-${b.id}">${esc(b.titulo)}</h2>${notas}
      <div class="cmd-grade">${cartoes}</div>
    </section>`;
  }

  const botao = (grupo, valor, texto) => `<button type="button" class="cmd-chip${estado[grupo] === valor ? ' active' : ''}" data-${grupo}="${valor}" aria-pressed="${estado[grupo] === valor}">${esc(texto)}</button>`;

  function desenha() {
    const c = C.conteudo(estado);
    $('comandos-versoes').textContent = `Conferido nas versões Claude Code ${c.versoes.claude} e Codex ${c.versoes.codex}`;
    $('comandos-body').innerHTML = `
      <div class="cmd-controles">
        <div class="cmd-grupo" role="group" aria-label="Sistema">
          <span class="cmd-grupo-rotulo" aria-hidden="true">Sistema</span>
          ${C.SISTEMAS.map(s => botao('sistema', s, C.NOME_SISTEMA[s])).join('')}
        </div>
        <div class="cmd-grupo" role="group" aria-label="Agente">
          <span class="cmd-grupo-rotulo" aria-hidden="true">Agente</span>
          ${C.AGENTES.map(a => botao('agente', a, C.NOME_AGENTE[a])).join('')}
        </div>
      </div>
      ${c.blocos.map(secao).join('')}`;
  }

  function open() {
    desenha();
  }

  // delegação: o desenho é refeito a cada troca, então o clique fica no contêiner
  $('comandos-body').addEventListener('click', e => {
    const b = e.target.closest('button[data-sistema], button[data-agente]');
    if (!b) return;
    if (b.dataset.sistema) estado.sistema = b.dataset.sistema;
    if (b.dataset.agente) estado.agente = b.dataset.agente;
    desenha();
    // o desenho recria os botões: devolve o foco ao botão que o teclado acabou de acionar
    const volta = b.dataset.sistema ? `button[data-sistema="${estado.sistema}"]` : `button[data-agente="${estado.agente}"]`;
    $('comandos-body').querySelector(volta)?.focus();
  });

  window.comandosPage = { open };
})();

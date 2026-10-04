/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// "Novidades" page: CHANGELOG.md.
// "Sobre" page: the product first, then — at the end — the credits and license notices the
// app must carry:
//   · every package shipped inside the app, with its license text (read from node_modules)
//   · tools the app only reads data from, and a trademark notice
//   · last: Tokenmeter (MIT, Dewashish Lambore), the project Rendra IDE is based on (LICENSE),
//     and RTK (Apache-2.0), installed by the setup straight from its official releases

(() => {
  const api = window.rendra.about;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let info = null;
  const load = async () => (info = info || await api.get());

  // Minimal Markdown: headings, bullet lists, **bold**, `code`, [links](https://…)
  function md(text) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="#" data-url="$2">$1</a>');
    let html = '';
    let inList = false;
    for (const line of text.split(/\r?\n/)) {
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      const li = line.match(/^\s*-\s+(.*)$/);
      if (!li && inList) { html += '</ul>'; inList = false; }
      if (h) { if (h[1].length > 1) html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; } // the "# Novidades" title is the page header
      else if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; }
      else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }

  const link = (url, text) => `<a href="#" data-url="${esc(url)}">${esc(text || url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`;

  function productHtml() {
    return `
      <div class="about-hero">
        <div class="about-brand">RENDRA<span>IDE</span></div>
        <p class="about-tagline">Ambiente de desenvolvimento com terminais, editor e o painel de consumo de tokens do Claude Code e do Codex, com o RTK para economizar tokens.</p>
        <div class="about-meta">
          <span>Versão <b>${esc(info.version)}</b></span>
          <span>Por <b>${esc(info.author?.name || 'Bruno Magalhaes')}</b> · ${link(info.author?.url || 'https://www.brunomagalhaes.me')} · ${link('https://www.instagram.com/brunomagalhaes.me/', 'Instagram')}</span>
          <span>Código ${link(info.repo || 'https://github.com/bsmagalhaes/rendra-ui-ide', 'GitHub')}</span>
          <span>Electron ${esc(info.electron)}</span>
        </div>
        <p class="about-made">Feito com ${link(info.repo || 'https://github.com/bsmagalhaes/rendra-ui-ide', 'Rendra')}</p>
      </div>
      <div class="about-grid">
        <div class="about-card"><h3>DevCode IDE</h3><p>Workspaces em abas, explorador com cores do Git, editor Monaco e terminais em grade, no Windows, macOS, Linux e WSL.</p></div>
        <div class="about-card"><h3>Consumo e custos</h3><p>Tokens e custo por token do Claude Code e do Codex, por projeto e período, com limites de uso do plano.</p></div>
        <div class="about-card"><h3>RTK</h3><p>Economia de tokens filtrando a saída dos comandos antes de chegar ao agente, integrada ao Claude Code e ao Codex.</p></div>
        <div class="about-card"><h3>Privacidade</h3><p>Tudo é lido localmente. O app só acessa a internet para verificar atualizações e preços no repositório do Rendra IDE e, se você ativar, os limites completos do Claude.</p></div>
      </div>`;
  }

  // Credits and licenses: required notices, kept at the end of the page
  function creditsHtml() {
    return `
      <div class="section-heading about-credits-heading">Créditos e licenças</div>
      <div class="about-card">
        <h3>Componentes incluídos no app</h3>
        <table class="breakdown-table about-table">
          <thead><tr><th>Pacote</th><th>Versão</th><th>Licença</th><th></th></tr></thead>
          <tbody>${info.packages.map(p => `
            <tr>
              <td class="mono">${p.homepage ? link(p.homepage.replace(/^git\+/, '').replace(/\.git$/, ''), p.name) : esc(p.name)}</td>
              <td class="mono dim">${esc(p.version)}</td>
              <td class="mono dim">${esc(p.license)}</td>
              <td>${p.hasText ? `<button class="dev-icon-btn about-view" data-text="${esc(p.name)}" title="Ver licença">📄</button>` : ''}</td>
            </tr>`).join('')}
            <tr><td class="mono">${link('https://www.electronjs.org', 'Electron')}</td><td class="mono dim">${esc(info.electron)}</td><td class="mono dim">MIT</td><td></td></tr>
            <tr><td class="mono">${link('https://www.chartjs.org', 'Chart.js')}</td><td class="mono dim">4.4.3</td><td class="mono dim">MIT</td><td></td></tr>
          </tbody>
        </table>
        <p class="about-small">Os textos completos das licenças acompanham cada pacote dentro do app. O Electron inclui o Chromium e outros componentes de código aberto, cujas licenças acompanham o instalador (LICENSES.chromium.html). O Chart.js é carregado da CDN jsDelivr.</p>
      </div>
      <div class="about-card">
        <h3>Ferramentas de terceiros</h3>
        <p>O Rendra IDE lê os arquivos locais do <b>Claude Code</b> (Anthropic) e do <b>Codex CLI</b> (OpenAI, Apache 2.0 · ${link('https://github.com/openai/codex')}), e a configuração do ambiente pode instalar o <b>Git</b> (Git para Windows, GPLv2, baixado do site oficial) e o <b>WSL</b> (Microsoft). Nenhuma dessas ferramentas é distribuída com o app.</p>
        <p class="about-small">Claude e Claude Code são marcas da Anthropic, PBC. OpenAI, ChatGPT e Codex são marcas da OpenAI. Windows e WSL são marcas da Microsoft. O Rendra IDE é um projeto independente, sem afiliação ou endosso dessas empresas. Os custos exibidos são estimativas.</p>
      </div>
      <div class="about-card">
        <h3>Tokenmeter</h3>
        <p>O Rendra IDE é baseado no <b>Tokenmeter</b>, de <b>Dewashish Lambore</b> (${link('https://github.com/DewashishCodes/tokenmeter')}), distribuído sob a licença <b>MIT</b>. O aviso de copyright e a licença original acompanham o Rendra IDE.</p>
        <button class="btn btn-secondary" data-text="rendra" type="button">Ver licença</button>
      </div>
      <div class="about-card">
        <h3>RTK · Rust Token Killer</h3>
        <p>© rtk-ai · Licença <b>Apache 2.0</b> · ${link('https://github.com/rtk-ai/rtk')}. O RTK não vem embutido no Rendra IDE: a configuração do ambiente o baixa diretamente das releases oficiais do projeto, com o checksum conferido, e ele continua sob a sua própria licença.</p>
        <button class="btn btn-secondary" data-text="rtk" type="button">Ver licença (Apache 2.0)</button>
      </div>
      <pre class="about-license" id="about-license" hidden></pre>`;
  }

  async function openAbout() {
    await load();
    $('about-version').textContent = `versão ${info.version}`;
    $('about-body').innerHTML = productHtml() + creditsHtml();
  }

  async function openChangelog() {
    await load();
    $('changelog-version').textContent = `versão atual ${info.version}`;
    $('changelog-body').innerHTML = md(info.changelog);
  }

  $('about-body').addEventListener('click', async e => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); window.rendra.openExternal(a.dataset.url); return; }
    const btn = e.target.closest('[data-text]');
    if (!btn) return;
    const name = btn.dataset.text;
    const text = name === 'rendra' ? info.license : await api.licenseText(name);
    const pre = $('about-license');
    pre.hidden = false;
    pre.textContent = text || 'Texto da licença indisponível.';
    pre.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('changelog-body').addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); window.rendra.openExternal(a.dataset.url); }
  });

  window.aboutPage = { open: openAbout };
  // Notas de uma versão (trecho do CHANGELOG) já em HTML, para o modal da primeira abertura
  async function notasHtml(version) {
    await load();
    const trecho = window.RendraNovidades.secao(info.changelog, version);
    return trecho ? md(trecho) : '<p>Esta versão não traz notas no CHANGELOG.</p>';
  }

  window.changelogPage = { open: openChangelog, notasHtml };
})();

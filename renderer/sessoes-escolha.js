/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Modelo puro do seletor de conversas do terminal (Claude Code e Codex): validação de id, comparação de
// pasta, título curto, data, ordenação, opções de nova conversa, comandos fixos e detecção do prompt.
// Carregado no renderer (window.RendraSessoesEscolha) e exigido no main e nos testes (require).
(function (root) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const PROVEDORES = { claude: 'Claude', codex: 'Codex' };
  const SEM_TITULO = 'Conversa sem título';
  const MAX_TITULO = 80;
  const VISIVEIS = 10; // conversas mostradas antes de "Ver todas"
  const TE = typeof module !== 'undefined' && module.exports ? require('./terminal-escolha') : root.RendraTermEscolha;

  // Só um uuid (minúsculo, com hífens nos lugares certos) pode chegar ao shell
  const idValido = id => typeof id === 'string' && UUID.test(id);

  // Caminho do Windows (unidade ou UNC) e /mnt/<unidade> não diferenciam caixa; Linux nativo diferencia
  const barras = p => p.replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  const semCaixa = p => /^[a-z]:(\/|$)/i.test(p) || p.startsWith('//') || /^\/mnt\/[a-z](\/|$)/i.test(p);
  const caixaInsensivel = p => typeof p === 'string' && semCaixa(barras(p));
  function mesmaPasta(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const x = barras(a), y = barras(b);
    return semCaixa(x) && semCaixa(y) ? x.toLowerCase() === y.toLowerCase() : x === y;
  }

  // Primeira linha não vazia, espaços colapsados, no máximo 80 caracteres (reticências no corte)
  function tituloCurto(texto) {
    if (typeof texto !== 'string') return '';
    const linha = texto.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    return linha.length > MAX_TITULO ? `${linha.slice(0, MAX_TITULO - 1).trimEnd()}…` : linha;
  }

  function dataBr(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const ordenarRecentes = sessoes => [...sessoes].sort((a, b) => (b.quando || 0) - (a.quando || 0));
  const visiveis = (sessoes, todas) => (todas ? sessoes : sessoes.slice(0, VISIVEIS));

  // Título salvo pelo usuário, depois o início da conversa, depois o histórico do CLI
  function escolherTitulo({ customTitle, primeiraMensagem, historico } = {}) {
    for (const t of [customTitle, primeiraMensagem, historico]) {
      const c = tituloCurto(t);
      if (c) return c;
    }
    return SEM_TITULO;
  }

  // Ambiente do terminal (uma regra só). `wsl` é o alvo já resolvido pelo main (wslFor), nunca o do renderer.
  function ambienteDoTerminal({ cwd, wsl, shell } = {}) {
    if (!cwd || typeof cwd !== 'string') return null;
    if (wsl && wsl.distro && wsl.linuxPath) return { tipo: 'wsl', distro: wsl.distro, cwd: wsl.linuxPath };
    if (typeof shell === 'string' && shell.startsWith('wsl:')) {
      const linux = TE.caminhoNoWsl(cwd);
      return linux ? { tipo: 'wsl', distro: shell.slice(4), cwd: linux } : null;
    }
    return { tipo: 'windows', distro: null, cwd };
  }

  function opcoesNovaSessao({ claude, codex } = {}) {
    const lista = [];
    if (claude) lista.push({ provedor: 'claude', label: `Nova conversa no ${PROVEDORES.claude}` });
    if (codex) lista.push({ provedor: 'codex', label: `Nova conversa no ${PROVEDORES.codex}` });
    if (!lista.length) return [];
    lista.push({ provedor: null, label: 'Só o terminal' });
    return lista;
  }

  function comandoRetomar(provedor, id) {
    if (!idValido(id)) throw new Error('Identificador de conversa inválido');
    if (provedor === 'claude') return `claude --resume ${id}\r`;
    if (provedor === 'codex') return `codex resume ${id}\r`;
    throw new Error('Provedor desconhecido');
  }

  function comandoNovo(provedor) {
    // Com argumento, o comando não passa por função claude() do rc do usuário (que, sem argumento, pode
    // anexar a uma sessão tmux já aberta); o id novo a cada chamada garante conversa nova.
    if (provedor === 'claude') return `claude --session-id ${globalThis.crypto.randomUUID()}\r`;
    if (provedor === 'codex') return 'codex\r';
    throw new Error('Provedor desconhecido');
  }

  // A saída crua do ConPTY traz CSI (cores, cursor), OSC (título da janela) e \r soltos
  const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
  const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
  const OSC_ABERTO = new RegExp(`${ESC}\\][^${BEL}${ESC}]*$`);
  const OUTRAS = new RegExp(`${ESC}[()][A-Za-z0-9]|${ESC}[=>78]`, 'g');
  // o terminador do prompt não vem depois de - = < > $ # (seta de texto como "-->" não conta)
  const TERMINADOR = /(?<![-=<>$#])[>$#]$/;
  function fimDePrompt(texto) {
    if (typeof texto !== 'string') return false;
    const limpo = texto.replace(OSC, '').replace(OSC_ABERTO, '').replace(CSI, '').replace(OUTRAS, '').replace(/\r(?!\n)/g, '');
    const linhas = limpo.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    const ultima = linhas[linhas.length - 1];
    return !!ultima && TERMINADOR.test(ultima);
  }

  const api = { idValido, mesmaPasta, caixaInsensivel, tituloCurto, dataBr, ordenarRecentes, visiveis, escolherTitulo, ambienteDoTerminal, opcoesNovaSessao, comandoRetomar, comandoNovo, fimDePrompt, VISIVEIS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraSessoesEscolha = api;
})(typeof window !== 'undefined' ? window : this);

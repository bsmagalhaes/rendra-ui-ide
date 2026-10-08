/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Teclas do terminal que a IDE trata antes do xterm.js. Carregado no renderer (window.RendraTermKeys)
// e nos testes (require).
//
// Shift+Enter quebra a linha nas CLIs de IA (Claude Code, Codex) sem enviar o prompt. O xterm.js
// ignora o Shift no Enter e manda só CR (enviaria o prompt); o Alt+Enter ele já manda como ESC + CR,
// que é o que essas CLIs entendem como nova linha. A sequência é a mesma em Windows, macOS e Linux.
(function (root) {
  const NOVA_LINHA = '\x1b\r';

  // Sequência a escrever no PTY para o evento, ou null para o xterm tratar como sempre.
  function sequenciaDeTecla(ev) {
    if (ev.type !== 'keydown' || ev.key !== 'Enter') return null;
    if (ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) return NOVA_LINHA;
    return null;
  }

  // ── Ctrl+C: um toque cola, dois avisam, três interrompem ─────────────────────────────────────────────────
  // Regra do dono (sem texto marcado): 1 toque sem outro em ESPERA_COLAR ms cola o que está copiado; 2 toques
  // cancelam a colagem, avisam "aperte mais 1 vez para interromper" e esperam o terceiro; o 3º toque dentro de
  // JANELA ms desde o primeiro interrompe (um só \x03 ao programa); sem o 3º, nada é enviado e o aviso some.
  // O programa nunca recebe os dois primeiros toques. A máquina é pura (o tempo entra como argumento).
  const ESPERA_COLAR = 1000;
  const JANELA = 2000;

  const novoEstado = () => ({ toques: 0, t0: 0 });

  // A colagem que o 1 toque agendou só acontece com o terminal vivo, sem painel de conversas e sem janela modal ou menu
  // aberto (o overlay "Abrir link?" pode abrir dentro do segundo de espera).
  function podeColarDeCtrlC({ vivo, painel, modalAberto }) {
    return !!vivo && !painel && !modalAberto;
  }

  // A letra lógica da tecla: `ev.key` quando é uma letra latina (vale em Dvorak, Colemak, AZERTY); sem ela (layout
  // não latino, tecla morta, evento sem key) cai na posição física `ev.code`.
  function eLetra(ev, letra) {
    const k = ev.key;
    if (typeof k === 'string' && /^[a-z]$/i.test(k)) return k.toLowerCase() === letra;
    return ev.code === `Key${letra.toUpperCase()}`;
  }

  // Avança o relógio: cola quando o único toque completa ESPERA_COLAR; esconde o aviso quando completa JANELA.
  function passar(estado, agora) {
    if (estado.toques === 1 && agora - estado.t0 >= ESPERA_COLAR) return { estado: novoEstado(), efeitos: ['colar'] };
    if (estado.toques === 2 && agora - estado.t0 >= JANELA) return { estado: novoEstado(), efeitos: ['esconder-aviso'] };
    return { estado, efeitos: [] };
  }

  // Um toque (keydown sem repeat) em `agora` ms. Primeiro deixa o relógio andar, para o limite ser determinístico.
  function tocar(estado, agora) {
    const antes = passar(estado, agora);
    const efeitos = antes.efeitos.slice();
    const e = antes.estado;
    if (e.toques === 0) return { estado: { toques: 1, t0: agora }, efeitos };
    if (e.toques === 1) return { estado: { toques: 2, t0: e.t0 }, efeitos: [...efeitos, 'avisar'] };
    return { estado: novoEstado(), efeitos: [...efeitos, 'esconder-aviso', 'interromper'] };
  }

  // Quantos ms faltam para a próxima mudança por tempo, ou null quando o estado está ocioso.
  function proximoPrazo(estado, agora) {
    if (estado.toques === 1) return Math.max(0, estado.t0 + ESPERA_COLAR - agora);
    if (estado.toques === 2) return Math.max(0, estado.t0 + JANELA - agora);
    return null;
  }

  // Embrulha a máquina com relógio e timer (injetáveis nos testes). Uma instância por terminal; um só timer,
  // agendado a partir de proximoPrazo. cancelar() para o timer e zera (terminal fechado ou processo encerrado).
  function criarCtrlC(deps = {}) {
    const agora = deps.agora || (() => Date.now());
    const agendar = deps.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
    const limpar = deps.clearTimeout || (id => globalThis.clearTimeout(id));
    const ao = {
      colar: deps.aoColar || (() => {}),
      'esconder-aviso': deps.aoEsconder || (() => {}),
      avisar: deps.aoAvisar || (() => {}),
      interromper: deps.aoInterromper || (() => {}),
    };
    let estado = novoEstado();
    let timer = null;
    const parar = () => { if (timer !== null) { limpar(timer); timer = null; } };
    const reagendar = () => {
      parar();
      const prazo = proximoPrazo(estado, agora());
      if (prazo !== null) timer = agendar(() => { timer = null; aplicar(passar(estado, agora())); }, prazo);
    };
    function aplicar(r) {
      estado = r.estado;
      reagendar(); // antes dos efeitos: um efeito que lance não deixa o timer solto
      for (const ef of r.efeitos) ao[ef]();
    }
    return {
      tocar: () => aplicar(tocar(estado, agora())),
      cancelar: () => { parar(); estado = novoEstado(); },
      estado: () => estado,
    };
  }

  const ctrlC = { novoEstado, tocar, passar, proximoPrazo, ESPERA_COLAR, JANELA };

  // ── Copiar ao marcar ─────────────────────────────────────────────────────────────────────────────────────
  // Marcar texto com o mouse copia sozinho (o realce fica). Cada arraste dispara vários eventos de seleção; o
  // devcode espera a seleção estabilizar e só então pergunta: vazio e repetido não copiam de novo.
  function deveCopiar(texto, ultimoCopiado) {
    if (!texto) return false;
    return texto !== ultimoCopiado;
  }

  // ── Colar (Ctrl+V, clique direito) ───────────────────────────────────────────────────────────────────────
  // Texto na área de transferência vence: cola o texto (com bracketed paste quando o programa pediu). Só imagem:
  // o Ctrl+V cru (\x16) vai ao programa, porque Claude Code e Codex leem a imagem sozinhos. Nada: cola vazio, sem efeito.
  function decidirColagem(texto, temImagem) {
    if (texto) return 'texto';
    return temImagem ? 'imagem' : 'texto';
  }

  // ── Colar imagem (Alt+V) ─────────────────────────────────────────────────────────────────────────────────
  // O Claude Code liga Alt+V só no Windows e no WSL e Ctrl+V nos outros sistemas; o Codex só Ctrl+V. As duas CLIs
  // leem a imagem da área de transferência sozinhas ao receber a tecla. Bytes por sistema e shell (T7):
  // Windows nativo manda ESC v (o Alt+V do Claude), WSL, Linux e macOS mandam Ctrl+V (\x16).
  function bytesColarImagem(plataforma, shellKey) {
    if (plataforma === 'win32' && shellKey !== 'wsl') return '\x1bv';
    return '\x16';
  }

  // Atalhos da IDE reconhecidos aqui (com o foco no terminal) vêm do módulo próprio, para haver uma só regra.
  function atalhosIde() {
    if (typeof module !== 'undefined' && module.exports) return require('./atalhos-ide');
    return root.RendraAtalhosIde;
  }

  // Decisão pura para um evento de tecla do terminal. Só o que a IDE trata antes do xterm; o resto é 'deixar'.
  //   enviar         bytes ao pty (Shift+Enter)
  //   ctrlc          Ctrl+C consumido (nunca chega o \x03 do xterm); `toque` diz se conta na máquina (keydown sem
  //                  repeat); `selecao` diz que há texto marcado: aí o handler só copia e mostra "Copiado"
  //   colar          Ctrl+V / Ctrl+Shift+V no Windows e no Linux (texto ou imagem)
  //   colar-imagem   Alt+V no Windows e no Linux (bytes decididos por bytesColarImagem)
  //   copiar-selecao Ctrl+Shift+C no Windows e no Linux
  //   nativo         Cmd+V no macOS (colagem do browser)
  //   atalho-ide     Ctrl+Shift+T, Ctrl+Tab, Cmd+O... (acao vem de atalhos-ide.js)
  //   deixar         o xterm trata (inclui Control+V e Option no macOS, Alt+Backspace, Ctrl+L, Ctrl+O, PageUp)
  // contexto: { temSelecao }. As letras C e V vêm de ev.key (a letra lógica, certa em Dvorak), com ev.code de reserva.
  function acaoDeTecla(ev, plataforma, shellKey, contexto = {}) {
    const mac = plataforma === 'darwin';
    const { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta } = ev;
    // Ctrl+C em qualquer tipo de evento: se algum caminho deixasse o xterm tratar, o \x03 sairia sem passar
    // pela máquina (tecla segurada, keyup, keypress)
    if (eLetra(ev, 'c') && ctrl && !shift && !alt && !meta) {
      return { tipo: 'ctrlc', toque: ev.type === 'keydown' && !ev.repeat, selecao: !!contexto.temSelecao };
    }
    if (ev.type !== 'keydown') return { tipo: 'deixar' };
    const nova = sequenciaDeTecla(ev);
    if (nova !== null) return { tipo: 'enviar', bytes: nova };
    const ide = atalhosIde();
    const acao = ide && ide.acaoDeAtalhoIde(ev, plataforma, { foraDoTerminal: false });
    if (acao) return { tipo: 'atalho-ide', acao };
    if (eLetra(ev, 'c') && ctrl && shift && !alt && !meta) return { tipo: mac ? 'deixar' : 'copiar-selecao' };
    if (eLetra(ev, 'v')) {
      if (mac) return { tipo: meta && !ctrl && !alt && !shift ? 'nativo' : 'deixar' };
      if (ctrl && !alt && !meta) return { tipo: 'colar' };
      if (alt && !ctrl && !meta && !shift) return { tipo: 'colar-imagem', bytes: bytesColarImagem(plataforma, shellKey) };
    }
    return { tipo: 'deixar' };
  }

  const api = { podeColarDeCtrlC, eLetra, sequenciaDeTecla, ctrlC, criarCtrlC, acaoDeTecla, bytesColarImagem, deveCopiar, decidirColagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraTermKeys = api;
})(typeof window !== 'undefined' ? window : this);

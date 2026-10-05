/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Roda do mouse no Windows: 1 entalhe rola as "linhas por vez" que o usuário configurou no sistema, no terminal e no
// editor. O Chromium já entrega essa configuração em WheelEvent.deltaY (N linhas x 100/3 px), mas o xterm e o Monaco
// leem o campo legado wheelDeltaY (fixo em 120) e a ignoram. Lógica pura (sem DOM), carregada no renderer
// (window.RendraWheelLines) e nos testes (require); o devcode.js só executa o que ela decide.
(function (root) {
  const PX_POR_LINHA = 100 / 3;   // regra do Chromium no Windows: cada "linha" do sistema vale 100/3 px de deltaY
  const FAST = 5;                 // Alt: o mesmo fastScrollSensitivity padrão do xterm e do Monaco
  const TOLERANCIA = 0.01;        // 499,99 / (100/3) = 14,9997: perto de um inteiro, conta o inteiro

  const novoEstado = () => ({ resto: 0 });

  // Só o entalhe de uma roda comum: pixels, com wheelDeltaY múltiplo de 120. Trackpad e roda de alta resolução (wheelDeltaY
  // menor) ficam com o comportamento de hoje.
  const eEntalhe = ev => ev.deltaMode === 0 && !!ev.wheelDeltaY && ev.wheelDeltaY % 120 === 0;

  // { linhas, estado }: linhas > 0 rola para baixo, < 0 para cima; null = não intercepta (comportamento atual); 0 = a
  // fração ainda não completou uma linha. O estado é por terminal e por editor, nunca global.
  function linhasDaRoda(estado, ev, { plataforma, linhasPagina }) {
    const nada = { linhas: null, estado };
    if (plataforma !== 'win32') return nada;
    if (ev.ctrlKey || ev.shiftKey || ev.metaKey || ev.deltaX || !ev.deltaY) return nada;
    const fator = ev.altKey ? FAST : 1;
    const sinal = ev.deltaY < 0 ? -1 : 1;
    if (ev.deltaMode === 1) return { linhas: ev.deltaY * fator, estado };
    if (ev.deltaMode === 2) return { linhas: sinal * linhasPagina * fator, estado };
    if (!eEntalhe(ev)) return nada;
    let resto = estado.resto;
    if (resto && Math.sign(resto) !== sinal) resto = 0; // inverteu o sentido: zera o resíduo
    const total = resto + ev.deltaY / PX_POR_LINHA;
    const inteiro = Math.round(total);
    const n = Math.abs(total - inteiro) < TOLERANCIA ? inteiro : Math.trunc(total);
    const novoResto = Math.abs(total - inteiro) < TOLERANCIA ? 0 : total - n;
    return { linhas: n * fator, estado: { resto: novoResto } };
  }

  // O que fazer com a roda: 'mouse' (o programa pediu a roda, em qualquer buffer; o x10 não informa roda), 'setas' (tela
  // alternativa sem mouse: o xterm manda setas) ou 'scroll' (buffer normal: o terminal rola o histórico).
  function decidirRamo({ tipoBuffer, modoMouse }) {
    if (modoMouse === 'vt200' || modoMouse === 'drag' || modoMouse === 'any') return 'mouse';
    return tipoBuffer === 'alternate' ? 'setas' : 'scroll';
  }

  // N setas no modo de cursor certo: ESC O (DECCKM ligado, como o less e o vim pedem) ou ESC [.
  function sequenciaDeSetas(linhas, modoAplicacao) {
    return ((modoAplicacao ? '\x1bO' : '\x1b[') + (linhas < 0 ? 'A' : 'B')).repeat(Math.abs(linhas));
  }

  // Relatórios de roda no modo de mouse: o evento original gera um, as cópias geram o resto.
  const copiasExtras = linhas => Math.max(0, Math.abs(linhas) - 1);

  const pixelsDeLinhas = (linhas, alturaLinha) => linhas * alturaLinha;

  const api = { novoEstado, linhasDaRoda, decidirRamo, sequenciaDeSetas, copiasExtras, pixelsDeLinhas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraWheelLines = api;
})(typeof window !== 'undefined' ? window : this);

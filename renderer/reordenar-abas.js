/*! Rendra IDE v1.6.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Reordenar abas (projetos, terminais e editor). Módulo puro, carregado no renderer (window.RendraReordenar) e nos
// testes (require). Não toca no DOM: devcode.js guarda o estado e chama estas funções.
(function (root) {
  // Tipo próprio do arraste: nunca `text/plain`, senão soltar uma aba sobre o Monaco ou o xterm inseriria o nome
  const TIPO = 'application/x-rendra-aba';

  // Move o item de `de` para antes ou depois do item `alvo` (índices da lista de ANTES do movimento).
  // Devolve { lista, indice, mudou }: a lista nova (a original não é alterada), onde o item movido ficou e se algo mudou.
  function moverPara(lista, de, alvo, depois) {
    const n = Array.isArray(lista) ? lista.length : 0;
    const semMudanca = { lista: Array.isArray(lista) ? lista.slice() : [], indice: de, mudou: false };
    if (!Number.isInteger(de) || !Number.isInteger(alvo) || de < 0 || alvo < 0 || de >= n || alvo >= n) return semMudanca;
    let destino = alvo + (depois ? 1 : 0);
    if (de < destino) destino -= 1;
    if (destino === de) return semMudanca;
    const nova = lista.slice();
    const [item] = nova.splice(de, 1);
    nova.splice(destino, 0, item);
    return { lista: nova, indice: destino, mudou: true };
  }

  // Move o item `de` um passo (delta -1 ou +1); trava nas pontas (sem dar a volta)
  function moverPorDelta(lista, de, delta) {
    const n = Array.isArray(lista) ? lista.length : 0;
    if (!Number.isInteger(de) || de < 0 || de >= n || (delta !== -1 && delta !== 1)) {
      return { lista: Array.isArray(lista) ? lista.slice() : [], indice: de, mudou: false };
    }
    const alvo = de + delta;
    if (alvo < 0 || alvo >= n) return { lista: lista.slice(), indice: de, mudou: false };
    return moverPara(lista, de, alvo, delta > 0);
  }

  // Posição do item numa lista depois do movimento, para acompanhar um item de referência (por exemplo o ativo)
  const indiceDe = (lista, item) => lista.indexOf(item);

  // Texto lido pelo leitor de tela depois de cada movimento (posição é 0-based na entrada, 1-based na frase)
  const anuncio = (nome, indice, total) => `${nome} movida para a posição ${indice + 1} de ${total}`;

  // O dataTransfer do arraste só vale para esta IDE e para a mesma barra
  const aceitaArraste = (types, estado, barra) =>
    !!estado && estado.barra === barra && !!types && Array.prototype.includes.call(types, TIPO);

  // Ctrl+Shift+Seta esquerda (-1) ou direita (+1) com o foco numa aba. Função PRÓPRIA, fora de acaoDeAtalhoIde
  // (atalhos-ide.js): essa decide as teclas do xterm, e o terminal e o Monaco usam Ctrl+Shift+Seta para marcar por
  // palavra. Mesma tecla nos três sistemas (Ctrl+Shift não conflita com o Cmd do macOS). Só keydown, sem Alt nem Meta.
  function moverAbaDeTecla(ev) {
    if (!ev || ev.type !== 'keydown') return null;
    if (!ev.ctrlKey || !ev.shiftKey || ev.altKey || ev.metaKey) return null;
    if (ev.code === 'ArrowLeft') return -1;
    if (ev.code === 'ArrowRight') return 1;
    return null;
  }

  const api = { TIPO, moverPara, moverPorDelta, indiceDe, anuncio, aceitaArraste, moverAbaDeTecla };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraReordenar = api;
})(typeof window !== 'undefined' ? window : this);

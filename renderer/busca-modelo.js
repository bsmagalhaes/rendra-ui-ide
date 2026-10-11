/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Modelo puro do painel de busca do explorador (UMD, sem DOM, testável no node): estado, validação do termo, frases do
// resumo (com o aviso de resultado parcial), trechos com marcas, lista plana do painel e a navegação por seta.
// Carregado no renderer (window.RendraBuscaModelo) e nos testes (require).
(function (root) {
  const TERMO_MIN = 2; // o mesmo mínimo do main (src/busca.js), nos dois modos

  const estadoInicial = () => ({ modo: 'texto', termo: '', diferenciar: false, palavra: false, regex: false, resposta: null, erro: null });

  // { ok } ou { ok: false, motivo }: o motivo é o texto de ajuda do painel (o main nunca é consultado com termo curto)
  function termoValido(estado) {
    if (!estado || typeof estado.termo !== 'string' || estado.termo.length < TERMO_MIN) {
      return { ok: false, motivo: `Digite pelo menos ${TERMO_MIN} caracteres para buscar.` };
    }
    return { ok: true };
  }

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // { frase, aviso, pulados }: aviso só quando a busca parou antes do fim (teto de ocorrências, de arquivos ou de tempo)
  function resumo(resposta) {
    if (!resposta) return { frase: '', aviso: '', pulados: '' };
    const lim = resposta.limites || {};
    const n = resposta.total || 0;
    let frase;
    if (!n) frase = 'Nenhum resultado';
    else if (resposta.modo === 'nome') frase = `${plural(n, 'arquivo encontrado', 'arquivos encontrados')}`;
    else frase = `${plural(n, 'ocorrência', 'ocorrências')} em ${plural(resposta.arquivos || 0, 'arquivo', 'arquivos')}`;
    const aviso = {
      ocorrencias: `Parou em ${lim.ocorrencias || n} ocorrências. Refine o termo.`,
      arquivos: `Parou em ${lim.arquivos || resposta.arquivos} arquivos. Refine o termo.`,
      tempo: `Parou no tempo limite (${Math.round((lim.tempoMs || 10000) / 1000)} s). Refine o termo.`,
    }[resposta.parcial] || '';
    const p = resposta.pulados || 0;
    const pulados = p ? `${plural(p, 'arquivo grande ou binário pulado', 'arquivos grandes ou binários pulados')}` : '';
    return { frase, aviso, pulados };
  }

  // Pedaços do trecho, `marca` true nas faixas casadas: o renderer monta por textContent, nunca por HTML cru
  function segmentos(trecho, marcas) {
    const out = [];
    let pos = 0;
    for (const [a, b] of [...(marcas || [])].sort((x, y) => x[0] - y[0])) {
      if (a < pos || b <= a || a >= trecho.length) continue;
      if (a > pos) out.push({ texto: trecho.slice(pos, a), marca: false });
      out.push({ texto: trecho.slice(a, Math.min(b, trecho.length)), marca: true });
      pos = Math.min(b, trecho.length);
    }
    if (pos < trecho.length) out.push({ texto: trecho.slice(pos), marca: false });
    return out;
  }

  // Caminho relativo à raiz, com "/" (a raiz vem do mesmo texto que o main usou para montar o caminho)
  function relativo(caminho, raiz) {
    let rel = String(caminho);
    if (raiz && rel.toLowerCase().startsWith(String(raiz).toLowerCase())) rel = rel.slice(raiz.length);
    return rel.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  }

  // Lista plana: { tipo: 'arquivo', rotulo, caminho, quantidade } e { tipo: 'item', caminho, rotulo, linha, coluna, trecho, marcas }
  function linhasDoPainel(resposta, raiz) {
    if (!resposta || !Array.isArray(resposta.resultados)) return [];
    const out = [];
    for (const r of resposta.resultados) {
      const rotulo = relativo(r.path, raiz);
      if (resposta.modo === 'nome') {
        out.push({ tipo: 'item', caminho: r.path, rotulo, linha: null, coluna: null, trecho: '', marcas: [] });
        continue;
      }
      out.push({ tipo: 'arquivo', rotulo, caminho: r.path, quantidade: r.ocorrencias.length });
      for (const o of r.ocorrencias) out.push({ tipo: 'item', caminho: r.path, rotulo, linha: o.linha, coluna: o.coluna, trecho: o.trecho, marcas: o.marcas });
    }
    return out;
  }

  // Navegação circular por seta: posições = o campo de busca (-1) e cada item (cabeçalhos de arquivo são ignorados).
  // `atual` é o índice na lista (ou -1 no campo); devolve o índice do próximo (ou -1 para voltar ao campo).
  function proximoItem(linhas, atual, delta) {
    const posicoes = [-1];
    linhas.forEach((l, i) => { if (l.tipo === 'item') posicoes.push(i); });
    if (posicoes.length === 1) return -1;
    const i = posicoes.indexOf(atual);
    const base = i < 0 ? 0 : i;
    return posicoes[(base + (delta < 0 ? -1 : 1) + posicoes.length) % posicoes.length];
  }

  const api = { TERMO_MIN, estadoInicial, termoValido, resumo, segmentos, relativo, linhasDoPainel, proximoItem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraBuscaModelo = api;
})(typeof window !== 'undefined' ? window : this);

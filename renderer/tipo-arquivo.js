/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Tipo do arquivo pela extensão, para o explorador decidir entre editar, visualizar ou avisar. Carregado no renderer
// (window.RendraTipoArquivo), no processo principal (protocolo de mídia) e nos testes (require).
// Nunca pelo conteúdo: o byte nulo continua sendo a regra do dev:read para o editor.
(function (root) {
  const IMAGEM = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
  const AUDIO = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg' };
  const VIDEO = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime' };
  const PDF = { pdf: 'application/pdf' };
  const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
  const HTML = new Set(['html', 'htm']);
  // Esquema do protocolo que serve a mídia ao renderer (registrado em main.js, só na sessão padrão)
  const ESQUEMA = 'rendra-midia';
  const PREFIXO_VISTA = 'vista:';

  const extensao = nome => {
    const n = String(nome || '').split(/[\\/]/).pop().toLowerCase();
    const i = n.lastIndexOf('.');
    return i > 0 ? n.slice(i + 1) : '';
  };

  // 'imagem' | 'audio' | 'video' | 'pdf' | 'texto'. SVG, HTML, Markdown e qualquer extensão desconhecida são texto
  // (o clique abre para editar; o menu Visualizar é que os mostra).
  function tipoDe(nome) {
    const e = extensao(nome);
    if (IMAGEM[e]) return 'imagem';
    if (AUDIO[e]) return 'audio';
    if (VIDEO[e]) return 'video';
    if (PDF[e]) return 'pdf';
    return 'texto';
  }

  // Tipo MIME que o protocolo de mídia serve; null para todo o resto (nunca HTML nem SVG)
  const mimeDe = nome => { const e = extensao(nome); return IMAGEM[e] || AUDIO[e] || VIDEO[e] || PDF[e] || null; };

  // Como o menu Visualizar mostra um arquivo de texto: 'markdown' | 'svg' | 'html' | 'texto'
  function vistaDe(nome) {
    const e = extensao(nome);
    if (MARKDOWN.has(e)) return 'markdown';
    if (e === 'svg') return 'svg';
    if (HTML.has(e)) return 'html';
    return 'texto';
  }

  // Endereço de um arquivo no protocolo de mídia: o caminho inteiro codificado num só segmento
  const urlMidia = caminho => `${ESQUEMA}://arquivo/${encodeURIComponent(caminho)}`;

  // Chave de aba: o caminho (editor e mídia) ou "vista:<caminho>" (visualização de texto, Markdown, SVG e HTML)
  const chaveVista = caminho => PREFIXO_VISTA + caminho;
  const ehChaveVista = chave => String(chave).startsWith(PREFIXO_VISTA);
  const caminhoDaChave = chave => (ehChaveVista(chave) ? String(chave).slice(PREFIXO_VISTA.length) : chave);

  const api = { tipoDe, mimeDe, vistaDe, extensao, urlMidia, chaveVista, ehChaveVista, caminhoDaChave, ESQUEMA, PREFIXO_VISTA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraTipoArquivo = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Reconhecedor de caminhos de arquivo no texto do terminal. Só devolve CANDIDATOS (texto que parece um
// caminho); quem decide se vira link é a verificação de existência no main. Puro, sem DOM: carregado no
// renderer (window.RendraCaminhos) e nos testes (require). Não valida palavra por palavra: só entra
// quem tem "/" ou "\" e (extensão, barra final ou prefixo ./ ../ ~/ / X:\).
(function (root) {
  const MAX_POR_LINHA = 20;
  const MAX_TAM = 400;
  const PREFIXO = /^(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)/;
  const EXTENSAO = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

  // Devolve [{ start, end, texto, caminho, linha, coluna }]; end é exclusivo e cobre o texto com ":linha".
  function acharCaminhos(texto) {
    const achados = [];
    if (typeof texto !== 'string' || !texto) return achados;
    const re = /[^\s"'`<>|*?(){}\[\],;=]+/g;
    let m;
    while ((m = re.exec(texto)) && achados.length < MAX_POR_LINHA) {
      let tok = m[0];
      const start = m.index;
      if (tok.length > MAX_TAM) continue;
      tok = tok.replace(/[.:!]+$/, ''); // pontuação de fim de frase
      if (!tok || tok.includes('://') || tok.startsWith('//') || tok.startsWith('\\\\')) continue; // URL ou UNC: nunca
      let caminho = tok, linha = null, coluna = null;
      const suf = /^(.*[^:\d]):(\d{1,7})(?::(\d{1,7}))?$/.exec(tok);
      if (suf) { caminho = suf[1]; linha = Number(suf[2]); coluna = suf[3] ? Number(suf[3]) : null; }
      if (!/[\\/]/.test(caminho) || !/[A-Za-z]/.test(caminho)) continue;
      if (/^[A-Za-z]:/.test(caminho) ? caminho.slice(2).includes(':') : caminho.includes(':')) continue; // ":" só na unidade e no sufixo :linha (a.txt:Zone.Identifier, git@host:x não)
      const primeiro = caminho.split(/[\\/]/)[0];
      if (primeiro.includes('@') || /^www\./i.test(primeiro)) continue; // a@b.com/x, user@host:/x, www.exemplo.com/x: endereço, não arquivo
      const separadores = (caminho.match(/[\\/]/g) || []).length;
      const ultimo = caminho.split(/[\\/]/).pop();
      let ok;
      if (ultimo === '') ok = caminho.replace(/[\\/]+$/, '').length > 1 || /^[A-Za-z]:/.test(caminho); // pasta com barra final
      else if (EXTENSAO.test(ultimo) || /^\.[A-Za-z]/.test(ultimo)) ok = true; // arquivo com extensão ou dotfile
      else ok = PREFIXO.test(caminho) && (separadores >= 2 || !caminho.startsWith('/')); // pasta sem extensão: só com prefixo (./ ../ ~/ / X:\)
      if (!ok) continue;
      achados.push({ start, end: start + tok.length, texto: tok, caminho, linha, coluna });
    }
    return achados;
  }

  const api = { acharCaminhos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraCaminhos = api;
})(typeof window !== 'undefined' ? window : this);

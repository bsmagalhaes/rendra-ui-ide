/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Protocolo próprio que serve ao renderer a mídia dos projetos abertos (imagem, áudio, vídeo e PDF). O renderer nunca
// carrega o conteúdo do usuário por file:, que não passa pelo guard: cada pedido confere guard + realDentro (a mesma
// regra do dev:read), decodifica a URL uma vez, só serve os tipos de mídia (nunca HTML nem SVG, que rodariam no
// documento) com nosniff, e responde a Range (o seek do vídeo). Só existe na sessão padrão da janela da IDE: o Rendra
// Browser usa outra partição, e uma página da web não pode ler arquivos do projeto.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { mimeDe, ESQUEMA } = require('../renderer/tipo-arquivo');

const HOST = 'arquivo';

// Para protocol.registerSchemesAsPrivileged (antes de o app ficar pronto). Sem bypassCSP: a CSP da página manda.
const esquemasPrivilegiados = () => [{ scheme: ESQUEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }];

const resposta = (status, texto) => new Response(texto, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } });

// "bytes=a-b", "bytes=a-" e "bytes=-n" (uma faixa só). Devolve { start, end } ou null quando a faixa é inválida.
function lerFaixa(cabecalho, tamanho) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(cabecalho).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { // últimos n bytes
    const n = +m[2];
    if (!n) return null;
    start = Math.max(0, tamanho - n); end = tamanho - 1;
  } else {
    start = +m[1]; end = m[2] === '' ? tamanho - 1 : Math.min(+m[2], tamanho - 1);
  }
  if (start > end || start >= tamanho) return null;
  return { start, end };
}

// guard(p): lança fora das pastas abertas; realDentro(p): o caminho REAL também está dentro; comLimite(promessa): teto de
// tempo (devolve null no estouro). Todos vêm do registerDevCode, que é quem sabe quais pastas estão abertas.
function criarManipulador({ guard, realDentro, comLimite = p => p }) {
  return async req => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return resposta(405, 'Método não permitido');
      const url = new URL(req.url);
      if (url.hostname !== HOST) return resposta(404, 'Não encontrado');
      let alvo;
      try { alvo = decodeURIComponent(url.pathname.slice(1)); } catch { return resposta(400, 'Endereço inválido'); }
      if (!alvo || alvo.includes('\0') || !path.isAbsolute(alvo)) return resposta(400, 'Endereço inválido');
      const tipo = mimeDe(alvo);
      if (!tipo) return resposta(403, 'Tipo de arquivo não servido');
      let completo;
      try { completo = guard(alvo); } catch { return resposta(403, 'Caminho fora das pastas abertas'); }
      let dentro;
      try { dentro = await comLimite(realDentro(completo)); } catch (e) { return resposta(e && e.code === 'ENOENT' ? 404 : 403, 'Arquivo não encontrado'); }
      if (!dentro) return resposta(403, 'Caminho fora das pastas abertas');
      const st = await fs.promises.stat(completo);
      if (!st.isFile()) return resposta(404, 'Arquivo não encontrado');
      const cab = { 'content-type': tipo, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };
      const pedida = req.headers.get('range');
      let faixa = null;
      if (pedida) {
        faixa = lerFaixa(pedida, st.size);
        if (!faixa) return new Response(null, { status: 416, headers: { ...cab, 'content-range': `bytes */${st.size}` } });
      }
      const start = faixa ? faixa.start : 0;
      const end = faixa ? faixa.end : st.size - 1;
      const comprimento = st.size ? end - start + 1 : 0;
      const headers = { ...cab, 'content-length': String(comprimento), ...(faixa ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) };
      if (req.method === 'HEAD' || !st.size) return new Response(null, { status: faixa ? 206 : 200, headers });
      return new Response(Readable.toWeb(fs.createReadStream(completo, { start, end })), { status: faixa ? 206 : 200, headers });
    } catch {
      return resposta(500, 'Erro ao ler o arquivo');
    }
  };
}

// Subquadros (iframe) que a janela da IDE aceita navegar: o protocolo de mídia (PDF), about:blank/srcdoc (o HTML da
// visualização, sem permissão de navegar) e o visualizador de PDF do próprio Chromium. Qualquer outro endereço num subquadro é
// barrado (defesa em profundidade além da CSP frame-src).
const VISUALIZADOR_PDF = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
function quadroPermitido(url) {
  const u = String(url || '');
  return u === 'about:blank' || u === 'about:srcdoc' || u.startsWith(`${ESQUEMA}://${HOST}/`) || u.startsWith(VISUALIZADOR_PDF);
}

// Registra o manipulador SÓ na sessão padrão (a da janela da IDE). Nunca em fromPartition: o Rendra Browser fica de fora.
function registrarProtocoloMidia({ session }, manipulador) {
  session.defaultSession.protocol.handle(ESQUEMA, manipulador);
}

module.exports = { criarManipulador, registrarProtocoloMidia, esquemasPrivilegiados, lerFaixa, quadroPermitido };

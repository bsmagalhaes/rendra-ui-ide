/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Clipboard do sistema, só o que o explorador precisa saber: se há arquivos copiados e uma "assinatura" do conteúdo, para
// decidir quem vence no Ctrl+V (a cópia interna do explorador ou a do sistema). Os caminhos dos arquivos NUNCA saem daqui:
// quem os lê é o evento paste/drop do renderer, pelo webUtils no preload (os dois valem nos três sistemas, porque é o
// Chromium que preenche clipboardData.files). No Electron 44 clipboard.read() lista os tipos do formato nativo (Windows:
// text/uri-list e "FileName"; macOS e Linux não foram exercitados). Nunca lança: erro vira "sem arquivos" / assinatura vazia.
const crypto = require('crypto');

const FORMATOS_DE_ARQUIVO = /^(text\/uri-list|electron application\/osclipboard;format="(FileNameW?|CF_HDROP|HDROP|public\.file-url|x-special\/gnome-copied-files|NSFilenamesPboardType)")$/;

async function tiposDoClipboard(clipboard) {
  try {
    const itens = await clipboard.read();
    return { itens: itens || [], tipos: (itens || []).flatMap(i => Array.from(i.types || []).map(String)) };
  } catch {
    return { itens: [], tipos: [] };
  }
}

// Há arquivos copiados no sistema (Explorer, Finder, gerenciador do Linux)?
async function temArquivos(clipboard) {
  try {
    const { tipos } = await tiposDoClipboard(clipboard);
    return tipos.some(t => FORMATOS_DE_ARQUIVO.test(t));
  } catch {
    return false;
  }
}

// Impressão digital do que está no clipboard agora: tipos + texto + lista de arquivos (copiar OUTROS arquivos no Explorer
// não muda os tipos nem o texto; a lista entra por isso). Só compara igual ou diferente; não guarda conteúdo.
async function assinatura(clipboard) {
  const h = crypto.createHash('sha1');
  try {
    const { itens, tipos } = await tiposDoClipboard(clipboard);
    h.update(tipos.join('\n'));
    try { h.update(`\u0000${String(await clipboard.readText())}`); } catch { /* sem texto */ }
    for (const item of itens) {
      if (!Array.from(item.types || []).includes('text/uri-list')) continue;
      try { h.update(`\u0000${await (await item.getType('text/uri-list')).text()}`); } catch { /* sem lista */ }
    }
  } catch { /* clipboard indisponível */ }
  return h.digest('hex');
}

module.exports = { temArquivos, assinatura, FORMATOS_DE_ARQUIVO };

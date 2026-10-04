/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Detecta imagem na área de transferência pela API do Electron 44 (clipboard.read(), que devolve itens com
// `types`). O clipboard.availableFormats() das versões antigas não existe mais e fazia o Ctrl+V do terminal
// falhar. Nunca lança: erro de leitura vale como "sem imagem", e o terminal cola o texto.
async function temImagem(clipboard) {
  try {
    const itens = await clipboard.read();
    return Array.isArray(itens) && itens.some(i => Array.isArray(i.types) && i.types.includes('image/png'));
  } catch {
    return false;
  }
}

module.exports = { temImagem };

/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Decide de onde o app se atualiza. Função pura, para ter teste (main.js só aplica o resultado).
//   git     clone com `git clone` + `npm install` (src/git-updater.js)
//   updater instalador (NSIS, AppImage, deb, zip do mac) pelo electron-updater e o GitHub Releases
//   store   pacote da Microsoft Store: a Store atualiza, o app não baixa nada
//   none    pasta sem .git e sem empacotar: sem atualização
function selectUpdateSource({ isPackaged, windowsStore, isClone }) {
  if (!isPackaged) return isClone ? 'git' : 'none';
  if (windowsStore) return 'store';
  return 'updater';
}

// Estado que o main.js mostra antes de qualquer verificação
function initialState(source) {
  if (source === 'store' || source === 'none') return { state: 'idle', mode: source };
  return { state: 'idle' };
}

// "Nova versão" só instala nos modos que têm origem própria
function canInstall(source) {
  return source === 'git' || source === 'updater';
}

module.exports = { selectUpdateSource, initialState, canInstall };

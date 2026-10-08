// Monta o registerDevCode com ipcMain e store falsos e abre as raízes dadas como workspaces (é assim que o app as
// coloca entre as pastas permitidas). Os testes chamam os handlers reais e afirmam o disco.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerDevCode } = require('../../src/devcode');

const pastas = [];
const pasta = () => { const p = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-'))); pastas.push(p); return p; };
const limpar = () => pastas.forEach(p => fs.rmSync(p, { recursive: true, force: true }));

function montar(raizes, { deps = {} } = {}) {
  const lista = [].concat(raizes);
  const handlers = new Map();
  const dados = new Map([['devcode.workspaces', { list: lista.map((root, i) => ({ name: `w${i}`, root })), active: 0 }]]);
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: k => dados.get(k), set: (k, v) => dados.set(k, v), delete: k => dados.delete(k) };
  const devcode = registerDevCode({ ipcMain, dialog: {}, store, getWindow: () => null, deps });
  handlers.get('dev:load-workspaces')({});
  return { devcode, handlers, call: (nome, ...args) => handlers.get(nome)({}, ...args) };
}

module.exports = { montar, pasta, limpar };

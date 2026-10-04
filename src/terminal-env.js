/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Ambiente do pty e abertura de links do terminal. Puro (sem Electron), testável no node.

// Só http e https saem do terminal para o navegador do sistema. Qualquer outro esquema (file:,
// javascript:, data:, ms-settings:, etc.) é recusado. Devolve a URL normalizada ou null.
function urlWebSegura(valor) {
  if (typeof valor !== 'string' || valor.length > 8192 || /[\u0000-\u001f\u007f]/.test(valor)) return null;
  let u;
  try { u = new URL(valor.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // user:senha@host é o disfarce clássico de link enganoso (https://banco.com@mal.com): recusa
  if (u.username || u.password) return null;
  return u.href;
}

// Programas no WSL abrem o navegador por xdg-open, $BROWSER ou wslview, que a distro costuma não
// ter. No terminal WSL, o $BROWSER aponta para o explorer.exe do Windows (interop do WSL), que abre
// a URL no navegador padrão do Windows. A URL chega como um único argumento (nunca por texto de
// shell), e o WSLENV leva a variável para dentro da distro. Nada é instalado na distro, e um
// BROWSER que o usuário já definiu (no Windows ou no perfil da distro) continua valendo.
const BROWSER_NO_WSL = 'explorer.exe';

function ambientePty(base, { wsl } = {}) {
  const env = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  if (!wsl) return env;
  const achar = nome => Object.keys(env).find(k => k.toUpperCase() === nome);
  if (achar('BROWSER')) return env; // o usuário já escolheu
  env.BROWSER = BROWSER_NO_WSL;
  const kWslenv = achar('WSLENV') || 'WSLENV';
  const atual = String(env[kWslenv] || '').split(':').filter(Boolean);
  if (!atual.some(i => i.split('/')[0].toUpperCase() === 'BROWSER')) atual.push('BROWSER/u');
  env[kWslenv] = atual.join(':');
  return env;
}

module.exports = { urlWebSegura, ambientePty };

/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
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
// ter. No terminal WSL, o $BROWSER aponta para src/wsl-abrir-url.sh, um script da IDE que recebe a URL
// como único argumento (o Claude Code faz execFile($BROWSER, [url])) e a entrega inteira ao navegador
// padrão do Windows por rundll32 url.dll,FileProtocolHandler. O explorer.exe não serve: lê `=` e `,`
// da linha de comando como separadores e abre uma pasta. O WSLENV leva a variável com /p, e o WSL
// converte o caminho do Windows para /mnt/.... O script fica fora do asar (asarUnpack de src/**).
// Nada é instalado na distro, e um BROWSER que o usuário já definiu continua valendo.
const path = require('path');
function caminhoAbridorUrl(dir = __dirname) {
  return path.join(dir.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'wsl-abrir-url.sh');
}

// `marca`: token aleatório do terminal (RENDRA_TERM). Quem herda a marca nasceu daquele terminal, e é assim que a IDE
// encontra, ao fechar, a sessão Linux dele (src/encerrar-proc.js). No WSL ela atravessa pelo WSLENV.
const MARCA = /^[0-9a-f]{16,64}$/;

function ambientePty(base, { wsl, marca } = {}) {
  const env = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  const achar = nome => Object.keys(env).find(k => k.toUpperCase() === nome);
  const levar = (nome, modo = 'u', forcar = false) => { // o WSLENV leva a variável do Windows para dentro da distro: /u texto, /p caminho convertido
    const kWslenv = achar('WSLENV') || 'WSLENV';
    const atual = String(env[kWslenv] || '').split(':').filter(Boolean);
    const i = atual.findIndex(x => x.split('/')[0].toUpperCase() === nome);
    if (i < 0) atual.push(`${nome}/${modo}`);
    else if (forcar) atual[i] = `${nome}/${modo}`; // um BROWSER/u antigo não converteria o caminho
    env[kWslenv] = atual.join(':');
  };
  if (typeof marca === 'string' && MARCA.test(marca)) {
    env.RENDRA_TERM = marca;
    if (wsl) levar('RENDRA_TERM');
  }
  if (!wsl) return env;
  if (achar('BROWSER')) return env; // o usuário já escolheu
  env.BROWSER = caminhoAbridorUrl();
  levar('BROWSER', 'p', true);
  return env;
}

module.exports = { urlWebSegura, ambientePty, caminhoAbridorUrl };

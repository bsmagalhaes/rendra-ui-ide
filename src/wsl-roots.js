/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Onde os agentes gravam as sessões depende do sistema do TERMINAL, não do da IDE: quem abre o
// terminal WSL no Windows roda o Claude Code e o Codex dentro da distro, e os arquivos ficam em
// /home/<usuário>/.claude/projects e /home/<usuário>/.codex/sessions. Daqui o Windows os alcança
// pelo caminho UNC //wsl.localhost/<distro>/home/<usuário>/... (no Windows, com barras invertidas)
// Descoberta: distros de `wsl -l -v` (sem docker-desktop), só as que estão em execução (ler uma
// distro parada pelo UNC a acordaria); em cada uma, as pastas de /home e /root que têm
// .claude/projects ou .codex/sessions. Falha silenciosa, com cache e tempo limite total (timeoutMs, 6 s) sobre a descoberta inteira: a listagem de distros e o acesso UNC.

const fs = require('fs');
const path = require('path');

const VAZIO = () => ({ claude: [], codex: [] });
let cache = null; // { at, value }
const _limpaCache = () => { cache = null; };

const uncPadrao = distro => ['', '', 'wsl.localhost', distro].join(path.win32.sep);
// assíncrono (fs.promises, thread pool): um UNC travado não congela o processo que chama
const existe = async p => { try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; } };
const nomes = async p => { try { return await fs.promises.readdir(p); } catch { return []; } };

async function varre(raiz) {
  const out = VAZIO();
  const homes = [path.join(raiz, 'root'), ...(await nomes(path.join(raiz, 'home'))).map(u => path.join(raiz, 'home', u))];
  for (const h of homes) {
    const c = path.join(h, '.claude', 'projects');
    const x = path.join(h, '.codex', 'sessions');
    if (await existe(c)) out.claude.push(c);
    if (await existe(x)) out.codex.push(x);
  }
  return out;
}

async function descobre({ listDistros, uncRoot }) {
  const out = VAZIO();
  let distros;
  try { distros = await listDistros(); } catch { return out; }
  for (const d of distros || []) {
    if (!/^running$/i.test(d.state)) continue;
    const r = await varre(uncRoot(d.name));
    out.claude.push(...r.claude);
    out.codex.push(...r.codex);
  }
  return out;
}

// deps (testes): platform, listDistros, uncRoot, ttl, timeoutMs
async function wslRoots(deps = {}) {
  if ((deps.platform || process.platform) !== 'win32') return VAZIO();
  const ttl = deps.ttl ?? 60000;
  if (ttl && cache && Date.now() - cache.at < ttl) return cache.value;
  const listDistros = deps.listDistros || (() => require('./setup').listWslDistros(4000));
  // O timer NÃO pode ter unref: ele é o que mantém o laço de eventos vivo enquanto a descoberta
  // está pendurada (wsl.exe ou UNC travado); sem ele, no Linux o processo encerra com a promessa
  // pendente. Quando a descoberta termina antes, o timer é cancelado.
  let t;
  const limite = new Promise(r => { t = setTimeout(() => r(VAZIO()), deps.timeoutMs ?? 6000); });
  let value;
  try { value = await Promise.race([descobre({ listDistros, uncRoot: deps.uncRoot || uncPadrao }), limite]); }
  finally { clearTimeout(t); }
  if (ttl) cache = { at: Date.now(), value };
  return value;
}

module.exports = { wslRoots, _limpaCache, varre, uncPadrao };

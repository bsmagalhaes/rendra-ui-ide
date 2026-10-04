/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Quais provedores (Claude Code, Codex) estão instalados no ambiente do terminal: "instalado" é o binário
// responder `--version` com saída 0, nunca a pasta .claude/.codex e nunca `command -v` (o shim do Codex na
// distro resolve no PATH e não roda). Nada é montado com dado externo: os nomes e os argumentos são literais,
// a distro só entra depois de passar pela regra de nome e vai como argumento de `execFile`, sem shell.
//   Windows: `where.exe <binário>` acha o caminho; .exe roda direto; .cmd/.bat (o Codex é shim do npm) roda por
//            cmd.exe /d /s /c com o caminho validado, porque execFile de .cmd sem shell lança EINVAL.
//   Distro:  wsl.exe -d <distro> -e bash -lic 'command <binário> --version' (shell interativo de login carrega
//            .bashrc e nvm; `command` pula a função claude() do .bashrc).
// Tempo limite por sondagem, as duas em paralelo, cache de 60 s por ambiente. Falha ou estouro = não instalado.

const { execFile } = require('child_process');

const PROVEDORES = ['claude', 'codex'];
const NAO = () => ({ claude: false, codex: false });
const cache = new Map(); // ambiente -> { at, promessa }
const _limpaCache = () => cache.clear();

// execFile promissificado; sempre resolve, nunca lança
const executarPadrao = timeout => (file, args, opts = {}) => new Promise(resolve => {
  try {
    execFile(file, args, { windowsHide: true, timeout, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1024 * 1024, ...opts },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  } catch { resolve({ ok: false, stdout: '' }); }
});

const NOME_DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CAMINHO_WIN = /^[A-Za-z]:\\[^&|<>^"%\r\n]+$/;

async function sondarWindows(nome, executar, platform) {
  const w = await executar(platform === 'win32' ? 'where.exe' : 'which', [nome]);
  if (!w.ok) return false;
  const linhas = w.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (platform !== 'win32') {
    const p = linhas.find(l => l.startsWith('/'));
    return p ? (await executar(p, ['--version'])).ok : false;
  }
  const caminho = linhas.find(l => CAMINHO_WIN.test(l) && /\.(exe|cmd|bat)$/i.test(l));
  if (!caminho) return false;
  if (/\.exe$/i.test(caminho)) return (await executar(caminho, ['--version'])).ok;
  return (await executar('cmd.exe', ['/d', '/s', '/c', `""${caminho}" --version"`], { windowsVerbatimArguments: true })).ok;
}

const sondarWsl = (distro, nome, executar) => executar('wsl.exe', ['-d', distro, '-e', 'bash', '-lic', `command ${nome} --version`]).then(r => r.ok);

// amb: { tipo: 'windows' | 'wsl', distro } de ambienteDoTerminal; distroRodando: falso não acorda a distro
// deps (testes): executar, platform, timeoutMs, ttl, agora
async function detectar({ amb, distroRodando = true, deps = {} } = {}) {
  if (!amb || (amb.tipo !== 'windows' && amb.tipo !== 'wsl')) return NAO();
  if (amb.tipo === 'wsl' && (!distroRodando || typeof amb.distro !== 'string' || !NOME_DISTRO.test(amb.distro))) return NAO();
  const agora = deps.agora || Date.now;
  const ttl = deps.ttl ?? 60000;
  const chave = amb.tipo === 'wsl' ? `wsl:${amb.distro.toLowerCase()}` : 'local';
  const salvo = cache.get(chave);
  if (ttl && salvo && agora() - salvo.at < ttl) return salvo.promessa;

  const timeoutMs = deps.timeoutMs ?? 6000;
  const executar = deps.executar || executarPadrao(timeoutMs);
  const platform = deps.platform || process.platform;
  // o executor pendurado também não segura a detecção: o tempo é imposto aqui além do de execFile
  const comTempo = p => new Promise(resolve => {
    const t = setTimeout(() => resolve(false), timeoutMs + 500);
    p.then(v => { clearTimeout(t); resolve(!!v); }, () => { clearTimeout(t); resolve(false); });
  });
  const promessa = Promise.all(PROVEDORES.map(nome => comTempo(amb.tipo === 'wsl' ? sondarWsl(amb.distro, nome, executar) : sondarWindows(nome, executar, platform))))
    .then(([claude, codex]) => ({ claude, codex }));
  if (ttl) cache.set(chave, { at: agora(), promessa });
  return promessa;
}

module.exports = { detectar, _limpaCache };

/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Escolha do terminal ao abrir um novo: o shell do seletor da barra decide o ambiente. PowerShell e CMD só existem
// no Windows e abrem direto; o Bash existe nos dois ambientes (Git Bash no Windows, Bash em cada distro do WSL) e é
// o único que pergunta. O projeto só traduz a pasta e diz qual opção vem focada. Carregado no renderer
// (window.RendraTermEscolha) e nos testes (require).
(function (root) {
  // Chave do seletor da barra que vale "Bash no WSL" quando não há Git Bash. Nunca chega ao pty:create: o renderer a
  // traduz para wsl:<distro>. Não colide com a chave 'bash' do macOS e do Linux.
  const CHAVE_BASH_WSL = 'bash-wsl';
  // O CMD só recebe esta linha (constante) e o caminho vai pela variável abaixo: nenhum caminho entra na linha de comando
  const VAR_PASTA_CMD = 'RENDRA_CMD_PASTA';
  const MSG_CMD_UNC = 'O CMD não abre nesta pasta: o caminho está no WSL e não há letra de unidade disponível. Use o PowerShell ou o Bash.';

  const distrosDe = wslInfo => (wslInfo && wslInfo.available && Array.isArray(wslInfo.distros) ? wslInfo.distros : []);
  const rotuloWsl = nome => `Bash (WSL ${nome})`;

  // Lista do seletor da barra: o que o pty:shells devolve mais, no Windows sem Git Bash e com distro, a entrada Bash
  // (que abre no WSL). Fora do Windows devolve a lista como veio.
  function shellsDoSeletor(shells, wslInfo, plataforma) {
    const lista = Array.isArray(shells) ? shells.slice() : [];
    if (plataforma !== 'win32' || !distrosDe(wslInfo).length || lista.some(s => s.key === 'gitbash')) return lista;
    const entrada = { key: CHAVE_BASH_WSL, label: 'Bash' };
    const i = lista.findIndex(s => s.key === 'cmd');
    if (i < 0) lista.push(entrada); else lista.splice(i, 0, entrada);
    return lista;
  }

  // Decide o que o "novo terminal" faz. Devolve { direto, opcoes, foco }: `direto` é o shell a abrir sem perguntar
  // (ou null); senão `opcoes` é o menu ([{ shell, label }]) e `foco` o índice da opção que vem focada (a do ambiente do
  // projeto). Entradas: shell escolhido na barra, resposta de dev:wsl-info, lista do seletor, distro do projeto
  // (ws.root.wsl?.distro ou nula) e a plataforma (process.platform).
  function opcoesDeTerminal({ shell, wslInfo, shells, distroProjeto, plataforma } = {}) {
    const lista = Array.isArray(shells) ? shells : [];
    const escolhido = lista.some(s => s.key === shell) ? shell : (lista[0] ? lista[0].key : (shell || ''));
    const nada = { opcoes: [], foco: 0 };
    const distros = plataforma && plataforma !== 'win32' ? [] : distrosDe(wslInfo);
    const bashWindows = escolhido === 'gitbash';
    if (!distros.length || (!bashWindows && escolhido !== CHAVE_BASH_WSL)) return { direto: escolhido, ...nada };
    const doWsl = distros.map(d => ({ shell: `wsl:${d.name}`, label: rotuloWsl(d.name) }));
    const temGitBash = lista.some(s => s.key === 'gitbash');
    const opcoes = temGitBash ? [{ shell: 'gitbash', label: 'Git Bash (Windows)' }, ...doWsl] : doWsl;
    if (opcoes.length === 1) return { direto: opcoes[0].shell, ...nada };
    const i = distroProjeto ? doWsl.findIndex(o => o.shell.slice(4).toLowerCase() === String(distroProjeto).toLowerCase()) : -1;
    const padrao = temGitBash ? 0 : Math.max(0, distros.findIndex(d => d.isDefault));
    return { direto: null, opcoes, foco: i >= 0 ? i + (temGitBash ? 1 : 0) : padrao };
  }

  // Pasta do Windows vista de dentro do WSL: "C:\a\b" vira "/mnt/c/a/b". null se não for caminho de unidade.
  function caminhoNoWsl(winPath) {
    const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(String(winPath || ''));
    if (!m) return null;
    const resto = m[2].replace(/[\\/]+/g, '/').replace(/\/$/, '');
    return `/mnt/${m[1].toLowerCase()}${resto ? '/' + resto : ''}`;
  }

  // O sentido contrário: "/mnt/c/a/b" vira "C:\a\b". Só /mnt/<uma letra> ou /mnt/<letra>/...; qualquer outro caminho
  // (/mnt/wsl, /mnt/c2, /home/...) devolve null.
  function caminhoNoWindows(linuxPath) {
    const m = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(String(linuxPath || ''));
    if (!m) return null;
    const resto = (m[2] || '').replace(/\/+$/, '').replace(/\//g, '\\');
    return `${m[1].toUpperCase()}:${resto || '\\'}`;
  }

  // Argumentos do cmd.exe para entrar numa pasta UNC (string pronta, o node-pty a entrega sem alterar). A linha é
  // constante: o caminho vai pela variável de ambiente VAR_PASTA_CMD, nunca dentro dela, porque o CMD expande %VAR%
  // mesmo entre aspas. /V:OFF desliga a expansão por "!". Se o pushd falha, o terminal fica aberto com a mensagem.
  const argsCmdUnc = () => `/V:OFF /k pushd "%${VAR_PASTA_CMD}%" || echo ${MSG_CMD_UNC}`;

  const aspasSh = s => s.replace(/'/g, "'\\''");
  const aspasPs = s => s.replace(/'/g, "''");
  const ehUnc = p => /^\\\\/.test(String(p || ''));

  // Comando digitado num terminal vivo para entrar na pasta do projeto (`root`: { root, wsl? }), conforme o ambiente
  // do PRÓPRIO terminal ({ shellKey, distro }). O projeto só traduz o caminho. Termina em \r.
  function comandoEntrarNaPasta({ shellKey, distro, root } = {}) {
    const p = root && root.root;
    if (!p) return '';
    const wsl = root.wsl && root.wsl.linuxPath ? root.wsl : null;
    switch (shellKey) {
      case 'gitbash': return `cd "$(cygpath -u '${aspasSh(p)}')"\r`;
      case 'cmd': {
        if (!ehUnc(p)) return `cd /d "${p}"\r`;
        const unidade = wsl ? caminhoNoWindows(wsl.linuxPath) : null;
        if (unidade) return `cd /d "${unidade}"\r`;
        // pushd mapeia uma letra temporária; "%", "!" e aspas no caminho não entram no comando digitado
        return /[%!"]/.test(p) ? `echo ${MSG_CMD_UNC}\r` : `pushd "${p}" || echo ${MSG_CMD_UNC}\r`;
      }
      case 'wsl': {
        const mesma = wsl && (!distro || String(wsl.distro).toLowerCase() === String(distro).toLowerCase());
        if (mesma) return `cd '${aspasSh(wsl.linuxPath)}'\r`;
        if (ehUnc(p)) return 'cd ~\r'; // UNC de outra distro: o wslpath não resolve
        return `cd "$(wslpath '${aspasSh(p)}')"\r`;
      }
      case 'powershell': return `Set-Location -LiteralPath '${aspasPs(p)}'\r`;
      default: return `cd '${aspasSh(p)}'\r`; // macOS / Linux (zsh, bash, fish…)
    }
  }

  const api = { opcoesDeTerminal, shellsDoSeletor, caminhoNoWsl, caminhoNoWindows, argsCmdUnc, comandoEntrarNaPasta, CHAVE_BASH_WSL, VAR_PASTA_CMD, MSG_CMD_UNC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraTermEscolha = api;
})(typeof window !== 'undefined' ? window : this);

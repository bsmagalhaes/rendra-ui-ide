/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Conteúdo da página "Comandos" (módulo puro, sem DOM): atalhos do terminal, comandos do Claude Code e do Codex e
// atalhos da IDE, por sistema (windows, macos, linux) e por agente (claude, codex). Carregado no renderer
// (window.RendraComandos) e nos testes (require). Tudo em português simples, sem travessão.
//
// Fontes: o comportamento da IDE vem de renderer/terminal-keys.js e renderer/atalhos-ide.js (os testes conferem que as
// teclas daqui são as mesmas); os comandos dos agentes vêm do `--help` e da documentação das versões abaixo. O que
// não foi conferido aparece como "sem equivalente conferido" ou "não conferido", nunca como afirmação.
(function (root) {
  const VERSOES = { claude: '2.1.287', codex: '0.157.1' };
  const SISTEMAS = ['windows', 'macos', 'linux'];
  const AGENTES = ['claude', 'codex'];
  const NOME_SISTEMA = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  const NOME_AGENTE = { claude: 'Claude Code', codex: 'Codex' };
  const SEM_EQUIVALENTE = 'sem equivalente conferido';

  // Cada tecla é um texto; uma combinação é uma lista de teclas; as alternativas são listas de combinações.
  const k = (...teclas) => teclas;

  // ── Atalhos do terminal ──────────────────────────────────────────────────────────────────────────────────
  // `sistema` escolhe as teclas; `agente` só muda a nota de alguns itens (colar imagem, apagar palavra, limpar a tela).
  function itensDoTerminal(sistema, agente) {
    const mac = sistema === 'macos';
    const ctrl = mac ? 'Control' : 'Ctrl';
    const alt = mac ? 'Option' : 'Alt';
    const colarTexto = mac ? [k('Cmd', 'V'), k('Clique direito')] : [k('Ctrl', 'V'), k('Ctrl', 'Shift', 'V'), k('Clique direito')];
    const itens = [];

    itens.push({
      id: 'copiar-marcando', titulo: 'Copiar marcando', teclas: [k('Marcar com o mouse')],
      oQueFaz: 'Marque o texto com o mouse. Ao soltar, ele já está copiado: o realce continua e aparece o aviso "Copiado".',
    });
    itens.push({
      id: 'copiar-teclado', titulo: 'Copiar pelo teclado', teclas: mac ? [k('Cmd', 'C')] : [k('Ctrl', 'Shift', 'C')],
      oQueFaz: mac ? 'Copia o texto marcado, como em qualquer programa do Mac.' : 'Copia o texto marcado. O Ctrl+C sozinho não copia: ele serve para interromper (veja abaixo).',
    });
    itens.push({
      id: 'colar-texto', titulo: 'Colar texto', teclas: colarTexto,
      oQueFaz: 'Cola na hora o que você copiou. Se a área de transferência tiver texto e imagem, cola o texto.',
    });

    // colar imagem: o Claude Code e o Codex leem a imagem sozinhos quando recebem a tecla
    let imagem;
    if (agente === 'codex') {
      imagem = {
        teclas: [k(ctrl, 'V')],
        oQueFaz: `O Codex cola a imagem com ${ctrl}+V, segundo a documentação dele (não conferido aqui, porque o Codex não estava conectado à conta). Só com uma imagem copiada, a IDE entrega esse ${ctrl}+V ao Codex.`,
      };
    } else if (sistema === 'windows') {
      imagem = {
        teclas: [k('Alt', 'V')],
        oQueFaz: 'Cola a imagem copiada no Claude Code. Funciona no PowerShell, no Git Bash e no terminal WSL (no WSL o Ctrl+V também funciona).',
      };
    } else if (mac) {
      imagem = {
        teclas: [k('Control', 'V')],
        oQueFaz: 'Cola a imagem copiada no Claude Code. O Cmd+V cola só texto. Testado por unidade, sem um Mac para a prova completa.',
      };
    } else {
      imagem = {
        teclas: [k('Ctrl', 'V'), k('Alt', 'V')],
        oQueFaz: 'Cola a imagem copiada no Claude Code. Só com uma imagem copiada, os dois atalhos entregam o Ctrl+V a ele.',
      };
    }
    itens.push({ id: 'colar-imagem', titulo: 'Colar imagem', ...imagem });

    const interromper = {
      id: 'interromper', titulo: 'Interromper', teclas: [k(ctrl, 'C', '(3 vezes)')],
      oQueFaz: `Aperte ${ctrl}+C 3 vezes em até 2 segundos para interromper o programa.`,
      detalhes: [
        '1 toque: depois de 1 segundo a IDE cola o que você copiou. O programa não recebe nada.',
        '2 toques: aparece o aviso "aperte mais 1 vez para interromper" e a colagem é cancelada.',
        '3 toques em até 2 segundos: o programa é interrompido (ele recebe um único Ctrl+C).',
        `Com texto marcado, o ${ctrl}+C só mostra "Copiado" e não conta como toque.`,
        'Sem o terceiro toque, nada é enviado e o aviso some.',
      ],
    };
    if (agente === 'claude') interromper.nota = 'No Claude Code, a tecla Esc interrompe a resposta sem usar o Ctrl+C. Para sair, use /exit.';
    else interromper.nota = 'No Codex, um Ctrl+C sem nada rodando pede para apertar de novo para sair. Cada um conta 3 toques na IDE.';
    itens.push(interromper);

    // apagar a palavra anterior: depende do shell (provado com as teclas reais da IDE)
    const apagar = { id: 'apagar-palavra', titulo: 'Apagar a palavra anterior' };
    if (sistema === 'windows') {
      apagar.teclas = [k('Alt', 'Backspace'), k('Ctrl', 'Backspace')];
      apagar.oQueFaz = 'Apaga a palavra antes do cursor.';
      apagar.detalhes = ['Git Bash e terminal WSL: Alt+Backspace.', 'PowerShell: Ctrl+Backspace (o Alt+Backspace não apaga no PowerShell).'];
    } else if (mac) {
      apagar.teclas = [k('Option', 'Delete')];
      apagar.oQueFaz = 'Apaga a palavra antes do cursor no bash. Testado por unidade, sem um Mac para a prova completa.';
    } else {
      apagar.teclas = [k('Alt', 'Backspace')];
      apagar.oQueFaz = 'Apaga a palavra antes do cursor no bash.';
    }
    apagar.nota = agente === 'claude'
      ? `No Claude Code, ${mac ? 'Option+Delete' : 'Ctrl+Backspace'} apaga só a palavra e Ctrl+W apaga até o espaço anterior (segundo a documentação dele, não conferido aqui dentro da IDE).`
      : 'No Codex: não conferido.';
    itens.push(apagar);

    itens.push({
      id: 'limpar-tela', titulo: 'Limpar a tela', teclas: [k(ctrl, 'L')],
      oQueFaz: agente === 'claude' ? 'Limpa a tela do shell. No Claude Code, redesenha a tela sem apagar a conversa.' : 'Limpa a tela do shell. Para começar outra conversa no Codex, use /clear.',
    });
    itens.push({
      id: 'quebrar-linha', titulo: 'Quebrar a linha sem enviar', teclas: [k('Shift', 'Enter')],
      oQueFaz: 'Escreve em várias linhas no prompt do Claude Code e do Codex, sem enviar a mensagem.',
    });
    itens.push({
      id: 'rolar', titulo: 'Rolar', teclas: [k('Roda do mouse'), k(alt, 'Roda do mouse'), k('Shift', 'PageUp'), k('Shift', 'PageDown')],
      oQueFaz: `Rola o histórico do terminal. Com ${alt} a roda rola 5 vezes mais rápido. O PageUp e o PageDown sem Shift vão para o programa. Digitar volta ao fim.`,
    });
    return itens;
  }

  function notasDoTerminal(sistema) {
    if (sistema === 'windows') return ['Terminal WSL dentro do Windows: valem os mesmos atalhos. A diferença é a imagem (no WSL, Alt+V e Ctrl+V colam) e o apagar palavra (Alt+Backspace).'];
    if (sistema === 'macos') return ['No macOS o Option é o do sistema (caracteres especiais), então atalhos do Claude Code que usam o Option como Meta (Alt+B, Alt+F, Alt+D) não funcionam. Cmd+C e Cmd+V são os do sistema.'];
    return [];
  }

  // ── Comandos do Claude Code e do Codex ───────────────────────────────────────────────────────────────────
  // comando: o que digitar no agente escolhido. equivalente: o que fazer no outro agente.
  const COMANDOS = [
    { id: 'entrar', oQueFaz: 'Entra na sua conta.', claude: '/login (ou claude auth no terminal)', codex: 'codex login' },
    { id: 'sair-conta', oQueFaz: 'Sai da conta.', claude: '/logout', codex: 'codex logout (ou /logout)' },
    { id: 'retomar', oQueFaz: 'Volta para uma conversa anterior.', claude: 'claude -c (a mais recente da pasta), claude -r (escolher) ou /resume', codex: 'codex resume (escolher), codex resume --last (a mais recente) ou /resume' },
    { id: 'limpar', oQueFaz: 'Começa uma conversa nova, sem o contexto anterior.', claude: '/clear', codex: '/clear ou /new' },
    { id: 'modelo', oQueFaz: 'Troca o modelo de IA.', claude: '/model', codex: '/model' },
    { id: 'ajuda', oQueFaz: 'Mostra a ajuda.', claude: '/help (ou ? com a linha vazia)', codex: 'digite / para ver a lista, ou codex --help no terminal' },
    { id: 'sair', oQueFaz: 'Fecha o agente.', claude: '/exit, /quit ou Ctrl+D duas vezes', codex: '/quit ou /exit' },
    { id: 'compactar', oQueFaz: 'Resume a conversa para liberar espaço no contexto.', claude: '/compact', codex: '/compact' },
    { id: 'status', oQueFaz: 'Mostra o estado da sessão e o uso.', claude: '/status e /usage', codex: '/status' },
    { id: 'permissoes', oQueFaz: 'Vê e muda o que o agente pode fazer sozinho e os hooks.', claude: '/permissions, /hooks e Shift+Tab (troca o modo)', codex: '/permissions e /hooks' },
    { id: 'iniciar', oQueFaz: 'Cria o arquivo de instruções do projeto.', claude: '/init', codex: '/init' },
  ];

  function itensDoAgente(agente) {
    const outro = agente === 'claude' ? 'codex' : 'claude';
    return COMANDOS.map(c => ({
      id: c.id, oQueFaz: c.oQueFaz, comando: c[agente] || SEM_EQUIVALENTE, equivalente: c[outro] || SEM_EQUIVALENTE, agenteDoEquivalente: NOME_AGENTE[outro],
    }));
  }

  // ── Atalhos da IDE ───────────────────────────────────────────────────────────────────────────────────────
  function itensDaIde(sistema) {
    const mac = sistema === 'macos';
    const c = mac ? 'Cmd' : 'Ctrl';
    return [
      { id: 'novo-terminal', titulo: 'Novo terminal', teclas: [k(c, 'Shift', 'T')], oQueFaz: 'Abre um terminal novo, também com o foco dentro de um terminal.' },
      {
        id: 'abrir-pasta', titulo: 'Abrir pasta', teclas: [k(c, 'O')],
        oQueFaz: mac ? 'Abre uma pasta no workspace, em qualquer lugar. O Control+O vai para o programa.' : 'Abre uma pasta no workspace quando o foco está fora do terminal (explorador, editor). Dentro do terminal, o Ctrl+O vai para o programa.',
      },
      { id: 'proxima-aba', titulo: 'Próxima aba do editor', teclas: [k(mac ? 'Control' : 'Ctrl', 'Tab')], oQueFaz: 'Vai para a próxima aba de arquivo aberta, em círculo.' },
      { id: 'aba-anterior', titulo: 'Aba anterior do editor', teclas: [k(mac ? 'Control' : 'Ctrl', 'Shift', 'Tab')], oQueFaz: 'Volta para a aba de arquivo anterior, em círculo.' },
      { id: 'salvar', titulo: 'Salvar', teclas: [k(c, 'S')], oQueFaz: 'Salva o arquivo aberto no editor.' },
      { id: 'fechar-aba', titulo: 'Fechar aba', teclas: [k(c, 'W')], oQueFaz: 'Fecha a aba do arquivo aberto no editor.' },
      { id: 'dividir', titulo: 'Dividir o editor', teclas: [k(c, '\\')], oQueFaz: 'Divide o editor à direita.' },
      { id: 'atualizar', titulo: 'Atualizar o consumo', teclas: [k(c, 'R')], oQueFaz: 'Atualiza os números de consumo. Nas páginas IDE e Terminal esse atalho vai para o programa.' },
      { id: 'abrir-link', titulo: 'Abrir link do terminal', teclas: [k(c, 'Clique')], oQueFaz: 'Abre o link direto. O clique simples pede uma confirmação antes.' },
      { id: 'renomear', titulo: 'Renomear', teclas: [k('Duplo clique')], oQueFaz: 'Duplo clique no nome de um terminal ou de um workspace para renomear.' },
      {
        id: 'reordenar', titulo: 'Reordenar abas', teclas: [k('Arrastar a aba'), k(mac ? 'Control' : 'Ctrl', 'Shift', 'Seta esquerda'), k(mac ? 'Control' : 'Ctrl', 'Shift', 'Seta direita')],
        oQueFaz: 'Arraste a aba de um projeto, de um terminal ou de um arquivo do editor sobre outra da mesma barra para trocar a ordem. Com o foco numa aba (tecla Tab), o atalho a move um passo. Dentro do terminal e do editor o Ctrl+Shift+Seta continua marcando por palavra.',
      },
      { id: 'esc', titulo: 'Fechar ou cancelar', teclas: [k('Esc')], oQueFaz: 'Fecha menus e cancela a renomeação.' },
      { id: 'enter', titulo: 'Confirmar', teclas: [k('Enter')], oQueFaz: 'Confirma a janela aberta ou a renomeação.' },
    ];
  }

  // ── Montagem ─────────────────────────────────────────────────────────────────────────────────────────────
  function conteudo({ sistema, agente } = {}) {
    if (!SISTEMAS.includes(sistema)) throw new Error(`sistema inválido: ${sistema}`);
    if (!AGENTES.includes(agente)) throw new Error(`agente inválido: ${agente}`);
    return {
      sistema, agente,
      nomeSistema: NOME_SISTEMA[sistema], nomeAgente: NOME_AGENTE[agente], nomeOutroAgente: NOME_AGENTE[agente === 'claude' ? 'codex' : 'claude'],
      versoes: { ...VERSOES },
      blocos: [
        { id: 'terminal', titulo: 'Atalhos do terminal', itens: itensDoTerminal(sistema, agente), notas: notasDoTerminal(sistema) },
        { id: 'agente', titulo: `Comandos do ${NOME_AGENTE[agente]}`, itens: itensDoAgente(agente), notas: [] },
        { id: 'ide', titulo: 'Atalhos da IDE', itens: itensDaIde(sistema), notas: [] },
      ],
    };
  }

  // Escrita das teclas: ["Ctrl","Shift","V"] vira "Ctrl+Shift+V"; as alternativas se juntam com " ou ".
  const combinacao = teclas => teclas.join('+');
  const rotulo = alternativas => alternativas.map(combinacao).join(' ou ');

  // Teclas de um item do terminal ou da IDE pelo id, para os testes de coerência com a decisão de tecla.
  function rotuloDeTecla(id, sistema, agente = 'claude') {
    const todos = [...itensDoTerminal(sistema, agente), ...itensDaIde(sistema)];
    const item = todos.find(i => i.id === id);
    return item ? item.teclas : null;
  }

  const api = { VERSOES, SISTEMAS, AGENTES, NOME_SISTEMA, NOME_AGENTE, SEM_EQUIVALENTE, conteudo, rotuloDeTecla, combinacao, rotulo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraComandos = api;
})(typeof window !== 'undefined' ? window : this);

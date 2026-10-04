# Novidades

## 1.7.0 · 03/10/2026
### Abas
- Arrastar as abas de terminais não funcionava e foi corrigido: arraste uma aba sobre outra e os terminais trocam de lugar, na grade também.
- As abas de projetos e as abas de arquivos do editor agora também se reordenam arrastando. A ordem dos projetos e das abas do editor é salva e volta quando você reabre o app. As abas do editor só trocam de lugar dentro do próprio quadro, e continuam sem renomear.
- O mesmo indicador aparece nas três barras: uma linha laranja marca onde a aba vai cair.
- Pelo teclado: com o foco numa aba, Ctrl+Shift+Seta esquerda ou direita move a aba um passo (o Ctrl+Shift+Seta continua marcando por palavra dentro do terminal e do editor). As abas das três barras agora são alcançadas com a tecla Tab, e a nova posição é anunciada para leitores de tela.
- A página Comandos lista o arraste e o atalho em "Reordenar abas".

## 1.6.0 · 03/10/2026
### Terminal
- O Ctrl+V voltava a não colar (nem texto nem imagem). Foi corrigido.
- Marcar texto com o mouse copia sozinho: o realce continua e aparece "Copiado".
- Ctrl+C agora segue uma regra nova, sem texto marcado: 1 toque cola o que você copiou depois de 1 segundo; 2 toques mostram "aperte mais 1 vez para interromper"; 3 toques em até 2 segundos interrompem o programa. Atenção: para interromper, agora são 3 toques (em programas como o Claude Code, sair com Ctrl+C passa a exigir 3 toques para cada Ctrl+C dele). Com texto marcado, o Ctrl+C só copia e mostra "Copiado".
- O clique direito sempre cola, na hora, e deixou de copiar o texto marcado.
- Alt+V cola imagem no Claude Code do Windows (PowerShell e Git Bash); no WSL, no Linux e no macOS a imagem vai com Ctrl+V (Control+V no Mac). Com texto e imagem copiados juntos, o Ctrl+V cola o texto.
- Alt+Backspace apaga a palavra no Git Bash e no WSL; no PowerShell, use Ctrl+Backspace.
- Com o painel de conversas aberto, Ctrl+C, colar e Alt+V não escrevem no terminal.
### Atalhos e página Comandos
- Atalhos novos: Ctrl+Shift+T abre um terminal (Cmd+Shift+T no Mac), Ctrl+O abre uma pasta quando o foco está fora do terminal (Cmd+O no Mac; dentro do terminal o Ctrl+O continua indo ao programa) e Ctrl+Tab troca de aba do editor (Ctrl+Shift+Tab volta).
- A página Comandos, na barra lateral acima de Novidades, lista os atalhos do terminal e da IDE e os comandos do Claude Code e do Codex, por sistema (Windows, macOS, Linux) e por agente, com o equivalente de cada comando no outro agente.

## 1.5.0 · 03/10/2026
### Conversas do terminal
- Ao abrir um terminal numa pasta, a IDE mostra as 10 conversas mais recentes do Claude Code e do Codex daquela pasta, da mais nova para a mais antiga, com o ícone do provedor, o título (o nome salvo ou o começo da conversa) e a data. Clicar numa delas retoma a conversa ali mesmo. "Ver todas" lista as demais.
- Abaixo da lista, "Nova conversa no Claude" e "Nova conversa no Codex" iniciam uma conversa nova, e "Só o terminal" (ou Esc) deixa o terminal puro. Só aparecem os provedores que respondem no sistema daquele terminal (Windows ou a distro do WSL); sem nenhum deles, o terminal abre direto, como antes.
- Pasta sem conversa anterior mostra só as opções de nova conversa, e o terminal avulso (sem pasta) não mostra nada. A IDE só guarda o título e a data na memória, nunca em disco, e escreve no terminal apenas o comando fixo de retomar com o identificador da conversa.
- Se a IDE não conseguir conferir quais provedores estão instalados naquele sistema, mas houver conversas gravadas, o painel mostra um aviso curto e a opção "Só o terminal", em vez de sumir sem explicar.

## 1.4.0 · 03/10/2026
### Terminal
- No Windows, o terminal passa a usar o ConPTY embarcado (o que acompanha o node-pty), no lugar do que vem no sistema. Com ele, programas de terminal como o Codex conseguem detectar as cores do terminal (consulta OSC 10 e 11), e o campo de digitação e as mensagens enviadas voltam a ser pintados. Vale para PowerShell e para o WSL; a resposta chega em poucos milissegundos.
- De brinde, no WSL colar um texto grande agora chega inteiro, e a saída longa (listas, logs, diffs) aparece de 2 a 4 vezes mais rápido.
- No Git Bash a cor continua não sendo detectada: é uma limitação do próprio Git Bash, que consome a consulta antes de ela chegar ao terminal.
- Se notar algo estranho, desligue a opção "Terminal moderno do Windows (ConPTY embarcado)" nas Configurações; ela vale para terminais abertos depois. No Linux e no macOS nada muda.
### Barra de título com provedor, conta e e-mail
- A barra de título ganhou um seletor de provedor e ambiente (por exemplo "Claude (Windows)", "Claude (Ubuntu-24.04)", "Codex (Ubuntu-24.04)"). Ele lista cada combinação que tem conta ou limites e só aparece quando há duas ou mais opções; com uma só, a barra mostra apenas a conta. A escolha fica lembrada entre as aberturas (na primeira vez vale o Claude). Se o ambiente escolhido sumir por um momento, por exemplo uma distro parada, a barra usa o padrão sem apagar a escolha.
- Antes dos limites aparecem o nome da organização (sem organização, o nome da pessoa) e o e-mail da conta, com o e-mail completo no tooltip. Isso substitui a regra antiga de nunca mostrar o e-mail na barra.
- O limite semanal do Codex aparece na barra, lido a cada 60 segundos por um canal leve que olha só os rollouts mais recentes (não o histórico todo) e não toca em nenhum token. Hoje o Codex informa só a janela semanal; uma janela de 5 horas, se vier, entra no mesmo lugar do Claude. O Codex também fica em cinza quando o dado tem mais de 15 minutos.
- Quando falta largura, a barra tira primeiro o e-mail (antes, ele ganha reticências), depois o nome da organização, e por fim o seletor passa a mostrar só "Claude" ou "Codex" (o ambiente vai para o tooltip), com a barra de progresso mais curta. Os limites nunca somem.
- Com conta e sem limites a barra agora fica visível, com a conta e o texto "sem dados"; antes ela sumia. Sem conta e sem limites ela continua escondida.
- Limites conhecidos: o Claude em uma distro WSL mostra só a identidade da conta ("sem dados" nos limites), porque a ponte da statusline só é instalada no Windows. Uma distro só aparece se tiver `.claude/projects` ou `.codex/sessions`.
### Links no terminal
- Clicar num link do terminal (clique simples) agora mostra a confirmação "Abrir link?" com o endereço completo e três opções: "Abrir no Rendra Browser", "Abrir no navegador padrão" (Enter) e "Cancelar" (Esc também cancela). Ctrl+clique (Cmd+clique no Mac) continua abrindo direto, e arrastar para selecionar um texto que contém link não dispara a confirmação.
- O Rendra Browser é uma janela própria e isolada para ver a página: sem acesso à IDE, sessão separada que não guarda nada, só http e https, downloads e permissões (câmera, microfone, notificações, localização) negados, e links que abririam janela nova abrem na mesma janela. Tem barra mínima com voltar, avançar, recarregar, endereço e "Abrir no navegador padrão".
- Corrigido: ao clicar num link do terminal aparecia ao mesmo tempo o diálogo em inglês do xterm, uma janela nova da IDE e o navegador. Agora a IDE nega janelas e navegações que ninguém pediu e só abre o link pelo caminho que você escolheu na confirmação.
- Caminhos de arquivo no texto do terminal (como docs/specs/plano.md, ./src/app.js:12, D:\pasta\arquivo.md ou /mnt/d/projeto/arquivo.md) ficam clicáveis quando o arquivo existe dentro das pastas abertas: o clique abre o arquivo no editor da lateral, na linha indicada, sem confirmação. Pasta é revelada no explorador. No WSL, o caminho Linux abre o mesmo arquivo. Caminho que não existe não vira link.
- Segurança: o editor também não abre mais arquivo lido por junção ou link simbólico que aponte para fora das pastas abertas, e o Rendra Browser desfaz uma navegação da página para `about:blank` (só http e https).

### RTK e Codex
- Ativar o RTK no Codex agora já deixa o hook aprovado: não é mais preciso abrir o Codex e aprová-lo à mão. A IDE registra a aprovação só do hook do RTK, no mesmo passo da ativação, com cópia de segurança e desfazendo tudo se algo falhar. Se o Codex estiver aberto, feche e abra de novo.
- A página RTK mostra se o hook do Codex está aprovado, foi alterado ou ainda espera aprovação. O aviso só aparece quando falta aprovar e diz o caminho: no Codex, digite /hooks, entre em PreToolUse e aperte t no hook do RTK.
- No Linux e no WSL, quando o Codex já está no modo que deixa ele gravar arquivos só dentro dos seus projetos (chamado workspace-write), a IDE libera sozinha a pasta do banco do RTK para ele registrar a economia. Ela nunca muda o modo do Codex e não faz isso no Windows.
- O "Status da instalação" mostra só o Claude Code e o Codex, por sistema, com o estado do Codex; OpenCode, Cursor e o CLAUDE.md local saíram.
- O aviso sobre o RTK antigo do WinGet some quando o RTK da IDE é o primeiro no PATH e os hooks usam o caminho dele.

## 1.3.1 · 03/10/2026
### Instalador do Mac
- O instalador do Mac chega para Apple Silicon (`Rendra-IDE-mac-arm64.dmg`) e Intel (`Rendra-IDE-mac-x64.dmg`), assinado e notarizado pela Apple, na página de Releases do GitHub e no site. Ele se atualiza sozinho, como os de Windows e Linux.
### Editor
- Arquivos `.env` (`.env`, `.env.local`, `.env.example`, `producao.env` e parecidos) abrem com realce de cores: a chave em laranja, o valor em verde, os comentários em cinza itálico, o `=` e o `export` discretos e a interpolação `${VAR}` em amarelo. É só cor: os valores continuam visíveis e nada é mascarado.
### Links e navegador no terminal
- Links do terminal (`http` e `https` no texto e hyperlinks do próprio programa) abrem no navegador padrão com Ctrl+clique (Cmd+clique no Mac); ao passar o mouse sobre o link, aparece a dica. Só `http` e `https` abrem: `file:`, `javascript:` e outros esquemas são recusados, e hyperlinks com `file:` aparecem como texto comum, sem sublinhado. Links com usuário e senha na URL (`https://a.com@b.com`) também são recusados.
- No terminal WSL, programas que abrem o navegador (como o `/login` do Claude Code) agora abrem o navegador do Windows sozinhos: a IDE define `BROWSER` para o `explorer.exe` ao abrir o terminal, sem instalar nada na distro. Se já existe um `BROWSER` no ambiente do terminal (definido no Windows com `WSLENV`, ou no perfil da distro), a IDE não o sobrescreve; um `BROWSER` definido só no Windows, sem `WSLENV`, não chega à distro. No Windows e no Linux nada muda.

## 1.3.0 · 02/10/2026
### Instaladores
- A Rendra IDE passa a ter instalador para Windows (`Rendra-IDE-Setup.exe`) e Linux (AppImage e `.deb`), na página de Releases do GitHub e no site. O instalador do Mac (Apple Silicon e Intel) entra quando a assinatura estiver configurada. A instalação por `git clone` continua valendo e se atualiza pelo próprio caminho.
- Quem instala pelo instalador recebe as versões novas sozinho: o app baixa a atualização em segundo plano e o botão "Nova versão" pede para reiniciar. No Windows cada atualização baixa o instalador completo; no Linux o `.deb` pede a senha do sistema para instalar.
- No Windows o instalador ainda não tem assinatura digital, então o SmartScreen mostra o aviso "O Windows protegeu seu computador" na primeira execução. O site explica o passo a passo ("Mais informações", "Executar assim mesmo").
- O pacote ficou menor: o editor leva só os arquivos que usa.

## 1.2.1 · 02/10/2026
### Correções
- A contagem de uso no WSL não trava mais os testes no Linux, o que destrava a publicação automática das versões no GitHub.

## 1.2.0 · 02/10/2026
### RTK para o Claude Code e o Codex
- O RTK passa a valer em três cenários, para os dois agentes: IDE no Windows, IDE no Linux e IDE no Windows com o terminal em uma distro WSL. A IDE exige o RTK 0.50.0 ou mais novo, e instala ou atualiza o RTK em cada sistema pelos botões "Instalar RTK" e "Atualizar RTK" da página RTK (Windows, Linux e distros WSL em execução). No Windows, o `rtk.exe` em uso por um hook é trocado sem erro; a cópia antiga do WinGet não é mexida, só aparece o aviso com o comando `winget upgrade --id rtk-ai.rtk`.
- Cada agente grava a economia em um banco próprio (`RTK_DB_PATH`): o do Claude Code é o caminho padrão do RTK e o do Codex fica na subpasta `codex`. O histórico anterior a esta versão continua na conta do Claude Code, sem copiar nem apagar nada.
- O botão "Ativar" da página RTK liga o hook do Claude Code ou do Codex em cada sistema, com o caminho absoluto do `rtk` (o hook não depende do PATH). Antes de começar, a IDE lista todos os arquivos que serão tocados, guarda uma cópia de segurança de cada um que já existe e, se algum passo falhar, devolve os arquivos ao que eram. No Codex, ela acrescenta ao `config.toml` só o bloco `[shell_environment_policy]` com o banco do Codex, sem mexer no resto. O botão antigo que rodava `rtk init -g --codex` foi substituído por este.
- A página RTK mostra o total economizado por agente, somando os sistemas: Claude Code em laranja e Codex em azul, com o detalhe por sistema ao passar o mouse (ou focar o total). O gráfico diário tem uma série por agente. Distro parada aparece como "WSL desligado", sem ser acordada.
- Depois de ativar o RTK no Codex, é preciso abrir o Codex e aprovar o hook em `/hooks`; sem isso o RTK não reescreve nenhum comando, e a página avisa enquanto a aprovação não existir. Se o sandbox do Codex impedir a gravação do banco, a página mostra o trecho de `writable_roots` para você aplicar.
- Aviso do RTK: o classificador de segurança do Codex ainda não reconhece o `rtk` embrulhado, então pode pedir mais confirmações em comandos seguros.

## 1.1.6 · 02/10/2026
### Uso no terminal WSL
- O consumo do Claude Code e do Codex agora considera o sistema do terminal, não só o do Windows: se você abre o terminal em uma distro WSL e roda os agentes lá, as sessões de `/home/<usuário>/.claude` e `/home/<usuário>/.codex` entram na soma, junto com as do Windows e sem contar nada duas vezes. Só distros em execução são lidas (a IDE não acorda distro parada); com o WSL desligado, a leitura segue só com o Windows.

## 1.1.5 · 01/10/2026
### Atualização
- Quando há versão nova, aparece um botão verde "Nova versão" no rodapé da barra lateral esquerda, perto de Novidades e Sobre; ele some quando o app está atualizado. O clique abre a confirmação e atualiza como antes. O aviso "Versão X disponível" na barra inferior foi removido.
- Na primeira abertura depois de atualizar, o app mostra um modal com as novidades da versão. Ele só fecha pelo botão "Fechar": não fecha sozinho, nem ao clicar fora, nem com Esc, e não volta a aparecer para a mesma versão.
### Terminal
- O terminal do WSL só abre em distribuições realmente instaladas; um nome de distribuição que não está na lista é recusado.
### Explorador
- Criar arquivo ou pasta recusa os caracteres reservados do Windows (`: * ? " < > |`) com um aviso próprio.
- Botão direito no explorador abre o menu "Novo arquivo" e "Nova pasta": o item nasce na pasta clicada, na pasta do arquivo clicado ou, em área vazia, na raiz do projeto. O nome é digitado na própria árvore (Enter cria, Esc cancela), recusa vazio, `/`, `\`, `..` e nomes que já existem, e o arquivo novo abre no editor. Funciona também em projetos WSL.

## 1.1.4 · 01/10/2026
### Consumo do plano do Claude Code
- A barra de título mostra o percentual do limite de 5 horas e do semanal, com cor por nível (laranja a partir de 70%, vermelho a partir de 90%), sempre visível e atualizada a cada minuto. Passe o mouse para ver conta, plano e quando reinicia. A barra usa a leitura pela statusline do Claude Code: fica em cinza quando a última leitura tem mais de 15 minutos e não aparece quando não há dados do plano.
### Editor
- Botão no cabeçalho dos terminais (e o ✕ no canto do editor) para esconder e mostrar o painel do editor; os terminais ocupam o espaço. Esconder não fecha nem descarta arquivos abertos. O painel reaparece ao abrir um arquivo, e o estado é lembrado por workspace.
### Terminal
- Shift+Enter quebra a linha no terminal em Windows, macOS e Linux, como nas CLIs de IA.
- Nenhum terminal abre sozinho: ao abrir a IDE ou trocar de projeto, a área dos terminais mostra "Nenhum terminal aberto" e o botão "Novo terminal".
- Com o WSL instalado, o botão de novo terminal pergunta onde abrir: "Windows (PowerShell)" ou "WSL (distribuição)". Sem WSL, abre direto.
- O ícone de "Esconder painel" do editor agora é uma seta, para não se confundir com o ✕ de "Fechar quadro".

## 1.1.3 · 29/09/2026
### Atualização mais segura
- O histórico do repositório do Rendra IDE no GitHub vai ser reorganizado. Para que a atualização automática continue funcionando depois disso, o app agora sabe se recuperar: se você não mexeu nos arquivos do app, ele acompanha a nova história sozinho e segue com a atualização normalmente.
- Se você alterou arquivos do app, nada é apagado nem trocado: o app abre na versão atual e avisa para guardar suas alterações (`git stash`) e atualizar de novo.
- Suas configurações, workspaces e preços ficam em `%APPDATA%\Rendra IDE` e nunca são tocados. Os commits antigos ficam guardados na branch local `rendra-backup-antes-da-atualizacao`.

## 1.1.2 · 29/09/2026
### Novo endereço
- O repositório passou de `bsmagalhaes/rendra-ide` para `bsmagalhaes/rendra-ui-ide`, e o site para `https://bsmagalhaes.github.io/rendra-ui-ide/`, para combinar com o nome da família Rendra. O endereço antigo do GitHub continua redirecionando, então a atualização automática e as cópias já instaladas seguem funcionando sem nenhuma ação. O link antigo do site deixou de abrir.
- O uso e as configurações não mudam. Quem clonou a pasta com o nome antigo pode manter tudo como está.

## 1.1.1 · 29/09/2026
### DevCode IDE
- Terminal do WSL com a distro desligada: o app liga a distro antes de abrir o terminal e tenta de novo se o WSL demorar a responder, em vez de mostrar o erro `Wsl/Service/0x8007274c`.

### Segurança e compatibilidade
- Electron atualizado da versão 31 (sem suporte) para a 44, a estável atual. Isso corrige o bloqueio no macOS ("Electron.app não foi aberto porque contém malware"), que apagava o Electron ao rodar `npm start`.
- Dependências de desenvolvimento atualizadas (electron-builder 26): as 16 vulnerabilidades conhecidas foram corrigidas e a instalação não mostra mais alertas do `npm audit`.
- Terminal, editor e painéis continuam iguais; nada muda no uso. Para atualizar à mão: `git pull` e `npm install` (Node 22.12 ou mais novo).

## 1.1.0 · 26/09/2026

### Rendra IDE
- O app passa a se chamar **Rendra IDE** ([rendraskills.com](https://rendraskills.com)). Configurações, workspaces e preços da versão anterior são migrados automaticamente.
- Atualização pelo próprio app: quando sai uma versão nova, a barra inferior mostra **Atualizar agora**. O app fecha (perguntando antes se há arquivos para salvar), baixa a versão com `git pull` e `npm install` e abre de novo, sem mexer em configurações, workspaces e preços. Na primeira abertura depois de atualizar, esta página mostra o que mudou.
- Preços atualizados pelo próprio Rendra IDE: ao abrir, o app verifica se há uma tabela de preços nova e oferece aplicar.
- Limites de uso do Claude lidos da statusline do Claude Code, sem usar o seu login; o modo completo (com limites por modelo) é opcional nas Configurações.
- Novas páginas **Novidades** e **Sobre**, com autoria, créditos e licenças.
- Novo ícone: símbolo de código laranja sobre fundo preto.
- Saiu o boneco animado e o escurecimento da tela por inatividade.

### DevCode IDE
- Nova aba principal: explorador de arquivos, terminais e editor Monaco (o editor do VS Code), com vários workspaces em abas, renomeáveis e restaurados ao abrir o app.
- Layout padrão Pastas 25% · Terminais 50% · Editor 25%, com todas as larguras ajustáveis.
- Terminais em grade de 1 a 4 colunas, abas no título, renomear inline e reordenar arrastando.
- Shells por sistema: PowerShell, Git Bash e CMD no Windows; zsh, bash e fish no macOS e Linux.
- Cores do Git em tempo real (modificado, novo, ignorado e submódulos) propagadas às pastas, ícones por tipo de arquivo e linhas-guia.
- Pergunta Salvar / Não salvar / Cancelar ao fechar abas, workspaces e o app com arquivos alterados; confirmação ao fechar terminais.
- WSL: projetos no Linux ou pastas do Windows montadas no Linux, com terminal e Git rodando dentro da distribuição.
- Colar imagem no terminal (Alt+V no Windows, Ctrl+V no Linux e macOS) para CLIs como o Claude Code.

### Terminal
- Página exclusiva de terminais, que funciona mesmo sem Claude Code ou Codex instalados.

### Consumo e custos
- Custo sempre por token: tokens × preço por 1 milhão de tokens.
- Nova página **Preços** com as tabelas do Claude Code e do Codex, editáveis e atualizadas pelo Rendra IDE a partir das tabelas oficiais da Anthropic e da OpenAI.
- Claude Code: escrita de cache de 5 minutos e de 1 hora cobradas separadamente, modo rápido e buscas web.
- Subagentes passaram a ser contados, e cada resposta é contada uma única vez (antes, linhas repetidas eram somadas em dobro).
- Nova página **Codex** (Codex CLI da OpenAI), com consumo, limites de uso e "Não conectado" quando não há dados.
- Filtros por projeto e período; conta conectada e limites de uso do plano do Claude.
- Leitura do histórico em segundo plano e com cache em disco: a abertura do app não trava mais.

### RTK
- Página do RTK com economia, comandos e integração com o Claude Code e o Codex.
- Configuração do ambiente na primeira abertura: instala Git Bash, RTK e WSL quando faltarem (`npm run setup` para quem clona o repositório).

### App
- Barra lateral no estilo do VS Code; interface em português.
- Compatível com Windows, macOS e Linux; abre maximizado (no macOS, ocupando a tela).

### Avisos
- Custos são **estimativas** calculadas com a tabela de preços da página Preços; o valor cobrado de fato depende do seu plano ou contrato.
- Os preços seguem as tabelas oficiais da Anthropic e da OpenAI na data indicada na página Preços; você pode ajustá-los manualmente.

## 1.0.0

- Versão original do Tokenmeter, por Dewashish Lambore: painel de consumo do Claude Code com gráficos, mapa de atividade, horários de pico e custos estimados.

/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Realce de arquivos .env no editor (Monaco): quais nomes de arquivo usam a linguagem `dotenv`, a
// gramática Monarch e as cores dos tokens. Só cor: nenhum valor é mascarado. Carregado no renderer
// (window.RendraDotenv) e nos testes (require). Sem DOM.
(function (root) {
  const ID = 'dotenv';

  // `.env`, `.env.local`, `.env.example` e `prod.env` entram; `environment.js` e `.envrc` não.
  function linguagemPorNome(caminho) {
    const nome = String(caminho || '').split(/[\\/]/).pop().toLowerCase();
    return nome === '.env' || nome.startsWith('.env.') || (nome.endsWith('.env') && nome.length > 4) ? ID : undefined;
  }

  // Cada linha: comentário inteiro; `export CHAVE=`; `CHAVE=`; depois o valor (sem aspas, 'simples'
  // ou "duplas" com ${VAR}) e um comentário após espaço. A aspa dupla aberta continua nas linhas
  // seguintes, como no dotenv.
  const MONARCH = {
    defaultToken: '',
    tokenPostfix: '.dotenv',
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^(\s*)(export)(\s+)([A-Za-z_][\w.\-]*)(\s*)(=)/, ['', 'keyword.export', '', 'variable.name', '', 'delimiter']],
        [/^(\s*)([A-Za-z_][\w.\-]*)(\s*)(=)/, ['', 'variable.name', '', 'delimiter']],
        [/\s+#.*$/, 'comment'],
        [/"/, { token: 'string.value', next: '@duplas' }],
        [/'[^']*'?/, 'string.value'],
        [/\$\{[^}]*\}/, 'variable.interp'],
        [/[^\s"'$]+/, 'string.value'],
        [/\$/, 'string.value'],
        [/\s+/, ''],
      ],
      duplas: [
        [/\\./, 'string.escape'],
        [/\$\{[^}]*\}/, 'variable.interp'],
        [/[^"\\$]+/,'string.value'],
        [/\$/, 'string.value'],
        [/"/, { token: 'string.value', next: '@pop' }],
      ],
    },
  };

  // Regras do tema 'rendra' (fundo #161616): chave laranja, valor verde, interpolação amarela,
  // `=` e `export` em cinza discreto. Contraste mínimo de 4,5:1 sobre o fundo (conferido no teste).
  // O app só tem tema escuro.
  const REGRAS_TEMA = [
    { token: 'variable.name.dotenv', foreground: 'f08a3c' },
    { token: 'string.value.dotenv', foreground: '8fc98f' },
    { token: 'string.escape.dotenv', foreground: 'c9a0e8' },
    { token: 'variable.interp.dotenv', foreground: 'e5c07b' },
    { token: 'keyword.export.dotenv', foreground: '8a8a8a' },
    { token: 'delimiter.dotenv', foreground: '8a8a8a' },
    { token: 'comment.dotenv', foreground: '808080', fontStyle: 'italic' },
  ];

  function registrar(monaco) {
    monaco.languages.register({ id: ID, aliases: ['Dotenv', '.env'] });
    monaco.languages.setMonarchTokensProvider(ID, MONARCH);
  }

  const api = { ID, MONARCH, REGRAS_TEMA, linguagemPorNome, registrar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraDotenv = api;
})(typeof window !== 'undefined' ? window : this);

/*! Rendra IDE v1.9.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Legenda do explorador (UMD, sem DOM, testável no node): o tipo do arquivo pelo nome (`fileKind`, a única fonte, também
// usada pela árvore), o emblema da linha (● de pasta ou de não salvo, ou a letra do git) e a lista de linhas da legenda.
// A legenda NÃO repete cor nenhuma: cada amostra é uma linha `.dev-node` real, com as mesmas classes da árvore, e a cor
// continua morando só no styles.css. O texto de cada linha diz a cor por extenso, para o sentido não depender só da cor.
// Carregado no renderer (window.RendraLegenda) e nos testes (require).
(function (root) {
  // Cinco tipos: pasta, oculto (começa com ponto), configuração, LLM/docs (markdown) e arquivo comum
  const CONFIG_EXT = new Set(['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'env', 'cfg', 'conf', 'config', 'xml', 'lock', 'properties', 'editorconfig']);
  const LLM_EXT = new Set(['md', 'mdx', 'markdown', 'prompt']);
  function fileKind(name, isDirectory) {
    if (isDirectory) return name.startsWith('.') ? 'hidden-dir' : 'dir';
    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (LLM_EXT.has(ext)) return 'llm';
    if (CONFIG_EXT.has(ext) || /^\.env(\.|$)/.test(lower) || /rc$/.test(lower) && lower.startsWith('.')) return 'config';
    if (lower.startsWith('.')) return 'hidden';
    return 'file';
  }

  // Sem código ou com I (ignorado pelo git): vazio. Pasta e alteração no editor (E): ●. Senão a letra do git.
  function emblema(codigo, ehPasta) {
    if (!codigo || codigo === 'I') return '';
    return ehPasta || codigo === 'E' ? '●' : codigo;
  }

  const I = (id, grupo, rotulo, texto, nome, extra = {}) => ({ id, grupo, rotulo, texto, nome, ehPasta: false, submodulo: false, codigo: '', recortado: false, linha: '', ...extra });

  // Uma linha por significado; os dois cinzas (ignorado e oculto) continuam distintos
  function itens() {
    return [
      I('novo', 'Git', 'Novo', 'Nome em verde e letra U (ou A): arquivo novo, ainda fora do último commit.', 'novo.js', { codigo: 'U' }),
      I('modificado', 'Git', 'Modificado', 'Nome em âmbar e letra M: arquivo com alteração que ainda não foi commitada.', 'tela.js', { codigo: 'M' }),
      I('pasta-modificada', 'Git', 'Pasta com mudança', 'Nome em âmbar e ● ao lado: há alteração dentro da pasta.', 'src', { ehPasta: true, codigo: 'M' }),
      I('apagado', 'Git', 'Apagado', 'Nome em vermelho e letra D: arquivo apagado.', 'antigo.js', { codigo: 'D' }),
      I('ignorado', 'Git', 'Ignorado pelo git', 'Nome em cinza apagado, sem marca ao lado: o arquivo ou a pasta está no .gitignore.', 'saida.log', { codigo: 'I' }),
      I('nao-salvo', 'Editor', 'Não salvo', 'Nome em laranja e ● ao lado: o arquivo foi alterado no editor e ainda não foi salvo.', 'rascunho.js', { codigo: 'E' }),
      I('submodulo', 'Submódulo', 'Submódulo', 'Nome em azul claro e ícone de pasta com um ponto: pasta que é um submódulo do git.', 'modulo-a', { ehPasta: true, submodulo: true }),
      I('submodulo-modificado', 'Submódulo', 'Submódulo modificado', 'Nome em azul mais claro e ● ao lado: o submódulo tem alteração.', 'modulo-b', { ehPasta: true, submodulo: true, codigo: 'M' }),
      I('pasta-oculta', 'Ocultos', 'Pasta oculta', 'Nome em cinza escuro e sem ícone: pasta cujo nome começa com ponto. Fica no começo da lista.', '.github', { ehPasta: true }),
      I('oculto', 'Ocultos', 'Arquivo oculto', 'Nome em cinza escuro e o ícone ◆: arquivo oculto pelo nome (começa com ponto). Os de configuração, como .env, .editorconfig e .npmrc, também ficam entre os ocultos na ordem, mas aparecem com o ícone de engrenagem e o nome em cinza claro.', '.DS_Store'),
      I('pasta', 'Tipos e ícones', 'Pasta', 'Nome em branco, com a seta ▸ para abrir.', 'docs', { ehPasta: true }),
      I('arquivo', 'Tipos e ícones', 'Arquivo comum', 'Nome em cinza claro e o ícone de folha.', 'index.js'),
      I('configuracao', 'Tipos e ícones', 'Configuração', 'Ícone de engrenagem: arquivos como .ini, .toml, .env e .npmrc.', 'servidor.toml'),
      I('json', 'Tipos e ícones', 'JSON', 'Ícone {} em amarelo.', 'package.json'),
      I('yaml', 'Tipos e ícones', 'YAML', 'Ícone ! em roxo.', 'ci.yml'),
      I('markdown', 'Tipos e ícones', 'Markdown e prompts', 'Ícone azul de texto: .md, .mdx e .prompt.', 'LEIAME.md'),
      I('aberto', 'Linhas', 'Arquivo aberto', 'Barra laranja à esquerda e fundo mais escuro: é o arquivo da aba ativa do editor.', 'index.js', { linha: 'active' }),
      I('selecionado', 'Linhas', 'Pasta selecionada', 'Barra cinza à esquerda e fundo mais escuro: é o destino do Colar e do soltar.', 'docs', { ehPasta: true, linha: 'selecionado' }),
      I('recortado', 'Linhas', 'Recortado', 'Linha esmaecida: item recortado, esperando o Colar.', 'copia.txt', { recortado: true }),
    ];
  }

  const api = { CONFIG_EXT, LLM_EXT, fileKind, emblema, itens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraLegenda = api;
})(typeof window !== 'undefined' ? window : this);

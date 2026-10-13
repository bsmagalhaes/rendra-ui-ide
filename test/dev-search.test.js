// dev:search (handler real, worker real) contra arquivos de verdade: o que o handler devolve, nunca a chamada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { montar, pasta, limpar } = require('./helpers/devcode-montar');

// o %TEMP% do Windows fica sob o perfil do usuário, que pode ser um repositório: o git não sobe até lá
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir());
test.after(limpar);

const temGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
const rels = (raiz, r) => r.resultados.map(x => path.relative(raiz, x.path).split(path.sep).join('/'));
const texto = (call, raiz, termo, extra = {}) => call('dev:search', { raiz, modo: 'texto', termo, ...extra });
const link = (alvo, caminho) => fs.symlinkSync(alvo, caminho, 'junction'); // no Linux e no macOS vira symlink

test('fora de git: acha nos arquivos certos, pula node_modules e .git (a pasta .git vazia faz o git falhar)', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'a', 'um.txt'), 'linha com ALVO aqui\n');
  escreve(path.join(raiz, 'b.txt'), 'nada\nalvo de novo\n');
  escreve(path.join(raiz, 'node_modules', 'pkg', 'x.js'), 'alvo dentro de node_modules');
  escreve(path.join(raiz, '.git', 'config'), 'alvo dentro do .git');
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  assert.deepStrictEqual(rels(raiz, r), ['a/um.txt', 'b.txt']);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.parcial, null);
  assert.deepStrictEqual(r.resultados[0].ocorrencias[0], { linha: 1, coluna: 11, trecho: 'linha com ALVO aqui', marcas: [[10, 14]] });
});

test('repositório: respeita o .gitignore, lista rastreado e novo, nada de dentro do .git', { skip: !temGit && 'git não instalado' }, async () => {
  const raiz = pasta();
  git(raiz, 'init', '-q');
  escreve(path.join(raiz, '.gitignore'), 'ignorado.txt\nbuild/\n');
  escreve(path.join(raiz, 'rastreado.txt'), 'alvo rastreado');
  escreve(path.join(raiz, 'novo.txt'), 'alvo novo');
  escreve(path.join(raiz, 'ignorado.txt'), 'alvo ignorado');
  escreve(path.join(raiz, 'build', 'saida.js'), 'alvo da build');
  escreve(path.join(raiz, 'node_modules', 'x.js'), 'alvo em node_modules sem regra no gitignore');
  git(raiz, 'add', 'rastreado.txt');
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  const achados = rels(raiz, r);
  assert.ok(achados.includes('rastreado.txt') && achados.includes('novo.txt'), achados.join());
  assert.ok(!achados.includes('ignorado.txt') && !achados.some(p => p.startsWith('build/')), achados.join());
  assert.ok(!achados.some(p => p.startsWith('.git/')));
  // regra do dono: em repositório vale o .gitignore (node_modules só some se o .gitignore o lista)
  assert.ok(achados.includes('node_modules/x.js'));
});

test('confinamento: link para pasta de fora não devolve o marcador, em projeto git e fora dele', async t => {
  for (const emGit of [false, true]) {
    if (emGit && !temGit) { t.diagnostic('git não instalado: caso do repositório pulado'); continue; }
    const base = pasta();
    const raiz = path.join(base, 'proj');
    const fora = path.join(base, 'fora');
    escreve(path.join(raiz, 'ok.txt'), 'MARCADOR dentro');
    escreve(path.join(fora, 'segredo.txt'), 'MARCADOR fora');
    if (emGit) git(raiz, 'init', '-q');
    link(fora, path.join(raiz, 'jun'));
    const { call } = montar([raiz]);
    const r = await texto(call, raiz, 'MARCADOR');
    assert.deepStrictEqual(rels(raiz, r), ['ok.txt'], `emGit=${emGit}`);
  }
});

test('confinamento por realpath: arquivo rastreado sob uma pasta trocada depois por link para fora não vaza', { skip: !temGit && 'git não instalado' }, async () => {
  const base = pasta();
  const raiz = path.join(base, 'proj');
  const fora = path.join(base, 'fora');
  escreve(path.join(raiz, 'a', 'b', 'f.txt'), 'MARCADOR dentro, antes da troca');
  escreve(path.join(raiz, 'ok.txt'), 'MARCADOR controle');
  escreve(path.join(fora, 'b', 'f.txt'), 'MARCADOR FORA');
  git(raiz, 'init', '-q');
  git(raiz, 'add', 'a/b/f.txt', 'ok.txt');
  fs.rmSync(path.join(raiz, 'a'), { recursive: true, force: true });
  link(fora, path.join(raiz, 'a')); // o git ainda lista a/b/f.txt, e o lstat da folha continua "arquivo comum"
  assert.ok(execFileSync('git', ['-C', raiz, 'ls-files', '-z', '--cached']).toString().includes('a/b/f.txt'));
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'MARCADOR');
  assert.deepStrictEqual(rels(raiz, r), ['ok.txt']);
  assert.ok(!JSON.stringify(r).includes('FORA'));
});

test('raiz fora das pastas abertas devolve erro, sem abrir busca', async () => {
  const raiz = pasta();
  const fora = pasta();
  escreve(path.join(fora, 'x.txt'), 'alvo');
  const { call } = montar([raiz]);
  assert.deepStrictEqual(await texto(call, fora, 'alvo'), { erro: 'Caminho fora das pastas abertas' });
  assert.ok((await call('dev:search', { raiz: fora, modo: 'nome', termo: 'x.' })).erro);
});

test('binário e arquivo acima do limite são pulados e contados', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'ok.txt'), 'alvo pequeno');
  fs.writeFileSync(path.join(raiz, 'bin.dat'), Buffer.concat([Buffer.from('alvo '), Buffer.from([0, 1, 2])]));
  escreve(path.join(raiz, 'grande.txt'), `alvo ${'x'.repeat(500)}`);
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo', { limites: { bytesArquivo: 100 } });
  assert.deepStrictEqual(rels(raiz, r), ['ok.txt']);
  assert.strictEqual(r.pulados, 2);
});

test('regex inválida e termo curto voltam como erro, nos dois modos', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'x.txt'), 'abc');
  const { call } = montar([raiz]);
  assert.deepStrictEqual(await texto(call, raiz, '(a', { regex: true }), { erro: 'Expressão regular inválida' });
  assert.match((await texto(call, raiz, 'a')).erro, /pelo menos 2/);
  assert.match((await call('dev:search', { raiz, modo: 'nome', termo: 'x' })).erro, /pelo menos 2/);
  assert.ok((await call('dev:search', { raiz, modo: 'outro', termo: 'xx' })).erro);
  assert.ok((await call('dev:search', null)).erro, 'o handler nunca lança');
});

test('teto de ocorrências: parcial só quando há mais; limite maior que o padrão é rebaixado para 500', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'muitas.txt'), `${Array.from({ length: 600 }, (_, i) => `alvo ${i}`).join('\n')}\n`);
  escreve(path.join(raiz, 'dez.txt'), `${Array.from({ length: 10 }, () => 'alvo').join('\n')}\n`);
  const { call } = montar([raiz]);
  const tres = await texto(call, raiz, 'alvo', { limites: { ocorrencias: 3 } });
  assert.strictEqual(tres.parcial, 'ocorrencias');
  assert.strictEqual(tres.total, 3);
  const grande = await texto(call, raiz, 'alvo', { limites: { ocorrencias: 999999 } });
  assert.strictEqual(grande.parcial, 'ocorrencias');
  assert.strictEqual(grande.total, 500);
  // exatamente no teto não é parcial
  escreve(path.join(raiz, 'muitas.txt'), 'nada\n');
  const exato = await texto(call, raiz, 'alvo', { limites: { ocorrencias: 10 } });
  assert.strictEqual(exato.total, 10);
  assert.strictEqual(exato.parcial, null);
});

test('teto de arquivos com ocorrência e de nomes', async () => {
  const raiz = pasta();
  for (let i = 0; i < 5; i++) escreve(path.join(raiz, `f${i}.txt`), 'alvo');
  const { call } = montar([raiz]);
  const t = await texto(call, raiz, 'alvo', { limites: { arquivos: 2 } });
  assert.strictEqual(t.parcial, 'arquivos');
  assert.strictEqual(t.arquivos, 2);
  const n = await call('dev:search', { raiz, modo: 'nome', termo: 'txt', limites: { arquivos: 2 } });
  assert.strictEqual(n.parcial, 'arquivos');
  assert.strictEqual(n.resultados.length, 2);
  const exato = await call('dev:search', { raiz, modo: 'nome', termo: 'txt', limites: { arquivos: 5 } });
  assert.strictEqual(exato.parcial, null);
});

test('teto de tempo: regex catastrófica volta como parcial "tempo" e o processo segue vivo', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'ruim.txt'), `${'a'.repeat(40)}!\n`);
  const { call } = montar([raiz]);
  const t0 = Date.now();
  const r = await texto(call, raiz, '(a+)+$', { regex: true, limites: { tempoMs: 800 } });
  assert.strictEqual(r.parcial, 'tempo');
  assert.ok(Date.now() - t0 < 5000, `demorou ${Date.now() - t0} ms`);
  const depois = await texto(call, raiz, 'aaa');
  assert.strictEqual(depois.total, 1);
});

test('uma busca nova cancela a anterior (a primeira devolve { cancelada: true })', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'ruim.txt'), `${'a'.repeat(40)}!\n`);
  const { call } = montar([raiz]);
  const t0 = Date.now();
  const primeira = texto(call, raiz, '(a+)+$', { regex: true, limites: { tempoMs: 8000 } });
  await new Promise(r => setTimeout(r, 700));
  const segunda = await texto(call, raiz, 'aaa');
  assert.deepStrictEqual(await primeira, { cancelada: true });
  assert.strictEqual(segunda.total, 1);
  assert.ok(Date.now() - t0 < 6000);
  // dev:search-cancel também encerra a busca em andamento
  const terceira = texto(call, raiz, '(a+)+$', { regex: true, limites: { tempoMs: 8000 } });
  await new Promise(r => setTimeout(r, 700));
  await call('dev:search-cancel');
  assert.deepStrictEqual(await terceira, { cancelada: true });
});

test('modo nome: só o nome do arquivo, sem diferenciar maiúsculas, só arquivos, ordem estável, path igual ao do dev:list', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'Relatorio.txt'), 'x');
  escreve(path.join(raiz, 'sub', 'outro-RELATORIO.md'), 'x');
  escreve(path.join(raiz, 'relatorio-pasta', 'x.txt'), 'relatorio no conteudo');
  const { call } = montar([raiz]);
  const r = await call('dev:search', { raiz, modo: 'nome', termo: 'relatorio' });
  assert.deepStrictEqual(rels(raiz, r), ['Relatorio.txt', 'sub/outro-RELATORIO.md']);
  assert.strictEqual(r.total, 2);
  assert.ok(r.resultados.every(x => x.ocorrencias === undefined));
  const lista = await call('dev:list', raiz);
  assert.ok(lista.some(e => e.path === r.resultados[0].path), 'o path devolvido é o mesmo texto do dev:list');
});

test('um arquivo na pasta da busca sem ocorrência devolve resultado vazio, não erro', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'x.txt'), 'nada');
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  assert.deepStrictEqual([r.resultados, r.total, r.parcial, r.pulados], [[], 0, null, 0]);
});

test('raiz aberta por junção (raiz diferente do realpath): a busca acha os arquivos', async () => {
  const base = pasta();
  const real = path.join(base, 'real');
  escreve(path.join(real, 'sub', 'x.txt'), 'alvo pela junção');
  const raiz = path.join(base, 'atalho');
  link(real, raiz);
  assert.notStrictEqual(fs.realpathSync(raiz), raiz);
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  assert.deepStrictEqual(rels(raiz, r), ['sub/x.txt']);
});

// forma 8.3 de um diretório (só Windows): realpath nativo expande, o do JS não. Se o volume não gera nomes curtos sozinho,
// tenta atribuir um com fsutil (exige privilégio); sem nenhum dos dois o teste se pula.
function nomeCurto(dir) {
  const consulta = () => {
    try {
      const out = execFileSync('cmd.exe', [`/d /s /c "for %I in ("${dir}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
      return out && out.toLowerCase() !== dir.toLowerCase() ? out : null;
    } catch { return null; }
  };
  const antes = consulta();
  if (antes) return antes;
  try { execFileSync('fsutil.exe', ['file', 'setshortname', dir, 'RNDRA~1'], { stdio: 'ignore' }); } catch { return null; }
  return consulta();
}
const base83 = process.platform === 'win32' ? (() => { const d = pasta(); fs.mkdirSync(path.join(d, 'projeto-com-nome-longo')); const c = nomeCurto(path.join(d, 'projeto-com-nome-longo')); return c ? { d, c } : null; })() : null;
test('raiz aberta por caminho 8.3 (nome curto): a busca acha os arquivos', { skip: process.platform !== 'win32' ? 'só no Windows' : !base83 && 'o volume não gera nomes curtos 8.3' }, async () => {
  const raiz = base83.c;
  escreve(path.join(base83.d, 'projeto-com-nome-longo', 'sub', 'x.txt'), 'alvo pelo nome curto');
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  assert.deepStrictEqual(rels(raiz, r), ['sub/x.txt']);
});

test('repositório cuja listagem falha dá erro visível, nunca uma busca que ignora o .gitignore', { skip: !temGit && 'git não instalado' }, async () => {
  const raiz = pasta();
  git(raiz, 'init', '-q');
  escreve(path.join(raiz, '.gitignore'), 'ignorado.txt\n');
  escreve(path.join(raiz, 'ignorado.txt'), 'alvo ignorado');
  escreve(path.join(raiz, 'ok.txt'), 'alvo ok');
  fs.writeFileSync(path.join(raiz, '.git', 'index'), 'lixo que não é um índice do git'); // rev-parse funciona, ls-files falha
  const { call } = montar([raiz]);
  const r = await texto(call, raiz, 'alvo');
  assert.deepStrictEqual(r, { erro: 'Não foi possível listar os arquivos do repositório' });
});

test('falha do worker volta como { erro } e a busca seguinte funciona', async () => {
  const raiz = pasta();
  escreve(path.join(raiz, 'x.txt'), 'alvo');
  const ruim = path.join(pasta(), 'worker-ruim.js');
  fs.writeFileSync(ruim, "throw new Error('falha de teste');\n");
  const { call } = montar([raiz], { deps: { buscaWorker: ruim } });
  assert.deepStrictEqual(await texto(call, raiz, 'alvo'), { erro: 'A busca falhou' });
  const { call: normal } = montar([raiz]);
  assert.strictEqual((await texto(normal, raiz, 'alvo')).total, 1);
});

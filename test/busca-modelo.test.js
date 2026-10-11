// Modelo puro do painel de busca (renderer/busca-modelo.js): ajuda, resumo com aviso de parcial, trechos, lista e setas.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../renderer/busca-modelo');
const B = require('../src/busca');

test('o mínimo do painel é o mesmo do main, nos dois modos', () => {
  assert.strictEqual(M.TERMO_MIN, B.TERMO_MIN);
  for (const modo of ['texto', 'nome']) {
    assert.strictEqual(M.termoValido({ ...M.estadoInicial(), modo, termo: 'a' }).ok, false);
    assert.match(M.termoValido({ ...M.estadoInicial(), modo, termo: '' }).motivo, /pelo menos 2 caracteres/);
    assert.strictEqual(M.termoValido({ ...M.estadoInicial(), modo, termo: 'ab' }).ok, true);
  }
});

test('estadoInicial: modo texto, termo vazio, botões desligados, sem resposta', () => {
  assert.deepStrictEqual(M.estadoInicial(), { modo: 'texto', termo: '', diferenciar: false, palavra: false, regex: false, resposta: null, erro: null });
});

test('resumo: frases de texto, de nome e de vazio', () => {
  assert.strictEqual(M.resumo({ modo: 'texto', total: 12, arquivos: 4, parcial: null, pulados: 0 }).frase, '12 ocorrências em 4 arquivos');
  assert.strictEqual(M.resumo({ modo: 'texto', total: 1, arquivos: 1, parcial: null }).frase, '1 ocorrência em 1 arquivo');
  assert.strictEqual(M.resumo({ modo: 'nome', total: 3, arquivos: 3, parcial: null }).frase, '3 arquivos encontrados');
  assert.strictEqual(M.resumo({ modo: 'nome', total: 1, arquivos: 1 }).frase, '1 arquivo encontrado');
  assert.strictEqual(M.resumo({ modo: 'texto', total: 0, arquivos: 0, parcial: null }).frase, 'Nenhum resultado');
  assert.deepStrictEqual(M.resumo(null), { frase: '', aviso: '', pulados: '' });
});

test('resumo: cada motivo de parcial mostra o aviso, com o limite que o main usou', () => {
  const base = { modo: 'texto', total: 500, arquivos: 9, limites: { ocorrencias: 500, arquivos: 200, tempoMs: 10000 } };
  assert.strictEqual(M.resumo({ ...base, parcial: 'ocorrencias' }).aviso, 'Parou em 500 ocorrências. Refine o termo.');
  assert.strictEqual(M.resumo({ ...base, parcial: 'arquivos' }).aviso, 'Parou em 200 arquivos. Refine o termo.');
  assert.strictEqual(M.resumo({ ...base, parcial: 'tempo' }).aviso, 'Parou no tempo limite (10 s). Refine o termo.');
  assert.strictEqual(M.resumo({ ...base, parcial: 'tempo', limites: { ...base.limites, tempoMs: 20000 } }).aviso, 'Parou no tempo limite (20 s). Refine o termo.');
  assert.strictEqual(M.resumo({ ...base, parcial: null }).aviso, '');
});

test('resumo: arquivos grandes ou binários pulados são contados', () => {
  assert.strictEqual(M.resumo({ modo: 'texto', total: 1, arquivos: 1, pulados: 3 }).pulados, '3 arquivos grandes ou binários pulados');
  assert.strictEqual(M.resumo({ modo: 'texto', total: 1, arquivos: 1, pulados: 1 }).pulados, '1 arquivo grande ou binário pulado');
  assert.strictEqual(M.resumo({ modo: 'texto', total: 1, arquivos: 1, pulados: 0 }).pulados, '');
});

test('segmentos preserva o trecho inteiro e marca só as faixas', () => {
  const s = M.segmentos('um alvo e outro alvo', [[3, 7], [16, 20]]);
  assert.strictEqual(s.map(x => x.texto).join(''), 'um alvo e outro alvo');
  assert.deepStrictEqual(s.filter(x => x.marca).map(x => x.texto), ['alvo', 'alvo']);
  assert.deepStrictEqual(M.segmentos('abc', []), [{ texto: 'abc', marca: false }]);
  assert.deepStrictEqual(M.segmentos('abc', [[0, 99]]).map(x => x.texto), ['abc']);
});

test('linhasDoPainel: cabeçalho por arquivo e itens com linha e coluna; nome vira item sem linha', () => {
  const raiz = 'C:\\p\\demo';
  const texto = M.linhasDoPainel({ modo: 'texto', resultados: [{ path: 'C:\\p\\demo\\src\\a.js', ocorrencias: [{ linha: 3, coluna: 5, trecho: 'x alvo', marcas: [[2, 6]] }, { linha: 9, coluna: 1, trecho: 'alvo', marcas: [[0, 4]] }] }] }, raiz);
  assert.deepStrictEqual(texto.map(l => l.tipo), ['arquivo', 'item', 'item']);
  assert.strictEqual(texto[0].rotulo, 'src/a.js');
  assert.strictEqual(texto[0].quantidade, 2);
  assert.deepStrictEqual([texto[1].linha, texto[1].coluna, texto[1].caminho], [3, 5, 'C:\\p\\demo\\src\\a.js']);
  const nome = M.linhasDoPainel({ modo: 'nome', resultados: [{ path: 'C:\\p\\demo\\Relatorio.txt' }] }, raiz);
  assert.deepStrictEqual(nome.map(l => [l.tipo, l.rotulo, l.linha]), [['item', 'Relatorio.txt', null]]);
  assert.deepStrictEqual(M.linhasDoPainel(null, raiz), []);
});

test('proximoItem: circular entre o campo (-1) e os itens, ignorando cabeçalhos', () => {
  const l = [{ tipo: 'arquivo' }, { tipo: 'item' }, { tipo: 'item' }, { tipo: 'arquivo' }, { tipo: 'item' }];
  assert.strictEqual(M.proximoItem(l, -1, 1), 1);
  assert.strictEqual(M.proximoItem(l, 1, 1), 2);
  assert.strictEqual(M.proximoItem(l, 2, 1), 4);
  assert.strictEqual(M.proximoItem(l, 4, 1), -1);
  assert.strictEqual(M.proximoItem(l, -1, -1), 4);
  assert.strictEqual(M.proximoItem(l, 1, -1), -1);
  assert.strictEqual(M.proximoItem([{ tipo: 'arquivo' }], -1, 1), -1);
  assert.strictEqual(M.proximoItem([], -1, 1), -1);
});

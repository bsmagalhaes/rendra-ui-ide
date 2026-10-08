const test = require('node:test');
const assert = require('node:assert');
const { nomeLivre } = require('../renderer/nome-livre');
const { validarNome } = require('../renderer/novo-item');

test('arquivo com extensão: nome (2).ext', () => {
  assert.strictEqual(nomeLivre('foto.png', ['foto.png']), 'foto (2).png');
});

test('avança até achar um livre', () => {
  assert.strictEqual(nomeLivre('foto.png', ['foto.png', 'foto (2).png', 'foto (3).png']), 'foto (4).png');
});

test('sem extensão, pasta e dotfile', () => {
  assert.strictEqual(nomeLivre('LEIAME', ['LEIAME']), 'LEIAME (2)');
  assert.strictEqual(nomeLivre('pasta.v1', ['pasta.v1'], { ehPasta: true }), 'pasta.v1 (2)');
  assert.strictEqual(nomeLivre('.env', ['.env']), '.env (2)');
  assert.strictEqual(nomeLivre('.env.local', ['.env.local']), '.env (2).local');
});

test('várias extensões: só a última é a extensão', () => {
  assert.strictEqual(nomeLivre('a.tar.gz', ['a.tar.gz']), 'a.tar (2).gz');
});

test('nome que já termina em (n) sobe o número', () => {
  assert.strictEqual(nomeLivre('a (2).txt', ['a.txt', 'a (2).txt']), 'a (3).txt');
});

test('a caixa é ignorada no Windows e no macOS e respeitada no Linux', () => {
  assert.strictEqual(nomeLivre('Foto.png', ['foto (2).PNG', 'Foto.png'], { insensivel: true }), 'Foto (3).png');
  assert.strictEqual(nomeLivre('Foto.png', ['foto (2).PNG', 'Foto.png'], { insensivel: false }), 'Foto (2).png');
});

test('o nome gerado passa pelo validarNome do explorador', () => {
  for (const n of ['foto.png', '.env', 'LEIAME', 'a.tar.gz', 'nome com espaço.txt']) {
    assert.strictEqual(validarNome(nomeLivre(n, [n]), [n]), null, n);
  }
});

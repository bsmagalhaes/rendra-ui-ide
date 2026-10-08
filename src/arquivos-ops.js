/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Operações de arquivo do explorador no processo principal: excluir (Lixeira), copiar, mover e importar. Toda operação
// repete guard + realDentro (a mesma regra do dev:read), olha o PRÓPRIO item por lstat (nunca segue o link: um symlink que
// aponta para fora é excluído e movido como link, com o alvo intacto), recusa a raiz de qualquer pasta aberta e tudo que a
// contém, e usa a API assíncrona do fs (copiar uma pasta grande de forma síncrona congelaria o IPC, os terminais e o watcher).
const fs = require('fs');
const path = require('path');

const MSG_FORA = 'Caminho fora das pastas abertas';
const MSG_RAIZ = 'Não dá para excluir ou mover uma pasta aberta como projeto';

const lstatOuNull = async p => { try { return await fs.promises.lstat(p); } catch { return null; } };
const erroDe = e => (e && e.message ? e.message : String(e));

// ctx: { guard(p) lança fora das pastas; realDentro(p) -> bool; inside0(p, r); raizes() -> pastas abertas; trashItem(p) -> Promise }
function criarOperacoes(ctx) {
  const { guard, realDentro, inside0 } = ctx;

  // Item existente, confinado pelo PAI real (o item em si pode ser um link que aponta para fora) e longe de qualquer raiz.
  async function itemConfinado(item) {
    const full = guard(item);
    for (const r of ctx.raizes()) if (inside0(r, full)) throw new Error(MSG_RAIZ);
    if (!(await realDentro(path.dirname(full)).catch(() => false))) throw new Error(MSG_FORA);
    const st = await lstatOuNull(full);
    if (!st) throw new Error('O item não existe mais');
    return { full, st };
  }

  // Manda um arquivo, link ou pasta (com tudo dentro) para a Lixeira do sistema. Nunca apaga de vez.
  async function excluir(item) {
    try {
      const { full } = await itemConfinado(item);
      try { await ctx.trashItem(full); } catch (e) { return { ok: false, error: `Não foi possível mover para a Lixeira: ${erroDe(e)}` }; }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: erroDe(e) };
    }
  }

  return { excluir, itemConfinado };
}

module.exports = { criarOperacoes, MSG_FORA, MSG_RAIZ };

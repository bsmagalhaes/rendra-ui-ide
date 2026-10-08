/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Operações de arquivo do explorador no processo principal: excluir (Lixeira), copiar, mover e importar. Toda operação
// repete guard + realDentro (a mesma regra do dev:read), olha o PRÓPRIO item por lstat (nunca segue o link: um symlink que
// aponta para fora é excluído e movido como link, com o alvo intacto), recusa a raiz de qualquer pasta aberta e tudo que a
// contém, e usa a API assíncrona do fs (copiar uma pasta grande de forma síncrona congelaria o IPC, os terminais e o watcher).
//
// Conflito de nome: sem decisão para o item, nada é gravado e o item volta como { conflito }. O main SÓ sobrescreve com a
// decisão explícita "substituir" para aquele item; um conflito que surgiu entre a pergunta e a execução vira erro
// "já existe" do item, nunca sobrescrita. Substituir troca o item inteiro (pasta nunca é mesclada): copia para um nome
// temporário no destino, só então remove o antigo e renomeia, e nunca destrói a origem.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nomeLivre } = require('../renderer/nome-livre');

const MSG_FORA = 'Caminho fora das pastas abertas';
const MSG_RAIZ = 'Não dá para excluir ou mover uma pasta aberta como projeto';
const DECISOES = new Set(['substituir', 'manter-ambos']);
const VALIDADE_REGISTRO_MS = 5 * 60 * 1000;
const MAX_REGISTROS = 20;
const MAX_ORIGENS = 1000;

const lstatOuNull = async p => { try { return await fs.promises.lstat(p); } catch { return null; } };
const erroDe = e => (e && e.message ? e.message : String(e));
const falha = msg => { const e = new Error(msg); e.amigavel = true; return e; };

// ctx: { guard(p) lança fora das pastas; realDentro(p) -> bool; inside0(p, r); raizes() -> pastas abertas; trashItem(p);
//        insensivel: Windows/macOS; fsx?: { rename, cp, rm, copyFile } (os testes injetam falhas) }
function criarOperacoes(ctx) {
  const { guard, realDentro, inside0 } = ctx;
  const insensivel = !!ctx.insensivel;
  const fsx = { rename: fs.promises.rename, rm: fs.promises.rm, copyFile: fs.promises.copyFile, mkdir: fs.promises.mkdir, symlink: fs.promises.symlink, ...(ctx.fsx || {}) };
  const mesmo = (a, b) => { const x = path.resolve(a), y = path.resolve(b); return insensivel ? x.toLowerCase() === y.toLowerCase() : x === y; };

  // Item existente, confinado pelo PAI real (o item em si pode ser um link que aponta para fora). Com checarRaiz, longe de
  // qualquer raiz aberta: excluir ou mover a raiz de um workspace (ou o que a contém) apagaria a pasta de outro.
  async function itemConfinado(item, { checarRaiz = true } = {}) {
    const full = guard(item);
    if (checarRaiz) for (const r of ctx.raizes()) if (inside0(r, full)) throw falha(MSG_RAIZ);
    if (!(await realDentro(path.dirname(full)).catch(() => false))) throw falha(MSG_FORA);
    const st = await lstatOuNull(full);
    if (!st) throw falha('O item não existe mais');
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

  // Pasta de destino: dentro das pastas abertas (lexical E real: o caminho final ainda não existe, então o realpath vale
  // para a pasta) e existente.
  async function lerDestino(destino) {
    const dir = guard(destino);
    if (!(await realDentro(dir).catch(() => false))) throw falha(MSG_FORA);
    const st = await fs.promises.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) throw falha('A pasta de destino não existe mais');
    return dir;
  }

  async function nomesDe(dir) { try { return await fs.promises.readdir(dir); } catch { return []; } }

  // Recria um link em `dst` apontando para o MESMO alvo (nunca copia o conteúdo do alvo: um link para ~/.ssh não pode trazer
  // essa pasta para dentro do projeto). No Windows o link de pasta vira junção (não pede privilégio); se o sistema não deixar
  // criar o link, ele fica de fora e entra nos avisos do item.
  async function copiarLink(src, dst, avisos) {
    const alvo = await fs.promises.readlink(src);
    let tipo;
    let destinoDoLink = alvo;
    if (process.platform === 'win32') {
      const st = await fs.promises.stat(src).catch(() => null);
      tipo = st && st.isDirectory() ? 'junction' : 'file';
      if (tipo === 'junction') destinoDoLink = path.resolve(path.dirname(src), alvo.replace(/^\\\\\?\\/, ''));
    }
    try { await fsx.symlink(destinoDoLink, dst, tipo); } catch (e) {
      if (e.code === 'EEXIST') throw e;
      avisos.push(`O link ${path.basename(src)} não foi copiado (${erroDe(e)})`);
    }
  }

  // Copia `src` (arquivo ou pasta, nunca link no topo: o topo já foi resolvido) para `dst`, que NÃO existe, sem seguir links
  // de dentro da pasta (copiados como links) e sem mesclar: se `dst` aparecer no meio, é erro "já existe".
  async function copiarNovo(src, st, dst, avisos) {
    if (st.isDirectory()) {
      try {
        await copiarPasta(src, dst, avisos);
      } catch (e) {
        if (e.code !== 'EEXIST' && !e.amigavel) await fsx.rm(dst, { recursive: true, force: true }).catch(() => {}); // só o que esta cópia criou
        throw e;
      }
    } else {
      try { await fsx.copyFile(src, dst, fs.constants.COPYFILE_EXCL); } catch (e) { if (e.code !== 'EEXIST') await fsx.rm(dst, { force: true }).catch(() => {}); throw e; }
    }
  }
  async function copiarPasta(src, dst, avisos) {
    if (await lstatOuNull(dst)) throw falha(`"${path.basename(dst)}" já existe nesta pasta`);
    await fsx.mkdir(dst); // sem recursivo: falha se já existe
    for (const ent of await fs.promises.readdir(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name), d = path.join(dst, ent.name);
      if (ent.isSymbolicLink()) await copiarLink(s, d, avisos);
      else if (ent.isDirectory()) await copiarPasta(s, d, avisos);
      else if (ent.isFile()) await fsx.copyFile(s, d, fs.constants.COPYFILE_EXCL);
      // sockets, pipes e dispositivos não são copiados
    }
  }

  // Move `origem` (pode ser um link, que anda como link) para `dst`, que NÃO existe. Outra unidade ou o share do WSL dão EXDEV:
  // copia e só depois apaga a origem (se a cópia falha no meio, a origem permanece).
  async function moverNovo(origem, lst, dst, avisos) {
    try {
      await fsx.rename(origem, dst);
      return;
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
    }
    if (lst.isSymbolicLink()) {
      try { await copiarLink(origem, dst, avisos); } catch (e) { await fsx.rm(dst, { force: true }).catch(() => {}); throw e; }
    } else {
      await copiarNovo(origem, lst, dst, avisos);
    }
    try { await fsx.rm(origem, { recursive: true, force: true }); } catch (e) { throw falha(`Copiado, mas não foi possível apagar a origem: ${erroDe(e)}`); }
  }

  // Um item da lista. `origemExterna`: importação (a origem fica fora de qualquer pasta aberta; é lida e nunca modificada).
  async function umItem({ modo, origem, dir, decisao, origemExterna }) {
    if (decisao !== undefined && !DECISOES.has(decisao)) throw falha('Decisão inválida');
    const mover = modo === 'mover';
    let full, lst;
    if (origemExterna) {
      full = path.resolve(origem);
      lst = await lstatOuNull(full);
      if (!lst) throw falha('O item não existe mais');
    } else {
      ({ full, st: lst } = await itemConfinado(origem, { checarRaiz: mover }));
    }
    const nome = path.basename(full);
    if (!nome || nome === '.' || nome === '..') throw falha('Origem inválida');

    // O que realmente se copia: o link de topo vira o alvo (cópia e importação); na cópia interna o alvo real tem de estar
    // dentro das pastas abertas. Mover anda com o próprio link.
    let efetiva = full, st = lst;
    if (lst.isSymbolicLink() && !mover) {
      if (!origemExterna && !(await realDentro(full).catch(() => false))) throw falha(MSG_FORA);
      efetiva = await fs.promises.realpath(full).catch(() => null);
      if (!efetiva) throw falha('O link está quebrado');
      st = await fs.promises.stat(efetiva);
    }
    const ehPasta = st.isDirectory();
    const ehPastaReal = lst.isDirectory(); // mover: um link para pasta anda como link, não como a pasta

    // pasta para dentro dela mesma (lexical e pelo caminho real) e mover para a própria pasta
    const dirReal = await fs.promises.realpath(dir).catch(() => dir);
    if ((ehPasta || ehPastaReal) && (inside0(dir, efetiva) || inside0(dirReal, efetiva))) {
      throw falha(mover ? 'Não dá para mover uma pasta para dentro dela mesma' : 'Não dá para copiar uma pasta para dentro dela mesma');
    }
    if (mover && mesmo(path.dirname(full), dir)) throw falha('O item já está nesta pasta');

    let final = path.join(dir, nome);
    const existente = await lstatOuNull(final);
    let substituindo = false;
    if (existente) {
      if (decisao === undefined) return { origem, conflito: true, nome, existente: final, ehPasta: existente.isDirectory() };
      if (decisao === 'manter-ambos') {
        final = path.join(dir, nomeLivre(nome, await nomesDe(dir), { ehPasta: ehPasta || ehPastaReal, insensivel }));
      } else {
        // substituir: nunca o próprio item nem um ancestral dele (apagar o destino apagaria a origem)
        if (mesmo(final, full) || mesmo(final, efetiva) || inside0(full, final) || inside0(efetiva, final)) {
          throw falha('Não dá para substituir: o destino é a própria origem ou contém a origem. Use "Manter os dois"');
        }
        substituindo = true;
      }
    }

    const avisos = [];
    const feito = tipo => ({ origem, ok: true, destino: final, tipo: tipo ? 'pasta' : 'arquivo', ...(avisos.length ? { avisos } : {}) });
    if (!substituindo) {
      // exclusivo: um item que apareceu no destino depois da pergunta vira erro "já existe", nunca sobrescrita
      if (mover) { if (await lstatOuNull(final)) throw falha(`"${path.basename(final)}" já existe nesta pasta`); await moverNovo(full, lst, final, avisos); }
      else await copiarNovo(efetiva, st, final, avisos);
      return feito(ehPasta || ehPastaReal);
    }

    // substituir: temporário no destino -> remove o antigo -> renomeia. Falha no meio deixa o destino antigo intacto.
    const temp = path.join(dir, `.${nome}.rendra-${crypto.randomBytes(4).toString('hex')}`);
    if (mover) await moverNovo(full, lst, temp, avisos); else await copiarNovo(efetiva, st, temp, avisos);
    try {
      await fsx.rm(final, { recursive: true, force: true });
    } catch (e) {
      if (mover) await fsx.rename(temp, full).catch(() => {}); else await fsx.rm(temp, { recursive: true, force: true }).catch(() => {});
      throw falha(`Não foi possível substituir: ${erroDe(e)}`);
    }
    await fsx.rename(temp, final);
    return feito(ehPasta || ehPastaReal);
  }

  async function executar(modo, { origens, destino, decisoes, origemExterna = false }) {
    let dir;
    try { dir = await lerDestino(destino); } catch (e) { return { ok: false, error: erroDe(e) }; }
    if (!Array.isArray(origens) || !origens.length || origens.length > MAX_ORIGENS || origens.some(o => typeof o !== 'string' || !o)) return { ok: false, error: 'Nada para copiar ou mover' };
    const mapa = decisoes && typeof decisoes === 'object' ? decisoes : {};
    const itens = [];
    const vistos = new Set();
    for (const origem of origens) {
      if (vistos.has(origem)) continue;
      vistos.add(origem);
      try {
        itens.push(await umItem({ modo, origem, dir, decisao: Object.prototype.hasOwnProperty.call(mapa, origem) ? mapa[origem] : undefined, origemExterna }));
      } catch (e) {
        itens.push({ origem, ok: false, error: erroDe(e) });
      }
    }
    return { ok: true, destino: dir, itens };
  }

  const copiar = args => executar('copiar', args || {});
  const mover = args => executar('mover', args || {});

  // ── Importação do sistema (Ctrl+V de arquivos copiados no Explorer/Finder e soltar na árvore) ──────────────────────
  // A origem NUNCA chega ao main como texto vindo do renderer: o preload lê os caminhos dos File reais (webUtils), registra a
  // lista aqui e só devolve { id, nomes }. O id é emitido por este módulo, expira e some quando todos os itens foram resolvidos.
  const registro = new Map(); // id -> { pendentes: Set, expira }
  const limpar = () => { const agora = Date.now(); for (const [id, e] of registro) if (e.expira < agora) registro.delete(id); };

  function registrar(caminhos) {
    limpar();
    const lista = [...new Set((Array.isArray(caminhos) ? caminhos : []).filter(p => typeof p === 'string' && p && !p.includes('\0') && path.isAbsolute(p)).map(p => path.resolve(p)))].slice(0, MAX_ORIGENS);
    if (!lista.length) return null;
    while (registro.size >= MAX_REGISTROS) registro.delete(registro.keys().next().value);
    const id = crypto.randomUUID();
    registro.set(id, { pendentes: new Set(lista), expira: Date.now() + VALIDADE_REGISTRO_MS });
    return { id, nomes: lista.map(p => path.basename(p)) };
  }

  async function importar(args) {
    const { id, destino, decisoes } = args && typeof args === 'object' ? args : {};
    limpar();
    const e = typeof id === 'string' ? registro.get(id) : null;
    if (!e) return { ok: false, error: 'A lista de arquivos expirou. Copie os arquivos de novo' };
    const r = await executar('copiar', { origens: [...e.pendentes], destino, decisoes, origemExterna: true });
    if (!r.ok) return r; // destino inválido: a lista continua válida para outra tentativa
    for (const it of r.itens) if (!it.conflito) e.pendentes.delete(it.origem);
    if (!e.pendentes.size) registro.delete(id);
    else e.expira = Date.now() + VALIDADE_REGISTRO_MS;
    return { ...r, id: e.pendentes.size ? id : null };
  }

  const cancelarImportacao = id => { registro.delete(id); return true; };

  return { excluir, copiar, mover, registrar, importar, cancelarImportacao };
}

module.exports = { criarOperacoes };

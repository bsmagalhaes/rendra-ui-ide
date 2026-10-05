/*! Rendra IDE v1.7.2 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Identidade do Codex CLI para a barra de título: lê <.codex>/auth.json e devolve SÓ
// { email, name, organization, plan }. O arquivo guarda três tokens (access, refresh, id): este
// módulo decodifica apenas o payload do id_token (base64url, sem verificar assinatura), monta o
// retorno por lista branca e NUNCA devolve, loga ou deixa em mensagem de erro qualquer trecho do
// arquivo. Falha silenciosa: qualquer problema vira null (sem e.message: a mensagem do JSON.parse
// do V8 traz um pedaço do texto, que pode ser um token).

const fs = require('fs');
const path = require('path');

const CLAIM = 'https://api.openai.com/auth';
const texto = v => (typeof v === 'string' && v.trim() ? v : null);

function organizacao(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const padrao = lista.find(o => o && o.is_default === true);
  return texto((padrao || lista[0])?.title);
}

async function lerContaCodex(codexDir) {
  try {
    const auth = JSON.parse(await fs.promises.readFile(path.join(codexDir, 'auth.json'), 'utf8'));
    const partes = String(auth?.tokens?.id_token || '').split('.');
    if (partes.length < 2) return null;
    const p = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (!p || typeof p !== 'object') return null;
    const a = p[CLAIM] || {};
    return { email: texto(p.email), name: texto(p.name), organization: organizacao(a.organizations), plan: texto(a.chatgpt_plan_type) };
  } catch {
    return null;
  }
}

module.exports = { lerContaCodex };

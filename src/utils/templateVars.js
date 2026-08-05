/**
 * Vocabulário de variáveis do CRM disponíveis para campanhas.
 *
 * Templates da Meta usam variáveis POSICIONAIS ({{1}}, {{2}}…). A campanha guarda
 * em `templateParams` qual token do CRM alimenta cada posição, ex.:
 *   templateParams: ['nome', 'dias_sem_comprar']  →  {{1}}=nome, {{2}}=dias_sem_comprar
 */

const TOKENS = {
  nome: (c) => c.name || 'cliente',
  produto_favorito: (c) => {
    const fav = Array.isArray(c.favoriteItems) ? c.favoriteItems : [];
    return fav[0]?.name || fav[0] || 'seu pedido favorito';
  },
  dias_sem_comprar: (c) =>
    c.lastOrderAt
      ? Math.floor((Date.now() - new Date(c.lastOrderAt)) / 86400000)
      : (c.daysSinceOrder || 0),
  total_pedidos: (c) => c.totalOrders || 0,
  ticket_medio: (c) => `R$ ${Number(c.averageTicket || 0).toFixed(2)}`,
};

const TOKEN_NAMES = Object.keys(TOKENS);

/**
 * A Meta rejeita parâmetros de template contendo quebra de linha, tab ou
 * 4+ espaços seguidos (erro 132000/132001), e também parâmetro vazio.
 */
function sanitizeParam(value) {
  // Colapsa qualquer sequência de espaço/quebra/tab em um único espaço:
  // cobre a regra da Meta e ainda limpa dados sujos do CRM.
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean || '-';
}

/** Resolve um token do CRM para o cliente informado. */
function resolveToken(token, customer) {
  const fn = TOKENS[token];
  if (!fn) return '-';
  try {
    return sanitizeParam(fn(customer));
  } catch {
    return '-';
  }
}

/**
 * Monta o array `parameters` do componente BODY para um cliente.
 * @param {string[]} templateParams tokens por posição
 */
function buildBodyParameters(templateParams, customer) {
  return (Array.isArray(templateParams) ? templateParams : []).map((token) => ({
    type: 'text',
    text: resolveToken(token, customer),
  }));
}

/**
 * Renderiza o corpo do template ({{1}}, {{2}}…) com os valores do cliente.
 * Usado só para exibição/registro em CampaignExecution.message — o envio real
 * vai pelos `parameters`, não por este texto.
 */
function renderTemplateBody(bodyText, templateParams, customer) {
  if (!bodyText) return '';
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, position) => {
    const token = (templateParams || [])[Number(position) - 1];
    return token ? resolveToken(token, customer) : match;
  });
}

/** Extrai as posições {{n}} de um corpo e valida que são sequenciais a partir de 1. */
function extractVariables(bodyText) {
  const found = [...String(bodyText || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1])
  );
  const unique = [...new Set(found)].sort((a, b) => a - b);
  const sequential = unique.every((n, i) => n === i + 1);
  return { positions: unique, count: unique.length, sequential };
}

module.exports = {
  TOKENS,
  TOKEN_NAMES,
  sanitizeParam,
  resolveToken,
  buildBodyParameters,
  renderTemplateBody,
  extractVariables,
};

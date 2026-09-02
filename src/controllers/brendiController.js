const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../utils/prisma');
const { normalizePhone } = require('./multipedidosController');

const BRENDI_BASE_URL = 'https://api.brendi.com.br';
let stats = { total: 0, lastAt: null, lastPayload: null };

// Cache do token OAuth2 (válido por 1h em média)
let tokenCache = { token: null, expiresAt: 0 };

async function getBrendiToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const clientId     = process.env.BRENDI_CLIENT_ID;
  const clientSecret = process.env.BRENDI_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('BRENDI_CLIENT_ID / BRENDI_CLIENT_SECRET não configurados');

  const res = await axios.post(
    `${BRENDI_BASE_URL}/oauth/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  );
  const { access_token, expires_in } = res.data;
  tokenCache = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  console.log('[Brendi] Token OAuth2 obtido');
  return access_token;
}

async function getOrderDetails(orderId, token) {
  const res = await axios.get(
    `${BRENDI_BASE_URL}/v1/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  );
  return res.data;
}

async function receiveOrder(req, res) {
  try {
    const body = req.body;
    console.log('[Brendi] Webhook recebido:', JSON.stringify(body, null, 2));

    stats.total++;
    stats.lastAt = new Date().toISOString();
    stats.lastPayload = body;

    // Responde 200 imediatamente para a Brendi não reenviar
    res.status(200).json({ success: true });

    // Só processa eventos de novo pedido
    const eventType = body.eventType;
    if (eventType !== 'CREATED') {
      console.log('[Brendi] Ignorando evento:', eventType);
      return;
    }

    const orderId = body.orderId;
    if (!orderId) {
      console.warn('[Brendi] orderId ausente no evento');
      return;
    }

    // Rotear para wabaAccount — wabaAccountId OBRIGATÓRIO na URL
    const { wabaAccountId } = req.params;
    if (!wabaAccountId) {
      console.warn('[Brendi] wabaAccountId ausente na URL');
      return;
    }
    const wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: wabaAccountId } });
    if (!wabaAccount) {
      console.warn('[Brendi] WabaAccount não encontrada:', wabaAccountId);
      return;
    }
    console.log('[Brendi] Roteando para conta:', wabaAccount.displayName);

    // Buscar detalhes do pedido na API da Brendi
    let order;
    try {
      const token = await getBrendiToken();
      order = await getOrderDetails(orderId, token);
      console.log('[Brendi] Detalhes do pedido obtidos:', orderId);
    } catch (err) {
      console.error('[Brendi] Erro ao buscar pedido:', err.response?.data || err.message);
      return;
    }

    const customer    = order.customer || {};
    const phone       = customer.phone?.number || '';
    const name        = customer.name || 'Cliente Brendi';
    const orderTotal  = parseFloat(order.total?.orderAmount?.value || 0);
    const items       = extractItems(order.items || []);
    const externalId  = String(orderId);

    if (!phone) {
      console.warn('[Brendi] Nenhum telefone encontrado no pedido:', orderId);
      return;
    }

    const normalizedPhone = normalizePhone(phone);

    const existing = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId: wabaAccount.id, phone: normalizedPhone },
    });

    // Detectar reentrega
    const isReplay = !!(existing && await prisma.customerOrder.findUnique({
      where: { crmCustomerId_externalId: { crmCustomerId: existing.id, externalId } },
    }));

    let crmCustomer;

    if (isReplay) {
      crmCustomer = existing;
      console.log('[Brendi] Pedido reentregue:', externalId, '— agregados preservados');
    } else if (existing) {
      const newTotal  = existing.totalOrders + 1;
      const newSpent  = parseFloat(existing.totalSpent) + orderTotal;
      const newTicket = newSpent / newTotal;
      let favItems = existing.favoriteItems || [];
      if (items.length) favItems = mergeFavoriteItems(favItems, items);
      crmCustomer = await prisma.crmCustomer.update({
        where: { id: existing.id },
        data: {
          name:          name || existing.name,
          totalOrders:   newTotal,
          totalSpent:    newSpent,
          averageTicket: newTicket,
          lastOrderAt:   new Date(),
          daysSinceOrder: 0,
          favoriteItems: favItems,
          topItem:       topItemFrom(favItems) || existing.topItem,
          source:        'brendi',
        },
      });
      console.log('[Brendi] Cliente atualizado:', normalizedPhone, '(pedido #' + newTotal + ')');
    } else {
      const favItems = mergeFavoriteItems([], items);
      crmCustomer = await prisma.crmCustomer.create({
        data: {
          wabaAccountId:      wabaAccount.id,
          phone:              normalizedPhone,
          name,
          totalOrders:        1,
          totalSpent:         orderTotal,
          averageTicket:      orderTotal,
          lastOrderAt:        new Date(),
          daysSinceOrder:     0,
          favoriteItems:      favItems,
          topItem:            topItemFrom(favItems),
          preferredDayOfWeek: new Date().getDay(),
          tags:               ['brendi'],
          source:             'brendi',
          externalId:         externalId,
        },
      });
      console.log('[Brendi] Novo cliente criado:', normalizedPhone);
    }

    await prisma.customerOrder.upsert({
      where: { crmCustomerId_externalId: { crmCustomerId: crmCustomer.id, externalId } },
      update: { total: orderTotal, items },
      create: {
        crmCustomerId: crmCustomer.id,
        wabaAccountId: wabaAccount.id,
        externalId,
        total:    orderTotal,
        items,
        source:   'brendi',
        orderedAt: new Date(),
      },
    });
    console.log('[Brendi] Pedido salvo: R$' + orderTotal.toFixed(2));
  } catch (err) {
    console.error('[Brendi] Erro ao processar webhook:', err);
  }
}

function extractItems(rawItems) {
  return rawItems.map(i => ({
    name:     i.name || i.externalCode || 'Item',
    quantity: parseFloat(i.quantity || 1),
    price:    parseFloat(i.unitPrice?.value || i.totalPrice?.value || 0),
  }));
}

function mergeFavoriteItems(existing, newItems) {
  const map = {};
  [].concat(existing, newItems).forEach(item => {
    const key = (item.name || '').toLowerCase();
    if (!map[key]) map[key] = { name: item.name, count: 0, totalSpent: 0 };
    map[key].count++;
    map[key].totalSpent += (item.price || 0) * (item.quantity || 1);
  });
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
}

function topItemFrom(favItems) {
  const first = (favItems || [])[0];
  if (!first) return null;
  return (typeof first === 'string' ? first : first.name) || null;
}

async function getStatus(req, res) {
  try {
    const wabaAccount = await prisma.wabaAccount.findFirst({ where: { userId: req.user.id } });
    const baseUrl = process.env.PUBLIC_URL || 'https://zapcloud-production-a340.up.railway.app';
    const webhookUrl = wabaAccount
      ? `${baseUrl}/webhook/brendi/${wabaAccount.id}`
      : `${baseUrl}/webhook/brendi/{wabaAccountId}`;
    const totalCustomers = await prisma.crmCustomer.count({
      where: { source: 'brendi', ...(wabaAccount ? { wabaAccountId: wabaAccount.id } : {}) },
    });
    res.json({
      success: true,
      data: { webhookUrl, totalReceived: stats.total, lastAt: stats.lastAt, lastPayload: stats.lastPayload, customersInCrm: totalCustomers },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { receiveOrder, getStatus };

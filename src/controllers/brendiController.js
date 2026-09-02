const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { normalizePhone } = require('./multipedidosController');

let stats = { total: 0, lastAt: null, lastPayload: null };

async function receiveOrder(req, res) {
  try {
    const body = req.body;
    console.log('[Brendi] Webhook recebido:', JSON.stringify(body, null, 2));

    stats.total++;
    stats.lastAt = new Date().toISOString();
    stats.lastPayload = body;

    // Verificar assinatura HMAC
    const clientSecret = process.env.BRENDI_CLIENT_SECRET;
    if (clientSecret) {
      const signature = req.headers['x-app-signature'];
      if (signature) {
        const rawBody = JSON.stringify(body);
        const expected = crypto.createHmac('sha256', clientSecret)
          .update(rawBody).digest('hex').toLowerCase();
        if (signature.toLowerCase() !== expected) {
          console.warn('[Brendi] Assinatura inválida recebida:', signature?.slice(0, 16));
          // Log mas não rejeita durante homologação
        }
      }
    }

    // Só processa eventos de novo pedido
    const eventType = body.eventType;
    if (eventType !== 'CREATED') {
      console.log('[Brendi] Ignorando evento:', eventType);
      return res.status(200).json({ success: true, message: 'Evento ignorado.' });
    }

    const order = body.order;
    if (!order) {
      console.warn('[Brendi] Nenhum order no payload');
      return res.json({ success: true, message: 'Sem dados de pedido.' });
    }

    const customer = order.customer || {};
    const phone = customer.phone?.number || '';
    const name = customer.name || 'Cliente Brendi';
    const orderId = body.orderId || order.id;
    const orderTotal = parseFloat(order.total?.orderAmount?.value || 0);
    const items = extractItems(order.items || []);

    if (!phone) {
      console.warn('[Brendi] Nenhum telefone encontrado no payload');
      return res.json({ success: true, message: 'Recebido, mas sem telefone do cliente.' });
    }

    // Rotear para wabaAccount
    let wabaAccount;
    if (req.params?.wabaAccountId) {
      wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: req.params.wabaAccountId } });
    } else {
      wabaAccount = await prisma.wabaAccount.findFirst({ orderBy: { createdAt: 'asc' } });
    }

    if (!wabaAccount) {
      console.warn('[Brendi] Nenhuma WabaAccount encontrada');
      return res.json({ success: true, message: 'Webhook funcionando! Configure uma conta WhatsApp.' });
    }
    console.log('[Brendi] Roteando para conta:', wabaAccount.displayName);

    const normalizedPhone = normalizePhone(phone);
    const externalId = orderId ? String(orderId) : null;

    const existing = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId: wabaAccount.id, phone: normalizedPhone },
    });

    // Detectar reentrega
    const isReplay = !!(existing && externalId && await prisma.customerOrder.findUnique({
      where: { crmCustomerId_externalId: { crmCustomerId: existing.id, externalId } },
    }));

    let crmCustomer;

    if (isReplay) {
      crmCustomer = existing;
      console.log('[Brendi] Pedido ' + externalId + ' reentregue para ' + normalizedPhone + ' — agregados preservados');
    } else if (existing) {
      const newTotal  = existing.totalOrders + 1;
      const newSpent  = parseFloat(existing.totalSpent) + orderTotal;
      const newTicket = newSpent / newTotal;
      let favItems = existing.favoriteItems || [];
      if (items.length) {
        favItems = mergeFavoriteItems(favItems, items);
      }
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
      console.log('[Brendi] Cliente atualizado: ' + normalizedPhone + ' (pedido #' + newTotal + ')');
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
          externalId:         String(orderId || ''),
        },
      });
      console.log('[Brendi] Novo cliente criado: ' + normalizedPhone);
    }

    // Upsert do pedido
    if (externalId) {
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
    } else {
      await prisma.customerOrder.create({
        data: {
          crmCustomerId: crmCustomer.id,
          wabaAccountId: wabaAccount.id,
          externalId:    null,
          total:    orderTotal,
          items,
          source:   'brendi',
          orderedAt: new Date(),
        },
      });
    }

    console.log('[Brendi] Pedido salvo: R$' + orderTotal.toFixed(2));
    res.status(200).json({ success: true, message: 'Pedido processado com sucesso.' });
  } catch (err) {
    console.error('[Brendi] Erro ao processar webhook:', err);
    res.status(500).json({ success: false, message: 'Erro interno.' });
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
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const webhookUrl = wabaAccount
      ? `${baseUrl}/webhook/brendi/${wabaAccount.id}`
      : `${baseUrl}/webhook/brendi`;
    const totalCustomers = await prisma.crmCustomer.count({
      where: { source: 'brendi', ...(wabaAccount ? { wabaAccountId: wabaAccount.id } : {}) },
    });
    res.json({
      success: true,
      data: {
        webhookUrl,
        totalReceived:   stats.total,
        lastAt:          stats.lastAt,
        lastPayload:     stats.lastPayload,
        customersInCrm:  totalCustomers,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { receiveOrder, getStatus };

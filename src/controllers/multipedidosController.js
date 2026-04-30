const prisma = require('../utils/prisma');

let stats = { total: 0, lastAt: null, lastPayload: null };

async function receiveOrder(req, res) {
  try {
    const expectedToken = process.env.MULTIPEDIDOS_TOKEN;
    if (expectedToken) {
      const receivedToken =
        req.headers['x-multipedidos-token'] ||
        req.headers['x-token'] ||
        req.headers['authorization']?.replace('Bearer ', '') ||
        req.body?.token ||
        req.query?.token;
      if (receivedToken !== expectedToken) {
        console.warn('[Multipedidos] Token invalido recebido:', receivedToken?.slice(0, 12));
      }
    }

    const body = req.body;
    console.log('[Multipedidos] Webhook recebido:', JSON.stringify(body, null, 2));

    stats.total++;
    stats.lastAt      = new Date().toISOString();
    stats.lastPayload = body;

    const customer = extractCustomer(body);
    const order    = extractOrder(body);

    if (!customer.phone) {
      console.warn('[Multipedidos] Nenhum telefone encontrado no payload.');
      return res.json({ success: true, message: 'Recebido, mas sem dados de cliente.' });
    }

    const wabaAccount = await prisma.wabaAccount.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (!wabaAccount) {
      console.warn('[Multipedidos] Nenhuma WabaAccount encontrada.');
      return res.json({ success: true, message: 'Webhook funcionando! Configure uma conta WhatsApp.' });
    }

    const phone = normalizePhone(customer.phone);
    const existing = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId: wabaAccount.id, phone },
    });

    let crmCustomer;

    if (existing) {
      const newTotal  = existing.totalOrders + 1;
      const newSpent  = parseFloat(existing.totalSpent) + order.total;
      const newTicket = newSpent / newTotal;
      let favItems = existing.favoriteItems || [];
      if (order.items?.length) {
        favItems = mergeFavoriteItems(favItems, order.items);
      }
      crmCustomer = await prisma.crmCustomer.update({
        where: { id: existing.id },
        data: {
          name:           customer.name || existing.name,
          totalOrders:    newTotal,
          totalSpent:     newSpent,
          averageTicket:  newTicket,
          lastOrderAt:    new Date(),
          daysSinceOrder: 0,
          favoriteItems:  favItems,
          source:         'multipedidos',
        },
      });
      console.log('[Multipedidos] Cliente atualizado: ' + phone + ' (pedido #' + newTotal + ')');
    } else {
      crmCustomer = await prisma.crmCustomer.create({
        data: {
          wabaAccountId:  wabaAccount.id,
          phone,
          name:           customer.name || 'Cliente Multipedidos',
          totalOrders:    1,
          totalSpent:     order.total,
          averageTicket:  order.total,
          lastOrderAt:    new Date(),
          daysSinceOrder: 0,
          favoriteItems:  order.items || [],
          tags:           ['multipedidos'],
          source:         'multipedidos',
          externalId:     String(order.id || ''),
        },
      });
      console.log('[Multipedidos] Novo cliente criado: ' + phone);
    }

    await prisma.customerOrder.create({
      data: {
        crmCustomerId: crmCustomer.id,
        wabaAccountId: wabaAccount.id,
        externalId:    String(order.id || ''),
        total:         order.total,
        items:         order.items || [],
        source:        'multipedidos',
        orderedAt:     new Date(),
      },
    });
    console.log('[Multipedidos] Pedido salvo no historico: R$' + order.total.toFixed(2));

    res.json({ success: true, message: 'Pedido processado com sucesso.' });
  } catch (err) {
    console.error('[Multipedidos] Erro ao processar webhook:', err);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
}

async function getStatus(req, res) {
  try {
    const totalCustomers = await prisma.crmCustomer.count({
      where: { source: 'multipedidos' },
    });
    res.json({
      success: true,
      data: {
        webhookUrl:      (process.env.PUBLIC_URL || 'http://localhost:3000') + '/api/multipedidos/webhook',
        totalReceived:   stats.total,
        lastAt:          stats.lastAt,
        lastPayload:     stats.lastPayload,
        customersInCrm:  totalCustomers,
        tokenConfigured: !!process.env.MULTIPEDIDOS_TOKEN,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

function extractCustomer(body) {
  const c = body.customer || body.cliente || body.client || {};
  return {
    phone: c.phone || c.telefone || c.celular || c.whatsapp ||
           body.phone || body.telefone || body.celular || body.customer_phone || '',
    name:  c.name  || c.nome || c.customer_name ||
           body.name  || body.nome  || body.customer_name  || '',
  };
}

function extractOrder(body) {
  const o = body.order || body.pedido || body;
  return {
    id:    o.id    || o.order_id || o.pedido_id || null,
    total: parseFloat(o.total || o.valor || o.amount || o.price || 0),
    items: extractItems(o),
  };
}

function extractItems(order) {
  const raw = order.items || order.itens || order.products || order.produtos || order.orderItems || order.lineItems || [];
  if (raw.length > 0) {
    console.log('[Multipedidos] Raw item (primeiro):', JSON.stringify(raw[0]));
  }
  return raw.map(function(i) {
    return {
      name:     i.menu_name   || i.name        || i.nome         || i.product_name || i.productName  ||
                i.produto     || i.title        || i.titulo       || i.description  ||
                i.descricao   || i.item_name    || i.itemName     || i.label        ||
                i.item        || i.product      || 'Item',
      quantity: parseInt(i.quantity || i.quantidade || i.qty || i.amount || i.count || 1),
      price:    parseFloat(i.menu_price || i.price || i.valor || i.preco || i.unit_price || i.unitPrice || i.item_sub_total || 0),
    };
  });
}

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  return digits;
}

function mergeFavoriteItems(existing, newItems) {
  const map = {};
  [].concat(existing, newItems).forEach(function(item) {
    const key = (item.name || '').toLowerCase();
    if (!map[key]) map[key] = { name: item.name, count: 0, totalSpent: 0 };
    map[key].count++;
    map[key].totalSpent += (item.price || 0) * (item.quantity || 1);
  });
  return Object.values(map).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
}

module.exports = { receiveOrder, getStatus };

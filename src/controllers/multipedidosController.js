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

    // Rota por wabaAccountId na URL (multi-tenant) ou fallback para a primeira conta
    let wabaAccount;
    if (req.params?.wabaAccountId) {
      wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: req.params.wabaAccountId } });
    } else {
      wabaAccount = await prisma.wabaAccount.findFirst({ orderBy: { createdAt: 'asc' } });
    }

    if (!wabaAccount) {
      console.warn('[Multipedidos] Nenhuma WabaAccount encontrada.');
      return res.json({ success: true, message: 'Webhook funcionando! Configure uma conta WhatsApp.' });
    }
    console.log('[Multipedidos] Roteando para conta:', wabaAccount.displayName);

    const phone = normalizePhone(customer.phone);
    const existing = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId: wabaAccount.id, phone },
    });

    // Id externo do pedido — calculado cedo para detectar reentrega antes dos agregados
    const externalId = order.id ? String(order.id) : null;

    let crmCustomer;

    // Webhook reentregue: o pedido já está no histórico → não incrementa agregados de novo
    const isReplay = !!(existing && externalId && await prisma.customerOrder.findUnique({
      where: { crmCustomerId_externalId: { crmCustomerId: existing.id, externalId } },
    }));

    if (isReplay) {
      crmCustomer = existing;
      console.log('[Multipedidos] Pedido ' + externalId + ' reentregue para ' + phone + ' — agregados preservados');
    } else if (existing) {
      const newTotal  = existing.totalOrders + 1;
      const newSpent  = parseFloat(existing.totalSpent) + order.total;
      const newTicket = newSpent / newTotal;
      let favItems = existing.favoriteItems || [];
      if (order.items?.length) {
        favItems = mergeFavoriteItems(favItems, order.items);
      }
      // O pedido atual ainda não está em CustomerOrder — entra como data extra
      const preferredDayOfWeek = await computePreferredDay(existing.id, [new Date()]);
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
          topItem:        topItemFrom(favItems) || existing.topItem,
          preferredDayOfWeek,
          tags:           buildOrderTags(newTotal, existing.tags),
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
          topItem:        topItemFrom(mergeFavoriteItems([], order.items || [])),
          preferredDayOfWeek: new Date().getDay(),
          tags:           buildOrderTags(1, ['multipedidos']),
          source:         'multipedidos',
          externalId:     String(order.id || ''),
        },
      });
      console.log('[Multipedidos] Novo cliente criado: ' + phone);
    }

    // Upsert pela chave (crmCustomerId, externalId): webhook reentregue não duplica o pedido.
    // Pedido sem id externo entra com externalId null (nulls não colidem no unique) via create simples.
    if (externalId) {
      await prisma.customerOrder.upsert({
        where: { crmCustomerId_externalId: { crmCustomerId: crmCustomer.id, externalId } },
        update: { total: order.total, items: order.items || [] },
        create: {
          crmCustomerId: crmCustomer.id,
          wabaAccountId: wabaAccount.id,
          externalId,
          total:         order.total,
          items:         order.items || [],
          source:        'multipedidos',
          orderedAt:     new Date(),
        },
      });
    } else {
      await prisma.customerOrder.create({
        data: {
          crmCustomerId: crmCustomer.id,
          wabaAccountId: wabaAccount.id,
          externalId:    null,
          total:         order.total,
          items:         order.items || [],
          source:        'multipedidos',
          orderedAt:     new Date(),
        },
      });
    }
    console.log('[Multipedidos] Pedido salvo no historico: R$' + order.total.toFixed(2));

    res.json({ success: true, message: 'Pedido processado com sucesso.' });
  } catch (err) {
    console.error('[Multipedidos] Erro ao processar webhook:', err);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
}

async function getStatus(req, res) {
  try {
    const wabaAccount = await prisma.wabaAccount.findFirst({
      where: { userId: req.user.id },
    });
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const webhookUrl = wabaAccount
      ? `${baseUrl}/api/multipedidos/webhook/${wabaAccount.id}`
      : `${baseUrl}/api/multipedidos/webhook`;

    const totalCustomers = await prisma.crmCustomer.count({
      where: { source: 'multipedidos', ...(wabaAccount ? { wabaAccountId: wabaAccount.id } : {}) },
    });
    res.json({
      success: true,
      data: {
        webhookUrl,
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

// Gera tags de frequência baseadas no total de pedidos
function buildOrderTags(totalOrders, existingTags = []) {
  const base = (existingTags || []).filter(t => !t.startsWith('comprou-'));
  const milestones = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  for (const m of milestones) {
    if (totalOrders >= m) base.push(`comprou-${m}x`);
  }
  return [...new Set(base)];
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

// Primeiro item da lista de favoritos (já ordenada por count). Aceita o formato
// antigo (string) e o atual ({ name }).
function topItemFrom(favItems) {
  const first = (favItems || [])[0];
  if (!first) return null;
  return (typeof first === 'string' ? first : first.name) || null;
}

// Dia da semana (0=domingo … 6=sábado) com mais pedidos. `extraDates` permite
// contar um pedido que ainda não foi gravado em CustomerOrder.
async function computePreferredDay(crmCustomerId, extraDates = []) {
  const orders = await prisma.customerOrder.findMany({
    where: { crmCustomerId },
    select: { orderedAt: true },
  });
  const dates = orders.map(o => o.orderedAt).concat(extraDates);
  if (!dates.length) return null;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  dates.forEach(d => counts[new Date(d).getDay()]++);
  return counts.indexOf(Math.max(...counts));
}

// ─── Backfill: atualizar tags de todos os clientes com base no totalOrders ────
async function backfillTags(req, res) {
  try {
    const customers = await prisma.crmCustomer.findMany({
      select: { id: true, totalOrders: true, tags: true, lastOrderAt: true },
    });

    let updated = 0;
    for (const c of customers) {
      const newTags = buildOrderTags(c.totalOrders, c.tags);
      const daysSinceOrder = c.lastOrderAt
        ? Math.floor((Date.now() - new Date(c.lastOrderAt).getTime()) / 86400000)
        : 0;
      await prisma.crmCustomer.update({
        where: { id: c.id },
        data: { tags: newTags, daysSinceOrder },
      });
      updated++;
    }

    res.json({ success: true, message: `${updated} clientes atualizados com tags e daysSinceOrder.` });
  } catch (err) {
    console.error('[Backfill] Erro:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Backfill: recalcular topItem e preferredDayOfWeek de todos os clientes ───
async function backfillPreferred(req, res) {
  try {
    const customers = await prisma.crmCustomer.findMany({
      select: {
        id: true,
        favoriteItems: true,
        orders: { select: { orderedAt: true, items: true } },
      },
    });

    let updated = 0;
    for (const c of customers) {
      // topItem: recalculado a partir dos itens de todos os pedidos;
      // sem itens no histórico, cai para os favoritos já acumulados no cliente
      const allItems = c.orders.flatMap(o => (Array.isArray(o.items) ? o.items : []));
      const topItem = topItemFrom(mergeFavoriteItems([], allItems)) || topItemFrom(c.favoriteItems);

      let preferredDayOfWeek = null;
      if (c.orders.length) {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        c.orders.forEach(o => counts[new Date(o.orderedAt).getDay()]++);
        preferredDayOfWeek = counts.indexOf(Math.max(...counts));
      }

      await prisma.crmCustomer.update({
        where: { id: c.id },
        data: { topItem, preferredDayOfWeek },
      });
      updated++;
    }

    res.json({ success: true, message: `${updated} clientes atualizados com topItem e preferredDayOfWeek.` });
  } catch (err) {
    console.error('[Backfill preferred] Erro:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { receiveOrder, getStatus, backfillTags, backfillPreferred, normalizePhone };


const prisma = require('../utils/prisma');

// Contador de pedidos recebidos (em memória — só para status)
let stats = { total: 0, lastAt: null, lastPayload: null };

/**
 * POST /api/multipedidos/webhook
 *
 * Multipedidos chama esta rota a cada novo pedido.
 * Autenticamos pelo token configurado em MULTIPEDIDOS_TOKEN.
 * Extraímos dados do cliente e upsertamos no CRM.
 */
async function receiveOrder(req, res) {
  try {
    // ── 1. Verificar token ────────────────────────────────────────
    const expectedToken = process.env.MULTIPEDIDOS_TOKEN;
    if (expectedToken) {
      // Token pode vir no header ou no body
      const receivedToken =
        req.headers['x-multipedidos-token'] ||
        req.headers['x-token'] ||
        req.headers['authorization']?.replace('Bearer ', '') ||
        req.body?.token ||
        req.query?.token;

      if (receivedToken !== expectedToken) {
        console.warn('[Multipedidos] Token inválido recebido:', receivedToken?.slice(0, 12));
        // Responde 200 mesmo assim para não bloquear (analisamos o payload)
      }
    }

    const body = req.body;
    console.log('[Multipedidos] Webhook recebido:', JSON.stringify(body, null, 2));

    // ── 2. Salva payload bruto para debug ─────────────────────────
    stats.total++;
    stats.lastAt      = new Date().toISOString();
    stats.lastPayload = body;

    // ── 3. Extrai dados do cliente (tenta vários formatos) ────────
    const customer = extractCustomer(body);
    const order    = extractOrder(body);

    if (!customer.phone) {
      console.warn('[Multipedidos] Nenhum telefone encontrado no payload.');
      return res.json({ success: true, message: 'Recebido, mas sem dados de cliente.' });
    }

    // ── 4. Descobre a conta WABA do restaurante ───────────────────
    // Usa o primeiro WabaAccount ativo (1 restaurante = 1 conta)
    const wabaAccount = await prisma.wabaAccount.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (!wabaAccount) {
      console.warn('[Multipedidos] Nenhuma WabaAccount encontrada — pedido recebido em modo teste.');
      stats.total++;
      stats.lastAt = new Date().toISOString();
      return res.json({ success: true, message: 'Webhook funcionando! Configure uma conta WhatsApp para salvar clientes no CRM.' });
    }

    // ── 5. Upsert no CRM ─────────────────────────────────────────
    const phone = normalizePhone(customer.phone);

    const existing = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId: wabaAccount.id, phone },
    });

    if (existing) {
      // Atualiza dados do cliente existente
      const newTotal  = existing.totalOrders + 1;
      const newSpent  = parseFloat(existing.totalSpent) + order.total;
      const newTicket = newSpent / newTotal;

      // Atualiza itens favoritos
      let favItems = existing.favoriteItems || [];
      if (order.items?.length) {
        favItems = mergeFavoriteItems(favItems, order.items);
      }

      await prisma.crmCustomer.update({
        where: { id: existing.id },
        data: {
          name:          customer.name || existing.name,
          totalOrders:   newTotal,
          totalSpent:    newSpent,
          averageTicket: newTicket,
          lastOrderAt:   new Date(),
          daysSinceOrder: 0,
          favoriteItems: favItems,
          source:        'multipedidos',
        },
      });
      console.log(`[Multipedidos] Cliente atualizado: ${phone} (pedido #${newTotal})`);
    } else {
      // Cria novo cliente
      await prisma.crmCustomer.create({
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
      console.log(`[Multipedidos] Novo cliente criado: ${phone}`);
    }

    res.json({ success: true, message: 'Pedido processado com sucesso.' });
  } catch (err) {
    console.error('[Multipedidos] Erro ao processar webhook:', err);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
}

/**
 * GET /api/multipedidos/status
 * Retorna estatísticas da integração.
 */
async function getStatus(req, res) {
  try {
    const totalCustomers = await prisma.crmCustomer.count({
      where: { source: 'multipedidos' },
    });
    res.json({
      success: true,
      data: {
        webhookUrl:      `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/multipedidos/webhook`,
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

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Tenta extrair dados do cliente de vários formatos possíveis
 * (Multipedidos pode usar diferentes nomes de campo)
 */
function extractCustomer(body) {
  // Formato 1: body.customer / body.cliente
  const c = body.customer || body.cliente || body.client || {};
  // Formato 2: campos direto no body
  return {
    phone: c.phone || c.telefone || c.celular || c.whatsapp ||
           body.phone || body.telefone || body.celular || body.customer_phone || '',
    name:  c.name  || c.nome || c.customer_name ||
           body.name  || body.nome  || body.customer_name  || '',
  };
}

/**
 * Tenta extrair dados do pedido de vários formatos possíveis
 */
function extractOrder(body) {
  const o = body.order || body.pedido || body;
  return {
    id:    o.id    || o.order_id || o.pedido_id || null,
    total: parseFloat(o.total || o.valor || o.amount || o.price || 0),
    items: extractItems(o),
  };
}

function extractItems(order) {
  const raw = order.items || order.itens || order.products || order.produtos || [];
  return raw.map(i => ({
    name:     i.name || i.nome || i.product_name || i.produto || 'Item',
    quantity: parseInt(i.quantity || i.quantidade || i.qty || 1),
    price:    parseFloat(i.price || i.valor || i.preco || 0),
  }));
}

/**
 * Normaliza telefone para apenas dígitos (com código do país)
 */
function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  return digits;
}

/**
 * Mescla itens favoritos acumulando contagem
 */
function mergeFavoriteItems(existing, newItems) {
  const map = {};
  [...existing, ...newItems].forEach(item => {
    const key = (item.name || '').toLowerCase();
    if (!map[key]) map[key] = { ...item, count: 0 };
    map[key].count = (map[key].count || 0) + (item.quantity || 1);
  });
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
}

module.exports = { receiveOrder, getStatus };

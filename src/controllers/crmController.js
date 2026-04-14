
const prisma = require('../utils/prisma');

// ─── Listar clientes com filtros de segmentação ───────────────────────────────
const listCustomers = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { daysInactive, minOrders, maxOrders, minTicket, favoriteItem, tag, search, orderDate, fromDate, toDate, source, page = 1, limit = 50 } = req.query;

    const where = { wabaAccountId, isActive: true };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (minOrders) where.totalOrders = { ...where.totalOrders, gte: parseInt(minOrders) };
    if (maxOrders) where.totalOrders = { ...where.totalOrders, lte: parseInt(maxOrders) };
    if (minTicket)  where.averageTicket = { gte: parseFloat(minTicket) };
    if (daysInactive) where.daysSinceOrder = { gte: parseInt(daysInactive) };
    if (tag) where.tags = { has: tag };
    if (source) where.source = source;
    // Filtro por data — intervalo fromDate→toDate ou dia único orderDate
    if (fromDate || toDate || orderDate) {
      const start = fromDate ? new Date(fromDate) : orderDate ? new Date(orderDate) : null;
      const end   = toDate   ? new Date(toDate)   : orderDate ? new Date(orderDate) : null;
      if (start) start.setHours(0, 0, 0, 0);
      if (end)   end.setHours(23, 59, 59, 999);
      where.lastOrderAt = {};
      if (start) where.lastOrderAt.gte = start;
      if (end)   where.lastOrderAt.lte = end;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [customers, total] = await Promise.all([
      prisma.crmCustomer.findMany({ where, orderBy: { lastOrderAt: 'desc' }, skip, take: parseInt(limit) }),
      prisma.crmCustomer.count({ where }),
    ]);

    // Recalcula daysSinceOrder dinamicamente
    const now = new Date();
    const result = customers.map(c => ({
      ...c,
      daysSinceOrder: c.lastOrderAt ? Math.floor((now - new Date(c.lastOrderAt)) / 86400000) : 999,
    }));

    res.json({ success: true, data: { customers: result, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao listar clientes.', error: err.message });
  }
};

// ─── Criar/atualizar cliente manualmente ─────────────────────────────────────
const upsertCustomer = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { phone, name, email, tags, totalOrders, totalSpent, lastOrderAt, favoriteItems } = req.body;

    const customer = await prisma.crmCustomer.upsert({
      where: { wabaAccountId_phone: { wabaAccountId, phone } },
      update: { name, email, tags, totalOrders, totalSpent,
        averageTicket: totalOrders > 0 ? totalSpent / totalOrders : 0,
        lastOrderAt: lastOrderAt ? new Date(lastOrderAt) : undefined,
        favoriteItems: favoriteItems || [],
        daysSinceOrder: lastOrderAt ? Math.floor((new Date() - new Date(lastOrderAt)) / 86400000) : 0,
      },
      create: { wabaAccountId, phone, name, email, tags: tags || [], totalOrders: totalOrders || 0,
        totalSpent: totalSpent || 0, averageTicket: totalOrders > 0 ? totalSpent / totalOrders : 0,
        lastOrderAt: lastOrderAt ? new Date(lastOrderAt) : null,
        firstOrderAt: lastOrderAt ? new Date(lastOrderAt) : null,
        favoriteItems: favoriteItems || [],
        daysSinceOrder: lastOrderAt ? Math.floor((new Date() - new Date(lastOrderAt)) / 86400000) : 0,
        source: 'manual',
      },
    });

    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao salvar cliente.', error: err.message });
  }
};

// ─── Importar clientes via CSV/JSON (bulk) ────────────────────────────────────
const importCustomers = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { customers, source = 'import' } = req.body;

    let imported = 0, updated = 0;
    for (const c of customers) {
      const exists = await prisma.crmCustomer.findUnique({ where: { wabaAccountId_phone: { wabaAccountId, phone: c.phone } } });

      // Se o cliente já existe via Multipedidos, preserva dados reais mais recentes
      const importedDate  = c.lastOrderAt ? new Date(c.lastOrderAt) : null;
      const existingDate  = exists?.lastOrderAt ? new Date(exists.lastOrderAt) : null;
      // Mantém a data mais recente (real ou importada)
      const keepDate      = existingDate && importedDate && existingDate > importedDate ? existingDate : importedDate;
      const keepSource    = exists?.source === 'multipedidos' ? 'multipedidos' : source;
      // Mantém o maior total de pedidos (real pode ser maior que histórico)
      const keepOrders    = exists ? Math.max(exists.totalOrders, c.totalOrders || 0) : (c.totalOrders || 0);
      const keepSpent     = exists && exists.source === 'multipedidos' && exists.totalSpent > (c.totalSpent || 0)
        ? parseFloat(exists.totalSpent) : (c.totalSpent || 0);
      const keepTicket    = keepOrders > 0 ? keepSpent / keepOrders : 0;
      const keepDays      = keepDate ? Math.floor((new Date() - keepDate) / 86400000) : 0;

      await prisma.crmCustomer.upsert({
        where: { wabaAccountId_phone: { wabaAccountId, phone: c.phone } },
        update: {
          name: c.name || exists?.name,
          totalOrders: keepOrders,
          totalSpent: keepSpent,
          averageTicket: keepTicket,
          lastOrderAt: keepDate,
          daysSinceOrder: keepDays,
          favoriteItems: c.favoriteItems?.length ? c.favoriteItems : (exists?.favoriteItems || []),
          tags: c.tags || exists?.tags || [],
          source: keepSource,
        },
        create: {
          wabaAccountId, phone: c.phone, name: c.name,
          totalOrders: c.totalOrders || 0,
          totalSpent: c.totalSpent || 0,
          averageTicket: c.totalOrders > 0 ? (c.totalSpent || 0) / c.totalOrders : 0,
          lastOrderAt: importedDate,
          firstOrderAt: importedDate,
          favoriteItems: c.favoriteItems || [],
          tags: c.tags || [],
          source,
          daysSinceOrder: importedDate ? Math.floor((new Date() - importedDate) / 86400000) : 0,
        },
      });
      exists ? updated++ : imported++;
    }

    res.json({ success: true, data: { imported, updated, total: customers.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao importar clientes.', error: err.message });
  }
};

// ─── Métricas do CRM ──────────────────────────────────────────────────────────
const getMetrics = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const now = new Date();

    const [total, active7, active30, inactive7, inactive30, topSpenders] = await Promise.all([
      prisma.crmCustomer.count({ where: { wabaAccountId } }),
      prisma.crmCustomer.count({ where: { wabaAccountId, lastOrderAt: { gte: new Date(now - 7 * 86400000) } } }),
      prisma.crmCustomer.count({ where: { wabaAccountId, lastOrderAt: { gte: new Date(now - 30 * 86400000) } } }),
      prisma.crmCustomer.count({ where: { wabaAccountId, lastOrderAt: { lt: new Date(now - 7 * 86400000) } } }),
      prisma.crmCustomer.count({ where: { wabaAccountId, lastOrderAt: { lt: new Date(now - 30 * 86400000) } } }),
      prisma.crmCustomer.findMany({ where: { wabaAccountId }, orderBy: { totalSpent: 'desc' }, take: 5 }),
    ]);

    res.json({ success: true, data: { total, active7, active30, inactive7, inactive30, topSpenders } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar métricas.', error: err.message });
  }
};

// ─── Excluir todos por source (bulk) ─────────────────────────────────────────
const deleteBySource = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { source } = req.query;
    if (!source) return res.status(400).json({ success: false, message: 'Informe o source.' });
    const result = await prisma.crmCustomer.deleteMany({
      where: { wabaAccountId, source },
    });
    res.json({ success: true, deleted: result.count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Excluir cliente ──────────────────────────────────────────────────────────
const deleteCustomer = async (req, res) => {
  try {
    const { wabaAccountId, customerId } = req.params;
    await prisma.crmCustomer.deleteMany({
      where: { id: customerId, wabaAccountId },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir cliente.', error: err.message });
  }
};

module.exports = { listCustomers, upsertCustomer, importCustomers, getMetrics, deleteCustomer, deleteBySource };

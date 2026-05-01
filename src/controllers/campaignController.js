
const axios = require('axios');
const prisma = require('../utils/prisma');

// ─── Substituir variáveis na mensagem ────────────────────────────────────────
function buildMessage(template, customer) {
  const favItems = Array.isArray(customer.favoriteItems) ? customer.favoriteItems : [];
  const favorite = favItems[0]?.name || favItems[0] || 'seu pedido favorito';
  const days = customer.daysSinceOrder || Math.floor((new Date() - new Date(customer.lastOrderAt)) / 86400000) || 0;

  return template
    .replace(/\{\{nome\}\}/gi, customer.name || 'cliente')
    .replace(/\{\{produto_favorito\}\}/gi, favorite)
    .replace(/\{\{dias_sem_comprar\}\}/gi, days)
    .replace(/\{\{total_pedidos\}\}/gi, customer.totalOrders || 0)
    .replace(/\{\{ticket_medio\}\}/gi, `R$ ${(customer.averageTicket || 0).toFixed(2)}`);
}

// ─── Aplicar filtros de segmento ──────────────────────────────────────────────
function buildFilter(wabaAccountId, segmentFilter) {
  const where = { wabaAccountId, isActive: true };
  const { daysInactive, minDaysInactive, maxDaysInactive, minOrders, maxOrders, minTicket, maxTicket, favoriteItem, tag, tags } = segmentFilter || {};

  if (daysInactive)    where.daysSinceOrder = { gte: parseInt(daysInactive) };
  if (minDaysInactive) where.daysSinceOrder = { ...where.daysSinceOrder, gte: parseInt(minDaysInactive) };
  if (maxDaysInactive) where.daysSinceOrder = { ...where.daysSinceOrder, lte: parseInt(maxDaysInactive) };
  if (minOrders)       where.totalOrders    = { ...where.totalOrders, gte: parseInt(minOrders) };
  if (maxOrders)       where.totalOrders    = { ...where.totalOrders, lte: parseInt(maxOrders) };
  if (minTicket)       where.averageTicket  = { ...where.averageTicket, gte: parseFloat(minTicket) };
  if (maxTicket)       where.averageTicket  = { ...where.averageTicket, lte: parseFloat(maxTicket) };
  if (tag)             where.tags           = { has: tag };
  if (tags?.length)    where.tags           = { hasSome: tags };

  return where;
}

// ─── Listar campanhas ─────────────────────────────────────────────────────────
const listCampaigns = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const campaigns = await prisma.campaign.findMany({
      where: { wabaAccountId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao listar campanhas.', error: err.message });
  }
};

// ─── Criar campanha ───────────────────────────────────────────────────────────
const createCampaign = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { name, message, segmentFilter } = req.body;

    // Conta quantos clientes serão impactados
    const where = buildFilter(wabaAccountId, segmentFilter);
    const totalRecipients = await prisma.crmCustomer.count({ where });

    const campaign = await prisma.campaign.create({
      data: { wabaAccountId, name, message, segmentFilter: segmentFilter || {}, totalRecipients },
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar campanha.', error: err.message });
  }
};

// ─── Preview: quantos clientes o segmento atinge ─────────────────────────────
const previewSegment = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { segmentFilter } = req.body;

    const where = buildFilter(wabaAccountId, segmentFilter);
    const [count, sample] = await Promise.all([
      prisma.crmCustomer.count({ where }),
      prisma.crmCustomer.findMany({ where, take: 5, orderBy: { lastOrderAt: 'desc' } }),
    ]);

    res.json({ success: true, data: { count, sample } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao calcular segmento.', error: err.message });
  }
};

// ─── Disparar campanha ────────────────────────────────────────────────────────
const executeCampaign = async (req, res) => {
  try {
    const { wabaAccountId, campaignId } = req.params;

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, wabaAccountId } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });
    if (campaign.status === 'RUNNING') return res.status(400).json({ success: false, message: 'Campanha já está em execução.' });

    const wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: wabaAccountId } });
    if (!wabaAccount) return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });

    // Busca clientes do segmento
    const where = buildFilter(wabaAccountId, campaign.segmentFilter);
    const customers = await prisma.crmCustomer.findMany({ where });

    // Atualiza status para RUNNING
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'RUNNING', startedAt: new Date(), totalRecipients: customers.length } });

    // Responde imediatamente e processa em background
    res.json({ success: true, message: `Campanha iniciada! ${customers.length} clientes serão contatados.`, data: { total: customers.length } });

    // Processa envios em background
    let sent = 0, failed = 0;
    for (const customer of customers) {
      try {
        const finalMessage = buildMessage(campaign.message, customer);

        // Cria registro de execução
        const execution = await prisma.campaignExecution.create({
          data: { campaignId, crmCustomerId: customer.id, message: finalMessage },
        });

        // Envia via Meta API
        const phone = customer.phone.replace(/\D/g, '');
        const response = await axios.post(
          `${process.env.META_BASE_URL}/${process.env.META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: finalMessage } },
          { headers: { Authorization: `Bearer ${wabaAccount.accessToken}`, 'Content-Type': 'application/json' } }
        );

        const waMessageId = response.data?.messages?.[0]?.id;
        await prisma.campaignExecution.update({
          where: { id: execution.id },
          data: { status: 'SENT', sentAt: new Date(), waMessageId },
        });
        sent++;
      } catch (err) {
        failed++;
        await prisma.campaignExecution.updateMany({
          where: { campaignId, crmCustomerId: customer.id },
          data: { status: 'FAILED', failedReason: err.message },
        });
      }

      // Delay de 500ms entre mensagens para evitar rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'COMPLETED', completedAt: new Date(), sentCount: sent, failedCount: failed },
    });

  } catch (err) {
    await prisma.campaign.update({ where: { id: req.params.campaignId }, data: { status: 'FAILED' } }).catch(() => {});
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro ao executar campanha.', error: err.message });
  }
};

// ─── Status/detalhes da campanha ──────────────────────────────────────────────
const getCampaign = async (req, res) => {
  try {
    const { wabaAccountId, campaignId } = req.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, wabaAccountId },
      include: { executions: { include: { crmCustomer: true }, take: 20, orderBy: { createdAt: 'desc' } } },
    });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar campanha.', error: err.message });
  }
};


// ─── Envio de teste ───────────────────────────────────────────────────────────
const testSend = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'Telefone e mensagem são obrigatórios.' });
    }

    const wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: wabaAccountId } });
    if (!wabaAccount) return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });

    // Busca dados do cliente pelo telefone para substituir variáveis
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('55') ? digits : '55' + digits;
    const customer = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId, phone: normalized },
    }) || {
      name: 'Cliente',
      favoriteItems: [],
      daysSinceOrder: 0,
      totalOrders: 0,
      averageTicket: 0,
    };

    const finalMessage = buildMessage(message, customer);

    const response = await axios.post(
      `${process.env.META_BASE_URL}/${process.env.META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body: finalMessage } },
      { headers: { Authorization: `Bearer ${wabaAccount.accessToken}`, 'Content-Type': 'application/json' } }
    );

    const waMessageId = response.data?.messages?.[0]?.id;
    console.log('[Campaign] Teste enviado para', normalized, '| msgId:', waMessageId);
    res.json({ success: true, message: 'Mensagem de teste enviada!', data: { phone: normalized, finalMessage, waMessageId } });
  } catch (err) {
    console.error('[Campaign] Erro no envio de teste:', err?.response?.data || err.message);
    res.status(500).json({ success: false, message: err?.response?.data?.error?.message || err.message });
  }
};

module.exports = { listCampaigns, createCampaign, previewSegment, executeCampaign, getCampaign, testSend };

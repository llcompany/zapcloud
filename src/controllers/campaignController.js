
const axios = require('axios');
const prisma = require('../utils/prisma');
const { buildBodyParameters, renderTemplateBody } = require('../utils/templateVars');

const META_BASE_URL = process.env.META_BASE_URL || 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

// ─── Normalização de telefone (mesma regra do multipedidosController) ────────
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  return digits;
}

/**
 * Monta o payload da Meta para um cliente.
 * Com template → type:'template' (único formato aceito fora da janela de 24h).
 * Sem template → type:'text' (legado; só funciona dentro da janela de 24h).
 */
function buildMetaPayload({ to, template, templateParams, customer, fallbackText }) {
  if (template) {
    const parameters = buildBodyParameters(templateParams, customer || {});
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: parameters.length ? [{ type: 'body', parameters }] : [],
      },
    };
  }
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: fallbackText } };
}

function metaError(error) {
  return error?.response?.data?.error?.error_user_msg
    || error?.response?.data?.error?.message
    || error.message;
}

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

  // Usa lastOrderAt para calcular dias dinamicamente (daysSinceOrder no banco fica obsoleto)
  const now = Date.now();
  if (daysInactive)    where.lastOrderAt = { ...where.lastOrderAt, lte: new Date(now - parseInt(daysInactive) * 86400000) };
  if (minDaysInactive) where.lastOrderAt = { ...where.lastOrderAt, lte: new Date(now - parseInt(minDaysInactive) * 86400000) };
  if (maxDaysInactive) where.lastOrderAt = { ...where.lastOrderAt, gte: new Date(now - parseInt(maxDaysInactive) * 86400000) };
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
    const { name, message, segmentFilter, templateId, templateParams } = req.body;

    let template = null;
    let params = Array.isArray(templateParams) ? templateParams : [];

    if (templateId) {
      template = await prisma.template.findFirst({ where: { id: templateId, wabaAccountId } });
      if (!template) {
        return res.status(404).json({ success: false, message: 'Template não encontrado nesta conta.' });
      }
      if (params.length !== template.variableCount) {
        return res.status(400).json({
          success: false,
          message: `O template "${template.name}" tem ${template.variableCount} variável(is); foram mapeadas ${params.length}.`,
        });
      }
    } else {
      params = [];
      if (!message) {
        return res.status(400).json({ success: false, message: 'Escolha um template ou informe a mensagem.' });
      }
    }

    // Conta quantos clientes serão impactados
    const where = buildFilter(wabaAccountId, segmentFilter);
    const totalRecipients = await prisma.crmCustomer.count({ where });

    const campaign = await prisma.campaign.create({
      data: {
        wabaAccountId,
        name,
        // Com template, `message` guarda o corpo aprovado apenas como referência/histórico
        message: message || template?.bodyText || '',
        templateId: template?.id || null,
        templateParams: params,
        segmentFilter: segmentFilter || {},
        totalRecipients,
      },
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

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, wabaAccountId },
      include: { template: true },
    });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });
    if (campaign.status === 'RUNNING') return res.status(400).json({ success: false, message: 'Campanha já está em execução.' });

    const wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: wabaAccountId } });
    if (!wabaAccount) return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });

    // Disparo em massa atinge clientes fora da janela de 24h — a Meta só aceita
    // template aprovado nesse caso (erro 131047 para texto livre).
    const template = campaign.template;
    if (!template) {
      return res.status(400).json({
        success: false,
        message: 'Esta campanha não tem template. Selecione um template aprovado — a Meta bloqueia texto livre para clientes fora da janela de 24h.',
      });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        message: `O template "${template.name}" está com status ${template.status}. Só é possível disparar com template APPROVED.`,
      });
    }

    // Busca clientes do segmento
    const where = buildFilter(wabaAccountId, campaign.segmentFilter);
    const customers = await prisma.crmCustomer.findMany({ where });

    // Atualiza status para RUNNING
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'RUNNING', startedAt: new Date(), totalRecipients: customers.length } });

    // Responde imediatamente e processa em background
    res.json({ success: true, message: `Campanha iniciada! ${customers.length} clientes serão contatados.`, data: { total: customers.length } });

    // Processa envios em background
    let sent = 0, failed = 0;
    const params = Array.isArray(campaign.templateParams) ? campaign.templateParams : [];

    for (const customer of customers) {
      try {
        // Texto só para registro/auditoria — o envio real vai pelos `parameters`
        const finalMessage = renderTemplateBody(template.bodyText, params, customer);

        // Cria registro de execução
        const execution = await prisma.campaignExecution.create({
          data: { campaignId, crmCustomerId: customer.id, message: finalMessage },
        });

        // Envia via Meta API
        const phone = normalizePhone(customer.phone);
        const response = await axios.post(
          `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
          buildMetaPayload({ to: phone, template, templateParams: params, customer }),
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
        console.error('[Campaign] Falha ao enviar para', customer.phone, '→', metaError(err));
        await prisma.campaignExecution.updateMany({
          where: { campaignId, crmCustomerId: customer.id },
          data: { status: 'FAILED', failedReason: metaError(err) },
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
    const { phone, message, templateId, templateParams } = req.body;

    if (!phone || (!message && !templateId)) {
      return res.status(400).json({ success: false, message: 'Telefone e template (ou mensagem) são obrigatórios.' });
    }

    const wabaAccount = await prisma.wabaAccount.findUnique({ where: { id: wabaAccountId } });
    if (!wabaAccount) return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });

    let template = null;
    if (templateId) {
      template = await prisma.template.findFirst({ where: { id: templateId, wabaAccountId } });
      if (!template) return res.status(404).json({ success: false, message: 'Template não encontrado nesta conta.' });
      if (template.status !== 'APPROVED') {
        return res.status(400).json({
          success: false,
          message: `Template com status ${template.status}. Aguarde a aprovação da Meta para testar.`,
        });
      }
    }

    // Busca dados do cliente pelo telefone para substituir variáveis
    const normalized = normalizePhone(phone);
    const customer = await prisma.crmCustomer.findFirst({
      where: { wabaAccountId, phone: normalized },
    }) || {
      name: 'Cliente',
      favoriteItems: [],
      daysSinceOrder: 0,
      totalOrders: 0,
      averageTicket: 0,
    };

    const params = Array.isArray(templateParams) ? templateParams : [];
    const finalMessage = template
      ? renderTemplateBody(template.bodyText, params, customer)
      : buildMessage(message, customer);

    const response = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
      buildMetaPayload({ to: normalized, template, templateParams: params, customer, fallbackText: finalMessage }),
      { headers: { Authorization: `Bearer ${wabaAccount.accessToken}`, 'Content-Type': 'application/json' } }
    );

    const waMessageId = response.data?.messages?.[0]?.id;
    console.log('[Campaign] Teste enviado para', normalized, '| msgId:', waMessageId);
    res.json({ success: true, message: 'Mensagem de teste enviada!', data: { phone: normalized, finalMessage, waMessageId } });
  } catch (err) {
    console.error('[Campaign] Erro no envio de teste:', err?.response?.data || err.message);
    res.status(500).json({ success: false, message: metaError(err) });
  }
};

module.exports = { listCampaigns, createCampaign, previewSegment, executeCampaign, getCampaign, testSend };

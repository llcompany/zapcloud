
const axios = require('axios');
const prisma = require('../utils/prisma');
const {
  buildBodyParameters,
  renderTemplateBody,
  publicBaseUrl,
  trackingUrlFor,
} = require('../utils/templateVars');

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
function buildMetaPayload({ to, template, templateParams, customer, ctx, fallbackText }) {
  if (template) {
    const parameters = buildBodyParameters(templateParams, customer || {}, ctx);
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
  const { allCustomers, sourceFilter, daysInactive, minDaysInactive, maxDaysInactive, minOrders, maxOrders, minTicket, maxTicket, favoriteItem, tag, tags, preferredDay, topItem } = segmentFilter || {};

  // Origem se aplica antes do atalho de "todos": permite disparar para
  // toda a base de uma origem específica (ex: todos de fidelidade_10x).
  // Aceita string (legado) ou array (multi-select).
  if (sourceFilter) {
    let sf = sourceFilter;
    // Deserializa JSON string gravado no banco (ex: '["multipedidos","fidelidade"]')
    if (typeof sf === 'string' && sf.startsWith('[')) {
      try { sf = JSON.parse(sf); } catch(e) {}
    }
    if (Array.isArray(sf) && sf.length > 0) {
      where.source = sf.length === 1 ? sf[0] : { in: sf };
    } else if (typeof sf === 'string') {
      where.source = sf;
    }
  }

  // "Todos os clientes" descarta o restante da segmentação.
  // isActive permanece porque a tela de CRM também filtra por ele: assim
  // "todos" significa exatamente os clientes que o usuário vê listados.
  if (allCustomers) return where;

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
  // 0 é domingo — checar por null/'' para não descartar o valor 0
  if (preferredDay !== undefined && preferredDay !== null && preferredDay !== '') {
    where.preferredDayOfWeek = parseInt(preferredDay);
  }
  if (topItem)         where.topItem        = { contains: topItem, mode: 'insensitive' };

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
    const { name, message, segmentFilter, templateId, templateParams, sourceFilter } = req.body;
    const source = sourceFilter || segmentFilter?.sourceFilter || null;

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
    const where = buildFilter(wabaAccountId, { ...(segmentFilter || {}), sourceFilter: source });
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
        sourceFilter: Array.isArray(source) ? JSON.stringify(source) : source,
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
    const { segmentFilter, sourceFilter } = req.body;

    const where = buildFilter(wabaAccountId, { ...(segmentFilter || {}), sourceFilter: sourceFilter || segmentFilter?.sourceFilter || null });
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
    // Permite retomar RUNNING (disparo interrompido) e COMPLETED (redisparo explícito)
    if (!['DRAFT','RUNNING','COMPLETED','FAILED'].includes(campaign.status)) {
      return res.status(400).json({ success: false, message: `Não é possível disparar campanha com status ${campaign.status}.` });
    }

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

    // Busca clientes do segmento (a origem gravada na campanha entra no filtro)
    const where = buildFilter(wabaAccountId, { ...(campaign.segmentFilter || {}), sourceFilter: campaign.sourceFilter || campaign.segmentFilter?.sourceFilter || null });
    const allCustomers = await prisma.crmCustomer.findMany({ where });

    // Custo estimado a partir do preço por conversa do template
    const unitCost = template.costPerConversation || 0;
    const estimatedCost = unitCost ? Number((allCustomers.length * unitCost).toFixed(2)) : null;

    // Link rastreado só é possível com uma base pública configurada
    const usesTracking = (campaign.templateParams || []).includes('link_rastreado');
    if (usesTracking && !publicBaseUrl()) {
      return res.status(400).json({
        success: false,
        message: 'A campanha usa link rastreado, mas PUBLIC_URL (ou APP_URL) não está configurada no servidor. Sem isso o link enviado ao cliente não funcionaria.',
      });
    }

    // ── Processamento em lotes ───────────────────────────────────────────────
    // Cada chamada processa no máximo BATCH_SIZE clientes e retorna.
    // O frontend chama execute repetidamente até done=true.
    // Isso garante que nenhuma requisição dura mais de ~15 segundos,
    // eliminando a dependência de processos background que podem ser mortos.
    const BATCH_SIZE = 25;
    const DELAY_MS   = 200; // 200ms entre envios dentro do lote

    // Clientes ainda não processados (unique constraint impede duplicatas)
    const executedIds = await prisma.campaignExecution.findMany({
      where: { campaignId },
      select: { crmCustomerId: true },
    });
    const executedSet = new Set(executedIds.map(e => e.crmCustomerId));
    const pending = allCustomers.filter(c => !executedSet.has(c.id));
    const batch   = pending.slice(0, BATCH_SIZE);

    // Contadores acumulados do que já foi processado
    const [alreadySent, alreadyFailed] = await Promise.all([
      prisma.campaignExecution.count({ where: { campaignId, status: 'SENT' } }),
      prisma.campaignExecution.count({ where: { campaignId, status: 'FAILED' } }),
    ]);

    // Na primeira chamada zera contadores; nas demais preserva
    const isFirstBatch = executedSet.size === 0;
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'RUNNING',
        startedAt: campaign.startedAt || new Date(),
        totalRecipients: allCustomers.length,
        estimatedCost,
        ...(isFirstBatch ? { sentCount: 0, failedCount: 0, readCount: 0, clickCount: 0, totalCost: null } : {}),
      },
    });

    const params = Array.isArray(campaign.templateParams) ? campaign.templateParams : [];
    let sent = alreadySent, failed = alreadyFailed;

    for (const customer of batch) {
      try {
        let execution;
        try {
          execution = await prisma.campaignExecution.create({
            data: { campaignId, crmCustomerId: customer.id, message: '' },
          });
        } catch (dupErr) {
          if (dupErr?.code === 'P2002') { continue; } // já processado por lote anterior
          throw dupErr;
        }

        const ctx = { trackingUrl: trackingUrlFor(execution.id) };
        const finalMessage = renderTemplateBody(template.bodyText, params, customer, ctx);
        const phone = normalizePhone(customer.phone);

        const response = await axios.post(
          `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
          buildMetaPayload({ to: phone, template, templateParams: params, customer, ctx }),
          { headers: { Authorization: `Bearer ${wabaAccount.accessToken}`, 'Content-Type': 'application/json' } }
        );

        const waMessageId = response.data?.messages?.[0]?.id;
        await prisma.campaignExecution.update({
          where: { id: execution.id },
          data: { status: 'SENT', sentAt: new Date(), waMessageId, message: finalMessage },
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

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const remaining = pending.length - batch.length;
    const done = remaining === 0;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: sent,
        failedCount: failed,
        ...(done ? {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalCost: unitCost ? Number((sent * unitCost).toFixed(2)) : null,
        } : {}),
      },
    });

    res.json({
      success: true,
      done,
      remaining,
      message: done
        ? `Disparo concluído! ${sent} enviadas, ${failed} falhas.`
        : `Lote processado: ${sent} enviadas até agora. Ainda ${remaining} restantes.`,
      data: { total: allCustomers.length, sent, failed, remaining },
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
      include: {
        template: { select: { name: true, costPerConversation: true, linkUrl: true } },
        executions: { include: { crmCustomer: true }, take: 20, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar campanha.', error: err.message });
  }
};


// ─── Rastreamento de clique (rota pública, acessada pelo cliente no WhatsApp) ─
/** Só redireciona para http/https, para a rota não virar um open redirect. */
function safeRedirect(url) {
  try {
    const parsed = new URL(String(url));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const trackClick = async (req, res) => {
  const fallback = safeRedirect(publicBaseUrl()) || '/';
  try {
    const { executionId } = req.params;

    const execution = await prisma.campaignExecution.findUnique({
      where: { id: executionId },
      select: { id: true, clicked: true, campaignId: true, campaign: { select: { template: { select: { linkUrl: true } } } } },
    });

    // Link inválido/expirado: manda para a home em vez de mostrar erro ao cliente
    if (!execution) return res.redirect(302, fallback);

    // Conta apenas o primeiro clique de cada destinatário
    if (!execution.clicked) {
      const updated = await prisma.campaignExecution.updateMany({
        where: { id: execution.id, clicked: false },
        data: { clicked: true },
      });
      if (updated.count > 0) {
        await prisma.campaign.update({
          where: { id: execution.campaignId },
          data: { clickCount: { increment: 1 } },
        });
      }
    }

    const destination = safeRedirect(execution.campaign?.template?.linkUrl);
    return res.redirect(302, destination || fallback);
  } catch (err) {
    console.error('[Campaign] trackClick:', err);
    return res.redirect(302, fallback);
  }
};

// ─── Relatório geral de campanhas ─────────────────────────────────────────────
const getCampaignReport = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end   = endDate   ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();

    // Campanhas disparadas no período (startedAt ou createdAt dentro do range)
    const campaigns = await prisma.campaign.findMany({
      where: {
        wabaAccountId,
        status: { in: ['COMPLETED', 'RUNNING'] },
        OR: [
          { startedAt: { gte: start, lte: end } },
          { startedAt: null, createdAt: { gte: start, lte: end } },
        ],
      },
      select: { id: true, sentCount: true, totalCost: true },
    });

    const totalDisparos = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
    const totalGasto    = campaigns.reduce((s, c) => s + (c.totalCost || 0), 0);
    const campaignIds   = campaigns.map(c => c.id);

    let vendasGeradas = 0;
    let receitaGerada = 0;

    if (campaignIds.length > 0) {
      // Pedidos realizados por clientes que receberam alguma dessas campanhas,
      // dentro de 30 dias após o envio
      const idList = campaignIds.map(id => `'${id}'`).join(',');
      // Calcula vendas/receita por campanha e soma, replicando o que cada
      // getCampaignConversions mostra individualmente — assim o total do relatório
      // sempre bate com a soma dos relatórios de cada campanha (um pedido atribuído
      // a mais de uma campanha conta em todas, como nos relatórios individuais)
      const rows = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(SUM(vendas), 0)::int    AS total_vendas,
          COALESCE(SUM(receita), 0)::float AS total_receita
        FROM (
          SELECT
            ce."campaignId",
            COUNT(DISTINCT co."crmCustomerId") AS vendas,
            COALESCE(SUM(co.total), 0)         AS receita
          FROM zapcloud.campaign_executions ce
          JOIN zapcloud.customer_orders co ON co."crmCustomerId" = ce."crmCustomerId"
          WHERE ce."campaignId" IN (${idList})
            AND ce.status = 'SENT'
            AND ce."sentAt" IS NOT NULL
            AND co."orderedAt" > ce."sentAt"
            AND co."orderedAt" < ce."sentAt" + INTERVAL '720 hours'
          GROUP BY ce."campaignId"
        ) campaign_stats
      `);
      vendasGeradas = Number(rows[0]?.total_vendas) || 0;
      receitaGerada = Number(rows[0]?.total_receita) || 0;
    }

    res.json({
      success: true,
      data: { totalDisparos, totalGasto, vendasGeradas, receitaGerada, startDate: start, endDate: end },
    });
  } catch (err) {
    console.error('[Campaign] Erro no relatório:', err.message);
    res.status(500).json({ success: false, message: 'Erro ao gerar relatório.' });
  }
};

// ─── Conversões da campanha ────────────────────────────────────────────────────
// Cruza execuções enviadas com pedidos realizados após o envio dentro de uma janela.
const getCampaignConversions = async (req, res) => {
  try {
    const { wabaAccountId, campaignId } = req.params;
    const windowHours = Math.min(parseInt(req.query.windowHours) || 48, 720);

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, wabaAccountId } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });

    // windowHours já é inteiro validado (parseInt + Math.min), seguro embutir no SQL
    // DISTINCT no subquery deduplica pedidos antes do SUM; o crmCustomerId entra no
    // subquery para conversions continuar contando clientes únicos, não pedidos
    const result = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT "crmCustomerId")::int AS conversions,
        COALESCE(SUM(total), 0)::float       AS revenue
      FROM (
        SELECT DISTINCT co.id, co.total, co."crmCustomerId"
        FROM zapcloud.campaign_executions ce
        JOIN zapcloud.customer_orders co ON co."crmCustomerId" = ce."crmCustomerId"
        WHERE ce."campaignId" = $1
          AND ce.status = 'SENT'
          AND ce."sentAt" IS NOT NULL
          AND co."orderedAt" > ce."sentAt"
          AND co."orderedAt" < ce."sentAt" + INTERVAL '${windowHours} hours'
      ) AS distinct_orders
    `, campaignId);

    const row = result[0] || {};
    const conversions = Number(row.conversions) || 0;
    const revenue = Number(row.revenue) || 0;
    const sent = campaign.sentCount || 0;

    res.json({
      success: true,
      data: {
        conversions,
        revenue,
        conversionRate: sent > 0 ? Math.round((conversions / sent) * 100) : 0,
        windowHours,
      },
    });
  } catch (err) {
    console.error('[Campaign] Erro ao buscar conversões:', err.message);
    res.status(500).json({ success: false, message: 'Erro ao buscar conversões.' });
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
    // Para test send usamos a linkUrl do template (URL real do negócio) como
    // trackingUrl — evita enviar domínio desconhecido (Railway) que a Meta bloqueia.
    const testCtx = template?.linkUrl ? { trackingUrl: template.linkUrl } : undefined;
    const finalMessage = template
      ? renderTemplateBody(template.bodyText, params, customer, testCtx)
      : buildMessage(message, customer);

    const response = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
      buildMetaPayload({ to: normalized, template, templateParams: params, customer, ctx: testCtx, fallbackText: finalMessage }),
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

// ─── Força conclusão de campanha travada em RUNNING ──────────────────────────
const forceCompleteCampaign = async (req, res) => {
  try {
    const { wabaAccountId, campaignId } = req.params;
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, wabaAccountId } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campanha não encontrada.' });
    if (campaign.status !== 'RUNNING') {
      return res.status(400).json({ success: false, message: `Campanha não está em RUNNING (status: ${campaign.status}).` });
    }

    // Conta execuções já processadas diretamente no banco
    const [sentResult, failedResult] = await Promise.all([
      prisma.campaignExecution.count({ where: { campaignId, status: 'SENT' } }),
      prisma.campaignExecution.count({ where: { campaignId, status: 'FAILED' } }),
    ]);

    const unitCost = campaign.estimatedCost && campaign.totalRecipients
      ? campaign.estimatedCost / campaign.totalRecipients
      : 0;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        sentCount: sentResult,
        failedCount: failedResult,
        totalCost: unitCost ? Number((sentResult * unitCost).toFixed(2)) : null,
      },
    });

    res.json({ success: true, message: `Campanha marcada como concluída: ${sentResult} enviadas, ${failedResult} falhas.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao forçar conclusão.', error: err.message });
  }
};

module.exports = { listCampaigns, createCampaign, previewSegment, executeCampaign, getCampaign, testSend, trackClick, getCampaignConversions, getCampaignReport, forceCompleteCampaign };

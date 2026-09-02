const axios = require('axios');


const prisma = require('../utils/prisma');

const META_BASE_URL = process.env.META_BASE_URL || 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

// ─── Helper: buscar conta WABA do usuário ─────────────────────────────────────

const getWabaAccount = async (userId, wabaAccountId) => {
  return prisma.wabaAccount.findFirst({
    where: { id: wabaAccountId, userId, isActive: true },
  });
};

// ─── Enviar mensagem de texto ─────────────────────────────────────────────────

const sendTextMessage = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { to, message } = req.body;

    const wabaAccount = await getWabaAccount(req.user.id, wabaAccountId);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    // Buscar ou criar contato
    let contact = await prisma.contact.upsert({
      where: { wabaAccountId_phone: { wabaAccountId, phone: to } },
      update: {},
      create: { wabaAccountId, phone: to },
    });

    // Registrar mensagem como PENDING
    const dbMessage = await prisma.message.create({
      data: {
        wabaAccountId,
        contactId: contact.id,
        userId: req.user.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'PENDING',
        content: { text: message },
      },
    });

    // Enviar para a API da Meta
    const metaUrl = `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`;
    console.log(`[WhatsApp] sendTextMessage → to=${to} phoneNumberId=${wabaAccount.phoneNumberId} url=${metaUrl}`);
    const response = await axios.post(
      metaUrl,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${wabaAccount.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const waMessageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] sendTextMessage → Meta OK waMessageId=${waMessageId}`);

    // Atualizar status para SENT
    await prisma.message.update({
      where: { id: dbMessage.id },
      data: { status: 'SENT', waMessageId, sentAt: new Date() },
    });

    return res.json({
      success: true,
      message: 'Mensagem enviada com sucesso.',
      data: { messageId: dbMessage.id, waMessageId },
    });
  } catch (error) {
    const errData = error?.response?.data;
    console.error('[WhatsApp] sendTextMessage ERRO:', JSON.stringify(errData || error.message));
    // Marcar mensagem como FAILED no banco
    try {
      await prisma.message.updateMany({
        where: { wabaAccountId, direction: 'OUTBOUND', status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: errData?.error?.message || error.message },
      });
    } catch {}
    return res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagem.',
      error: errData,
    });
  }
};

// ─── Enviar template ──────────────────────────────────────────────────────────

const sendTemplate = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { to, templateName, language = 'pt_BR', components = [] } = req.body;

    const wabaAccount = await getWabaAccount(req.user.id, wabaAccountId);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    let contact = await prisma.contact.upsert({
      where: { wabaAccountId_phone: { wabaAccountId, phone: to } },
      update: {},
      create: { wabaAccountId, phone: to },
    });

    const dbMessage = await prisma.message.create({
      data: {
        wabaAccountId,
        contactId: contact.id,
        userId: req.user.id,
        direction: 'OUTBOUND',
        type: 'TEMPLATE',
        status: 'PENDING',
        content: { templateName, language, components },
      },
    });

    const response = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: { name: templateName, language: { code: language }, components },
      },
      {
        headers: {
          Authorization: `Bearer ${wabaAccount.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const waMessageId = response.data?.messages?.[0]?.id;

    await prisma.message.update({
      where: { id: dbMessage.id },
      data: { status: 'SENT', waMessageId, sentAt: new Date() },
    });

    return res.json({
      success: true,
      message: 'Template enviado com sucesso.',
      data: { messageId: dbMessage.id, waMessageId },
    });
  } catch (error) {
    console.error('[WhatsApp] sendTemplate:', error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Erro ao enviar template.',
      error: error?.response?.data,
    });
  }
};

// ─── Webhook - Verificação ────────────────────────────────────────────────────

const webhookVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Webhook] Verificado com sucesso.');
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ success: false, message: 'Token de verificação inválido.' });
};

// ─── Webhook - Receber eventos ────────────────────────────────────────────────

const webhookReceive = async (req, res) => {
  try {
    // Responder imediatamente para a Meta
    res.status(200).send('EVENT_RECEIVED');
    console.log('[Webhook] POST recebido - Content-Type:', req.headers['content-type'], '| body type:', typeof req.body, '| isBuffer:', Buffer.isBuffer(req.body));

    // req.body pode ser Buffer (express.raw) ou objeto (express.json)
    const body = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;

    console.log('[Webhook] body.object:', body?.object);
    if (!body || body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        // Mensagens recebidas
        if (value.messages) {
          for (const msg of value.messages) {
            await processInboundMessage(value, msg);
          }
        }

        // Atualizações de status
        if (value.statuses) {
          for (const status of value.statuses) {
            await processStatusUpdate(status);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] Erro ao processar evento:', error);
  }
};

// ─── Auto-reply: redirecionar cliente para o WhatsApp de atendimento ─────────

const AUTO_REPLY_TEXT =
  'Para dar continuidade no atendimento, fale conosco pelo nosso WhatsApp: https://wa.me/5547913454493';
const AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

// contactId → timestamp do último auto-reply enviado
const autoReplyCache = new Map();

const sendAutoReply = async (wabaAccount, contact) => {
  try {
    const lastSent = autoReplyCache.get(contact.id);
    if (lastSent && Date.now() - lastSent < AUTO_REPLY_COOLDOWN_MS) return;

    autoReplyCache.set(contact.id, Date.now());

    const response = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: contact.phone,
        type: 'text',
        text: { body: AUTO_REPLY_TEXT },
      },
      {
        headers: {
          Authorization: `Bearer ${wabaAccount.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const waMessageId = response.data?.messages?.[0]?.id;

    await prisma.message.create({
      data: {
        wabaAccountId: wabaAccount.id,
        contactId: contact.id,
        userId: wabaAccount.userId,
        waMessageId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        content: { text: AUTO_REPLY_TEXT },
        sentAt: new Date(),
      },
    });

    console.log(`[Webhook] Auto-reply enviado para ${contact.phone}`);
  } catch (error) {
    // Se o envio falhou, libera para tentar de novo na próxima mensagem
    autoReplyCache.delete(contact.id);
    console.error('[Webhook] sendAutoReply:', error?.response?.data || error.message);
  }
};

const processInboundMessage = async (value, msg) => {
  try {
    const wabaId = value.metadata?.phone_number_id;
    console.log(`[Webhook] processInboundMessage - phoneNumberId recebido: "${wabaId}"`);

    const wabaAccount = await prisma.wabaAccount.findUnique({
      where: { phoneNumberId: wabaId },
    });
    console.log(`[Webhook] wabaAccount encontrado: ${wabaAccount ? wabaAccount.id : 'NÃO ENCONTRADO'}`);
    if (!wabaAccount) {
      // Listar todos para debug
      const all = await prisma.wabaAccount.findMany({ select: { id: true, phoneNumberId: true, isActive: true } });
      console.log('[Webhook] Contas cadastradas:', JSON.stringify(all));
      return;
    }

    const phone = msg.from;

    const contact = await prisma.contact.upsert({
      where: { wabaAccountId_phone: { wabaAccountId: wabaAccount.id, phone } },
      update: { lastSeenAt: new Date() },
      create: {
        wabaAccountId: wabaAccount.id,
        phone,
        name: value.contacts?.[0]?.profile?.name,
        lastSeenAt: new Date(),
      },
    });

    // Montar conteúdo dependendo do tipo
    let type = 'TEXT';
    let content = {};

    if (msg.type === 'text') {
      content = { text: msg.text?.body };
    } else if (['image', 'audio', 'video', 'document'].includes(msg.type)) {
      type = msg.type.toUpperCase();
      content = { mediaId: msg[msg.type]?.id, caption: msg[msg.type]?.caption };
    } else {
      content = msg[msg.type] || {};
    }

    await prisma.message.create({
      data: {
        wabaAccountId: wabaAccount.id,
        contactId: contact.id,
        waMessageId: msg.id,
        direction: 'INBOUND',
        type,
        status: 'DELIVERED',
        content,
        deliveredAt: new Date(),
      },
    });

    console.log(`[Webhook] Mensagem recebida de ${phone}`);

    // Auto-reply, exceto se a mensagem vier do próprio número da conta (evitar loop)
    if (phone !== wabaAccount.phoneNumberId && phone !== value.metadata?.display_phone_number) {
      await sendAutoReply(wabaAccount, contact);
    }
  } catch (error) {
    console.error('[Webhook] processInboundMessage:', error);
  }
};

const processStatusUpdate = async (status) => {
  try {
    const { id: waMessageId, status: newStatus, timestamp } = status;

    const statusMap = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };

    const mappedStatus = statusMap[newStatus];
    if (!mappedStatus) return;

    const updateData = { status: mappedStatus };
    if (newStatus === 'delivered') updateData.deliveredAt = new Date(Number(timestamp) * 1000);
    if (newStatus === 'read') updateData.readAt = new Date(Number(timestamp) * 1000);
    if (newStatus === 'failed') updateData.errorMessage = status.errors?.[0]?.message;

    await prisma.message.updateMany({
      where: { waMessageId },
      data: updateData,
    });

    // Mensagens de campanha vivem em campaign_executions, não em messages
    if (newStatus === 'read') {
      await markCampaignExecutionRead(waMessageId, updateData.readAt);
    }
  } catch (error) {
    console.error('[Webhook] processStatusUpdate:', error);
  }
};

/**
 * Marca a execução de campanha como lida e incrementa readCount na campanha.
 * A Meta reenvia o mesmo status em retries, então só conta a primeira vez.
 */
const markCampaignExecutionRead = async (waMessageId, readAt) => {
  try {
    if (!waMessageId) return;

    const execution = await prisma.campaignExecution.findFirst({
      where: { waMessageId, readAt: null },
      select: { id: true, campaignId: true },
    });
    if (!execution) return;

    // updateMany com readAt:null garante que só um webhook concorrente vence a corrida
    const updated = await prisma.campaignExecution.updateMany({
      where: { id: execution.id, readAt: null },
      data: { readAt: readAt || new Date() },
    });
    if (updated.count === 0) return;

    await prisma.campaign.update({
      where: { id: execution.campaignId },
      data: { readCount: { increment: 1 } },
    });

    console.log('[Webhook] Campanha', execution.campaignId, '- leitura registrada:', waMessageId);
  } catch (error) {
    console.error('[Webhook] markCampaignExecutionRead:', error);
  }
};

// ─── Listar mensagens de um contato ──────────────────────────────────────────

const getMessages = async (req, res) => {
  try {
    const { wabaAccountId, contactId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const wabaAccount = await getWabaAccount(req.user.id, wabaAccountId);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { wabaAccountId, contactId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.message.count({ where: { wabaAccountId, contactId } }),
    ]);

    return res.json({
      success: true,
      data: { messages, pagination: { page: Number(page), limit: Number(limit), total } },
    });
  } catch (error) {
    console.error('[WhatsApp] getMessages:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar mensagens.' });
  }
};

module.exports = { sendTextMessage, sendTemplate, webhookVerify, webhookReceive, getMessages };

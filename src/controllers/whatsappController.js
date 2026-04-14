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
    const response = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.phoneNumberId}/messages`,
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
    console.error('[WhatsApp] sendTextMessage:', error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagem.',
      error: error?.response?.data,
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

    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

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

const processInboundMessage = async (value, msg) => {
  try {
    const wabaId = value.metadata?.phone_number_id;

    const wabaAccount = await prisma.wabaAccount.findUnique({
      where: { phoneNumberId: wabaId },
    });
    if (!wabaAccount) return;

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
  } catch (error) {
    console.error('[Webhook] processStatusUpdate:', error);
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

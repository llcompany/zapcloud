

const prisma = require('../utils/prisma');

// ─── Listar contatos ──────────────────────────────────────────────────────────

const listContacts = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { page = 1, limit = 50, search } = req.query;

    // Verificar se a conta pertence ao usuário
    const wabaAccount = await prisma.wabaAccount.findFirst({
      where: { id: wabaAccountId, userId: req.user.id },
    });
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const where = { wabaAccountId };
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.contact.count({ where }),
    ]);

    return res.json({
      success: true,
      data: { contacts, pagination: { page: Number(page), limit: Number(limit), total } },
    });
  } catch (error) {
    console.error('[Contact] listContacts:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar contatos.' });
  }
};

// ─── Criar/Atualizar contato ──────────────────────────────────────────────────

const upsertContact = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { phone, name, email, tags } = req.body;

    const wabaAccount = await prisma.wabaAccount.findFirst({
      where: { id: wabaAccountId, userId: req.user.id },
    });
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const contact = await prisma.contact.upsert({
      where: { wabaAccountId_phone: { wabaAccountId, phone } },
      update: { name, email, tags: tags || [] },
      create: { wabaAccountId, phone, name, email, tags: tags || [] },
    });

    return res.json({ success: true, data: contact });
  } catch (error) {
    console.error('[Contact] upsertContact:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar contato.' });
  }
};

// ─── Buscar contato por ID ────────────────────────────────────────────────────

const getContact = async (req, res) => {
  try {
    const { wabaAccountId, contactId } = req.params;

    const wabaAccount = await prisma.wabaAccount.findFirst({
      where: { id: wabaAccountId, userId: req.user.id },
    });
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, wabaAccountId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contato não encontrado.' });
    }

    return res.json({ success: true, data: contact });
  } catch (error) {
    console.error('[Contact] getContact:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar contato.' });
  }
};

module.exports = { listContacts, upsertContact, getContact };

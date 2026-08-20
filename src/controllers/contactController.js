

const prisma = require('../utils/prisma');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { normalizePhone } = require('./multipedidosController');

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
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
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

// ─── Importar contatos via arquivo CSV/XLSX ───────────────────────────────────

// Mapeamento de cabeçalhos aceitos (case-insensitive) → campo interno
const COLUMN_MAP = {
  phone: 'phone', telefone: 'phone', celular: 'phone', whatsapp: 'phone',
  name: 'name', nome: 'name',
  source: 'source', origem: 'source',
};

function mapRow(raw) {
  const row = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = COLUMN_MAP[String(key).trim().toLowerCase()];
    if (field && row[field] === undefined) row[field] = value;
  }
  return row;
}

function parseFileRows(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  // CSV — detecta delimitador (planilhas BR costumam exportar com ";")
  const text = file.buffer.toString('utf8');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  return parse(text, { columns: true, bom: true, trim: true, skip_empty_lines: true, delimiter, relax_column_count: true });
}

const importContacts = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Envie um arquivo .csv ou .xlsx no campo "file".' });
    }

    let rawRows;
    try {
      rawRows = parseFileRows(req.file);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Não foi possível ler o arquivo: ' + e.message });
    }
    if (!rawRows.length) {
      return res.status(400).json({ success: false, message: 'O arquivo não contém linhas de dados.' });
    }

    const defaultSource = (req.body.source || '').trim() || 'importado';
    const errors = [];
    let skipped = 0;

    // Monta lista válida, deduplicando telefones repetidos dentro do próprio arquivo
    const seen = new Set();
    const candidates = [];
    rawRows.forEach((raw, i) => {
      const line = i + 2; // +1 do cabeçalho, +1 índice 1-based
      const row = mapRow(raw);
      if (!row.phone || !String(row.phone).trim()) {
        errors.push({ line, message: 'Telefone ausente.' });
        return;
      }
      const phone = normalizePhone(row.phone);
      if (phone.length < 10) {
        errors.push({ line, message: `Telefone inválido: "${row.phone}"` });
        return;
      }
      if (seen.has(phone)) { skipped++; return; }
      seen.add(phone);
      candidates.push({
        phone,
        name: row.name ? String(row.name).trim() || null : null,
        source: (row.source && String(row.source).trim()) || defaultSource,
      });
    });

    // Ignora quem já existe na base (não sobrescreve)
    const existing = candidates.length
      ? await prisma.crmCustomer.findMany({
          where: { wabaAccountId, phone: { in: candidates.map(c => c.phone) } },
          select: { phone: true },
        })
      : [];
    const existingPhones = new Set(existing.map(e => e.phone));
    const toCreate = candidates.filter(c => !existingPhones.has(c.phone));
    skipped += candidates.length - toCreate.length;

    if (toCreate.length) {
      await prisma.crmCustomer.createMany({
        data: toCreate.map(c => ({ wabaAccountId, phone: c.phone, name: c.name, source: c.source, tags: [] })),
        skipDuplicates: true,
      });
    }

    return res.json({ success: true, imported: toCreate.length, skipped, errors });
  } catch (error) {
    console.error('[Contact] importContacts:', error);
    return res.status(500).json({ success: false, message: 'Erro ao importar contatos.' });
  }
};

module.exports = { listContacts, upsertContact, getContact, importContacts };

const axios = require('axios');

const prisma = require('../utils/prisma');
const { extractVariables } = require('../utils/templateVars');

const META_BASE_URL = process.env.META_BASE_URL || 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const NAME_RULE = /^[a-z0-9_]{1,512}$/;

// Mapeia o status textual da Meta para o enum TemplateStatus do Prisma
const STATUS_MAP = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  IN_APPEAL: 'PENDING',
  PENDING_DELETION: 'PENDING',
  DELETED: 'DISABLED',
  DISABLED: 'DISABLED',
  PAUSED: 'DISABLED',
  LIMIT_EXCEEDED: 'DISABLED',
};

/**
 * Carrega a conta WABA garantindo que ela pertence ao usuário autenticado.
 * Retorna null quando não existe ou é de outro tenant.
 */
async function getOwnedWabaAccount(wabaAccountId, user) {
  const where = { id: wabaAccountId };
  if (user.role !== 'ADMIN') where.userId = user.id;
  return prisma.wabaAccount.findFirst({ where });
}

function metaError(error) {
  return error?.response?.data?.error?.error_user_msg
    || error?.response?.data?.error?.message
    || error.message;
}

// ─── Listar templates (banco + sincroniza status na Meta) ────────────────────
const listTemplates = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;

    const wabaAccount = await getOwnedWabaAccount(wabaAccountId, req.user);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    // Sincroniza o status de aprovação com a Meta (best-effort: se falhar, devolve o cache do banco)
    try {
      const response = await axios.get(
        `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.wabaId}/message_templates`,
        {
          params: { fields: 'id,name,status,category,language,components,rejected_reason', limit: 200 },
          headers: { Authorization: `Bearer ${wabaAccount.accessToken}` },
        }
      );

      for (const remote of response.data?.data || []) {
        const status = STATUS_MAP[remote.status] || 'PENDING';
        const body = (remote.components || []).find((c) => c.type === 'BODY');
        await prisma.template.updateMany({
          where: { wabaAccountId, name: remote.name },
          data: {
            status,
            metaTemplateId: remote.id ? String(remote.id) : undefined,
            components: remote.components || [],
            bodyText: body?.text || undefined,
            rejectedReason: remote.rejected_reason || null,
          },
        });
      }
    } catch (syncErr) {
      console.warn('[Template] Falha ao sincronizar com a Meta:', metaError(syncErr));
    }

    const templates = await prisma.template.findMany({
      where: { wabaAccountId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('[Template] listTemplates:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar templates.', error: err.message });
  }
};

// ─── Criar template na Meta + salvar no banco ────────────────────────────────
const createTemplate = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;
    const { name, category = 'MARKETING', language = 'pt_BR', bodyText, footerText, examples } = req.body;

    if (!name || !bodyText) {
      return res.status(400).json({ success: false, message: 'Nome e corpo da mensagem são obrigatórios.' });
    }

    const normalizedName = String(name).trim().toLowerCase().replace(/\s+/g, '_');
    if (!NAME_RULE.test(normalizedName)) {
      return res.status(400).json({
        success: false,
        message: 'Nome inválido. Use apenas letras minúsculas, números e underscore (ex: reativacao_30dias).',
      });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Categoria inválida. Use uma de: ${VALID_CATEGORIES.join(', ')}.`,
      });
    }

    const body = String(bodyText).trim();
    if (body.length > 1024) {
      return res.status(400).json({ success: false, message: 'O corpo do template excede 1024 caracteres.' });
    }

    const { count, sequential } = extractVariables(body);
    if (!sequential) {
      return res.status(400).json({
        success: false,
        message: 'As variáveis devem ser sequenciais começando em {{1}} (ex: {{1}}, {{2}}, {{3}}).',
      });
    }
    // A Meta rejeita corpo que começa ou termina com variável
    if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}\s*$/.test(body)) {
      return res.status(400).json({
        success: false,
        message: 'O corpo não pode começar nem terminar com uma variável. Adicione texto ao redor.',
      });
    }

    const wabaAccount = await getOwnedWabaAccount(wabaAccountId, req.user);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const existing = await prisma.template.findUnique({
      where: { wabaAccountId_name: { wabaAccountId, name: normalizedName } },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Já existe um template com esse nome.' });
    }

    // Monta componentes no formato da Meta. `example.body_text` é OBRIGATÓRIO quando há variáveis.
    const bodyComponent = { type: 'BODY', text: body };
    if (count > 0) {
      const sample = Array.isArray(examples) && examples.length === count
        ? examples.map((e) => String(e))
        : Array.from({ length: count }, (_, i) => `exemplo${i + 1}`);
      bodyComponent.example = { body_text: [sample] };
    }

    const components = [bodyComponent];
    if (footerText) components.push({ type: 'FOOTER', text: String(footerText).trim().slice(0, 60) });

    let metaResponse;
    try {
      metaResponse = await axios.post(
        `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.wabaId}/message_templates`,
        { name: normalizedName, language, category, components },
        { headers: { Authorization: `Bearer ${wabaAccount.accessToken}`, 'Content-Type': 'application/json' } }
      );
    } catch (metaErr) {
      console.error('[Template] Meta recusou a criação:', metaErr?.response?.data || metaErr.message);
      return res.status(400).json({ success: false, message: metaError(metaErr) });
    }

    const template = await prisma.template.create({
      data: {
        wabaAccountId,
        metaTemplateId: metaResponse.data?.id ? String(metaResponse.data.id) : null,
        name: normalizedName,
        category: metaResponse.data?.category || category,
        language,
        status: STATUS_MAP[metaResponse.data?.status] || 'PENDING',
        components,
        bodyText: body,
        variableCount: count,
      },
    });

    console.log('[Template] Criado e enviado para aprovação:', normalizedName, '| metaId:', template.metaTemplateId);
    res.status(201).json({ success: true, message: 'Template enviado para aprovação da Meta.', data: template });
  } catch (err) {
    console.error('[Template] createTemplate:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar template.', error: err.message });
  }
};

// ─── Deletar template (Meta + banco) ─────────────────────────────────────────
const deleteTemplate = async (req, res) => {
  try {
    const { wabaAccountId, id } = req.params;

    const wabaAccount = await getOwnedWabaAccount(wabaAccountId, req.user);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const template = await prisma.template.findFirst({ where: { id, wabaAccountId } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template não encontrado.' });
    }

    const inUse = await prisma.campaign.count({
      where: { templateId: id, status: { in: ['RUNNING', 'PAUSED'] } },
    });
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        message: 'Template está em uso por uma campanha em execução. Finalize a campanha antes de excluir.',
      });
    }

    try {
      await axios.delete(
        `${META_BASE_URL}/${META_API_VERSION}/${wabaAccount.wabaId}/message_templates`,
        {
          params: { name: template.name },
          headers: { Authorization: `Bearer ${wabaAccount.accessToken}` },
        }
      );
    } catch (metaErr) {
      // Se já não existe na Meta seguimos e limpamos o registro local
      console.warn('[Template] Meta não removeu (seguindo com delete local):', metaError(metaErr));
    }

    await prisma.template.delete({ where: { id } });

    console.log('[Template] Removido:', template.name);
    res.json({ success: true, message: 'Template removido.' });
  } catch (err) {
    console.error('[Template] deleteTemplate:', err);
    res.status(500).json({ success: false, message: 'Erro ao remover template.', error: err.message });
  }
};

module.exports = { listTemplates, createTemplate, deleteTemplate };

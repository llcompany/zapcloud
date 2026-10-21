const axios = require('axios');
const crypto = require('crypto');

const prisma = require('../utils/prisma');
const { extractVariables } = require('../utils/templateVars');
const { getSupabase } = require('../utils/supabase');

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

/** Valida o custo por conversa. Vazio vira null (sem custo definido). */
function parseCost(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'Custo por conversa inválido.' };
  return { ok: true, value: n };
}

/** Valida a URL de destino do link rastreado. Vazio vira null. */
function parseDestination(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null };
  try {
    const parsed = new URL(String(raw).trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocolo');
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, message: 'URL de destino inválida. Use http:// ou https://.' };
  }
}

const BUTTON_VAR = /\{\{\s*1\s*\}\}/;

/**
 * Valida texto + URL do botão CTA e monta o objeto no formato da Meta.
 * URL pode ser fixa ou dinâmica com {{1}} (obrigatoriamente no final —
 * a Meta só aceita a variável como sufixo da URL base).
 */
function parseButton(buttonText, buttonUrl) {
  const text = String(buttonText || '').trim();
  const url = String(buttonUrl || '').trim();
  if (!text && !url) return { ok: true, value: null };
  if (!text) return { ok: false, message: 'Informe o texto do botão (ex: Pedir agora).' };
  if (text.length > 25) return { ok: false, message: 'O texto do botão tem no máximo 25 caracteres.' };
  if (!url) return { ok: false, message: 'Informe a URL do botão.' };

  const dynamic = BUTTON_VAR.test(url);
  if (dynamic && !/\{\{\s*1\s*\}\}$/.test(url)) {
    return { ok: false, message: 'A variável {{1}} do botão deve ficar no final da URL (ex: https://site.com/{{1}}).' };
  }
  if ((url.match(/\{\{/g) || []).length > 1) {
    return { ok: false, message: 'A URL do botão aceita apenas uma variável: {{1}}.' };
  }
  try {
    const probe = new URL(url.replace(BUTTON_VAR, 'exemplo'));
    if (!['http:', 'https:'].includes(probe.protocol)) throw new Error('protocolo');
  } catch {
    return { ok: false, message: 'URL do botão inválida. Use http:// ou https://.' };
  }

  const button = { type: 'URL', text, url };
  if (dynamic) button.example = [url.replace(BUTTON_VAR, 'exemplo')];
  return { ok: true, value: button };
}

// ─── Upload de imagem de header para a Meta (Resumable Upload API) ──────────
// Gera o `handle` exigido no example.header_handle da criação do template e
// salva uma cópia pública no Supabase Storage — a Meta exige a imagem de novo
// em cada envio, e o filesystem do Railway é efêmero (apagado a cada deploy).
const HEADER_BUCKET = 'template-headers';

const uploadTemplateHeader = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;

    const wabaAccount = await getOwnedWabaAccount(wabaAccountId, req.user);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Envie a imagem no campo "file" (JPEG ou PNG, até 5MB).' });
    }
    const appId = process.env.META_APP_ID;
    if (!appId) {
      return res.status(500).json({ success: false, message: 'META_APP_ID não configurado no servidor.' });
    }
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'SUPABASE_URL/SUPABASE_SERVICE_KEY não configurados no servidor.' });
    }

    // 1) Abre a sessão de upload no app
    const session = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${appId}/uploads`,
      null,
      { params: { file_length: req.file.size, file_type: req.file.mimetype, access_token: wabaAccount.accessToken } }
    );
    const sessionId = session.data?.id; // formato "upload:XXXX"
    if (!sessionId) throw new Error('A Meta não retornou a sessão de upload.');

    // 2) Envia o binário — note o esquema "OAuth" (não "Bearer") exigido por esta API
    const uploaded = await axios.post(
      `${META_BASE_URL}/${META_API_VERSION}/${sessionId}`,
      req.file.buffer,
      {
        headers: {
          Authorization: `OAuth ${wabaAccount.accessToken}`,
          file_offset: 0,
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
      }
    );
    const handle = uploaded.data?.h;
    if (!handle) throw new Error('A Meta não retornou o handle da imagem.');

    // 3) Guarda cópia pública no Supabase Storage para usar como link de header
    // em cada disparo — a URL não muda entre deploys do Railway
    const ext = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
    const filename = `${crypto.randomUUID()}${ext}`;
    const { error: storageError } = await supabase.storage
      .from(HEADER_BUCKET)
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (storageError) {
      throw new Error(`Falha ao salvar a imagem no Supabase Storage: ${storageError.message}`);
    }
    const { data: publicData } = supabase.storage.from(HEADER_BUCKET).getPublicUrl(filename);
    const url = publicData.publicUrl;

    console.log('[Template] Imagem de header enviada à Meta + Supabase:', filename);
    res.json({ success: true, data: { handle, url } });
  } catch (err) {
    console.error('[Template] uploadTemplateHeader:', err?.response?.data || err.message);
    res.status(400).json({ success: false, message: metaError(err) });
  }
};

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
    const {
      name, category = 'MARKETING', language = 'pt_BR',
      bodyText, footerText, examples, costPerConversation, linkUrl,
      headerHandle, headerImageUrl, buttonText, buttonUrl,
    } = req.body;

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

    const parsedCost = parseCost(costPerConversation);
    if (!parsedCost.ok) return res.status(400).json({ success: false, message: parsedCost.message });
    const cost = parsedCost.value;

    const parsedLink = parseDestination(linkUrl);
    if (!parsedLink.ok) return res.status(400).json({ success: false, message: parsedLink.message });
    const destination = parsedLink.value;

    // Header de imagem: handle (exemplo p/ aprovação) + URL pública (usada em cada envio)
    const parsedHeaderUrl = parseDestination(headerImageUrl);
    if (!parsedHeaderUrl.ok) {
      return res.status(400).json({ success: false, message: 'URL da imagem de header inválida.' });
    }
    const headerImage = parsedHeaderUrl.value;
    if (headerHandle && !headerImage) {
      return res.status(400).json({ success: false, message: 'Imagem de header sem URL pública. Refaça o upload da imagem.' });
    }

    const parsedButton = parseButton(buttonText, buttonUrl);
    if (!parsedButton.ok) return res.status(400).json({ success: false, message: parsedButton.message });
    const button = parsedButton.value;

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

    // Ordem convencional da Meta: HEADER, BODY, FOOTER, BUTTONS
    const components = [];
    if (headerHandle) {
      components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [String(headerHandle)] } });
    }
    components.push(bodyComponent);
    if (footerText) components.push({ type: 'FOOTER', text: String(footerText).trim().slice(0, 60) });
    if (button) components.push({ type: 'BUTTONS', buttons: [button] });

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
        costPerConversation: cost,
        linkUrl: destination,
        headerImageUrl: headerHandle ? headerImage : null,
      },
    });

    console.log('[Template] Criado e enviado para aprovação:', normalizedName, '| metaId:', template.metaTemplateId);
    res.status(201).json({ success: true, message: 'Template enviado para aprovação da Meta.', data: template });
  } catch (err) {
    console.error('[Template] createTemplate:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar template.', error: err.message });
  }
};

// ─── Atualizar custo e link (apenas no banco) ────────────────────────────────
// O conteúdo aprovado do template é imutável na Meta, então esta rota não chama
// a Graph API: mexe só nos campos operacionais controlados pelo ZapCloud.
const updateTemplate = async (req, res) => {
  try {
    const { wabaAccountId, id } = req.params;
    const { costPerConversation, linkUrl, headerImageUrl } = req.body;

    const wabaAccount = await getOwnedWabaAccount(wabaAccountId, req.user);
    if (!wabaAccount) {
      return res.status(404).json({ success: false, message: 'Conta WABA não encontrada.' });
    }

    const template = await prisma.template.findFirst({ where: { id, wabaAccountId } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template não encontrado.' });
    }

    // Só altera o que veio no corpo — campo ausente fica como está
    const data = {};

    if (costPerConversation !== undefined) {
      const parsed = parseCost(costPerConversation);
      if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
      data.costPerConversation = parsed.value;
    }

    if (linkUrl !== undefined) {
      const parsed = parseDestination(linkUrl);
      if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
      data.linkUrl = parsed.value;
    }

    // A imagem enviada em cada disparo pode ser trocada sem nova aprovação —
    // o que a Meta congela é a estrutura do template, não a mídia do envio.
    if (headerImageUrl !== undefined) {
      const hasImageHeader = (Array.isArray(template.components) ? template.components : [])
        .some((c) => String(c.type).toUpperCase() === 'HEADER' && String(c.format).toUpperCase() === 'IMAGE');
      if (!hasImageHeader) {
        return res.status(400).json({ success: false, message: 'Este template não tem header de imagem.' });
      }
      const parsed = parseDestination(headerImageUrl);
      if (!parsed.ok) return res.status(400).json({ success: false, message: 'URL da imagem de header inválida.' });
      data.headerImageUrl = parsed.value;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: 'Nada para atualizar. Envie costPerConversation, linkUrl e/ou headerImageUrl.' });
    }

    const updated = await prisma.template.update({ where: { id }, data });

    console.log('[Template] Atualizado:', template.name, JSON.stringify(data));
    res.json({ success: true, message: 'Template atualizado.', data: updated });
  } catch (err) {
    console.error('[Template] updateTemplate:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar template.', error: err.message });
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

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate, uploadTemplateHeader };

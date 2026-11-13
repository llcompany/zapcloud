const axios = require('axios');
const prisma = require('./prisma');
const { getSupabase } = require('./supabase');

const META_BASE_URL = process.env.META_BASE_URL || 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

// Bucket PRIVADO: mídia enviada por clientes (fotos, áudios, documentos) pode
// conter dados pessoais. Nunca gerar URL pública — o acesso passa pelo proxy
// autenticado GET /api/whatsapp/:wabaAccountId/media/:mediaId.
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'whatsapp-media';

// Limite de upload por arquivo no plano padrão do Supabase. Acima disso a mídia
// não é arquivada e continua servida pela Meta enquanto ela guardar (~7 dias).
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

// Só seguimos URLs de download da própria Meta (a URL vem da resposta da API)
const META_MEDIA_HOST = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net)$/i;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

/**
 * Resolve um mediaId na Meta: devolve { url, mime_type, file_size }.
 * A URL expira em minutos e exige o token da conta para baixar.
 * Lança erro se a Meta não tiver mais a mídia ou devolver URL fora do domínio dela.
 */
async function resolveMetaMedia(mediaId, accessToken) {
  const { data } = await axios.get(`${META_BASE_URL}/${META_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  let host = '';
  try { host = new URL(data?.url).hostname; } catch { /* host vazio = inválido */ }
  if (!META_MEDIA_HOST.test(host)) {
    const err = new Error(`URL de mídia inesperada da Meta: ${data?.url}`);
    err.unexpectedUrl = true;
    throw err;
  }
  return data;
}

/** Baixa o arquivo da URL resolvida pela Meta (stream ou buffer). */
function downloadMetaMedia(url, accessToken, responseType) {
  return axios.get(url, {
    // Sem User-Agent o CDN da Meta às vezes devolve HTML em vez do arquivo
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'ZapFood/1.0' },
    responseType,
    timeout: 60000,
    maxContentLength: MAX_ARCHIVE_BYTES,
  });
}

// Cria o bucket privado na primeira vez (uma checagem por processo)
let bucketReady = null;
function ensureMediaBucket(supabase) {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await supabase.storage.getBucket(MEDIA_BUCKET);
      if (data) return;
      const { error } = await supabase.storage.createBucket(MEDIA_BUCKET, { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
      console.log('[Mídia] Bucket privado criado no Supabase:', MEDIA_BUCKET);
    })().catch((err) => { bucketReady = null; throw err; });
  }
  return bucketReady;
}

/**
 * Arquiva no Supabase Storage a mídia de uma mensagem recebida e grava o caminho
 * em content.storagePath — a partir daí a mídia não depende mais da Meta.
 * Nunca lança: falha só é logada (a mensagem já está salva e o proxy ainda
 * consegue servir pela Meta enquanto ela guardar o arquivo).
 */
async function archiveInboundMedia({ messageId, wabaAccountId, accessToken, content }) {
  const mediaId = content?.mediaId;
  if (!mediaId || content.storagePath) return;
  try {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn('[Mídia] SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes — mídia não arquivada:', mediaId);
      return;
    }

    const info = await resolveMetaMedia(mediaId, accessToken);
    if (info.file_size && info.file_size > MAX_ARCHIVE_BYTES) {
      console.warn(`[Mídia] Arquivo grande demais para arquivar (${info.file_size} bytes):`, mediaId);
      return;
    }

    const file = await downloadMetaMedia(info.url, accessToken, 'arraybuffer');
    const mimeType = (info.mime_type || file.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const ext = EXT_BY_MIME[mimeType] || 'bin';
    const month = new Date().toISOString().slice(0, 7);
    const storagePath = `${wabaAccountId}/${month}/${mediaId}.${ext}`;

    await ensureMediaBucket(supabase);
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, Buffer.from(file.data), { contentType: mimeType, upsert: true });
    if (error) throw new Error(`Supabase Storage: ${error.message}`);

    await prisma.message.update({
      where: { id: messageId },
      data: { content: { ...content, storagePath, mimeType, fileSize: file.data.byteLength } },
    });
    console.log('[Mídia] Arquivada no Supabase:', storagePath);
  } catch (err) {
    console.error('[Mídia] Falha ao arquivar', mediaId, '→', err.response?.data?.error?.message || err.message);
  }
}

/** Baixa do Supabase uma mídia já arquivada. Devolve Buffer ou null se falhar. */
async function readArchivedMedia(storagePath) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(storagePath);
  if (error || !data) {
    console.error('[Mídia] Falha ao ler do Supabase', storagePath, '→', error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { resolveMetaMedia, downloadMetaMedia, archiveInboundMedia, readArchivedMedia, MEDIA_BUCKET };

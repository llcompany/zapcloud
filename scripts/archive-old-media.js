/**
 * Arquiva no Supabase Storage a mídia de mensagens recebidas ANTES do
 * arquivamento automático no webhook existir.
 *
 * - Busca mensagens IMAGE/AUDIO/VIDEO/DOCUMENT com mediaId e sem storagePath
 *   (ignorando as já marcadas como expired).
 * - Baixa da Meta e sobe no bucket privado (mesmo código do webhook:
 *   src/utils/whatsappMedia.js), gravando content.storagePath.
 * - Se a Meta não tiver mais o arquivo, marca content.expired = true para não
 *   tentar de novo. Falhas temporárias (rede, Supabase) NÃO são marcadas:
 *   rodar o script de novo tenta essas outra vez.
 *
 * Uso:
 *   node scripts/archive-old-media.js            # arquiva
 *   node scripts/archive-old-media.js --dry-run  # só conta, não altera nada
 */
require('dotenv').config();
const prisma = require('../src/utils/prisma');
const { archiveInboundMedia } = require('../src/utils/whatsappMedia');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pending = await prisma.$queryRawUnsafe(`
    SELECT m.id, m.type, m."wabaAccountId", m.content, m."createdAt", w."accessToken"
    FROM zapcloud.messages m
    JOIN zapcloud.waba_accounts w ON w.id = m."wabaAccountId"
    WHERE m.type IN ('IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT')
      AND m.content->>'mediaId' IS NOT NULL
      AND m.content->>'storagePath' IS NULL
      AND COALESCE(m.content->>'expired', 'false') <> 'true'
    ORDER BY m."createdAt" DESC
  `);

  const total = pending.length;
  console.log(`Mensagens com mídia a arquivar: ${total}${DRY_RUN ? ' (dry-run: nada será alterado)' : ''}\n`);
  if (DRY_RUN || total === 0) return;

  const count = { archived: 0, expired: 0, too_large: 0, error: 0, skipped: 0 };

  // Das mais novas para as mais antigas: as recentes são as que ainda existem na Meta
  for (const [i, m] of pending.entries()) {
    const status = await archiveInboundMedia({
      messageId: m.id,
      wabaAccountId: m.wabaAccountId,
      accessToken: m.accessToken,
      content: m.content,
    });
    count[status] = (count[status] || 0) + 1;

    if (status === 'expired') {
      await prisma.message.update({
        where: { id: m.id },
        data: { content: { ...m.content, expired: true, expiredCheckedAt: new Date().toISOString() } },
      });
    }

    const day = new Date(m.createdAt).toISOString().slice(0, 10);
    console.log(
      `[${i + 1}/${total}] ${day} ${m.type.padEnd(8)} ${status.padEnd(9)} | ` +
      `${count.archived}/${total} arquivadas, ${count.expired} expiradas` +
      (count.error ? `, ${count.error} com erro` : '')
    );
  }

  console.log('\n===== RESUMO =====');
  console.log(`Arquivadas:        ${count.archived}`);
  console.log(`Expiradas:         ${count.expired} (marcadas com content.expired = true)`);
  if (count.too_large) console.log(`Grandes demais:    ${count.too_large} (acima de 50 MB, não arquivadas)`);
  if (count.error)     console.log(`Erro temporário:   ${count.error} (rode o script de novo para tentar outra vez)`);
  if (count.skipped)   console.log(`Ignoradas:         ${count.skipped}`);
}

main()
  .catch((err) => { console.error('Erro fatal:', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

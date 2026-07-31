/**
 * migrate-data.js
 *
 * Migra contatos, mensagens, clientes CRM e templates
 * do banco ANTIGO (segajnmtdlayrkzuvexc) para o banco NOVO (wkrhvhzifaqevdhijkwv).
 *
 * Uso:
 *   OLD_DB_URL="postgresql://postgres:SENHA@db.segajnmtdlayrkzuvexc.supabase.co:5432/postgres"
 *   NEW_DB_URL="postgresql://postgres:SENHA@db.wkrhvhzifaqevdhijkwv.supabase.co:5432/postgres"
 *   node scripts/migrate-data.js
 */

const { PrismaClient: PrismaOld } = require('@prisma/client');
const { PrismaClient: PrismaNew } = require('@prisma/client');

const oldDb = new PrismaOld({ datasources: { db: { url: process.env.OLD_DB_URL } } });
const newDb = new PrismaNew({ datasources: { db: { url: process.env.NEW_DB_URL } } });

async function main() {
  console.log('=== Iniciando migração de dados ===\n');

  // 1. Buscar wabaAccounts em ambos os bancos para montar o mapeamento de IDs
  const oldWabaAccounts = await oldDb.wabaAccount.findMany();
  const newWabaAccounts = await newDb.wabaAccount.findMany();

  console.log(`Banco antigo: ${oldWabaAccounts.length} wabaAccount(s)`);
  console.log(`Banco novo:   ${newWabaAccounts.length} wabaAccount(s)\n`);

  // Mapeia phoneNumberId → novo wabaAccount.id
  const wabaIdMap = {};
  for (const oldWaba of oldWabaAccounts) {
    const newWaba = newWabaAccounts.find(w => w.phoneNumberId === oldWaba.phoneNumberId);
    if (newWaba) {
      wabaIdMap[oldWaba.id] = newWaba.id;
      console.log(`Mapeado: ${oldWaba.displayName} (${oldWaba.id}) → ${newWaba.id}`);
    } else {
      console.warn(`⚠️  Sem correspondência no banco novo para: ${oldWaba.displayName} (phoneNumberId=${oldWaba.phoneNumberId})`);
    }
  }

  if (Object.keys(wabaIdMap).length === 0) {
    console.error('\n❌ Nenhum wabaAccount correspondente encontrado. Abortando.');
    return;
  }

  console.log('');

  // 2. Migrar Contacts
  console.log('--- Migrando contatos ---');
  const contactIdMap = {};
  for (const [oldWabaId, newWabaId] of Object.entries(wabaIdMap)) {
    const contacts = await oldDb.contact.findMany({ where: { wabaAccountId: oldWabaId } });
    console.log(`  ${contacts.length} contato(s) para wabaAccount ${oldWabaId}`);

    for (const c of contacts) {
      try {
        const created = await newDb.contact.upsert({
          where: { wabaAccountId_phone: { wabaAccountId: newWabaId, phone: c.phone } },
          update: {
            name: c.name,
            email: c.email,
            tags: c.tags,
            isBlocked: c.isBlocked,
            lastSeenAt: c.lastSeenAt,
          },
          create: {
            wabaAccountId: newWabaId,
            phone: c.phone,
            name: c.name,
            email: c.email,
            tags: c.tags,
            isBlocked: c.isBlocked,
            lastSeenAt: c.lastSeenAt,
            createdAt: c.createdAt,
          },
        });
        contactIdMap[c.id] = created.id;
      } catch (e) {
        console.warn(`  ⚠️  Contato ${c.phone}: ${e.message}`);
      }
    }
  }
  console.log(`  Total mapeados: ${Object.keys(contactIdMap).length}\n`);

  // 3. Migrar Messages
  console.log('--- Migrando mensagens ---');
  let msgCount = 0;
  let msgSkipped = 0;
  for (const [oldWabaId, newWabaId] of Object.entries(wabaIdMap)) {
    const messages = await oldDb.message.findMany({
      where: { wabaAccountId: oldWabaId },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`  ${messages.length} mensagem(ns) para wabaAccount ${oldWabaId}`);

    for (const m of messages) {
      const newContactId = contactIdMap[m.contactId];
      if (!newContactId) {
        msgSkipped++;
        continue;
      }
      try {
        await newDb.message.upsert({
          where: { waMessageId: m.waMessageId || `migrated-${m.id}` },
          update: {},
          create: {
            wabaAccountId: newWabaId,
            contactId: newContactId,
            waMessageId: m.waMessageId || `migrated-${m.id}`,
            direction: m.direction,
            type: m.type,
            status: m.status,
            content: m.content,
            errorMessage: m.errorMessage,
            sentAt: m.sentAt,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
            createdAt: m.createdAt,
          },
        });
        msgCount++;
      } catch (e) {
        msgSkipped++;
        if (!e.message.includes('Unique constraint')) {
          console.warn(`  ⚠️  Mensagem ${m.id}: ${e.message}`);
        }
      }
    }
  }
  console.log(`  Migradas: ${msgCount} | Ignoradas: ${msgSkipped}\n`);

  // 4. Migrar CrmCustomers
  console.log('--- Migrando clientes CRM ---');
  const crmIdMap = {};
  let crmCount = 0;
  for (const [oldWabaId, newWabaId] of Object.entries(wabaIdMap)) {
    const customers = await oldDb.crmCustomer.findMany({ where: { wabaAccountId: oldWabaId } });
    console.log(`  ${customers.length} cliente(s) CRM para wabaAccount ${oldWabaId}`);

    for (const c of customers) {
      try {
        const created = await newDb.crmCustomer.upsert({
          where: { wabaAccountId_phone: { wabaAccountId: newWabaId, phone: c.phone } },
          update: {
            name: c.name,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            averageTicket: c.averageTicket,
            lastOrderAt: c.lastOrderAt,
            firstOrderAt: c.firstOrderAt,
            daysSinceOrder: c.daysSinceOrder,
            favoriteItems: c.favoriteItems,
            tags: c.tags,
          },
          create: {
            wabaAccountId: newWabaId,
            phone: c.phone,
            name: c.name,
            email: c.email,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            averageTicket: c.averageTicket,
            lastOrderAt: c.lastOrderAt,
            firstOrderAt: c.firstOrderAt,
            daysSinceOrder: c.daysSinceOrder,
            favoriteItems: c.favoriteItems,
            tags: c.tags,
            source: c.source,
            externalId: c.externalId,
            isActive: c.isActive,
            createdAt: c.createdAt,
          },
        });
        crmIdMap[c.id] = created.id;
        crmCount++;
      } catch (e) {
        console.warn(`  ⚠️  CRM ${c.phone}: ${e.message}`);
      }
    }
  }
  console.log(`  Total migrados: ${crmCount}\n`);

  // 5. Migrar Templates
  console.log('--- Migrando templates ---');
  let tplCount = 0;
  for (const [oldWabaId, newWabaId] of Object.entries(wabaIdMap)) {
    const templates = await oldDb.template.findMany({ where: { wabaAccountId: oldWabaId } });
    console.log(`  ${templates.length} template(s) para wabaAccount ${oldWabaId}`);

    for (const t of templates) {
      try {
        await newDb.template.upsert({
          where: { wabaAccountId_name: { wabaAccountId: newWabaId, name: t.name } },
          update: { status: t.status, components: t.components },
          create: {
            wabaAccountId: newWabaId,
            metaTemplateId: t.metaTemplateId,
            name: t.name,
            category: t.category,
            language: t.language,
            status: t.status,
            components: t.components,
            createdAt: t.createdAt,
          },
        });
        tplCount++;
      } catch (e) {
        console.warn(`  ⚠️  Template ${t.name}: ${e.message}`);
      }
    }
  }
  console.log(`  Total migrados: ${tplCount}\n`);

  console.log('=== Migração concluída ===');
}

main()
  .catch(e => { console.error('ERRO FATAL:', e); process.exit(1); })
  .finally(async () => {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  });

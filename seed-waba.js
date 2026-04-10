// Script para registrar a conta WABA no banco de dados
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Busca o primeiro usuário
  const user = await prisma.user.findFirst();
  if (!user) { console.error('❌ Nenhum usuário encontrado. Faça login primeiro.'); process.exit(1); }

  const account = await prisma.wabaAccount.upsert({
    where: { wabaId: process.env.WABA_ID },
    update: {
      accessToken:   process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
    },
    create: {
      userId:        user.id,
      wabaId:        process.env.WABA_ID,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      accessToken:   process.env.WHATSAPP_TOKEN,
      displayName:   'Lucalaike Company',
    },
  });

  console.log('✅ Conta WABA registrada com sucesso!');
  console.log('   Empresa:', account.displayName);
  console.log('   WABA ID:', account.wabaId);
  console.log('   Phone ID:', account.phoneNumberId);
}

main().catch(e => { console.error('❌ Erro:', e.message); }).finally(() => prisma.$disconnect());

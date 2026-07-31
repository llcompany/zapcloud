/**
 * fix-forest-burger.js
 * Vincula o wabaAccount "Forest Burger" ao userId correto do Murilo.
 *
 * Uso no Railway Console:
 *   node scripts/fix-forest-burger.js
 */

require('dotenv').config({ path: '.env.build' });
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const MURILO_USER_ID = '54db6bb3-1afe-4c62-995a-8f3015d0dbb3';

  const before = await prisma.wabaAccount.findMany({
    where: { displayName: 'Forest Burger' },
    select: { id: true, displayName: true, userId: true, phoneNumberId: true },
  });

  console.log('Antes:', JSON.stringify(before, null, 2));

  if (before.length === 0) {
    console.log('Nenhuma conta "Forest Burger" encontrada.');
    return;
  }

  const result = await prisma.wabaAccount.updateMany({
    where: { displayName: 'Forest Burger' },
    data: { userId: MURILO_USER_ID },
  });

  console.log('\nAtualizado:', result.count, 'conta(s)');

  const after = await prisma.wabaAccount.findMany({
    where: { displayName: 'Forest Burger' },
    select: { id: true, displayName: true, userId: true },
  });

  console.log('Depois:', JSON.stringify(after, null, 2));
  console.log('\n✅ Fix concluído!');
}

main()
  .catch(e => { console.error('ERRO:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());

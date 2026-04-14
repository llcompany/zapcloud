const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('❌ AVISO: DATABASE_URL não está definida! O servidor vai iniciar mas queries vão falhar.');
} else {
  const maskedUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  console.log('🔌 Prisma DATABASE_URL:', maskedUrl);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL || 'postgresql://dummy:dummy@dummy:5432/dummy' },
  },
  log: ['error'],
});

module.exports = prisma;

const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('❌ FATAL: DATABASE_URL não está definida!');
  process.exit(1);
}

const maskedUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
console.log('🔌 Prisma DATABASE_URL:', maskedUrl);

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: ['error'],
});

module.exports = prisma;

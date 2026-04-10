// Converte token temporário (24h) em token de longa duração (60 dias)
require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SHORT_TOKEN = process.env.WHATSAPP_TOKEN;
const APP_ID     = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('🔄 Trocando token temporário por token de 60 dias...');

  const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${SHORT_TOKEN}`;
  const result = await fetchJson(url);

  if (result.error) {
    console.error('❌ Erro da Meta:', result.error.message);
    return;
  }

  const longToken = result.access_token;
  const dias = Math.round((result.expires_in || 5184000) / 86400);
  console.log(`✅ Token de ${dias} dias gerado com sucesso!`);

  // Atualiza o .env
  const fs = require('fs');
  let env = fs.readFileSync('.env', 'utf8');
  env = env.replace(/WHATSAPP_TOKEN=.*/, `WHATSAPP_TOKEN=${longToken}`);
  fs.writeFileSync('.env', env);
  console.log('✅ .env atualizado!');

  // Atualiza o banco
  await prisma.wabaAccount.updateMany({
    where: { wabaId: process.env.WABA_ID },
    data: { accessToken: longToken }
  });
  console.log('✅ Banco de dados atualizado!');
  console.log(`\n⚠️  Lembre de reiniciar o servidor com: node src/server.js`);
  console.log(`📅 Token válido por ${dias} dias.`);
}

main().catch(e => console.error('❌ Erro:', e.message)).finally(() => prisma.$disconnect());

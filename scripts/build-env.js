/**
 * build-env.js
 * Executado durante o BUILD do Nixpacks no Railway.
 * Railway injeta as variáveis de serviço durante o build (não no runtime do V2).
 * Este script captura todas elas e grava em .env.build para uso em runtime.
 */
const fs = require('fs');
const path = require('path');

const VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'WHATSAPP_TOKEN',
  'WABA_ID',
  'PHONE_NUMBER_ID',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_BASE_URL',
  'META_REDIRECT_URI',
  'META_VERIFY_TOKEN',
  'META_API_VERSION',
  'MULTIPEDIDOS_TOKEN',
  'MULTIPEDIDOS_RESTAURANT_ID',
  'PUBLIC_URL',
  'NODE_ENV',
  'PORT',
];

const lines = VARS
  .filter(k => process.env[k] !== undefined && process.env[k] !== '')
  .map(k => `${k}=${JSON.stringify(process.env[k])}`);

if (lines.length === 0) {
  console.warn('⚠️  build-env.js: Nenhuma variável de serviço encontrada no build. .env.build não foi criado.');
  process.exit(0);
}

const outputPath = path.join(__dirname, '..', '.env.build');
fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
console.log(`✅ .env.build criado com ${lines.length} variáveis:`);
lines.forEach(l => console.log(`   ${l.split('=')[0]}`));

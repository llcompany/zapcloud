// Script de teste — envia uma mensagem real pelo WhatsApp
require('dotenv').config();
const http = require('http');

const PARA = '5547997109331';
const MENSAGEM = 'Olá! Esta é uma mensagem de teste do ZapCloud 🚀 Funcionou!';

function request(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🔐 Fazendo login...');
  const login = await request('POST', '/api/auth/login', { email: 'llcompanyltda@gmail.com', password: 'Lucas123' });
  if (!login.body.success) { console.error('❌ Login falhou:', login.body.message); return; }
  const token = login.body.data.accessToken;
  console.log('✅ Login OK');

  console.log('🔍 Buscando conta WABA...');
  const me = await request('GET', '/api/auth/me', null, token);
  const wabaAccounts = me.body?.data?.wabaAccounts;
  if (!wabaAccounts || wabaAccounts.length === 0) { console.error('❌ Nenhuma conta WABA encontrada. Rode node seed-waba.js primeiro.'); return; }
  const wabaId = wabaAccounts[0].id;
  console.log('✅ Conta WABA:', wabaAccounts[0].displayName, '| ID:', wabaId);

  console.log(`📤 Enviando mensagem para +${PARA}...`);
  const send = await request('POST', `/api/whatsapp/${wabaId}/messages/text`, { to: PARA, message: MENSAGEM }, token);

  if (send.body.success) {
    console.log('✅ Mensagem enviada com sucesso!');
    console.log('   Para:', '+' + PARA);
    console.log('   Texto:', MENSAGEM);
  } else {
    console.error('❌ Erro ao enviar:', JSON.stringify(send.body, null, 2));
  }
}

main().catch(e => console.error('❌ Erro:', e.message));

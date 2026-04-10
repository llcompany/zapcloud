/**
 * Script de teste integrado - roda o servidor com mock do Prisma
 * e testa todos os endpoints principais.
 */

// Injetar mock antes de qualquer require
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@prisma/client') {
    return require('./__mocks__/@prisma/client.js');
  }
  return origLoad.call(this, request, parent, isMain);
};

const http = require('http');

// Iniciar o servidor
require('./src/server.js');

const BASE = 'http://localhost:3001';

// Helper de request
const req = (method, path, body, token) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };
    const r = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) r.write(data);
    r.end();
  });

const log = (label, result) => {
  const icon = result.body?.success ? '✅' : '❌';
  console.log(`\n${icon} ${label}`);
  console.log(`   Status: ${result.status}`);
  if (result.body?.message) console.log(`   Msg: ${result.body.message}`);
  if (result.body?.errors) console.log(`   Erros: ${JSON.stringify(result.body.errors)}`);
  if (result.body?.data?.user) {
    const u = result.body.data.user;
    console.log(`   User: ${u.name} (${u.email}) [${u.role}]`);
  }
  if (result.body?.data?.accessToken) {
    console.log(`   Token: ${result.body.data.accessToken.substring(0, 40)}...`);
  }
  return result;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(500); // aguardar servidor iniciar

  console.log('\n══════════════════════════════════════════════');
  console.log('   ZAPCLOUD - TESTES DE INTEGRAÇÃO');
  console.log('══════════════════════════════════════════════');

  // ── AUTH ─────────────────────────────────────────────────────────────────

  console.log('\n─── AUTENTICAÇÃO ────────────────────────────');

  const reg = log(
    'REGISTER válido',
    await req('POST', '/api/auth/register', {
      name: 'Lucas Dev',
      email: 'lucas@zapcloud.com',
      password: 'senha1234',
    })
  );

  log(
    'REGISTER e-mail duplicado → 409',
    await req('POST', '/api/auth/register', {
      name: 'Lucas Dev',
      email: 'lucas@zapcloud.com',
      password: 'senha1234',
    })
  );

  log(
    'REGISTER senha curta → 422',
    await req('POST', '/api/auth/register', {
      name: 'Test',
      email: 'test@test.com',
      password: '123',
    })
  );

  const login = log(
    'LOGIN correto',
    await req('POST', '/api/auth/login', {
      email: 'lucas@zapcloud.com',
      password: 'senha1234',
    })
  );

  log(
    'LOGIN senha errada → 401',
    await req('POST', '/api/auth/login', {
      email: 'lucas@zapcloud.com',
      password: 'errada',
    })
  );

  const token = login.body?.data?.accessToken;
  const refreshToken = login.body?.data?.refreshToken;

  log('GET /auth/me com token válido', await req('GET', '/api/auth/me', null, token));
  log('GET /auth/me sem token → 401', await req('GET', '/api/auth/me'));

  log(
    'POST /auth/refresh',
    await req('POST', '/api/auth/refresh', { refreshToken })
  );

  // ── WEBHOOK ────────────────────────────────────────────────────────────────

  console.log('\n─── WEBHOOK ─────────────────────────────────');

  log(
    'GET /webhook verificação válida',
    await req(
      'GET',
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=meu_token_de_verificacao&hub.challenge=ABC123'
    )
  );

  log(
    'GET /webhook token inválido → 403',
    await req(
      'GET',
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token_errado&hub.challenge=ABC123'
    )
  );

  // ── ROTAS PROTEGIDAS ────────────────────────────────────────────────────────

  console.log('\n─── ROTAS PROTEGIDAS ────────────────────────');

  log(
    'GET /meta/auth-url (autenticado)',
    await req('GET', '/api/meta/auth-url', null, token)
  );

  log(
    'GET /meta/accounts (autenticado)',
    await req('GET', '/api/meta/accounts', null, token)
  );

  log(
    'GET /meta/accounts sem token → 401',
    await req('GET', '/api/meta/accounts')
  );

  // ── 404 ────────────────────────────────────────────────────────────────────

  console.log('\n─── ROTA INEXISTENTE ────────────────────────');
  log('GET /rota-inexistente → 404', await req('GET', '/rota-inexistente'));

  console.log('\n══════════════════════════════════════════════');
  console.log('   TESTES CONCLUÍDOS');
  console.log('══════════════════════════════════════════════\n');

  process.exit(0);
})();

/**
 * Script de descoberta da API do Multipedidos
 * Testa os endpoints mais prováveis e mostra qual responde.
 *
 * Uso: node test-multipedidos.js
 */

const TOKEN       = '8d6d5b5507e97d96078a5e23c28f15bed378f37a9207633c4fd001d27f9dfa95';
const RESTAURANT  = '44';

// Candidatos de base URL
const BASE_URLS = [
  'https://api.multipedidos.com.br',
  'https://app.multipedidos.com.br/api',
  'https://multipedidos.com.br/api',
  'https://painel.multipedidos.com.br/api',
  'https://api.multipedidos.com.br/v1',
  'https://api.multipedidos.com.br/v2',
];

// Candidatos de endpoint
const ENDPOINTS = [
  '/orders',
  '/pedidos',
  `/restaurants/${RESTAURANT}/orders`,
  `/restaurantes/${RESTAURANT}/pedidos`,
  `/store/${RESTAURANT}/orders`,
  `/loja/${RESTAURANT}/pedidos`,
  `/customers`,
  `/clientes`,
];

// Headers mais comuns para autenticação
const HEADER_SETS = [
  { 'Authorization': `Bearer ${TOKEN}` },
  { 'X-API-Token': TOKEN },
  { 'X-Token': TOKEN },
  { 'token': TOKEN },
  { 'Authorization': TOKEN },
];

async function tryFetch(url, headers) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, ok: res.status < 500 };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function main() {
  console.log('\n🔍 Testando endpoints da API Multipedidos...\n');
  console.log(`   Token:       ${TOKEN.slice(0,12)}...`);
  console.log(`   Restaurante: ${RESTAURANT}\n`);
  console.log('─'.repeat(70));

  const found = [];

  for (const base of BASE_URLS) {
    for (const endpoint of ENDPOINTS) {
      const url = base + endpoint;
      for (const headers of HEADER_SETS) {
        const result = await tryFetch(url, headers);
        const headerKey = Object.keys(headers)[0];

        if (result.status !== 0 && result.status !== 404) {
          const icon = result.status === 200 ? '✅' : result.status < 400 ? '🟡' : '🔴';
          console.log(`${icon} [${result.status}] ${url}`);
          console.log(`      Header: ${headerKey}: ${Object.values(headers)[0].slice(0,16)}...`);

          if (result.status === 200) {
            found.push({ url, headers, headerKey });
          }
        }
      }
    }
  }

  console.log('\n' + '─'.repeat(70));
  if (found.length > 0) {
    console.log('\n🎉 Endpoints funcionando (200):');
    found.forEach(f => console.log(`   ${f.url}  [${f.headerKey}]`));
  } else {
    console.log('\n⚠️  Nenhum endpoint retornou 200.');
    console.log('   Verifique se há documentação no painel do Multipedidos.');
    console.log('   Ou tente acessar no navegador: https://api.multipedidos.com.br');
  }
  console.log('');
}

main().catch(console.error);

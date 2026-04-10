/**
 * Foca em app.multipedidos.com.br e variações de autenticação
 */

const TOKEN      = '8d6d5b5507e97d96078a5e23c28f15bed378f37a9207633c4fd001d27f9dfa95';
const RESTAURANT = '44';

const TESTS = [
  // app.multipedidos.com.br com vários caminhos
  { url: `https://app.multipedidos.com.br/api/orders`,                          auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/api/orders?restaurant_id=${RESTAURANT}`, auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/api/v1/orders`,                       auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/api/v1/restaurants/${RESTAURANT}/orders`, auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/orders`,                              auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/v1/orders`,                           auth: 'bearer' },
  // Token como query param (comum em APIs mais antigas)
  { url: `https://app.multipedidos.com.br/api/orders?token=${TOKEN}`,           auth: 'none' },
  { url: `https://app.multipedidos.com.br/api/orders?api_token=${TOKEN}`,       auth: 'none' },
  { url: `https://app.multipedidos.com.br/api/pedidos?token=${TOKEN}&restaurante=${RESTAURANT}`, auth: 'none' },
  // Raiz para ver o que o servidor responde
  { url: `https://app.multipedidos.com.br/api`,                                 auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/api/`,                                auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/health`,                              auth: 'none' },
  // Outros padrões com restaurant ID no path
  { url: `https://app.multipedidos.com.br/api/${RESTAURANT}/orders`,            auth: 'bearer' },
  { url: `https://app.multipedidos.com.br/api/${RESTAURANT}/pedidos`,           auth: 'bearer' },
  // api.multipedidos.com.br — raiz e health
  { url: `https://api.multipedidos.com.br/`,                                    auth: 'bearer' },
  { url: `https://api.multipedidos.com.br/health`,                              auth: 'none' },
  { url: `https://api.multipedidos.com.br/api/orders`,                          auth: 'bearer' },
  { url: `https://api.multipedidos.com.br/api/${RESTAURANT}/orders`,            auth: 'bearer' },
];

function headers(type) {
  if (type === 'none') return { 'Content-Type': 'application/json' };
  return { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}

async function test({ url, auth }) {
  try {
    const res = await fetch(url, {
      headers: headers(auth),
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    const isHTML = text.trim().startsWith('<');
    const preview = isHTML ? '[HTML]' : text.slice(0, 250);
    const icon = res.status === 200 && !isHTML ? '✅' :
                 res.status === 401 || res.status === 403 ? '🔐' :
                 res.status === 404 ? '❌' : '🟡';
    console.log(`${icon} [${res.status}] ${url}`);
    if (!isHTML && res.status !== 404) {
      console.log(`   ${preview}\n`);
    }
  } catch (e) {
    console.log(`💥 [ERR] ${url} — ${e.message}`);
  }
}

(async () => {
  console.log('\n🔍 Explorando app.multipedidos.com.br...\n');
  for (const t of TESTS) await test(t);
  console.log('\n✅ Concluído.\n');
})();

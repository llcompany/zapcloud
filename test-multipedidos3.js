/**
 * Testa subdomínios e caminhos alternativos da API Multipedidos
 */

const TOKEN      = '8d6d5b5507e97d96078a5e23c28f15bed378f37a9207633c4fd001d27f9dfa95';
const RESTAURANT = '44';

const URLS = [
  // Subdomínios comuns
  `https://api.multipedidos.com.br/orders`,
  `https://api.multipedidos.com.br/pedidos`,
  `https://api.multipedidos.com.br/restaurants/${RESTAURANT}/orders`,
  `https://api.multipedidos.com.br/v1/orders`,
  `https://api.multipedidos.com.br/v1/restaurants/${RESTAURANT}/orders`,
  `https://api.multipedidos.com.br/v1/pedidos`,
  `https://backend.multipedidos.com.br/api/orders`,
  `https://backend.multipedidos.com.br/orders`,
  `https://app.multipedidos.com.br/api/orders`,
  `https://painel.multipedidos.com.br/api/orders`,
  `https://admin.multipedidos.com.br/api/orders`,
  // Com restaurant_id como query param
  `https://api.multipedidos.com.br/orders?restaurant_id=${RESTAURANT}`,
  `https://api.multipedidos.com.br/orders?restaurante_id=${RESTAURANT}`,
  `https://api.multipedidos.com.br/pedidos?restaurante=${RESTAURANT}`,
  // Outros padrões
  `https://api.multipedidos.com.br/store/${RESTAURANT}/orders`,
  `https://api.multipedidos.com.br/loja/${RESTAURANT}/pedidos`,
];

async function test(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    const isHTML = text.trim().startsWith('<');
    const preview = isHTML ? '[HTML - página do site]' : text.slice(0, 200);
    const icon = res.status === 200 && !isHTML ? '✅' : res.status === 401 || res.status === 403 ? '🔐' : res.status === 404 ? '❌' : '🟡';
    console.log(`${icon} [${res.status}] ${url}`);
    if (!isHTML && res.status !== 404) console.log(`   ${preview}`);
  } catch (e) {
    console.log(`💥 [ERR] ${url} — ${e.message}`);
  }
}

(async () => {
  console.log('\n🔍 Testando subdomínios e variações...\n');
  for (const url of URLS) await test(url);
  console.log('\n✅ Concluído.\n');
  console.log('Legenda: ✅ JSON válido  🔐 Auth error  ❌ Not found  🟡 Outro  💥 Falha de rede\n');
})();

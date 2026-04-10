/**
 * Mostra o CORPO das respostas da API Multipedidos
 */

const TOKEN      = '8d6d5b5507e97d96078a5e23c28f15bed378f37a9207633c4fd001d27f9dfa95';
const RESTAURANT = '44';
const BASE       = 'https://multipedidos.com.br/api';

const TESTS = [
  `/orders`,
  `/pedidos`,
  `/restaurants/${RESTAURANT}/orders`,
  `/restaurantes/${RESTAURANT}/pedidos`,
  `/customers`,
  `/clientes`,
];

async function test(path) {
  const url = BASE + path;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    console.log(`\n── ${url} [${res.status}] ──`);
    console.log(JSON.stringify(body, null, 2).slice(0, 600));
  } catch (e) {
    console.log(`\n── ${url} ── ERRO: ${e.message}`);
  }
}

(async () => {
  console.log('🔍 Verificando corpo das respostas...\n');
  for (const path of TESTS) await test(path);
  console.log('\n✅ Concluído.\n');
})();

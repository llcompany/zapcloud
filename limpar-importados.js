// Apaga todos os clientes importados da planilha (source = 'importacao')
// Mantém apenas os clientes reais do Multipedidos
const API = 'http://localhost:3000';

async function main() {
  // Login
  const loginRes  = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'llcompanyltda@gmail.com', password: 'Lucas123' }),
  });
  const loginData = await loginRes.json();
  const token     = loginData.data?.accessToken;
  if (!token) { console.error('❌ Login falhou'); return; }

  const meRes  = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = await meRes.json();
  const wabaId = meData.data?.wabaAccounts?.[0]?.id;
  if (!wabaId) { console.error('❌ Conta não encontrada'); return; }
  console.log('✅ Login OK\n');

  console.log('🗑️  Apagando todos os clientes importados...');
  const res  = await fetch(`${API}/api/crm/${wabaId}/customers/bulk?source=import`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  if (data.success) {
    console.log(`\n✅ Pronto! ${data.deleted} clientes importados removidos.`);
    console.log('   Os clientes reais do Multipedidos foram mantidos.');
  } else {
    console.error('❌ Erro:', data.message);
  }
}

main().catch(console.error);

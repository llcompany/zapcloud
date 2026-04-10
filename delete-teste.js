// Script para apagar o cliente "Cliente Teste" do CRM
const API = 'http://localhost:3000';

async function main() {
  // 1. Login
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'llcompanyltda@gmail.com', password: 'Lucas123' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken;
  if (!token) { console.error('Login falhou:', JSON.stringify(loginData)); return; }

  // Busca wabaId via /api/auth/me
  const meRes = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = await meRes.json();
  const wabaId = meData.data?.wabaAccounts?.[0]?.id;
  if (!wabaId) { console.error('Nenhuma conta WhatsApp encontrada'); return; }
  console.log('✅ Login OK, wabaId:', wabaId);

  // 2. Busca clientes com search "Cliente Teste" ou phone 5547999999999
  const res = await fetch(`${API}/api/crm/${wabaId}/customers?search=Cliente+Teste&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data } = await res.json();
  const toDelete = (data.customers || []).filter(c =>
    c.name === 'Cliente Teste' || c.phone === '5547999999999'
  );

  if (toDelete.length === 0) {
    console.log('ℹ️  Nenhum "Cliente Teste" encontrado.');
    return;
  }

  // 3. Deleta cada um
  for (const c of toDelete) {
    const del = await fetch(`${API}/api/crm/${wabaId}/customers/${c.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await del.json();
    console.log(`🗑️  Deletado: ${c.name} (${c.phone}) — ${d.success ? 'OK' : 'ERRO'}`);
  }
}

main().catch(console.error);

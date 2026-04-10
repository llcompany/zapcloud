const API = 'http://localhost:3000';

// ─── EDITE AQUI os clientes com pedidos reais de ontem/hoje ──────────────────
// Formato: { phone: '55...' (com 55), name: 'Nome', orderDate: 'YYYY-MM-DD', total: valor }
const PEDIDOS_REAIS = [
  { phone: '5547999111375', name: 'Thaise', orderDate: '2026-04-08', total: 66.90 },
  // Adicione os outros clientes aqui se souber:
  // { phone: '5547900000000', name: 'Nome', orderDate: '2026-04-07', total: 00.00 },
];
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const loginRes  = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'llcompanyltda@gmail.com', password: 'Lucas123' }),
  });
  const loginData = await loginRes.json();
  const token     = loginData.data?.accessToken;
  if (!token) { console.error('❌ Login falhou:', JSON.stringify(loginData)); return; }

  const meRes  = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = await meRes.json();
  const wabaId = meData.data?.wabaAccounts?.[0]?.id;
  if (!wabaId) { console.error('❌ Nenhuma conta WhatsApp encontrada'); return; }
  console.log('✅ Login OK\n');

  for (const p of PEDIDOS_REAIS) {
    const phone = p.phone.startsWith('55') ? p.phone : '55' + p.phone;
    const r = await fetch(`${API}/api/crm/${wabaId}/customers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        phone,
        name: p.name,
        lastOrderAt: p.orderDate,
        totalOrders: 1,
        totalSpent: p.total || 0,
        source: 'multipedidos',
        tags: ['multipedidos'],
      }),
    });
    const d = await r.json();
    console.log(`${d.success ? '✅' : '❌'} ${p.name} (${phone}) — ${d.success ? 'atualizado' : d.message}`);
  }
}

main().catch(console.error);

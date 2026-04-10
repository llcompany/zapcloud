/**
 * Importa clientes do Excel de Faixas de Compras para o CRM do ZapCloud
 * Uso: node import-clientes.js
 */

const fs   = require('fs');
const path = require('path');

const API   = 'http://localhost:3000';
const EMAIL = 'llcompanyltda@gmail.com';
const SENHA = 'Lucas123';

async function main() {
  console.log('\n🚀 ZapCloud — Importador de Clientes\n');

  // ── 1. Login ────────────────────────────────────────────────
  console.log('🔐 Fazendo login...');
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('❌ Erro no login:', loginData.message);
    console.log('   Verifique o email e senha no topo do arquivo import-clientes.js');
    process.exit(1);
  }
  const token  = loginData.data.accessToken;
  const wabaId = loginData.data.user?.wabaAccounts?.[0]?.id;
  console.log('✅ Login OK');

  // ── 2. Busca wabaId se não veio no login ─────────────────────
  let waba = wabaId;
  if (!waba) {
    const meRes  = await fetch(`${API}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    const meData = await meRes.json();
    waba = meData.data?.wabaAccounts?.[0]?.id;
  }
  if (!waba) {
    console.error('❌ Nenhuma conta WhatsApp encontrada. Configure a conta primeiro.');
    process.exit(1);
  }
  console.log(`✅ Conta encontrada: ${waba}\n`);

  // ── 3. Carrega clientes do JSON ──────────────────────────────
  const jsonPath = path.join(__dirname, '../../../clientes_import.json');
  // Tenta caminhos alternativos
  const paths = [
    jsonPath,
    path.join(__dirname, 'clientes_import.json'),
    '/sessions/amazing-quirky-wozniak/clientes_import.json',
  ];
  let clientes = null;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      clientes = JSON.parse(fs.readFileSync(p, 'utf-8'));
      console.log(`📂 Arquivo carregado: ${p}`);
      break;
    }
  }
  if (!clientes) {
    console.error('❌ Arquivo clientes_import.json não encontrado.');
    process.exit(1);
  }
  console.log(`👥 Total de clientes: ${clientes.length}\n`);

  // ── 4. Importa em lotes de 100 ───────────────────────────────
  const BATCH = 100;
  let importados = 0, atualizados = 0, erros = 0;

  for (let i = 0; i < clientes.length; i += BATCH) {
    const lote  = clientes.slice(i, i + BATCH);
    const atual = Math.min(i + BATCH, clientes.length);

    process.stdout.write(`\r⏳ Importando ${atual}/${clientes.length}...`);

    try {
      const res  = await fetch(`${API}/api/crm/${waba}/customers/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ customers: lote }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        importados += data.data?.imported || 0;
        atualizados += data.data?.updated  || 0;
      } else {
        erros += lote.length;
        console.error(`\n⚠️  Lote ${i}-${atual}: ${data.message}`);
      }
    } catch (e) {
      erros += lote.length;
      console.error(`\n💥 Erro no lote ${i}-${atual}:`, e.message);
    }

    // Pequena pausa para não sobrecarregar
    await new Promise(r => setTimeout(r, 150));
  }

  // ── 5. Resultado ─────────────────────────────────────────────
  console.log('\n\n' + '─'.repeat(50));
  console.log('✅ Importação concluída!');
  console.log(`   Novos clientes:       ${importados}`);
  console.log(`   Clientes atualizados: ${atualizados}`);
  if (erros > 0) console.log(`   Erros:               ${erros}`);
  console.log('\n🎉 Abra o ZapCloud → CRM para ver os clientes!\n');
}

main().catch(e => {
  console.error('\n💥 Erro fatal:', e.message);
  process.exit(1);
});

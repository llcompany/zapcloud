const { createClient } = require('@supabase/supabase-js');

// Client do Supabase Storage (service role — ignora RLS; nunca expor no frontend).
// Singleton: criado na primeira chamada, depois reutilizado.
let client = null;

function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  // @supabase/supabase-js v2 inicializa um RealtimeClient que exige WebSocket.
  // No Node.js < 22 não há WebSocket nativo — passamos o pacote `ws` como transport
  // para evitar o erro "Node.js detected but native WebSocket not found".
  // O backend usa apenas Storage (nunca Realtime), então o ws nunca chega a conectar.
  let wsImpl;
  try { wsImpl = require('ws'); } catch (_) { /* ws não instalado — será corrigido pelo engines */ }

  client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: wsImpl ? { transport: wsImpl } : {},
  });
  return client;
}

module.exports = { getSupabase };

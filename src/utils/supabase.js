const { createClient } = require('@supabase/supabase-js');

// Client do Supabase Storage (service role — ignora RLS; nunca expor no frontend).
// Singleton: criado na primeira chamada, depois reutilizado.
let client = null;

function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

module.exports = { getSupabase };

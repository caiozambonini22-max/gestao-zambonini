// Edge Function Vercel: proxy pra API do Bling
// URL: gestao-zambonini.vercel.app/api/bling-proxy
//
// Resolve CORS (navegador não pode chamar API Bling direto)
// Renova token automaticamente quando expira
//
// Uso do ERP:
//   fetch('/api/bling-proxy', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       method: 'POST',           // método HTTP pra API Bling
//       endpoint: '/produtos',    // endpoint da API Bling (sem /Api/v3)
//       body: { ... }            // corpo da requisição (opcional)
//     })
//   })

export const config = { runtime: 'edge' };

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const BLING_API_BASE = 'https://www.bling.com.br/Api/v3';

export default async function handler(req) {
  // CORS pra chamadas do navegador
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405, corsHeaders);
  }

  try {
    const { method = 'GET', endpoint, body } = await req.json();

    if (!endpoint) {
      return json({ error: 'endpoint é obrigatório' }, 400, corsHeaders);
    }

    // 1. Pega token do Supabase
    let token = await getToken();
    if (!token) {
      return json({ error: 'Não conectado ao Bling. Autorize primeiro.' }, 401, corsHeaders);
    }

    // 2. Verifica se token expirou (ou vai expirar nos próximos 5 min)
    const expiresAt = new Date(token.expires_at).getTime();
    const now = Date.now();
    if (expiresAt - now < 5 * 60 * 1000) {
      // Expira em menos de 5 min → renova
      token = await refreshToken(token.refresh_token);
      if (!token) {
        return json({ error: 'Falha ao renovar token. Reconecte o Bling.' }, 401, corsHeaders);
      }
    }

    // 3. Chama a API do Bling
    const fullUrl = `${BLING_API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const blingRes = await fetch(fullUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    const resText = await blingRes.text();
    let resData;
    try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }

    return json({
      status: blingRes.status,
      ok: blingRes.ok,
      data: resData,
    }, 200, corsHeaders);

  } catch (e) {
    return json({ error: `Exceção: ${e.message}` }, 500, corsHeaders);
  }
}

async function getToken() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/zambonini_data?key=eq.bling_token&select=value`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows || !rows.length) return null;
  return rows[0].value;
}

async function refreshToken(refreshTkn) {
  const credentials = btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`);
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTkn,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) return null;

  const newToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshTkn,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    token_type: data.token_type || 'Bearer',
    scope: data.scope,
    refreshed_at: new Date().toISOString(),
  };

  // Salva o novo token
  await fetch(`${SUPABASE_URL}/rest/v1/zambonini_data`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: 'bling_token',
      value: newToken,
      updated_at: new Date().toISOString(),
    }),
  });

  return newToken;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

// Edge Function Vercel: proxy pra API da SuperFrete
// URL: gestao-zambonini.vercel.app/api/superfrete-proxy
//
// Resolve CORS (navegador não pode chamar API SuperFrete direto)
// Adiciona User-Agent obrigatório
//
// Uso do ERP:
//   fetch('/api/superfrete-proxy', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       method: 'POST',          // método HTTP pra API SuperFrete
//       endpoint: '/calculator', // endpoint da API (sem /api/v0)
//       body: { ... }           // corpo da requisição (opcional)
//     })
//   })

export const config = { runtime: 'edge' };

const SUPERFRETE_TOKEN = process.env.SUPERFRETE_TOKEN;
const SUPERFRETE_USER_AGENT = process.env.SUPERFRETE_USER_AGENT || 'Zambonini Imports (caiohzambonini@gmail.com)';

// IMPORTANTE: produção = api.superfrete.com. Sandbox = sandbox.superfrete.com
const SUPERFRETE_API_BASE = 'https://api.superfrete.com/api/v0';

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

  if (!SUPERFRETE_TOKEN) {
    return json({ error: 'SUPERFRETE_TOKEN não configurado no Vercel.' }, 500, corsHeaders);
  }

  try {
    const { method = 'GET', endpoint, body } = await req.json();

    if (!endpoint) {
      return json({ error: 'endpoint é obrigatório' }, 400, corsHeaders);
    }

    // Monta URL
    const fullUrl = `${SUPERFRETE_API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    // Chama a API da SuperFrete
    const sfRes = await fetch(fullUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${SUPERFRETE_TOKEN}`,
        'User-Agent': SUPERFRETE_USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    const resText = await sfRes.text();
    let resData;
    try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }

    return json({
      status: sfRes.status,
      ok: sfRes.ok,
      data: resData,
    }, 200, corsHeaders);

  } catch (e) {
    return json({ error: `Exceção: ${e.message}` }, 500, corsHeaders);
  }
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

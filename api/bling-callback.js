// Edge Function Vercel: recebe o callback OAuth do Bling
// URL: gestao-zambonini.vercel.app/api/bling-callback
//
// Fluxo:
// 1. Usuário clica "Conectar Bling" no ERP
// 2. ERP abre https://www.bling.com.br/Api/v3/oauth/authorize?...&redirect_uri=...bling-callback
// 3. Usuário autoriza no Bling
// 4. Bling redireciona pra cá com ?code=XXXX&state=YYYY
// 5. Esta função troca o code por access_token + refresh_token
// 6. Salva no Supabase e redireciona de volta pro ERP

export const config = { runtime: 'edge' };

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ERP_URL = process.env.ERP_URL || 'https://gestao-zambonini.vercel.app';

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  // Se o Bling retornou erro
  if (error) {
    const msg = `Erro OAuth Bling: ${error} - ${errorDesc || 'sem detalhes'}`;
    return redirectWithStatus(ERP_URL, 'erro', msg);
  }

  if (!code) {
    return redirectWithStatus(ERP_URL, 'erro', 'Código OAuth não recebido');
  }

  try {
    // 1. Troca code por token (Bling API v3)
    const credentials = btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`);
    const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || JSON.stringify(tokenData);
      return redirectWithStatus(ERP_URL, 'erro', `Falha ao obter token: ${errMsg}`);
    }

    // 2. Salva no Supabase
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();

    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/zambonini_data`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        key: 'bling_token',
        value: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          token_type: tokenData.token_type || 'Bearer',
          scope: tokenData.scope,
          connected_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }),
    });

    if (!sbRes.ok) {
      const errText = await sbRes.text();
      return redirectWithStatus(ERP_URL, 'erro', `Falha ao salvar token no Supabase: ${errText.slice(0, 200)}`);
    }

    // 3. Redireciona de volta pro ERP com sucesso
    return redirectWithStatus(ERP_URL, 'ok', 'Bling conectado com sucesso!');

  } catch (e) {
    return redirectWithStatus(ERP_URL, 'erro', `Exceção: ${e.message}`);
  }
}

function redirectWithStatus(baseUrl, status, msg) {
  const encodedMsg = encodeURIComponent(msg);
  const redirectUrl = `${baseUrl}/#bling=${status}&msg=${encodedMsg}`;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectUrl },
  });
}

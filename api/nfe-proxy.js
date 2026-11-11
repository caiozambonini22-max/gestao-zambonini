// Edge Function Vercel: proxy pro emissor de NF-e próprio (VPS)
// URL: gestao-zambonini.vercel.app/api/nfe-proxy?path=status
//
// Variáveis de ambiente na Vercel:
//   NFE_API_URL   = http://srv2126279.hstgr.cloud:8085
//   NFE_API_TOKEN = token do .env da VPS
//   NFE_ERP_KEY   = chave que o ERP manda no header x-nfe-key (ou ?key= no navegador)
//
// O repositório é público: NENHUM segredo fica aqui, só nas variáveis da Vercel.

export const config = { runtime: 'edge' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-nfe-key',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const key = req.headers.get('x-nfe-key') || url.searchParams.get('key');
  if (!process.env.NFE_ERP_KEY || key !== process.env.NFE_ERP_KEY) {
    return new Response(JSON.stringify({ erro: 'Chave do ERP inválida' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const path = (url.searchParams.get('path') || 'status').replace(/^\/+/, '');
  url.searchParams.delete('path');
  url.searchParams.delete('key');
  const qs = url.searchParams.toString();
  const target = `${process.env.NFE_API_URL}/${path}${qs ? '?' + qs : ''}`;

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { Authorization: `Bearer ${process.env.NFE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    });
    const headers = { ...cors, 'Content-Type': r.headers.get('content-type') || 'application/json' };
    const cd = r.headers.get('content-disposition');
    if (cd) headers['Content-Disposition'] = cd;
    return new Response(r.body, { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'VPS não respondeu: ' + e.message }), {
      status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

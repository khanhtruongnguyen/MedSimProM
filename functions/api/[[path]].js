// Cloudflare Pages Functions — static index.html được serve tự động,
// function này chỉ lo phần /api/* để giữ nguyên đường dẫn client.
// Logic y hệt worker/ai-call.js và worker/admin.js (Worker độc lập).
import { handleAiCall } from './worker/ai-call.js';
import { handleAdmin } from './worker/admin.js';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    });
  }

  if (pathname === '/api/ai-call') {
    return handleAiCall(request, context.env);
  }
  if (pathname === '/api/admin') {
    return handleAdmin(request, context.env);
  }

  return new Response(JSON.stringify({ error: `Not found: ${pathname}` }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

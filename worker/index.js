import { handleAiCall } from './ai-call.js';
import { handleAdmin } from './admin.js';

// Handler tổng — client gọi POST /api/ai-call và /api/admin như cũ.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight (tương tự event.httpMethod === 'OPTIONS' của Netlify)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (pathname === '/api/ai-call' || pathname === '/ai-call') {
      return handleAiCall(request, env);
    }
    if (pathname === '/api/admin' || pathname === '/admin') {
      return handleAdmin(request, env);
    }

    return new Response(JSON.stringify({ error: `Not found: ${pathname}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

export function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

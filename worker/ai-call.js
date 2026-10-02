// ===================================================================
// Cloudflare Worker: ai-call.js (port từ Netlify Functions)
// Proxy mọi AI API call, kiểm tra auth + daily limit
// KHÁC Netlify: thay vì returns { statusCode, headers, body } → Response
// ===================================================================
import { corsHeaders } from './index.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(),
  });
}

export async function handleAiCall(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const SUPABASE_URL      = env.SUPABASE_URL;
  const SUPABASE_SVC_KEY  = env.SUPABASE_SERVICE_KEY;
  const AI_API_KEY        = env.AI_API_KEY;
  const AI_API_BASE_URL   = env.AI_API_BASE_URL;
  const AI_MAIN_MODEL     = env.AI_MAIN_MODEL;
  const AI_JUDGE_MODEL    = env.AI_JUDGE_MODEL;

  // ── 1. Lấy & xác thực user token ─────────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const userToken  = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return json({ error: 'Chưa đăng nhập' }, 401);

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_SVC_KEY }
    });
    if (!r.ok) return json({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại' }, 401);
    const d = await r.json();
    userId = d.id;
  } catch {
    return json({ error: 'Lỗi xác thực' }, 401);
  }

  // ── 2. Lấy profile user ──────────────────────────────────────────
  let profile;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY }
    });
    const list = await r.json();
    profile = list[0];
  } catch {
    return json({ error: 'Lỗi server' }, 500);
  }

  if (!profile)           return json({ error: 'Tài khoản không tồn tại' }, 403);
  if (!profile.is_active) return json({ error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ admin.' }, 403);

  // ── 3. Kiểm tra daily limit ──────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  let currentCount = 0, usageExists = false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_usage?user_id=eq.${userId}&usage_date=eq.${today}&select=call_count`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY } }
    );
    const data = await r.json();
    if (data[0]) { currentCount = data[0].call_count; usageExists = true; }
  } catch { /* non-fatal */ }

  if (currentCount >= profile.daily_limit) {
    return json({
      error: `Bạn đã dùng hết ${profile.daily_limit} lượt hôm nay. Thử lại vào ngày mai.`,
      _usage: { used: currentCount, limit: profile.daily_limit }
    }, 429);
  }

  // ── 4. Parse body ────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request' }, 400); }

  const { messages, modelType = 'main', extra = {} } = body;
  // KHÔNG nhận customModel từ client — model luôn do server quyết định theo role

  // ── 5. Xác định model ────────────────────────────────────────────
  const envModel = modelType === 'judge' ? AI_JUDGE_MODEL : AI_MAIN_MODEL;
  const isElevated = profile.role === 'admin' || profile.role === 'ultra';

  let model = envModel;
  let modelSource = 'env';

  if (isElevated) {
    const own = modelType === 'judge' ? profile.custom_judge_model : profile.custom_main_model;
    if (own && own.trim()) { model = own.trim(); modelSource = 'personal'; }
  } else {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?id=eq.1&select=group_main_model,group_judge_model`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY }
      });
      if (r.ok) {
        const s = (await r.json())[0];
        const g = s ? (modelType === 'judge' ? s.group_judge_model : s.group_main_model) : '';
        if (g && g.trim()) { model = g.trim(); modelSource = 'group'; }
      }
    } catch { /* non-fatal — fallback env */ }
  }

  if (!model || !model.trim()) {
    console.error(`Missing env var: ${modelType === 'judge' ? 'AI_JUDGE_MODEL' : 'AI_MAIN_MODEL'}`);
    return json({ error: 'Hệ thống chưa cấu hình model AI. Liên hệ admin.' }, 500);
  }

  // ── 6. Gọi AI API ────────────────────────────────────────────────
  console.log(`[ai-call] model="${model}" type=${modelType} role=${profile.role} source=${modelSource}`);

  let aiData;
  try {
    const r = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model, messages, ...extra })
    });
    if (!r.ok) {
      const t = await r.text();

      const isModelMissing =
        t.includes('not_found_error') ||
        t.includes('model_not_found') ||
        t.includes('is not available');
      if (isModelMissing) {
        console.error(`AI model unavailable: "${model}" — ${t}`);
        return json({
          error: 'Model AI đang không khả dụng trên hệ thống. Admin vui lòng cập nhật cấu hình model.'
        }, 500);
      }

      return json({ error: `AI error: ${t}` }, r.status);
    }
    aiData = await r.json();
  } catch (e) {
    return json({ error: 'Lỗi kết nối tới AI: ' + e.message }, 502);
  }

  // ── 7. Tăng usage counter ────────────────────────────────────────
  try {
    if (usageExists) {
      await fetch(`${SUPABASE_URL}/rest/v1/daily_usage?user_id=eq.${userId}&usage_date=eq.${today}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ call_count: currentCount + 1 })
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/daily_usage`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, usage_date: today, call_count: 1 })
      });
    }
  } catch (e) { console.error('Usage increment failed:', e); }

  // ── 8. Trả về kết quả — CHỈ những field cần thiết, ẩn model name ─
  return json({
    id:      aiData.id,
    object:  aiData.object,
    choices: aiData.choices,
    usage:   aiData.usage,
    _usage: { used: currentCount + 1, limit: profile.daily_limit, role: profile.role }
  });
}


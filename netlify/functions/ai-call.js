// ===================================================================
// Netlify Function: ai-call.js
// Proxy mọi AI API call, kiểm tra auth + daily limit
// ===================================================================
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const AI_API_KEY        = process.env.AI_API_KEY;
  const AI_API_BASE_URL   = process.env.AI_API_BASE_URL;
  const AI_MAIN_MODEL     = process.env.AI_MAIN_MODEL;
  const AI_JUDGE_MODEL    = process.env.AI_JUDGE_MODEL;

  // ── 1. Lấy & xác thực user token ─────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const userToken  = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Chưa đăng nhập' }) };

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_SVC_KEY }
    });
    if (!r.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại' }) };
    const d = await r.json();
    userId = d.id;
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Lỗi xác thực' }) };
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi server' }) };
  }

  if (!profile)           return { statusCode: 403, headers, body: JSON.stringify({ error: 'Tài khoản không tồn tại' }) };
  if (!profile.is_active) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ admin.' }) };

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
    return {
      statusCode: 429, headers,
      body: JSON.stringify({
        error: `Bạn đã dùng hết ${profile.daily_limit} lượt hôm nay. Thử lại vào ngày mai.`,
        _usage: { used: currentCount, limit: profile.daily_limit }
      })
    };
  }

  // ── 4. Parse body ────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { messages, modelType = 'main', extra = {}, customModel } = body;

  // ── 5. Xác định model ────────────────────────────────────────────
  let model;
  if ((profile.role === 'admin' || profile.role === 'ultra') && customModel) {
    model = customModel;  // admin/ultra có thể override model
  } else {
    model = modelType === 'judge' ? AI_JUDGE_MODEL : AI_MAIN_MODEL;
  }

  // Model phải được cấu hình ở server — không bao giờ để client biết tên
  if (!model || !model.trim()) {
    console.error(`Missing env var: ${modelType === 'judge' ? 'AI_JUDGE_MODEL' : 'AI_MAIN_MODEL'}`);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Hệ thống chưa cấu hình model AI. Liên hệ admin.' })
    };
  }

  // ── 6. Gọi AI API ────────────────────────────────────────────────
  let aiData;
  try {
    const r = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model, messages, ...extra })
    });
    if (!r.ok) {
      const t = await r.text();

      // Model không tồn tại trên provider → lỗi cấu hình, cần admin sửa env var
      const isModelMissing =
        t.includes('not_found_error') ||
        t.includes('model_not_found') ||
        t.includes('is not available');
      if (isModelMissing) {
        console.error(`AI model unavailable: "${model}" (env var ${modelType === 'judge' ? 'AI_JUDGE_MODEL' : 'AI_MAIN_MODEL'}) — ${t}`);
        return {
          statusCode: 500, headers,
          body: JSON.stringify({
            error: 'Model AI đang không khả dụng trên hệ thống. Admin vui lòng cập nhật cấu hình model.'
          })
        };
      }

      return { statusCode: r.status, headers, body: JSON.stringify({ error: `AI error: ${t}` }) };
    }
    aiData = await r.json();
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Lỗi kết nối tới AI: ' + e.message }) };
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
  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      id:      aiData.id,
      object:  aiData.object,
      choices: aiData.choices,   // nội dung trả lời
      usage:   aiData.usage,     // token usage (không có model name)
      // model: ẩn hoàn toàn — không trả về client
      _usage: { used: currentCount + 1, limit: profile.daily_limit, role: profile.role }
    })
  };
};

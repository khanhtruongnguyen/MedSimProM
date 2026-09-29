// ===================================================================
// Netlify Function: admin.js
// Quản lý user (chỉ admin mới gọi được)
// ===================================================================
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
  const AI_MAIN_MODEL    = process.env.AI_MAIN_MODEL;
  const AI_JUDGE_MODEL   = process.env.AI_JUDGE_MODEL;

  // ── 1. Xác thực token ────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const userToken  = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_SVC_KEY }
    });
    if (!r.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    userId = (await r.json()).id;
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── 2. Kiểm tra quyền admin ──────────────────────────────────────
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY }
  });
  const profiles = await profileRes.json();
  if (profiles[0]?.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Chỉ admin mới có quyền này' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) }; }

  const { action } = body;

  // ── ACTION: get_models ───────────────────────────────────────────
  // Trả về tên model thật cho admin/ultra
  if (action === 'get_models') {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ mainModel: AI_MAIN_MODEL, judgeModel: AI_JUDGE_MODEL })
    };
  }

  // ── ACTION: list_users ───────────────────────────────────────────
  if (action === 'list_users') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&order=created_at.asc`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY }
    });
    const users = await r.json();
    return { statusCode: 200, headers, body: JSON.stringify({ users }) };
  }

  // ── ACTION: create_user ──────────────────────────────────────────
  if (action === 'create_user') {
    const { email, password, username, role, daily_limit } = body;
    if (!email || !password || !username || !role) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Thiếu thông tin bắt buộc (email, password, username, role)' }) };
    }
    const validRoles = ['free', 'vip', 'pro', 'ultra'];
    if (!validRoles.includes(role)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Role không hợp lệ' }) };
    }

    // Tạo user trong Supabase Auth
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (!createRes.ok) {
      const err = await createRes.json();
      return { statusCode: 400, headers, body: JSON.stringify({ error: err.msg || err.message || 'Tạo tài khoản thất bại' }) };
    }
    const newUser = await createRes.json();

    // Tạo profile
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ id: newUser.id, username, role, daily_limit: daily_limit || 5, is_active: true })
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, userId: newUser.id }) };
  }

  // ── ACTION: toggle_user ──────────────────────────────────────────
  if (action === 'toggle_user') {
    const { targetUserId, is_active } = body;
    if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Thiếu targetUserId' }) };
    // Không cho phép tự vô hiệu hóa chính mình
    if (targetUserId === userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Không thể vô hiệu hóa chính mình' }) };
    }
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ is_active, updated_at: new Date().toISOString() })
    });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── ACTION: update_user ──────────────────────────────────────────
  if (action === 'update_user') {
    const { targetUserId, role, daily_limit, username } = body;
    if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Thiếu targetUserId' }) };
    const update = { updated_at: new Date().toISOString() };
    if (role !== undefined)        update.role        = role;
    if (daily_limit !== undefined) update.daily_limit = parseInt(daily_limit);
    if (username !== undefined)    update.username    = username;
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'apikey': SUPABASE_SVC_KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify(update)
    });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
};

// ===================================================================
// Cloudflare Worker: admin.js (port từ Netlify Functions)
// Quản lý user (chỉ admin mới gọi được)
// ===================================================================
import { corsHeaders } from './index.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

export async function handleAdmin(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const SUPABASE_URL     = env.SUPABASE_URL;
  const SUPABASE_SVC_KEY = env.SUPABASE_SERVICE_KEY;
  const AI_MAIN_MODEL    = env.AI_MAIN_MODEL;
  const AI_JUDGE_MODEL   = env.AI_JUDGE_MODEL;

  // ── Helper: gọi Supabase REST ─────────────────────────────────────
  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${SUPABASE_SVC_KEY}`,
      'apikey': SUPABASE_SVC_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });

  // ── 1. Xác thực token ────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const userToken  = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return json({ error: 'Unauthorized' }, 401);

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_SVC_KEY }
    });
    if (!r.ok) return json({ error: 'Unauthorized' }, 401);
    userId = (await r.json()).id;
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── 2. Kiểm tra quyền admin ──────────────────────────────────────
  const profileRes = await sb(`/rest/v1/profiles?id=eq.${userId}&select=role`);
  const profiles   = await profileRes.json();
  const role       = profiles[0]?.role || 'free';

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid body' }, 400); }

  const { action } = body;

  // ── ACTION: get_models ───────────────────────────────────────────
  if (action === 'get_models') {
    if (role !== 'admin' && role !== 'ultra') {
      return json({ error: 'Không có quyền' }, 403);
    }
    const result = { mainModel: AI_MAIN_MODEL, judgeModel: AI_JUDGE_MODEL };

    const ownRes = await sb(`/rest/v1/profiles?id=eq.${userId}&select=custom_main_model,custom_judge_model`);
    const own    = (await ownRes.json())[0] || {};
    result.customMainModel = own.custom_main_model || '';
    result.customJudgeModel = own.custom_judge_model || '';

    if (role === 'admin') {
      try {
        const g = await sb(`/rest/v1/app_settings?id=eq.1&select=group_main_model,group_judge_model`);
        const settings = (await g.json())[0] || {};
        result.groupMainModel  = settings.group_main_model  || '';
        result.groupJudgeModel = settings.group_judge_model || '';
      } catch { /* non-fatal */ }
    }

    return json(result);
  }

  // ── ACTION: set_own_model ────────────────────────────────────────
  if (action === 'set_own_model') {
    if (role !== 'admin' && role !== 'ultra') {
      return json({ error: 'Không có quyền' }, 403);
    }
    const { customMainModel, customJudgeModel } = body;
    const update = { updated_at: new Date().toISOString() };
    if (customMainModel !== undefined)  update.custom_main_model  = String(customMainModel).trim();
    if (customJudgeModel !== undefined) update.custom_judge_model = String(customJudgeModel).trim();
    await sb(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(update)
    });
    return json({ success: true });
  }

  // ── ACTION: set_group_model ──────────────────────────────────────
  if (action === 'set_group_model') {
    if (role !== 'admin') {
      return json({ error: 'Chỉ admin mới có quyền này' }, 403);
    }
    const { groupMainModel, groupJudgeModel } = body;
    const update = { updated_at: new Date().toISOString() };
    if (groupMainModel  !== undefined) update.group_main_model  = String(groupMainModel).trim();
    if (groupJudgeModel !== undefined) update.group_judge_model = String(groupJudgeModel).trim();
    await sb(`/rest/v1/app_settings?id=eq.1`, {
      method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(update)
    });
    return json({ success: true });
  }

  // Các action còn lại yêu cầu admin
  if (role !== 'admin') {
    return json({ error: 'Chỉ admin mới có quyền này' }, 403);
  }

  // ── ACTION: list_users ───────────────────────────────────────────
  if (action === 'list_users') {
    const [profilesRes, authUsersRes] = await Promise.all([
      sb(`/rest/v1/profiles?select=*&order=created_at.asc`),
      sb(`/auth/v1/admin/users?per_page=1000`)
    ]);
    const profileList  = await profilesRes.json();
    const authData     = await authUsersRes.json();
    const authUsers    = authData.users || [];

    const emailMap = {};
    authUsers.forEach(u => { emailMap[u.id] = u.email; });

    const users = profileList.map(p => ({ ...p, email: emailMap[p.id] || '' }));
    return json({ users });
  }

  // ── ACTION: create_user ──────────────────────────────────────────
  if (action === 'create_user') {
    const { email, password, username, role, daily_limit } = body;
    if (!email || !password || !username || !role) {
      return json({ error: 'Thiếu thông tin bắt buộc' }, 400);
    }
    const validRoles = ['free', 'vip', 'pro', 'ultra'];
    if (!validRoles.includes(role)) {
      return json({ error: 'Role không hợp lệ' }, 400);
    }

    const createRes = await sb(`/auth/v1/admin/users`, {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (!createRes.ok) {
      const err = await createRes.json();
      return json({ error: err.msg || err.message || 'Tạo tài khoản thất bại' }, 400);
    }
    const created = await createRes.json();
    const newId   = created.user?.id || created.id;

    // Tạo profile
    await sb(`/rest/v1/profiles`, {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        id: newId,
        username,
        role,
        daily_limit: parseInt(daily_limit) || 5,
        is_active: true,
        custom_main_model: '',
        custom_judge_model: ''
      })
    });

    return json({ success: true });
  }

  // ── ACTION: toggle_active ────────────────────────────────────────
  if (action === 'toggle_active') {
    const { targetUserId, is_active } = body;
    if (!targetUserId) return json({ error: 'Thiếu targetUserId' }, 400);
    if (targetUserId === userId) {
      return json({ error: 'Không thể vô hiệu hóa chính mình' }, 400);
    }
    await sb(`/rest/v1/profiles?id=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ is_active, updated_at: new Date().toISOString() })
    });
    return json({ success: true });
  }

  // ── ACTION: update_user ──────────────────────────────────────────
  if (action === 'update_user') {
    const { targetUserId, role, daily_limit, username } = body;
    if (!targetUserId) return json({ error: 'Thiếu targetUserId' }, 400);
    const update = { updated_at: new Date().toISOString() };
    if (role !== undefined)        update.role        = role;
    if (daily_limit !== undefined) update.daily_limit = parseInt(daily_limit);
    if (username !== undefined)    update.username    = username;
    await sb(`/rest/v1/profiles?id=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(update)
    });
    return json({ success: true });
  }

  // ── ACTION: change_password ──────────────────────────────────────
  if (action === 'change_password') {
    const { targetUserId, newPassword } = body;
    if (!targetUserId || !newPassword) {
      return json({ error: 'Thiếu thông tin' }, 400);
    }
    if (newPassword.length < 6) {
      return json({ error: 'Mật khẩu phải ít nhất 6 ký tự' }, 400);
    }
    const r = await sb(`/auth/v1/admin/users/${targetUserId}`, {
      method: 'PUT',
      body: JSON.stringify({ password: newPassword })
    });
    if (!r.ok) {
      const err = await r.json();
      return json({ error: err.msg || err.message || 'Đổi mật khẩu thất bại' }, 400);
    }
    return json({ success: true });
  }

  // ── ACTION: delete_user ──────────────────────────────────────────
  if (action === 'delete_user') {
    const { targetUserId } = body;
    if (!targetUserId) return json({ error: 'Thiếu targetUserId' }, 400);
    if (targetUserId === userId) {
      return json({ error: 'Không thể xóa chính mình' }, 400);
    }

    // Xóa dữ liệu theo thứ tự (FK safe)
    await sb(`/rest/v1/daily_usage?user_id=eq.${targetUserId}`, {
      method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
    });
    await sb(`/rest/v1/cases?user_id=eq.${targetUserId}`, {
      method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
    });
    await sb(`/rest/v1/profiles?id=eq.${targetUserId}`, {
      method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
    });
    // Xóa auth user (cuối cùng)
    const delRes = await sb(`/auth/v1/admin/users/${targetUserId}`, { method: 'DELETE' });
    if (!delRes.ok && delRes.status !== 404) {
      const err = await delRes.json();
      return json({ error: err.msg || 'Xóa tài khoản thất bại' }, 400);
    }

    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}


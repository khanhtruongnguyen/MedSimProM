# Migration Complete Part 2 — Maintenance & Next Steps

## 📋 Maintenance Checklist

### Immediate (week 1)
- [ ] Monitor Cloudflare Workers Logs for errors
  - Dashboard → Workers & Pages → medsim-api → Logs
  - Filter: `path = /api/ai-call`
  - Expect: `[ai-call] model="gpt-4" type=main role=admin source=env`

- [ ] Disable Netlify auto-deploy (optional)
  - app.netlify.com → Site → Deploys → Disable auto-deploy
  - Lý do: Tránh deploy thừa khi push GitHub (không cần Netlify nữa)

- [ ] Cleanup old tokens (if suspected leak)
  - GitHub: Settings → Developer settings → Personal access tokens
  - Netlify: User settings → Applications → Authorized apps
  - Supabase: Settings → API → Rotate service_role key (cẩn thận)

### Optional (month 1)
- [ ] Custom domain cho Worker (thay `.workers.dev`)
  - Cloudflare Dashboard → Workers & Pages → medsim-api → Settings → Domains & Routes
  - Thêm domain (vd: `api.tenmien.com`) → CNAME record → Worker route
  - Update `index.html`: `const API_BASE = 'https://api.tenmien.com'`

- [ ] Set up monitoring/alerting
  - Cloudflare Workers → Analytics → Requests, Errors, Latency
  - Optional: PagerDuty/Opsgenie cho critical errors

- [ ] Review daily limits
  - Supabase: `profiles.daily_limit` column
  - Adjust nếu user tăng/giảm

---

## 🔧 Troubleshooting Quick Reference

### Lỗi 404 `/api/ai-call`
**Nguyên nhân:** Worker URL sai hoặc index.html chưa update API_BASE

**Fix:**
1. Check `https://medsim-api.medsim.workers.dev/api/ai-call` → phải trả 401
2. Check `index.html` có `const API_BASE = '...'` không
3. Check 5 chỗ fetch đã dùng `${API_BASE}/api/...` chưa

### Lỗi CORS
**Nguyên nhân:** GitHub Pages domain ≠ Worker domain, Supabase chưa allow

**Fix:**
1. Supabase Dashboard → Authentication → URL Configuration
2. Site URL: `https://khanhtruongnguyen.github.io`
3. Redirect URLs: `https://khanhtruongnguyen.github.io/*`
4. Save

### Lỗi 401 Unauthorized
**Nguyên nhân:** Auth token sai hoặc expired

**Fix:**
1. Check browser DevTools → Application → Local Storage → `supabase.auth.token`
2. Token có `access_token` không?
3. Token hết hạn → login lại

### Lỗi Model not available
**Nguyên nhân:** `AI_MAIN_MODEL` / `AI_JUDGE_MODEL` sai hoặc provider không support

**Fix:**
1. Cloudflare Dashboard → Workers & Pages → Settings → Variables
2. Check `AI_MAIN_MODEL` (vd: `gpt-4o-mini`)
3. Check `AI_JUDGE_MODEL` (vd: `gpt-4o`)
4. Save → redeploy worker

### Worker Logs không thấy
**Nguyên nhân:** Free plan chỉ log 10 phút gần nhất

**Fix:**
1. Cloudflare Dashboard → Workers & Pages → medsim-api → Tail Workers
2. Enable (free: 10 GB data transfer)
3. Logs giữ 3 ngày

---

## 📚 Documentation

- **Migration Guide:** `docs/cloudflare-migration.md` (411 lines)
  - Architecture diagram
  - Step-by-step instructions
  - Troubleshooting
  - Rollback plan
  - Cost comparison

- **HANDOFF.md:** Section 0 (current status)
  - Production URLs
  - Maintenance checklist
  - Rollback plan

- **Code Comments:** Inline comments trong `worker/*.js`
  - Logic flow
  - Env vars needed
  - Error handling

---

## 🎯 Next Steps (User Choice)

### Option A: Ngừng tại đây (Recommended)
App đã chạy ổn định trên Cloudflare. Không cần làm gì thêm.

**Ưu điểm:**
- Đã migrate xong, test OK
- Free tier đủ dùng (100k requests/ngày)
- Không cần maintain thêm

**Nhược điểm:**
- URL `.workers.dev` có username (khanhtruongnguyen)
- Netlify account vẫn active (có thể quên)

---

### Option B: Cleanup & Optimize (1-2 giờ)
Làm các bước "Maintenance Checklist" ở trên.

**Ưu điểm:**
- Disable Netlify (tránh deploy thừa)
- Cleanup tokens (bảo mật)
- Optional: custom domain (chuyên nghiệp)

**Nhược điểm:**
- Tốn thời gian
- Cần thao tác trên nhiều dashboards

---

### Option C: Production Ready (4-6 giờ)
Full production setup với monitoring, alerting, custom domain, backup strategy.

**Ưu điểm:**
- Professional deployment
- Alert khi có lỗi
- Custom domain (api.tenmien.com)

**Nhược điểm:**
- Tốn thời gian nhất
- Cần domain (mua ~200k/năm)
- Cần cấu hình monitoring service

---

## 💡 Khuyến nghị

**Chọn Option A** nếu:
- App cá nhân / nhóm nhỏ (< 50 users)
- Không cần domain chuyên nghiệp
- Không muốn maintain thêm

**Chọn Option B** nếu:
- Muốn cleanup Netlify account
- Muốn bảo mật tokens
- Có domain sẵn (không cần mua mới)

**Chọn Option C** nếu:
- App production thật (users thật, paid)
- Cần monitoring/alerting
- Cần domain chuyên nghiệp

---

## 📞 Support

**Nếu gặp lỗi:**
1. Check `HANDOFF.md` Section 0 (Troubleshooting)
2. Check `docs/cloudflare-migration.md` (chi tiết hơn)
3. Check Cloudflare Workers Logs
4. Paste error message → debug

**Resources:**
- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/
- Wrangler CLI: https://developers.cloudflare.com/workers/wrangler/
- GitHub Pages: https://docs.github.com/en/pages
- Supabase Auth: https://supabase.com/docs/guides/auth

---

**Ngày migration:** 10/02/2026  
**Thời gian hoàn thành:** ~2 giờ (code + deploy + test)  
**Trạng thái:** ✅ Production Ready  
**Maintenance:** Low (free tier, không cần monitor sát)
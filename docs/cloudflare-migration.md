# H??ng d?n migrate sang Cloudflare

**Ng?y:** 10/02/2026  
**Tr?ng th?i:** Code ?? port xong, ch? user thao t?c tay.

---

## Ki?n tr?c m?i

```
???????????????????????????
?   GitHub Pages (CDN)    ? ? index.html (static, free unlimited deploy)
?   khanhtruongnguyen.    ?
?   github.io/MedSimProM  ?
???????????????????????????
           ? fetch('/api/ai-call', ...)
           ? fetch('/api/admin', ...)
           ?
???????????????????????????
?  Cloudflare Worker      ? ? worker/index.js (router)
?  api.yourdomain.com/*   ?    + worker/ai-call.js
?  (free: 100k req/ng?y)  ?    + worker/admin.js
???????????????????????????
           ? fetch(supabase REST)
           ?
???????????????????????????
?       Supabase          ?
???????????????????????????
```

**?u ?i?m:**
- GitHub Pages: unlimited deploy, kh?ng gi?i h?n credits
- Cloudflare Workers free: 100k request/ng?y (?? cho app c? nh?n/nh?m nh?)
- Code client gi? nguy?n `/api/ai-call` ? kh?ng s?a `index.html`
- Worker logs v?n xem ???c trong Cloudflare Dashboard ? Workers & Pages ? Logs

---

## C?c file ?? t?o

| File | M?c ??ch |
|---|---|
| `worker/index.js` | Router: dispatch `/api/ai-call` v? `/api/admin` |
| `worker/ai-call.js` | Port 1:1 t? `netlify/functions/ai-call.js` |
| `worker/admin.js` | Port 1:1 t? `netlify/functions/admin.js` |
| `functions/api/[[path]].js` | Pages Functions (backup n?u b?n ch?n Pages to?n b?) |
| `wrangler.toml` | C?u h?nh Worker (t?n, routes, compat date) |
| `.github/workflows/deploy-pages.yml` | GitHub Actions ? GitHub Pages |

**Logic gi? nguy?n 100%:**
- Auth: `Authorization: Bearer <supabase_token>` ? `/auth/v1/user`
- Profile: `profiles` table ? role, daily_limit, custom models
- Daily limit: check + increment `daily_usage`
- Model selection: personal (admin/ultra) ? group (pro/vip/free) ? env fallback
- G?i AI: `${AI_API_BASE_URL}/chat/completions`
- ?n model name: ch? tr? `choices`, `usage`, `_usage` (kh?ng c? `model`)

**Kh?c bi?t k? thu?t:**
- Netlify: `exports.handler = async (event) => ({ statusCode, headers, body })`
- Cloudflare: `export default { async fetch(request, env, ctx) => Response }`
- `event.body` (string) ? `await request.json()`
- `event.headers.authorization` ? `request.headers.get('Authorization')`
- `process.env` ? `env` (wrangler.toml vars ho?c dashboard secrets)
- `console.log` v?n ho?t ??ng ? xem trong Workers & Pages ? Logs

---

## B??C 1: T?o Cloudflare account (n?u ch?a c?)

1. V?o **https://dash.cloudflare.com/sign-up**
2. ??ng k? b?ng email + password
3. Verify email
4. Ho?n t?t setup wizard

**Th?i gian:** 2 ph?t

---

## B??C 2: Deploy Worker

### C?ch A: D?ng Wrangler CLI (khuy?n ngh?)

C?i Node.js: https://nodejs.org (LTS)

```powershell
# T? folder project
npm install -g wrangler
wrangler login  # m? browser, authorize

# Set secrets (m?i l?nh s? h?i paste value)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put AI_API_KEY
wrangler secret put AI_API_BASE_URL
wrangler secret put AI_MAIN_MODEL
wrangler secret put AI_JUDGE_MODEL

# Deploy
wrangler deploy
```

**Gi? tr? secrets:**

```
SUPABASE_URL           = https://dpmynrjlmmpjujmpwzdp.supabase.co
SUPABASE_SERVICE_KEY    = [paste t? Netlify env vars ho?c Supabase Dashboard ? Settings ? API]
AI_API_KEY              = [paste t? Netlify env vars]
AI_API_BASE_URL         = [paste t? Netlify env vars]
AI_MAIN_MODEL           = [v? d?: gpt-4o-mini]
AI_JUDGE_MODEL          = [v? d?: gpt-4o]
```

**L?y secrets t? Netlify Dashboard:**
1. V?o https://app.netlify.com ? site ? Site configuration ? Environment variables
2. Copy t?ng gi? tr?

**L?y secrets t? Supabase (n?u kh?ng c?n Netlify):**
1. V?o https://supabase.com/dashboard ? ch?n project ? Settings ? API
2. `Project URL` ? `SUPABASE_URL`
3. `service_role` key ? `SUPABASE_SERVICE_KEY` (?? gi? b? m?t)

---

### C?ch B: D?ng Dashboard (kh?ng c?n CLI)

1. V?o **https://dash.cloudflare.com** ? **Workers & Pages** ? **Create** ? **Create Worker**
2. ??t t?n: `medsim-api`
3. Nh?n **Deploy** (skeleton tr??c)
4. V?o **Settings** ? **Variables and Secrets** ? **Add**
   - T?n: `SUPABASE_URL`, Lo?i: **Secret**, Value: paste
   - L?p l?i cho c?c secrets c?n l?i
5. V?o **Settings** ? **Triggers** ? **Routes** ? **Add route**
   - Route: `api/*` (ho?c `api.yourdomain.com/*` n?u c? custom domain)
   - Zone: ch?n zone c?a b?n (ho?c `*.workers.dev` subdomain)
6. Quay l?i **Code** ? paste n?i dung 3 file t? `worker/` (g?p ho?c d?ng module syntax n?u bi?t)
   - ?? Dashboard editor kh?ng support multi-module ? c?n g?p th?nh 1 file ho?c d?ng c?ch A

**Khuy?n ngh?:** D?ng c?ch A (Wrangler CLI) ?? maintain ???c multi-file.

---

## B??C 3: B?t GitHub Pages + set repo variable

### 3.1 B?t GitHub Pages

1. V?o https://github.com/khanhtruongnguyen/MedSimProM
2. **Settings** ? **Pages**
3. **Source:** Deploy from a branch
4. **Branch:** `main` / `/ (root)`
5. **Save**

**GitHub Actions s? t? ch?y** (do `.github/workflows/deploy-pages.yml`)

Ki?m tra: **Actions** tab ? th?y workflow "Deploy to GitHub Pages" ch?y th?nh c?ng

**URL:** `https://khanhtruongnguyen.github.io/MedSimProM/`

---

### 3.2 Set repo variable `CF_WORKER_URL`

**M?c ??ch:** GitHub Pages c?n bi?t Worker URL ?? g?i API.

**N?u d?ng Workers.dev subdomain:**

1. V?o Cloudflare Dashboard ? Workers & Pages ? `medsim-api` ? **Settings** ? **Domains & Routes**
2. Copy URL (v? d?: `https://medsim-api.khanhtruongnguyen.workers.dev`)
3. V?o GitHub repo ? **Settings** ? **Secrets and variables** ? **Actions**
4. **Variables** tab ? **New repository variable**
   - Name: `CF_WORKER_URL`
   - Value: `https://medsim-api.khanhtruongnguyen.workers.dev`
5. **Add variable**

**N?u d?ng custom domain (khuy?n ngh? cho production):**

1. Th?m domain v?o Cloudflare (v? d?: `api.khanhtruongnguyen.me`)
2. Setup CNAME record ? Worker route
3. Set `CF_WORKER_URL` = `https://api.khanhtruongnguyen.me`

---

### 3.3 Update `index.html` (CH? N?U c?n)

**M?c ??nh:** `fetch('/api/ai-call', ...)` ? relative path ? c?ng origin v?i GitHub Pages ? **404** (v? Pages kh?ng c? API).

**C?ch fix:** Th?m ? ??u `<script>` trong `index.html`:

```javascript
// Cloudflare Worker API base URL
const API_BASE = 'https://medsim-api.khanhtruongnguyen.workers.dev';
```

R?i s?a 5 ch? g?i API:

```javascript
// Tr??c
fetch('/api/ai-call', ...)

// Sau
fetch(`${API_BASE}/api/ai-call`, ...)
```

**?? L?u ?:**
- N?u Worker d?ng route `api.yourdomain.com/*` ? ??i th?nh `fetch('https://api.yourdomain.com/ai-call', ...)`
- N?u GitHub Pages deploy c?ng domain v?i Worker (kh?ng khuy?n ngh?) ? kh?ng c?n s?a

**C?ch kh?c (kh?ng s?a code):** D?ng Cloudflare Pages thay v? GitHub Pages (xem m?c cu?i).

---

## B??C 4: Update Supabase CORS (n?u c?n)

**N?u GitHub Pages domain kh?c Worker domain** ? c?n th?m v?o Supabase allowlist.

1. V?o Supabase Dashboard ? Authentication ? URL Configuration
2. **Site URL:** `https://khanhtruongnguyen.github.io`
3. **Redirect URLs:** Th?m `https://khanhtruongnguyen.github.io/*`
4. **Save**

**N?u d?ng custom domain:**
- Site URL: `https://medsimpro.yourdomain.com`
- Redirect URLs: `https://medsimpro.yourdomain.com/*`

---

## Ki?m tra sau migrate

### 1. Test Worker

```powershell
# Kh?ng auth ? expect 401
curl -X POST https://medsim-api.khanhtruongnguyen.workers.dev/api/ai-call

# V?i auth (l?y token t? browser DevTools ? Application ? Local Storage ? supabase.auth.token)
curl -X POST https://medsim-api.khanhtruongnguyen.workers.dev/api/ai-call `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <access_token>" `
  -d '{"messages":[{"role":"user","content":"test"}],"modelType":"main"}'
```

**Expect:** JSON v?i `choices`, `usage`, `_usage` (kh?ng c? `model`)

### 2. Test GitHub Pages

M? `https://khanhtruongnguyen.github.io/MedSimProM/` ? ??ng nh?p ? t?o ca

**Expect:** ca ???c generate (ki?m tra Worker Logs)

### 3. Xem Worker Logs

Cloudflare Dashboard ? Workers & Pages ? `medsim-api` ? **Logs**

**Filter:** `path = /api/ai-call`

**Expect:** d?ng `[ai-call] model="..." type=main role=admin source=env`


---

## C?ch kh?c: Cloudflare Pages to?n b? (frontend + API)

N?u mu?n **m?t domain duy nh?t** (kh?ng c?n s?a `index.html`):

### B??c 1: ??i workflow

S?a `.github/workflows/deploy-pages.yml` ? thay b?ng `cloudflare/pages deploy`:

```yaml
# .github/workflows/deploy-pages.yml (thay th?)
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name=medsim-pro
```

### B??c 2: T?o Cloudflare Pages project

1. Cloudflare Dashboard ? Workers & Pages ? Create ? Pages
2. Name: `medsim-pro`
3. **Settings** ? **Build & deployment**
   - **Build command:** ?? tr?ng
   - **Build output directory:** `/` (root)
4. **Settings** ? **Environment variables** ? th?m secrets (gi?ng Worker)
5. **Settings** ? **Functions**
   - Cloudflare s? t? detect folder `functions/` ? ch?y `functions/api/[[path]].js`

### B??c 3: Set GitHub secrets

GitHub repo ? Settings ? Secrets and variables ? Actions:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**?u ?i?m:**
- Kh?ng c?n s?a `index.html`
- C?ng domain ? kh?ng c?n CORS config
- Unlimited deploy (Pages kh?ng t?nh credits)

**Nh??c ?i?m:**
- C?n t?ch code (hi?n t?i ?? c? s?n `functions/api/[[path]].js`)
- Pages Functions free: 500k request/th?ng (??)

---

## Rollback v? Netlify (n?u c? v?n ??)

```powershell
# 1. Disable GitHub Pages
GitHub repo ? Settings ? Pages ? Source: None

# 2. Re-enable Netlify
app.netlify.com ? site ? Deploys ? Trigger deploy

# 3. X?a Worker (t?y ch?n)
wrangler delete medsim-api
```

**Client kh?ng c?n s?a g?** (c?ng endpoint `/api/ai-call`).

---

## Troubleshooting

### L?i 404 `/api/ai-call` tr?n GitHub Pages

**Nguy?n nh?n:** Pages kh?ng c? API ? Worker URL ch?a config.

**Fix:** Xem B??c 3.3 ? s?a `index.html` th?m `API_BASE`.

### L?i CORS

**Nguy?n nh?n:** Worker domain kh?c GitHub Pages domain.

**Fix:**
1. Worker ? Settings ? CORS ? th?m origin `https://khanhtruongnguyen.github.io`
2. Ho?c d?ng Cloudflare Pages (c?ng domain)

### L?i 401 Unauthorized

**Nguy?n nh?n:** `SUPABASE_URL` sai project.

**Fix:** Ki?m tra `index.html` d?ng 635 vs Worker secrets ? c?ng project URL.

### L?i Model kh?ng kh? d?ng

**Nguy?n nh?n:** `AI_MAIN_MODEL` / `AI_JUDGE_MODEL` sai ho?c provider kh?ng support.

**Fix:** 
1. Worker Logs ? xem error
2. Cloudflare Dashboard ? Workers & Pages ? Settings ? Variables ? s?a model name

### Worker Logs kh?ng th?y

**Nguy?n nh?n:** Free plan ch? log 10 ph?t g?n nh?t.

**Fix:** Cloudflare Dashboard ? Workers & Pages ? `medsim-api` ? **Tail Workers** ? **Enable** (free: 10 GB data transfer)

---

## So s?nh chi ph?

| Platform | Free tier | Deploy limit |
|---|---|---|
| **Netlify Free** | 300 credits/th?ng | 1 production deploy = 15 credits ? **~20 deploy/th?ng** |
| **GitHub Pages** | Unlimited | Unlimited (soft limit: 1k builds/hour) |
| **Cloudflare Workers Free** | 100k request/ng?y | Unlimited deploy |
| **Cloudflare Pages Free** | 500k functions request/th?ng | Unlimited deploy |

**T?ng free:** GitHub Pages (frontend) + CF Workers (API) = **unlimited deploy + 100k API req/ng?y**

---

## Checklist ho?n th?nh

- [ ] T?o Cloudflare account
- [ ] Deploy Worker + set 6 secrets
- [ ] Test Worker v?i curl
- [ ] B?t GitHub Pages
- [ ] Set repo variable `CF_WORKER_URL`
- [ ] S?a `index.html` th?m `API_BASE` (n?u c?n)
- [ ] Update Supabase CORS (n?u c?n)
- [ ] Test end-to-end: ??ng nh?p ? t?o ca ? ch?m ?i?m
- [ ] Xem Worker Logs x?c nh?n `[ai-call] model=...`
- [ ] Disable Netlify deploy (t?y ch?n)
- [ ] C?p nh?t HANDOFF.md

---

## Li?n h? / H? tr?

- **Cloudflare Docs:** https://developers.cloudflare.com/workers/
- **Wrangler CLI:** https://developers.cloudflare.com/workers/wrangler/
- **GitHub Pages:** https://docs.github.com/en/pages
- **Supabase Auth:** https://supabase.com/docs/guides/auth

---

**N?u g?p l?i ? b??c n?o ? paste error message + screenshot ? m?nh s? debug ti?p.**

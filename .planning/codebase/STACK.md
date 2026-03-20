# Technology Stack

**Analysis Date:** 2026-03-20

## Languages

**Primary:**
- JavaScript (ES2022+) - All frontend and backend code
- SQL (PostgreSQL dialect) - Database schema and migrations

**Secondary:**
- HTML5 - `index.html` (single-page application markup)
- CSS3 - `style.css` (all styling, no preprocessor)
- Python - `import_bonus.py`, `read_excel.py`, `read_excel2.py`, `read_excel3.py` (data import utilities, not part of production runtime)

## Runtime

**Environment:**
- Node.js (no version pinned — no `.nvmrc` or `.node-version` file detected)
- Executed on two separate platforms: Vercel (serverless) and Render.com (persistent Express server)

**Package Manager:**
- npm
- Root lockfile: `package-lock.json` (present)
- Render-proxy lockfile: not detected (only `package.json` in `render-proxy/`)

## Frameworks

**Core:**
- Express 4.18+ - HTTP server for `render-proxy/index.js` on Render.com
- None on frontend — Vanilla JS SPA, no React/Vue/Angular

**Testing:**
- Not detected — no test runner configuration found

**Build/Dev:**
- No build step — frontend is served as static files directly via Vercel
- No Webpack, Vite, or bundler detected

## Key Dependencies

**Critical:**
- `@supabase/supabase-js ^2.0.0` - Database client used in both root (`package.json`) and `render-proxy/package.json`; loaded client-side via CDN (`cdn.jsdelivr.net/npm/@supabase/supabase-js@2`)
- `express ^4.18.0` - HTTP framework for the Render proxy only (`render-proxy/package.json`)

**CDN-loaded (frontend, no local install):**
- `@supabase/supabase-js@2` via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js` — loaded in `index.html` line 652

## Configuration

**Environment (set on Vercel and Render — never committed):**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (admin ops, user creation/deletion)
- `COC_API_TOKEN` - Clash of Clans API bearer token (used only in `render-proxy/index.js`)
- `RENDER_PROXY_URL` - URL of the Render Express proxy (used by Vercel serverless functions)
- `SYNC_SECRET` - Shared secret for inter-service auth between Vercel and Render
- `CRON_SECRET` - Secret for Vercel cron job authentication (used in `api/purge-ex-players.js`)
- `RESEND_API_KEY` - Optional: Resend email API key for welcome emails (used in `api/register-with-coc.js`)
- `PORT` - Render proxy listen port (defaults to 3000)

**Client-side config (committed, not secret):**
- `supabase-config.js` — hardcodes Supabase project URL and anon key, creates `window.sb` client with `persistSession: false`

**Build:**
- `vercel.json` — defines cron schedules (no routing/rewrite rules detected, purely cron config)

## Platform Requirements

**Development:**
- Node.js + npm to install and run `render-proxy/`
- Python 3 + openpyxl/pandas (inferred) to run bonus import scripts
- Supabase project with schema applied from `schema*.sql` files
- Environment variables configured on both platforms

**Production:**
- Vercel (Hobby plan) — hosts static frontend + serverless API functions in `api/`; limit of 12 functions enforced (see commit log `fdc7225`)
- Render.com — hosts `render-proxy/index.js` as a persistent Express server with a fixed IP (required for CoC API IP whitelist)
- Supabase — PostgreSQL database (project ID: `ubgpohirljxmnamuzuqi`)

---

*Stack analysis: 2026-03-20*

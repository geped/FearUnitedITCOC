# Technology Stack

**Analysis Date:** 2026-03-20 (aggiornato post-fix criticità)

---

## Languages

**Primary:**
- JavaScript (ES2022+) - All frontend and backend code
- SQL (PostgreSQL dialect) - Database schema and migrations

**Secondary:**
- HTML5 - `index.html` (single-page application markup)
- CSS3 - `style.css` (all styling, no preprocessor)
- Python - `import_bonus.py`, `read_excel.py` (data import utilities, non parte del runtime di produzione)

## Runtime

**Environment:**
- Node.js (no version pinned — no `.nvmrc` or `.node-version` file)
- Eseguito su due piattaforme: Vercel (serverless) e Render.com (persistent Express)

**Package Manager:**
- npm
- Root `package.json`: `@supabase/supabase-js ^2.0.0` + script `test`
- `render-proxy/package.json`: `express`, `@supabase/supabase-js`, `node-fetch`

## Frameworks

**Core:**
- Express 4.18+ - HTTP server per `render-proxy/index.js` su Render.com
- None su frontend — Vanilla JS SPA, no React/Vue/Angular

**Testing:**
- Node.js built-in `node:test` + `node:assert/strict`
- Script: `npm test` → `node --test tests/*.test.js`
- 11 test unitari (6 bonus-calculator + 5 purge-logic)

**Build/Dev:**
- No build step — frontend servito come file statici su Vercel
- No Webpack, Vite, o bundler

## Key Dependencies

**Critical:**
- `@supabase/supabase-js ^2.0.0` - Database client usato in root e `render-proxy/`; caricato lato client via CDN (`cdn.jsdelivr.net/npm/@supabase/supabase-js@2`)
- `express ^4.18.0` - HTTP framework solo per il proxy Render

**CDN-loaded (frontend, no local install):**
- `@supabase/supabase-js@2` via CDN in `index.html`

**Rimosso:**
- Firebase / Firestore — completamente rimosso (file, config, dipendenze)

## Configuration

**Environment (su Vercel e Render — mai committate):**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key — usata da render-proxy per scrivere (bypassa RLS) e da Vercel per admin ops
- `COC_API_TOKEN` - Clash of Clans API bearer token (solo in `render-proxy/index.js`)
- `RENDER_PROXY_URL` - URL del proxy Render (usato dalle Vercel functions)
- `SYNC_SECRET` - Segreto condiviso per auth inter-servizio: Vercel ↔ Render + script Python
- `CRON_SECRET` - Segreto per cron Vercel (usato in `api/purge-ex-players.js`)
- `RESEND_API_KEY` - Opzionale: Resend API key per email di benvenuto
- `PORT` - Render proxy listen port (default: 3000)

**Client-side config (committata, non segreta):**
- `supabase-config.js` — hardcoda Supabase URL e anon key, crea `window.sb`

**Build:**
- `vercel.json` — define 3 cron schedules:
  - `0 6 * * *` → `/api/sync-members`
  - `0 7 1 * *` → `/api/purge-ex-players`
  - `0 20 * * *` → `/api/auto-save-wars`

## Platform Requirements

**Development:**
- Node.js + npm per installare e avviare `render-proxy/`
- Python 3 + openpyxl per gli script di import bonus
- Supabase project con schema applicato da `schema-MASTER.sql`
- Variabili d'ambiente configurate su entrambe le piattaforme

**Production:**
- Vercel (Hobby plan) — static frontend + serverless API functions in `api/`
  - **Limite: 12 functions** — attualmente 12/12 (incluso `admin/users.js`)
  - Cron jobs: solo frequenza giornaliera (min `0 H * * *`) su Hobby plan
- Render.com (piano gratuito) — `render-proxy/index.js` come persistent Express server
  - IP fisso richiesto per whitelist CoC API
  - Cold start ~30s dopo 15min di inattività
  - Warm-up: endpoint `/health` + ping giornaliero da `sync-members`
- Supabase — PostgreSQL database (project: `ubgpohirljxmnamuzuqi`)

---

*Stack analysis: 2026-03-20 — aggiornato post-fix 16 criticità*

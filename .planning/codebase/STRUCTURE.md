# Codebase Structure

**Analysis Date:** 2026-03-20 (aggiornato post-fix criticità)

---

## Directory Layout

```
FearUnitedCoC/                  # Project root
├── index.html                  # SPA shell — all HTML markup (742 lines)
├── app.js                      # All frontend logic (4650 lines)
├── style.css                   # All styles (3224 lines)
├── supabase-config.js          # Supabase client init — sets window.sb
├── vercel.json                 # Vercel cron job definitions (3 cron jobs)
├── package.json                # @supabase/supabase-js + script test
│
├── api/                        # Vercel serverless functions (12/12 — limite Hobby)
│   ├── _utils/                 # Moduli condivisi (NON contano nel limite 12)
│   │   ├── proxy-client.js     # proxyFetch(res, path, params) — helper comune
│   │   └── require-role.js     # requireRole(req, roles) — auth JWT middleware
│   ├── admin/
│   │   └── users.js            # CRUD utenti — verifica ruolo 'admin' via JWT
│   ├── sync-members.js         # Cron: daily member sync 6:00 UTC (delega a proxy)
│   ├── auto-save-wars.js       # Cron: daily war auto-save 20:00 UTC (delega a proxy)
│   ├── purge-ex-players.js     # Cron: monthly ex-member cleanup 7:00 UTC del 1°
│   ├── clan-info.js            # Proxy forwarder: clan info
│   ├── clan-members.js         # Proxy forwarder: live member list
│   ├── cwl-stats.js            # Proxy forwarder: CWL live stats
│   ├── war-log.js              # Proxy forwarder: war log
│   ├── lookup.js               # Proxy forwarder: player lookup, clan search, rankings
│   ├── generate-bonuses.js     # Bonus calculation (legge cwl_history) + Supabase upsert
│   ├── import-bonus.js         # Excel bonus import (richiede header x-sync-key)
│   └── register-with-coc.js   # User registration via CoC in-game API key
│
├── render-proxy/
│   └── index.js                # Express server on Render.com (631 lines)
│                               # Holds COC_API_TOKEN + SUPABASE_SERVICE_ROLE_KEY
│                               # Makes all CoC API calls + writes to Supabase
│
├── tests/                      # Node.js built-in test runner
│   ├── bonus-calculator.test.js  # 6 test — calculateMerit() formula
│   └── purge-logic.test.js       # 5 test — shouldPurge() logic
│
├── th/                         # Town Hall level icons
│   └── webp/                   # TH levels 1–18 .webp (usare percorso webp/)
│
├── leagues/                    # CWL league badge images
│                               # Named by league: BronzoI.png, ArgentoIII.png, etc.
│
├── schema-MASTER.sql           # Schema unificato — ordine di applicazione corretto
├── schema.sql                  # Base schema (members, RLS policies)
├── schema-cwl.sql              # CWL history + seasons tables
├── schema-bonus.sql            # Bonus table
├── schema-classic-wars.sql     # Classic wars table
├── schema-league.sql           # League table
├── schema-multiclan.sql        # Multi-clan support schema
├── schema-retention.sql        # Retention/cleanup schema
├── schema-update.sql           # Schema migration patches
├── schema-security-rls.sql     # RLS: cwl_bonuses read-only per anon
└── schema-security-rls-v2.sql  # RLS: ripristina write anon su members (render-proxy)
```

---

## Directory Purposes

**`api/_utils/`:**
- Purpose: Moduli condivisi tra serverless functions — non espongono endpoints
- `proxy-client.js`: funzione `proxyFetch(res, path, params)` — gestisce RENDER_PROXY_URL, header x-sync-key, error handling. Usata da `clan-info`, `clan-members`, `cwl-stats`, `war-log`
- `require-role.js`: funzione `requireRole(req, allowedRoles)` — estrae JWT da header Authorization, verifica con Supabase Auth, controlla `user_metadata.role`. Usata da `admin/users` e `generate-bonuses`

**`api/`:**
- Purpose: Vercel serverless functions — one file per endpoint
- Contains: Node.js CommonJS modules, each exporting a single `async (req, res) => {}` handler
- Key files: `register-with-coc.js` (user onboarding), `lookup.js` (consolidated proxy forwarder), `admin/users.js` (admin CRUD con verifica ruolo)
- Pattern: Proxy forwarders usano `proxyFetch` da `_utils`; solo `generate-bonuses.js`, `import-bonus.js` e `register-with-coc.js` contengono logica di business

**`api/admin/`:**
- Purpose: Admin-only endpoints
- Access control: Verifica JWT + `user_metadata.role === 'admin'` via `requireRole(req, ['admin'])`

**`render-proxy/`:**
- Purpose: Persistent Express server on Render.com acting as trusted CoC API intermediary
- Contains: `index.js` con tutti i route handler e logica aggregazione dati
- Auth su Supabase: usa `SUPABASE_SERVICE_ROLE_KEY` per scrivere (bypassa RLS)
- Deploy: Separato da Vercel — push su git o deploy manuale dalla dashboard Render
- Auth proxy: Tutti i route protetti da `authMiddleware` che verifica header `x-sync-key`
- Warm-up: `GET /health` endpoint disponibile per evitare cold start

**`tests/`:**
- Purpose: Test unitari con Node.js built-in test runner
- Run: `npm test` (script in `package.json`)
- Filosofia: zero dipendenze — logica estratta per copia/testabilità

**`th/webp/`:**
- Purpose: Static TH level icon assets
- Naming: `level_NN.webp` per tutti i livelli (1–18+)
- I file precedenti in `th/` root sono stati rimossi

**`leagues/`:**
- Purpose: CWL war league badge images
- Naming: Italian league name concatenated (e.g., `BronzoI.png`, `CristalloIII.png`)
- Referenced by: `LEAGUE_BADGE_MAP` in `app.js`

**`schema*.sql`:**
- Purpose: Supabase SQL migration scripts — eseguiti manualmente nel Supabase SQL Editor
- Punto di partenza: usare `schema-MASTER.sql` per setup da zero
- Non applicati automaticamente

---

## Key File Locations

**Entry Points:**
- `index.html`: Browser entry — all HTML structure, loads scripts
- `app.js` line 32: App boot — `db.auth.onAuthStateChange()` è il punto di init reale
- `supabase-config.js`: Deve caricarsi prima di `app.js` — imposta `window.sb`

**Configuration:**
- `vercel.json`: Cron schedule definitions (3 cron jobs: sync-members, purge-ex-players, auto-save-wars)
- `render-proxy/index.js` line ~625: `const PORT = process.env.PORT || 3000`

**Core Logic:**
- `app.js` line ~383: `showApp()` — post-login initialization, role/clan setup
- `app.js` line ~478: `activateTab()` — tab navigation hub, triggers lazy data loads
- `app.js` line ~887: `loadAssignBonus()` — CWL bonus assignment entry point
- `app.js` line ~1885: `applyBonusCriteria()` — bonus score calculation (live data path)
- `api/generate-bonuses.js`: `calculateMerit()` — formula ufficiale bonus serverless
- `render-proxy/index.js` line 137: `getCwlStats()` — CWL data aggregation (all rounds, standings)
- `render-proxy/index.js` line 94: `syncMembers()` — member sync from CoC API to Supabase
- `render-proxy/index.js` line 29: `saveEndedWar()` — classic war detection and persistence

**Admin:**
- `api/admin/users.js`: GET/POST/PUT/DELETE su `auth.users` (richiede JWT admin)
- `app.js` line ~2221: `loadUsers()` — admin panel frontend

**Utilities:**
- `api/_utils/proxy-client.js`: `proxyFetch()` — usare per qualsiasi nuova function che parla con render-proxy
- `api/_utils/require-role.js`: `requireRole()` — usare per qualsiasi endpoint che richiede ruolo specifico

**Database Schemas:**
- `schema-MASTER.sql`: File unificato — usare questo per setup da zero
- `schema.sql`: Members table + RLS baseline
- `schema-cwl.sql`: `cwl_history` table con seed data
- `schema-classic-wars.sql`: `classic_wars` table

---

## Naming Conventions

**Files:**
- Serverless functions: `kebab-case.js` matching URL path (e.g., `sync-members.js` → `/api/sync-members`)
- Shared utilities: `api/_utils/kebab-case.js`
- Frontend: single flat files at root (`app.js`, `style.css`, `index.html`)
- SQL schemas: `schema-[feature].sql`

**Directories:**
- All lowercase, kebab-case for multi-word (`render-proxy/`, `api/admin/`, `api/_utils/`)

**Functions in `app.js`:**
- Load functions: `loadXxx()` — async, fetches data, calls render
- Render functions: `renderXxx()` — sync, builds DOM from data
- Open/Close modals: `openXxxModal()`, `closeXxxModal()`
- Switch tabs/views: `switchXxxTab(tab, btn)`

**HTML IDs:**
- Tab sections: `tab-{tabId}` (e.g., `tab-members`, `tab-cwl`)
- Navigation buttons: `data-tab="{tabId}"` attribute on `.tab-btn` e `.bnav-btn`

---

## Where to Add New Code

**New data-displaying tab:**
1. Add HTML section in `index.html` as `<section id="tab-{name}" class="tab-content">`
2. Add nav button in sidebar and bottom-nav with `data-tab="{name}"`
3. Add entry to `TAB_TITLES` object in `app.js`
4. Add `if (tabId === '{name}') loadXxx()` in `activateTab()` in `app.js`
5. Add `loadXxx()` and `renderXxx()` functions in `app.js` (append after existing sections)

**New Vercel API endpoint:**
1. **Verifica il limite 12 functions** — conta i file in `api/` (escludi `_utils/` e `admin/`)
2. Create `api/{endpoint-name}.js` exporting `async (req, res) => {}`
3. Se parla con CoC: usa `proxyFetch` da `api/_utils/proxy-client.js`
4. Se richiede auth: usa `requireRole` da `api/_utils/require-role.js`
5. Se è admin-only: crea in `api/admin/` e usa `requireRole(req, ['admin'])`

**New Render proxy route:**
1. Add `app.get()` o `app.post()` in `render-proxy/index.js` prima di `app.listen()`
2. Apply `authMiddleware` as second argument per tutti i route
3. Deploy separato su Render (non parte di `vercel deploy`)

**New cron job:**
1. Crea handler in `api/{job-name}.js` (attenzione limite 12 functions)
2. Aggiungi entry in `vercel.json` `crons` array
3. **Nota:** Vercel Hobby supporta solo cron giornalieri (frequenza minima: `0 H * * *`)

**New Supabase table:**
1. Scrivi SQL in un nuovo `schema-{feature}.sql`
2. Aggiungi al `schema-MASTER.sql` nell'ordine corretto
3. Esegui manualmente nel Supabase SQL Editor
4. RLS pattern: `FOR SELECT USING (auth.role() = 'authenticated')` — write solo via service role

**New shared API utility:**
1. Crea in `api/_utils/{name}.js`
2. Esporta con `module.exports = { functionName }`
3. Importa con `const { functionName } = require('./_utils/{name}')`

---

## Special Directories

**`.planning/`:**
- Purpose: GSD planning artifacts (phases, codebase maps, reports)
- Committed: Yes

**`.agent/`:**
- Purpose: GSD agent skill definitions and tooling
- Committed: Yes

**`scraper/`:**
- Purpose: One-off asset scraping scripts — non parte del runtime

**`report/`:**
- Purpose: Report generati (player stats, ecc.) — non parte del runtime

---

*Structure analysis: 2026-03-20 — aggiornato post-fix 16 criticità*

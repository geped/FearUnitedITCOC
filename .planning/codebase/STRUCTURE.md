# Codebase Structure

**Analysis Date:** 2026-03-20

## Directory Layout

```
FearUnitedCoC/                  # Project root
├── index.html                  # SPA shell — all HTML markup (742 lines)
├── app.js                      # All frontend logic (4597 lines)
├── style.css                   # All styles (3224 lines)
├── supabase-config.js          # Supabase client init — sets window.sb
├── firebase-config.js          # Legacy Firebase (do not use)
├── vercel.json                 # Vercel cron job definitions
├── package.json                # Minimal (only @vercel/node listed)
│
├── api/                        # Vercel serverless functions
│   ├── admin/
│   │   └── users.js            # CRUD utenti (requires SERVICE_ROLE_KEY)
│   ├── sync-members.js         # Cron: daily member sync (delegates to proxy)
│   ├── auto-save-wars.js       # Cron: daily war auto-save (delegates to proxy)
│   ├── purge-ex-players.js     # Cron: monthly ex-member cleanup
│   ├── clan-info.js            # Proxy forwarder: clan info
│   ├── clan-members.js         # Proxy forwarder: live member list
│   ├── cwl-stats.js            # Proxy forwarder: CWL live stats
│   ├── war-log.js              # Proxy forwarder: war log
│   ├── lookup.js               # Proxy forwarder: player lookup, clan search, rankings
│   ├── generate-bonuses.js     # Bonus calculation + Supabase upsert
│   ├── import-bonus.js         # Excel bonus import
│   └── register-with-coc.js   # User registration via CoC in-game API key
│
├── render-proxy/
│   └── index.js                # Express server on Render.com (625 lines)
│                               # Holds COC_API_TOKEN, makes all CoC API calls
│
├── th/                         # Town Hall level icons
│   ├── level_01.webp           # TH levels 1–18 are .webp
│   ├── ...
│   ├── level_18.webp
│   ├── level_19.png            # TH levels 19–20 are .png
│   ├── level_20.png
│   └── webp/                   # Alternative webp copies
│
├── leagues/                    # CWL league badge images
│                               # Named by league: BronzoI.png, ArgentoIII.png, etc.
│
├── schema.sql                  # Base schema
├── schema-cwl.sql              # CWL history + seasons tables
├── schema-bonus.sql            # Bonus table
├── schema-classic-wars.sql     # Classic wars table
├── schema-league.sql           # League table
├── schema-multiclan.sql        # Multi-clan support schema
├── schema-retention.sql        # Retention/cleanup schema
└── schema-update.sql           # Schema migration patches
```

## Directory Purposes

**`api/`:**
- Purpose: Vercel serverless functions — one file per endpoint
- Contains: Node.js CommonJS modules, each exporting a single `async (req, res) => {}` handler
- Key files: `register-with-coc.js` (user onboarding), `lookup.js` (consolidated proxy forwarder), `admin/users.js` (admin CRUD)
- Pattern: Most functions are thin forwarders to `RENDER_PROXY_URL`; only `generate-bonuses.js`, `import-bonus.js`, and `register-with-coc.js` contain real business logic

**`api/admin/`:**
- Purpose: Admin-only endpoints requiring `SUPABASE_SERVICE_ROLE_KEY`
- Contains: `users.js` — full CRUD on `auth.users` via Supabase admin API
- Access control: Caller must be `isAdmin` (enforced in `app.js` before calling, but service key check is server-side)

**`render-proxy/`:**
- Purpose: Persistent Express server on Render.com acting as trusted CoC API intermediary
- Contains: `index.js` with all route handlers and business logic for data aggregation
- Deploy: Separate deployment from Vercel — changes require `render` deploy, not `vercel deploy`
- Auth: All routes protected by `authMiddleware` checking `x-sync-key` header

**`th/`:**
- Purpose: Static TH level icon assets served directly by Vercel CDN
- Naming: `level_NN.webp` for levels 1–18, `level_NN.png` for 19–20
- Referenced by: `thImgSrc(level)` in `app.js` line 524

**`leagues/`:**
- Purpose: CWL war league badge images
- Naming: Italian league name concatenated (e.g., `BronzoI.png`, `CristalloIII.png`, `LeggendaV2.png`)
- Referenced by: `LEAGUE_BADGE_MAP` in `app.js` line 249

**`schema*.sql`:**
- Purpose: Supabase SQL migration scripts — run manually in Supabase SQL Editor
- Not applied automatically — no migration runner is configured

## Key File Locations

**Entry Points:**
- `index.html`: Browser entry — all HTML structure, loads scripts
- `app.js` line 32: App boot — `db.auth.onAuthStateChange()` is the real initialization point
- `supabase-config.js`: Must load before `app.js` — sets `window.sb`

**Configuration:**
- `vercel.json`: Cron schedule definitions (no routing config — all routes are file-based)
- `render-proxy/index.js` line 623: `const PORT = process.env.PORT || 3000`

**Core Logic:**
- `app.js` line 383: `showApp()` — post-login initialization, role/clan setup
- `app.js` line 478: `activateTab()` — tab navigation hub, triggers lazy data loads
- `app.js` line 887: `loadAssignBonus()` — CWL bonus assignment entry point
- `app.js` line 1885: `applyBonusCriteria()` — bonus score calculation (live data path)
- `render-proxy/index.js` line 137: `getCwlStats()` — CWL data aggregation (all rounds, standings)
- `render-proxy/index.js` line 94: `syncMembers()` — member sync from CoC API to Supabase
- `render-proxy/index.js` line 29: `saveEndedWar()` — classic war detection and persistence
- `api/register-with-coc.js`: Full registration flow with CoC token verification

**Admin:**
- `api/admin/users.js`: GET/POST/PUT/DELETE on `auth.users`
- `app.js` line 2221: `loadUsers()` — admin panel frontend

**Database Schemas:**
- `schema.sql`: Members table baseline
- `schema-cwl.sql`: `cwl_history` table with seed data
- `schema-classic-wars.sql`: `classic_wars` table
- `schema-multiclan.sql`: Multi-clan support additions to `members`

## Naming Conventions

**Files:**
- Serverless functions: `kebab-case.js` matching the URL path (e.g., `sync-members.js` → `/api/sync-members`)
- Frontend: single flat files at root (`app.js`, `style.css`, `index.html`)
- SQL schemas: `schema-[feature].sql`

**Directories:**
- All lowercase, kebab-case for multi-word (`render-proxy/`, `api/admin/`)

**Functions in `app.js`:**
- Load functions: `loadXxx()` — async, fetches data, calls render
- Render functions: `renderXxx()` — sync, builds DOM from data
- Open/Close modals: `openXxxModal()`, `closeXxxModal()`
- Switch tabs/views: `switchXxxTab(tab, btn)`
- Private helpers: `_xxxHelper()` — underscore prefix for internal use

**HTML IDs:**
- Tab sections: `tab-{tabId}` (e.g., `tab-members`, `tab-cwl`)
- Navigation buttons: `data-tab="{tabId}"` attribute on `.tab-btn` and `.bnav-btn`
- Dynamic clan name elements: class `clan-name-dyn`

**CSS Classes:**
- Role badges: `role-leader`, `role-coleader`, `role-elder`, `role-member`
- Admin-gated elements: class `admin-only`
- Badge containers: `badge`, `badge-gold`

## Where to Add New Code

**New data-displaying tab:**
1. Add HTML section in `index.html` as `<section id="tab-{name}" class="tab-content">`
2. Add nav button in sidebar and bottom-nav with `data-tab="{name}"`
3. Add entry to `TAB_TITLES` object in `app.js` line 469
4. Add `if (tabId === '{name}') loadXxx()` in `activateTab()` in `app.js` line 478
5. Add `loadXxx()` and `renderXxx()` functions in `app.js` (append after existing sections)

**New Vercel API endpoint:**
1. Create `api/{endpoint-name}.js` exporting `async (req, res) => {}`
2. If it needs CoC data: forward to `RENDER_PROXY_URL/{route}` with `x-sync-key` header
3. If it needs admin access: create in `api/admin/` and use `SUPABASE_SERVICE_ROLE_KEY`
4. No entry in `vercel.json` needed — Vercel auto-detects files in `api/`

**New Render proxy route:**
1. Add `app.get()` or `app.post()` in `render-proxy/index.js` before the `app.listen()` call
2. Apply `authMiddleware` as second argument for all routes
3. Deploy separately to Render (not part of `vercel deploy`)

**New cron job:**
1. Create the handler in `api/{job-name}.js`
2. Add entry to `vercel.json` `crons` array with `path` and `schedule`

**New Supabase table:**
1. Write SQL in a new `schema-{feature}.sql` file
2. Apply manually in Supabase SQL Editor
3. Add RLS policies — pattern: `FOR SELECT USING (auth.role() = 'authenticated')`

**Utilities and helpers:**
- Shared frontend helpers: add as named functions in `app.js` near the relevant section
- No shared modules between API functions — each `api/*.js` is self-contained

## Special Directories

**`.planning/`:**
- Purpose: GSD planning artifacts (phases, codebase maps, reports)
- Generated: Partially (by GSD tooling)
- Committed: Yes

**`.agent/`:**
- Purpose: GSD agent skill definitions and tooling
- Generated: Yes (GSD framework)
- Committed: Yes

**`node_modules/`:**
- Purpose: Root-level dependencies (minimal — mostly `@supabase/supabase-js` for API functions)
- Generated: Yes
- Committed: No

**`functions/`:**
- Purpose: Legacy Firebase Cloud Functions (migration to Supabase complete)
- Generated: No
- Committed: Yes — but do not add new logic here

**`scraper/`:**
- Purpose: One-off asset scraping scripts (CoC building images)
- Generated: No — not part of the application runtime

**`report/`:**
- Purpose: Generated reports (player stats, etc.) — not part of app runtime
- Generated: Yes

---

*Structure analysis: 2026-03-20*

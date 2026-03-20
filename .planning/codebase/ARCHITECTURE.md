# Architecture

**Analysis Date:** 2026-03-20

## Pattern Overview

**Overall:** Multi-tier web application with a monolithic SPA frontend, thin serverless middleware layer, and a dedicated backend proxy

**Key Characteristics:**
- Single-page application: all UI state and logic lives in one file (`app.js`, 4597 lines)
- Three deployment tiers: Vercel (static frontend + serverless functions), Render.com (Express proxy), Supabase (database + auth)
- The render-proxy is mandatory: the CoC API blocks direct browser calls (CORS + IP whitelisting), so all game data flows through Render first
- Authentication is entirely delegated to Supabase Auth; roles and clan metadata are stored as `user_metadata` on the JWT

## Layers

**Frontend (Presentation + Application Logic):**
- Purpose: Renders all UI, manages tab navigation, calls Vercel APIs, reads Supabase directly for data queries
- Location: `index.html`, `app.js`, `style.css`
- Contains: DOM manipulation, auth flow, tab routing, data rendering, bonus calculation logic
- Depends on: Supabase JS SDK (via `window.sb`), Vercel `/api/*` endpoints, Render proxy (indirectly)
- Used by: End users in browser

**Serverless API Layer (Vercel Functions):**
- Purpose: Thin adapter layer — authenticates requests, forwards to Render proxy or writes directly to Supabase
- Location: `api/*.js`, `api/admin/users.js`
- Contains: Proxy forwarding logic, bonus calculation, admin CRUD, registration with CoC token verification
- Depends on: `RENDER_PROXY_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET`
- Used by: Frontend (`app.js`) and Vercel cron jobs

**Backend Proxy (Render.com Express):**
- Purpose: Single trusted server that holds the CoC API token and makes all game API calls from a fixed IP whitelisted by CoC
- Location: `render-proxy/index.js`
- Contains: CoC API integration, member sync logic, war saving logic, CWL stats aggregation
- Depends on: `COC_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYNC_SECRET`
- Used by: Vercel serverless functions only (never called directly from browser)

**Database Layer (Supabase/PostgreSQL):**
- Purpose: Persistent storage for members, CWL bonuses, history, and auth
- Location: Supabase cloud — schema in `schema*.sql` files
- Contains: `members`, `cwl_bonuses`, `cwl_history`, `player_aliases`, `classic_wars`, `cwl_seasons`
- Depends on: Nothing (source of truth)
- Used by: Both frontend (direct read via anon key + RLS) and Render proxy (write via anon key)

## Data Flow

**User Login:**
1. User enters username or CoC tag in `index.html` login form
2. `app.js` → `resolveLoginEmail()` converts to internal email (`tag@cocboard.internal`)
3. `db.auth.signInWithPassword()` calls Supabase Auth directly from browser
4. `onAuthStateChange` fires → `showApp(user)` initializes clan metadata from `user_metadata`

**Clan Data Display (Members tab):**
1. `showApp()` sets `window._userClanTag` from `user.user_metadata.coc_clan_tag`
2. `loadMembers()` queries Supabase `members` table directly: `db.from("members").select("*").eq("clan_tag", ...)`
3. `renderMembers()` builds DOM cards with TH images from `th/` directory

**Live CoC API Data (CWL, War Log, etc.):**
1. `app.js` calls `/api/cwl-stats?clanTag=...` (Vercel function)
2. `api/cwl-stats.js` forwards to `RENDER_PROXY_URL/cwl-live?clanTag=...` with `x-sync-key` header
3. Render proxy fetches CoC API with bearer token, aggregates data, returns JSON
4. `app.js` receives result and renders via `renderCwlTable()` / `renderAssignContent()`

**Scheduled Member Sync (cron):**
1. Vercel cron fires daily at 06:00 UTC → `POST /api/sync-members`
2. `api/sync-members.js` calls `RENDER_PROXY_URL/sync` with sync key
3. Render proxy fetches CoC `/clans/{tag}/members` and upserts into Supabase `members`
4. Also calls `saveEndedWar()` to auto-persist concluded classic wars

**Auto War Save (cron):**
1. Vercel cron fires daily at 20:00 UTC → `POST /api/auto-save-wars`
2. `api/auto-save-wars.js` calls `RENDER_PROXY_URL/save-all-wars`
3. Render proxy queries distinct `clan_tag` values from `members`, then saves ended wars for each clan

**CWL Bonus Calculation:**
1. User triggers via UI → `applyBonusCriteria()` or `saveBonusFromModal()` in `app.js`
2. For live data: calls `/api/cwl-stats` → aggregates player stats, applies score formula
3. Score = `(stars × 100) + destruction% − (missed_attacks × 500)`, anti-duplicate: score=0 if received last month
4. Saves to Supabase `cwl_bonuses` (current) and `cwl_history` (historical)

**New User Registration:**
1. User fills CoC tag + in-game API key in signup form
2. `app.js` → `POST /api/register-with-coc`
3. Vercel function calls `RENDER_PROXY_URL/verify-player-token` (proxy holds CoC token)
4. Proxy verifies token against CoC API, returns player info
5. Vercel function creates Supabase Auth user with `user_metadata` (role, clanTag, clanName, etc.)

**State Management:**
- No framework state — mutable module-level globals in `app.js`:
  - `window._userClanTag`, `window._clanName`, `window._clanBadgeUrl` — set post-login in `showApp()`
  - `window._userRole`, `window._canEdit` — role-based feature flags
  - `window.sb` — Supabase client, initialized by `supabase-config.js`
- Favorites stored in `localStorage` under key `coc_favorites`
- Tab navigation via DOM show/hide (`.tab-content` sections)

## Key Abstractions

**Tab Navigation:**
- Purpose: Single-page section switching without routing library
- Implementation: `activateTab(tabId)` shows/hides `.tab-content` divs, triggers lazy data load
- Tabs: `members`, `warlog`, `cwl`, `profilo`, `cerca`, `rankings`, `admin`

**Clan Context (`clanQ()`):**
- Purpose: Injects `?clanTag=...` into all API calls, enabling multi-clan support
- Location: `app.js` line 9
- Used by all `loadXxx()` functions when fetching clan-specific data

**Role Hierarchy:**
- Roles in order: `utente` < `membro` < `anziano` < `co-capo` < `capo` < `admin`
- Stored in `user.user_metadata.role`
- `canEdit` = `['admin', 'capo', 'co-capo'].includes(role)` — gates bonus assignment UI
- `isAdmin` = `role === 'admin'` — gates `/api/admin/users` and Gestione Utenti tab

**Render Proxy Auth:**
- All calls to Render proxy require `x-sync-key` header matching `SYNC_SECRET` env var
- Checked by `authMiddleware()` in `render-proxy/index.js` line 333
- Vercel functions inject this key server-side — browser never sees `SYNC_SECRET`

**TH Image Resolution:**
- Purpose: Renders Town Hall level icons next to player names
- Functions: `thImg(level)`, `thImgV(level)`, `thImgSrc(level)` in `app.js` around line 524
- Files 1–18: `th/level_NN.webp`, files 19–20: `th/level_19.png`, `th/level_20.png`

## Entry Points

**Browser Entry:**
- Location: `index.html`
- Triggers: User navigates to domain
- Responsibilities: Loads CSS, Supabase CDN, `supabase-config.js`, `app.js`; provides all HTML markup for login screen, app shell, and all tab sections

**App Initialization:**
- Location: `app.js` line 32 — `db.auth.onAuthStateChange()`
- Triggers: Supabase session detection on page load
- Responsibilities: Routes to `showApp()` (authenticated) or `showLogin()` (unauthenticated)

**Cron Jobs (Vercel):**
- `POST /api/sync-members` — daily 06:00 UTC, member sync
- `POST /api/auto-save-wars` — daily 20:00 UTC, war auto-save
- `POST /api/purge-ex-players` — monthly 1st at 07:00 UTC, cleanup ex-members

## Error Handling

**Strategy:** Inline try/catch in every async function; errors displayed in UI via `showLoginError()` or inline status elements

**Patterns:**
- API errors: `res.status(5xx).json({ error: err.message })` in serverless functions
- Frontend: `catch(err)` → set `.textContent` on status/error DOM elements, or `console.error`
- Proxy errors: Returns `{ skipped: true, reason: '...' }` for non-fatal conditions (e.g., war not ended yet)
- Auth errors: Login fallback tries `@fearunited.internal` if `@cocboard.internal` fails (legacy support)

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` only — no structured logging framework

**Validation:** Input validation in serverless functions (missing params → 400); minimal validation in frontend before form submit

**Authentication:** Every Vercel function that touches sensitive data checks `SUPABASE_SERVICE_ROLE_KEY` is present; Render proxy checks `x-sync-key`; Supabase RLS enforces `auth.role() = 'authenticated'` on all tables

**Localization:** Italian UI throughout; EN→IT translation maps for CoC league names in both `app.js` and `render-proxy/index.js`

---

*Architecture analysis: 2026-03-20*

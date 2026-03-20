# External Integrations

**Analysis Date:** 2026-03-20

## APIs & External Services

**Clash of Clans API:**
- Service: Clash of Clans REST API v1 (`https://api.clashofclans.com/v1`)
- Purpose: Fetch clan members, war log, CWL data, player info, player token verification, global rankings
- SDK/Client: Native `fetch()` — no SDK, raw HTTP calls
- Auth: `Authorization: Bearer <COC_API_TOKEN>` header
- Constraint: Requires IP whitelisting — calls made exclusively from `render-proxy/index.js` on Render.com (fixed IP); Vercel functions CANNOT call the CoC API directly due to CORS + dynamic IPs
- Endpoints used:
  - `GET /clans/{tag}` — clan info
  - `GET /clans/{tag}/members` — member list
  - `GET /clans/{tag}/currentwar` — current war state
  - `GET /clans/{tag}/currentwar/leaguegroup` — CWL group
  - `GET /clans/{tag}/warlog` — war log (up to 100 results)
  - `GET /clanwarleagues/wars/{warTag}` — individual CWL war
  - `GET /players/{tag}` — player info
  - `POST /players/{tag}/verifytoken` — verify in-game API key (used for registration)
  - `GET /locations/{id}/rankings/{type}` — global rankings (players, clans, builder base)

**Resend (email):**
- Service: `https://api.resend.com/emails`
- Purpose: Welcome email on registration (optional — only fires if `RESEND_API_KEY` is set and user provides a real email)
- SDK/Client: Native `fetch()` — raw HTTP POST
- Auth: `Authorization: Bearer <RESEND_API_KEY>`
- Implementation: `api/register-with-coc.js` lines 100-128
- Note: Email failure is non-blocking — registration succeeds even if email fails

**ipify:**
- Service: `https://api.ipify.org?format=json`
- Purpose: Debug endpoint `/myip` on the Render proxy to verify the outbound IP (used to confirm IP whitelisting for CoC API)
- Implementation: `render-proxy/index.js` line 347

## Data Storage

**Databases:**
- Provider: Supabase (PostgreSQL), project `ubgpohirljxmnamuzuqi`
- Connection (client-side): Supabase anon key, `window.sb` client initialized in `supabase-config.js`
- Connection (server-side): `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` in most serverless functions; `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` in admin operations (`api/admin/users.js`, `api/register-with-coc.js`, `api/purge-ex-players.js`)
- ORM/Client: `@supabase/supabase-js ^2.0.0` (JS SDK)

**Tables (from schema files):**
- `members` — current roster, PK: `tag`; columns: `tag, name, role, first_seen, th_level, trophies, donations, donations_received, exp_level, clan_rank, league_name, league_icon_url, clan_tag, clan_name`; schema: `schema.sql`, `schema-league.sql`, `schema-multiclan.sql`
- `cwl_bonuses` — current bonus ranking snapshot, PK: `tag`; columns: `tag, name, score, rank, assigned_at, received_last_month, clan_tag`; schema: `schema.sql`, `schema-multiclan.sql`
- `cwl_history` — per-season CWL performance, unique: `(player_name, season, clan_tag)`; columns: `id, player_name, season, participated, stars, destruction, attacks_made, attacks_required, bonus_score, still_in_clan, is_secondary, clan_tag, bonus_assigned`; schema: `schema-cwl.sql`, `schema-bonus.sql`, `schema-multiclan.sql`
- `cwl_seasons` — aggregated CWL season results per clan, unique: `(season, clan_tag)`; columns: `season, league, position, stars, destruction, clan_tag`; schema: created inline in `render-proxy/index.js` via upsert
- `classic_wars` — classic war history with full member/attack JSON, unique: `(clan_tag, end_time)`; columns include `our_members JSONB, opp_members JSONB`; schema: `schema-classic-wars.sql`
- `player_aliases` — player name alias mapping (referenced in CLAUDE.md; no schema file found in root)

**Row-Level Security:**
- All tables have RLS enabled
- `members` and `cwl_bonuses` allow both `anon` and `authenticated` roles (permissive, no restriction)
- `cwl_history` restricts to `authenticated` role only
- `classic_wars` allows all roles for SELECT and INSERT (no authentication check on policies)

**File Storage:**
- Local static files only — `th/` (Town Hall icons), `leagues/` (CWL league badges)
- No Supabase Storage or S3 detected

**Caching:**
- None detected at application level

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (built-in)
- Implementation: email+password login using synthetic internal emails
  - Legacy scheme: `username@fearunited.internal` (referenced in CLAUDE.md)
  - Current scheme: `{tag_without_hash_lowercase}@cocboard.internal` (used in `api/register-with-coc.js` line 68 and `api/admin/users.js` line 24)
  - Login accepts username or player tag, then constructs the internal email for Supabase sign-in
- Session: `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false` — no token persistence
- Roles stored in `user_metadata`: `role` field with values `utente < membro < anziano < co-capo < admin`
- Additional metadata: `username, coc_tag, coc_clan_tag, coc_clan_name, coc_clan_badge_url`
- Admin operations use `SUPABASE_SERVICE_ROLE_KEY` via `supabase.auth.admin.*` methods

**Registration flow:**
1. User provides CoC player tag + in-game API key + password
2. Vercel calls `render-proxy/verify-player-token` (POST) to validate in-game key via CoC API
3. Player info fetched from CoC API to derive username and clan role
4. Supabase user created via `auth.admin.createUser()` with synthetic email and role in metadata
5. Optional welcome email sent via Resend

## Monitoring & Observability

**Error Tracking:**
- None detected — no Sentry, Datadog, or similar

**Logs:**
- `console.error()` used for non-blocking errors (e.g., email failures in `api/register-with-coc.js`)
- No structured logging framework
- Vercel and Render platform logs available via their dashboards

## CI/CD & Deployment

**Hosting:**
- Frontend + serverless API: Vercel (Hobby plan, max 12 functions)
- Express proxy: Render.com (persistent Node.js service)
- Database: Supabase (managed PostgreSQL)

**CI Pipeline:**
- None detected — no GitHub Actions, CircleCI, or similar config files found

**Cron Jobs (configured in `vercel.json`):**
- `POST /api/sync-members` — daily at 06:00 UTC (sync clan members from CoC API)
- `POST /api/purge-ex-players` — monthly on 1st at 07:00 UTC (purge ex-player data older than 6 months)
- `POST /api/auto-save-wars` — daily at 20:00 UTC (auto-save ended classic wars)

## Environment Configuration

**Required env vars (Vercel):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RENDER_PROXY_URL`
- `SYNC_SECRET`
- `CRON_SECRET`

**Required env vars (Render.com):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `COC_API_TOKEN`
- `SYNC_SECRET`
- `PORT` (optional, defaults to 3000)

**Optional env vars:**
- `RESEND_API_KEY` (Vercel) — if absent, welcome emails are silently skipped

**Secrets location:**
- All secrets configured as platform environment variables (Vercel dashboard and Render dashboard)
- Never committed to repository

## Webhooks & Callbacks

**Incoming:**
- None detected — no webhook receivers

**Outgoing:**
- None detected — no webhook dispatch

## Legacy Integrations (Inactive)

**Firebase / Firestore:**
- Config: `firebase-config.js` — initializes Firebase app and Firestore as `window.firestore`
- Project: `fearunitedit` (Google project ID `496741338584`)
- Status: Fully superseded by Supabase. Do not add new logic here.
- Related files: `firebase.json`, `firestore.rules`, `functions/` directory

---

*Integration audit: 2026-03-20*

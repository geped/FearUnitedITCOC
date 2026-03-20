# Stack Research

**Domain:** CoCBoard v2.0 — UI/UX evolution of existing Clash of Clans clan dashboard
**Researched:** 2026-03-20
**Confidence:** MEDIUM-HIGH (CoC API endpoints MEDIUM via community wrappers; vanilla JS patterns HIGH; CDN sources MEDIUM)

---

## Recommended Stack

### Core Technologies

No new core technologies are needed. The existing stack is confirmed correct for v2.0.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vanilla JS (ES2022+) | — | All UI logic in `app.js` | Already in place; framework migration is explicitly out of scope; modern browser APIs (ES modules, fetch, optional chaining) provide everything needed |
| CoC API v1 | current | Player, clan, rankings, search data | Only official source of CoC data; all calls must go through render-proxy due to CORS + IP whitelist |
| render-proxy (Express on Render.com) | 4.18+ | Proxy all CoC API calls | Already in place; IP is whitelisted; adding new routes here costs nothing vs Vercel function count |
| Vercel serverless | — | Thin adapter layer over render-proxy | Already at 12/12 limit — no new functions can be added; new proxy routes go to render-proxy only |
| Supabase PostgreSQL | ^2.0.0 | Persistence (no changes for v2.0) | No new tables needed for v2.0 features |

### Supporting Libraries

No new npm dependencies needed. All additions are in-code (new JS objects/functions in `app.js` and new routes in `render-proxy/index.js`).

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| coc.guide CDN | — | Equipment and troop images | Already in use via `_unitCdnUrl()` at `https://coc.guide/static/imgs/{category}/{slug}.png`; extend `UNIT_COC_SLUG` map for missing items |
| CoC API `iconUrls` | — | League badges, clan crests in rankings | API responses include `badgeUrls.small` (clans) and `league.iconUrls.small` (players); use directly from API response, no local copy needed |

### Development Tools

No changes to development tools. Existing test runner (`node:test`) is sufficient.

---

## CoC API v1 Endpoints for v2.0 Features

### Global Leaderboards (HIGH priority fix)

**Root cause of the bug:** `app.js` uses `RANK_LOCATIONS = { global: '32000000', italy: '32000094' }`. The ID `32000000` is Europe (a continent), not the global leaderboard. The correct value for global rankings is the string `"global"`.

| Endpoint | Method | Parameters | Purpose |
|----------|--------|-----------|---------|
| `GET /locations/global/rankings/players` | GET | `limit` (default 200, max 200) | Top players globally by trophies |
| `GET /locations/global/rankings/clans` | GET | `limit` | Top clans globally by trophies |
| `GET /locations/global/rankings/players-builder-base` | GET | `limit` | Builder base global player rankings |
| `GET /locations/global/rankings/clans-builder-base` | GET | `limit` | Builder base global clan rankings |
| `GET /locations/{locationId}/rankings/players` | GET | `limit` | Country rankings (e.g., `32000094` for Italy) |
| `GET /locations/{locationId}/rankings/clans` | GET | `limit` | Country clan rankings |

**Required render-proxy change:** The `/rankings` route at line 620 of `render-proxy/index.js` already constructs the URL correctly as `…/locations/${encodeURIComponent(locationId)}/rankings/${encodeURIComponent(type)}` — so passing `locationId=global` from `app.js` (instead of `32000000`) will fix the bug. No render-proxy code change needed, only the `RANK_LOCATIONS` constant in `app.js`.

**Confidence:** MEDIUM — confirmed "global" string works via multiple CoC community wrappers (coc.py default, clashofclans.js docs); Supercell official API portal is JS-rendered and could not be directly fetched to verify.

### Advanced Clan Search Filters

**Current state:** `render-proxy/index.js` `/search-clans` route only passes `name` to `GET /v1/clans`. All other filter parameters are dropped.

**Available CoC API `/v1/clans` query parameters:**

| Parameter | Type | Notes |
|-----------|------|-------|
| `name` | string | Min 3 chars; required if no other filter |
| `minMembers` | integer | Min members in clan (1–50) |
| `maxMembers` | integer | Max members in clan (1–50) |
| `minClanPoints` | integer | Filter by minimum clan trophy points |
| `minClanLevel` | integer | Filter by minimum clan level |
| `warFrequency` | string | `always`, `moreThanOncePerWeek`, `oncePerWeek`, `lessThanOncePerWeek`, `never`, `unknown` |
| `locationId` | integer | Location ID from `/v1/locations`; Italy = `32000094` |
| `limit` | integer | Results to return (default 20, max 200 but practical limit ~50) |
| `after` | string | Cursor for pagination |
| `labelIds` | string | Comma-separated label IDs |

**Required change:** Extend `/search-clans` in render-proxy to accept and forward these parameters. Add `minTownhallLevel` is NOT a native CoC API parameter — client-side filtering of results is required for TH-based filtering.

**Confidence:** HIGH — confirmed across coc.py docs, clashofclans.js `ClanSearchOptions` interface, multiple PHP/Node wrappers.

### TownHall Level in Rankings

**Issue:** The `_renderRankPlayers()` function calls `thImgV(p.townHallLevel)` — but the CoC API `GET /locations/{id}/rankings/players` response includes `townHallLevel` as a field on each ranked player object. The bug is likely in the `thImgV()` helper or the TH image path, not the API endpoint.

**Verify:** Player ranking response shape: `{ rank, tag, name, trophies, attackWins, defenseWins, townHallLevel, clan: { tag, name, badgeUrls }, league: { id, name, iconUrls } }`.

---

## Asset Mapping for Hero Equipment

### Current Architecture

`app.js` contains `UNIT_COC_SLUG` — a JS object mapping equipment name (string) → `{c: category, s: slug}`. Images are served from `https://coc.guide/static/imgs/{c}/{s}.png`.

Function `_unitCdnUrl(name, category)` looks up the map; if not found, auto-generates a slug.

### Bug: Stick Horse Not in UNIT_COC_SLUG

`Stick Horse` is absent from both `UNIT_COC_SLUG` and `HERO_EQUIPMENT_MAP`. This causes it to:
1. Fall through to auto-slug as `stick-horse` (which may 404)
2. Not be grouped under Barbarian King in `_renderEquipmentGrouped()` — lands in `__altro__` group

**Fix:** Add to both maps. Confirmed it belongs to Barbarian King (community wiki). Slug to verify: `stick-horse` on coc.guide.

### Bug: Battle Drill Shows Wrong Image

`UNIT_COC_SLUG['Battle Drill']` maps to `{c:'troop', s:'battleram'}`. Battle Drill is a siege machine, not named "battleram" on coc.guide. The correct slug is likely `battle-drill`. The existing map has it at line 3640 in app.js.

### CDN Source Recommendation

**Use:** `https://coc.guide/static/imgs/{category}/{slug}.png`

This is already in use. `coc.guide` states all data is pulled directly from game files, making it the highest-quality community CDN. No license issues for non-commercial fan use.

**URL pattern examples:**
```
https://coc.guide/static/imgs/equipment/barbarian-puppet.png
https://coc.guide/static/imgs/equipment/stick-horse.png
https://coc.guide/static/imgs/hero/barbarian-king.png
https://coc.guide/static/imgs/troop/barbarian.png
```

**Confidence:** MEDIUM — URL pattern confirmed from existing working code in `app.js`. Specific slug for new equipment items (Stick Horse, correct Battle Drill slug) requires manual verification by loading the URL.

**Alternative CDN for clan/player badges:** CoC API responses embed absolute `badgeUrls.small` / `iconUrls.small` URLs pointing to Supercell's own CDN (`api.clashofclans.com` assets). Use those directly from API response for league badges and clan crests in rankings — no local copy needed.

---

## Vanilla JS Patterns for Shared State and Component Reuse

The codebase is a monolith (`app.js` 4650 lines). For v2.0, the right pattern is incremental enhancement within the monolith, not a rewrite.

### Pattern 1: Module-Level State Object (recommended)

For the "shared clan state" requirement (mio clan + cerca showing same data structure):

```javascript
// Single source of truth — defined once at module scope
const ClanView = {
  tag: null,
  data: null,
  activeTab: 'members', // 'members' | 'wars' | 'cwl'
  set(tag, data) { this.tag = tag; this.data = data; },
  reset() { this.tag = null; this.data = null; }
};
```

Both "Il mio clan" and "Cerca clan" read from the same `ClanView` object and call the same render functions. No event bus needed.

**Why:** app.js already uses module-level variables (`let _rankType`, `let _rankLocale`). This pattern is consistent with the existing codebase style.

### Pattern 2: Render Functions as Shared Components (already in use)

The existing `_renderRankPlayers()`, `_renderRankClans()`, `_renderEquipmentGrouped()` are already pure render functions that take a container ID + data. This is the right pattern for `WarDetailView`: a function `renderWarDetail(containerId, warData)` called from both classic war and CWL contexts.

```javascript
function renderWarDetail(containerId, warData) {
  // renders into #containerId regardless of caller
}
```

**Why:** No framework needed. DOM injection via `innerHTML` is fast enough for ~50-member war views.

### Pattern 3: Sub-tabs via CSS Class Toggle (already in use)

Tab switching is already done with `classList.toggle('active', ...)`. The same pattern works for war sub-tabs inside "Il mio clan":

```javascript
function switchClanTab(tabId) {
  ['members','wars','cwl'].forEach(t =>
    document.getElementById(`clan-tab-${t}`).classList.toggle('active', t === tabId)
  );
  document.getElementById('clan-section-members').style.display = tabId === 'members' ? '' : 'none';
  // etc.
}
```

**Why:** Zero dependencies, consistent with existing `switchTab()` in app.js.

### Anti-pattern to Avoid: Event Bus / Custom Events

An event bus (`CustomEvent`, `EventTarget`) would add indirection without benefit in a 4650-line monolith where all functions can call each other directly. Keep explicit function calls.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| String `"global"` for locationId | Numeric `32000000` | Never — 32000000 is Europe continent, not global |
| coc.guide CDN for equipment images | Local image copies | If coc.guide goes offline or changes URL structure; host copies as fallback |
| Client-side TH filter for search results | CoC API `minTownhallLevel` param | CoC API does not expose this parameter natively; client filtering of returned results is the only option |
| render-proxy new route parameters | New Vercel function | Vercel is at 12/12 limit; all new backend logic goes to render-proxy |
| Module-level state object | Observable/Redux pattern | Observable adds complexity for no benefit in a monolith; state is simple enough for direct reference |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New Vercel serverless functions | Already at 12/12 Hobby limit; adding one breaks deployment | Add routes to `render-proxy/index.js` instead |
| `32000000` as global locationId | This is the "Europe" continent location, not global leaderboard | Use string `"global"` |
| External image CDN not already in use | Adds dependency; coc.guide already works | Continue using `coc.guide/static/imgs/` |
| React/Vue/any framework | Explicitly out of scope per PROJECT.md; would require build step and rewrite | Vanilla JS patterns with module-level state |
| `iconUrls` from LEAGUE_BADGE_MAP fallback for new leagues | Map may be outdated | Prefer `league.iconUrls.small` direct from API response; local map as fallback only |

---

## Stack Patterns by Variant

**For global leaderboard fix:**
- Change `RANK_LOCATIONS.global` from `'32000000'` to `'global'` in `app.js`
- No render-proxy change needed (URL construction already uses `encodeURIComponent(locationId)`)

**For advanced clan search:**
- Add filter params to `/search-clans` handler in `render-proxy/index.js`
- Pass `minMembers`, `maxMembers`, `locationId`, `warFrequency`, `minClanLevel` to CoC API
- `minTownhallLevel` filter: apply client-side after receiving results

**For WarDetailView component:**
- Implement as `renderWarDetail(containerId, warData, options)` in `app.js`
- Call from both classic war and CWL war contexts with same signature
- No new API endpoints needed — war data already fetched

**For asset mapper (Stick Horse + Battle Drill fix):**
- Add missing entries to `UNIT_COC_SLUG` in `app.js`
- Add `'Stick Horse': 'Barbarian King'` to `HERO_EQUIPMENT_MAP`
- Verify exact coc.guide slugs by loading URLs in browser before committing

---

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| CoC API `"global"` locationId | All current endpoint types (players, clans, builder-base variants) | Confirmed by coc.py, clashofclans.js wrappers |
| `coc.guide/static/imgs/` | Current equipment names (as of March 2026) | Community CDN; no SLA; verify slugs manually for new equipment added after TH17 |
| Supabase JS ^2.0.0 | No changes needed for v2.0 | No new tables or queries |

---

## Sources

- [cocpy.readthedocs.io API Reference](https://cocpy.readthedocs.io/en/rewrite/api.html) — Location and rankings endpoints, clan search parameters (MEDIUM confidence)
- [clashofclans.js ClanSearchOptions](https://clashofclans.js.org/docs/api/interfaces/ClanSearchOptions) — Clan search parameter names (MEDIUM confidence)
- [Supercell CoC API forum thread on global rankings](https://forum.supercell.com/showthread.php/1210551-How-to-get-global-rankings-through-clash-of-clans-api) — Confirmed "global" string for locationId (MEDIUM confidence)
- [coc.guide](https://coc.guide/) — CDN source for troop/equipment images; URL pattern `coc.guide/static/imgs/{category}/{slug}.png` confirmed from existing `app.js` working code (HIGH confidence)
- [patterns.dev Observer Pattern](https://www.patterns.dev/vanilla/observer-pattern/) — Vanilla JS state patterns (HIGH confidence)
- `render-proxy/index.js` line 620 — Existing `/rankings` route URL construction (HIGH confidence, codebase)
- `app.js` lines 3641–3690 — Existing `UNIT_COC_SLUG` and `HERO_EQUIPMENT_MAP` (HIGH confidence, codebase)
- `app.js` lines 4558–4560 — `RANK_LOCATIONS` bug identified (`32000000` = Europe, not global) (HIGH confidence, codebase + web confirmation)

---

*Stack research for: CoCBoard v2.0 UI/UX Evolution*
*Researched: 2026-03-20*

# Feature Research

**Domain:** CoC Clan Dashboard — UI/UX Evolution (CoCBoard v2.0)
**Researched:** 2026-03-20
**Confidence:** MEDIUM-HIGH (CoC API structure verified via official JS library docs and community sources; hero equipment data cross-referenced with wiki and allclash.com; some API behaviors LOW confidence due to lack of direct API access)

---

## Domain Context

This is a subsequent milestone on an existing working app. All v1.0 features are shipped. The v2.0 scope is tightly bounded: fix bugs in hero equipment display, fix broken global leaderboards, restructure "Il mio clan" with sub-tabs and a WarDetailView component, add clan search filters, and introduce a centralized asset mapper. This is not greenfield — every feature has a concrete dependency on the existing 4650-line app.js monolith and the Vercel/Render/Supabase stack.

---

## A. Hero Equipment Categorization

### Confirmed Hero-to-Equipment Mapping (as of March 2026)

**Source confidence: HIGH** — cross-referenced with allclash.com 2026 guide, sportskeeda wiki entries, and the existing `HERO_EQUIPMENT_MAP` in app.js which was already annotated "Fonte: wiki ufficiale Supercell (marzo 2026)".

| Hero | Equipment Items (7 each except Dragon Duke) |
|------|---------------------------------------------|
| **Barbarian King** | Barbarian Puppet, Rage Vial, Earthquake Boots, Vampstache, Giant Gauntlet, Spiky Ball, Snake Bracelet |
| **Archer Queen** | Archer Puppet, Invisibility Vial, Giant Arrow, Healer Puppet, Frozen Arrow, Magic Mirror, Action Figure |
| **Grand Warden** | Eternal Tome, Life Gem, Rage Gem, Healing Tome, Fireball, Lavaloon Puppet, Heroic Torch |
| **Royal Champion** | Royal Gem, Seeking Shield, Hog Rider Puppet, Haste Vial, Rocket Spear, Electro Boots, Frost Flake |
| **Minion Prince** | Dark Orb, Henchmen Puppet, Metal Pants, Dark Crown, Meteor Staff, Noble Iron |
| **Dragon Duke** | Fire Heart, Flame Blower, Stun Blaster (3 items — added Feb 2026) |

**Stick Horse:** Belongs to the **Barbarian King**. It is his 8th epic equipment item, introduced in the "Wise Warriors" medal event starting February 9, 2026. It is NOT in "Altro" — it should appear under the Barbarian King group like all other BK equipment.

**Current bug:** `HERO_EQUIPMENT_MAP` in app.js (line ~3780) does NOT include "Stick Horse" → it falls through to the `__altro__` group. The map has 7 entries for BK but is missing this new item.

**API name for Stick Horse:** The CoC API returns hero equipment with the English name. Based on the sportskeeda article and standard CoC naming, the API name is `"Stick Horse"` (same as display name).

### Battle Drill Bug

`Battle Drill` is mapped in `UNIT_IMG_MAP` (line 3640) with `{c:'troop', s:'battleram'}`. This is wrong — `battleram` likely resolves to the Wall Wrecker or another siege machine image. The Battle Drill is a siege machine, not a troop (already correctly listed in `SIEGE_SET`), but the image slug `battleram` is incorrect. Correct slug should be `battle-drill`. **Confidence: MEDIUM** — coc.guide CDN path not directly verified.

---

## B. Global Leaderboard API Structure

### CoC API Endpoint Pattern

**Endpoint:** `GET /v1/locations/{locationId}/rankings/{type}`

**Valid types:** `players`, `clans`, `players-builder-base`, `clans-builder-base`

**Location IDs:**
| Location | ID | Notes |
|----------|----|-------|
| Global (worldwide) | `global` | String literal "global", not a number |
| Europe | `32000000` | This is a REGION, not global |
| Italy | `32000094` | Country-specific |

**Current bug in app.js (line 4560):**
```javascript
const RANK_LOCATIONS = { global: '32000000', italy: '32000094' };
```
`32000000` is Europe, not global. The correct value for worldwide rankings is the string `"global"`. This is the root cause of the `notFound` / empty data errors. **Confidence: HIGH** — confirmed via Supercell forum discussion and cocpy.readthedocs.io documentation which states `location_id` defaults to `'global'` for worldwide rankings.

### API Response Structure (players ranking)

```json
{
  "items": [
    {
      "tag": "#ABC123",
      "name": "PlayerName",
      "rank": 1,
      "previousRank": 2,
      "trophies": 8500,
      "townHallLevel": 17,
      "league": {
        "id": 29000022,
        "name": "Legend League",
        "iconUrls": { "small": "...", "medium": "...", "tiny": "..." }
      },
      "clan": {
        "tag": "#CLAN",
        "name": "ClanName",
        "badgeUrls": { "small": "...", "medium": "...", "large": "..." }
      }
    }
  ],
  "paging": { "cursors": { "after": "..." } }
}
```

### API Response Structure (clans ranking)

```json
{
  "items": [
    {
      "tag": "#CLAN",
      "name": "ClanName",
      "rank": 1,
      "previousRank": 1,
      "clanPoints": 55000,
      "members": 50,
      "clanLevel": 20,
      "location": { "id": 32000249, "name": "United States", "isCountry": true, "countryCode": "US" },
      "badgeUrls": { "small": "...", "medium": "...", "large": "..." }
    }
  ],
  "paging": { "cursors": { "after": "..." } }
}
```

**Key field for TH bug:** The player ranking response includes `townHallLevel` directly on each player object. The current `_renderRankPlayers` function uses `thImgV(p.townHallLevel)` — this should work once the correct location ID returns real data.

---

## C. WarDetailView — Classic War and CWL Patterns

### Classic War Detail (already partially implemented)

The existing `openCercaWarDetail()` function (line ~4360) already renders a modal war detail with: result badge, team sizes, badges, stars/destruction summary, and per-member attack table. This is the pattern to extract into a reusable `WarDetailView` component.

**Classic war attack structure (from CoC API):**
```
war.clan.members[] → {
  tag, name, townhallLevel,
  attacks: [{ attackerTag, defenderTag, stars, destructionPercentage, order, duration }],
  opponentAttacks: number
}
```

### CWL War Detail — 7 Rounds

CWL differs from classic war in these ways:

| Aspect | Classic War | CWL |
|--------|-------------|-----|
| Attacks per member | 2 | 1 |
| Rounds per season | 1 | 7 |
| Group size | 2 clans | 8 clans (32-clan bracket) |
| War result tracking | win/lose/draw per war | aggregate standings across 7 rounds |

**CWL data flow (existing in app.js):**
- `cwl-stats` endpoint → `getCwlStats()` → returns `roundsData[]` and `groupStandings[]`
- Each round entry in `roundsData` matches the structure of a classic war (same fields, `attacksPerMember: 1`)
- `window._cwlSeasonRoundsMap` stores rounds keyed by season string

**Expected CWL WarDetailView UI pattern** (based on REQUIREMENTS.md CLAN-04):
- Season header with month/year + league badge
- Group standings table (8 clans, ranks 1-8)
- Round selector (Round 1–7, showing which rounds are complete)
- Per-round: our clan vs opponent, stars, destruction, attacks detail
- Members who did not attack highlighted (missed attack = red row)

**Implementation note:** The `_renderCwlRoundDetail()` function (around line 3180+) already implements a version of this for the main clan. The work is making it reusable so "Cerca clan" can invoke the same component.

---

## D. Clan Search Filter Combinations

### CoC API `/v1/clans` Supported Filters

**Confirmed via clashofclans.js ClanSearchOptions interface (HIGH confidence):**

| Parameter | Type | Notes |
|-----------|------|-------|
| `name` | string | Min 3 chars; wildcard match anywhere in name |
| `minMembers` | number | 2–50 |
| `maxMembers` | number | 2–50 |
| `minClanPoints` | number | Trophy total |
| `minClanLevel` | number | Clan level 1–N |
| `locationId` | number | CoC location ID (country) |
| `type` | string | `"open"`, `"inviteOnly"`, `"closed"` |
| `warFrequency` | string | `"always"`, `"moreThanOncePerWeek"`, etc. |
| `labelIds` | string | Comma-separated label IDs |
| `limit` | number | Max results |

**Not supported by CoC API:** There is NO `minTownHallLevel` or `requiredTownHall` filter in the clan search endpoint. The `requiredTownHies` filter exists as a field on clan objects (returned in results) but is NOT a search filter. **Implication:** The REQUIREMENTS.md CERCA-01 mentions "TH minimo richiesto" as a filter — this must be implemented as **client-side post-filtering** on the returned results, not as a server-side parameter. **Confidence: HIGH** — no such parameter in any documented CoC API wrapper.

**Current render-proxy `/search-clans`** only passes `name` and `limit=20`. Filters require modifying both render-proxy (to accept and forward params) and the Vercel `lookup.js` endpoint (to pass them through). This is within scope since no new Vercel function is needed.

---

## E. Asset Mapper for CoC Images

### Current Pattern (app.js lines 3530–3690)

The `UNIT_IMG_MAP` object maps English unit names to `{c: category, s: slug}` pairs. The `_unitCdnUrl()` function resolves to `https://coc.guide/static/imgs/{category}/{slug}.png`. For unmapped units, it auto-generates a slug from the name.

**Known issues with the auto-generated approach:**
- `Battle Drill` → slug `battle-drill` but current map has wrong slug `battleram`
- `Stick Horse` → not in map at all, will auto-generate `stick-horse` (may or may not exist on CDN)
- Any new equipment added by Supercell post-August 2025 will auto-generate; CDN paths may differ

### Centralized Asset Mapper (ARCH-01)

The requirement is a single JS module/object where ALL troop/equipment → image path mappings live, and all rendering functions import from it. The current `UNIT_IMG_MAP` is close but:
1. It is defined inline in app.js, not importable
2. It mixes troops, spells, heroes, and equipment in one flat map
3. The fallback auto-generation is unreliable for CDN mismatches

**Recommended pattern:** A `ASSET_MAP` constant in app.js (or extracted to an inline `<script>` in index.html) that includes every known item with explicit verified CDN paths, plus a `getAssetUrl(name, category)` function that: (1) checks map, (2) falls back to slug auto-generation, (3) returns a local `/img/placeholder.png` if CDN image 404s (requires an `onerror` handler on `<img>` tags).

**Placeholder image:** The requirement EQUIP-03 wants a neutral icon placeholder. Use an SVG inline placeholder or a small local file in the project root (e.g., `/img/equipment-placeholder.svg`). No external CDN dependency for the placeholder.

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Hero equipment grouped by hero (no "Altro") | Any CoC dashboard shows equipment per hero, not uncategorized | LOW | Map fix + add Stick Horse entry |
| Correct equipment images (no broken/wrong images) | Visual correctness is table stakes | LOW | Fix Battle Drill slug, add onerror placeholder |
| Global leaderboard working | Rankings tab exists and is visible — users expect it to load | LOW | Single constant fix: `'32000000'` → `'global'` |
| TH level visible in leaderboards | TH level is a primary stat in CoC — "?" is clearly broken | LOW | Data is present in API response; rendering fix only |
| Clan crest in leaderboard rows | Every CoC community site shows clan badges | LOW | `badgeUrls.small` is in the API response |
| War Log accessible from clan view | War history is core clan management data | MEDIUM | Sub-tab restructure in existing UI |
| Clickable items in leaderboards open profiles | Standard navigation pattern in every CoC tracker | LOW | Wire onclick to existing `openCercaPlayer()`/`openCercaClan()` |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| WarDetailView — per-member attack table for CWL rounds | Most clan dashboards show only aggregate stats; per-attack detail helps admins evaluate participation | MEDIUM | Reuse existing `_renderCwlRoundDetail()` logic, extract to reusable component |
| Identical UI for "Cerca clan" and "Il mio clan" | Admin can evaluate any clan the same way they evaluate their own — useful for scouting and recruitment | MEDIUM | Shared state object + reuse of same rendering functions |
| Clan search with client-side TH filter | Rare in public CoC tools — useful for finding clans matching skill level | LOW-MEDIUM | Client-side filter on `requiredTrophies`; note API does not expose `requiredTownHallLevel` directly |
| Forced-refresh button on leaderboards | Avoids stale cached rankings — admins need current data | LOW | Pass `?nocache=1` to proxy or strip cache headers |
| Centralized asset mapper | Future-proofs image management — one place to update when Supercell adds equipment | MEDIUM | Architectural refactor, no user-visible feature until it prevents future breakage |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time leaderboard auto-refresh | "Always fresh data" feels better | Hammers CoC API, risks rate limiting, costs Render cold start wake-ups on every page view | Manual "Aggiorna" button with force-fresh header (CLAS-06) |
| Global search by player name | Players want to look up friends | CoC API has no name search endpoint for players — only by tag; fake implementation via clan scan would be unreliable and slow | Keep player lookup by tag only (already implemented in lookup.js) |
| TH filter as server-side API parameter | Cleaner, fewer results to filter | CoC API `/v1/clans` does NOT support TH-level filtering — there is no `minTownHallLevel` query param | Post-filter returned results client-side on `requiredTrophies` as proxy |
| Splitting app.js into modules | Better code organization | Zero build step constraint; dynamic `import()` in vanilla JS works but adds complexity for marginal gain at this scale | Incremental modularization only if a file clearly needs it; keep monolith for now |

---

## Feature Dependencies

```
ARCH-01 (asset mapper)
    └──enables──> EQUIP-03 (placeholder for missing images)
    └──enables──> EQUIP-04 (Battle Drill correct image)
    └──enables──> EQUIP-01 (Stick Horse under BK — needs mapper entry)

EQUIP-01 + EQUIP-02 (equipment grouping fix)
    └──requires──> HERO_EQUIPMENT_MAP fix (add Stick Horse, remove __altro__ fallback rendering)

CLAS-01 + CLAS-02 (global rankings working)
    └──requires──> locationId fix ('32000000' → 'global')
    └──enables──> CLAS-05 (TH column — data was always present, just no rows to show)
    └──enables──> CLAS-04 (clan crest — badgeUrls present in data, just no rows)

CLAN-01 + CLAN-02 (sub-tab restructure)
    └──requires──> ARCH-02 (shared global state for current clan)
    └──enables──> CLAN-03 (WarDetailView for classic wars — needs sub-tab to exist first)
    └──enables──> CLAN-04 (CWL round detail — needs sub-tab to exist first)

CERCA-02 + CERCA-03 (clan search UI identical to Il mio clan)
    └──requires──> CLAN-01 + CLAN-02 (sub-tab structure must exist to be reused)
    └──requires──> ARCH-02 (shared state — same render functions for any clan tag)
    └──requires──> CERCA-01 (filters — the enhanced search endpoint)

CERCA-01 (clan search filters)
    └──requires──> render-proxy `/search-clans` to accept and forward filter params
    └──requires──> lookup.js to pass filter params to proxy
    └──note──> NO new Vercel function needed (stays within 12-function limit)
```

### Dependency Notes

- **ARCH-01 is a foundation, not a blocker:** The asset mapper refactor improves all image paths but the equipment bug fixes (EQUIP-01–04) can be done with targeted map edits before full ARCH-01 is complete. ARCH-01 should be done in Phase 1 to avoid doing the map work twice.
- **CLAS-01/02 fix is one line:** The location ID constant change is the lowest-effort fix with the highest visibility impact. It unblocks CLAS-04, CLAS-05, CLAS-06, CLAS-07 at once.
- **CLAN and CERCA features form a chain:** The sub-tab restructure (Phase 3) must be stable before the WarDetailView (Phase 4) and before the Cerca advanced features (Phase 5) can be built on top.

---

## MVP Definition (for v2.0 milestone)

### Phase 1 — Launch With (Equipment & Asset Mapper)

- [x] EQUIP-01: Add `'Stick Horse': 'Barbarian King'` to `HERO_EQUIPMENT_MAP`
- [x] EQUIP-02: Remove rendering of `__altro__` group section
- [x] EQUIP-03: Add `onerror` handler on equipment `<img>` → swap to placeholder SVG
- [x] EQUIP-04: Fix Battle Drill slug in `UNIT_IMG_MAP` (`battleram` → `battle-drill`)
- [x] ARCH-01: Centralize all asset lookups through one `getAssetUrl()` function

### Phase 2 — Rankings Fixes

- [x] CLAS-01/02: Fix `RANK_LOCATIONS.global` to `'global'` (string, not `'32000000'`)
- [x] CLAS-03: Update league badge filenames to current versions
- [x] CLAS-04: Add `badgeUrls.small` img in clan ranking rows
- [x] CLAS-05: TH column auto-fixes once real data loads (data was always present)
- [x] CLAS-06: Add force-refresh button (pass `Cache-Control: no-cache` header or timestamp param)
- [x] CLAS-07: Wire onclick on player/clan rows to existing profile navigation

### Phase 3 — Clan Restructure

- [x] CLAN-01/02: Add sub-tab navigation (Membri / War Classiche / Cronologia CWL) inside "Il mio clan"
- [x] ARCH-02: Introduce `window._currentClanState = { tag, info, members, warLog, cwlHistory }` shared object

### Phase 4 — WarDetailView

- [x] CLAN-03: Reusable `renderWarDetail(war, container)` for classic wars
- [x] CLAN-04: Reusable `renderCwlSeasonDetail(season, roundsData, container)` for CWL with 7-round tabs

### Phase 5 — Advanced Clan Search

- [x] CERCA-01: Extend `/search-clans` to accept filter params; client-side TH post-filter
- [x] CERCA-02/03: Reuse sub-tab + WarDetailView for any searched clan

### Defer to v3.0

- [ ] IMP-01: Excel import UI — not needed for v2.0
- [ ] ROB-01: CWL bonus keyed by tag — schema migration, out of scope
- [ ] PERF-01/02: Performance optimizations — not blocking

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix Stick Horse under BK | MEDIUM | LOW (add one map entry) | P1 |
| Remove "Altro" section | MEDIUM | LOW (remove rendering branch) | P1 |
| Equipment placeholder on missing images | MEDIUM | LOW (onerror handler) | P1 |
| Fix Battle Drill image | LOW | LOW (fix one slug) | P1 |
| Centralized asset mapper (ARCH-01) | LOW (invisible to users) | MEDIUM | P1 (foundation) |
| Fix global rankings (CLAS-01/02) | HIGH | LOW (one constant) | P1 |
| Fix TH column (CLAS-05) | MEDIUM | NONE (auto-fixes with data) | P1 |
| Clan crest in rankings (CLAS-04) | MEDIUM | LOW | P2 |
| Updated league badges (CLAS-03) | LOW | LOW | P2 |
| Force-refresh button (CLAS-06) | MEDIUM | LOW | P2 |
| Clickable ranking rows (CLAS-07) | MEDIUM | LOW | P2 |
| Sub-tab restructure (CLAN-01/02) | HIGH | MEDIUM | P1 |
| Shared clan state (ARCH-02) | LOW (invisible) | LOW | P1 (enables CERCA) |
| WarDetailView classic (CLAN-03) | HIGH | MEDIUM | P2 |
| CWL round detail (CLAN-04) | HIGH | MEDIUM | P2 |
| Clan search filters (CERCA-01) | MEDIUM | MEDIUM | P2 |
| Cerca clan = Il mio clan (CERCA-02/03) | HIGH | MEDIUM | P2 |

**Priority key:**
- P1: Must have for v2.0 — fixes visible broken features or is foundational
- P2: Should have — new capability but builds on stable base
- P3: Nice to have — deferred to v3.0

---

## CoC-Specific Notes for Implementation

### Dragon Duke Equipment (added Feb 2026)

Dragon Duke is the 6th hero (added February 2026). He has 3 equipment items. The existing `HERO_ORDER_EQUIP` array already includes `'Dragon Duke'` at position 5. However, the rendering function only shows heroes that appear in the player's `heroEquipment` response data — if a player does not have Dragon Duke, his section will not appear. This is correct behavior.

### CWL 7-Round Structure — API Reality

- CWL always has exactly 7 rounds (battle days) for the standard league
- Each round contains one war per pair of clans in the group
- `attacksPerMember` is always `1` for CWL wars (verified in existing app.js data)
- The `groupStandings` array contains 8 clans ranked by stars, then destruction
- Missed attacks (player did not attack) appear as members with `attacks: []` in the war data

### Global vs Regional Leaderboards — API Behavior

- String `"global"` returns worldwide top 50 (default limit)
- Country IDs (e.g., `32000094` for Italy) return country-specific rankings
- `32000000` is Europe (a region, not global) — this is the confirmed bug
- Builder base rankings use separate types: `players-builder-base`, `clans-builder-base`

### Clan Search — What the API Does NOT Support

These filters do NOT exist as CoC API query parameters:
- `minTownHallLevel` / `requiredTownHallLevel`
- `language` (only `locationId` filters by country)
- Any text filter beyond `name`

The `requiredTrophies` field exists on returned clan objects and can be used for client-side filtering as a rough TH proxy.

---

## Sources

- [Hero Equipment — clashofclans.fandom.com (via search, direct access 403)](https://clashofclans.fandom.com/wiki/Hero_Equipment)
- [Stick Horse — sportskeeda.com (confirmed BK equipment, Feb 2026)](https://www.sportskeeda.com/mobile-games/clash-clans-stick-horse-equipment-ability-get)
- [Best Hero Equipment 2026 — allclash.com (hero groupings confirmed)](https://www.allclash.com/the-best-hero-abilities-equipment-for-each-hero-in-clash-of-clans/)
- [ClanSearchOptions — clashofclans.js official docs (filter parameters)](https://clashofclans.js.org/docs/api/interfaces/ClanSearchOptions)
- [API Reference — cocpy.readthedocs.io (location_id 'global' for worldwide)](https://cocpy.readthedocs.io/en/rewrite/api.html)
- [Global rankings forum thread — forum.supercell.com](https://forum.supercell.com/showthread.php/1210551-How-to-get-global-rankings-through-clash-of-clans-api)
- [CWL structure — clashofclans.fandom.com/wiki/Clan_War_Leagues](https://clashofclans.fandom.com/wiki/Clan_War_Leagues)
- Existing app.js codebase analysis (line references above are from direct code reading)

---

*Feature research for: CoCBoard v2.0 — CoC Clan Dashboard UI/UX Evolution*
*Researched: 2026-03-20*

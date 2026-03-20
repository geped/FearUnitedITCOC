# Project Research Summary

**Project:** CoCBoard v2.0 — UI/UX Evolution
**Domain:** Vanilla JS SPA — Clash of Clans Clan Dashboard
**Researched:** 2026-03-20
**Confidence:** HIGH (architecture/pitfalls from direct codebase inspection; features from cross-referenced CoC API docs; stack confirmed against existing working code)

## Executive Summary

CoCBoard v2.0 is a tightly scoped evolution of an existing, working clan management dashboard. This is not greenfield: the entire stack (Vanilla JS + Supabase + Vercel + Render.com proxy) stays unchanged. The scope is bounded to five interconnected areas: fix two known bugs (global leaderboard broken by wrong locationId, hero equipment "Stick Horse" in wrong category), restructure "Il mio clan" with sub-tabs and a reusable WarDetailView component, add advanced clan search filters, and centralize the asset mapper. All research confirms that these goals are achievable with additive changes to `app.js`, `index.html`, `render-proxy/index.js`, and `api/lookup.js` — no new files, no new dependencies, no new Vercel functions.

The recommended approach is to sequence work by dependency. Two bugs — the global rankings locationId constant and the Stick Horse equipment mapping — are each single-line fixes that unblock larger feature areas (rankings columns, equipment display) and should be addressed first. The asset mapper centralization (ARCH-01) is a low-user-impact but high-leverage architectural step that prevents duplicate fix effort later. The WarDetailView refactor is a prerequisite for making war data available in both "Il mio clan" and "Cerca clan" contexts. Advanced search filters come last because they depend on the sub-tab structure being stable.

The dominant risk is the Vercel Hobby plan's hard limit of 12 serverless functions, which is already at capacity. Any new file in `api/` breaks the deploy. A secondary risk is the global `.subtab-btn` CSS selector in `switchWarTab()`, which is document-wide and will silently corrupt the active state of other sub-tab groups when a new sub-tab set is added to "Il mio clan". Both risks have clear, low-cost mitigations identified in research and must be enforced as constraints at the start of execution, not addressed reactively.

---

## Key Findings

### Recommended Stack

No new technologies are needed. The existing stack is confirmed correct for v2.0. The Vercel function count is at 12/12, making `render-proxy/index.js` (Express on Render.com) the only valid destination for new backend routes. All new CoC API capabilities — search filter params, global rankings fix — route through the existing `api/lookup.js` → `render-proxy/index.js` chain without creating new files.

**Core technologies:**
- **Vanilla JS (ES2022+):** All UI logic in `app.js` monolith — framework migration is out of scope; modern browser APIs provide everything needed
- **render-proxy (Express on Render.com):** The only place new backend logic can go; already holds the CoC API token and whitelisted IP
- **Vercel serverless (12/12):** Thin adapter layer only; no new `.js` files in `api/` can be created
- **Supabase PostgreSQL:** No schema changes needed for v2.0
- **coc.guide CDN:** Already in use for troop/equipment images via `_unitCdnUrl()`; extend `UNIT_COC_SLUG` for missing items, verify slugs manually

**Critical stack note:** The global rankings bug is caused by `RANK_LOCATIONS.global = '32000000'` in `app.js`. The correct value is the string `"global"`. The render-proxy already handles this correctly — only the constant in `app.js` needs changing. STACK.md and FEATURES.md agree on this with HIGH confidence.

### Expected Features

**Must have (table stakes — visible broken things):**
- Fix Stick Horse under Barbarian King in equipment view — currently falls through to "Altro" group
- Fix global leaderboard returning empty/notFound — one constant change (`'32000000'` → `'global'`)
- Correct equipment images — Battle Drill has wrong slug (`battleram` → `battle-drill`)
- TH level column in leaderboards — data is present in API response; auto-fixes when locationId is corrected
- Clan crest in ranking rows — `badgeUrls.small` is in the API response, just not rendered
- War log accessible from clan view — currently requires navigating to a separate top-level tab

**Should have (new capabilities):**
- Sub-tab restructure for "Il mio clan" (Membri / War Classiche / Cronologia CWL)
- Reusable WarDetailView component shared between "Il mio clan" and "Cerca clan"
- Advanced clan search filters (minMembers, maxMembers, warFrequency, locationId, minClanLevel) — server-side; client-side post-filter for TH level (CoC API does not expose `minTownHallLevel`)
- "Cerca clan" showing identical sub-tab UI as "Il mio clan" for any searched clan
- Force-refresh button on leaderboards
- Clickable player/clan rows in rankings wired to existing profile navigation

**Defer to v3.0:**
- Excel import UI (IMP-01)
- CWL bonus keyed by player tag instead of name (ROB-01) — schema migration required
- Performance optimizations (PERF-01/02) — not blocking

**Anti-features to avoid:**
- Real-time auto-refresh on rankings — risks CoC API rate limiting; use manual refresh button instead
- Global player name search — CoC API has no name search endpoint for players; tag-only lookup is correct
- `minTownHallLevel` as a server-side filter — parameter does not exist in CoC API; client-side post-filter on `requiredTrophies` is the correct approach
- Splitting `app.js` into modules — no build step constraint; keep monolith

### Architecture Approach

All v2.0 changes are additive modifications to the existing four files (`index.html`, `app.js`, `api/lookup.js`, `render-proxy/index.js`). The monolith is intentional and correct at this scale. Two new patterns are introduced: (1) a `window._viewedClan` shared state object for "Cerca" clan context, kept deliberately separate from `window._userClanTag` which is auth-bound; (2) a `buildWarDetailHTML(warData, opts)` pure function that returns HTML strings and eliminates the current ~150-line duplication between `openClassicWarDetail` and `openCercaWarDetail`. All new sub-tab switchers must use scoped `querySelectorAll` on a parent container, not the document-wide `.subtab-btn` selector pattern currently used in `switchWarTab`.

**Major components:**
1. **`app.js` state objects** — `window._userClanTag` (auth-bound, never changes), `window._viewedClan` (navigation-bound, changes per searched clan), `window._warLogMap` (must be namespaced by clan tag in v2.0 to prevent clobber)
2. **`buildWarDetailHTML(warData, opts)`** — new pure HTML builder function; eliminates duplication; called by both classic war and CWL round detail paths
3. **`render-proxy/index.js` `/search-clans` route** — must be extended to accept and forward `minMembers`, `maxMembers`, `warFrequency`, `locationId`, `minClanLevel` to the CoC API
4. **`api/lookup.js`** — existing multi-purpose proxy; extend with filter param pass-through, no new files
5. **`EQUIPMENT_MAP` / `getAssetUrl()`** — centralized asset mapper replacing scattered image resolution logic; derives reverse hero-to-equipment map programmatically from a single forward map

### Critical Pitfalls

1. **Global `.subtab-btn` selector collision** — `switchWarTab()` uses a document-wide selector that will deactivate sub-tab active states across all visible sections simultaneously. Every new sub-tab function must scope its selector: `btn.closest('.subtab-group').querySelectorAll('.subtab-btn')` or use a unique class per group. Audit all four existing switchers before adding a fifth.

2. **Wrong `locationId` for global rankings** — `RANK_LOCATIONS.global = '32000000'` is the Europe continent ID, not global. Change to the string `"global"`. The render-proxy route is already correct; only the constant in `app.js` needs updating. Verify with a direct CoC API call before shipping.

3. **Vercel 12/12 function limit** — Adding any new `.js` file in `api/` (outside `_utils/`) breaks the deploy. Enforce with `ls api/*.js | grep -v _utils | wc -l` before every deploy. All new backend logic goes to `render-proxy/index.js` or as new `type=` branches in `lookup.js`.

4. **`window._warLogMap` clobber between clan contexts** — The war log map is not namespaced by clan tag. When "Cerca clan" and "Il mio clan" both load war data, the last writer wins. Fix: namespace as `window._warLogMap[clanTag][endTime]` and pass `clanTag` as a parameter to `openClassicWarDetail()`.

5. **Hero equipment hero assignment is implicit and fragile** — The CoC API player response does not include which hero owns each equipment item. The current static map is incomplete (missing Stick Horse). Fix: maintain a single forward `EQUIPMENT_HERO_MAP` (hero → equipment array) and derive the reverse map programmatically. Never maintain the reverse by hand. Any new Supercell equipment will otherwise appear in "Altro" until manually patched.

---

## Implications for Roadmap

Based on research, the dependency graph strongly suggests five phases. Each phase is a stable deliverable that the next phase builds on.

### Phase 1: Bug Fixes and Asset Foundation

**Rationale:** Two visible bugs (broken global rankings, wrong equipment grouping) must be fixed before adding any new features on top. The asset mapper centralization (ARCH-01) is done here because the equipment bug fixes require touching the same maps — doing it twice would be wasteful. These changes are purely additive to `app.js` with no structural risk.

**Delivers:** Working global leaderboards (with TH column and clan crests auto-populating), correct hero equipment grouping with no "Altro" section, Battle Drill showing the right image, placeholder on missing images, and a single centralized `getAssetUrl()` function.

**Addresses:** EQUIP-01 (Stick Horse), EQUIP-02 (remove Altro), EQUIP-03 (onerror placeholder), EQUIP-04 (Battle Drill slug), CLAS-01/02 (global locationId), CLAS-05 (TH column), ARCH-01 (asset mapper)

**Avoids:** Hero assignment fragility pitfall (build `EQUIPMENT_HERO_MAP` forward map now, derive reverse programmatically)

**Research flag:** No deeper research needed — all fixes are confirmed with HIGH confidence from codebase inspection and CoC API docs.

### Phase 2: Rankings Polish

**Rationale:** Once the global rankings data loads correctly (Phase 1), the remaining rankings features (clan crest rendering, league badge updates, clickable rows, force-refresh button) are low-effort polish that completes the rankings feature area before moving to structural changes.

**Delivers:** Fully functional rankings tab — clan crests in clan rows, current league badges, clickable rows that open player/clan profiles, and a manual refresh button.

**Addresses:** CLAS-03 (league badges), CLAS-04 (clan crest), CLAS-06 (force-refresh), CLAS-07 (clickable rows)

**Avoids:** Stale data anti-feature — manual "Aggiorna" button is the correct approach, not auto-refresh

**Research flag:** No deeper research needed — all features use data already present in API responses.

### Phase 3: "Il mio clan" Restructure and Shared State

**Rationale:** The sub-tab restructuring is a prerequisite for Phase 4 (WarDetailView) and Phase 5 (Cerca parity). The shared `window._viewedClan` state object and `buildWarDetailHTML()` extraction are also done here — they are low-risk refactors with no visual change, but they are what Phase 4 builds on.

**Delivers:** "Il mio clan" with three sub-tabs (Membri / War Classiche / Cronologia CWL), shared `window._viewedClan` state, and `buildWarDetailHTML()` pure function (eliminating ~150 lines of duplication) — no new visual features yet, but the structural plumbing is correct.

**Addresses:** CLAN-01/02 (sub-tab structure), ARCH-02 (shared clan state)

**Avoids:** Global `.subtab-btn` selector pitfall — Phase 3 is where a fifth sub-tab group is introduced; scoped selectors must be enforced from the start. Also avoids `window._warLogMap` clobber — namespace the map by clan tag in this phase.

**Research flag:** No deeper research needed — architecture patterns are well-documented in ARCHITECTURE.md with specific code examples.

### Phase 4: WarDetailView Component

**Rationale:** With Phase 3's structural foundation in place, the WarDetailView can be built as a reusable component. CWL round data uses the same war object shape as classic wars (`attacksPerMember: 1`), so `buildWarDetailHTML()` handles both with a single `opts` parameter.

**Delivers:** Per-member attack detail view for classic wars and CWL rounds, accessible from "Il mio clan" sub-tabs. Missed attacks highlighted. 7-round CWL season navigator.

**Addresses:** CLAN-03 (classic WarDetailView), CLAN-04 (CWL round detail)

**Avoids:** Parallel implementation anti-pattern — the shared pure builder is the explicit output of this phase; any temptation to copy-paste the existing modal implementation must be resisted.

**Research flag:** No deeper research needed — CWL data structure is confirmed in FEATURES.md; existing `_renderCwlRoundDetail()` provides the starting implementation to extract from.

### Phase 5: Advanced Clan Search

**Rationale:** Advanced search depends on the sub-tab structure (Phase 3) and WarDetailView (Phase 4) being stable, because "Cerca clan" should show an identical UI to "Il mio clan" for any searched clan. The filter extension touches three files (render-proxy, lookup.js, app.js) — it is the most cross-cutting change and benefits from all other phases being settled.

**Delivers:** Clan search with filters (minMembers, maxMembers, warFrequency, locationId, minClanLevel); client-side TH post-filter; "Cerca clan" showing full sub-tab view (Membri / War Classiche / Cronologia CWL) identical to "Il mio clan".

**Addresses:** CERCA-01 (filters), CERCA-02/03 (Cerca = Il mio clan)

**Avoids:** New Vercel function temptation — all filter logic goes through existing `lookup.js` and `render-proxy/index.js`. No new files. Also avoids the `minTownHallLevel` server-side filter trap — CoC API does not support it; implement as client-side post-filter on `requiredTrophies`.

**Research flag:** No deeper research needed — all CoC API filter parameters are confirmed with HIGH confidence via clashofclans.js interface docs.

### Phase Ordering Rationale

- **Bugs first:** Global rankings and equipment fixes unblock columns and data that downstream phases rely on for visual verification.
- **Foundation before features:** ARCH-01 (asset mapper) and ARCH-02 (shared state) done in Phases 1 and 3 respectively, so Phases 4 and 5 build on correct foundations rather than patching around them.
- **Single-file changes before multi-file changes:** Phases 1 and 2 touch only `app.js`. Phase 3 adds `index.html` changes. Phase 5 is the most cross-cutting (4 files) and benefits from all other phases being stable.
- **Constraint enforced throughout:** Vercel 12/12 limit is a hard constraint from Phase 1 onward — verify function count before every deploy.

### Research Flags

Phases with standard patterns (no deeper research needed):
- **Phase 1:** All bug fixes are confirmed from codebase inspection; locationId fix confirmed from multiple CoC API sources
- **Phase 2:** Rankings polish uses data already present in API responses
- **Phase 3:** Architecture patterns have explicit code examples in ARCHITECTURE.md
- **Phase 4:** CWL data structure confirmed; existing `_renderCwlRoundDetail()` is the reference implementation
- **Phase 5:** CoC API filter parameters confirmed with HIGH confidence

No phase requires a `/gsd:research-phase` call — all research is complete and actionable.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No changes to stack; all constraints (12/12 Vercel limit, render-proxy as only backend extension point) confirmed from codebase |
| Features | MEDIUM-HIGH | CoC API behavior confirmed via community wrappers (cocpy, clashofclans.js); Supercell official portal not directly accessible; `"global"` locationId confirmed via forum + wrapper defaults |
| Architecture | HIGH | Based on direct inspection of `app.js` (4650 lines) and `index.html` (742 lines); patterns extracted from working code |
| Pitfalls | HIGH | Derived from direct codebase inspection; bugs confirmed by cross-referencing STACK.md, FEATURES.md, and ARCHITECTURE.md independently reaching the same conclusions |

**Overall confidence:** HIGH

### Gaps to Address

- **Battle Drill CDN slug (`battle-drill`):** Confirmed as wrong slug (`battleram`), but correct slug on coc.guide not directly verified. Load `https://coc.guide/static/imgs/troop/battle-drill.png` in browser before committing the fix. If it 404s, check coc.guide's siege machine category.

- **Stick Horse slug on coc.guide:** Auto-generated slug `stick-horse` may or may not resolve correctly. Verify `https://coc.guide/static/imgs/equipment/stick-horse.png` before relying on it. The `onerror` placeholder (Phase 1, EQUIP-03) provides a safety net if the CDN path is wrong.

- **Global rankings API behavior in production:** The `"global"` string is confirmed via community wrappers and forum posts, but not via a direct authenticated API call. After Phase 1 ships, verify with `GET /v1/locations/global/rankings/players?limit=50` using the production CoC API token.

- **Dragon Duke equipment items in API response:** Dragon Duke was added February 2026 with 3 equipment items. The `HERO_EQUIPMENT_MAP` may already include him (noted as present in `HERO_ORDER_EQUIP`), but the equipment items (Fire Heart, Flame Blower, Stun Blaster) should be verified against a player who has unlocked Dragon Duke.

---

## Sources

### Primary (HIGH confidence)
- `app.js` (4650 lines, direct inspection) — RANK_LOCATIONS bug, sub-tab patterns, UNIT_COC_SLUG, HERO_EQUIPMENT_MAP
- `index.html` (742 lines, direct inspection) — HTML structure, existing sub-tab markup
- `render-proxy/index.js` (631 lines, direct inspection) — `/rankings` route, `/search-clans` route
- `api/lookup.js` (direct inspection) — current filter pass-through behavior
- `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONCERNS.md` — codebase analysis
- `.planning/PROJECT.md` — v2.0 requirements and known bugs

### Secondary (MEDIUM confidence)
- [cocpy.readthedocs.io](https://cocpy.readthedocs.io/en/rewrite/api.html) — `location_id='global'` default for worldwide rankings; clan search parameters
- [clashofclans.js ClanSearchOptions](https://clashofclans.js.org/docs/api/interfaces/ClanSearchOptions) — confirmed filter parameter names
- [Supercell forum thread on global rankings](https://forum.supercell.com/showthread.php/1210551-How-to-get-global-rankings-through-clash-of-clans-api) — `"global"` string confirmed
- [allclash.com hero equipment 2026](https://www.allclash.com/the-best-hero-abilities-equipment-for-each-hero-in-clash-of-clans/) — hero-to-equipment groupings
- [sportskeeda — Stick Horse](https://www.sportskeeda.com/mobile-games/clash-clans-stick-horse-equipment-ability-get) — Barbarian King 8th equipment, Feb 2026

### Tertiary (MEDIUM-LOW confidence)
- [coc.guide](https://coc.guide/) — CDN URL pattern confirmed from existing working code; specific slugs for new items (Stick Horse, Battle Drill) require manual browser verification
- [clashofclans.fandom.com](https://clashofclans.fandom.com/wiki/Hero_Equipment) — hero equipment wiki (403 on direct access, referenced via search snippets)

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*

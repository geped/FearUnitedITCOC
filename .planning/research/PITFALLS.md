# Pitfalls Research

**Domain:** Vanilla JS SPA monolith — Clash of Clans dashboard with serverless API
**Researched:** 2026-03-20
**Confidence:** HIGH (derived from direct codebase inspection + CoC API documentation patterns)

---

## Critical Pitfalls

### Pitfall 1: Global `.subtab-btn` Selector Nukes All Sub-Tabs at Once

**What goes wrong:**
`switchWarTab()` at line 2441 runs `document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'))` — a **document-wide** selector, not scoped to a parent container. When "Il mio clan" gains its own sub-tabs (Membri / War Classiche / Cronologia CWL), switching between them will simultaneously deactivate the active sub-tab in every other section that is currently rendered in the DOM (Registri Guerre, Profilo, Cerca, the new Clan sub-tabs). Visible symptom: a user in "Il mio clan" clicks "War Classiche" and the active button in the open Profilo panel also turns grey.

**Why it happens:**
The three existing sub-tab systems (`switchWarTab`, `switchProfiloTab`, `_switchCercaSubtab`, `_switchCercaClanTab`) all share the same CSS class `subtab-btn` and each uses a selector that is either document-wide or scoped only narrowly. Adding a fourth set of sub-tabs inside `#tab-members` with the same class will collide.

**How to avoid:**
Scope every sub-tab toggle to its nearest container, not the document. Use a passed parent selector or traverse from the clicked button's closest parent section:
```js
// Instead of:
document.querySelectorAll('.subtab-btn').forEach(...)
// Do:
btn.closest('.subtab-group').querySelectorAll('.subtab-btn').forEach(...)
```
Or give each sub-tab group a unique class: `.warlog-subtab-btn`, `.clan-subtab-btn`.
Audit all four existing subtab switchers before adding a fifth one.

**Warning signs:**
- Clicking a sub-tab in one section visually resets the active state in another visible section.
- Test by opening "Registri Guerre" tab, leaving it on CWL sub-tab, then clicking into "Il mio clan" sub-tabs — watch the Registri Guerre sub-tabs for spurious deactivation.

**Phase to address:** Phase that adds sub-tabs to "Il mio clan" (WarDetailView + clan restructuring).

---

### Pitfall 2: Global Rankings Broken Because `locationId=32000000` Is Not "Global"

**What goes wrong:**
`RANK_LOCATIONS = { global: '32000000', italy: '32000094' }` at line 4560. The CoC API uses the string `"global"` (literally) as the `locationId` for global leaderboards — not a numeric ID. The numeric ID `32000000` does not map to "global" in the CoC API; it returns `notFound` or an empty result set for ranking endpoints. This is the root cause of the "classifiche globali restituiscono notFound" bug already listed in PROJECT.md.

**Why it happens:**
The developer assumed a numeric location ID exists for "global" analogous to country codes, but the CoC API `/locations/{locationId}/rankings/{rankingId}` endpoint treats `"global"` as a special keyword, not a number.

**How to avoid:**
Change `RANK_LOCATIONS.global` from `'32000000'` to `'global'`. The render-proxy `/rankings` route already passes the value verbatim to the CoC API URL, so only the constant in `app.js` needs updating. Verify with a direct curl against the CoC API using your token before shipping:
```
GET /v1/locations/global/rankings/players?limit=50
```

**Warning signs:**
- Rankings tab shows "Nessun dato disponibile" or an API error for the Global option.
- Any new ranking type added (Builder Base, Clan Capital) will have the same failure if it reuses the `RANK_LOCATIONS` map.

**Phase to address:** Phase fixing global leaderboards (fix-bugs phase, before new feature phases).

---

### Pitfall 3: Vercel 12/12 Function Limit — Adding Any New File in `api/` Will Break Deploy

**What goes wrong:**
The project is at exactly 12/12 serverless functions on the Vercel Hobby plan. Creating any new `.js` file in `api/` (excluding `_utils/` subdirectory, which does not count) will cause the deploy to fail with a quota error or silently drop one of the existing functions. This is not a future risk — it is an immediate blocker the moment a new file is created.

**Why it happens:**
v2.0 features (WarDetailView, advanced search filters, new ranking types) may tempt adding a dedicated endpoint file. The constraint is already documented but easy to forget under deadline pressure.

**How to avoid:**
Any new backend capability must be added as a new `type=` branch inside `api/lookup.js` (the existing catch-all), or as a new route in `render-proxy/index.js` (the Express server on Render.com — no function limit). Never create a new file in `api/` without first removing an existing one. Check count before every deploy: `ls api/*.js | grep -v _utils | wc -l`.

Advanced search filters (minMembers, maxMembers, country, minTH) can be added as query params to the existing `/search-clans` route in `render-proxy/index.js` and the `type=search-clans` branch in `lookup.js` without adding any new files.

**Warning signs:**
- `vercel --prod` deploy output shows "Function count exceeds limit".
- A new `.js` file appears in `api/` in any PR diff.

**Phase to address:** Every phase — enforce as a constraint at the start of roadmap execution.

---

### Pitfall 4: `window._warLogMap` State Survives Navigation and Corrupts WarDetailView

**What goes wrong:**
`window._warLogMap` is populated by `loadWarLog()` and keyed by `endTime`. The new WarDetailView component needs to reuse this structure for wars loaded from "Cerca clan" context as well. If `openClassicWarDetail(endTime)` is called from a search context where the map was populated with a *different clan's* wars (or is stale from the user's own clan), the detail view will show wrong data — or show nothing at all if the key is absent.

**Why it happens:**
The shared global state is designed for the single "my clan war log" use case. Adding a second entry point (cercaClan war log sub-tab) that also calls `openClassicWarDetail()` will write to the same `window._warLogMap` without a clan-tag namespace. The last `loadWarLog()` call wins.

**How to avoid:**
Namespace the map by clan tag: `window._warLogMap = window._warLogMap || {}; window._warLogMap[clanTag] = {}`. Then `openClassicWarDetail(endTime, clanTag)` looks up `window._warLogMap[clanTag][endTime]`. The WarDetailView component should receive data as a parameter rather than reading from global state directly.

**Warning signs:**
- Opening "my clan" war detail after having browsed a search clan's war log shows the search clan's war data.
- `window._warLogMap` has more keys than expected after browsing two different clans.

**Phase to address:** Phase building WarDetailView + "Il mio clan" restructuring.

---

### Pitfall 5: `_renderEquipmentGrouped` Hero Assignment Is Implicit and Fragile

**What goes wrong:**
Hero equipment is categorized by the set membership in the UNIT_COC_SLUG map (e.g., `{c:'equipment', s:'...'}`) and by explicit grouping logic in `_renderEquipmentGrouped`. The Stick Horse bug (mapped to "Altro" instead of Barbarian King) occurs because the grouping function relies on a hard-coded hero-to-equipment association that is maintained manually. Every new equipment item Supercell releases goes to "Altro" by default unless someone manually adds it to the correct hero bucket.

**Why it happens:**
The CoC API `heroEquipment` array returns a flat list with an `equipment.name` field but **no hero association** in the player profile response. The correct hero association must be looked up from a static mapping table. The current table is incomplete.

**How to avoid:**
Maintain a single authoritative `EQUIPMENT_HERO_MAP` constant:
```js
const EQUIPMENT_HERO_MAP = {
  'Barbarian King': ['Barbarian Puppet','Rage Vial','Earthquake Boots','Vampstache','Giant Gauntlet','Spiky Ball','Snaky Bracelet','Action Figure','Heroic Torch','Stun Blaster'],
  'Archer Queen':   ['Archer Puppet','Invisibility Vial','Giant Arrow','Healer Puppet','Frozen Arrow','Magic Mirror','Frost Flake','Noble Iron'],
  // ...etc
};
```
Then derive the reverse map programmatically. Never maintain the reverse mapping by hand. When Supercell adds new equipment and it appears in "Altro", the fix is to add one line to the forward map, not hunt through the render logic.

**Warning signs:**
- Any equipment item appearing in "Altro" section after a CoC update.
- Multiple places in `app.js` that reference equipment names by string literal (fragmentation means one place gets updated and another doesn't).

**Phase to address:** Phase fixing Hero Equipment categorization.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| All UI logic in `app.js` monolith | No build step, no module boundary decisions | Adding 300+ lines per feature pushes file past 5000 lines; `Ctrl+F` navigation degrades; merge conflicts more frequent | Acceptable for v2.0 given vanilla JS constraint — add section banners religiously |
| `window.*` for cross-function state | Simple to access from anywhere | Each new `window._` var is invisible to linters; naming collisions accumulate; global pollution increases | Acceptable for single state variables (userClanTag, canEdit) — never acceptable for transient UI state like "last viewed war" |
| CDN-hosted images (`coc.guide/static/imgs/`) | Zero hosting cost, always up-to-date | CDN availability outside your control; slug format changes silently break all images; new units return 404 until UNIT_COC_SLUG is updated | Acceptable — but the centralized asset mapper is the right mitigation |
| No abort controller on search fetches | Simpler code | Rapid re-search triggers multiple in-flight requests; last-to-arrive wins (not last-initiated); stale results overwrite fresh ones | Never acceptable for search — existing `loadWarLog` uses AbortController correctly, replicate the pattern |
| `innerHTML` with template literals for entire sections | No virtual DOM overhead | XSS risk if any user-controlled string is unescaped; difficult to partially update (must re-render whole section) | Acceptable — but every user-controlled string (clan names, player names) must be passed through an escape function before insertion |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CoC API — global rankings | Using numeric location ID `32000000` as the "global" identifier | Use the string literal `"global"` as `locationId` in the rankings URL |
| CoC API — search clans filters | Passing unsupported filter params directly to `/v1/clans` | Consult the official API docs; only `name`, `warFrequency`, `locationId`, `minMembers`, `maxMembers`, `minClanLevel`, `minClanPoints`, `labelIds`, `limit` are supported natively |
| CoC API — player equipment | Expecting `heroEquipment[i].hero` to tell you which hero owns the equipment | The field does not exist in the player endpoint response; hero association must be inferred from a static mapping |
| CoC API — war log CWL filtering | Relying on `warType === 'cwl'` alone to exclude CWL wars from the log | Use the existing three-heuristic filter (warType + opponent presence + star ceiling check) already in `loadWarLog()` — it exists because `warType` is sometimes absent |
| Render.com proxy — cold start | Calling the proxy immediately after 15 min inactivity without warm-up | Use the existing `/health` ping from the calling function, or show a spinner with a "Il server proxy si sta avviando (~30s)" message; do not hide the latency from the user |
| Supabase RLS — reading `cwl_history` from frontend | Querying without `clan_tag` filter for a multi-clan table | Always apply `.eq('clan_tag', window._userClanTag)` before executing — omitting the filter returns all clans' data to the client |
| Vercel cron — single daily trigger | Adding a new operation to `sync-members` cron assuming it will run at a predictable sub-minute interval | Vercel Hobby cron granularity is 1 day minimum; all time-sensitive operations need to be triggered by user action, not cron |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N uncached CoC API calls per CWL stats load | Each `/cwl-live` load in render-proxy fires up to 30 sequential/parallel CoC API calls (7 war tags + group info + individual player lookups) | Add a Map-based TTL cache (5 min) in `render-proxy/index.js` for CWL group data | Breaks when multiple users open the CWL tab simultaneously — CoC API may rate-limit the render-proxy IP |
| No debounce on search input | Each keystroke in the clan search fires a new `/api/lookup` request | Debounce search input by 300–500ms before firing; use AbortController to cancel in-flight requests when a new one starts | Breaks immediately with fast typists — currently mitigated by the manual "Cerca" button, but filter UI may add live-filter inputs |
| Re-rendering entire table on every filter change | Advanced search filters (minTH, country, type) applied client-side re-render the entire `innerHTML` each time | Apply filters in-memory on a cached result set; only update the DOM once after all filter changes | Breaks at 50+ results in the DOM — visible lag on mobile |
| `_renderEquipmentGrouped` loops UNIT_COC_SLUG on every render | For each equipment item, the function currently iterates the slug map; scales linearly with equipment count | Build the reverse lookup map once at startup, not on each render call | Not critical at current scale (~40 equipment items), but will degrade as Supercell adds more |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unescaped clan/player names in `onclick` string attributes | CoC player names can contain apostrophes and special chars — `onclick="toggleFavClan('${tag}','${name}')"` breaks if name contains `'` | Use `name.replace(/'/g, "\\'")` consistently — already done in some favBtn calls but inconsistently applied; a centralized `esc(str)` helper prevents gaps |
| Embedding user tag/name in innerHTML without sanitization | XSS if a player name contains `<script>` — unlikely in CoC but possible for clan descriptions | Run all CoC string fields through a sanitize function before `.innerHTML` injection; existing code does `replace(/"/g, '&quot;')` for attributes but not for text nodes |
| `SYNC_SECRET` in `import_bonus.py` local script | If the local script is committed or leaked, the import endpoint becomes publicly accessible | `import_bonus.py` is already in `??` (untracked) git status — keep it in `.gitignore` explicitly |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Rankings tab loaded only on first `activateTab('rankings')` — no refresh button | User sees stale data with no way to refresh without navigating away and back | Add a "Aggiorna" button to the rankings header that calls `loadRankings()` — already listed as a v2.0 feature |
| Sub-tab navigation resets scroll position | Adding war log as a sub-tab of "Il mio clan" means the user's scroll position is lost every time they switch between Membri and War Classiche | Preserve the scroll position per sub-tab in a module-level variable: `_clanSubtabScroll[tab] = container.scrollTop` before hide, restore after show |
| WarDetailView modal opened from within a sub-tab has no "back to list" affordance | If the modal is dismissed by clicking the overlay, the parent sub-tab must still show the correct active sub-tab | The modal's `transitionend` handler must restore the parent container's state, not just remove itself from the DOM |
| Cold start spinner shows no estimated wait time | User sees generic spinner for up to 30s and assumes the page is broken | When a proxy endpoint request takes more than 3s, show "Il proxy si sta avviando, attendi ~30 secondi" below the spinner |
| Clan search results not sortable | Advanced filter results returned by CoC API are unordered; the current UI shows them as-is | Default to sorting by `clanLevel` descending — matches user expectation for "best clans first" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Global rankings fix:** Verify with actual API call — not just that the UI renders, but that `items.length > 0` and the first entry has a real player name and `townHallLevel` field (TH column shows "?" if `townHallLevel` is missing from ranking response vs. player profile response).
- [ ] **Sub-tabs in "Il mio clan":** Verify that switching to another main tab (Profilo, Cerca) and back to "Il mio clan" restores the correct active sub-tab, not always defaulting to the first one.
- [ ] **WarDetailView:** Verify it works for both classic war (from `window._warLogMap`) and CWL round (from `cwl-live` response), not just one path.
- [ ] **Hero Equipment:** After fixing Stick Horse assignment, verify that newly-released equipment items (any not in UNIT_COC_SLUG) render with a placeholder image, not a broken `<img>` with no `onerror` handler.
- [ ] **Asset mapper:** After centralizing `_unitCdnUrl`, verify the `onerror` fallback path (colored-initial placeholder) still works when coc.guide is unreachable — the fallback uses canvas or CSS, confirm it doesn't throw on browsers that block canvas.
- [ ] **Advanced search filters:** Verify that filtering by `minMembers`/`maxMembers` passes CoC API-supported param names exactly — the API uses `minMembers` and `maxMembers` (camelCase), not `min_members`.
- [ ] **Sub-tab selector scoping:** After adding new sub-tabs, run through all existing sub-tab groups in sequence and confirm no cross-contamination of active states.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Global `.subtab-btn` selector collision | LOW | Add a unique class or scope the querySelector to a parent — one-line fix per affected function; no data loss |
| Wrong `locationId` for global rankings | LOW | Change one constant in `app.js`; no deploy of render-proxy required |
| Vercel 12-function limit exceeded | MEDIUM | Identify least-used standalone function, merge its logic into `lookup.js`; re-test that endpoint; redeploy |
| `window._warLogMap` clobber between clan contexts | MEDIUM | Namespace the map by clan tag; update all call sites of `openClassicWarDetail()` to pass clan tag; test both contexts |
| New CoC equipment in "Altro" after Supercell update | LOW | Add one entry to `EQUIPMENT_HERO_MAP` and re-derive reverse map; no backend change needed |
| coc.guide CDN slug changes breaking all unit images | HIGH | All images break simultaneously with no error in the console (just broken img tags); mitigation is ensuring `onerror` placeholder is always set; long-term fix requires switching to self-hosted or official CDN |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Global `.subtab-btn` selector collision | Phase adding "Il mio clan" sub-tabs | Manual test: all 4 sub-tab groups active simultaneously — switch one, check others unchanged |
| Wrong `locationId` for global rankings | Phase 1 (fix bugs) | `loadRankings()` with `_rankLocale='global'` returns `items.length > 0` |
| Vercel 12-function limit | All phases | `ls api/*.js \| grep -v _utils \| wc -l` returns ≤12 before every deploy |
| `window._warLogMap` clobber | Phase adding WarDetailView | Open detail modal from "Cerca" context; navigate to "Il mio clan" war log; open different detail — both show correct clan's data |
| Hero equipment hero assignment | Phase fixing Hero Equipment | No items in "Altro" section for a max-TH player profile |
| No debounce on search | Phase adding advanced search filters | Network tab shows one request per completed search, not one per keystroke |
| Cold start UX | Any phase touching proxy-dependent load | Request that hits a cold proxy shows a timed status message after 3s |

---

## Sources

- Direct inspection of `app.js` (4650 lines), `render-proxy/index.js` (631 lines), `api/lookup.js`
- `.planning/codebase/CONCERNS.md` — existing fragile areas catalogue
- `.planning/PROJECT.md` — v2.0 active requirements and known bugs
- CoC API documentation patterns: `developer.clashofclans.com` — `"global"` as location ID keyword
- WebSearch: Clash of Clans API rankings global locationId — confirmed `"global"` string required, not a numeric ID
- CONVENTIONS.md — existing patterns for sub-tab switching, global state, tag handling

---
*Pitfalls research for: CoCBoard v2.0 — vanilla JS SPA + CoC API integration*
*Researched: 2026-03-20*

# Architecture Research

**Domain:** Vanilla JS SPA — CoCBoard v2.0 UI/UX Evolution
**Researched:** 2026-03-20
**Confidence:** HIGH (based on direct codebase inspection)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (SPA)                             │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ index.html│  │   app.js     │  │  supabase-config.js  │  │
│  │(742 lines)│  │(4650 lines)  │  │  sets window.sb      │  │
│  │ All HTML  │  │ All logic    │  └──────────────────────┘  │
│  │ markup    │  │ state, nav,  │                            │
│  │ All tab   │  │ render, auth │                            │
│  │ sections  │  └──────┬───────┘                            │
│  └───────────┘         │                                    │
│                        │ fetch()                            │
├────────────────────────┼────────────────────────────────────┤
│                 VERCEL SERVERLESS                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │
│  │lookup.js │  │war-log.js│  │cwl-stats │  │clan-info  │   │
│  │rankings  │  │          │  │.js       │  │.js        │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘   │
│       │             │             │              │          │
├───────┴─────────────┴─────────────┴──────────────┴──────────┤
│                 RENDER.COM PROXY                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  render-proxy/index.js — holds COC_API_TOKEN         │   │
│  │  All CoC API calls + Supabase writes                 │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                               │
├─────────────────────────────┼───────────────────────────────┤
│             SUPABASE (PostgreSQL + Auth)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │
│  │ members  │  │cwl_bonus │  │cwl_history│  │classic_   │  │
│  │          │  │es        │  │           │  │wars       │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Current Implementation |
|-----------|----------------|------------------------|
| `activateTab(tabId)` | Top-level section switching | Show/hide `.tab-content` sections, trigger lazy load |
| `switchWarTab(tab, btn)` | Sub-tab inside "Registri Guerre" | Show/hide `#wl-classic` / `#wl-cwl` divs |
| `switchProfiloTab(tab, btn)` | Sub-tab inside "Il mio Profilo" | Show/hide `#profilo-tab-{t}` divs |
| `_switchCercaClanTab(tab, btn)` | Sub-tab inside cerca clan detail | Show/hide `#cc-tab-{t}` divs |
| `_switchCercaSubtab(tab, btn)` | Sub-tab inside cerca search area | Show/hide `#cerca-sub-{t}` divs |
| `_showCercaArea(area)` | Navigation stack for cerca detail views | Show/hide search/clan/player detail panels |
| `openCercaClan(tag)` | Load + render full clan detail | Fetches clan-info + clan-members, renders sub-tabs inline |
| `window._userClanTag` | Identity of logged-in user's clan | Set once in `showApp()`, used by `clanQ()` |
| `window._warLogMap` | Cache for war log items by key | Set by `loadWarLog()`, read by `openClassicWarDetail()` |
| `window._cercaWarLogItems` | Cache for cerca war log items | Set by `_loadCercaWarLog()`, read by `openCercaWarDetail()` |
| `LEAGUE_BADGE_MAP` | League name → local image filename | Static object in app.js |
| `LEAGUE_BADGE` | CWL league name → local PNG path | Static object in app.js (separate from LEAGUE_BADGE_MAP) |

---

## Existing Navigation Patterns (How Sub-tabs Already Work)

There are **two sub-tab patterns** already in the codebase. Both must be followed for new work.

### Pattern A: Static Sub-tabs (preferred — used in "Registri Guerre" and "Profilo")

HTML structure in `index.html`:
```html
<section id="tab-warlog" class="tab-content">
  <div class="subtab-bar">
    <button class="subtab-btn active" onclick="switchWarTab('classic', this)">War Classiche</button>
    <button class="subtab-btn" onclick="switchWarTab('cwl', this)">Cronologia Leghe</button>
  </div>
  <div id="wl-classic"><!-- content --></div>
  <div id="wl-cwl" style="display:none"><!-- content --></div>
</section>
```

Switch function in `app.js`:
```javascript
function switchWarTab(tab, btn) {
  document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('wl-classic').style.display = tab === 'classic' ? 'block' : 'none';
  document.getElementById('wl-cwl').style.display     = tab === 'cwl'     ? 'block' : 'none';
  if (tab === 'classic') loadWarLog();
  if (tab === 'cwl')     loadCwlSeasons();
}
```

**Note:** `querySelectorAll('.subtab-btn')` is GLOBAL — it hits ALL subtab buttons on the page.
The scoped variant `document.querySelectorAll('#tab-profilo .subtab-btn')` is used in `switchProfiloTab` and is safer. New sub-tab switches MUST use scoped selectors.

### Pattern B: Dynamic Sub-tabs (used in "Cerca" clan detail — injected via innerHTML)

The sub-tab bar is injected dynamically by `_renderCercaClanDetail()`. The switch function uses a scoped selector on the container:
```javascript
function _switchCercaClanTab(tab, btn) {
  ['members','warlog','cwl'].forEach(t => {
    const el = document.getElementById(`cc-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cerca-clan-content .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}
```

---

## Integration Points for v2.0 Features

### 1. "Il mio clan" Sub-tab Restructuring

**Current state:** `tab-members` is a flat section — clan header + expandable details panel + members table. War log and CWL history live in separate top-level tabs (`tab-warlog`, `tab-cwl`).

**Target state:** `tab-members` becomes "Il mio clan" with sub-tabs: Membri / War Classiche / Cronologia CWL.

**Integration approach:**

The existing `tab-warlog` section in `index.html` already contains sub-tabs for "War Classiche" and "Cronologia Leghe" — exactly the content needed. The restructuring is:

1. Rename `tab-members` to `tab-clan` (or keep ID as-is, change `TAB_TITLES`).
2. Add a `.subtab-bar` inside `tab-members` section in `index.html` with three buttons.
3. Move the war-log and CWL history sub-panels into `tab-members`, or keep them in `tab-warlog` and redirect navigation.
4. Add a `switchClanTab(tab, btn)` function in `app.js` (scoped to `#tab-members .subtab-btn`).
5. Update `activateTab('members')` to trigger the default sub-tab on first visit.

**Modified files:** `index.html` (add subtab-bar + sub-panels), `app.js` (add `switchClanTab`, update `activateTab`).

**What stays:** `tab-warlog` can remain as-is if "Il mio clan" sub-tabs simply call the existing `loadWarLog()` and `loadCwlSeasons()` with the user's own clan tag. No duplication needed.

### 2. Shared WarDetailView Component

**Current state:** Two separate war detail implementations exist:
- `openClassicWarDetail(key)` — opens a full-screen modal appended to `document.body`, reads from `window._warLogMap`
- `openCercaWarDetail(idx)` — reads from `window._cercaWarLogItems`, opens a similar modal

Both build the same HTML structure (member cards, attack rows, badges, result banner). The code is duplicated across ~150 lines each.

**Target state:** A single `openWarDetailView(warData, options)` function that both call.

**Integration approach:**

Extract the shared HTML builder into a pure function:
```javascript
// In app.js — pure function, no side effects
function buildWarDetailHTML(warData, opts = {}) {
  // opts: { atkPerMember, clanTag, enrichedData }
  // Returns: HTML string for the modal body
}

// Callers:
function openClassicWarDetail(key) {
  const w = (window._warLogMap || {})[key];
  const html = buildWarDetailHTML(w, { clanTag: window._userClanTag });
  // inject into modal
}

function openCercaWarDetail(idx) {
  const w = (window._cercaWarLogItems || [])[idx];
  const html = buildWarDetailHTML(w, {});
  // inject into modal
}
```

**CWL rounds detail:** CWL rounds from `cwl-stats` API return individual war objects with the same shape as classic wars (`clan`, `opponent`, `teamSize`, members with attacks). The same `buildWarDetailHTML()` function can render them — the only difference is `atkPerMember` is always 1 for CWL.

**Modified files:** `app.js` only — refactor existing functions, add `buildWarDetailHTML`.

### 3. Shared State for Currently-Viewed Clan

**Current state:** Two separate state paths:
- "Il mio clan": reads `window._userClanTag` (set at login, never changes)
- "Cerca": clan tag is a local variable passed through `openCercaClan(tag)` → `_renderCercaClanDetail(info, members, clanTag, container)` → stored only in closure scope, also in `window._cercaWarLogItems` by side effect

There is no shared `window._viewedClanTag` object — the two paths are entirely separate.

**Target state:** A `window._viewedClan` object that "Cerca" populates when a user opens a clan. "Il mio clan" always uses `window._userClanTag` directly, not this object.

**Integration approach:**

Add at top of `app.js` (near existing globals):
```javascript
window._viewedClan = null; // { tag, name, badge, info, members }
```

Set it inside `openCercaClan()`:
```javascript
window._viewedClan = { tag, name: info.name, badge, info, members };
```

**Important:** Do NOT merge `_userClanTag` and `_viewedClan`. They serve different contexts. `_userClanTag` is auth-bound and never changes per session. `_viewedClan` is navigation-bound and changes every time the user opens a different clan in "Cerca".

**Modified files:** `app.js` only — add global, populate in `openCercaClan`.

### 4. Centralized Asset Mapper

**Current state:** Asset resolution is scattered:
- `thImgSrc(level)` — in app.js ~line 562, handles TH images
- `thImg(level)`, `thImgV(level)` — wrappers around `thImgSrc`
- `LEAGUE_BADGE_MAP` — maps league name → filename for player leagues
- `LEAGUE_BADGE` — maps CWL league name (Italian) → path for CWL seasons
- Equipment/troop images: inline `src` strings in profile rendering, no central mapper
- Bug: Stick Horse mapped to "Altro" category instead of Barbarian King equipment

**Target state:** A single `ASSET_MAP` object (or named constants) that maps all asset types to their paths. Equipment specifically needs an `EQUIPMENT_MAP` with hero association.

**Integration approach:**

Add near the top of `app.js` (after existing constants, before functions):
```javascript
// Maps equipmentId → { path, hero, name }
const EQUIPMENT_MAP = {
  'equipment_bk_001': { path: 'assets/equipment/barbarian_king/sword.png', hero: 'barbarianKing', name: 'Spada Reale' },
  'equipment_bk_stick_horse': { path: 'assets/equipment/barbarian_king/stick_horse.png', hero: 'barbarianKing', name: 'Cavallino' },
  // ...
};

function equipmentImgSrc(id) {
  return EQUIPMENT_MAP[id]?.path || 'assets/equipment/placeholder.png';
}
```

**TH mapper stays as-is** — `thImgSrc` is already clean. Only equipment needs fixing.

**Modified files:** `app.js` only — add `EQUIPMENT_MAP`, add `equipmentImgSrc()`, update profile rendering to use it.

### 5. Advanced Search Filters for Clan Search

**Current state:** `eseguiCerca()` calls `/api/lookup?type=search-clans&q=...` with only the query string. The CoC API `/clans` endpoint accepts: `name`, `warFrequency`, `locationId`, `minMembers`, `maxMembers`, `minClanLevel`, `limit`.

**Target state:** Filter UI added to `cerca-search-area` in `index.html`, query params passed through to `lookup.js` → `render-proxy/index.js`.

**Integration approach:**

Frontend (`app.js`): Update `eseguiCerca()` to read filter values from new DOM elements and append them to the URL:
```javascript
const minMembers = document.getElementById('filter-min-members')?.value;
const locationId = document.getElementById('filter-location')?.value;
// append: &minMembers=N&locationId=X
```

API (`api/lookup.js`): Extract and forward additional query params to render-proxy.

Render proxy (`render-proxy/index.js`): The `/search-clans` route already calls CoC `/clans?name=...`. Add pass-through for the extra params.

**No new Vercel function needed** — all flows through existing `lookup.js`.

**Modified files:** `index.html` (add filter inputs), `app.js` (update `eseguiCerca`), `api/lookup.js` (forward params), `render-proxy/index.js` (pass to CoC API).

### 6. Global Leaderboards Fix

**Current state:** `loadRankings()` calls `/api/lookup?type=rankings&rankType=players&locationId=32000006`. The bug is that `rankType=players` maps to the CoC endpoint `/locations/{id}/rankings/players` and `rankType=clans` maps to `/locations/{id}/rankings/clans`. The "Globale" option uses `locationId=global` — but the CoC API uses `locationId=32000006` for global (`/locations/global/rankings/players` is not valid; global uses a special ID).

**Fix approach:** Verify the correct CoC API path for global rankings in `render-proxy/index.js`. The correct endpoint is `/locations/{locationId}/rankings/players` where `locationId` must be a valid numeric ID. For global, CoC uses `32000000` (not `global` as a string). The `RANK_LOCATIONS` object in `app.js` must use the correct numeric IDs.

**Modified files:** `app.js` (fix `RANK_LOCATIONS` IDs), `render-proxy/index.js` (verify route logic).

---

## Recommended Project Structure (No Changes)

The existing flat structure is appropriate for this project size. Do NOT reorganize:

```
FearUnitedCoC/
├── index.html          # All HTML — add new sub-tab markup here
├── app.js              # All frontend logic — add/modify functions here
├── style.css           # All styles — add new component styles here
├── api/lookup.js       # Extend for filter params (no new files)
├── render-proxy/       # Extend search-clans route for filter params
```

The monolith is intentional (see `CLAUDE.md` — "app.js è monolitico — non spezzarlo senza motivo"). All v2.0 changes are additive modifications to existing files.

---

## Data Flow

### Sub-tab Navigation (new pattern for "Il mio clan")

```
User clicks sub-tab button
    |
    v
switchClanTab(tab, btn)         [app.js — NEW function]
    |
    +-- scope: querySelectorAll('#tab-members .subtab-btn')
    |
    +-- tab === 'members'  → show #clan-sub-members (already rendered)
    |
    +-- tab === 'warlog'   → show #clan-sub-warlog
    |                         → loadWarLog() if not loaded (_warLogLoaded flag)
    |
    +-- tab === 'cwl'      → show #clan-sub-cwl
                             → loadCwlSeasons() if not loaded
```

### Shared War Detail View (new)

```
User clicks war row
    |
    v
openClassicWarDetail(key)       OR      openCercaWarDetail(idx)
    |                                       |
    +-- get warData from cache              +-- get warData from cache
    |
    v
buildWarDetailHTML(warData, opts)       [app.js — NEW pure function]
    |
    v
Inject into modal overlay appended to document.body
    |
    v
closeWarDetailModal()   ← user clicks X or overlay
```

### Viewed Clan State (new)

```
User opens clan from search results / rankings
    |
    v
openCercaClan(tag)
    |
    +-- fetch /api/clan-info + /api/clan-members
    |
    +-- window._viewedClan = { tag, name, badge, info, members }
    |
    v
_renderCercaClanDetail(info, members, tag, container)
    |
    +-- Renders sub-tab bar (Membri / War Classiche / Cronologia CWL)
    |
    +-- _loadCercaWarLog(tag)    ← async, fills #cc-tab-warlog
    +-- _loadCercaCwlHistory(tag) ← async, fills #cc-tab-cwl
```

### Rankings Drill-down (existing pattern, extended)

```
User clicks player row in rankings
    |
    v
openCercaPlayer(tag)            [existing function]
    |
    v
Shows player detail in #cerca-detail-player area
    |
    v
User can navigate back via cercaPlayerTorna()
```

---

## Architectural Patterns

### Pattern 1: Scoped Sub-tab Switch

**What:** Each sub-tab switcher queries only its own section's buttons.
**When to use:** Whenever adding sub-tabs inside a `.tab-content` section.
**Trade-offs:** Slightly more verbose, but avoids the `.subtab-btn` global selector bug that `switchWarTab` currently has.

**Example (NEW — follow this, not the old pattern):**
```javascript
function switchClanTab(tab, btn) {
  ['members', 'warlog', 'cwl'].forEach(t => {
    const el = document.getElementById(`clan-sub-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  // SCOPED selector — critical to avoid deactivating other sections' buttons
  document.querySelectorAll('#tab-members .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'warlog' && !window._clanWarLogLoaded) loadWarLog();
  if (tab === 'cwl'    && !window._clanCwlLoaded)    loadCwlSeasons();
}
```

### Pattern 2: Load-once Flag

**What:** Boolean flag prevents re-fetching data when user switches sub-tabs back and forth.
**When to use:** For sub-tab content that doesn't change often (war log, CWL seasons).
**Trade-offs:** Simple, zero dependencies. Requires manual reset on tab exit or logout.

**Example:**
```javascript
let _clanWarLogLoaded = false;
function loadWarLog() {
  // ...fetch and render...
  _clanWarLogLoaded = true;
}
// Reset in activateTab when leaving members:
// if (tabId !== 'members') _clanWarLogLoaded = false; // optional
```

### Pattern 3: Pure HTML Builder Function

**What:** Functions that take data and return HTML strings, with no DOM side effects.
**When to use:** For any view that needs to be rendered in multiple contexts (e.g., war detail for "my clan" AND "searched clan").
**Trade-offs:** Easy to reuse and test. Caller is responsible for injection. No event listeners can be attached inline — must use `onclick="globalFn()"` strings.

**Example:**
```javascript
// Pure — returns HTML string, touches no DOM
function buildWarDetailHTML(w, opts = {}) {
  const { atkPerMember = 2 } = opts;
  // build and return HTML string
  return `<div class="war-detail">...</div>`;
}

// Caller injects into DOM
function openClassicWarDetail(key) {
  const modal = document.createElement('div');
  modal.innerHTML = buildWarDetailHTML(window._warLogMap[key]);
  document.body.appendChild(modal);
}
```

### Pattern 4: Inline onclick with Global Function References

**What:** Event handlers as `onclick="globalFunctionName(arg)"` strings inside `innerHTML`.
**When to use:** Always in this codebase — no alternative without event delegation.
**Trade-offs:** Functions called by onclick MUST be globally accessible (no `let`/`const` in module scope). All functions in `app.js` that are called from inline HTML are implicitly global.

This is already the established pattern throughout `app.js`. Do not introduce `addEventListener` for dynamically injected content — it doesn't work after `innerHTML` replacement.

---

## Anti-Patterns

### Anti-Pattern 1: Global `.subtab-btn` Selector

**What people do:** `document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'))`
**Why it's wrong:** This is in `switchWarTab()` today. If two sub-tab sections are visible simultaneously, it deactivates ALL sub-tab buttons on the page, not just the current section's.
**Do this instead:** Scope the selector: `document.querySelectorAll('#tab-warlog .subtab-btn')` or `document.querySelectorAll('#tab-members .subtab-btn')`.

### Anti-Pattern 2: Two Parallel Implementations of the Same View

**What people do:** Copy-paste `openClassicWarDetail` to create `openCercaWarDetail` with slight variations.
**Why it's wrong:** Already happened — the war detail modal HTML is duplicated ~150 lines. Any visual fix (new CSS class, new field display) must be applied twice.
**Do this instead:** Extract `buildWarDetailHTML(warData, opts)` as a shared pure builder. Both callers use it.

### Anti-Pattern 3: Adding a New Vercel Function for New Features

**What people do:** Create `api/advanced-search.js` for the filter search.
**Why it's wrong:** The Vercel Hobby plan is at 12/12 functions. Any new `.js` file in `api/` (excluding `_utils/`) burns a slot.
**Do this instead:** Extend `api/lookup.js`. It already handles multiple `type` values (`player`, `search-clans`, `rankings`). Add filter params as pass-through query parameters.

### Anti-Pattern 4: Two Separate `LEAGUE_BADGE_*` Maps

**What people do:** Add yet another league badge mapping object for a third context.
**Why it's wrong:** `LEAGUE_BADGE_MAP` (player leagues) and `LEAGUE_BADGE` (CWL leagues Italian names) are already two separate objects that must be kept in sync.
**Do this instead:** In v2.0, keep the two maps as-is for now (merging would require touching all call sites). When fixing league badges, update both maps simultaneously. A future cleanup phase can unify them.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| CoC API | Never called directly from browser. All calls: app.js → /api/*.js → render-proxy/index.js → CoC API | Adding new CoC API data = add route to render-proxy, pass through lookup.js |
| Supabase | Direct read from browser (anon key + RLS). Writes only via render-proxy (service role key) | New tables need `schema-{feature}.sql` + entry in `schema-MASTER.sql` |
| Vercel Functions | fetch() from app.js, authenticated via JWT header or SYNC_SECRET | 12/12 limit — do not add files, extend existing |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.html` ↔ `app.js` | `onclick="globalFn()"`, `id=` selectors, `document.getElementById` | All IDs are defined in index.html, all logic in app.js |
| `app.js` ↔ `api/lookup.js` | `fetch('/api/lookup?type=...&param=...')` | lookup.js is the multi-purpose proxy — extend by adding new `type` values or forwarding additional params |
| `app.js` ↔ `api/war-log.js` | `fetch('/api/war-log?clanTag=...')` | Read-only, no extension needed for v2.0 |
| sub-tab state ↔ parent tab | Implicit: no state object, sub-tab content is loaded on demand into DOM containers | Load-once flags (`_warLogLoaded`, etc.) are the only state |
| "Il mio clan" ↔ "Cerca" | Currently none — completely separate code paths | v2.0 shared state via `window._viewedClan` for cerca; user clan always uses `window._userClanTag` |

---

## Build Order Recommendation

Given the dependency structure, implement v2.0 features in this order:

1. **Asset mapper + bug fixes first** — `EQUIPMENT_MAP` centralizes assets; equipment bugs (Stick Horse, Battle Drill) are fixed here. No UI changes, lowest risk, unblocks profile rendering correctness.

2. **`buildWarDetailHTML()` extraction** — Pure refactor, no visual change. Once extracted, both `openClassicWarDetail` and `openCercaWarDetail` use it. This is a prerequisite for making war detail work in CWL rounds.

3. **"Il mio clan" sub-tab restructuring** — Add sub-tab bar to `tab-members` in HTML + `switchClanTab()` in app.js. Content (war log, CWL history) already exists; this is structural plumbing only.

4. **`window._viewedClan` global state** — One-line addition to globals, one assignment in `openCercaClan`. Low risk, enables "Cerca" parity with "Il mio clan".

5. **Rankings fix** — Fix `RANK_LOCATIONS` IDs in app.js, verify render-proxy routing. Requires testing against CoC API.

6. **Advanced search filters** — Extend `eseguiCerca()`, `lookup.js`, `render-proxy/index.js`. Three-file change, touched at end to avoid blocking other work.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (single clan, ~30 users) | Monolith is ideal — zero overhead, direct DOM manipulation |
| Multi-clan (hypothetical) | Already partially supported via `clanQ()` — would require Supabase RLS changes, not frontend changes |
| Framework migration (not planned) | The pattern of pure HTML builder functions (`buildWarDetailHTML`) is the step toward component-thinking — makes a future migration easier without requiring one now |

---

## Sources

- Direct inspection of `app.js` (4650 lines, 2026-03-20)
- Direct inspection of `index.html` (742 lines, 2026-03-20)
- `.planning/codebase/ARCHITECTURE.md` — codebase analysis
- `.planning/codebase/STRUCTURE.md` — structure analysis
- `.planning/PROJECT.md` — v2.0 requirements

---

*Architecture research for: CoCBoard v2.0 UI/UX Evolution*
*Researched: 2026-03-20*

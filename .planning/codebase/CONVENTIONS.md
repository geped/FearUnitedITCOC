# Coding Conventions

**Analysis Date:** 2026-03-20

## Naming Patterns

**Files:**
- Serverless functions: `kebab-case.js` (e.g., `clan-members.js`, `sync-members.js`, `generate-bonuses.js`)
- Subdirectory functions: `api/admin/users.js`
- Frontend monolith: `app.js`, `style.css`, `index.html`

**Functions:**
- Frontend render functions: `render` prefix — `renderMembers()`, `renderClanDetails()`, `renderStoricoTable()`
- Frontend load functions: `load` prefix — `loadMembers()`, `loadWarLog()`, `loadCwlHistory()`
- Frontend show/hide functions: `show` prefix — `showApp()`, `showLogin()`, `showSection()`
- Utility/pure functions: descriptive camelCase — `thImgSrc()`, `cocRole()`, `leagueTierNameIt()`, `parseClanTag()`
- Boolean predicates: plain name, not `is`-prefixed — `isNew`, `canEdit`, `isAdmin` (local vars are camelCase)

**Variables:**
- camelCase for local variables: `clanTag`, `proxyUrl`, `serviceKey`
- Module-level state prefixed with `_` underscore: `_clanDetailsLoaded`, `_storicoData`, `_storicoSort`, `_assignMembersMap`
- Global browser state on `window._`: `window._userClanTag`, `window._clanName`, `window._canEdit`
- Constants: SCREAMING_SNAKE_CASE for lookup maps — `COC_ROLES`, `ROLE_ORDER`, `LEAGUE_EN_TO_IT`, `LEAGUE_BADGE_MAP`

**Types / Config Maps:**
- Lookup maps are `const` objects at module or file scope: `COC_ROLE_MAP`, `TAB_TITLES`, `CLAN_TYPE_LABELS`
- No TypeScript — plain JS objects, no JSDoc type annotations

## Code Style

**Formatting:**
- No formatter tooling detected (no `.prettierrc`, no `biome.json`)
- Frontend (`app.js`): 2-space indentation
- Backend (`api/*.js`, `render-proxy/index.js`): 4-space indentation
- Single quotes in backend Node.js; double or single quotes mixed in frontend

**Alignment:**
- Multi-property object literals use aligned spacing in some places:
  ```js
  window._userClanTag    = null;
  window._clanName       = '';
  window._clanBadgeUrl   = null;
  ```
- Row construction objects use aligned colons for readability in `render-proxy/index.js`

**Line length:**
- No enforced limit; some lines exceed 120 characters (especially template literals building HTML)

**Linting:**
- No `.eslintrc` detected — no automated lint enforcement

## Section Separators

Both `app.js` and `render-proxy/index.js` use banner comments to separate logical sections:
```js
// ── SECTION NAME ────────────────────────────────────────────────────────────────
```
Always add a banner comment when starting a new logical section.

## Import Organization

**Backend (api/*.js, render-proxy/index.js):**
- `require()` at top of file, one per line
- `@supabase/supabase-js` always first if present
- No barrel/index files — each API function is a standalone module

**Frontend (app.js):**
- No `import` statements — uses global `window.sb` (Supabase client injected by `supabase-config.js`)
- External resources referenced as bare URLs (CDN or `/api/` path)

## API Function Pattern (Vercel serverless)

Every file in `api/` exports a single async handler:
```js
module.exports = async (req, res) => {
    try {
        // 1. Validate env vars
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: '...' });

        // 2. Validate inputs
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });

        // 3. Do the work
        const response = await fetch(`${proxyUrl}/...`, { headers: { 'x-sync-key': ... } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Errore proxy');

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
```

**Pattern rules:**
- Always `try/catch` the entire handler body
- Early-return with `return res.status(NNN).json(...)` for validation failures
- Throw errors from internal logic; catch at the outer level → `res.status(500).json({ error: err.message })`
- Success response always includes `status(200)` explicit call (or 201 for creation)
- Error payloads always: `{ error: string }`
- Success payloads always include `ok: true` for mutation endpoints

## Express Route Pattern (render-proxy/index.js)

```js
app.get('/route', authMiddleware, async (req, res) => {
    try {
        // validate → fetch CoC API → transform → res.json()
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

- All routes use `authMiddleware` (validates `x-sync-key` header)
- GET routes for reads, POST routes for mutations
- CoC API calls always use `cocHeaders()` helper for the Bearer token
- Tag normalization always goes through `parseClanTag()` + `encodeTag()` before use in URLs

## Error Handling

**Backend:**
- Errors always surfaced as `{ error: string }` JSON
- `err.message` propagated directly to response — no wrapping
- Supabase errors checked after every call: `if (error) throw new Error(error.message)`
- Network errors from CoC API: check `!response.ok`, then `throw new Error(data.error || 'Errore proxy')`
- `console.error()` used only in background/non-critical paths (e.g., email send failure in `register-with-coc.js:125`)

**Frontend:**
- `try/catch` blocks on all async operations
- User-facing errors written to DOM status elements (not `alert()`):
  ```js
  status.textContent = '✗ ' + err.message;   // sync button
  showLoginError(msg);                         // login flow
  ```
- Generic connection error messages in Italian for all network failures
- Silent catch (`catch (_) {}`) used when the failure is non-critical (e.g., fallback clan details, user metadata refresh)

## Comments

**Language:** Italian for business logic comments; English occasionally for technical/structural notes
**Style:** Inline `//` comments on the same line or above
**Section banners:** `// ── SECTION NAME ─────...` (as above)
**Explanatory notes on non-obvious mappings:**
```js
// Nota: nell'API CoC "admin" = Anziano (Elder), NON admin app
```

**When to comment:**
- Non-obvious CoC API quirks (role name mismatches, tag encoding)
- Complex data transformations (CWL aggregation, score calculation)
- Skip explanation not needed for straightforward CRUD

## HTML Generation

Frontend builds UI entirely via template literal strings injected with `.innerHTML`:
```js
const tr = document.createElement('tr');
tr.innerHTML = `
  <td class="col-th-cell">${thImgV(m.th_level)}</td>
  <td class="col-member"><span class="member-name">${m.name}</span></td>
`;
tbody.appendChild(tr);
```

- Use `document.createElement()` + `.innerHTML` for table rows
- Use `div.innerHTML = fullHtmlString` for replacing whole sections
- Escape user-controlled strings: `name.replace(/"/g, '&quot;')` before embedding in attributes

## Async Patterns

**Parallel fetch:** Always use `Promise.all()` when multiple independent requests are needed:
```js
const [lgRes, clanRes] = await Promise.all([
    fetch(`…/leaguegroup`, { headers: cocHeaders() }),
    fetch(`…/clan`,       { headers: cocHeaders() })
]);
```

**Abort controller for timeouts:**
```js
const ctrl = new AbortController();
const tid = setTimeout(() => ctrl.abort(), 10000);
const r = await fetch(url, { signal: ctrl.signal });
clearTimeout(tid);
```

**Supabase queries with chaining:**
```js
const q = db.from('cwl_history').select('*').order('season', { ascending: false });
if (window._userClanTag) q.eq('clan_tag', window._userClanTag);
const { data, error } = await q;
```

## Tag Handling

CoC player/clan tags must always be:
1. Uppercased
2. Prefixed with `#` if missing
3. URL-encoded before use in fetch URLs

Use `parseClanTag(raw)` in `render-proxy/index.js` and `normalizeTag(raw)` in `register-with-coc.js` — same logic.
Frontend uses `clanQ()` to append `?clanTag=...` to all API calls.

## Supabase Usage

**Backend (service role):** Create client with `SUPABASE_SERVICE_ROLE_KEY` for admin operations:
```js
const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});
```

**Backend (standard):** Create client with `SUPABASE_ANON_KEY` for regular data operations

**Frontend:** Use global `window.sb` (the pre-initialized Supabase client from `supabase-config.js`), aliased as `const db = window.sb`

**Upsert pattern:**
```js
const { error } = await supabase.from('table').upsert(rows, { onConflict: 'unique_col' });
if (error) throw new Error(error.message);
```

---

*Convention analysis: 2026-03-20*

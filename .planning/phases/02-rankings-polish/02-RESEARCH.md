# Phase 2: Rankings Polish - Research

**Researched:** 2026-03-20
**Domain:** Clash of Clans API global rankings, browser fetch cache, vanilla JS rendering
**Confidence:** HIGH (root cause identified, code fully audited)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Global rankings root cause (CLAS-01, CLAS-02):** `RANK_LOCATIONS.global = '32000000'` restituisce `notFound` — il fix e' cambiare in `"global"` (stringa). Modificare sia `app.js` (costante) che `render-proxy/index.js` (URL CoC API costruita se il proxy non accetta stringa).
- **TH column (CLAS-05):** Usare `p.townHallLevel` dalla risposta API rankings senza fetch separati. Se il campo manca dopo il fix, mostrare "—" tramite `thImgV()` esistente (gestisce gia' valori falsy). Non aggiungere fetch separati per 50 righe.
- **League badges (CLAS-03):** Il codice gia' prioritizza CDN `p.league?.iconUrls?.small`; il fallback locale `LEAGUE_BADGE_MAP` e' safety net. Non aggiornare file `.png` se CDN funziona.
- **Refresh button (CLAS-06):** Aggiungere `cache: 'no-store'` alla `fetch` in `loadRankings()`. Il render-proxy NON ha caching per `/rankings` — nessuna modifica proxy necessaria.
- **Click handlers (CLAS-07):** Gia' implementati (`onclick="openCercaPlayer(...)"` e `openCercaClan(...)`). Verificare solo encoding del tag `#`.
- **Clan crest (CLAS-04):** Gia' implementato in `_renderRankClans` (`c.badgeUrls?.small`). Si risolve automaticamente con CLAS-02.

### Claude's Discretion

- Scelta del valore corretto del global locationId (verificato: stringa `"global"`)
- Gestione dell'errore HTTP quando locationId non supporta un certo type
- Formato preciso del messaggio di errore se i dati rankings non sono disponibili

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLAS-01 | Classifica "Giocatori + Globale" si carica senza errore `notFound` | Root cause: `RANK_LOCATIONS.global = '32000000'` invalido. Fix: cambiare in stringa `"global"` in `app.js` e aggiornare proxy URL. |
| CLAS-02 | Classifica "Clan + Globale" mostra dati (non "Nessun dato") | Stesso root cause di CLAS-01. La stringa `"global"` vale per entrambi `players` e `clans`. |
| CLAS-03 | Stemmi leghe sono quelli attuali | CDN path gia' implementato e corretto. `LEAGUE_BADGE_MAP` gia' punta a `LeggendaV2.png`. Si verifica dopo CLAS-01/02. |
| CLAS-04 | Tabelle classifiche mostrano clan crest | Gia' implementato in `_renderRankClans`. Si sblocca con CLAS-02. |
| CLAS-05 | Colonna TH mostra livello corretto | `p.townHallLevel` presente nel response rankings CoC API. Si sblocca con CLAS-01. |
| CLAS-06 | Tasto "Aggiorna" forza chiamata fresca | Aggiungere `cache: 'no-store'` alla fetch in `loadRankings()`. |
| CLAS-07 | Click su giocatore/clan apre profilo relativo | Gia' implementato; verificare encoding `#` nel tag. |
</phase_requirements>

---

## Summary

Il problema centrale di Phase 2 e' un singolo ID errato: `RANK_LOCATIONS.global = '32000000'` nella costante di `app.js`. La CoC API v1 accetta la stringa `"global"` (non un ID numerico) per le classifiche mondiali — confermato dalla libreria ufficiale `clashofclans.js` e dalla community. L'endpoint corretto e' `GET /v1/locations/global/rankings/players` e `GET /v1/locations/global/rankings/clans`.

Il proxy `render-proxy/index.js` costruisce l'URL con `encodeURIComponent(locationId)` — la stringa `"global"` viene codificata in `"global"` (nessun carattere speciale), quindi il proxy e' gia' compatibile senza modifiche. La fix e' solo nella costante `app.js`.

Tutti gli altri requirement (CLAS-03 through CLAS-07) sono gia' implementati o si risolvono a cascata: CDN badge gia' prioritizzato, clan crest gia' nel render, click handlers gia' cablati, solo `cache: 'no-store'` manca per CLAS-06.

**Primary recommendation:** Cambiare `'32000000'` in `'global'` in `RANK_LOCATIONS` e aggiungere `cache: 'no-store'` al fetch di `loadRankings()` — le altre modifiche sono verifiche/smoke test.

---

## Standard Stack

### Core (gia' in uso)
| Component | Versione | Scopo | Note |
|-----------|----------|-------|------|
| CoC API v1 | — | Rankings endpoint | `GET /v1/locations/{locationId}/rankings/{type}` |
| Node.js built-in `node:test` | 22.x | Test runner | Zero dipendenze |
| Vanilla JS fetch API | browser | HTTP calls | Da aggiungere `cache: 'no-store'` |

### No new dependencies required
Phase 2 non aggiunge librerie. Tutte le modifiche sono a file esistenti.

---

## Architecture Patterns

### Data Flow Rankings
```
Browser (app.js)
  loadRankings()
    fetch('/api/lookup?type=rankings&rankType={type}&locationId={locId}')
      api/lookup.js (Vercel serverless)
        fetch(RENDER_PROXY_URL + '/rankings?type=...&locationId=...')
          render-proxy/index.js (Render.com)
            fetch('https://api.clashofclans.com/v1/locations/{locId}/rankings/{type}?limit=50')
```

### Pattern 1: LocationId Fix
**What:** Cambiare la costante da ID numerico a stringa `"global"`
**When to use:** Solo per global rankings — Italy usa ancora `'32000094'` (ID numerico valido)
**Example:**
```javascript
// PRIMA (app.js riga 4567) — DA CAMBIARE
const RANK_LOCATIONS = { global: '32000000', italy: '32000094' };

// DOPO
const RANK_LOCATIONS = { global: 'global', italy: '32000094' };
```

### Pattern 2: Cache Bypass
**What:** Aggiungere `cache: 'no-store'` alla fetch di `loadRankings()`
**When to use:** Solo per la chiamata rankings — non applicare globalmente
**Example:**
```javascript
// app.js riga 4589 — aggiungere opzione cache
const r = await fetch(
  `/api/lookup?type=rankings&rankType=${type}&locationId=${locId}`,
  { cache: 'no-store' }
);
```

### Pattern 3: Render-Proxy URL Construction
**What:** Il proxy usa `encodeURIComponent(locationId)` — stringa `"global"` e' safe
**No change needed:** `encodeURIComponent('global')` === `'global'` (nessun carattere speciale)
**render-proxy/index.js riga 620:**
```javascript
const url = `https://api.clashofclans.com/v1/locations/${encodeURIComponent(locationId)}/rankings/${encodeURIComponent(type)}?limit=50`;
// Con locationId = 'global' produce: /v1/locations/global/rankings/players?limit=50
```

### Anti-Patterns to Avoid
- **Fetch separato per TH:** Non aggiungere fetch `/api/lookup?type=player` per ogni riga rankings — 50 fetch in parallelo sovraccaricano il proxy Render.com e il limite Vercel.
- **Aggiornare file `.png` badge:** Non necessario — il CDN `iconUrls.small` funziona quando i dati arrivano.
- **Modificare render-proxy per caching:** Non richiesto per questo phase — il proxy non cachea `/rankings` ed e' corretto cosi'.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TH image rendering | Logica custom inline | `thImgV(p.townHallLevel)` gia' in uso riga 4622 | Gestisce gia' falsy values con `<span class="th-unknown">?</span>` |
| League badge URL | Lookup custom | `p.league?.iconUrls?.small` con fallback `LEAGUE_BADGE_MAP` gia' in `_renderRankPlayers` | Pattern CDN-first gia' implementato riga 4609-4611 |
| Navigation al profilo | Nuove funzioni | `openCercaPlayer(tag)` e `openCercaClan(tag)` gia' cablate | Riga 4613 e 4639 gia' hanno `onclick` |

**Key insight:** La maggior parte di Phase 2 e' gia' implementata correttamente nel codice. Il bug e' solo nel valore di `RANK_LOCATIONS.global`.

---

## Common Pitfalls

### Pitfall 1: Tag Encoding nel Click Handler
**What goes wrong:** `onclick="openCercaPlayer('${p.tag}')"` — se `p.tag` contiene `#` (es. `#ABC123`), l'HTML inline non richiede escaping del `#` ma JavaScript inline potrebbe avere problemi se il tag contiene apostrofi o backslash.
**Why it happens:** I tag CoC iniziano sempre con `#` — e' valido in JS string ma va verificato.
**How to avoid:** Verificare in test che `openCercaPlayer('#ABC123')` funzioni correttamente. Il codice esistente non usa `encodeURIComponent` sul tag nell'onclick.
**Warning signs:** Click su riga rankings apre profilo sbagliato o genera errore JS console.

### Pitfall 2: Render-Proxy Doppio encodeURIComponent
**What goes wrong:** `api/lookup.js` fa `encodeURIComponent(locationId)` quando costruisce il path verso il proxy, e il proxy fa di nuovo `encodeURIComponent(locationId)`. Con ID numerici non e' problema, ma se si passasse un ID con caratteri speciali potrebbe diventare double-encoded.
**Why it happens:** Entrambi i layer sanitizzano l'input indipendentemente.
**How to avoid:** Con `"global"` non ci sono caratteri speciali — il double-encode non e' un problema in questo caso specifico.
**Warning signs:** Non applicabile per `"global"`.

### Pitfall 3: Vercel Limite 12 Functions
**What goes wrong:** Aggiungere un nuovo file in `api/` per gestire rankings separatamente.
**Why it happens:** Istinto di separare concerns.
**How to avoid:** Le rankings passano gia' per `api/lookup.js` — non creare un nuovo file `api/rankings.js`. Il limite e' gia' a 12/12 secondo STATE.md.

### Pitfall 4: `items` Array Vuoto vs Errore
**What goes wrong:** Confondere risposta 200 con `items: []` (nessun dato) vs risposta 404 `notFound`.
**Why it happens:** Il codice esistente gestisce entrambi ma e' utile saperlo.
**How to avoid:** Il flow corretto in `loadRankings()` e' gia' implementato — `throw new Error` su `!r.ok`, poi check `!items.length` separatamente.

---

## Code Examples

### Fix Principale: CLAS-01 e CLAS-02
```javascript
// app.js — RANK_LOCATIONS (riga 4567)
// Source: clashofclans.js docs — "For global ranking, use 'global' as locationId"
const RANK_LOCATIONS = { global: 'global', italy: '32000094' };
```

### Fix CLAS-06: Cache Bypass
```javascript
// app.js — loadRankings() (riga 4589)
const r = await fetch(
  `/api/lookup?type=rankings&rankType=${type}&locationId=${locId}`,
  { cache: 'no-store' }
);
```

### Render Proxy — Nessuna modifica necessaria
```javascript
// render-proxy/index.js riga 620 — gia' funzionante con stringa "global"
const url = `https://api.clashofclans.com/v1/locations/${encodeURIComponent(locationId)}/rankings/${encodeURIComponent(type)}?limit=50`;
// encodeURIComponent('global') === 'global' — nessun carattere speciale
```

### Verifica Tag Encoding (CLAS-07)
```javascript
// I tag CoC hanno sempre '#' — verificare che openCercaPlayer gestisca correttamente
// Esempio: p.tag = '#2J2VLPP9R'
// Il fetch in openCercaPlayer gia' usa encodeURIComponent:
// fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(playerTag)}`)  // riga 4504
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LocationId numerico `32000000` per global | Stringa `"global"` | Da sempre per CoC API v1 | Il fix risolve CLAS-01 e CLAS-02 in una riga |
| Nessun cache control | `cache: 'no-store'` | Best practice da aggiungere | Il tasto Aggiorna funzionerà davvero |

**Nota:** Il locationId `32000000` non e' mai stato valido per global rankings nella CoC API v1. L'endpoint corretto ha sempre usato la stringa letterale `"global"`.

---

## Open Questions

1. **`townHallLevel` nel response rankings**
   - What we know: Il campo e' presente nei response clan members. I wrapper API lo espongono. Il codice lo usa gia' (`p.townHallLevel` riga 4622).
   - What's unclear: Non e' stato possibile verificare con 100% di certezza se il response specifico di `/v1/locations/global/rankings/players` include `townHallLevel` (la documentazione ufficiale non e' accessibile direttamente).
   - Recommendation: CLAS-05 e' marcata come "si risolve automaticamente con il fix rankings" in REQUIREMENTS.md. Se dopo il fix `townHallLevel` e' presente, nessuna azione. Se e' assente, `thImgV(undefined)` ritorna gia' `<span class="th-unknown">?</span>` — nessun crash, solo "?" invece del TH. **Non aggiungere fetch separati.**

2. **CWL league badges nelle classifiche globali**
   - What we know: `LEAGUE_BADGE_MAP` mappa le leghe CWL (Bronze, Silver, Gold, Crystal, Master, Champion, Titan, Legend). Il CDN `iconUrls.small` e' prioritizzato.
   - What's unclear: I giocatori nelle classifiche globali sono in Legend League — verificare che `p.league?.iconUrls?.small` contenga un URL CDN valido una volta che i dati arrivano.
   - Recommendation: Dopo il fix CLAS-01, caricare la classifica globale e ispezionare un item per verificare la struttura `league.iconUrls`. Se CDN funziona, CLAS-03 e' risolto. Se manca, fallback `LEAGUE_BADGE_MAP['Legend League'] = 'LeggendaV2'` e' gia' presente.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (v22.x) |
| Config file | none — runner via `npm test` |
| Quick run command | `node --test tests/*.test.js` |
| Full suite command | `node --test tests/*.test.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLAS-01 | `RANK_LOCATIONS.global` equals `'global'` (stringa) | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 |
| CLAS-02 | Stessa costante di CLAS-01 | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 |
| CLAS-03 | CDN URL prioritizzato su fallback locale | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 |
| CLAS-04 | `c.badgeUrls?.small` usato nel render clans | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 |
| CLAS-05 | `thImgV(undefined)` ritorna span th-unknown | unit | Gia' coperto implicitamente da logica `thImgV` — aggiungere asserzione | ❌ Wave 0 |
| CLAS-06 | fetch include `cache: 'no-store'` | unit/smoke | manual (browser DevTools) | manual-only |
| CLAS-07 | `openCercaPlayer`/`openCercaClan` chiamati onclick | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 |

**Nota:** CLAS-06 e' testabile solo manualmente (browser DevTools Network tab → verificare Request Headers include `Cache-Control: no-store`).

### Sampling Rate
- **Per task commit:** `node --test tests/rankings.test.js`
- **Per wave merge:** `node --test tests/*.test.js`
- **Phase gate:** Full suite green prima di `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/rankings.test.js` — unit test per: valore di `RANK_LOCATIONS.global`, output di `_renderRankPlayers` e `_renderRankClans` con dati mock, `thImgV(undefined)` ritorna `th-unknown`

*(I test esistenti `bonus-calculator.test.js`, `equipment-map.test.js`, `purge-logic.test.js` non coprono il codice rankings.)*

---

## Sources

### Primary (HIGH confidence)
- [clashofclans.js Client docs](https://clashofclans.js.org/docs/api/classes/Client) — confermato: `"global"` come locationId per global rankings
- `app.js` righe 4563-4657 — audit completo del codice classifiche
- `render-proxy/index.js` righe 614-628 — audit endpoint `/rankings`
- `api/lookup.js` — audit bridge Vercel → proxy

### Secondary (MEDIUM confidence)
- WebSearch multi-source — pattern `"global"` come locationId confermato da cocpy docs e clashofclans.js
- [cocpy readthedocs](https://cocpy.readthedocs.io/en/rewrite/api.html) — `get_location_players()` default `location_id='global'`

### Tertiary (LOW confidence — needing validation)
- `townHallLevel` nel response `/v1/locations/global/rankings/players` — non verificabile senza accesso live all'API. Gestita da fallback esistente `thImgV()`.

---

## Metadata

**Confidence breakdown:**
- Root cause (CLAS-01/02): HIGH — stringa `"global"` confermata da libreria ufficiale e community
- Proxy compatibility: HIGH — `encodeURIComponent('global') === 'global'`, nessuna modifica proxy
- CLAS-03/04/07 gia' implementati: HIGH — codice auditato direttamente
- CLAS-06 fix: HIGH — `cache: 'no-store'` e' standard fetch API, nessun proxy change
- `townHallLevel` nel rankings response: MEDIUM — probabile ma non verificato live
- League CDN badge con dati corretti: MEDIUM — pattern CDN gia' implementato, da verificare post-fix

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stabile — API CoC v1 non cambia spesso)

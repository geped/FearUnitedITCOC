# Phase 2: Rankings Polish - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning
**Mode:** Auto (--auto flag — all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

La sezione classifiche è completamente funzionante: classifiche globali caricate senza errori, stemmi leghe corretti, clan crest visibili nelle righe clan, righe cliccabili per aprire profilo, tasto "Aggiorna" forza chiamata fresca all'API.

Requirements in scope: CLAS-01, CLAS-02, CLAS-03, CLAS-04, CLAS-05, CLAS-06, CLAS-07.

</domain>

<decisions>
## Implementation Decisions

### Global rankings root cause (CLAS-01, CLAS-02)
- Il locationId `32000000` restituisce `notFound` per player rankings globali — probabile ID non valido per questo endpoint
- Il researcher deve verificare: `/v1/locations/global/rankings/players` vs `/v1/locations/{id}/rankings/players` vs endpoint dedicato senza locationId
- Il fix va applicato sia in `render-proxy/index.js` (URL CoC API costruita) che in `app.js` (RANK_LOCATIONS.global se l'ID cambia)
- La sezione Italia (`italy: '32000094'`) è il baseline di confronto — se funziona, la differenza è nel global ID

### TH column (CLAS-05)
- Usa `p.townHallLevel` dalla risposta API rankings — nessun lookup separato per TH (troppo lento per 50 righe)
- Se la risposta rankings non include `townHallLevel`, mostrare "—" invece di "?" (già gestito da `thImgV` che ritorna `<span class="th-unknown">?</span>` quando il valore è falsy)
- REQUIREMENTS.md nota: "si risolve automaticamente con il fix rankings" → la priorità è fixare CLAS-01/02; il TH dovrebbe venire con i dati corretti
- Se l'API rankings NON restituisce `townHallLevel` anche dopo il fix, rimuovere la colonna TH dalla tabella player rankings (non aggiungere fetch separati)

### League badges (CLAS-03)
- Il codice in `_renderRankPlayers` già prioritizza CDN `p.league?.iconUrls?.small` prima del fallback locale `leagues/${leagueBadge}.png` — pattern corretto
- `LEAGUE_BADGE_MAP` già punta a `LeggendaV2.png` (versione corretta); `Leggenda.png` (vecchia) è ancora presente in `leagues/` come residuo
- Il researcher deve verificare: (a) se le leghe CWL (Electro League, ecc.) sono mappate correttamente; (b) quali badge CDN vengono serviti nell'API per i giocatori globali attuali
- Se i badge CDN funzionano, non è necessario aggiornare i file locali `.png` — il fallback locale è solo safety net
- CLAS-03 si risolve prevalentemente attraverso il funzionamento corretto del CDN path già implementato

### Refresh button (CLAS-06)
- Aggiungere `cache: 'no-store'` alla fetch in `loadRankings()` per bypassare cache browser
- Il render-proxy NON ha caching per l'endpoint `/rankings` → nessuna modifica lato proxy necessaria
- Il tasto "Aggiorna" (riga 594 `index.html`) chiama già `loadRankings()` direttamente — nessun rewiring necessario

### Click handlers (CLAS-07)
- `_renderRankPlayers` ha già `onclick="openCercaPlayer('${p.tag}')"` su ogni riga — già implementato
- `_renderRankClans` ha già `onclick="openCercaClan('${c.tag}')"` su ogni riga — già implementato
- Verifica che `openCercaPlayer` e `openCercaClan` gestiscano correttamente il contesto "classifica" (tag può includere `#` — verificare encoding)
- Nessuna nuova funzione da aggiungere; se il click non funziona è un bug di encoding tag o di flow navigation

### Clan crest (CLAS-04)
- `_renderRankClans` mostra già `c.badgeUrls?.small` come `<img>` — già implementato
- Se non appare, è perché i dati non caricano (CLAS-02); fix CLAS-02 risolve anche CLAS-04
- Nessuna modifica al rendering richiesta se i dati arrivano correttamente

### Claude's Discretion
- Scelta del valore corretto del global locationId (da verificare con le CoC API docs aggiornate)
- Gestione dell'errore HTTP quando locationId non supporta un certo type (players vs clans potrebbero avere endpoint diversi)
- Formato preciso del messaggio di errore se i dati rankings non sono disponibili

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Codice classifiche esistente
- `app.js` righe 4563-4657 — Tutto il codice ranking: RANK_LOCATIONS, loadRankings(), _renderRankPlayers(), _renderRankClans()
- `app.js` righe 287-296 — LEAGUE_BADGE_MAP (badge leghe → file locale)
- `app.js` righe 582-588 — thImgV() — rendering immagine TH con fallback "?"

### Proxy backend
- `render-proxy/index.js` righe 614-628 — Endpoint /rankings — costruisce URL CoC API con locationId
- `api/lookup.js` — Serverless function Vercel che fa da bridge verso render-proxy per le rankings

### HTML rankings
- `index.html` righe 594-604 — Bottone Aggiorna + toggle Giocatori/Clan/Globale/Italia

### Requisiti
- `.planning/REQUIREMENTS.md` righe 19-25 — CLAS-01 through CLAS-07 con note su root cause
- `.planning/ROADMAP.md` righe 39-48 — Phase 2 success criteria

### Nessuno spec esterno
Le API CoC sono documentate esternamente (docs.clashofclans.com) — il researcher deve verificare l'endpoint corretto per global rankings.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `thImgV(level)` — già usata per rendere il TH in tutti i contesti; riutilizzare as-is per rankings
- `LEAGUE_BADGE_MAP` — mappa statica league name → filename locale; aggiornare solo se badge mancanti
- `openCercaPlayer(tag)` / `openCercaClan(tag)` — funzioni di navigazione già esistenti, wired sulle righe rankings
- `getAssetUrl()` (nuovo in Phase 1) — centralizza URL immagini; le rankings usano ancora logica diretta inline

### Established Patterns
- **API fetch pattern**: `fetch('/api/lookup?type=...&...')` → render-proxy → CoC API; stessa chain per rankings
- **Error handling rankings**: `catch(e) => el.innerHTML = \`<div class="cerca-error">Errore: ${e.message}</div>\`` — già presente
- **CDN + local fallback**: priorità CDN `iconUrls.small`, fallback `leagues/filename.png` — pattern già in uso in `_renderRankPlayers`
- **Loading spinner**: `'<div class="profilo-loading" ...><div class="spinner"></div>...'` — pattern standard per loading states

### Integration Points
- `loadRankings()` in `app.js` è il punto di ingresso — modificare solo qui + `RANK_LOCATIONS` se il locationId cambia
- render-proxy `/rankings` endpoint — l'URL CoC API va corretta qui se il path cambia
- `RANK_LOCATIONS.global` — se il locationId cambia, aggiornare solo questa costante in `app.js`

### Known Issues (da code scout)
- `RANK_LOCATIONS.global = '32000000'` — potenzialmente non valido per player rankings globali (restituisce notFound)
- `_renderRankClans` non ha colonna TH (corretto — le classifiche clan non hanno TH)
- `_renderRankPlayers` usa `p.townHallLevel` — il researcher deve verificare se questo campo è incluso nella risposta dell'API rankings o se è solo nella risposta del player profile

</code_context>

<specifics>
## Specific Ideas

- Dal STATE.md: "Dopo il fix locationId verificare GET /v1/locations/global/rankings/players in produzione" — questo è il punto di verifica principale
- Da PIANO_STRATEGICO.md: "Risolvere l'errore `notFound` per 'Giocatori + Globale'. Risolvere 'Nessun dato' per 'Clan + Globale'. Verificare il proxy backend per questi endpoint specifici."
- Da PIANO_STRATEGICO.md: "Rendere cliccabili i nomi dei giocatori/clan nelle classifiche" — già implementato nel codice; verificare che funzioni
- La classifica Italia funziona (locationId `32000094`) — confrontarla con il global per isolare il problema

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-rankings-polish*
*Context gathered: 2026-03-20*

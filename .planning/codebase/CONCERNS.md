# Codebase Concerns

**Analysis Date:** 2026-03-20 (aggiornato post-fix 16 criticità — 2026-03-20)

---

## Legenda stato

- ✅ **RISOLTO** — fix applicato e deployato
- ⚠️ **PARZIALE** — mitigato ma non eliminato
- 🔴 **APERTO** — ancora da affrontare

---

## Tech Debt

**Monolith app.js (4650 righe):** 🔴 APERTO (debito tecnico noto, bassa priorità)
- Aggiunto indice sezioni in testa al file per navigazione
- Non è stato spezzato — richiede pianificazione dedicata per non rompere funzionalità
- Fix approach: Estrarre progressivamente in moduli ES6 seguendo la separazione proposta in `ANALISI_CRITICITA_COCBARD.md`

**Duplicazione boilerplate nelle API Vercel:** ✅ RISOLTO
- `api/_utils/proxy-client.js` creato con `proxyFetch(res, path, params)`
- `clan-info.js`, `clan-members.js`, `cwl-stats.js`, `war-log.js` usano ora `proxyFetch`
- Duplication % scesa da 11.59% a ~3%

**`generate-bonuses.js` calcola sempre score = 0:** ✅ RISOLTO
- L'endpoint ora legge dati reali da `cwl_history` per la stagione corrente
- Formula allineata a quella di `app.js` Bonus Manager

**render-proxy usa ANON_KEY invece di SERVICE_ROLE_KEY:** ✅ RISOLTO
- `render-proxy/index.js` usa `SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` configurata come env var su Render.com

**Schema frammentato in 8+ file SQL:** ✅ RISOLTO
- `schema-MASTER.sql` creato con tutti gli script nell'ordine corretto di applicazione
- I file individuali restano per riferimento storico

**style.css monolitico (3224 righe):** 🔴 APERTO (debito tecnico noto, bassa priorità)
- Invariato — richiede bundler o lavoro di separazione dedicato

---

## Security Considerations

**ANON_KEY hardcoded nel frontend:** ⚠️ PARZIALE
- La chiave è pubblica per design in Supabase — il rischio dipende dalle policy RLS
- Policy RLS aggiornate per limitare danni

**Policy RLS `anon` troppo permissive:** ✅ RISOLTO
- `cwl_bonuses`: policy `anon_bonuses` limitata a SELECT-only via `schema-security-rls.sql`
- `members`: write solo via render-proxy con SERVICE_ROLE_KEY; policy anon ridotta
- Migration: `schema-security-rls.sql` + `schema-security-rls-v2.sql` eseguiti su Supabase

**`/api/admin/users` senza verifica ruolo:** ✅ RISOLTO
- `requireRole(req, ['admin'])` aggiunto all'inizio dell'handler
- Verifica JWT + `user_metadata.role === 'admin'`

**`/api/import-bonus` senza autenticazione:** ✅ RISOLTO
- Header `x-sync-key` verificato contro `process.env.SYNC_SECRET`
- Rifiuta con 401 se secret mancante o non corrispondente

**Endpoint debug `/debug-league` esposto:** ⚠️ PARZIALE
- Protetto da `authMiddleware` (x-sync-key) — non accessibile pubblicamente
- Da rimuovere in futuro quando non più necessario

**`purge-ex-players.js` bypass auth se nessun secret configurato:** ✅ RISOLTO
- Logica corretta: se nessun secret è configurato, rifiuta con 401
- Pattern: `if (!cronSecret && !syncSecret) return 401`

---

## Performance Bottlenecks

**`getCwlStats` fa N+2 fetch sequenziali:** 🔴 APERTO
- Le fetch sono già parallelizzate con `Promise.all`
- Cache in-memory non implementata
- Mitigazione futura: `node-cache` o Map con TTL 5min nel render-proxy

**`purge-ex-players.js` carica tutta `cwl_history` in memoria:** 🔴 APERTO
- Ancora presente — aggregazione in-memory in JavaScript
- Mitigazione futura: query SQL aggregata `MAX(season) GROUP BY player_name, clan_tag`

**`register-with-coc.js` preflight check con `listUsers`:** ✅ RISOLTO
- Rimosso `listUsers({perPage: 1000})`
- L'errore "email duplicata" viene ora catturato direttamente dalla risposta di `createUser`

**Render.com cold start ~30s:** ⚠️ PARZIALE
- `GET /health` endpoint aggiunto al render-proxy
- `api/sync-members.js` esegue warm-up fire-and-forget prima della sync giornaliera
- Il cold start può ancora avvenire se non ci sono richieste per più di 15min fuori dal cron
- Mitigazione completa: piano Render a pagamento (non gratuito)

---

## Fragile Areas

**Identificazione guerra CWL tramite `warType` field:** 🔴 APERTO
- Invariato — tre euristiche fragili
- Nessun test automatico

**Alias giocatori risolti solo lato client:** 🔴 APERTO
- `purge-ex-players.js` non usa la logica alias di `app.js`
- Un giocatore che cambia nome potrebbe essere purgato erroneamente
- Nessun test automatico

**Bonus CWL salvati per `player_name` (stringa), non per `tag`:** 🔴 APERTO
- UNIQUE constraint su `(player_name, season, clan_tag)` — fragile su cambi nome
- Nessuna migrazione pianificata

**`window._warLogItems` come stato globale:** ✅ RISOLTO
- Sostituito con `window._warLogMap` keyed by `endTime`
- `openClassicWarDetail` ora usa la chiave `endTime` come lookup, non un indice numerico

---

## Known Bugs (stato)

**Calcolo distruzione incoerente:** ✅ RISOLTO
- `renderCwlTable()` ora mostra la media per attacco (`destruction / attacks_made`)
- Header colonna aggiornato a "💥 Distruz. media"

**`saveAssignChanges` salva stelle/distruz./attacchi sempre a 0:** ✅ RISOLTO
- `buildAssignRow()` ora aggiunge attributi `data-stars`, `data-destruction`, `data-attacks-made`, `data-attacks-required`, `data-bonus-score`, `data-participated` ai checkbox
- `saveAssignChanges()` legge da `cb.dataset` invece di hardcodare zero

**Login fallback dual-domain silenzioso:** ✅ RISOLTO
- Se entrambi i tentativi falliscono, viene mostrato l'errore più recente (secondo tentativo)
- Aggiunto controllo `includes('invalid')` per messaggi d'errore Supabase

---

## Missing Critical Features (stato)

**Autenticazione su endpoint admin:** ✅ RISOLTO
- `/api/admin/users`: `requireRole(['admin'])` via JWT
- `/api/import-bonus`: header `x-sync-key` verificato
- `/api/generate-bonuses`: richiede autenticazione

**Nessun caching nel render-proxy:** 🔴 APERTO
- Cache in-memory non implementata — ogni `/cwl-live` genera fino a 30 fetch alla CoC API

**Import bonus da Excel manuale:** 🔴 APERTO
- Il flusso Python → JSON → `/api/import-bonus` è ancora manuale
- Nessuna UI integrata per l'import

---

## Test Coverage (stato)

**Zero coverage → coverage parziale:** ✅ PARZIALE
- 11 test unitari aggiunti in `tests/`
- Formula bonus CWL: 6 test ✓
- Logica purge: 5 test ✓
- Aree critiche ancora senza test: proxy fetch chain, auth middleware, tag normalization

---

## Dependencies at Risk (stato)

**Firebase legacy:** ✅ RISOLTO
- `firebase-config.js`, `functions/`, `.firebaserc` rimossi dal repository

**Render.com piano gratuito:** ⚠️ PARZIALE
- Warm-up implementato (cron giornaliero + endpoint /health)
- Cold start ancora possibile dopo 15min di inattività
- Soluzione definitiva: upgrade piano Render o migrazione su Vercel Edge Functions

---

*Concerns audit: 2026-03-20 — aggiornato post-fix 16 criticità*

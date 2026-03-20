# Codebase Concerns

**Analysis Date:** 2026-03-20

---

## Tech Debt

**Monolith app.js (4597 righe):**
- Issue: Tutta la logica SPA — gestione stato, manipolazione DOM, chiamate API, calcolo bonus, navigazione, rendering tabelle — è nello stesso file senza moduli. Variabili globali (`window._userClanTag`, `window._userRole`, `window._canEdit`, `window._warLogItems`, `bmCandidates`, `bmSelections`) creano dipendenze implicite tra sezioni non correlate.
- Files: `app.js`
- Impact: Modificare la logica bonus (righe ~850–2070) può rompere il rendering dei membri o la navigazione. Difficile testare funzioni singole. Debug lento perché lo scope globale è condiviso.
- Fix approach: Estrarre progressivamente in moduli ES6 seguendo la separazione proposta in `ANALISI_CRITICITA_COCBARD.md` — `js/services/api-service.js`, `js/logic/bonus-calculator.js`, `js/ui/table-generator.js`. Non riscrivere tutto in una volta.

**Duplicazione boilerplate nelle API Vercel:**
- Issue: Ogni file in `api/` implementa autonomamente il pattern fetch-verso-proxy: stesso controllo `RENDER_PROXY_URL`, stesso header `x-sync-key`, stesso catch generico. Identificato da jscpd come 11.59% duplicazione.
- Files: `api/clan-info.js`, `api/clan-members.js`, `api/cwl-stats.js`, `api/war-log.js`, `api/sync-members.js`, `api/auto-save-wars.js`
- Impact: Se l'URL del proxy o il meccanismo di autenticazione cambia, bisogna modificare 6+ file. Alto rischio di dimenticare un file e creare comportamenti inconsistenti.
- Fix approach: Creare `api/_utils/proxy-client.js` che esporta una funzione `proxyFetch(path, options)`. Tutti gli endpoint la importano.

**generate-bonuses.js calcola sempre score = 0:**
- Issue: `api/generate-bonuses.js` inizializza `stats` come `{ stars: 0, destructionPercentage: 0, attacksMade: 0, attacksRequired: 0 }` hardcoded (righe 26–27), ignorando completamente i dati reali CWL. Il calcolo del merito produce sempre 0 per ogni membro.
- Files: `api/generate-bonuses.js`
- Impact: L'endpoint `/api/generate-bonuses` è di fatto non funzionale per il ranking reale. Il calcolo bonus avviene invece lato client in `app.js` tramite i dati live dalla CWL. L'endpoint serverless è un placeholder non completo.
- Fix approach: Connettere l'endpoint ai dati CWL live (via render-proxy `/cwl-live`) prima di calcolare il merito, oppure rimuovere l'endpoint se il calcolo avviene solo lato client.

**render-proxy usa ANON_KEY invece di SERVICE_ROLE_KEY:**
- Issue: La funzione `supabase()` in `render-proxy/index.js` (riga 18) crea il client con `SUPABASE_ANON_KEY`. Il proxy scrive su Supabase (tabelle `members`, `classic_wars`, `cwl_seasons`) usando una chiave che rispetta le policy RLS. Finché le policy consentono `anon` di scrivere (come in `schema.sql` righe 26–33 che hanno policy `anon_members` per ALL), funziona — ma è una superficie di attacco.
- Files: `render-proxy/index.js`, `schema.sql`
- Impact: Le operazioni di scrittura dal proxy non sono autenticate come service role. Se qualcuno ottiene la ANON_KEY (esposta in `supabase-config.js` nel frontend) potrebbe chiamare le stesse API Supabase direttamente, bypassando il proxy.
- Fix approach: Il proxy dovrebbe usare `SUPABASE_SERVICE_ROLE_KEY` per le scritture, e le policy RLS sulle tabelle `members` e `classic_wars` dovrebbero essere più restrittive (solo service role in scrittura).

**Schema frammentato in 8 file SQL senza ordine di applicazione:**
- Issue: Le migrazioni sono in 8 file separati (`schema.sql`, `schema-update.sql`, `schema-cwl.sql`, `schema-bonus.sql`, `schema-multiclan.sql`, `schema-retention.sql`, `schema-league.sql`, `schema-classic-wars.sql`) senza numerazione o documentazione dell'ordine di esecuzione.
- Files: `schema*.sql`
- Impact: Setup da zero di un nuovo ambiente Supabase richiede di dedurre l'ordine corretto. Alcuni file fanno `ALTER TABLE` su tabelle create da altri file. Applicarli nell'ordine sbagliato causa errori.
- Fix approach: Creare un file `schema-MASTER.sql` che applica tutto nell'ordine corretto, o adottare uno strumento di migrazioni (es. Supabase migrations CLI).

**style.css monolitico (3224 righe):**
- Issue: Tutti gli stili — layout, componenti, tabelle bonus, profilo, war detail modal, CWL rounds — sono in un unico file senza sezioni chiaramente delimitate. Selettori come `.wdm-*`, `.cdm-*`, `.assign-*` sono intercalati senza raggruppamento per feature.
- Files: `style.css`
- Impact: Alta probabilità di selettori inutilizzati o sovrascritti. Difficile trovare stili specifici senza ricerca testuale.
- Fix approach: Dividere in file per feature se si adotta un bundler, oppure aggiungere marcatori di sezione `/* ── FEATURE NAME ─── */` consistenti.

---

## Security Considerations

**ANON_KEY hardcoded nel frontend (commit-safe ma pubblica):**
- Risk: `supabase-config.js` contiene la `SUPABASE_ANON_KEY` hardcoded (riga 2) e committata nel repository. La chiave è visibile a chiunque acceda al sorgente del sito o al repo git.
- Files: `supabase-config.js`
- Current mitigation: La ANON_KEY di Supabase è per design pubblica — protegge solo tramite RLS. Il rischio reale dipende dalle policy RLS attive.
- Recommendations: Verificare che tutte le policy RLS nelle tabelle sensibili (`cwl_history`, `cwl_bonuses`, `members`) blocchino scritture da `anon`. Attualmente `schema.sql` ha policy `anon_members FOR ALL ... WITH CHECK (true)` che permette a chiunque di scrivere nella tabella `members` senza autenticazione.

**Policy RLS troppo permissive per anon:**
- Risk: `schema.sql` crea policy `anon_members` e `anon_bonuses` che consentono `FOR ALL` (lettura E scrittura) agli utenti anonimi su `members` e `cwl_bonuses`.
- Files: `schema.sql` (righe 26–33)
- Current mitigation: Nessuna — chiunque con la ANON_KEY (pubblica) può inserire/modificare/cancellare membri e bonus senza autenticarsi.
- Recommendations: Rimuovere le policy `anon` di scrittura. Mantenere solo lettura per `authenticated`. Le scritture dovrebbero avvenire solo tramite service role (render-proxy o funzioni Vercel con service key).

**`/api/admin/users` non ha controllo del ruolo chiamante:**
- Risk: L'endpoint `api/admin/users.js` verifica solo che `SUPABASE_SERVICE_ROLE_KEY` sia configurata, ma non verifica che l'utente che fa la richiesta sia effettivamente admin. Qualunque utente autenticato che conosce l'endpoint può chiamarlo.
- Files: `api/admin/users.js`
- Current mitigation: L'endpoint non è accessibile pubblicamente (richiede conoscenza dell'URL), ma non c'è autenticazione a livello API.
- Recommendations: Aggiungere verifica del JWT dell'utente chiamante e controllo `user_metadata.role === 'admin'` prima di eseguire operazioni admin.

**`/api/import-bonus` non ha autenticazione:**
- Risk: `api/import-bonus.js` accetta qualsiasi array di righe e le fa upsert in `cwl_history` senza verificare il ruolo dell'utente chiamante.
- Files: `api/import-bonus.js`
- Current mitigation: Nessuna — chiunque possa fare una POST a `/api/import-bonus` con la struttura dati corretta può sovrascrivere lo storico CWL.
- Recommendations: Aggiungere middleware di autenticazione che verifica JWT e ruolo `admin` o `capo`.

**Endpoint debug `/debug-league` esposto in produzione:**
- Risk: `render-proxy/index.js` espone `/debug-league` (riga 552) con commento "Endpoint debug temporaneo". Restituisce dati raw sui primi 5 membri del clan, utile per ricognizione.
- Files: `render-proxy/index.js` (righe 551–575)
- Current mitigation: Protetto da `authMiddleware` (header `x-sync-key`), quindi non accessibile pubblicamente.
- Recommendations: Rimuovere l'endpoint ora che il campo `leagueTier` è stato correttamente mappato.

**`purge-ex-players.js` ha logica di bypass auth:**
- Risk: Righe 18–24 in `api/purge-ex-players.js`: se né `CRON_SECRET` né `SYNC_SECRET` sono configurate, l'endpoint lascia passare qualsiasi richiesta ("Solo in sviluppo"). In un ambiente mal configurato, chiunque può eseguire un purge massiccio dei dati.
- Files: `api/purge-ex-players.js` (righe 18–24)
- Current mitigation: In produzione entrambe le variabili sono configurate su Vercel.
- Recommendations: Rimuovere il bypass "sviluppo". Se nessun secret è configurato, rifiutare sempre con 401.

---

## Performance Bottlenecks

**`getCwlStats` fa N+2 fetch sequenziali:**
- Problem: In `render-proxy/index.js`, `getCwlStats` fa prima 2 fetch in parallelo (leaguegroup + clan info), poi fino a 35 fetch in parallelo per tutte le guerre del gruppo CWL (`Promise.all(warTags.map(...))`). Con 8 clan e 7 round = fino a ~28 fetch alla CoC API in parallelo.
- Files: `render-proxy/index.js` (righe 137–329)
- Cause: La CoC API non ha un endpoint aggregato per le statistiche CWL complete. Le fetch sono già parallelizzate, ma il volume è alto.
- Improvement path: Aggiungere un layer di cache in-memory nel proxy (es. `node-cache` o un semplice Map con TTL di 5 minuti) per evitare di rifetchare lo stesso leaguegroup più volte per richieste ravvicinate.

**`purge-ex-players.js` carica tutta `cwl_history` in memoria:**
- Problem: Il purge scarica l'intera tabella `cwl_history` (riga 37: `select('clan_tag, player_name, season, still_in_clan')` senza filtri) per calcolare l'ultima stagione attiva di ogni giocatore. Con molti clan e stagioni, questo diventa un full table scan.
- Files: `api/purge-ex-players.js` (righe 36–42)
- Cause: Logica di aggregazione fatta in-memory in JavaScript invece che in SQL.
- Improvement path: Riscrivere con una query SQL aggregata: `SELECT clan_tag, player_name, MAX(season) as last_active FROM cwl_history WHERE still_in_clan = true GROUP BY clan_tag, player_name`.

**`register-with-coc.js` fa `listUsers({perPage: 1000})` ad ogni registrazione:**
- Problem: Per verificare se un'email esiste già, `api/register-with-coc.js` (riga 76) carica fino a 1000 utenti in memoria e fa un `.some()` in JS. Non scala con molti utenti.
- Files: `api/register-with-coc.js` (riga 76)
- Cause: Mancanza di un metodo diretto per cercare un utente per email nella Supabase Admin API usata qui.
- Improvement path: Usare `supabase.auth.admin.listUsers()` con filtro email se l'API lo supporta, oppure catturare l'errore `email already exists` nel `createUser` invece di fare un preflight check.

**Render.com cold start provoca timeout utente:**
- Problem: Il proxy su Render.com (piano gratuito) va in sleep dopo inattività. Il war log nel frontend ha un timeout di 10s (`AbortController`, riga 2405 di `app.js`) con messaggio di cold start ~30s. L'UX è degradata ogni volta che il proxy è freddo.
- Files: `app.js` (righe 2403–2416), `render-proxy/index.js`
- Cause: Piano gratuito Render con spin-down automatico.
- Improvement path: Aggiungere un cron di "keep-alive" che pinga il proxy ogni 14 minuti, oppure aggiornare a un piano Render a pagamento.

---

## Fragile Areas

**Identificazione guerra CWL tramite `warType` field:**
- Files: `app.js` (righe 2417–2426)
- Why fragile: Il filtro per escludere CWL dal war log classico usa tre euristiche: `warType === 'cwl'`, assenza di `opponent.name`, e stelle > `teamSize * 3`. Se la CoC API cambia il formato di risposta o aggiunge nuovi tipi di guerra, il filtro potrebbe includere/escludere erroneamente.
- Safe modification: Aggiungere test sui 3 criteri separatamente. Loggare in console i tipi guerra trovati per monitorare cambiamenti API.
- Test coverage: Nessun test automatico.

**Alias giocatori risolti solo lato client:**
- Files: `app.js` (funzioni `resolveMember`, `getCanonicalName`, `isCurrentMember`, righe ~823–860)
- Why fragile: La logica di matching alias (gestione cambi nome) è implementata solo in `app.js`. Il purge in `api/purge-ex-players.js` confronta `members.name` con `cwl_history.player_name` senza alias — un giocatore che ha cambiato nome potrebbe essere considerato "ex" dal purge anche se è ancora nel clan.
- Safe modification: Qualsiasi modifica alla logica alias deve essere replicata anche nel purge serverless.
- Test coverage: Nessun test automatico.

**Bonus CWL salvati per `player_name` (stringa), non per `tag`:**
- Files: `cwl_history` table, `app.js` (funzione `saveAssignChanges`, riga 1275), `api/import-bonus.js`
- Why fragile: La tabella `cwl_history` usa `player_name` come chiave business (UNIQUE con `season, clan_tag`). I nomi in CoC possono essere cambiati dai giocatori e contengono caratteri speciali (es. `♤Aman♤`). Il sistema alias è la workaround, ma è manual-only.
- Safe modification: Non modificare il constraint UNIQUE senza migrazione completa. Aggiungere un `player_tag` opzionale come campo di supporto per future riconciliazioni.
- Test coverage: Nessun test automatico.

**`window._warLogItems` come stato globale per war detail:**
- Files: `app.js` (riga 2429, funzione `openClassicWarDetail`)
- Why fragile: La funzione `openClassicWarDetail(idx)` legge da `window._warLogItems[idx]`. Se `loadWarLog()` viene chiamata mentre un modale è aperto, l'array viene rimpiazzato e l'indice `idx` potrebbe riferirsi a una guerra diversa.
- Safe modification: Passare l'intero oggetto guerra al modale invece dell'indice.
- Test coverage: Nessun test automatico.

---

## Known Bugs

**Calcolo distruzione storico usa totale invece di media:**
- Symptoms: Nella tab Assegna Bonus (sezione ex-player), la colonna "Distruz." mostra `avgD = (destr / atkMade).toFixed(1) + '%'` (riga 1214 di `app.js`), ma in altre sezioni (tab Storico, Hall of Fame) la stessa variabile `destruction` viene accumulata come somma per stagione. L'interpretazione del campo non è coerente tra sezioni.
- Files: `app.js` (righe ~700–720 per Storico, ~1213 per ex-player section)
- Trigger: Visibile quando un giocatore ha fatto più di 1 attacco in una stagione.
- Workaround: Nessuno — l'utente deve conoscere il contesto per interpretare correttamente il dato.

**`saveAssignChanges` salva sempre `stars: 0, destruction: 0.0, attacks_made: 0`:**
- Symptoms: Quando si salvano le assegnazioni bonus dalla tabella "Assegna" (non dal modal Bonus Manager), i dati performance vengono salvati come tutti zero (righe 1281–1284 di `app.js`).
- Files: `app.js` (funzione `saveAssignChanges`, righe 1264–1306)
- Trigger: Ogni salvataggio manuale dalla tab Assegna.
- Workaround: Usare il Bonus Manager (modal) che legge i dati live CWL prima di salvare.

**Login fallback dual-domain silenzioso su errore:**
- Symptoms: In `app.js` righe 56–59, se il login con `@cocboard.internal` fallisce, viene tentato automaticamente con `@fearunited.internal`. Se entrambi falliscono, viene mostrato solo l'errore del primo tentativo. L'utente non sa che sono stati fatti due tentativi distinti.
- Files: `app.js` (righe 54–68)
- Trigger: Utente con account legacy `@fearunited.internal` che riceve errore criptico se la password è sbagliata su entrambi.
- Workaround: Nessuno.

---

## Missing Critical Features

**Nessuna autenticazione sugli endpoint Vercel admin:**
- Problem: `/api/admin/users`, `/api/import-bonus`, `/api/generate-bonuses` non verificano l'identità o il ruolo del chiamante. La protezione è affidata esclusivamente alla security-through-obscurity dell'URL.
- Blocks: Sicurezza reale per operazioni privilegiate.

**Nessun caching nel render-proxy:**
- Problem: Ogni richiesta a `/cwl-live` genera fino a 30 fetch alla CoC API. Non c'è cache né rate limiting.
- Blocks: Scalabilità anche con un solo clan. Con più clan il rischio di rate limit CoC API aumenta significativamente.

**Import bonus da Excel è manuale e fragile:**
- Problem: Il flusso `import_bonus.py` → `excel_data.json` → `/api/import-bonus` è documentato solo implicitamente dai file `read_excel*.py` nella root. Non c'è UI integrata per l'import; richiede esecuzione locale di script Python.
- Files: `read_excel.py`, `read_excel2.py`, `read_excel3.py`, `import_bonus.py`, `api/import-bonus.js`
- Blocks: Autonomia operativa — chi non sa usare Python non può importare dati storici.

---

## Test Coverage Gaps

**Nessun test automatico — zero coverage:**
- What's not tested: Tutto. Non esistono file `*.test.*` o `*.spec.*`. Non esiste configurazione Jest, Vitest o altro test runner.
- Files: Intero progetto
- Risk: Regressioni silenziose su calcolo bonus, logica alias, filtro war log CWL/classica, autenticazione.
- Priority: High

**Calcolo bonus CWL non è una funzione pura testabile:**
- What's not tested: La formula `score = (stelle × 100) + destruction% - (attacchi_mancati × 500)` è implementata sia in `api/generate-bonuses.js` (funzione `calculateMerit`, righe 8–15) che in forma diversa in `app.js` (merit score nel Bonus Manager, righe 1944–1946). Le due implementazioni producono risultati diversi e non sono confrontabili.
- Files: `api/generate-bonuses.js` (righe 8–15), `app.js` (riga 1944)
- Risk: Bug nel calcolo bonus passa inosservato.
- Priority: High

**Logica purge ex-player non testata:**
- What's not tested: La funzione in `api/purge-ex-players.js` cancella dati in modo permanente. Non ci sono test per il calcolo della data di scadenza, per il matching alias, o per la logica di esclusione membri attivi.
- Files: `api/purge-ex-players.js`
- Risk: Cancellazione accidentale di dati di giocatori ancora attivi con nome cambiato.
- Priority: High

---

## Dependencies at Risk

**Firebase legacy ancora presente:**
- Risk: `firebase-config.js` e la directory `functions/` sono ancora nel repo. Le dipendenze Firebase sono potenzialmente ancora installate localmente.
- Files: `firebase-config.js`, `functions/`
- Impact: Confusione per chi lavora al codice — non è chiaro cosa è attivo e cosa è dismesso. Superficie di attacco aumentata se le config Firebase contengono credenziali.
- Migration plan: Rimuovere `firebase-config.js`, `functions/`, `.firebaserc` e qualsiasi dipendenza Firebase da `package.json`.

**Render.com piano gratuito:**
- Risk: Il piano gratuito di Render.com ha limitazioni di uptime (spin-down dopo 15min di inattività) e potrebbe essere deprecato o modificato.
- Impact: Cold start di ~30 secondi degrada l'UX ogni volta che il proxy è inattivo. Se Render cambia le politiche del piano gratuito, il proxy smette di funzionare.
- Migration plan: Migrare la logica del proxy su Vercel Edge Functions (stesso provider del frontend) o aggiornare a un piano Render a pagamento.

---

*Concerns audit: 2026-03-20*

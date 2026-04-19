# CoCBoard — CLAUDE.md

## Panoramica Progetto

Dashboard web + bot Telegram per la gestione del clan Clash of Clans.
Funzionalità principali: sincronizzazione membri, calcolo bonus CWL, storico performance, gestione utenti, community (chat globale + reclutamento), supporto ticket, notifiche guerre in tempo reale, Mini App Telegram.
UI in italiano, single-page application vanilla JS.

---

## Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Frontend | HTML5 / CSS3 / Vanilla JavaScript (no framework) |
| Database | Supabase (PostgreSQL) |
| Serverless API | Vercel (Node.js), Hobby plan — limite 12 functions |
| Backend unificato | Render.com (Express) — **servizio unico** `cocboard`: proxy CoC API + bot Telegram sullo stesso processo. Piano gratuito, cold start ~30s, deploy automatico da push. |
| Auth | Supabase Auth con metadati custom (role, username, coc_tag, coc_clan_tag) |
| API esterna | Clash of Clans API v1 |
| Test | Node.js built-in `node:test` (zero dipendenze) |

---

## Struttura Directory

```
├── index.html                # UI markup
├── app.js                    # Logica applicazione (monolitico — non spezzare)
├── style.css                 # Stili
├── supabase-config.js        # Init client Supabase (lato client)
├── vercel.json               # Config Vercel + cron jobs
│
├── api/                      # Serverless functions Vercel (max 12)
│   ├── _utils/
│   │   ├── proxy-client.js   # Helper proxyFetch() condiviso tra endpoints
│   │   └── require-role.js   # Middleware auth JWT + verifica ruolo
│   ├── admin/users.js        # CRUD utenti (solo admin — verifica ruolo JWT)
│   ├── auto-save-wars.js     # Cron salvataggio automatico guerre + CWL (20:00 UTC)
│   ├── clan-info.js          # Info clan (via proxy)
│   ├── clan-members.js       # Lista membri live (via proxy)
│   ├── cwl-stats.js          # Stats CWL live (via proxy)
│   ├── generate-bonuses.js   # Calcolo e salvataggio bonus (legge cwl_history)
│   ├── import-bonus.js       # Import bonus da Excel (richiede SYNC_SECRET)
│   ├── lookup.js             # Player lookup, clan search, rankings, telegram-handoff (via proxy)
│   ├── purge-ex-players.js   # Cron pulizia ex-membri (1° del mese 7:00 UTC)
│   ├── register-with-coc.js  # Registrazione tramite chiave API in-game CoC
│   ├── sync-members.js       # Sync membri (cron giornaliero 6:00 UTC)
│   └── war-log.js            # Log guerre (via proxy)
│
├── render-proxy/             # Backend Express su Render.com
│   └── index.js              # Proxy CoC API con caching
│
├── telegram-bot/             # Bot Telegram (servizio Render separato)
│   ├── index.js              # Entry point: Express + Telegraf (~5100 righe)
│   ├── package.json
│   ├── lib/
│   │   ├── access.js             # Rate limit + TELEGRAM_ALLOWED_IDS
│   │   ├── auth-resolve.js       # Risoluzione email login (allineata ad app.js)
│   │   ├── bonus-assistant.js    # Wizard assistito assegnazione bonus
│   │   ├── cocboard-api.js       # Client HTTP verso api/ Vercel
│   │   ├── community-handlers.js # Chat globale + reclutamento (callback comm_*)
│   │   ├── community-validation.js # Validazione messaggi globali, rate limit, epoch
│   │   ├── format.js             # Formattazione HTML Telegram per tutti i menu
│   │   ├── private-ui-cleanup.js # Pulizia bolle UI in chat privata
│   │   ├── supabase.js           # Tutte le query DB (service_role + anon)
│   │   ├── supabase-community.js # Query DB per community (chat globale, reclutamento)
│   │   ├── telegram-auth.js      # Login/registrazione Supabase Auth via bot
│   │   └── telegram-html.js      # Conversione entities Telegram → HTML
│   ├── schema-telegram-links.sql
│   ├── schema-community-chat.sql
│   ├── schema-community-subscriber-rpc.sql
│   ├── schema-global-share-moderation.sql
│   ├── schema-telegram-chat-links.sql
│   ├── schema-support-tickets-ensure.sql
│   ├── schema-telegram-moderators.sql
│   ├── README.md
│   └── DEPLOY-COCBOARD-BOT.md
│
├── tests/                    # Test Node.js built-in
│   ├── bonus-calculator.test.js
│   ├── purge-logic.test.js
│   └── ... (altri file test)
│
├── leagues/                  # Badge immagini leghe CWL
├── th/                       # Icone Town Hall (level_01–18 .webp, webp/ per le copie)
│
├── schema-MASTER.sql         # Schema unificato sito — applica tutto nell'ordine corretto
└── schema*.sql               # File di migrazione individuali (per riferimento)
```

---

## Database Supabase

### Tabelle sito (schema-MASTER.sql)

| Tabella | Scopo |
|---------|-------|
| `members` | Roster attuale clan (PK: `tag`) |
| `cwl_bonuses` | Snapshot assegnazione bonus corrente (PK: `tag`) |
| `cwl_history` | Storico performance CWL per stagione (unique: `player_name, season`) |
| `cwl_seasons` | Metadati stagioni CWL |
| `classic_wars` | Storico guerre classiche salvate |
| `player_aliases` | Alias nomi giocatori (per gestire cambi nome) |
| `auth.users` | Gestito da Supabase Auth (metadati: `role`, `username`, `coc_tag`, `coc_clan_tag`) |

### Tabelle bot Telegram (schema-telegram-*.sql)

| Tabella | Scopo |
|---------|-------|
| `telegram_links` | Sessioni Auth bot (PK: `telegram_user_id`) — token refresh, override clan |
| `telegram_pending_chat_links` | Token temporanei per collegamento gruppo ↔ clan |
| `telegram_chat_links` | Associazione gruppo/canale ↔ clan (PK: `telegram_chat_id`) |
| `telegram_chat_controls` | Interruttore `/coc_off` `/coc_on` per chat |
| `telegram_chat_notification_settings` | Flag avvisi guerra/CWL/raid/giochi per chat |
| `telegram_usage_events` | Analytics utilizzo bot |
| `telegram_user_restrictions` | Ban e mute utenti bot |
| `telegram_support_tickets` | Ticket supporto utente ↔ admin |
| `telegram_support_messages` | Messaggi conversazione ticket |
| `telegram_global_chat_subscribers` | Iscritti chat globale (nome, tag, verificato, epoch) |
| `telegram_global_chat_messages` | Messaggi chat globale |
| `telegram_global_ephemeral_deliveries` | Tracking bolle relay per pulizia UI |
| `telegram_global_moderation` | Violazioni e sanzioni chat globale |
| `telegram_global_reports` | Segnalazioni messaggi chat globale |
| `telegram_recruitment_subscribers` | Iscritti feed reclutamento |
| `telegram_recruitment_submissions` | Bozze annunci reclutamento in attesa approvazione |
| `telegram_recruitment_posts` | Annunci approvati (TTL 24h) |
| `telegram_staff_moderator_ids` | Lookup O(1) moderatori staff (sincronizzato da API) |

### Ruoli utente

`utente` < `membro` < `anziano` < `co-capo` < `admin`

- **admin**: accesso completo (sito + bot), assegnazione bonus, gestione utenti, pannello staff bot
- **capo / co-capo**: assegnazione bonus CWL, collegamento gruppo ↔ clan
- **Login**: username → email interna `username@fearunited.internal`

### Policy RLS

- `members`: SELECT per `authenticated`; write solo via `SERVICE_ROLE_KEY`
- `cwl_bonuses`: SELECT-only per `anon` e `authenticated`; write solo via `SERVICE_ROLE_KEY`
- Tabelle `telegram_*`: accesso via `SERVICE_ROLE_KEY` (bot)

---

## API Endpoints (Vercel)

| Endpoint | Metodo | Auth richiesta | Scopo |
|----------|--------|----------------|-------|
| `/api/sync-members` | POST | SYNC_SECRET header | Cron sync giornaliero (6:00 UTC) |
| `/api/auto-save-wars` | POST | — | Cron salvataggio guerre (20:00 UTC) |
| `/api/clan-members` | GET | — | Lista membri corrente |
| `/api/clan-info` | GET | — | Info clan |
| `/api/cwl-stats` | GET | — | Stats CWL live |
| `/api/war-log` | GET | — | Log guerre |
| `/api/lookup` | GET | — | Player/clan lookup, rankings, telegram-handoff |
| `/api/generate-bonuses` | POST | JWT authenticated | Calcola e salva ranking bonus |
| `/api/import-bonus` | POST | SYNC_SECRET header | Import dati da Excel |
| `/api/register-with-coc` | POST | — | Registrazione con chiave CoC |
| `/api/purge-ex-players` | POST | CRON_SECRET o SYNC_SECRET | Cron pulizia mensile (1° del mese) |
| `/api/admin/users` | GET/POST/PUT/DELETE | JWT admin | Gestione utenti |

### Render Proxy (render-proxy/index.js)

Proxy Express verso CoC API. Richiede `COC_API_TOKEN`. Route principali:
`/player`, `/clan-info`, `/clan-members`, `/cwl-live`, `/war-log`, `/current-war`, `/search-clans`, `/rankings`, `/locations`, `/verify-player-token`, `/sync` (POST), `/save-war` (POST), `/save-all-wars` (POST).

---

## Variabili d'Ambiente

Configurate su Vercel e Render — non committare mai valori reali:

```
# Vercel
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RENDER_PROXY_URL             # URL servizio Render unificato (es. https://fearuniteditcoc.onrender.com)
SYNC_SECRET
CRON_SECRET
RESEND_API_KEY               # Opzionale: email di benvenuto
TELEGRAM_BOT_TOKEN           # Obbligatorio per /api/lookup?type=recruit-list (foto via getFile)

# Render — servizio unificato cocboard (proxy CoC API + bot Telegram)
SUPABASE_URL
SUPABASE_ANON_KEY            # Chiave anon (obbligatoria per login bot)
SUPABASE_SERVICE_ROLE_KEY    # Chiave service_role (scritture DB)
COC_API_TOKEN                # Token CoC API per il proxy
SYNC_SECRET                  # Auth header x-sync-key per route proxy protette
TELEGRAM_BOT_TOKEN           # Token BotFather (stesso del Vercel)
COCBOARD_API_BASE            # URL sito Vercel (es. https://cocboard.vercel.app)
COCBOARD_SITE_HOME_URL       # URL sito per Mini App e pulsante "Apri sito"
TELEGRAM_WEBHOOK_SECRET_TOKEN # Segreto webhook (consigliato in prod)
BOT_OWNER_TELEGRAM_IDS       # ID Telegram proprietari bot (virgola-separati)
TELEGRAPH_TUTORIAL_URL       # Opzionale: URL tutorial Telegraph (default hardcoded)
TELEGRAM_ALLOWED_IDS         # Opzionale: limita accesso per ID
PORT                         # Default 3000
```

---

## Bot Telegram — Architettura

### Catena middleware (ordine esatto in `setupBot`)

1. **guardMiddleware** — ban/mute DB (`telegram_user_restrictions`), `TELEGRAM_ALLOWED_IDS`, rate limit
2. **Usage logging** — `telegram_usage_events`
3. **Interruttore chat** — `/coc_off` blocca tutto tranne `/coc_on`
4. **Private UI tracking** — traccia bolle inviate per pulizia successiva
5. **Private callback wipe** — elimina bolle UI precedenti (eccezioni: hub chat globale, bonus assign, sotto-menu)
6. **Private command wipe** — stessa pulizia su comandi `/…`
7. **Leave global chat** — uscita silenziosa da chat globale su quasi tutti i callback
8. **Router messaggi** — pending auth, search, link wizard, support tickets, community handlers
9. **Session gate** — `tauth.getValidSession`, imposta `ctx.cocboardUser`; ammette guest read in gruppi collegati

### Menu bot in chat privata

**Ospite (non loggato):**
- Accedi, Registrati
- Community
- Cerca, Classifica
- Contatta amministratore
- Guida e tutorial

**Autenticato:**
- Community (no in gruppo)
- Il mio clan (se clan disponibile)
- Cerca, Classifica
- Aggiungi a canale/gruppo (solo Capo/Co-Capo/Admin)
- CoCBoardBot (solo Admin/Moderatore)
- Contatta amministratore
- Account, Aiuto, Logout

### Menu bot in gruppo/canale collegato

**Ospite (non loggato):**
- Il mio clan → Membri, Info, Profilo 🔒, Bonus, Mini app, « Menù
- Cerca, Classifica
- Accedi / Registrati (privato)
- Tutorial, Aiuto

**Autenticato:**
- Il mio clan + Gestione avvisi → Membri, Info, Profilo, Bonus, Mini app, « Menù
- Cerca, Classifica
- Account, Aiuto, Logout

### Clan Hub (dentro "Il mio clan")

| Pulsante | Privato | Gruppo ospite | Gruppo loggato |
|----------|---------|---------------|----------------|
| Membri | ✅ | ✅ | ✅ |
| Info clan | ✅ | ✅ | ✅ |
| Il mio profilo | ✅ | 🔒 | ✅ |
| Bonus | ✅ | ✅ (sola lettura) | ✅ |
| CWL live | ✅ | — (solo in mini app) | — (solo in mini app) |
| Registro guerre | ✅ | — (solo in mini app) | — (solo in mini app) |
| Mini app | ✅ | ✅ | ✅ |

### Mini App (Visualizza come mini app)

Pulsanti web per aprire sezioni del sito. In privata usa `webApp` button (Telegram Mini App nativa).
In gruppo usa `url` button (limitazione API Telegram: `webApp` non supportato in inline keyboard di gruppo).

Tab disponibili per ospiti: `cwl_warlog`, `warlog`, `bonus`, `members`, `cerca`, `rankings`.
Tab bloccata per ospiti: `profilo` → rimanda alla chat privata per login.

### Sezione Bonus CWL (bot)

**Schermata principale** (`bonus:0`): mostra **Classifica riceventi** (chi ha ricevuto più bonus in assoluto nelle stagioni storiche, da `cwl_history`).
Pulsanti: 📅 Storico per stagione | ✏️ Assegna / Modifica bonus (solo Capo/Co-Capo/Admin) | 🌐 web | « Menù.

**Storico per stagione** (`bonus:hist`): season picker con bottoni per ogni stagione (più recente prima).
`bonus:sv:YYYY-MM`: mostra i giocatori con `bonus_assigned=true` per quella stagione, ordinati per score desc.

**Assegnazione / Modifica** (`bonus:as`): visibile solo a ruoli **admin**, **capo**, **co-capo** (`isCapoOrCoCapoForBonus`).
Percorso: scelta stagione → modalità:
- **Manuale**: toggle singolo giocatore per pagina
- **Assistito**: scelta numero bonus + criteri (Standard/Strict/Solo peso TH/Solo score) → ranking automatico → conferma

Funziona anche se i bonus sono già assegnati (modifica possibile).
I bonus vengono scritti su `cwl_history` con flag `bonus_assigned` e score `bonus_score`.

### Community

- **Chat globale** — stanza a finestre temporali (epoch 5 min), ingresso con profilo CoCBoard (✅ verificato) o nome+tag manuale. Regole: no link, no tag in-game nel corpo, no emoji nel formato manuale, rate limit 12 msg/min. Segnalazioni → pannello admin.
- **Reclutamento** — invio bozza (rapido o guidato), approvazione da owner, broadcast a iscritti, TTL 24h.

### Supporto

Ticket utente → admin/moderatore. Conversazione bidirezionale in chat privata. Tastiera reply dedicata per admin (presa in carico, in attesa, chiudi, ban/unban). Pannello `/adminbot` con statistiche, ticket aperti/chiusi, segnalazioni chat globale, utenti bannati, export CSV.

### Notifiche guerre (gruppi collegati)

Avvisi automatici ogni 60s per chat con flag attivi (`war_alerts_enabled`, `cwl_alerts_enabled`, etc.):
countdown guerra, attacchi mancanti, recap finale, mismatch TH.

---

## Algoritmo Bonus CWL

```
merit = (stelle / attacchi_richiesti) × 40
      + (distruzione_media%) × 0.2
      + (attacchi_fatti / attacchi_richiesti) × 20
```

- `distruzione_media%` = `destructionPercentage / attacksMade` (media per attacco, non totale)
- Giocatori che hanno ricevuto il bonus il mese scorso ricevono score = 0 (anti-duplicati)
- Calcolo automatico o override manuale
- I bonus vengono salvati su `cwl_bonuses` e storicizzati su `cwl_history`
- Implementazione autorevole: `api/generate-bonuses.js` → `calculateMerit()` + `tests/bonus-calculator.test.js`

---

## Test

```bash
# Esegui tutti i test
npm test

# Output atteso: 38 test passati
```

I test usano il test runner built-in di Node.js (`node:test`) — zero dipendenze aggiuntive.
Coprono: formula bonus, logica purge, emoji detection, war planner, war alerts, equipment mapping, asset URL, classifiche.

---

## Comandi Utili

```bash
# Deploy sito su Vercel (produzione)
vercel --prod --yes

# Deploy Render (servizio unificato cocboard — proxy + bot)
# → qualsiasi modifica a render-proxy/ o telegram-bot/ + git push origin master
# → Render triggera build automatico (npm install && npm install --prefix ../telegram-bot)
# → oppure Manual Deploy dalla dashboard

# Test
npm test
```

**Convenzione (agente):** dopo modifiche al bot o al proxy, eseguire **commit e push** senza attendere conferma, salvo implementazioni **complesse** (es. migrazioni SQL delicate, refactor ampi, breaking changes) dove serve un checkpoint con il maintainer.

---

## Vincoli Architetturali — NON MODIFICARE

1. **Firebase rimosso** — `firebase-config.js`, `functions/`, `.firebaserc` eliminati. Non aggiungere nulla Firebase.
2. **Limite 12 functions Vercel Hobby** — ogni nuovo file in `api/` conta come function. Prima di aggiungerne uno nuovo, valuta se può essere fuso in `lookup.js` o in un endpoint esistente. `api/_utils/` non conta (sono moduli importati).
3. **`app.js` è monolitico** — tutta la logica UI/stato è qui. Non spezzarlo senza motivo.
4. **`telegram-bot/index.js` è monolitico** — ~5100 righe, tutto il bot è qui + `lib/`. Non spezzare `index.js`.
5. **Servizio Render unificato** — `render-proxy/index.js` avvia Express, monta il proxy CoC API, poi chiama `mountOnApp(app)` da `telegram-bot/index.js` sullo stesso processo/porta. Build command: `npm install && npm install --prefix ../telegram-bot` (installa deps proxy + bot separatamente nelle rispettive `node_modules/`). Webhook bot: `https://fearuniteditcoc.onrender.com/tg/cocboard-webhook`.
6. **CoC API solo via render-proxy** — CORS + token segreto impediscono chiamate dirette dal browser.
7. **Auth bot ↔ sito** condivide lo stesso account Supabase Auth. Il flusso `telegram_links` + handoff (`tg_h` + `telegram-handoff`) è critico: modificare URL contract o tabella rompe Mini App e login.
8. **`webApp` button Telegram** funziona solo in chat privata (limitazione API Telegram). In gruppi si usa `url` button.
9. **Formula bonus** deve restare allineata tra `api/generate-bonuses.js`, `bonus-assistant.js` e test.
10. **Ruoli per assegnazione bonus**: `admin`, `capo`, `co-capo` — controllati da `isCapoOrCoCapoForBonus` nel bot e `require-role.js` sul sito.
11. **Middleware ordine** nel bot è critico: guardMiddleware → usage → coc_off → UI tracking → wipe → global leave → router → session gate. Non riordinare.
12. **`isGroupClanReadCallback`** è la whitelist dei callback accessibili da ospiti in gruppi collegati. Include: `menu`, `noop`, `clan_home`, `clan_webapps`, `info`, `cwl`, `war_menu`, `bonus:hist`, `bonus:hof`, pattern `bonus:\d+`, `bonus:sv:\d{4}-\d{2}`, `mb\d+`, `cwl_v:`, `war:`. Aggiungere callback qui richiede verifica che non espongano dati sensibili.
13. **Le immagini TH** livello 1–18 sono `.webp` in `th/webp/`; i file root sono stati rimossi. 
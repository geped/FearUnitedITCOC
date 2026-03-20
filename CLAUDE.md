# CoCBoard — CLAUDE.md

## Panoramica Progetto

Dashboard web per la gestione del clan Clash of Clans **Fear United IT** (`#2J2VLPP9R`).
Funzionalità principali: sincronizzazione membri, calcolo bonus CWL, storico performance, gestione utenti.
UI in italiano, single-page application vanilla JS.

---

## Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Frontend | HTML5 / CSS3 / Vanilla JavaScript (no framework) |
| Database | Supabase (PostgreSQL) |
| Serverless API | Vercel (Node.js), Hobby plan — limite 12 functions |
| Proxy backend | Render.com (Express) — piano gratuito, cold start ~30s |
| Auth | Supabase Auth con metadati custom (role, username) |
| API esterna | Clash of Clans API v1 |
| Test | Node.js built-in `node:test` (zero dipendenze) |

---

## Struttura Directory

```
├── index.html              # UI markup (742 righe)
├── app.js                  # Logica applicazione (4650 righe)
├── style.css               # Stili (3224 righe)
├── supabase-config.js      # Init client Supabase (lato client)
├── vercel.json             # Config Vercel + cron job
│
├── api/                    # Serverless functions Vercel (max 12)
│   ├── _utils/
│   │   ├── proxy-client.js # Helper proxyFetch() condiviso tra endpoints
│   │   └── require-role.js # Middleware auth JWT + verifica ruolo
│   ├── admin/users.js      # CRUD utenti (solo admin — verifica ruolo JWT)
│   ├── auto-save-wars.js   # Cron salvataggio automatico guerre (20:00 UTC)
│   ├── clan-info.js        # Info clan (via proxy)
│   ├── clan-members.js     # Lista membri live (via proxy)
│   ├── cwl-stats.js        # Stats CWL live (via proxy)
│   ├── generate-bonuses.js # Calcolo e salvataggio bonus (legge cwl_history)
│   ├── import-bonus.js     # Import bonus da Excel (richiede SYNC_SECRET)
│   ├── lookup.js           # Player lookup, clan search, rankings (via proxy)
│   ├── purge-ex-players.js # Cron pulizia ex-membri (1° del mese 7:00 UTC)
│   ├── register-with-coc.js# Registrazione tramite chiave API in-game CoC
│   ├── sync-members.js     # Sync membri (cron giornaliero 6:00 UTC)
│   └── war-log.js          # Log guerre (via proxy)
│
├── render-proxy/           # Backend Express su Render.com
│   └── index.js            # Proxy CoC API con caching (631 righe)
│
├── tests/                  # Test Node.js built-in
│   ├── bonus-calculator.test.js  # 6 test formula calculateMerit
│   └── purge-logic.test.js       # 5 test logica shouldPurge
│
├── leagues/                # Badge immagini leghe CWL
├── th/                     # Icone Town Hall (level_01–18 .webp, webp/ per le copie)
│
├── schema-MASTER.sql       # Schema unificato — applica tutto nell'ordine corretto
└── schema*.sql             # File di migrazione individuali (per riferimento)
```

---

## Database Supabase

**Tabelle principali:**

| Tabella | Scopo |
|---------|-------|
| `members` | Roster attuale clan (PK: `tag`) |
| `cwl_bonuses` | Snapshot assegnazione bonus corrente (PK: `tag`) |
| `cwl_history` | Storico performance CWL per stagione (unique: `player_name, season`) |
| `player_aliases` | Alias nomi giocatori (per gestire cambi nome) |
| `auth.users` | Gestito da Supabase Auth (metadati: `role`, `username`) |

**Ruoli utente:** `utente` < `membro` < `anziano` < `co-capo` < `admin`

**Login:** username → email interna `username@fearunited.internal`

**Policy RLS:**
- `members`: SELECT per `authenticated`; write solo via `SERVICE_ROLE_KEY` (render-proxy) + policy anon ristretta
- `cwl_bonuses`: SELECT-only per `anon` e `authenticated`; write solo via `SERVICE_ROLE_KEY`

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
| `/api/lookup` | GET | — | Player/clan lookup e rankings |
| `/api/generate-bonuses` | POST | JWT authenticated | Calcola e salva ranking bonus |
| `/api/import-bonus` | POST | SYNC_SECRET header | Import dati da Excel |
| `/api/register-with-coc` | POST | — | Registrazione con chiave CoC |
| `/api/purge-ex-players` | POST | CRON_SECRET o SYNC_SECRET | Cron pulizia mensile (1° del mese) |
| `/api/admin/users` | GET/POST/PUT/DELETE | JWT admin | Gestione utenti |

---

## Variabili d'Ambiente

Configurate su Vercel e Render — non committare mai valori reali:

```
# Vercel + Render
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY    # Render usa questa per scrivere su Supabase (bypassa RLS)

# Solo Render
COC_API_TOKEN
PORT

# Solo Vercel
RENDER_PROXY_URL
SYNC_SECRET                  # Segreto condiviso Vercel ↔ Render + script Python
CRON_SECRET                  # Segreto per cron Vercel (purge-ex-players)
RESEND_API_KEY               # Opzionale: email di benvenuto

# Script locali (import_bonus.py)
SYNC_SECRET                  # Stesso segreto configurato su Vercel
```

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

# Output atteso: 11 test passati (6 bonus + 5 purge)
```

I test usano il test runner built-in di Node.js (`node:test`) — zero dipendenze aggiuntive.

---

## Comandi Utili

```bash
# Deploy su Vercel (produzione)
vercel --prod --yes

# Deploy Render (solo se modifichi render-proxy/index.js)
# → Fare push su git e triggera deploy automatico su Render, oppure deploy manuale dalla dashboard

# Test
npm test
```

---

## Note Importanti

- **Firebase rimosso** — `firebase-config.js`, `functions/`, `.firebaserc` eliminati. Non aggiungere nulla Firebase.
- **Limite 12 functions Vercel Hobby** — ogni nuovo file in `api/` conta come function. Prima di aggiungerne uno nuovo, valuta se può essere fuso in `lookup.js` o in un endpoint esistente.
- `app.js` è monolitico (4650 righe) — tutta la logica UI/stato è qui. Non spezzarlo senza motivo.
- `render-proxy/index.js` gira su Render.com separatamente — modifiche richiedono deploy separato.
- Le immagini TH livello 1–18 sono `.webp` in `th/webp/`; i file root sono stati rimossi.
- Il progetto usa `render-proxy` perché la CoC API non supporta chiamate dirette dal browser (CORS + token segreto).
- `api/_utils/` non conta nel limite delle 12 functions (sono moduli CommonJS importati, non handler).

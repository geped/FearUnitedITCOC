# FearUnitedCoC — CLAUDE.md

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
| Serverless API | Vercel (Node.js) |
| Proxy backend | Render.com (Express) |
| Auth | Supabase Auth con metadati custom (role, username) |
| API esterna | Clash of Clans API v1 |
| Legacy (dismesso) | Firebase / Firestore |

---

## Struttura Directory

```
├── index.html              # UI markup (473 righe)
├── app.js                  # Logica applicazione (2636 righe)
├── style.css               # Stili (2071 righe)
├── supabase-config.js      # Init client Supabase (lato client)
├── firebase-config.js      # Legacy Firebase (non usare)
├── vercel.json             # Config Vercel + cron job
│
├── api/                    # Serverless functions Vercel
│   ├── admin/users.js      # CRUD utenti (solo admin)
│   ├── clan-info.js        # Info clan (proxy)
│   ├── clan-members.js     # Lista membri (proxy)
│   ├── cwl-stats.js        # Stats CWL live (proxy)
│   ├── generate-bonuses.js # Calcolo e salvataggio bonus
│   ├── import-bonus.js     # Import bonus da Excel
│   ├── sync-members.js     # Sync membri (cron giornaliero 6:00)
│   └── war-log.js          # Log guerre
│
├── render-proxy/           # Backend Express su Render.com
│   └── index.js            # Proxy CoC API con caching
│
├── leagues/                # Badge immagini leghe CWL
├── th/                     # Icone Town Hall (level_01–18 .webp, 19–20 .png)
│
└── schema*.sql             # Schema e migrazioni Supabase
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

---

## API Endpoints (Vercel)

| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/sync-members` | POST | Cron sync giornaliero (6:00 UTC) |
| `/api/clan-members` | GET | Lista membri corrente |
| `/api/clan-info` | GET | Info clan |
| `/api/cwl-stats` | GET | Stats CWL live |
| `/api/war-log` | GET | Log guerre |
| `/api/generate-bonuses` | POST | Calcola e salva ranking bonus |
| `/api/admin/users` | GET/POST/PUT/DELETE | Gestione utenti (admin) |
| `/api/import-bonus` | POST | Import dati da Excel |
| `/api/register-with-coc` | POST | Registrazione tramite chiave API in-game CoC |

---

## Variabili d'Ambiente

Configurate su Vercel e Render — non committare mai valori reali:

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
COC_API_TOKEN
RENDER_PROXY_URL
SYNC_SECRET
```

---

## Algoritmo Bonus CWL

```
score = (stelle × 100) + destruction% - (attacchi_mancati × 500)
```

- Giocatori che hanno ricevuto il bonus il mese scorso ricevono score = 0 (anti-duplicati)
- Calcolo automatico o override manuale
- I bonus vengono salvati su `cwl_bonuses` e storicizzati su `cwl_history`

---

## Comandi Utili

```bash
# Deploy frontend
vercel deploy

# Deploy Cloud Functions Firebase (legacy)
cd functions && firebase deploy --only functions

# Emulator locale (legacy)
cd functions && npm install && npm run serve
```

---

## Note Importanti

- **Firebase è legacy** — la migrazione verso Supabase è completata. Non aggiungere nuova logica Firebase.
- `app.js` è monolitico — tutta la logica UI/stato è qui. Non spezzarlo senza motivo.
- `render-proxy/index.js` gira su Render.com separatamente — modifiche richiedono deploy separato.
- Le immagini TH livello 19 e 20 sono `.png`, quelle 1–18 sono `.webp`.
- Il progetto usa un `render-proxy` perché la CoC API non supporta chiamate dirette dal browser (CORS + token).

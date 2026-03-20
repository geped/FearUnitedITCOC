# CoCBoard — Dashboard Clan Fear United IT

Dashboard web per la gestione del clan Clash of Clans **Fear United IT** (`#2J2VLPP9R`).

## Stack

| Layer | Tecnologia |
|-------|-----------|
| Frontend | HTML5 / CSS3 / Vanilla JavaScript |
| Database | Supabase (PostgreSQL + Auth) |
| API serverless | Vercel (Node.js) |
| Proxy backend | Render.com (Express) |
| API esterna | Clash of Clans API v1 |

## Funzionalità principali

- **Sincronizzazione membri** — cron giornaliero che aggiorna il roster dal clan CoC
- **Calcolo bonus CWL** — formula di merito basata su stelle, distruzione e partecipazione
- **Storico performance** — storico CWL per stagione con Hall of Fame
- **War log** — log guerre classiche con dettaglio per giocatore
- **Classifiche** — ranking bonus e statistiche comparative
- **Gestione utenti** — CRUD utenti con ruoli (admin, co-capo, anziano, membro, utente)

## Struttura directory

```
├── index.html              # SPA markup
├── app.js                  # Logica frontend (~4650 righe)
├── style.css               # Stili (~3224 righe)
├── supabase-config.js      # Init client Supabase (lato client)
│
├── api/                    # Serverless functions Vercel
│   ├── _utils/
│   │   ├── proxy-client.js # Helper condiviso per chiamate al proxy
│   │   └── require-role.js # Middleware autenticazione JWT + ruolo
│   ├── admin/users.js      # CRUD utenti (solo admin)
│   ├── sync-members.js     # Cron: sync giornaliero 6:00 UTC
│   ├── auto-save-wars.js   # Cron: salvataggio guerre 20:00 UTC
│   ├── purge-ex-players.js # Cron: pulizia ex-membri 1° del mese
│   ├── generate-bonuses.js # Calcolo e salvataggio bonus CWL
│   ├── import-bonus.js     # Import bonus da Excel
│   ├── register-with-coc.js# Registrazione tramite chiave API CoC
│   ├── lookup.js           # Player/clan lookup e rankings
│   ├── clan-info.js        # Info clan
│   ├── clan-members.js     # Lista membri live
│   ├── cwl-stats.js        # Stats CWL live
│   └── war-log.js          # Log guerre
│
├── render-proxy/
│   └── index.js            # Proxy Express su Render.com
│
├── tests/
│   ├── bonus-calculator.test.js
│   └── purge-logic.test.js
│
├── schema-MASTER.sql       # Schema Supabase unificato
└── vercel.json             # Configurazione cron Vercel
```

## Algoritmo Bonus CWL

```
merit = (stelle / attacchi_richiesti) × 40
      + (distruzione_media%) × 0.2
      + (attacchi_fatti / attacchi_richiesti) × 20
```

- Chi ha ricevuto il bonus il mese scorso ottiene score = 0 (anti-duplicati)
- Il calcolo può essere automatico o con override manuale

## Setup ambiente

### Variabili d'ambiente richieste

**Vercel:**
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RENDER_PROXY_URL
SYNC_SECRET
CRON_SECRET
RESEND_API_KEY        # opzionale
```

**Render.com:**
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
COC_API_TOKEN
SYNC_SECRET
PORT
```

### Database

Applicare `schema-MASTER.sql` nel Supabase SQL Editor per creare tutte le tabelle e policy RLS nell'ordine corretto.

### Deploy

```bash
# Frontend + API Vercel
vercel --prod --yes

# Test
npm test
```

Il proxy Render.com viene deployato separatamente tramite la sua dashboard o con push su git.

## Note

- Vercel Hobby plan: limite di **12 serverless functions** (attualmente al limite)
- Vercel Hobby plan: cron jobs solo con frequenza giornaliera
- Il proxy Render.com è necessario perché la CoC API non supporta chiamate dirette dal browser (CORS + token segreto)
- `api/_utils/` contiene moduli condivisi e non conta nel limite delle 12 functions

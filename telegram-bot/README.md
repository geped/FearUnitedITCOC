# CoCBoard — Bot Telegram

Stesso **account Supabase Auth** del sito per il menù completo e le **Mini App (web)**. Da **ospite** restano disponibili Cerca, Classifica, **Community** (chat globale + reclutamento), e in gruppi collegati anche **Membri, Info clan, Bonus** (sola lettura), **CWL/Guerre** via Mini App. Il clan mostrato dopo login viene dal **profilo CoC** (`coc_clan_tag`), con override `/setclan #TAG`.

Guida passo-passo su tutti i servizi: **[`DEPLOY-COCBOARD-BOT.md`](./DEPLOY-COCBOARD-BOT.md)**.

---

## Variabili d'ambiente

| Variabile | Obbligatorio | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `COCBOARD_API_BASE` | sì | URL sito Vercel, es. `https://cocboard.vercel.app` (senza `/` finale) |
| `SUPABASE_URL` | sì | Project URL API (`https://xxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | sì | Chiave **anon** (Auth `signInWithPassword` dal bot) |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Chiave **service_role** (Dashboard → API). Serve per `telegram_links`, ticket supporto e altre scritture: **non** usare la chiave anon qui. |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | consigliato in prod | Segreto webhook (Telegram header) |
| `COCBOARD_SITE_HOME_URL` | consigliato | URL sito per Mini App e pulsante "Apri sito". Senza questa variabile le Mini App non funzionano. |
| `BOT_OWNER_TELEGRAM_IDS` | consigliato | ID Telegram proprietari bot (virgola-separati). Necessario per approvazione annunci reclutamento. |
| `TELEGRAPH_TUTORIAL_URL` | no | URL tutorial Telegraph (default hardcoded) |
| `TELEGRAM_ALLOWED_IDS` | no | Limita chi può aprire il bot (lista ID separati da virgola) |
| `PORT` | no | Default `3001` |

Webhook: il bot gira nel **servizio Render unificato `cocboard`** insieme al proxy CoC API (`render-proxy/index.js`). L'URL webhook è `https://fearuniteditcoc.onrender.com/tg/cocboard-webhook`, impostato automaticamente da `RENDER_EXTERNAL_URL`. Il file `index.js` esporta anche `mountOnApp(app)` per montarsi su un Express esterno. Vedi [`render.yaml`](../render.yaml).

---

## Architettura bot (index.js ~5100 righe)

### File principali

| File | Scopo |
|------|-------|
| `index.js` | Entry point: Express server + Telegraf bot, tutti gli handler e middleware |
| `lib/access.js` | Rate limit + `TELEGRAM_ALLOWED_IDS` |
| `lib/auth-resolve.js` | Risoluzione email login (allineata ad `app.js`) |
| `lib/bonus-assistant.js` | Wizard assistito assegnazione bonus CWL |
| `lib/cocboard-api.js` | Client HTTP verso `api/` Vercel |
| `lib/community-handlers.js` | Chat globale + reclutamento (callback `comm_*`, `recg_*`) |
| `lib/community-validation.js` | Validazione messaggi globali, rate limit, epoch, owner check |
| `lib/format.js` | Formattazione HTML Telegram per tutti i menu e sezioni |
| `lib/private-ui-cleanup.js` | Pulizia bolle UI in chat privata |
| `lib/supabase.js` | Tutte le query DB (service_role + anon) |
| `lib/supabase-community.js` | Query DB per community (chat globale, reclutamento, moderazione) |
| `lib/telegram-auth.js` | Login/registrazione Supabase Auth via bot |
| `lib/telegram-html.js` | Conversione entities Telegram → HTML |

### Catena middleware (ordine critico — non riordinare)

1. **guardMiddleware** — ban/mute, allowed IDs, rate limit
2. **Usage logging** — `telegram_usage_events`
3. **coc_off gate** — in gruppo, blocca tutto tranne `/coc_on`
4. **Private UI tracking** — traccia bolle inviate
5. **Private callback wipe** — elimina bolle precedenti (eccezioni per sotto-menu)
6. **Private command wipe** — stessa pulizia su `/…`
7. **Leave global chat** — uscita silenziosa
8. **Router messaggi** — pending auth/search/wizard/support/community
9. **Session gate** — `getValidSession`, imposta `ctx.cocboardUser`, ammette guest read in gruppi

### Whitelist callback ospiti in gruppo (`isGroupClanReadCallback`)

Callback accessibili senza login in gruppi collegati:
`menu`, `noop`, `clan_home`, `clan_webapps`, `info`, `cwl`, `war_menu`, `bonus:hist`, `bonus:hof`, `bonus:\d+`, `mb\d+`, `cwl_v:*`, `war:*`.

Modificare questa whitelist richiede verifica che non esponga dati sensibili.

---

## Menu bot — Struttura attuale

### Chat privata — Ospite

```
Accedi | Registrati
Community
Cerca | Classifica
Contatta amministratore
Guida e tutorial
```

### Chat privata — Autenticato

```
Il mio clan (se clan disponibile)
Community
Cerca | Classifica
Aggiungi a canale/gruppo (solo Capo/Co-Capo/Admin)
CoCBoardBot (solo Admin/Moderatore)
Contatta amministratore
Account | Aiuto
Logout
```

### Gruppo/canale collegato — Ospite

```
Il mio clan
Cerca | Classifica
Accedi / Registrati (privato) [URL]
Tutorial [URL]
Aiuto
```

### Gruppo/canale collegato — Autenticato

```
Il mio clan | Gestione avvisi
Cerca | Classifica
Account | Aiuto
Logout
```

### Clan Hub (Il mio clan)

| Pulsante | Privato | Gruppo ospite | Gruppo loggato |
|----------|---------|---------------|----------------|
| Membri | ✅ | ✅ | ✅ |
| Info clan | ✅ | ✅ | ✅ |
| Il mio profilo | ✅ | 🔒 | ✅ |
| Bonus | ✅ | ✅ (lettura) | ✅ |
| CWL live | ✅ | — | — |
| Registro guerre | ✅ | — | — |
| Mini app | ✅ | ✅ | ✅ |

CWL live e Registro guerre in gruppo sono accessibili solo tramite Mini App.

### Mini App (Visualizza come mini app)

```
CWL live (web) | Registro guerre (web)
Bonus (web)    | Info / Membri (web)
Cerca (web)    | Classifica (web)
Profilo (web)  [🔒 per ospiti → porta al login in privato]
« Il mio clan  | « Menù
```

**Limitazione Telegram:** in gruppo i pulsanti `webApp` non sono supportati nelle inline keyboard. Il bot usa `url` button che apre il sito nel browser integrato di Telegram.

---

## Funzionalità principali

### Assegnazione bonus CWL

Ruoli abilitati: **admin**, **capo**, **co-capo** (funzione `isCapoOrCoCapoForBonus`).
Percorso: Il mio clan → Bonus → ✏️ Assegna bonus → scelta stagione → modalità:
- **Manuale**: toggle singolo giocatore per pagina
- **Assistito**: scelta numero bonus + criteri (Standard/Strict/Solo peso TH/Solo score) → ranking automatico → toggle per conferma → salva

### Community

- **Chat globale**: finestre temporali (epoch 5 min), ingresso verificato (profilo CoCBoard) o manuale (nome#TAG). Regole anti-spam, segnalazioni, moderazione.
- **Reclutamento**: invio bozza rapido o guidato, approvazione owner, broadcast iscritti, TTL 24h.

### Supporto ticket

Apertura da utente (`/assistenza` o pulsante), conversazione bidirezionale, pannello admin con stats/CSV/ban.

### Notifiche guerre

Avvisi automatici per chat con flag attivi: countdown, attacchi mancanti, recap finale.

### Mini App / handoff

Codice one-time `tg_h` → endpoint `telegram-handoff` su Vercel → `app.js` imposta sessione Auth nel browser. Funziona solo in chat privata (pulsante `webApp`). In gruppo usa URL diretto (guest o autenticato).

---

## Database (schema SQL)

Esegui nel SQL Editor Supabase, in ordine:

1. **`schema-telegram-links.sql`** — sessione Auth + override clan
2. **`schema-community-chat.sql`** — chat globale, reclutamento
3. **`schema-community-subscriber-rpc.sql`** — RPC iscrizioni, privacy, moderazione
4. **`schema-global-share-moderation.sql`** — allineamento colonne (se schema 3 era vecchio)
5. **`schema-telegram-chat-links.sql`** — gruppo ↔ clan, controlli, notifiche, restrizioni, ticket
6. **`schema-support-tickets-ensure.sql`** — fix idempotente ticket supporto
7. **`schema-telegram-moderators.sql`** — lookup moderatori staff

---

## Comandi bot registrati con BotFather

**Chat privata:** `start`, `cocboard`, `help`, `assistenza`, `adminbot`, `cerca`, `classifica`, `esci_chat_global`, `annulla_reclutamento`

**Gruppi:** `cocboard`, `cerca`, `classifica`, `help`, `assistenza`, `coc_off`, `coc_on`, `coc_status`

**Comandi aggiuntivi** (non nel menu BotFather ma funzionanti): `/membri`, `/info`, `/cwl`, `/bonus`, `/guerre`, `/player`, `/setclan`, `/logout_clan`, `/esci`, `/linkclan`, `/unlinkclan`, `/skip`, `/cerca_clan`, `/cancel`

---

## Avvio locale

```bash
cd telegram-bot
npm install
# imposta le env (vedi tabella sopra)
npm start
```

Non committare mai token né chiavi Supabase.

---

## Vincoli critici — NON MODIFICARE

1. **`index.js` è monolitico** (~5800 righe). Non spezzarlo.
2. **Ordine middleware** è critico per sicurezza e UX. Non riordinare.
3. **`isGroupClanReadCallback`** è la whitelist ospiti in gruppo. Modifiche richiedono verifica sicurezza.
4. **Auth flow** (`telegram_links` + handoff `tg_h`) è condiviso con il sito. Cambiare il contratto URL rompe Mini App.
5. **Formula bonus** deve restare allineata tra `api/generate-bonuses.js`, `bonus-assistant.js` e test.
6. **`webApp` button** funziona solo in chat privata (limitazione API Telegram).
7. **Community handlers** (`comm_*`, `recg_*`) sono in `lib/community-handlers.js` ma registrati alla fine di `setupBot` in `index.js`.
8. **`mountOnApp(app)`** è l'export per il servizio unificato. Non rimuoverlo e non aggiungere logica Express standalone fuori da `main()` — in modalità unificata `main()` non viene chiamato.
9. **Dipendenze bot** installate in `telegram-bot/node_modules/` (non in `render-proxy/`). Build command Render deve includere `npm install --prefix ../telegram-bot`.

# Checklist deploy CoCBoard — Bot Telegram

Segui nell'ordine. Il bot **non** modifica il sito: usa solo API già online + Supabase.

---

## 1) Supabase (dashboard del progetto)

| Cosa | Dove |
|------|------|
| **SQL** | **SQL Editor** → incolla ed esegui in ordine: 1) `schema-telegram-links.sql` 2) `schema-community-chat.sql` 3) `schema-community-subscriber-rpc.sql` 4) `schema-global-share-moderation.sql` 5) `schema-telegram-chat-links.sql` 6) `schema-support-tickets-ensure.sql` 7) `schema-telegram-moderators.sql` |
| **URL** | **Project Settings → API → Project URL** → es. `https://xxxx.supabase.co` (non la URL della dashboard!). |
| **anon public** | Stessa pagina → **anon public** → copiala in **`SUPABASE_ANON_KEY`** su Render. **Obbligatoria per Accedi/Registrati** (senza di questa compare l'errore «manca SUPABASE_ANON_KEY»). |
| **service_role** | Stessa pagina → **service_role** → **`SUPABASE_SERVICE_ROLE_KEY`**. Salva sessione e tabella `telegram_links`; **non** sostituisce l'anon. |

---

## 2) Vercel (sito CoCBoard già deployato)

| Cosa | Azione |
|------|--------|
| **URL** | Copia l'URL produzione (es. `https://cocboard.vercel.app`) → sarà `COCBOARD_API_BASE` e `COCBOARD_SITE_HOME_URL` sul bot. |
| **API** | Nessun deploy obbligatorio se `/api/register-with-coc`, `/api/clan-*`, `/api/lookup` funzionano già dal browser. |
| **Segreto** | `RENDER_PROXY_URL` e `SYNC_SECRET` devono restare configurati (il bot chiama Vercel come il sito). |

---

## 3) Render (servizio unificato `cocboard`)

Il bot gira sullo **stesso servizio** del proxy CoC API (`render-proxy/index.js`). Non serve un servizio separato.

| Cosa | Azione |
|------|--------|
| **Servizio esistente** | Usa il servizio `cocboard` già attivo su `https://fearuniteditcoc.onrender.com`. |
| **Build Command** | Deve essere `npm install && npm install --prefix ../telegram-bot` (installa deps di entrambi). Verifica in Settings → Build & Deploy. |
| **Root Directory** | `render-proxy` |
| **Variabili** | Nella scheda **Environment** compila tutte (vedi tabella sotto). Dopo ogni modifica: **Save** e **Manual Deploy**. |
| **URL webhook** | `https://fearuniteditcoc.onrender.com/tg/cocboard-webhook` — impostato automaticamente da `RENDER_EXTERNAL_URL`. |
| **Health** | `GET /health` deve rispondere `{ ok: true }`. |

### Variabili d'ambiente su Render (servizio `cocboard`)

| Variabile | Esempio / Note |
|-----------|----------------|
| `COC_API_TOKEN` | Token CoC API (per il proxy) |
| `SYNC_SECRET` | Auth header proxy (per Vercel) |
| `TELEGRAM_BOT_TOKEN` | Token da BotFather |
| `COCBOARD_API_BASE` | `https://cocboard.vercel.app` |
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Chiave **anon** (non service_role!) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chiave **service_role** |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Stringa segreta a scelta |
| `COCBOARD_SITE_HOME_URL` | Stesso URL di `COCBOARD_API_BASE` — necessario per Mini App |
| `BOT_OWNER_TELEGRAM_IDS` | ID Telegram numerici, separati da virgola |

Opzionali: `TELEGRAPH_TUTORIAL_URL`, `TELEGRAM_ALLOWED_IDS`, `PORT`.

---

## 4) Telegram — BotFather

| Cosa | Azione |
|------|--------|
| **Token** | `@BotFather` → `/newbot` o bot esistente → copia il token → variabile `TELEGRAM_BOT_TOKEN` su Render. |
| **Comandi** | Il bot registra automaticamente i comandi all'avvio (`registerBotCommands`). |
| **Menu button** | Opzionale: `/setmenubutton` per configurare il pulsante Mini App nel menu del bot. |

Non serve configurare il webhook a mano: lo imposta il processo Node all'avvio.

---

## 5) Verifica finale

1. Log Render: riga **`[bot] Webhook set: https://fearuniteditcoc.onrender.com/tg/cocboard-webhook`**.
2. Apri il bot in Telegram → **`/start`** → devi vedere **Accedi** / **Registrati** / Community / Cerca / Classifica.
3. Accedi con le stesse credenziali del sito oppure registrati con tag + chiave API.
4. Dopo il login: menù con clan da profilo o `/setclan #TAG` se serve.
5. In un **gruppo collegato**: `/cocboard@nomebot` → Il mio clan + Cerca + Classifica (anche senza login).

---

## Troubleshooting

### `TypeError: fetch failed` o ❌ Errore in chat

Significa che il bot **non riesce a contattare Supabase** (o raramente altre API). Controlla:

1. **`SUPABASE_URL`** deve essere solo `https://TUO_REF.supabase.co` — **non** l'URL della dashboard.
2. **`SUPABASE_SERVICE_ROLE_KEY`** e **`SUPABASE_ANON_KEY`** devono essere le chiavi dello **stesso** progetto.
3. Su **Render**, dopo aver modificato le env, fai **Manual Deploy** / riavvio del servizio.
4. Nei **log** cerca `[cocboard-bot] getValidSession` o l'avviso su URL errata all'avvio.

### Premo Start e non succede nulla

Telegram non consegna gli update al processo (webhook) o il middleware li scarta.

1. **Stesso bot del token** — La chat deve essere con il bot il cui token hai messo in `TELEGRAM_BOT_TOKEN`.
2. **`TELEGRAM_WEBHOOK_SECRET_TOKEN`** — Se cambiata senza redeploy: fai **Manual Deploy**. Se dubiti, svuotala temporaneamente, redeploy, riprova `/start`; poi rimetti segreto e redeploy.
3. **Controlla il webhook** — nel browser: `https://api.telegram.org/botIL_TOKEN/getWebhookInfo`
   - `url` deve essere `https://tuo-host.onrender.com/tg/cocboard-webhook`
   - Se c'è `last_error_message`, leggilo.
4. **Log Render** — Cerca `[cocboard-bot] webhook POST url=...`. Se non compare, le richieste non arrivano.

### Non vedo "Assegna bonus" nella sezione Bonus

Il pulsante compare solo se:
1. Sei **loggato** nel bot (non ospite)
2. Il tuo ruolo su Supabase Auth è `admin`, `capo` o `co-capo` (`user_metadata.role`)
3. Sei in **chat privata** con il bot

Se il ruolo è corretto ma il pulsante non appare, verifica con il SQL Editor:
```sql
SELECT raw_user_meta_data->>'role' FROM auth.users WHERE raw_user_meta_data->>'username' = 'TUO_USERNAME';
```

### Mini App non funziona in gruppo

Limitazione API Telegram: i pulsanti `webApp` (Mini App nativa) funzionano **solo in chat privata** con il bot. In gruppi il bot usa pulsanti `url` che aprono il sito nel browser integrato di Telegram. Questo è il comportamento atteso.

### Non vedo il clan nel gruppo

Il gruppo deve essere **collegato** con il comando `/linkclan TOKEN`. Il token si genera dalla chat privata del bot: menù → Aggiungi a canale/gruppo (visibile solo a Capo/Co-Capo/Admin).

---

## Sicurezza

- Non incollare **service_role**, **anon** o token in chat pubbliche.
- Password e chiave API in Telegram restano nei messaggi: l'utente può eliminarli a mano; `/cancel` annulla la procedura.
- Il webhook verifica `secret_token` se configurato.
- Ban/mute utenti dal pannello admin (`/adminbot`) o dal bot owner.

---

## Schema database — Ordine di esecuzione

| # | File | Contenuto |
|---|------|-----------|
| 1 | `schema-telegram-links.sql` | Tabella `telegram_links` (sessioni Auth, override clan) |
| 2 | `schema-community-chat.sql` | Chat globale, reclutamento, epoche |
| 3 | `schema-community-subscriber-rpc.sql` | RPC iscrizioni, display_verified, privacy, moderazione base |
| 4 | `schema-global-share-moderation.sql` | Colonne share/moderazione aggiuntive (se schema 3 era vecchio) |
| 5 | `schema-telegram-chat-links.sql` | Collegamento gruppo ↔ clan, controlli chat, notifiche, analytics, restrizioni, ticket supporto |
| 6 | `schema-support-tickets-ensure.sql` | Fix idempotente tabelle ticket (se aprire ticket dà errore DB) |
| 7 | `schema-telegram-moderators.sql` | Tabella `telegram_staff_moderator_ids` (lookup moderatori) |

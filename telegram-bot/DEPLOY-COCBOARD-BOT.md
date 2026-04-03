# Checklist deploy CoCBoard — Bot Telegram

Segui nell’ordine. Il bot **non** modifica il sito: usa solo API già online + Supabase.

---

## 1) Supabase (dashboard del progetto)

| Cosa | Dove |
|------|------|
| **SQL** | **SQL Editor** → incolla ed esegui tutto [`schema-telegram-links.sql`](./schema-telegram-links.sql) (crea/aggiorna `telegram_links` con colonne sessione Auth). |
| **URL** | **Project Settings → API → Project URL** → es. `https://xxxx.supabase.co` (non la URL della dashboard!). |
| **anon public** | Stessa pagina → **anon public** → copiala in **`SUPABASE_ANON_KEY`** su Render. **Obbligatoria per Accedi/Registrati** (senza di questa compare l’errore «manca SUPABASE_ANON_KEY»). |
| **service_role** | Stessa pagina → **service_role** → **`SUPABASE_SERVICE_ROLE_KEY`**. Salva sessione e tabella `telegram_links`; **non** sostituisce l’anon. |

---

## 2) Vercel (sito CoCBoard già deployato)

| Cosa | Azione |
|------|--------|
| **URL** | Copia l’URL produzione (es. `https://cocboard.vercel.app`) → sarà `COCBOARD_API_BASE` sul bot. |
| **API** | Nessun deploy obbligatorio se `/api/register-with-coc`, `/api/clan-*`, `/api/lookup` funzionano già dal browser. |
| **Segreto** | `RENDER_PROXY_URL` e `SYNC_SECRET` devono restare configurati (il bot chiama Vercel come il sito). |

---

## 3) Render (host del bot)

| Cosa | Azione |
|------|--------|
| **Nuovo servizio** | **New → Blueprint** (o Web Service) → repo Git → usa [`render.yaml`](../render.yaml) nella root del repo. |
| **Variabili** | Nella scheda **Environment** compila tutte: `TELEGRAM_BOT_TOKEN`, `COCBOARD_API_BASE`, `SUPABASE_URL`, **`SUPABASE_ANON_KEY`** (chiave **anon**, non solo service_role), `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`. Dopo ogni modifica: **Save** e **Manual Deploy** / restart. |
| **URL** | Dopo il primo deploy, Render imposta `RENDER_EXTERNAL_URL`: il bot la usa per il webhook automaticamente (`/tg/cocboard-webhook`). |
| **Health** | `GET /health` sulla URL del servizio deve rispondere JSON `ok` (solo in modalità webhook). |

Opzionale: `COCBOARD_SITE_HOME_URL` = stesso URL Vercel (per il pulsante “Apri sito”).

---

## 4) Telegram — BotFather

| Cosa | Azione |
|------|--------|
| **Token** | `@BotFather` → `/newbot` o bot esistente → copia il token → variabile `TELEGRAM_BOT_TOKEN` su Render. |
| **Comandi (opzionale)** | `/setcommands` → incolla ad esempio:<br>`start - Menù`<br>`help - Aiuto`<br>`accedi - (usa pulsanti)`<br>`setclan - Clan da mostrare`<br>`esci - Logout` |

Non serve configurare il webhook a mano: lo imposta il processo Node all’avvio.

---

## Problema: `TypeError: fetch failed` o ❌ Errore in chat

Significa che il bot **non riesce a contattare Supabase** (o raramente altre API). Controlla:

1. **`SUPABASE_URL`** deve essere solo `https://TUO_REF.supabase.co` — **non** l’URL della dashboard del tipo `supabase.com/dashboard/project/...`.
2. **`SUPABASE_SERVICE_ROLE_KEY`** e **`SUPABASE_ANON_KEY`** devono essere le chiavi dello **stesso** progetto (Settings → API).
3. Su **Render**, dopo aver modificato le env, fai **Manual Deploy** / riavvio del servizio.
4. Nei **log** del servizio cerca `[cocboard-bot] getValidSession` o l’avviso su URL errata all’avvio.

Il codice ora, se la lettura sessione fallisce, mostra comunque il **menù ospite** invece di crashare con eccezione non gestita.

## Problema: premo Start o invio `/start` e non succede nulla

Significa quasi sempre che **Telegram non sta consegnando gli update al processo** (webhook) o che il middleware li **scarta** prima del bot.

1. **Stesso bot del token** — La chat deve essere con il bot il cui token hai messo in `TELEGRAM_BOT_TOKEN` su Render (non un altro bot di prova).
2. **`TELEGRAM_WEBHOOK_SECRET_TOKEN`** — Se su Render è valorizzata, **deve essere identica** a ciò che Telegram si aspetta. Dopo averla cambiata senza ridistribuire, o se era vuota e poi l’hai aggiunta: fai **Manual Deploy** così parte di nuovo `setWebhook`. Se dubiti, **svuota** temporaneamente `TELEGRAM_WEBHOOK_SECRET_TOKEN`, salva, redeploy, riprova `/start`; poi rimetti un segreto fisso e redeploy di nuovo.
3. **Controlla il webhook** (sostituisci `IL_TOKEN_DEL_BOT`):
   - Apri nel browser: `https://api.telegram.org/botIL_TOKEN_DEL_BOT/getWebhookInfo`
   - **`url`** deve essere `https://cocboard-telegram-bot.onrender.com/tg/cocboard-webhook` (o il tuo host Render + stesso path).
   - Se c’è **`last_error_message`**, leggilo (spesso path o secret).
4. **Log Render** — Dopo aver premuto Start, cerca una riga **`[cocboard-bot] webhook POST url=...`**. Se **non compare**, le richieste non arrivano al servizio (URL webhook sbagliato, altro bot, o servizio spento). Se compare ma in chat resta silenzio, incolla quella riga e `getWebhookInfo` (senza il token) per capire il passo successivo.

## 5) Verifica finale

1. Log Render: riga **`Webhook set: https://…onrender.com/tg/cocboard-webhook`**.
2. Apri il bot in Telegram → **`/start`** → devi vedere solo **Accedi** / **Registrati** (nessun clan finché non entri).
3. Accedi con le stesse credenziali del sito oppure registrati con tag + chiave API.
4. Dopo il login: menù con clan da profilo o `/setclan #TAG` se serve.

---

## Sicurezza

- Non incollare **service_role**, **anon** o token in chat pubbliche.
- Password e chiave API in Telegram restano nei messaggi: l’utente può eliminarli a mano; per `/cancel` durante la procedura annulla la richiesta in corso.

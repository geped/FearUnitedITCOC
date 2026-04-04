# CoCBoard — Bot Telegram

Stesso **account Supabase Auth** del sito per il menù completo e le **Mini App (web)**. Da **ospite** restano disponibili Cerca, Classifica e **Community** (chat globale + reclutamento). Il clan mostrato dopo login viene dal **profilo CoC** (`coc_clan_tag`), con override `/setclan #TAG`.

Guida passo-passo su tutti i servizi: **[`DEPLOY-COCBOARD-BOT.md`](./DEPLOY-COCBOARD-BOT.md)**.

## Variabili d’ambiente

| Variabile | Obbligatorio | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `COCBOARD_API_BASE` | sì | URL sito Vercel, es. `https://cocboard.vercel.app` (senza `/` finale) |
| `SUPABASE_URL` | sì | Project URL API (`https://xxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | sì | Chiave **anon** (Auth `signInWithPassword` dal bot) |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Salva sessione su `telegram_links` + bonus DB |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | consigliato in prod | Segreto webhook (Telegram header) |
| `COCBOARD_SITE_HOME_URL` | no | Pulsante “Apri sito” |
| `TELEGRAM_ALLOWED_IDS` | no | Limita chi può aprire il bot (lista ID separati da virgola) |
| `PORT` | no | Default `3001` |

Webhook: su Render vengono usati `RENDER_EXTERNAL_URL` e path `/tg/cocboard-webhook` salvo override. Vedi [`render.yaml`](../render.yaml).

## Database

Esegui nel SQL Editor Supabase, in ordine:

1. **[`schema-telegram-links.sql`](./schema-telegram-links.sql)** — sessione Auth + override clan  
2. **[`schema-community-chat.sql`](./schema-community-chat.sql)** — chat globale, reclutamento, colonne hub  
3. **[`schema-community-subscriber-rpc.sql`](./schema-community-subscriber-rpc.sql)** — RPC iscrizioni chat globale + `display_verified`, privacy dettagli verificati, moderazione (`telegram_global_moderation`)

Se avevi già eseguito una versione **vecchia** del punto 3 (solo 10 parametri nell’RPC), applica anche **[`schema-global-share-moderation.sql`](./schema-global-share-moderation.sql)** per allineare colonne e funzione.

## Comandi utili (dopo login)

`/setclan #TAG` · `/logout_clan` · `/esci` · `/membri` · `/help` · …

## Avvio locale

```bash
cd telegram-bot
npm install
# imposta le env (vedi .env.example)
npm start
```

Non committare mai token né chiavi Supabase.

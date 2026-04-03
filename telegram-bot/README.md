# CoCBoard — Bot Telegram

Stesso **account Supabase Auth** del sito: senza **Accedi** o **Registrati** nessuno può usare le funzioni del bot. Il clan mostrato viene dal **profilo CoC** su metadata (`coc_clan_tag`), con override opzionale tramite `/setclan #TAG`.

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

Esegui **[`schema-telegram-links.sql`](./schema-telegram-links.sql)** nel SQL Editor Supabase (sessione Auth + override clan).

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

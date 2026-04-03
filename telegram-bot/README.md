# CoCBoard — Bot Telegram

Progetto **autonomo** in questa cartella: il codice del sito nella root del repo resta invariato. Il bot consuma solo le API pubbliche già deployate e Supabase (service role) per preferenze utente e bonus.

### Login clan (per utente)
- `/login #TAGCLAN` — membro, CWL, bonus (DB) e guerre usano quel tag.
- `/logout_clan` — torni al clan predefinito `DEFAULT_CLAN_TAG`.
- `/link #TAG` — villaggio per “Il mio profilo” (opzionale, separato dal clan).
- Ricerca clan per nome: `/cerca_clan nome` (non più `/clan nome`).

Legge gli stessi dati del sito tramite gli endpoint Vercel (`/api/*`) e Supabase con **service role** (solo server).

## Variabili d’ambiente

| Variabile | Obbligatorio | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token da BotFather |
| `COCBOARD_API_BASE` | sì | URL origine del sito, es. `https://tuoprogetto.vercel.app` (senza slash finale) |
| `DEFAULT_CLAN_TAG` | no | Default `#2J2VLPP9R` |
| `SUPABASE_URL` | per `/link` e Bonus DB | Stesso progetto del sito |
| `SUPABASE_SERVICE_ROLE_KEY` | per `/link` e Bonus DB | Solo sul server del bot |
| `TELEGRAM_ALLOWED_IDS` | no | Lista ID numerici separati da virgola; se vuota, il bot accetta chiunque |
| `COCBOARD_SITE_HOME_URL` | no | URL mostrato come pulsante “Apri CoCBoard” |
| `PORT` | no | Default `3001` |
| **Webhook (produzione)** | | |
| `TELEGRAM_WEBHOOK_DOMAIN` | no* | Origine pubblica HTTPS, es. `https://cocboard-bot.onrender.com` |
| `TELEGRAM_WEBHOOK_SECRET_PATH` | no* | Path segreto, es. `/tg-hook-xyz123` (deve iniziare con `/` o viene aggiunto) |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | consigliato | Stesso valore passato a `secret_token` in `setWebhook` (Telegraf lo verifica) |

\* Se mancano dominio e path, il processo usa **long polling** (adatto a sviluppo locale, non ideale su hosting effimero).

## Database

Esegui in Supabase il file **[`schema-telegram-links.sql`](./schema-telegram-links.sql)**. Se la tabella esisteva già (solo `player_tag`), lo script aggiunge `clan_tag` e rende `player_tag` opzionale: **rieseguilo** o applica solo le righe `ALTER`/`ADD COLUMN` del file.

## Avvio

```bash
cd telegram-bot
npm install
npm start
```

## Deploy su Render (produzione)

1. Push del repo su GitHub/GitLab.
2. [Render](https://render.com) → **New** → **Blueprint** → collega il repo → Render trova [`render.yaml`](../render.yaml) nella root.
3. Nella dashboard del servizio compila i **secret**:
   - `TELEGRAM_BOT_TOKEN`
   - `COCBOARD_API_BASE` (URL del sito Vercel)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - **`TELEGRAM_WEBHOOK_SECRET_TOKEN`** — stringa lunga casuale (es. `openssl rand -hex 24`). Telegram la userà nell’header; deve coincidere con ciò che invia `setWebhook`.
4. Non serve impostare `TELEGRAM_WEBHOOK_DOMAIN` su Render: il bot usa **`RENDER_EXTERNAL_URL`** (variabile automatica). Path predefinito webhook: **`/tg/cocboard-webhook`** (sovrascrivibile con `TELEGRAM_WEBHOOK_SECRET_PATH`).
5. Dopo il deploy apri i log: deve comparire `Webhook set: https://….onrender.com/tg/cocboard-webhook`. Poi prova il bot su Telegram con `/start`.

**Health check:** `GET /health` (solo in modalità webhook).

In locale resta il **long polling** se non imposti dominio + path webhook.

Non committare mai `TELEGRAM_BOT_TOKEN` né la service role key.

# Setup email CoCBoard (senza dominio a pagamento)

Il sito resta su `https://cocboard.vercel.app`. Per inviare email a **tutti** gli utenti **senza comprare un dominio**, usa **Brevo**.

## Consigliato: Brevo (gratis)

- ~**300 email/giorno** gratis
- Verifica una **Gmail** (o altra mail) come Single Sender — **niente DNS / dominio**
- Puoi inviare OTP di recupero a qualsiasi indirizzo di recupero utente

### Setup Brevo (5 minuti)

1. Crea account su [brevo.com](https://www.brevo.com/) (ex Sendinblue).
2. **Mittenti e IP** → aggiungi la tua Gmail → conferma il codice in posta.
3. **SMTP e API → Chiavi API e MCP** → crea una **API key** (non la chiave SMTP).
4. **Obbligatorio su Vercel:** apri [IP autorizzati](https://app.brevo.com/security/authorised_ips) e **disattiva** il blocco IP.  
   Vercel usa IP sempre diversi; con la whitelist attiva l’invio fallisce (`unrecognised IP address`).
5. Su **Vercel → Production**:

| Variabile | Valore |
|-----------|--------|
| `BREVO_API_KEY` | la chiave API Brevo |
| `BREVO_FROM` | la Gmail verificata, es. `info.cocboard@gmail.com` |

6. (Opzionale) togli o ignora `RESEND_*` se usi solo Brevo.
7. **Redeploy** Production.

Se sono presenti sia Brevo sia Resend, **vince Brevo**.

## Alternativa: Resend (solo con dominio o test)

| Scenario | Funziona? |
|----------|-----------|
| Dominio tuo verificato + `RESEND_FROM=CoCBoard <noreply@…>` | Sì, a tutti |
| Senza dominio (`onboarding@resend.dev`) | Solo verso l’email del tuo account Resend |

Non mettere chiavi Resend/Brevo su Supabase o Render: servono **solo su Vercel**.

## Supabase — tabella OTP

Esegui nel SQL Editor:

`schema-password-reset-otps.sql`

## Bot Telegram (Render)

Il bot **non** richiede chiavi email: chiama le API Vercel. `COCBOARD_API_BASE` deve puntare al sito in produzione.

## Test

1. Brevo dashboard → invio di prova / oppure «Password dimenticata» sul sito verso un account con email di recupero.
2. Controlla spam se usi Gmail come mittente (è normale all’inizio).

## Note

- Auth resta `username@cocboard.internal`; l’email reale è in `user_metadata.email`.
- Limite Brevo free: ~300/giorno — più che sufficiente per CoCBoard.
- Deliverability migliore con dominio proprio; con Gmail + Brevo va bene per un clan/app piccola.

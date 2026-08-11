# Setup Resend per CoCBoard

Guida rapida per collegare Resend al sito (Vercel) e al recupero password.

## 1. Dominio mittente (consigliato in produzione)

1. Apri [Resend → Domains](https://resend.com/domains) e aggiungi un dominio (es. `tuodominio.it` o `mail.tuodominio.it`).
2. Pubblica i record DNS SPF/DKIM (e opzionalmente DMARC) mostrati da Resend.
3. Attendi la verifica del dominio.
4. Usa un mittente del tipo: `CoCBoard <noreply@tuodominio.it>`.

Senza dominio verificato Resend consente solo `onboarding@resend.dev` e spesso solo verso l’email del tuo account Resend.

## 2. Variabili su Vercel (progetto del sito)

| Variabile | Obbligatoria | Esempio |
|-----------|--------------|---------|
| `RESEND_API_KEY` | sì | `re_...` |
| `RESEND_FROM` | sì in prod | `CoCBoard <noreply@tuodominio.it>` |
| `RESEND_REPLY_TO` | no | `support@tuodominio.it` |
| `COCBOARD_SITE_HOME_URL` | consigliata | `https://cocboard.vercel.app` |

Dopo averle impostate, fai un redeploy.

## 3. Supabase — tabella OTP

Esegui nel SQL Editor lo script:

`schema-password-reset-otps.sql`

Senza questa tabella il self-service OTP non funziona.

## 4. Bot Telegram (Render)

Il bot **non** richiede `RESEND_API_KEY`: chiama le API Vercel (`password-reset-request` / `confirm`).
Assicurati che `COCBOARD_API_BASE` punti al sito in produzione.

## 5. Test

1. Dashboard Resend → invia una email di prova a te stesso.
2. Registrazione con email di recupero → email di benvenuto.
3. Admin → genera password temporanea per un utente con email → arriva anche via mail.
4. Login → «Password dimenticata» (sito o bot) → codice a 6 cifre → nuova password.

## Note

- L’account Auth resta `username@cocboard.internal`; l’email reale è in `user_metadata.email`.
- Messaggi di richiesta reset sono generici (non rivelano se username/email esistono).

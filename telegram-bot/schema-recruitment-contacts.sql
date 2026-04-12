-- CoCBoard bot — Contatti Telegram negli annunci reclutamento
-- Aggiunge fino a 2 username Telegram opzionali per ogni submission.
-- Esegui in Supabase SQL Editor (idempotente grazie a IF NOT EXISTS/ADD COLUMN IF NOT EXISTS).
-- Prerequisito: schema-community-chat.sql + schema-recruitment-upgrade.sql già eseguiti.

ALTER TABLE public.telegram_recruitment_submissions
  ADD COLUMN IF NOT EXISTS tg_contact_1 TEXT,
  ADD COLUMN IF NOT EXISTS tg_contact_2 TEXT;

COMMENT ON COLUMN public.telegram_recruitment_submissions.tg_contact_1 IS 'Username Telegram opzionale (senza @) mostrato come link t.me/ nell''annuncio.';
COMMENT ON COLUMN public.telegram_recruitment_submissions.tg_contact_2 IS 'Secondo username Telegram opzionale.';

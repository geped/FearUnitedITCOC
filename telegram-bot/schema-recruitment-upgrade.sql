-- CoCBoard bot — Aggiornamento tabelle reclutamento
-- Esegui in Supabase SQL Editor (idempotente grazie a IF NOT EXISTS).
-- Prerequisito: schema-community-chat.sql già eseguito.

-- ─── clan_tag normalizzato per controllo duplicati per clan ────────────────────
ALTER TABLE public.telegram_recruitment_submissions
  ADD COLUMN IF NOT EXISTS clan_tag TEXT;

-- Indice per controllo duplicati O(1): "esiste già un pending/approved per questo clan?"
CREATE INDEX IF NOT EXISTS telegram_recruit_sub_clan_tag_idx
  ON public.telegram_recruitment_submissions (clan_tag, status)
  WHERE clan_tag IS NOT NULL;

-- ─── submitter per notifica scadenza + pulsante "Ritira annuncio" ──────────────
ALTER TABLE public.telegram_recruitment_posts
  ADD COLUMN IF NOT EXISTS submitter_telegram_user_id BIGINT;

CREATE INDEX IF NOT EXISTS telegram_recruit_posts_submitter_idx
  ON public.telegram_recruitment_posts (submitter_telegram_user_id)
  WHERE submitter_telegram_user_id IS NOT NULL;

-- Commenti
COMMENT ON COLUMN public.telegram_recruitment_submissions.clan_tag IS 'Tag clan normalizzato (senza #, uppercase, es. 2J2VLPP9R) — per blocco duplicati per clan.';
COMMENT ON COLUMN public.telegram_recruitment_posts.submitter_telegram_user_id IS 'Telegram user id del submitter — per notifica scadenza DM e pulsante ritiro.';

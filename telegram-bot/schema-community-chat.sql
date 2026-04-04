-- CoCBoard bot — Chat globale (epoch 5 min UTC) + reclutamento (approvazione owner, 24h)
-- Esegui in Supabase SQL Editor. Accesso solo SERVICE_ROLE dal bot (come telegram_links).

-- ─── Chat globale ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_global_chat_subscribers (
  telegram_user_id BIGINT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  display_tag      TEXT,
  epoch_index      BIGINT NOT NULL,
  joined_at        TIMESTAMPTZ NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_global_sub_epoch_idx
  ON public.telegram_global_chat_subscribers (epoch_index)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.telegram_global_chat_messages (
  id                     BIGSERIAL PRIMARY KEY,
  epoch_index            BIGINT NOT NULL,
  sender_telegram_user_id BIGINT NOT NULL,
  display_label          TEXT NOT NULL,
  body                   TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_global_msg_epoch_idx
  ON public.telegram_global_chat_messages (epoch_index);

-- ─── Feed reclutamento (opt-in) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_recruitment_subscribers (
  telegram_user_id BIGINT PRIMARY KEY,
  subscribed       BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.telegram_recruitment_submissions (
  id                         BIGSERIAL PRIMARY KEY,
  submitter_telegram_user_id BIGINT NOT NULL,
  submitter_display          TEXT NOT NULL,
  body_text                  TEXT NOT NULL,
  clan_profile_url           TEXT NOT NULL,
  photo_file_id              TEXT,
  status                     TEXT NOT NULL DEFAULT 'pending',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at                TIMESTAMPTZ,
  reviewer_telegram_user_id  BIGINT
);

CREATE INDEX IF NOT EXISTS telegram_recruit_sub_status_idx
  ON public.telegram_recruitment_submissions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.telegram_recruitment_posts (
  id                BIGSERIAL PRIMARY KEY,
  submission_id     BIGINT NOT NULL REFERENCES public.telegram_recruitment_submissions (id) ON DELETE CASCADE,
  post_text         TEXT NOT NULL,
  photo_file_id     TEXT,
  approved_at       TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  delivered_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS telegram_recruit_posts_expires_idx
  ON public.telegram_recruitment_posts (expires_at);

ALTER TABLE public.telegram_global_chat_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_global_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_recruitment_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_recruitment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_recruitment_posts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_global_chat_subscribers IS 'Bot: utenti in chat globale effimera (epoch 5 min UTC).';

-- Messaggi inviati dal bot nella DM (chat globale): cancellati a fine finestra
CREATE TABLE IF NOT EXISTS public.telegram_global_ephemeral_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      BIGINT NOT NULL,
  message_id   BIGINT NOT NULL,
  epoch_index  BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_global_ephem_epoch_idx
  ON public.telegram_global_ephemeral_deliveries (epoch_index);

ALTER TABLE public.telegram_global_chat_subscribers ADD COLUMN IF NOT EXISTS hub_message_id BIGINT;
ALTER TABLE public.telegram_global_chat_subscribers ADD COLUMN IF NOT EXISTS hub_epoch_index BIGINT;

-- Opzionale: dopo ADD COLUMN, aggiorna la cache PostgREST (errore "column ... not in schema cache").
-- Se fallisce, da Supabase: Settings → API → Restart project, oppure esegui solo questa riga:
-- NOTIFY pgrst, 'reload schema';

COMMENT ON COLUMN public.telegram_global_chat_subscribers.hub_message_id IS 'Messaggio fisso stanza (countdown + pulsanti); aggiornato via edit.';
COMMENT ON COLUMN public.telegram_global_chat_subscribers.hub_epoch_index IS 'Epoch della finestra in cui è stato creato l’hub; se < epoch corrente, hub va eliminato.';

ALTER TABLE public.telegram_global_ephemeral_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_global_chat_messages IS 'Bot: messaggi chat globale (cancellati a cambio epoch).';
COMMENT ON TABLE public.telegram_global_ephemeral_deliveries IS 'Bot: message_id DM da cancellare al reset finestra (bolla chat).';
COMMENT ON TABLE public.telegram_recruitment_submissions IS 'Bot: bozze reclutamento in attesa approvazione owner.';

-- Migrazione: formattazione Telegram (grassetto, ecc.) preservata in anteprima/pubblicazione
ALTER TABLE public.telegram_recruitment_submissions ADD COLUMN IF NOT EXISTS body_html TEXT;
COMMENT ON COLUMN public.telegram_recruitment_submissions.body_html IS 'Testo annuncio in HTML (stili Telegram); se null si usa body_text escaped.';

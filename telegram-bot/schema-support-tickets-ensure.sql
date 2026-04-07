-- Idempotente: eseguire in Supabase SQL Editor se il bot risponde
-- "Impossibile aprire il ticket" o errori su telegram_support_*.
-- Crea tabelle se mancano e aggiunge colonne introdotte dopo la prima versione.

CREATE TABLE IF NOT EXISTS public.telegram_support_tickets (
    id                        BIGSERIAL PRIMARY KEY,
    telegram_user_id          BIGINT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'open',
    subject                   TEXT,
    image_count               INT NOT NULL DEFAULT 0,
    reopen_count              INT NOT NULL DEFAULT 0,
    session_index             INT NOT NULL DEFAULT 1,
    assigned_admin_id         BIGINT,
    closed_at                 TIMESTAMPTZ,
    purge_after               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.telegram_support_messages (
    id                        BIGSERIAL PRIMARY KEY,
    ticket_id                 BIGINT NOT NULL REFERENCES public.telegram_support_tickets(id) ON DELETE CASCADE,
    from_role                 TEXT NOT NULL,
    from_telegram_user_id     BIGINT,
    text                      TEXT,
    photo_file_id             TEXT,
    session_index             INT NOT NULL DEFAULT 1,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_support_tickets
  ADD COLUMN IF NOT EXISTS image_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopen_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_index INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_admin_id BIGINT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

ALTER TABLE public.telegram_support_messages
  ADD COLUMN IF NOT EXISTS session_index INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS telegram_support_tickets_status_idx
  ON public.telegram_support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS telegram_support_tickets_user_idx
  ON public.telegram_support_tickets (telegram_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS telegram_support_messages_ticket_idx
  ON public.telegram_support_messages (ticket_id, created_at ASC);

ALTER TABLE public.telegram_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_support_messages ENABLE ROW LEVEL SECURITY;

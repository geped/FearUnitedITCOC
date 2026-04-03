-- Collegamento gruppo/canale Telegram ↔ clan CoCBoard (solo service_role dal bot)
-- Esegui in Supabase SQL Editor dopo schema-telegram-links.sql

CREATE TABLE IF NOT EXISTS public.telegram_pending_chat_links (
    token                  TEXT PRIMARY KEY,
    telegram_user_id       BIGINT NOT NULL,
    clan_tag               TEXT NOT NULL,
    expires_at             TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_pending_chat_links_user_idx
  ON public.telegram_pending_chat_links (telegram_user_id);

CREATE INDEX IF NOT EXISTS telegram_pending_chat_links_expires_idx
  ON public.telegram_pending_chat_links (expires_at);

CREATE TABLE IF NOT EXISTS public.telegram_chat_links (
    telegram_chat_id       BIGINT PRIMARY KEY,
    clan_tag               TEXT NOT NULL,
    linked_by_telegram_user_id BIGINT,
    chat_type              TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_chat_links_clan_tag_idx ON public.telegram_chat_links (clan_tag);

ALTER TABLE public.telegram_pending_chat_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_chat_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_chat_links IS 'Bot: chat gruppo/canale → clan. Nessuna policy anon.';
COMMENT ON TABLE public.telegram_pending_chat_links IS 'Bot: token monouso per /linkclan in gruppo.';

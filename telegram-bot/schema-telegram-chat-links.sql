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

-- Controlli runtime del bot per chat (gruppo/supergruppo/canale)
CREATE TABLE IF NOT EXISTS public.telegram_chat_controls (
    telegram_chat_id BIGINT PRIMARY KEY,
    bot_enabled      BOOLEAN NOT NULL DEFAULT true,
    updated_by       BIGINT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_chat_controls_enabled_idx
  ON public.telegram_chat_controls (bot_enabled);

ALTER TABLE public.telegram_pending_chat_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_chat_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_chat_controls ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_chat_links IS 'Bot: chat gruppo/canale → clan. Nessuna policy anon.';
COMMENT ON TABLE public.telegram_pending_chat_links IS 'Bot: token monouso per /linkclan in gruppo.';
COMMENT ON TABLE public.telegram_chat_controls IS 'Bot: ON/OFF per chat; se bot_enabled=false risponde solo ai comandi di riattivazione.';

-- Notifiche per chat collegate (default OFF per evitare spam).
CREATE TABLE IF NOT EXISTS public.telegram_chat_notification_settings (
    telegram_chat_id            BIGINT PRIMARY KEY,
    war_alerts_enabled          BOOLEAN NOT NULL DEFAULT false,
    cwl_alerts_enabled          BOOLEAN NOT NULL DEFAULT false,
    capital_raids_enabled       BOOLEAN NOT NULL DEFAULT false,
    clan_games_enabled          BOOLEAN NOT NULL DEFAULT false,
    updated_by                  BIGINT,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.telegram_chat_notification_settings ENABLE ROW LEVEL SECURITY;

-- Eventi uso bot (analytics base admin dashboard).
CREATE TABLE IF NOT EXISTS public.telegram_usage_events (
    id                  BIGSERIAL PRIMARY KEY,
    telegram_user_id    BIGINT,
    telegram_chat_id    BIGINT,
    chat_type           TEXT,
    event_type          TEXT NOT NULL,
    payload             JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_usage_events_created_idx ON public.telegram_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_usage_events_type_idx ON public.telegram_usage_events (event_type, created_at DESC);
ALTER TABLE public.telegram_usage_events ENABLE ROW LEVEL SECURITY;

-- Restrizioni globali utente (supporto/admin panel).
CREATE TABLE IF NOT EXISTS public.telegram_user_restrictions (
    telegram_user_id    BIGINT PRIMARY KEY,
    banned              BOOLEAN NOT NULL DEFAULT false,
    muted_until         TIMESTAMPTZ,
    reason              TEXT,
    updated_by          BIGINT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.telegram_user_restrictions ENABLE ROW LEVEL SECURITY;

-- Ticket supporto utente -> admin (chat privata con bot).
CREATE TABLE IF NOT EXISTS public.telegram_support_tickets (
    id                        BIGSERIAL PRIMARY KEY,
    telegram_user_id          BIGINT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'open',
    subject                   TEXT,
    image_count               INT NOT NULL DEFAULT 0,
    assigned_admin_id         BIGINT,
    closed_at                 TIMESTAMPTZ,
    purge_after               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_support_tickets_status_idx ON public.telegram_support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS telegram_support_tickets_user_idx ON public.telegram_support_tickets (telegram_user_id, updated_at DESC);
ALTER TABLE public.telegram_support_tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.telegram_support_messages (
    id                        BIGSERIAL PRIMARY KEY,
    ticket_id                 BIGINT NOT NULL REFERENCES public.telegram_support_tickets(id) ON DELETE CASCADE,
    from_role                 TEXT NOT NULL, -- user | admin | system
    from_telegram_user_id     BIGINT,
    text                      TEXT,
    photo_file_id             TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_support_messages_ticket_idx ON public.telegram_support_messages (ticket_id, created_at ASC);
ALTER TABLE public.telegram_support_messages ENABLE ROW LEVEL SECURITY;

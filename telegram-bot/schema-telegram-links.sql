-- Bot Telegram — preferenze utente (clan + opzionale villaggio)
-- Esegui in Supabase (SQL Editor). Solo SERVICE_ROLE dal server bot.

CREATE TABLE IF NOT EXISTS public.telegram_links (
    telegram_user_id BIGINT PRIMARY KEY,
    player_tag       TEXT,
    clan_tag         TEXT,
    supabase_user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrazione da versioni precedenti (player_tag obbligatorio, senza clan_tag)
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS clan_tag TEXT;
ALTER TABLE public.telegram_links ALTER COLUMN player_tag DROP NOT NULL;

CREATE INDEX IF NOT EXISTS telegram_links_player_tag_idx ON public.telegram_links (player_tag);
CREATE INDEX IF NOT EXISTS telegram_links_clan_tag_idx ON public.telegram_links (clan_tag);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_links IS 'Bot: telegram user → clan_tag (login) e player_tag (profilo).';

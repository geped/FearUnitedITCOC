-- Bot Telegram — preferenze + sessione Supabase Auth (solo cartella telegram-bot/)
-- Esegui in Supabase SQL Editor. Accesso dati solo via SERVICE_ROLE dal server bot.

CREATE TABLE IF NOT EXISTS public.telegram_links (
    telegram_user_id     BIGINT PRIMARY KEY,
    player_tag           TEXT,
    clan_tag             TEXT,
    supabase_user_id     UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    auth_access_token    TEXT,
    auth_refresh_token   TEXT,
    auth_expires_at      TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS clan_tag TEXT;
ALTER TABLE public.telegram_links ALTER COLUMN player_tag DROP NOT NULL;
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS auth_access_token TEXT;
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS auth_refresh_token TEXT;
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS auth_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS telegram_links_player_tag_idx ON public.telegram_links (player_tag);
CREATE INDEX IF NOT EXISTS telegram_links_clan_tag_idx ON public.telegram_links (clan_tag);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_links IS 'Bot: sessione Auth + override clan. Nessuna policy anon.';

-- Handoff una tantum: Mini App / browser Telegram → CoCBoard senza ridigitare login
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS webapp_handoff_code TEXT;
ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS webapp_handoff_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS telegram_links_webapp_handoff_code_idx
  ON public.telegram_links (webapp_handoff_code)
  WHERE webapp_handoff_code IS NOT NULL;

ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS tutorial_completed_at TIMESTAMPTZ;

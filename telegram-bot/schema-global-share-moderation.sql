-- CoCBoard bot — Chat globale: privacy dettagli verificati + moderazione
-- Esegui in Supabase SQL Editor dopo schema-community-chat.sql e schema-community-subscriber-rpc.sql

-- Dettagli opzionali per profilo verificato (tag/TH/XP in chat)
ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS share_verified_details BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS cached_th_level INTEGER,
  ADD COLUMN IF NOT EXISTS cached_exp_level INTEGER;

COMMENT ON COLUMN public.telegram_global_chat_subscribers.share_verified_details IS
  'Se true e display_verified: in broadcast mostra riga con tag/TH/XP; se false solo nome e ✅.';
COMMENT ON COLUMN public.telegram_global_chat_subscribers.cached_th_level IS
  'Cache ultimo TH noto (members); aggiornata in ingresso.';
COMMENT ON COLUMN public.telegram_global_chat_subscribers.cached_exp_level IS
  'Cache ultimo livello esperienza (members); aggiornata in ingresso.';

-- Moderazione (solo service_role dal bot)
CREATE TABLE IF NOT EXISTS public.telegram_global_moderation (
  telegram_user_id BIGINT PRIMARY KEY,
  strike_count     INT NOT NULL DEFAULT 0,
  muted_until      TIMESTAMPTZ,
  banned           BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_global_moderation ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_global_moderation IS
  'Bot: strike/mute/ban chat globale; gestito solo da backend con service_role.';

-- Elimina overload precedente (10 parametri) se presente
DROP FUNCTION IF EXISTS public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean
);

CREATE OR REPLACE FUNCTION public.cocboard_upsert_global_chat_subscriber(
  p_telegram_user_id bigint,
  p_display_name text,
  p_display_tag text,
  p_epoch_index bigint,
  p_joined_at timestamptz,
  p_active boolean,
  p_updated_at timestamptz,
  p_hub_message_id bigint,
  p_hub_epoch_index bigint,
  p_display_verified boolean,
  p_share_verified_details boolean,
  p_cached_th_level integer,
  p_cached_exp_level integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.telegram_global_chat_subscribers AS s (
    telegram_user_id, display_name, display_tag, epoch_index, joined_at, active, updated_at,
    hub_message_id, hub_epoch_index, display_verified,
    share_verified_details, cached_th_level, cached_exp_level
  ) VALUES (
    p_telegram_user_id, p_display_name, p_display_tag, p_epoch_index, p_joined_at, p_active, p_updated_at,
    p_hub_message_id, p_hub_epoch_index, COALESCE(p_display_verified, false),
    COALESCE(p_share_verified_details, true), p_cached_th_level, p_cached_exp_level
  )
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    display_tag = EXCLUDED.display_tag,
    epoch_index = EXCLUDED.epoch_index,
    joined_at = EXCLUDED.joined_at,
    active = EXCLUDED.active,
    updated_at = EXCLUDED.updated_at,
    hub_message_id = EXCLUDED.hub_message_id,
    hub_epoch_index = EXCLUDED.hub_epoch_index,
    display_verified = EXCLUDED.display_verified,
    share_verified_details = EXCLUDED.share_verified_details,
    cached_th_level = EXCLUDED.cached_th_level,
    cached_exp_level = EXCLUDED.cached_exp_level;
$$;

REVOKE ALL ON FUNCTION public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';

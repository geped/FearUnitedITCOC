-- CoCBoard bot — Chat globale: ingresso "Entra come admin" (solo BOT_OWNER_TELEGRAM_IDS).
-- Esegui in Supabase SQL Editor dopo schema-community-subscriber-rpc.sql.

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS bot_owner_persona BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.telegram_global_chat_subscribers.bot_owner_persona IS
  'true = il creatore del bot entra con nome fisso CoCBoard Admin (formattazione speciale in broadcast).';

-- Sostituisci RPC upsert con parametro aggiuntivo
DROP FUNCTION IF EXISTS public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer
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
  p_cached_exp_level integer,
  p_bot_owner_persona boolean
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.telegram_global_chat_subscribers AS s (
    telegram_user_id, display_name, display_tag, epoch_index, joined_at, active, updated_at,
    hub_message_id, hub_epoch_index, display_verified,
    share_verified_details, cached_th_level, cached_exp_level, bot_owner_persona
  ) VALUES (
    p_telegram_user_id, p_display_name, p_display_tag, p_epoch_index, p_joined_at, p_active, p_updated_at,
    p_hub_message_id, p_hub_epoch_index, COALESCE(p_display_verified, false),
    COALESCE(p_share_verified_details, true), p_cached_th_level, p_cached_exp_level,
    COALESCE(p_bot_owner_persona, false)
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
    cached_exp_level = EXCLUDED.cached_exp_level,
    bot_owner_persona = EXCLUDED.bot_owner_persona;
$$;

REVOKE ALL ON FUNCTION public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer, boolean
) TO service_role;

NOTIFY pgrst, 'reload schema';

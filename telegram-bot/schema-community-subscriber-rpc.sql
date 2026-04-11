-- CoCBoard bot — RPC su telegram_global_chat_subscribers (bypass cache PostgREST su colonne hub_*)
-- La tabella `telegram_global_chat_subscribers` deve esistere (da schema-community-chat.sql).
-- Questo file aggiunge anche colonne hub / verified se mancano, poi crea le RPC.
--
-- Se vedi ancora "column ... not in schema cache" sulle REST table, questi RPC evitano il problema.
-- Opzionale ma consigliato dopo qualunque ADD COLUMN su tabelle esposte a PostgREST:
--   NOTIFY pgrst, 'reload schema';
-- oppure Dashboard → Settings → API → Restart project.

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS hub_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS hub_epoch_index BIGINT;

COMMENT ON COLUMN public.telegram_global_chat_subscribers.hub_message_id IS
  'Messaggio fisso stanza (hub); aggiornato via edit.';
COMMENT ON COLUMN public.telegram_global_chat_subscribers.hub_epoch_index IS
  'Epoch della finestra in cui è stato creato l’hub; se < epoch corrente, hub da ricreare.';

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS display_verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS share_verified_details BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS cached_th_level INTEGER,
  ADD COLUMN IF NOT EXISTS cached_exp_level INTEGER;

ALTER TABLE public.telegram_global_chat_subscribers
  ADD COLUMN IF NOT EXISTS bot_owner_persona BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.telegram_global_chat_subscribers.bot_owner_persona IS
  'Solo creatore bot (lato app): ingresso con nome CoCBoard Admin in broadcast.';

COMMENT ON COLUMN public.telegram_global_chat_subscribers.display_verified IS
  'true = nome da account CoCBoard; false = ospite con riga nomeInGioco#TAG (nessuna verifica API CoC).';

COMMENT ON COLUMN public.telegram_global_chat_subscribers.share_verified_details IS
  'Profilo verificato: se true mostra in chat tag/TH/XP; se false solo nome e ✅.';

CREATE TABLE IF NOT EXISTS public.telegram_global_moderation (
  telegram_user_id BIGINT PRIMARY KEY,
  strike_count     INT NOT NULL DEFAULT 0,
  muted_until      TIMESTAMPTZ,
  banned           BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_global_moderation ENABLE ROW LEVEL SECURITY;

-- ─── RPC (SECURITY DEFINER) ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cocboard_get_global_chat_subscriber(p_telegram_user_id bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT to_jsonb(t)
  FROM public.telegram_global_chat_subscribers t
  WHERE t.telegram_user_id = p_telegram_user_id
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.cocboard_upsert_global_chat_subscriber(
  bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean
);

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

CREATE OR REPLACE FUNCTION public.cocboard_set_global_subscriber_hub(
  p_telegram_user_id bigint,
  p_hub_message_id bigint,
  p_hub_epoch_index bigint,
  p_updated_at timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.telegram_global_chat_subscribers
  SET hub_message_id = p_hub_message_id,
      hub_epoch_index = p_hub_epoch_index,
      updated_at = p_updated_at
  WHERE telegram_user_id = p_telegram_user_id AND active = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.cocboard_clear_global_subscriber_hub(p_telegram_user_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.telegram_global_chat_subscribers
  SET hub_message_id = NULL,
      hub_epoch_index = NULL,
      updated_at = NOW()
  WHERE telegram_user_id = p_telegram_user_id;
$$;

CREATE OR REPLACE FUNCTION public.cocboard_deactivate_global_subscriber(p_telegram_user_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.telegram_global_chat_subscribers
  SET active = false,
      hub_message_id = NULL,
      hub_epoch_index = NULL,
      updated_at = NOW()
  WHERE telegram_user_id = p_telegram_user_id;
$$;

REVOKE ALL ON FUNCTION public.cocboard_get_global_chat_subscriber(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cocboard_upsert_global_chat_subscriber(bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cocboard_set_global_subscriber_hub(bigint, bigint, bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cocboard_clear_global_subscriber_hub(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cocboard_deactivate_global_subscriber(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cocboard_get_global_chat_subscriber(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.cocboard_upsert_global_chat_subscriber(bigint, text, text, bigint, timestamptz, boolean, timestamptz, bigint, bigint, boolean, boolean, integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cocboard_set_global_subscriber_hub(bigint, bigint, bigint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cocboard_clear_global_subscriber_hub(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.cocboard_deactivate_global_subscriber(bigint) TO service_role;

NOTIFY pgrst, 'reload schema';

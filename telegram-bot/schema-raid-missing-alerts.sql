-- Raid Capitale: countdown 1g / 12h / 3h + elenco opzionale nei messaggi
-- Applica su Supabase SQL Editor (già applicato su FearUnitedIT).

ALTER TABLE public.telegram_chat_notification_settings
  ADD COLUMN IF NOT EXISTS raid_missing_1d BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_missing_12h BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_missing_3h BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_missing_include_list BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.telegram_chat_notification_settings.raid_missing_1d IS 'Avviso ~24h prima fine raid capitale';
COMMENT ON COLUMN public.telegram_chat_notification_settings.raid_missing_12h IS 'Avviso ~12h prima fine raid capitale';
COMMENT ON COLUMN public.telegram_chat_notification_settings.raid_missing_3h IS 'Avviso ~3h prima fine raid capitale';
COMMENT ON COLUMN public.telegram_chat_notification_settings.raid_missing_include_list IS 'Nei countdown raid, includi elenco chi ha/non ha attaccato';

ALTER TABLE public.telegram_chat_custom_alerts
  ADD COLUMN IF NOT EXISTS raid_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_lead_minutes INTEGER;

DO $$ BEGIN
  ALTER TABLE public.telegram_chat_custom_alerts
    ADD CONSTRAINT telegram_chat_custom_alerts_raid_minutes_chk
    CHECK (raid_lead_minutes IS NULL OR (raid_lead_minutes >= 1 AND raid_lead_minutes <= 1440));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notifiche CoCBoard Bot – alert personalizzati (war/CWL/Raid)
-- Permette a Capo/Co-Capo/Admin di scegliere un preavviso custom in minuti.

CREATE TABLE IF NOT EXISTS public.telegram_chat_custom_alerts (
  telegram_chat_id BIGINT PRIMARY KEY
    REFERENCES public.telegram_chat_links(telegram_chat_id) ON DELETE CASCADE,

  war_enabled      BOOLEAN NOT NULL DEFAULT false,
  war_paused       BOOLEAN NOT NULL DEFAULT false,
  war_lead_minutes INTEGER,

  cwl_enabled      BOOLEAN NOT NULL DEFAULT false,
  cwl_paused       BOOLEAN NOT NULL DEFAULT false,
  cwl_lead_minutes INTEGER,

  raid_enabled      BOOLEAN NOT NULL DEFAULT false,
  raid_paused       BOOLEAN NOT NULL DEFAULT false,
  raid_lead_minutes INTEGER,

  updated_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT telegram_chat_custom_alerts_war_minutes_chk
    CHECK (war_lead_minutes IS NULL OR (war_lead_minutes >= 1 AND war_lead_minutes <= 1440)),
  CONSTRAINT telegram_chat_custom_alerts_cwl_minutes_chk
    CHECK (cwl_lead_minutes IS NULL OR (cwl_lead_minutes >= 1 AND cwl_lead_minutes <= 1440)),
  CONSTRAINT telegram_chat_custom_alerts_raid_minutes_chk
    CHECK (raid_lead_minutes IS NULL OR (raid_lead_minutes >= 1 AND raid_lead_minutes <= 1440))
);

ALTER TABLE public.telegram_chat_custom_alerts ENABLE ROW LEVEL SECURITY;


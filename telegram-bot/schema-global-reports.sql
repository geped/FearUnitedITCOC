-- CoCBoard bot — coda segnalazioni chat globale (admin)
-- Eseguire in Supabase SQL Editor (idempotente).

CREATE TABLE IF NOT EXISTS public.telegram_global_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_telegram_user_id BIGINT NOT NULL,
  reporter_display_name TEXT NOT NULL,
  reporter_display_tag TEXT,
  reason TEXT NOT NULL,
  reported_message_text TEXT NOT NULL,
  reported_target_telegram_user_id BIGINT,
  reported_target_display_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  action_taken TEXT,
  resolution_note TEXT,
  reviewed_by_telegram_user_id BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_global_reports_status_idx
  ON public.telegram_global_reports (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS telegram_global_reports_target_idx
  ON public.telegram_global_reports (reported_target_telegram_user_id, created_at DESC);

ALTER TABLE public.telegram_global_reports ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_global_reports IS
  'Coda segnalazioni inviate dagli utenti della chat globale; gestita in /adminbot.';

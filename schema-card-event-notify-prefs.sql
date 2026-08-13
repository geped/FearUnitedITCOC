-- Evento "Clash of Cards" — preferenze avvisi Telegram per nuovi scambi possibili.
-- Default: tutto DISATTIVATO. Proposte, messaggi in chat e scambi completati
-- restano sempre notificati (sono azioni dirette, non discovery).
-- Esegui in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.card_event_notify_prefs (
    user_id             UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    matches_enabled     BOOLEAN NOT NULL DEFAULT false,
    matches_all         BOOLEAN NOT NULL DEFAULT false,
    matches_unlock_me   BOOLEAN NOT NULL DEFAULT false,
    matches_mutual      BOOLEAN NOT NULL DEFAULT false,
    matches_same_clan   BOOLEAN NOT NULL DEFAULT false,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.card_event_notify_prefs IS
  'Preferenze avvisi Telegram per scambi carte suggeriti. Tutto OFF di default. Scritta/letta via SERVICE_ROLE da /api/lookup e dal bot.';
COMMENT ON COLUMN public.card_event_notify_prefs.matches_enabled IS
  'Master: se false non si inviano avvisi di nuovi scambi possibili.';
COMMENT ON COLUMN public.card_event_notify_prefs.matches_all IS
  'Tutti i match pubblici (comportamento precedente).';
COMMENT ON COLUMN public.card_event_notify_prefs.matches_unlock_me IS
  'Solo match in cui il destinatario sblocca una carta nuova.';
COMMENT ON COLUMN public.card_event_notify_prefs.matches_mutual IS
  'Solo match in cui sbloccano entrambi.';
COMMENT ON COLUMN public.card_event_notify_prefs.matches_same_clan IS
  'Solo match con giocatori dello stesso clan.';

ALTER TABLE public.card_event_notify_prefs ENABLE ROW LEVEL SECURITY;

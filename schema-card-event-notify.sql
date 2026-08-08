-- Evento "Clash of Cards" — outbox notifiche Telegram (Fase 3).
-- Il sito (api/_utils/card-trades.js, card-event.js) accoda righe qui quando succede
-- qualcosa che riguarda un altro utente (nuovo match, messaggio, proposta, scambio
-- accettato). Il bot Telegram (telegram-bot/lib/card-event-notify.js) fa polling
-- ogni ~45s, invia il messaggio via Telegram e marca la riga come inviata.
-- Esegui in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.card_event_notify_outbox (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('match', 'message', 'proposal', 'trade_done')),
    dedupe_key  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at     TIMESTAMPTZ
);

-- Evita di riaccodare più volte lo stesso match potenziale (finché non cambia
-- la collezione di uno dei due); messaggi/proposte/scambi usano l'id della riga
-- di origine come dedupe_key, quindi sono naturalmente unici.
CREATE UNIQUE INDEX IF NOT EXISTS card_event_notify_outbox_dedupe_idx
  ON public.card_event_notify_outbox (user_id, kind, dedupe_key);

CREATE INDEX IF NOT EXISTS card_event_notify_outbox_pending_idx
  ON public.card_event_notify_outbox (created_at)
  WHERE sent_at IS NULL;

ALTER TABLE public.card_event_notify_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.card_event_notify_outbox IS
  'Evento Clash of Cards: coda notifiche Telegram (match/messaggio/proposta/scambio). Scritta da api/lookup.js (SERVICE_ROLE), letta e marcata dal bot (SERVICE_ROLE).';

-- Il bot deve risalire dal supabase_user_id (destinatario notifica) al telegram_user_id.
CREATE INDEX IF NOT EXISTS telegram_links_supabase_user_id_idx
  ON public.telegram_links (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

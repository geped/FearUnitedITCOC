-- Lookup O(1) per badge moderatore in chat globale (sincronizzato da API quando si toggola user_metadata.telegram_moderator).
CREATE TABLE IF NOT EXISTS public.telegram_staff_moderator_ids (
  telegram_user_id BIGINT PRIMARY KEY,
  supabase_user_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_staff_moderator_supabase ON public.telegram_staff_moderator_ids (supabase_user_id);

ALTER TABLE public.telegram_staff_moderator_ids ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.telegram_staff_moderator_ids IS
  'Moderatori staff CoCBoard (Telegram). Popolata dal backend; usata dal bot per badge in broadcast chat globale.';

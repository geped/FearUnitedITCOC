-- OTP recupero password self-service (Resend)
-- Esegui nel SQL Editor di Supabase.

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  user_id     UUID PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_otps_expires_idx
  ON public.password_reset_otps (expires_at);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Solo service_role (API Vercel) legge/scrive; nessuna policy per anon/authenticated.
DROP POLICY IF EXISTS "password_reset_otps_deny_all" ON public.password_reset_otps;

COMMENT ON TABLE public.password_reset_otps IS
  'Codici OTP hashati per reset password via Resend; accesso solo SERVICE_ROLE_KEY.';

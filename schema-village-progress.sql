-- Progresso villaggio: snapshot privati da export JSON in-game (Impostazioni → Esporta dati).
-- Accesso solo via SERVICE_ROLE (API JWT verifica ownership su user_coc_profiles).
-- PRIVATO: nessuno oltre il proprietario; mai esposto in lookup pubblici / bot / mazzi.
-- Esegui su Supabase (SQL Editor) PRIMA della fase API/UI.
--
-- Dipendenze: public.user_coc_profiles (schema-user-coc-profiles.sql).
-- Retention (max 12 snapshot per user+tag): gestita in API dopo insert, non via trigger.

CREATE TABLE IF NOT EXISTS public.village_progress_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id        UUID REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL,
  coc_tag           TEXT NOT NULL,
  game_timestamp    BIGINT NOT NULL,
  th_level          INT,
  bh_level          INT,
  raw_json          JSONB NOT NULL,
  summary           JSONB NOT NULL,
  dataset_version   TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'in_game_export',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT village_progress_snapshots_tag_chk
    CHECK (coc_tag ~ '^#[0-9A-Z]+$')
);

CREATE INDEX IF NOT EXISTS village_progress_snapshots_owner_idx
  ON public.village_progress_snapshots (user_id, coc_tag, created_at DESC);

CREATE INDEX IF NOT EXISTS village_progress_snapshots_profile_idx
  ON public.village_progress_snapshots (profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;

-- Evita re-import identico dello stesso export (stesso tag + stesso timestamp gioco)
CREATE UNIQUE INDEX IF NOT EXISTS village_progress_snapshots_dedupe_idx
  ON public.village_progress_snapshots (user_id, coc_tag, game_timestamp);

ALTER TABLE public.village_progress_snapshots ENABLE ROW LEVEL SECURITY;
-- Nessuna policy per anon/authenticated: solo service_role bypassa RLS.

COMMENT ON TABLE public.village_progress_snapshots IS
  'Snapshot progresso villaggio da JSON in-game. PRIVATO: solo proprietario via API (SERVICE_ROLE).';
COMMENT ON COLUMN public.village_progress_snapshots.raw_json IS
  'Export grezzo CoC (buildings, traps, units, …). Mai esposto in endpoint pubblici.';
COMMENT ON COLUMN public.village_progress_snapshots.summary IS
  'Risultato calcolo: % TH corrente / % globale, gap, costi, tempi, upgrade attivi.';
COMMENT ON COLUMN public.village_progress_snapshots.game_timestamp IS
  'Campo timestamp dell''export in-game (unix seconds). Usato per dedupe.';
COMMENT ON COLUMN public.village_progress_snapshots.dataset_version IS
  'Versione del dataset statico data/coc-village usata per calcolare summary.';
COMMENT ON COLUMN public.village_progress_snapshots.source IS
  'Origine snapshot (default in_game_export).';

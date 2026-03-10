-- Esegui questo nel SQL Editor di Supabase per aggiungere le nuove colonne
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS th_level            integer,
  ADD COLUMN IF NOT EXISTS trophies            integer,
  ADD COLUMN IF NOT EXISTS donations           integer,
  ADD COLUMN IF NOT EXISTS donations_received  integer,
  ADD COLUMN IF NOT EXISTS exp_level           integer,
  ADD COLUMN IF NOT EXISTS clan_rank           integer;

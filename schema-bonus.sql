-- Aggiunge colonna bonus_assigned a cwl_history
-- Esegui nel SQL Editor di Supabase

ALTER TABLE cwl_history ADD COLUMN IF NOT EXISTS bonus_assigned boolean DEFAULT false;

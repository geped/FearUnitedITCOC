-- ══════════════════════════════════════════════════════════════
-- CoCBoard — Retention ex-player & isolamento alias per clan
-- Esegui questo script nel SQL Editor di Supabase
-- ══════════════════════════════════════════════════════════════

-- ── player_aliases: aggiungi clan_tag ────────────────────────
ALTER TABLE player_aliases ADD COLUMN IF NOT EXISTS clan_tag TEXT;
CREATE INDEX IF NOT EXISTS player_aliases_clan_tag_idx ON player_aliases(clan_tag);

-- Etichetta alias esistenti come Fear United IT
UPDATE player_aliases SET clan_tag = '#2J2VLPP9R' WHERE clan_tag IS NULL;

-- ── cwl_bonuses: aggiungi player_name se non esiste ──────────
-- (necessario per il purge per nome)
ALTER TABLE cwl_bonuses ADD COLUMN IF NOT EXISTS player_name TEXT;

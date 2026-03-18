-- ══════════════════════════════════════════════════════════════
-- CoCBoard — Migrazione multi-clan
-- Esegui questo script nel SQL Editor di Supabase
-- ══════════════════════════════════════════════════════════════

-- ── members ──────────────────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS clan_tag  TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS clan_name TEXT;
CREATE INDEX IF NOT EXISTS members_clan_tag_idx ON members(clan_tag);

-- ── cwl_bonuses ───────────────────────────────────────────────
ALTER TABLE cwl_bonuses ADD COLUMN IF NOT EXISTS clan_tag TEXT;
CREATE INDEX IF NOT EXISTS cwl_bonuses_clan_tag_idx ON cwl_bonuses(clan_tag);

-- ── cwl_history ───────────────────────────────────────────────
ALTER TABLE cwl_history ADD COLUMN IF NOT EXISTS clan_tag TEXT;
ALTER TABLE cwl_history DROP CONSTRAINT IF EXISTS cwl_history_player_name_season_key;
ALTER TABLE cwl_history ADD CONSTRAINT cwl_history_player_name_season_clan_key
    UNIQUE (player_name, season, clan_tag);
CREATE INDEX IF NOT EXISTS cwl_history_clan_tag_idx ON cwl_history(clan_tag);

-- ── cwl_seasons ───────────────────────────────────────────────
ALTER TABLE cwl_seasons ADD COLUMN IF NOT EXISTS clan_tag TEXT;
ALTER TABLE cwl_seasons DROP CONSTRAINT IF EXISTS cwl_seasons_season_key;
ALTER TABLE cwl_seasons ADD CONSTRAINT cwl_seasons_season_clan_key
    UNIQUE (season, clan_tag);
CREATE INDEX IF NOT EXISTS cwl_seasons_clan_tag_idx ON cwl_seasons(clan_tag);

-- ── Retrocompatibilità: etichetta dati esistenti (Fear United IT) ──
UPDATE members     SET clan_tag = '#2J2VLPP9R', clan_name = 'Fear United IT' WHERE clan_tag IS NULL;
UPDATE cwl_bonuses SET clan_tag = '#2J2VLPP9R'  WHERE clan_tag IS NULL;
UPDATE cwl_history SET clan_tag = '#2J2VLPP9R'  WHERE clan_tag IS NULL;
UPDATE cwl_seasons SET clan_tag = '#2J2VLPP9R'  WHERE clan_tag IS NULL;

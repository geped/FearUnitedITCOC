-- ── TABELLA STORICO CWL ────────────────────────────────────────────────────
-- Esegui nel SQL Editor di Supabase

CREATE TABLE IF NOT EXISTS cwl_history (
    id                serial PRIMARY KEY,
    player_name       text NOT NULL,
    season            text NOT NULL,          -- formato 'YYYY-MM'
    participated      boolean DEFAULT false,  -- ha giocato la CWL?
    stars             integer DEFAULT 0,
    destruction       numeric(5,2) DEFAULT 0,
    attacks_made      integer DEFAULT 0,
    attacks_required  integer DEFAULT 0,
    bonus_score       integer DEFAULT 0,      -- bonus CWL assegnato
    still_in_clan     boolean DEFAULT true,
    is_secondary      boolean DEFAULT false,
    UNIQUE(player_name, season)
);

ALTER TABLE cwl_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticati leggono cwl_history" ON cwl_history
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Autenticati scrivono cwl_history" ON cwl_history
    FOR ALL USING (auth.role() = 'authenticated');

-- ── DATI STORICI: CWL MARZO 2025 (dal file Excel) ──────────────────────────
INSERT INTO cwl_history (player_name, season, participated, bonus_score, still_in_clan, is_secondary) VALUES
-- Player attivi nel clan (verde = partecipato, azzurro = non partecipato)
('Geped',                 '2025-03', true,  5, true,  false),
('Ohlins',               '2025-03', true,  6, true,  false),
('Pexy',                 '2025-03', true,  6, true,  false),
('l97',                  '2025-03', true,  6, true,  false),
('Gianni',               '2025-03', true,  2, true,  false),
('Nico 9800',            '2025-03', false, 6, true,  false),
('Tommy.v96',            '2025-03', false, 4, true,  false),
('Geroldd',              '2025-03', false, 1, true,  false),
('Marko',                '2025-03', false, 1, true,  false),
('Siddi++',              '2025-03', true,  5, true,  false),
('♤Aman♤',              '2025-03', true,  3, true,  false),
('THUG LIFE (I CHARLIE)','2025-03', true,  5, true,  false),
('Fosco',                '2025-03', true,  6, true,  false),
('Giacomo',              '2025-03', false, 0, true,  false),
('Miky',                 '2025-03', true,  5, true,  false),
('geky888',              '2025-03', true,  3, true,  false),
('ale',                  '2025-03', false, 2, true,  false),
('bam',                  '2025-03', true,  1, true,  false),
('SamuRuggi',            '2025-03', true,  3, true,  false),
('xXGabboXx',            '2025-03', true,  2, true,  false),
('pl,okmijnuhb',         '2025-03', true,  1, true,  false),
('giuseppe',             '2025-03', true,  0, true,  false),
('Mec',                  '2025-03', true,  0, true,  false),
-- Ex-player (colore rosso nel file)
('Mago',                 '2025-03', false, 4, false, false),
('Alessio',              '2025-03', false, 8, false, false),
('Noakin',               '2025-03', false, 1, false, false),
('Lele177',              '2025-03', false, 4, false, false),
('TSvale',               '2025-03', false, 1, false, false),
('Pomodorino',           '2025-03', false, 2, false, false),
('Gino',                 '2025-03', false, 1, false, false),
-- Account secondari (blu)
('Geped 2',              '2025-03', false, 0, true,  true),
('Geped 3',              '2025-03', false, 0, true,  true),
('Geped troll',          '2025-03', false, 0, true,  true),
('Nara',                 '2025-03', false, 0, true,  true),
('TomHawk',              '2025-03', false, 0, true,  true),
('fosco',                '2025-03', false, 0, true,  true),
('SamuRuggi2',           '2025-03', false, 0, true,  true),
('Samuele',              '2025-03', false, 0, true,  true)
ON CONFLICT (player_name, season) DO NOTHING;

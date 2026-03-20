-- ═══════════════════════════════════════════════════════════════════════════════
-- CoCBoard — SCHEMA MASTER UNIFICATO
-- Data: 2026-03-20
-- Progetto: Dashboard clan Clash of Clans "Fear United IT" (#2J2VLPP9R)
--
-- Questo file unifica tutti gli script SQL del progetto nell'ordine corretto
-- di esecuzione. Applicare integralmente su un database Supabase vuoto per
-- ottenere lo schema completo e aggiornato.
--
-- Ordine di applicazione: 1→base, 2→update, 3→cwl, 4→bonus, 5→multiclan, 6→retention, 7→league, 8→classic-wars, 9→security
--
-- Sorgenti originali (in ordine):
--   1. schema.sql               — Tabelle base + RLS iniziale
--   2. schema-update.sql        — Colonne aggiuntive su members
--   3. schema-cwl.sql           — Storico CWL + dati marzo 2025
--   4. schema-bonus.sql         — Colonna bonus_assigned su cwl_history
--   5. schema-multiclan.sql     — Supporto multi-clan (clan_tag su tutte le tabelle)
--   6. schema-retention.sql     — Retention ex-player + isolamento alias per clan
--   7. schema-league.sql        — Colonna lega individuale su members
--   8. schema-classic-wars.sql  — Tabella storico war classiche
--   9. schema-security-rls-v2.sql — Fix sicurezza RLS (ripristino scrittura anon sync)
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══ SEZIONE 1: BASE — Tabelle fondamentali + RLS iniziale ═══
-- Fonte: schema.sql

-- Esegui questo script nel SQL Editor di Supabase
-- https://supabase.com/dashboard/project/ubgpohirljxmnamuzuqi/sql

CREATE TABLE IF NOT EXISTS public.members (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cwl_bonuses (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  rank INTEGER,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  received_last_month BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cwl_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_members" ON public.members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: solo lettura (ANON_KEY è pubblica nel frontend — nessuna scrittura senza auth)
CREATE POLICY "anon_members_read" ON public.members
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_bonuses" ON public.cwl_bonuses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: solo lettura
CREATE POLICY "anon_bonuses_read" ON public.cwl_bonuses
  FOR SELECT TO anon USING (true);


-- ═══ SEZIONE 2: UPDATE — Colonne aggiuntive su members ═══
-- Fonte: schema-update.sql

-- Esegui questo nel SQL Editor di Supabase per aggiungere le nuove colonne
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS th_level            integer,
  ADD COLUMN IF NOT EXISTS trophies            integer,
  ADD COLUMN IF NOT EXISTS donations           integer,
  ADD COLUMN IF NOT EXISTS donations_received  integer,
  ADD COLUMN IF NOT EXISTS exp_level           integer,
  ADD COLUMN IF NOT EXISTS clan_rank           integer;


-- ═══ SEZIONE 3: CWL — Storico CWL + dati storici marzo 2025 ═══
-- Fonte: schema-cwl.sql

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


-- ═══ SEZIONE 4: BONUS — Colonna bonus_assigned su cwl_history ═══
-- Fonte: schema-bonus.sql

-- Aggiunge colonna bonus_assigned a cwl_history
-- Esegui nel SQL Editor di Supabase

ALTER TABLE cwl_history ADD COLUMN IF NOT EXISTS bonus_assigned boolean DEFAULT false;


-- ═══ SEZIONE 5: MULTICLAN — Supporto multi-clan (clan_tag su tutte le tabelle) ═══
-- Fonte: schema-multiclan.sql

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


-- ═══ SEZIONE 6: RETENTION — Retention ex-player + isolamento alias per clan ═══
-- Fonte: schema-retention.sql

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


-- ═══ SEZIONE 7: LEAGUE — Colonna lega individuale su members ═══
-- Fonte: schema-league.sql

-- CoCBoard — Aggiunge colonna lega individuale per ogni giocatore
-- Esegui questo script nel SQL Editor di Supabase
-- https://supabase.com/dashboard/project/_/sql

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS league_name TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS league_icon_url TEXT;


-- ═══ SEZIONE 8: CLASSIC-WARS — Tabella storico war classiche ═══
-- Fonte: schema-classic-wars.sql

-- CoCBoard — Tabella per storico war classiche con dettagli attacchi
-- Esegui nel SQL Editor di Supabase: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS public.classic_wars (
    id            BIGSERIAL PRIMARY KEY,
    clan_tag      TEXT NOT NULL,
    end_time      TEXT NOT NULL,            -- formato CoC: "20250318T120000.000Z"
    result        TEXT,                     -- 'win' | 'lose' | 'tie'
    team_size     INT,
    atk_per_member INT DEFAULT 2,
    our_tag       TEXT,
    our_name      TEXT,
    our_badge     TEXT,
    our_stars     INT,
    our_destr     DECIMAL(5,2),
    opp_tag       TEXT,
    opp_name      TEXT,
    opp_badge     TEXT,
    opp_stars     INT,
    opp_destr     DECIMAL(5,2),
    our_members   JSONB,                    -- array [{tag,name,townhallLevel,mapPosition,attacks:[...]}]
    opp_members   JSONB,                    -- stessa struttura
    saved_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clan_tag, end_time)
);

-- RLS: solo service role può scrivere, tutti i ruoli autenticati possono leggere
ALTER TABLE public.classic_wars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classic_wars_read" ON public.classic_wars
    FOR SELECT USING (true);

CREATE POLICY "classic_wars_insert" ON public.classic_wars
    FOR INSERT WITH CHECK (true);

CREATE POLICY "classic_wars_upsert" ON public.classic_wars
    FOR UPDATE USING (true);


-- ═══ SEZIONE 9: SECURITY — Fix RLS v2 (ripristino scrittura anon per sync) ═══
-- Fonte: schema-security-rls-v2.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX v2: Ripristino scrittura anon su members (necessaria per sync)
-- Esegui nel SQL Editor di Supabase:
-- https://supabase.com/dashboard/project/ubgpohirljxmnamuzuqi/sql
--
-- RAGIONAMENTO:
-- - members: dati pubblici CoC (nomi, th_level, trofei) — la sync li sovrascrive
--   ad ogni esecuzione, quindi un write malevolo viene corretto al prossimo sync.
--   Ripristiniamo la scrittura anon per permettere al render-proxy di sincronizzare.
-- - cwl_bonuses: dati sensibili (assegnazione bonus) — manteniamo solo lettura anon.
--   Le scritture avvengono solo da utenti autenticati.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ripristina scrittura anon su members (render-proxy sync)
DROP POLICY IF EXISTS "anon_members_read" ON public.members;
CREATE POLICY "anon_members" ON public.members
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- cwl_bonuses: mantieni solo lettura per anon (dati sensibili)
-- (anon_bonuses_read è già attiva dal fix precedente — nessuna modifica necessaria)

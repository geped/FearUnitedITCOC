-- ══════════════════════════════════════════════════════════════
-- CoCBoard — Tabella storico guerre CWL + colonne aggiuntive cwl_seasons
-- Esegui nel SQL Editor di Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ══════════════════════════════════════════════════════════════

-- ── cwl_wars: un record per ogni turno CWL con dettaglio attacchi ──
CREATE TABLE IF NOT EXISTS public.cwl_wars (
    id            BIGSERIAL PRIMARY KEY,
    clan_tag      TEXT NOT NULL,
    season        TEXT NOT NULL,              -- formato 'YYYY-MM'
    round         INTEGER NOT NULL,           -- 1-7
    war_tag       TEXT,
    state         TEXT,                       -- 'warEnded' | 'inWar' | 'preparation'
    team_size     INT,
    start_time    TEXT,
    end_time      TEXT,
    result        TEXT,                       -- 'win' | 'lose' | 'draw' | 'ongoing' | 'preparation'
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
    our_members   JSONB,                     -- [{tag,name,thLevel,mapPosition,attacks:[{defenderTag,stars,destruction,order}]}]
    opp_members   JSONB,
    defender_map  JSONB,                     -- {tag: {name, thLevel}} per lookup rapido
    saved_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clan_tag, season, round)
);

ALTER TABLE public.cwl_wars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cwl_wars_read" ON public.cwl_wars
    FOR SELECT USING (true);

CREATE POLICY "cwl_wars_insert" ON public.cwl_wars
    FOR INSERT WITH CHECK (true);

CREATE POLICY "cwl_wars_upsert" ON public.cwl_wars
    FOR UPDATE USING (true);

-- ── cwl_seasons: colonne aggiuntive per classifica gruppo e roster ──
ALTER TABLE public.cwl_seasons ADD COLUMN IF NOT EXISTS group_standings JSONB;
ALTER TABLE public.cwl_seasons ADD COLUMN IF NOT EXISTS roster JSONB;

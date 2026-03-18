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

-- ══════════════════════════════════════════════════════════════
-- CoCBoard — Storico Raid Capitale (weekend)
-- Esegui nel SQL Editor di Supabase.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.capital_raids (
    id                         BIGSERIAL PRIMARY KEY,
    clan_tag                   TEXT NOT NULL,
    weekend_start              TEXT NOT NULL, -- formato CoC API: YYYYMMDDTHHMMSS.000Z
    weekend_end                TEXT,
    state                      TEXT,
    capital_total_loot         INTEGER NOT NULL DEFAULT 0,
    raids_completed            INTEGER NOT NULL DEFAULT 0,
    total_attacks              INTEGER NOT NULL DEFAULT 0,
    enemy_districts_destroyed  INTEGER NOT NULL DEFAULT 0,
    offensive_reward           INTEGER NOT NULL DEFAULT 0,
    defensive_reward           INTEGER NOT NULL DEFAULT 0,
    top_contributor_name       TEXT,
    top_contributor_tag        TEXT,
    top_contributor_loot       INTEGER NOT NULL DEFAULT 0,
    attack_log                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    defense_log                JSONB NOT NULL DEFAULT '[]'::jsonb,
    members                    JSONB NOT NULL DEFAULT '[]'::jsonb,
    saved_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(clan_tag, weekend_start)
);

ALTER TABLE public.capital_raids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capital_raids_read"
ON public.capital_raids
FOR SELECT
USING (true);

CREATE POLICY "capital_raids_insert"
ON public.capital_raids
FOR INSERT
WITH CHECK (true);

CREATE POLICY "capital_raids_update"
ON public.capital_raids
FOR UPDATE
USING (true);

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

-- Multi-profilo CoC per account CoCBoard
-- Un Auth user → N villaggi (max 10 enforced in API). Un coc_tag → un solo account.
-- Esegui su Supabase (SQL Editor) oppure via migrazione MCP.

CREATE TABLE IF NOT EXISTS public.user_coc_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    coc_tag              TEXT NOT NULL,
    username             TEXT,
    clan_role            TEXT NOT NULL DEFAULT 'membro'
                         CHECK (clan_role IN ('capo', 'co-capo', 'anziano', 'membro', 'utente')),
    coc_clan_tag         TEXT,
    coc_clan_name        TEXT,
    coc_clan_badge_url   TEXT,
    town_hall_level      INT,
    label                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_coc_profiles_coc_tag_unique UNIQUE (coc_tag)
);

CREATE INDEX IF NOT EXISTS user_coc_profiles_user_id_idx
  ON public.user_coc_profiles (user_id);

ALTER TABLE public.user_coc_profiles
  ADD COLUMN IF NOT EXISTS town_hall_level INT;

CREATE TABLE IF NOT EXISTS public.user_account_prefs (
    user_id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    active_profile_id    UUID REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL,
    default_profile_id   UUID REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL,
    always_ask_profile   BOOLEAN NOT NULL DEFAULT false,
    mini_app_profile_id  UUID REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL,
    account_is_admin     BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_chat_links
  ADD COLUMN IF NOT EXISTS linked_by_profile_id UUID
  REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS telegram_chat_links_profile_idx
  ON public.telegram_chat_links (linked_by_profile_id)
  WHERE linked_by_profile_id IS NOT NULL;

ALTER TABLE public.user_coc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_account_prefs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_coc_profiles IS
  'Villaggi CoC collegati a un account CoCBoard. Accesso solo SERVICE_ROLE.';
COMMENT ON TABLE public.user_account_prefs IS
  'Preferenze multi-profilo (attivo, default, chiedi sempre, Mini App, admin account).';
COMMENT ON COLUMN public.telegram_chat_links.linked_by_profile_id IS
  'Profilo CoC usato al momento del collegamento chat→clan.';

-- =============================================================================
-- Notifiche CoCBoard Bot – v2 (flag granulari per Guerra, CWL, Raid, Attività)
-- Applica su Supabase SQL Editor.
-- Tutti i nuovi flag hanno DEFAULT false (disattivati).
-- =============================================================================

ALTER TABLE telegram_chat_notification_settings

  -- ── Guerra Classica (sub-flag di war_alerts_enabled) ─────────────────────
  ADD COLUMN IF NOT EXISTS war_prep_start          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_start_alert         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_missing_4h          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_missing_1h          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_missing_15m         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_3star               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS war_result              BOOLEAN NOT NULL DEFAULT false,

  -- ── CWL (sub-flag di cwl_alerts_enabled) ─────────────────────────────────
  ADD COLUMN IF NOT EXISTS cwl_prep_start          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_round_start         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_missing_4h          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_missing_1h          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_missing_15m         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_round_end           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_end                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_league_promotion    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_league_demotion     BOOLEAN NOT NULL DEFAULT false,

  -- ── Raid Capitale (sub-flag di capital_raids_enabled) ────────────────────
  ADD COLUMN IF NOT EXISTS raid_start              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_district_destroyed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_clan_cleared       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_capital_fallen     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_end                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_loot_milestone     BOOLEAN NOT NULL DEFAULT false,

  -- ── Attività Clan (nuovo master + sub-flag) ───────────────────────────────
  ADD COLUMN IF NOT EXISTS clan_activity_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_member_join        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_member_leave       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_role_promoted      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_role_demoted       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_level_up           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_war_streak         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clan_name_change        BOOLEAN NOT NULL DEFAULT false;

-- Commenti documentazione
COMMENT ON COLUMN telegram_chat_notification_settings.war_prep_start          IS 'Avviso inizio fase preparazione guerra classica';
COMMENT ON COLUMN telegram_chat_notification_settings.war_start_alert         IS 'Avviso inizio guerra classica';
COMMENT ON COLUMN telegram_chat_notification_settings.war_missing_4h          IS 'Avviso 4h prima fine guerra classica (attacchi mancanti)';
COMMENT ON COLUMN telegram_chat_notification_settings.war_missing_1h          IS 'Avviso 1h prima fine guerra classica (attacchi mancanti)';
COMMENT ON COLUMN telegram_chat_notification_settings.war_missing_15m         IS 'Avviso 15min prima fine guerra classica (attacchi mancanti)';
COMMENT ON COLUMN telegram_chat_notification_settings.war_3star               IS 'Avviso guerra perfetta (tutte 3 stelle)';
COMMENT ON COLUMN telegram_chat_notification_settings.war_result              IS 'Recap finale guerra classica';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_prep_start          IS 'Avviso inizio preparazione round CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_round_start         IS 'Avviso inizio round CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_missing_4h          IS 'Avviso 4h prima fine round CWL (attacchi mancanti)';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_missing_1h          IS 'Avviso 1h prima fine round CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_missing_15m         IS 'Avviso 15min prima fine round CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_round_end           IS 'Recap fine round CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_end                 IS 'Avviso fine stagione CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_league_promotion    IS 'Avviso promozione lega CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_league_demotion     IS 'Avviso retrocessione lega CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_start              IS 'Avviso inizio weekend raid capitale';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_district_destroyed IS 'Avviso distretto nemico distrutto al 100%';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_clan_cleared       IS 'Avviso clan nemico completamente eliminato';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_capital_fallen     IS 'Avviso nostra capitale caduta';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_end                IS 'Avviso fine weekend raid';
COMMENT ON COLUMN telegram_chat_notification_settings.raid_loot_milestone     IS 'Avviso milestone oro raid (50k/100k...)';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_activity_enabled   IS 'Master toggle attività clan';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_member_join        IS 'Avviso nuovo membro nel clan';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_member_leave       IS 'Avviso membro uscito dal clan';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_role_promoted      IS 'Avviso promozione ruolo membro';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_role_demoted       IS 'Avviso retrocessione ruolo membro';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_level_up           IS 'Avviso livello clan aumentato';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_war_streak         IS 'Avviso serie vittorie consecutive';
COMMENT ON COLUMN telegram_chat_notification_settings.clan_name_change        IS 'Avviso cambio nome clan';

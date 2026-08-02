-- =============================================================================
-- Notifiche CWL – v3 (round perfetto separato, overlap prep, roster, stagione)
-- Applica su Supabase SQL Editor se la migrazione MCP non è già stata applicata.
-- =============================================================================

ALTER TABLE telegram_chat_notification_settings
  ADD COLUMN IF NOT EXISTS cwl_3star            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_prep_next        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_roster_reminder  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_season_start     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cwl_standings        BOOLEAN NOT NULL DEFAULT false;

-- Chi aveva il recap ON riceveva anche il "perfetto": allinea il nuovo flag
UPDATE telegram_chat_notification_settings
SET cwl_3star = true
WHERE cwl_round_end = true AND cwl_3star = false;

COMMENT ON COLUMN telegram_chat_notification_settings.cwl_3star           IS 'Avviso round CWL perfetto (tutte 3 stelle)';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_prep_next       IS 'Avviso prep turno successivo mentre gira ancora una battle';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_roster_reminder IS 'Promemoria roster/CC ~6h prima inizio battle CWL';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_season_start    IS 'Avviso inizio stagione CWL / gruppo assegnato';
COMMENT ON COLUMN telegram_chat_notification_settings.cwl_standings       IS 'Classifica gruppo dopo fine round CWL';

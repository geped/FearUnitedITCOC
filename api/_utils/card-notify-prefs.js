'use strict';

/**
 * Preferenze avvisi Telegram per nuovi scambi possibili (Clash of Cards).
 * Default: tutto OFF. Le notifiche transazionali (proposta, messaggio, escrow,
 * scambio completato) non passano da qui.
 */

const DEFAULT_PREFS = {
  matches_enabled: false,
  matches_all: false,
  matches_unlock_me: false,
  matches_mutual: false,
  matches_same_clan: false,
};

const BOOL_KEYS = Object.keys(DEFAULT_PREFS);

function normalizePrefs(row) {
  const out = { ...DEFAULT_PREFS };
  if (!row) return out;
  for (const k of BOOL_KEYS) {
    if (typeof row[k] === 'boolean') out[k] = row[k];
  }
  return out;
}

function sameClanName(a, b) {
  const na = String(a || '').trim().toLowerCase();
  const nb = String(b || '').trim().toLowerCase();
  return na.length > 0 && na === nb;
}

/**
 * @param {object} prefs
 * @param {{ iUnlock?: boolean, theyUnlock?: boolean, sameClan?: boolean }} match
 */
function shouldNotifyMatch(prefs, match = {}) {
  const p = normalizePrefs(prefs);
  if (!p.matches_enabled) return false;
  if (p.matches_all) return true;
  const iUnlock = match.iUnlock === true;
  const theyUnlock = match.theyUnlock === true;
  if (p.matches_unlock_me && iUnlock) return true;
  if (p.matches_mutual && iUnlock && theyUnlock) return true;
  if (p.matches_same_clan && match.sameClan === true) return true;
  return false;
}

/** Se si accende il master senza alcun sotto-flag, attiva "solo se sblocco io". */
function withMasterSafeDefaults(prefs) {
  const p = normalizePrefs(prefs);
  if (
    p.matches_enabled &&
    !p.matches_all &&
    !p.matches_unlock_me &&
    !p.matches_mutual &&
    !p.matches_same_clan
  ) {
    p.matches_unlock_me = true;
  }
  return p;
}

async function getPrefs(admin, userId) {
  if (!userId) return { ...DEFAULT_PREFS };
  const { data } = await admin
    .from('card_event_notify_prefs')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return normalizePrefs(data);
}

async function getPrefsMap(admin, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  for (const id of ids) map[id] = { ...DEFAULT_PREFS };
  if (!ids.length) return map;
  const { data } = await admin.from('card_event_notify_prefs').select('*').in('user_id', ids);
  for (const row of data || []) map[row.user_id] = normalizePrefs(row);
  return map;
}

async function savePrefs(admin, userId, patch) {
  if (!userId) {
    const e = new Error('user_id obbligatorio.');
    e.status = 400;
    throw e;
  }
  const current = await getPrefs(admin, userId);
  const next = { ...current };
  for (const k of BOOL_KEYS) {
    if (typeof patch[k] === 'boolean') next[k] = patch[k];
  }
  const enablingMaster = next.matches_enabled && !current.matches_enabled;
  const safe = enablingMaster ? withMasterSafeDefaults(next) : next;
  const row = {
    user_id: userId,
    ...safe,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from('card_event_notify_prefs')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return { ok: true, prefs: normalizePrefs(data || row) };
}

module.exports = {
  DEFAULT_PREFS,
  BOOL_KEYS,
  normalizePrefs,
  sameClanName,
  shouldNotifyMatch,
  withMasterSafeDefaults,
  getPrefs,
  getPrefsMap,
  savePrefs,
};

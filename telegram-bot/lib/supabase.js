'use strict';

const { createClient } = require('@supabase/supabase-js');

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getFullRow(telegramUserId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_links')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function getTelegramRow(telegramUserId) {
  const row = await getFullRow(telegramUserId);
  if (!row) return null;
  return { player_tag: row.player_tag, clan_tag: row.clan_tag };
}

async function getTelegramLink(telegramUserId) {
  const row = await getTelegramRow(telegramUserId);
  return row?.player_tag || null;
}

async function getSavedClanTag(telegramUserId) {
  const row = await getTelegramRow(telegramUserId);
  const t = row?.clan_tag;
  if (!t || !String(t).trim()) return null;
  const s = String(t).trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s}`;
}

async function getAuthTokensRow(telegramUserId) {
  return getFullRow(telegramUserId);
}

function normSessionTimes(session) {
  const exp = session?.expires_at;
  if (exp == null) return null;
  if (typeof exp === 'number') return new Date(exp * 1000).toISOString();
  return new Date(exp).toISOString();
}

async function saveAuthSession(telegramUserId, session, user) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const prev = await getFullRow(telegramUserId);
  const now = new Date().toISOString();
  const meta = user?.user_metadata || {};
  const row = {
    telegram_user_id: telegramUserId,
    supabase_user_id: user.id,
    auth_access_token: session.access_token,
    auth_refresh_token: session.refresh_token,
    auth_expires_at: normSessionTimes(session),
    player_tag: prev?.player_tag ?? meta.coc_tag ?? null,
    clan_tag: prev?.clan_tag ?? null,
    updated_at: now,
  };
  if (!prev) row.created_at = now;
  else row.created_at = prev.created_at;
  const { error } = await client.from('telegram_links').upsert(row, { onConflict: 'telegram_user_id' });
  if (error) throw new Error(error.message);
}

async function clearAuthSession(telegramUserId) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const { error } = await client.from('telegram_links').delete().eq('telegram_user_id', telegramUserId);
  if (error) throw new Error(error.message);
}

/**
 * patch.player_tag / patch.clan_tag: undefined = non modificare, null = rimuovi
 */
async function upsertTelegramRow(telegramUserId, patch) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato (SUPABASE_URL / SERVICE_ROLE).');
  const prev = await getFullRow(telegramUserId);
  let player_tag =
    patch.player_tag !== undefined ? patch.player_tag : prev?.player_tag !== undefined ? prev.player_tag : null;
  let clan_tag =
    patch.clan_tag !== undefined ? patch.clan_tag : prev?.clan_tag !== undefined ? prev.clan_tag : null;

  if (player_tag != null && !String(player_tag).trim()) player_tag = null;
  if (clan_tag != null && !String(clan_tag).trim()) clan_tag = null;

  const now = new Date().toISOString();
  const hasAuth = prev?.auth_refresh_token;

  if (!player_tag && !clan_tag && !hasAuth) {
    const { error: delErr } = await client.from('telegram_links').delete().eq('telegram_user_id', telegramUserId);
    if (delErr) throw new Error(delErr.message);
    return;
  }

  if (!player_tag && !clan_tag && hasAuth) {
    const { error } = await client
      .from('telegram_links')
      .update({ player_tag: null, clan_tag: null, updated_at: now })
      .eq('telegram_user_id', telegramUserId);
    if (error) throw new Error(error.message);
    return;
  }

  const row = {
    telegram_user_id: telegramUserId,
    player_tag,
    clan_tag,
    supabase_user_id: prev?.supabase_user_id ?? null,
    auth_access_token: prev?.auth_access_token ?? null,
    auth_refresh_token: prev?.auth_refresh_token ?? null,
    auth_expires_at: prev?.auth_expires_at ?? null,
    updated_at: now,
  };
  if (!prev) row.created_at = now;
  else row.created_at = prev.created_at;

  const { error } = await client.from('telegram_links').upsert(row, { onConflict: 'telegram_user_id' });
  if (error) throw new Error(error.message);
}

async function setSavedClanTag(telegramUserId, clanTagRaw) {
  const s = String(clanTagRaw || '').trim().toUpperCase();
  const norm = s.startsWith('#') ? s : `#${s}`;
  await upsertTelegramRow(telegramUserId, { clan_tag: norm });
}

async function clearSavedClanOnly(telegramUserId) {
  await upsertTelegramRow(telegramUserId, { clan_tag: null });
}

async function deleteTelegramLink(telegramUserId) {
  await clearAuthSession(telegramUserId);
}

async function fetchBonusesForClan(clanTag) {
  const client = sb();
  if (!client) return null;
  const norm = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  const { data, error } = await client
    .from('cwl_bonuses')
    .select('name,tag,score,rank,received_last_month,clan_tag')
    .order('rank', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const rows = (data || []).filter((r) => !r.clan_tag || r.clan_tag === norm);
  rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return rows;
}

module.exports = {
  sb,
  getFullRow,
  getTelegramRow,
  getTelegramLink,
  getSavedClanTag,
  getAuthTokensRow,
  saveAuthSession,
  clearAuthSession,
  upsertTelegramRow,
  setSavedClanTag,
  clearSavedClanOnly,
  deleteTelegramLink,
  fetchBonusesForClan,
};

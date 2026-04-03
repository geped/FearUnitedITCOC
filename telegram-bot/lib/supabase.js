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

async function getTelegramRow(telegramUserId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_links')
    .select('player_tag, clan_tag')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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

/**
 * Upsert con merge: non azzera campi non passati in patch.
 * patch.player_tag / patch.clan_tag: undefined = non modificare, null = rimuovi
 */
async function upsertTelegramRow(telegramUserId, patch) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato (SUPABASE_URL / SERVICE_ROLE).');
  const prev = await getTelegramRow(telegramUserId);
  let player_tag =
    patch.player_tag !== undefined ? patch.player_tag : prev?.player_tag !== undefined ? prev.player_tag : null;
  let clan_tag =
    patch.clan_tag !== undefined ? patch.clan_tag : prev?.clan_tag !== undefined ? prev.clan_tag : null;

  if (player_tag != null && !String(player_tag).trim()) player_tag = null;
  if (clan_tag != null && !String(clan_tag).trim()) clan_tag = null;

  const now = new Date().toISOString();

  if (!player_tag && !clan_tag) {
    const { error: delErr } = await client.from('telegram_links').delete().eq('telegram_user_id', telegramUserId);
    if (delErr) throw new Error(delErr.message);
    return;
  }

  const row = {
    telegram_user_id: telegramUserId,
    player_tag,
    clan_tag,
    updated_at: now,
  };
  if (!prev) row.created_at = now;

  const { error } = await client.from('telegram_links').upsert(row, { onConflict: 'telegram_user_id' });
  if (error) throw new Error(error.message);
}

async function setTelegramLink(telegramUserId, playerTag) {
  await upsertTelegramRow(telegramUserId, { player_tag: playerTag });
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
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const { error } = await client.from('telegram_links').delete().eq('telegram_user_id', telegramUserId);
  if (error) throw new Error(error.message);
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
  getTelegramRow,
  getTelegramLink,
  getSavedClanTag,
  upsertTelegramRow,
  setTelegramLink,
  setSavedClanTag,
  clearSavedClanOnly,
  deleteTelegramLink,
  fetchBonusesForClan,
};

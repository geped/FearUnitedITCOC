'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
/** Fallback runtime se telegram_chat_controls non esiste ancora su DB. */
const chatControlsFallback = new Map();

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isChatControlsMissingError(error) {
  const msg = String(error?.message || '');
  return (
    msg.includes("public.telegram_chat_controls") ||
    msg.includes('telegram_chat_controls') ||
    msg.includes('schema cache')
  );
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
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('Sessione incompleta (mancano i token).');
  }
  if (!user?.id) {
    throw new Error('Profilo utente mancante dopo il login (user.id).');
  }
  const prev = await getFullRow(telegramUserId);
  const now = new Date().toISOString();
  const meta = user.user_metadata || {};
  const row = {
    telegram_user_id: telegramUserId,
    supabase_user_id: user.id,
    auth_access_token: session.access_token,
    auth_refresh_token: session.refresh_token,
    auth_expires_at: normSessionTimes(session),
    player_tag: prev?.player_tag ?? meta.coc_tag ?? null,
    clan_tag: prev?.clan_tag ?? null,
    webapp_handoff_code: null,
    webapp_handoff_expires_at: null,
    tutorial_completed_at: prev?.tutorial_completed_at ?? null,
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

/** Codice monouso (≈10 min) per aprire il sito da Telegram Mini App con sessione esistente. */
async function markTutorialCompleted(telegramUserId) {
  const client = sb();
  if (!client) return;
  const now = new Date().toISOString();
  await client
    .from('telegram_links')
    .update({ tutorial_completed_at: now, updated_at: now })
    .eq('telegram_user_id', telegramUserId);
}

/** chatId: ctx.chat.id (number) */
async function getTelegramChatLink(chatId) {
  const client = sb();
  if (!client) return null;
  const id = typeof chatId === 'bigint' ? Number(chatId) : Number(chatId);
  const { data, error } = await client.from('telegram_chat_links').select('*').eq('telegram_chat_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function getTelegramChatControl(chatId) {
  const client = sb();
  if (!client) {
    const v = chatControlsFallback.get(Number(chatId));
    return { bot_enabled: v !== false };
  }
  const id = Number(chatId);
  const { data, error } = await client.from('telegram_chat_controls').select('*').eq('telegram_chat_id', id).maybeSingle();
  if (error) {
    if (isChatControlsMissingError(error)) {
      const v = chatControlsFallback.get(id);
      return { telegram_chat_id: id, bot_enabled: v !== false };
    }
    throw new Error(error.message);
  }
  return data || { telegram_chat_id: id, bot_enabled: true };
}

async function setTelegramChatEnabled(chatId, enabled, updatedBy) {
  const client = sb();
  const id = Number(chatId);
  const flag = enabled === true;
  chatControlsFallback.set(id, flag);
  if (!client) return;
  const now = new Date().toISOString();
  const payload = {
    telegram_chat_id: id,
    bot_enabled: flag,
    updated_by: updatedBy != null ? Number(updatedBy) : null,
    updated_at: now,
  };
  const { error } = await client.from('telegram_chat_controls').upsert(payload, { onConflict: 'telegram_chat_id' });
  if (error && !isChatControlsMissingError(error)) throw new Error(error.message);
}

async function listEnabledTelegramChatLinks() {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('telegram_chat_links')
    .select('telegram_chat_id, clan_tag, chat_type')
    .order('telegram_chat_id', { ascending: true });
  if (error) throw new Error(error.message);
  let controls = [];
  try {
    controls = await client
      .from('telegram_chat_controls')
      .select('telegram_chat_id, bot_enabled')
      .then(({ data: cdata, error: cerr }) => {
        if (cerr) throw cerr;
        return cdata || [];
      });
  } catch (e) {
    if (!isChatControlsMissingError(e)) throw new Error(e.message || String(e));
    controls = [];
  }
  const controlMap = new Map(controls.map((r) => [Number(r.telegram_chat_id), r.bot_enabled !== false]));
  return (data || []).filter((r) => {
    const id = Number(r.telegram_chat_id);
    if (chatControlsFallback.has(id)) return chatControlsFallback.get(id) !== false;
    return controlMap.get(id) !== false;
  });
}

async function upsertTelegramChatLink(chatId, clanTag, linkedByTelegramUserId, chatType) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const id = Number(chatId);
  const norm = String(clanTag || '').trim().toUpperCase();
  const tag = norm.startsWith('#') ? norm : `#${norm}`;
  const now = new Date().toISOString();
  const { data: ex } = await client.from('telegram_chat_links').select('created_at').eq('telegram_chat_id', id).maybeSingle();
  const createdAt = ex?.created_at || now;
  const { error } = await client.from('telegram_chat_links').upsert(
    {
      telegram_chat_id: id,
      clan_tag: tag,
      linked_by_telegram_user_id: linkedByTelegramUserId ?? null,
      chat_type: chatType || null,
      updated_at: now,
      created_at: createdAt,
    },
    { onConflict: 'telegram_chat_id' }
  );
  if (error) throw new Error(error.message);
}

async function deleteTelegramChatLink(chatId) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const { error } = await client.from('telegram_chat_links').delete().eq('telegram_chat_id', Number(chatId));
  if (error) throw new Error(error.message);
}

async function createPendingChatLink(telegramUserId, clanTagRaw) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const norm = String(clanTagRaw || '').trim().toUpperCase();
  const tag = norm.startsWith('#') ? norm : `#${norm}`;
  const token = crypto.randomBytes(5).toString('hex');
  const exp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await client.from('telegram_pending_chat_links').delete().eq('telegram_user_id', telegramUserId);
  const { error } = await client.from('telegram_pending_chat_links').insert({
    token,
    telegram_user_id: telegramUserId,
    clan_tag: tag,
    expires_at: exp,
  });
  if (error) throw new Error(error.message);
  return token;
}

/** Legge clan_tag dal token senza consumarlo (stesse regole di validità di consume). */
async function peekPendingChatLink(token, telegramUserId) {
  const client = sb();
  if (!client) return null;
  const t = String(token || '').trim().toLowerCase();
  if (t.length < 8) return null;
  const { data, error } = await client.from('telegram_pending_chat_links').select('*').eq('token', t).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (Number(data.telegram_user_id) !== Number(telegramUserId)) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.clan_tag;
}

/** Ritorna clan_tag se valido; consuma il token. */
async function consumePendingChatLink(token, telegramUserId) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const t = String(token || '').trim().toLowerCase();
  if (t.length < 8) return null;
  const { data, error } = await client.from('telegram_pending_chat_links').select('*').eq('token', t).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (Number(data.telegram_user_id) !== Number(telegramUserId)) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await client.from('telegram_pending_chat_links').delete().eq('token', t);
    return null;
  }
  await client.from('telegram_pending_chat_links').delete().eq('token', t);
  return data.clan_tag;
}

async function createWebAppHandoff(telegramUserId) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const row = await getFullRow(telegramUserId);
  if (!row?.auth_refresh_token) throw new Error('Sessione non disponibile. Accedi di nuovo dal bot.');
  const code = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await client
    .from('telegram_links')
    .update({ webapp_handoff_code: code, webapp_handoff_expires_at: exp, updated_at: new Date().toISOString() })
    .eq('telegram_user_id', telegramUserId);
  if (error) throw new Error(error.message);
  return code;
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

function normClanTagSql(clanTagRaw) {
  const s = String(clanTagRaw || '').trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s}`;
}

/** Elenco chat_id collegate a un clan (per pruning lato Telegram). */
async function listTelegramChatIdsForClan(clanTagRaw) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client.from('telegram_chat_links').select('telegram_chat_id').eq('clan_tag', tag);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => Number(r.telegram_chat_id));
}

/** Max 3 chat diverse per clan; stessa chat può ri-collegare lo stesso clan. */
async function canLinkChatToClan(chatId, clanTagRaw) {
  const client = sb();
  if (!client) return true;
  const tag = normClanTagSql(clanTagRaw);
  const id = Number(chatId);
  const { data, error } = await client.from('telegram_chat_links').select('telegram_chat_id').eq('clan_tag', tag);
  if (error) throw new Error(error.message);
  const list = data || [];
  if (list.some((r) => Number(r.telegram_chat_id) === id)) return true;
  return list.length < 3;
}

async function fetchCwlHistoryBonusRows(clanTagRaw) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_history')
    .select('player_name, season, bonus_score, bonus_assigned')
    .eq('clan_tag', tag)
    .order('season', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
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
  createWebAppHandoff,
  markTutorialCompleted,
  getTelegramChatLink,
  getTelegramChatControl,
  setTelegramChatEnabled,
  listEnabledTelegramChatLinks,
  upsertTelegramChatLink,
  deleteTelegramChatLink,
  createPendingChatLink,
  peekPendingChatLink,
  consumePendingChatLink,
  canLinkChatToClan,
  listTelegramChatIdsForClan,
  fetchCwlHistoryBonusRows,
};

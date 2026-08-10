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

async function getCocProfileById(profileId) {
  const client = sb();
  if (!client || !profileId) return null;
  const { data, error } = await client
    .from('user_coc_profiles')
    .select('*')
    .eq('id', String(profileId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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

// Tutti i flag booleani della tabella telegram_chat_notification_settings.
const NOTIF_BOOL_KEYS = [
  // Categorie master
  'war_alerts_enabled', 'cwl_alerts_enabled', 'capital_raids_enabled',
  'clan_games_enabled', 'clan_activity_enabled',
  // Guerra Classica
  'war_prep_start', 'war_start_alert', 'war_missing_4h', 'war_missing_1h',
  'war_missing_15m', 'war_3star', 'war_result',
  // CWL
  'cwl_prep_start', 'cwl_prep_next', 'cwl_roster_reminder',
  'cwl_round_start', 'cwl_missing_4h', 'cwl_missing_1h',
  'cwl_missing_15m', 'cwl_3star', 'cwl_round_end',
  'cwl_season_start', 'cwl_standings', 'cwl_end',
  'cwl_league_promotion', 'cwl_league_demotion',
  // Raid Capitale
  'raid_start', 'raid_district_destroyed', 'raid_clan_cleared',
  'raid_capital_fallen', 'raid_end', 'raid_loot_milestone',
  'raid_missing_1d', 'raid_missing_12h', 'raid_missing_3h', 'raid_missing_include_list',
  // Attività Clan
  'clan_member_join', 'clan_member_leave', 'clan_role_promoted',
  'clan_role_demoted', 'clan_level_up', 'clan_war_streak', 'clan_name_change',
];

function _defaultNotifSettings(chatId) {
  const obj = { telegram_chat_id: Number(chatId) };
  for (const k of NOTIF_BOOL_KEYS) obj[k] = false;
  return obj;
}

async function getChatNotificationSettings(chatId) {
  const client = sb();
  const id = Number(chatId);
  if (!client) return _defaultNotifSettings(id);
  const { data, error } = await client
    .from('telegram_chat_notification_settings')
    .select('*')
    .eq('telegram_chat_id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || _defaultNotifSettings(id);
}

async function upsertChatNotificationSettings(chatId, patch, updatedBy) {
  const client = sb();
  if (!client) return;
  const id   = Number(chatId);
  const prev = await getChatNotificationSettings(id);
  const row  = { telegram_chat_id: id };
  for (const k of NOTIF_BOOL_KEYS) {
    row[k] = patch[k] !== undefined ? patch[k] === true : prev[k] === true;
  }
  row.updated_by = updatedBy != null ? Number(updatedBy) : null;
  row.updated_at = new Date().toISOString();
  const { error } = await client
    .from('telegram_chat_notification_settings')
    .upsert(row, { onConflict: 'telegram_chat_id' });
  if (error) throw new Error(error.message);
}

function _defaultCustomAlertSettings(chatId) {
  return {
    telegram_chat_id: Number(chatId),
    war_enabled: false,
    war_paused: false,
    war_lead_minutes: null,
    cwl_enabled: false,
    cwl_paused: false,
    cwl_lead_minutes: null,
    raid_enabled: false,
    raid_paused: false,
    raid_lead_minutes: null,
  };
}

async function getChatCustomAlertSettings(chatId) {
  const client = sb();
  const id = Number(chatId);
  if (!client) return _defaultCustomAlertSettings(id);
  const { data, error } = await client
    .from('telegram_chat_custom_alerts')
    .select('*')
    .eq('telegram_chat_id', id)
    .maybeSingle();
  if (error) {
    // Migrazione non ancora applicata: fallback silenzioso
    if (String(error.message || '').includes('telegram_chat_custom_alerts')) {
      return _defaultCustomAlertSettings(id);
    }
    throw new Error(error.message);
  }
  return data || _defaultCustomAlertSettings(id);
}

async function upsertChatCustomAlertSettings(chatId, patch, updatedBy) {
  const client = sb();
  if (!client) return;
  const id = Number(chatId);
  const prev = await getChatCustomAlertSettings(id);
  const row = {
    telegram_chat_id: id,
    war_enabled: patch.war_enabled !== undefined ? patch.war_enabled === true : prev.war_enabled === true,
    war_paused: patch.war_paused !== undefined ? patch.war_paused === true : prev.war_paused === true,
    war_lead_minutes:
      patch.war_lead_minutes !== undefined
        ? (patch.war_lead_minutes == null ? null : Number(patch.war_lead_minutes))
        : (prev.war_lead_minutes == null ? null : Number(prev.war_lead_minutes)),
    cwl_enabled: patch.cwl_enabled !== undefined ? patch.cwl_enabled === true : prev.cwl_enabled === true,
    cwl_paused: patch.cwl_paused !== undefined ? patch.cwl_paused === true : prev.cwl_paused === true,
    cwl_lead_minutes:
      patch.cwl_lead_minutes !== undefined
        ? (patch.cwl_lead_minutes == null ? null : Number(patch.cwl_lead_minutes))
        : (prev.cwl_lead_minutes == null ? null : Number(prev.cwl_lead_minutes)),
    raid_enabled: patch.raid_enabled !== undefined ? patch.raid_enabled === true : prev.raid_enabled === true,
    raid_paused: patch.raid_paused !== undefined ? patch.raid_paused === true : prev.raid_paused === true,
    raid_lead_minutes:
      patch.raid_lead_minutes !== undefined
        ? (patch.raid_lead_minutes == null ? null : Number(patch.raid_lead_minutes))
        : (prev.raid_lead_minutes == null ? null : Number(prev.raid_lead_minutes)),
    updated_by: updatedBy != null ? Number(updatedBy) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client
    .from('telegram_chat_custom_alerts')
    .upsert(row, { onConflict: 'telegram_chat_id' });
  if (error) throw new Error(error.message);
}

async function insertUsageEvent(event) {
  const client = sb();
  if (!client) return;
  const row = {
    telegram_user_id: event.telegram_user_id != null ? Number(event.telegram_user_id) : null,
    telegram_chat_id: event.telegram_chat_id != null ? Number(event.telegram_chat_id) : null,
    chat_type: event.chat_type || null,
    event_type: String(event.event_type || 'unknown').slice(0, 64),
    payload: event.payload || {},
  };
  await client.from('telegram_usage_events').insert(row);
}

async function getAdminDashboardStats() {
  const client = sb();
  if (!client) return null;
  const now = Date.now();
  const dayAgo   = new Date(now - 24 * 3600 * 1000).toISOString();
  const sevenAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const results = await Promise.allSettled([
    client.from('telegram_chat_links').select('*', { count: 'exact', head: true }),
    client.from('telegram_chat_controls').select('*', { count: 'exact', head: true }).eq('bot_enabled', false),
    client.from('telegram_usage_events').select('telegram_user_id').gte('created_at', dayAgo).not('telegram_user_id', 'is', null),
    client.from('telegram_usage_events').select('telegram_user_id').gte('created_at', sevenAgo).not('telegram_user_id', 'is', null),
    // Utenti registrati (righe telegram_links = account bot collegati)
    client.from('telegram_links').select('*', { count: 'exact', head: true }),
    // Ban attivi
    client.from('telegram_user_restrictions').select('*', { count: 'exact', head: true }).eq('banned', true),
    // Ticket aperti/in lavorazione
    client.from('telegram_support_tickets').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress', 'waiting_user']),
    // Segnalazioni globali aperte
    client.from('telegram_global_reports').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_review']),
  ]);
  const get = (i) => results[i]?.status === 'fulfilled' ? results[i].value : {};
  const linkedChats    = get(0).count ?? 0;
  const pausedChats    = get(1).count ?? 0;
  const dauRows        = get(2).data ?? [];
  const wauRows        = get(3).data ?? [];
  const registeredUsers= get(4).count ?? 0;
  const activeBans     = get(5).count ?? 0;
  const openTickets    = get(6).count ?? 0;
  const openReports    = get(7).count ?? 0;
  const dau = new Set(dauRows.map((r) => Number(r.telegram_user_id))).size;
  const wau = new Set(wauRows.map((r) => Number(r.telegram_user_id))).size;
  return { linkedChats, pausedChats, dau, wau, registeredUsers, activeBans, openTickets, openReports };
}

async function getOpenTicketForUser(telegramUserId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_support_tickets')
    .select('*')
    .eq('telegram_user_id', Number(telegramUserId))
    .in('status', ['open', 'in_progress', 'waiting_user'])
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function getLatestClosedPendingTicketForUser(telegramUserId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_support_tickets')
    .select('*')
    .eq('telegram_user_id', Number(telegramUserId))
    .eq('status', 'closed_pending_purge')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function createSupportTicket(telegramUserId, subject) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  // Solo colonne base + default DB: compatibile con schema senza reopen_count/session_index espliciti nell'INSERT.
  const row = {
    telegram_user_id: Number(telegramUserId),
    status: 'open',
    subject: subject ? String(subject).slice(0, 180) : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('telegram_support_tickets').insert(row).select('*').single();
  if (error) {
    console.error('[sb] createSupportTicket', error.code || '', error.message, error.details || '');
    throw new Error(error.message);
  }
  return data;
}

async function appendSupportMessage(ticketId, msg) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const row = {
    ticket_id: Number(ticketId),
    from_role: String(msg.from_role || 'user'),
    from_telegram_user_id: msg.from_telegram_user_id != null ? Number(msg.from_telegram_user_id) : null,
    text: msg.text != null ? String(msg.text).slice(0, 4000) : null,
    photo_file_id: msg.photo_file_id ? String(msg.photo_file_id).slice(0, 300) : null,
    session_index:
      msg.session_index != null && Number.isFinite(Number(msg.session_index)) ? Number(msg.session_index) : 1,
  };
  const { error } = await client.from('telegram_support_messages').insert(row);
  if (error) throw new Error(error.message);
}

async function countTicketPhotos(ticketId) {
  const client = sb();
  if (!client) return 0;
  const { count, error } = await client
    .from('telegram_support_messages')
    .select('*', { count: 'exact', head: true })
    .eq('ticket_id', Number(ticketId))
    .not('photo_file_id', 'is', null);
  if (error) return 0;
  return count || 0;
}

async function countTicketPhotosInSession(ticketId, sessionIndex) {
  const client = sb();
  if (!client) return 0;
  const { count, error } = await client
    .from('telegram_support_messages')
    .select('*', { count: 'exact', head: true })
    .eq('ticket_id', Number(ticketId))
    .eq('session_index', Number(sessionIndex))
    .not('photo_file_id', 'is', null);
  if (error) return 0;
  return count || 0;
}

async function setTicketStatus(ticketId, status, adminId) {
  const client = sb();
  if (!client) return;
  const now = new Date();
  const patch = {
    status,
    updated_at: now.toISOString(),
    assigned_admin_id: adminId != null ? Number(adminId) : null,
  };
  if (status === 'closed_pending_purge') {
    patch.closed_at = now.toISOString();
    patch.purge_after = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  }
  if (status === 'open') {
    patch.closed_at = null;
    patch.purge_after = null;
  }
  const { error } = await client.from('telegram_support_tickets').update(patch).eq('id', Number(ticketId));
  if (error) throw new Error(error.message);
}

async function reopenSupportTicket(telegramUserId) {
  const client = sb();
  if (!client) return { ok: false, reason: 'Supabase non configurato.' };
  const ticket = await getLatestClosedPendingTicketForUser(telegramUserId);
  if (!ticket) return { ok: false, reason: 'Nessun ticket chiuso recente da riaprire.' };
  const reopenCount = Number(ticket.reopen_count || 0);
  if (reopenCount >= 3) {
    return { ok: false, reason: 'Hai raggiunto il limite massimo: 3 riaperture per lo stesso ticket.' };
  }
  const patch = {
    status: 'open',
    reopen_count: reopenCount + 1,
    session_index: Number(ticket.session_index || 1) + 1,
    closed_at: null,
    purge_after: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('telegram_support_tickets').update(patch).eq('id', Number(ticket.id));
  if (error) throw new Error(error.message);
  const updated = await getTicketById(ticket.id);
  return { ok: true, ticket: updated };
}

async function listActiveSupportTickets(limit = 30) {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('telegram_support_tickets')
    .select('*')
    .in('status', ['open', 'in_progress', 'waiting_user', 'closed_pending_purge'])
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function listActiveSupportTicketsAssignedTo(adminTelegramUserId, limit = 30) {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('telegram_support_tickets')
    .select('*')
    .in('status', ['in_progress', 'waiting_user', 'closed_pending_purge'])
    .eq('assigned_admin_id', Number(adminTelegramUserId))
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function listSupportMessages(ticketId, limit = 80) {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('telegram_support_messages')
    .select('*')
    .eq('ticket_id', Number(ticketId))
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function getTicketById(ticketId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client.from('telegram_support_tickets').select('*').eq('id', Number(ticketId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function purgeExpiredSupportTickets() {
  const client = sb();
  if (!client) return 0;
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('telegram_support_tickets')
    .delete()
    .eq('status', 'closed_pending_purge')
    .lt('purge_after', now)
    .select('id');
  if (error) throw new Error(error.message);
  return (data || []).length;
}

async function getTelegramUserRestriction(telegramUserId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_user_restrictions')
    .select('*')
    .eq('telegram_user_id', Number(telegramUserId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function setTelegramUserBanned(telegramUserId, banned, reason, updatedBy) {
  const client = sb();
  if (!client) return;
  const prev = await getTelegramUserRestriction(telegramUserId).catch(() => null);
  const row = {
    telegram_user_id: Number(telegramUserId),
    banned: banned === true,
    muted_until: prev?.muted_until || null,
    reason: reason ? String(reason).slice(0, 240) : null,
    updated_by: updatedBy != null ? Number(updatedBy) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('telegram_user_restrictions').upsert(row, { onConflict: 'telegram_user_id' });
  if (error) throw new Error(error.message);
}

async function setTelegramUserMutedUntil(telegramUserId, mutedUntilIso, reason, updatedBy) {
  const client = sb();
  if (!client) return;
  const prev = await getTelegramUserRestriction(telegramUserId).catch(() => null);
  const row = {
    telegram_user_id: Number(telegramUserId),
    banned: prev?.banned === true,
    muted_until: mutedUntilIso ? new Date(mutedUntilIso).toISOString() : null,
    reason: reason ? String(reason).slice(0, 240) : prev?.reason || null,
    updated_by: updatedBy != null ? Number(updatedBy) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('telegram_user_restrictions').upsert(row, { onConflict: 'telegram_user_id' });
  if (error) throw new Error(error.message);
}

async function listBannedTelegramUsers(limit = 50) {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('telegram_user_restrictions')
    .select('*')
    .eq('banned', true)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function insertGlobalChatReport(input) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const row = {
    reporter_telegram_user_id: Number(input.reporterTelegramUserId),
    reporter_display_name: String(input.reporterDisplayName || 'Utente').slice(0, 160),
    reporter_display_tag: input.reporterDisplayTag ? String(input.reporterDisplayTag).slice(0, 32) : null,
    reason: String(input.reason || '').slice(0, 400),
    reported_message_text: String(input.reportedMessageText || '').slice(0, 4000),
    reported_target_telegram_user_id:
      input.reportedTargetTelegramUserId != null ? Number(input.reportedTargetTelegramUserId) : null,
    reported_target_display_name: input.reportedTargetDisplayName
      ? String(input.reportedTargetDisplayName).slice(0, 160)
      : null,
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('telegram_global_reports').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function listGlobalChatReports(statuses = ['open', 'in_review'], limit = 30) {
  const client = sb();
  if (!client) return [];
  const q = client
    .from('telegram_global_reports')
    .select('*')
    .in('status', statuses)
    .order('updated_at', { ascending: false })
    .limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function getGlobalChatReportById(reportId) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from('telegram_global_reports')
    .select('*')
    .eq('id', Number(reportId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function setGlobalChatReportStatus(reportId, status, adminTelegramUserId, resolutionNote, actionType) {
  const client = sb();
  if (!client) return;
  const patch = {
    status: String(status || 'archived').slice(0, 32),
    updated_at: new Date().toISOString(),
    reviewed_by_telegram_user_id: adminTelegramUserId != null ? Number(adminTelegramUserId) : null,
    reviewed_at: new Date().toISOString(),
    resolution_note: resolutionNote ? String(resolutionNote).slice(0, 500) : null,
    action_taken: actionType ? String(actionType).slice(0, 64) : null,
  };
  const { error } = await client.from('telegram_global_reports').update(patch).eq('id', Number(reportId));
  if (error) throw new Error(error.message);
}

async function setGlobalReportTargetTelegramUser(reportId, targetTelegramUserId, adminTelegramUserId) {
  const client = sb();
  if (!client) return;
  const patch = {
    reported_target_telegram_user_id: Number(targetTelegramUserId),
    reviewed_by_telegram_user_id: adminTelegramUserId != null ? Number(adminTelegramUserId) : null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('telegram_global_reports').update(patch).eq('id', Number(reportId));
  if (error) throw new Error(error.message);
}

async function getUsageDailyStats(days = 14) {
  const client = sb();
  if (!client) return [];
  const start = new Date(Date.now() - Math.max(1, Number(days)) * 24 * 3600 * 1000).toISOString();
  const { data, error } = await client
    .from('telegram_usage_events')
    .select('created_at, event_type, telegram_user_id, telegram_chat_id')
    .gte('created_at', start)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const r of data || []) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    let row = map.get(day);
    if (!row) {
      row = { day, events: 0, users: new Set(), chats: new Set(), commands: 0, callbacks: 0, messages: 0 };
      map.set(day, row);
    }
    row.events += 1;
    if (r.telegram_user_id != null) row.users.add(Number(r.telegram_user_id));
    if (r.telegram_chat_id != null) row.chats.add(Number(r.telegram_chat_id));
    if (r.event_type === 'command') row.commands += 1;
    else if (r.event_type === 'callback') row.callbacks += 1;
    else if (r.event_type === 'message') row.messages += 1;
  }
  return [...map.values()].map((r) => ({
    day: r.day,
    events: r.events,
    unique_users: r.users.size,
    unique_chats: r.chats.size,
    commands: r.commands,
    callbacks: r.callbacks,
    messages: r.messages,
  }));
}

async function upsertTelegramChatLink(chatId, clanTag, linkedByTelegramUserId, chatType, linkedByProfileId) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const id = Number(chatId);
  const norm = String(clanTag || '').trim().toUpperCase();
  const tag = norm.startsWith('#') ? norm : `#${norm}`;
  const now = new Date().toISOString();
  const { data: ex } = await client.from('telegram_chat_links').select('created_at').eq('telegram_chat_id', id).maybeSingle();
  const createdAt = ex?.created_at || now;
  const row = {
    telegram_chat_id: id,
    clan_tag: tag,
    linked_by_telegram_user_id: linkedByTelegramUserId ?? null,
    chat_type: chatType || null,
    updated_at: now,
    created_at: createdAt,
  };
  if (linkedByProfileId !== undefined) {
    row.linked_by_profile_id = linkedByProfileId || null;
  }
  const { error } = await client.from('telegram_chat_links').upsert(row, { onConflict: 'telegram_chat_id' });
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
    .eq('bonus_assigned', true)
    .order('season', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Mappa alias → nome canonico CoC per il clan (tabella player_aliases). */
async function fetchPlayerAliasesForClan(clanTagRaw) {
  const client = sb();
  if (!client) return {};
  const tag = normClanTagSql(clanTagRaw);
  try {
    const { data } = await client
      .from('player_aliases')
      .select('alias, coc_name')
      .eq('clan_tag', tag);
    const map = {};
    (data || []).forEach((a) => { map[String(a.alias).toLowerCase()] = a.coc_name; });
    return map;
  } catch (_) {
    return {}; // tabella potrebbe non esistere
  }
}

/** Stagioni distinte presenti in cwl_history per il clan (più recenti prima). */
async function listCwlSeasonsForClan(clanTagRaw, limit = 12) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_history')
    .select('season')
    .eq('clan_tag', tag)
    .order('season', { ascending: false });
  if (error) throw new Error(error.message);
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    const s = r?.season;
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Righe complete per una stagione (assegnazione bonus come tab «Assegna» sul sito). */
async function fetchCwlHistoryFullSeason(clanTagRaw, season) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_history')
    .select('*')
    .eq('clan_tag', tag)
    .eq('season', String(season));
  if (error) throw new Error(error.message);
  const rows = data || [];
  rows.sort(
    (a, b) =>
      (Number(b.bonus_score ?? 0) - Number(a.bonus_score ?? 0)) ||
      String(a.player_name || '').localeCompare(String(b.player_name || ''), 'it')
  );
  return rows;
}

async function upsertCwlHistoryAssignRow(row) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const tag = normClanTagSql(row.clan_tag);
  const patch = {
    clan_tag: tag,
    player_name: String(row.player_name),
    season: String(row.season),
    participated: Boolean(row.participated),
    stars: Math.round(Number(row.stars ?? 0)),
    destruction: Number(Number(row.destruction ?? 0).toFixed(2)),
    attacks_made: Math.round(Number(row.attacks_made ?? 0)),
    attacks_required: Math.round(Number(row.attacks_required ?? 0)),
    bonus_score: Math.round(Number(row.bonus_score ?? 0)),
    bonus_assigned: Boolean(row.bonus_assigned),
    still_in_clan: row.still_in_clan !== false,
    is_secondary: Boolean(row.is_secondary),
  };
  const { error } = await client.from('cwl_history').upsert(patch, { onConflict: 'player_name,season,clan_tag' });
  if (error) throw new Error(error.message);
}

/** Nomi con bonus assegnato in una stagione (per esclusione “stagione precedente”). */
async function fetchBonusAssignedNamesForSeason(clanTagRaw, season) {
  const client = sb();
  if (!client) return new Set();
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_history')
    .select('player_name')
    .eq('clan_tag', tag)
    .eq('season', String(season))
    .eq('bonus_assigned', true);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.player_name).filter(Boolean));
}

/** Mappa nome giocatore (lower) → th_level per clan. */
async function fetchMembersThByNameForClan(clanTagRaw) {
  const client = sb();
  if (!client) return new Map();
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client.from('members').select('name, th_level').eq('clan_tag', tag);
  if (error) throw new Error(error.message);
  const m = new Map();
  for (const r of data || []) {
    const n = String(r.name || '').toLowerCase().trim();
    if (n) m.set(n, Number(r.th_level) || 0);
  }
  return m;
}

/** Imposta bonus_assigned su tutto il roster attivo (non secondari) della stagione. */
async function applyBonusSelectionForSeason(clanTagRaw, season, selectedNames) {
  const client = sb();
  if (!client) throw new Error('Supabase non configurato.');
  const tag = normClanTagSql(clanTagRaw);
  const all = await fetchCwlHistoryFullSeason(clanTagRaw, season);
  const sel = new Set(selectedNames);
  const payload = [];
  for (const r of all) {
    if (r.still_in_clan === false || r.is_secondary) continue;
    payload.push({
      clan_tag: tag,
      player_name: String(r.player_name),
      season: String(season),
      participated: Boolean(r.participated),
      stars: Math.round(Number(r.stars ?? 0)),
      destruction: Number(Number(r.destruction ?? 0).toFixed(2)),
      attacks_made: Math.round(Number(r.attacks_made ?? 0)),
      attacks_required: Math.round(Number(r.attacks_required ?? 0)),
      bonus_score: Math.round(Number(r.bonus_score ?? 0)),
      bonus_assigned: sel.has(String(r.player_name)),
      still_in_clan: r.still_in_clan !== false,
      is_secondary: Boolean(r.is_secondary),
    });
  }
  if (!payload.length) return 0;
  const { error } = await client.from('cwl_history').upsert(payload, { onConflict: 'player_name,season,clan_tag' });
  if (error) throw new Error(error.message);
  return payload.length;
}

/** Dettaglio war classica salvato (attacchi / roster) — come tabella classic_wars sul sito. */
async function getClassicWarSaved(clanTagRaw, endTime) {
  const client = sb();
  if (!client || !endTime) return null;
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('classic_wars')
    .select('*')
    .eq('clan_tag', tag)
    .eq('end_time', endTime)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/** Turni CWL salvati per stagione (cwl_wars), ordinati per round. */
async function getCwlWarsForSeason(clanTagRaw, season) {
  const client = sb();
  if (!client || !season) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_wars')
    .select('*')
    .eq('clan_tag', tag)
    .eq('season', season)
    .order('round', { ascending: true });
  if (error) return [];
  return data || [];
}

/** Meta stagione CWL (lega, posizione, …) da cwl_seasons. */
async function getCwlSeasonSavedMeta(clanTagRaw, season) {
  const client = sb();
  if (!client || !season) return null;
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_seasons')
    .select('*')
    .eq('clan_tag', tag)
    .eq('season', season)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/** Tutte le righe cwl_seasons per il clan (lega, posizione, roster, classifica gruppo). */
async function listCwlSeasonsRows(clanTagRaw) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client
    .from('cwl_seasons')
    .select('*')
    .eq('clan_tag', tag)
    .order('season', { ascending: false });
  if (error) return [];
  return data || [];
}

/** Stagioni distinte presenti in cwl_wars (salvate automaticamente). */
async function listCwlWarSeasonsFromDb(clanTagRaw) {
  const client = sb();
  if (!client) return [];
  const tag = normClanTagSql(clanTagRaw);
  const { data, error } = await client.from('cwl_wars').select('season').eq('clan_tag', tag);
  if (error) return [];
  const seen = new Set();
  for (const r of data || []) {
    if (r?.season) seen.add(r.season);
  }
  return [...seen].sort((a, b) => b.localeCompare(a));
}

/**
 * Evento "Clash of Cards" — outbox notifiche (match/messaggio/proposta/scambio).
 * Scritta dal sito (api/_utils/card-trades.js) con SERVICE_ROLE, letta qui dal bot.
 */
async function listPendingCardNotifications(limit = 25) {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from('card_event_notify_outbox')
    .select('*')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.warn('[cards-notify] list:', error.message);
    return [];
  }
  return data || [];
}

/** Recupera una singola riga outbox (per i bottoni "Applica subito"/"Proponi" nelle notifiche match). */
async function getCardNotificationById(id) {
  const client = sb();
  if (!client || !id) return null;
  const { data, error } = await client
    .from('card_event_notify_outbox')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function markCardNotificationsSent(ids) {
  const client = sb();
  if (!client || !ids?.length) return;
  await client
    .from('card_event_notify_outbox')
    .update({ sent_at: new Date().toISOString() })
    .in('id', ids);
}

/** Risale dall'utente Supabase (destinatario di una notifica) al suo telegram_user_id. */
async function getTelegramUserIdForSupabaseUser(userId) {
  const client = sb();
  if (!client || !userId) return null;
  const { data, error } = await client
    .from('telegram_links')
    .select('telegram_user_id, updated_at')
    .eq('supabase_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.telegram_user_id || null;
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
  getCocProfileById,
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
  fetchPlayerAliasesForClan,
  listCwlSeasonsForClan,
  fetchCwlHistoryFullSeason,
  upsertCwlHistoryAssignRow,
  fetchBonusAssignedNamesForSeason,
  fetchMembersThByNameForClan,
  applyBonusSelectionForSeason,
  getClassicWarSaved,
  getCwlWarsForSeason,
  getCwlSeasonSavedMeta,
  listCwlWarSeasonsFromDb,
  listCwlSeasonsRows,
  getChatNotificationSettings,
  upsertChatNotificationSettings,
  getChatCustomAlertSettings,
  upsertChatCustomAlertSettings,
  insertUsageEvent,
  getAdminDashboardStats,
  getOpenTicketForUser,
  getLatestClosedPendingTicketForUser,
  createSupportTicket,
  appendSupportMessage,
  countTicketPhotos,
  countTicketPhotosInSession,
  setTicketStatus,
  reopenSupportTicket,
  listActiveSupportTickets,
  listActiveSupportTicketsAssignedTo,
  listSupportMessages,
  getTicketById,
  purgeExpiredSupportTickets,
  getTelegramUserRestriction,
  setTelegramUserBanned,
  setTelegramUserMutedUntil,
  listBannedTelegramUsers,
  insertGlobalChatReport,
  listGlobalChatReports,
  getGlobalChatReportById,
  setGlobalChatReportStatus,
  setGlobalReportTargetTelegramUser,
  getUsageDailyStats,
  listPendingCardNotifications,
  getCardNotificationById,
  markCardNotificationsSent,
  getTelegramUserIdForSupabaseUser,
};

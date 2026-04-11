'use strict';

const { createClient } = require('@supabase/supabase-js');
const { currentEpochIndex, epochStartIso } = require('./community-validation');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function tickGlobalEpochIfNeeded() {
  const c = client();
  if (!c) return;
  const cur = currentEpochIndex();
  await c.from('telegram_global_chat_messages').delete().lt('epoch_index', cur);
  const epochStart = epochStartIso(cur);
  await c
    .from('telegram_global_chat_subscribers')
    .update({ epoch_index: cur, joined_at: epochStart, updated_at: new Date().toISOString() })
    .eq('active', true)
    .lt('epoch_index', cur);
}

async function upsertGlobalSubscriber(telegramUserId, displayName, displayTag, opts = {}) {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const epoch = currentEpochIndex();
  const now = new Date().toISOString();
  const existing = await getGlobalSubscriber(telegramUserId);
  const displayVerified = opts.displayVerified === true;
  const shareVerifiedDetails = displayVerified ? opts.shareVerifiedDetails !== false : false;
  const th =
    opts.cachedThLevel != null && Number.isFinite(Number(opts.cachedThLevel))
      ? Number(opts.cachedThLevel)
      : null;
  const exp =
    opts.cachedExpLevel != null && Number.isFinite(Number(opts.cachedExpLevel))
      ? Number(opts.cachedExpLevel)
      : null;
  const botOwnerPersona = opts.botOwnerPersona === true;
  const { error } = await c.rpc('cocboard_upsert_global_chat_subscriber', {
    p_telegram_user_id: Number(telegramUserId),
    p_display_name: String(displayName || '').slice(0, 120),
    p_display_tag: displayTag ? String(displayTag).slice(0, 32) : null,
    p_epoch_index: epoch,
    p_joined_at: now,
    p_active: true,
    p_updated_at: now,
    p_hub_message_id: existing?.hub_message_id != null ? Number(existing.hub_message_id) : null,
    p_hub_epoch_index: existing?.hub_epoch_index != null ? Number(existing.hub_epoch_index) : null,
    p_display_verified: displayVerified,
    p_share_verified_details: shareVerifiedDetails,
    p_cached_th_level: th,
    p_cached_exp_level: exp,
    p_bot_owner_persona: botOwnerPersona,
  });
  if (error) throw new Error(error.message);
}

async function deactivateGlobalSubscriber(telegramUserId) {
  const c = client();
  if (!c) return;
  const { error } = await c.rpc('cocboard_deactivate_global_subscriber', {
    p_telegram_user_id: Number(telegramUserId),
  });
  if (error) throw new Error(error.message);
}

async function setGlobalSubscriberHub(telegramUserId, hubMessageId, hubEpochIndex) {
  const c = client();
  if (!c) return;
  const now = new Date().toISOString();
  const { data, error } = await c.rpc('cocboard_set_global_subscriber_hub', {
    p_telegram_user_id: Number(telegramUserId),
    p_hub_message_id: Number(hubMessageId),
    p_hub_epoch_index: Number(hubEpochIndex),
    p_updated_at: now,
  });
  if (error) throw new Error(error.message);
  const n = typeof data === 'number' ? data : Number(data);
  if (!n) {
    throw new Error('setGlobalSubscriberHub: nessuna riga attiva aggiornata (utente non in chat globale?)');
  }
}

async function clearGlobalSubscriberHub(telegramUserId) {
  const c = client();
  if (!c) return;
  const { error } = await c.rpc('cocboard_clear_global_subscriber_hub', {
    p_telegram_user_id: Number(telegramUserId),
  });
  if (error) throw new Error(error.message);
}

async function insertGlobalEphemeralDelivery(chatId, messageId, epochIndex) {
  const c = client();
  if (!c) return;
  await c.from('telegram_global_ephemeral_deliveries').insert({
    chat_id: Number(chatId),
    message_id: Number(messageId),
    epoch_index: Number(epochIndex),
  });
}

/** Elimina righe con epoch_index < cutoff; ritorna le coppie chat_id/message_id da cancellare su Telegram. */
async function consumeGlobalEphemeralDeliveriesBeforeEpoch(cutoffEpochIndex) {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from('telegram_global_ephemeral_deliveries')
    .delete()
    .lt('epoch_index', Number(cutoffEpochIndex))
    .select('chat_id, message_id');
  if (error) throw new Error(error.message);
  return data || [];
}

/** Elimina tutte le bolle chat globale per una DM (utente esce o cambia sezione); ritorna le righe per deleteMessage su Telegram. */
async function consumeGlobalEphemeralDeliveriesForChat(chatId) {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from('telegram_global_ephemeral_deliveries')
    .delete()
    .eq('chat_id', Number(chatId))
    .select('chat_id, message_id');
  if (error) throw new Error(error.message);
  return data || [];
}

async function getGlobalSubscriber(telegramUserId) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.rpc('cocboard_get_global_chat_subscriber', {
    p_telegram_user_id: Number(telegramUserId),
  });
  if (error) throw new Error(error.message);
  if (data == null || typeof data !== 'object') return null;
  return data;
}

async function getGlobalSubscriberByDisplayTag(displayTagRaw) {
  const c = client();
  if (!c) return null;
  const tag = String(displayTagRaw || '').trim().toUpperCase();
  if (!/^#[0-9A-Z]{9}$/.test(tag)) return null;
  const { data, error } = await c
    .from('telegram_global_chat_subscribers')
    .select('*')
    .eq('display_tag', tag)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function isActiveInGlobalChat(telegramUserId) {
  const row = await getGlobalSubscriber(telegramUserId);
  if (!row || !row.active) return false;
  const cur = currentEpochIndex();
  return Number(row.epoch_index) === cur;
}

async function insertGlobalMessage(senderTelegramUserId, displayLabel, body) {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const epoch = currentEpochIndex();
  const row = {
    epoch_index: epoch,
    sender_telegram_user_id: Number(senderTelegramUserId),
    display_label: String(displayLabel).slice(0, 160),
    body: String(body),
  };
  const { data, error } = await c.from('telegram_global_chat_messages').insert(row).select('id, created_at').single();
  if (error) throw new Error(error.message);
  return { ...data, epoch_index: epoch };
}

async function listGlobalBroadcastTargets(epochIndex, senderTelegramUserId, messageCreatedAtIso) {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from('telegram_global_chat_subscribers')
    .select('telegram_user_id, joined_at')
    .eq('active', true)
    .eq('epoch_index', Number(epochIndex));
  if (error) throw new Error(error.message);
  const created = new Date(messageCreatedAtIso).getTime();
  const sid = Number(senderTelegramUserId);
  return (data || []).filter((r) => {
    if (Number(r.telegram_user_id) === sid) return false;
    return new Date(r.joined_at).getTime() <= created;
  });
}

async function ensureRecruitmentSubscriber(telegramUserId) {
  const c = client();
  if (!c) return;
  const now = new Date().toISOString();
  await c.from('telegram_recruitment_subscribers').upsert(
    { telegram_user_id: Number(telegramUserId), subscribed: true, updated_at: now },
    { onConflict: 'telegram_user_id' }
  );
}

async function listRecruitmentFeedUserIds() {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from('telegram_recruitment_subscribers')
    .select('telegram_user_id')
    .eq('subscribed', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => Number(r.telegram_user_id));
}

async function insertRecruitmentSubmission(submitterId, display, bodyText, clanUrl, photoFileId, bodyHtml, clanTag, status = 'pending') {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const html =
    bodyHtml != null && String(bodyHtml).trim() ? String(bodyHtml).slice(0, 12000) : null;
  const row = {
    submitter_telegram_user_id: Number(submitterId),
    submitter_display: String(display).slice(0, 160),
    body_text: String(bodyText),
    body_html: html,
    clan_profile_url: String(clanUrl).slice(0, 512),
    // Può essere file_id Telegram oppure URL HTTPS (es. stemma CoC da API)
    photo_file_id: photoFileId ? String(photoFileId).slice(0, 2048) : null,
    status,
    clan_tag: clanTag ? String(clanTag).toUpperCase().replace(/^#/, '').slice(0, 20) : null,
  };
  const { data, error } = await c.from('telegram_recruitment_submissions').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function getRecruitmentSubmission(id) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.from('telegram_recruitment_submissions').select('*').eq('id', Number(id)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function setSubmissionStatus(id, status, reviewerId) {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const now = new Date().toISOString();
  const { error } = await c
    .from('telegram_recruitment_submissions')
    .update({
      status,
      reviewed_at: now,
      reviewer_telegram_user_id: reviewerId != null ? Number(reviewerId) : null,
    })
    .eq('id', Number(id));
  if (error) throw new Error(error.message);
}

async function insertRecruitmentPost(submissionId, postText, photoFileId, approvedAtIso, expiresAtIso, deliveredIds, submitterTelegramUserId) {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const row = {
    submission_id: Number(submissionId),
    post_text: String(postText),
    photo_file_id: photoFileId ? String(photoFileId).slice(0, 2048) : null,
    approved_at: approvedAtIso,
    expires_at: expiresAtIso,
    delivered_message_ids: deliveredIds,
    submitter_telegram_user_id: submitterTelegramUserId != null ? Number(submitterTelegramUserId) : null,
  };
  const { data, error } = await c.from('telegram_recruitment_posts').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function listExpiredRecruitmentPosts() {
  const c = client();
  if (!c) return [];
  const now = new Date().toISOString();
  const { data, error } = await c.from('telegram_recruitment_posts').select('*').lte('expires_at', now);
  if (error) throw new Error(error.message);
  return data || [];
}

async function deleteRecruitmentPostRow(id) {
  const c = client();
  if (!c) return;
  await c.from('telegram_recruitment_posts').delete().eq('id', Number(id));
}

async function countSubmissionsSince(submitterId, sinceIso) {
  const c = client();
  if (!c) return 0;
  const { count, error } = await c
    .from('telegram_recruitment_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('submitter_telegram_user_id', Number(submitterId))
    .gte('created_at', sinceIso);
  if (error) return 0;
  return count || 0;
}

async function countActiveGlobalSubscribers(epochIndex) {
  const c = client();
  if (!c) return 0;
  const { count, error } = await c
    .from('telegram_global_chat_subscribers')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)
    .eq('epoch_index', Number(epochIndex));
  if (error) return 0;
  return count || 0;
}

async function listActiveRecruitmentPosts(limit = 10) {
  const c = client();
  if (!c) return [];
  const now = new Date().toISOString();
  const { data, error } = await c
    .from('telegram_recruitment_posts')
    .select('id, post_text, photo_file_id, approved_at, expires_at, submission_id')
    .gt('expires_at', now)
    .order('approved_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function listPendingRecruitmentSubmissions(limit = 25) {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from('telegram_recruitment_submissions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function countPendingRecruitmentSubmissions() {
  const c = client();
  if (!c) return 0;
  const { count, error } = await c
    .from('telegram_recruitment_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) return 0;
  return count || 0;
}

async function getRecruitmentPostById(postId) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c
    .from('telegram_recruitment_posts')
    .select('*')
    .eq('id', Number(postId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/**
 * Controlla se esiste già un annuncio pendente o attivo per questo clan.
 * @param {string} clanTag - tag normalizzato senza # (es. '2J2VLPP9R')
 * @returns {Promise<{ blocked: boolean, hasPending?: boolean, hasActive?: boolean }>}
 */
async function checkClanAlreadyBlocked(clanTag) {
  const c = client();
  if (!c || !clanTag) return { blocked: false };
  const tag = String(clanTag).toUpperCase().replace(/^#/, '');
  if (!tag) return { blocked: false };
  const now = new Date().toISOString();

  // Submission in attesa per questo clan?
  const { count: pendingCount, error: pe } = await c
    .from('telegram_recruitment_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('clan_tag', tag)
    .eq('status', 'pending');
  if (!pe && (pendingCount || 0) > 0) return { blocked: true, hasPending: true };

  // Post attivo (scadenza futura) per questo clan?
  const { data: subs, error: se } = await c
    .from('telegram_recruitment_submissions')
    .select('id')
    .eq('clan_tag', tag)
    .in('status', ['approved', 'auto_published']);
  if (se || !subs || subs.length === 0) return { blocked: false };

  const ids = subs.map((s) => s.id);
  const { count: activeCount, error: ae } = await c
    .from('telegram_recruitment_posts')
    .select('*', { count: 'exact', head: true })
    .in('submission_id', ids)
    .gt('expires_at', now);
  if (!ae && (activeCount || 0) > 0) return { blocked: true, hasActive: true };

  return { blocked: false };
}

/**
 * Controlla se l'utente ha già un annuncio attivo (qualsiasi clan).
 * @returns {Promise<{ id: number, expires_at: string } | null>}
 */
async function checkUserAlreadyHasActivePost(userId) {
  const c = client();
  if (!c) return null;
  const now = new Date().toISOString();
  const { data, error } = await c
    .from('telegram_recruitment_posts')
    .select('id, expires_at')
    .eq('submitter_telegram_user_id', Number(userId))
    .gt('expires_at', now)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/**
 * Verifica se il clan è collegato a una chat CoCBoard (badge verificato).
 * @param {string} clanTag - tag normalizzato senza # (es. '2J2VLPP9R')
 * @returns {Promise<boolean>}
 */
async function isClanRegisteredInCocboard(clanTag) {
  const c = client();
  if (!c || !clanTag) return false;
  const tag = `#${String(clanTag).toUpperCase().replace(/^#/, '')}`;
  const { count, error } = await c
    .from('telegram_chat_links')
    .select('telegram_chat_id', { count: 'exact', head: true })
    .eq('clan_tag', tag);
  if (error) return false;
  return (count || 0) > 0;
}

/**
 * Restituisce il post attivo (se esiste) creato da questo submitter.
 * @returns {Promise<{ id: number, expires_at: string, submission_id: number } | null>}
 */
async function getActivePostBySubmitter(userId) {
  const c = client();
  if (!c) return null;
  const now = new Date().toISOString();
  const { data, error } = await c
    .from('telegram_recruitment_posts')
    .select('id, expires_at, submission_id')
    .eq('submitter_telegram_user_id', Number(userId))
    .gt('expires_at', now)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/** Normalizza tag giocatore per confronto con members.tag (formato API CoC: #XXX). */
function normPlayerTagForMembers(tagRaw) {
  let t = String(tagRaw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!t) return null;
  if (!t.startsWith('#')) t = `#${t}`;
  if (!/^#[0-9A-Z]{3,15}$/.test(t)) return null;
  return t;
}

async function getMemberThExpByPlayerTag(tagRaw) {
  const c = client();
  if (!c) return null;
  const t = normPlayerTagForMembers(tagRaw);
  if (!t) return null;
  const tryTag = async (tag) => {
    const { data, error } = await c.from('members').select('th_level, exp_level').eq('tag', tag).maybeSingle();
    if (error) return null;
    return data || null;
  };
  let row = await tryTag(t);
  if (row) return row;
  const noHash = t.replace(/^#/, '');
  row = await tryTag(noHash);
  return row || null;
}

async function getGlobalModerationRow(telegramUserId) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c
    .from('telegram_global_moderation')
    .select('*')
    .eq('telegram_user_id', Number(telegramUserId))
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/** Moderatore staff (tabella sincronizzata da API; badge in chat globale). */
async function isTelegramStaffModerator(telegramUserId) {
  const c = client();
  if (!c) return false;
  const uid = Number(telegramUserId);
  if (!Number.isFinite(uid)) return false;
  const { data, error } = await c
    .from('telegram_staff_moderator_ids')
    .select('telegram_user_id')
    .eq('telegram_user_id', uid)
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

function globalModerationBlocked(row) {
  if (!row) return { blocked: false };
  if (row.banned === true || row.banned === 'true') return { blocked: true, kind: 'banned' };
  const mu = row.muted_until;
  if (mu && new Date(mu).getTime() > Date.now()) return { blocked: true, kind: 'muted', until: mu };
  return { blocked: false };
}

/** Incrementa strike e applica mute/ban; ritorna messaggio utente in italiano. */
async function recordGlobalChatViolation(telegramUserId) {
  const c = client();
  if (!c) return '⚠️ Regola della chat violata.';
  const uid = Number(telegramUserId);
  const now = new Date();
  const row = await getGlobalModerationRow(uid);
  let banned = row?.banned === true || row?.banned === 'true';
  const strikes = (row?.strike_count || 0) + 1;
  let mutedUntil = null;
  const existingMute =
    row?.muted_until && new Date(row.muted_until).getTime() > now.getTime() ? new Date(row.muted_until) : null;

  if (!banned && strikes >= 6) banned = true;

  if (banned) {
    mutedUntil = null;
  } else if (strikes >= 5) {
    mutedUntil = new Date(now.getTime() + 72 * 3600 * 1000);
  } else if (strikes >= 4) {
    mutedUntil = new Date(now.getTime() + 24 * 3600 * 1000);
  } else if (strikes >= 3) {
    mutedUntil = new Date(now.getTime() + 6 * 3600 * 1000);
  } else if (existingMute) {
    mutedUntil = existingMute;
  }

  const payload = {
    telegram_user_id: uid,
    strike_count: strikes,
    muted_until: mutedUntil ? mutedUntil.toISOString() : null,
    banned,
    updated_at: now.toISOString(),
  };
  const { error } = await c.from('telegram_global_moderation').upsert(payload, { onConflict: 'telegram_user_id' });
  if (error) return '⚠️ Regola della chat violata.';
  if (banned) {
    await deactivateGlobalSubscriber(uid).catch(() => {});
    return (
      '🚫 <b>Ban dalla chat globale.</b> Troppi strike: non puoi più entrare in stanza. ' +
      'Per ricorsi scrivi allo staff del bot.'
    );
  }
  if (mutedUntil && strikes >= 3) {
    return (
      `⚠️ <b>Avviso moderazione</b> (strike ${strikes}). ` +
      `Sei in <b>mute</b> fino a ${mutedUntil.toLocaleString('it-IT', { timeZone: 'UTC' })} UTC. ` +
      'Niente link, tag promozionali o spam in chat.'
    );
  }
  return `⚠️ <b>Avviso moderazione</b> (strike ${strikes}/5). Leggi le regole in Guida: niente link, reclutamento o falsi simboli di verifica.`;
}

module.exports = {
  tickGlobalEpochIfNeeded,
  upsertGlobalSubscriber,
  deactivateGlobalSubscriber,
  setGlobalSubscriberHub,
  clearGlobalSubscriberHub,
  insertGlobalEphemeralDelivery,
  consumeGlobalEphemeralDeliveriesBeforeEpoch,
  consumeGlobalEphemeralDeliveriesForChat,
  getGlobalSubscriber,
  getGlobalSubscriberByDisplayTag,
  isActiveInGlobalChat,
  insertGlobalMessage,
  listGlobalBroadcastTargets,
  ensureRecruitmentSubscriber,
  listRecruitmentFeedUserIds,
  insertRecruitmentSubmission,
  getRecruitmentSubmission,
  setSubmissionStatus,
  insertRecruitmentPost,
  listExpiredRecruitmentPosts,
  deleteRecruitmentPostRow,
  countSubmissionsSince,
  countActiveGlobalSubscribers,
  listActiveRecruitmentPosts,
  listPendingRecruitmentSubmissions,
  countPendingRecruitmentSubmissions,
  getRecruitmentPostById,
  checkClanAlreadyBlocked,
  checkUserAlreadyHasActivePost,
  isClanRegisteredInCocboard,
  getActivePostBySubmitter,
  getMemberThExpByPlayerTag,
  getGlobalModerationRow,
  isTelegramStaffModerator,
  globalModerationBlocked,
  recordGlobalChatViolation,
};

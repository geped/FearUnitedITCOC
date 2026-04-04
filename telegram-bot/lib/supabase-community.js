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

async function insertRecruitmentSubmission(submitterId, display, bodyText, clanUrl, photoFileId, bodyHtml) {
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
    photo_file_id: photoFileId ? String(photoFileId).slice(0, 256) : null,
    status: 'pending',
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

async function insertRecruitmentPost(submissionId, postText, photoFileId, approvedAtIso, expiresAtIso, deliveredIds) {
  const c = client();
  if (!c) throw new Error('Supabase non configurato.');
  const row = {
    submission_id: Number(submissionId),
    post_text: String(postText),
    photo_file_id: photoFileId || null,
    approved_at: approvedAtIso,
    expires_at: expiresAtIso,
    delivered_message_ids: deliveredIds,
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
};

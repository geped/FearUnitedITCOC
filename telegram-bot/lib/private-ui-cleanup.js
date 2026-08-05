'use strict';

const sbc = require('./supabase-community');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @type {Map<number, Set<number>>} */
const privateUiMessageIds = new Map();

function notePrivateUiMessage(telegramUserId, messageId) {
  if (telegramUserId == null || messageId == null) return;
  const uid = Number(telegramUserId);
  const mid = typeof messageId === 'bigint' ? Number(messageId) : Number(messageId);
  if (!Number.isFinite(uid) || !Number.isFinite(mid)) return;
  let set = privateUiMessageIds.get(uid);
  if (!set) {
    set = new Set();
    privateUiMessageIds.set(uid, set);
  }
  set.add(mid);
}

/**
 * Chat privata: intercetta reply/sendMessage (nuove bolle) e edit* (stessa bolla dei callback),
 * così il wipe elimina anche i menù aggiornati solo con editMessageText.
 */
function attachPrivateUiTracking(ctx) {
  if (ctx.chat?.type !== 'private' || ctx.from?.id == null) return;
  const uid = ctx.from.id;

  const trackSent = (orig) => async (...args) => {
    const m = await orig(...args);
    if (m != null && m.message_id != null) notePrivateUiMessage(uid, m.message_id);
    return m;
  };

  ctx.reply = trackSent(ctx.reply.bind(ctx));
  ctx.sendMessage = trackSent(ctx.sendMessage.bind(ctx));
  // Anteprime reclutamento (foto/stemma) e altri media: altrimenti restano in chat dopo wipe
  if (typeof ctx.replyWithPhoto === 'function') {
    ctx.replyWithPhoto = trackSent(ctx.replyWithPhoto.bind(ctx));
  }
  if (typeof ctx.replyWithVideo === 'function') {
    ctx.replyWithVideo = trackSent(ctx.replyWithVideo.bind(ctx));
  }
  if (typeof ctx.replyWithDocument === 'function') {
    ctx.replyWithDocument = trackSent(ctx.replyWithDocument.bind(ctx));
  }

  const origEditText = ctx.editMessageText.bind(ctx);
  ctx.editMessageText = async (...args) => {
    const r = await origEditText(...args);
    const mid = ctx.callbackQuery?.message?.message_id;
    if (mid != null) notePrivateUiMessage(uid, mid);
    return r;
  };

  const origEditMarkup = ctx.editMessageReplyMarkup.bind(ctx);
  ctx.editMessageReplyMarkup = async (...args) => {
    const r = await origEditMarkup(...args);
    const mid = ctx.callbackQuery?.message?.message_id;
    if (mid != null) notePrivateUiMessage(uid, mid);
    return r;
  };
}

/** Callback che aggiornano solo la bolla corrente (nessun cambio sezione): non cancellare il resto. */
function callbackSkipsUiWipe(data) {
  const d = data || '';
  if (d === 'noop' || d === 'comm_global_status') return true;
  // Sotto-menu chat globale: stessa bolla di comm_global — se facciamo wipe, editMessageText fallisce.
  if (
    d === 'comm_gman' ||
    d === 'comm_gauth' ||
    d === 'comm_gprof' ||
    d === 'comm_gprof_sf' ||
    d === 'comm_gprof_sm' ||
    d === 'comm_global_report' ||
    d === 'comm_global_mode' ||
    d === 'comm_global_quick'
  ) {
    return true;
  }
  // Navigazione interna war/cwl live (stessa bolla: edit testo)
  if (d.startsWith('wl_v:') || d.startsWith('cwl_v:')) return true;
  // Gestione avvisi (stessa bolla: categorie, esempi, toggle)
  if (
    d === 'notif_menu' ||
    d.startsWith('notif_cat:') ||
    d.startsWith('notif_ex:') ||
    d.startsWith('notif_tog:') ||
    d === 'notif_custom_menu' ||
    d.startsWith('notif_custom_') ||
    d === 'prof_menu' ||
    d === 'prof_gate' ||
    d.startsWith('prof_')
  ) {
    return true;
  }
  // Assegnazione / storico bonus (stessa bolla: edit testo + tastiera).
  // Season: YYYY-MM oppure YYYY-MM-DD (CoC API).
  const SEASON = String.raw`\d{4}-\d{2}(?:-\d{2})?`;
  if (
    d === 'bonus:as' ||
    d === 'bonus:hist' ||
    d === 'bonus:hof' ||
    new RegExp(`^bonus:sv:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:az[pm]:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:asz:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:asp:${SEASON}:\\d+$`).test(d) ||
    new RegExp(`^bonus:ast:${SEASON}:\\d+:\\d+$`).test(d) ||
    new RegExp(`^bonus:asy:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:aw:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:awn:${SEASON}:\\d+$`).test(d) ||
    new RegExp(`^bonus:awm:${SEASON}:\\d+:\\d+$`).test(d) ||
    new RegExp(`^bonus:awp:${SEASON}:\\d+$`).test(d) ||
    new RegExp(`^bonus:awt:${SEASON}:\\d+$`).test(d) ||
    new RegExp(`^bonus:awr:${SEASON}$`).test(d) ||
    new RegExp(`^bonus:awy:${SEASON}$`).test(d)
  ) {
    return true;
  }
  return false;
}

/** @type {((telegramUserId: number) => void) | null} */
let onBeforePrivateUiWipe = null;

function setOnBeforePrivateUiWipe(fn) {
  onBeforePrivateUiWipe = typeof fn === 'function' ? fn : null;
}

/**
 * In chat privata: elimina tutte le bolle UI tracciate + messaggi relay chat globale (DB ephemeral).
 * Chiamare prima di aprire una nuova sezione (comando /, quasi tutti i callback).
 */
async function wipePrivateConversationUi(telegram, telegramUserId) {
  if (telegramUserId == null) return;
  const chatId = Number(telegramUserId);
  if (!Number.isFinite(chatId)) return;

  if (onBeforePrivateUiWipe) {
    try {
      onBeforePrivateUiWipe(chatId);
    } catch (_) {}
  }

  const tracked = privateUiMessageIds.get(chatId);
  privateUiMessageIds.delete(chatId);
  const ids = tracked ? Array.from(tracked) : [];

  let ephemeralRows = [];
  try {
    ephemeralRows = await sbc.consumeGlobalEphemeralDeliveriesForChat(chatId);
  } catch (_) {
    ephemeralRows = [];
  }

  for (const mid of ids) {
    try {
      await telegram.deleteMessage(chatId, mid);
    } catch (_) {}
    await sleep(14);
  }
  for (const row of ephemeralRows) {
    if (row?.message_id == null) continue;
    try {
      await telegram.deleteMessage(Number(row.chat_id), Number(row.message_id));
    } catch (_) {}
    await sleep(14);
  }
}

/** Solo relay chat globale (e testi utente tracciati): utile all’uscita dalla stanza senza wipe menù. */
async function purgeGlobalEphemeralOnly(telegram, telegramUserId) {
  if (telegramUserId == null) return;
  const chatId = Number(telegramUserId);
  if (!Number.isFinite(chatId)) return;
  let ephemeralRows = [];
  try {
    ephemeralRows = await sbc.consumeGlobalEphemeralDeliveriesForChat(chatId);
  } catch (_) {
    ephemeralRows = [];
  }
  for (const row of ephemeralRows) {
    if (row?.message_id == null) continue;
    try {
      await telegram.deleteMessage(Number(row.chat_id), Number(row.message_id));
    } catch (_) {}
    await sleep(14);
  }
}

module.exports = {
  notePrivateUiMessage,
  attachPrivateUiTracking,
  callbackSkipsUiWipe,
  wipePrivateConversationUi,
  purgeGlobalEphemeralOnly,
  setOnBeforePrivateUiWipe,
};

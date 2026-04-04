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
  const mid = Number(messageId);
  if (!Number.isFinite(uid) || !Number.isFinite(mid)) return;
  let set = privateUiMessageIds.get(uid);
  if (!set) {
    set = new Set();
    privateUiMessageIds.set(uid, set);
  }
  set.add(mid);
}

/** Callback che aggiornano solo la bolla corrente (nessun cambio sezione): non cancellare il resto. */
function callbackSkipsUiWipe(data) {
  const d = data || '';
  if (d === 'noop' || d === 'comm_global_status') return true;
  return false;
}

/**
 * In chat privata: elimina tutte le bolle UI tracciate + messaggi relay chat globale (DB ephemeral).
 * Chiamare prima di aprire una nuova sezione (comando /, quasi tutti i callback).
 */
async function wipePrivateConversationUi(telegram, telegramUserId) {
  if (telegramUserId == null) return;
  const chatId = Number(telegramUserId);
  if (!Number.isFinite(chatId)) return;

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

module.exports = {
  notePrivateUiMessage,
  callbackSkipsUiWipe,
  wipePrivateConversationUi,
};

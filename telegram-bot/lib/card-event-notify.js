'use strict';

/**
 * Evento "Clash of Cards" — invio notifiche Telegram proattive.
 * Polling periodico (vedi index.js) su card_event_notify_outbox: righe accodate
 * dal sito (api/_utils/card-trades.js / card-event.js) quando succede qualcosa
 * che riguarda un altro utente (nuovo match, messaggio, proposta, scambio accettato).
 */

const fmt = require('./format');

const BATCH_SIZE = 25;

function buildMessage(row) {
  const p = row.payload || {};
  const give = fmt.escapeHtml(p.card_give_name || p.card_give || '?');
  const get = fmt.escapeHtml(p.card_get_name || p.card_get || '?');

  if (row.kind === 'match') {
    return (
      `${fmt.DIV}\n🎴 <b>Nuovo scambio possibile!</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.other_username || p.other_coc_tag || 'Un giocatore')}</b> ha una carta che ti serve.\n\n` +
      `Tu cedi: <b>${give}</b>\nTu ricevi: <b>${get}</b>\n\n` +
      `Apri "Carte scambio → Scambi" dal menù per proporre lo scambio.`
    );
  }
  if (row.kind === 'message') {
    const body = fmt.escapeHtml(String(p.body || '').slice(0, 200));
    return (
      `${fmt.DIV}\n💬 <b>Nuovo messaggio — scambio carte</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.sender_username || 'Un giocatore')}</b>: “${body}”\n\n` +
      `Apri "Carte scambio → Scambi → Le mie stanze" per rispondere.`
    );
  }
  if (row.kind === 'proposal') {
    return (
      `${fmt.DIV}\n🔁 <b>Nuova proposta di scambio</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.proposer_username || 'Un giocatore')}</b> propone: cede <b>${give}</b> → riceve <b>${get}</b>\n\n` +
      `Apri "Carte scambio → Scambi → Le mie stanze" per accettare o rifiutare.`
    );
  }
  if (row.kind === 'trade_done') {
    return (
      `${fmt.DIV}\n✅ <b>Scambio completato</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.accepted_by_username || 'L\'altro giocatore')}</b> ha accettato: cedi <b>${give}</b> → ricevi <b>${get}</b>.\n` +
      `La tua collezione è già stata aggiornata.`
    );
  }
  return '🎴 Aggiornamento evento Clash of Cards.';
}

async function runCardEventNotifications(bot, sb) {
  let rows = [];
  try {
    rows = await sb.listPendingCardNotifications(BATCH_SIZE);
  } catch (e) {
    console.warn('[cards-notify] list:', e.message);
    return;
  }
  if (!rows.length) return;

  const sentIds = [];
  for (const row of rows) {
    try {
      const telegramUserId = await sb.getTelegramUserIdForSupabaseUser(row.user_id);
      if (telegramUserId) {
        await bot.telegram.sendMessage(telegramUserId, buildMessage(row), { parse_mode: 'HTML' });
      }
      sentIds.push(row.id);
    } catch (e) {
      const s = String(e.message || '');
      // Utente ha bloccato il bot o chat non più valida: marca come inviata comunque
      // (nessun destinatario raggiungibile) per non ritentare all'infinito.
      if (s.includes('Forbidden') || s.includes('chat not found') || s.includes('bot was blocked')) {
        sentIds.push(row.id);
      } else {
        console.warn('[cards-notify] send:', row.id, e.message);
      }
    }
  }
  if (sentIds.length) {
    await sb.markCardNotificationsSent(sentIds).catch((e) => console.warn('[cards-notify] mark sent:', e.message));
  }
}

module.exports = { runCardEventNotifications };

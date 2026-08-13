'use strict';

/**
 * Evento "Clash of Cards" — invio notifiche Telegram proattive.
 * Polling periodico (vedi index.js) su card_event_notify_outbox: righe accodate
 * dal sito (api/_utils/card-trades.js / card-event.js) quando succede qualcosa
 * che riguarda un altro utente (nuovo match, messaggio, proposta, scambio
 * accettato, escrow "committed").
 *
 * Ogni notifica porta con sé, quando disponibile, il profilo CoC coinvolto
 * (my_profile_id / coc_tag) e i bottoni azione per intervenire subito senza
 * dover navigare tutto il menù "Carte scambio".
 */

const { Markup } = require('telegraf');
const fmt = require('./format');

const BATCH_SIZE = 25;

function playerIdentityHtml(username, tag, clan) {
  const name = fmt.escapeHtml(username || tag || 'Un giocatore');
  const extras = [tag, clan].filter(Boolean).map((s) => fmt.escapeHtml(String(s)));
  if (!extras.length) return `<b>${name}</b>`;
  return `<b>${name}</b> <i>(${extras.join(' · ')})</i>`;
}

function buildMessage(row) {
  const p = row.payload || {};
  const give = fmt.escapeHtml(p.card_give_name || p.card_give || '?');
  const get = fmt.escapeHtml(p.card_get_name || p.card_get || '?');
  const otherId = playerIdentityHtml(p.other_username, p.other_coc_tag, p.other_clan_name);
  const myId = playerIdentityHtml(p.my_username, p.my_coc_tag, p.my_clan_name);
  const profileLine = p.my_coc_tag
    ? `\n<i>Con il profilo: ${fmt.escapeHtml(p.my_coc_tag)}${p.my_username ? ` · ${fmt.escapeHtml(p.my_username)}` : ''}${p.my_clan_name ? ` · ${fmt.escapeHtml(p.my_clan_name)}` : ''}</i>`
    : '';

  if (row.kind === 'match') {
    const iUnlock = p.i_unlock !== false;
    if (iUnlock) {
      return (
        `${fmt.DIV}\n🎴 <b>Nuovo scambio possibile!</b>\n${fmt.DIV}\n\n` +
        `${otherId} ha una carta che ti serve.\n\n` +
        `Con il tuo profilo: ${myId}\n\n` +
        `Tu cedi: <b>${give}</b>\nTu ricevi: <b>${get}</b>\n\n` +
        `Usa i bottoni qui sotto per applicare subito o proporre lo scambio in chat.`
      );
    }
    return (
      `${fmt.DIV}\n🎴 <b>Nuovo scambio possibile!</b>\n${fmt.DIV}\n\n` +
      `${otherId} può sbloccare una carta scambiando con te.\n\n` +
      `Con il tuo profilo: ${myId}\n\n` +
      `Tu daresti: <b>${give}</b> (ti resta almeno 1 copia)\n` +
      `Tu riceveresti: <b>${get}</b> (già nel mazzo)\n\n` +
      `Solo chi sblocca una carta nuova può proporre lo scambio: attendi la sua proposta oppure aprilo dal sito.`
    );
  }
  if (row.kind === 'message') {
    const body = fmt.escapeHtml(String(p.body || '').slice(0, 200));
    return (
      `${fmt.DIV}\n💬 <b>Nuovo messaggio — scambio carte</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.sender_username || 'Un giocatore')}</b>: “${body}”\n\n` +
      `Apri la chat per rispondere.`
    );
  }
  if (row.kind === 'proposal') {
    return (
      `${fmt.DIV}\n🔁 <b>Nuova proposta di scambio</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.proposer_username || 'Un giocatore')}</b> propone: cede <b>${give}</b> → riceve <b>${get}</b>.${profileLine}\n\n` +
      `Apri la chat per accettare o rifiutare.`
    );
  }
  if (row.kind === 'committed') {
    return (
      `${fmt.DIV}\n⚡ <b>L'altro ha già ceduto la sua carta!</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.proposer_username || 'Un giocatore')}</b> ha già dato <b>${give}</b> in cambio di <b>${get}</b> e aspetta che tu completi lo scambio.${profileLine}\n\n` +
      `Apri la chat e premi "Applica subito" per completare (riceverete entrambi la carta).`
    );
  }
  if (row.kind === 'trade_done') {
    return (
      `${fmt.DIV}\n✅ <b>Scambio completato</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.accepted_by_username || 'L\'altro giocatore')}</b> ha accettato: cedi <b>${give}</b> → ricevi <b>${get}</b>.${profileLine}\n` +
      `La tua collezione è già stata aggiornata.`
    );
  }
  if (row.kind === 'triangle_proposal') {
    const a = fmt.escapeHtml(p.card_a_gives_name || p.card_a_gives || '?');
    const b = fmt.escapeHtml(p.card_b_gives_name || p.card_b_gives || '?');
    const c = fmt.escapeHtml(p.card_c_gives_name || p.card_c_gives || '?');
    return (
      `${fmt.DIV}\n🔀 <b>Proposta scambio a tre</b>\n${fmt.DIV}\n\n` +
      `<b>${fmt.escapeHtml(p.proposer_username || 'Un giocatore')}</b> propone un triangolo.${profileLine}\n\n` +
      `Ciclo: ${a} → ${b} → ${c}\n\n` +
      `Accetta o rifiuta con i bottoni sotto.`
    );
  }
  if (row.kind === 'triangle_done') {
    return (
      `${fmt.DIV}\n✅ <b>Triangolo completato</b>\n${fmt.DIV}\n\n` +
      `Lo scambio a tre è stato applicato.${profileLine}\n` +
      `La tua collezione è aggiornata.`
    );
  }
  if (row.kind === 'triangle_match') {
    return (
      `${fmt.DIV}\n🔀 <b>Nuovo triangolo possibile</b>\n${fmt.DIV}\n\n` +
      `C'è uno scambio a tre disponibile con i mazzi pubblici.${profileLine}`
    );
  }
  return '🎴 Aggiornamento evento Clash of Cards.';
}

function buildKeyboard(row) {
  const p = row.payload || {};
  const rows = [];
  if (row.kind === 'match') {
    if (p.i_unlock !== false) {
      rows.push([
        Markup.button.callback('⚡ Applica subito', `cards:nmatch:${row.id}:apply`),
        Markup.button.callback('💬 Proponi', `cards:nmatch:${row.id}:propose`),
      ]);
    } else {
      rows.push([Markup.button.callback('🎴 Apri carte', 'cards:menu')]);
    }
  } else if (row.kind === 'proposal' && p.room_id) {
    rows.push([Markup.button.callback('💬 Apri chat', `cards:room:${p.room_id}`)]);
  } else if (row.kind === 'committed' && p.room_id) {
    rows.push([
      Markup.button.callback('⚡ Applica subito (completa)', `cards:ncommit:${p.proposal_id}`),
      Markup.button.callback('💬 Apri chat', `cards:room:${p.room_id}`),
    ]);
  } else if (row.kind === 'trade_done' && p.room_id) {
    rows.push([Markup.button.callback('💬 Apri chat', `cards:room:${p.room_id}`)]);
  } else if (row.kind === 'message' && p.room_id) {
    rows.push([Markup.button.callback('💬 Apri chat', `cards:room:${p.room_id}`)]);
  } else if (row.kind === 'triangle_proposal' && p.triangle_id) {
    rows.push([
      Markup.button.callback('✅ Accetta', `cards:tri:acc:${p.triangle_id}`),
      Markup.button.callback('✕ Rifiuta', `cards:tri:rej:${p.triangle_id}`),
    ]);
  } else if (row.kind === 'triangle_done') {
    rows.push([Markup.button.callback('🎴 Apri carte', 'cards:menu')]);
  }
  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
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
        const kb = buildKeyboard(row);
        await bot.telegram.sendMessage(telegramUserId, buildMessage(row), {
          parse_mode: 'HTML',
          ...(kb || {}),
        });
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

module.exports = { runCardEventNotifications, buildMessage, buildKeyboard };

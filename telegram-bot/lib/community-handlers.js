'use strict';

const { Markup } = require('telegraf');
const sbc = require('./supabase-community');
const cv = require('./community-validation');

function isPrivate(ctx) {
  return ctx.chat?.type === 'private';
}

function displayFromUser(user) {
  const meta = user?.user_metadata || {};
  const tag = meta.coc_tag ? String(meta.coc_tag).trim() : '';
  const name = (meta.username || (user?.email || '').split('@')[0] || 'Comandante').trim();
  return { name: name.slice(0, 120), tag: tag ? (tag.startsWith('#') ? tag : `#${tag}`).slice(0, 32) : '' };
}

function formatGlobalLine(displayName, displayTag, body) {
  const tagPart = displayTag ? ` <code>${escapeHtml(displayTag)}</code>` : '';
  return `<b>${escapeHtml(displayName)}</b>${tagPart}\n${escapeHtml(body)}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tryHandleEarlyMessage(ctx, pendingCommunity, { isLinkedChatContext, sendMainMenu, backMenuKb, tauth }) {
  const uid = ctx.from?.id;
  if (uid == null || !isPrivate(ctx) || isLinkedChatContext(ctx)) return false;

  const txt = (ctx.message?.text || '').trim();
  const low = txt.split(/\s+/)[0].toLowerCase();

  if (low === '/esci_chat_global' || low.startsWith('/esci_chat_global@')) {
    await sbc.deactivateGlobalSubscriber(uid);
    pendingCommunity.delete(uid);
    await ctx.reply('👋 Hai lasciato la <b>chat globale</b>.', { parse_mode: 'HTML', ...backMenuKb() });
    const sess = await tauth.getValidSession(uid);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    }
    return true;
  }

  if (low === '/annulla_reclutamento' || low.startsWith('/annulla_reclutamento@')) {
    pendingCommunity.delete(uid);
    await ctx.reply('Bozza reclutamento annullata.', { ...backMenuKb() });
    return true;
  }

  if (ctx.message && !txt.startsWith('/')) {
    const ag = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (ag && ctx.message.photo) {
      await ctx.reply('In chat globale invia solo testo.');
      return true;
    }
  }

  if (pendingCommunity.has(uid)) {
    const st = pendingCommunity.get(uid);
    if (st.kind === 'global_manual_tag') {
      if (!ctx.message?.text || txt.startsWith('/')) return true;
      pendingCommunity.delete(uid);
      const tagRaw = txt.replace(/^#/, '').trim().toUpperCase();
      const displayTag = tagRaw ? `#${tagRaw.slice(0, 15)}` : '#????';
      const displayName = `Player ${displayTag}`;
      await sbc.tickGlobalEpochIfNeeded().catch(() => {});
      await sbc.upsertGlobalSubscriber(uid, displayName, displayTag);
      await ctx.reply(
        `✅ Sei nella <b>chat globale</b>.\n\n` +
          `Nome mostrato: <b>${escapeHtml(displayName)}</b> ${escapeHtml(displayTag)}\n\n` +
          `• Finestra attuale: messaggi si azzerano ogni <b>5 minuti</b> (UTC) per tutti.\n` +
          `• Vedi solo messaggi inviati <b>dopo</b> il tuo ingresso in questa finestra.\n` +
          `• Scrivi per inviare. <code>/esci_chat_global</code> per uscire.`,
        { parse_mode: 'HTML' }
      );
      return true;
    }
    if (st.kind === 'recruit_body') {
      let bodyText = '';
      let photoFileId = null;
      if (ctx.message?.photo?.length) {
        photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        bodyText = (ctx.message.caption || '').trim();
      } else if (ctx.message?.text) {
        bodyText = txt;
      } else {
        await ctx.reply('Invia testo (e opzionalmente una foto con didascalia) oppure /annulla_reclutamento.');
        return true;
      }
      const v = cv.recruitmentTextValid(bodyText);
      if (!v.ok) {
        await ctx.reply(`❌ ${v.reason}\n\nRiprova o /annulla_reclutamento`);
        return true;
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const n = await sbc.countSubmissionsSince(uid, since);
      if (n >= 5) {
        await ctx.reply('❌ Troppi invii nelle ultime 24h. Riprova più tardi.');
        pendingCommunity.delete(uid);
        return true;
      }
      const sess = await tauth.getValidSession(uid);
      const disp = sess?.user ? displayFromUser(sess.user) : { name: 'Utente', tag: '' };
      const subLabel = disp.tag ? `${disp.name} (${disp.tag})` : disp.name;
      pendingCommunity.delete(uid);
      let sid;
      try {
        sid = await sbc.insertRecruitmentSubmission(uid, subLabel, bodyText, v.link, photoFileId);
      } catch (e) {
        await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        return true;
      }
      const owners = cv.parseOwnerTelegramIds();
      if (!owners.length) {
        await ctx.reply(
          '⚠️ Bozza salvata ma <b>nessun owner</b> configurato (<code>BOT_OWNER_TELEGRAM_IDS</code>). Nessuno potrà approvare.',
          { parse_mode: 'HTML', ...backMenuKb() }
        );
        return true;
      }
      const shortPreview = escapeHtml(bodyText.slice(0, 500));
      const modKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Approva', `rva:${sid}`), Markup.button.callback('❌ Rifiuta', `rvr:${sid}`)],
      ]);
      for (const oid of owners) {
        await ctx.telegram
          .sendMessage(
            oid,
            `📋 <b>Reclutamento</b> bozza <code>#${sid}</code>\n` +
              `Da: ${escapeHtml(subLabel)}\n\n` +
              `${shortPreview}${bodyText.length > 500 ? '…' : ''}\n\n` +
              `<b>Link estratto:</b>\n<code>${escapeHtml(v.link)}</code>`,
            { parse_mode: 'HTML', ...modKb }
          )
          .catch(() => {});
      }
      await ctx.reply(
        '✅ Bozza inviata in moderazione. Se approvata, il bot pubblicherà il messaggio nel feed (24h).',
        { parse_mode: 'HTML', ...backMenuKb() }
      );
      return true;
    }
  }

  if (ctx.message && !txt.startsWith('/') && !ctx.message.photo) {
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (active) {
      await sbc.tickGlobalEpochIfNeeded().catch(() => {});
      const still = await sbc.isActiveInGlobalChat(uid).catch(() => false);
      if (!still) {
        await ctx.reply('La finestra chat è appena ripartita. Riapri la chat globale dal menù.');
        return true;
      }
      const body = txt;
      if (!body.trim()) return true;
      if (body.length > cv.GLOBAL_MSG_MAX_LEN) {
        await ctx.reply(`Messaggio troppo lungo (max ${cv.GLOBAL_MSG_MAX_LEN} caratteri).`);
        return true;
      }
      const sub = await sbc.getGlobalSubscriber(uid);
      if (!sub) return true;
      const label = sub.display_tag ? `${sub.display_name} ${sub.display_tag}` : sub.display_name;
      let inserted;
      try {
        inserted = await sbc.insertGlobalMessage(uid, label, body);
      } catch (e) {
        await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        return true;
      }
      const targets = await sbc.listGlobalBroadcastTargets(inserted.epoch_index, uid, inserted.created_at);
      const line = formatGlobalLine(sub.display_name, sub.display_tag || '', body);
      for (const t of targets) {
        const tid = t.telegram_user_id;
        await ctx.telegram.sendMessage(tid, line, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
      }
      return true;
    }
  }

  return false;
}

function communityMenuKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🌍 Chat globale', 'comm_global')],
    [Markup.button.callback('📣 Reclutamento', 'comm_recruit')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

async function sendCommunityMenu(ctx) {
  const text =
    `${escapeHtml('───')}\n💬 <b>Community CoCBoard</b>\n${escapeHtml('───')}\n\n` +
    `• <b>Chat globale</b> — messaggi effimeri (finestre di 5 minuti UTC, stesso reset per tutti).\n` +
    `• <b>Reclutamento</b> — annuncio con link ufficiale clan CoC; dopo approvazione del proprietario del bot viene pubblicato dal bot per <b>24 ore</b>.\n\n` +
    `<i>Richiede accesso al bot. Nessuna chat diretta tra giocatori.</i>`;
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...communityMenuKb() });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', ...communityMenuKb() });
  }
}

function registerCommunityHandlers(bot, deps) {
  const { pendingCommunity, isLinkedChatContext, tauth, sendMainMenu, backMenuKb } = deps;

  bot.action('comm_hub', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.answerCbQuery('Accedi prima.').catch(() => {});
      return;
    }
    ctx.cocboardUser = sess.user;
    await sendCommunityMenu(ctx);
  });

  bot.action('comm_global', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.answerCbQuery('Accedi prima.').catch(() => {});
      return;
    }
    ctx.cocboardUser = sess.user;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('👤 Nome da profilo CoCBoard', 'comm_gprof')],
      [Markup.button.callback('✏️ Inserisco tag villaggio (testo)', 'comm_gman')],
      [Markup.button.callback('« Indietro', 'comm_hub')],
    ]);
    const body =
      `🌍 <b>Chat globale</b>\n\n` +
      `Come vuoi essere mostrato agli altri? (solo nome + tag, niente username Telegram)\n\n` +
      `<i>La cronologia della finestra si azzera per tutti ogni 5 minuti (UTC).</i>`;
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('comm_gprof', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) return;
    const { name, tag } = displayFromUser(sess.user);
    await sbc.tickGlobalEpochIfNeeded().catch(() => {});
    await sbc.upsertGlobalSubscriber(uid, name, tag || null);
    await ctx
      .editMessageText(
        `✅ Sei nella <b>chat globale</b>.\n\n` +
          `Nome mostrato: <b>${escapeHtml(name)}</b>${tag ? ` <code>${escapeHtml(tag)}</code>` : ''}\n\n` +
          `• Messaggi: solo testo.\n` +
          `• <code>/esci_chat_global</code> per uscire.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  });

  bot.action('comm_gman', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) return;
    pendingCommunity.set(uid, { kind: 'global_manual_tag' });
    await ctx
      .editMessageText(
        '✏️ Invia il <b>tag villaggio</b> (es. <code>#2ABC</code> o <code>2ABC</code>).\n<code>/esci_chat_global</code> per uscire dalla modalità.',
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  });

  bot.action('comm_recruit', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.answerCbQuery('Accedi prima.').catch(() => {});
      return;
    }
    await sbc.ensureRecruitmentSubscriber(uid);
    pendingCommunity.set(uid, { kind: 'recruit_body' });
    const help =
      `📣 <b>Reclutamento</b>\n\n` +
      `Invia <b>un messaggio</b> che includa:\n` +
      `• testo di presentazione\n` +
      `• link ufficiale al clan, solo in questo formato:\n` +
      `  <code>https://link.clashofclans.com/xx?action=OpenClanProfile&amp;tag=...</code>\n\n` +
      `Puoi allegare <b>una foto</b> (il testo con il link può essere nella didascalia).\n\n` +
      `Il post non è immediato: il proprietario del bot deve approvarlo. Se approvato, il <b>bot</b> lo pubblica (24h).\n\n` +
      `<code>/annulla_reclutamento</code> per uscire.`;
    try {
      await ctx.editMessageText(help, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_hub')]]) });
    } catch (_) {
      await ctx.reply(help, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_hub')]]) });
    }
  });

  bot.action(/^rva:(\d+)$/, async (ctx) => {
    safeCb(ctx);
    if (!cv.isBotOwnerTelegramUser(ctx.from?.id)) {
      await ctx.answerCbQuery('Non autorizzato.').catch(() => {});
      return;
    }
    const sid = Number(ctx.match[1]);
    const sub = await sbc.getRecruitmentSubmission(sid);
    if (!sub || sub.status !== 'pending') {
      await ctx.answerCbQuery('Bozza non trovata o già gestita.').catch(() => {});
      return;
    }
    await sbc.setSubmissionStatus(sid, 'approved', ctx.from.id);
    const exp = new Date(Date.now() + cv.RECRUIT_TTL_MS);
    const expStr = exp.toISOString();
    const approvedAt = new Date().toISOString();
    const link = sub.clan_profile_url;
    const postText =
      `📣 <b>Reclutamento</b> (pubblicato dal bot)\n` +
      `⏳ <i>Fino a:</i> ${escapeHtml(exp.toLocaleString('it-IT', { timeZone: 'UTC' }))} UTC\n` +
      `👤 <i>Presentato come:</i> ${escapeHtml(sub.submitter_display)}\n\n` +
      escapeHtml(sub.body_text) +
      `\n\n🔗 <a href="${escapeHtml(link)}">Apri profilo clan (CoC)</a>`;
    const userIds = await sbc.listRecruitmentFeedUserIds();
    const delivered = [];
    for (const chatId of userIds) {
      try {
        if (sub.photo_file_id) {
          const m1 = await ctx.telegram.sendMessage(chatId, postText, {
            parse_mode: 'HTML',
            disable_web_page_preview: false,
          });
          if (m1?.message_id) delivered.push({ chat_id: chatId, message_id: m1.message_id });
          const m2 = await ctx.telegram.sendPhoto(chatId, sub.photo_file_id, {
            caption: '📣 Immagine allegata all’annuncio di reclutamento.',
          });
          if (m2?.message_id) delivered.push({ chat_id: chatId, message_id: m2.message_id });
        } else {
          const msg = await ctx.telegram.sendMessage(chatId, postText, {
            parse_mode: 'HTML',
            disable_web_page_preview: false,
          });
          if (msg?.message_id) delivered.push({ chat_id: chatId, message_id: msg.message_id });
        }
      } catch (_) {}
      await sleep(35);
    }
    await sbc.insertRecruitmentPost(sid, postText, sub.photo_file_id, approvedAt, expStr, delivered);
    await ctx.answerCbQuery('Approvato e inviato.').catch(() => {});
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
    await ctx.reply(`✅ Bozza #${sid} approvata. Inviata a ${delivered.length} iscritti al feed.`, { parse_mode: 'HTML' }).catch(() => {});
    await ctx.telegram
      .sendMessage(
        sub.submitter_telegram_user_id,
        '✅ Il tuo annuncio di reclutamento è stato <b>approvato</b> e pubblicato dal bot (24h).',
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  });

  bot.action(/^rvr:(\d+)$/, async (ctx) => {
    safeCb(ctx);
    if (!cv.isBotOwnerTelegramUser(ctx.from?.id)) {
      await ctx.answerCbQuery('Non autorizzato.').catch(() => {});
      return;
    }
    const sid = Number(ctx.match[1]);
    const sub = await sbc.getRecruitmentSubmission(sid);
    if (!sub || sub.status !== 'pending') {
      await ctx.answerCbQuery('Bozza non trovata o già gestita.').catch(() => {});
      return;
    }
    await sbc.setSubmissionStatus(sid, 'rejected', ctx.from.id);
    await ctx.answerCbQuery('Rifiutato.').catch(() => {});
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
    await ctx.reply(`❌ Bozza #${sid} rifiutata.`, { parse_mode: 'HTML' }).catch(() => {});
    await ctx.telegram
      .sendMessage(sub.submitter_telegram_user_id, '❌ Il tuo annuncio di reclutamento non è stato approvato.', {
        parse_mode: 'HTML',
      })
      .catch(() => {});
  });
}

function safeCb(ctx) {
  try {
    ctx.answerCbQuery().catch(() => {});
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  tryHandleEarlyMessage,
  sendCommunityMenu,
  communityMenuKb,
  registerCommunityHandlers,
  displayFromUser,
};

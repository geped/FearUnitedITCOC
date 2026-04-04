'use strict';

const { Markup } = require('telegraf');
const sbc = require('./supabase-community');
const cv = require('./community-validation');
const tgh = require('./telegram-html');

function displayFromUser(user) {
  const meta = user?.user_metadata || {};
  const tag = meta.coc_tag ? String(meta.coc_tag).trim() : '';
  const name = (meta.username || (user?.email || '').split('@')[0] || 'Comandante').trim();
  return { name: name.slice(0, 120), tag: tag ? (tag.startsWith('#') ? tag : `#${tag}`).slice(0, 32) : '' };
}

/** Solo contenuto messaggio utente (niente footer stanza: sta nel messaggio fisso hub). */
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

/** Limite caption Telegram (HTML); sotto questa soglia usiamo un solo messaggio (foto + testo). */
const TG_CAPTION_HTML_MAX = 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function submissionBodyHtmlPart(sub) {
  if (sub.body_html && String(sub.body_html).trim()) return sub.body_html;
  return escapeHtml(sub.body_text || '');
}

function buildApprovedPostTextFromSubmission(sub, expDate) {
  const link = sub.clan_profile_url;
  const bodyPart = submissionBodyHtmlPart(sub);
  return (
    `📣 <b>Reclutamento</b> (pubblicato dal bot)\n` +
    `⏳ <i>Fino a:</i> ${escapeHtml(expDate.toLocaleString('it-IT', { timeZone: 'UTC' }))} UTC\n` +
    `👤 <i>Presentato come:</i> ${escapeHtml(sub.submitter_display)}\n\n` +
    bodyPart +
    `\n\n🔗 <a href="${escapeHtml(link)}">Apri profilo clan (CoC)</a>`
  );
}

async function broadcastRecruitmentDelivers(telegram, postText, photoFileId) {
  const userIds = await sbc.listRecruitmentFeedUserIds();
  const delivered = [];
  const singlePhoto = Boolean(photoFileId && postText.length <= TG_CAPTION_HTML_MAX);
  for (const chatId of userIds) {
    try {
      if (singlePhoto) {
        const m = await telegram.sendPhoto(chatId, photoFileId, {
          caption: postText,
          parse_mode: 'HTML',
        });
        if (m?.message_id) delivered.push({ chat_id: chatId, message_id: m.message_id });
      } else if (photoFileId) {
        const m1 = await telegram.sendMessage(chatId, postText, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        });
        if (m1?.message_id) delivered.push({ chat_id: chatId, message_id: m1.message_id });
        const m2 = await telegram.sendPhoto(chatId, photoFileId, {
          caption: '📣 Immagine allegata all’annuncio di reclutamento.',
        });
        if (m2?.message_id) delivered.push({ chat_id: chatId, message_id: m2.message_id });
      } else {
        const msg = await telegram.sendMessage(chatId, postText, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        });
        if (msg?.message_id) delivered.push({ chat_id: chatId, message_id: msg.message_id });
      }
    } catch (_) {}
    await sleep(35);
  }
  return delivered;
}

async function sendOneActivePostToChat(telegram, chatId, row, ownerDeleteKb) {
  const extra = ownerDeleteKb ? { reply_markup: ownerDeleteKb.reply_markup } : {};
  const text = row.post_text || '';
  try {
    if (row.photo_file_id) {
      if (text.length <= TG_CAPTION_HTML_MAX) {
        await telegram.sendPhoto(chatId, row.photo_file_id, {
          caption: text,
          parse_mode: 'HTML',
          ...extra,
        });
        return;
      }
      const m1 = await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        ...extra,
      });
      await telegram.sendPhoto(chatId, row.photo_file_id, {
        caption: '📣 Immagine allegata all’annuncio.',
      });
      return { m1 };
    }
    await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...extra,
    });
  } catch (e) {
    await telegram
      .sendMessage(chatId, `⚠️ Annuncio #${row.id}: errore invio (${escapeHtml(String(e.message || '')).slice(0, 80)}).`, {
        parse_mode: 'HTML',
      })
      .catch(() => {});
  }
  return null;
}

function globalHubKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚪 Esci', 'comm_global_leave'),
      Markup.button.callback('🔄 Aggiorna', 'comm_global_status'),
    ],
    [Markup.button.callback('« Menù', 'menu'), Markup.button.callback('« Community', 'comm_hub')],
  ]);
}

async function buildGlobalHubBodyHtml(subscriberRow) {
  await sbc.tickGlobalEpochIfNeeded().catch(() => {});
  const epoch = cv.currentEpochIndex();
  const n = await sbc.countActiveGlobalSubscribers(epoch);
  const ms = cv.msUntilNextEpochBoundary();
  const cd = cv.formatCountdownIt(ms);
  const sub = subscriberRow;
  const tagPart = sub.display_tag ? ` <code>${escapeHtml(sub.display_tag)}</code>` : '';
  return (
    `🌍 <b>Chat globale</b> <i>(finestra UTC)</i>\n\n` +
    `Nome mostrato: <b>${escapeHtml(sub.display_name)}</b>${tagPart}\n\n` +
    `👥 <b>${n}</b> in stanza\n` +
    `⏱ Azzeramento tra <b>${escapeHtml(cd)}</b> (UTC)\n\n` +
    `<i>I messaggi di questa finestra vengono rimossi al reset. Solo testo. Il countdown si aggiorna con <b>Aggiorna</b> o quando invii un messaggio.</i>`
  );
}

function globalHubEditErrorKind(e) {
  const msg = String(e?.response?.description || e?.description || e?.message || '');
  if (/message is not modified/i.test(msg)) return 'unchanged';
  if (/message to edit not found|message can't be edited|chat not found/i.test(msg)) return 'gone';
  return 'other';
}

/**
 * @param {{ allowCreate?: boolean }} opts allowCreate=true solo da ingresso / pulsante Aggiorna (mai in background).
 */
async function ensureGlobalHubMessage(telegram, telegramUserId, opts = {}) {
  const allowCreate = opts.allowCreate === true;
  const sub = await sbc.getGlobalSubscriber(telegramUserId);
  if (!sub || !sub.active) return;
  const curE = cv.currentEpochIndex();
  if (Number(sub.epoch_index) !== curE) return;
  const text = await buildGlobalHubBodyHtml(sub);
  const kb = globalHubKeyboard();
  const chatId = telegramUserId;
  const extra = { parse_mode: 'HTML', reply_markup: kb.reply_markup };
  const mid = sub.hub_message_id != null ? Number(sub.hub_message_id) : null;

  if (mid) {
    try {
      await telegram.editMessageText(chatId, mid, undefined, text, extra);
      if (Number(sub.hub_epoch_index) !== curE) {
        try {
          await sbc.setGlobalSubscriberHub(telegramUserId, mid, curE);
        } catch (err) {
          console.warn('[cocboard-bot] global hub setHub dopo edit:', err.message || err);
        }
      }
      return;
    } catch (e) {
      const kind = globalHubEditErrorKind(e);
      if (kind === 'unchanged') return;
      if (kind === 'gone') {
        await sbc.clearGlobalSubscriberHub(telegramUserId).catch(() => {});
      } else {
        console.warn('[cocboard-bot] global hub editMessageText:', e?.response?.description || e.message || e);
      }
      if (!allowCreate) return;
    }
  }

  if (!allowCreate) return;

  try {
    const msg = await telegram.sendMessage(chatId, text, extra);
    if (msg?.message_id) {
      try {
        await sbc.setGlobalSubscriberHub(telegramUserId, msg.message_id, curE);
      } catch (err) {
        console.warn('[cocboard-bot] global hub setHub dopo send:', err.message || err);
      }
    }
  } catch (e) {
    console.warn('[cocboard-bot] global hub sendMessage:', e.message || e);
  }
}

async function refreshGlobalHubForUser(telegram, telegramUserId) {
  await ensureGlobalHubMessage(telegram, telegramUserId, { allowCreate: true });
}

/** Dopo tick epoch: cancella su Telegram le bolle della finestra precedente e hub obsoleti. */
async function purgeGlobalWindowTelegramMessages(telegram) {
  const cur = cv.currentEpochIndex();
  let rows = [];
  try {
    rows = await sbc.consumeGlobalEphemeralDeliveriesBeforeEpoch(cur);
  } catch (_) {
    rows = [];
  }
  for (const r of rows) {
    if (r.chat_id != null && r.message_id != null) {
      try {
        await telegram.deleteMessage(r.chat_id, r.message_id);
      } catch (_) {}
      await sleep(25);
    }
  }
}

async function sendGlobalEnteredMessage(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  try {
    await ctx.editMessageText('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' });
  } catch (_) {
    await ctx.reply('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' }).catch(() => {});
  }
  await ensureGlobalHubMessage(ctx.telegram, uid, { allowCreate: true });
}

async function submitRecruitmentToModerators(ctx, { bodyText, bodyHtml, photoFileId, uid, subLabel }) {
  const v = cv.recruitmentTextValid(bodyText);
  if (!v.ok) {
    await ctx.reply(`❌ ${v.reason}`, { parse_mode: 'HTML' });
    return false;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const n = await sbc.countSubmissionsSince(uid, since);
  if (n >= 5) {
    await ctx.reply('❌ Troppi invii nelle ultime 24h. Riprova più tardi.');
    return false;
  }
  const htmlStore =
    bodyHtml && String(bodyHtml).trim() ? bodyHtml : tgh.messageEntitiesToHtml(bodyText, []);
  let sid;
  try {
    sid = await sbc.insertRecruitmentSubmission(uid, subLabel, bodyText, v.link, photoFileId, htmlStore);
  } catch (e) {
    await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
    return false;
  }
  const owners = cv.parseOwnerTelegramIds();
  if (!owners.length) {
    await ctx.reply(
      '⚠️ Bozza salvata ma <b>nessun owner</b> configurato (<code>BOT_OWNER_TELEGRAM_IDS</code>). Nessuno potrà approvare.',
      { parse_mode: 'HTML', ...recruitBackKb() }
    );
    return true;
  }
  const previewPart =
    htmlStore.length > 1200 ? `${htmlStore.slice(0, 1197)}…` : htmlStore;
  const modKb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Approva', `rva:${sid}`), Markup.button.callback('❌ Rifiuta', `rvr:${sid}`)],
  ]);
  for (const oid of owners) {
    await ctx.telegram
      .sendMessage(
        oid,
        `📋 <b>Reclutamento</b> bozza <code>#${sid}</code>\n` +
          `Da: ${escapeHtml(subLabel)}\n\n` +
          `${previewPart}\n\n` +
          `<b>Link estratto:</b>\n<code>${escapeHtml(v.link)}</code>`,
        { parse_mode: 'HTML', ...modKb }
      )
      .catch(() => {});
  }
  await ctx.reply(
    '✅ Bozza inviata in moderazione. Se approvata, il bot pubblicherà il messaggio nel feed (24h).',
    { parse_mode: 'HTML', ...recruitBackKb() }
  );
  return true;
}

function recruitHubKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Annunci attivi', 'comm_recruit_list'), Markup.button.callback('✉️ Invia annuncio', 'comm_recruit_send')],
    [Markup.button.callback('« Community', 'comm_hub')],
  ]);
}

function recruitSendKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Invia subito (un messaggio)', 'comm_recruit_quick')],
    [Markup.button.callback('📝 Invia annuncio guidato', 'comm_recruit_guided')],
    [Markup.button.callback('« Indietro', 'comm_recruit')],
  ]);
}

function recruitBackKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Community', 'comm_hub')]]);
}

function guidedPreviewKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Conferma e invia in revisione', 'recg_confirm')],
    [Markup.button.callback('❌ Annulla', 'recg_cancel'), Markup.button.callback('🏠 Torna alla Community', 'comm_hub')],
  ]);
}

function buildGuidedDraftPlain(st) {
  const raw = String(st.clan_tag_raw || '').replace(/^#/, '').toUpperCase();
  const tagHash = `#${raw}`;
  const link = st.clan_link || cv.buildOfficialClanLinkFromTag(raw);
  return `${st.presentation.trim()}\n\n🏷 Tag clan: ${tagHash}\n🔗 ${link}`;
}

function buildGuidedDraftHtml(st) {
  const raw = String(st.clan_tag_raw || '').replace(/^#/, '').toUpperCase();
  const tagHash = `#${raw}`;
  const link = st.clan_link || cv.buildOfficialClanLinkFromTag(raw);
  const pres = st.presentation_html || escapeHtml(st.presentation);
  return (
    `${pres}\n\n🏷 Tag clan: <code>${escapeHtml(tagHash)}</code>\n` +
    `🔗 <a href="${escapeHtml(link)}">Apri link clan (CoC)</a>`
  );
}

function formatGuidedPreviewHtml(st) {
  const raw = String(st.clan_tag_raw || '').replace(/^#/, '').toUpperCase();
  const tagHash = `#${raw}`;
  const link = st.clan_link || cv.buildOfficialClanLinkFromTag(raw);
  const pres = st.presentation_html || escapeHtml(st.presentation);
  return (
    `📎 <b>Anteprima bozza</b>\n\n` +
    `${pres}\n\n` +
    `🏷 <code>${escapeHtml(tagHash)}</code>\n` +
    `🔗 <a href="${escapeHtml(link)}">Apri link clan (CoC)</a>` +
    `${st.photo_file_id ? '\n\n📷 <i>Con immagine allegata</i>' : ''}`
  );
}

async function tryHandleEarlyMessage(ctx, pendingCommunity, { isLinkedChatContext, sendMainMenu, backMenuKb, tauth }) {
  const uid = ctx.from?.id;
  if (uid == null || ctx.chat?.type !== 'private' || isLinkedChatContext(ctx)) return false;

  const txt = (ctx.message?.text || '').trim();
  const low = txt.split(/\s+/)[0].toLowerCase();

  if (low === '/esci_chat_global' || low.startsWith('/esci_chat_global@')) {
    const subLeave = await sbc.getGlobalSubscriber(uid).catch(() => null);
    if (subLeave?.hub_message_id) {
      try {
        await ctx.telegram.deleteMessage(uid, subLeave.hub_message_id);
      } catch (_) {}
    }
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
    await ctx.reply('Bozza reclutamento annullata.', { parse_mode: 'HTML', ...recruitHubKb() });
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
      await ctx.reply('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' });
      await ensureGlobalHubMessage(ctx.telegram, uid, { allowCreate: true });
      return true;
    }

    if (st.kind === 'recruit_guided') {
      const sess = await tauth.getValidSession(uid);
      if (!sess) {
        pendingCommunity.delete(uid);
        return false;
      }
      if (st.step === 'tag') {
        if (!ctx.message?.text || txt.startsWith('/')) return true;
        const norm = cv.normClanTagForUrl(txt);
        if (!norm) {
          await ctx.reply('Tag non valido. Invia solo lettere e numeri (es. <code>#2J2VLPP9R</code>).', { parse_mode: 'HTML' });
          return true;
        }
        st.clan_tag_raw = norm;
        st.step = 'link';
        pendingCommunity.set(uid, st);
        await ctx.reply(
          `🔗 <b>Link clan (opzionale)</b>\n\n` +
            `Invia il link ufficiale CoC (<code>link.clashofclans.com</code> … <code>OpenClanProfile</code> …)\n` +
            `oppure premi <b>Salta</b> per usare il link generato dal tag.`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⏭ Salta — uso link dal tag', 'recg_skip_link')]]) }
        );
        return true;
      }
      if (st.step === 'link') {
        if (!ctx.message?.text || txt.startsWith('/')) return true;
        const link = cv.extractOfficialClanLink(txt) || (cv.isOfficialClanProfileLink(txt.trim()) ? txt.trim() : null);
        if (!link || !cv.isOfficialClanProfileLink(link)) {
          await ctx.reply('Link non valido. Usa il formato ufficiale CoC oppure /annulla_reclutamento.', { parse_mode: 'HTML' });
          return true;
        }
        st.clan_link = link;
        st.step = 'body';
        pendingCommunity.set(uid, st);
        await ctx.reply('📝 Invia il <b>messaggio di presentazione</b> del clan (testo libero).', { parse_mode: 'HTML' });
        return true;
      }
      if (st.step === 'body') {
        if (!ctx.message?.text || txt.startsWith('/')) return true;
        if (txt.length < 8) {
          await ctx.reply('Testo troppo corto.');
          return true;
        }
        st.presentation = txt.slice(0, 3000);
        st.presentation_html = tgh.messageEntitiesToHtml(txt, ctx.message.entities || []);
        st.step = 'media';
        pendingCommunity.set(uid, st);
        await ctx.reply(
          '📷 Invia una <b>immagine</b> (opzionale) oppure salta.',
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⏭ Salta — nessuna immagine', 'recg_skip_media')]]) }
        );
        return true;
      }
      if (st.step === 'media') {
        if (ctx.message?.photo?.length) {
          st.photo_file_id = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else {
          await ctx.reply('Invia una foto o premi «Salta — nessuna immagine».');
          return true;
        }
        st.step = 'preview';
        pendingCommunity.set(uid, st);
        await ctx.reply(formatGuidedPreviewHtml(st), { parse_mode: 'HTML', ...guidedPreviewKb() });
        return true;
      }
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
      pendingCommunity.delete(uid);
      const sess = await tauth.getValidSession(uid);
      const disp = sess?.user ? displayFromUser(sess.user) : { name: 'Utente', tag: '' };
      const subLabel = disp.tag ? `${disp.name} (${disp.tag})` : disp.name;
      let bodyHtml;
      if (ctx.message.photo) {
        bodyHtml = tgh.messageEntitiesToHtml(bodyText, ctx.message.caption_entities || []);
      } else {
        bodyHtml = tgh.messageToHtml(ctx.message);
      }
      await submitRecruitmentToModerators(ctx, { bodyText, bodyHtml, photoFileId, uid, subLabel });
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
        const tid = Number(t.telegram_user_id);
        try {
          const msg = await ctx.telegram.sendMessage(tid, line, { parse_mode: 'HTML', disable_web_page_preview: true });
          if (msg?.message_id) await sbc.insertGlobalEphemeralDelivery(tid, msg.message_id, inserted.epoch_index);
        } catch (_) {}
      }
      try {
        const okMsg = await ctx.reply('✅ Inviato.', { parse_mode: 'HTML' });
        if (okMsg?.message_id) await sbc.insertGlobalEphemeralDelivery(uid, okMsg.message_id, inserted.epoch_index);
      } catch (_) {}
      await ensureGlobalHubMessage(ctx.telegram, uid, { allowCreate: false }).catch(() => {});
      return true;
    }
  }

  return false;
}

function communityMenuKb(forTelegramUserId) {
  const rows = [
    [Markup.button.callback('🌍 Chat globale', 'comm_global')],
    [Markup.button.callback('📣 Reclutamento', 'comm_recruit')],
  ];
  if (forTelegramUserId != null && cv.isBotOwnerTelegramUser(forTelegramUserId)) {
    rows.push([Markup.button.callback('✅ Approva post', 'comm_owner_queue')]);
  }
  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

function ownerQueueBackKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Community', 'comm_hub')]]);
}

async function sendCommunityMenu(ctx) {
  const uid = ctx.from?.id;
  const text =
    `${escapeHtml('───')}\n💬 <b>Community CoCBoard</b>\n${escapeHtml('───')}\n\n` +
    `• <b>Chat globale</b> — messaggi effimeri (finestre di 5 minuti UTC, stesso reset per tutti).\n` +
    `• <b>Reclutamento</b> — annunci approvati dal proprietario del bot, visibili 24h nel feed.\n\n` +
    `<i>Richiede accesso. Nessuna chat diretta tra giocatori.</i>`;
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...communityMenuKb(uid) });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', ...communityMenuKb(uid) });
  }
}

function registerCommunityHandlers(bot, deps) {
  const { pendingCommunity, isLinkedChatContext, tauth, sendMainMenu, backMenuKb } = deps;

  bot.action('comm_hub', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    pendingCommunity.delete(uid);
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
      [Markup.button.callback('« Indietro — Community', 'comm_hub')],
    ]);
    const body =
      `🌍 <b>Chat globale</b>\n\n` +
      `Come vuoi essere mostrato agli altri? (solo nome + tag, niente username Telegram)\n\n` +
      `<i>Contatore partecipanti e countdown al reset sono disponibili dopo l’ingresso.</i>`;
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('comm_global_leave', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const subLeave = await sbc.getGlobalSubscriber(uid).catch(() => null);
    if (subLeave?.hub_message_id) {
      try {
        await ctx.telegram.deleteMessage(uid, subLeave.hub_message_id);
      } catch (_) {}
    }
    await sbc.deactivateGlobalSubscriber(uid);
    pendingCommunity.delete(uid);
    const sess = await tauth.getValidSession(uid);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await ctx.reply('👋 Uscito dalla chat globale.', { parse_mode: 'HTML' });
      await sendMainMenu(ctx);
    } else {
      await ctx.reply('Sessione non valida.', { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('comm_global_status', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (!active) {
      await ctx.answerCbQuery('Non sei in chat globale.').catch(() => {});
      return;
    }
    await refreshGlobalHubForUser(ctx.telegram, uid).catch(() => {});
    await ctx.answerCbQuery('Stanza aggiornata.').catch(() => {});
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
    await sendGlobalEnteredMessage(ctx);
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
        '✏️ Invia il <b>tag villaggio</b> (es. <code>#2ABC</code>).\n\n' +
          '<code>/esci_chat_global</code> oppure il pulsante «Esci» dopo l’ingresso.',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro — Chat globale', 'comm_global')]]) }
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
    pendingCommunity.delete(uid);
    const text =
      `📣 <b>Reclutamento</b>\n\n` +
      `Scegli una sezione:\n` +
      `• <b>Annunci attivi</b> — cosa è in circolazione ora (dal database).\n` +
      `• <b>Invia annuncio</b> — bozza da far approvare al proprietario del bot.`;
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...recruitHubKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...recruitHubKb() });
    }
  });

  bot.action('comm_recruit_list', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    try {
      const rows = await sbc.listActiveRecruitmentPosts(12);
      const introKb = Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit')]]);
      if (!rows.length) {
        const text = '📋 <b>Annunci attivi</b>\n\n<i>Nessun annuncio attivo al momento.</i>';
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...introKb }).catch(async () => {
          await ctx.reply(text, { parse_mode: 'HTML', ...introKb });
        });
        return;
      }
      await ctx
        .editMessageText(
          `📋 <b>Annunci attivi</b>\n\n<i>Seguono <b>${rows.length}</b> messaggi (uno per annuncio), con formattazione originale.</i>`,
          { parse_mode: 'HTML', ...introKb }
        )
        .catch(async () => {
          await ctx.reply(
            `📋 <b>Annunci attivi</b>\n\n<i>Seguono ${rows.length} messaggi.</i>`,
            { parse_mode: 'HTML', ...introKb }
          );
        });
      const chatId = ctx.chat.id;
      for (const row of rows) {
        const ownerKb =
          uid != null && cv.isBotOwnerTelegramUser(uid)
            ? Markup.inlineKeyboard([[Markup.button.callback('🗑 Rimuovi annuncio', `rad:${row.id}`)]])
            : null;
        await sendOneActivePostToChat(ctx.telegram, chatId, row, ownerKb);
        await sleep(45);
      }
    } catch (e) {
      await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...recruitHubKb() });
    }
  });

  bot.action('comm_owner_queue', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    if (!cv.isBotOwnerTelegramUser(ctx.from?.id)) {
      await ctx.answerCbQuery('Non autorizzato.').catch(() => {});
      return;
    }
    safeCb(ctx);
    try {
      const list = await sbc.listPendingRecruitmentSubmissions(20);
      const introKb = ownerQueueBackKb();
      if (!list.length) {
        const t = '✅ <b>Approva post</b>\n\n<i>Nessuna bozza in attesa.</i>';
        await ctx.editMessageText(t, { parse_mode: 'HTML', ...introKb }).catch(async () => {
          await ctx.reply(t, { parse_mode: 'HTML', ...introKb });
        });
        return;
      }
      await ctx
        .editMessageText(
          `✅ <b>Approva post</b>\n\n<i>${list.length} bozza/e in attesa. Dettagli nei messaggi seguenti.</i>`,
          { parse_mode: 'HTML', ...introKb }
        )
        .catch(async () => {
          await ctx.reply(
            `✅ <b>Approva post</b>\n\n<i>${list.length} bozza/e in attesa.</i>`,
            { parse_mode: 'HTML', ...introKb }
          );
        });
      const chatId = ctx.chat.id;
      for (const sub of list) {
        const part = submissionBodyHtmlPart(sub);
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approva', `rva:${sub.id}`), Markup.button.callback('❌ Rifiuta', `rvr:${sub.id}`)],
        ]);
        const head = `📋 Bozza <code>#${sub.id}</code>\nDa: ${escapeHtml(sub.submitter_display)}\n\n`;
        const tail = `\n\n🔗 <code>${escapeHtml(sub.clan_profile_url)}</code>`;
        const combined = `${head}${part}${tail}`;
        if (sub.photo_file_id && combined.length <= TG_CAPTION_HTML_MAX) {
          await ctx.telegram
            .sendPhoto(chatId, sub.photo_file_id, { caption: combined, parse_mode: 'HTML', ...kb })
            .catch(() => {});
        } else {
          await ctx.telegram
            .sendMessage(chatId, combined, { parse_mode: 'HTML', ...kb })
            .catch(() => {});
          if (sub.photo_file_id) {
            await ctx.telegram
              .sendPhoto(chatId, sub.photo_file_id, { caption: '📷 Allegato alla bozza.' })
              .catch(() => {});
          }
        }
        await sleep(45);
      }
    } catch (e) {
      await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...ownerQueueBackKb() });
    }
  });

  bot.action(/^rad:(\d+)$/, async (ctx) => {
    if (!cv.isBotOwnerTelegramUser(ctx.from?.id)) {
      await ctx.answerCbQuery('Non autorizzato.').catch(() => {});
      return;
    }
    safeCb(ctx);
    const postId = Number(ctx.match[1]);
    try {
      const row = await sbc.getRecruitmentPostById(postId);
      if (!row) {
        await ctx.answerCbQuery('Annuncio non trovato.').catch(() => {});
        return;
      }
      const ids = Array.isArray(row.delivered_message_ids) ? row.delivered_message_ids : [];
      for (const entry of ids) {
        if (entry?.chat_id != null && entry?.message_id != null) {
          try {
            await ctx.telegram.deleteMessage(entry.chat_id, entry.message_id);
          } catch (_) {}
          await sleep(30);
        }
      }
      await sbc.deleteRecruitmentPostRow(postId);
      await ctx.answerCbQuery('Rimosso').catch(() => {});
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (_) {}
      await ctx.reply(`🗑 Annuncio <code>#${postId}</code> rimosso dal feed.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('comm_recruit_send', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) return;
    pendingCommunity.delete(uid);
    const text =
      `✉️ <b>Invia annuncio</b>\n\n` +
      `• <b>Subito</b> — un solo messaggio (testo + link ufficiale clan; foto opzionale).\n` +
      `• <b>Guidato</b> — passaggi: tag → link (opz.) → presentazione → media (opz.) → anteprima → conferma.`;
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...recruitSendKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...recruitSendKb() });
    }
  });

  bot.action('comm_recruit_quick', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    pendingCommunity.set(uid, { kind: 'recruit_body' });
    const help =
      `⚡ <b>Invio rapido</b>\n\n` +
      `Invia <b>un messaggio</b> con:\n` +
      `• testo di presentazione\n` +
      `• link ufficiale:\n` +
      `  <code>https://link.clashofclans.com/xx?action=OpenClanProfile&amp;tag=...</code>\n\n` +
      `Opzionale: <b>foto</b> con didascalia che contenga il link.\n\n` +
      `<code>/annulla_reclutamento</code> · «Community» dal menù.`;
    try {
      await ctx.editMessageText(help, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit_send')]]),
      });
    } catch (_) {
      await ctx.reply(help, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit_send')]]),
      });
    }
  });

  bot.action('comm_recruit_guided', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    pendingCommunity.set(uid, { kind: 'recruit_guided', step: 'tag' });
    await ctx
      .editMessageText(
        `📝 <b>Annuncio guidato</b> — passo 1/4\n\n` +
          `Invia il <b>tag del clan</b> da promuovere (es. <code>#2J2VLPP9R</code>).`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit_send')]]) }
      )
      .catch(() => {});
  });

  bot.action('recg_skip_link', async (ctx) => {
    safeCb(ctx);
    const uid = ctx.from?.id;
    const st = uid != null ? pendingCommunity.get(uid) : null;
    if (!st || st.kind !== 'recruit_guided' || st.step !== 'link') {
      await ctx.answerCbQuery('Sessione scaduta.').catch(() => {});
      return;
    }
    st.clan_link = null;
    st.step = 'body';
    pendingCommunity.set(uid, st);
    await ctx.answerCbQuery('OK').catch(() => {});
    await ctx.reply('📝 Invia il <b>messaggio di presentazione</b> del clan.', { parse_mode: 'HTML' });
  });

  bot.action('recg_skip_media', async (ctx) => {
    safeCb(ctx);
    const uid = ctx.from?.id;
    const st = uid != null ? pendingCommunity.get(uid) : null;
    if (!st || st.kind !== 'recruit_guided' || st.step !== 'media') {
      await ctx.answerCbQuery('Sessione scaduta.').catch(() => {});
      return;
    }
    st.photo_file_id = null;
    st.step = 'preview';
    pendingCommunity.set(uid, st);
    await ctx.answerCbQuery('OK').catch(() => {});
    await ctx.reply(formatGuidedPreviewHtml(st), { parse_mode: 'HTML', ...guidedPreviewKb() });
  });

  bot.action('recg_confirm', async (ctx) => {
    safeCb(ctx);
    const uid = ctx.from?.id;
    const st = uid != null ? pendingCommunity.get(uid) : null;
    if (!st || st.kind !== 'recruit_guided' || st.step !== 'preview') {
      await ctx.answerCbQuery('Niente da confermare.').catch(() => {});
      return;
    }
    const bodyText = buildGuidedDraftPlain(st);
    const bodyHtml = buildGuidedDraftHtml(st);
    pendingCommunity.delete(uid);
    const sess = await tauth.getValidSession(uid);
    const disp = sess?.user ? displayFromUser(sess.user) : { name: 'Utente', tag: '' };
    const subLabel = disp.tag ? `${disp.name} (${disp.tag})` : disp.name;
    await submitRecruitmentToModerators(ctx, {
      bodyText,
      bodyHtml,
      photoFileId: st.photo_file_id,
      uid,
      subLabel,
    });
  });

  bot.action('recg_cancel', async (ctx) => {
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid != null) pendingCommunity.delete(uid);
    await ctx.answerCbQuery('Annullato').catch(() => {});
    await ctx.reply('Bozza guidata annullata.', { parse_mode: 'HTML', ...recruitSendKb() });
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
    const postText = buildApprovedPostTextFromSubmission(sub, exp);
    const delivered = await broadcastRecruitmentDelivers(ctx.telegram, postText, sub.photo_file_id);
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

module.exports = {
  tryHandleEarlyMessage,
  sendCommunityMenu,
  communityMenuKb,
  registerCommunityHandlers,
  displayFromUser,
  purgeGlobalWindowTelegramMessages,
};

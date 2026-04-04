'use strict';

const { Markup } = require('telegraf');
const sbc = require('./supabase-community');
const cv = require('./community-validation');

function displayFromUser(user) {
  const meta = user?.user_metadata || {};
  const tag = meta.coc_tag ? String(meta.coc_tag).trim() : '';
  const name = (meta.username || (user?.email || '').split('@')[0] || 'Comandante').trim();
  return { name: name.slice(0, 120), tag: tag ? (tag.startsWith('#') ? tag : `#${tag}`).slice(0, 32) : '' };
}

function formatGlobalLine(displayName, displayTag, body, statusFooterHtml) {
  const tagPart = displayTag ? ` <code>${escapeHtml(displayTag)}</code>` : '';
  const foot = statusFooterHtml ? `\n\n${statusFooterHtml}` : '';
  return `<b>${escapeHtml(displayName)}</b>${tagPart}\n${escapeHtml(body)}${foot}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function globalRoomInlineKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚪 Esci dalla chat → menù CoCBoard', 'comm_global_leave')],
    [Markup.button.callback('🔄 Stato stanza (utenti + countdown)', 'comm_global_status')],
  ]);
}

async function buildGlobalStatusFooterHtml() {
  await sbc.tickGlobalEpochIfNeeded().catch(() => {});
  const epoch = cv.currentEpochIndex();
  const n = await sbc.countActiveGlobalSubscribers(epoch);
  const ms = cv.msUntilNextEpochBoundary();
  const cd = cv.formatCountdownIt(ms);
  return `<i>👥 ${n} in stanza · ⏱ Azzeramento finestra tra ${escapeHtml(cd)} (UTC)</i>`;
}

async function sendGlobalEnteredMessage(ctx, introHtml) {
  const foot = await buildGlobalStatusFooterHtml();
  const text = `${introHtml}\n\n${foot}\n\n<i>Messaggi: solo testo. Usa i pulsanti sotto per uscire o aggiornare il conteggio.</i>`;
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...globalRoomInlineKb() });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', ...globalRoomInlineKb() });
  }
}

async function submitRecruitmentToModerators(ctx, { bodyText, photoFileId, uid, subLabel }) {
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
  let sid;
  try {
    sid = await sbc.insertRecruitmentSubmission(uid, subLabel, bodyText, v.link, photoFileId);
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

function buildGuidedDraftBody(st) {
  const raw = String(st.clan_tag_raw || '').replace(/^#/, '').toUpperCase();
  const tagHash = `#${raw}`;
  const link = st.clan_link || cv.buildOfficialClanLinkFromTag(raw);
  return `${st.presentation.trim()}\n\n🏷 Tag clan: ${tagHash}\n🔗 ${link}`;
}

function formatGuidedPreviewHtml(st) {
  const raw = String(st.clan_tag_raw || '').replace(/^#/, '').toUpperCase();
  const tagHash = `#${raw}`;
  const link = st.clan_link || cv.buildOfficialClanLinkFromTag(st.clan_tag_raw);
  return (
    `📎 <b>Anteprima bozza</b>\n\n` +
    `${escapeHtml(st.presentation)}\n\n` +
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
      const intro =
        `✅ Sei nella <b>chat globale</b>.\n\n` +
        `Nome mostrato: <b>${escapeHtml(displayName)}</b> <code>${escapeHtml(displayTag)}</code>\n\n` +
        `• Vedi solo messaggi inviati <b>dopo</b> il tuo ingresso in questa finestra.\n` +
        `• La finestra si azzera per <b>tutti</b> ogni 5 minuti (UTC).`;
      await ctx.reply(intro, { parse_mode: 'HTML', ...globalRoomInlineKb() });
      const foot = await buildGlobalStatusFooterHtml();
      await ctx.reply(foot, { parse_mode: 'HTML' });
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
      await submitRecruitmentToModerators(ctx, { bodyText, photoFileId, uid, subLabel });
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
      const foot = await buildGlobalStatusFooterHtml();
      const targets = await sbc.listGlobalBroadcastTargets(inserted.epoch_index, uid, inserted.created_at);
      const line = formatGlobalLine(sub.display_name, sub.display_tag || '', body, foot);
      for (const t of targets) {
        const tid = t.telegram_user_id;
        await ctx.telegram.sendMessage(tid, line, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
      }
      await ctx.reply(`✅ Inviato.\n\n${foot}`, { parse_mode: 'HTML', ...globalRoomInlineKb() });
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
    `• <b>Reclutamento</b> — annunci approvati dal proprietario del bot, visibili 24h nel feed.\n\n` +
    `<i>Richiede accesso. Nessuna chat diretta tra giocatori.</i>`;
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
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (!active) {
      await ctx.answerCbQuery('Non sei in chat globale.').catch(() => {});
      return;
    }
    const foot = await buildGlobalStatusFooterHtml();
    await ctx.reply(`📊 <b>Stato stanza</b>\n\n${foot}`, { parse_mode: 'HTML', ...globalRoomInlineKb() });
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
    const intro =
      `✅ Sei nella <b>chat globale</b>.\n\n` +
      `Nome mostrato: <b>${escapeHtml(name)}</b>${tag ? ` <code>${escapeHtml(tag)}</code>` : ''}\n\n` +
      `• Vedi solo messaggi dopo il tuo ingresso in questa finestra.\n` +
      `• Reset globale ogni 5 min (UTC).`;
    await sendGlobalEnteredMessage(ctx, intro);
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
    try {
      const rows = await sbc.listActiveRecruitmentPosts(8);
      let body;
      if (!rows.length) {
        body = '<i>Nessun annuncio attivo al momento (o scaduti).</i>';
      } else {
        const parts = rows.map((r, i) => {
          const plain = String(r.post_text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const snip = plain.length > 220 ? `${plain.slice(0, 217)}…` : plain;
          const until = new Date(r.expires_at).toLocaleString('it-IT', { timeZone: 'UTC' });
          return `<b>${i + 1}.</b> (fino ${escapeHtml(until)} UTC)\n${escapeHtml(snip)}`;
        });
        body = parts.join('\n\n');
      }
      const text = `📋 <b>Annunci attivi</b>\n\n${body}`;
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit')]]),
      }).catch(async () => {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit')]]),
        });
      });
    } catch (e) {
      await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...recruitHubKb() });
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
    const bodyText = buildGuidedDraftBody(st);
    pendingCommunity.delete(uid);
    const sess = await tauth.getValidSession(uid);
    const disp = sess?.user ? displayFromUser(sess.user) : { name: 'Utente', tag: '' };
    const subLabel = disp.tag ? `${disp.name} (${disp.tag})` : disp.name;
    await submitRecruitmentToModerators(ctx, {
      bodyText,
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

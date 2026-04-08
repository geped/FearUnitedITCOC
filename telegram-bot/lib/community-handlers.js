'use strict';

const { Markup } = require('telegraf');

/** Impostato da registerCommunityHandlers: aggiorna tastiera reply in chat privata. */
let refreshPrivateReplyKeyboardRef = async () => {};
const sbc = require('./supabase-community');
const cv = require('./community-validation');
const tgh = require('./telegram-html');
const privateUi = require('./private-ui-cleanup');

function displayFromUser(user) {
  const meta = user?.user_metadata || {};
  const tag = meta.coc_tag ? String(meta.coc_tag).trim() : '';
  const name = (meta.username || (user?.email || '').split('@')[0] || 'Comandante').trim();
  return { name: name.slice(0, 120), tag: tag ? (tag.startsWith('#') ? tag : `#${tag}`).slice(0, 32) : '' };
}

function guestTelegramLabel(from) {
  if (!from) return 'Ospite';
  if (from.username) return `@${String(from.username).slice(0, 100)}`;
  const n = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return (n || `id:${from.id}`).slice(0, 160);
}

/**
 * Intestazione + messaggio: una sola riga per nome, ✅, tag (link se verificato+condivisione), TH e XP; poi a capo il testo.
 */
function formatGlobalLine(displayName, displayTag, body, displayVerified, meta = {}) {
  const shareDetails = meta.shareVerifiedDetails === true;
  const th = meta.thLevel;
  const exp = meta.expLevel;
  const badge = displayVerified ? ' ✅' : '';
  const modBadge = meta.staffModerator === true ? ' 🛡' : '';
  const namePart = `<b>${escapeHtml(displayName)}</b>${badge}${modBadge}`;
  let tail = '';
  if (displayVerified && shareDetails) {
    const tagRaw = displayTag ? String(displayTag).trim() : '';
    const profUrl = tagRaw ? cv.buildOpenPlayerProfileUrl(tagRaw) : null;
    const tagHtml = tagRaw
      ? profUrl
        ? `<a href="${cv.escapeTelegramHtmlHref(profUrl)}">${escapeHtml(tagRaw)}</a>`
        : escapeHtml(tagRaw)
      : '—';
    const thPart = th != null && Number.isFinite(Number(th)) ? `TH${Number(th)}` : '—';
    const xpPart = exp != null && Number.isFinite(Number(exp)) ? `${Number(exp)} xp` : '— xp';
    tail = ` ${tagHtml} | ${escapeHtml(thPart)} | ${escapeHtml(xpPart)}`;
  } else if (!displayVerified && displayTag) {
    tail = ` <code>${escapeHtml(String(displayTag))}</code>`;
  }
  return `${namePart}${tail}\n${escapeHtml(body)}`;
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

/** @returns {Promise<number[]>} message_id inviati (per cleanup UI in privato) */
async function sendOneActivePostToChat(telegram, chatId, row, ownerDeleteKb) {
  const extra = ownerDeleteKb ? { reply_markup: ownerDeleteKb.reply_markup } : {};
  const text = row.post_text || '';
  const out = [];
  try {
    if (row.photo_file_id) {
      if (text.length <= TG_CAPTION_HTML_MAX) {
        const m = await telegram.sendPhoto(chatId, row.photo_file_id, {
          caption: text,
          parse_mode: 'HTML',
          ...extra,
        });
        if (m?.message_id) out.push(m.message_id);
        return out;
      }
      const m1 = await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        ...extra,
      });
      if (m1?.message_id) out.push(m1.message_id);
      const m2 = await telegram.sendPhoto(chatId, row.photo_file_id, {
        caption: '📣 Immagine allegata all’annuncio.',
      });
      if (m2?.message_id) out.push(m2.message_id);
      return out;
    }
    const m = await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...extra,
    });
    if (m?.message_id) out.push(m.message_id);
    return out;
  } catch (e) {
    try {
      const errM = await telegram.sendMessage(
        chatId,
        `⚠️ Annuncio #${row.id}: errore invio (${escapeHtml(String(e.message || '')).slice(0, 80)}).`,
        { parse_mode: 'HTML' }
      );
      if (errM?.message_id) out.push(errM.message_id);
    } catch (_) {}
  }
  return out;
}

function globalHubKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚪 Esci', 'comm_global_leave'),
      Markup.button.callback('🔄 Aggiorna', 'comm_global_status'),
    ],
    [Markup.button.callback('⚙️ Modifica modalità accesso', 'comm_global_mode')],
    [Markup.button.callback('🚩 Segnala messaggio', 'comm_global_report')],
    [Markup.button.callback('« Menù', 'menu'), Markup.button.callback('« Community', 'comm_hub')],
  ]);
}

async function renderGlobalAccessModeMenu(ctx, tauth, opts = {}) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  const sess = await tauth.getValidSession(uid);
  if (sess) ctx.cocboardUser = sess.user;
  const sub = await sbc.getGlobalSubscriber(uid).catch(() => null);
  const hasLast = Boolean(sub && sub.display_name);
  const lastVerified = sub?.display_verified === true || sub?.display_verified === 'true';
  const rows = [];
  if (hasLast) rows.push([Markup.button.callback('⚡ Entra con ultima modalità', 'comm_global_quick')]);
  rows.push([
    sess
      ? Markup.button.callback('👤 Nome da profilo CoCBoard', 'comm_gprof')
      : Markup.button.callback('👤 Nome da profilo (Accedi / Registrati)', 'comm_gauth'),
  ]);
  rows.push([Markup.button.callback('✏️ Nome in gioco + tag (testo)', 'comm_gman')]);
  rows.push([Markup.button.callback('« Indietro — Community', opts.backToHub ? 'comm_hub' : 'comm_global')]);
  const kb = Markup.inlineKeyboard(rows);
  const lastLine = hasLast
    ? `\n\nUltima modalità salvata: <b>${lastVerified ? 'Profilo CoCBoard' : 'Nome+tag manuale'}</b>.`
    : '';
  const body =
    `🌍 <b>Chat globale</b>\n\n` +
    `Scegli come entrare in stanza:` +
    `\n• <b>Profilo CoCBoard</b> — accesso verificato ✅ (con o senza dettagli tag/TH/XP).` +
    `\n• <b>Nome+tag manuale</b> — formato <code>nomeInGioco#TAG</code> (solo testo, <b>nessuna</b> emoticon).` +
    `\n\n<i>La scelta viene ricordata per i prossimi accessi e puoi cambiarla da "Modifica modalità accesso".</i>` +
    lastLine;
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  }
  await refreshPrivateReplyKeyboardRef(ctx);
}

async function buildGlobalHubBodyHtml(subscriberRow) {
  await sbc.tickGlobalEpochIfNeeded().catch(() => {});
  const epoch = cv.currentEpochIndex();
  const n = await sbc.countActiveGlobalSubscribers(epoch);
  const sub = subscriberRow;
  const tagPart = sub.display_tag ? ` <code>${escapeHtml(sub.display_tag)}</code>` : '';
  const verified = sub.display_verified === true || sub.display_verified === 'true';
  const share = verified && sub.share_verified_details !== false && sub.share_verified_details !== 'false';
  const verifiedLine = verified
    ? share
      ? '\n✅ <i>Profilo CoCBoard — in chat: stessa riga con tag (link profilo), TH ed XP se disponibili.</i>'
      : '\n✅ <i>Profilo CoCBoard — in chat solo nome e spunta (dettagli nascosti).</i>'
    : '\n<i>Ospite: in chat nome e tag su una riga (non verificato; non usare ✅ nel nome).</i>';
  return (
    `🌍 <b>Chat globale</b>\n\n` +
    `🟢 <b>Modalità attiva:</b> <i>Chat globale</i>\n\n` +
    `Nome mostrato: <b>${escapeHtml(sub.display_name)}</b>${tagPart}${verifiedLine}\n\n` +
    `👥 <b>${n}</b> in stanza\n\n` +
    `<i>Solo chi è in stanza riceve i messaggi. La sessione si aggiorna in automatico. Invia solo testo. Usa <b>Aggiorna</b> per aggiornare il contatore.</i>`
  );
}

/** Formato: <code>nomeInGioco#XXXXXXXXX</code> — parte tag = <code>#</code> + 9 caratteri (10 in tutto). Solo formalità, nessuna verifica API CoC. Nessuna emoticon nel nome. */
function parseGlobalManualDisplayLine(raw) {
  const t = String(raw || '').trim();
  if (cv.containsEmojiOrPictograph(t)) {
    return {
      ok: false,
      reason:
        'Non sono ammesse <b>emoticon</b> o simboli tipo scudo/emoji (es. 🛡). ' +
        'Usa solo <b>testo</b> come in gioco, formato <code>nome#TAG</code> (es. <code>GIOCATORE#2J2VLPP9R</code>).',
    };
  }
  if (cv.containsFakeVerificationMarker(t)) {
    return {
      ok: false,
      reason:
        'Non usare simboli tipo ✅ nel nome: imitano la verifica riservata ai profili CoCBoard. ' +
        'Inserisci solo il <b>nome in gioco</b> e il <b>tag</b> nel formato <code>nome#TAG</code>.',
    };
  }
  const hashIdx = t.indexOf('#');
  if (hashIdx < 1) {
    return {
      ok: false,
      reason:
        'Formato: <code>nomeInGioco#TAG</code> (es. <code>GIOCATORE#2J2VLPP9R</code>). Dopo il <code>#</code> servono <b>9</b> caratteri → il tag è <b>10</b> caratteri in tutto (incluso <code>#</code>).',
    };
  }
  const displayName = t.slice(0, hashIdx).trim();
  const tagPart = t.slice(hashIdx).replace(/\s+/g, '').toUpperCase();
  if (!displayName) {
    return { ok: false, reason: 'Inserisci il nome prima del <code>#</code>.' };
  }
  if (cv.containsFakeVerificationMarker(displayName)) {
    return {
      ok: false,
      reason:
        'Nel nome non sono ammessi simboli di “verificato” (✅ ecc.). Usa il nome pulito come in gioco.',
    };
  }
  if (!/^#[0-9A-Z]{9}$/.test(tagPart)) {
    return {
      ok: false,
      reason:
        'Il tag deve iniziare con <code>#</code> ed essere lungo <b>10</b> caratteri in tutto (es. <code>#2J2VLPP9R</code>). Non verifichiamo il villaggio in gioco.',
    };
  }
  return { ok: true, displayName: displayName.slice(0, 120), displayTag: tagPart };
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
  let sub = opts.subscriberOverride;
  if (!sub) {
    sub = await sbc.getGlobalSubscriber(telegramUserId);
  }
  if (!sub || !sub.active) {
    if (!opts.subscriberOverride) {
      await sleep(80);
      sub = await sbc.getGlobalSubscriber(telegramUserId);
    }
    if (!sub || !sub.active) return;
  }
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

async function sendGlobalEnteredMessage(ctx, opts = {}) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  try {
    await ctx.editMessageText('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' });
  } catch (_) {
    await ctx.reply('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' }).catch(() => {});
  }
  await ensureGlobalHubMessage(ctx.telegram, uid, {
    allowCreate: true,
    subscriberOverride: opts.subscriberOverride,
  });
  await refreshPrivateReplyKeyboardRef(ctx);
}

async function promptGlobalProfileShareChoice(ctx, tauth) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  const sess = await tauth.getValidSession(uid);
  if (!sess) {
    await ctx
      .reply('Sessione non attiva. Usa <b>Accedi</b> dal menù e riprova.', { parse_mode: 'HTML' })
      .catch(() => {});
    return;
  }
  ctx.cocboardUser = sess.user;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Sì: tag, TH ed XP in chat', 'comm_gprof_sf')],
    [Markup.button.callback('🔒 No: solo nome e spunta ✅', 'comm_gprof_sm')],
    [Markup.button.callback('« Indietro — Chat globale', 'comm_global')],
  ]);
  const body =
    `👤 <b>Profilo CoCBoard</b>\n\n` +
    `Come vuoi apparire agli altri in <b>chat globale</b>?\n\n` +
    `• <b>Sì</b> — sulla <b>stessa riga</b> del nome: tag (link al profilo in gioco), TH ed esperienza ` +
    `(se noti nel database membri).\n` +
    `• <b>No</b> — solo <b>nome</b> e spunta ✅, senza tag/TH/XP.`;
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb }).catch(() => {});
  }
  await refreshPrivateReplyKeyboardRef(ctx);
}

async function finalizeJoinGlobalVerified(ctx, tauth, shareGameDetails) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  const mod = await sbc.getGlobalModerationRow(uid);
  const bl = sbc.globalModerationBlocked(mod);
  if (bl.blocked && bl.kind === 'banned') {
    await ctx
      .reply(
        '🚫 Non puoi entrare in <b>chat globale</b>: account segnalato per violazioni ripetute delle regole.',
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    return;
  }
  const sess = await tauth.getValidSession(uid);
  if (!sess) {
    await ctx
      .reply('Sessione non attiva. Usa <b>Accedi</b> dal menù e riprova.', { parse_mode: 'HTML' })
      .catch(() => {});
    return;
  }
  ctx.cocboardUser = sess.user;
  const { name, tag } = displayFromUser(sess.user);
  let th = null;
  let exp = null;
  if (shareGameDetails && tag) {
    const m = await sbc.getMemberThExpByPlayerTag(tag).catch(() => null);
    if (m) {
      th = m.th_level ?? null;
      exp = m.exp_level ?? null;
    }
  }
  await sbc.tickGlobalEpochIfNeeded().catch(() => {});
  await sbc.upsertGlobalSubscriber(uid, name, tag || null, {
    displayVerified: true,
    shareVerifiedDetails: shareGameDetails,
    cachedThLevel: th,
    cachedExpLevel: exp,
  });
  let subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
  if (!subFresh?.active) {
    await sleep(80);
    subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
  }
  await sendGlobalEnteredMessage(ctx, { subscriberOverride: subFresh || undefined });
}

async function joinGlobalAsCocboardProfile(ctx, tauth) {
  await promptGlobalProfileShareChoice(ctx, tauth);
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
  await ctx.reply(
    '✅ Bozza inviata correttamente. Se approvata, l’annuncio resta pubblicato per <b>24h</b> in <b>Annunci attivi</b>.',
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

async function tryHandleEarlyMessage(
  ctx,
  pendingCommunity,
  { isLinkedChatContext, sendMainMenu, sendGuestMenu, backMenuKb, tauth, createGlobalReport }
) {
  const rk = refreshPrivateReplyKeyboardRef;
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
    await privateUi.purgeGlobalEphemeralOnly(ctx.telegram, uid).catch(() => {});
    await sbc.deactivateGlobalSubscriber(uid);
    pendingCommunity.delete(uid);
    await ctx.reply('👋 Hai lasciato la <b>chat globale</b>.', { parse_mode: 'HTML' });
    const sess = await tauth.getValidSession(uid);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    } else if (typeof sendGuestMenu === 'function') {
      await sendGuestMenu(ctx);
    }
    return true;
  }

  if (low === '/annulla_reclutamento' || low.startsWith('/annulla_reclutamento@')) {
    pendingCommunity.delete(uid);
    await ctx.reply('Bozza reclutamento annullata.', { parse_mode: 'HTML', ...recruitHubKb() });
    await rk(ctx);
    return true;
  }

  if (pendingCommunity.has(uid)) {
    const st = pendingCommunity.get(uid);
    if (st.kind === 'global_manual_tag') {
      if (ctx.message?.photo) {
        await ctx.reply(
          'Per entrare invia <b>solo testo</b> su una riga: <code>nomeInGioco#TAG</code> (nessuna emoticon).',
          { parse_mode: 'HTML' }
        );
        return true;
      }
      if (!ctx.message?.text || txt.startsWith('/')) return true;
      pendingCommunity.delete(uid);
      const parsed = parseGlobalManualDisplayLine(txt);
      if (!parsed.ok) {
        await ctx.reply(`❌ ${parsed.reason}`, { parse_mode: 'HTML' });
        pendingCommunity.set(uid, { kind: 'global_manual_tag' });
        return true;
      }
      try {
        await sbc.tickGlobalEpochIfNeeded().catch(() => {});
        await sbc.upsertGlobalSubscriber(uid, parsed.displayName, parsed.displayTag, { displayVerified: false });
      } catch (e) {
        pendingCommunity.set(uid, { kind: 'global_manual_tag' });
        await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        return true;
      }
      let subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
      if (!subFresh?.active) {
        await sleep(80);
        subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
      }
      await ctx.reply('✅ <b>Chat globale</b> — sei dentro.', { parse_mode: 'HTML' });
      await ensureGlobalHubMessage(ctx.telegram, uid, { allowCreate: true, subscriberOverride: subFresh || undefined });
      await rk(ctx);
      return true;
    }

    if (st.kind === 'global_report') {
      if (!ctx.message?.text || txt.startsWith('/')) return true;
      const reason = txt.slice(0, 400).trim();
      if (!reason) {
        await ctx.reply('Inserisci una motivazione breve per la segnalazione.');
        return true;
      }
      const replied = ctx.message.reply_to_message;
      if (!replied || !String(replied.text || replied.caption || '').trim()) {
        await ctx.reply(
          'Per segnalare, rispondi a un messaggio della chat globale e scrivi il motivo (es. "spam ripetuto").'
        );
        return true;
      }
      pendingCommunity.delete(uid);
      const reporter = await sbc.getGlobalSubscriber(uid).catch(() => null);
      const reporterName = reporter?.display_name || guestTelegramLabel(ctx.from);
      const reportedText = String(replied.text || replied.caption || '').slice(0, 1200);
      try {
        if (typeof createGlobalReport === 'function') {
          await createGlobalReport({
            reporterTelegramUserId: uid,
            reporterDisplayName: reporterName,
            reporterDisplayTag: reporter?.display_tag || null,
            reason,
            reportedMessageText: reportedText,
          });
        }
      } catch (e) {
        await ctx
          .reply(`❌ Impossibile registrare la segnalazione: ${escapeHtml(String(e.message || 'errore'))}`, {
            parse_mode: 'HTML',
          })
          .catch(() => {});
        await refreshPrivateReplyKeyboardRef(ctx);
        return true;
      }
      await ctx.reply('✅ Segnalazione registrata in /adminbot > Segnalazioni chat globale.', {
        parse_mode: 'HTML',
        ...globalHubKeyboard(),
      });
      await refreshPrivateReplyKeyboardRef(ctx);
      return true;
    }

    if (st.kind === 'recruit_guided') {
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
      const disp = sess?.user ? displayFromUser(sess.user) : null;
      const subLabel = disp
        ? disp.tag
          ? `${disp.name} (${disp.tag})`
          : disp.name
        : guestTelegramLabel(ctx.from);
      let bodyHtml;
      if (ctx.message.photo) {
        bodyHtml = tgh.messageEntitiesToHtml(bodyText, ctx.message.caption_entities || []);
      } else {
        bodyHtml = tgh.messageToHtml(ctx.message);
      }
      await submitRecruitmentToModerators(ctx, { bodyText, bodyHtml, photoFileId, uid, subLabel });
      await rk(ctx);
      return true;
    }
  }

  if (ctx.message && !txt.startsWith('/')) {
    const ag = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (ag && ctx.message.photo) {
      await ctx.reply('In chat globale invia solo testo.');
      return true;
    }
  }

  if (ctx.message && !txt.startsWith('/') && !ctx.message.photo) {
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (active) {
      const modRow = await sbc.getGlobalModerationRow(uid).catch(() => null);
      const bl = sbc.globalModerationBlocked(modRow);
      if (bl.blocked) {
        if (bl.kind === 'banned') {
          await ctx.reply('🚫 Sei <b>bannato</b> dalla chat globale.', { parse_mode: 'HTML' });
        } else if (bl.until) {
          await ctx.reply(
            `🔇 Sei in <b>mute</b> fino a ${escapeHtml(
              new Date(bl.until).toLocaleString('it-IT', { timeZone: 'UTC' })
            )} UTC.`,
            { parse_mode: 'HTML' }
          );
        } else {
          await ctx.reply('🔇 Non puoi scrivere in chat globale in questo momento.', { parse_mode: 'HTML' });
        }
        return true;
      }
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
      const verified = sub.display_verified === true || sub.display_verified === 'true';
      const share = verified && sub.share_verified_details !== false && sub.share_verified_details !== 'false';
      if (!verified && cv.containsFakeVerificationMarker(body)) {
        const warn = await sbc.recordGlobalChatViolation(uid);
        await ctx.reply(warn, { parse_mode: 'HTML' });
        return true;
      }
      const rules = cv.validateGlobalChatMessageBody(body);
      if (!rules.ok) {
        const warn = await sbc.recordGlobalChatViolation(uid);
        await ctx.reply(`${warn}\n\n❌ ${rules.reason}`, { parse_mode: 'HTML' });
        return true;
      }
      const rate = cv.checkGlobalChatRateLimit(uid);
      if (!rate.ok) {
        const warn = await sbc.recordGlobalChatViolation(uid);
        await ctx.reply(`${warn}\n\n❌ ${rate.reason}`, { parse_mode: 'HTML' });
        return true;
      }
      const label = sub.display_tag ? `${sub.display_name} ${sub.display_tag}` : sub.display_name;
      let inserted;
      try {
        inserted = await sbc.insertGlobalMessage(uid, label, body);
      } catch (e) {
        await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        return true;
      }
      try {
        if (ctx.message?.message_id != null) {
          await sbc.insertGlobalEphemeralDelivery(uid, ctx.message.message_id, inserted.epoch_index);
        }
      } catch (_) {}
      let th = sub.cached_th_level ?? null;
      let exp = sub.cached_exp_level ?? null;
      if (share && sub.display_tag) {
        const m = await sbc.getMemberThExpByPlayerTag(sub.display_tag).catch(() => null);
        if (m) {
          th = m.th_level ?? th;
          exp = m.exp_level ?? exp;
        }
      }
      const staffMod = await sbc.isTelegramStaffModerator(uid).catch(() => false);
      const line = formatGlobalLine(sub.display_name, sub.display_tag || '', body, verified, {
        shareVerifiedDetails: share,
        thLevel: th,
        expLevel: exp,
        staffModerator: staffMod,
      });
      const targets = await sbc.listGlobalBroadcastTargets(inserted.epoch_index, uid, inserted.created_at);
      for (const t of targets) {
        const tid = Number(t.telegram_user_id);
        try {
          const msg = await ctx.telegram.sendMessage(tid, line, { parse_mode: 'HTML', disable_web_page_preview: true });
          if (msg?.message_id) await sbc.insertGlobalEphemeralDelivery(tid, msg.message_id, inserted.epoch_index);
        } catch (e) {
          console.warn('[cocboard-bot] global broadcast sendMessage:', tid, e?.response?.description || e.message || e);
        }
      }
      await ensureGlobalHubMessage(ctx.telegram, uid, { allowCreate: false }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function communityMenuKb(forTelegramUserId) {
  const rows = [
    [Markup.button.callback('🌍 Chat globale', 'comm_global')],
    [Markup.button.callback('📣 Reclutamento', 'comm_recruit')],
  ];
  if (forTelegramUserId != null && cv.isBotOwnerTelegramUser(forTelegramUserId)) {
    let n = 0;
    try {
      n = await sbc.countPendingRecruitmentSubmissions();
    } catch (_) {}
    const label = n > 0 ? `✅ Approva post (${n})` : '✅ Approva post';
    rows.push([Markup.button.callback(label, 'comm_owner_queue')]);
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
    `⚪ <b>Modalità attiva:</b> <i>Menu Community</i>\n\n` +
    `• <b>Chat globale</b> — aperta a tutti; in stanza solo chi è dentro; ✅ se usi il profilo CoCBoard.\n` +
    `• <b>Reclutamento</b> — annunci visibili a tutti; invio bozza anche senza account (come <b>ospite Telegram</b>); 24h nel feed dopo approvazione.\n\n` +
    `<i>Nessuna chat diretta tra giocatori.</i>`;
  const kb = await communityMenuKb(uid);
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }
  await refreshPrivateReplyKeyboardRef(ctx);
}

function registerCommunityHandlers(bot, deps) {
  const { pendingCommunity, isLinkedChatContext, tauth, sendMainMenu, sendGuestMenu, backMenuKb } = deps;
  refreshPrivateReplyKeyboardRef =
    typeof deps.refreshPrivateReplyKeyboard === 'function' ? deps.refreshPrivateReplyKeyboard : async () => {};

  bot.action('comm_hub', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    pendingCommunity.delete(uid);
    const sess = await tauth.getValidSession(uid);
    if (sess) ctx.cocboardUser = sess.user;
    await sendCommunityMenu(ctx);
  });

  bot.action('comm_global', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const mod = await sbc.getGlobalModerationRow(uid).catch(() => null);
    const bl = sbc.globalModerationBlocked(mod);
    if (bl.blocked && bl.kind === 'banned') {
      await ctx
        .reply(
          '🚫 Non puoi usare la <b>chat globale</b>: questo account è stato bannato per violazioni ripetute.',
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
      await refreshPrivateReplyKeyboardRef(ctx);
      return;
    }
    await renderGlobalAccessModeMenu(ctx, tauth, { backToHub: true });
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
    await privateUi.purgeGlobalEphemeralOnly(ctx.telegram, uid).catch(() => {});
    await sbc.deactivateGlobalSubscriber(uid);
    pendingCommunity.delete(uid);
    const sess = await tauth.getValidSession(uid);
    await ctx.reply('👋 Uscito dalla chat globale.', { parse_mode: 'HTML' });
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    } else if (typeof sendGuestMenu === 'function') {
      await sendGuestMenu(ctx);
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

  bot.action('comm_global_mode', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (!active) {
      await ctx.answerCbQuery('Apri prima Chat globale').catch(() => {});
      return;
    }
    await renderGlobalAccessModeMenu(ctx, tauth, { backToHub: false });
  });

  bot.action('comm_global_quick', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sub = await sbc.getGlobalSubscriber(uid).catch(() => null);
    if (!sub || !sub.display_name) {
      await ctx.answerCbQuery('Nessuna modalità salvata').catch(() => {});
      return;
    }
    if (sub.display_verified === true || sub.display_verified === 'true') {
      const sess = await tauth.getValidSession(uid);
      if (!sess) {
        await ctx.answerCbQuery('Serve accesso CoCBoard').catch(() => {});
        await renderGlobalAccessModeMenu(ctx, tauth, { backToHub: true });
        return;
      }
      const share = sub.share_verified_details !== false && sub.share_verified_details !== 'false';
      await finalizeJoinGlobalVerified(ctx, tauth, share);
      return;
    }
    await sbc.tickGlobalEpochIfNeeded().catch(() => {});
    await sbc.upsertGlobalSubscriber(uid, sub.display_name, sub.display_tag || null, { displayVerified: false });
    let subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
    if (!subFresh?.active) {
      await sleep(80);
      subFresh = await sbc.getGlobalSubscriber(uid).catch(() => null);
    }
    await sendGlobalEnteredMessage(ctx, { subscriberOverride: subFresh || undefined });
  });

  bot.action('comm_global_report', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const active = await sbc.isActiveInGlobalChat(uid).catch(() => false);
    if (!active) {
      await ctx.answerCbQuery('Entra prima in chat globale').catch(() => {});
      return;
    }
    pendingCommunity.set(uid, { kind: 'global_report' });
    const body =
      `🚩 <b>Segnala messaggio</b>\n\n` +
      `Rispondi a un messaggio della chat globale e scrivi una breve motivazione.\n` +
      `Esempio: <i>spam ripetuto</i>\n\n` +
      `<i>Per annullare: /start o «Community».</i>`;
    const kb = Markup.inlineKeyboard([[Markup.button.callback('« Indietro — Chat globale', 'comm_global')]]);
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
    await refreshPrivateReplyKeyboardRef(ctx);
  });

  bot.action('comm_gauth', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (sess) {
      ctx.cocboardUser = sess.user;
      return joinGlobalAsCocboardProfile(ctx, tauth);
    }
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🔑 Accedi', 'auth_login_for_global'), Markup.button.callback('📝 Registrati', 'auth_register_for_global')],
      [Markup.button.callback('« Indietro — Chat globale', 'comm_global')],
    ]);
    const body =
      `👤 <b>Nome da profilo CoCBoard</b>\n\n` +
      `Per entrare in chat con il nome dell’account (✅ <i>verificato</i>) devi <b>accedere o registrarti</b>.\n\n` +
      `Dopo l’accesso ti chiederemo se entrare in chat globale o aprire il menù principale.`;
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
    await refreshPrivateReplyKeyboardRef(ctx);
  });

  bot.action('comm_postauth_global_join', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    await joinGlobalAsCocboardProfile(ctx, tauth);
  });

  bot.action('comm_gprof', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.answerCbQuery('Usa Accedi / Registrati.').catch(() => {});
      return;
    }
    await promptGlobalProfileShareChoice(ctx, tauth);
  });

  bot.action('comm_gprof_sf', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    await finalizeJoinGlobalVerified(ctx, tauth, true);
  });

  bot.action('comm_gprof_sm', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    await finalizeJoinGlobalVerified(ctx, tauth, false);
  });

  bot.action('comm_gman', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    pendingCommunity.set(uid, { kind: 'global_manual_tag' });
    const body =
      '✏️ Invia <b>una riga</b> nel formato:\n<code>nomeInGioco#TAG</code>\n\n' +
      '<b>Solo caratteri di testo</b> nel nome (lettere, numeri, spazi, <code>_</code> <code>.</code> ecc.) — <b>nessuna</b> emoticon o simbolo tipo scudo (🛡).\n\n' +
      'Esempio: in gioco ti chiami <b>GIOCATORE</b> e il tag è <code>#2J2VLPP9R</code> →\n<code>GIOCATORE#2J2VLPP9R</code>\n\n' +
      '<code>/esci_chat_global</code> oppure «Esci» sull’hub dopo l’ingresso.';
    const kb = Markup.inlineKeyboard([[Markup.button.callback('« Indietro — Chat globale', 'comm_global')]]);
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb }).catch(() => {});
    }
    await refreshPrivateReplyKeyboardRef(ctx);
  });

  bot.action('comm_recruit', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (sess) ctx.cocboardUser = sess.user;
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
    await refreshPrivateReplyKeyboardRef(ctx);
  });

  bot.action('comm_recruit_list', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    try {
      const rows = await sbc.listActiveRecruitmentPosts(12);
      const introKb = Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'comm_recruit_back_clean')]]);
      if (!rows.length) {
        const text = '📋 <b>Annunci attivi</b>\n\n<i>Nessun annuncio attivo al momento.</i>';
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...introKb }).catch(async () => {
          await ctx.reply(text, { parse_mode: 'HTML', ...introKb });
        });
        await refreshPrivateReplyKeyboardRef(ctx);
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
        const mids = await sendOneActivePostToChat(ctx.telegram, chatId, row, ownerKb);
        if (uid != null) for (const mid of mids) privateUi.notePrivateUiMessage(uid, mid);
        await sleep(45);
      }
      const endKb = Markup.inlineKeyboard([[Markup.button.callback('« Indietro — Reclutamento', 'comm_recruit_back_clean')]]);
      try {
        const endMsg = await ctx.telegram.sendMessage(chatId, '📋 <b>Annunci attivi</b> — fine elenco.', {
          parse_mode: 'HTML',
          ...endKb,
        });
        if (uid != null && endMsg?.message_id) privateUi.notePrivateUiMessage(uid, endMsg.message_id);
      } catch (_) {}
      await refreshPrivateReplyKeyboardRef(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...recruitHubKb() });
      await refreshPrivateReplyKeyboardRef(ctx);
    }
  });

  bot.action('comm_recruit_back_clean', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid == null) return;
    // Pulizia esplicita dei messaggi mostrati nella lista annunci attivi.
    await privateUi.wipePrivateConversationUi(ctx.telegram, uid).catch(() => {});
    const sess = await tauth.getValidSession(uid);
    if (sess) ctx.cocboardUser = sess.user;
    await sbc.ensureRecruitmentSubscriber(uid);
    pendingCommunity.delete(uid);
    const text =
      `📣 <b>Reclutamento</b>\n\n` +
      `Scegli una sezione:\n` +
      `• <b>Annunci attivi</b> — cosa è in circolazione ora (dal database).\n` +
      `• <b>Invia annuncio</b> — bozza da far approvare al proprietario del bot.`;
    await ctx.reply(text, { parse_mode: 'HTML', ...recruitHubKb() }).catch(() => {});
    await refreshPrivateReplyKeyboardRef(ctx);
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
      const ownerUid = ctx.from?.id;
      for (const sub of list) {
        const part = submissionBodyHtmlPart(sub);
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approva', `rva:${sub.id}`), Markup.button.callback('❌ Rifiuta', `rvr:${sub.id}`)],
        ]);
        const head = `📋 Bozza <code>#${sub.id}</code>\nDa: ${escapeHtml(sub.submitter_display)}\n\n`;
        const tail = `\n\n🔗 <code>${escapeHtml(sub.clan_profile_url)}</code>`;
        const combined = `${head}${part}${tail}`;
        if (sub.photo_file_id && combined.length <= TG_CAPTION_HTML_MAX) {
          try {
            const pm = await ctx.telegram.sendPhoto(chatId, sub.photo_file_id, {
              caption: combined,
              parse_mode: 'HTML',
              ...kb,
            });
            if (ownerUid != null && pm?.message_id) privateUi.notePrivateUiMessage(ownerUid, pm.message_id);
          } catch (_) {}
        } else {
          try {
            const tm = await ctx.telegram.sendMessage(chatId, combined, { parse_mode: 'HTML', ...kb });
            if (ownerUid != null && tm?.message_id) privateUi.notePrivateUiMessage(ownerUid, tm.message_id);
          } catch (_) {}
          if (sub.photo_file_id) {
            try {
              const pm2 = await ctx.telegram.sendPhoto(chatId, sub.photo_file_id, { caption: '📷 Allegato alla bozza.' });
              if (ownerUid != null && pm2?.message_id) privateUi.notePrivateUiMessage(ownerUid, pm2.message_id);
            } catch (_) {}
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
    if (sess) ctx.cocboardUser = sess.user;
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
    await refreshPrivateReplyKeyboardRef(ctx);
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
    await refreshPrivateReplyKeyboardRef(ctx);
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
    await refreshPrivateReplyKeyboardRef(ctx);
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
    await refreshPrivateReplyKeyboardRef(ctx);
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
    await refreshPrivateReplyKeyboardRef(ctx);
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
    const disp = sess?.user ? displayFromUser(sess.user) : null;
    const subLabel = disp ? (disp.tag ? `${disp.name} (${disp.tag})` : disp.name) : guestTelegramLabel(ctx.from);
    await submitRecruitmentToModerators(ctx, {
      bodyText,
      bodyHtml,
      photoFileId: st.photo_file_id,
      uid,
      subLabel,
    });
    await refreshPrivateReplyKeyboardRef(ctx);
  });

  bot.action('recg_cancel', async (ctx) => {
    safeCb(ctx);
    const uid = ctx.from?.id;
    if (uid != null) pendingCommunity.delete(uid);
    await ctx.answerCbQuery('Annullato').catch(() => {});
    await ctx.reply('Bozza guidata annullata.', { parse_mode: 'HTML', ...recruitSendKb() });
    await refreshPrivateReplyKeyboardRef(ctx);
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
  joinGlobalAsCocboardProfile,
  purgeGlobalWindowTelegramMessages,
};

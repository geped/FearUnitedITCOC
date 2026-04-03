'use strict';

const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const { isUserAllowed, rateLimitOk } = require('./lib/access');
const api = require('./lib/cocboard-api');
const sb = require('./lib/supabase');
const fmt = require('./lib/format');
const tauth = require('./lib/telegram-auth');

const PORT = Number(process.env.PORT) || 3001;

/** Wizard registrazione / login (testo multi-step) */
const pendingAuth = new Map();
/** Cerca giocatore/clan (testo) — anche senza login */
const pendingSearch = new Map();

let cachedTgBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

async function ensureTgBotUsername(telegram) {
  if (cachedTgBotUsername) return cachedTgBotUsername;
  try {
    const me = await telegram.getMe();
    cachedTgBotUsername = (me.username || '').replace(/^@/, '');
  } catch (_) {}
  return cachedTgBotUsername;
}

function privateChatUrl(username) {
  const u = (username || '').replace(/^@/, '');
  return u ? `https://t.me/${u}` : '';
}

function chatKind(ctx) {
  return ctx.chat?.type || 'private';
}

function isGroupLike(ctx) {
  const t = chatKind(ctx);
  return t === 'group' || t === 'supergroup';
}

function guardUserId(ctx) {
  return ctx.from?.id ?? ctx.callbackQuery?.from?.id;
}

function isPublicCallbackData(d) {
  if (!d) return false;
  return (
    d === 'menu' ||
    d === 'nav_search' ||
    d === 'nav_rank' ||
    d === 'srch_p' ||
    d === 'srch_c' ||
    d === 'rk_p_i' ||
    d === 'rk_p_g' ||
    d === 'rk_c_i' ||
    d === 'rk_c_g' ||
    d === 'noop'
  );
}

/** Ospite in chat privata: niente Logout (non sei dentro). */
function buildPrivateGuestKb() {
  const rows = [
    [Markup.button.callback('🔑 Accedi', 'auth_login')],
    [Markup.button.callback('📝 Registrati', 'auth_register')],
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
    [Markup.button.callback('ℹ️ Come funziona', 'auth_guest_help')],
  ];
  const site = process.env.COCBOARD_SITE_HOME_URL;
  if (site && String(site).trim()) {
    rows.push([Markup.button.url('🌐 Apri il sito CoCBoard', String(site).trim())]);
  }
  return Markup.inlineKeyboard(rows);
}

/** Gruppo: login solo in privato; cerca/classifica pubbliche. */
function buildGroupGuestKb(botUsername) {
  const rows = [];
  const url = privateChatUrl(botUsername);
  if (url) {
    rows.push([Markup.button.url('🔐 Accedi / Registrati (privato)', url)]);
  }
  rows.push(
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
    [Markup.button.callback('ℹ️ Guida gruppo', 'auth_guest_help')]
  );
  const site = process.env.COCBOARD_SITE_HOME_URL;
  if (site && String(site).trim()) {
    rows.push([Markup.button.url('🌐 Sito CoCBoard', String(site).trim())]);
  }
  return Markup.inlineKeyboard(rows);
}

async function getClanContextAuthed(telegramUserId, user) {
  const saved = await sb.getSavedClanTag(telegramUserId).catch(() => null);
  if (saved) {
    try {
      const info = await api.clanInfo(saved);
      return { clanTag: saved, clanName: info.name || saved, hasOverride: true };
    } catch {
      return { clanTag: saved, clanName: saved, hasOverride: true };
    }
  }
  const raw = user?.user_metadata?.coc_clan_tag;
  if (!raw) return { clanTag: null, clanName: null, hasOverride: false };
  const u = String(raw).trim().toUpperCase();
  const tag = u.startsWith('#') ? u : `#${u}`;
  try {
    const info = await api.clanInfo(tag);
    return { clanTag: tag, clanName: info.name || tag, hasOverride: false };
  } catch {
    return { clanTag: tag, clanName: tag, hasOverride: false };
  }
}

async function resolveClanTagForCommands(telegramUserId, user) {
  const c = await getClanContextAuthed(telegramUserId, user);
  return c.clanTag;
}

async function handlePendingSearch(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  const p = pendingSearch.get(uid);
  if (!p) return;
  const textRaw = (ctx.message?.text || '').trim();
  if (textRaw === '/cancel') {
    pendingSearch.delete(uid);
    await ctx.reply('Ricerca annullata.', backMenuKb());
    return;
  }
  if (!textRaw || textRaw.startsWith('/')) return;
  pendingSearch.delete(uid);
  try {
    if (p.kind === 'player') {
      const tag = fmt.parseTagArg(textRaw);
      if (!tag) {
        await ctx.reply('Tag non valido. Esempio: <code>#2ABC</code>', { parse_mode: 'HTML', ...backMenuKb() });
        return;
      }
      const data = await api.lookupPlayer(tag);
      await ctx.reply(fmt.formatPlayerSummary(data), { parse_mode: 'HTML', ...backMenuKb() });
      return;
    }
    if (p.kind === 'clan') {
      if (textRaw.length < 3) {
        await ctx.reply('Scrivi almeno 3 caratteri per il nome del clan.', backMenuKb());
        return;
      }
      const data = await api.searchClans(textRaw);
      const txt = fmt.formatClanSearch(data.items || []);
      await ctx.reply(txt, { parse_mode: 'HTML', ...backMenuKb() });
    }
  } catch (e) {
    await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() });
  }
}

async function handlePendingMessage(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  if (isGroupLike(ctx)) {
    await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
    return;
  }
  const textRaw = (ctx.message.text || '').trim();
  if (textRaw === '/cancel') {
    pendingAuth.delete(uid);
    await ctx.reply('Operazione annullata.');
    await sendGuestMenu(ctx);
    return;
  }

  const p = pendingAuth.get(uid);
  if (!p) return;

  if (p.kind === 'login') {
    if (p.step === 1) {
      p.username = textRaw;
      p.step = 2;
      await ctx.reply(
        '🔒 Invia la <b>password</b>.\n<i>Elimina i messaggi con tutore sensibile se preferisci.</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 2) {
      pendingAuth.delete(uid);
      const pwd = textRaw;
      try {
        await ctx.deleteMessage().catch(() => {});
        const data = await tauth.signInWithPasswordFromInput(p.username, pwd);
        await sb.saveAuthSession(uid, data.session, data.user);
        await ctx.reply('✅ <b>Accesso effettuato.</b>', { parse_mode: 'HTML' });
        await reopenMainMenu(ctx, data.user);
      } catch (e) {
        await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        await sendGuestMenu(ctx);
      }
    }
    return;
  }

  if (p.kind === 'reg') {
    if (p.step === 1) {
      const tag = fmt.parseTagArg(textRaw);
      if (!tag) {
        await ctx.reply('Tag non valido. Invia un tag tipo <code>#2ABC</code>', { parse_mode: 'HTML' });
        return;
      }
      p.tag = tag;
      p.step = 2;
      await ctx.reply(
        '🔑 Invia la <b>chiave API</b> dall’app CoC (Impostazioni → Altre impostazioni → Chiave API).',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 2) {
      if (textRaw.length < 8) {
        await ctx.reply('Chiave API troppo corta. Riprova.');
        return;
      }
      p.apiToken = textRaw;
      p.step = 3;
      await ctx.reply('🔒 Scegli una <b>password</b> (minimo 6 caratteri) per l’account CoCBoard.', {
        parse_mode: 'HTML',
      });
      return;
    }
    if (p.step === 3) {
      if (textRaw.length < 6) {
        await ctx.reply('Password troppo corta (min 6). Riprova.');
        return;
      }
      await ctx.deleteMessage().catch(() => {});
      p.password = textRaw;
      p.step = 4;
      await ctx.reply(
        '📧 Invia un’<b>email</b> per recupero password (opzionale).\nScrivi <code>-</code> per saltare.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 4) {
      const emailOpt = textRaw === '-' ? undefined : textRaw;
      if (emailOpt && !emailOpt.includes('@')) {
        await ctx.reply('Email non valida. Riprova o <code>-</code>', { parse_mode: 'HTML' });
        return;
      }
      pendingAuth.delete(uid);
      try {
        const reg = await api.registerWithCoc({
          playerTag: p.tag,
          apiToken: p.apiToken,
          password: p.password,
          email: emailOpt,
        });
        const sign = await tauth.signInWithEmailPassword(reg.email, p.password);
        await sb.saveAuthSession(uid, sign.session, sign.user);
        await ctx.reply(`✅ Registrato come <b>${fmt.escapeHtml(reg.username)}</b>.`, { parse_mode: 'HTML' });
        await reopenMainMenu(ctx, sign.user);
      } catch (e) {
        await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        await sendGuestMenu(ctx);
      }
    }
  }
}

async function reopenMainMenu(ctx, user) {
  ctx.cocboardUser = user;
  await sendMainMenu(ctx);
}

function safeAnswerCb(ctx) {
  try {
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  } catch (_) {}
}

function guardMiddleware() {
  return async (ctx, next) => {
    const uid = guardUserId(ctx);
    if (uid == null) return next();
    if (!isUserAllowed(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Accesso non autorizzato.').catch(() => {});
      else await ctx.reply('Accesso non autorizzato.').catch(() => {});
      return;
    }
    if (!rateLimitOk(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Rallenta un attimo.').catch(() => {});
      else if (ctx.message) await ctx.reply('⏳ Rallenta un attimo.').catch(() => {});
      return;
    }
    return next();
  };
}

async function sendGuestMenu(ctx) {
  await ensureTgBotUsername(ctx.telegram);
  const group = isGroupLike(ctx);
  const text = group
    ? fmt.formatGuestWelcomeGroup(privateChatUrl(cachedTgBotUsername))
    : fmt.formatGuestWelcomePrivate();
  const kb = group ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }
}

async function mainMenuKeyboard(uid, user, hasClanTag) {
  const rows = [];
  rows.push([
    Markup.button.callback('🔍 Cerca', 'nav_search'),
    Markup.button.callback('📊 Classifica', 'nav_rank'),
  ]);
  if (hasClanTag) {
    rows.push(
      [Markup.button.callback('👥 Membri', 'mb0'), Markup.button.callback('🏰 Info clan', 'info')],
      [Markup.button.callback('🏆 CWL live', 'cwl'), Markup.button.callback('🎁 Bonus', 'bonus:0')],
      [Markup.button.callback('📜 Registro guerre', 'war')]
    );
    if (user?.user_metadata?.coc_tag) {
      rows.push([Markup.button.callback('👤 Il mio profilo', 'me')]);
    }
  } else {
    rows.push([Markup.button.callback('🏰 Come impostare il clan', 'setclan_help')]);
  }
  rows.push(
    [Markup.button.callback('⚙️ Account', 'acct')],
    [Markup.button.callback('❓ Aiuto', 'helpbtn')],
    [Markup.button.callback('🚪 Logout', 'auth_logout')]
  );
  const site = process.env.COCBOARD_SITE_HOME_URL;
  if (site && String(site).trim()) {
    rows.push([Markup.button.url('🌐 Apri CoCBoard nel browser', String(site).trim())]);
  }
  return Markup.inlineKeyboard(rows);
}

async function sendMainMenu(ctx) {
  const uid = ctx.from?.id;
  const sess = await tauth.getValidSession(uid);
  const user = sess?.user || ctx.cocboardUser;
  if (!user) return sendGuestMenu(ctx);

  const meta = user.user_metadata || {};
  const display = meta.username || (user.email || '').split('@')[0] || 'Comandante';
  const { clanTag, clanName, hasOverride } = await getClanContextAuthed(uid, user);
  const intro = fmt.formatAuthedMenuIntro({
    displayName: display,
    clanTag,
    clanName,
    hasClanOverride: hasOverride,
    chatHint: isGroupLike(ctx) ? 'Sei in gruppo: i dati sono quelli del tuo account Telegram.' : '',
  });
  const kb = await mainMenuKeyboard(uid, user, !!clanTag);
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
  }
}

function backMenuKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
}

function buildMembersKb(page, pages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀', `mb${page - 1}`));
  row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
  if (page < pages - 1) row.push(Markup.button.callback('▶', `mb${page + 1}`));
  return Markup.inlineKeyboard([row, [Markup.button.callback('« Menù', 'menu')]]);
}

function pickWebhookDomain() {
  const manual = (process.env.TELEGRAM_WEBHOOK_DOMAIN || '').trim();
  if (manual) return manual.replace(/\/$/, '');
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (render) return render.replace(/\/$/, '');
  return '';
}

function pickWebhookPath() {
  const p = (process.env.TELEGRAM_WEBHOOK_SECRET_PATH || '').trim();
  if (p) return p.startsWith('/') ? p : `/${p}`;
  if ((process.env.RENDER_EXTERNAL_URL || '').trim()) return '/tg/cocboard-webhook';
  return '';
}

function webhookPublicUrl() {
  const domain = pickWebhookDomain();
  const pathRaw = pickWebhookPath();
  if (!domain || !pathRaw) return null;
  const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
  return `${String(domain).replace(/\/$/, '')}${path}`;
}

/** Svuota la coda update lato Telegram (non riavvia il processo Render). */
async function refreshWebhookDropPending(telegram) {
  const url = webhookPublicUrl();
  if (!url) return;
  const secretToken = (process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '').trim();
  try {
    await telegram.setWebhook(url, {
      secret_token: secretToken || undefined,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    });
    console.log('[cocboard-bot] setWebhook(drop_pending_updates) dopo logout');
  } catch (e) {
    console.error('[cocboard-bot] refreshWebhookDropPending', e.message || e);
  }
}

async function performFullLogout(ctx, { viaCommand }) {
  const uid = ctx.from?.id;
  if (uid == null) {
    if (viaCommand) await ctx.reply('⚠️ Comando non applicabile.').catch(() => {});
    else await ctx.answerCbQuery('Errore: mittente sconosciuto').catch(() => {});
    return;
  }
  try {
    await sb.clearAuthSession(uid);
  } catch (e) {
    console.error('[cocboard-bot] clearAuthSession', e.message || e);
  }
  pendingAuth.delete(uid);
  pendingSearch.delete(uid);
  await refreshWebhookDropPending(ctx.telegram);
  if (viaCommand) {
    await ctx
      .reply(
        '👋 <b>Logout:</b> sessione sul bot cancellata; wizard annullato; messaggi in coda su Telegram ignorati.',
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  } else {
    await ctx.answerCbQuery('Logout: sessione e coda azzerate.').catch(() => {});
  }
  await sendGuestMenu(ctx);
}

function parseCwlViewKey(raw) {
  if (raw === 'ov') return { view: 'ov', pPage: 0, rIdx: 0 };
  if (raw === 'g') return { view: 'g', pPage: 0, rIdx: 0 };
  const pm = /^p:(\d+)$/.exec(raw);
  if (pm) return { view: 'p', pPage: Number(pm[1]), rIdx: 0 };
  const rm = /^r:(\d+)$/.exec(raw);
  if (rm) return { view: 'r', pPage: 0, rIdx: Number(rm[1]) };
  return { view: 'ov', pPage: 0, rIdx: 0 };
}

function buildCwlNavKb(data, spec) {
  const { view, pPage, rIdx } = spec;
  if (!data || data.state === 'notInWar') {
    return Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
  }
  const pPages = fmt.getCwlPlayerPageCount(data);
  const rCount = fmt.getCwlRoundCount(data);

  const tab = (active, short, payload) =>
    Markup.button.callback(active ? `· ${short} ·` : short, payload);

  const rows = [
    [
      tab(view === 'ov', '📊 Pan', 'cwl_v:ov'),
      tab(view === 'g', '🏅 Gruppo', 'cwl_v:g'),
    ],
    [
      tab(view === 'p', '👥 Roster', 'cwl_v:p:0'),
      tab(view === 'r', '⚔️ Turni', `cwl_v:r:${view === 'r' ? rIdx : 0}`),
    ],
  ];

  if (view === 'p' && pPages > 1) {
    const prev = Math.max(0, pPage - 1);
    const next = Math.min(pPages - 1, pPage + 1);
    rows.push([
      Markup.button.callback('◀', `cwl_v:p:${prev}`),
      Markup.button.callback(`· ${pPage + 1}/${pPages} ·`, 'noop'),
      Markup.button.callback('▶', `cwl_v:p:${next}`),
    ]);
  }

  if (view === 'r' && rCount > 1) {
    const prev = Math.max(0, rIdx - 1);
    const next = Math.min(rCount - 1, rIdx + 1);
    rows.push([
      Markup.button.callback('◀ Turno', `cwl_v:r:${prev}`),
      Markup.button.callback(`· ${rIdx + 1}/${rCount} ·`, 'noop'),
      Markup.button.callback('Turno ▶', `cwl_v:r:${next}`),
    ]);
  }

  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

async function loadAndShowCwl(_ctx, clanTag, viewSpec) {
  const data = await api.cwlStats(clanTag);
  const formatted = fmt.formatCwlScreen(data, viewSpec.view, viewSpec.pPage, viewSpec.rIdx);
  const kb = buildCwlNavKb(data, formatted);
  return { text: formatted.text, kb, data };
}

async function sendCwlMessages(ctx, text, kb) {
  const parts = fmt.chunkForTelegram(text);
  for (let i = 0; i < parts.length; i++) {
    const extra = i === parts.length - 1 ? kb : {};
    await ctx.reply(parts[i], { parse_mode: 'HTML', ...extra });
  }
}

async function editOrReplyCwl(ctx, text, kb) {
  const parts = fmt.chunkForTelegram(text);
  try {
    await ctx.editMessageText(parts[0], { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(parts[0], { parse_mode: 'HTML', ...kb });
  }
  for (let i = 1; i < parts.length; i++) {
    await ctx.reply(parts[i], { parse_mode: 'HTML' });
  }
}

function buildBonusKb(page, pages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀', `bonus:${page - 1}`));
  row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
  if (page < pages - 1) row.push(Markup.button.callback('▶', `bonus:${page + 1}`));
  return Markup.inlineKeyboard([row, [Markup.button.callback('« Menù', 'menu')]]);
}

function rankPickKb() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⭐ Gioc. Italia', 'rk_p_i'),
      Markup.button.callback('⭐ Gioc. Mondo', 'rk_p_g'),
    ],
    [
      Markup.button.callback('🏰 Clan Italia', 'rk_c_i'),
      Markup.button.callback('🏰 Clan Mondo', 'rk_c_g'),
    ],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

function searchPickKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Villaggio (#tag)', 'srch_p'), Markup.button.callback('🏰 Clan (nome)', 'srch_c')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

async function replyRanking(ctx, rankType, locationId, areaLabel) {
  const data = await api.rankings(rankType, locationId);
  const txt = fmt.formatRankings(data, rankType, areaLabel);
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('« Classifiche', 'nav_rank')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
  try {
    await ctx.editMessageText(txt, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(txt, { parse_mode: 'HTML', ...kb });
  }
}

function setupBot(bot) {
  bot.use(guardMiddleware());

  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const txt = (ctx.message?.text || '').trim();
    if (txt === '/start') {
      pendingAuth.delete(ctx.from.id);
      pendingSearch.delete(ctx.from.id);
      return next();
    }
    if (pendingAuth.has(ctx.from.id) && ctx.message?.text && !txt.startsWith('/')) {
      await handlePendingMessage(ctx);
      return;
    }
    if (pendingSearch.has(ctx.from.id) && ctx.message?.text && !txt.startsWith('/')) {
      await handlePendingSearch(ctx);
      return;
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid == null) return next();
    const t = (ctx.message?.text || '').trim();
    if (
      t.startsWith('/start') ||
      t.startsWith('/help') ||
      t.startsWith('/player') ||
      t.startsWith('/cerca_clan') ||
      t.startsWith('/cerca') ||
      t.startsWith('/classifica')
    ) {
      return next();
    }
    if (ctx.callbackQuery?.data?.startsWith('auth_')) return next();
    if (pendingSearch.has(uid)) return next();
    const d = ctx.callbackQuery?.data || '';
    if (isPublicCallbackData(d)) return next();

    const session = await tauth.getValidSession(uid);
    if (!session) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🔒 Accedi per il clan / bonus / CWL.').catch(() => {});
        await ensureTgBotUsername(ctx.telegram);
        const gkb = isGroupLike(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
        await ctx.reply(fmt.formatGuestSnack(), { parse_mode: 'HTML', ...gkb }).catch(() => {});
        return;
      }
      if (ctx.message && ctx.message.text) {
        await sendGuestMenu(ctx);
        return;
      }
      return;
    }
    ctx.cocboardUser = session.user;
    ctx.cocboardSession = session.session;
    return next();
  });

  bot.start(async (ctx) => {
    if (!ctx.from?.id) return;
    try {
      const sess = await tauth.getValidSession(ctx.from.id);
      if (sess) {
        ctx.cocboardUser = sess.user;
        return await sendMainMenu(ctx);
      }
      return await sendGuestMenu(ctx);
    } catch (e) {
      console.error('[cocboard-bot] /start', e);
      await ctx
        .reply(
          '⚠️ Errore temporaneo. Controlla su Render/PC i log e che SUPABASE_URL sia https://…supabase.co (non la dashboard).'
        )
        .catch(() => {});
    }
  });

  bot.command('help', async (ctx) => {
    if (!ctx.from?.id) return;
    const sess = await tauth.getValidSession(ctx.from.id);
    if (!sess) {
      await ensureTgBotUsername(ctx.telegram);
      const text = isGroupLike(ctx) ? fmt.formatGroupHelp() : fmt.formatGuestHelp();
      const kb = isGroupLike(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
      return;
    }
    const lines = [
      `${fmt.DIV}`,
      `📖 <b>Aiuto CoCBoard</b>`,
      `${fmt.DIV}`,
      '',
      `🔍 <b>Cerca e classifica</b> (anche senza clan)`,
      `Pulsanti <b>Cerca</b> e <b>Classifica</b>, oppure <code>/player</code> · <code>/cerca_clan</code>`,
      '',
      `🏰 <b>Clan</b>`,
      `<code>/setclan #TAG</code> — altro clan\n<code>/logout_clan</code> — rimuovi override`,
      '',
      `📊 <b>Dati clan</b>`,
      `<code>/membri</code> · <code>/info</code> · <code>/cwl</code> · <code>/bonus</code> · <code>/guerre</code>`,
      '',
      `🚪 <code>/esci</code> o <b>Logout</b> nel menù`,
      '',
      `<code>/start</code> — menù principale`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('esci', async (ctx) => {
    if (!ctx.from?.id) return;
    try {
      await performFullLogout(ctx, { viaCommand: true });
    } catch (e) {
      await ctx.reply(String(e.message || ''));
    }
  });

  bot.command('setclan', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply(fmt.formatSetclanHelp(), { parse_mode: 'HTML', ...backMenuKb() });
      return;
    }
    try {
      const info = await api.clanInfo(tag);
      await sb.setSavedClanTag(ctx.from.id, tag);
      await ctx.reply(
        `✅ Clan impostato su <b>${fmt.escapeHtml(info.name)}</b> <code>${fmt.escapeHtml(info.tag || tag)}</code>`,
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.command('logout_clan', async (ctx) => {
    try {
      await sb.clearSavedClanOnly(ctx.from.id);
      await ctx.reply(
        '🔓 Override clan rimosso. Si usa di nuovo il clan sul profilo account (se presente).',
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(String(e.message || ''), { ...backMenuKb() });
    }
  });

  async function cmdNeedClan(ctx, fn) {
    const tag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!tag) {
      await ctx.reply(
        '⚠️ Nessun clan disponibile. Usa <code>/setclan #TAG</code> o assicurati di essere in un clan in game.',
        { parse_mode: 'HTML', ...backMenuKb() }
      );
      return;
    }
    return fn(tag);
  }

  bot.command('membri', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const data = await api.clanMembers(clanTag);
      const { text, page, pages } = fmt.formatMembersPage(data.items, 0, clanTag);
      await ctx.reply(text, { parse_mode: 'HTML', ...buildMembersKb(page, pages) });
    });
  });

  bot.command('info', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const info = await api.clanInfo(clanTag);
      await ctx.reply(fmt.formatClanInfo(info), { parse_mode: 'HTML', ...backMenuKb() });
    });
  });

  bot.command('cwl', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const { text, kb } = await loadAndShowCwl(ctx, clanTag, { view: 'ov', pPage: 0, rIdx: 0 });
      await sendCwlMessages(ctx, text, kb);
    });
  });

  bot.command('bonus', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      let rows = null;
      try {
        rows = await sb.fetchBonusesForClan(clanTag);
      } catch (_) {
        rows = null;
      }
      const { text, page, pages } = fmt.formatBonusesPage(rows || [], 0, clanTag);
      const kb = pages > 1 ? buildBonusKb(page, pages) : backMenuKb();
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    });
  });

  bot.command('guerre', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const data = await api.warLog(clanTag);
      await ctx.reply(fmt.formatWarLog(data), { parse_mode: 'HTML', ...backMenuKb() });
    });
  });

  bot.command('player', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply('Usa: /player #TAG');
      return;
    }
    const data = await api.lookupPlayer(tag);
    await ctx.reply(fmt.formatPlayerSummary(data), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('cerca_clan', async (ctx) => {
    const q = (ctx.message.text || '').replace(/^\/cerca_clan\s*/i, '').trim();
    if (q.length < 3) {
      await ctx.reply('Usa: /cerca_clan nome (almeno 3 caratteri)');
      return;
    }
    const data = await api.searchClans(q);
    await ctx.reply(fmt.formatClanSearch(data.items || []), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('cerca', async (ctx) => {
    await ctx.reply(fmt.formatSearchMenuIntro(), { parse_mode: 'HTML', ...searchPickKb() });
  });

  bot.command('classifica', async (ctx) => {
    await ctx.reply(fmt.formatRankMenuIntro(), { parse_mode: 'HTML', ...rankPickKb() });
  });

  bot.command('clan', async (ctx) => {
    await ctx.reply(
      `Usa <code>/setclan #TAG</code> per il clan da mostrare,\no <code>/cerca_clan nome</code> per cercare.`,
      { parse_mode: 'HTML', ...backMenuKb() }
    );
  });

  bot.action('auth_login', async (ctx) => {
    safeAnswerCb(ctx);
    if (isGroupLike(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Accedi in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    pendingSearch.delete(ctx.from.id);
    pendingAuth.set(ctx.from.id, { kind: 'login', step: 1 });
    await ctx.reply(
      '🔑 <b>Accedi</b> (come su CoCBoard)\n\n' +
        'Invia <b>nome utente</b>, <b>tag</b> <code>#...</code> o <b>email</b>.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('auth_register', async (ctx) => {
    safeAnswerCb(ctx);
    if (isGroupLike(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Registrati in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    pendingSearch.delete(ctx.from.id);
    pendingAuth.set(ctx.from.id, { kind: 'reg', step: 1 });
    await ctx.reply(
      '📝 <b>Registrati</b>\n\nInvia il <b>tag giocatore</b> (es. <code>#2ABC</code>).',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('auth_guest_help', async (ctx) => {
    safeAnswerCb(ctx);
    await ensureTgBotUsername(ctx.telegram);
    const text = isGroupLike(ctx) ? fmt.formatGroupHelp() : fmt.formatGuestHelp();
    const kb = isGroupLike(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('auth_logout', async (ctx) => {
    await performFullLogout(ctx, { viaCommand: false });
  });

  bot.action('noop', async (ctx) => {
    safeAnswerCb(ctx);
  });

  bot.action('menu', async (ctx) => {
    safeAnswerCb(ctx);
    const sess = await tauth.getValidSession(ctx.from.id);
    if (!sess) return sendGuestMenu(ctx);
    ctx.cocboardUser = sess.user;
    return sendMainMenu(ctx);
  });

  bot.action('setclan_help', async (ctx) => {
    safeAnswerCb(ctx);
    const text = fmt.formatSetclanHelp();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('acct', async (ctx) => {
    safeAnswerCb(ctx);
    const uid = ctx.from.id;
    const u = ctx.cocboardUser;
    const meta = u?.user_metadata || {};
    const saved = await sb.getSavedClanTag(uid).catch(() => null);
    const text = fmt.formatAccountPanel({
      username: meta.username || (u?.email || '').split('@')[0],
      cocTag: meta.coc_tag,
      profileClanTag: meta.coc_clan_tag,
      savedClanOverride: saved,
    });
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🚪 Logout', 'auth_logout')],
      [Markup.button.callback('« Menù', 'menu')],
    ]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('helpbtn', async (ctx) => {
    safeAnswerCb(ctx);
    const body =
      `${fmt.DIV}\n📖 <b>Aiuto rapido</b>\n${fmt.DIV}\n\n` +
      `• <b>Cerca / Classifica</b> — pulsanti nel menù\n` +
      `• <code>/setclan</code> · <code>/player</code> · <code>/cerca_clan</code>\n` +
      `• <code>/esci</code> — logout\n` +
      `• Comando completo: <code>/help</code>`;
    await ctx
      .editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]) })
      .catch(async () => {
        await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]) });
      });
  });

  bot.action('nav_search', async (ctx) => {
    safeAnswerCb(ctx);
    const intro = fmt.formatSearchMenuIntro();
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...searchPickKb() });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...searchPickKb() });
    }
  });

  bot.action('nav_rank', async (ctx) => {
    safeAnswerCb(ctx);
    const intro = fmt.formatRankMenuIntro();
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...rankPickKb() });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...rankPickKb() });
    }
  });

  bot.action('srch_p', async (ctx) => {
    safeAnswerCb(ctx);
    if (!ctx.from?.id) return;
    pendingAuth.delete(ctx.from.id);
    pendingSearch.set(ctx.from.id, { kind: 'player' });
    await ctx.reply(
      '👤 Invia il <b>tag villaggio</b> (es. <code>#2ABC</code>).\n<code>/cancel</code> per annullare.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('srch_c', async (ctx) => {
    safeAnswerCb(ctx);
    if (!ctx.from?.id) return;
    pendingAuth.delete(ctx.from.id);
    pendingSearch.set(ctx.from.id, { kind: 'clan' });
    await ctx.reply(
      '🏰 Invia <b>parte del nome</b> del clan (min. 3 caratteri).\n<code>/cancel</code> per annullare.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('rk_p_i', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'players', fmt.RANK_LOCATION_ITALY, 'Italia');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_p_g', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'players', fmt.RANK_LOCATION_GLOBAL, 'Mondo');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_c_i', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'clans', fmt.RANK_LOCATION_ITALY, 'Italia');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_c_g', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'clans', fmt.RANK_LOCATION_GLOBAL, 'Mondo');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action(/^mb(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    const page = Number(ctx.match[1]) || 0;
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Imposta clan').catch(() => {});
      return;
    }
    const data = await api.clanMembers(clanTag);
    const { text, page: p, pages } = fmt.formatMembersPage(data.items, page, clanTag);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...buildMembersKb(p, pages) });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...buildMembersKb(p, pages) });
    }
  });

  bot.action('info', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const info = await api.clanInfo(clanTag);
    const text = fmt.formatClanInfo(info);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('cwl', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const { text, kb } = await loadAndShowCwl(ctx, clanTag, { view: 'ov', pPage: 0, rIdx: 0 });
    await editOrReplyCwl(ctx, text, kb);
  });

  bot.action(/^cwl_v:(.+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const key = ctx.match[1];
    const spec = parseCwlViewKey(key);
    const { text, kb } = await loadAndShowCwl(ctx, clanTag, spec);
    await editOrReplyCwl(ctx, text, kb);
  });

  bot.action(/^bonus:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    const page = Number(ctx.match[1]) || 0;
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let rows = null;
    try {
      rows = await sb.fetchBonusesForClan(clanTag);
    } catch (_) {
      rows = null;
    }
    const { text, page: p, pages } = fmt.formatBonusesPage(rows || [], page, clanTag);
    const kb = pages > 1 ? buildBonusKb(p, pages) : backMenuKb();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('war', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await resolveClanTagForCommands(ctx.from.id, ctx.cocboardUser);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const data = await api.warLog(clanTag);
    const text = fmt.formatWarLog(data);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('me', async (ctx) => {
    safeAnswerCb(ctx);
    const tag = ctx.cocboardUser?.user_metadata?.coc_tag;
    if (!tag) {
      await ctx.answerCbQuery('Nessun villaggio sul profilo').catch(() => {});
      return;
    }
    const data = await api.lookupPlayer(tag);
    const text = fmt.formatPlayerSummary(data);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.on('my_chat_member', async (ctx) => {
    try {
      const chat = ctx.chat;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
      const me = await ctx.telegram.getMe();
      const nn = ctx.myChatMember?.new_chat_member;
      if (nn?.user?.id !== me.id) return;
      if (nn.status !== 'member' && nn.status !== 'administrator') return;
      await ctx.reply(fmt.formatGroupBotAdded(), { parse_mode: 'HTML' });
    } catch (_) {}
  });

  bot.catch((err, ctx) => {
    console.error(err);
    const msg = err?.message || 'Errore sconosciuto';
    ctx.reply(`❌ Errore: ${msg}`).catch(() => {});
  });
}

/** Telegraf confronta req.url col path esatto: senza questa, `/path/` non matcha e l’update viene scartato (in chat: silenzio). */
function normalizeTelegrafWebhookPath(expectedPath) {
  return (req, _res, next) => {
    const u = req.url || '';
    const q = u.indexOf('?');
    const qs = q >= 0 ? u.slice(q) : '';
    const pathname = q >= 0 ? u.slice(0, q) : u;
    if (pathname === `${expectedPath}/` || pathname === `${expectedPath}//`) {
      req.url = expectedPath + qs;
    }
    next();
  };
}

function logIncomingWebhook(secretConfigured) {
  return (req, _res, next) => {
    const hdr = req.headers['x-telegram-bot-api-secret-token'];
    const hasHeader = hdr != null && String(hdr).length > 0;
    console.log(
      `[cocboard-bot] webhook POST url=${req.url} secret_header=${hasHeader} secret_env=${secretConfigured ? 'yes' : 'no'}`
    );
    next();
  };
}

function warnSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || '').trim();
  if (!url) {
    console.warn('[cocboard-bot] SUPABASE_URL mancante: /start userà solo menu ospite e il login non funzionerà.');
    return;
  }
  if (url.includes('supabase.com/dashboard') || url.includes('/project/')) {
    console.error(
      '[cocboard-bot] SUPABASE_URL errata: hai incollato la pagina dashboard. Deve essere tipo https://xxxx.supabase.co (Project Settings → API).'
    );
  }
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    console.warn('[cocboard-bot] SUPABASE_SERVICE_ROLE_KEY mancante.');
  }
  if (!(process.env.SUPABASE_ANON_KEY || '').trim()) {
    console.warn('[cocboard-bot] SUPABASE_ANON_KEY mancante (login impossibile).');
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Imposta TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  warnSupabaseEnv();

  const bot = new Telegraf(token);
  setupBot(bot);

  const webhookDomain = pickWebhookDomain();
  const webhookSecretPath = pickWebhookPath();
  const hookUrl = webhookPublicUrl();

  if (webhookDomain && webhookSecretPath && hookUrl) {
    const domain = String(webhookDomain).replace(/\/$/, '');
    const path = webhookSecretPath.startsWith('/') ? webhookSecretPath : `/${webhookSecretPath}`;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'cocboard-telegram-bot' }));

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '';
    const hookMw = bot.webhookCallback(path, { secretToken: secretToken || undefined });
    const logMw = logIncomingWebhook(Boolean(secretToken && String(secretToken).trim()));
    const normMw = normalizeTelegrafWebhookPath(path);
    app.post(path, normMw, logMw, hookMw);
    app.post(`${path}/`, normMw, logMw, hookMw);

    if (!secretToken && (process.env.RENDER_EXTERNAL_URL || '').trim()) {
      console.warn(
        '[cocboard-bot] Imposta TELEGRAM_WEBHOOK_SECRET_TOKEN in produzione.'
      );
    }
    const listenPort = Number(process.env.PORT) || PORT;
    app.listen(listenPort, '0.0.0.0', async () => {
      console.log(`Listening 0.0.0.0:${listenPort} webhook POST ${path}`);
      await bot.telegram.setWebhook(hookUrl, {
        secret_token: secretToken || undefined,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
        drop_pending_updates: true,
      });
      try {
        const me = await bot.telegram.getMe();
        if (me.username) cachedTgBotUsername = me.username.replace(/^@/, '');
      } catch (_) {}
      console.log('Webhook set:', hookUrl);
    });
  } else {
    console.log(
      'Avvio long polling. Per webhook: TELEGRAM_WEBHOOK_* o deploy Render (RENDER_EXTERNAL_URL).'
    );
    await bot.launch();
    try {
      const me = await bot.telegram.getMe();
      if (me.username) cachedTgBotUsername = me.username.replace(/^@/, '');
    } catch (_) {}
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

'use strict';

const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const { isUserAllowed, rateLimitOk } = require('./lib/access');
const api = require('./lib/cocboard-api');
const sb = require('./lib/supabase');
const fmt = require('./lib/format');

const PORT = Number(process.env.PORT) || 3001;

async function getClanContext(telegramUserId) {
  const defaultTag = api.getDefaultClanTag();
  const saved =
    telegramUserId != null ? await sb.getSavedClanTag(telegramUserId).catch(() => null) : null;
  const clanTag = saved || defaultTag;
  let clanName = clanTag;
  try {
    const info = await api.clanInfo(clanTag);
    clanName = info.name || clanTag;
  } catch (_) {
    clanName = clanTag;
  }
  return { clanTag, clanName, isCustomClan: !!saved, defaultTag };
}

async function clanTagForUser(telegramUserId) {
  const ctx = await getClanContext(telegramUserId);
  return ctx.clanTag;
}

function safeAnswerCb(ctx) {
  try {
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  } catch (_) {}
}

function guardMiddleware() {
  return async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid == null) return;
    if (!isUserAllowed(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Accesso non autorizzato.').catch(() => {});
      else await ctx.reply('Accesso non autorizzato.').catch(() => {});
      return;
    }
    if (!rateLimitOk(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Rallenta un attimo.').catch(() => {});
      return;
    }
    return next();
  };
}

async function mainMenuKeyboard(telegramUserId) {
  const linked = telegramUserId ? await sb.getTelegramLink(telegramUserId).catch(() => null) : null;
  const rows = [
    [
      Markup.button.callback('👥 Membri', 'mb0'),
      Markup.button.callback('🏰 Info clan', 'info'),
    ],
    [
      Markup.button.callback('🏆 CWL live', 'cwl'),
      Markup.button.callback('🎁 Bonus', 'bonus'),
    ],
    [Markup.button.callback('📜 Registro guerre', 'war')],
  ];
  if (linked) rows.push([Markup.button.callback('👤 Il mio profilo', 'me')]);
  else rows.push([Markup.button.callback('🔗 Collega villaggio', 'linkhelp')]);
  rows.push([Markup.button.callback('🔐 Account · login clan', 'acct')]);
  rows.push([Markup.button.callback('❓ Aiuto · ricerca', 'helpbtn')]);
  const site = process.env.COCBOARD_SITE_HOME_URL;
  if (site && String(site).trim()) {
    rows.push([Markup.button.url('🌐 Apri CoCBoard nel browser', String(site).trim())]);
  }
  return Markup.inlineKeyboard(rows);
}

async function sendMainMenu(ctx) {
  const uid = ctx.from?.id;
  const { clanTag, clanName, isCustomClan, defaultTag } = await getClanContext(uid);
  const intro = fmt.formatMainMenuIntro({
    clanLabel: escapeMenuName(clanName),
    clanTag,
    isCustomClan,
    defaultTag,
  });
  const kb = await mainMenuKeyboard(uid);
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

function escapeMenuName(name) {
  return String(name)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function backMenuKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Menù principale', 'menu')]]);
}

function buildMembersKb(page, pages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀', `mb${page - 1}`));
  row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
  if (page < pages - 1) row.push(Markup.button.callback('▶', `mb${page + 1}`));
  return Markup.inlineKeyboard([row, [Markup.button.callback('« Menù', 'menu')]]);
}

function setupBot(bot) {
  bot.use(guardMiddleware());

  bot.start(async (ctx) => sendMainMenu(ctx));

  bot.command('help', async (ctx) => {
    const def = api.getDefaultClanTag();
    const lines = [
      `${fmt.DIV}`,
      `❓ <b>Comandi</b>`,
      `${fmt.DIV}`,
      '',
      `🔐 <b>Account / clan</b>`,
      `<code>/login #CLANTAG</code> — gestisci <i>tuo</i> clan`,
      `<code>/logout_clan</code> — torna al predefinito <code>${def}</code>`,
      '',
      `📊 <b>Dati clan attivo</b>`,
      `<code>/membri</code> · <code>/info</code> · <code>/cwl</code> · <code>/bonus</code> · <code>/guerre</code>`,
      '',
      `🔍 <b>Cerca</b>`,
      `<code>/player #TAG</code> · <code>/cerca_clan testo</code>`,
      '',
      `👤 <b>Villaggio</b>`,
      `<code>/link #TAG</code> · <code>/unlink</code>`,
      '',
      `<code>/start</code> — menù con pulsanti`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('login', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply(fmt.formatLoginHelp(api.getDefaultClanTag()), { parse_mode: 'HTML', ...backMenuKb() });
      return;
    }
    try {
      const info = await api.clanInfo(tag);
      await sb.setSavedClanTag(ctx.from.id, tag);
      await ctx.reply(
        `${fmt.DIV}\n✅ <b>Login effettuato</b>\n${fmt.DIV}\n\n` +
          `🏰 <b>${fmt.escapeHtml(info.name)}</b>\n<code>${fmt.escapeHtml(info.tag || tag)}</code>\n\n` +
          `Da ora membro, CWL, bonus e guerre usano <b>questo</b> clan.\n` +
          `<i>Bonus DB: solo se presenti dati su Supabase per questo tag.</i>`,
 { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(
        `❌ Clan non trovato o API non disponibile.\n<code>${fmt.escapeHtml(tag)}</code>\n\n${fmt.escapeHtml(String(e.message || ''))}`,
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    }
  });

  bot.command('logout_clan', async (ctx) => {
    try {
      if (!sb.sb()) {
        await ctx.reply('Supabase non configurato.');
        return;
      }
      await sb.clearSavedClanOnly(ctx.from.id);
      await ctx.reply(
        `🔓 <b>Clan personalizzato rimosso.</b>\n` +
          `Ora usi di nuovo il predefinito:\n<code>${api.getDefaultClanTag()}</code>`,
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(String(e.message || ''), { ...backMenuKb() });
    }
  });

  bot.command('link', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply('Usa: /link #TUOTAG (es. /link #2ABC123PL)');
      return;
    }
    try {
      await api.lookupPlayer(tag);
    } catch (e) {
      await ctx.reply(`Tag non valido o API non disponibile: ${e.message}`);
      return;
    }
    try {
      await sb.setTelegramLink(ctx.from.id, tag);
      await ctx.reply(`✅ Villaggio collegato: <code>${fmt.escapeHtml(tag)}</code>`, {
        parse_mode: 'HTML',
        ...backMenuKb(),
      });
    } catch (e) {
      await ctx.reply(
        `Impossibile salvare: ${e.message}\n` +
          'Verifica SUPABASE e lo schema <code>telegram-bot/schema-telegram-links.sql</code>.',
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('unlink', async (ctx) => {
    try {
      if (!sb.sb()) {
        await ctx.reply('Supabase non configurato.');
        return;
      }
      await sb.deleteTelegramLink(ctx.from.id);
      await ctx.reply('🗑️ Preferenze salvate rimosse (clan + villaggio).', { ...backMenuKb() });
    } catch (e) {
      await ctx.reply(e.message);
    }
  });

  bot.command('membri', async (ctx) => {
    const clanTag = await clanTagForUser(ctx.from.id);
    const data = await api.clanMembers(clanTag);
    const { text, page, pages } = fmt.formatMembersPage(data.items, 0, clanTag);
    await ctx.reply(text, { parse_mode: 'HTML', ...buildMembersKb(page, pages) });
  });

  bot.command('info', async (ctx) => {
    const clanTag = await clanTagForUser(ctx.from.id);
    const info = await api.clanInfo(clanTag);
    await ctx.reply(fmt.formatClanInfo(info), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('cwl', async (ctx) => {
    const clanTag = await clanTagForUser(ctx.from.id);
    const data = await api.cwlStats(clanTag);
    const txt = fmt.formatCwl(data);
    const parts = fmt.chunkForTelegram(txt);
    for (let i = 0; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: 'HTML',
        ...(i === parts.length - 1 ? backMenuKb() : {}),
      });
    }
  });

  bot.command('bonus', async (ctx) => {
    const clanTag = await clanTagForUser(ctx.from.id);
    let rows = null;
    try {
      rows = await sb.fetchBonusesForClan(clanTag);
    } catch (_) {
      rows = null;
    }
    const txt = fmt.formatBonuses(rows || []);
    const parts = fmt.chunkForTelegram(txt);
    for (let i = 0; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: 'HTML',
        ...(i === parts.length - 1 ? backMenuKb() : {}),
      });
    }
  });

  bot.command('guerre', async (ctx) => {
    const clanTag = await clanTagForUser(ctx.from.id);
    const data = await api.warLog(clanTag);
    await ctx.reply(fmt.formatWarLog(data), { parse_mode: 'HTML', ...backMenuKb() });
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

  /** Ricerca clan per nome (stesso endpoint di prima) */
  bot.command('cerca_clan', async (ctx) => {
    const q = (ctx.message.text || '').replace(/^\/cerca_clan\s*/i, '').trim();
    if (q.length < 3) {
      await ctx.reply('Usa: /cerca_clan nome (almeno 3 caratteri)');
      return;
    }
    const data = await api.searchClans(q);
    const items = data.items || [];
    await ctx.reply(fmt.formatClanSearch(items), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('clan', async (ctx) => {
    const sub = (ctx.message.text || '').split(/\s+/)[1] || '';
    if (/^#/i.test(sub)) {
      await ctx.reply(
        `Per impostare il <b>tuo</b> clan usa:\n<code>/login ${fmt.escapeHtml(sub)}</code>\n\n` +
          `Per cercare clan per nome: <code>/cerca_clan testo</code>`,
        { parse_mode: 'HTML', ...backMenuKb() }
      );
      return;
    }
    await ctx.reply(
      `Usa <code>/login #TAG</code> per gestire il tuo clan,\no <code>/cerca_clan nome</code> per cercare.`,
      { parse_mode: 'HTML', ...backMenuKb() }
    );
  });

  bot.action('noop', async (ctx) => {
    safeAnswerCb(ctx);
  });

  bot.action('menu', async (ctx) => {
    safeAnswerCb(ctx);
    await sendMainMenu(ctx);
  });

  bot.action('acct', async (ctx) => {
    safeAnswerCb(ctx);
    const uid = ctx.from.id;
    const playerTag = await sb.getTelegramLink(uid).catch(() => null);
    const savedClan = await sb.getSavedClanTag(uid).catch(() => null);
    const text = fmt.formatAccountPanel({
      playerTag,
      clanTag: savedClan,
      defaultTag: api.getDefaultClanTag(),
    });
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🔐 Istruzioni login', 'loginscr')],
      [Markup.button.callback('« Menù', 'menu')],
    ]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('loginscr', async (ctx) => {
    safeAnswerCb(ctx);
    const text = fmt.formatLoginHelp(api.getDefaultClanTag());
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Account', 'acct')],
          [Markup.button.callback('« Menù', 'menu')],
        ]),
      });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('helpbtn', async (ctx) => {
    safeAnswerCb(ctx);
    await ctx
      .editMessageText(
        `${fmt.DIV}\n🔍 <b>Aiuto rapido</b>\n${fmt.DIV}\n\n` +
          `<code>/player #TAG</code> — scheda giocatore\n` +
          `<code>/cerca_clan nome</code> — ricerca clan\n` +
          `<code>/login #CLAN</code> — il tuo clan nel bot\n` +
          `<code>/help</code> — tutti i comandi`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]) }
      )
      .catch(async () => {
        await ctx.reply('Usa /help per l’elenco comandi.');
      });
  });

  bot.action('linkhelp', async (ctx) => {
    safeAnswerCb(ctx);
    const text =
      `${fmt.DIV}\n🔗 <b>Collega il villaggio</b>\n${fmt.DIV}\n\n` +
      'Così compare <b>Il mio profilo</b> nel menù.\n\n' +
      '<code>/link #TUOTAG</code>\n\n' +
      '<i>Richiede tabella <code>telegram_links</code> su Supabase.</i>';
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Menù', 'menu')],
        ]),
      });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action(/^mb(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    const page = Number(ctx.match[1]) || 0;
    const clanTag = await clanTagForUser(ctx.from.id);
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
    const clanTag = await clanTagForUser(ctx.from.id);
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
    const clanTag = await clanTagForUser(ctx.from.id);
    const data = await api.cwlStats(clanTag);
    const txt = fmt.formatCwl(data);
    const parts = fmt.chunkForTelegram(txt);
    try {
      await ctx.editMessageText(parts[0], { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(parts[0], { parse_mode: 'HTML', ...backMenuKb() });
    }
    for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i], { parse_mode: 'HTML' });
  });

  bot.action('bonus', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await clanTagForUser(ctx.from.id);
    let rows = null;
    try {
      rows = await sb.fetchBonusesForClan(clanTag);
    } catch (_) {
      rows = null;
    }
    const txt = fmt.formatBonuses(rows || []);
    const parts = fmt.chunkForTelegram(txt);
    try {
      await ctx.editMessageText(parts[0], { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(parts[0], { parse_mode: 'HTML', ...backMenuKb() });
    }
    for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i], { parse_mode: 'HTML' });
  });

  bot.action('war', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await clanTagForUser(ctx.from.id);
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
    const tag = await sb.getTelegramLink(ctx.from.id);
    if (!tag) {
      await ctx.answerCbQuery('Collega con /link #TAG').catch(() => {});
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

  bot.catch((err, ctx) => {
    console.error(err);
    const msg = err?.message || 'Errore sconosciuto';
    ctx.reply(`❌ Errore: ${msg}`).catch(() => {});
  });
}

function pickWebhookDomain() {
  const manual = (process.env.TELEGRAM_WEBHOOK_DOMAIN || '').trim();
  if (manual) return manual.replace(/\/$/, '');
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (render) return render.replace(/\/$/, '');
  return '';
}

/** Path webhook: env esplicito, oppure default su Render (URL servizio auto-impostato). */
function pickWebhookPath() {
  const p = (process.env.TELEGRAM_WEBHOOK_SECRET_PATH || '').trim();
  if (p) return p.startsWith('/') ? p : `/${p}`;
  if ((process.env.RENDER_EXTERNAL_URL || '').trim()) return '/tg/cocboard-webhook';
  return '';
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Imposta TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  const bot = new Telegraf(token);
  setupBot(bot);

  const webhookDomain = pickWebhookDomain();
  const webhookSecretPath = pickWebhookPath();

  if (webhookDomain && webhookSecretPath) {
    const domain = String(webhookDomain).replace(/\/$/, '');
    const path = webhookSecretPath.startsWith('/') ? webhookSecretPath : `/${webhookSecretPath}`;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'cocboard-telegram-bot' }));

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '';
    const hookMw = bot.webhookCallback(path, { secretToken: secretToken || undefined });
    app.post(path, hookMw);

    const url = `${domain}${path}`;
    if (!secretToken && (process.env.RENDER_EXTERNAL_URL || '').trim()) {
      console.warn(
        '[cocboard-bot] Imposta TELEGRAM_WEBHOOK_SECRET_TOKEN in produzione (Telegram invierà X-Telegram-Bot-Api-Secret-Token).'
      );
    }
    const listenPort = Number(process.env.PORT) || PORT;
    app.listen(listenPort, '0.0.0.0', async () => {
      console.log(`Listening 0.0.0.0:${listenPort} webhook POST ${path}`);
      await bot.telegram.setWebhook(url, {
        secret_token: secretToken || undefined,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      console.log('Webhook set:', url);
    });
  } else {
    console.log(
      'Avvio long polling. Per webhook usa TELEGRAM_WEBHOOK_DOMAIN + TELEGRAM_WEBHOOK_SECRET_PATH, oppure deploy su Render (RENDER_EXTERNAL_URL).'
    );
    await bot.launch();
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

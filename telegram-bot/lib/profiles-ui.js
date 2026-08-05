'use strict';

/**
 * UI multi-profilo CoC sul bot Telegram (privato).
 * Dipende da profiles-api.js (Vercel) + sessione Auth.
 */

const { Markup } = require('telegraf');
const profilesApi = require('./profiles-api');
const fmt = require('./format');

/** @type {Map<number, object>} */
const pendingProfileAdd = new Map();
/** @type {Map<number, object>} */
const pendingProfileWipe = new Map();

function escapeHtml(s) {
  return fmt.escapeHtml ? fmt.escapeHtml(s) : String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function roleLabel(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'capo') return 'Capo';
  if (r === 'co-capo') return 'Co-Capo';
  if (r === 'anziano') return 'Anziano';
  if (r === 'membro') return 'Membro';
  if (r === 'admin') return 'Admin';
  return r || '—';
}

function formatProfileLine(p, prefs) {
  const bits = [];
  if (prefs?.active_profile_id === p.id) bits.push('●');
  if (prefs?.default_profile_id === p.id) bits.push('⭐');
  if (prefs?.mini_app_profile_id === p.id) bits.push('📱');
  const mark = bits.length ? `${bits.join('')} ` : '';
  const name = escapeHtml(p.label || p.username || 'Villaggio');
  const tag = escapeHtml(p.coc_tag || '');
  const clan = p.coc_clan_name ? ` · ${escapeHtml(p.coc_clan_name)}` : '';
  return `${mark}<b>${name}</b> <code>${tag}</code>${clan}\n   ${roleLabel(p.clan_role)}`;
}

function buildPickerText(data, { title, gate } = {}) {
  const prefs = data.prefs || {};
  const lines = (data.profiles || []).map((p) => formatProfileLine(p, prefs));
  const head = title || (gate ? '👤 <b>Scegli il profilo CoC</b>' : '👤 <b>Profili CoC</b>');
  const hint = gate
    ? '\nSeleziona il villaggio da usare ora, oppure aggiungine uno nuovo.'
    : '\n● attivo · ⭐ predefinito · 📱 Mini App dedicata';
  return `${head}\n${hint}\n\n${lines.join('\n\n') || '<i>Nessun profilo.</i>'}`;
}

function buildPickerKb(data, { gate } = {}) {
  const rows = [];
  for (const p of data.profiles || []) {
    const label = `${p.username || 'Villaggio'} (${p.coc_tag})`.slice(0, 60);
    rows.push([Markup.button.callback(`➤ ${label}`, `prof_use:${p.id}`)]);
  }
  if ((data.profiles || []).length < (data.max_profiles || 10)) {
    rows.push([Markup.button.callback('➕ Aggiungi villaggio (API CoC)', 'prof_add')]);
  }
  if (!gate) {
    rows.push([
      Markup.button.callback(
        data.prefs?.always_ask_profile ? '🔁 Chiedi sempre: ON' : '🔁 Chiedi sempre: OFF',
        'prof_tog_ask',
      ),
    ]);
    rows.push([Markup.button.callback('⭐ Imposta predefinito…', 'prof_def_menu')]);
    rows.push([Markup.button.callback('📱 Mini App…', 'prof_mini_menu')]);
    rows.push([Markup.button.callback('🗑 Scollega profilo…', 'prof_rm_menu')]);
    rows.push([Markup.button.callback('⚠️ Elimina account CoCBoard', 'prof_wipe')]);
    rows.push([Markup.button.callback('« Account', 'acct'), Markup.button.callback('« Menù', 'menu')]);
  } else {
    rows.push([Markup.button.callback('🚪 Logout', 'auth_logout')]);
  }
  return Markup.inlineKeyboard(rows);
}

async function getAccessToken(sb, telegramUserId) {
  const row = await sb.getFullRow(telegramUserId).catch(() => null);
  return row?.auth_access_token || null;
}

async function refreshCtxUser(tauth, ctx) {
  const sess = await tauth.getValidSession(ctx.from.id).catch(() => null);
  if (sess?.user) ctx.cocboardUser = sess.user;
  return sess;
}

function setup(bot, deps) {
  const {
    sb,
    tauth,
    safeAnswerCb,
    isLinkedChatContext,
    sendMainMenu,
    replyTransient,
  } = deps;

  async function showProfilesPanel(ctx, { gate } = {}) {
    const token = await getAccessToken(sb, ctx.from.id);
    if (!token) {
      await replyTransient(ctx, 'Sessione scaduta. Accedi di nuovo.', { parse_mode: 'HTML' });
      return;
    }
    const data = await profilesApi.bootstrap(token);
    const text = buildPickerText(data, { gate });
    const kb = buildPickerKb(data, { gate });
    try {
      if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
      else await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  }

  bot.action('prof_menu', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      await showProfilesPanel(ctx, { gate: false });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_gate', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      await showProfilesPanel(ctx, { gate: true });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action(/^prof_use:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    const profileId = ctx.match[1];
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      await profilesApi.switchProfile(token, profileId);
      await refreshCtxUser(tauth, ctx);
      if (ctx.from?.id != null && typeof deps.onProfilePicked === 'function') {
        deps.onProfilePicked(ctx.from.id);
      }
      await replyTransient(ctx, '✅ Profilo attivo aggiornato.', { parse_mode: 'HTML' }, 2500);
      await sendMainMenu(ctx);
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_tog_ask', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const data = await profilesApi.bootstrap(token);
      const next = !(data.prefs?.always_ask_profile === true);
      await profilesApi.setAlwaysAsk(token, next);
      await showProfilesPanel(ctx, { gate: false });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_def_menu', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const data = await profilesApi.bootstrap(token);
      const rows = (data.profiles || []).map((p) => [
        Markup.button.callback(
          `${data.prefs?.default_profile_id === p.id ? '⭐ ' : ''}${p.username || p.coc_tag}`,
          `prof_def:${p.id}`,
        ),
      ]);
      rows.push([Markup.button.callback('✖ Nessun predefinito', 'prof_def:none')]);
      rows.push([Markup.button.callback('« Profili', 'prof_menu')]);
      const text =
        '⭐ <b>Profilo predefinito</b>\n\n' +
        'Se impostato, al login non viene chiesta la scelta (salvo “Chiedi sempre”).';
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action(/^prof_def:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const id = ctx.match[1] === 'none' ? null : ctx.match[1];
      await profilesApi.setDefault(token, id);
      await showProfilesPanel(ctx, { gate: false });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_mini_menu', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const data = await profilesApi.bootstrap(token);
      const rows = (data.profiles || []).map((p) => [
        Markup.button.callback(
          `${data.prefs?.mini_app_profile_id === p.id ? '📱 ' : ''}${p.username || p.coc_tag}`,
          `prof_mini:${p.id}`,
        ),
      ]);
      rows.push([Markup.button.callback('↗ Eredita profilo attivo', 'prof_mini:none')]);
      rows.push([Markup.button.callback('« Profili', 'prof_menu')]);
      await ctx.editMessageText(
        '📱 <b>Profilo Mini App</b>\n\nDefault: eredita il profilo attivo. Oppure scegline uno dedicato.',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) },
      );
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action(/^prof_mini:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const id = ctx.match[1] === 'none' ? null : ctx.match[1];
      await profilesApi.setMiniApp(token, id);
      await showProfilesPanel(ctx, { gate: false });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_rm_menu', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      const data = await profilesApi.bootstrap(token);
      if ((data.profiles || []).length <= 1) {
        await ctx.answerCbQuery('Hai un solo profilo: usa Elimina account.', { show_alert: true }).catch(() => {});
        return;
      }
      const rows = (data.profiles || []).map((p) => [
        Markup.button.callback(`🗑 ${p.username || p.coc_tag}`, `prof_rm:${p.id}`),
      ]);
      rows.push([Markup.button.callback('« Profili', 'prof_menu')]);
      await ctx.editMessageText(
        '🗑 <b>Scollega profilo</b>\n\nNon puoi scollegare il predefinito né l’unico profilo.',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) },
      );
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action(/^prof_rm:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    const profileId = ctx.match[1];
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Conferma scollega', `prof_rmok:${profileId}`)],
      [Markup.button.callback('« Annulla', 'prof_rm_menu')],
    ]);
    await ctx.editMessageText(
      '⚠️ Confermi lo scollegamento di questo villaggio dal tuo account?',
      { parse_mode: 'HTML', ...kb },
    );
  });

  bot.action(/^prof_rmok:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    try {
      const token = await getAccessToken(sb, ctx.from.id);
      await profilesApi.removeProfile(token, ctx.match[1]);
      await refreshCtxUser(tauth, ctx);
      await showProfilesPanel(ctx, { gate: false });
    } catch (e) {
      await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.action('prof_add', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    pendingProfileAdd.set(ctx.from.id, { step: 1 });
    await ctx.reply(
      '➕ <b>Aggiungi villaggio</b>\n\nInvia il <b>tag giocatore</b> (es. <code>#ABC123</code>).\n/cancel per annullare.',
      { parse_mode: 'HTML' },
    );
  });

  bot.action('prof_wipe', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    safeAnswerCb(ctx);
    pendingProfileWipe.set(ctx.from.id, { step: 1 });
    await ctx.reply(
      '⚠️ <b>Elimina account CoCBoard</b>\n\n' +
        'Verranno rimossi account, tutti i profili CoC e le sessioni bot.\n' +
        'I gruppi collegati restano sul clan, ma non avrai più accesso.\n\n' +
        'Scrivi <code>ELIMINA</code> per confermare, oppure /cancel.',
      { parse_mode: 'HTML' },
    );
  });

  return {
    showProfilesPanel,
    pendingProfileAdd,
    pendingProfileWipe,
    async handlePendingText(ctx) {
      const uid = ctx.from?.id;
      if (uid == null) return false;
      const txt = String(ctx.message?.text || '').trim();

      if (pendingProfileAdd.has(uid)) {
        if (txt === '/cancel') {
          pendingProfileAdd.delete(uid);
          await replyTransient(ctx, 'Annullato.', { parse_mode: 'HTML' });
          return true;
        }
        const st = pendingProfileAdd.get(uid);
        if (st.step === 1) {
          st.tag = txt;
          st.step = 2;
          pendingProfileAdd.set(uid, st);
          await ctx.reply(
            'Ora invia la <b>chiave API CoC</b> di quel villaggio (Impostazioni → Altre impostazioni → Chiave API).\n/cancel per annullare.',
            { parse_mode: 'HTML' },
          );
          return true;
        }
        if (st.step === 2) {
          pendingProfileAdd.delete(uid);
          try {
            const token = await getAccessToken(sb, uid);
            await profilesApi.addProfile(token, st.tag, txt);
            await refreshCtxUser(tauth, ctx);
            await ctx.reply('✅ Villaggio collegato.', { parse_mode: 'HTML' });
            await showProfilesPanel(ctx, { gate: false });
          } catch (e) {
            await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
          }
          return true;
        }
      }

      if (pendingProfileWipe.has(uid)) {
        if (txt === '/cancel') {
          pendingProfileWipe.delete(uid);
          await replyTransient(ctx, 'Annullato.', { parse_mode: 'HTML' });
          return true;
        }
        if (txt.toUpperCase() !== 'ELIMINA') {
          await replyTransient(ctx, 'Digita <code>ELIMINA</code> oppure /cancel.', { parse_mode: 'HTML' });
          return true;
        }
        pendingProfileWipe.delete(uid);
        try {
          const token = await getAccessToken(sb, uid);
          await profilesApi.deleteAccount(token);
          await sb.clearAuthSession(uid).catch(() => {});
          ctx.cocboardUser = null;
          await ctx.reply(
            'Account eliminato. Puoi registrarti di nuovo quando vuoi.',
            { parse_mode: 'HTML' },
          );
        } catch (e) {
          await replyTransient(ctx, `❌ ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }
        return true;
      }

      return false;
    },
    async afterLoginMaybeGate(ctx, accessToken) {
      try {
        const data = await profilesApi.bootstrap(accessToken);
        if (data.needs_selection) {
          await showProfilesPanel(ctx, { gate: true });
          return true;
        }
        // Applica default se presente e diverso dall'attivo
        if (
          data.prefs?.default_profile_id &&
          data.active?.id &&
          data.prefs.default_profile_id !== data.active.id &&
          !data.prefs.always_ask_profile
        ) {
          await profilesApi.switchProfile(accessToken, data.prefs.default_profile_id);
          await refreshCtxUser(tauth, ctx);
        }
      } catch (e) {
        console.warn('[profiles] afterLogin', e.message);
      }
      return false;
    },
    markGateDone(telegramUserId) {
      /* no-op placeholder — parent tracks profileGateDone */
    },
  };
}

module.exports = { setup };

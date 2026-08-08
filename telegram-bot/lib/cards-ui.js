'use strict';

/**
 * UI evento "Clash of Cards" (scambio carte) sul bot Telegram — solo chat privata.
 * Rispecchia le funzioni del sito (tab "Carte Evento" → collezione + scambi):
 * segna manualmente le carte possedute, trova match automatici con altri
 * giocatori o tra i propri profili, negozia in una stanza privata con chat
 * e proposte accetta/rifiuta/annulla.
 *
 * Stato multi-step tenuto in Map in memoria (stesso pattern di bonusWizardByUid
 * in index.js): niente ctx.session, tutto per telegram_user_id.
 */

const { Markup } = require('telegraf');
const cardsApi = require('./cards-api');
const fmt = require('./format');

const PAGE_SIZE = 10; // card per pagina nella griglia collezione (2 colonne x 5 righe)

/** @type {Map<number, object>} uid -> { token, catalog, profiles, collections, activeIdx, activeCat, page } */
const stateByUid = new Map();
/** @type {Map<number, object>} uid -> { roomId, myProfileId, otherUsername, proposeGive } */
const roomByUid = new Map();
/** @type {Map<number, { roomId: string }>} uid -> attesa testo libero per messaggio in chat stanza */
const pendingChatByUid = new Map();

function escapeHtml(s) {
  return fmt.escapeHtml(s);
}

const CAT_EMOJI = {
  elixir: '🟣',
  dark_elixir: '⚫',
  builder_base: '🔧',
  super_troop: '⭐',
};

function qtyIcon(qty) {
  if (qty >= 2) return '✅';
  if (qty === 1) return '🔹';
  return '▫️';
}

function clearUserState(uid) {
  stateByUid.delete(uid);
  roomByUid.delete(uid);
  pendingChatByUid.delete(uid);
}

async function getToken(sb, tauth, uid) {
  // getValidSession rinnova il token se scaduto e lo persiste su DB, a differenza
  // di una semplice lettura di auth_access_token (che potrebbe essere stantio).
  const sess = await tauth.getValidSession(uid).catch(() => null);
  if (sess?.session?.access_token) return sess.session.access_token;
  const row = await sb.getFullRow(uid).catch(() => null);
  return row?.auth_access_token || null;
}

async function ensureState(sb, tauth, uid, { forceReload = false } = {}) {
  let st = stateByUid.get(uid);
  if (st && !forceReload) return st;
  const token = await getToken(sb, tauth, uid);
  if (!token) {
    const e = new Error('Sessione scaduta. Accedi di nuovo dal Menù.');
    e.code = 'NO_SESSION';
    throw e;
  }
  const [catalog, coll] = await Promise.all([cardsApi.catalog(), cardsApi.getCollection(token)]);
  st = {
    token,
    catalog,
    profiles: coll.profiles || [],
    collections: coll.collections || {},
    activeIdx: st?.activeIdx || 0,
    activeCat: st?.activeCat || catalog.category_order?.[0] || 'elixir',
    page: 0,
  };
  if (st.activeIdx >= st.profiles.length) st.activeIdx = 0;
  stateByUid.set(uid, st);
  return st;
}

async function refreshCollection(sb, tauth, uid) {
  const st = await ensureState(sb, tauth, uid);
  const coll = await cardsApi.getCollection(st.token);
  st.profiles = coll.profiles || [];
  st.collections = coll.collections || {};
  return st;
}

function activeProfile(st) {
  return st.profiles[st.activeIdx] || null;
}

function activeColl(st) {
  const p = activeProfile(st);
  return p ? st.collections[p.coc_tag] || {} : {};
}

function profileLabel(p) {
  return p ? `${p.username || 'Villaggio'} (${p.coc_tag})` : '—';
}

async function renderView(ctx, text, kb) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }
}

function setup(bot, deps) {
  const { sb, tauth, safeAnswerCb, isLinkedChatContext, replyTransient, isCoCboardAdminUser } = deps;

  function guard(ctx) {
    return isLinkedChatContext(ctx); // true = blocca (feature privata-only)
  }

  async function isAdmin(ctx) {
    const sess = await tauth.getValidSession(ctx.from?.id).catch(() => null);
    return !!sess?.user && isCoCboardAdminUser(sess.user);
  }

  async function withErrors(ctx, fn) {
    try {
      await fn();
    } catch (e) {
      if (e.code === 'NO_SESSION') {
        await replyTransient(ctx, '⚠️ Sessione scaduta. Accedi di nuovo dal Menù.', { parse_mode: 'HTML' });
        return;
      }
      await replyTransient(ctx, `❌ ${escapeHtml(e.message || 'Errore imprevisto.')}`, { parse_mode: 'HTML' });
    }
  }

  // ── Hub principale ───────────────────────────────────────────────────
  async function openHub(ctx, { forceReload = false } = {}) {
    const uid = ctx.from.id;
    const st = await ensureState(sb, tauth, uid, { forceReload });
    if (!st.profiles.length) {
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Profili CoC', 'prof_menu')],
        [Markup.button.callback('« Menù', 'menu')],
      ]);
      await renderView(
        ctx,
        `${fmt.DIV}\n🎴 <b>Evento Clash of Cards</b>\n${fmt.DIV}\n\n` +
          'Nessun profilo CoC collegato al tuo account: collega un villaggio da "Profili CoC" per usare questa sezione.',
        kb,
      );
      return;
    }
    const p = activeProfile(st);
    const coll = activeColl(st);
    const live = st.catalog.settings?.live === true;
    const found = st.catalog.cards.filter((c) => (coll[c.key] || 0) >= 1).length;
    const admin = await isAdmin(ctx);
    const endsAt = st.catalog.settings?.ends_at ? new Date(st.catalog.settings.ends_at) : null;

    const lines = [`${fmt.DIV}`, '🎴 <b>Evento Clash of Cards</b>', fmt.DIV, ''];
    if (!live) {
      lines.push('⚠️ Evento terminato o disattivato: sezione in sola lettura.', '');
    } else if (endsAt) {
      lines.push(`Segna le carte che possiedi. Scambi con gli altri entro il ${endsAt.toLocaleDateString('it-IT')}.`, '');
    }
    lines.push(`Profilo attivo: <b>${escapeHtml(profileLabel(p))}</b>`);
    lines.push(`Carte trovate: <b>${found}/${st.catalog.total_cards}</b>`);

    const rows = [];
    if (st.profiles.length > 1) {
      for (let i = 0; i < st.profiles.length; i++) {
        const pp = st.profiles[i];
        rows.push([
          Markup.button.callback(`${i === st.activeIdx ? '● ' : ''}${profileLabel(pp)}`.slice(0, 60), `cards:p:${i}`),
        ]);
      }
    }
    rows.push([Markup.button.callback('📋 La mia collezione', 'cards:coll')]);
    rows.push([Markup.button.callback('🔄 Scambi', 'cards:tr')]);
    if (admin) {
      rows.push([
        Markup.button.callback(
          st.catalog.settings?.enabled ? '🛑 Disattiva evento (admin)' : '▶️ Riattiva evento (admin)',
          'cards:admtoggle',
        ),
      ]);
    }
    rows.push([Markup.button.callback('« Menù', 'menu')]);
    await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  }

  bot.action('cards', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, () => openHub(ctx, { forceReload: true }));
  });
  bot.action('cards:home', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, () => openHub(ctx));
  });

  bot.action(/^cards:p:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const idx = Number(ctx.match[1]);
      if (idx >= 0 && idx < st.profiles.length) {
        st.activeIdx = idx;
        st.page = 0;
      }
      await openHub(ctx);
    });
  });

  bot.action('cards:admtoggle', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      if (!(await isAdmin(ctx))) return;
      const st = await ensureState(sb, tauth, ctx.from.id);
      await cardsApi.adminToggle(st.token, !(st.catalog.settings?.enabled === true));
      await openHub(ctx, { forceReload: true });
    });
  });

  // ── Collezione ────────────────────────────────────────────────────────
  function renderCollectionView(ctx, st) {
    const coll = activeColl(st);
    const live = st.catalog.settings?.live === true;
    const cardsInCat = st.catalog.cards.filter((c) => c.category === st.activeCat);
    const totalPages = Math.max(1, Math.ceil(cardsInCat.length / PAGE_SIZE));
    if (st.page >= totalPages) st.page = totalPages - 1;
    if (st.page < 0) st.page = 0;
    const pageCards = cardsInCat.slice(st.page * PAGE_SIZE, st.page * PAGE_SIZE + PAGE_SIZE);

    const found = cardsInCat.filter((c) => (coll[c.key] || 0) >= 1).length;
    const text =
      `${fmt.DIV}\n📋 <b>${escapeHtml(st.catalog.category_label_it[st.activeCat] || st.activeCat)}</b>\n${fmt.DIV}\n\n` +
      `Profilo: <b>${escapeHtml(profileLabel(activeProfile(st)))}</b>\n` +
      `Trovate in categoria: <b>${found}/${cardsInCat.length}</b>${live ? '' : '\n\n⚠️ Evento in sola lettura.'}`;

    const rows = [];
    const catRow = [];
    for (const cat of st.catalog.category_order) {
      const c = CAT_EMOJI[cat] || '';
      catRow.push(Markup.button.callback(`${cat === st.activeCat ? '▶' : c}`, `cards:cat:${cat}`));
    }
    rows.push(catRow);

    for (let i = 0; i < pageCards.length; i += 2) {
      const row = [];
      for (const card of pageCards.slice(i, i + 2)) {
        const qty = coll[card.key] || 0;
        const label = `${qtyIcon(qty)} ${card.name_it}${qty >= 2 ? ` (x${qty})` : ''}`.slice(0, 40);
        row.push(Markup.button.callback(label, `cards:pick:${card.key}`));
      }
      rows.push(row);
    }

    if (totalPages > 1) {
      rows.push([
        Markup.button.callback('◀', st.page > 0 ? `cards:collpg:${st.page - 1}` : 'noop'),
        Markup.button.callback(`${st.page + 1}/${totalPages}`, 'noop'),
        Markup.button.callback('▶', st.page < totalPages - 1 ? `cards:collpg:${st.page + 1}` : 'noop'),
      ]);
    }
    rows.push([Markup.button.callback('« Carte', 'cards:home')]);
    return renderView(ctx, text, Markup.inlineKeyboard(rows));
  }

  bot.action('cards:coll', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      st.page = 0;
      await renderCollectionView(ctx, st);
    });
  });

  bot.action(/^cards:cat:(\w+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const cat = ctx.match[1];
      if (st.catalog.category_order.includes(cat)) {
        st.activeCat = cat;
        st.page = 0;
      }
      await renderCollectionView(ctx, st);
    });
  });

  bot.action(/^cards:collpg:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      st.page = Number(ctx.match[1]) || 0;
      await renderCollectionView(ctx, st);
    });
  });

  // ── Modale scelta quantità con pulsanti +/- (quantità libera, non solo 0/1/2) ──
  function qtyNote(qty) {
    if (qty === 0) return 'Non la possiedi — verrà rimossa dalla collezione.';
    if (qty === 1) return 'La possiedi: 1 sola copia (non scambiabile).';
    return `Hai ${qty} copie: doppioni scambiabili con altri giocatori.`;
  }

  function renderQtyPicker(ctx, st) {
    const pending = st.pendingQty;
    const card = st.catalog.cards.find((c) => c.key === pending?.cardKey);
    if (!card) return renderCollectionView(ctx, st);
    const live = st.catalog.settings?.live === true;
    const text =
      `${fmt.DIV}\n${escapeHtml(card.name_it)}\n${fmt.DIV}\n\n` +
      (live
        ? `Quante copie possiedi di questa carta?\n\n<b>${pending.qty}</b> — ${escapeHtml(qtyNote(pending.qty))}`
        : '⚠️ Evento in sola lettura: non puoi modificare la collezione.');
    const rows = live
      ? [
          [
            Markup.button.callback('－', 'cards:qadj:-1'),
            Markup.button.callback(String(pending.qty), 'noop'),
            Markup.button.callback('＋', 'cards:qadj:1'),
          ],
          [Markup.button.callback('💾 Salva', 'cards:qsave')],
          [Markup.button.callback('« Annulla', 'cards:coll')],
        ]
      : [[Markup.button.callback('« Indietro', 'cards:coll')]];
    return renderView(ctx, text, Markup.inlineKeyboard(rows));
  }

  bot.action(/^cards:pick:(.+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const cardKey = ctx.match[1];
      const card = st.catalog.cards.find((c) => c.key === cardKey);
      if (!card) return;
      st.pendingQty = { cardKey, qty: activeColl(st)[cardKey] || 0 };
      await renderQtyPicker(ctx, st);
    });
  });

  bot.action(/^cards:qadj:(-?\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      if (!st.pendingQty) return;
      const delta = Number(ctx.match[1]);
      st.pendingQty.qty = Math.max(0, Math.min(99, st.pendingQty.qty + delta));
      await renderQtyPicker(ctx, st);
    });
  });

  bot.action('cards:qsave', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const p = activeProfile(st);
      if (!p || !st.pendingQty) return;
      const { cardKey, qty } = st.pendingQty;
      await cardsApi.saveCard(st.token, { cocTag: p.coc_tag, cardKey, qtyState: qty });
      if (!st.collections[p.coc_tag]) st.collections[p.coc_tag] = {};
      st.collections[p.coc_tag][cardKey] = qty;
      st.pendingQty = null;
      await renderCollectionView(ctx, st);
    });
  });

  // ── Scambi: hub ──────────────────────────────────────────────────────
  async function openTradeHub(ctx, st) {
    const live = st.catalog.settings?.live === true;
    const text =
      `${fmt.DIV}\n🔄 <b>Scambi</b>\n${fmt.DIV}\n\n` +
      `Profilo attivo: <b>${escapeHtml(profileLabel(activeProfile(st)))}</b>${live ? '' : '\n\n⚠️ Evento in sola lettura: solo consultazione.'}`;
    const rows = [
      [Markup.button.callback('🔍 Scambi con altri giocatori', 'cards:tr:p2p')],
    ];
    if (st.profiles.length > 1) {
      rows.push([Markup.button.callback('🔁 Scambi tra i miei profili', 'cards:tr:self')]);
    }
    rows.push([Markup.button.callback('🌐 Mazzi pubblici', 'cards:tr:pub')]);
    rows.push([Markup.button.callback('💬 Le mie stanze', 'cards:tr:rooms')]);
    rows.push([Markup.button.callback('« Carte', 'cards:home')]);
    await renderView(ctx, text, Markup.inlineKeyboard(rows));
  }

  bot.action('cards:tr', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      await openTradeHub(ctx, st);
    });
  });

  bot.action('cards:tr:p2p', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const p = activeProfile(st);
      if (!p) return;
      const data = await cardsApi.matches(st.token, p.id);
      st.lastMatches = data.matches || [];
      const live = st.catalog.settings?.live === true;
      const lines = [`${fmt.DIV}`, '🔍 <b>Scambi con altri giocatori</b>', fmt.DIV, ''];
      const rows = [];
      if (!st.lastMatches.length) {
        lines.push('Nessuno scambio disponibile al momento.\nSegna più carte nella tua collezione per trovare match.');
      } else {
        st.lastMatches.forEach((m, i) => {
          lines.push(
            `${i + 1}. <b>${escapeHtml(m.other_profile.username || m.other_profile.coc_tag)}</b>: cedi ` +
              `${escapeHtml(m.card_give_meta?.name_it || m.card_give)} → ricevi ${escapeHtml(m.card_get_meta?.name_it || m.card_get)}`,
          );
          if (live) rows.push([Markup.button.callback(`Proponi scambio #${i + 1}`, `cards:mprop:${i}`)]);
        });
      }
      rows.push([Markup.button.callback('« Scambi', 'cards:tr')]);
      await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
    });
  });

  bot.action(/^cards:mprop:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const p = activeProfile(st);
      const m = (st.lastMatches || [])[Number(ctx.match[1])];
      if (!p || !m) return;
      st.pendingPublicSuggested = null;
      const room = await cardsApi.roomOpen(st.token, { profileId: p.id, otherCocTag: m.other_profile.coc_tag });
      await cardsApi.propose(st.token, {
        roomId: room.room.id,
        profileId: p.id,
        cardGive: m.card_give,
        cardGet: m.card_get,
      });
      await replyTransient(ctx, '✅ Proposta inviata! Apri la stanza per seguirla.', { parse_mode: 'HTML' }, 4000);
      await openRoom(ctx, st, room.room.id);
    });
  });

  bot.action('cards:tr:self', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const data = await cardsApi.selfMatches(st.token);
      st.lastSelfMatches = data.matches || [];
      const live = st.catalog.settings?.live === true;
      const lines = [`${fmt.DIV}`, '🔁 <b>Scambi tra i tuoi profili</b>', fmt.DIV, ''];
      const rows = [];
      if (!st.lastSelfMatches.length) {
        lines.push('Nessuno scambio disponibile tra i tuoi profili collegati.');
      } else {
        lines.push('🟢 = sblocca una carta nuova · 🟡 = possibile ma non necessario (la possiedi già)', '');
        st.lastSelfMatches.forEach((m, i) => {
          const aIsNew = m.a_is_new !== false;
          const bIsNew = m.b_is_new !== false;
          const nameA = escapeHtml(m.profile_a.username || m.profile_a.coc_tag);
          const nameB = escapeHtml(m.profile_b.username || m.profile_b.coc_tag);
          lines.push(
            `${i + 1}. <b>${nameA}</b> cede ${escapeHtml(m.card_a_to_b_meta?.name_it || m.card_a_to_b)} → riceve ${escapeHtml(m.card_b_to_a_meta?.name_it || m.card_b_to_a)} ${aIsNew ? '🟢' : '🟡'}\n` +
              `   <b>${nameB}</b> cede ${escapeHtml(m.card_b_to_a_meta?.name_it || m.card_b_to_a)} → riceve ${escapeHtml(m.card_a_to_b_meta?.name_it || m.card_a_to_b)} ${bIsNew ? '🟢' : '🟡'}`,
          );
          if (live) rows.push([Markup.button.callback(`Applica subito #${i + 1}`, `cards:mself:${i}`)]);
        });
      }
      rows.push([Markup.button.callback('« Scambi', 'cards:tr')]);
      await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
    });
  });

  bot.action(/^cards:mself:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const m = (st.lastSelfMatches || [])[Number(ctx.match[1])];
      if (!m) return;
      await cardsApi.selfApply(st.token, {
        profileA: m.profile_a.id,
        profileB: m.profile_b.id,
        cardAToB: m.card_a_to_b,
        cardBToA: m.card_b_to_a,
      });
      await refreshCollection(sb, tauth, ctx.from.id);
      await replyTransient(ctx, '✅ Scambio applicato: le collezioni sono state aggiornate.', { parse_mode: 'HTML' }, 4000);
      const fresh = await ensureState(sb, tauth, ctx.from.id);
      await openTradeHub(ctx, fresh);
    });
  });

  // ── Mazzi pubblici (vetrina) ─────────────────────────────────────────────
  async function renderPublicDecksView(ctx, st) {
    const p = activeProfile(st);
    if (!p) return;
    const data = await cardsApi.publicList(st.token, p.id);
    st.lastPublicDecks = data.decks || [];
    const live = st.catalog.settings?.live === true;
    const lines = [
      `${fmt.DIV}`,
      '🌐 <b>Mazzi pubblici</b>',
      fmt.DIV,
      '',
      `Il tuo mazzo (${escapeHtml(profileLabel(p))}) è: <b>${data.my_public ? 'pubblico ✅' : 'privato 🔒'}</b>`,
      'Se pubblico, il tuo mazzo completo appare qui come "annuncio" a tutti gli utenti CoCBoard, che potranno proporti scambi.',
      '',
    ];
    const rows = [];
    if (live) {
      rows.push([Markup.button.callback(data.my_public ? '🔒 Rendi privato' : '🌐 Rendi pubblico', 'cards:pubtoggle')]);
    }
    if (!st.lastPublicDecks.length) {
      lines.push('Nessun altro utente ha reso pubblico il proprio mazzo per ora.');
    } else {
      st.lastPublicDecks.forEach((d, i) => {
        const n = d.matches.length;
        lines.push(`${i + 1}. <b>${escapeHtml(d.profile.username || d.profile.coc_tag)}</b>${n ? ` — 🔄 ${n} scambio${n === 1 ? '' : 'i'} possibile${n === 1 ? '' : 'i'}` : ' — nessuno scambio automatico'}`);
        rows.push([Markup.button.callback(`📋 Vedi mazzo di ${d.profile.username || d.profile.coc_tag}`.slice(0, 60), `cards:pubview:${i}`)]);
      });
    }
    rows.push([Markup.button.callback('« Scambi', 'cards:tr')]);
    await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  }

  bot.action('cards:tr:pub', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      await renderPublicDecksView(ctx, st);
    });
  });

  bot.action('cards:pubtoggle', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const p = activeProfile(st);
      if (!p) return;
      const data = await cardsApi.publicList(st.token, p.id);
      await cardsApi.publicToggle(st.token, p.id, !data.my_public);
      await renderPublicDecksView(ctx, st);
    });
  });

  // "Post" completo di un mazzo pubblico: collezione intera per categoria + scambi suggeriti.
  function formatPublicDeckCards(catalog, collection) {
    const blocks = [];
    for (const catKey of catalog.category_order) {
      const cardsInCat = catalog.cards.filter((c) => c.category === catKey);
      const owned = cardsInCat.filter((c) => (collection[c.key] || 0) >= 1);
      if (!owned.length) continue;
      const label = catalog.category_label_it[catKey] || catKey;
      const list = owned
        .map((c) => `${escapeHtml(c.name_it)}${(collection[c.key] || 0) >= 2 ? ` x${collection[c.key]}` : ''}`)
        .join(', ');
      blocks.push(`<b>${CAT_EMOJI[catKey] || ''} ${escapeHtml(label)}</b> (${owned.length}/${cardsInCat.length}): ${list}`);
    }
    return blocks.length ? blocks.join('\n\n') : 'Nessuna carta segnata ancora.';
  }

  async function renderPublicDeckPost(ctx, st, idx) {
    const d = (st.lastPublicDecks || [])[idx];
    if (!d) return renderPublicDecksView(ctx, st);
    const live = st.catalog.settings?.live === true;
    const lines = [
      `${fmt.DIV}`,
      `🌐 <b>${escapeHtml(d.profile.username || d.profile.coc_tag)}</b>${d.profile.coc_clan_name ? ` · ${escapeHtml(d.profile.coc_clan_name)}` : ''}`,
      fmt.DIV,
      '',
      formatPublicDeckCards(st.catalog, d.collection || {}),
      '',
    ];
    const n = d.matches.length;
    if (n) {
      lines.push(`<b>🔄 ${n} scambio${n === 1 ? '' : 'i'} possibile${n === 1 ? '' : 'i'} con te:</b>`);
      d.matches.forEach((m) =>
        lines.push(`• Cedi ${escapeHtml(m.card_give_meta?.name_it || m.card_give)} → ricevi ${escapeHtml(m.card_get_meta?.name_it || m.card_get)}`),
      );
    } else {
      lines.push('Nessuno scambio automatico con te al momento.');
    }
    const rows = [];
    if (live) rows.push([Markup.button.callback('💬 Apri chat e proponi', `cards:pubopen:${idx}`)]);
    rows.push([Markup.button.callback('« Mazzi pubblici', 'cards:tr:pub')]);
    await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  }

  bot.action(/^cards:pubview:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      await renderPublicDeckPost(ctx, st, Number(ctx.match[1]));
    });
  });

  bot.action(/^cards:pubopen:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const p = activeProfile(st);
      const d = (st.lastPublicDecks || [])[Number(ctx.match[1])];
      if (!p || !d) return;
      const room = await cardsApi.roomOpen(st.token, { profileId: p.id, otherCocTag: d.profile.coc_tag });
      st.pendingPublicSuggested = d.matches || [];
      await openRoom(ctx, st, room.room.id);
    });
  });

  // ── Stanze 1-a-1 (chat + proposte) ──────────────────────────────────────
  bot.action('cards:tr:rooms', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const data = await cardsApi.rooms(st.token);
      st.lastRooms = data.rooms || [];
      const lines = [`${fmt.DIV}`, '💬 <b>Le mie stanze</b>', fmt.DIV, ''];
      const rows = [];
      if (!st.lastRooms.length) {
        lines.push('Nessuna conversazione ancora.');
      } else {
        for (const r of st.lastRooms) {
          const preview = r.last_message ? (r.last_message.body || '').slice(0, 40) : 'Nessun messaggio ancora';
          const badge = r.pending_proposals > 0 ? ` (${r.pending_proposals} 🔔)` : '';
          rows.push([
            Markup.button.callback(
              `${(r.other_profile?.username || r.other_profile?.coc_tag || '—')}${badge} — ${preview}`.slice(0, 60),
              `cards:room:${r.id}`,
            ),
          ]);
        }
      }
      rows.push([Markup.button.callback('« Scambi', 'cards:tr')]);
      await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
    });
  });

  async function openRoom(ctx, st, roomId, { keepSuggested = false } = {}) {
    const data = await cardsApi.roomDetail(st.token, roomId);
    roomByUid.set(ctx.from.id, { roomId, myProfileId: data.room.my_profile_id, proposeGive: null });
    if (!keepSuggested) {
      st.roomSuggested = st.pendingPublicSuggested || null;
      st.pendingPublicSuggested = null;
    }
    const live = st.catalog.settings?.live === true;
    const otherName = escapeHtml(data.other.username || data.other.coc_tag);

    const lines = [`${fmt.DIV}`, `🔁 ${otherName}`, fmt.DIV, ''];
    const suggested = st.roomSuggested || [];
    const rows = [];
    if (suggested.length && live) {
      lines.push('<b>🔄 Scambi suggeriti (mazzo pubblico):</b>');
      suggested.forEach((m, i) => {
        lines.push(`• Cedi ${escapeHtml(m.card_give_meta?.name_it || m.card_give)} → ricevi ${escapeHtml(m.card_get_meta?.name_it || m.card_get)}`);
        rows.push([Markup.button.callback(`Proponi suggerito #${i + 1}`, `cards:pubprop:${i}`)]);
      });
      lines.push('');
    }
    const pending = data.proposals.filter((p) => p.status === 'pending');
    if (pending.length) {
      lines.push('<b>Proposte in corso:</b>');
      for (const p of pending) {
        const mine = p.proposer_profile === data.room.my_profile_id;
        lines.push(
          `• ${mine ? 'Hai proposto' : `${otherName} propone`}: cede ${escapeHtml(p.card_give_meta?.name_it || p.card_give)} → riceve ${escapeHtml(p.card_get_meta?.name_it || p.card_get)}`,
        );
        if (live) {
          if (mine) {
            rows.push([Markup.button.callback('Annulla proposta', `cards:resp:${p.id}:cancel`)]);
          } else {
            rows.push([
              Markup.button.callback('✓ Accetta', `cards:resp:${p.id}:accept`),
              Markup.button.callback('✕ Rifiuta', `cards:resp:${p.id}:reject`),
            ]);
          }
        }
      }
      lines.push('');
    }
    const recent = data.messages.slice(-8);
    lines.push('<b>Ultimi messaggi:</b>');
    if (!recent.length) {
      lines.push('<i>Nessun messaggio. Scrivi per iniziare la trattativa.</i>');
    } else {
      for (const m of recent) {
        if (m.kind === 'system') {
          lines.push(`⚙️ <i>${escapeHtml(m.body || '')}</i>`);
        } else {
          const mine = m.sender_profile === data.room.my_profile_id;
          lines.push(`${mine ? 'Tu' : otherName}: ${escapeHtml((m.body || '').slice(0, 300))}`);
        }
      }
    }

    if (live) {
      rows.push([Markup.button.callback('✉️ Scrivi messaggio', 'cards:rsend')]);
      rows.push([Markup.button.callback('🔁 Proponi scambio', 'cards:rgive')]);
    }
    rows.push([Markup.button.callback('« Stanze', 'cards:tr:rooms')]);
    await renderView(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  }

  bot.action(/^cards:room:(.+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      st.pendingPublicSuggested = null;
      await openRoom(ctx, st, ctx.match[1]);
    });
  });

  bot.action(/^cards:pubprop:(\d+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const rs = roomByUid.get(ctx.from.id);
      const m = (st.roomSuggested || [])[Number(ctx.match[1])];
      if (!rs || !m) return;
      await cardsApi.propose(st.token, {
        roomId: rs.roomId,
        profileId: rs.myProfileId,
        cardGive: m.card_give,
        cardGet: m.card_get,
      });
      st.roomSuggested = (st.roomSuggested || []).filter((_, i) => i !== Number(ctx.match[1]));
      await replyTransient(ctx, '✅ Proposta inviata!', { parse_mode: 'HTML' }, 4000);
      await openRoom(ctx, st, rs.roomId, { keepSuggested: true });
    });
  });

  bot.action('cards:rsend', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    const rs = roomByUid.get(ctx.from.id);
    if (!rs) return;
    pendingChatByUid.set(ctx.from.id, { roomId: rs.roomId });
    await ctx.reply('✉️ Scrivi il messaggio da inviare nella stanza (testo libero).\n/cancel per annullare.', {
      parse_mode: 'HTML',
    });
  });

  bot.action('cards:rgive', async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const rs = roomByUid.get(ctx.from.id);
      if (!rs) return;
      const p = activeProfile(st);
      const coll = activeColl(st);
      const dupes = st.catalog.cards.filter((c) => (coll[c.key] || 0) >= 2);
      const text =
        `${fmt.DIV}\n🔁 Proponi scambio\n${fmt.DIV}\n\n` +
        `Profilo: <b>${escapeHtml(profileLabel(p))}</b>\n\nScegli la carta che <b>cedi</b> (doppione):`;
      const rows = dupes.map((c) => [Markup.button.callback(`${c.name_it} (${st.catalog.category_label_it[c.category] || c.category})`.slice(0, 60), `cards:rgive:${c.key}`)]);
      if (!dupes.length) rows.push([Markup.button.callback('Nessun doppione disponibile', 'noop')]);
      rows.push([Markup.button.callback('« Stanza', `cards:room:${rs.roomId}`)]);
      await renderView(ctx, text, Markup.inlineKeyboard(rows));
    });
  });

  bot.action(/^cards:rgive:(.+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const rs = roomByUid.get(ctx.from.id);
      if (!rs) return;
      const giveKey = ctx.match[1];
      const giveCard = st.catalog.cards.find((c) => c.key === giveKey);
      if (!giveCard) return;
      rs.proposeGive = giveKey;
      const coll = activeColl(st);
      const missing = st.catalog.cards.filter((c) => c.category === giveCard.category && (coll[c.key] || 0) === 0);
      const text =
        `${fmt.DIV}\n🔁 Proponi scambio\n${fmt.DIV}\n\n` +
        `Cedi: <b>${escapeHtml(giveCard.name_it)}</b>\n\nScegli la carta che vuoi <b>ricevere</b> (stessa categoria):`;
      const rows = missing.map((c) => [Markup.button.callback(c.name_it.slice(0, 60), `cards:rget:${c.key}`)]);
      if (!missing.length) rows.push([Markup.button.callback('Nessuna carta mancante in questa categoria', 'noop')]);
      rows.push([Markup.button.callback('« Annulla', `cards:room:${rs.roomId}`)]);
      await renderView(ctx, text, Markup.inlineKeyboard(rows));
    });
  });

  bot.action(/^cards:rget:(.+)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const rs = roomByUid.get(ctx.from.id);
      if (!rs || !rs.proposeGive) return;
      const getKey = ctx.match[1];
      await cardsApi.propose(st.token, {
        roomId: rs.roomId,
        profileId: rs.myProfileId,
        cardGive: rs.proposeGive,
        cardGet: getKey,
      });
      rs.proposeGive = null;
      await replyTransient(ctx, '✅ Proposta inviata.', { parse_mode: 'HTML' }, 3000);
      await openRoom(ctx, st, rs.roomId);
    });
  });

  bot.action(/^cards:resp:(.+):(accept|reject|cancel)$/, async (ctx) => {
    if (guard(ctx)) return;
    safeAnswerCb(ctx);
    await withErrors(ctx, async () => {
      const st = await ensureState(sb, tauth, ctx.from.id);
      const rs = roomByUid.get(ctx.from.id);
      if (!rs) return;
      const proposalId = ctx.match[1];
      const action = ctx.match[2];
      await cardsApi.respond(st.token, { proposalId, profileId: rs.myProfileId, action });
      if (action === 'accept') await refreshCollection(sb, tauth, ctx.from.id);
      await openRoom(ctx, st, rs.roomId);
    });
  });

  return {
    clearUserState,
    async handlePendingText(ctx) {
      const uid = ctx.from?.id;
      if (uid == null) return false;
      const pending = pendingChatByUid.get(uid);
      if (!pending) return false;
      const txt = String(ctx.message?.text || '').trim();
      if (txt === '/cancel') {
        pendingChatByUid.delete(uid);
        await replyTransient(ctx, 'Annullato.', { parse_mode: 'HTML' });
        return true;
      }
      pendingChatByUid.delete(uid);
      const rs = roomByUid.get(uid);
      if (!rs) {
        await replyTransient(ctx, '⚠️ Stanza non più disponibile, riapri da "Le mie stanze".', { parse_mode: 'HTML' });
        return true;
      }
      try {
        const st = await ensureState(sb, tauth, uid);
        await cardsApi.roomSend(st.token, { roomId: rs.roomId, profileId: rs.myProfileId, body: txt });
        await replyTransient(ctx, '✅ Messaggio inviato.', { parse_mode: 'HTML' }, 2500);
        await openRoom(ctx, st, rs.roomId);
      } catch (e) {
        await replyTransient(ctx, `❌ ${escapeHtml(e.message || 'Errore invio messaggio.')}`, { parse_mode: 'HTML' });
      }
      return true;
    },
  };
}

module.exports = { setup };

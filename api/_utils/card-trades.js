'use strict';

/**
 * Evento "Clash of Cards" — Fase 2: matching, room 1-a-1, room self, chat, storico.
 * Il matching vero e proprio gira lato Postgres (find_card_matches / find_self_card_matches
 * / apply_card_trade in schema-card-event-trades.sql) per restare dentro al limite di
 * 12 serverless function di Vercel Hobby ed evitare N+1 query lato Node.
 */

const profilesUtil = require('./user-profiles');
const cardEvent = require('./card-event');
const { CARD_BY_KEY } = require('./card-event-catalog');

function err(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function requireEventLive(admin) {
  const settings = await cardEvent.getSettings(admin);
  if (!cardEvent.isEventLive(settings)) {
    throw err(403, 'Evento Clash of Cards non attivo.', 'EVENT_NOT_LIVE');
  }
}

async function myProfileOr403(admin, user, profileId) {
  const { data, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('id', profileId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw err(403, 'Profilo non collegato al tuo account.');
  return data;
}

async function publicProfilesByIds(admin, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await admin
    .from('user_coc_profiles')
    .select('id, coc_tag, username, coc_clan_name, coc_clan_badge_url, town_hall_level')
    .in('id', uniq);
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.id] = row;
  return map;
}

function cardMeta(cardKey) {
  const c = CARD_BY_KEY.get(cardKey);
  return c ? { name_it: c.name_it, name_en: c.name_en, icon_url: c.icon_url, category: c.category } : null;
}

function enrichCardKeys(row, keys) {
  const out = { ...row };
  for (const k of keys) out[`${k}_meta`] = cardMeta(row[k]);
  return out;
}

// ── NOTIFICHE (outbox → bot Telegram) ────────────────────────────────────
// Best-effort: un fallimento qui non deve mai rompere il flusso di scambio.
async function queueNotification(admin, { userId, kind, dedupeKey, payload }) {
  if (!userId || !dedupeKey) return;
  try {
    await admin
      .from('card_event_notify_outbox')
      .upsert(
        { user_id: userId, kind, dedupe_key: String(dedupeKey), payload: payload || {} },
        { onConflict: 'user_id,kind,dedupe_key', ignoreDuplicates: true },
      );
  } catch (_) {
    // silenzioso: le notifiche sono un extra, non devono bloccare lo scambio
  }
}

async function profileUserId(admin, profileId) {
  const { data } = await admin.from('user_coc_profiles').select('id, user_id, username').eq('id', profileId).maybeSingle();
  return data || null;
}

/**
 * Dopo che un profilo aggiorna la sua collezione, ricalcola i match p2p per quel tag
 * e accoda una notifica sia per il proprietario del tag sia per la controparte
 * (i dati del match dalla prospettiva di A bastano per costruire anche quella di B,
 * evitando una seconda chiamata RPC per ogni avversario).
 */
async function notifyMatchesForTag(admin, cocTag) {
  try {
    const { data: matches, error } = await admin.rpc('find_card_matches', { p_coc_tag: cocTag });
    if (error || !matches?.length) return;
    const { data: me } = await admin.from('user_coc_profiles').select('id, user_id, username, coc_tag').eq('coc_tag', cocTag).maybeSingle();
    if (!me) return;
    const otherTags = [...new Set(matches.map((m) => m.other_coc_tag))];
    const { data: others } = await admin
      .from('user_coc_profiles')
      .select('id, user_id, username, coc_tag')
      .in('coc_tag', otherTags);
    const otherByTag = Object.fromEntries((others || []).map((p) => [p.coc_tag, p]));

    for (const m of matches) {
      const other = otherByTag[m.other_coc_tag];
      if (!other) continue;
      const giveMeta = cardMeta(m.card_give);
      const getMeta = cardMeta(m.card_get);
      await queueNotification(admin, {
        userId: me.user_id,
        kind: 'match',
        dedupeKey: `${me.coc_tag}|${other.coc_tag}|${m.card_give}|${m.card_get}`,
        payload: {
          my_coc_tag: me.coc_tag,
          other_coc_tag: other.coc_tag,
          other_username: other.username,
          card_give: m.card_give,
          card_get: m.card_get,
          card_give_name: giveMeta?.name_it,
          card_get_name: getMeta?.name_it,
        },
      });
      await queueNotification(admin, {
        userId: other.user_id,
        kind: 'match',
        dedupeKey: `${other.coc_tag}|${me.coc_tag}|${m.card_get}|${m.card_give}`,
        payload: {
          my_coc_tag: other.coc_tag,
          other_coc_tag: me.coc_tag,
          other_username: me.username,
          card_give: m.card_get,
          card_get: m.card_give,
          card_give_name: getMeta?.name_it,
          card_get_name: giveMeta?.name_it,
        },
      });
    }
  } catch (_) {
    // best-effort
  }
}

// ── MATCHING ────────────────────────────────────────────────────────────

async function getMatchesForProfile(admin, user, profileId) {
  const me = await myProfileOr403(admin, user, profileId);
  const { data, error } = await admin.rpc('find_card_matches', { p_coc_tag: me.coc_tag });
  if (error) throw error;
  // find_card_matches non restituisce l'id profilo (solo coc_tag), risolviamolo in batch
  const tags = [...new Set((data || []).map((m) => m.other_coc_tag))];
  let profileByTag = {};
  if (tags.length) {
    const { data: rows, error: e2 } = await admin
      .from('user_coc_profiles')
      .select('id, coc_tag, username, coc_clan_name, coc_clan_badge_url, town_hall_level')
      .in('coc_tag', tags);
    if (e2) throw e2;
    profileByTag = Object.fromEntries((rows || []).map((r) => [r.coc_tag, r]));
  }
  return {
    ok: true,
    profile: profilesUtil.profileToPublic(me),
    matches: (data || []).map((m) =>
      enrichCardKeys(
        {
          other_profile: profileByTag[m.other_coc_tag] || { coc_tag: m.other_coc_tag },
          card_give: m.card_give,
          card_get: m.card_get,
          category: m.category,
        },
        ['card_give', 'card_get'],
      ),
    ),
  };
}

async function getSelfMatches(admin, user) {
  const { data, error } = await admin.rpc('find_self_card_matches', { p_user_id: user.id });
  if (error) throw error;
  const ids = [];
  for (const m of data || []) {
    ids.push(m.profile_a, m.profile_b);
  }
  const profiles = await publicProfilesByIds(admin, ids);
  return {
    ok: true,
    matches: (data || []).map((m) =>
      enrichCardKeys(
        {
          profile_a: profiles[m.profile_a] || { id: m.profile_a, coc_tag: m.coc_tag_a },
          profile_b: profiles[m.profile_b] || { id: m.profile_b, coc_tag: m.coc_tag_b },
          card_a_to_b: m.card_a_to_b,
          card_b_to_a: m.card_b_to_a,
          category: m.category,
          // "Semaforo": verde = lo scambio sblocca davvero una carta nuova per quel lato,
          // giallo = il lato la possiede già (non necessario ma comunque possibile).
          a_is_new: m.a_already_has_target !== true,
          b_is_new: m.b_already_has_target !== true,
        },
        ['card_a_to_b', 'card_b_to_a'],
      ),
    ),
  };
}

// ── MAZZI PUBBLICI (vetrina) ──────────────────────────────────────────────

async function setProfilePublic(admin, user, profileId, isPublic) {
  const me = await myProfileOr403(admin, user, profileId);
  const { data, error } = await admin
    .from('user_coc_profiles')
    .update({ card_deck_public: isPublic === true })
    .eq('id', me.id)
    .select('*')
    .single();
  if (error) throw error;
  return { ok: true, profile: profilesUtil.profileToPublic(data) };
}

/**
 * Elenco dei mazzi pubblici di ALTRI account CoCBoard, con i possibili scambi
 * verso il profilo attivo (riusa find_card_matches, già globale, filtrando
 * solo le controparti che hanno scelto di pubblicare il proprio mazzo).
 *
 * Ogni voce è un "post" completo: include l'intera collezione (card_key → qty)
 * del mazzo pubblicato, così chi lo consulta vede subito tutte le carte
 * possedute dall'altro utente, oltre alle combinazioni di scambio automatiche.
 */
async function listPublicDecks(admin, user, myProfileId) {
  const me = await myProfileOr403(admin, user, myProfileId);

  const { data: publicProfiles, error: e1 } = await admin
    .from('user_coc_profiles')
    .select('id, coc_tag, username, coc_clan_name, coc_clan_badge_url, town_hall_level, user_id')
    .eq('card_deck_public', true)
    .neq('user_id', user.id);
  if (e1) throw e1;

  const otherTags = (publicProfiles || []).map((p) => p.coc_tag).filter((t) => t !== me.coc_tag);

  const [{ data: matches, error: e2 }, { data: collRows, error: e3 }] = await Promise.all([
    admin.rpc('find_card_matches', { p_coc_tag: me.coc_tag }),
    otherTags.length
      ? admin.from('card_event_collections').select('coc_tag, card_key, qty_state').in('coc_tag', otherTags)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const matchesByTag = {};
  for (const m of matches || []) {
    (matchesByTag[m.other_coc_tag] = matchesByTag[m.other_coc_tag] || []).push(
      enrichCardKeys({ card_give: m.card_give, card_get: m.card_get, category: m.category }, ['card_give', 'card_get']),
    );
  }

  const collectionByTag = {};
  for (const row of collRows || []) {
    if (!row.qty_state) continue; // esponi solo le carte effettivamente possedute (0 = non trovata)
    (collectionByTag[row.coc_tag] = collectionByTag[row.coc_tag] || {})[row.card_key] = row.qty_state;
  }

  return {
    ok: true,
    my_public: me.card_deck_public === true,
    decks: (publicProfiles || [])
      .filter((p) => p.coc_tag !== me.coc_tag)
      .map((p) => ({
        profile: profilesUtil.profileToPublic(p),
        matches: matchesByTag[p.coc_tag] || [],
        collection: collectionByTag[p.coc_tag] || {},
      }))
      .sort((a, b) => (b.matches.length || 0) - (a.matches.length || 0)),
  };
}

// ── ROOM 1-A-1 ──────────────────────────────────────────────────────────

function sortPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function getOrCreateRoom(admin, user, myProfileId, otherCocTag) {
  const me = await myProfileOr403(admin, user, myProfileId);
  const { data: other, error: e1 } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('coc_tag', String(otherCocTag || '').toUpperCase())
    .maybeSingle();
  if (e1) throw e1;
  if (!other) throw err(404, 'Profilo avversario non trovato.');
  if (other.user_id === user.id) {
    throw err(400, 'Per scambiare tra i tuoi profili usa la stanza personale.', 'USE_SELF_ROOM');
  }

  const [lo, hi] = sortPair(me.id, other.id);
  let { data: room, error: e2 } = await admin
    .from('card_event_rooms')
    .select('*')
    .eq('profile_lo', lo)
    .eq('profile_hi', hi)
    .maybeSingle();
  if (e2) throw e2;
  if (!room) {
    const { data: created, error: e3 } = await admin
      .from('card_event_rooms')
      .insert({ profile_lo: lo, profile_hi: hi })
      .select('*')
      .single();
    if (e3) throw e3;
    room = created;
  }
  return getRoomDetail(admin, user, room.id, { room, me, other });
}

async function myProfileIdsSet(admin, userId) {
  const { data, error } = await admin.from('user_coc_profiles').select('id').eq('user_id', userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.id));
}

async function getRoomDetail(admin, user, roomId, preloaded) {
  let room = preloaded?.room || null;
  if (!room) {
    const { data, error } = await admin.from('card_event_rooms').select('*').eq('id', roomId).maybeSingle();
    if (error) throw error;
    room = data;
  }
  if (!room) throw err(404, 'Stanza non trovata.');

  const mineSet = await myProfileIdsSet(admin, user.id);
  const myProfileId = [room.profile_lo, room.profile_hi].find((pid) => mineSet.has(pid));
  if (!myProfileId) throw err(403, 'Non fai parte di questa stanza.');
  const otherProfileId = room.profile_lo === myProfileId ? room.profile_hi : room.profile_lo;

  const profilesMap =
    preloaded?.me && preloaded?.other
      ? { [preloaded.me.id]: preloaded.me, [preloaded.other.id]: preloaded.other }
      : await publicProfilesByIds(admin, [myProfileId, otherProfileId]);

  const [{ data: messages, error: e1 }, { data: proposals, error: e2 }] = await Promise.all([
    admin
      .from('card_event_room_messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .limit(200),
    admin
      .from('card_event_proposals')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  return {
    ok: true,
    room: {
      id: room.id,
      created_at: room.created_at,
      my_profile_id: myProfileId,
      other_profile_id: otherProfileId,
    },
    me: profilesUtil.profileToPublic(profilesMap[myProfileId]),
    other: profilesUtil.profileToPublic(profilesMap[otherProfileId]),
    messages: messages || [],
    proposals: (proposals || []).map((p) => enrichCardKeys(p, ['card_give', 'card_get'])),
  };
}

async function listRoomsForUser(admin, user) {
  const mine = await profilesUtil.listProfiles(admin, user.id);
  const ids = mine.map((p) => p.id);
  if (!ids.length) return { ok: true, rooms: [] };

  const { data: rooms, error } = await admin
    .from('card_event_rooms')
    .select('*')
    .or(`profile_lo.in.(${ids.join(',')}),profile_hi.in.(${ids.join(',')})`)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  if (!rooms?.length) return { ok: true, rooms: [] };

  const mineSet = new Set(ids);
  const otherIds = rooms.map((r) => (mineSet.has(r.profile_lo) ? r.profile_hi : r.profile_lo));
  const myIds = rooms.map((r) => (mineSet.has(r.profile_lo) ? r.profile_lo : r.profile_hi));
  const allProfiles = await publicProfilesByIds(admin, [...otherIds, ...myIds]);

  const roomIds = rooms.map((r) => r.id);
  const { data: lastMsgs } = await admin
    .from('card_event_room_messages')
    .select('room_id, body, kind, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false });
  const lastByRoom = {};
  for (const m of lastMsgs || []) {
    if (!lastByRoom[m.room_id]) lastByRoom[m.room_id] = m;
  }
  const { data: pendingProposals } = await admin
    .from('card_event_proposals')
    .select('room_id, status')
    .in('room_id', roomIds)
    .eq('status', 'pending');
  const pendingByRoom = {};
  for (const p of pendingProposals || []) pendingByRoom[p.room_id] = (pendingByRoom[p.room_id] || 0) + 1;

  return {
    ok: true,
    rooms: rooms.map((r, i) => ({
      id: r.id,
      my_profile: profilesUtil.profileToPublic(allProfiles[myIds[i]]),
      other_profile: profilesUtil.profileToPublic(allProfiles[otherIds[i]]),
      last_message: lastByRoom[r.id] || null,
      pending_proposals: pendingByRoom[r.id] || 0,
      updated_at: r.updated_at,
    })),
  };
}

async function sendRoomMessage(admin, user, roomId, myProfileId, bodyText) {
  await requireEventLive(admin);
  const me = await myProfileOr403(admin, user, myProfileId);
  const text = String(bodyText || '').trim().slice(0, 500);
  if (!text) throw err(400, 'Messaggio vuoto.');

  const { data: room, error: eRoom } = await admin
    .from('card_event_rooms')
    .select('id, profile_lo, profile_hi')
    .eq('id', roomId)
    .maybeSingle();
  if (eRoom) throw eRoom;
  if (!room || (room.profile_lo !== me.id && room.profile_hi !== me.id)) {
    throw err(403, 'Non fai parte di questa stanza.');
  }

  const { data: msg, error } = await admin
    .from('card_event_room_messages')
    .insert({ room_id: roomId, sender_profile: me.id, kind: 'text', body: text })
    .select('*')
    .single();
  if (error) throw error;
  await admin.from('card_event_rooms').update({ updated_at: new Date().toISOString() }).eq('id', roomId);

  const otherProfileId = room.profile_lo === me.id ? room.profile_hi : room.profile_lo;
  const other = await profileUserId(admin, otherProfileId);
  if (other?.user_id) {
    queueNotification(admin, {
      userId: other.user_id,
      kind: 'message',
      dedupeKey: msg.id,
      payload: { room_id: roomId, sender_username: me.username, body: text },
    });
  }

  return { ok: true, message: msg };
}

function assertCard(cardKey) {
  const c = CARD_BY_KEY.get(cardKey);
  if (!c) throw err(400, `Carta non riconosciuta: ${cardKey}`);
  return c;
}

async function proposeTrade(admin, user, roomId, myProfileId, cardGive, cardGet) {
  await requireEventLive(admin);
  const me = await myProfileOr403(admin, user, myProfileId);
  const give = assertCard(cardGive);
  const get = assertCard(cardGet);
  if (give.category !== get.category) throw err(400, 'Le due carte devono essere della stessa categoria.');

  const { data: room, error: eRoom } = await admin
    .from('card_event_rooms')
    .select('id, profile_lo, profile_hi')
    .eq('id', roomId)
    .maybeSingle();
  if (eRoom) throw eRoom;
  if (!room || (room.profile_lo !== me.id && room.profile_hi !== me.id)) {
    throw err(403, 'Non fai parte di questa stanza.');
  }
  const otherId = room.profile_lo === me.id ? room.profile_hi : room.profile_lo;
  const { data: other, error: eOther } = await admin
    .from('user_coc_profiles')
    .select('coc_tag')
    .eq('id', otherId)
    .single();
  if (eOther) throw eOther;

  const { data: rows, error: eColl } = await admin
    .from('card_event_collections')
    .select('coc_tag, card_key, qty_state')
    .in('coc_tag', [me.coc_tag, other.coc_tag])
    .in('card_key', [cardGive, cardGet]);
  if (eColl) throw eColl;
  const state = (tag, key) => rows.find((r) => r.coc_tag === tag && r.card_key === key)?.qty_state ?? 0;

  if (state(me.coc_tag, cardGive) < 2) throw err(400, 'Non hai un doppione di questa carta.');
  if (state(me.coc_tag, cardGet) !== 0) throw err(400, 'Hai già sbloccato la carta richiesta.');
  if (state(other.coc_tag, cardGive) !== 0) throw err(400, "L'altro giocatore ha già sbloccato questa carta.");
  if (state(other.coc_tag, cardGet) < 2) throw err(400, "L'altro giocatore non ha un doppione di quella carta.");

  const { data: proposal, error } = await admin
    .from('card_event_proposals')
    .insert({
      room_id: roomId,
      proposer_profile: me.id,
      card_give: cardGive,
      card_get: cardGet,
      category: give.category,
    })
    .select('*')
    .single();
  if (error) throw error;

  await admin.from('card_event_room_messages').insert({
    room_id: roomId,
    sender_profile: me.id,
    kind: 'proposal',
    proposal_id: proposal.id,
    body: `Propone: cede ${give.name_it} → riceve ${get.name_it}`,
  });
  await admin.from('card_event_rooms').update({ updated_at: new Date().toISOString() }).eq('id', roomId);

  const otherProfile = await profileUserId(admin, otherId);
  if (otherProfile?.user_id) {
    queueNotification(admin, {
      userId: otherProfile.user_id,
      kind: 'proposal',
      dedupeKey: proposal.id,
      payload: {
        room_id: roomId,
        proposer_username: me.username,
        card_give: cardGive,
        card_get: cardGet,
        card_give_name: give.name_it,
        card_get_name: get.name_it,
      },
    });
  }

  return { ok: true, proposal: enrichCardKeys(proposal, ['card_give', 'card_get']) };
}

async function respondProposal(admin, user, proposalId, myProfileId, action) {
  const me = await myProfileOr403(admin, user, myProfileId);
  const { data: proposal, error } = await admin
    .from('card_event_proposals')
    .select('*, card_event_rooms!inner(id, profile_lo, profile_hi)')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw err(404, 'Proposta non trovata.');
  const room = proposal.card_event_rooms;
  if (room.profile_lo !== me.id && room.profile_hi !== me.id) throw err(403, 'Non fai parte di questa stanza.');
  if (proposal.status !== 'pending') throw err(400, 'Questa proposta è già stata gestita.');

  const otherId = room.profile_lo === proposal.proposer_profile ? room.profile_hi : room.profile_lo;

  if (action === 'cancel') {
    if (proposal.proposer_profile !== me.id) throw err(403, 'Solo chi ha proposto può annullare.');
    await admin.from('card_event_proposals').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', proposalId);
    await admin.from('card_event_room_messages').insert({ room_id: room.id, kind: 'system', body: 'Proposta annullata.' });
    return { ok: true, status: 'cancelled' };
  }

  if (action === 'reject') {
    await admin.from('card_event_proposals').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', proposalId);
    await admin.from('card_event_room_messages').insert({ room_id: room.id, kind: 'system', body: 'Proposta rifiutata.' });
    return { ok: true, status: 'rejected' };
  }

  if (action === 'accept') {
    if (proposal.proposer_profile === me.id) throw err(403, 'Non puoi accettare la tua stessa proposta.');
    await requireEventLive(admin);
    const { error: rpcErr } = await admin.rpc('apply_card_trade', {
      p_kind: 'p2p',
      p_profile_a: proposal.proposer_profile,
      p_profile_b: otherId,
      p_card_a_gave: proposal.card_give,
      p_card_b_gave: proposal.card_get,
      p_room_id: room.id,
      p_proposal_id: proposalId,
    });
    if (rpcErr) throw err(400, rpcErr.message || 'Scambio non applicabile (collezioni cambiate).');
    const giveMeta = cardMeta(proposal.card_give);
    const getMeta = cardMeta(proposal.card_get);
    await admin.from('card_event_room_messages').insert({
      room_id: room.id,
      kind: 'system',
      body: `Scambio completato: ${giveMeta?.name_it || proposal.card_give} ↔ ${getMeta?.name_it || proposal.card_get}`,
    });
    const proposer = await profileUserId(admin, proposal.proposer_profile);
    if (proposer?.user_id) {
      queueNotification(admin, {
        userId: proposer.user_id,
        kind: 'trade_done',
        dedupeKey: proposalId,
        payload: {
          room_id: room.id,
          accepted_by_username: me.username,
          card_give: proposal.card_give,
          card_get: proposal.card_get,
          card_give_name: giveMeta?.name_it,
          card_get_name: getMeta?.name_it,
        },
      });
    }
    return { ok: true, status: 'accepted' };
  }

  throw err(400, 'Azione non valida.');
}

// ── ROOM SELF (stesso account, applicazione diretta) ─────────────────────

async function applySelfTrade(admin, user, profileAId, profileBId, cardAToB, cardBToA) {
  await requireEventLive(admin);
  const a = await myProfileOr403(admin, user, profileAId);
  const b = await myProfileOr403(admin, user, profileBId);
  if (a.id === b.id) throw err(400, 'Seleziona due profili diversi.');
  const give = assertCard(cardAToB);
  const get = assertCard(cardBToA);
  if (give.category !== get.category) throw err(400, 'Le due carte devono essere della stessa categoria.');

  const { error: rpcErr } = await admin.rpc('apply_card_trade', {
    p_kind: 'self',
    p_profile_a: a.id,
    p_profile_b: b.id,
    p_card_a_gave: cardAToB,
    p_card_b_gave: cardBToA,
    p_room_id: null,
    p_proposal_id: null,
  });
  if (rpcErr) throw err(400, rpcErr.message || 'Scambio non applicabile (collezioni cambiate).');
  return { ok: true };
}

async function getTradeLog(admin, user) {
  const mine = await profilesUtil.listProfiles(admin, user.id);
  const ids = mine.map((p) => p.id);
  if (!ids.length) return { ok: true, log: [] };
  const { data, error } = await admin
    .from('card_event_trade_log')
    .select('*')
    .or(`profile_a.in.(${ids.join(',')}),profile_b.in.(${ids.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const allIds = [];
  for (const row of data || []) allIds.push(row.profile_a, row.profile_b);
  const profiles = await publicProfilesByIds(admin, allIds);
  return {
    ok: true,
    log: (data || []).map((row) =>
      enrichCardKeys(
        {
          ...row,
          profile_a: profiles[row.profile_a] ? profilesUtil.profileToPublic(profiles[row.profile_a]) : null,
          profile_b: profiles[row.profile_b] ? profilesUtil.profileToPublic(profiles[row.profile_b]) : null,
        },
        ['card_a_gave', 'card_b_gave'],
      ),
    ),
  };
}

module.exports = {
  getMatchesForProfile,
  getSelfMatches,
  setProfilePublic,
  listPublicDecks,
  getOrCreateRoom,
  getRoomDetail,
  listRoomsForUser,
  sendRoomMessage,
  proposeTrade,
  respondProposal,
  applySelfTrade,
  getTradeLog,
  notifyMatchesForTag,
};

'use strict';

/**
 * Evento "Clash of Cards" — Fase 2: matching, room 1-a-1, room self, chat, storico.
 * Il matching vero e proprio gira lato Postgres (find_card_matches / find_self_card_matches
 * / apply_card_trade in schema-card-event-trades.sql) per restare dentro al limite di
 * 12 serverless function di Vercel Hobby ed evitare N+1 query lato Node.
 */

const profilesUtil = require('./user-profiles');
const cardEvent = require('./card-event');
const { CARD_BY_KEY, CARD_EVENT_CATALOG } = require('./card-event-catalog');
const notifyPrefs = require('./card-notify-prefs');

function err(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/**
 * Matching P2P (account diversi):
 * - cedi solo doppioni (qty >= 2)
 * - ricevi solo carte che non possiedi (qty === 0): il proponente deve beneficiare
 * - l'altro può già avere la carta che riceve (aggiunge al conteggio)
 * - stessa categoria, carte diverse
 * Usa le mappe card_key → qty (assenza = 0). Non dipende da righe qty=0 in DB.
 */
function computeP2pMatches(myColl, otherColl) {
  const mine = myColl || {};
  const other = otherColl || {};
  const qty = (map, key) => Number(map[key] || 0);
  const out = [];
  for (const give of CARD_EVENT_CATALOG) {
    if (qty(mine, give.key) < 2) continue;
    for (const get of CARD_EVENT_CATALOG) {
      if (get.category !== give.category) continue;
      if (get.key === give.key) continue;
      if (qty(other, get.key) < 2) continue;
      const iUnlock = qty(mine, get.key) === 0;
      const theyUnlock = qty(other, give.key) === 0;
      // Mostra il match se almeno uno sblocca. Chi già possiede riceve un doppione.
      // Solo chi sblocca (i_unlock) può proporre: il gioco vieta di scambiare senza beneficio.
      if (!iUnlock && !theyUnlock) continue;
      out.push({
        card_give: give.key,
        card_get: get.key,
        category: give.category,
        i_unlock: iUnlock,
        they_unlock: theyUnlock,
      });
    }
  }
  return out;
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
  const { data } = await admin.from('user_coc_profiles').select('id, user_id, username, coc_tag').eq('id', profileId).maybeSingle();
  return data || null;
}

/**
 * Dopo che un profilo aggiorna la sua collezione, ricalcola i match p2p per quel tag
 * e accoda una notifica sia per il proprietario del tag sia per la controparte
 * (i dati del match dalla prospettiva di A bastano per costruire anche quella di B,
 * evitando una seconda chiamata RPC per ogni avversario).
 */
function matchNotifyPayload(me, other, cardGive, cardGet, iUnlock, theyUnlock) {
  const giveMeta = cardMeta(cardGive);
  const getMeta = cardMeta(cardGet);
  return {
    my_profile_id: me.id,
    my_coc_tag: me.coc_tag,
    my_username: me.username || null,
    my_clan_name: me.coc_clan_name || null,
    other_coc_tag: other.coc_tag,
    other_username: other.username || null,
    other_clan_name: other.coc_clan_name || null,
    card_give: cardGive,
    card_get: cardGet,
    card_give_name: giveMeta?.name_it,
    card_get_name: getMeta?.name_it,
    i_unlock: iUnlock === true,
    they_unlock: theyUnlock === true,
  };
}

async function notifyMatchesForTag(admin, cocTag) {
  try {
    const { data: me } = await admin
      .from('user_coc_profiles')
      .select('id, user_id, username, coc_tag, coc_clan_name')
      .eq('coc_tag', cocTag)
      .maybeSingle();
    if (!me) return;

    const { data: others } = await admin
      .from('user_coc_profiles')
      .select('id, user_id, username, coc_tag, coc_clan_name')
      .neq('user_id', me.user_id);
    if (!others?.length) return;

    const tags = [me.coc_tag, ...others.map((p) => p.coc_tag).filter(Boolean)];
    const { data: collRows } = await admin
      .from('card_event_collections')
      .select('coc_tag, card_key, qty_state')
      .in('coc_tag', tags);
    const collByTag = {};
    for (const tag of tags) collByTag[tag] = {};
    for (const row of collRows || []) {
      if (!collByTag[row.coc_tag]) collByTag[row.coc_tag] = {};
      collByTag[row.coc_tag][row.card_key] = row.qty_state;
    }

    const prefsMap = await notifyPrefs.getPrefsMap(admin, [me.user_id, ...others.map((p) => p.user_id)]);
    const myColl = collByTag[me.coc_tag] || {};
    for (const other of others) {
      const pair = computeP2pMatches(myColl, collByTag[other.coc_tag] || {});
      if (!pair.length) continue;
      const clanMate = notifyPrefs.sameClanName(me.coc_clan_name, other.coc_clan_name);
      for (const m of pair) {
        if (notifyPrefs.shouldNotifyMatch(prefsMap[me.user_id], {
          iUnlock: m.i_unlock === true,
          theyUnlock: m.they_unlock === true,
          sameClan: clanMate,
        })) {
          await queueNotification(admin, {
            userId: me.user_id,
            kind: 'match',
            dedupeKey: `${me.coc_tag}|${other.coc_tag}|${m.card_give}|${m.card_get}`,
            payload: matchNotifyPayload(me, other, m.card_give, m.card_get, m.i_unlock, m.they_unlock),
          });
        }
        if (notifyPrefs.shouldNotifyMatch(prefsMap[other.user_id], {
          iUnlock: m.they_unlock === true,
          theyUnlock: m.i_unlock === true,
          sameClan: clanMate,
        })) {
          await queueNotification(admin, {
            userId: other.user_id,
            kind: 'match',
            dedupeKey: `${other.coc_tag}|${me.coc_tag}|${m.card_get}|${m.card_give}`,
            payload: matchNotifyPayload(other, me, m.card_get, m.card_give, m.they_unlock, m.i_unlock),
          });
        }
      }
    }
  } catch (_) {
    // best-effort
  }
}

// ── MATCHING ────────────────────────────────────────────────────────────

/**
 * Scambi suggeriti con altri account CoCBoard. Se profileId è fornito, comportamento
 * legacy (solo quel profilo, compat con vecchie chiamate). Se omesso, calcola i match
 * per TUTTI i profili CoC dell'utente contemporaneamente: ogni match indica con quale
 * mio profilo (my_profile) si applica — l'utente non deve più scegliere un profilo
 * "attivo" per vedere tutti gli scambi possibili.
 */
async function getMatchesForProfile(admin, user, profileId) {
  const myProfiles = profileId
    ? [await myProfileOr403(admin, user, profileId)]
    : await profilesUtil.listProfiles(admin, user.id);
  if (!myProfiles.length) return { ok: true, profile: null, matches: [] };

  const myTags = myProfiles.map((p) => p.coc_tag);

  const { data: publicProfiles, error: ePub } = await admin
    .from('user_coc_profiles')
    .select('id, coc_tag, username, coc_clan_name, coc_clan_badge_url, town_hall_level, user_id')
    .neq('user_id', user.id);
  if (ePub) throw ePub;

  const otherTags = (publicProfiles || []).map((p) => p.coc_tag).filter((t) => t && !myTags.includes(t));
  const tagsToLoad = [...myTags, ...otherTags];
  const { data: collRows, error: eColl } = tagsToLoad.length
    ? await admin.from('card_event_collections').select('coc_tag, card_key, qty_state').in('coc_tag', tagsToLoad)
    : { data: [], error: null };
  if (eColl) throw eColl;

  const collByTag = {};
  for (const tag of tagsToLoad) collByTag[tag] = {};
  for (const row of collRows || []) {
    if (!collByTag[row.coc_tag]) collByTag[row.coc_tag] = {};
    collByTag[row.coc_tag][row.card_key] = row.qty_state;
  }

  const profileByTag = Object.fromEntries((publicProfiles || []).map((r) => [r.coc_tag, r]));
  const matches = [];
  for (const myProfile of myProfiles) {
    for (const tag of otherTags) {
      const pair = computeP2pMatches(collByTag[myProfile.coc_tag], collByTag[tag]);
      for (const m of pair) {
        matches.push(
          enrichCardKeys(
            {
              my_profile: profilesUtil.profileToPublic(myProfile),
              other_profile: profileByTag[tag] || { coc_tag: tag },
              card_give: m.card_give,
              card_get: m.card_get,
              category: m.category,
              i_unlock: m.i_unlock !== false,
              they_unlock: m.they_unlock === true,
            },
            ['card_give', 'card_get'],
          ),
        );
      }
    }
  }

  return {
    ok: true,
    profile: profilesUtil.profileToPublic(myProfiles[0]),
    profiles: myProfiles.map(profilesUtil.profileToPublic),
    matches,
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
 * Elenco dei mazzi pubblici di ALTRI account CoCBoard, con i possibili scambi.
 * Se myProfileId è fornito, comportamento legacy (solo quel profilo). Se omesso,
 * calcola i match aggregando TUTTI i profili CoC dell'utente: ogni scambio indica
 * con quale mio profilo (my_profile) si applica, senza dover scegliere un profilo
 * "attivo" a priori.
 * Matching calcolato sulle collezioni: carta assente = mancante (non serve riga qty=0).
 *
 * Ogni voce include la collezione posseduta (qty>=1) e le combinazioni di scambio.
 */
async function listPublicDecks(admin, user, myProfileId) {
  const myProfiles = myProfileId
    ? [await myProfileOr403(admin, user, myProfileId)]
    : await profilesUtil.listProfiles(admin, user.id);
  const myTags = myProfiles.map((p) => p.coc_tag);
  const { data: publicProfiles, error: e1 } = await admin
    .from('user_coc_profiles')
    .select('id, coc_tag, username, coc_clan_name, coc_clan_badge_url, town_hall_level, user_id')
    .neq('user_id', user.id);
  if (e1) throw e1;

  const otherTags = (publicProfiles || []).map((p) => p.coc_tag).filter((t) => !myTags.includes(t));
  const tagsToLoad = [...myTags, ...otherTags];
  const { data: collRows, error: e3 } = tagsToLoad.length
    ? await admin.from('card_event_collections').select('coc_tag, card_key, qty_state, updated_at').in('coc_tag', tagsToLoad)
    : { data: [], error: null };
  if (e3) throw e3;

  const collectionByTag = {};
  const lastModifiedByTag = {};
  for (const tag of tagsToLoad) collectionByTag[tag] = {};
  for (const row of collRows || []) {
    if (!collectionByTag[row.coc_tag]) collectionByTag[row.coc_tag] = {};
    collectionByTag[row.coc_tag][row.card_key] = row.qty_state;
    if (row.updated_at && (!lastModifiedByTag[row.coc_tag] || row.updated_at > lastModifiedByTag[row.coc_tag])) {
      lastModifiedByTag[row.coc_tag] = row.updated_at;
    }
  }

  const ownedOnly = (full) => {
    const out = {};
    for (const [k, v] of Object.entries(full || {})) {
      if (Number(v) >= 1) out[k] = v;
    }
    return out;
  };

  return {
    ok: true,
    my_public: true,
    my_profiles: myProfiles.map(profilesUtil.profileToPublic),
    decks: (publicProfiles || [])
      .filter((p) => !myTags.includes(p.coc_tag))
      .map((p) => {
        const fullColl = collectionByTag[p.coc_tag] || {};
        const matches = [];
        for (const myProfile of myProfiles) {
          const pair = computeP2pMatches(collectionByTag[myProfile.coc_tag], fullColl);
          for (const m of pair) {
            matches.push(
              enrichCardKeys(
                {
                  my_profile: profilesUtil.profileToPublic(myProfile),
                  card_give: m.card_give,
                  card_get: m.card_get,
                  category: m.category,
                  i_unlock: m.i_unlock !== false,
                  they_unlock: m.they_unlock === true,
                },
                ['card_give', 'card_get'],
              ),
            );
          }
        }
        return {
          profile: profilesUtil.profileToPublic(p),
          matches,
          collection: ownedOnly(fullColl),
          last_modified: lastModifiedByTag[p.coc_tag] || null,
        };
      })
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

  // Best-effort: rileva subito eventuali proposte "stale" (collezioni cambiate da
  // quando sono state create) prima di mostrare la stanza, invece di scoprirlo solo
  // al momento dell'accettazione.
  const myTag = profilesMap[myProfileId]?.coc_tag;
  const otherTag = profilesMap[otherProfileId]?.coc_tag;
  if (myTag) await revalidateProposalsForTag(admin, myTag);
  if (otherTag && otherTag !== myTag) await revalidateProposalsForTag(admin, otherTag);

  const [{ data: messages, error: e1 }, { data: proposals, error: e2 }, { data: otherColl, error: e3 }] = await Promise.all([
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
    admin
      .from('card_event_collections')
      .select('card_key, qty_state')
      .eq('coc_tag', profilesMap[otherProfileId]?.coc_tag || ''),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const otherCollection = {};
  for (const row of otherColl || []) {
    if (Number(row.qty_state) >= 1) otherCollection[row.card_key] = row.qty_state;
  }

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
    other_collection: otherCollection,
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

async function proposeTrade(admin, user, roomId, myProfileId, cardGive, cardGet, opts = {}) {
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
  // L'altro può già avere la carta che riceve (aggiunge al conteggio): non è un errore.
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
        proposal_id: proposal.id,
        my_profile_id: otherId,
        my_coc_tag: other.coc_tag,
        proposer_username: me.username,
        card_give: cardGive,
        card_get: cardGet,
        card_give_name: give.name_it,
        card_get_name: get.name_it,
      },
    });
  }

  if (opts.commitNow) {
    // "Applica subito": il proponente cede subito il suo doppione (escrow), senza
    // bisogno del consenso dell'altro. Se il commit fallisce (race sulle quantità),
    // la proposta resta comunque creata come classica "Proponi scambio".
    try {
      const committed = await commitProposal(admin, user, proposal.id, myProfileId);
      return { ok: true, proposal: enrichCardKeys(committed.proposal, ['card_give', 'card_get']) };
    } catch (e) {
      return { ok: true, proposal: enrichCardKeys(proposal, ['card_give', 'card_get']), commit_error: e.message };
    }
  }

  return { ok: true, proposal: enrichCardKeys(proposal, ['card_give', 'card_get']) };
}

/**
 * Tasto "Applica subito (solo il mio mazzo)": il proponente cede DAVVERO e SUBITO
 * il suo doppione (escrow), senza bisogno del consenso dell'altro lato. Non riceve
 * ancora la carta richiesta: lo scambio si conclude solo quando l'altro fa lo stesso
 * (accettando la proposta, che a quel punto salta il débito già fatto qui).
 * Rollback automatico (il doppione torna al proponente) se la proposta viene poi
 * annullata, rifiutata o invalidata (collezioni cambiate).
 */
async function commitProposal(admin, user, proposalId, myProfileId) {
  await requireEventLive(admin);
  const { data: proposal, error } = await admin
    .from('card_event_proposals')
    .select('*, card_event_rooms!inner(id, profile_lo, profile_hi)')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw err(404, 'Proposta non trovata.');
  const room = proposal.card_event_rooms;
  // profile_id opzionale: se omesso (es. bottone da una notifica Telegram), solo chi
  // ha proposto lo scambio può comunque confermare, quindi si usa direttamente
  // proposal.proposer_profile (verificandone la proprietà più sotto).
  const resolvedProfileId = myProfileId || proposal.proposer_profile;
  const mineSet = await myProfileIdsSet(admin, user.id);
  if (!mineSet.has(resolvedProfileId)) throw err(403, 'Profilo non collegato al tuo account.');
  const meMap = await publicProfilesByIds(admin, [resolvedProfileId]);
  const me = meMap[resolvedProfileId];
  if (!me) throw err(403, 'Profilo non collegato al tuo account.');
  if (room.profile_lo !== me.id && room.profile_hi !== me.id) throw err(403, 'Non fai parte di questa stanza.');
  if (proposal.proposer_profile !== me.id) {
    throw err(403, 'Solo chi ha proposto lo scambio può confermare la propria cessione.');
  }
  if (proposal.status !== 'pending') throw err(400, 'Questa proposta non è più in attesa.');

  if (!proposal.proposer_committed) {
    const { error: rpcErr } = await admin.rpc('commit_card_trade_offer', {
      p_proposal_id: proposalId,
      p_profile_id: me.id,
    });
    if (rpcErr) throw err(400, rpcErr.message || 'Non hai più il doppione richiesto.');
    proposal.proposer_committed = true;

    const giveMeta = cardMeta(proposal.card_give);
    await admin.from('card_event_room_messages').insert({
      room_id: room.id,
      kind: 'system',
      body: `⚡ ${me.username || me.coc_tag} ha già ceduto ${giveMeta?.name_it || proposal.card_give}: in attesa che l'altro completi lo scambio con "Applica subito".`,
    });
    await admin.from('card_event_rooms').update({ updated_at: new Date().toISOString() }).eq('id', room.id);

    const otherId = room.profile_lo === me.id ? room.profile_hi : room.profile_lo;
    const other = await profileUserId(admin, otherId);
    if (other?.user_id) {
      const getMeta = cardMeta(proposal.card_get);
      queueNotification(admin, {
        userId: other.user_id,
        kind: 'committed',
        dedupeKey: `${proposalId}:committed`,
        payload: {
          room_id: room.id,
          proposal_id: proposalId,
          my_profile_id: otherId,
          my_coc_tag: other.coc_tag,
          proposer_username: me.username,
          card_give: proposal.card_give,
          card_get: proposal.card_get,
          card_give_name: giveMeta?.name_it,
          card_get_name: getMeta?.name_it,
        },
      });
    }
  }

  return { ok: true, proposal, room_id: room.id };
}

/**
 * Ricontrolla le proposte "pending" che coinvolgono un profilo (per coc_tag) dopo che
 * la sua collezione è cambiata: se lo scambio non è più valido, la marca "stale",
 * rimborsa l'eventuale doppione già ceduto in escrow e lascia un messaggio di sistema.
 * Best-effort: non deve mai bloccare il salvataggio della collezione.
 */
async function revalidateProposalsForTag(admin, cocTag) {
  try {
    const { data: profile } = await admin
      .from('user_coc_profiles')
      .select('id, coc_tag')
      .eq('coc_tag', cocTag)
      .maybeSingle();
    if (!profile) return;

    const { data: rooms } = await admin
      .from('card_event_rooms')
      .select('id, profile_lo, profile_hi')
      .or(`profile_lo.in.(${profile.id}),profile_hi.in.(${profile.id})`);
    if (!rooms?.length) return;
    const roomIds = rooms.map((r) => r.id);
    const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));

    const { data: pending } = await admin
      .from('card_event_proposals')
      .select('*')
      .in('room_id', roomIds)
      .eq('status', 'pending');
    if (!pending?.length) return;

    const involvedProfileIds = new Set([profile.id]);
    for (const p of pending) {
      const room = roomById[p.room_id];
      if (!room) continue;
      involvedProfileIds.add(room.profile_lo);
      involvedProfileIds.add(room.profile_hi);
    }
    const { data: profRows } = await admin
      .from('user_coc_profiles')
      .select('id, coc_tag')
      .in('id', [...involvedProfileIds]);
    const tagById = Object.fromEntries((profRows || []).map((p) => [p.id, p.coc_tag]));
    const involvedTags = [...new Set(Object.values(tagById))];

    const { data: collRows } = await admin
      .from('card_event_collections')
      .select('coc_tag, card_key, qty_state')
      .in('coc_tag', involvedTags);
    const qtyOf = (tag, key) => (collRows || []).find((r) => r.coc_tag === tag && r.card_key === key)?.qty_state ?? 0;

    for (const p of pending) {
      const room = roomById[p.room_id];
      if (!room) continue;
      const otherId = room.profile_lo === p.proposer_profile ? room.profile_hi : room.profile_lo;
      const proposerTag = tagById[p.proposer_profile];
      const otherTag = tagById[otherId];
      if (!proposerTag || !otherTag) continue;

      const proposerHasGive = p.proposer_committed === true || qtyOf(proposerTag, p.card_give) >= 2;
      const proposerLacksGet = qtyOf(proposerTag, p.card_get) === 0;
      // L'altro può già avere la carta che cede il proponente (riceve un doppione): ok.
      const otherHasGet = qtyOf(otherTag, p.card_get) >= 2;
      if (proposerHasGive && proposerLacksGet && otherHasGet) continue;

      if (p.proposer_committed) {
        await admin.rpc('refund_card_trade_offer', { p_proposal_id: p.id }).catch(() => {});
      }
      await admin
        .from('card_event_proposals')
        .update({ status: 'stale', resolved_at: new Date().toISOString() })
        .eq('id', p.id);
      await admin.from('card_event_room_messages').insert({
        room_id: p.room_id,
        kind: 'system',
        body: '⚠️ Questa proposta non è più applicabile: una delle due collezioni è cambiata nel frattempo.',
      });
    }
  } catch (_) {
    // best-effort: non deve mai bloccare il salvataggio della collezione
  }
}

async function respondProposal(admin, user, proposalId, myProfileId, action) {
  const { data: proposal, error } = await admin
    .from('card_event_proposals')
    .select('*, card_event_rooms!inner(id, profile_lo, profile_hi)')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw err(404, 'Proposta non trovata.');
  const room = proposal.card_event_rooms;
  // profile_id opzionale: se omesso (es. bottone da una notifica Telegram, senza stato
  // pregresso), risolve automaticamente qual è il "mio" profilo in questa stanza.
  const me = myProfileId
    ? await myProfileOr403(admin, user, myProfileId)
    : await (async () => {
        const mineSet = await myProfileIdsSet(admin, user.id);
        const resolvedId = [room.profile_lo, room.profile_hi].find((pid) => mineSet.has(pid));
        if (!resolvedId) throw err(403, 'Non fai parte di questa stanza.');
        const map = await publicProfilesByIds(admin, [resolvedId]);
        return map[resolvedId];
      })();
  if (room.profile_lo !== me.id && room.profile_hi !== me.id) throw err(403, 'Non fai parte di questa stanza.');
  if (proposal.status !== 'pending') throw err(400, 'Questa proposta è già stata gestita.');

  const otherId = room.profile_lo === proposal.proposer_profile ? room.profile_hi : room.profile_lo;

  if (action === 'cancel') {
    if (proposal.proposer_profile !== me.id) throw err(403, 'Solo chi ha proposto può annullare.');
    if (proposal.proposer_committed) {
      await admin.rpc('refund_card_trade_offer', { p_proposal_id: proposalId }).catch(() => {});
    }
    await admin.from('card_event_proposals').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', proposalId);
    await admin.from('card_event_room_messages').insert({
      room_id: room.id,
      kind: 'system',
      body: proposal.proposer_committed
        ? 'Proposta annullata: il doppione già ceduto è stato restituito al proponente.'
        : 'Proposta annullata.',
    });
    return { ok: true, status: 'cancelled', room_id: room.id };
  }

  if (action === 'reject') {
    if (proposal.proposer_committed) {
      await admin.rpc('refund_card_trade_offer', { p_proposal_id: proposalId }).catch(() => {});
    }
    await admin.from('card_event_proposals').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', proposalId);
    await admin.from('card_event_room_messages').insert({
      room_id: room.id,
      kind: 'system',
      body: proposal.proposer_committed
        ? 'Proposta rifiutata: il doppione già ceduto è stato restituito al proponente.'
        : 'Proposta rifiutata.',
    });
    return { ok: true, status: 'rejected', room_id: room.id };
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
      p_skip_a_debit: proposal.proposer_committed === true,
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
          my_coc_tag: proposer.coc_tag,
          card_give: proposal.card_give,
          card_get: proposal.card_get,
          card_give_name: giveMeta?.name_it,
          card_get_name: getMeta?.name_it,
        },
      });
    }
    return { ok: true, status: 'accepted', room_id: room.id };
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
  computeP2pMatches,
  getMatchesForProfile,
  getSelfMatches,
  setProfilePublic,
  listPublicDecks,
  getOrCreateRoom,
  getRoomDetail,
  listRoomsForUser,
  sendRoomMessage,
  proposeTrade,
  commitProposal,
  revalidateProposalsForTag,
  respondProposal,
  applySelfTrade,
  getTradeLog,
  notifyMatchesForTag,
};

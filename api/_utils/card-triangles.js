'use strict';

/**
 * Evento "Clash of Cards" — scambi a tre (triangoli / cicli).
 * Matching lato Node (variante A: qty≥2 obbligatorio, preferenza qty≥3).
 * Ciclo: A cede → C; B cede → A; C cede → B. Tutti ricevono una carta mancante.
 */

const profilesUtil = require('./user-profiles');
const cardEvent = require('./card-event');
const { CARD_BY_KEY, CARD_EVENT_CATALOG } = require('./card-event-catalog');

function err(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function qtyOf(coll, key) {
  return Number((coll || {})[key] || 0);
}

function enrichMeta(obj, keys) {
  const out = { ...obj };
  for (const k of keys) {
    const meta = CARD_BY_KEY.get(obj[k]);
    if (meta) out[`${k}_meta`] = { key: meta.key, name_it: meta.name_it, icon_url: meta.icon_url, category: meta.category };
  }
  return out;
}

/**
 * Trova cicli A→C / B→A / C→B tra una lista di profili con collezioni.
 * Dedup canonico per id profilo ordinati + carte.
 * Preferenza: prefer_score = numero di lati con qty≥3 (0..3), sort desc.
 */
function computeTriangleCycles(profiles) {
  // profiles: [{ id, coc_tag, user_id, username, ... , collection: {key:qty} }]
  const list = (profiles || []).filter((p) => p && p.id && p.collection);
  const out = [];
  const seen = new Set();

  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < list.length; k++) {
        if (k === i || k === j) continue;
        const A = list[i];
        const B = list[j];
        const C = list[k];
        // Canonical orientation: smallest profile id must be A among rotated forms
        // We'll generate all and dedupe by sorted ids + sorted cards later.

        for (const cardA of CARD_EVENT_CATALOG) {
          if (qtyOf(A.collection, cardA.key) < 2) continue;
          if (qtyOf(C.collection, cardA.key) !== 0) continue;

          for (const cardB of CARD_EVENT_CATALOG) {
            if (cardB.category !== cardA.category) continue;
            if (cardB.key === cardA.key) continue;
            if (qtyOf(B.collection, cardB.key) < 2) continue;
            if (qtyOf(A.collection, cardB.key) !== 0) continue;

            for (const cardC of CARD_EVENT_CATALOG) {
              if (cardC.category !== cardA.category) continue;
              if (cardC.key === cardA.key || cardC.key === cardB.key) continue;
              if (qtyOf(C.collection, cardC.key) < 2) continue;
              if (qtyOf(B.collection, cardC.key) !== 0) continue;

              const prefer =
                (qtyOf(A.collection, cardA.key) >= 3 ? 1 : 0) +
                (qtyOf(B.collection, cardB.key) >= 3 ? 1 : 0) +
                (qtyOf(C.collection, cardC.key) >= 3 ? 1 : 0);

              // Dedup: same cycle under rotation
              const rotations = [
                [`${A.id}|${B.id}|${C.id}`, cardA.key, cardB.key, cardC.key],
                [`${B.id}|${C.id}|${A.id}`, cardB.key, cardC.key, cardA.key],
                [`${C.id}|${A.id}|${B.id}`, cardC.key, cardA.key, cardB.key],
              ];
              const canon = rotations
                .map((r) => `${r[0]}::${r[1]}>${r[2]}>${r[3]}`)
                .sort()[0];
              if (seen.has(canon)) continue;
              seen.add(canon);

              out.push({
                profile_a: A,
                profile_b: B,
                profile_c: C,
                card_a_gives: cardA.key,
                card_b_gives: cardB.key,
                card_c_gives: cardC.key,
                category: cardA.category,
                prefer_score: prefer,
                qty_a: qtyOf(A.collection, cardA.key),
                qty_b: qtyOf(B.collection, cardB.key),
                qty_c: qtyOf(C.collection, cardC.key),
              });
            }
          }
        }
      }
    }
  }

  out.sort(
    (x, y) =>
      y.prefer_score - x.prefer_score ||
      String(x.profile_a.id).localeCompare(String(y.profile_a.id)),
  );
  return out;
}

/**
 * Trova cicli a 4 profili: A→B→C→D→A.
 * Regole: stessa categoria per tutte le carte, qty≥2 per chi cede, qty=0 per chi riceve.
 * Usa edge-graph per efficienza. Limite: maxCycles risultati.
 */
function computeQuadCycles(profiles, maxCycles = 20) {
  const list = (profiles || []).filter((p) => p && p.id && p.collection);
  if (list.length < 4) return [];

  const byId = Object.fromEntries(list.map((p) => [p.id, p]));

  // Costruisci grafo diretto: edgesFrom[id] = [{to, card, category}]
  const edgesFrom = {};
  for (const A of list) {
    edgesFrom[A.id] = [];
    for (const card of CARD_EVENT_CATALOG) {
      if (qtyOf(A.collection, card.key) < 2) continue;
      for (const B of list) {
        if (B.id === A.id) continue;
        if (qtyOf(B.collection, card.key) !== 0) continue;
        edgesFrom[A.id].push({ to: B.id, card: card.key, category: card.category });
      }
    }
  }

  const out = [];
  const seen = new Set();

  outer: for (const A of list) {
    for (const e1 of (edgesFrom[A.id] || [])) {
      if (!byId[e1.to]) continue;
      for (const e2 of (edgesFrom[e1.to] || [])) {
        if (e2.to === A.id) continue;
        if (e2.category !== e1.category) continue;
        if (e2.card === e1.card) continue;
        if (!byId[e2.to]) continue;
        for (const e3 of (edgesFrom[e2.to] || [])) {
          if (e3.to === A.id || e3.to === e1.to) continue;
          if (e3.category !== e1.category) continue;
          if (e3.card === e1.card || e3.card === e2.card) continue;
          if (!byId[e3.to]) continue;
          for (const e4 of (edgesFrom[e3.to] || [])) {
            if (e4.to !== A.id) continue;
            if (e4.category !== e1.category) continue;
            if (e4.card === e1.card || e4.card === e2.card || e4.card === e3.card) continue;

            const B = byId[e1.to];
            const C = byId[e2.to];
            const D = byId[e3.to];

            // Dedup canonico: minima rotazione lessicografica
            const rotations = [
              [A.id, B.id, C.id, D.id, e1.card, e2.card, e3.card, e4.card],
              [B.id, C.id, D.id, A.id, e2.card, e3.card, e4.card, e1.card],
              [C.id, D.id, A.id, B.id, e3.card, e4.card, e1.card, e2.card],
              [D.id, A.id, B.id, C.id, e4.card, e1.card, e2.card, e3.card],
            ];
            const canon = rotations.map((r) => r.join('|')).sort()[0];
            if (seen.has(canon)) continue;
            seen.add(canon);

            const prefer =
              (qtyOf(A.collection, e1.card) >= 3 ? 1 : 0) +
              (qtyOf(B.collection, e2.card) >= 3 ? 1 : 0) +
              (qtyOf(C.collection, e3.card) >= 3 ? 1 : 0) +
              (qtyOf(D.collection, e4.card) >= 3 ? 1 : 0);

            out.push({
              profile_a: A, profile_b: B, profile_c: C, profile_d: D,
              card_a_gives: e1.card, card_b_gives: e2.card, card_c_gives: e3.card, card_d_gives: e4.card,
              category: e1.category, prefer_score: prefer,
              qty_a: qtyOf(A.collection, e1.card),
              qty_b: qtyOf(B.collection, e2.card),
              qty_c: qtyOf(C.collection, e3.card),
              qty_d: qtyOf(D.collection, e4.card),
            });
            if (out.length >= maxCycles) break outer;
          }
        }
      }
    }
  }

  out.sort((x, y) => y.prefer_score - x.prefer_score);
  return out;
}

function formatQuadCycle(cycle) {
  return enrichMeta(
    {
      profile_a: toPublicProfile(cycle.profile_a),
      profile_b: toPublicProfile(cycle.profile_b),
      profile_c: toPublicProfile(cycle.profile_c),
      profile_d: toPublicProfile(cycle.profile_d),
      card_a_gives: cycle.card_a_gives,
      card_b_gives: cycle.card_b_gives,
      card_c_gives: cycle.card_c_gives,
      card_d_gives: cycle.card_d_gives,
      category: cycle.category,
      prefer_score: cycle.prefer_score,
      qty_a: cycle.qty_a,
      qty_b: cycle.qty_b,
      qty_c: cycle.qty_c,
      qty_d: cycle.qty_d,
      legs: {
        a: { gives: cycle.card_a_gives, gets: cycle.card_d_gives },
        b: { gives: cycle.card_b_gives, gets: cycle.card_a_gives },
        c: { gives: cycle.card_c_gives, gets: cycle.card_b_gives },
        d: { gives: cycle.card_d_gives, gets: cycle.card_c_gives },
      },
    },
    ['card_a_gives', 'card_b_gives', 'card_c_gives', 'card_d_gives'],
  );
}

/**
 * Catene a 4 P2P che coinvolgono almeno un profilo dell'utente.
 */
async function getP2pQuads(admin, user) {
  const { data: mine, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('user_id', user.id);
  if (error) throw error;
  if (!mine?.length) return { ok: true, quads: [] };

  const { data: publics, error: e2 } = await admin
    .from('user_coc_profiles')
    .select('*')
    .neq('user_id', user.id);
  if (e2) throw e2;
  if ((publics?.length || 0) < 3) return { ok: true, quads: [] };

  const pool = await loadProfilesWithCollections(admin, [...mine, ...publics]);
  const myIds = new Set(mine.map((p) => p.id));

  const quads = computeQuadCycles(pool)
    .filter((c) => {
      const ids = [c.profile_a, c.profile_b, c.profile_c, c.profile_d];
      const mineCount = ids.filter((p) => myIds.has(p.id)).length;
      return mineCount >= 1 && (4 - mineCount) >= 1;
    })
    .map((c) => {
      const formatted = formatQuadCycle(c);
      const myRole = myIds.has(c.profile_a.id) ? 'a'
        : myIds.has(c.profile_b.id) ? 'b'
        : myIds.has(c.profile_c.id) ? 'c'
        : 'd';
      formatted.my_role = myRole;
      formatted.my_profile = formatted[`profile_${myRole}`];
      return formatted;
    });

  return { ok: true, quads };
}

async function requireEventLive(admin) {
  const settings = await cardEvent.getSettings(admin);
  if (!cardEvent.isEventLive(settings)) {
    throw err(403, 'Evento Clash of Cards non attivo.', 'EVENT_NOT_LIVE');
  }
}

async function loadProfilesWithCollections(admin, profileRows) {
  const tags = [...new Set((profileRows || []).map((p) => p.coc_tag).filter(Boolean))];
  const collByTag = {};
  for (const t of tags) collByTag[t] = {};
  if (tags.length) {
    const { data: rows, error } = await admin
      .from('card_event_collections')
      .select('coc_tag, card_key, qty_state')
      .in('coc_tag', tags);
    if (error) throw error;
    for (const row of rows || []) {
      collByTag[row.coc_tag][row.card_key] = row.qty_state;
    }
  }
  return (profileRows || []).map((p) => ({
    ...p,
    collection: collByTag[p.coc_tag] || {},
  }));
}

async function queueNotification(admin, { userId, kind, dedupeKey, payload }) {
  if (!userId) return;
  await admin.from('card_event_notify_outbox').upsert(
    {
      user_id: userId,
      kind,
      dedupe_key: dedupeKey,
      payload: payload || {},
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,kind,dedupe_key', ignoreDuplicates: true },
  );
}

function toPublicProfile(p) {
  if (!p) return null;
  return profilesUtil.profileToPublic
    ? profilesUtil.profileToPublic(p)
    : {
        id: p.id,
        coc_tag: p.coc_tag,
        username: p.username,
        coc_clan_name: p.coc_clan_name,
        town_hall_level: p.town_hall_level,
      };
}

function formatCycle(cycle) {
  return enrichMeta(
    {
      profile_a: toPublicProfile(cycle.profile_a),
      profile_b: toPublicProfile(cycle.profile_b),
      profile_c: toPublicProfile(cycle.profile_c),
      card_a_gives: cycle.card_a_gives,
      card_b_gives: cycle.card_b_gives,
      card_c_gives: cycle.card_c_gives,
      category: cycle.category,
      prefer_score: cycle.prefer_score,
      qty_a: cycle.qty_a,
      qty_b: cycle.qty_b,
      qty_c: cycle.qty_c,
      // Vista dal punto di vista di ciascun profilo: cosa cede / cosa riceve
      legs: {
        a: { gives: cycle.card_a_gives, gets: cycle.card_b_gives },
        b: { gives: cycle.card_b_gives, gets: cycle.card_c_gives },
        c: { gives: cycle.card_c_gives, gets: cycle.card_a_gives },
      },
    },
    ['card_a_gives', 'card_b_gives', 'card_c_gives'],
  );
}

/** Triangoli self: solo profili dello stesso account. */
async function getSelfTriangles(admin, user) {
  const { data: mine, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('user_id', user.id);
  if (error) throw error;
  if (!mine || mine.length < 3) return { ok: true, triangles: [] };

  const withColl = await loadProfilesWithCollections(admin, mine);
  const cycles = computeTriangleCycles(withColl).map(formatCycle);
  return { ok: true, triangles: cycles };
}

/**
 * Triangoli P2P che coinvolgono almeno un profilo dell'utente.
 * Pool: miei profili + mazzi pubblici di altri account.
 */
async function getP2pTriangles(admin, user) {
  const { data: mine, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('user_id', user.id);
  if (error) throw error;
  if (!mine?.length) return { ok: true, triangles: [] };

  const { data: publics, error: e2 } = await admin
    .from('user_coc_profiles')
    .select('*')
    .neq('user_id', user.id);
  if (e2) throw e2;
  if (!publics?.length) return { ok: true, triangles: [] };

  const pool = await loadProfilesWithCollections(admin, [...mine, ...publics]);
  const myIds = new Set(mine.map((p) => p.id));

  // Solo cicli che coinvolgono ≥1 mio profilo e ≥1 profilo altrui (preferibilmente 3 account)
  const cycles = computeTriangleCycles(pool)
    .filter((c) => {
      const ids = [c.profile_a, c.profile_b, c.profile_c];
      const mineCount = ids.filter((p) => myIds.has(p.id)).length;
      const otherCount = 3 - mineCount;
      return mineCount >= 1 && otherCount >= 1;
    })
    .map((c) => {
      const formatted = formatCycle(c);
      const myRole = myIds.has(c.profile_a.id)
        ? 'a'
        : myIds.has(c.profile_b.id)
          ? 'b'
          : 'c';
      formatted.my_role = myRole;
      formatted.my_profile =
        myRole === 'a'
          ? formatted.profile_a
          : myRole === 'b'
            ? formatted.profile_b
            : formatted.profile_c;
      return formatted;
    });

  return { ok: true, triangles: cycles };
}

async function validateCycleStillValid(admin, profileA, profileB, profileC, cardA, cardB, cardC) {
  const withColl = await loadProfilesWithCollections(admin, [profileA, profileB, profileC]);
  const byId = Object.fromEntries(withColl.map((p) => [p.id, p]));
  const A = byId[profileA.id];
  const B = byId[profileB.id];
  const C = byId[profileC.id];
  if (!A || !B || !C) throw err(400, 'Profilo non trovato.');
  if (qtyOf(A.collection, cardA) < 2) throw err(400, `Il profilo A non ha più il doppione (${cardA}).`);
  if (qtyOf(B.collection, cardB) < 2) throw err(400, `Il profilo B non ha più il doppione (${cardB}).`);
  if (qtyOf(C.collection, cardC) < 2) throw err(400, `Il profilo C non ha più il doppione (${cardC}).`);
  if (qtyOf(C.collection, cardA) !== 0) throw err(400, 'Il profilo C possiede già la carta che riceverebbe.');
  if (qtyOf(A.collection, cardB) !== 0) throw err(400, 'Il profilo A possiede già la carta che riceverebbe.');
  if (qtyOf(B.collection, cardC) !== 0) throw err(400, 'Il profilo B possiede già la carta che riceverebbe.');
  const ca = CARD_BY_KEY.get(cardA);
  const cb = CARD_BY_KEY.get(cardB);
  const cc = CARD_BY_KEY.get(cardC);
  if (!ca || !cb || !cc || ca.category !== cb.category || cb.category !== cc.category) {
    throw err(400, 'Le carte devono essere della stessa categoria.');
  }
  return { A, B, C, category: ca.category };
}

/** Self: Applica subito senza proposta. */
async function applySelfTriangle(admin, user, { profileA, profileB, profileC, cardA, cardB, cardC }) {
  await requireEventLive(admin);
  const ids = [profileA, profileB, profileC];
  const { data: rows, error } = await admin.from('user_coc_profiles').select('*').in('id', ids);
  if (error) throw error;
  if ((rows || []).length !== 3) throw err(400, 'Profili non trovati.');
  if ((rows || []).some((r) => r.user_id !== user.id)) {
    throw err(403, 'Puoi applicare triangoli self solo tra i tuoi profili.');
  }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  await validateCycleStillValid(
    admin,
    byId[profileA],
    byId[profileB],
    byId[profileC],
    cardA,
    cardB,
    cardC,
  );

  const { error: rpcErr } = await admin.rpc('apply_card_triangle', {
    p_kind: 'self',
    p_profile_a: profileA,
    p_profile_b: profileB,
    p_profile_c: profileC,
    p_card_a: cardA,
    p_card_b: cardB,
    p_card_c: cardC,
    p_triangle_id: null,
  });
  if (rpcErr) throw err(400, rpcErr.message || 'Errore applicazione triangolo.');
  return { ok: true };
}

/** P2P: crea proposta; il creatore è già accettato sul suo ruolo. */
async function proposeTriangle(admin, user, body) {
  await requireEventLive(admin);
  const profileA = body.profile_a || body.profileA;
  const profileB = body.profile_b || body.profileB;
  const profileC = body.profile_c || body.profileC;
  const cardA = body.card_a_gives || body.cardA;
  const cardB = body.card_b_gives || body.cardB;
  const cardC = body.card_c_gives || body.cardC;
  const createdBy = body.created_by || body.createdBy || body.my_profile_id || body.profile_id;

  if (!profileA || !profileB || !profileC || !cardA || !cardB || !cardC || !createdBy) {
    throw err(400, 'Parametri triangolo incompleti.');
  }
  if (![profileA, profileB, profileC].includes(createdBy)) {
    throw err(400, 'Il proponente deve essere uno dei tre profili del ciclo.');
  }

  const { data: rows, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .in('id', [profileA, profileB, profileC]);
  if (error) throw error;
  if ((rows || []).length !== 3) throw err(400, 'Profili non trovati.');
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  if (byId[createdBy]?.user_id !== user.id) {
    throw err(403, 'Puoi proporre solo con un tuo profilo.');
  }

  const userIds = new Set(rows.map((r) => r.user_id));
  if (userIds.size < 2) {
    throw err(400, 'Per triangoli tra i tuoi profili usa Applica subito (self).', 'USE_SELF_TRIANGLE');
  }

  const { category } = await validateCycleStillValid(
    admin,
    byId[profileA],
    byId[profileB],
    byId[profileC],
    cardA,
    cardB,
    cardC,
  );

  const accept = {
    accept_a: createdBy === profileA,
    accept_b: createdBy === profileB,
    accept_c: createdBy === profileC,
  };

  const { data: proposal, error: insErr } = await admin
    .from('card_event_triangle_proposals')
    .insert({
      kind: 'p2p',
      category,
      profile_a: profileA,
      profile_b: profileB,
      profile_c: profileC,
      card_a_gives: cardA,
      card_b_gives: cardB,
      card_c_gives: cardC,
      created_by: createdBy,
      status: 'pending',
      ...accept,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;

  const creatorName = byId[createdBy]?.username || byId[createdBy]?.coc_tag || 'Un giocatore';
  for (const p of rows) {
    if (p.user_id === user.id) continue;
    const myRole = p.id === profileA ? 'a' : p.id === profileB ? 'b' : 'c';
    await queueNotification(admin, {
      userId: p.user_id,
      kind: 'triangle_proposal',
      dedupeKey: `tri:${proposal.id}:${p.user_id}`,
      payload: {
        triangle_id: proposal.id,
        my_profile_id: p.id,
        my_coc_tag: p.coc_tag,
        my_role: myRole,
        proposer_username: creatorName,
        card_a_gives: cardA,
        card_b_gives: cardB,
        card_c_gives: cardC,
        card_a_gives_name: CARD_BY_KEY.get(cardA)?.name_it,
        card_b_gives_name: CARD_BY_KEY.get(cardB)?.name_it,
        card_c_gives_name: CARD_BY_KEY.get(cardC)?.name_it,
        profile_a: toPublicProfile(byId[profileA]),
        profile_b: toPublicProfile(byId[profileB]),
        profile_c: toPublicProfile(byId[profileC]),
      },
    });
  }

  return { ok: true, proposal };
}

async function listMyTriangleProposals(admin, user) {
  const { data: mine, error } = await admin
    .from('user_coc_profiles')
    .select('id')
    .eq('user_id', user.id);
  if (error) throw error;
  const ids = (mine || []).map((p) => p.id);
  if (!ids.length) return { ok: true, proposals: [] };

  const { data: rows, error: e2 } = await admin
    .from('card_event_triangle_proposals')
    .select('*')
    .eq('status', 'pending')
    .or(`profile_a.in.(${ids.join(',')}),profile_b.in.(${ids.join(',')}),profile_c.in.(${ids.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(40);
  if (e2) throw e2;

  const allIds = [];
  for (const r of rows || []) allIds.push(r.profile_a, r.profile_b, r.profile_c, r.created_by);
  const { data: profs } = await admin.from('user_coc_profiles').select('*').in('id', [...new Set(allIds)]);
  const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));

  return {
    ok: true,
    proposals: (rows || []).map((r) => {
      const myId = ids.find((id) => id === r.profile_a || id === r.profile_b || id === r.profile_c);
      const myRole = myId === r.profile_a ? 'a' : myId === r.profile_b ? 'b' : 'c';
      return enrichMeta(
        {
          ...r,
          my_role: myRole,
          my_profile_id: myId,
          profile_a: toPublicProfile(byId[r.profile_a]),
          profile_b: toPublicProfile(byId[r.profile_b]),
          profile_c: toPublicProfile(byId[r.profile_c]),
          created_by_profile: toPublicProfile(byId[r.created_by]),
        },
        ['card_a_gives', 'card_b_gives', 'card_c_gives'],
      );
    }),
  };
}

async function respondTriangle(admin, user, triangleId, action) {
  await requireEventLive(admin);
  const { data: proposal, error } = await admin
    .from('card_event_triangle_proposals')
    .select('*')
    .eq('id', triangleId)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw err(404, 'Proposta triangolo non trovata.');
  if (proposal.status !== 'pending') throw err(400, 'Questa proposta non è più in attesa.');

  const { data: mine } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('user_id', user.id)
    .in('id', [proposal.profile_a, proposal.profile_b, proposal.profile_c]);
  if (!mine?.length) throw err(403, 'Non fai parte di questo triangolo.');
  const myProfile = mine[0];
  const myRole =
    myProfile.id === proposal.profile_a
      ? 'a'
      : myProfile.id === proposal.profile_b
        ? 'b'
        : 'c';

  if (action === 'cancel') {
    const canCancel = mine.some((p) => p.id === proposal.created_by);
    if (!canCancel) throw err(403, 'Solo chi ha proposto può annullare.');
    await admin
      .from('card_event_triangle_proposals')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', triangleId);
    return { ok: true, status: 'cancelled' };
  }

  if (action === 'reject') {
    await admin
      .from('card_event_triangle_proposals')
      .update({ status: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', triangleId);
    return { ok: true, status: 'rejected' };
  }

  if (action !== 'accept') throw err(400, 'Azione non valida.');

  const patch = {};
  if (myRole === 'a') patch.accept_a = true;
  if (myRole === 'b') patch.accept_b = true;
  if (myRole === 'c') patch.accept_c = true;

  const next = {
    accept_a: myRole === 'a' ? true : proposal.accept_a,
    accept_b: myRole === 'b' ? true : proposal.accept_b,
    accept_c: myRole === 'c' ? true : proposal.accept_c,
  };

  if (next.accept_a && next.accept_b && next.accept_c) {
    // Validazione + apply
    const { data: profs } = await admin
      .from('user_coc_profiles')
      .select('*')
      .in('id', [proposal.profile_a, proposal.profile_b, proposal.profile_c]);
    const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));
    try {
      await validateCycleStillValid(
        admin,
        byId[proposal.profile_a],
        byId[proposal.profile_b],
        byId[proposal.profile_c],
        proposal.card_a_gives,
        proposal.card_b_gives,
        proposal.card_c_gives,
      );
    } catch (e) {
      await admin
        .from('card_event_triangle_proposals')
        .update({ status: 'stale', resolved_at: new Date().toISOString() })
        .eq('id', triangleId);
      throw e;
    }

    const { error: rpcErr } = await admin.rpc('apply_card_triangle', {
      p_kind: 'p2p',
      p_profile_a: proposal.profile_a,
      p_profile_b: proposal.profile_b,
      p_profile_c: proposal.profile_c,
      p_card_a: proposal.card_a_gives,
      p_card_b: proposal.card_b_gives,
      p_card_c: proposal.card_c_gives,
      p_triangle_id: triangleId,
    });
    if (rpcErr) {
      await admin
        .from('card_event_triangle_proposals')
        .update({ status: 'stale', resolved_at: new Date().toISOString() })
        .eq('id', triangleId);
      throw err(400, rpcErr.message || 'Triangolo non più applicabile.');
    }

    for (const p of profs || []) {
      if (p.user_id === user.id) continue;
      await queueNotification(admin, {
        userId: p.user_id,
        kind: 'triangle_done',
        dedupeKey: `tri-done:${triangleId}:${p.user_id}`,
        payload: {
          triangle_id: triangleId,
          my_profile_id: p.id,
          my_coc_tag: p.coc_tag,
          accepted_by_username: myProfile.username || myProfile.coc_tag,
          card_a_gives: proposal.card_a_gives,
          card_b_gives: proposal.card_b_gives,
          card_c_gives: proposal.card_c_gives,
          card_a_gives_name: CARD_BY_KEY.get(proposal.card_a_gives)?.name_it,
          card_b_gives_name: CARD_BY_KEY.get(proposal.card_b_gives)?.name_it,
          card_c_gives_name: CARD_BY_KEY.get(proposal.card_c_gives)?.name_it,
        },
      });
    }
    return { ok: true, status: 'accepted' };
  }

  await admin.from('card_event_triangle_proposals').update(patch).eq('id', triangleId);
  return { ok: true, status: 'pending', ...next };
}

/** Marca pending come stale se le quantità non sono più valide. */
async function revalidateTrianglesForTag(admin, cocTag) {
  const { data: profile } = await admin
    .from('user_coc_profiles')
    .select('id')
    .eq('coc_tag', cocTag)
    .maybeSingle();
  if (!profile) return;

  const { data: pending } = await admin
    .from('card_event_triangle_proposals')
    .select('*')
    .eq('status', 'pending')
    .or(`profile_a.in.(${profile.id}),profile_b.in.(${profile.id}),profile_c.in.(${profile.id})`);

  if (!pending?.length) return;

  for (const t of pending) {
    const { data: profs } = await admin
      .from('user_coc_profiles')
      .select('*')
      .in('id', [t.profile_a, t.profile_b, t.profile_c]);
    const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));
    try {
      await validateCycleStillValid(
        admin,
        byId[t.profile_a],
        byId[t.profile_b],
        byId[t.profile_c],
        t.card_a_gives,
        t.card_b_gives,
        t.card_c_gives,
      );
    } catch {
      await admin
        .from('card_event_triangle_proposals')
        .update({ status: 'stale', resolved_at: new Date().toISOString() })
        .eq('id', t.id);
    }
  }
}

module.exports = {
  computeTriangleCycles,
  computeQuadCycles,
  getSelfTriangles,
  getP2pTriangles,
  getP2pQuads,
  applySelfTriangle,
  proposeTriangle,
  listMyTriangleProposals,
  respondTriangle,
  revalidateTrianglesForTag,
};

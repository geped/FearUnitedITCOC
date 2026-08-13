'use strict';

/**
 * Fake minimale del client Supabase per testare la logica di scambio carte
 * (api/_utils/card-trades.js) senza un database reale. Supporta solo il
 * sottoinsieme di query-builder chain effettivamente usato da quel modulo
 * (select/eq/in/or/order/limit/maybeSingle/single/insert/update/rpc).
 *
 * Gli RPC Postgres (find_card_matches, find_self_card_matches, apply_card_trade)
 * sono simulati in JS rispecchiando la logica di schema-card-event-trades.sql:
 * se quel file cambia, aggiornare anche qui.
 */

let idCounter = 1;
function nextId(prefix) {
  return `${prefix}-${idCounter++}`;
}

class QueryBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this._insertRows = null;
    this._updatePatch = null;
    this._delete = false;
    this._single = false;
    this._maybeSingle = false;
  }
  select() { return this; }
  eq(col, val) { this.filters.push({ op: 'eq', col, val }); return this; }
  neq(col, val) { this.filters.push({ op: 'neq', col, val }); return this; }
  in(col, vals) { this.filters.push({ op: 'in', col, vals: vals.map(String) }); return this; }
  or(expr) { this.filters.push({ op: 'or', expr }); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this._maybeSingle = true; return this; }
  single() { this._single = true; return this; }
  insert(rows) { this._insertRows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this._updatePatch = patch; return this; }
  delete() { this._delete = true; return this; }
  upsert(rows, opts = {}) {
    this._upsertRows = Array.isArray(rows) ? rows : [rows];
    this._upsertConflict = (opts.onConflict || '').split(',').filter(Boolean);
    this._upsertIgnore = opts.ignoreDuplicates === true;
    return this;
  }

  _rowMatches(row) {
    return this.filters.every((f) => {
      if (f.op === 'eq') return String(row[f.col]) === String(f.val);
      if (f.op === 'neq') return String(row[f.col]) !== String(f.val);
      if (f.op === 'in') return f.vals.includes(String(row[f.col]));
      if (f.op === 'or') {
        const re = /(\w+)\.in\.\(([^)]*)\)/g;
        let m;
        while ((m = re.exec(f.expr))) {
          const [, col, list] = m;
          const vals = list.split(',').filter(Boolean);
          if (vals.includes(String(row[col]))) return true;
        }
        return false;
      }
      return true;
    });
  }

  async _run() {
    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);

    if (this._upsertRows) {
      const out = [];
      for (const r of this._upsertRows) {
        const existing = this._upsertConflict.length
          ? rows.find((x) => this._upsertConflict.every((c) => String(x[c]) === String(r[c])))
          : null;
        if (existing) {
          if (!this._upsertIgnore) Object.assign(existing, r);
          out.push(existing);
        } else {
          const row = { id: nextId(this.table), created_at: new Date().toISOString(), ...r };
          rows.push(row);
          out.push(row);
        }
      }
      if (this._maybeSingle || this._single) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }

    if (this._insertRows) {
      const inserted = this._insertRows.map((r) => {
        const row = {
          id: nextId(this.table),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'pending',
          ...r,
        };
        rows.push(row);
        return row;
      });
      if (this._single) return { data: inserted[0], error: null };
      return { data: inserted, error: null };
    }

    const matched = rows.filter((r) => this._rowMatches(r));

    if (this._updatePatch) {
      matched.forEach((r) => Object.assign(r, this._updatePatch));
      if (this._single) return { data: matched[0] || null, error: null };
      return { data: matched, error: null };
    }

    if (this._delete) {
      this.db.tables[this.table] = rows.filter((r) => !this._rowMatches(r));
      return { data: matched, error: null };
    }

    // Supporta l'embed usato da respondProposal: '*, card_event_rooms!inner(...)'
    const withEmbed = matched.map((r) => {
      if (this.table === 'card_event_proposals' && r.room_id) {
        const room = (this.db.tables.card_event_rooms || []).find((x) => x.id === r.room_id);
        return { ...r, card_event_rooms: room || null };
      }
      return r;
    });

    if (this._maybeSingle) return { data: withEmbed[0] || null, error: null };
    if (this._single) {
      if (!withEmbed.length) return { data: null, error: { message: 'Not found' } };
      return { data: withEmbed[0], error: null };
    }
    return { data: withEmbed, error: null };
  }

  then(resolve, reject) {
    return this._run().then(resolve, reject);
  }
}

// ── Simulazione RPC (rispecchia schema-card-event-trades.sql) ────────────
function rpcApplyCardTrade(db, params) {
  const collections = db.tables.card_event_collections || [];
  const profiles = db.tables.user_coc_profiles || [];
  const findProfile = (id) => profiles.find((p) => p.id === id);
  const a = findProfile(params.p_profile_a);
  const b = findProfile(params.p_profile_b);
  if (!a || !b) return { data: null, error: { message: 'Profilo non trovato per lo scambio' } };

  const findColl = (tag, key) => collections.find((c) => c.coc_tag === tag && c.card_key === key);
  const upsertColl = (tag, key, category, delta) => {
    const row = findColl(tag, key);
    if (row) { row.qty_state += delta; return row; }
    const created = { coc_tag: tag, card_key: key, category, qty_state: Math.max(0, delta) };
    collections.push(created);
    db.tables.card_event_collections = collections;
    return created;
  };

  const skipADebit = params.p_skip_a_debit === true;
  const aGave = findColl(a.coc_tag, params.p_card_a_gave);
  if (!aGave || (!skipADebit && aGave.qty_state < 2)) {
    return { data: null, error: { message: `Il profilo A non ha più il doppione richiesto (${params.p_card_a_gave}).` } };
  }
  const bGave = findColl(b.coc_tag, params.p_card_b_gave);
  if (!bGave || bGave.qty_state < 2) {
    return { data: null, error: { message: `Il profilo B non ha più il doppione richiesto (${params.p_card_b_gave}).` } };
  }

  if (!skipADebit) aGave.qty_state -= 1;
  bGave.qty_state -= 1;

  if (params.p_kind === 'self') {
    upsertColl(a.coc_tag, params.p_card_b_gave, bGave.category, 1);
    upsertColl(b.coc_tag, params.p_card_a_gave, aGave.category, 1);
  } else {
    const aGet = findColl(a.coc_tag, params.p_card_b_gave);
    if (aGet && aGet.qty_state >= 1) {
      return { data: null, error: { message: `Il profilo A ha già sbloccato la carta richiesta (${params.p_card_b_gave}).` } };
    }
    const bGet = findColl(b.coc_tag, params.p_card_a_gave);
    if (bGet && bGet.qty_state >= 1) {
      return { data: null, error: { message: `Il profilo B ha già sbloccato la carta richiesta (${params.p_card_a_gave}).` } };
    }
    if (aGet) aGet.qty_state = 1; else upsertColl(a.coc_tag, params.p_card_b_gave, bGave.category, 1);
    if (bGet) bGet.qty_state = 1; else upsertColl(b.coc_tag, params.p_card_a_gave, aGave.category, 1);
  }

  (db.tables.card_event_trade_log = db.tables.card_event_trade_log || []).push({
    id: nextId('log'),
    kind: params.p_kind,
    room_id: params.p_room_id || null,
    proposal_id: params.p_proposal_id || null,
    profile_a: params.p_profile_a,
    profile_b: params.p_profile_b,
    card_a_gave: params.p_card_a_gave,
    card_b_gave: params.p_card_b_gave,
    created_at: new Date().toISOString(),
  });

  if (params.p_proposal_id) {
    const proposal = (db.tables.card_event_proposals || []).find((p) => p.id === params.p_proposal_id);
    if (proposal) {
      proposal.status = 'accepted';
      proposal.resolved_at = new Date().toISOString();
    }
  }

  return { data: null, error: null };
}

// ── Simulazione RPC escrow (rispecchia schema-card-event-escrow.sql) ─────
function rpcCommitCardTradeOffer(db, params) {
  const proposals = db.tables.card_event_proposals || [];
  const proposal = proposals.find((p) => p.id === params.p_proposal_id);
  if (!proposal) return { data: null, error: { message: 'Proposta non trovata.' } };
  if (proposal.proposer_profile !== params.p_profile_id) {
    return { data: null, error: { message: 'Solo chi ha proposto lo scambio può confermare la propria cessione.' } };
  }
  if (proposal.status !== 'pending') {
    return { data: null, error: { message: 'Questa proposta non è più in attesa.' } };
  }
  if (proposal.proposer_committed) return { data: null, error: null };

  const profiles = db.tables.user_coc_profiles || [];
  const me = profiles.find((p) => p.id === params.p_profile_id);
  if (!me) return { data: null, error: { message: 'Profilo non trovato.' } };
  const collections = db.tables.card_event_collections || [];
  const row = collections.find((c) => c.coc_tag === me.coc_tag && c.card_key === proposal.card_give);
  if (!row || row.qty_state < 2) {
    return { data: null, error: { message: `Non hai più il doppione richiesto (${proposal.card_give}).` } };
  }
  row.qty_state -= 1;
  proposal.proposer_committed = true;
  return { data: null, error: null };
}

function rpcRefundCardTradeOffer(db, params) {
  const proposals = db.tables.card_event_proposals || [];
  const proposal = proposals.find((p) => p.id === params.p_proposal_id);
  if (!proposal || !proposal.proposer_committed) return { data: null, error: null };

  const profiles = db.tables.user_coc_profiles || [];
  const me = profiles.find((p) => p.id === proposal.proposer_profile);
  if (me) {
    const collections = db.tables.card_event_collections || [];
    const row = collections.find((c) => c.coc_tag === me.coc_tag && c.card_key === proposal.card_give);
    if (row) row.qty_state += 1;
    else collections.push({ coc_tag: me.coc_tag, card_key: proposal.card_give, category: proposal.category, qty_state: 1 });
  }
  proposal.proposer_committed = false;
  return { data: null, error: null };
}

function rpcApplyCardTriangle(db, params) {
  const kind = params.p_kind;
  const idA = params.p_profile_a;
  const idB = params.p_profile_b;
  const idC = params.p_profile_c;
  const cardA = params.p_card_a;
  const cardB = params.p_card_b;
  const cardC = params.p_card_c;
  const triangleId = params.p_triangle_id || null;

  const profiles = db.tables.user_coc_profiles || [];
  const tagA = profiles.find((p) => p.id === idA)?.coc_tag;
  const tagB = profiles.find((p) => p.id === idB)?.coc_tag;
  const tagC = profiles.find((p) => p.id === idC)?.coc_tag;
  if (!tagA || !tagB || !tagC) return { data: null, error: { message: 'Profilo non trovato per il triangolo.' } };

  const coll = db.tables.card_event_collections || [];
  const find = (tag, key) => coll.find((r) => r.coc_tag === tag && r.card_key === key);
  const aGave = find(tagA, cardA);
  const bGave = find(tagB, cardB);
  const cGave = find(tagC, cardC);
  if (!aGave || aGave.qty_state < 2) return { data: null, error: { message: `Il profilo A non ha più il doppione richiesto (${cardA}).` } };
  if (!bGave || bGave.qty_state < 2) return { data: null, error: { message: `Il profilo B non ha più il doppione richiesto (${cardB}).` } };
  if (!cGave || cGave.qty_state < 2) return { data: null, error: { message: `Il profilo C non ha più il doppione richiesto (${cardC}).` } };

  aGave.qty_state -= 1;
  bGave.qty_state -= 1;
  cGave.qty_state -= 1;

  const credit = (tag, key, cat, allowSum) => {
    let row = find(tag, key);
    if (!row) {
      coll.push({ coc_tag: tag, card_key: key, category: cat, qty_state: 1 });
      return null;
    }
    if (!allowSum && row.qty_state >= 1) {
      return { message: `Ha già sbloccato la carta (${key}).` };
    }
    row.qty_state = allowSum ? row.qty_state + 1 : 1;
    return null;
  };

  const allowSum = kind === 'self';
  let e = credit(tagC, cardA, aGave.category, allowSum);
  if (e) return { data: null, error: e };
  e = credit(tagA, cardB, bGave.category, allowSum);
  if (e) return { data: null, error: e };
  e = credit(tagB, cardC, cGave.category, allowSum);
  if (e) return { data: null, error: e };

  if (!db.tables.card_event_trade_log) db.tables.card_event_trade_log = [];
  db.tables.card_event_trade_log.push({
    kind: 'triangle',
    profile_a: idA,
    profile_b: idB,
    profile_c: idC,
    card_a_gave: cardA,
    card_b_gave: cardB,
    card_c_gave: cardC,
    triangle_id: triangleId,
  });

  if (triangleId) {
    const t = (db.tables.card_event_triangle_proposals || []).find((x) => x.id === triangleId);
    if (t) {
      t.status = 'accepted';
      t.accept_a = true;
      t.accept_b = true;
      t.accept_c = true;
      t.resolved_at = new Date().toISOString();
    }
  }
  return { data: null, error: null };
}

function makeFakeSupabase(seed = {}) {
  const db = { tables: {} };
  for (const [table, rows] of Object.entries(seed)) {
    db.tables[table] = rows.map((r) => ({ ...r }));
  }
  return {
    db,
    from(table) {
      return new QueryBuilder(db, table);
    },
    async rpc(fn, params) {
      if (fn === 'apply_card_trade') return rpcApplyCardTrade(db, params);
      if (fn === 'apply_card_triangle') return rpcApplyCardTriangle(db, params);
      if (fn === 'commit_card_trade_offer') return rpcCommitCardTradeOffer(db, params);
      if (fn === 'refund_card_trade_offer') return rpcRefundCardTradeOffer(db, params);
      if (fn === 'find_card_matches' || fn === 'find_self_card_matches') {
        return { data: (db.rpcStubs && db.rpcStubs[fn]) || [], error: null };
      }
      return { data: null, error: { message: `RPC non simulata: ${fn}` } };
    },
  };
}

module.exports = { makeFakeSupabase };

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./_fake-supabase');
const cardTriangles = require('../api/_utils/card-triangles');

const USER_A = 'user-a';
const USER_B = 'user-b';
const USER_C = 'user-c';

function fakeUser(id) {
  return { id };
}

/** Ciclo classico: A ha Barbaro×3 manca Arciere; B ha Arciere×3 manca Gigante; C ha Gigante×3 manca Barbaro. */
function seedTriangle() {
  return makeFakeSupabase({
    card_event_settings: [{ id: 1, enabled: true, ends_at: '2099-01-01T00:00:00Z' }],
    user_coc_profiles: [
      { id: 'p-a1', user_id: USER_A, coc_tag: '#AAA1', username: 'Alice', card_deck_public: true },
      { id: 'p-a2', user_id: USER_A, coc_tag: '#AAA2', username: 'Alice2', card_deck_public: false },
      { id: 'p-a3', user_id: USER_A, coc_tag: '#AAA3', username: 'Alice3', card_deck_public: false },
      { id: 'p-b1', user_id: USER_B, coc_tag: '#BBB1', username: 'Bob', card_deck_public: true },
      { id: 'p-c1', user_id: USER_C, coc_tag: '#CCC1', username: 'Carol', card_deck_public: true },
    ],
    card_event_collections: [
      // A1
      { coc_tag: '#AAA1', card_key: 'elx_barbarian', category: 'elixir', qty_state: 3 },
      { coc_tag: '#AAA1', card_key: 'elx_archer', category: 'elixir', qty_state: 0 },
      { coc_tag: '#AAA1', card_key: 'elx_giant', category: 'elixir', qty_state: 1 },
      // B1
      { coc_tag: '#BBB1', card_key: 'elx_archer', category: 'elixir', qty_state: 3 },
      { coc_tag: '#BBB1', card_key: 'elx_giant', category: 'elixir', qty_state: 0 },
      { coc_tag: '#BBB1', card_key: 'elx_barbarian', category: 'elixir', qty_state: 1 },
      // C1
      { coc_tag: '#CCC1', card_key: 'elx_giant', category: 'elixir', qty_state: 3 },
      { coc_tag: '#CCC1', card_key: 'elx_barbarian', category: 'elixir', qty_state: 0 },
      { coc_tag: '#CCC1', card_key: 'elx_archer', category: 'elixir', qty_state: 1 },
      // Self triangle A1/A2/A3
      { coc_tag: '#AAA2', card_key: 'elx_archer', category: 'elixir', qty_state: 3 },
      { coc_tag: '#AAA2', card_key: 'elx_giant', category: 'elixir', qty_state: 0 },
      { coc_tag: '#AAA2', card_key: 'elx_barbarian', category: 'elixir', qty_state: 1 },
      { coc_tag: '#AAA3', card_key: 'elx_giant', category: 'elixir', qty_state: 3 },
      { coc_tag: '#AAA3', card_key: 'elx_barbarian', category: 'elixir', qty_state: 0 },
      { coc_tag: '#AAA3', card_key: 'elx_archer', category: 'elixir', qty_state: 1 },
    ],
    card_event_triangle_proposals: [],
    card_event_notify_outbox: [],
    card_event_trade_log: [],
  });
}

describe('card-triangles: computeTriangleCycles', () => {
  it('trova un ciclo verde A→C / B→A / C→B con prefer_score≥1 se qty≥3', () => {
    const profiles = [
      {
        id: 'p-a1',
        coc_tag: '#AAA1',
        collection: { elx_barbarian: 3, elx_archer: 0, elx_giant: 1 },
      },
      {
        id: 'p-b1',
        coc_tag: '#BBB1',
        collection: { elx_archer: 3, elx_giant: 0, elx_barbarian: 1 },
      },
      {
        id: 'p-c1',
        coc_tag: '#CCC1',
        collection: { elx_giant: 3, elx_barbarian: 0, elx_archer: 1 },
      },
    ];
    const cycles = cardTriangles.computeTriangleCycles(profiles);
    assert.ok(cycles.length >= 1);
    const hit = cycles.find(
      (c) =>
        c.card_a_gives === 'elx_barbarian' &&
        c.card_b_gives === 'elx_archer' &&
        c.card_c_gives === 'elx_giant',
    );
    assert.ok(hit, 'deve trovare il ciclo Barbaro→Arciere→Gigante');
    assert.equal(hit.prefer_score, 3);
  });

  it('non propone cicli se manca un doppione necessario', () => {
    const profiles = [
      { id: 'p1', collection: { elx_barbarian: 1, elx_archer: 0 } }, // nessun doppione
      { id: 'p2', collection: { elx_archer: 2, elx_giant: 0 } },
      { id: 'p3', collection: { elx_giant: 2, elx_barbarian: 0 } },
    ];
    const cycles = cardTriangles.computeTriangleCycles(profiles);
    assert.equal(cycles.length, 0);
  });
});

describe('card-triangles: self apply', () => {
  it('applica subito un triangolo tra i propri profili', async () => {
    const admin = seedTriangle();
    const res = await cardTriangles.applySelfTriangle(admin, fakeUser(USER_A), {
      profileA: 'p-a1',
      profileB: 'p-a2',
      profileC: 'p-a3',
      cardA: 'elx_barbarian',
      cardB: 'elx_archer',
      cardC: 'elx_giant',
    });
    assert.equal(res.ok, true);
    const qty = (tag, key) =>
      admin.db.tables.card_event_collections.find((r) => r.coc_tag === tag && r.card_key === key)?.qty_state || 0;
    assert.equal(qty('#AAA1', 'elx_barbarian'), 2);
    assert.equal(qty('#AAA1', 'elx_archer'), 1);
    assert.equal(qty('#AAA2', 'elx_archer'), 2);
    assert.equal(qty('#AAA2', 'elx_giant'), 1);
    assert.equal(qty('#AAA3', 'elx_giant'), 2);
    assert.equal(qty('#AAA3', 'elx_barbarian'), 1);
  });
});

describe('card-triangles: p2p propose + accept', () => {
  it('crea proposta e completa dopo le accettazioni degli altri due', async () => {
    const admin = seedTriangle();
    const proposed = await cardTriangles.proposeTriangle(admin, fakeUser(USER_A), {
      profile_a: 'p-a1',
      profile_b: 'p-b1',
      profile_c: 'p-c1',
      card_a_gives: 'elx_barbarian',
      card_b_gives: 'elx_archer',
      card_c_gives: 'elx_giant',
      created_by: 'p-a1',
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.proposal.accept_a, true);
    assert.equal(proposed.proposal.accept_b, false);

    const id = proposed.proposal.id;
    const r1 = await cardTriangles.respondTriangle(admin, fakeUser(USER_B), id, 'accept');
    assert.equal(r1.status, 'pending');

    const r2 = await cardTriangles.respondTriangle(admin, fakeUser(USER_C), id, 'accept');
    assert.equal(r2.status, 'accepted');

    const qty = (tag, key) =>
      admin.db.tables.card_event_collections.find((r) => r.coc_tag === tag && r.card_key === key)?.qty_state || 0;
    assert.equal(qty('#AAA1', 'elx_archer'), 1);
    assert.equal(qty('#BBB1', 'elx_giant'), 1);
    assert.equal(qty('#CCC1', 'elx_barbarian'), 1);
  });

  it('rifiuta propose self masquerading come p2p', async () => {
    const admin = seedTriangle();
    await assert.rejects(
      () =>
        cardTriangles.proposeTriangle(admin, fakeUser(USER_A), {
          profile_a: 'p-a1',
          profile_b: 'p-a2',
          profile_c: 'p-a3',
          card_a_gives: 'elx_barbarian',
          card_b_gives: 'elx_archer',
          card_c_gives: 'elx_giant',
          created_by: 'p-a1',
        }),
      (e) => e.code === 'USE_SELF_TRIANGLE',
    );
  });
});

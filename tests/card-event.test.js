'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../api/_utils/card-event-catalog');
const cardEvent = require('../api/_utils/card-event');

describe('card-event-catalog', () => {
  it('ha esattamente 60 carte totali', () => {
    assert.equal(catalog.TOTAL_CARDS, 60);
    assert.equal(catalog.CARD_EVENT_CATALOG.length, 60);
  });

  it('ripartisce le carte nelle 4 categorie coerenti con l\'evento ufficiale', () => {
    assert.deepEqual(catalog.CATEGORY_TOTALS, {
      elixir: 19,
      dark_elixir: 13,
      builder_base: 11,
      super_troop: 17,
    });
  });

  it('ogni card_key è univoca', () => {
    const keys = catalog.CARD_EVENT_CATALOG.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('ogni carta ha categoria valida, nome IT e icon_url', () => {
    const validCategories = new Set(catalog.CATEGORY_ORDER);
    for (const c of catalog.CARD_EVENT_CATALOG) {
      assert.ok(validCategories.has(c.category), `categoria non valida per ${c.key}`);
      assert.ok(c.name_it && c.name_it.length > 0, `name_it mancante per ${c.key}`);
      assert.ok(/^https:\/\//.test(c.icon_url), `icon_url non valido per ${c.key}`);
    }
  });

  it('CARD_BY_KEY consente lookup O(1) coerente con il catalogo', () => {
    for (const c of catalog.CARD_EVENT_CATALOG) {
      assert.equal(catalog.CARD_BY_KEY.get(c.key), c);
    }
  });
});

describe('card-event: isEventLive', () => {
  it('false se enabled=false anche prima della scadenza', () => {
    const settings = { enabled: false, ends_at: '2099-01-01T00:00:00Z' };
    assert.equal(cardEvent.isEventLive(settings), false);
  });

  it('false dopo ends_at anche se enabled=true', () => {
    const settings = { enabled: true, ends_at: '2000-01-01T00:00:00Z' };
    assert.equal(cardEvent.isEventLive(settings), false);
  });

  it('true se enabled=true e ends_at nel futuro', () => {
    const settings = { enabled: true, ends_at: '2099-01-01T00:00:00Z' };
    assert.equal(cardEvent.isEventLive(settings), true);
  });

  it('false se settings assente', () => {
    assert.equal(cardEvent.isEventLive(null), false);
  });
});

describe('card-event: catalogPayload', () => {
  it('espone catalogo, totali per categoria e stato evento', () => {
    const payload = cardEvent.catalogPayload({ enabled: true, ends_at: '2099-01-01T00:00:00Z' });
    assert.equal(payload.ok, true);
    assert.equal(payload.total_cards, 60);
    assert.equal(payload.cards.length, 60);
    assert.equal(payload.settings.live, true);
    assert.deepEqual(payload.category_order, ['elixir', 'dark_elixir', 'builder_base', 'super_troop']);
  });
});

describe('card-event: collectionHasCards', () => {
  it('false se vuota o solo zeri', () => {
    assert.equal(cardEvent.collectionHasCards({}), false);
    assert.equal(cardEvent.collectionHasCards({ elx_barbarian: 0 }), false);
    assert.equal(cardEvent.collectionHasCards(null), false);
  });
  it('true se almeno una carta posseduta', () => {
    assert.equal(cardEvent.collectionHasCards({ elx_barbarian: 1 }), true);
    assert.equal(cardEvent.collectionHasCards({ elx_archer: 0, elx_barbarian: 2 }), true);
  });
});

describe('card-event: getPublicCollectionByTag', () => {
  const { makeFakeSupabase } = require('./_fake-supabase');

  function seed() {
    return makeFakeSupabase({
      user_coc_profiles: [
        { id: 'p-a', user_id: 'user-a', coc_tag: '#AAA1', username: 'Alice', card_deck_public: false },
        { id: 'p-b', user_id: 'user-b', coc_tag: '#BBB1', username: 'Bob', card_deck_public: true },
      ],
      card_event_collections: [
        { coc_tag: '#AAA1', card_key: 'elx_barbarian', qty_state: 2 },
        { coc_tag: '#BBB1', card_key: 'elx_archer', qty_state: 1 },
      ],
    });
  }

  it('non espone la collezione se il mazzo è nascosto', async () => {
    const admin = seed();
    const res = await cardEvent.getPublicCollectionByTag(admin, '#AAA1', 'user-b');
    assert.equal(res.public, false);
    assert.equal(res.collection, undefined);
  });

  it('il proprietario vede sempre la propria collezione anche se nascosta', async () => {
    const admin = seed();
    const res = await cardEvent.getPublicCollectionByTag(admin, '#AAA1', 'user-a');
    assert.equal(res.is_owner, true);
    assert.equal(res.public, false);
    assert.equal(res.has_collection, true);
    assert.equal(res.collection.elx_barbarian, 2);
  });

  it('espone la collezione se resa pubblica', async () => {
    const admin = seed();
    const res = await cardEvent.getPublicCollectionByTag(admin, '#BBB1', 'user-a');
    assert.equal(res.public, true);
    assert.equal(res.has_collection, true);
    assert.equal(res.collection.elx_archer, 1);
  });
});

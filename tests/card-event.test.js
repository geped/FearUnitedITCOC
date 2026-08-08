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

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./_fake-supabase');
const prefs = require('../api/_utils/card-notify-prefs');

describe('card-notify-prefs: shouldNotifyMatch', () => {
  it('default (tutto off) non notifica', () => {
    assert.equal(prefs.shouldNotifyMatch(null, { iUnlock: true, theyUnlock: true, sameClan: true }), false);
    assert.equal(prefs.shouldNotifyMatch(prefs.DEFAULT_PREFS, { iUnlock: true }), false);
  });

  it('master off ignora i sotto-flag', () => {
    assert.equal(prefs.shouldNotifyMatch({
      matches_enabled: false,
      matches_all: true,
      matches_unlock_me: true,
    }, { iUnlock: true }), false);
  });

  it('matches_all notifica qualsiasi match', () => {
    const p = { matches_enabled: true, matches_all: true };
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: false, theyUnlock: true, sameClan: false }), true);
  });

  it('unlock_me solo se iUnlock', () => {
    const p = { matches_enabled: true, matches_unlock_me: true };
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: true }), true);
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: false, theyUnlock: true }), false);
  });

  it('mutual richiede entrambi sbloccano', () => {
    const p = { matches_enabled: true, matches_mutual: true };
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: true, theyUnlock: true }), true);
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: true, theyUnlock: false }), false);
  });

  it('same_clan è indipendente dallo sblocco', () => {
    const p = { matches_enabled: true, matches_same_clan: true };
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: false, sameClan: true }), true);
    assert.equal(prefs.shouldNotifyMatch(p, { iUnlock: true, sameClan: false }), false);
  });
});

describe('card-notify-prefs: savePrefs', () => {
  it('accendendo il master senza sotto-flag attiva unlock_me', async () => {
    const admin = makeFakeSupabase({});
    const saved = await prefs.savePrefs(admin, 'user-a', { matches_enabled: true });
    assert.equal(saved.prefs.matches_enabled, true);
    assert.equal(saved.prefs.matches_unlock_me, true);
    assert.equal(saved.prefs.matches_all, false);
  });

  it('non riaccende unlock_me se il master era già on', async () => {
    const admin = makeFakeSupabase({
      card_event_notify_prefs: [{
        user_id: 'user-a',
        matches_enabled: true,
        matches_all: false,
        matches_unlock_me: true,
        matches_mutual: false,
        matches_same_clan: false,
      }],
    });
    const saved = await prefs.savePrefs(admin, 'user-a', { matches_unlock_me: false });
    assert.equal(saved.prefs.matches_enabled, true);
    assert.equal(saved.prefs.matches_unlock_me, false);
  });
});

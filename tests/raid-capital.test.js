'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const raid = require('../telegram-bot/lib/raid-capital');

describe('raid-capital helpers', () => {
  it('parseCocTime parses CoC API timestamps as UTC', () => {
    const d = raid.parseCocTime('20260803T070000.000Z');
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-08-03T07:00:00.000Z');
  });

  it('leadReached fires at and below threshold', () => {
    assert.equal(raid.leadReached(12 * 3600 * 1000, 720), true);
    assert.equal(raid.leadReached(12 * 3600 * 1000 - 1, 720), true);
    assert.equal(raid.leadReached(12 * 3600 * 1000 + 1, 720), false);
    assert.equal(raid.leadReached(0, 180), false);
  });

  it('buildRaidParticipation splits done / remaining / none with roster', () => {
    const season = {
      capitalTotalLoot: 50000,
      totalAttacks: 8,
      members: [
        { tag: '#AAA', name: 'Alice', attacks: 6, attackLimit: 5, bonusAttackLimit: 1, capitalResourcesLooted: 20000 },
        { tag: '#BBB', name: 'Bob', attacks: 2, attackLimit: 5, bonusAttackLimit: 0, capitalResourcesLooted: 5000 },
      ],
    };
    const roster = {
      items: [
        { tag: '#AAA', name: 'Alice' },
        { tag: '#BBB', name: 'Bob' },
        { tag: '#CCC', name: 'Carol' },
      ],
    };
    const part = raid.buildRaidParticipation(season, roster);
    assert.equal(part.done.length, 1);
    assert.equal(part.done[0].name, 'Alice');
    assert.equal(part.remaining.length, 1);
    assert.equal(part.remaining[0].name, 'Bob');
    assert.equal(part.none.length, 1);
    assert.equal(part.none[0].name, 'Carol');
    assert.equal(part.totalLoot, 50000);
  });

  it('formatRaidCountdownMessage includes list when requested', () => {
    const season = {
      state: 'ongoing',
      startTime: '20260731T070000.000Z',
      endTime: '20990804T070000.000Z',
      capitalTotalLoot: 1000,
      members: [{ tag: '#Z', name: 'Zero', attacks: 0, attackLimit: 5, bonusAttackLimit: 0, capitalResourcesLooted: 0 }],
    };
    const withList = raid.formatRaidCountdownMessage(season, { items: [{ tag: '#Z', name: 'Zero' }] }, 720, true);
    assert.match(withList, /Promemoria/);
    assert.match(withList, /Non hanno attaccato/);
    const noList = raid.formatRaidCountdownMessage(season, null, 180, false);
    assert.match(noList, /Promemoria/);
    assert.equal(noList.includes('Non hanno attaccato'), false);
  });

  it('formatRaidEndMessage lists completers and missing', () => {
    const season = {
      state: 'ended',
      capitalTotalLoot: 9000,
      raidsCompleted: 2,
      totalAttacks: 5,
      members: [
        { tag: '#A', name: 'A', attacks: 5, attackLimit: 5, bonusAttackLimit: 0, capitalResourcesLooted: 9000 },
      ],
    };
    const text = raid.formatRaidEndMessage(season, { items: [{ tag: '#A', name: 'A' }, { tag: '#B', name: 'B' }] });
    assert.match(text, /Fine weekend/);
    assert.match(text, /Completati/);
    assert.match(text, /Non hanno attaccato/);
    assert.match(text, /B/);
  });

  it('formatRaidCapitalPage paginates members', () => {
    const members = [];
    for (let i = 0; i < 15; i++) {
      members.push({
        tag: `#T${i}`,
        name: `P${i}`,
        attacks: i % 3,
        attackLimit: 5,
        bonusAttackLimit: 0,
        capitalResourcesLooted: i * 100,
      });
    }
    const season = { state: 'ongoing', endTime: '20990804T070000.000Z', members, capitalTotalLoot: 1, raidsCompleted: 0 };
    const p0 = raid.formatRaidCapitalPage(season, { capitalLeague: { name: 'Bronze League I' } }, null, 0);
    assert.ok(p0.pages >= 2);
    assert.match(p0.text, /Bronze League I/);
    assert.match(p0.text, /Pagina <b>1<\/b>/);
  });
});

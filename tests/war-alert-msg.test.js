'use strict';

const { test } = require('node:test');
const assert = require('assert/strict');

// Inline copies of helpers from notifications-extended.js (no Telegram deps).
function memberTh(m) {
  const v = m?.townHallLevel ?? m?.townhallLevel ?? m?.thLevel;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function missingAttacks(war, side = 'clan') {
  const aPM = war?.attacksPerMember || 1;
  const members = side === 'opponent' ? (war?.opponent?.members || []) : (war?.clan?.members || []);
  return members
    .filter((m) => (m.attacks?.length || 0) < aPM)
    .map((m) => ({
      name: m.name,
      th: memberTh(m),
      mapPosition: m.mapPosition ?? null,
      missing: aPM - (m.attacks?.length || 0),
    }))
    .sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
}

function villagesNotThreeStarred(war, side = 'clan') {
  const defenders = side === 'opponent' ? (war?.opponent?.members || []) : (war?.clan?.members || []);
  const attackers = side === 'opponent' ? (war?.clan?.members || []) : (war?.opponent?.members || []);
  const bestByDef = new Map();
  for (const atkMember of attackers) {
    for (const a of atkMember.attacks || []) {
      const tag = a.defenderTag;
      if (!tag) continue;
      const prev = bestByDef.get(tag) || { stars: 0, destruction: 0 };
      const stars = Number(a.stars || 0);
      const destr = Number(a.destructionPercentage || 0);
      if (stars > prev.stars || (stars === prev.stars && destr > prev.destruction)) {
        bestByDef.set(tag, { stars, destruction: destr });
      }
    }
  }
  return defenders
    .map((m) => {
      const best = bestByDef.get(m.tag) || { stars: 0, destruction: 0 };
      return {
        name: m.name,
        th: memberTh(m),
        mapPosition: m.mapPosition ?? null,
        bestStars: best.stars,
        bestDest: best.destruction,
      };
    })
    .filter((v) => v.bestStars < 3)
    .sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
}

const sampleWar = {
  attacksPerMember: 2,
  clan: {
    name: 'Fear United IT',
    stars: 15,
    destructionPercentage: 100,
    members: [
      { tag: '#A', name: 'l97', mapPosition: 1, townHallLevel: 18, attacks: [{ defenderTag: '#X', stars: 3, destructionPercentage: 100 }] },
      { tag: '#B', name: 'Miky', mapPosition: 2, townHallLevel: 17, attacks: [] },
    ],
  },
  opponent: {
    name: 'monforts city',
    stars: 13,
    destructionPercentage: 93,
    members: [
      { tag: '#X', name: 'CYCLONE99', mapPosition: 3, townHallLevel: 18, attacks: [{ defenderTag: '#A', stars: 2, destructionPercentage: 80 }] },
      { tag: '#Y', name: 'Opp2', mapPosition: 1, townHallLevel: 16, attacks: [] },
    ],
  },
};

test('missingAttacks: include TH e lato avversario', () => {
  const ours = missingAttacks(sampleWar, 'clan');
  assert.equal(ours.length, 2);
  const miky = ours.find((m) => m.name === 'Miky');
  const l97 = ours.find((m) => m.name === 'l97');
  assert.equal(miky.th, 17);
  assert.equal(miky.missing, 2);
  assert.equal(l97.th, 18);
  assert.equal(l97.missing, 1);

  const opp = missingAttacks(sampleWar, 'opponent');
  assert.equal(opp.length, 2);
  const opp2 = opp.find((m) => m.name === 'Opp2');
  const cyc = opp.find((m) => m.name === 'CYCLONE99');
  assert.equal(opp2.th, 16);
  assert.equal(opp2.missing, 2);
  assert.equal(cyc.th, 18);
  assert.equal(cyc.missing, 1);
});

test('villagesNotThreeStarred: entrambi i lati', () => {
  const ours = villagesNotThreeStarred(sampleWar, 'clan');
  assert.ok(ours.some((v) => v.name === 'l97' && v.bestStars === 2));
  assert.ok(ours.some((v) => v.name === 'Miky' && v.bestStars === 0));

  const opp = villagesNotThreeStarred(sampleWar, 'opponent');
  assert.ok(opp.some((v) => v.name === 'CYCLONE99' && v.bestStars === 3) === false);
  assert.ok(opp.some((v) => v.name === 'Opp2' && v.bestStars === 0));
  assert.equal(opp.filter((v) => v.name === 'CYCLONE99').length, 0);
});

const { mapCwlRoundToWar, listCwlWarsFromStats } = require('../telegram-bot/lib/cocboard-api');

test('mapCwlRoundToWar: roundNumber, TH e destruction', () => {
  const war = mapCwlRoundToWar({
    roundNumber: 3,
    state: 'inWar',
    teamSize: 15,
    attacksPerMember: 1,
    endTime: '20260802T120000.000Z',
    startTime: '20260801T120000.000Z',
    clan: {
      name: 'Fear',
      tag: '#AAA',
      stars: 10,
      destruction: 80.5,
      members: [{ tag: '#P1', name: 'A', thLevel: 18, mapPosition: 1, attacks: [] }],
    },
    opponent: {
      name: 'Opp',
      tag: '#BBB',
      stars: 8,
      destruction: 70,
      members: [],
    },
  }, 7);
  assert.equal(war.warType, 'cwl');
  assert.equal(war.roundNumber, 3);
  assert.equal(war.totalRounds, 7);
  assert.equal(war.clan.destructionPercentage, 80.5);
  assert.equal(war.clan.members[0].townHallLevel, 18);
  assert.equal(listCwlWarsFromStats({ roundsData: [{ state: 'preparation', roundNumber: 1 }] }).length, 1);
});

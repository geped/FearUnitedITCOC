'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CWL_WIN_BONUS_STARS,
  cwlWarWinner,
  accumulateCwlGroupStandings,
} = require('../shared/cwl-group-standings');

const clans = [
  { tag: '#AAA', name: 'Alpha' },
  { tag: '#BBB', name: 'Beta' },
  { tag: '#CCC', name: 'Gamma' },
];

function war(state, aTag, aStars, aDestr, bTag, bStars, bDestr) {
  return {
    state,
    teamSize: 15,
    clan: { tag: aTag, name: aTag, stars: aStars, destructionPercentage: aDestr },
    opponent: { tag: bTag, name: bTag, stars: bStars, destructionPercentage: bDestr },
  };
}

describe('cwl-group-standings', () => {
  it('bonus vittoria = 10 stelle; sconfitta = 0', () => {
    assert.equal(CWL_WIN_BONUS_STARS, 10);
    const standings = accumulateCwlGroupStandings(clans, [
      war('warEnded', '#AAA', 40, 90, '#BBB', 30, 80),
    ]);
    const alpha = standings.find((c) => c.tag === '#AAA');
    const beta = standings.find((c) => c.tag === '#BBB');
    assert.equal(alpha.attackStars, 40);
    assert.equal(alpha.bonusStars, 10);
    assert.equal(alpha.stars, 50);
    assert.equal(alpha.wins, 1);
    assert.equal(beta.attackStars, 30);
    assert.equal(beta.bonusStars, 0);
    assert.equal(beta.stars, 30);
    assert.equal(beta.wins, 0);
  });

  it('pareggio (stesse stelle e stessa distruzione): nessuno riceve +10', () => {
    assert.equal(cwlWarWinner(
      { stars: 40, destructionPercentage: 95 },
      { stars: 40, destructionPercentage: 95 },
    ), 'draw');
    const standings = accumulateCwlGroupStandings(clans, [
      war('warEnded', '#AAA', 40, 95, '#BBB', 40, 95),
    ]);
    const alpha = standings.find((c) => c.tag === '#AAA');
    const beta = standings.find((c) => c.tag === '#BBB');
    assert.equal(alpha.stars, 40);
    assert.equal(beta.stars, 40);
    assert.equal(alpha.bonusStars, 0);
    assert.equal(beta.bonusStars, 0);
    assert.equal(alpha.wins, 0);
    assert.equal(alpha.draws, 1);
  });

  it('a parità di stelle vince chi ha più distruzione → +10', () => {
    assert.equal(cwlWarWinner(
      { stars: 40, destructionPercentage: 98 },
      { stars: 40, destructionPercentage: 90 },
    ), 'clan');
    const standings = accumulateCwlGroupStandings(clans, [
      war('warEnded', '#AAA', 40, 98, '#BBB', 40, 90),
    ]);
    assert.equal(standings.find((c) => c.tag === '#AAA').stars, 50);
    assert.equal(standings.find((c) => c.tag === '#BBB').stars, 40);
  });

  it('guerra in corso: somma stelle attacco ma nessun bonus vittoria ancora', () => {
    const standings = accumulateCwlGroupStandings(clans, [
      war('inWar', '#AAA', 20, 50, '#BBB', 10, 30),
    ]);
    assert.equal(standings.find((c) => c.tag === '#AAA').stars, 20);
    assert.equal(standings.find((c) => c.tag === '#AAA').bonusStars, 0);
    assert.equal(standings.find((c) => c.tag === '#AAA').wins, 0);
  });

  it('ordina per stelle totali (con bonus), poi distruzione', () => {
    const standings = accumulateCwlGroupStandings(clans, [
      war('warEnded', '#AAA', 35, 80, '#BBB', 30, 70), // AAA 45, BBB 30
      war('warEnded', '#CCC', 44, 99, '#AAA', 20, 50), // CCC 54, AAA 45+20=65
    ]);
    // AAA: 35+10 + 20 = 65 · CCC: 44+10 = 54 · BBB: 30
    assert.equal(standings[0].tag, '#AAA');
    assert.equal(standings[0].stars, 65);
    assert.equal(standings[1].tag, '#CCC');
    assert.equal(standings[1].stars, 54);
    assert.equal(standings[2].tag, '#BBB');
    assert.equal(standings[2].stars, 30);
  });
});

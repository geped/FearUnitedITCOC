'use strict';

/**
 * Classifica gruppo CWL (come in-game):
 * - stelle attacco da ogni guerra del gruppo
 * - +10 stelle bonus per ogni turno vinto
 * - sconfitta: nessun bonus
 * - pareggio (stesse stelle e stessa distruzione %): nessun bonus a nessuno
 * Tie-break classifica: stelle totali, poi distruzione cumulata.
 */

const CWL_WIN_BONUS_STARS = 10;

function normClanTag(tag) {
  if (!tag) return '';
  const s = String(tag).trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s}`;
}

/**
 * Esito di una guerra CWL dal punto di vista delle due parti API.
 * @returns {'clan'|'opponent'|'draw'}
 */
function cwlWarWinner(clan, opponent) {
  const as = Number(clan?.stars || 0);
  const bs = Number(opponent?.stars || 0);
  if (as !== bs) return as > bs ? 'clan' : 'opponent';
  const ad = Number(clan?.destructionPercentage || 0);
  const bd = Number(opponent?.destructionPercentage || 0);
  if (ad !== bd) return ad > bd ? 'clan' : 'opponent';
  return 'draw';
}

/**
 * @param {Array<{tag:string,name?:string,badgeUrls?:object}>} clans — lg.clans
 * @param {Array<object|null>} wars — risultati /clanwarleagues/wars/{tag}
 * @returns {Array<object>} standings ordinati
 */
function accumulateCwlGroupStandings(clans, wars) {
  const groupMap = {};
  for (const c of clans || []) {
    if (!c?.tag) continue;
    const t = normClanTag(c.tag);
    groupMap[t] = {
      tag: t,
      name: c.name || t,
      badgeUrls: c.badgeUrls ?? null,
      stars: 0,
      attackStars: 0,
      bonusStars: 0,
      totalDestr: 0,
      warCount: 0,
      wins: 0,
      draws: 0,
      teamSize: 0,
    };
  }

  for (const war of wars || []) {
    if (!war || war.state === 'notInWar') continue;
    const isEnded = war.state === 'warEnded' || war.state === 'ended';
    const teamSize = war.teamSize || 15;

    for (const side of [war.clan, war.opponent]) {
      if (!side?.tag) continue;
      const tg = normClanTag(side.tag);
      if (!groupMap[tg]) continue;
      const atk = Number(side.stars || 0);
      groupMap[tg].attackStars += atk;
      groupMap[tg].stars += atk;
      groupMap[tg].totalDestr += Number(side.destructionPercentage || 0);
      groupMap[tg].teamSize = groupMap[tg].teamSize || teamSize;
      if (isEnded || war.state === 'inWar') {
        groupMap[tg].warCount++;
      }
    }

    // Bonus +10 solo a guerra conclusa con un vincitore (non in preparazione / in corso / pareggio)
    if (!isEnded || !war.clan?.tag || !war.opponent?.tag) continue;
    const result = cwlWarWinner(war.clan, war.opponent);
    if (result === 'draw') {
      const aTag = normClanTag(war.clan.tag);
      const bTag = normClanTag(war.opponent.tag);
      if (groupMap[aTag]) groupMap[aTag].draws++;
      if (groupMap[bTag]) groupMap[bTag].draws++;
      continue;
    }
    const winnerTag = normClanTag(result === 'clan' ? war.clan.tag : war.opponent.tag);
    const row = groupMap[winnerTag];
    if (!row) continue;
    row.wins++;
    row.bonusStars += CWL_WIN_BONUS_STARS;
    row.stars += CWL_WIN_BONUS_STARS;
  }

  return Object.values(groupMap).sort((a, b) =>
    b.stars !== a.stars ? b.stars - a.stars : b.totalDestr - a.totalDestr,
  );
}

module.exports = {
  CWL_WIN_BONUS_STARS,
  normClanTag,
  cwlWarWinner,
  accumulateCwlGroupStandings,
};

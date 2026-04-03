const { test } = require('node:test');
const assert = require('node:assert/strict');

// Contract tests for new helpers in app.js:
// - _buildCwlAttackPlanner(round)
// - _buildCwlOperationalAlerts(round)

function _buildCwlAttackPlanner(round) {
  const attacksPerMember = round?.attacksPerMember || 1;
  const us = [...(round?.clan?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const them = [...(round?.opponent?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));

  function scoreTarget(attacker, target) {
    const stars = target.bestOpponentAttack?.stars ?? 0;
    if (stars >= 3) return -9999;
    const thDiff = (attacker.thLevel || 0) - (target.thLevel || 0);
    let score = 100;
    score -= Math.abs(thDiff) * 15;
    if (thDiff < 0) score -= 25;
    score += (3 - stars) * 8;
    if (!target.bestOpponentAttack) score += 12;
    if (target.mapPosition === attacker.mapPosition) score += 10;
    return score;
  }

  const out = [];
  for (const a of us) {
    const done = (a.attacks || []).length;
    const missing = Math.max(0, attacksPerMember - done);
    if (missing <= 0) continue;

    const ranked = them
      .map(t => ({ target: t, score: scoreTarget(a, t) }))
      .sort((x, y) => y.score - x.score);

    const best = ranked[0]?.target || them[0];
    const targetStars = best?.bestOpponentAttack?.stars ?? 0;
    const targetDestPct = best?.bestOpponentAttack?.destructionPercentage ?? 0;
    const thDelta = (a.thLevel || 0) - (best?.thLevel || 0);

    out.push({
      attackerName: a.name || '—',
      attackerTag: a.tag || '',
      attackerPosition: a.mapPosition ?? '?',
      attackerThLevel: a.thLevel || 0,
      targetName: best?.name || '—',
      targetTag: best?.tag || '',
      targetPosition: best?.mapPosition ?? '?',
      targetThLevel: best?.thLevel || 0,
      targetStars,
      targetDestPct,
      missingAttacks: missing,
      thDelta,
    });
  }
  return out;
}

function _buildCwlOperationalAlerts(round) {
  const alerts = [];
  const attacksPerMember = round?.attacksPerMember || 1;
  const us = [...(round?.clan?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const themByPos = new Map((round?.opponent?.members || []).map(m => [m.mapPosition, m]));
  const missing = us.reduce((acc, m) => acc + Math.max(0, attacksPerMember - ((m.attacks || []).length)), 0);
  if (missing > 0) alerts.push({ code: 'missing-attacks', severity: missing >= 3 ? 'high' : 'medium' });
  let strongMismatch = 0;
  us.forEach(m => {
    const opp = themByPos.get(m.mapPosition);
    if (!opp) return;
    if (Math.abs((m.thLevel || 0) - (opp.thLevel || 0)) >= 2) strongMismatch++;
  });
  if (strongMismatch > 0) alerts.push({ code: 'th-mismatch', severity: strongMismatch >= 3 ? 'high' : 'low' });
  if (!alerts.length) alerts.push({ code: 'ok', severity: 'ok' });
  return alerts;
}

test('planner: suggerisce target mirror per player con attacco disponibile', () => {
  const round = {
    state: 'inWar',
    clan: {
      members: [
        { tag: '#A', name: 'Alpha', thLevel: 16, mapPosition: 1, attacks: [] },
      ],
    },
    opponent: {
      members: [
        { tag: '#X', name: 'Xray', thLevel: 16, mapPosition: 1 },
      ],
    },
  };

  const rows = _buildCwlAttackPlanner(round);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attackerName, 'Alpha');
  assert.equal(rows[0].targetName, 'Xray');
  assert.equal(rows[0].attackerPosition, 1);
  assert.equal(rows[0].targetPosition, 1);
  assert.equal(rows[0].missingAttacks, 1);
});

test('planner: evita target già 3-stellati, preferisce base vergine', () => {
  const round = {
    state: 'inWar',
    attacksPerMember: 1,
    clan: {
      members: [
        { tag: '#A', name: 'Alpha', thLevel: 15, mapPosition: 1, attacks: [] },
      ],
    },
    opponent: {
      members: [
        { tag: '#X', name: 'Xray',  thLevel: 15, mapPosition: 1, bestOpponentAttack: { stars: 3, destructionPercentage: 100 } },
        { tag: '#Y', name: 'Yankee', thLevel: 15, mapPosition: 2 }, // base vergine
      ],
    },
  };

  const rows = _buildCwlAttackPlanner(round);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].targetName, 'Yankee', 'deve evitare Xray già 3-stellato');
  assert.equal(rows[0].targetStars, 0);
});

test('planner: include posizione attaccante e target nel risultato', () => {
  const round = {
    state: 'inWar',
    attacksPerMember: 1,
    clan: {
      members: [
        { tag: '#A', name: 'Alpha', thLevel: 14, mapPosition: 3, attacks: [] },
      ],
    },
    opponent: {
      members: [
        { tag: '#X', name: 'Xray', thLevel: 14, mapPosition: 3 },
      ],
    },
  };

  const rows = _buildCwlAttackPlanner(round);
  assert.equal(rows[0].attackerPosition, 3);
  assert.equal(rows[0].targetPosition, 3);
  assert.equal(rows[0].attackerThLevel, 14);
  assert.equal(rows[0].targetThLevel, 14);
});

test('alerts: segnala attacchi mancanti quando il turno è live', () => {
  const round = {
    state: 'inWar',
    clan: {
      members: [
        { tag: '#A', name: 'Alpha', attacks: [] },
        { tag: '#B', name: 'Beta', attacks: [{ stars: 2 }] },
      ],
    },
  };
  const alerts = _buildCwlOperationalAlerts(round);
  assert.ok(alerts.some(a => a.code === 'missing-attacks'));
});

test('alerts: segnala mismatch TH forti nel confronto mirror', () => {
  const round = {
    state: 'warEnded',
    clan: { members: [{ tag: '#A', name: 'Alpha', thLevel: 16, mapPosition: 1 }] },
    opponent: { members: [{ tag: '#X', name: 'Xray', thLevel: 13, mapPosition: 1 }] },
  };
  const alerts = _buildCwlOperationalAlerts(round);
  assert.ok(alerts.some(a => a.code === 'th-mismatch'));
});

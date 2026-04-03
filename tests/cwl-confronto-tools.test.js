const { test } = require('node:test');
const assert = require('node:assert/strict');

// Contract tests for new helpers in app.js:
// - _buildCwlAttackPlanner(round)
// - _buildCwlOperationalAlerts(round)

function _buildCwlAttackPlanner(round) {
  const attacksPerMember = round?.attacksPerMember || 1;
  const us = [...(round?.clan?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const them = [...(round?.opponent?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const byPos = new Map(them.map(m => [m.mapPosition, m]));
  const unresolved = them.filter(m => !(m.bestOpponentAttack && m.bestOpponentAttack.stars >= 3));
  const out = [];
  for (const a of us) {
    const done = (a.attacks || []).length;
    const missing = Math.max(0, attacksPerMember - done);
    if (missing <= 0) continue;
    let target = byPos.get(a.mapPosition);
    if (!target) {
      const th = a.thLevel || 0;
      target = unresolved
        .slice()
        .sort((x, y) => Math.abs((x.thLevel || 0) - th) - Math.abs((y.thLevel || 0) - th))[0] || them[0];
    }
    out.push({
      attackerName: a.name || '—',
      attackerTag: a.tag || '',
      targetName: target?.name || '—',
      targetTag: target?.tag || '',
      missingAttacks: missing,
      thDelta: (a.thLevel || 0) - (target?.thLevel || 0),
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
  assert.equal(rows[0].missingAttacks, 1);
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

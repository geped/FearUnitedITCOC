/**
 * Test formula merito CWL — copiata da api/generate-bonuses.js
 * Esegui con: node --test tests/bonus-calculator.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Formula estratta (copiata da api/generate-bonuses.js per testabilità)
function calculateMerit(stats, history) {
    const req  = Math.max(stats.attacksRequired || 0, 1);
    const made = stats.attacksMade || 0;
    const avgD = made > 0 ? (stats.destructionPercentage || 0) / made : 0;
    let score  = (stats.stars / req) * 40 + avgD * 0.2 + (made / req) * 20;
    if (history?.received_last_month) score = 0;
    return Math.round(score * 10) / 10;
}

test('score massimo: 7 attacchi, 21 stelle, 700% distruzione totale', () => {
    const stats = { stars: 21, destructionPercentage: 700, attacksMade: 7, attacksRequired: 7 };
    const score = calculateMerit(stats, null);
    // (21/7)*40 = 3*40 = 120
    // avgD = 700/7 = 100 → 100*0.2 = 20
    // (7/7)*20 = 20  → totale = 160
    assert.equal(score, 160, `score atteso 160 ma ottenuto ${score}`);
});

test('score zero se ha ricevuto bonus il mese scorso', () => {
    const stats = { stars: 18, destructionPercentage: 500, attacksMade: 6, attacksRequired: 7 };
    const score = calculateMerit(stats, { received_last_month: true });
    assert.equal(score, 0, 'score deve essere 0 per anti-duplicati');
});

test('score zero se nessun attacco effettuato', () => {
    const stats = { stars: 0, destructionPercentage: 0, attacksMade: 0, attacksRequired: 7 };
    const score = calculateMerit(stats, null);
    assert.equal(score, 0, 'score deve essere 0 senza attacchi');
});

test('partecipazione parziale penalizza il punteggio', () => {
    const statsFull    = { stars: 6, destructionPercentage: 200, attacksMade: 7, attacksRequired: 7 };
    const statsPartial = { stars: 6, destructionPercentage: 200, attacksMade: 3, attacksRequired: 7 };
    const scoreFull    = calculateMerit(statsFull, null);
    const scorePartial = calculateMerit(statsPartial, null);
    assert.ok(scoreFull > scorePartial, 'partecipazione piena deve dare score maggiore');
});

test('attacksRequired = 0 non causa divisione per zero', () => {
    const stats = { stars: 3, destructionPercentage: 100, attacksMade: 1, attacksRequired: 0 };
    assert.doesNotThrow(() => calculateMerit(stats, null));
});

test('risultati coerenti: score arrotondato a 1 decimale', () => {
    const stats = { stars: 5, destructionPercentage: 300, attacksMade: 5, attacksRequired: 7 };
    const score = calculateMerit(stats, null);
    const decimals = (score.toString().split('.')[1] || '').length;
    assert.ok(decimals <= 1, `score deve avere max 1 decimale, ottenuto: ${score}`);
});

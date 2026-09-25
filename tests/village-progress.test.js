'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/village-export-th14');
const { parseVillageExport } = require('../api/_utils/village-progress-parser');
const { calculateProgress } = require('../api/_utils/village-progress-calc');
const { loadDataset } = require('../api/_utils/village-progress-dataset');

describe('village-progress dataset', () => {
  it('carica entities con dataId Town Hall e Wall', () => {
    const ds = loadDataset();
    assert.ok(ds.entities.length > 100);
    assert.equal(ds.byId.get(1000001).name, 'Town Hall');
    assert.equal(ds.byId.get(1000010).category, 'walls');
    assert.ok(ds.version);
  });
});

describe('village-progress parser', () => {
  it('estrae tag, TH, BH e items', () => {
    const p = parseVillageExport(fixture);
    assert.equal(p.tag, '#TESTVP99');
    assert.equal(p.gameTimestamp, 1700000000);
    assert.equal(p.thLevel, 14);
    assert.equal(p.bhLevel, 10);
    assert.ok(p.items.length > 10);
    assert.ok(p.items.some((i) => i.dataId === 1000010 && i.village === 'home'));
  });

  it('rifiuta JSON senza tag', () => {
    assert.throws(() => parseVillageExport({ timestamp: 1, buildings: [{ data: 1000001, lvl: 10 }] }), /tag/i);
  });

  it('accetta stringa JSON', () => {
    const p = parseVillageExport(JSON.stringify(fixture));
    assert.equal(p.thLevel, 14);
  });
});

describe('village-progress calc', () => {
  it('produce % TH e globale + costi', () => {
    const parsed = parseVillageExport(fixture);
    const summary = calculateProgress(parsed);
    assert.equal(summary.th_level, 14);
    assert.equal(summary.bh_level, 10);
    assert.ok(summary.home.pct_th > 0 && summary.home.pct_th <= 1);
    assert.ok(summary.home.pct_global > 0 && summary.home.pct_global <= 1);
    assert.ok(summary.home.pct_global <= summary.home.pct_th + 1e-9);
    assert.ok(summary.home.categories.walls);
    assert.ok(summary.home.categories.defenses);
    assert.ok(typeof summary.home.time_sec_th === 'number');
    assert.ok(summary.home.cost_th.gold >= 0);
    assert.ok(summary.builder.pct_th > 0);
    assert.ok(summary.dataset_version);
    assert.ok(summary.disclaimer);
  });

  it('preview allinea parser+calc', () => {
    const parsed = parseVillageExport(fixture);
    const summary = calculateProgress(parsed);
    assert.equal(parsed.tag, '#TESTVP99');
    assert.equal(summary.th_level, 14);
  });
});

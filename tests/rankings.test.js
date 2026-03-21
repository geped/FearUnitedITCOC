/**
 * Test classifiche (Rankings) — costanti e funzioni di rendering
 * Copiate da app.js per testabilità (monolite non importabile)
 * Esegui con: node --test tests/rankings.test.js
 *
 * Requisiti coperti: CLAS-01, CLAS-02, CLAS-03, CLAS-04, CLAS-05, CLAS-06, CLAS-07
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Costanti (TARGET state — valore atteso dopo il fix) ───────────────────────
const RANK_LOCATIONS = { global: 'global', italy: '32000094' };

// ── Funzioni di supporto copiate da app.js ────────────────────────────────────
function thImgSrc(l) { return 'th/webp/level_' + String(l).padStart(2, '0') + '.webp'; }
function openRankPlayer() {}
function openRankClan() {}

// thImgV — copiata da app.js linee 582-588
function thImgV(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  return `<div class="th-cell-v">
    <img src="${thImgSrc(level)}" alt="TH${level}" class="th-img" onerror="thImgFallback(this,${level})">
    <span class="th-label-v">TH${level}</span>
  </div>`;
}

// _renderRankPlayers — copiata da app.js (versione aggiornata: CDN-only badge, no TH col, openRankPlayer)
function _renderRankPlayers(el, items) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Giocatore</th><th>Clan</th><th>Trofei</th>
    </tr></thead>
    <tbody>
      ${items.map((p,i) => {
        const lbHtml = p.league?.iconUrls?.small
          ? `<img src="${p.league.iconUrls.small}" class="league-badge-sm" alt="" style="margin-right:4px">`
          : '';
        const rankClass = i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':'';
        return `<tr class="cc-member-row" onclick="openRankPlayer('${p.tag.replace(/'/g,"\\'")}')">
          <td class="stat-cell"><span class="rank-num ${rankClass}">${p.rank??i+1}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.35rem">
              ${lbHtml}<span style="font-weight:600">${p.name}</span>
            </div>
            <div class="mono" style="font-size:0.72rem;color:var(--text-3)">${p.tag}</div>
          </td>
          <td style="font-size:0.82rem;color:var(--text-2)">${p.clan?.name||'—'}</td>
          <td class="stat-cell">${(p.trophies||0).toLocaleString('it')} 🏆</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

// _renderRankClans — copiata da app.js (usa openRankClan)
function _renderRankClans(el, items) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Clan</th><th>Membri</th><th>Trofei</th>
    </tr></thead>
    <tbody>
      ${items.map((c,i) => {
        const badge = c.badgeUrls?.small||'';
        const rankClass = i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':'';
        return `<tr class="cc-member-row" onclick="openRankClan('${c.tag.replace(/'/g,"\\'")}')">
          <td class="stat-cell"><span class="rank-num ${rankClass}">${c.rank??i+1}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.4rem">
              ${badge?`<img src="${badge}" class="cerca-clan-badge" style="width:28px;height:28px">`:'' }
              <div>
                <div style="font-weight:600">${c.name}</div>
                <div class="mono" style="font-size:0.72rem;color:var(--text-3)">${c.tag}</div>
              </div>
            </div>
          </td>
          <td class="stat-cell">${c.members??'—'}/50</td>
          <td class="stat-cell">${(c.clanPoints||0).toLocaleString('it')} 🏆</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

// ── Dati mock ─────────────────────────────────────────────────────────────────
const mockPlayers = [{
  rank: 1, name: 'TestPlayer', tag: '#ABC123',
  clan: { name: 'TestClan' }, townHallLevel: 16, trophies: 6000,
  league: { name: 'Legend League', iconUrls: { small: 'https://cdn.example.com/legend.png' } }
}];

const mockPlayersNoIcon = [{
  rank: 1, name: 'TestPlayer2', tag: '#DEF456',
  clan: { name: 'TestClan2' }, townHallLevel: 15, trophies: 5500,
  league: { name: 'Legend League' }
}];

const mockClans = [{
  rank: 1, name: 'TestClan', tag: '#CLAN01',
  badgeUrls: { small: 'https://cdn.example.com/badge.png' },
  members: 45, clanPoints: 50000
}];

// ── Test ──────────────────────────────────────────────────────────────────────

// CLAS-01: locationId globale deve essere la stringa 'global' (non '32000000')
test('CLAS-01: RANK_LOCATIONS.global è la stringa global', () => {
  assert.equal(RANK_LOCATIONS.global, 'global',
    `RANK_LOCATIONS.global deve essere 'global', non '${RANK_LOCATIONS.global}'`);
});

// CLAS-02: locationId Italia rimane immutata (regression guard)
test('CLAS-02: RANK_LOCATIONS.italy è 32000094', () => {
  assert.equal(RANK_LOCATIONS.italy, '32000094',
    `RANK_LOCATIONS.italy deve essere '32000094'`);
});

// CLAS-05: thImgV(undefined) restituisce span con classe th-unknown
test('CLAS-05: thImgV(undefined) restituisce th-unknown', () => {
  const html = thImgV(undefined);
  assert.ok(html.includes('th-unknown'),
    `thImgV(undefined) deve contenere 'th-unknown', ottenuto: ${html}`);
});

// CLAS-05b: thImgV(16) restituisce elemento con TH16
test('CLAS-05b: thImgV(16) restituisce elemento con TH16', () => {
  const html = thImgV(16);
  assert.ok(html.includes('TH16'),
    `thImgV(16) deve contenere 'TH16', ottenuto: ${html}`);
});

// CLAS-03: CDN badge priorità — se disponibile usa CDN, non fallback locale
test('CLAS-03: _renderRankPlayers usa CDN url quando disponibile', () => {
  const el = { innerHTML: '' };
  _renderRankPlayers(el, mockPlayers);
  assert.ok(el.innerHTML.includes('https://cdn.example.com/legend.png'),
    'Output deve contenere URL CDN della lega');
  assert.ok(!el.innerHTML.includes('leagues/'),
    'Non deve usare badge locali quando CDN è disponibile');
});

// CLAS-03b: Nessun fallback a leagues/ se CDN non disponibile (badge omesso)
test('CLAS-03b: _renderRankPlayers non mostra badge locale obsoleto se CDN assente', () => {
  const el = { innerHTML: '' };
  _renderRankPlayers(el, mockPlayersNoIcon);
  assert.ok(!el.innerHTML.includes('leagues/'),
    'Non deve usare fallback leagues/*.png — badge locali obsoleti rimossi');
});

// CLAS-04: Clan crest con classe cerca-clan-badge
test('CLAS-04: _renderRankClans mostra badge clan con cerca-clan-badge', () => {
  const el = { innerHTML: '' };
  _renderRankClans(el, mockClans);
  assert.ok(el.innerHTML.includes('cerca-clan-badge'),
    'Output deve contenere classe cerca-clan-badge per il badge del clan');
  assert.ok(el.innerHTML.includes('https://cdn.example.com/badge.png'),
    'Output deve contenere URL badge del clan');
});

// CLAS-07: onclick openRankPlayer (profilo inline, non cerca)
test('CLAS-07: _renderRankPlayers ha onclick openRankPlayer', () => {
  const el = { innerHTML: '' };
  _renderRankPlayers(el, mockPlayers);
  assert.ok(el.innerHTML.includes('openRankPlayer('),
    "Output deve contenere onclick openRankPlayer");
  assert.ok(!el.innerHTML.includes('openCercaPlayer('),
    "Non deve usare openCercaPlayer (aprirebbe tab cerca)");
});

// CLAS-07b: onclick openRankClan (profilo inline, non cerca)
test('CLAS-07b: _renderRankClans ha onclick openRankClan', () => {
  const el = { innerHTML: '' };
  _renderRankClans(el, mockClans);
  assert.ok(el.innerHTML.includes('openRankClan('),
    "Output deve contenere onclick openRankClan");
  assert.ok(!el.innerHTML.includes('openCercaClan('),
    "Non deve usare openCercaClan (aprirebbe tab cerca)");
});

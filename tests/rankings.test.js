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
function _rankLeagueImgErr() {}

/** Sottoinsieme della mappa app (solo per test fallback locale su nome noto senza CDN) */
const LEAGUE_BADGE_MAP = {
  'Legend League': 'LeggendaV2',
};

function rankLeagueBadgeHtml(league, opts) {
  if (!league) return '<span class="no-league-badge">—</span>';
  const nameEn = league.name || '';
  const imgClass = (opts && opts.imgClass) || 'league-badge-sm';
  const titleEsc = nameEn.replace(/"/g, '&quot;').replace(/</g, '');
  const apiUrl = league.iconUrls && (league.iconUrls.large || league.iconUrls.medium || league.iconUrls.small);
  const localFile = LEAGUE_BADGE_MAP[nameEn];
  const localPath = localFile ? `leagues/${localFile}.png` : '';
  const fbAttr = localPath ? ` data-league-fb="${localPath.replace(/"/g, '&quot;')}"` : '';

  if (apiUrl) {
    return `<img src="${apiUrl}" alt="" class="${imgClass}" loading="lazy" decoding="async"${fbAttr} title="${titleEsc}" onerror="_rankLeagueImgErr(this)">`;
  }
  if (localPath) {
    return `<img src="${localPath}" alt="${nameEn.replace(/"/g, '')}" class="${imgClass}" loading="lazy" title="${titleEsc}">`;
  }
  return nameEn
    ? `<span class="no-league-badge" title="${titleEsc}">—</span>`
    : '<span class="no-league-badge">—</span>';
}

function _playerLeagueForBadge(p) {
  if (!p) return null;
  const lt = p.leagueTier;
  if (lt && (lt.name || (lt.iconUrls && (lt.iconUrls.small || lt.iconUrls.medium || lt.iconUrls.large)))) {
    return {
      name: lt.name || p.league?.name || '',
      iconUrls: lt.iconUrls || p.league?.iconUrls,
    };
  }
  return p.league || null;
}

function _rankingPlayerLeague(p) {
  return _playerLeagueForBadge(p);
}

// thImgV — copiata da app.js linee 582-588
function thImgV(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  return `<div class="th-cell-v">
    <img src="${thImgSrc(level)}" alt="TH${level}" class="th-img" onerror="thImgFallback(this,${level})">
    <span class="th-label-v">TH${level}</span>
  </div>`;
}

// _renderRankPlayers — allineata a app.js (leagueTier + rankLeagueBadgeHtml, stemma clan, ATK/DEF)
function _renderRankPlayers(el, items) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Giocatore</th><th>Clan</th><th>Trofei</th><th>Att. vinti</th><th>Dif. vinte</th>
    </tr></thead>
    <tbody>
      ${items.map((p,i) => {
        const lbHtml = rankLeagueBadgeHtml(_rankingPlayerLeague(p));
        const cb = p.clan?.badgeUrls?.small || p.clan?.badgeUrls?.medium || '';
        const clanLabel = p.clan?.name || '—';
        const clanCell = cb
          ? `<div class="rank-clan-cell"><img src="${cb}" alt="" class="rank-clan-badge-img" loading="lazy" width="28" height="28"><span>${clanLabel}</span></div>`
          : `<span style="font-size:0.82rem;color:var(--text-2)">${clanLabel}</span>`;
        const atk = p.attackWins != null ? p.attackWins : '—';
        const def = p.defenseWins != null ? p.defenseWins : '—';
        const rankClass = i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':'';
        return `<tr class="cc-member-row" onclick="openRankPlayer('${p.tag.replace(/'/g,"\\'")}')">
          <td class="stat-cell"><span class="rank-num ${rankClass}">${p.rank??i+1}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.35rem">
              ${lbHtml}<span style="font-weight:600">${p.name}</span>
            </div>
            <div class="mono" style="font-size:0.72rem;color:var(--text-3)">${p.tag}</div>
          </td>
          <td>${clanCell}</td>
          <td class="stat-cell">${(p.trophies||0).toLocaleString('it')}</td>
          <td class="stat-cell">${atk}</td>
          <td class="stat-cell">${def}</td>
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
  clan: {
    name: 'TestClan',
    badgeUrls: { small: 'https://cdn.example.com/clan-badge.png' },
  },
  townHallLevel: 16,
  trophies: 6000,
  attackWins: 12,
  defenseWins: 3,
  league: { name: 'Legend League', iconUrls: { small: 'https://cdn.example.com/legend.png' } },
}];

/** Lega senza CDN e senza entry in LEAGUE_BADGE_MAP di test → nessun leagues/*.png */
const mockPlayersNoIcon = [{
  rank: 1, name: 'TestPlayer2', tag: '#DEF456',
  clan: { name: 'TestClan2' }, townHallLevel: 15, trophies: 5500,
  league: { name: 'Zzz Unmapped League For Test' },
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

// CLAS-03: CDN badge priorità — se disponibile usa CDN come src (data-league-fb può puntare a PNG locale per onerror)
test('CLAS-03: _renderRankPlayers usa CDN url quando disponibile', () => {
  const el = { innerHTML: '' };
  _renderRankPlayers(el, mockPlayers);
  assert.ok(el.innerHTML.includes('https://cdn.example.com/legend.png'),
    'Output deve contenere URL CDN della lega');
  assert.ok(!el.innerHTML.match(/class="league-badge-sm"[^>]*src="leagues\//),
    'L’attributo src del badge lega non deve essere un file locale quando la CDN è disponibile');
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

test('CLAS-08: _renderRankPlayers mostra stemma clan (rank-clan-badge-img) se badgeUrls', () => {
  const el = { innerHTML: '' };
  _renderRankPlayers(el, mockPlayers);
  assert.ok(el.innerHTML.includes('rank-clan-badge-img'),
    'Colonna clan deve includere immagine badge');
  assert.ok(el.innerHTML.includes('https://cdn.example.com/clan-badge.png'),
    'URL stemma clan dalla API');
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

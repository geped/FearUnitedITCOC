const COC_CLAN_TAG = "%232J2VLPP9R";

const db = window.sb;

// Mappatura ruoli CoC API → etichette italiane
// Nota: nell'API CoC "admin" = Anziano (Elder), NON admin app
const COC_ROLES = {
  leader: { label: "Capo", cls: "role-leader" },
  coLeader: { label: "Co-Capo", cls: "role-coleader" },
  admin: { label: "Anziano", cls: "role-elder" },
  member: { label: "Membro", cls: "role-member" },
};

const ROLE_ORDER = { leader: 0, coLeader: 1, admin: 2, member: 3 };

function cocRole(role) {
  return COC_ROLES[role] || { label: role || "—", cls: "role-member" };
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

db.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(session.user);
  else showLogin();
});

// Converte "nomeutente" → "nomeutente@fearunited.internal" per login interni
function resolveLoginEmail(input) {
  const s = input.trim();
  if (s.includes('@')) return s;
  // Stessa normalizzazione usata in api/admin/users.js
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_') + '@fearunited.internal';
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const rawInput = document.getElementById("email").value;
    const email    = resolveLoginEmail(rawInput);
    const { error } = await db.auth.signInWithPassword({
      email,
      password: document.getElementById("password").value,
    });
    if (error) {
      // Messaggio più chiaro per utenti senza email reale
      const msg = error.message.includes('Invalid login')
        ? 'Credenziali errate. Controlla il nome utente e la password.'
        : error.message;
      showLoginError(msg);
    }
  } catch (err) {
    showLoginError("Errore di connessione. Ricarica la pagina e riprova.");
  }
});


document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signUp({
    email: document.getElementById("signup-email").value,
    password: document.getElementById("signup-password").value,
  });
  if (error) showLoginError(error.message);
  else
    showLoginError(
      "Controlla la tua email per confermare la registrazione.",
      "info",
    );
});

document.getElementById("show-signup").addEventListener("click", () => {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("show-signup").style.display = "none";
  document.getElementById("signup-form").style.display = "flex";
  document.getElementById("show-login").style.display = "block";
  document.getElementById("login-error").style.display = "none";
});

document.getElementById("show-login").addEventListener("click", () => {
  document.getElementById("signup-form").style.display = "none";
  document.getElementById("show-login").style.display = "none";
  document.getElementById("login-form").style.display = "flex";
  document.getElementById("show-signup").style.display = "block";
  document.getElementById("login-error").style.display = "none";
});

document
  .getElementById("logout-btn")
  .addEventListener("click", () => db.auth.signOut());

function showLoginError(msg, type = "error") {
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.className = type === "info" ? "info-msg" : "error-msg";
  el.style.display = "block";
}

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("app").style.display = "none";
}

// Costanti ruoli
const ROLES = [
  { value: 'utente',  label: 'Utente',   cls: 'role-utente' },
  { value: 'membro',  label: 'Membro',   cls: 'role-member' },
  { value: 'anziano', label: 'Anziano',  cls: 'role-elder' },
  { value: 'co-capo', label: 'Co-Capo', cls: 'role-coleader' },
  { value: 'admin',   label: 'Admin',    cls: 'role-leader' },
];
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.value, r]));

async function showApp(sessionUser) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-email').textContent = sessionUser.email;
  const topbarEmailEl = document.getElementById('topbar-email');
  if (topbarEmailEl) topbarEmailEl.textContent = sessionUser.email;

  // Recupera i dati utente aggiornati dal server (evita metadata stale)
  let user = sessionUser;
  try {
    const { data } = await db.auth.getUser();
    if (data?.user) user = data.user;
  } catch (_) {}

  const role = user.user_metadata?.role || 'utente';
  const isAdmin   = role === 'admin';
  const isCoCapo  = role === 'co-capo';
  const canEdit   = isAdmin || isCoCapo;  // può modificare bonus

  // Badge ruolo in header
  const badge = document.getElementById('user-role-badge');
  const roleInfo = ROLE_LABELS[role];
  if (roleInfo) {
    badge.textContent = roleInfo.label;
    badge.className = `badge ${roleInfo.cls}`;
    badge.style.display = 'inline';
  }
  // Solo admin+co-capo vedono pannello bonus / pulsanti di modifica
  // (gli elementi tab admin sono esclusi perché gestiti sotto separatamente)
  document.querySelectorAll('.admin-only').forEach(el => {
    // Salta i tab/nav che portano alla sezione admin: gestiti a parte
    if (el.dataset.tab === 'admin') return;
    const tag = el.tagName.toLowerCase();
    el.style.display = canEdit
      ? (el.classList.contains('bnav-btn') ? 'flex'
         : tag === 'button' || tag === 'span' ? 'inline-block' : 'block')
      : 'none';
  });

  // Solo admin vede tab "Gestione Utenti" — deve venire DOPO il loop admin-only
  document.querySelectorAll('[data-tab="admin"]').forEach(el => {
    el.style.display = isAdmin
      ? (el.classList.contains('bnav-btn') ? 'flex' : 'inline-block')
      : 'none';
  });

  // Imposta stagione bonus al mese corrente
  const seasonInput = document.getElementById('bonus-season');
  if (seasonInput) seasonInput.value = new Date().toISOString().slice(0, 7);

  // Salva il ruolo corrente globalmente
  window._userRole = role;
  window._canEdit  = canEdit;  // usato da renderCwlSeasons per pulsante ✏️

  loadMembers();
}



// ── NAVIGATION ────────────────────────────────────────────────────────────────

const TAB_TITLES = {
  members: 'Clan',
  warlog:  'Registri Guerre',
  cwl:     'Bonus CWL',
  admin:   'Gestione Utenti',
};

function activateTab(tabId) {
  // Aggiorna TUTTI i tab-btn (sidebar + bottom-nav)
  document.querySelectorAll('.tab-btn, .bnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(s => (s.style.display = 'none'));
  const sec = document.getElementById('tab-' + tabId);
  if (sec) sec.style.display = 'block';
  // Aggiorna titolo topbar
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = TAB_TITLES[tabId] || tabId;
  if (tabId === 'admin') loadUsers();
  if (tabId === 'warlog') setTimeout(loadWarLog, 80);
  if (tabId === 'cwl') setTimeout(loadAssignBonus, 80);
}

document.querySelectorAll('.tab-btn, .bnav-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Hamburger
function openNav() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('nav-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeNav() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('open');
  document.body.style.overflow = '';
}


// ── MEMBRI ────────────────────────────────────────────────────────────────────

async function loadMembers() {
  const { data } = await db.from("members").select("*").order("name");
  renderMembers(data || []);
}

function thImg(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  const n = String(level).padStart(2, "0");
  return `<div class="th-cell">
        <img src="th/level_${n}.png" alt="TH${level}" class="th-img">
        <span class="th-label">TH${level}</span>
    </div>`;
}

// Vertical variant: image with level shown below (used in CWL sections)
function thImgV(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  const n = String(level).padStart(2, "0");
  return `<div class="th-cell-v">
    <img src="th/level_${n}.png" alt="TH${level}" class="th-img">
    <span class="th-label-v">TH${level}</span>
  </div>`;
}

// Ex-player placeholder (player left the clan)
function thImgOut() {
  return `<div class="th-cell-v">
    <img src="th/playerout.png" alt="Ex" class="th-img th-img-out">
    <span class="th-label-v" style="color:var(--red)">EX</span>
  </div>`;
}

// Resolve TH for bonus contexts: use thImgV if in clan, thImgOut if ex, ? if unknown
function thImgBonus(playerName, isExPlayer) {
  const member = resolveMember(playerName);
  if (member?.th_level) return thImgV(member.th_level);
  if (isExPlayer) return thImgOut();
  return '<span class="th-unknown">?</span>';
}

function renderMembers(members) {
  const tbody = document.querySelector("#members-table tbody");
  tbody.innerHTML = "";
  const now = new Date();

  members.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 4;
    const rb = ROLE_ORDER[b.role] ?? 4;
    if (ra !== rb) return ra - rb;
    if ((b.th_level ?? 0) !== (a.th_level ?? 0))
      return (b.th_level ?? 0) - (a.th_level ?? 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  members.forEach((m) => {
    const joinDate = m.first_seen ? new Date(m.first_seen) : now;
    const isNew = Math.floor((now - joinDate) / 86400000) < 7;
    const role = cocRole(m.role);
    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td class="th-col">${thImg(m.th_level)}</td>
            <td>
                <span class="member-name">${m.name}</span>
                ${isNew ? '<span class="new-badge">NUOVO</span>' : ""}
                <br><span class="tag-cell">${m.tag}</span>
            </td>
            <td><span class="role-badge ${role.cls}">${role.label}</span></td>
            <td class="stat-cell">${m.trophies ?? '—'}</td>
            <td class="stat-cell hide-sm">${m.donations ?? '—'} / ${m.donations_received ?? '—'}</td>
            <td class="stat-cell hide-sm">${m.clan_rank ?? '—'}</td>
            <td class="date-cell hide-md">${joinDate.toLocaleDateString('it-IT')}</td>
        `;
    tbody.appendChild(tr);
  });

  // Aggiorna stat cards
  const leaders = members.filter(m => m.role === 'leader' || m.role === 'coLeader').length;
  const thLevels = members.map(m => m.th_level).filter(Boolean);
  const avgTh = thLevels.length ? (thLevels.reduce((a,b)=>a+b,0)/thLevels.length).toFixed(1) : '—';
  const newCount = members.filter(m => {
    if (!m.first_seen) return false;
    return Math.floor((new Date() - new Date(m.first_seen)) / 86400000) < 7;
  }).length;
  const s = id => document.getElementById(id);
  if (s('stat-total'))   s('stat-total').textContent   = members.length;
  if (s('stat-leaders')) s('stat-leaders').textContent = leaders;
  if (s('stat-avg-th'))  s('stat-avg-th').textContent  = avgTh;
  if (s('stat-new'))     s('stat-new').textContent     = newCount;
}


document.getElementById("sync-btn").addEventListener("click", async () => {
  const status = document.getElementById("sync-status");
  status.textContent = "Sincronizzazione in corso…";
  try {
    const res = await fetch("/api/sync-members");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Errore server");
    status.textContent = `✓ Sincronizzati ${data.synced} membri`;
    loadMembers();
  } catch (err) {
    status.textContent = "✗ " + err.message;
  }
});

// ── CWL ────────────────────────────────────────────────────────────────────────

let cwlLiveData = null;

async function loadCwlHistory() {
  const { data } = await db
    .from('cwl_history')
    .select('player_name, still_in_clan, is_secondary, participated, stars, destruction, attacks_made, attacks_required, bonus_score, bonus_assigned, season')
    .order('bonus_score', { ascending: false });
  return data || [];
}


function renderCwlTable(history, live) {
  const div = document.getElementById('bonus-results');
  if (!div) return; // elemento rimosso nel nuovo layout

  // Mappa live per nome
  const liveMap = {};
  if (live) live.forEach(p => { liveMap[p.name.toLowerCase()] = p; });

  // ── AGGREGA per giocatore ──────────────────────────────────────────────────
  // cwl_history ha una riga per stagione (e per ogni bonus assegnato).
  // Raggruppiamo per player_name per evitare duplicati.
  const playerMap = {};
  history.forEach(h => {
    const key = h.player_name;
    if (!playerMap[key]) {
      playerMap[key] = {
        player_name:   h.player_name,
        still_in_clan: h.still_in_clan,
        is_secondary:  h.is_secondary,
        participated:  h.participated,
        stars:         h.stars,
        destruction:   h.destruction,
        attacks_made:  h.attacks_made,
        attacks_required: h.attacks_required,
        bonus_score:   0,
        bonus_months:  []   // stagioni in cui ha ricevuto bonus
      };
    }
    const p = playerMap[key];
    // Somma score (la stessa sessione non va sommata due volte)
    p.bonus_score = Math.max(p.bonus_score, h.bonus_score ?? 0);
    // Accumula mesi bonus
    if (h.bonus_assigned && h.season) p.bonus_months.push(h.season);
    // Aggiorna dati live se presenti nella sessione corrente
    if (h.stars    != null) p.stars    = h.stars;
    if (h.destruction != null) p.destruction = h.destruction;
    if (h.attacks_made != null) p.attacks_made = h.attacks_made;
    if (h.attacks_required != null) p.attacks_required = h.attacks_required;
    if (h.participated) p.participated = true;
    if (h.still_in_clan) p.still_in_clan = true;
    if (h.is_secondary) p.is_secondary = true;
  });

  const players = Object.values(playerMap);
  players.sort((a, b) => (b.bonus_score - a.bonus_score) || a.player_name.localeCompare(b.player_name));

  const active    = players.filter(p => p.still_in_clan && !p.is_secondary);
  const exPlayers = players.filter(p => !p.still_in_clan && !p.is_secondary);
  const secondary = players.filter(p => p.is_secondary);

  function buildRows(rows) {
    return rows.map((h, i) => {
      const lp = liveMap[h.player_name.toLowerCase()];
      const stars = lp ? lp.stars       : h.stars       != null ? h.stars       : '—';
      const destr = lp ? lp.destruction.toFixed(1) + '%' : h.destruction ? h.destruction.toFixed(1) + '%' : '—';
      const atk   = lp ? `${lp.attacks_made}/${lp.attacks_required}` : h.attacks_made ? `${h.attacks_made}/${h.attacks_required}` : '—';
      const participated = h.participated
        ? '<span class="cwl-yes">✓ CWL</span>'
        : '<span class="cwl-no">✗</span>';
      const statusCls = !h.still_in_clan ? 'cwl-exmember' : '';
      // Pillole mesi bonus
      const bonusPills = h.bonus_months.length
        ? h.bonus_months.sort().map(s => `<span class="bo-pill">${s}</span>`).join('')
        : '<span style="color:var(--text-3);font-size:0.78rem">—</span>';

      return `<tr class="${statusCls}">
        <td class="stat-cell">${i + 1}</td>
        <td class="member-name">${h.player_name}</td>
        <td>${participated}</td>
        <td class="stat-cell">${stars}</td>
        <td class="stat-cell">${destr}</td>
        <td class="stat-cell">${atk}</td>
        <td class="stat-cell"><strong>${h.bonus_score}</strong></td>
        <td style="min-width:120px">${bonusPills}</td>
      </tr>`;
    }).join('');
  }

  div.innerHTML = `
    <div class="table-wrap">
      <table id="cwl-table">
        <thead>
          <tr>
            <th>#</th><th>Nome</th><th>CWL</th>
            <th>⭐ Stelle</th><th>💥 Distruz.</th>
            <th>⚔ Attacchi</th><th>Score</th>
            <th>🏆 Mesi bonus</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(active)}
          ${exPlayers.length ? `<tr class="cwl-section-row"><td colspan="8">Ex-Player</td></tr>${buildRows(exPlayers)}` : ''}
          ${secondary.length ? `<tr class="cwl-section-row"><td colspan="8">Account Secondari</td></tr>${buildRows(secondary)}` : ''}
        </tbody>
      </table>
    </div>`;
}


// ── CWL BONUS TABS ────────────────────────────────────────────────────────────

function switchCwlTab(tab, btn) {
  document.querySelectorAll('[data-cwl-tab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['assign','storico','hof'].forEach(t => {
    const el = document.getElementById('cwl-tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'storico') loadStorico();
  if (tab === 'hof') loadHallOfFame();
}

// ── ASSEGNA BONUS ─────────────────────────────────────────────────────────────

let _assignMembersMap = {};  // name.toLowerCase() → {th_level, tag, name, ...}
let _playerAliases   = {};  // alias.toLowerCase() → {alias, coc_name, tag, th_level}

// Carica alias da Supabase (tabella player_aliases)
async function loadPlayerAliases() {
  _playerAliases = {};
  try {
    const { data } = await db.from('player_aliases').select('*');
    (data || []).forEach(a => { _playerAliases[a.alias.toLowerCase()] = a; });
  } catch (_) {} // tabella potrebbe non esistere ancora
}

// Risolve un nome player → membro (controlla memberMap diretta + aliases)
function resolveMember(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  const direct = _assignMembersMap[key];
  if (direct) return direct;
  const alias = _playerAliases[key];
  if (alias?.coc_name) {
    const byCoc = _assignMembersMap[alias.coc_name.toLowerCase()];
    if (byCoc) return byCoc;
    if (alias.tag || alias.th_level) return { th_level: alias.th_level, tag: alias.tag, name: alias.coc_name };
  }
  return null;
}

// True se il player è ATTUALMENTE nel clan (via directo o alias)
function isCurrentMember(name) {
  if (!name) return false;
  if (_assignMembersMap[name.toLowerCase()]) return true;
  const a = _playerAliases[name.toLowerCase()];
  return !!(a?.coc_name && _assignMembersMap[a.coc_name.toLowerCase()]);
}

async function loadMembersMap() {
  _assignMembersMap = {};

  // 1) Carica PRIMA da Supabase — veloce e sempre disponibile (ha th_level, tag, ecc.)
  const { data: sbData } = await db.from('members').select('*');
  if (sbData) sbData.forEach(m => { _assignMembersMap[m.name.toLowerCase()] = m; });

  // 2) Prova a refreshare dai dati live CoC API (con timeout 6s per non bloccare)
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('/api/clan-members', { signal: ctrl.signal });
    clearTimeout(tid);
    if (r.ok) {
      const j = await r.json();
      // Dati API più freschi: sovrascrivono quelli Supabase
      (j.items || []).forEach(m => { _assignMembersMap[m.name.toLowerCase()] = m; });
    }
  } catch (_) {} // timeout o proxy offline → usiamo dati Supabase

  await loadPlayerAliases();
}

async function loadAssignBonus() {
  const status = document.getElementById('cwl-status');
  if (!status) return;
  status.textContent = 'Verifica CWL in corso…';

  try {
    const res = await fetch('/api/cwl-stats');
    const data = await res.json();

    if (data.state !== 'notInWar' && data.players?.length) {
      cwlLiveData = data.players;
      const season = data.season || new Date().toISOString().slice(0, 7);

      const banner = document.getElementById('assign-live-banner');
      const selector = document.getElementById('assign-month-selector');
      if (banner) banner.style.display = 'flex';
      if (selector) selector.style.display = 'none';
      const liveSeasonEl = document.getElementById('assign-live-season');
      if (liveSeasonEl) liveSeasonEl.textContent = ` — Stagione ${season}`;
      const liveBadge = document.getElementById('cwl-live-badge');
      if (liveBadge) liveBadge.style.display = 'inline-block';

      status.textContent = `✓ CWL live — ${data.players.length} giocatori`;
      await loadMembersMap();
      renderAssignContent(data.players, season, true);
    } else {
      // Nessuna CWL attiva
      const banner = document.getElementById('assign-live-banner');
      const selector = document.getElementById('assign-month-selector');
      const liveBadge = document.getElementById('cwl-live-badge');
      if (banner) banner.style.display = 'none';
      if (selector) selector.style.display = 'block';
      if (liveBadge) liveBadge.style.display = 'none';
      cwlLiveData = null;

      const pick = document.getElementById('assign-season-pick');
      if (pick && !pick.value) pick.value = new Date().toISOString().slice(0, 7);

      status.textContent = 'Nessuna CWL in corso. Seleziona un mese storico.';
      await loadAssignMostRecent();
    }
  } catch (err) {
    status.textContent = '⚠ API non disponibile. Seleziona un mese manualmente.';
    const selector = document.getElementById('assign-month-selector');
    if (selector) selector.style.display = 'block';
    const pick = document.getElementById('assign-season-pick');
    if (pick && !pick.value) pick.value = new Date().toISOString().slice(0, 7);
    await loadAssignMostRecent();
  }
}

async function loadAssignMostRecent() {
  const { data } = await db.from('cwl_history')
    .select('season')
    .order('season', { ascending: false })
    .limit(1);
  if (data?.[0]?.season) {
    const pick = document.getElementById('assign-season-pick');
    if (pick) pick.value = data[0].season;
    await loadAssignMonth(data[0].season);
  }
}

async function loadAssignLive() {
  const status = document.getElementById('cwl-status');
  if (status) status.textContent = 'Aggiornamento dati live…';
  try {
    const res = await fetch('/api/cwl-stats');
    const data = await res.json();
    if (data.players?.length) {
      cwlLiveData = data.players;
      const season = data.season || new Date().toISOString().slice(0, 7);
      const liveSeasonEl = document.getElementById('assign-live-season');
      if (liveSeasonEl) liveSeasonEl.textContent = ` — Stagione ${season}`;
      if (status) status.textContent = `✓ Aggiornato — ${data.players.length} giocatori`;
      await loadMembersMap();
      renderAssignContent(data.players, season, true);
    }
  } catch (err) {
    if (status) status.textContent = '✗ ' + err.message;
  }
}

// ── SALVA STAGIONE CWL LIVE ────────────────────────────────────────────────────
async function saveCwlSeasonLive() {
  if (!cwlLiveData?.length) {
    const status = document.getElementById('cwl-status');
    if (status) status.textContent = '⚠ Nessun dato live disponibile.';
    return;
  }
  const seasonEl = document.getElementById('assign-live-season');
  const season = seasonEl?.textContent?.replace(/\s*—\s*Stagione\s*/i, '').trim()
    || new Date().toISOString().slice(0, 7);

  const btn = document.getElementById('save-live-season-btn');
  const status = document.getElementById('cwl-status');
  if (btn) { btn.disabled = true; btn.textContent = '💾 Salvataggio…'; }
  if (status) status.textContent = 'Salvataggio stagione…';

  const rows = cwlLiveData.map(p => {
    const req = Math.max(p.attacks_required || 1, 1);
    const made = p.attacks_made || 0;
    const stars = p.stars || 0;
    const destr = p.destruction || 0;
    const bonusScore = Math.round((stars / req) * 40 + (destr / Math.max(made, 1)) * 0.2 + (made / req) * 20);
    return {
      player_name:      p.name,
      season,
      participated:     true,
      stars,
      destruction:      parseFloat(destr.toFixed(2)),
      attacks_made:     made,
      attacks_required: p.attacks_required || 0,
      bonus_score:      bonusScore,
      bonus_assigned:   false,
      still_in_clan:    true,
      is_secondary:     false
    };
  });

  const { error } = await db.from('cwl_history').upsert(rows, { onConflict: 'player_name,season' });
  if (btn) { btn.disabled = false; btn.textContent = '💾 Salva Stagione'; }
  if (error) {
    if (status) status.textContent = '✗ Errore: ' + error.message;
  } else {
    if (status) status.textContent = `✓ Stagione ${season} salvata — ${rows.length} giocatori. Ora assegna i bonus.`;
    // Reload the assign content to reflect saved data
    await loadAssignMonth(season);
  }
}

async function loadAssignMonth(overrideSeason) {
  const season = overrideSeason || document.getElementById('assign-season-pick')?.value;
  if (!season) {
    const d = document.getElementById('assign-content');
    if (d) d.innerHTML = '<p class="wl-loading">Seleziona un mese.</p>';
    return;
  }
  const statusEl = document.getElementById('assign-load-status');
  if (statusEl) statusEl.textContent = 'Caricamento…';

  const { data: history } = await db.from('cwl_history')
    .select('*')
    .eq('season', season)
    .order('bonus_score', { ascending: false });

  await loadMembersMap();
  if (statusEl) statusEl.textContent = '';
  renderAssignContent(history || [], season, false);
}

function renderAssignContent(players, season, isLive) {
  const div = document.getElementById('assign-content');
  if (!div) return;
  const canEdit = window._canEdit;

  const [y, m] = season.split('-');
  const monthLabel = new Date(+y, +m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  let html = '';

  // ── Sezione Bonus Assegnati (solo storico, non live) ──────────────────────
  if (!isLive) {
    const bonusPlayers = players.filter(p => p.bonus_assigned);
    if (bonusPlayers.length) {
      html += `<div class="assign-bonus-section">
        <h3 class="assign-section-title">🏆 Bonus assegnati — ${monthLabel}</h3>
        <div class="assign-bonus-grid">`;
      bonusPlayers.forEach(p => {
        const member = _assignMembersMap[p.player_name?.toLowerCase()];
        const thHtml = thImgBonus(p.player_name, !p.still_in_clan);
        const tag = member?.tag || '—';
        const avgD = p.attacks_made > 0 ? (p.destruction / p.attacks_made).toFixed(1) + '%' : '—';
        html += `<div class="assign-bonus-card">
          <div class="assign-card-th">${thHtml}</div>
          <div class="assign-card-info">
            <span class="member-name">${p.player_name}</span>
            <span class="tag-cell">${tag}</span>
          </div>
          <div class="assign-card-stats">
            <span title="Stelle">⭐ ${p.stars ?? '—'}</span>
            <span title="Distruzione media">💥 ${avgD}</span>
            <span title="Attacchi">⚔ ${p.attacks_made ?? '—'}/${p.attacks_required ?? '—'}</span>
          </div>
        </div>`;
      });
      html += '</div></div>';
    } else {
      html += `<div class="assign-bonus-section">
        <p class="wl-loading">Nessun bonus assegnato per ${monthLabel}.</p>
      </div>`;
    }
  }

  // ── Tabella tutti i giocatori ─────────────────────────────────────────────
  const list = isLive ? players : players.filter(p => !p.is_secondary);

  html += `<div class="card" style="margin-top:0.25rem">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">
      <h3 class="card-title" style="margin:0">
        ${isLive ? `🌐 Partecipanti live — Stagione ${season}` : `👥 Tutti i giocatori — ${monthLabel}`}
      </h3>
      ${canEdit ? `<div style="display:flex;gap:0.4rem">
        <button id="assign-edit-btn" class="btn-secondary btn-sm" onclick="toggleAssignEdit()">✏️ Modifica</button>
        <button id="assign-save-btn" class="btn-primary btn-sm" onclick="saveAssignChanges('${season}')" style="display:none">💾 Salva</button>
        <button id="assign-cancel-btn" class="btn-secondary btn-sm" onclick="toggleAssignEdit(true)" style="display:none">✕ Annulla</button>
      </div>` : ''}
    </div>
    <div class="table-wrap">
      <table id="assign-table">
        <thead><tr>
          <th class="assign-chk-col" style="display:none;width:36px;text-align:center">✓</th>
          <th>TH</th>
          <th>Nome / Tag</th>
          <th>CWL</th>
          <th>⭐ Stelle</th>
          <th class="hide-xs">💥 Distruz.</th>
          <th class="hide-xs">⚔ Attacchi</th>
          <th class="hide-sm">Score</th>
        </tr></thead>
        <tbody>`;

  list.forEach(p => {
    const name = isLive ? p.name : p.player_name;
    const member = _assignMembersMap[name?.toLowerCase()];
    const isEx = !isLive && !p.still_in_clan;
    const thHtml = thImgBonus(name, isEx);
    const tag = member?.tag ? `<br><span class="tag-cell">${member.tag}</span>` : '';
    const hasBonus = !isLive && p.bonus_assigned;
    const participated = isLive || p.participated;
    const destr = isLive ? (p.destruction || 0) : (p.destruction || 0);
    const atkMade = p.attacks_made ?? 0;
    const atkReq = p.attacks_required ?? 0;
    const avgD = atkMade > 0 ? (destr / atkMade).toFixed(1) + '%' : '—';
    const atk = atkReq > 0 ? `${atkMade}/${atkReq}` : '—';
    const score = isLive ? '—' : (p.bonus_score ?? '—');
    const stars = isLive ? (p.stars ?? '—') : (p.stars ?? '—');
    const participatedHtml = participated
      ? '<span class="cwl-yes">✓ CWL</span>'
      : '<span class="cwl-no">✗</span>';
    const bonusIcon = hasBonus ? ' <span class="assign-bonus-icon">🏆</span>' : '';

    html += `<tr>
      <td class="assign-chk-col stat-cell" style="display:none">
        <input type="checkbox" class="assign-check" data-name="${name.replace(/"/g, '&quot;')}" ${hasBonus ? 'checked' : ''} style="accent-color:#f0a500;width:16px;height:16px">
      </td>
      <td>${thHtml}</td>
      <td><span class="member-name">${name}${bonusIcon}</span>${tag}</td>
      <td>${participatedHtml}</td>
      <td class="stat-cell">${stars}</td>
      <td class="stat-cell hide-xs">${avgD}</td>
      <td class="stat-cell hide-xs">${atk}</td>
      <td class="stat-cell hide-sm"><strong>${score}</strong></td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  div.innerHTML = html;
}

function toggleAssignEdit(cancel = false) {
  const editBtn = document.getElementById('assign-edit-btn');
  const saveBtn = document.getElementById('assign-save-btn');
  const cancelBtn = document.getElementById('assign-cancel-btn');
  const isEditing = saveBtn?.style.display !== 'none';
  const turnOn = !cancel && !isEditing;

  document.querySelectorAll('.assign-chk-col').forEach(el => {
    el.style.display = turnOn ? '' : 'none';
  });
  document.querySelectorAll('.assign-bonus-icon').forEach(el => {
    el.style.opacity = turnOn ? '0.35' : '1';
  });
  if (editBtn)  editBtn.style.display  = turnOn ? 'none' : 'inline-block';
  if (saveBtn)  saveBtn.style.display  = turnOn ? 'inline-block' : 'none';
  if (cancelBtn) cancelBtn.style.display = turnOn ? 'inline-block' : 'none';
}

async function saveAssignChanges(season) {
  const saveBtn = document.getElementById('assign-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '💾 Salvataggio…'; }

  const checks = document.querySelectorAll('.assign-check');
  const status = document.getElementById('cwl-status');
  const rows = [];
  checks.forEach(cb => {
    rows.push({
      player_name: cb.dataset.name,
      season,
      bonus_assigned: cb.checked,
      participated: true,
      stars: 0, destruction: 0.0,
      attacks_made: 0, attacks_required: 0,
      bonus_score: 0, still_in_clan: true, is_secondary: false
    });
  });

  if (!rows.length) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salva'; }
    return;
  }

  const { error } = await db.from('cwl_history')
    .upsert(rows, { onConflict: 'player_name,season' });

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salva'; }

  if (error) {
    if (status) status.textContent = '✗ Errore: ' + error.message;
  } else {
    const bonusCount = rows.filter(r => r.bonus_assigned).length;
    if (status) status.textContent = `✓ Salvato! ${bonusCount} bonus assegnati per ${season}.`;
    toggleAssignEdit(true);
    await loadAssignMonth(season);
  }
}

// ── STORICO ASSEGNAZIONI ──────────────────────────────────────────────────────

let _storicoData = [];
let _storicoSort = { col: 'bonus_months', dir: -1 };

async function loadStorico() {
  const div = document.getElementById('storico-content');
  if (!div) return;
  div.innerHTML = '<p class="wl-loading">Caricamento storico…</p>';

  const { data: history, error } = await db.from('cwl_history')
    .select('*')
    .order('season', { ascending: false });

  if (error || !history?.length) {
    div.innerHTML = error
      ? `<p style="color:#ff6b6b">Errore: ${error.message}</p>`
      : '<p class="wl-loading">Nessun dato storico disponibile.</p>';
    return;
  }

  await loadMembersMap();

  // Aggrega per giocatore
  const playerMap = {};
  history.forEach(h => {
    const key = h.player_name;
    if (!playerMap[key]) {
      playerMap[key] = {
        player_name: key,
        still_in_clan: false,
        is_secondary: h.is_secondary || false,
        best_stars: 0,
        best_destruction: 0,
        best_attacks_made: 0,
        best_attacks_required: 0,
        best_score: 0,
        bonus_months: [],
        total_seasons: 0
      };
    }
    const p = playerMap[key];
    if (h.still_in_clan) p.still_in_clan = true;
    if (h.is_secondary) p.is_secondary = true;
    p.total_seasons++;
    if ((h.stars || 0) >= p.best_stars) {
      if ((h.stars || 0) > p.best_stars || (h.bonus_score || 0) > p.best_score) {
        p.best_stars = h.stars || 0;
        p.best_destruction = h.destruction || 0;
        p.best_attacks_made = h.attacks_made || 0;
        p.best_attacks_required = h.attacks_required || 0;
      }
    }
    if ((h.bonus_score || 0) > p.best_score) p.best_score = h.bonus_score || 0;
    if (h.bonus_assigned && h.season) p.bonus_months.push(h.season);
  });

  _storicoData = Object.values(playerMap);
  filterStorico();
}

function filterStorico() {
  const search = (document.getElementById('storico-search')?.value || '').toLowerCase();
  const filter = document.getElementById('storico-filter')?.value || '';

  let data = _storicoData;
  if (search) data = data.filter(p => p.player_name.toLowerCase().includes(search));
  if (filter === 'active')    data = data.filter(p => p.still_in_clan && !p.is_secondary);
  else if (filter === 'ex')   data = data.filter(p => !p.still_in_clan && !p.is_secondary);
  else if (filter === 'secondary') data = data.filter(p => p.is_secondary);

  renderStoricoTable(data);
}

function sortStorico(col) {
  if (_storicoSort.col === col) _storicoSort.dir *= -1;
  else { _storicoSort.col = col; _storicoSort.dir = -1; }
  filterStorico();
}

function renderStoricoTable(data) {
  const div = document.getElementById('storico-content');
  if (!div) return;

  if (!data.length) {
    div.innerHTML = '<p class="wl-loading">Nessun risultato.</p>';
    return;
  }

  // Sort
  const { col, dir } = _storicoSort;
  data = [...data].sort((a, b) => {
    let av, bv;
    if (col === 'bonus_months') { av = a.bonus_months.length; bv = b.bonus_months.length; }
    else if (col === 'best_stars') { av = a.best_stars; bv = b.best_stars; }
    else if (col === 'best_score') { av = a.best_score; bv = b.best_score; }
    else if (col === 'name') { return dir * a.player_name.localeCompare(b.player_name); }
    else { av = a[col] || 0; bv = b[col] || 0; }
    return dir * ((av ?? 0) - (bv ?? 0));
  });

  const active    = data.filter(p => p.still_in_clan && !p.is_secondary);
  const exPlayers = data.filter(p => !p.still_in_clan && !p.is_secondary);
  const secondary = data.filter(p => p.is_secondary);

  const sortArrow = (c) => {
    if (_storicoSort.col !== c) return '<span style="opacity:0.3;font-size:0.7rem">⇅</span>';
    return _storicoSort.dir > 0 ? '↑' : '↓';
  };

  function buildRows(rows, isEx) {
    return rows.map(p => {
      const member = _assignMembersMap[p.player_name.toLowerCase()];
      const thHtml = thImgBonus(p.player_name, isEx);
      const tag = member?.tag || '—';
      const nameCls = isEx ? 'member-name storico-ex-name' : 'member-name';
      const avgD = p.best_attacks_made > 0
        ? (p.best_destruction / p.best_attacks_made).toFixed(1) + '%'
        : '—';
      const atk = p.best_attacks_required > 0
        ? `${p.best_attacks_made}/${p.best_attacks_required}`
        : '—';
      const pills = p.bonus_months.length
        ? p.bonus_months.sort().slice(-5).map(s => {
            const [y, mo] = s.split('-');
            const lbl = new Date(+y, +mo-1, 1).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
            return `<span class="bo-pill">${lbl}</span>`;
          }).join('') + (p.bonus_months.length > 5 ? `<span class="bo-pill" style="opacity:0.6">+${p.bonus_months.length - 5}</span>` : '')
        : '<span style="color:var(--text-3);font-size:0.78rem">—</span>';
      return `<tr>
        <td>${thHtml}</td>
        <td class="tag-cell">${tag}</td>
        <td><span class="${nameCls}">${p.player_name}</span></td>
        <td class="stat-cell">${p.best_stars || '—'}</td>
        <td class="stat-cell hide-xs">${avgD}</td>
        <td class="stat-cell hide-xs">${atk}</td>
        <td class="stat-cell hide-sm"><strong>${p.best_score || '—'}</strong></td>
        <td class="stat-cell"><strong style="color:var(--gold)">${p.bonus_months.length}</strong></td>
        <td style="min-width:150px;padding:0.4rem 0.6rem">${pills}</td>
      </tr>`;
    }).join('');
  }

  const s = sortArrow;
  div.innerHTML = `
    <div class="table-wrap">
      <table id="storico-table">
        <thead><tr>
          <th>TH</th>
          <th onclick="sortStorico('name')" class="sortable-th">Tag / Nome ${s('name')}</th>
          <th></th>
          <th onclick="sortStorico('best_stars')" class="sortable-th">⭐ Stelle ${s('best_stars')}</th>
          <th class="hide-xs">💥 Distruz.</th>
          <th class="hide-xs">⚔ Attacchi</th>
          <th onclick="sortStorico('best_score')" class="sortable-th hide-sm">Score ${s('best_score')}</th>
          <th onclick="sortStorico('bonus_months')" class="sortable-th">🏆 Tot. ${s('bonus_months')}</th>
          <th style="min-width:150px">Mesi bonus</th>
        </tr></thead>
        <tbody>
          ${buildRows(active, false)}
          ${exPlayers.length ? `<tr class="cwl-section-row"><td colspan="9">— Ex-player (${exPlayers.length})</td></tr>${buildRows(exPlayers, true)}` : ''}
          ${secondary.length ? `<tr class="cwl-section-row"><td colspan="9">— Account secondari (${secondary.length})</td></tr>${buildRows(secondary, false)}` : ''}
        </tbody>
      </table>
    </div>`;
}

// ── HALL OF FAME ──────────────────────────────────────────────────────────────

async function loadHallOfFame() {
  const div = document.getElementById('hof-content');
  if (!div) return;
  div.innerHTML = '<p class="wl-loading">Caricamento…</p>';

  await loadMembersMap();

  const { data, error } = await db.from('cwl_history')
    .select('player_name, season, still_in_clan, bonus_score')
    .eq('bonus_assigned', true)
    .order('season', { ascending: true });

  if (error) { div.innerHTML = `<p style="color:var(--red)">Errore: ${error.message}</p>`; return; }
  if (!data?.length) { div.innerHTML = '<p class="wl-loading">Nessun bonus trovato.</p>'; return; }

  // Raggruppa per player
  const map = {};
  for (const r of data) {
    if (!map[r.player_name]) map[r.player_name] = { months: [], inClan: false };
    map[r.player_name].months.push(r.season);
  }

  // Verifica membership ATTUALE (usa alias se nome storico ≠ nome CoC)
  for (const name of Object.keys(map)) {
    map[name].inClan = isCurrentMember(name);
    const member = resolveMember(name);
    if (member?.tag) map[name].tag = member.tag;
  }

  const players = Object.entries(map)
    .sort((a, b) => b[1].months.length - a[1].months.length || a[0].localeCompare(b[0]));

  const maxBonus = players[0]?.[1]?.months.length || 1;
  const totalBonus = data.length;

  let html = `<p style="margin:0 0 1rem;font-size:0.84rem;color:var(--text-3)">
    <strong style="color:var(--text)">${players.length}</strong> giocatori · <strong style="color:var(--gold)">${totalBonus}</strong> bonus totali assegnati
  </p>`;

  // Podio top 3
  if (players.length >= 1) {
    const podiumData = players.slice(0, Math.min(3, players.length));
    const podiumOrder = podiumData.length >= 2 ? [1, 0, 2].filter(i => i < podiumData.length) : [0];
    html += '<div class="hof-podium">';
    const heights = ['hof-gold', 'hof-silver', 'hof-bronze'];
    const medals = ['🥇', '🥈', '🥉'];
    podiumOrder.forEach(i => {
      const [name, info] = podiumData[i];
      const thH = thImgBonus(name, !info.inClan);
      html += `<div class="hof-podium-item ${heights[i]}">
        <div class="hof-podium-th" style="margin-bottom:0.3rem">${thH}</div>
        <div class="hof-medal">${medals[i]}</div>
        <div class="hof-podium-name">${name}</div>
        <div class="hof-podium-count">${info.months.length}</div>
        <div class="hof-podium-label">bonus</div>
      </div>`;
    });
    html += '</div>';
  }

  // Tabella completa
  html += `<div class="table-wrap" style="margin-top:1rem">
    <table>
      <thead><tr>
        <th style="width:40px">#</th>
        <th style="width:40px">TH</th>
        <th>Giocatore</th>
        <th style="width:80px">Tag</th>
        <th style="text-align:center;width:50px">🏆</th>
        <th style="min-width:100px">Progressione</th>
        <th>Mesi ricevuti</th>
        <th style="text-align:center;width:56px">Clan</th>
      </tr></thead>
      <tbody>`;

  players.forEach(([name, info], i) => {
    const total = info.months.length;
    const barPct = Math.round((total / maxBonus) * 100);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const monthCards = info.months.sort().map(s => {
      const [y, mo] = s.split('-');
      const lbl = new Date(+y, +mo-1, 1).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
      return `<span class="hof-month-card">${lbl}</span>`;
    }).join('');
    const clanBadge = info.inClan
      ? '<span class="cwl-yes" style="font-size:0.8rem">✓</span>'
      : '<span class="cwl-no" style="font-size:0.8rem">Ex</span>';
    const thH = thImgBonus(name, !info.inClan);
    const tag = info.tag ? `<span class="tag-cell" style="font-size:0.72rem">${info.tag}</span>` : '—';
    const rowCls = info.inClan ? '' : 'hof-ex-row';

    html += `<tr class="${rowCls}">
      <td class="stat-cell">${medal}</td>
      <td>${thH}</td>
      <td class="member-name">${name}</td>
      <td>${tag}</td>
      <td class="stat-cell"><strong style="color:var(--gold);font-size:1rem">${total}</strong></td>
      <td><div class="bo-bar"><div class="bo-bar-fill" style="width:${barPct}%"></div></div></td>
      <td style="padding:0.4rem 0.6rem">${monthCards}</td>
      <td class="stat-cell">${clanBadge}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  div.innerHTML = html;
}

// ── BONUS MODAL ───────────────────────────────────────────────────────────────

let bmCandidates = [];      // tutti i candidati caricati
let bmSelections = new Set(); // selezioni correnti nel modal

// ── Apertura / Chiusura ──────────────────────────────
function openBonusModal() {
  document.getElementById('bonus-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Imposta mese corrente come default
  const now = new Date().toISOString().slice(0, 7);
  if (!document.getElementById('bm-season').value)      document.getElementById('bm-season').value = now;
  if (!document.getElementById('bm-history-season').value) document.getElementById('bm-history-season').value = now;
  switchBmTab('criteria', document.querySelector('[data-bm-tab="criteria"]'));
}

function closeBonusModal() {
  document.getElementById('bonus-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function closeBonusModalIfOutside(e) {
  if (e.target === document.getElementById('bonus-modal-overlay')) closeBonusModal();
}

document.getElementById('open-bonus-modal').addEventListener('click', openBonusModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBonusModal(); });

// ── Tab switching ─────────────────────────────────────
function switchBmTab(tab, btn) {
  document.querySelectorAll('.modal-tab, .bm-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.modal-tab-content').forEach(c => c.style.display = 'none');
  if (btn) btn.classList.add('active');
  const el = document.getElementById('bm-tab-' + tab);
  if (el) el.style.display = 'block';
}

// ── Toggle Automatico / Manuale ───────────────────────
function switchBonusMode(mode) {
  document.getElementById('bm-auto-section').style.display   = mode === 'auto'   ? 'block' : 'none';
  document.getElementById('bm-manual-section').style.display = mode === 'manual' ? 'block' : 'none';
  document.getElementById('bm-mode-auto').classList.toggle('active', mode === 'auto');
  document.getElementById('bm-mode-manual').classList.toggle('active', mode === 'manual');
  // Reset aree comuni
  document.getElementById('bm-msg').textContent = '';
  document.getElementById('bm-candidates').innerHTML = '';
  document.getElementById('bm-footer').style.display = 'none';
  if (mode === 'manual') {
    const now = new Date().toISOString().slice(0, 7);
    const el = document.getElementById('bm-manual-season');
    if (!el.value) el.value = now;
  }
}

// ── Carica lista membri del clan (modalità manuale) ──
let bmManualSelected = new Set();

async function loadManualMemberList() {
  const season = document.getElementById('bm-manual-season').value;
  const listDiv = document.getElementById('bm-manual-list');
  if (!season) { listDiv.innerHTML = '<p style="color:#f0a500;font-size:0.85rem">Seleziona prima la stagione.</p>'; return; }

  listDiv.innerHTML = '<p style="color:#5a7a98;font-size:0.85rem">Caricamento membri…</p>';
  bmManualSelected.clear();

  // Carica da Supabase prima (veloce), poi prova API live con timeout
  let members = [];
  const { data: sbMembers } = await db.from('members').select('name').order('name');
  if (sbMembers) members = sbMembers.map(r => r.name).filter(Boolean);

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('/api/clan-members', { signal: ctrl.signal });
    clearTimeout(tid);
    if (r.ok) {
      const j = await r.json();
      const apiNames = (j.items || []).map(m => m.name).sort((a, b) => a.localeCompare(b));
      if (apiNames.length) members = apiNames; // API dati più freschi
    }
  } catch (_) {}

  // Fallback finale: prende i nomi unici dalla panoramica storica
  if (!members.length) {
    const { data } = await db.from('cwl_history').select('player_name');
    if (data) {
      members = [...new Set(data.map(r => r.player_name))].sort((a, b) => a.localeCompare(b));
    }
  }

  if (!members.length) {
    listDiv.innerHTML = '<p style="color:#ff6b6b;font-size:0.85rem">Impossibile caricare i membri. Verifica la connessione.</p>';
    return;
  }

  // Controlla chi ha già ricevuto il bonus in questa stagione
  const { data: existing } = await db.from('cwl_history')
    .select('player_name')
    .eq('season', season)
    .eq('bonus_assigned', true);
  const alreadyBonus = new Set((existing || []).map(r => r.player_name));

  // Pre-seleziona chi ha già il bonus nel DB
  alreadyBonus.forEach(n => bmManualSelected.add(n));

  // Renderizza lista con TH images
  const items = members.map(name => {
    const checked = alreadyBonus.has(name) ? 'checked' : '';
    const member = _assignMembersMap[name.toLowerCase()];
    const thH = member?.th_level ? thImgV(member.th_level) : '<span class="th-unknown" style="width:36px;text-align:center">?</span>';
    const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<label class="bm-manual-item">
      <input type="checkbox" ${checked} onchange="toggleManualMember('${escapedName}', this.checked)">
      ${thH}
      <span class="bm-item-name">${name}</span>
      ${alreadyBonus.has(name) ? '<span class="bm-already-tag">già assegnato</span>' : ''}
    </label>`;
  }).join('');

  listDiv.innerHTML = `
    <div class="bm-manual-list-wrap">${items}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.75rem;padding-top:0.5rem;border-top:1px solid var(--border)">
      <span style="font-size:0.84rem;color:var(--text-3)">Selezionati: <strong id="bm-manual-count" style="color:var(--gold)">${bmManualSelected.size}</strong> / ${members.length}</span>
      <button class="btn-primary btn-sm" onclick="saveManualBonus('${season}')">💾 Salva Bonus Manuali</button>
    </div>`;
}

function toggleManualMember(name, checked) {
  if (checked) bmManualSelected.add(name);
  else bmManualSelected.delete(name);
  const el = document.getElementById('bm-manual-count');
  if (el) el.textContent = bmManualSelected.size;
}

async function saveManualBonus(season) {
  if (!bmManualSelected.size) {
    alert('Nessun giocatore selezionato.');
    return;
  }
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '💾 Salvataggio…'; }

  const rows = [...bmManualSelected].map(name => ({
    player_name:      name,
    season,
    participated:     true,
    bonus_assigned:   true,
    stars:            0,
    destruction:      0.0,
    attacks_made:     0,
    attacks_required: 0,
    bonus_score:      0,
    still_in_clan:    true,
    is_secondary:     false,
  }));

  const { error } = await db.from('cwl_history')
    .upsert(rows, { onConflict: 'player_name,season' });

  if (btn) { btn.disabled = false; btn.textContent = '💾 Salva Bonus Manuali'; }

  if (error) {
    alert('Errore nel salvataggio: ' + error.message);
  } else {
    const msg = document.getElementById('bm-msg');
    msg.textContent = `✅ ${bmManualSelected.size} bonus salvati per ${season}!`;
    msg.style.color = '#4caf50';
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
}


// ── GESTIONE ALIAS PLAYER ─────────────────────────────────────────────────────

async function loadAliasManager() {
  const div = document.getElementById('bm-alias-content');
  if (!div) return;
  div.innerHTML = '<p style="font-size:0.84rem;color:var(--text-3)">Caricamento…</p>';

  await loadMembersMap(); // ensure maps are fresh

  const { data: historyPlayers } = await db.from('cwl_history').select('player_name');
  if (!historyPlayers?.length) {
    div.innerHTML = '<p style="font-size:0.84rem;color:var(--text-3)">Nessun giocatore nello storico.</p>';
    return;
  }

  const uniqueNames = [...new Set(historyPlayers.map(r => r.player_name))].sort((a,b) => a.localeCompare(b));
  const currentMembers = Object.values(_assignMembersMap).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  const rows = uniqueNames.map(name => {
    const resolved = resolveMember(name);
    const alias = _playerAliases[name.toLowerCase()];
    const inClan = isCurrentMember(name);
    const statusIcon = resolved ? (inClan ? '✓' : '⚠') : '✗';
    const statusCls  = resolved ? (inClan ? 'cwl-yes' : '') : 'cwl-no';
    const selectedCoc = alias?.coc_name || '';
    const escapedName = name.replace(/"/g, '&quot;');

    return `<tr>
      <td><span class="member-name">${name}</span></td>
      <td style="text-align:center"><span class="${statusCls}" style="font-size:0.8rem">${statusIcon}</span></td>
      <td>
        <select class="admin-select alias-select" data-alias="${escapedName}" style="font-size:0.8rem;width:100%">
          <option value="">— nessun alias —</option>
          ${currentMembers.map(m => `<option value="${m.name.replace(/"/g,'&quot;')}" ${selectedCoc === m.name ? 'selected' : ''}>${m.name}${m.th_level ? ` (TH${m.th_level})` : ''}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <p style="font-size:0.76rem;color:var(--text-3);margin-bottom:0.6rem">
      ✓ in clan · ⚠ trovato via alias · ✗ non trovato — imposta l'alias per collegarlo al player CoC corretto.
    </p>
    <div class="table-wrap" style="max-height:340px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>Nome storico</th>
          <th style="width:40px;text-align:center">Stato</th>
          <th>Collega a giocatore CoC</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:0.5rem;margin-top:0.75rem;padding-top:0.5rem;border-top:1px solid var(--border)">
      <span id="alias-save-msg" style="font-size:0.82rem;color:var(--text-3)"></span>
      <button class="btn-secondary btn-sm" onclick="loadAliasManager()">🔄 Ricarica</button>
      <button class="btn-primary btn-sm" onclick="saveAliases()">💾 Salva Alias</button>
    </div>`;
}

async function saveAliases() {
  const selects = document.querySelectorAll('.alias-select');
  const toUpsert = [];
  const toDelete = [];

  selects.forEach(sel => {
    const alias = sel.dataset.alias;
    if (!alias) return;
    const cocName = sel.value;
    if (cocName) {
      const member = resolveMember(cocName) || _assignMembersMap[cocName.toLowerCase()];
      toUpsert.push({ alias, coc_name: cocName, tag: member?.tag || null, th_level: member?.th_level || null });
    } else {
      // Remove alias only if one exists
      if (_playerAliases[alias.toLowerCase()]) toDelete.push(alias);
    }
  });

  const msg = document.getElementById('alias-save-msg');
  if (msg) msg.textContent = 'Salvataggio…';

  try {
    if (toUpsert.length) {
      const { error } = await db.from('player_aliases').upsert(toUpsert, { onConflict: 'alias' });
      if (error) throw error;
    }
    for (const alias of toDelete) {
      await db.from('player_aliases').delete().eq('alias', alias);
    }
    await loadPlayerAliases();
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = `✓ ${toUpsert.length} alias salvati.`; }
  } catch (err) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Errore: ' + (err.message || 'verifica che la tabella player_aliases esista.'); }
  }
}

async function applyBonusCriteria() {
  const season  = document.getElementById('bm-season').value;
  const count   = parseInt(document.getElementById('bm-bonus-count').value) || 6;
  const msg     = document.getElementById('bm-msg');
  const div     = document.getElementById('bm-candidates');

  const critParticipated  = document.getElementById('crit-participated').checked;
  const critMinStars      = document.getElementById('crit-min-stars').checked;
  const critMinDestr      = document.getElementById('crit-min-destr').checked;
  const critMinAtk        = document.getElementById('crit-min-atk').checked;
  const critNoRecent      = document.getElementById('crit-no-recent').checked;
  const minStars          = parseInt(document.getElementById('crit-stars-val').value) || 0;
  const minDestr          = parseFloat(document.getElementById('crit-destr-val').value) || 0;
  const minAtk            = parseInt(document.getElementById('crit-atk-val').value) || 0;
  const recentMonths      = parseInt(document.getElementById('crit-recent-months').value) || 1;

  if (!season) { msg.textContent = '⚠ Seleziona una stagione.'; return; }

  const applyBtn = document.getElementById('bm-apply');
  applyBtn.textContent = 'Caricamento…';
  msg.textContent = '';
  div.innerHTML = '';
  bmCandidates = [];
  bmSelections = new Set();
  document.getElementById('bm-footer').style.display = 'none';

  // Carica dati storici per season
  const { data: history, error } = await db.from('cwl_history')
    .select('*')
    .eq('season', season)
    .eq('is_secondary', false);

  if (error || !history?.length) {
    msg.textContent = '⚠ Nessun dato per questa stagione. Prima carica lo storico o i dati live dalla tab CWL.';
    applyBtn.textContent = '🔍 Applica Criteri';
    return;
  }

  // Carica bonus recenti per criterio "no recent"
  let recentBonusNames = new Set();
  if (critNoRecent) {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - recentMonths);
    const fromSeason = pastDate.toISOString().slice(0, 7);
    const { data: recentData } = await db.from('cwl_history')
      .select('player_name, season')
      .eq('bonus_assigned', true)
      .gte('season', fromSeason)
      .neq('season', season);
    if (recentData) recentData.forEach(r => recentBonusNames.add(r.player_name));
  }

  // Se ci sono dati live, li usiamo — altrimenti storico DB
  let pool = [];
  if (cwlLiveData && cwlLiveData.length) {
    pool = cwlLiveData.map(p => {
      const req  = Math.max(p.attacks_required, 1);
      const made = p.attacks_made;
      const avgD = made > 0 ? p.destruction / made : 0;
      const merit = (p.stars / req) * 40 + avgD * 0.2 + (made / req) * 20;
      return {
        player_name: p.name, stars: p.stars, destruction: p.destruction,
        attacks_made: made, attacks_required: req,
        avg_destr: avgD, participated: true, merit: Math.round(merit * 10) / 10,
        bonus_assigned: false, still_in_clan: true
      };
    });
  } else {
    pool = history.map(h => ({
      player_name: h.player_name,
      stars: h.stars || 0,
      destruction: h.destruction || 0,
      attacks_made: h.attacks_made || 0,
      attacks_required: h.attacks_required || 0,
      avg_destr: h.attacks_made > 0 ? (h.destruction / h.attacks_made) : 0,
      participated: h.participated || false,
      merit: h.bonus_score || 0,
      bonus_assigned: h.bonus_assigned || false,
      still_in_clan: h.still_in_clan
    }));
  }

  // Applica filtri
  let filtered = pool.filter(p => {
    if (!p.still_in_clan) return false;
    if (critParticipated && !p.participated) return false;
    if (critMinStars && p.stars < minStars) return false;
    if (critMinDestr && p.avg_destr < minDestr) return false;
    if (critMinAtk && p.attacks_made < minAtk) return false;
    if (critNoRecent && recentBonusNames.has(p.player_name)) return false;
    return true;
  });

  filtered.sort((a, b) => b.merit - a.merit);
  bmCandidates = filtered;

  // Auto-seleziona top N
  bmSelections = new Set(filtered.slice(0, count).map(c => c.player_name));

  renderBmCandidates();
  applyBtn.textContent = '🔍 Applica Criteri';

  const excluded = pool.length - filtered.length;
  msg.textContent = `${filtered.length} candidati idonei${excluded ? ` (${excluded} esclusi dai criteri)` : ''}.`;
  document.getElementById('bm-footer').style.display = 'flex';
  document.getElementById('bm-sel-count').textContent = bmSelections.size;
}

function renderBmCandidates() {
  const div = document.getElementById('bm-candidates');
  if (!bmCandidates.length) { div.innerHTML = '<p style="color:#5a7a98;padding:1rem 0">Nessun candidato idoneo con questi criteri.</p>'; return; }

  const rows = bmCandidates.map((c, i) => {
    const checked = bmSelections.has(c.player_name) ? 'checked' : '';
    const topCls  = i < 3 ? 'bonus-top' : '';
    const avgD    = c.attacks_made > 0 ? (c.destruction / c.attacks_made).toFixed(1) + '%' : '—';
    const atkStr  = c.attacks_required > 0 ? `${c.attacks_made}/${c.attacks_required}` : '—';
    const merit   = typeof c.merit === 'number' ? c.merit.toFixed(1) : c.merit;
    const prevBadge = c.bonus_assigned ? ' <span class="bonus-badge" title="Ha già bonus questo mese">🏆</span>' : '';
    return `<tr class="${topCls}">
      <td style="text-align:center"><input type="checkbox" data-name="${c.player_name}" ${checked}
        onchange="toggleBmBonus('${c.player_name}', this.checked)"></td>
      <td class="member-name">${i + 1}. ${c.player_name}${prevBadge}</td>
      <td class="stat-cell">${merit}</td>
      <td class="stat-cell">${c.stars}</td>
      <td class="stat-cell">${avgD}</td>
      <td class="stat-cell">${atkStr}</td>
    </tr>`;
  }).join('');

  div.innerHTML = `<div class="table-wrap" style="margin-top:0.75rem">
    <table>
      <thead><tr>
        <th style="width:36px;text-align:center">✓</th>
        <th>Giocatore</th>
        <th title="Merit score">Score</th>
        <th>⭐</th>
        <th>💥 avg</th>
        <th>⚔</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function toggleBmBonus(name, checked) {
  if (checked) bmSelections.add(name);
  else bmSelections.delete(name);
  document.getElementById('bm-sel-count').textContent = bmSelections.size;
}

// ── Salva assegnazione da modal ───────────────────────
async function saveBonusFromModal() {
  const season = document.getElementById('bm-season').value;
  const msg    = document.getElementById('bm-msg');
  const btn    = document.getElementById('bm-save');
  if (!bmCandidates.length) { msg.textContent = '⚠ Prima applica i criteri.'; return; }

  btn.textContent = 'Salvataggio…';

  const upsertData = bmCandidates.map(c => ({
    player_name:      c.player_name,
    season,
    participated:     c.participated ?? false,
    stars:            Math.round(c.stars || 0),
    destruction:      parseFloat((c.destruction || 0).toFixed(2)),
    attacks_made:     c.attacks_made || 0,
    attacks_required: c.attacks_required || 0,
    bonus_score:      Math.round(c.merit || 0),
    bonus_assigned:   bmSelections.has(c.player_name),
    still_in_clan:    true,
    is_secondary:     false
  }));

  const { error } = await db.from('cwl_history').upsert(upsertData, { onConflict: 'player_name,season' });
  btn.textContent = '💾 Salva Assegnazione';
  if (error) { msg.textContent = '✗ ' + error.message; return; }

  const names = [...bmSelections].join(', ');
  msg.textContent = `✓ ${bmSelections.size} bonus salvati per ${season}: ${names}`;
  // Aggiorna il badge nella tabella CWL principale
  const mainHistory = await loadCwlHistory();
  renderCwlTable(mainHistory, cwlLiveData);
}

// ── Storico bonus per mese ────────────────────────────
async function loadBonusHistory() {
  const season  = document.getElementById('bm-history-season').value;
  const div     = document.getElementById('bm-history-results');
  if (!season) { div.innerHTML = '<p style="color:#5a7a98">Seleziona un mese.</p>'; return; }

  div.innerHTML = '<p style="color:#5a7a98;padding:1rem 0">Caricamento…</p>';

  const { data, error } = await db.from('cwl_history')
    .select('*')
    .eq('season', season)
    .eq('bonus_assigned', true)
    .order('bonus_score', { ascending: false });

  if (error) { div.innerHTML = '<p style="color:#ff6b6b">Errore: ' + error.message + '</p>'; return; }
  if (!data?.length) {
    div.innerHTML = '<p style="color:#5a7a98;padding:1rem 0">Nessun bonus assegnato per questo mese.</p>';
    return;
  }

  const rows = data.map((h, i) => {
    const avgD = h.attacks_made > 0 ? (h.destruction / h.attacks_made).toFixed(1) + '%' : '—';
    const atkStr = h.attacks_required > 0 ? `${h.attacks_made}/${h.attacks_required}` : '—';
    return `<tr>
      <td class="stat-cell">${i + 1}</td>
      <td class="member-name">🏆 ${h.player_name}</td>
      <td class="stat-cell">${h.stars ?? '—'}</td>
      <td class="stat-cell">${avgD}</td>
      <td class="stat-cell">${atkStr}</td>
      <td class="stat-cell"><strong>${h.bonus_score ?? '—'}</strong></td>
      <td class="stat-cell">${h.still_in_clan ? '<span class="cwl-yes">✓</span>' : '<span class="cwl-no">Ex</span>'}</td>
    </tr>`;
  }).join('');

  const [y, m] = season.split('-');
  const label = new Date(+y, +m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  div.innerHTML = `
    <p style="margin:0.75rem 0 0.5rem;font-size:0.88rem;color:#7a9ab8">${data.length} bonus assegnati — <strong>${label}</strong></p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Giocatore</th><th>⭐</th><th>💥 avg</th><th>⚔</th><th>Score</th><th>Clan</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Toggle vista storico ──────────────────────────────
function switchHistoryView(view) {
  document.getElementById('bm-history-month').style.display = view === 'month' ? 'block' : 'none';
  document.getElementById('bm-history-overview').style.display = view === 'overview' ? 'block' : 'none';
  document.getElementById('bm-view-month').classList.toggle('active', view === 'month');
  document.getElementById('bm-view-overview').classList.toggle('active', view === 'overview');
  if (view === 'overview') loadBonusOverview();
}

// ── Panoramica generale: tutti i giocatori × totale bonus ─
async function loadBonusOverview() {
  const div = document.getElementById('bm-overview-results');
  div.innerHTML = '<p style="color:#5a7a98;padding:0.75rem 0">Caricamento…</p>';

  const { data, error } = await db.from('cwl_history')
    .select('player_name, season, still_in_clan')
    .eq('bonus_assigned', true)
    .order('season', { ascending: true });

  if (error) { div.innerHTML = '<p style="color:#ff6b6b">Errore: ' + error.message + '</p>'; return; }
  if (!data?.length) { div.innerHTML = '<p style="color:#5a7a98;padding:0.75rem 0">Nessun bonus trovato.</p>'; return; }

  // Raggruppa per player_name
  const map = {};
  for (const r of data) {
    if (!map[r.player_name]) map[r.player_name] = { months: [], inClan: r.still_in_clan };
    map[r.player_name].months.push(r.season);
    if (r.still_in_clan) map[r.player_name].inClan = true; // se almeno una voce è true
  }

  // Ordina per totale decrescente, poi per nome
  const players = Object.entries(map)
    .sort((a, b) => b[1].months.length - a[1].months.length || a[0].localeCompare(b[0]));

  const maxBonus = players[0]?.[1]?.months.length || 1;

  const rows = players.map(([name, info], i) => {
    const total = info.months.length;
    const barPct = Math.round((total / maxBonus) * 100);
    // Pillole mese ordinate
    const pills = info.months
      .sort()
      .map(s => {
        const [y, m] = s.split('-');
        const label = new Date(+y, +m - 1, 1)
          .toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
        return `<span class="bov-pill">${label}</span>`;
      }).join('');

    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    const clanBadge = info.inClan
      ? '<span class="cwl-yes" style="font-size:0.8rem">✓</span>'
      : '<span class="cwl-no" style="font-size:0.8rem">Ex</span>';

    return `<tr class="bov-row">
      <td class="stat-cell" style="white-space:nowrap">${medal}</td>
      <td class="member-name">${name}</td>
      <td class="stat-cell" style="text-align:center">
        <strong style="color:#f0a500;font-size:1rem">${total}</strong>
      </td>
      <td style="min-width:160px">
        <div class="bov-bar-wrap">
          <div class="bov-bar" style="width:${barPct}%"></div>
        </div>
      </td>
      <td style="padding:0.4rem 0.6rem">${pills}</td>
      <td class="stat-cell" style="text-align:center">${clanBadge}</td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <p style="margin:0.5rem 0 0.6rem;font-size:0.84rem;color:#7a9ab8">
      <strong>${players.length}</strong> giocatori · <strong>${data.length}</strong> bonus totali
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Giocatore</th>
          <th style="text-align:center" title="Totale bonus ricevuti">Tot.</th>
          <th style="min-width:120px">Progressione</th>
          <th>Mesi ricevuti</th>
          <th style="text-align:center">Clan</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── ADMIN: GESTIONE UTENTI ────────────────────────────────────────────────────

// ── ADMIN: GESTIONE UTENTI ────────────────────────────────────────────────────

const ROLE_OPTIONS = ROLES.map(r =>
  `<option value="${r.value}">${r.label}</option>`
).join('');

async function loadUsers() {
  const tbody = document.querySelector('#users-table tbody');
  const msg   = document.getElementById('admin-msg');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#5a7a98">Caricamento…</td></tr>';

  const res = await fetch('/api/admin/users');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showAdminMsg(err.error || 'Errore caricamento utenti.', 'error');
    tbody.innerHTML = '';
    return;
  }

  const { users } = await res.json();
  msg.style.display = 'none';
  tbody.innerHTML = '';

  users.sort((a, b) => {
    const rOrder = ['admin','co-capo','anziano','membro','utente'];
    const ra = rOrder.indexOf(a.user_metadata?.role || 'utente');
    const rb = rOrder.indexOf(b.user_metadata?.role || 'utente');
    return ra - rb;
  });

  users.forEach(u => {
    const role      = u.user_metadata?.role || 'utente';
    const username  = u.user_metadata?.username || '';
    const roleInfo  = ROLE_LABELS[role] || ROLE_LABELS['utente'];
    const isInternal = u.email?.endsWith('@fearunited.internal');
    // Login ID: per utenti interni mostra il nome utente (senza @fearunited.internal)
    const loginId   = isInternal
      ? (u.email.replace('@fearunited.internal', ''))
      : (u.email || '—');
    const displayInfo = isInternal
      ? `<span class="login-id-tag" title="Usa questo come nome utente al login">${loginId}</span>`
      : `<span style="font-size:0.8rem;color:#5a7a98">${u.email}</span>`;
    const created   = new Date(u.created_at).toLocaleDateString('it-IT');
    const isMe      = u.email === document.getElementById('user-email').textContent;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="member-name">${username || loginId}</td>
      <td>${displayInfo}</td>
      <td>
        <select class="admin-role-sel" onchange="changeRole('${u.id}', this)" ${isMe ? 'disabled' : ''}>
          ${ROLES.map(r => `<option value="${r.value}" ${r.value === role ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </td>
      <td class="date-cell">${created}</td>
      <td style="display:flex;gap:0.4rem;flex-wrap:wrap">
        <button class="admin-save-btn" onclick="saveRole('${u.id}', this)">💾 Salva</button>
        ${!isMe ? `<button class="btn-danger" onclick="deleteUser('${u.id}')">🗑 Elimina</button>` : '<span style="font-size:0.75rem;color:#5a7a98">(tu)</span>'}
      </td>`;

    tbody.appendChild(tr);
  });
}

function showAdminMsg(text, type = 'info') {
  const el = document.getElementById('admin-msg');
  el.textContent = text;
  el.className = 'admin-msg-box ' + (type === 'error' ? 'admin-msg-err' : 'admin-msg-ok');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function createUser() {
  const username = document.getElementById('new-username').value.trim();
  const email    = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value;
  const role     = document.getElementById('new-role').value;
  const msgEl    = document.getElementById('create-user-msg');

  if (!username) { msgEl.textContent = '⚠ Nome utente obbligatorio.'; msgEl.style.color = '#f0a500'; return; }
  if (password.length < 6) { msgEl.textContent = '⚠ Password min 6 caratteri.'; msgEl.style.color = '#f0a500'; return; }

  msgEl.textContent = 'Creazione in corso…'; msgEl.style.color = '#7a9ab8';

  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: email || undefined, password, role }),
  });
  const data = await res.json();

  if (!res.ok) {
    msgEl.textContent = '✗ ' + (data.error || 'Errore creazione.');
    msgEl.style.color = '#ef5350';
  } else {
    msgEl.textContent = `✅ Utente "${username}" creato!`;
    msgEl.style.color = '#4caf50';
    document.getElementById('new-username').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
    loadUsers();
  }
}

async function changeRole(userId, selectEl) {
  // Evidenzia che ci sono modifiche non salvate
  selectEl.style.borderColor = '#f0a500';
}

async function saveRole(userId, btn) {
  const row     = btn.closest('tr');
  const selEl   = row.querySelector('.admin-role-sel');
  const newRole = selEl.value;
  btn.disabled  = true; btn.textContent = '💾…';

  const res = await fetch('/api/admin/users', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, role: newRole }),
  });
  btn.disabled = false; btn.textContent = '💾 Salva';
  if (res.ok) {
    selEl.style.borderColor = '';
    showAdminMsg('✅ Ruolo aggiornato.');
  } else {
    const err = await res.json().catch(() => ({}));
    showAdminMsg('✗ ' + (err.error || 'Errore.'), 'error');
  }
}

async function deleteUser(userId) {
  if (!confirm('Eliminare questo utente? Questa azione è irreversibile.')) return;
  const res = await fetch('/api/admin/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (res.ok) { showAdminMsg('✅ Utente eliminato.'); loadUsers(); }
  else { const e = await res.json().catch(() => ({})); showAdminMsg('✗ ' + (e.error || 'Errore.'), 'error'); }
}

document.getElementById('refresh-users').addEventListener('click', loadUsers);

// ─────────────────────────────────────────────────────────────────────────────
// ── REGISTRI GUERRE ──────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function switchWarTab(tab, btn) {
  document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('wl-classic').style.display = tab === 'classic' ? 'block' : 'none';
  document.getElementById('wl-cwl').style.display     = tab === 'cwl'     ? 'block' : 'none';
  if (tab === 'classic') loadWarLog();
  if (tab === 'cwl')     loadCwlSeasons();
}

// ── War Log classiche (API CoC) ──────────────────────
async function loadWarLog() {
  const div = document.getElementById('wl-classic-results');
  div.innerHTML = '<p class="wl-loading">Caricamento war log…</p>';
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch('/api/war-log', { signal: ctrl.signal });
    clearTimeout(tid);
    const data = await r.json();
    if (data.reason === 'accessDenied') {
      div.innerHTML = '<p class="wl-err">⚠️ War log privato. Vai nelle impostazioni clan su CoC → Informazioni clan → imposta il Registro di guerra su "Pubblico".</p>';
      return;
    }
    if (!r.ok) {
      div.innerHTML = `<p class="wl-err">⚠️ Servizio temporaneamente non disponibile (${r.status}). Riprova tra qualche secondo. <button class="btn-secondary btn-sm" onclick="loadWarLog()" style="margin-left:0.5rem">🔄 Riprova</button></p>`;
      return;
    }
    // Mantieni solo war classiche: esclude CWL (warType cwl, opponent assente, o stelle impossibili)
    const items = (data.items || []).filter(w => {
      const wt = (w.warType || '').toLowerCase();
      if (wt === 'cwl') return false;
      if (!w.opponent?.name) return false;
      // Se le stelle superano il massimo possibile (teamSize * 3) è dati aggregati CWL
      const maxStars = (w.teamSize || 50) * 3;
      if ((w.clan?.stars || 0) > maxStars) return false;
      return true;
    });
    if (!items.length) { div.innerHTML = '<p class="wl-loading">Nessuna war classica nel log.</p>'; return; }

    const rows = items.map(w => {
      const date = w.endTime ? new Date(
        w.endTime.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')
      ).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'2-digit' }) : '—';

      const result = w.result === 'win' ? '<span class="wl-win">Vinta ✓</span>'
                   : w.result === 'lose' ? '<span class="wl-lose">Persa ✗</span>'
                   : '<span class="wl-draw">Patta =</span>';

      const isCwl = w.warType === 'cwl';
      const type  = isCwl ? '<span class="wl-badge-cwl">CWL</span>' : '<span class="wl-badge-classic">War</span>';

      const stars     = `${w.clan?.stars ?? 0} — ${w.opponent?.stars ?? 0}`;
      const destrClan = w.clan?.destructionPercentage?.toFixed(1) ?? '0.0';
      const destrOpp  = w.opponent?.destructionPercentage?.toFixed(1) ?? '0.0';
      const opp       = w.opponent?.name ?? 'Sconosciuto';
      const size      = w.teamSize ?? '?';

      return `<tr>
        <td class="stat-cell">${date}</td>
        <td class="stat-cell">${type}</td>
        <td>${result}</td>
        <td>${opp}</td>
        <td class="stat-cell">${size} vs ${size}</td>
        <td class="stat-cell">${stars}</td>
        <td class="stat-cell">${destrClan}% — ${destrOpp}%</td>
      </tr>`;
    }).join('');

    div.innerHTML = `
      <div class="table-wrap" style="margin-top:0.75rem">
        <table>
          <thead><tr>
            <th>Data</th><th>Tipo</th><th>Risultato</th><th>Avversario</th>
            <th>Dimensione</th><th>⭐ Noi — Loro</th><th>💥 Noi — Loro</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch(e) {
    const msg = e.name === 'AbortError'
      ? '⏳ Il proxy è in avvio (cold start Render). Attendi ~30s e riprova.'
      : '⚠️ Servizio non raggiungibile.';
    div.innerHTML = `<p class="wl-err">${msg} <button class="btn-secondary btn-sm" onclick="loadWarLog()" style="margin-left:0.5rem">🔄 Riprova</button></p>`;
  }
}

// Carica war log quando entra nel tab
document.querySelectorAll('.tab-btn[data-tab="warlog"]').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(loadWarLog, 100));
});

// ── CRONOLOGIA LEGHE CWL ─────────────────────────────────────────────────────

// Mappa posizione → testo italiano
const POS_LABELS = ['', '1° Primo', '2° Secondo', '3° Terzo', '4° Quarto',
                    '5° Quinto', '6° Sesto', '7° Settimo', '8° Ottavo'];
const POS_COLORS = ['', '#f0a500','#c0cce8','#e07040','#7aaccc',
                    '#7a9ab8','#7a9ab8','#5a7a98','#5a7a98'];

// Mappa lega → emoji medaglia
const LEAGUE_ICON = {
  'Cristallo I': '🔮', 'Cristallo II': '🔮', 'Cristallo III': '🔮',
  'Oro I': '🥇', 'Oro II': '🥇', 'Oro III': '🥇',
  'Maestro I': '🏅', 'Maestro II': '🏅', 'Maestro III': '🏅',
  'Campione I': '🏆', 'Campione II': '🏆', 'Campione III': '🏆',
  'Titano I': '💎', 'Titano II': '💎', 'Titano III': '💎',
  'Leggenda': '👑'
};

// Nomi mesi in italiano
const MONTH_IT = ['', 'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function seasonLabel(season) {
  // season = 'YYYY-MM'
  const [y, m] = season.split('-');
  return `Stagione di ${MONTH_IT[+m] || season} ${y}`;
}

// ── Carica e renderizza ──────────────────────────────────────────────────────
async function loadCwlSeasons() {
  const div = document.getElementById('cwl-seasons-list');
  div.innerHTML = '<p class="wl-loading">Caricamento cronologia…</p>';

  // Prova a caricare dati supplementari (posizione, lega) da DB — silenzioso se tabella assente
  const dbMap = {};
  try {
    const { data: dbSeasons } = await db
      .from('cwl_seasons')
      .select('*')
      .order('season', { ascending: false });
    (dbSeasons || []).forEach(s => { dbMap[s.season] = s; });
  } catch (_) {}

  // Carica dati CWL dal war log API (raggruppati per stagione usando endTime)
  let apiSeasonMap = {};
  let warLogError = null;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000); // 10s timeout (cold start proxy)
    const r = await fetch('/api/war-log', { signal: ctrl.signal });
    clearTimeout(tid);
    const warData = await r.json();
    if (warData.reason === 'accessDenied') {
      warLogError = 'accessDenied';
    } else if (!r.ok) {
      warLogError = `server_${r.status}`;
    } else {
      (warData.items || []).filter(w => {
        const wt = (w.warType || '').toLowerCase();
        const maxStars = (w.teamSize || 50) * 3;
        const isAggregated = (w.clan?.stars || 0) > maxStars;
        return (wt === 'cwl' || !w.opponent?.name || isAggregated) && w.endTime;
      }).forEach(w => {
        // Estrae stagione da endTime: "20250315T000000.000Z" → "2025-03"
        const s = w.endTime.slice(0, 4) + '-' + w.endTime.slice(4, 6);
        if (!apiSeasonMap[s]) apiSeasonMap[s] = { wins: 0, losses: 0, draws: 0, totalStars: 0, totalDestr: 0, warCount: 0 };
        const ws = apiSeasonMap[s];
        ws.warCount++;
        if (w.result === 'win') ws.wins++;
        else if (w.result === 'lose') ws.losses++;
        else ws.draws++;
        ws.totalStars += w.clan?.stars || 0;
        ws.totalDestr += w.clan?.destructionPercentage || 0;
      });
    }
  } catch (e) { warLogError = e.name === 'AbortError' ? 'timeout' : 'network'; }

  // Merge: tutte le stagioni trovate da DB o API
  const allKeys = new Set([...Object.keys(dbMap), ...Object.keys(apiSeasonMap)]);
  const merged = [];
  allKeys.forEach(s => {
    const d = dbMap[s] || {};
    const a = apiSeasonMap[s] || {};
    merged.push({
      season:      s,
      league:      d.league || null,
      position:    d.position || null,
      stars:       d.stars ?? (a.warCount ? a.totalStars : null),
      destruction: d.destruction ?? (a.warCount ? parseFloat((a.totalDestr / a.warCount).toFixed(1)) : null),
      attacks:     d.attacks ?? null,
      wins:        a.wins || null,
      losses:      a.losses || null,
      warCount:    a.warCount || null,
      fromApiOnly: !d.league && !!a.warCount
    });
  });
  merged.sort((a, b) => b.season.localeCompare(a.season));
  renderCwlSeasons(merged, warLogError);
}

function renderCwlSeasons(seasons, warLogError) {
  const div = document.getElementById('cwl-seasons-list');

  if (!seasons.length) {
    let msg = '';
    if (warLogError === 'accessDenied') {
      msg = '<p class="wl-err">⚠️ War log privato. Vai nelle impostazioni clan su CoC → imposta il Registro di guerra su "Pubblico".</p>';
    } else if (warLogError === 'timeout') {
      msg = `<p class="wl-err">⏳ Il proxy è in avvio (cold start Render). Attendi ~30 secondi e riprova. <button class="btn-secondary btn-sm" onclick="loadCwlSeasons()" style="margin-left:0.5rem">🔄 Riprova</button></p>`;
    } else if (warLogError) {
      msg = `<p class="wl-err">⚠️ Servizio API non disponibile. <button class="btn-secondary btn-sm" onclick="loadCwlSeasons()" style="margin-left:0.5rem">🔄 Riprova</button></p>`;
    } else {
      msg = '<div class="cwl-empty"><span style="font-size:2rem">⚔️</span><p>Nessuna stagione CWL trovata nel war log.</p><p style="font-size:0.83rem;color:#5a7a98">Le stagioni appariranno automaticamente man mano che vengono giocate.</p></div>';
    }
    div.innerHTML = msg;
    return;
  }

  // Raggruppa per anno
  const byYear = {};
  seasons.forEach(s => {
    const year = s.season.slice(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(s);
  });

  let html = '';
  Object.keys(byYear).sort((a,b) => b - a).forEach(year => {
    html += `<div class="cwl-year-group">
      <div class="cwl-year-label">${year}</div>`;
    byYear[year].forEach(s => {
      const pos      = s.position ? +s.position : null;
      const posLabel = pos ? (POS_LABELS[pos] || `${pos}°`) : null;
      const posColor = pos ? (POS_COLORS[pos] || '#5a7a98') : '#5a7a98';
      const icon     = s.league ? (LEAGUE_ICON[s.league] || '🏅') : '⚔️';
      const stars    = s.stars   != null ? s.stars   : '—';
      const destr    = s.destruction != null ? (+s.destruction).toFixed(0) : '—';

      // Record W/L/D da API
      const wld = (s.wins != null)
        ? `<span style="color:#4caf50;font-weight:700">${s.wins}V</span> <span style="color:#ef5350;font-weight:700">${s.losses}S</span>${s.draws ? ` <span style="color:#5a7a98">${s.draws}P</span>` : ''}`
        : '';

      // Badge "solo API" - dati parziali da war log
      const apiOnlyBadge = s.fromApiOnly
        ? `<span style="font-size:0.65rem;background:rgba(91,157,224,0.12);color:#7aaccc;border:1px solid rgba(91,157,224,0.25);border-radius:3px;padding:0.05rem 0.35rem;margin-left:0.4rem">via API</span>`
        : '';

      html += `
      <div class="cwl-season-card" data-season="${s.season}">
        <div class="cwl-card-left">
          <div class="cwl-card-month">${seasonLabel(s.season)}${apiOnlyBadge}</div>
          <div class="cwl-card-league">
            <span class="cwl-league-icon">${icon}</span>
            <span class="cwl-league-name">${s.league || 'Lega non registrata'}</span>
          </div>
          ${wld ? `<div style="margin-top:0.25rem;font-size:0.78rem">${wld}</div>` : ''}
        </div>
        <div class="cwl-card-mid">
          <div class="cwl-pos-badge" style="color:${posColor}">${posLabel || '—'}</div>
          <div class="cwl-league-sub">${s.league ? `Lega ${s.league}` : 'Dati parziali'}</div>
        </div>
        <div class="cwl-card-right">
          <div class="cwl-card-stats">
            <div><span class="cwl-card-stat-val">⭐ ${stars}</span><span class="cwl-card-stat-label">Stelle</span></div>
            <div><span class="cwl-card-stat-val">💥 ${destr}%</span><span class="cwl-card-stat-label">Distruz.</span></div>
          </div>
        </div>
        ${canEdit && !s.fromApiOnly ? `<button class="cwl-card-edit-btn" onclick="editCwlSeason('${s.season}','${(s.league||'').replace(/'/g,"\\'")}',${pos||''},${s.stars ?? ''},${s.destruction ?? ''},${s.attacks ?? ''})" title="Modifica">✏️</button>` : ''}
        ${canEdit && s.fromApiOnly ? `<button class="cwl-card-edit-btn" onclick="prefillCwlSeason('${s.season}')" title="Aggiungi dati">➕</button>` : ''}
      </div>`;
    });
    html += '</div>';
  });

  div.innerHTML = html;
}

// Pre-compila form per nuova stagione da API
function prefillCwlSeason(season) {
  document.getElementById('cs-season').value = season;
  document.getElementById('cwl-season-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Salva stagione (nuova o aggiornamento) ────────────────────────────────────
async function saveCwlSeason() {
  const season      = document.getElementById('cs-season').value;
  const league      = document.getElementById('cs-league').value;
  const position    = +document.getElementById('cs-position').value;
  const stars       = document.getElementById('cs-stars').value ? +document.getElementById('cs-stars').value : null;
  const destruction = document.getElementById('cs-destruction').value ? +document.getElementById('cs-destruction').value : null;
  const attacks     = document.getElementById('cs-attacks').value ? +document.getElementById('cs-attacks').value : null;
  const msg         = document.getElementById('cs-msg');

  if (!season || !league || !position) {
    msg.textContent = '⚠️ Stagione, Lega e Posizione sono obbligatori.';
    msg.style.color = '#f0a500';
    return;
  }

  msg.textContent = 'Salvataggio…';
  msg.style.color = '#5a7a98';

  const { error } = await db.from('cwl_seasons').upsert(
    { season, league, position, stars, destruction, attacks },
    { onConflict: 'season' }
  );

  if (error) {
    msg.textContent = '✗ ' + error.message;
    msg.style.color = '#ef5350';
  } else {
    msg.textContent = '✅ Stagione salvata!';
    msg.style.color = '#4caf50';
    // Svuota form (eccetto lega) e aggiorna lista
    document.getElementById('cs-season').value = '';
    document.getElementById('cs-position').value = '';
    document.getElementById('cs-stars').value = '';
    document.getElementById('cs-destruction').value = '';
    document.getElementById('cs-attacks').value = '';
    setTimeout(() => { msg.textContent = ''; }, 3000);
    loadCwlSeasons();
  }
}

// Pre-compila form per modifica
function editCwlSeason(season, league, position, stars, destruction, attacks) {
  document.getElementById('cs-season').value = season;
  const sel = document.getElementById('cs-league');
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === league) { sel.selectedIndex = i; break; }
  }
  document.getElementById('cs-position').value    = position || '';
  document.getElementById('cs-stars').value       = stars !== null && stars !== undefined ? stars : '';
  document.getElementById('cs-destruction').value = destruction !== null && destruction !== undefined ? destruction : '';
  document.getElementById('cs-attacks').value     = attacks !== null && attacks !== undefined ? attacks : '';
  // Scrolla al form
  document.getElementById('cwl-season-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


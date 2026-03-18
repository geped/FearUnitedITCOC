const db = window.sb;

// Clan dell'utente loggato — impostati in showApp() dopo il login
window._userClanTag    = null;  // es. '#2J2VLPP9R'
window._clanName       = '';
window._clanBadgeUrl   = null;

// Restituisce '?clanTag=XXXX' da aggiungere alle fetch API
function clanQ() {
  return window._userClanTag
    ? `?clanTag=${encodeURIComponent(window._userClanTag)}`
    : '';
}

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
  // Tag CoC (inizia con #): strip # e usa cocboard.internal
  if (s.startsWith('#')) return s.slice(1).toLowerCase() + '@cocboard.internal';
  // Username manuale: normalizza e usa cocboard.internal
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_') + '@cocboard.internal';
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const rawInput = document.getElementById("email").value;
    const email    = resolveLoginEmail(rawInput);
    const pwd = document.getElementById("password").value;
    let { error } = await db.auth.signInWithPassword({ email, password: pwd });
    if (error) {
      // Fallback: prova fearunited.internal per account legacy
      const fallback = email.replace('@cocboard.internal', '@fearunited.internal');
      if (fallback !== email) {
        const r2 = await db.auth.signInWithPassword({ email: fallback, password: pwd });
        if (!r2.error) return; // onAuthStateChange gestirà il resto
      }
      const msg = error.message.includes('Invalid login')
        ? 'Credenziali errate. Controlla il nome utente e la password.'
        : error.message;
      showLoginError(msg);
    }
  } catch (err) {
    showLoginError("Errore di connessione. Ricarica la pagina e riprova.");
  }
});


// ── Navigazione sezioni login ─────────────────────────────────────────────────

function showSection(section) {
  document.getElementById('login-form').style.display        = section === 'login'    ? 'flex'  : 'none';
  document.getElementById('login-links').style.display       = section === 'login'    ? 'flex'  : 'none';
  document.getElementById('signup-section').style.display    = section === 'signup'   ? 'block' : 'none';
  document.getElementById('recovery-section').style.display  = section === 'recovery' ? 'block' : 'none';
  document.getElementById('show-login').style.display        = section !== 'login'    ? 'block' : 'none';
  document.getElementById('login-error').style.display       = 'none';
}

document.getElementById('show-signup').addEventListener('click',   () => showSection('signup'));
document.getElementById('show-recovery').addEventListener('click', () => showSection('recovery'));
document.getElementById('show-login').addEventListener('click',    () => showSection('login'));

// ── Registrazione tramite chiave API CoC ─────────────────────────────────────

document.getElementById("signup-coc-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const playerTag = document.getElementById("coc-reg-tag").value.trim();
  const apiToken  = document.getElementById("coc-reg-token").value.trim();
  const password  = document.getElementById("coc-reg-password").value;
  const email     = document.getElementById("coc-reg-email").value.trim();

  if (!playerTag || !apiToken || !password) {
    showLoginError("Tag, chiave API e password sono obbligatori.");
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Verifica in corso…";

  try {
    const res = await fetch("/api/register-with-coc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerTag, apiToken, password, email: email || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      showLoginError(data.error || "Errore durante la registrazione.");
      return;
    }

    showLoginError(`Benvenuto, ${data.username}! Accesso in corso…`, "info");

    const { error: loginError } = await db.auth.signInWithPassword({
      email: data.email,
      password,
    });

    if (loginError) {
      showLoginError("Account creato. Accedi con il tuo tag come nome utente.");
    }
  } catch (err) {
    showLoginError("Errore di connessione. Ricarica la pagina e riprova.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⚔️ Verifica & Registrati";
  }
});

// ── Recupero password ─────────────────────────────────────────────────────────

document.getElementById("recovery-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("recovery-email").value.trim();
  if (!email) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Invio in corso…";

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "📨 Invia link di recupero";

  if (error) {
    showLoginError(error.message);
  } else {
    showLoginError("📨 Email inviata! Controlla la tua casella di posta.", "info");
  }
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
  document.getElementById("no-clan-screen").style.display = "none";
}

function updateClanUI() {
  const url  = window._clanBadgeUrl;
  const name = window._clanName || 'Il tuo Clan';

  // Badge in tutti gli elementi .tab-clan-badge e #sidebar-clan-badge
  ['sidebar-clan-badge', 'tab-clan-badge', 'bnav-clan-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (url) {
      el.src = url;
      el.style.display = 'inline-block';
      const fallback = el.nextElementSibling;
      if (fallback && (fallback.classList.contains('nav-icon--fallback') ||
                       fallback.classList.contains('sidebar-brand-icon--fallback') ||
                       fallback.classList.contains('bnav-icon--fallback'))) {
        fallback.style.display = 'none';
      }
    } else {
      el.style.display = 'none';
    }
  });

  // Badge nell'header del tab clan
  const headerBadge = document.getElementById('clan-header-badge');
  const headerFallback = document.getElementById('clan-header-badge-fallback');
  if (headerBadge && headerFallback) {
    if (url) {
      headerBadge.src = url;
      headerBadge.style.display = 'block';
      headerFallback.style.display = 'none';
    } else {
      headerBadge.style.display = 'none';
      headerFallback.style.display = 'flex';
    }
  }

  // Tag clan nell'header
  const tagEl = document.getElementById('clan-header-tag');
  if (tagEl) tagEl.textContent = window._userClanTag || '';

  // Nome clan ovunque
  document.querySelectorAll('.clan-name-dyn').forEach(el => {
    el.textContent = name;
  });
}

// ── PANNELLO DETTAGLI CLAN (espandibile) ──────────────────────────────────────

let _clanDetailsLoaded = false;
let _clanDetailsOpen   = false;

// Mappa nome lega inglese → file badge in /leagues/
const LEAGUE_BADGE_MAP = {
  'Bronze League III': 'BronzoIII', 'Bronze League II': 'BronzoII', 'Bronze League I': 'BronzoI',
  'Silver League III': 'ArgentoIII', 'Silver League II': 'ArgentoII', 'Silver League I': 'ArgentoI',
  'Gold League III':   'OroIII',     'Gold League II':   'OroII',     'Gold League I':   'OroI',
  'Crystal League III':'CristalloIII','Crystal League II':'CristalloII','Crystal League I':'CristalloI',
  'Master League III': 'MaestroIII', 'Master League II': 'MaestroII', 'Master League I': 'MaestroI',
  'Champion League III':'CampioneIII','Champion League II':'CampioneII','Champion League I':'CampioneI',
  'Titan League III':  'TitanoIII',  'Titan League II':  'TitanoII',  'Titan League I':  'TitanoI',
  'Legend League':     'Leggenda',
};

const CLAN_TYPE_LABELS = { open: 'Aperto', inviteOnly: 'Su invito', closed: 'Chiuso' };

// SVG inline per le info clan (piccoli, 16x16)
const SVG_TROPHY = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M7 3H4v5c0 1.5.8 2.8 2 3.6V13H4v2h16v-2h-2v-1.4c1.2-.8 2-2.1 2-3.6V3h-3V1H7v2zm10 5c0 1.7-1.3 3-3 3h-4c-1.7 0-3-1.3-3-3V5h10v3zm-5 8v3H9v2h6v-2h-3v-3h-1v1z"/></svg>`;
const SVG_PIN    = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
const SVG_SPEECH = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
const SVG_GLOBE  = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
const SVG_SHIELD = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>`;
const SVG_LOCK   = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
const SVG_UNLOCK = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 13c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6-5h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75l1.94.49C9.42 3.86 10.63 3 12 3c1.65 0 3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>`;
const SVG_MAIL   = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`;

function toggleClanDetails() {
  const panel   = document.getElementById('clan-details-panel');
  const chevron = document.getElementById('clan-details-chevron');
  const toggle  = document.getElementById('clan-details-toggle');
  if (!panel) return;

  _clanDetailsOpen = !_clanDetailsOpen;
  panel.classList.toggle('clan-details-panel--open', _clanDetailsOpen);
  if (chevron) chevron.style.transform = _clanDetailsOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  if (toggle)  toggle.classList.toggle('open', _clanDetailsOpen);

  if (_clanDetailsOpen && !_clanDetailsLoaded) {
    loadClanDetails();
  }
}

async function loadClanDetails() {
  const div = document.getElementById('clan-details-content');
  if (!div || !window._userClanTag) return;

  try {
    const r = await fetch(`/api/clan-info${clanQ()}`);
    if (!r.ok) throw new Error('non disponibile');
    const info = await r.json();
    _clanDetailsLoaded = true;
    renderClanDetails(info, div);
  } catch (_) {
    div.innerHTML = '<span style="color:var(--text-3);font-size:0.78rem">Informazioni clan non disponibili.</span>';
  }
}

function renderClanDetails(info, div) {
  if (!div || !info) return;

  // War League — nome in italiano
  const leagueNameEn    = info.warLeague?.name || null;
  const leagueNameIt    = leagueNameEn ? (LEAGUE_EN_TO_IT[leagueNameEn] || leagueNameEn) : null;
  const leagueBadgeFile = leagueNameEn ? LEAGUE_BADGE_MAP[leagueNameEn] : null;
  const leagueHtml = leagueNameIt
    ? `<div class="clan-detail-item">
        ${leagueBadgeFile ? `<img src="leagues/${leagueBadgeFile}.png" alt="${leagueNameIt}" class="clan-detail-league-badge">` : SVG_TROPHY}
        <span>${leagueNameIt}</span>
       </div>`
    : '';

  // Tipo accesso
  const typeKey   = info.type || 'open';
  const typeLabel = CLAN_TYPE_LABELS[typeKey] || typeKey;
  const typeSvg   = typeKey === 'closed' ? SVG_LOCK : typeKey === 'inviteOnly' ? SVG_MAIL : SVG_UNLOCK;
  const typeHtml  = `<div class="clan-detail-item">${typeSvg}<span>${typeLabel}</span></div>`;

  // Trofei richiesti
  const trophiesHtml = info.requiredTrophies != null
    ? `<div class="clan-detail-item">${SVG_TROPHY}<span>${info.requiredTrophies.toLocaleString('it-IT')} trofei req.</span></div>`
    : '';

  // Sede/Luogo
  const locationHtml = info.location?.name
    ? `<div class="clan-detail-item">${SVG_PIN}<span>${info.location.name}</span></div>`
    : '';

  // Lingua
  const langHtml = info.chatLanguage?.name
    ? `<div class="clan-detail-item">${SVG_SPEECH}<span>${info.chatLanguage.name}</span></div>`
    : '';

  // Punti clan (globale)
  const pointsHtml = info.clanPoints != null
    ? `<div class="clan-detail-item">${SVG_GLOBE}<span>${info.clanPoints.toLocaleString('it-IT')} pt</span></div>`
    : '';

  // Livello clan
  const levelHtml = info.clanLevel != null
    ? `<div class="clan-detail-item">${SVG_SHIELD}<span>Lv ${info.clanLevel}</span></div>`
    : '';

  div.innerHTML = `<div class="clan-detail-grid">
    ${leagueHtml}${locationHtml}${langHtml}${typeHtml}${trophiesHtml}${pointsHtml}${levelHtml}
  </div>`;
}

function showNoClanScreen(username) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "none";
  document.getElementById("no-clan-screen").style.display = "flex";
  const nameEl = document.getElementById("no-clan-username");
  if (nameEl) nameEl.textContent = username ? `, ${username}` : '';
}

// Costanti ruoli (ordine crescente di privilegio)
const ROLES = [
  { value: 'utente',  label: 'Utente',   cls: 'role-utente' },
  { value: 'membro',  label: 'Membro',   cls: 'role-member' },
  { value: 'anziano', label: 'Anziano',  cls: 'role-elder' },
  { value: 'co-capo', label: 'Co-Capo', cls: 'role-coleader' },
  { value: 'capo',    label: 'Capo',     cls: 'role-capo' },
  { value: 'admin',   label: 'Admin',    cls: 'role-leader' },
];
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.value, r]));

async function showApp(sessionUser) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Recupera i dati utente aggiornati dal server (evita metadata stale)
  let user = sessionUser;
  try {
    const { data } = await db.auth.getUser();
    if (data?.user) user = data.user;
  } catch (_) {}

  const role = user.user_metadata?.role || 'utente';
  const isAdmin   = role === 'admin';
  const canEdit   = ['admin', 'capo', 'co-capo'].includes(role);

  // Imposta info clan dell'utente
  window._userClanTag  = user.user_metadata?.coc_clan_tag  || null;
  window._clanName     = user.user_metadata?.coc_clan_name || '';
  window._clanBadgeUrl = user.user_metadata?.coc_clan_badge_url || null;

  // Se l'utente non è in nessun clan
  if (!window._userClanTag) {
    if (!isAdmin) {
      showNoClanScreen(user.user_metadata?.username || '');
      return;
    }
    // Admin senza clan: nasconde le tab clan, va direttamente a Gestione Utenti
    ['members', 'warlog', 'cwl'].forEach(tab => {
      document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => el.style.display = 'none');
    });
  }

  // Mostra nome in-game nella sidebar
  const displayName = user.user_metadata?.username || user.email?.replace(/@(fearunited|cocboard)\.internal$/, '') || user.email;
  document.getElementById('user-email').textContent = displayName;
  const topbarEmailEl = document.getElementById('topbar-email');
  if (topbarEmailEl) topbarEmailEl.textContent = displayName;

  // Applica badge clan e nome in tutta la UI
  updateClanUI();

  // Badge ruolo in header
  const badge = document.getElementById('user-role-badge');
  const roleInfo = ROLE_LABELS[role];
  if (roleInfo) {
    badge.textContent = roleInfo.label;
    badge.className = `badge ${roleInfo.cls}`;
    badge.style.display = 'inline';
  }
  // capo/co-capo/admin vedono pulsanti di modifica bonus
  // (gli elementi tab admin sono esclusi perché gestiti sotto separatamente)
  document.querySelectorAll('.admin-only').forEach(el => {
    if (el.dataset.tab === 'admin') return;
    const tag = el.tagName.toLowerCase();
    el.style.display = canEdit
      ? (el.classList.contains('bnav-btn') ? 'flex'
         : tag === 'button' || tag === 'span' ? 'inline-block' : 'block')
      : 'none';
  });

  // Solo admin vede tab "Gestione Utenti"
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

  if (!window._userClanTag && isAdmin) {
    activateTab('admin');
  } else {
    loadMembers();
  }
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
  const query = db.from("members").select("*").order("name");
  if (window._userClanTag) query.eq("clan_tag", window._userClanTag);
  const { data } = await query;
  renderMembers(data || []);
}

// Ritorna il percorso immagine TH — usa webp (th/) per livelli 1-18, png per 19+
function thImgSrc(level) {
  const n = String(level).padStart(2, "0");
  return level <= 18 ? `th/level_${n}.webp` : `th/level_${n}.png`;
}

// Fallback png se webp non carica (chiamata da onerror inline)
function thImgFallback(el, level) {
  el.onerror = null;
  el.src = `th/level_${String(level).padStart(2,"0")}.png`;
}

function thImg(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  return `<div class="th-cell">
        <img src="${thImgSrc(level)}" alt="TH${level}" class="th-img" onerror="thImgFallback(this,${level})">
        <span class="th-label">TH${level}</span>
    </div>`;
}

// Vertical variant: image with level shown below (used in CWL sections)
function thImgV(level) {
  if (!level) return '<span class="th-unknown">?</span>';
  return `<div class="th-cell-v">
    <img src="${thImgSrc(level)}" alt="TH${level}" class="th-img" onerror="thImgFallback(this,${level})">
    <span class="th-label-v">TH${level}</span>
  </div>`;
}

// Ex-player placeholder (player left the clan)
function thImgOut() {
  return `<div class="th-cell-v">
    <img src="th/playerout.webp" alt="Ex" class="th-img th-img-out" onerror="this.onerror=null;this.src='th/playerout.png'">
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

    // Lega individuale giocatore
    const leagueItName = m.league_name ? (LEAGUE_EN_TO_IT[m.league_name] || m.league_name) : null;
    const leagueImgSrc = m.league_icon_url || (m.league_name && LEAGUE_BADGE_MAP[m.league_name] ? `leagues/${LEAGUE_BADGE_MAP[m.league_name]}.png` : null);
    const leagueHtml = leagueImgSrc
      ? `<img src="${leagueImgSrc}" class="league-badge-sm" alt="${leagueItName || ''}" title="${leagueItName || ''}" loading="lazy">`
      : '<span class="no-league-badge">—</span>';

    // Badge SVG per giocatori nuovi (< 7 giorni)
    const newBadge = isNew
      ? `<svg class="new-player-badge" viewBox="0 0 38 13" xmlns="http://www.w3.org/2000/svg" aria-label="Nuovo membro"><rect x="0.5" y="0.5" width="37" height="12" rx="2.5" fill="rgba(39,174,96,0.15)" stroke="rgba(39,174,96,0.45)"/><text x="19" y="9.5" text-anchor="middle" font-size="7" font-weight="700" fill="#27AE60" font-family="IBM Plex Mono,monospace" letter-spacing="0.6">NUOVO</text></svg>`
      : '';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-league">${leagueHtml}</td>
      <td class="col-th-cell">${thImgV(m.th_level)}</td>
      <td class="col-member">
        <div class="member-name-wrap">
          <span class="member-name">${m.name}</span>${newBadge}
        </div>
        <span class="member-tag">${m.tag}<span class="member-role-inline ${role.cls}">${role.label}</span></span>
      </td>
      <td class="stat-cell col-trophies">${m.trophies ?? '—'}</td>
      <td class="stat-cell col-extra">${m.donations ?? '—'} / ${m.donations_received ?? '—'}</td>
      <td class="stat-cell col-extra">${m.clan_rank ?? '—'}</td>
      <td class="col-expand-btn"><button class="btn-expand" onclick="toggleMemberExpand(this)" aria-label="Espandi" aria-expanded="false">+</button></td>
    `;

    const trExtra = document.createElement("tr");
    trExtra.className = "tr-member-extra";
    trExtra.innerHTML = `
      <td colspan="99" class="td-extra-content">
        <span class="extra-kv"><span class="extra-k">Don.</span>${m.donations ?? '—'}&nbsp;/&nbsp;Ric.&nbsp;${m.donations_received ?? '—'}</span>
        <span class="extra-sep">·</span>
        <span class="extra-kv"><span class="extra-k">#</span>${m.clan_rank ?? '—'}</span>
      </td>
    `;

    tbody.appendChild(tr);
    tbody.appendChild(trExtra);
  });

  // Aggiorna stat cards compatte (nella sezione Dettagli clan)
  const leaders   = members.filter(m => m.role === 'leader').length;
  const coleaders = members.filter(m => m.role === 'coLeader').length;
  const thLevels  = members.map(m => m.th_level).filter(Boolean);
  const avgTh     = thLevels.length ? (thLevels.reduce((a,b)=>a+b,0)/thLevels.length).toFixed(1) : '—';
  const s = id => document.getElementById(id);
  if (s('stat-total'))     s('stat-total').textContent     = members.length;
  if (s('stat-leaders'))   s('stat-leaders').textContent   = leaders;
  if (s('stat-coleaders')) s('stat-coleaders').textContent = coleaders;
  if (s('stat-avg-th'))    s('stat-avg-th').textContent    = avgTh;
}

// Espande/comprime la riga extra (mobile) nella tabella membri
function toggleMemberExpand(btn) {
  const tr   = btn.closest('tr');
  const next = tr.nextElementSibling;
  if (!next || !next.classList.contains('tr-member-extra')) return;
  const isOpen = next.classList.toggle('visible');
  btn.textContent = isOpen ? '−' : '+';
  btn.setAttribute('aria-expanded', isOpen);
}


document.getElementById("sync-btn").addEventListener("click", async () => {
  const status = document.getElementById("sync-status");
  status.textContent = "Sincronizzazione in corso…";
  try {
    const res = await fetch(`/api/sync-members${clanQ()}`, { method: 'POST' });
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
  const q = db
    .from('cwl_history')
    .select('player_name, still_in_clan, is_secondary, participated, stars, destruction, attacks_made, attacks_required, bonus_score, bonus_assigned, season')
    .order('bonus_score', { ascending: false });
  if (window._userClanTag) q.eq('clan_tag', window._userClanTag);
  const { data } = await q;
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

// Carica alias da Supabase (tabella player_aliases) — filtrati per clan
async function loadPlayerAliases() {
  _playerAliases = {};
  try {
    const q = db.from('player_aliases').select('*');
    if (window._userClanTag) q.eq('clan_tag', window._userClanTag);
    const { data } = await q;
    (data || []).forEach(a => { _playerAliases[a.alias.toLowerCase()] = a; });
  } catch (_) {} // tabella potrebbe non esistere ancora
}

// Calcola info scadenza ex-player (retention 6 mesi dall'ultima stagione attiva)
function calcExpiryInfo(lastActiveSeason) {
  const RETENTION = 6;
  if (!lastActiveSeason) return { expiresSeason: '—', mesiRimasti: 0, scaduto: true };
  const [ly, lm] = lastActiveSeason.split('-').map(Number);
  const expYear  = ly + Math.floor((lm - 1 + RETENTION) / 12);
  const expMonth = ((lm - 1 + RETENTION) % 12) + 1;
  const expiresSeason = `${expYear}-${String(expMonth).padStart(2, '0')}`;
  const now = new Date();
  const nowYear = now.getFullYear(), nowMonth = now.getMonth() + 1;
  const nowSeason = `${nowYear}-${String(nowMonth).padStart(2, '0')}`;
  const mesiRimasti = (expYear - nowYear) * 12 + (expMonth - nowMonth);
  return { expiresSeason, mesiRimasti: Math.max(0, mesiRimasti), scaduto: nowSeason > expiresSeason };
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

// Ritorna il nome canonico (coc_name dall'alias se esiste, altrimenti il nome originale)
// Usato per unificare righe duplicate in Storico/HoF quando un player cambia nome
function getCanonicalName(name) {
  if (!name) return name;
  const a = _playerAliases[name.toLowerCase()];
  return a?.coc_name || name;
}

async function loadMembersMap() {
  _assignMembersMap = {};

  // 1) Carica PRIMA da Supabase — veloce e sempre disponibile (ha th_level, tag, ecc.)
  const sbQ = db.from('members').select('*');
  if (window._userClanTag) sbQ.eq('clan_tag', window._userClanTag);
  const { data: sbData } = await sbQ;
  if (sbData) sbData.forEach(m => { _assignMembersMap[m.name.toLowerCase()] = m; });

  // 2) Prova a refreshare dai dati live CoC API (con timeout 6s per non bloccare)
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`/api/clan-members${clanQ()}`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (r.ok) {
      const j = await r.json();
      // Mergia dati API (più freschi) con quelli Supabase, preservando th_level
      // (l'API CoC usa townHallLevel, Supabase usa th_level)
      (j.items || []).forEach(m => {
        const existing = _assignMembersMap[m.name.toLowerCase()] || {};
        _assignMembersMap[m.name.toLowerCase()] = {
          ...existing,
          ...m,
          th_level: m.townHallLevel || existing.th_level,
        };
      });
    }
  } catch (_) {} // timeout o proxy offline → usiamo dati Supabase

  await loadPlayerAliases();
}

async function loadAssignBonus() {
  const status = document.getElementById('cwl-status');
  if (!status) return;
  status.textContent = 'Verifica CWL in corso…';

  try {
    const res = await fetch(`/api/cwl-stats${clanQ()}`);
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
  const qRecent = db.from('cwl_history').select('season').order('season', { ascending: false }).limit(1);
  if (window._userClanTag) qRecent.eq('clan_tag', window._userClanTag);
  const { data } = await qRecent;
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
    const res = await fetch(`/api/cwl-stats${clanQ()}`);
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
      clan_tag:         window._userClanTag || null,
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

  const { error } = await db.from('cwl_history').upsert(rows, { onConflict: 'player_name,season,clan_tag' });
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

  const qMonth = db.from('cwl_history').select('*').eq('season', season).order('bonus_score', { ascending: false });
  if (window._userClanTag) qMonth.eq('clan_tag', window._userClanTag);
  const { data: history } = await qMonth;

  await loadMembersMap();

  // Carica l'ultima stagione attiva per ciascun ex-player (per mostrare scadenza in rosso)
  const expiryMap = {}; // playerName → lastActiveSeason
  const exNames = (history || []).filter(h => !isCurrentMember(h.player_name)).map(h => h.player_name);
  if (exNames.length && window._userClanTag) {
    const qExp = db.from('cwl_history')
      .select('player_name, season')
      .eq('clan_tag', window._userClanTag)
      .eq('still_in_clan', true)
      .in('player_name', exNames)
      .order('season', { ascending: false });
    const { data: expData } = await qExp;
    (expData || []).forEach(r => {
      if (!expiryMap[r.player_name]) expiryMap[r.player_name] = r.season;
    });
  }

  if (statusEl) statusEl.textContent = '';
  renderAssignContent(history || [], season, false, expiryMap);
}

function renderAssignContent(players, season, isLive, expiryMap = {}) {
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
        const thHtml = thImgBonus(p.player_name, !isCurrentMember(p.player_name));
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

  // ── Suddividi giocatori in: attivi / secondari / ex ───────────────────────
  const activePlayers    = [];
  const secondaryPlayers = [];
  const exPlayers        = [];

  players.forEach(p => {
    const name   = isLive ? p.name : p.player_name;
    const inClan = isLive ? true : isCurrentMember(name);
    const isSec  = !isLive && (p.is_secondary || false);
    if (!inClan)     exPlayers.push(p);
    else if (isSec)  secondaryPlayers.push(p);
    else             activePlayers.push(p);
  });

  // ── Funzione helper per costruire righe tabella ────────────────────────────
  function buildAssignRow(p, isSec) {
    const name    = isLive ? p.name : p.player_name;
    const member  = _assignMembersMap[name?.toLowerCase()];
    const inClan  = isLive ? true : isCurrentMember(name);
    const thHtml  = thImgBonus(name, !inClan);
    const tag     = member?.tag ? `<br><span class="tag-cell">${member.tag}</span>` : '';
    const hasBonus    = !isLive && p.bonus_assigned;
    const participated = isLive || p.participated;
    const atkMade = p.attacks_made ?? 0;
    const atkReq  = p.attacks_required ?? 0;
    const destr   = p.destruction || 0;
    const avgD    = atkMade > 0 ? (destr / atkMade).toFixed(1) + '%' : '—';
    const atk     = atkReq > 0 ? `${atkMade}/${atkReq}` : '—';
    const score   = isLive ? '—' : (p.bonus_score ?? '—');
    const stars   = p.stars ?? '—';
    const participatedHtml = participated
      ? '<span class="cwl-yes">✓ CWL</span>'
      : '<span class="cwl-no">✗</span>';
    const bonusIcon = hasBonus ? ' <span class="assign-bonus-icon">🏆</span>' : '';
    const secBadge  = isSec ? ' <span class="assign-sec-badge">2°</span>' : '';
    const qname = name.replace(/"/g, '&quot;');
    return `<tr>
      <td class="assign-chk-col stat-cell" style="display:none">
        <input type="checkbox" class="assign-check" data-name="${qname}" ${hasBonus ? 'checked' : ''} style="accent-color:#f0a500;width:16px;height:16px">
      </td>
      <td class="assign-sec-col stat-cell" style="display:none">
        <input type="checkbox" class="assign-secondary" data-name="${qname}" ${isSec ? 'checked' : ''} style="accent-color:#7aaccc;width:16px;height:16px" title="Secondo account">
      </td>
      <td>${thHtml}</td>
      <td><span class="member-name">${name}${bonusIcon}${secBadge}</span>${tag}</td>
      <td>${participatedHtml}</td>
      <td class="stat-cell">${stars}</td>
      <td class="stat-cell hide-xs">${avgD}</td>
      <td class="stat-cell hide-xs">${atk}</td>
      <td class="stat-cell hide-sm"><strong>${score}</strong></td>
    </tr>`;
  }

  // ── Tabella principale (attivi + secondari) ────────────────────────────────
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
          <th class="assign-chk-col" style="display:none;width:36px;text-align:center" title="Assegna bonus">✓</th>
          <th class="assign-sec-col" style="display:none;width:36px;text-align:center" title="Secondo account">2°</th>
          <th>TH</th>
          <th>Nome / Tag</th>
          <th>CWL</th>
          <th>⭐ Stelle</th>
          <th class="hide-xs">💥 Distruz.</th>
          <th class="hide-xs">⚔ Attacchi</th>
          <th class="hide-sm">Score</th>
        </tr></thead>
        <tbody>`;

  activePlayers.forEach(p => { html += buildAssignRow(p, false); });

  if (secondaryPlayers.length) {
    html += `<tr class="cwl-section-row"><td colspan="9">— Account secondari (${secondaryPlayers.length})</td></tr>`;
    secondaryPlayers.forEach(p => { html += buildAssignRow(p, true); });
  }

  html += '</tbody></table></div></div>';

  // ── Sezione Ex-player (non più nel clan) — solo storico ───────────────────
  if (exPlayers.length && !isLive) {
    html += `<div class="assign-ex-section">
      <h4 class="assign-ex-title">🚪 Ex-player — non più nel clan (${exPlayers.length})</h4>
      <p style="font-size:0.78rem;color:var(--text-3);margin:-0.25rem 0 0.75rem">
        I dati degli ex-player vengono eliminati automaticamente dopo <strong style="color:#ef5350">6 mesi</strong> dall'ultima stagione attiva.
      </p>
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>TH</th>
          <th>Nome / Tag</th>
          <th>CWL</th>
          <th>⭐ Stelle</th>
          <th class="hide-xs">💥 Distruz.</th>
          <th class="hide-xs">⚔ Attacchi</th>
          <th class="hide-sm">Score</th>
          <th>Scadenza</th>
        </tr></thead>
        <tbody>`;
    exPlayers.forEach(p => {
      const name    = p.player_name;
      const thHtml  = thImgBonus(name, true);
      const hasBonus    = p.bonus_assigned;
      const participated = p.participated;
      const atkMade = p.attacks_made ?? 0;
      const atkReq  = p.attacks_required ?? 0;
      const destr   = p.destruction || 0;
      const avgD    = atkMade > 0 ? (destr / atkMade).toFixed(1) + '%' : '—';
      const atk     = atkReq > 0 ? `${atkMade}/${atkReq}` : '—';
      const score   = p.bonus_score ?? '—';
      const stars   = p.stars ?? '—';
      const participatedHtml = participated
        ? '<span class="cwl-yes">✓ CWL</span>'
        : '<span class="cwl-no">✗</span>';
      const bonusIcon = hasBonus ? ' <span class="assign-bonus-icon">🏆</span>' : '';
      // Badge scadenza
      const exp = calcExpiryInfo(expiryMap[name] || null);
      const expBadge = exp.scaduto
        ? `<span style="color:#ef5350;font-size:0.75rem;font-weight:700">⚠ Scaduto</span>`
        : exp.mesiRimasti <= 2
          ? `<span style="color:#ef5350;font-size:0.75rem;font-weight:600">🗑 ${exp.mesiRimasti} mes${exp.mesiRimasti === 1 ? 'e' : 'i'}</span>`
          : `<span style="color:#ef5350;font-size:0.75rem">🗑 ${exp.expiresSeason}</span>`;
      html += `<tr class="assign-ex-row">
        <td>${thHtml}</td>
        <td><span class="member-name storico-ex-name">${name}${bonusIcon}</span></td>
        <td>${participatedHtml}</td>
        <td class="stat-cell">${stars}</td>
        <td class="stat-cell hide-xs">${avgD}</td>
        <td class="stat-cell hide-xs">${atk}</td>
        <td class="stat-cell hide-sm"><strong>${score}</strong></td>
        <td class="stat-cell">${expBadge}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  div.innerHTML = html;
}

function toggleAssignEdit(cancel = false) {
  const editBtn = document.getElementById('assign-edit-btn');
  const saveBtn = document.getElementById('assign-save-btn');
  const cancelBtn = document.getElementById('assign-cancel-btn');
  const isEditing = saveBtn?.style.display !== 'none';
  const turnOn = !cancel && !isEditing;

  document.querySelectorAll('.assign-chk-col, .assign-sec-col').forEach(el => {
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
  // Raccoglie stato "secondo account" per nome
  const secMap = {};
  document.querySelectorAll('.assign-secondary').forEach(cb => { secMap[cb.dataset.name] = cb.checked; });
  const rows = [];
  checks.forEach(cb => {
    rows.push({
      clan_tag:       window._userClanTag || null,
      player_name:    cb.dataset.name,
      season,
      bonus_assigned: cb.checked,
      is_secondary:   secMap[cb.dataset.name] || false,
      participated: true,
      stars: 0, destruction: 0.0,
      attacks_made: 0, attacks_required: 0,
      bonus_score: 0, still_in_clan: true
    });
  });

  if (!rows.length) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salva'; }
    return;
  }

  const { error } = await db.from('cwl_history')
    .upsert(rows, { onConflict: 'player_name,season,clan_tag' });

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

  const qStorico = db.from('cwl_history').select('*').order('season', { ascending: false });
  if (window._userClanTag) qStorico.eq('clan_tag', window._userClanTag);
  const { data: history, error } = await qStorico;

  if (error || !history?.length) {
    div.innerHTML = error
      ? `<p style="color:#ff6b6b">Errore: ${error.message}</p>`
      : '<p class="wl-loading">Nessun dato storico disponibile.</p>';
    return;
  }

  await loadMembersMap();

  // Aggrega per giocatore usando il nome CANONICO (merge alias: "Geped" + "Geped™" → un'unica riga)
  const playerMap = {};
  history.forEach(h => {
    const key = getCanonicalName(h.player_name); // usa nome CoC se esiste alias
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
        total_seasons: 0,
        lastActiveSeason: null,  // ultima stagione con still_in_clan=true
      };
    }
    const p = playerMap[key];
    if (h.still_in_clan) {
      p.still_in_clan = true;
      if (!p.lastActiveSeason || h.season > p.lastActiveSeason) p.lastActiveSeason = h.season;
    }
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
    if (h.bonus_assigned && h.season) {
      // Evita duplicati di mese se stesso player con nome diverso
      if (!p.bonus_months.includes(h.season)) p.bonus_months.push(h.season);
    }
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
      // Badge scadenza per ex-player
      let expCell = '';
      if (isEx) {
        const exp = calcExpiryInfo(p.lastActiveSeason);
        expCell = exp.scaduto
          ? `<br><span style="color:#ef5350;font-size:0.72rem;font-weight:700">⚠ Dati scaduti — eliminazione imminente</span>`
          : exp.mesiRimasti <= 2
            ? `<br><span style="color:#ef5350;font-size:0.72rem;font-weight:600">🗑 Eliminazione tra ${exp.mesiRimasti} mes${exp.mesiRimasti === 1 ? 'e' : 'i'}</span>`
            : `<br><span style="color:#ef5350;font-size:0.72rem">🗑 Eliminaz. ${exp.expiresSeason}</span>`;
      }
      return `<tr>
        <td>${thHtml}</td>
        <td class="tag-cell">${tag}</td>
        <td><span class="${nameCls}">${p.player_name}</span>${expCell}</td>
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

  const qHof = db.from('cwl_history')
    .select('player_name, season, still_in_clan, bonus_score')
    .eq('bonus_assigned', true)
    .order('season', { ascending: true });
  if (window._userClanTag) qHof.eq('clan_tag', window._userClanTag);
  const { data, error } = await qHof;

  if (error) { div.innerHTML = `<p style="color:var(--red)">Errore: ${error.message}</p>`; return; }
  if (!data?.length) { div.innerHTML = '<p class="wl-loading">Nessun bonus trovato.</p>'; return; }

  // Raggruppa per player usando nome CANONICO (merge "Geped" + "Geped™" → una sola riga)
  const map = {};
  for (const r of data) {
    const key = getCanonicalName(r.player_name);
    if (!map[key]) map[key] = { months: [], inClan: false };
    if (!map[key].months.includes(r.season)) map[key].months.push(r.season);
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
  const sbMQ = db.from('members').select('name').order('name');
  if (window._userClanTag) sbMQ.eq('clan_tag', window._userClanTag);
  const { data: sbMembers } = await sbMQ;
  if (sbMembers) members = sbMembers.map(r => r.name).filter(Boolean);

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`/api/clan-members${clanQ()}`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (r.ok) {
      const j = await r.json();
      const apiNames = (j.items || []).map(m => m.name).sort((a, b) => a.localeCompare(b));
      if (apiNames.length) members = apiNames; // API dati più freschi
    }
  } catch (_) {}

  // Fallback finale: prende i nomi unici dalla panoramica storica
  if (!members.length) {
    const qFallback = db.from('cwl_history').select('player_name');
    if (window._userClanTag) qFallback.eq('clan_tag', window._userClanTag);
    const { data } = await qFallback;
    if (data) {
      members = [...new Set(data.map(r => r.player_name))].sort((a, b) => a.localeCompare(b));
    }
  }

  if (!members.length) {
    listDiv.innerHTML = '<p style="color:#ff6b6b;font-size:0.85rem">Impossibile caricare i membri. Verifica la connessione.</p>';
    return;
  }

  // Controlla chi ha già ricevuto il bonus in questa stagione
  const qExisting = db.from('cwl_history').select('player_name').eq('season', season).eq('bonus_assigned', true);
  if (window._userClanTag) qExisting.eq('clan_tag', window._userClanTag);
  const { data: existing } = await qExisting;
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
    clan_tag:         window._userClanTag || null,
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
    .upsert(rows, { onConflict: 'player_name,season,clan_tag' });

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

  const nMembers = Object.keys(_assignMembersMap).length;
  const nAliases = Object.keys(_playerAliases).length;

  const qAlias = db.from('cwl_history').select('player_name');
  if (window._userClanTag) qAlias.eq('clan_tag', window._userClanTag);
  const { data: historyPlayers } = await qAlias;
  if (!historyPlayers?.length) {
    div.innerHTML = `<p style="font-size:0.84rem;color:var(--text-3)">Nessun giocatore nello storico. (Membri caricati: ${nMembers}, Alias: ${nAliases})</p>`;
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
    <p style="font-size:0.75rem;color:var(--text-3);margin-bottom:0.6rem">
      Membri CoC caricati: <strong style="color:var(--text)">${nMembers}</strong> &nbsp;·&nbsp;
      Alias attivi: <strong style="color:var(--gold)">${nAliases}</strong>
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
  const qCrit = db.from('cwl_history').select('*').eq('season', season).eq('is_secondary', false);
  if (window._userClanTag) qCrit.eq('clan_tag', window._userClanTag);
  const { data: history, error } = await qCrit;

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
    const qRecent2 = db.from('cwl_history')
      .select('player_name, season')
      .eq('bonus_assigned', true)
      .gte('season', fromSeason)
      .neq('season', season);
    if (window._userClanTag) qRecent2.eq('clan_tag', window._userClanTag);
    const { data: recentData } = await qRecent2;
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
    clan_tag:         window._userClanTag || null,
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

  const { error } = await db.from('cwl_history').upsert(upsertData, { onConflict: 'player_name,season,clan_tag' });
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

  const qBonusHist = db.from('cwl_history')
    .select('*')
    .eq('season', season)
    .eq('bonus_assigned', true)
    .order('bonus_score', { ascending: false });
  if (window._userClanTag) qBonusHist.eq('clan_tag', window._userClanTag);
  const { data, error } = await qBonusHist;

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

  const qOverview = db.from('cwl_history')
    .select('player_name, season, still_in_clan')
    .eq('bonus_assigned', true)
    .order('season', { ascending: true });
  if (window._userClanTag) qOverview.eq('clan_tag', window._userClanTag);
  const { data, error } = await qOverview;

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

  const ROLE_ORDER = ['admin','capo','co-capo','anziano','membro','utente'];
  users.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.user_metadata?.role || 'utente');
    const rb = ROLE_ORDER.indexOf(b.user_metadata?.role || 'utente');
    return ra - rb;
  });

  const myDisplayName = document.getElementById('user-email').textContent;

  users.forEach(u => {
    const role      = u.user_metadata?.role || 'utente';
    const username  = u.user_metadata?.username || '';
    const cocTag    = u.user_metadata?.coc_tag || '';
    const roleInfo  = ROLE_LABELS[role] || ROLE_LABELS['utente'];
    const isInternal = u.email?.endsWith('@fearunited.internal') || u.email?.endsWith('@cocboard.internal');
    const loginId   = isInternal ? u.email.replace(/@(fearunited|cocboard)\.internal$/, '') : (u.email || '—');
    const recoveryEmail = u.user_metadata?.email || '';

    // Colonna Tag/Login
    const tagCell = cocTag
      ? `<span class="login-id-tag" title="Tag CoC">${cocTag}</span>`
      : `<span class="login-id-tag" title="Nome utente login">${loginId}</span>`;

    // Colonna Email (mostra email di recupero dai metadata)
    const emailCell = recoveryEmail
      ? `<span style="font-size:0.8rem;color:#7ab8d4">${recoveryEmail}</span>`
      : `<span class="user-no-email" title="Nessuna email impostata">—</span>`;

    const created   = new Date(u.created_at).toLocaleDateString('it-IT');
    const isMe      = (username || loginId) === myDisplayName;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="member-name">${username || loginId}</td>
      <td>${tagCell}</td>
      <td class="hide-md">${emailCell}</td>
      <td>
        <select class="admin-role-sel" onchange="changeRole('${u.id}', this)" ${isMe ? 'disabled' : ''}>
          ${ROLES.map(r => `<option value="${r.value}" ${r.value === role ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </td>
      <td class="date-cell">${created}</td>
      <td class="admin-actions-cell">
        ${!isMe ? `
          <button class="admin-save-btn" onclick="saveRole('${u.id}', this)">💾 Salva</button>
          <button class="btn-secondary btn-sm" onclick="resetUserPassword('${u.id}', '${(username || loginId).replace(/'/g,"\\'")}')">🔑 Password</button>
          <button class="btn-danger" onclick="deleteUser('${u.id}', '${(username || loginId).replace(/'/g,"\\'")}')">🗑</button>
        ` : '<span style="font-size:0.75rem;color:#5a7a98">(tu)</span>'}
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

async function resetUserPassword(userId, username) {
  const newPassword = prompt(`Nuova password per "${username}" (min 6 caratteri):`);
  if (!newPassword) return;
  if (newPassword.length < 6) { alert('Password troppo corta (min 6 caratteri).'); return; }

  const res = await fetch('/api/admin/users', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, newPassword }),
  });
  if (res.ok) showAdminMsg(`✅ Password di "${username}" aggiornata.`);
  else { const e = await res.json().catch(() => ({})); showAdminMsg('✗ ' + (e.error || 'Errore reset.'), 'error'); }
}

async function deleteUser(userId, username) {
  if (!confirm(`Eliminare l'utente "${username}"? Questa azione è irreversibile.`)) return;
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
    const r = await fetch(`/api/war-log${clanQ()}`, { signal: ctrl.signal });
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

      const stars     = `${w.clan?.stars ?? 0} ⭐ — ⭐ ${w.opponent?.stars ?? 0}`;
      const destrClan = w.clan?.destructionPercentage?.toFixed(1) ?? '0.0';
      const destrOpp  = w.opponent?.destructionPercentage?.toFixed(1) ?? '0.0';
      const size      = w.teamSize ?? '?';

      // Clan badge + nome + livello
      const clanBadge  = w.clan?.badgeUrls?.small
        ? `<img src="${w.clan.badgeUrls.small}" alt="" class="wl-clan-badge">`  : '🛡️';
      const oppBadge   = w.opponent?.badgeUrls?.small
        ? `<img src="${w.opponent.badgeUrls.small}" alt="" class="wl-clan-badge">` : '🛡️';
      const clanLv  = w.clan?.clanLevel     ? `<span class="wl-clan-lv">Lv ${w.clan.clanLevel}</span>`     : '';
      const oppLv   = w.opponent?.clanLevel ? `<span class="wl-clan-lv">Lv ${w.opponent.clanLevel}</span>` : '';
      const oppName = w.opponent?.name ?? 'Sconosciuto';

      const ourClan = `<div class="wl-clan-cell">${clanBadge}<span>${w.clan?.name ?? 'Noi'}${clanLv}</span></div>`;
      const oppClan = `<div class="wl-clan-cell">${oppBadge}<span>${oppName}${oppLv}</span></div>`;

      return `<tr>
        <td class="stat-cell">${date}</td>
        <td>${result}</td>
        <td>${ourClan}</td>
        <td class="stat-cell" style="text-align:center">vs<br><span style="font-size:0.72rem;color:var(--text-3)">${size}v${size}</span></td>
        <td>${oppClan}</td>
        <td class="stat-cell">${stars}</td>
        <td class="stat-cell">${destrClan}% — ${destrOpp}%</td>
      </tr>`;
    }).join('');

    div.innerHTML = `
      <div class="table-wrap" style="margin-top:0.75rem">
        <table>
          <thead><tr>
            <th>Data</th><th>Risultato</th><th>Noi</th><th style="text-align:center">—</th>
            <th>Avversario</th><th>⭐ Noi — Loro</th><th>💥 Noi — Loro</th>
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
const POS_MEDALS = ['', '🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

// Mappa nome lega inglese (API) → italiano (UI)
const LEAGUE_EN_TO_IT = {
  'Bronze League III':'Bronzo III','Bronze League II':'Bronzo II','Bronze League I':'Bronzo I',
  'Silver League III':'Argento III','Silver League II':'Argento II','Silver League I':'Argento I',
  'Gold League III':'Oro III','Gold League II':'Oro II','Gold League I':'Oro I',
  'Crystal League III':'Cristallo III','Crystal League II':'Cristallo II','Crystal League I':'Cristallo I',
  'Master League III':'Maestro III','Master League II':'Maestro II','Master League I':'Maestro I',
  'Champion League III':'Campione III','Champion League II':'Campione II','Champion League I':'Campione I',
  'Titan League III':'Titano III','Titan League II':'Titano II','Titan League I':'Titano I',
  'Legend League':'Leggenda'
};

// Icone trofeo CWL — immagini locali (scaricate da Fandom CoC wiki, stile in-game)
const LEAGUE_BADGE = {
  'Bronzo III':   '/leagues/BronzoIII.png',
  'Bronzo II':    '/leagues/BronzoII.png',
  'Bronzo I':     '/leagues/BronzoI.png',
  'Argento III':  '/leagues/ArgentoIII.png',
  'Argento II':   '/leagues/ArgentoII.png',
  'Argento I':    '/leagues/ArgentoI.png',
  'Oro III':      '/leagues/OroIII.png',
  'Oro II':       '/leagues/OroII.png',
  'Oro I':        '/leagues/OroI.png',
  'Cristallo III':'/leagues/CristalloIII.png',
  'Cristallo II': '/leagues/CristalloII.png',
  'Cristallo I':  '/leagues/CristalloI.png',
  'Maestro III':  '/leagues/MaestroIII.png',
  'Maestro II':   '/leagues/MaestroII.png',
  'Maestro I':    '/leagues/MaestroI.png',
  'Campione III': '/leagues/CampioneIII.png',
  'Campione II':  '/leagues/CampioneII.png',
  'Campione I':   '/leagues/CampioneI.png',
  'Titano III':   '/leagues/TitanoIII.png',
  'Titano II':    '/leagues/TitanoII.png',
  'Titano I':     '/leagues/TitanoI.png',
  'Leggenda':     '/leagues/Leggenda.png',
};
// Fallback emoji (usato se img non carica)
const LEAGUE_ICON = {
  'Bronzo III':'🥉','Bronzo II':'🥉','Bronzo I':'🥉',
  'Argento III':'🔘','Argento II':'🔘','Argento I':'🔘',
  'Oro III':'🥇','Oro II':'🥇','Oro I':'🥇',
  'Cristallo III':'🔮','Cristallo II':'🔮','Cristallo I':'🔮',
  'Maestro III':'🏅','Maestro II':'🏅','Maestro I':'🏅',
  'Campione III':'🏆','Campione II':'🏆','Campione I':'🏆',
  'Titano III':'💎','Titano II':'💎','Titano I':'💎',
  'Leggenda':'👑'
};
const LEAGUE_COLOR = {
  'Bronzo III':'#cd7f32','Bronzo II':'#cd7f32','Bronzo I':'#cd7f32',
  'Argento III':'#a8b8c8','Argento II':'#a8b8c8','Argento I':'#a8b8c8',
  'Oro III':'#f0a500','Oro II':'#f0a500','Oro I':'#f0a500',
  'Cristallo III':'#5b9de0','Cristallo II':'#5b9de0','Cristallo I':'#7aaccc',
  'Maestro III':'#9b59b6','Maestro II':'#9b59b6','Maestro I':'#b07ccc',
  'Campione III':'#e74c3c','Campione II':'#e74c3c','Campione I':'#ff6060',
  'Titano III':'#ff8c00','Titano II':'#ff8c00','Titano I':'#ffaa00',
  'Leggenda':'#f0d060'
};

// Nomi mesi in italiano
const MONTH_IT = ['', 'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function seasonLabel(season) {
  // season = 'YYYY-MM'
  const [y, m] = season.split('-');
  return `Stagione di ${MONTH_IT[+m] || season} ${y}`;
}

// Aggiorna il messaggio di stato nella barra di caricamento CWL
function _cwlStatus(msg, isError) {
  const msgEl = document.getElementById('cwl-load-msg');
  const el = msgEl || document.getElementById('cwl-api-loading');
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-3)';
  }
}

// ── Carica e renderizza ──────────────────────────────────────────────────────
async function loadCwlSeasons() {
  const div = document.getElementById('cwl-seasons-list');
  div.innerHTML = `<div id="cwl-api-loading" class="cwl-loading-bar">
    <span class="cwl-loading-spinner">⏳</span>
    <span id="cwl-load-msg">Connessione…</span>
    <span id="cwl-load-timer" style="margin-left:0.5rem;font-variant-numeric:tabular-nums"></span>
  </div>`;

  // Timer visibile
  let elapsed = 0;
  const timerInterval = setInterval(() => {
    elapsed++;
    const el = document.getElementById('cwl-load-timer');
    if (el) el.textContent = `${elapsed}s`;
  }, 1000);

  // Lancia in parallelo: Supabase + war-log (storico CWL) + cwl-stats (stagione corrente) + clan-info (banner)
  const [dbResult, warLogResult, cwlResult, clanResult] = await Promise.allSettled([
    db.from('cwl_seasons').select('*').eq('clan_tag', window._userClanTag || '').order('season', { ascending: false }),
    fetch(`/api/war-log${clanQ()}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/cwl-stats${clanQ()}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/clan-info${clanQ()}`).then(r => r.ok ? r.json() : null)
  ]);

  clearInterval(timerInterval);
  document.getElementById('cwl-api-loading')?.remove();

  // ── Banner lega corrente ──────────────────────────────────────────────────
  const clanInfo       = clanResult.status === 'fulfilled' ? clanResult.value : null;
  const cwlData        = cwlResult.status  === 'fulfilled' ? cwlResult.value  : null;
  const leagueEnBanner = cwlData?.leagueNameEn || clanInfo?.warLeague?.name || null;
  const leagueItBanner = leagueEnBanner ? (LEAGUE_EN_TO_IT[leagueEnBanner] || leagueEnBanner) : null;
  const banner = document.getElementById('cwl-current-league-banner');
  if (banner && leagueItBanner) {
    const color    = LEAGUE_COLOR[leagueItBanner] || 'var(--gold)';
    const badgeUrl = LEAGUE_BADGE[leagueItBanner] || null;
    const isLive = cwlData && cwlData.state !== 'notInWar' && cwlData.state !== 'ended';
    const fallbackIcon = LEAGUE_ICON[leagueItBanner] || '🏆';
    const bannerImg = badgeUrl
      ? `<img src="${badgeUrl}" class="cwl-league-img" alt="${leagueItBanner}" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='')"><span class="cwl-league-fallback" style="display:none;font-size:1.4rem">${fallbackIcon}</span>`
      : `<span style="font-size:1.4rem">${fallbackIcon}</span>`;
    banner.innerHTML = `
      <span class="cwl-banner-label">Lega attuale</span>
      <span class="cwl-banner-league" style="color:${color}">${bannerImg} ${leagueItBanner}</span>
      ${isLive ? '<span class="cwl-live-dot-sm"></span><span style="font-size:0.72rem;color:#4caf50;font-weight:700">CWL IN CORSO</span>' : ''}`;
    banner.style.borderColor = color;
    banner.style.display = 'flex';
  }

  // ── Dati Supabase (posizione + lega salvate automaticamente) ──────────────
  const dbRaw = dbResult.status === 'fulfilled' ? dbResult.value : { data: null, error: null };
  const dbMap = {};
  let cwlSeasonsTableMissing = false;
  if (dbRaw.error?.code === '42P01') cwlSeasonsTableMissing = true;
  (dbRaw.data || []).forEach(s => { dbMap[s.season] = s; });

  // ── War-log: aggrega guerre CWL per stagione (stelle + distruzione) ───────
  // NOTA: destruction nel gioco = sum(war.destructionPercentage) × teamSize
  // Esempio: 638.9 × 15 = 9583 (il valore mostrato nel gioco CoC)
  const warSeasonMap = {};
  const warSeasonRoundsMap = {}; // season → array di round (per il modal dettaglio)
  const warLogData = warLogResult.status === 'fulfilled' ? warLogResult.value : null;
  if (warLogData && !warLogData.reason) {
    (warLogData.items || []).filter(w => {
      const wt = (w.warType || '').toLowerCase();
      const maxStars = (w.teamSize || 50) * 3;
      const isAggregated = (w.clan?.stars || 0) > maxStars;
      return (wt === 'cwl' || !w.opponent?.name || isAggregated) && w.endTime;
    }).forEach(w => {
      // Estrae stagione da endTime: "20250315T000000.000Z" → "2025-03"
      const s = w.endTime.slice(0, 4) + '-' + w.endTime.slice(4, 6);
      if (!warSeasonMap[s]) warSeasonMap[s] = { wins: 0, losses: 0, draws: 0, totalStars: 0, totalDestr: 0, teamSize: 0, warCount: 0 };
      const ws = warSeasonMap[s];
      ws.warCount++;
      ws.teamSize = ws.teamSize || w.teamSize || 15;
      if (w.result === 'win') ws.wins++;
      else if (w.result === 'lose') ws.losses++;
      else ws.draws++;
      ws.totalStars += w.clan?.stars || 0;
      ws.totalDestr += w.clan?.destructionPercentage || 0;
      // Accumula dati per-turno (usati nel modal dettaglio stagione)
      if (!warSeasonRoundsMap[s]) warSeasonRoundsMap[s] = [];
      warSeasonRoundsMap[s].push({
        endTime:          w.endTime,
        result:           w.result,
        teamSize:         w.teamSize || 15,
        attacksPerMember: w.attacksPerMember || 1,
        clan: {
          stars:       w.clan?.stars || 0,
          destruction: +(w.clan?.destructionPercentage || 0).toFixed(2),
          attacksUsed: w.clan?.attacks || 0
        },
        opponent: {
          name:        w.opponent?.name || 'Sconosciuto',
          tag:         w.opponent?.tag,
          badgeUrls:   w.opponent?.badgeUrls,
          stars:       w.opponent?.stars || 0,
          destruction: +(w.opponent?.destructionPercentage || 0).toFixed(2),
          attacksUsed: w.opponent?.attacks || 0
        }
      });
    });
    // Ordina i turni di ogni stagione in ordine cronologico
    Object.keys(warSeasonRoundsMap).forEach(s => {
      warSeasonRoundsMap[s].sort((a, b) => a.endTime.localeCompare(b.endTime));
      warSeasonRoundsMap[s].forEach((r, i) => { r.roundNumber = i + 1; });
    });
  }

  // ── Stagione corrente/live da cwl-stats ───────────────────────────────────
  if (cwlData && cwlData.state !== 'notInWar' && cwlData.season) {
    const key      = cwlData.season;
    const ourGroup = (cwlData.groupStandings || []).find(c => c.tag === window._userClanTag);
    dbMap[key] = {
      season:         key,
      league:         cwlData.leagueNameIt          || dbMap[key]?.league      || null,
      position:       cwlData.ourPosition            || dbMap[key]?.position    || null,
      stars:          ourGroup?.stars                ?? dbMap[key]?.stars       ?? warSeasonMap[key]?.totalStars ?? null,
      // destruction live = totalDestr × teamSize (stesso formato del gioco)
      destruction:    ourGroup?.warCount
                        ? Math.round(ourGroup.totalDestr * (cwlData.teamSize || 15))
                        : (dbMap[key]?.destruction ?? null),
      attacks:        dbMap[key]?.attacks            ?? null,
      wins:           warSeasonMap[key]?.wins        ?? null,
      losses:         warSeasonMap[key]?.losses      ?? null,
      isLive:         cwlData.state !== 'ended',
      groupStandings: cwlData.groupStandings         || null,
      roundsData:     cwlData.roundsData             || null
    };
    // Sostituisce i dati war-log per la stagione live con quelli più dettagliati da cwl-stats
    if (cwlData.roundsData?.length) warSeasonRoundsMap[key] = cwlData.roundsData;
  }

  // Salva globalmente per accesso dal modal dettaglio stagione
  window._cwlSeasonRoundsMap = warSeasonRoundsMap;

  // ── Merge: unifica DB + war-log ───────────────────────────────────────────
  const allSeasons = new Set([...Object.keys(dbMap), ...Object.keys(warSeasonMap)]);
  const merged = [];
  allSeasons.forEach(s => {
    const d  = dbMap[s]       || {};
    const wl = warSeasonMap[s] || {};
    merged.push({
      season:         s,
      league:         d.league      || null,
      position:       d.position    || null,
      stars:          d.stars       ?? (wl.warCount ? wl.totalStars : null),
      destruction:    d.destruction ?? (wl.warCount ? Math.round(wl.totalDestr * (wl.teamSize || 15)) : null),
      attacks:        d.attacks     ?? null,
      wins:           d.wins        ?? wl.wins    ?? null,
      losses:         d.losses      ?? wl.losses  ?? null,
      isLive:         d.isLive      || false,
      groupStandings: d.groupStandings || null,
      hasRounds:      !!(warSeasonRoundsMap[s]?.length)
    });
  });
  merged.sort((a, b) => b.season.localeCompare(a.season));

  window._cwlMergedSeasons = merged;
  renderCwlSeasons(merged, cwlSeasonsTableMissing);
}

function renderCwlSeasons(seasons, tablesMissing) {
  const div = document.getElementById('cwl-seasons-list');

  if (!seasons.length) {
    if (tablesMissing) {
      div.innerHTML = `<div class="cwl-empty">
        <span style="font-size:2rem">🗄️</span>
        <p style="color:var(--gold)">Tabella <code>cwl_seasons</code> non trovata su Supabase.</p>
        <p style="font-size:0.83rem;color:#5a7a98">Crea la tabella nel SQL Editor di Supabase:</p>
        <pre class="sql-hint">CREATE TABLE IF NOT EXISTS cwl_seasons (
  season TEXT PRIMARY KEY,
  league TEXT,
  position INTEGER,
  stars INTEGER,
  destruction NUMERIC(6,2),
  attacks INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cwl_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cwl_seasons_read"  ON cwl_seasons FOR SELECT USING (true);
CREATE POLICY "cwl_seasons_write" ON cwl_seasons FOR ALL TO authenticated USING (true) WITH CHECK (true);</pre>
      </div>`;
    } else {
      div.innerHTML = '<div class="cwl-empty"><span style="font-size:2rem">⚔️</span><p>Nessuna stagione CWL registrata.</p><p style="font-size:0.83rem;color:#5a7a98">I dati vengono salvati automaticamente al termine di ogni CWL.</p></div>';
    }
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
    html += `<div class="cwl-year-group"><div class="cwl-year-label">${year}</div>`;
    byYear[year].forEach(s => {
      const pos         = s.position ? +s.position : null;
      const posLabel    = pos ? (POS_LABELS[pos] || `${pos}°`) : null;
      const posColor    = pos ? (POS_COLORS[pos] || '#5a7a98') : '#5a7a98';
      const posMedal    = pos ? (POS_MEDALS[pos] || `${pos}°`) : null;
      const league      = s.league || null;
      const badgeUrl    = league ? (LEAGUE_BADGE[league] || null) : null;
      const leagueColor = league ? (LEAGUE_COLOR[league] || 'var(--gold)') : 'var(--border)';
      const stars       = s.stars != null ? s.stars : null;
      // destruction è un numero intero (come nel gioco CoC), non una percentuale
      const destr       = s.destruction != null ? Math.round(+s.destruction) : null;
      const attacks     = s.attacks != null ? s.attacks : null;
      const liveBadge   = s.isLive
        ? `<span class="cwl-live-badge-sm">🟢 LIVE</span>` : '';

      // Classifica gruppo (se disponibile — stagione live)
      let groupHtml = '';
      if (s.groupStandings?.length) {
        groupHtml = `<div class="cwl-group-standings">
          <div class="cwl-group-title">Classifica gruppo</div>
          ${s.groupStandings.map((c, i) => {
            const isMyClan = c.tag === window._userClanTag;
            const rankMedal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
            return `<div class="cwl-group-row${isMyClan ? ' cwl-group-row--us' : ''}">
              <span class="cwl-group-rank">${rankMedal}</span>
              <span class="cwl-group-name">${isMyClan ? `<strong>${c.name}</strong>` : c.name}</span>
              <span class="cwl-group-stars">⭐ ${c.stars}</span>
              <span class="cwl-group-destr">💥 ${c.warCount ? (c.totalDestr/c.warCount).toFixed(0) : 0}%</span>
            </div>`;
          }).join('')}
        </div>`;
      }

      html += `
      <div class="cwl-season-card${s.hasRounds ? ' cwl-season-card--clickable' : ''}" data-season="${s.season}" style="border-left-color:${leagueColor}"${s.hasRounds ? ` onclick="openCwlSeasonDetail('${s.season}')" title="Clicca per vedere i turni"` : ''}>
        <div class="cwl-card-left">
          <div class="cwl-card-month">${seasonLabel(s.season)} ${liveBadge}</div>
          <div class="cwl-card-league">
            ${badgeUrl
              ? `<img src="${badgeUrl}" class="cwl-league-img" alt="${league}" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='')"><span style="display:none;font-size:1.1rem">${LEAGUE_ICON[league] || '🏆'}</span>`
              : (league ? `<span style="font-size:1.1rem">${LEAGUE_ICON[league] || '🏆'}</span>` : '')}
            <span class="cwl-league-name" style="color:${leagueColor}">${league || '<span style="color:var(--text-3);font-style:italic">—</span>'}</span>
          </div>
        </div>
        <div class="cwl-card-mid">
          ${pos
            ? `<div class="cwl-pos-medal">${posMedal}</div>
               <div class="cwl-pos-badge" style="color:${posColor}">${posLabel}</div>`
            : `<div class="cwl-pos-unknown">—</div><div class="cwl-pos-sub">in attesa</div>`}
        </div>
        <div class="cwl-card-right">
          <div class="cwl-card-stats">
            <div class="cwl-stat-item">
              <span class="cwl-stat-val">${stars != null ? '⭐ '+stars : '—'}</span>
              <span class="cwl-stat-lbl">Stelle</span>
            </div>
            <div class="cwl-stat-item">
              <span class="cwl-stat-val">${destr != null ? '💥 '+destr : '—'}</span>
              <span class="cwl-stat-lbl">Distruz.</span>
            </div>
            ${attacks != null ? `<div class="cwl-stat-item"><span class="cwl-stat-val">⚔️ ${attacks}</span><span class="cwl-stat-lbl">Attacchi</span></div>` : ''}
          </div>
        </div>
        ${groupHtml}
        ${s.hasRounds ? `<div class="cwl-card-detail-hint">⚔ Vedi turni →</div>` : ''}
      </div>`;
    });
    html += '</div>';
  });

  div.innerHTML = html;
}

// ── Modal Dettaglio Stagione CWL ──────────────────────────────────────────────

function openCwlSeasonDetail(season) {
  const rounds = (window._cwlSeasonRoundsMap || {})[season] || [];
  if (!rounds.length) return;

  // Recupera la season card per gruppoStandings e meta info
  const card = document.querySelector(`.cwl-season-card[data-season="${season}"]`);
  const league   = card?.dataset?.league  || null;
  const position = card?.dataset?.pos     || null;

  // Cerca groupStandings dalla stagione (se live)
  let groupStandings = null;
  const allMerged = window._cwlMergedSeasons || [];
  const seasonObj  = allMerged.find(s => s.season === season);
  if (seasonObj?.groupStandings) groupStandings = seasonObj.groupStandings;

  _renderCwlDetailModal(season, rounds, groupStandings, seasonObj);
}

function _renderCwlDetailModal(season, rounds, groupStandings, seasonObj) {
  // Rimuove modal esistente
  document.getElementById('cwl-detail-modal')?.remove();

  const league   = seasonObj?.league   || null;
  const position = seasonObj?.position || null;
  const isLive   = seasonObj?.isLive   || false;
  const badgeUrl = league ? (LEAGUE_BADGE[league] || null) : null;
  const leagueColor = league ? (LEAGUE_COLOR[league] || 'var(--gold)') : 'var(--gold)';
  const posMedal = position ? (POS_MEDALS[+position] || `${position}°`) : null;
  const posLabel = position ? (POS_LABELS[+position]  || `${position}°`) : null;

  // ── Normalizza sempre a 7 slot (turni 1-7) ──
  // Per stagioni live: padda i round mancanti con placeholder "Da giocare"
  // Per stagioni storiche (dati aggregati war-log): mostra round disponibili as-is
  const hasDetailedData = rounds.some(r => r.defenderMap != null || r.clan?.members?.length);
  const TOTAL_ROUNDS = 7;
  let roundSlots;
  if (isLive || hasDetailedData) {
    // Stagione live o con dati dettagliati: forza 7 slot
    roundSlots = [];
    for (let i = 1; i <= TOTAL_ROUNDS; i++) {
      const found = rounds.find(r => (r.roundNumber || 0) === i);
      roundSlots.push(found || { roundNumber: i, upcoming: true });
    }
  } else {
    // Stagione storica da war-log: mostra i dati disponibili (max 7)
    roundSlots = rounds.slice(0, TOTAL_ROUNDS);
  }

  // ── Group Standings ──
  let standingsHtml = '';
  if (groupStandings?.length) {
    standingsHtml = `
    <div class="cdm-standings">
      <div class="cdm-section-title">Classifica gruppo</div>
      <div class="cdm-standings-list">
        ${groupStandings.map((c, i) => {
          const isUs = c.tag === window._userClanTag;
          const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
          const clBadge = c.badgeUrls?.small ? `<img src="${c.badgeUrls.small}" class="cdm-clan-badge" alt="">` : '<span class="cdm-clan-badge-ph">🛡️</span>';
          return `<div class="cdm-standing-row${isUs ? ' cdm-standing-row--us' : ''}">
            <span class="cdm-rank">${medal}</span>
            ${clBadge}
            <span class="cdm-clan-name${isUs ? ' cdm-clan-name--us' : ''}">${c.name}</span>
            <span class="cdm-clan-stars">⭐ ${c.stars}</span>
            <span class="cdm-clan-destr">💥 ${c.warCount ? (c.totalDestr/c.warCount).toFixed(1)+'%' : '—'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // ── Round Tabs ──
  const RESULT_ICON = { win:'🟢', lose:'🔴', draw:'🟡', ongoing:'🔵', preparation:'⚪', upcoming:'⬜' };
  const roundTabsHtml = roundSlots.map((r, i) => {
    const icon = r.upcoming ? '⬜' : (RESULT_ICON[r.result] || '⚪');
    const tabClass = `cdm-round-tab${i === 0 ? ' active' : ''}${r.upcoming ? ' cdm-round-tab--upcoming' : ''}`;
    return `<button class="${tabClass}" onclick="_cwlSelectRound(${i})" id="cdm-tab-${i}">${icon} T${r.roundNumber || i+1}</button>`;
  }).join('');

  // ── Singolo turno HTML ──
  function renderRound(r, idx) {
    // Placeholder per round non ancora disputati
    if (r.upcoming) {
      return `<div class="cdm-round-panel cdm-round-upcoming" id="cdm-round-${idx}">
        <div class="cdm-upcoming-msg">
          <div class="cdm-upcoming-icon">⚔</div>
          <div class="cdm-upcoming-label">Turno ${r.roundNumber} — Da giocare</div>
          <div class="cdm-upcoming-sub">Questo turno non è ancora stato disputato</div>
        </div>
      </div>`;
    }

    const RESULT_LABEL = { win:'VITTORIA', lose:'SCONFITTA', draw:'PAREGGIO', ongoing:'IN CORSO', preparation:'PREPARAZIONE' };
    const RESULT_CLASS = { win:'cdm-result--win', lose:'cdm-result--lose', draw:'cdm-result--draw', ongoing:'cdm-result--ongoing', preparation:'cdm-result--prep' };
    const resLabel = RESULT_LABEL[r.result] || '';
    const resClass = RESULT_CLASS[r.result] || '';
    const oppBadge = r.opponent?.badgeUrls?.small
      ? `<img src="${r.opponent.badgeUrls.small}" class="cdm-war-badge" alt="">`
      : '<span class="cdm-war-badge-ph">🛡️</span>';
    const ourBadge = r.clan?.badgeUrls?.small
      ? `<img src="${r.clan.badgeUrls.small}" class="cdm-war-badge" alt="">`
      : '<span class="cdm-war-badge-ph">🛡️</span>';

    const fmtDestr = (v) => v != null ? v.toFixed(1) + '%' : '—';
    const totalAtks = (r.teamSize || 15) * (r.attacksPerMember || 1);

    // Tabella attacchi (solo se dati dettagliati disponibili)
    let attacksHtml = '';
    if (r.clan?.members?.length) {
      const defMap = r.defenderMap || {};
      const thImg = (lv) => lv ? `<img src="/th/level_${lv}.png" class="cdm-th-icon" alt="TH${lv}" onerror="this.style.display='none'">` : '';
      const attackRows = [];
      r.clan.members.forEach(m => {
        m.attacks.forEach(a => {
          const def = defMap[a.defenderTag] || { name: a.defenderTag, thLevel: null };
          const stars = '⭐'.repeat(a.stars) + '☆'.repeat(3 - a.stars);
          attackRows.push(`<tr>
            <td class="cdm-atk-player">${thImg(m.thLevel)}<span>${m.name}</span></td>
            <td class="cdm-atk-arrow">→</td>
            <td class="cdm-atk-player">${thImg(def.thLevel)}<span>${def.name}</span></td>
            <td class="cdm-atk-stars">${stars}</td>
            <td class="cdm-atk-destr">${a.destruction.toFixed(1)}%</td>
          </tr>`);
        });
        const missing = (r.attacksPerMember || 1) - m.attacks.length;
        for (let x = 0; x < missing; x++) {
          attackRows.push(`<tr class="cdm-atk-missed">
            <td class="cdm-atk-player">${thImg(m.thLevel)}<span>${m.name}</span></td>
            <td class="cdm-atk-arrow">→</td>
            <td class="cdm-atk-player"><span style="color:var(--text-3)">—</span></td>
            <td colspan="2" style="color:var(--text-3);font-size:0.8rem">non attaccato</td>
          </tr>`);
        }
      });
      if (attackRows.length) {
        attacksHtml = `
        <div class="cdm-attacks-section">
          <div class="cdm-section-title">Attacchi ${window._clanName || 'del tuo clan'}</div>
          <div class="cdm-attacks-scroll">
            <table class="cdm-attacks-table">
              <thead><tr>
                <th>Attaccante</th><th></th><th>Difensore</th><th>⭐</th><th>💥</th>
              </tr></thead>
              <tbody>${attackRows.join('')}</tbody>
            </table>
          </div>
        </div>`;
      }
    }

    return `<div class="cdm-round-panel" id="cdm-round-${idx}">
      <div class="cdm-war-header">
        <div class="cdm-war-side cdm-war-side--us">
          ${ourBadge}
          <div class="cdm-war-clan-name">${window._clanName || 'Il tuo Clan'}</div>
          <div class="cdm-war-stars">⭐ ${r.clan?.stars ?? '—'}</div>
          <div class="cdm-war-destr">💥 ${fmtDestr(r.clan?.destruction)}</div>
          <div class="cdm-war-attacks">⚔ ${r.clan?.attacksUsed ?? '—'}/${totalAtks}</div>
        </div>
        <div class="cdm-war-vs">
          <div class="cdm-war-result ${resClass}">${resLabel}</div>
          <div class="cdm-war-vs-label">VS</div>
        </div>
        <div class="cdm-war-side cdm-war-side--opp">
          ${oppBadge}
          <div class="cdm-war-clan-name">${r.opponent?.name || '—'}</div>
          <div class="cdm-war-stars">⭐ ${r.opponent?.stars ?? '—'}</div>
          <div class="cdm-war-destr">💥 ${fmtDestr(r.opponent?.destruction)}</div>
          <div class="cdm-war-attacks">⚔ ${r.opponent?.attacksUsed ?? '—'}/${totalAtks}</div>
        </div>
      </div>
      ${attacksHtml}
    </div>`;
  }

  const roundPanelsHtml = roundSlots.map((r, i) =>
    `<div style="display:${i===0?'block':'none'}" id="cdm-rpanel-${i}">${renderRound(r, i)}</div>`
  ).join('');

  const leagueBadgeHtml = badgeUrl
    ? `<img src="${badgeUrl}" class="cdm-header-badge" alt="${league||''}">`
    : '';

  const modal = document.createElement('div');
  modal.id = 'cwl-detail-modal';
  modal.className = 'cdm-overlay';
  modal.innerHTML = `
    <div class="cdm-box" onclick="event.stopPropagation()">
      <div class="cdm-header">
        <div class="cdm-header-left">
          ${leagueBadgeHtml}
          <div>
            <div class="cdm-header-season">${seasonLabel(season)}${isLive ? ' <span class="cwl-live-badge-sm">🟢 LIVE</span>' : ''}</div>
            ${league ? `<div class="cdm-header-league" style="color:${leagueColor}">${league}</div>` : ''}
            ${posMedal ? `<div class="cdm-header-pos">${posMedal} ${posLabel}</div>` : ''}
          </div>
        </div>
        <button class="cdm-close" onclick="closeCwlSeasonDetail()">✕</button>
      </div>
      ${standingsHtml}
      <div class="cdm-section-title" style="margin-top:1rem">Turni</div>
      <div class="cdm-round-tabs">${roundTabsHtml}</div>
      <div class="cdm-round-content">${roundPanelsHtml}</div>
    </div>`;

  modal.addEventListener('click', closeCwlSeasonDetail);
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('cdm-overlay--visible'));
}

function _cwlSelectRound(idx) {
  document.querySelectorAll('.cdm-round-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('[id^="cdm-rpanel-"]').forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none'; });
}

function closeCwlSeasonDetail() {
  const modal = document.getElementById('cwl-detail-modal');
  if (!modal) return;
  modal.classList.remove('cdm-overlay--visible');
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
}


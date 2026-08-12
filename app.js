// ═══════════════════════════════════════════════════════════════════════════════
// app.js — CoCBoard SPA  |  Fear United IT
// ═══════════════════════════════════════════════════════════════════════════════
// INDICE SEZIONI (Ctrl+F sul nome per navigare):
//
//   AUTH                    ~43     Login, logout, registrazione, recupero password
//   NAVIGATION              ~482    Routing tra sezioni SPA
//   CLAN                    ~240    Dettagli clan espandibili
//   MEMBRI                  ~529    Lista e sync membri
//   CWL                     ~685    Storico CWL, tabelle, live data
//   ASSEGNA BONUS           ~815    Tab assegnazione bonus mensile
//   STORICO ASSEGNAZIONI    ~1334   Vista storico per giocatore/mese
//   HALL OF FAME            ~1518   Classifica storica bonus
//   BONUS MODAL             ~1630   Modal Bonus Manager (calcolo merito)
//   ALIAS PLAYER            ~1806   Gestione alias/cambi nome
//   ADMIN UTENTI            ~2240   CRUD utenti (solo admin)
//   REGISTRI GUERRE         ~2413   War log classiche + dettaglio modal
//   CRONOLOGIA LEGHE CWL    ~2718   Storico stagioni CWL
//   IL MIO PROFILO          ~3329   Profilo personale + unità
//   CERCA                   ~3898   Ricerca clan/giocatori
//
// ═══════════════════════════════════════════════════════════════════════════════

const db = window.sb;

// ── Handoff da bot Telegram (Mini App): codice monouso → sessione ─────────────
(function readCwlRoundFromQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    const cr = p.get('cwl_round');
    if (cr != null && cr !== '') {
      const n = parseInt(cr, 10);
      if (n >= 1 && n <= 7) window.__cocboardOpenCwlRound = n;
    }
  } catch (_) {}
})();
(function readOpenTabFromQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    const ot = p.get('open_tab');
    const allowed = new Set(['members', 'cerca', 'cwl', 'cwl_warlog', 'login', 'warlog', 'profilo', 'rankings', 'bonus', 'botadmin']);
    const clanFromQ = p.get('clan_tag') || p.get('clanTag');
    if (clanFromQ && String(clanFromQ).trim()) {
      let t = String(clanFromQ).trim().toUpperCase();
      if (!t.startsWith('#')) t = '#' + t.replace(/^#+/, '');
      window.__cocboardForcedClanTag = t;
      window.__cocboardGuestClanTag = t;
    }
    if (allowed.has(ot)) {
      window.__cocboardOpenTab = ot;
    } else {
      // Direct App Link da gruppi Telegram: start_param può essere "TAB" o "TAB__CLANTAG"
      const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      if (sp) {
        const parts = sp.split('__');
        const tab = parts[0];
        const rawTag = parts[1] || '';
        if (allowed.has(tab)) window.__cocboardOpenTab = tab;
        if (rawTag) {
          window.__cocboardGuestClanTag = `#${rawTag}`;
          window.__cocboardForcedClanTag = `#${rawTag}`;
        }
      }
    }
  } catch (_) {}
})();
// Handoff tg_h: vedi cocboardTelegramHandoffBootstrap() dopo registrazione onAuthStateChange (await prima del login).

// Clan dell'utente loggato — impostati in showApp() dopo il login
window._userClanTag    = null;  // es. '#2J2VLPP9R'
window._clanName       = '';
window._clanBadgeUrl   = null;
window._userIsTelegramModerator = false;
window._userBotAdminFull = false;

// Fetch con JWT dell'utente corrente — usare per endpoint protetti (admin, import)
async function authFetch(url, options = {}) {
  const session = (await db.auth.getSession())?.data?.session;
  const token = session?.access_token;
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
}

// Restituisce '?clanTag=XXXX' da aggiungere alle fetch API
function clanQ() {
  const tag = window.__cocboardForcedClanTag || window._userClanTag;
  return tag
    ? `?clanTag=${encodeURIComponent(tag)}`
    : '';
}

/** Tag clan per confronti sicuri (stesso formato del proxy) */
function normClanTag(t) {
  if (!t) return '';
  const s = String(t).trim().toUpperCase();
  return s.startsWith('#') ? s : '#' + s;
}

/** URL stemma clan API (small → medium → large) */
function cocBadgeUrl(bu) {
  if (!bu) return '';
  return bu.small || bu.medium || bu.large || '';
}

/**
 * Stemma lega giocatore: priorità iconUrls CoC API (sempre allineati al gioco), poi PNG locale, poi "—".
 * `opts.imgClass` per header profilo / cerca (default league-badge-sm).
 */
function rankLeagueBadgeHtml(league, opts) {
  if (!league) return '<span class="no-league-badge">—</span>';
  const nameEn = league.name || '';
  const imgClass = (opts && opts.imgClass) || 'league-badge-sm';
  const titleEsc = nameEn.replace(/"/g, '&quot;').replace(/</g, '');
  const apiUrl = league.iconUrls && (league.iconUrls.large || league.iconUrls.medium || league.iconUrls.small);
  const localFile = LEAGUE_BADGE_MAP[nameEn] || LEAGUE_BADGE_MAP[nameEn.replace(/\s+\d+$/, '')];
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

function _rankLeagueImgErr(img) {
  const fb = img.getAttribute('data-league-fb');
  if (fb && !img.dataset.leagueFbTried) {
    img.dataset.leagueFbTried = '1';
    img.removeAttribute('data-league-fb');
    img.src = fb;
    img.onerror = function () { this.outerHTML = '<span class="no-league-badge">—</span>'; };
    return;
  }
  img.outerHTML = '<span class="no-league-badge">—</span>';
}

/** Lega da mostrare sul profilo: leagueTier (ranked) ha priorità su league legacy */
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

/** Lega nei record classifica CoC (stesso schema player: leagueTier + league) */
function _rankingPlayerLeague(p) {
  return _playerLeagueForBadge(p);
}

function _lookupApiError(data) {
  if (!data || typeof data !== 'object') return 'Errore API';
  if (data.error) return String(data.error);
  if (data.reason && data.message) return `${data.reason}: ${data.message}`;
  if (data.reason) return String(data.reason);
  return 'Errore API';
}

/** Profilo ridotto da tabella members (sync) se /player CoC non risponde (es. invalid IP) */
function _profileFromMemberRow(row, meta) {
  const tag = row.tag || '';
  const clanTag = meta?.coc_clan_tag || row.clan_tag || null;
  const clanName = meta?.coc_clan_name || row.clan_name || null;
  const badgeUrl = meta?.coc_clan_badge_url || null;
  return {
    name: row.name,
    tag,
    townHallLevel: row.th_level ?? null,
    trophies: row.trophies ?? null,
    donations: row.donations ?? null,
    donationsReceived: row.donations_received ?? null,
    expLevel: row.exp_level ?? null,
    role: row.role || null,
    league: row.league_name
      ? {
          name: row.league_name,
          iconUrls: row.league_icon_url
            ? { small: row.league_icon_url, medium: row.league_icon_url, large: row.league_icon_url }
            : undefined,
        }
      : null,
    clan: clanTag
      ? {
          tag: clanTag,
          name: clanName || 'Clan',
          badgeUrls: badgeUrl ? { small: badgeUrl, medium: badgeUrl } : {},
        }
      : null,
    heroes: [],
    troops: [],
    spells: [],
    heroEquipment: [],
    achievements: [],
    builderHallLevel: null,
    warStars: null,
    attackWins: null,
    defenseWins: null,
    clanCapitalContributions: null,
    builderBaseTrophies: null,
    builderBaseBestTrophies: null,
    _profileSource: 'roster',
  };
}

async function _fetchMemberRowForProfile(tag) {
  const norm = tag && String(tag).trim().toUpperCase().startsWith('#') ? String(tag).trim().toUpperCase() : '#' + String(tag || '').replace(/^#/, '').toUpperCase();
  const { data, error } = await db.from('members').select('*').eq('tag', norm).maybeSingle();
  if (error || !data) return null;
  return data;
}

/** URL CDN da nome (fallback se asset API non carica nel browser) */
function unitImgUrl(u, category) {
  if (!u) return getAssetUrl('', category);
  const coc = _cocUnitIconUrl(u);
  if (coc) return coc;
  const gh = getGhWidgetsUrl(u.name);
  if (gh) return gh;
  return getAssetUrl(u.name, category);
}

/** Icona CoC dall'API: large prima (spesso più stabile), poi medium/small */
function _cocUnitIconUrl(u) {
  if (!u?.iconUrls) return '';
  const i = u.iconUrls;
  return i.large || i.medium || i.small || '';
}

/**
 * Coppia src + fallback coc.guide per <img>: se l'asset Supercell fallisce (hotlink/referrer),
 * onerror prova il secondo URL.
 */
/**
 * Catena fallback immagini unità: opzionale file locale (units/) → mirror GitHub clash_widgets → coc.guide.
 * I path GitHub sono stabili (repo Zacatac3/clash_widgets, branch main).
 */
function _unitImgFallbackUrls(u, category) {
  const name = u?.name;
  const out = [];
  const loc = UNIT_LOCAL_IMAGE && UNIT_LOCAL_IMAGE[name];
  if (loc) {
    const p = String(loc).replace(/^\//, '');
    out.push(p.startsWith('http') ? p : p);
  }
  // UNIT_WIKI_URL è definita più sotto nel file: la funzione viene invocata solo a runtime,
  // quando tutto lo script è già stato valutato, quindi qui la mappa è già popolata.
  const wiki = UNIT_WIKI_URL[name];
  if (wiki) out.push(wiki);
  const gh = getGhWidgetsUrl(name);
  if (gh) out.push(gh);
  const guide = getCocGuideUrl(name, category);
  if (guide) out.push(guide);
  return out;
}

function _unitImgSrcPair(u, category) {
  const chain = _unitImgFallbackUrls(u, category);
  const coc = _cocUnitIconUrl(u);
  if (coc) {
    return { src: coc, fbChain: chain };
  }
  if (!chain.length) return { src: '', fbChain: [] };
  return { src: chain[0], fbChain: chain.slice(1) };
}

function _unitImgDataFbChainAttr(fbChain) {
  if (!fbChain || !fbChain.length) return '';
  try {
    const enc = encodeURIComponent(JSON.stringify(fbChain));
    return ` data-fb-chain="${enc.replace(/'/g, '&#39;')}"`;
  } catch (_) {
    return '';
  }
}

function _profiloUnitImgOnError(img) {
  const enc = img.getAttribute('data-fb-chain');
  if (enc) {
    try {
      const urls = JSON.parse(decodeURIComponent(enc));
      const i = parseInt(img.dataset.fbI || '0', 10);
      if (i < urls.length) {
        img.dataset.fbI = String(i + 1);
        img.src = urls[i];
        return;
      }
    } catch (_) {}
  }
  img.style.display = 'none';
  const nx = img.nextElementSibling;
  if (nx) nx.style.display = 'flex';
}

let _cwlHeroLvlCache = {};
function _sumHomeHeroLevels(p) {
  if (!p || !p.heroes) return null;
  return p.heroes.filter(h => h.village === 'home').reduce((s, h) => s + (h.level || 0), 0);
}
async function _getHeroLevelsSum(playerTag) {
  const k = playerTag;
  if (_cwlHeroLvlCache[k] !== undefined) return _cwlHeroLvlCache[k];
  try {
    const r = await fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(playerTag)}`);
    const p = await r.json();
    if (!r.ok) { _cwlHeroLvlCache[k] = null; return null; }
    const s = _sumHomeHeroLevels(p);
    _cwlHeroLvlCache[k] = s;
    return s;
  } catch (_) {
    _cwlHeroLvlCache[k] = null;
    return null;
  }
}

/** Data/ora CoC API `yyyyMMddTHHmmss.fffZ` → Date */
function parseCocApiTime(str) {
  if (!str || str.length < 14) return null;
  const y = str.slice(0, 4), mo = str.slice(4, 6), d = str.slice(6, 8);
  if (str.charAt(8) !== 'T') return null;
  const h = str.slice(9, 11), mi = str.slice(11, 13), sec = str.slice(13, 15);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`);
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

window.__cocboardAuthBootstrapping = true;

db.auth.onAuthStateChange((_event, session) => {
  if (window.__cocboardAuthBootstrapping) return;
  if (session) void showApp(session.user);
  else showLogin();
});

/** Mini App / link bot: scambia tg_h con JWT prima di mostrare login; open_tab già letto in window.__cocboardOpenTab. */
void (async function cocboardTelegramHandoffBootstrap() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('tg_h') || params.get('h');
    const tgProfile = params.get('tg_profile');
    if (code) {
      const r = await fetch(`/api/lookup?type=telegram-handoff&code=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.access_token && j.refresh_token) {
        await db.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
        if (tgProfile) window.__cocboardTgProfile = tgProfile;
        params.delete('tg_h');
        params.delete('h');
        params.delete('tg_profile');
        params.delete('cwl_round');
        params.delete('open_tab');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      } else {
        console.warn('[CoCBoard] Handoff Telegram:', j.error || r.status);
      }
    }
  } catch (e) {
    console.warn('[CoCBoard] Handoff Telegram', e);
  }
  const { data: { session } } = await db.auth.getSession();
  window.__cocboardAuthBootstrapping = false;
  if (session) {
    await showApp(session.user);
  } else {
    // Telegram Mini App con tab pubblico + clan tag noto: modalità ospite senza login
    // Nessuna config Supabase richiesta — usa utente guest fittizio (sola lettura)
    const isTgMiniApp = !!(window.Telegram?.WebApp?.initData);
    const guestTabs = new Set(['cwl_warlog', 'cwl', 'warlog', 'bonus', 'members', 'cerca', 'rankings']);
    if (isTgMiniApp && guestTabs.has(window.__cocboardOpenTab) && window.__cocboardGuestClanTag) {
      const guestUser = { id: null, is_anonymous: true, user_metadata: {}, app_metadata: {} };
      await showApp(guestUser);
      return;
    }
    showLogin();
  }
})();

// Converte "nomeutente" → "nomeutente@fearunited.internal" per login interni
function resolveLoginEmail(input) {
  const s = input.trim();
  if (s.includes('@')) return s;
  // Tag CoC (inizia con #): strip # e usa cocboard.internal
  if (s.startsWith('#')) return s.slice(1).toLowerCase() + '@cocboard.internal';
  // Username manuale: normalizza e usa cocboard.internal
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_') + '@cocboard.internal';
}

const COCSAVED_LOGIN_KEY = 'cocboard_saved_login_id';

function _prefillLoginSaved() {
  const saved = localStorage.getItem(COCSAVED_LOGIN_KEY);
  const emailEl = document.getElementById('email');
  const rememberCb = document.getElementById('login-remember');
  if (saved && emailEl) {
    emailEl.value = saved;
    if (rememberCb) rememberCb.checked = true;
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  // Evita che credenziali restino nella barra indirizzi (bookmark / GET accidentale)
  try {
    const u = new URL(window.location.href);
    let dirty = false;
    ['username', 'password', 'email', 'pwd', 'pass', 'passwd', 'user', 'login'].forEach((k) => {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
    });
    if (dirty) {
      const qs = u.searchParams.toString();
      history.replaceState({}, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
    }
  } catch (_) {}
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Caricamento…";
  try {
    const rawInput = document.getElementById("email").value;
    const remember = document.getElementById('login-remember')?.checked;
    if (remember) localStorage.setItem(COCSAVED_LOGIN_KEY, rawInput.trim());
    else localStorage.removeItem(COCSAVED_LOGIN_KEY);
    const email    = await resolveLoginEmailAsync(rawInput);
    const pwd = document.getElementById("password").value;
    let { error } = await db.auth.signInWithPassword({ email, password: pwd });
    if (error) {
      // Fallback: prova fearunited.internal per account legacy
      const fallback = email.replace('@cocboard.internal', '@fearunited.internal');
      if (fallback !== email) {
        const r2 = await db.auth.signInWithPassword({ email: fallback, password: pwd });
        if (!r2.error) return; // onAuthStateChange gestirà il resto
        // Entrambi i tentativi falliti — usa errore del fallback per maggiore contesto
        error = r2.error;
      }
      const msg = (error.message.includes('Invalid login') || error.message.includes('invalid'))
        ? 'Credenziali errate. Controlla il nome utente e la password.'
        : error.message;
      showLoginError(msg);
    }
  } catch (err) {
    showLoginError("Errore di connessione. Ricarica la pagina e riprova.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Accedi";
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
  if (section === 'recovery') {
    const req = document.getElementById('recovery-request-form');
    const conf = document.getElementById('recovery-confirm-form');
    const msg = document.getElementById('recovery-msg');
    if (req) req.style.display = 'flex';
    if (conf) conf.style.display = 'none';
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  }
}

document.getElementById('show-signup').addEventListener('click',   () => showSection('signup'));
document.getElementById('show-recovery').addEventListener('click', () => showSection('recovery'));
document.getElementById('show-login').addEventListener('click',    () => showSection('login'));

function showRecoveryMsg(text, type) {
  const el = document.getElementById('recovery-msg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = type === 'error' ? 'var(--red,#ef5350)' : 'var(--green,#4caf50)';
}

document.getElementById('recovery-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('recovery-request-btn');
  const username = document.getElementById('recovery-username')?.value?.trim() || '';
  if (!username) return showRecoveryMsg('Inserisci username, tag o email.', 'error');
  if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }
  try {
    const r = await fetch('/api/lookup?type=password-reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showRecoveryMsg(data.error || 'Richiesta non riuscita.', 'error');
      return;
    }
    window._recoveryUsername = username;
    const hint = document.getElementById('recovery-hint');
    if (hint) {
      hint.textContent = data.emailHint
        ? `Codice inviato a ${data.emailHint}. Inseriscilo sotto e scegli la nuova password.`
        : (data.message || 'Se l’account ha un’email, abbiamo inviato un codice.');
    }
    document.getElementById('recovery-request-form').style.display = 'none';
    const conf = document.getElementById('recovery-confirm-form');
    if (conf) conf.style.display = 'flex';
    showRecoveryMsg(data.message || 'Controlla la posta.', 'ok');
  } catch (_) {
    showRecoveryMsg('Errore di connessione. Riprova.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Invia codice via email'; }
  }
});

document.getElementById('recovery-confirm-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('recovery-confirm-btn');
  const username = window._recoveryUsername || document.getElementById('recovery-username')?.value?.trim() || '';
  const code = document.getElementById('recovery-code')?.value?.trim() || '';
  const p1 = document.getElementById('recovery-new-password')?.value || '';
  const p2 = document.getElementById('recovery-new-password2')?.value || '';
  if (p1.length < 6) return showRecoveryMsg('Password minimo 6 caratteri.', 'error');
  if (p1 !== p2) return showRecoveryMsg('Le due password non coincidono.', 'error');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    const r = await fetch('/api/lookup?type=password-reset-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, code, newPassword: p1 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showRecoveryMsg(data.error || 'Conferma non riuscita.', 'error');
      return;
    }
    showRecoveryMsg(data.message || 'Password aggiornata. Ora puoi accedere.', 'ok');
    setTimeout(() => {
      showSection('login');
      const emailEl = document.getElementById('email');
      if (emailEl && username) emailEl.value = username;
      showLoginError('Password aggiornata. Accedi con la nuova password.', 'info');
    }, 800);
  } catch (_) {
    showRecoveryMsg('Errore di connessione. Riprova.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Imposta nuova password'; }
  }
});

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
  // Reset flag di sessione multi-profilo: un nuovo login (anche senza reload pagina)
  // non deve ereditare la scelta profilo dell'utente precedente.
  window.__cocboardManualProfilePick = false;
  window.__cocboardDefaultApplied = false;
  window.__cocboardLandingTabApplied = false;
  _prefillLoginSaved();
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

// Mappa prefisso lega (da API leagueTier.name es. "Electro League 31") → nome italiano
// Il formato API è: "[Prefisso] [numero]"
const LEAGUE_TIER_PREFIX_IT = {
  'Skeleton League':    'Scheletro',
  'Barbarian League':   'Barbaro',
  'Archer League':      'Arciere',
  'Wizard League':      'Mago',
  'Valkyrie League':    'Valchiria',
  'Witch League':       'Strega',
  'Golem League':       'Golem',
  'P.E.K.K.A League':  'P.E.K.K.A.',
  'Electro Titan League':'Elettro Titano',
  'Dragon League':      'Drago',
  'Electro Dragon League':'Elettro Drago',
  'Electro League':     'Elettro',
  'Legend League':      'Leggenda',
};

// Mappa nome lega CWL guerra (clan warLeague) → file badge in /leagues/
const LEAGUE_BADGE_MAP = {
  'Bronze League III': 'BronzoIII', 'Bronze League II': 'BronzoII', 'Bronze League I': 'BronzoI',
  'Silver League III': 'ArgentoIII', 'Silver League II': 'ArgentoII', 'Silver League I': 'ArgentoI',
  'Gold League III':   'OroIII',     'Gold League II':   'OroII',     'Gold League I':   'OroI',
  'Crystal League III':'CristalloIII','Deep Crystal League III':'CristalloIII','Crystal League II':'CristalloII','Deep Crystal League II':'CristalloII','Crystal League I':'CristalloI','Deep Crystal League I':'CristalloI',
  'Master League III': 'MaestroIII', 'Master League II': 'MaestroII', 'Master League I': 'MaestroI',
  'Champion League III':'CampioneIII','Champion League II':'CampioneII','Champion League I':'CampioneI',
  'Titan League III':  'TitanoIII',  'Titan League II':  'TitanoII',  'Titan League I':  'TitanoI',
  'Legend League':     'LeggendaV2',
  // Leghe Ranked Battles — badge dedicati + prefisso base per nomi numerici (es. "Dragon League 5")
  'Unranked': 'Unranked',
  'Skeleton League III': 'Skeleton', 'Skeleton League II': 'Skeleton', 'Skeleton League I': 'Skeleton', 'Skeleton League': 'Skeleton',
  'Barbarian League III': 'Barbarian', 'Barbarian League II': 'Barbarian', 'Barbarian League I': 'Barbarian', 'Barbarian League': 'Barbarian',
  'Archer League III': 'Archer', 'Archer League II': 'Archer', 'Archer League I': 'Archer', 'Archer League': 'Archer',
  'Wizard League III': 'Wizard', 'Wizard League II': 'Wizard', 'Wizard League I': 'Wizard', 'Wizard League': 'Wizard',
  'Valkyrie League III': 'Valkyrie', 'Valkyrie League II': 'Valkyrie', 'Valkyrie League I': 'Valkyrie', 'Valkyrie League': 'Valkyrie',
  'Witch League III': 'Witch', 'Witch League II': 'Witch', 'Witch League I': 'Witch', 'Witch League': 'Witch',
  'Golem League III': 'Golem', 'Golem League II': 'Golem', 'Golem League I': 'Golem', 'Golem League': 'Golem',
  'P.E.K.K.A League III': 'PEKKA', 'P.E.K.K.A League II': 'PEKKA', 'P.E.K.K.A League I': 'PEKKA', 'P.E.K.K.A League': 'PEKKA',
  'Electro Titan League III': 'ElettroTitano', 'Electro Titan League II': 'ElettroTitano', 'Electro Titan League I': 'ElettroTitano', 'Electro Titan League': 'ElettroTitano',
  'Dragon League III': 'Drago', 'Dragon League II': 'Drago', 'Dragon League I': 'Drago', 'Dragon League': 'Drago',
  'Electro Dragon League III': 'ElectroDrago', 'Electro Dragon League II': 'ElectroDrago', 'Electro Dragon League I': 'ElectroDrago', 'Electro Dragon League': 'ElectroDrago',
};

// Converte leagueTier.name (es. "Electro League 31") in nome italiano (es. "Elettro #31")
function leagueTierNameIt(name) {
  if (!name) return null;
  const m = name.match(/^(.+?)\s+(\d+)$/);
  if (m) {
    const itPrefix = LEAGUE_TIER_PREFIX_IT[m[1]] || m[1];
    return `${itPrefix} #${m[2]}`;
  }
  return LEAGUE_TIER_PREFIX_IT[name] || name;
}

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

  const descRaw = (info.description && String(info.description).trim()) ? String(info.description).trim() : '';
  const descHtml = descRaw
    ? `<div class="clan-detail-desc-wrap"><div class="cc-desc clan-detail-desc">${descRaw.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div>`
    : '';

  div.innerHTML = `${descHtml}<div class="clan-detail-grid">
    ${leagueHtml}${locationHtml}${langHtml}${typeHtml}${trophiesHtml}${pointsHtml}${levelHtml}
  </div>`;
}

function showNoClanScreen(username) {
  // Non bloccare più l'app: gli utenti senza clan usano le sezioni pubbliche.
  const nc = document.getElementById("no-clan-screen");
  if (nc) nc.style.display = "none";
  continueWithoutClan();
}

function continueWithoutClan() {
  const nc = document.getElementById("no-clan-screen");
  if (nc) nc.style.display = "none";
  const app = document.getElementById("app");
  if (app) app.style.display = "flex";
  const banner = document.getElementById("no-clan-banner");
  if (banner) banner.style.display = "block";
  try {
    activateTab("profilo");
  } catch (_) {}
}

// ── Cambio password obbligatorio (dopo reset da pannello admin) ─────────────
function showForcePasswordChangeScreen(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "none";
  document.getElementById("no-clan-screen").style.display = "none";
  document.getElementById("force-password-screen").style.display = "flex";
  window._forcePasswordUser = user;
  const errEl = document.getElementById('force-password-error');
  if (errEl) errEl.style.display = 'none';
  const f1 = document.getElementById('force-password-new');
  const f2 = document.getElementById('force-password-confirm');
  if (f1) f1.value = '';
  if (f2) f2.value = '';
}

document.getElementById('force-password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('force-password-error');
  const newPw = document.getElementById('force-password-new').value;
  const confirmPw = document.getElementById('force-password-confirm').value;
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (newPw.length < 6) return showErr('La password deve avere almeno 6 caratteri.');
  if (newPw !== confirmPw) return showErr('Le due password non coincidono.');

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Salvataggio…';
  try {
    const { data, error } = await db.auth.updateUser({
      password: newPw,
      data: { must_change_password: false },
    });
    if (error) { showErr(error.message || 'Errore durante il salvataggio.'); return; }
    document.getElementById('force-password-screen').style.display = 'none';
    await showApp(data?.user || window._forcePasswordUser);
  } catch (err) {
    showErr('Errore di connessione. Riprova.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Salva e continua';
  }
});

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

function applyBotAdminStaffUi() {
  const full = window._userRole === 'admin';
  document.querySelectorAll('[data-botadmin-admin-only], .botadmin-admin-only-block').forEach((el) => {
    el.classList.toggle('botadmin-mod-hidden', !full);
  });
}

/** Applica sui globali UI il blocco `clan` restituito dall'API CoC (player o clan-info). */
function applyClanFromApiClanObject(clan) {
  if (!clan?.tag) return false;
  window._userClanTag = normClanTag(clan.tag);
  if (clan.name) window._clanName = clan.name;
  const bu = clan.badgeUrls;
  if (bu) {
    const url = cocBadgeUrl(bu);
    if (url) window._clanBadgeUrl = url;
  }
  return true;
}

/**
 * Risolve il clan live dal player CoC (preferito) così non resta il clan vecchio in metadata.
 * 1) lookup player da `coc_tag` (pubblico) → clan attuale
 * 2) roster `members` su Supabase se l'API CoC non risponde
 * 3) `/api/lookup?type=session-clan` (JWT)
 */
async function tryHydrateClanFromUserMetadata(user) {
  // Mini App da gruppo collegato: clan forzato dalla chat, non dal profilo attivo
  if (window.__cocboardForcedClanTag) {
    const forced = normClanTag(window.__cocboardForcedClanTag);
    window._userClanTag = forced;
    window._clanName = '';
    window._clanBadgeUrl = null;
    try {
      const r = await fetch(`/api/clan-info?clanTag=${encodeURIComponent(forced)}`);
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.tag) {
        applyClanFromApiClanObject(data);
        return;
      }
    } catch (_) {}
    return;
  }

  const meta = user?.user_metadata || {};
  const normPlayer = (raw) => {
    if (!raw || !String(raw).trim()) return null;
    let t = String(raw).trim().toUpperCase();
    if (!t.startsWith('#')) t = '#' + t.replace(/^#+/, '');
    return t;
  };

  const playerTag = normPlayer(meta.coc_tag);

  if (playerTag) {
    try {
      const r = await fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(playerTag)}`);
      const data = await r.json();
      if (r.ok) {
        if (data.clan && applyClanFromApiClanObject(data.clan)) return;
        window._userClanTag = null;
        window._clanName = '';
        window._clanBadgeUrl = null;
        return;
      }
    } catch (_) {}
    try {
      const row = await _fetchMemberRowForProfile(playerTag);
      if (row?.clan_tag && String(row.clan_tag).trim()) {
        window._userClanTag = normClanTag(row.clan_tag);
        if (row.clan_name) window._clanName = row.clan_name;
        return;
      }
    } catch (_) {}
  }

  if (window._userClanTag) return;

  try {
    const session = (await db.auth.getSession())?.data?.session;
    if (!session?.access_token) return;
    const r = await fetch('/api/lookup?type=session-clan', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.clan) applyClanFromApiClanObject(j.clan);
  } catch (_) {}
}


// ── Multi-profilo CoC ─────────────────────────────────────────────────────────
window._profilesState = null;
window._profilesGateMode = false;

function isAccountAdminUser(user) {
  const meta = user?.user_metadata || {};
  if (meta.account_is_admin === true) return true;
  if (user?.app_metadata?.is_admin === true) return true;
  return String(meta.role || '').toLowerCase() === 'admin';
}

function effectiveClanRoleFromUser(user) {
  if (isAccountAdminUser(user)) return 'admin';
  const meta = user?.user_metadata || {};
  return String(meta.clan_role || meta.role || 'utente').toLowerCase();
}

async function authBearerHeaders() {
  const { data: { session } } = await db.auth.getSession();
  if (!session?.access_token) throw new Error('Sessione scaduta.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function profilesApi(type, { method = 'GET', body = null } = {}) {
  const headers = await authBearerHeaders();
  const url = `/api/lookup?type=${encodeURIComponent(type)}`;
  const opts = { method, headers };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || `HTTP ${r.status}`);
    err.code = j.code;
    throw err;
  }
  return j;
}

async function resolveLoginEmailAsync(rawInput) {
  try {
    const r = await fetch('/api/lookup?type=resolve-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: rawInput }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.email) return j.email;
  } catch (_) {}
  return resolveLoginEmail(rawInput);
}

function updateActiveProfileChip(state) {
  const el = document.getElementById('active-profile-chip');
  if (!el) return;
  const p = state?.active;
  if (!p) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const clan = p.coc_clan_name ? ` · ${p.coc_clan_name}` : '';
  el.textContent = `${p.username || 'Villaggio'} (${p.coc_tag})${clan}`;
}

function setProfilesModalBusy(busy, msg) {
  const modal = document.getElementById('profiles-modal');
  if (!modal) return;
  let overlay = document.getElementById('profiles-busy-overlay');
  const closeBtn = document.getElementById('profiles-modal-close');
  if (busy) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'profiles-busy-overlay';
      overlay.className = 'profiles-busy-overlay';
      // Appendi al body della modale, NON sopra l'header: la X resta sempre cliccabile.
      (modal.querySelector('.profiles-modal-body') || modal.querySelector('.modal-box'))?.appendChild(overlay);
    }
    overlay.textContent = msg || 'Caricamento…';
    overlay.style.display = 'flex';
    modal.querySelectorAll('button').forEach((b) => {
      if (b.id === 'profiles-modal-close') {
        b.disabled = false;
        return;
      }
      b.disabled = true;
    });
  } else if (overlay) {
    overlay.style.display = 'none';
    modal.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
  // La X non deve mai restare disabilitata (bug mobile: overlay busy bloccava la chiusura).
  if (closeBtn) closeBtn.disabled = false;
}

function closeProfilesModal({ force = false } = {}) {
  if (!force && window._profilesGateMode) return;
  const modal = document.getElementById('profiles-modal');
  if (!modal) return;
  setProfilesModalBusy(false);
  modal.style.display = 'none';
}

function renderProfilesModal(state, { gate = false } = {}) {
  window._profilesState = state;
  window._profilesGateMode = !!gate;
  const modal = document.getElementById('profiles-modal');
  const list = document.getElementById('profiles-list');
  const actions = document.getElementById('profiles-actions');
  const title = document.getElementById('profiles-modal-title');
  const hint = document.getElementById('profiles-modal-hint');
  const closeBtn = document.getElementById('profiles-modal-close');
  if (!modal || !list) return;

  title.textContent = gate ? 'Scegli il profilo CoC' : 'Profili CoC';
  hint.textContent = gate
    ? 'Hai più villaggi collegati. Seleziona quello da usare ora, oppure aggiungine uno.'
    : '● attivo · ⭐ predefinito · 📱 Mini App. Max 10 profili.';
  // In gate mode nascondi solo se c'è almeno un profilo da scegliere; altrimenti
  // lascia sempre la X visibile (evita modale "intrappolata" su mobile).
  if (closeBtn) {
    const hasProfiles = (state.profiles || []).length > 0;
    closeBtn.style.display = (gate && hasProfiles) ? 'none' : 'flex';
    closeBtn.disabled = false;
  }

  const prefs = state.prefs || {};
  list.innerHTML = '';
  (state.profiles || []).forEach((p) => {
    const row = document.createElement('div');
    row.className = 'profiles-row' + (prefs.active_profile_id === p.id ? ' active' : '');
    const marks = [];
    if (prefs.active_profile_id === p.id) marks.push('●');
    if (prefs.default_profile_id === p.id) marks.push('⭐');
    if (prefs.mini_app_profile_id === p.id) marks.push('📱');
    const th = Number(p.town_hall_level) || 0;
    const thN = String(Math.min(Math.max(th || 1, 1), 18)).padStart(2, '0');
    const thSrc = th > 0 ? `th/level_${thN}.webp` : '';
    const badge = (p.coc_clan_badge_url || '').replace(/"/g, '');
    const name = (p.label || p.username || 'Villaggio').replace(/[<>]/g, '');
    const tag = (p.coc_tag || '').replace(/[<>]/g, '');
    const role = (p.clan_role || '').replace(/[<>]/g, '');
    const clanName = (p.coc_clan_name || '').replace(/[<>]/g, '');
    row.innerHTML = `
      <div class="profiles-row-main">
        <div class="profiles-row-identity">
          ${thSrc ? `<img class="profiles-th" src="${thSrc}" alt="TH${th}" onerror="this.onerror=null;this.src='th/level_${thN}.png'">` : '<span class="profiles-th profiles-th-empty">TH?</span>'}
          <div>
            <strong>${marks.join(' ')} ${name}</strong>
            <div class="profiles-row-meta mono">${tag} · ${role || '—'}</div>
            <div class="profiles-row-clan">
              ${badge ? `<img class="profiles-clan-badge" src="${badge}" alt="">` : ''}
              <span>${clanName || (p.coc_clan_tag || 'Nessun clan')}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="profiles-row-actions"></div>
    `;
    const acts = row.querySelector('.profiles-row-actions');
    const useBtn = document.createElement('button');
    useBtn.className = 'btn-primary btn-sm';
    useBtn.textContent = prefs.active_profile_id === p.id ? 'In uso' : 'Usa';
    useBtn.disabled = prefs.active_profile_id === p.id;
    useBtn.onclick = () => void switchProfileAndReload(p.id, { setDefault: false });
    acts.appendChild(useBtn);

    if (!gate) {
      const defBtn = document.createElement('button');
      defBtn.className = 'btn-logout btn-sm';
      defBtn.textContent = prefs.default_profile_id === p.id ? '⭐ Predefinito' : 'Rendi predefinito';
      defBtn.onclick = () => void setDefaultProfileId(p.id);
      acts.appendChild(defBtn);

      const miniBtn = document.createElement('button');
      miniBtn.className = 'btn-logout btn-sm';
      miniBtn.textContent = prefs.mini_app_profile_id === p.id ? '📱 Mini App' : 'Imposta Mini App';
      miniBtn.onclick = () => void setMiniAppProfileId(p.id);
      acts.appendChild(miniBtn);

      if ((state.profiles || []).length > 1) {
        const rm = document.createElement('button');
        rm.className = 'btn-logout btn-sm';
        rm.textContent = 'Scollega';
        rm.onclick = () => void removeProfileId(p.id);
        acts.appendChild(rm);
      }
    } else {
      const keep = document.createElement('button');
      keep.className = 'btn-logout btn-sm';
      keep.textContent = 'Usa e mantieni predefinito';
      keep.onclick = () => void switchProfileAndReload(p.id, { setDefault: true });
      acts.appendChild(keep);
    }
    list.appendChild(row);
  });

  actions.innerHTML = '';
  if ((state.profiles || []).length < (state.max_profiles || 10)) {
    const add = document.createElement('button');
    add.className = 'btn-primary btn-sm';
    add.textContent = '➕ Aggiungi villaggio';
    add.onclick = () => {
      document.getElementById('profiles-add-form').style.display = 'block';
      document.getElementById('profiles-wipe-box').style.display = 'none';
    };
    actions.appendChild(add);
  }
  if (!gate) {
    const ask = document.createElement('button');
    ask.className = 'btn-logout btn-sm';
    ask.textContent = prefs.always_ask_profile ? 'Chiedi sempre: ON' : 'Chiedi sempre: OFF';
    ask.onclick = () => void toggleAlwaysAsk(!prefs.always_ask_profile);
    actions.appendChild(ask);

    const clearMini = document.createElement('button');
    clearMini.className = 'btn-logout btn-sm';
    clearMini.textContent = 'Mini App: eredita attivo';
    clearMini.onclick = () => void setMiniAppProfileId(null);
    actions.appendChild(clearMini);

    const wipe = document.createElement('button');
    wipe.className = 'btn-logout btn-sm';
    wipe.textContent = 'Elimina account…';
    wipe.onclick = () => {
      document.getElementById('profiles-wipe-box').style.display = 'block';
      document.getElementById('profiles-add-form').style.display = 'none';
    };
    actions.appendChild(wipe);
  }

  modal.style.display = 'flex';
  setProfilesModalBusy(false);
  updateActiveProfileChip(state);
}

async function refreshProfilesModal(opts = {}) {
  setProfilesModalBusy(true, 'Caricamento profili…');
  try {
    const state = await profilesApi('profiles-bootstrap');
    renderProfilesModal(state, opts);
    return state;
  } catch (e) {
    setProfilesModalBusy(false);
    throw e;
  }
}

async function switchProfileAndReload(profileId, { setDefault = false } = {}) {
  window.__cocboardManualProfilePick = true;
  setProfilesModalBusy(true, setDefault ? 'Imposto predefinito e attivo…' : 'Attivo profilo…');
  try {
    await profilesApi('profiles-switch', {
      method: 'POST',
      body: { profile_id: profileId, set_default: setDefault === true },
    });
    await db.auth.refreshSession().catch(() => {});
    closeProfilesModal({ force: true });
    const { data } = await db.auth.getUser();
    if (data?.user) await showApp(data.user);
    else location.reload();
  } catch (e) {
    setProfilesModalBusy(false);
    alert(e.message || 'Errore cambio profilo');
  }
}

async function setDefaultProfileId(profileId) {
  setProfilesModalBusy(true, 'Salvo predefinito…');
  try {
    await profilesApi('profiles-set-default', { method: 'POST', body: { profile_id: profileId } });
    await refreshProfilesModal({ gate: false });
  } catch (e) {
    setProfilesModalBusy(false);
    alert(e.message || 'Errore');
  }
}

async function setMiniAppProfileId(profileId) {
  setProfilesModalBusy(true, 'Salvo Mini App…');
  try {
    await profilesApi('profiles-mini-app', { method: 'POST', body: { profile_id: profileId } });
    await refreshProfilesModal({ gate: false });
  } catch (e) {
    setProfilesModalBusy(false);
    alert(e.message || 'Errore');
  }
}

async function toggleAlwaysAsk(on) {
  setProfilesModalBusy(true, 'Salvo preferenza…');
  try {
    await profilesApi('profiles-always-ask', { method: 'POST', body: { always_ask: on === true } });
    await refreshProfilesModal({ gate: false });
  } catch (e) {
    setProfilesModalBusy(false);
    alert(e.message || 'Errore');
  }
}

async function removeProfileId(profileId) {
  if (!confirm('Scollegare questo villaggio dal tuo account?')) return;
  setProfilesModalBusy(true, 'Scollegamento…');
  try {
    await profilesApi('profiles-remove', { method: 'POST', body: { profile_id: profileId } });
    await db.auth.refreshSession().catch(() => {});
    await refreshProfilesModal({ gate: false });
    const { data } = await db.auth.getUser();
    if (data?.user) await showApp(data.user);
  } catch (e) {
    setProfilesModalBusy(false);
    alert(e.message || 'Impossibile scollegare.');
  }
}

function wireProfilesUiOnce() {
  if (window.__profilesUiWired) return;
  window.__profilesUiWired = true;
  document.getElementById('profiles-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('profiles-btn');
    const prev = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Caricamento…'; }
    void refreshProfilesModal({ gate: false })
      .catch((e) => alert(e.message))
      .finally(() => {
        if (btn) { btn.disabled = false; btn.textContent = prev || 'Profili'; }
      });
  });
  document.getElementById('profiles-modal-close')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeProfilesModal();
  });
  document.getElementById('profiles-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'profiles-modal') closeProfilesModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('profiles-modal');
    if (modal && modal.style.display !== 'none') closeProfilesModal();
  });
  document.getElementById('prof-add-cancel')?.addEventListener('click', () => {
    document.getElementById('profiles-add-form').style.display = 'none';
  });
  document.getElementById('prof-wipe-cancel')?.addEventListener('click', () => {
    document.getElementById('profiles-wipe-box').style.display = 'none';
  });
  document.getElementById('prof-add-submit')?.addEventListener('click', async () => {
    const errEl = document.getElementById('prof-add-error');
    const submitBtn = document.getElementById('prof-add-submit');
    errEl.style.display = 'none';
    const playerTag = document.getElementById('prof-add-tag').value.trim();
    const apiToken = document.getElementById('prof-add-token').value.trim();
    if (!playerTag || !apiToken) {
      errEl.textContent = 'Tag e chiave API obbligatori.';
      errEl.style.display = 'block';
      return;
    }
    const prevLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Caricamento…';
    try {
      const headers = await authBearerHeaders();
      const r = await fetch('/api/register-with-coc', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'add-profile', playerTag, apiToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Errore');
      document.getElementById('profiles-add-form').style.display = 'none';
      document.getElementById('prof-add-tag').value = '';
      document.getElementById('prof-add-token').value = '';
      await refreshProfilesModal({ gate: window._profilesGateMode });
    } catch (e) {
      errEl.textContent = e.message || 'Errore';
      errEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel || 'Collega villaggio';
    }
  });
  document.getElementById('prof-wipe-submit')?.addEventListener('click', async () => {
    const confirmTxt = document.getElementById('prof-wipe-confirm').value.trim();
    if (confirmTxt.toUpperCase() !== 'ELIMINA') {
      alert('Digita ELIMINA per confermare.');
      return;
    }
    if (!confirm('Confermi l’eliminazione definitiva dell’account?')) return;
    try {
      const headers = await authBearerHeaders();
      const r = await fetch('/api/register-with-coc', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete-account', confirm: 'ELIMINA' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Errore');
      await db.auth.signOut();
      location.reload();
    } catch (e) {
      alert(e.message || 'Errore eliminazione');
    }
  });
}

async function ensureProfilesBeforeApp(user) {
  wireProfilesUiOnce();
  if (!user?.id || user.is_anonymous) return true;
  try {
    // Mini App con profilo dedicato (tg_profile): attiva quel profilo per la sessione web
    // Mai in gruppo collegato (clan forzato): resta il clan della chat
    if (window.__cocboardTgProfile && !window.__cocboardForcedClanTag) {
      const pid = window.__cocboardTgProfile;
      delete window.__cocboardTgProfile;
      window.__cocboardFromMiniAppProfile = true;
      await profilesApi('profiles-switch', {
        method: 'POST',
        body: { profile_id: pid },
      });
      await db.auth.refreshSession().catch(() => {});
    } else if (window.__cocboardForcedClanTag) {
      delete window.__cocboardTgProfile;
    }

    const state = await profilesApi('profiles-bootstrap');
    window._profilesState = state;
    updateActiveProfileChip(state);
    // Metadata Auth aggiornati dal refresh live → rinnova JWT locale
    await db.auth.refreshSession().catch(() => {});
    // Non riaprire la gate se l'utente ha già scelto manualmente un profilo in questa
    // sessione (tasto "Usa"): senza "mantieni predefinito" il server non salva un
    // default_profile_id, quindi needs_selection resterebbe true e la modale si
    // richiuderebbe/riaprirebbe all'infinito (con la X nascosta, sembra "bloccata").
    if (
      state.needs_selection &&
      !window.__cocboardManualProfilePick &&
      !window.__cocboardFromMiniAppProfile &&
      !window.__cocboardForcedClanTag
    ) {
      renderProfilesModal(state, { gate: true });
      return false;
    }
    // Applica predefinito SOLO al primo avvio sessione browser, mai dopo un "Usa" manuale
    if (
      !window.__cocboardManualProfilePick &&
      !window.__cocboardDefaultApplied &&
      !window.__cocboardFromMiniAppProfile &&
      !window.__cocboardForcedClanTag &&
      state.prefs?.default_profile_id &&
      state.active?.id &&
      state.prefs.default_profile_id !== state.active.id &&
      !state.prefs.always_ask_profile
    ) {
      window.__cocboardDefaultApplied = true;
      await profilesApi('profiles-switch', {
        method: 'POST',
        body: { profile_id: state.prefs.default_profile_id },
      });
      await db.auth.refreshSession().catch(() => {});
      const { data } = await db.auth.getUser();
      if (data?.user) user = data.user;
    } else {
      window.__cocboardDefaultApplied = true;
    }
  } catch (e) {
    console.warn('[profiles]', e.message);
  }
  return true;
}


async function showApp(sessionUser) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Recupera i dati utente aggiornati dal server (evita metadata stale)
  let user = sessionUser;
  try {
    const { data } = await db.auth.getUser();
    if (data?.user) user = data.user;
  } catch (_) {}

  if (user.user_metadata?.must_change_password === true && !user.is_anonymous) {
    showForcePasswordChangeScreen(user);
    return;
  }

  const okProfiles = await ensureProfilesBeforeApp(user);
  if (!okProfiles) {
    // Gate profili: resta in app shell ma aspetta scelta
    return;
  }
  try {
    const { data } = await db.auth.getUser();
    if (data?.user) user = data.user;
  } catch (_) {}

  const role = effectiveClanRoleFromUser(user);
  const isAdmin   = isAccountAdminUser(user);
  const isTelegramModerator = user.user_metadata?.telegram_moderator === true;
  const canEdit   = ['admin', 'capo', 'co-capo'].includes(role);

  // Info clan: priorità clan forzato da gruppo Telegram, poi metadata
  const rawMetaClan =
    window.__cocboardForcedClanTag ||
    user.user_metadata?.coc_clan_tag ||
    window.__cocboardGuestClanTag ||
    null;
  window._userClanTag =
    rawMetaClan && String(rawMetaClan).trim() ? normClanTag(rawMetaClan) : null;
  if (window.__cocboardForcedClanTag) {
    window._clanName = '';
    window._clanBadgeUrl = null;
  } else {
    window._clanName = user.user_metadata?.coc_clan_name || '';
    window._clanBadgeUrl = user.user_metadata?.coc_clan_badge_url || null;
  }

  await tryHydrateClanFromUserMetadata(user);

  // Tab clan-dipendenti: nascoste senza clan; ripristinate se il clan è disponibile
  ['members', 'warlog', 'cwl'].forEach(tab => {
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => {
      if (!window._userClanTag) {
        el.style.display = 'none';
        return;
      }
      const tag = el.tagName.toLowerCase();
      el.style.display = (el.classList.contains('bnav-btn') || el.classList.contains('bnav-altro-item'))
        ? 'flex'
        : (tag === 'button' || tag === 'span' ? 'inline-block' : 'block');
    });
  });

  // Senza clan: resta in app (profilo, cerca, classifica, carte…). Niente blocco a schermo pieno.
  document.getElementById('no-clan-screen').style.display = 'none';
  const noClanBanner = document.getElementById('no-clan-banner');
  if (noClanBanner) {
    noClanBanner.style.display = window._userClanTag ? 'none' : 'block';
  }

  // Mostra nome in-game nella sidebar (utenti anonimi non hanno username/email)
  const displayName = user.user_metadata?.username || user.email?.replace(/@(fearunited|cocboard)\.internal$/, '') || user.email || (user.is_anonymous ? 'Ospite' : null);
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

  // Solo admin vede "Gestione Utenti"; CoCBoardBot per admin o moderatori Telegram
  document.querySelectorAll('[data-tab="admin"]').forEach(el => {
    el.style.display = isAdmin
      ? (el.classList.contains('bnav-btn') || el.classList.contains('bnav-altro-item') ? 'flex' : 'inline-block')
      : 'none';
  });
  document.querySelectorAll('[data-tab="botadmin"]').forEach(el => {
    const show = isAdmin || isTelegramModerator;
    el.style.display = show
      ? (el.classList.contains('bnav-btn') ? 'flex' : 'inline-block')
      : 'none';
  });

  // Evento Clash of Cards: mostra la tab solo se attivo (o se admin, per gestirlo)
  initCardEventTabVisibility(isAdmin).catch(() => {});

  // Imposta stagione bonus al mese corrente
  const seasonInput = document.getElementById('bonus-season');
  if (seasonInput) seasonInput.value = new Date().toISOString().slice(0, 7);

  // Salva il ruolo corrente globalmente
  window._userRole = role;
  window._canEdit  = canEdit;  // usato da renderCwlSeasons per pulsante ✏️
  window._userIsTelegramModerator = !!isTelegramModerator;
  window._userBotAdminFull = isAdmin;
  applyBotAdminStaffUi();

  // Landing tab SOLO al primo ingresso sessione — non ad ogni refresh JWT / token
  if (!window.__cocboardLandingTabApplied) {
    window.__cocboardLandingTabApplied = true;
    if (!window._userClanTag) {
      activateTab('profilo');
    } else {
      loadMembers();
    }
  } else if (window._userClanTag) {
    // Refresh sessione: aggiorna roster senza rubare la tab attiva
    loadMembers();
  }

  queueMicrotask(() => {
    void applyCocboardTelegramWebDeepLinks();
  });
}

/** Dopo login: priorità a deep link CWL; altrimenti tab Clan (handoff bot con <code>open_tab=members</code>). */
async function applyCocboardTelegramWebDeepLinks() {
  try {
    const otFirst = window.__cocboardOpenTab;
    const rn = window.__cocboardOpenCwlRound;
    if ((otFirst === 'cwl_warlog' || otFirst === 'cwl') && window._userClanTag) {
      delete window.__cocboardOpenTab;
      await applyCocboardTelegramWebDeepLinkWarlogRounds(rn != null ? rn : undefined);
      return;
    }
    if (rn != null && window._userClanTag) {
      await applyCocboardTelegramWebDeepLink();
      return;
    }
    const ot = window.__cocboardOpenTab;
    if (!ot) return;
    if (ot === 'botadmin') {
      delete window.__cocboardOpenTab;
      if (window._userRole === 'admin' || window._userIsTelegramModerator) activateTab('botadmin');
      return;
    }
    if (ot === 'login') {
      delete window.__cocboardOpenTab;
      const ls = document.getElementById('login-screen');
      const app = document.getElementById('app');
      const nc = document.getElementById('no-clan-screen');
      if (ls) ls.style.display = 'flex';
      if (app) app.style.display = 'none';
      if (nc) nc.style.display = 'none';
      return;
    }
    if (ot === 'cerca') {
      delete window.__cocboardOpenTab;
      activateTab('cerca');
      return;
    }
    if (ot === 'bonus' && window._userClanTag) {
      delete window.__cocboardOpenTab;
      activateTab('cwl');
      return;
    }
    if (ot === 'warlog' && window._userClanTag) {
      delete window.__cocboardOpenTab;
      activateTab('warlog');
      return;
    }
    if (ot === 'war_live' && window._userClanTag) {
      delete window.__cocboardOpenTab;
      activateTab('warlog');
      return;
    }
    if (ot === 'profilo') {
      delete window.__cocboardOpenTab;
      activateTab('profilo');
      return;
    }
    if (ot === 'rankings') {
      delete window.__cocboardOpenTab;
      activateTab('rankings');
      return;
    }
    if (ot === 'members' && window._userClanTag) {
      delete window.__cocboardOpenTab;
      activateTab('members');
    }
  } catch (e) {
    console.warn('[CoCBoard] Deep link web (tab / CWL)', e);
  }
}

/** Dopo login: apre Registri → Cronologia leghe → modal turni (da link bot / Mini App). */
async function applyCocboardTelegramWebDeepLink() {
  const rn = window.__cocboardOpenCwlRound;
  if (rn == null || !window._userClanTag) return;
  delete window.__cocboardOpenCwlRound;
  await applyCocboardTelegramWebDeepLinkWarlogRounds(rn);
}

/**
 * Registri guerre → Cronologia leghe CWL → stagione (live se c’è) → tab Turni;
 * opzionale `initialRound` = numero turno 1–7 (altrimenti turno attivo automatico).
 */
async function applyCocboardTelegramWebDeepLinkWarlogRounds(initialRound) {
  if (!window._userClanTag) return;
  delete window.__cocboardOpenCwlRound;
  try {
    activateTab('warlog');
    const cwlBtn = document.querySelector('#tab-warlog .subtab-btn[onclick*="\'cwl\'"]');
    document.querySelectorAll('#tab-warlog .subtab-btn').forEach((b) => b.classList.remove('active'));
    if (cwlBtn) cwlBtn.classList.add('active');
    const wlClassic = document.getElementById('wl-classic');
    const wlCwl = document.getElementById('wl-cwl');
    if (wlClassic) wlClassic.style.display = 'none';
    if (wlCwl) wlCwl.style.display = 'block';
    await loadCwlSeasons();
    const merged = window._cwlMergedSeasons || [];
    const live = merged.find((s) => s.isLive && s.hasRounds) || merged.find((s) => s.hasRounds);
    if (!live) return;
    const extra = { forceCdmTab: 'rounds' };
    if (initialRound != null && initialRound >= 1 && initialRound <= 7) {
      extra.initialRoundNumber = initialRound;
    }
    openCwlSeasonDetail(live.season, extra);
  } catch (e) {
    console.warn('[CoCBoard] Deep link CWL warlog / turni', e);
  }
}



// ── NAVIGATION ────────────────────────────────────────────────────────────────

const TAB_TITLES = {
  members:   'Clan',
  warlog:    'Registri Guerre',
  cwl:       'Bonus CWL',
  profilo:   'Il mio Profilo',
  cerca:     'Cerca',
  rankings:  'Classifiche',
  admin:     'Pannello Admin',
  carte:     'Clash of Cards',
};

const BNAV_ALTRO_TABS = new Set(['cerca', 'rankings', 'admin']);

function closeBnavAltro() {
  const sheet = document.getElementById('bnav-altro-sheet');
  const btn = document.getElementById('bnav-altro-btn');
  if (sheet) {
    sheet.style.display = 'none';
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openBnavAltro() {
  const sheet = document.getElementById('bnav-altro-sheet');
  const btn = document.getElementById('bnav-altro-btn');
  if (!sheet) return;
  sheet.style.display = 'block';
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function toggleBnavAltro() {
  const sheet = document.getElementById('bnav-altro-sheet');
  if (sheet && (sheet.classList.contains('open') || sheet.style.display === 'block')) closeBnavAltro();
  else openBnavAltro();
}

function wireBnavAltroOnce() {
  if (window.__bnavAltroWired) return;
  window.__bnavAltroWired = true;
  document.getElementById('bnav-altro-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleBnavAltro();
  });
  document.getElementById('bnav-altro-backdrop')?.addEventListener('click', () => closeBnavAltro());
  document.querySelectorAll('#bnav-altro-sheet .bnav-altro-item[data-tab]').forEach((item) => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      closeBnavAltro();
      if (tab) activateTab(tab);
    });
  });
}

function activateTab(tabId) {
  // botadmin deep-links redirect to unified admin tab (bot panel)
  if (tabId === 'botadmin') { tabId = 'admin'; window._adminOpenPanel = 'bot'; }
  if (!tabId) return;
  // Senza clan: Clan / Registri / Bonus non disponibili
  if (!window._userClanTag && (tabId === 'members' || tabId === 'warlog' || tabId === 'cwl')) {
    tabId = 'profilo';
  }
  closeBnavAltro();

  document.querySelectorAll('.tab-btn, .bnav-btn[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  // Evidenzia "Altro" se la tab attiva è una voce secondaria
  const altroBtn = document.getElementById('bnav-altro-btn');
  if (altroBtn) altroBtn.classList.toggle('active', BNAV_ALTRO_TABS.has(tabId));
  document.querySelectorAll('#bnav-altro-sheet .bnav-altro-item[data-tab]').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-content').forEach(s => (s.style.display = 'none'));
  const sec = document.getElementById('tab-' + tabId);
  if (sec) sec.style.display = 'block';
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = TAB_TITLES[tabId] || tabId;
  if (tabId === 'admin') {
    const panel = window._adminOpenPanel || 'users';
    delete window._adminOpenPanel;
    const btn = document.querySelector(`.subtab-btn[onclick*="switchAdminPanel('${panel}'"]`);
    switchAdminPanel(panel, btn);
  }
  if (tabId === 'warlog') setTimeout(loadWarLog, 80);
  if (tabId === 'cwl') setTimeout(loadAssignBonus, 80);
  if (tabId === 'profilo') setTimeout(loadProfile, 80);
  if (tabId === 'rankings') { setTimeout(loadRankings, 80); setTimeout(renderFavoriti, 80); _detectUserCountry(); }
  if (tabId === 'cerca') setTimeout(renderFavoriti, 80);
  if (tabId === 'carte') setTimeout(loadCardEventTab, 80);
}

function switchAdminPanel(panel, btn) {
  document.getElementById('admin-panel-users').style.display = panel === 'users' ? 'block' : 'none';
  document.getElementById('admin-panel-bot').style.display = panel === 'bot' ? 'block' : 'none';

  const bar = document.querySelector('#tab-admin > .subtab-bar');
  if (bar) bar.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (panel === 'users') loadUsers();
  if (panel === 'bot') {
    applyBotAdminStaffUi();
    if (window._userBotAdminFull) {
      const d = document.querySelector('#admin-panel-bot [data-botadmin-tab="dashboard"]');
      switchBotAdminTab('dashboard', d);
    } else {
      const t = document.querySelector('#admin-panel-bot [data-botadmin-tab="tickets"]');
      switchBotAdminTab('tickets', t);
    }
  }
}

document.querySelectorAll('.tab-btn, .bnav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});
wireBnavAltroOnce();

// ── Evento "Clash of Cards" (temporaneo) ──────────────────────────────────────
window._cardEventCatalog = null;   // { cards, category_order, category_label_it, category_totals, total_cards, settings }
window._cardEventData    = null;   // { profiles, collections, settings } (per-utente, da cards-get)
window._cardEventActiveTag = null;
window._cardEventActiveCat = null;

const CARTE_CAT_BORDER = {
  elixir: 'cat-border-elixir',
  dark_elixir: 'cat-border-dark',
  builder_base: 'cat-border-builder',
  super_troop: 'cat-border-super',
};

async function initCardEventTabVisibility(isAdmin) {
  try {
    const headers = await authBearerHeaders().catch(() => ({ Accept: 'application/json' }));
    const r = await fetch('/api/lookup?type=cards-catalog', { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return;
    window._cardEventCatalog = j;
    const show = j.settings?.live === true || isAdmin === true;
    document.querySelectorAll('.carte-event-tab').forEach(el => {
      el.style.display = show ? (el.classList.contains('bnav-btn') ? 'flex' : 'inline-block') : 'none';
    });
  } catch (_) {}
}

async function loadCardEventTab() {
  const box = document.getElementById('carte-content');
  if (!box) return;
  box.innerHTML = '<div class="profilo-empty"><p style="color:var(--text-3)">Caricamento…</p></div>';
  try {
    if (!window._cardEventCatalog) {
      const headers = await authBearerHeaders().catch(() => ({ Accept: 'application/json' }));
      const rc = await fetch('/api/lookup?type=cards-catalog', { headers });
      window._cardEventCatalog = await rc.json();
    }
    window._cardEventData = await profilesApi('cards-get');
  } catch (e) {
    box.innerHTML = `<div class="profilo-empty"><p style="color:var(--red)">Errore caricamento evento: ${escH(e.message || '')}</p></div>`;
    return;
  }
  const profiles = window._cardEventData?.profiles || [];
  if (!window._cardEventActiveTag || !profiles.some(p => p.coc_tag === window._cardEventActiveTag)) {
    const activeId = window._profilesState?.active?.id;
    window._cardEventActiveTag = (profiles.find(p => p.id === activeId) || profiles[0])?.coc_tag || null;
  }
  if (!window._cardEventActiveCat) {
    window._cardEventActiveCat = window._cardEventCatalog?.category_order?.[0] || 'elixir';
  }
  renderCardEventProfilePicker();
  renderCardEventContent();
  const tradeBox = document.getElementById('carte-trade-content');
  if (tradeBox && tradeBox.style.display !== 'none') loadCardTradeTab();
  maybeShowCarteTutorial();
}

const CARTE_TUTORIAL_KEY = 'cocboard_carte_tutorial_v1';
const CARTE_TUTORIAL_STEPS = [
  {
    title: 'Benvenuto in Clash of Cards',
    body: 'Qui segni manualmente le carte dell\'evento Supercell che hai trovato, trovi scambi con altri utenti CoCBoard e tra i tuoi profili CoC.',
  },
  {
    title: 'La mia collezione',
    body: 'Tocca una carta e usa + / − per indicare quante copie hai (0 = non ce l\'hai, 1 = ce l\'hai, 2+ = doppioni scambiabili). Non puoi mai scendere a 0 su una carta già trovata dopo uno scambio: si cedono solo i doppioni.',
  },
  {
    title: 'Scambi tra i tuoi profili',
    body: 'Se hai collegato più villaggi, nella tab Scambi → "Tra i tuoi profili" vedi le proposte automatiche. 🟢 = sblocchi una carta nuova · 🟡 = possibile ma già la possiedi.',
  },
  {
    title: 'Mazzi pubblici e chat',
    body: 'In "Mazzi pubblici" puoi rendere pubblico un tuo mazzo, vedere quelli degli altri con gli scambi suggeriti e aprire una chat privata per proporre/accettare lo scambio.',
  },
];

function maybeShowCarteTutorial() {
  try {
    if (localStorage.getItem(CARTE_TUTORIAL_KEY) === '1') return;
  } catch (_) { return; }
  _openCarteTutorial(false);
}

function _markCarteTutorialSeen() {
  try { localStorage.setItem(CARTE_TUTORIAL_KEY, '1'); } catch (_) {}
}

function _openCarteTutorial(fromButton = false) {
  document.getElementById('carte-tutorial-modal')?.remove();
  window._carteTutorialStep = 0;
  window._carteTutorialManual = !!fromButton;
  const modal = document.createElement('div');
  modal.id = 'carte-tutorial-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1100';
  modal.innerHTML = `<div class="modal-box carte-tutorial-box" style="max-width:400px;width:100%"></div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) _closeCarteTutorial(true); });
  document.body.appendChild(modal);
  _renderCarteTutorialStep();
}

function _closeCarteTutorial(markSeen) {
  if (markSeen) _markCarteTutorialSeen();
  document.getElementById('carte-tutorial-modal')?.remove();
}

function _renderCarteTutorialStep() {
  const box = document.querySelector('#carte-tutorial-modal .carte-tutorial-box');
  if (!box) return;
  const i = window._carteTutorialStep || 0;
  const step = CARTE_TUTORIAL_STEPS[i];
  const last = i >= CARTE_TUTORIAL_STEPS.length - 1;
  const dots = CARTE_TUTORIAL_STEPS.map((_, di) =>
    `<span class="carte-tutorial-dot ${di === i ? 'active' : ''}"></span>`
  ).join('');
  box.innerHTML = `
    <div class="modal-header">
      <h2 style="font-size:1rem">${escH(step.title)}</h2>
      <button type="button" class="modal-close" onclick="_closeCarteTutorial(true)" aria-label="Chiudi">✕</button>
    </div>
    <div class="carte-tutorial-body">
      <p class="carte-tutorial-text">${escH(step.body)}</p>
      <div class="carte-tutorial-dots">${dots}</div>
      <div class="carte-qty-modal-actions">
        <button type="button" class="btn-secondary" onclick="_closeCarteTutorial(true)">Salta</button>
        ${i > 0 ? `<button type="button" class="btn-secondary" onclick="_carteTutorialPrev()">Indietro</button>` : ''}
        <button type="button" class="btn-primary" onclick="${last ? '_closeCarteTutorial(true)' : '_carteTutorialNext()'}">${last ? 'Ho capito' : 'Avanti'}</button>
      </div>
    </div>`;
}

function _carteTutorialNext() {
  window._carteTutorialStep = Math.min(CARTE_TUTORIAL_STEPS.length - 1, (window._carteTutorialStep || 0) + 1);
  _renderCarteTutorialStep();
}
function _carteTutorialPrev() {
  window._carteTutorialStep = Math.max(0, (window._carteTutorialStep || 0) - 1);
  _renderCarteTutorialStep();
}

function renderCardEventProfilePicker() {
  const el = document.getElementById('carte-profile-picker');
  if (!el) return;
  const profiles = window._cardEventData?.profiles || [];
  if (profiles.length < 2) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = profiles.map(p => {
    const th = Number(p.town_hall_level) || 0;
    const thN = String(Math.min(Math.max(th || 1, 1), 18)).padStart(2, '0');
    const thImg = th > 0
      ? `<img src="th/level_${thN}.webp" class="carte-profile-th" alt="" onerror="this.onerror=null;this.src='th/level_${thN}.png'">`
      : '';
    return `
    <button type="button" class="carte-profile-chip ${p.coc_tag === window._cardEventActiveTag ? 'active' : ''}"
      onclick="_switchCarteProfile('${escH(p.coc_tag)}')">
      ${thImg}
      ${escH(p.username || p.coc_tag)}
    </button>`;
  }).join('');
}

function _switchCarteProfile(cocTag) {
  window._cardEventActiveTag = cocTag;
  renderCardEventProfilePicker();
  renderCardEventContent();
  const tradeBox = document.getElementById('carte-trade-content');
  if (tradeBox && tradeBox.style.display !== 'none') loadCardTradeTab();
}

function _switchCarteCategory(cat) {
  window._cardEventActiveCat = cat;
  const f = _carteGetFilters();
  f.category = cat || 'all';
  window._carteAlbumFilter = cat || 'all';
  renderCardEventContent();
}

function _carteGetFilters() {
  if (!window._carteSearchFilters) {
    window._carteSearchFilters = {
      q: '',
      direction: 'any', // 'give' | 'get' | 'any'
      category: 'all',
      qty: 'all', // 'all' | '0' | '1' | '2'
      onlyTradable: false,
      onlyMatches: false,
      playerQ: '',
    };
  }
  return window._carteSearchFilters;
}

function _carteNormSearch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function _carteCardTextMatch(card, qRaw) {
  const q = _carteNormSearch(qRaw);
  if (!q) return true;
  const hay = _carteNormSearch([card.name_it, card.name_en, card.key].filter(Boolean).join(' '));
  return hay.includes(q);
}

function _cartePassesDirection(qty, direction) {
  if (direction === 'give') return qty >= 2;
  if (direction === 'get') return qty === 0;
  return true;
}

function _cartePassesQtyFilter(qty, f) {
  if (f.onlyTradable) return qty >= 2;
  if (f.qty === '0') return qty === 0;
  if (f.qty === '1') return qty === 1;
  if (f.qty === '2') return qty >= 2;
  return true;
}

/** Carte del profilo attivo che passano testo + verso + qty (+ categoria se non "all"). */
function _carteFindHitsForActiveProfile() {
  const cat = window._cardEventCatalog;
  const data = window._cardEventData;
  const tag = window._cardEventActiveTag;
  const f = _carteGetFilters();
  if (!cat || !data || !tag) return [];
  const coll = data.collections?.[tag] || {};
  return cat.cards.filter((c) => {
    if (f.category !== 'all' && c.category !== f.category) return false;
    if (!_carteCardTextMatch(c, f.q)) return false;
    const qty = coll[c.key] || 0;
    if (!_cartePassesDirection(qty, f.direction)) return false;
    if (!_cartePassesQtyFilter(qty, f)) return false;
    return true;
  });
}

function _carteFiltersActive() {
  const f = _carteGetFilters();
  return !!(
    f.q ||
    f.direction !== 'any' ||
    f.category !== 'all' ||
    f.qty !== 'all' ||
    f.onlyTradable ||
    f.onlyMatches ||
    f.playerQ
  );
}

function _carteResetFilters() {
  window._carteSearchFilters = {
    q: '',
    direction: 'any',
    category: 'all',
    qty: 'all',
    onlyTradable: false,
    onlyMatches: false,
    playerQ: '',
  };
  window._carteAlbumFilter = 'all';
  _carteApplyFiltersUi();
}

function _carteSetFilter(key, value) {
  const f = _carteGetFilters();
  f[key] = value;
  if (key === 'onlyTradable' && value) f.qty = 'all';
  if (key === 'qty' && value !== 'all') f.onlyTradable = false;
  if (key === 'category') {
    window._carteAlbumFilter = value || 'all';
    if (value && value !== 'all') window._cardEventActiveCat = value;
  }
  _carteApplyFiltersUi();
}

function _carteOnSearchInput(el, which) {
  const f = _carteGetFilters();
  if (which === 'player') f.playerQ = el.value;
  else f.q = el.value;
  window._carteSearchCaret = { which, start: el.selectionStart, end: el.selectionEnd };
  // Solo con testo: se tipologia è "Tutte", salta alla categoria della prima corrispondenza
  if (which === 'q') window._carteSearchAutoCat = true;
  _carteApplyFiltersUi();
}

function _carteApplyFiltersUi() {
  const tradeBox = document.getElementById('carte-trade-content');
  const inTrade = tradeBox && tradeBox.style.display !== 'none';
  if (inTrade) {
    if (window._cardTradeData) renderCardTradeContent();
    else void loadCardTradeTab();
  } else {
    renderCardEventContent();
  }
  const caret = window._carteSearchCaret;
  if (caret) {
    const id = caret.which === 'player' ? 'carte-filter-player' : 'carte-filter-q';
    const el = document.getElementById(id);
    if (el && typeof el.setSelectionRange === 'function') {
      try { el.focus(); el.setSelectionRange(caret.start, caret.end); } catch (_) {}
    }
    window._carteSearchCaret = null;
  }
}

function _carteSearchBarHtml({ showTradeExtras = false } = {}) {
  const f = _carteGetFilters();
  const cat = window._cardEventCatalog;
  const active = _carteFiltersActive();
  // Default compresso su mobile/viewport stretta; stato ricordato in sessione
  if (window._carteFiltersCollapsed == null) {
    window._carteFiltersCollapsed = (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches);
  }
  const collapsed = window._carteFiltersCollapsed === true;
  const shortLabel = {
    elixir: 'Elisir',
    dark_elixir: 'Elisir nero',
    builder_base: 'Builder',
    super_troop: 'Super truppe',
  };
  const catChips = [
    `<button type="button" class="carte-album-filter-btn ${f.category === 'all' ? 'active' : ''}" onclick="_carteSetFilter('category','all')">Tutte</button>`,
    ...(cat?.category_order || []).map((c) =>
      `<button type="button" class="carte-album-filter-btn ${f.category === c ? 'active' : ''} ${CARTE_CAT_BORDER[c] || ''}"
        onclick="_carteSetFilter('category','${c}')"><i class="carte-album-cat-dot ${CARTE_CAT_BORDER[c] || ''}"></i> ${escH(shortLabel[c] || cat.category_label_it[c] || c)}</button>`),
  ].join('');
  const qtyChips = [
    ['all', 'Tutte'],
    ['0', 'Mancanti'],
    ['1', 'Possedute'],
    ['2', 'Doppioni'],
  ].map(([v, lab]) =>
    `<button type="button" class="carte-album-filter-btn ${f.qty === v && !f.onlyTradable ? 'active' : ''}" onclick="_carteSetFilter('qty','${v}')">${lab}</button>`
  ).join('');

  const summaryBits = [];
  if (f.q) summaryBits.push(`“${f.q}”`);
  if (f.category !== 'all') summaryBits.push(shortLabel[f.category] || f.category);
  if (f.qty !== 'all') summaryBits.push({ '0': 'Mancanti', '1': 'Possedute', '2': 'Doppioni' }[f.qty] || f.qty);
  if (f.direction !== 'any') summaryBits.push(f.direction === 'give' ? 'Cedere' : 'Ricevere');
  if (f.onlyTradable) summaryBits.push('Scambiabili');
  if (f.onlyMatches) summaryBits.push('Solo match');
  if (f.playerQ) summaryBits.push(`Giocatore: ${f.playerQ}`);
  const summary = summaryBits.length ? summaryBits.map(escH).join(' · ') : 'Nessun filtro attivo';

  return `
    <div class="carte-search-bar ${collapsed ? 'is-collapsed' : ''}">
      <div class="carte-search-toggle-row">
        <button type="button" class="carte-search-toggle" onclick="_carteToggleFiltersCollapsed()" aria-expanded="${collapsed ? 'false' : 'true'}">
          ${collapsed ? '▾ Mostra filtri' : '▴ Nascondi filtri'}
          ${active ? `<span class="carte-search-toggle-badge">attivi</span>` : ''}
        </button>
        ${collapsed ? `<span class="carte-search-collapsed-summary">${summary}</span>` : ''}
        ${collapsed && active ? `<button type="button" class="btn-secondary btn-sm carte-search-reset" onclick="_carteResetFilters()">✕</button>` : ''}
      </div>
      <div class="carte-search-body">
        <div class="carte-search-row">
          <label class="carte-search-field carte-search-grow">
            <span class="carte-search-label">Cerca carta</span>
            <input type="search" id="carte-filter-q" class="carte-search-input" placeholder="es. arciere, golem meteorite…"
              value="${escH(f.q)}" autocomplete="off"
              oninput="_carteOnSearchInput(this,'q')">
          </label>
          ${showTradeExtras ? `
          <label class="carte-search-field carte-search-grow">
            <span class="carte-search-label">Giocatore / mazzo</span>
            <input type="search" id="carte-filter-player" class="carte-search-input" placeholder="username o tag…"
              value="${escH(f.playerQ)}" autocomplete="off"
              oninput="_carteOnSearchInput(this,'player')">
          </label>` : ''}
          <div class="carte-search-seg" role="group" aria-label="Verso scambio">
            <button type="button" class="carte-search-seg-btn ${f.direction === 'any' ? 'active' : ''}" onclick="_carteSetFilter('direction','any')">Entrambi</button>
            <button type="button" class="carte-search-seg-btn ${f.direction === 'give' ? 'active' : ''}" onclick="_carteSetFilter('direction','give')">Cedere</button>
            <button type="button" class="carte-search-seg-btn ${f.direction === 'get' ? 'active' : ''}" onclick="_carteSetFilter('direction','get')">Ricevere</button>
          </div>
          <button type="button" class="btn-secondary btn-sm carte-search-reset" ${active ? '' : 'disabled'} onclick="_carteResetFilters()">✕ Reset</button>
        </div>
        <div class="carte-search-chip-block">
          <span class="carte-search-label">Tipologia</span>
          <div class="carte-album-filters">${catChips}</div>
        </div>
        <div class="carte-search-chip-block">
          <span class="carte-search-label">Stato</span>
          <div class="carte-album-filters">
            ${qtyChips}
            <button type="button" class="carte-album-filter-btn ${f.onlyTradable ? 'active' : ''}" onclick="_carteSetFilter('onlyTradable', ${f.onlyTradable ? 'false' : 'true'})">Solo scambiabili</button>
            ${showTradeExtras ? `<button type="button" class="carte-album-filter-btn ${f.onlyMatches ? 'active' : ''}" onclick="_carteSetFilter('onlyMatches', ${f.onlyMatches ? 'false' : 'true'})">Solo match</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function _carteToggleFiltersCollapsed() {
  window._carteFiltersCollapsed = !(window._carteFiltersCollapsed === true);
  // Re-render della vista attiva
  const trade = document.getElementById('carte-trade-content');
  const coll = document.getElementById('carte-content');
  if (trade && trade.style.display !== 'none') {
    if (window._carteTradeSub === 'public') _renderCartePublicWindow();
    else renderCardTradeContent();
  } else if (coll) {
    renderCardEventContent();
  }
}

function _renderCollectionCatGrid(cardsInCat, coll, hitKeys, searching, hitsLen, readOnly) {
  return cardsInCat.map((c) => {
    const qty = coll[c.key] || 0;
    const stateCls = qty >= 2 ? 'state-2' : qty === 1 ? 'state-1' : 'state-0';
    const borderCls = CARTE_CAT_BORDER[c.category] || '';
    const isHit = hitKeys.has(c.key);
    // Non applico più is-search-dim - le carte si vedono sempre chiaramente
    const hit = isHit && searching ? 'is-search-hit' : '';
    return `<button type="button" class="carte-card ${stateCls} ${borderCls} ${hit}" data-card-key="${escH(c.key)}" ${readOnly ? 'disabled' : ''}
        onclick="_onCardEventClick('${c.key}')" title="${escH(c.name_it)}">
      <img src="${escH(c.icon_url)}" alt="${escH(c.name_it)}" loading="lazy"
           onerror="this.style.visibility='hidden'">
      <span class="carte-card-name">${escH(c.name_it)}</span>
      ${qty >= 2 ? `<span class="carte-card-badge">x${qty}</span>` : ''}
    </button>`;
  }).join('');
}

function renderCardEventContent() {
  const box = document.getElementById('carte-content');
  if (!box) return;
  const cat = window._cardEventCatalog;
  const data = window._cardEventData;
  if (!cat || !data) return;

  const subEl = document.getElementById('carte-event-sub');
  if (subEl) {
    if (!cat.settings?.live) {
      subEl.innerHTML = `⚠️ Evento terminato o disattivato: la sezione è in sola lettura.`;
    } else {
      const endsAt = cat.settings?.ends_at ? new Date(cat.settings.ends_at) : null;
      subEl.textContent = endsAt
        ? `Segna le carte che possiedi. Scambi con gli altri giocatori entro il ${endsAt.toLocaleDateString('it-IT')}.`
        : 'Segna manualmente le carte che possiedi per trovare scambi con altri giocatori.';
    }
  }

  const tag = window._cardEventActiveTag;
  const coll = (data.collections && tag && data.collections[tag]) || {};
  const f = _carteGetFilters();
  const hits = tag ? _carteFindHitsForActiveProfile() : [];
  const hitKeys = new Set(hits.map((c) => c.key));

  // Auto-passa alla tipologia solo quando digiti una ricerca (non quando cambi chip a mano)
  if (window._carteSearchAutoCat && hits.length && f.category === 'all' && f.q) {
    const preferred = hits[0].category;
    if (preferred) {
      window._cardEventActiveCat = preferred;
      f.category = preferred;
      window._carteAlbumFilter = preferred;
    }
  }
  window._carteSearchAutoCat = false;

  if (f.category !== 'all') {
    window._cardEventActiveCat = f.category;
  } else if (!window._cardEventActiveCat) {
    window._cardEventActiveCat = cat.category_order[0];
  }

  const totalFound = cat.cards.filter((c) => (coll[c.key] || 0) >= 1).length;
  const readOnly = !cat.settings?.live;
  // Filtraggio attivo se c'è ricerca testuale O filtri qty/direction
  const hasActiveFilters = !!(f.q || f.qty !== 'all' || f.direction !== 'any' || f.onlyTradable);
  // Evidenzia solo quando c'è ricerca testuale
  const searching = !!(f.q);
  const catsToShow = f.category === 'all' ? cat.category_order : [f.category];

  const otherCatHits = {};
  for (const h of hits) {
    if (f.category !== 'all' && h.category === f.category) continue;
    if (f.category === 'all') continue;
    otherCatHits[h.category] = (otherCatHits[h.category] || 0) + 1;
  }

  const gridsHtml = catsToShow.map((catKey) => {
    let cardsInCat = cat.cards.filter((c) => c.category === catKey);
    // Se ci sono filtri attivi, mostra solo le carte che passano
    if (hasActiveFilters) {
      cardsInCat = cardsInCat.filter((c) => {
        const qty = coll[c.key] || 0;
        if (!_cartePassesDirection(qty, f.direction)) return false;
        if (!_cartePassesQtyFilter(qty, f)) return false;
        if (!_carteCardTextMatch(c, f.q)) return false;
        return true;
      });
    }
    const found = cardsInCat.filter((c) => (coll[c.key] || 0) >= 1).length;
    const grid = _renderCollectionCatGrid(cardsInCat, coll, hitKeys, searching, hits.length, readOnly);
    return `
      <div class="carte-album-cat">
        <div class="carte-album-cat-label">
          <span class="carte-album-cat-dot ${CARTE_CAT_BORDER[catKey] || ''}"></span>
          ${escH(cat.category_label_it[catKey] || catKey)}
          <span class="carte-cat-count">${found}/${cardsInCat.length}</span>
        </div>
        <div class="carte-grid">${grid}</div>
      </div>`;
  }).join('');

  const dirLabel = f.direction === 'give' ? 'da cedere (doppioni)' : f.direction === 'get' ? 'da ricevere (mancanti)' : 'trovate';
  let statusHtml = '';
  if (tag && (searching || hasActiveFilters)) {
    if (!hits.length && hasActiveFilters) {
      statusHtml = `<div class="carte-search-status is-empty">Nessuna carta ${escH(dirLabel)} corrisponde ai filtri su questo profilo.</div>`;
    } else if (searching && hits.length) {
      const jump = Object.keys(otherCatHits).map((ck) =>
        `<button type="button" class="carte-search-jump" onclick="_carteSetFilter('category','${escH(ck)}')">${escH(cat.category_label_it[ck] || ck)} (${otherCatHits[ck]})</button>`
      ).join('');
      statusHtml = `<div class="carte-search-status">
        <strong>${hits.length}</strong> carta${hits.length === 1 ? '' : 'e'} ${escH(dirLabel)}
        ${jump ? `<span class="carte-search-jump-wrap">Anche in: ${jump}</span>` : ''}
      </div>`;
    }
  }

  const hitsStrip = (tag && searching && hits.length)
    ? `<div class="carte-search-hits">
        <div class="carte-search-hits-label">Corrispondenze</div>
        <div class="carte-search-hits-row">
          ${hits.slice(0, 24).map((c) => {
            const qty = coll[c.key] || 0;
            return `<button type="button" class="carte-card state-${qty >= 2 ? '2' : qty} ${CARTE_CAT_BORDER[c.category] || ''} is-search-hit" ${readOnly ? 'disabled' : ''}
              onclick="_onCardEventClick('${c.key}')" title="${escH(c.name_it)}">
              <img src="${escH(c.icon_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
              <span class="carte-card-name">${escH(c.name_it)}</span>
              ${qty >= 2 ? `<span class="carte-card-badge">x${qty}</span>` : ''}
            </button>`;
          }).join('')}
        </div>
      </div>`
    : '';

  const noProfile = !tag ? `<div class="profilo-empty"><p style="color:var(--text-3)">Nessun profilo CoC collegato al tuo account: collega un villaggio da "Profili" per usare questa sezione.</p></div>` : '';
  const hasAnyProfile = (data.profiles || []).length > 0;

  box.innerHTML = `
    <div class="carte-total-row">
      <div class="carte-total-counter">Carte trovate: <strong>${totalFound}/${cat.total_cards}</strong></div>
      ${hasAnyProfile ? `<button type="button" class="btn-secondary btn-sm" onclick="_openCarteShareDupes()">📋 Condividi doppioni</button>` : ''}
    </div>
    ${_carteSearchBarHtml({ showTradeExtras: false })}
    ${statusHtml}
    ${hitsStrip}
    ${noProfile}
    ${tag ? gridsHtml : ''}
    ${window._userRole === 'admin' ? renderCardEventAdminToggle(cat.settings) : ''}
  `;

  if (searching && hits.length) {
    requestAnimationFrame(() => {
      const el = box.querySelector('.carte-card.is-search-hit');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

const CARTE_CAT_EMOJI = {
  elixir: '🟣',
  dark_elixir: '⚫',
  builder_base: '🔧',
  super_troop: '⭐',
};

/** Elenco doppioni (qty >= 2) per profilo, già filtrati e ordinati per categoria/catalogo. */
function _carteDupesByProfile() {
  const cat = window._cardEventCatalog;
  const data = window._cardEventData;
  if (!cat || !data) return [];
  return (data.profiles || []).map((p) => {
    const coll = (data.collections && data.collections[p.coc_tag]) || {};
    const byCat = {};
    for (const catKey of cat.category_order) {
      byCat[catKey] = cat.cards
        .filter((c) => c.category === catKey && (coll[c.key] || 0) >= 2)
        .map((c) => ({ key: c.key, name_it: c.name_it, qty: coll[c.key] }));
    }
    return {
      id: p.id,
      coc_tag: p.coc_tag,
      label: p.username || p.label || p.coc_tag,
      byCat,
    };
  });
}

function _carteShareHeader() {
  return '🎴 I miei doppioni — Clash of Cards\nCoCBoard';
}

function _carteShareCatLine(cat, catKey) {
  const emoji = CARTE_CAT_EMOJI[catKey] || '';
  const label = cat.category_label_it[catKey] || catKey;
  return `${emoji} ${label}`.trim();
}

/** Formato A: blocco per ogni profilo CoC, categorie sotto. */
function buildCarteDupesTextA() {
  const cat = window._cardEventCatalog;
  if (!cat) return '';
  const profiles = _carteDupesByProfile();
  const lines = [_carteShareHeader(), ''];
  if (!profiles.length) {
    lines.push('(Nessun profilo CoC collegato.)');
    return lines.join('\n');
  }
  for (const p of profiles) {
    lines.push(`—— ${p.label} (${p.coc_tag}) ——`);
    for (const catKey of cat.category_order) {
      lines.push(_carteShareCatLine(cat, catKey));
      const items = p.byCat[catKey] || [];
      if (!items.length) lines.push('(nessun doppione)');
      else for (const it of items) lines.push(`• ${it.name_it} x${it.qty}`);
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Formato B: un elenco per categoria, profilo tra parentesi su ogni voce. */
function buildCarteDupesTextB() {
  const cat = window._cardEventCatalog;
  if (!cat) return '';
  const profiles = _carteDupesByProfile();
  const lines = [_carteShareHeader(), ''];
  for (const catKey of cat.category_order) {
    lines.push(_carteShareCatLine(cat, catKey));
    const parts = [];
    for (const p of profiles) {
      for (const it of p.byCat[catKey] || []) {
        parts.push(`${it.name_it} x${it.qty} (${p.label})`);
      }
    }
    if (!parts.length) lines.push('(nessun doppione)');
    else lines.push(`• ${parts.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Formato C: solo carte per categoria, quantità sommate tra i profili (senza attributo profilo). */
function buildCarteDupesTextC() {
  const cat = window._cardEventCatalog;
  if (!cat) return '';
  const profiles = _carteDupesByProfile();
  const lines = [_carteShareHeader(), ''];
  for (const catKey of cat.category_order) {
    lines.push(_carteShareCatLine(cat, catKey));
    const qtyByKey = new Map();
    for (const p of profiles) {
      for (const it of p.byCat[catKey] || []) {
        qtyByKey.set(it.key, (qtyByKey.get(it.key) || 0) + it.qty);
      }
    }
    const items = cat.cards
      .filter((c) => c.category === catKey && qtyByKey.has(c.key))
      .map((c) => ({ name_it: c.name_it, qty: qtyByKey.get(c.key) }));
    if (!items.length) lines.push('(nessun doppione)');
    else for (const it of items) lines.push(`• ${it.name_it} x${it.qty}`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function buildCarteDupesText(format) {
  if (format === 'b') return buildCarteDupesTextB();
  if (format === 'c') return buildCarteDupesTextC();
  return buildCarteDupesTextA();
}

function _carteInlineNotice(msg) {
  document.getElementById('carte-inline-notice')?.remove();
  const el = document.createElement('div');
  el.id = 'carte-inline-notice';
  el.className = 'carte-inline-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${escH(msg)}</span><button type="button" class="modal-close" aria-label="Chiudi" onclick="this.parentElement.remove()">✕</button>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function _openCarteShareDupes(format) {
  const cat = window._cardEventCatalog;
  const data = window._cardEventData;
  if (!cat || !data || !(data.profiles || []).length) {
    _carteInlineNotice('Nessun profilo CoC con collezione da condividere.');
    return;
  }
  const fmt = ['a', 'b', 'c'].includes(format) ? format : (window._carteShareFormat || 'a');
  window._carteShareFormat = fmt;
  const text = buildCarteDupesText(fmt);
  document.getElementById('carte-share-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'carte-share-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1000';
  modal.innerHTML = `
    <div class="modal-box carte-share-modal-box" role="dialog" aria-modal="true" aria-labelledby="carte-share-title">
      <div class="modal-header">
        <h2 id="carte-share-title" style="font-size:1rem">📋 Condividi doppioni</h2>
        <button type="button" class="modal-close" onclick="document.getElementById('carte-share-modal')?.remove()" aria-label="Chiudi">✕</button>
      </div>
      <div class="carte-share-body">
        <p class="carte-share-hint">Scegli il formato, poi copia il testo da incollare su WhatsApp, Telegram o Discord.</p>
        <div class="carte-share-formats" role="group" aria-label="Formato messaggio">
          <button type="button" class="carte-share-fmt-btn ${fmt === 'a' ? 'active' : ''}" onclick="_openCarteShareDupes('a')">A · Per profilo</button>
          <button type="button" class="carte-share-fmt-btn ${fmt === 'b' ? 'active' : ''}" onclick="_openCarteShareDupes('b')">B · Con profilo</button>
          <button type="button" class="carte-share-fmt-btn ${fmt === 'c' ? 'active' : ''}" onclick="_openCarteShareDupes('c')">C · Solo carte</button>
        </div>
        <p class="carte-share-fmt-desc">${
          fmt === 'a' ? 'Un blocco per ogni villaggio, categorie sotto.'
            : fmt === 'b' ? 'Elenco unico per categoria; il profilo è tra parentesi.'
            : 'Solo carte; le quantità dei profili sono sommate.'
        }</p>
        <textarea id="carte-share-preview" class="carte-share-preview" readonly rows="14"></textarea>
        <div class="carte-row-actions">
          <button type="button" class="btn-primary" id="carte-share-copy-btn" onclick="_copyCarteShareDupes()">Copia negli appunti</button>
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  const ta = document.getElementById('carte-share-preview');
  if (ta) ta.value = text;
}

async function _copyCarteShareDupes() {
  const ta = document.getElementById('carte-share-preview');
  const btn = document.getElementById('carte-share-copy-btn');
  if (!ta) return;
  const text = ta.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      ta.focus();
      ta.select();
      document.execCommand('copy');
    }
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = '✓ Copiato';
      setTimeout(() => { if (btn) btn.textContent = prev; }, 1800);
    }
  } catch (_) {
    ta.focus();
    ta.select();
    _carteInlineNotice('Seleziona il testo e copialo con Ctrl+C / Cmd+C.');
  }
}

function renderCardEventAdminToggle(settings) {
  const live = settings?.enabled === true;
  return `
    <div class="carte-admin-toggle">
      <span>Evento attivo globalmente:</span>
      <button type="button" class="btn-secondary btn-sm" onclick="_toggleCardEventEnabled(${!live})">
        ${live ? 'Disattiva' : 'Riattiva'}
      </button>
    </div>`;
}

async function _toggleCardEventEnabled(nextEnabled) {
  try {
    await profilesApi('cards-admin-toggle', { method: 'POST', body: { enabled: nextEnabled } });
    window._cardEventCatalog = null;
    await loadCardEventTab();
  } catch (e) {
    alert(e.message || 'Errore aggiornamento evento.');
  }
}

function _onCardEventClick(cardKey) {
  const cat = window._cardEventCatalog;
  const tag = window._cardEventActiveTag;
  if (!cat || !tag) return;
  if (!cat.settings?.live) { alert('Evento non attivo: sezione in sola lettura.'); return; }
  const card = cat.cards.find(c => c.key === cardKey);
  if (!card) return;
  const coll = (window._cardEventData?.collections && window._cardEventData.collections[tag]) || {};
  const qty = coll[cardKey] || 0;
  _openCardQtyModal(card, qty);
}

window._carteQtyModalState = null; // { card, qty (pendente, non ancora salvata) }

function _openCardQtyModal(card, qty) {
  document.getElementById('carte-qty-modal')?.remove();
  window._carteQtyModalState = { card, qty: Number(qty) || 0 };
  const modal = document.createElement('div');
  modal.id = 'carte-qty-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1000';
  modal.innerHTML = `
    <div class="modal-box carte-qty-modal-box" style="max-width:340px;width:100%">
      <div class="modal-header">
        <h2 style="font-size:1rem">${escH(card.name_it)}</h2>
        <button class="modal-close" onclick="document.getElementById('carte-qty-modal').remove()">✕</button>
      </div>
      <div class="carte-qty-modal-body">
        <img src="${escH(card.icon_url)}" alt="" class="carte-qty-modal-img" onerror="this.style.visibility='hidden'">
        <p class="carte-qty-modal-hint">Quante copie possiedi di questa carta?</p>
        <div class="carte-qty-stepper">
          <button type="button" class="carte-qty-step-btn" onclick="_adjustCardQtyModal(-1)">−</button>
          <div class="carte-qty-stepper-value" id="carte-qty-value">0</div>
          <button type="button" class="carte-qty-step-btn" onclick="_adjustCardQtyModal(1)">+</button>
        </div>
        <p class="carte-qty-modal-note" id="carte-qty-note"></p>
        <div class="carte-qty-modal-actions">
          <button type="button" class="btn-secondary" onclick="document.getElementById('carte-qty-modal').remove()">Annulla</button>
          <button type="button" class="btn-primary" onclick="_onCardEventSetQty()">Salva</button>
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  _renderCardQtyModalValue();
}

function _adjustCardQtyModal(delta) {
  const st = window._carteQtyModalState;
  if (!st) return;
  st.qty = Math.max(0, Math.min(99, st.qty + delta));
  _renderCardQtyModalValue();
}

function _renderCardQtyModalValue() {
  const st = window._carteQtyModalState;
  if (!st) return;
  const valEl = document.getElementById('carte-qty-value');
  const noteEl = document.getElementById('carte-qty-note');
  if (valEl) valEl.textContent = String(st.qty);
  if (noteEl) {
    noteEl.textContent = st.qty === 0
      ? 'Non la possiedi — verrà rimossa dalla collezione.'
      : st.qty === 1
        ? 'La possiedi: 1 sola copia (non scambiabile).'
        : `Hai ${st.qty} copie: doppioni scambiabili con altri giocatori.`;
  }
}

async function _onCardEventSetQty() {
  const st = window._carteQtyModalState;
  const cat = window._cardEventCatalog;
  const tag = window._cardEventActiveTag;
  if (!st || !cat || !tag) return;
  const { card, qty } = st;
  document.getElementById('carte-qty-modal')?.remove();
  try {
    await profilesApi('cards-save', { method: 'POST', body: { coc_tag: tag, card_key: card.key, qty_state: qty } });
    if (!window._cardEventData.collections[tag]) window._cardEventData.collections[tag] = {};
    window._cardEventData.collections[tag][card.key] = qty;
    renderCardEventContent();
  } catch (e) {
    alert(e.message || 'Errore salvataggio carta.');
  }
}

// ── Evento "Clash of Cards" — Fase 2: scambio, room, chat ─────────────────────
window._cardTradeData = null; // { matches, selfMatches, rooms }

async function cardsApi(type, { method = 'GET', body = null, params = null } = {}) {
  const headers = await authBearerHeaders();
  let url = `/api/lookup?type=${encodeURIComponent(type)}`;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }
  }
  const opts = { method, headers };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || `HTTP ${r.status}`);
    err.code = j.code;
    throw err;
  }
  return j;
}

function _switchCarteMainTab(tab, btn) {
  document.getElementById('carte-content').style.display = tab === 'collezione' ? 'block' : 'none';
  document.getElementById('carte-trade-content').style.display = tab === 'scambi' ? 'block' : 'none';
  document.querySelectorAll('#tab-carte > .subtab-bar .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'scambi') loadCardTradeTab();
}

window._carteTradeSub = null; // 'self' | 'public'
window._cartePublicWin = 'suggested'; // 'suggested' | 'albums-mine' | 'rooms'
window._carteAlbumFilter = 'all'; // 'all' | category key
window._carteAlbumCollapsed = window._carteAlbumCollapsed || {}; // id -> true se ridotto

function _switchCarteTradeSub(sub, btn) {
  window._carteTradeSub = sub;
  if (sub === 'public') window._cartePublicWin = 'suggested';
  const selfBox = document.getElementById('carte-trade-self');
  const pubBox = document.getElementById('carte-trade-public');
  if (selfBox) selfBox.style.display = sub === 'self' ? 'block' : 'none';
  if (pubBox) pubBox.style.display = sub === 'public' ? 'block' : 'none';
  document.querySelectorAll('#carte-trade-subtabs .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'public') _renderCartePublicWindow();
}

function _openCartePublicWin(win) {
  window._cartePublicWin = (win && win !== 'hub' && win !== 'albums-hub' && win !== 'albums-others') ? win : 'suggested';
  _renderCartePublicWindow();
}

function _activeCardProfileId() {
  const tag = window._cardEventActiveTag;
  const profiles = window._cardEventData?.profiles || [];
  return profiles.find(p => p.coc_tag === tag)?.id || null;
}

async function loadCardTradeTab() {
  const box = document.getElementById('carte-trade-content');
  if (!box) return;
  const profileId = _activeCardProfileId();
  if (!profileId) {
    box.innerHTML = `<div class="profilo-empty"><p style="color:var(--text-3)">Collega un villaggio da "Profili" per usare gli scambi.</p></div>`;
    return;
  }
  const keepWin = window._cartePublicWin;
  const keepSub = window._carteTradeSub;
  box.innerHTML = '<div class="profilo-empty"><p style="color:var(--text-3)">Caricamento…</p></div>';
  try {
    const profiles = window._cardEventData?.profiles || [];
    // Nessun profile_id: aggrega gli scambi suggeriti su TUTTI i profili CoC collegati
    // (ogni match indica con quale mio profilo si applica), senza dover scegliere un
    // profilo "attivo" a priori.
    const [matches, selfMatches, rooms, publicDecks, p2pTriangles, selfTriangles, triangleProposals] = await Promise.all([
      cardsApi('cards-matches'),
      profiles.length > 1 ? cardsApi('cards-self-matches') : Promise.resolve({ matches: [] }),
      cardsApi('cards-rooms'),
      cardsApi('cards-public-list'),
      cardsApi('cards-triangles'),
      profiles.length >= 3 ? cardsApi('cards-triangles-self') : Promise.resolve({ triangles: [] }),
      cardsApi('cards-triangle-proposals'),
    ]);
    window._cardTradeData = {
      matches: matches.matches || [],
      selfMatches: selfMatches.matches || [],
      rooms: rooms.rooms || [],
      p2pTriangles: p2pTriangles.triangles || [],
      selfTriangles: selfTriangles.triangles || [],
      triangleProposals: triangleProposals.proposals || [],
    };
    window._cardPublicData = { myPublic: publicDecks.my_public === true, decks: publicDecks.decks || [] };
  } catch (e) {
    box.innerHTML = `<div class="profilo-empty"><p style="color:var(--red)">Errore caricamento scambi: ${escH(e.message || '')}</p></div>`;
    return;
  }
  if (keepSub) window._carteTradeSub = keepSub;
  if (keepWin && keepWin !== 'hub' && keepWin !== 'albums-hub' && keepWin !== 'albums-others') {
    window._cartePublicWin = keepWin;
  } else {
    window._cartePublicWin = 'suggested';
  }
  renderCardTradeContent();
}

function _cardMiniImg(meta) {
  if (!meta) return '';
  return `<img src="${escH(meta.icon_url)}" alt="${escH(meta.name_it)}" class="carte-trade-card-icon" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

function _carteTriangleRowHtml(t, idx, { selfMode = false, live = false } = {}) {
  const nA = escH(t.profile_a?.username || t.profile_a?.coc_tag || 'A');
  const nB = escH(t.profile_b?.username || t.profile_b?.coc_tag || 'B');
  const nC = escH(t.profile_c?.username || t.profile_c?.coc_tag || 'C');
  const cA = escH(t.card_a_gives_meta?.name_it || t.card_a_gives);
  const cB = escH(t.card_b_gives_meta?.name_it || t.card_b_gives);
  const cC = escH(t.card_c_gives_meta?.name_it || t.card_c_gives);
  const prefer = t.prefer_score >= 1 ? ' · preferito (×3+)' : '';
  const actions = live
    ? (selfMode
      ? `<button type="button" class="btn-secondary btn-sm" onclick="_applySelfTriangle(${idx})">⚡ Applica subito</button>`
      : `<button type="button" class="btn-primary btn-sm" onclick="_proposeTriangle(${idx})">💬 Proponi triangolo</button>`)
    : '';
  return `<div class="carte-self-row semaforo-green carte-triangle-row">
    <div class="carte-self-row-header">
      <span class="carte-self-row-players">🔀 Triangolo · ${nA} → ${nC} → ${nB} → ${nA}</span>
      <span class="carte-self-row-dot" title="Ciclo a tre: tutti sbloccano una carta nuova">🟢</span>
    </div>
    <div class="carte-triangle-legs">
      <div class="carte-self-row-item">${_cardMiniImg(t.card_a_gives_meta)}<div><div class="carte-self-row-card-name">${nA} cede ${cA}</div><div class="carte-self-row-sub">${nC} riceve</div></div></div>
      <div class="carte-self-row-item">${_cardMiniImg(t.card_b_gives_meta)}<div><div class="carte-self-row-card-name">${nB} cede ${cB}</div><div class="carte-self-row-sub">${nA} riceve</div></div></div>
      <div class="carte-self-row-item">${_cardMiniImg(t.card_c_gives_meta)}<div><div class="carte-self-row-card-name">${nC} cede ${cC}</div><div class="carte-self-row-sub">${nB} riceve</div></div></div>
    </div>
    <div class="carte-qty-modal-note" style="text-align:left;margin:0.35rem 0">${prefer ? `Variante A${prefer}` : 'Ciclo valido (qty ≥ 2)'}</div>
    <div class="carte-row-actions">${actions}</div>
  </div>`;
}

async function _applySelfTriangle(idx) {
  const t = window._cardTradeData?.selfTriangles?.[idx];
  if (!t) return;
  try {
    await cardsApi('cards-triangle-self-apply', {
      method: 'POST',
      body: {
        profile_a: t.profile_a.id,
        profile_b: t.profile_b.id,
        profile_c: t.profile_c.id,
        card_a_gives: t.card_a_gives,
        card_b_gives: t.card_b_gives,
        card_c_gives: t.card_c_gives,
      },
    });
    _carteInlineNotice('✅ Triangolo applicato ai tuoi profili.', 2500);
    window._cardEventData = await cardsApi('cards-get');
    renderCardEventContent();
    await loadCardTradeTab();
  } catch (e) {
    _carteInlineNotice('❌ ' + (e.message || 'Errore triangolo.'), 3500);
  }
}

async function _proposeTriangle(idx) {
  const t = window._cardTradeData?.p2pTriangles?.[idx];
  if (!t) return;
  const createdBy = t.my_profile?.id || t.profile_a?.id;
  try {
    await cardsApi('cards-triangle-propose', {
      method: 'POST',
      body: {
        profile_a: t.profile_a.id,
        profile_b: t.profile_b.id,
        profile_c: t.profile_c.id,
        card_a_gives: t.card_a_gives,
        card_b_gives: t.card_b_gives,
        card_c_gives: t.card_c_gives,
        created_by: createdBy,
      },
    });
    _carteInlineNotice('✅ Triangolo proposto: in attesa delle altre accettazioni.', 3000);
    await loadCardTradeTab();
  } catch (e) {
    _carteInlineNotice('❌ ' + (e.message || 'Errore proposta.'), 3500);
  }
}

async function _respondTriangle(triangleId, action) {
  try {
    const r = await cardsApi('cards-triangle-respond', {
      method: 'POST',
      body: { triangle_id: triangleId, action },
    });
    if (r.status === 'accepted') _carteInlineNotice('✅ Triangolo completato!', 2500);
    else if (r.status === 'pending') _carteInlineNotice('✅ Accettato: in attesa degli altri.', 2500);
    else _carteInlineNotice('Proposta aggiornata.', 2000);
    if (r.status === 'accepted') {
      window._cardEventData = await cardsApi('cards-get');
      renderCardEventContent();
    }
    await loadCardTradeTab();
  } catch (e) {
    _carteInlineNotice('❌ ' + (e.message || 'Errore.'), 3500);
  }
}

function _carteTriangleProposalsHtml(live) {
  const list = window._cardTradeData?.triangleProposals || [];
  if (!list.length) return '';
  const rows = list.map((p) => {
    const nA = escH(p.profile_a?.username || p.profile_a?.coc_tag || 'A');
    const nB = escH(p.profile_b?.username || p.profile_b?.coc_tag || 'B');
    const nC = escH(p.profile_c?.username || p.profile_c?.coc_tag || 'C');
    const accepted = [p.accept_a, p.accept_b, p.accept_c].filter(Boolean).length;
    const myAccepted = p.my_role === 'a' ? p.accept_a : p.my_role === 'b' ? p.accept_b : p.accept_c;
    const isCreator = p.created_by === p.my_profile_id || p.created_by_profile?.id === p.my_profile_id;
    return `<div class="carte-self-row">
      <div class="carte-self-row-header">
        <span class="carte-self-row-players">🔀 Proposta triangolo · ${nA} / ${nB} / ${nC}</span>
        <span class="carte-room-badge">${accepted}/3</span>
      </div>
      <div class="carte-qty-modal-note" style="text-align:left">
        ${escH(p.card_a_gives_meta?.name_it || p.card_a_gives)} → ${nC} ·
        ${escH(p.card_b_gives_meta?.name_it || p.card_b_gives)} → ${nA} ·
        ${escH(p.card_c_gives_meta?.name_it || p.card_c_gives)} → ${nB}
      </div>
      ${live ? `<div class="carte-row-actions">
        ${!myAccepted ? `<button type="button" class="btn-primary btn-sm" onclick="_respondTriangle('${p.id}','accept')">✅ Accetta</button>
        <button type="button" class="btn-secondary btn-sm" onclick="_respondTriangle('${p.id}','reject')">✕ Rifiuta</button>` : '<span class="carte-committed-badge">Hai già accettato</span>'}
        ${isCreator ? `<button type="button" class="btn-secondary btn-sm" onclick="_respondTriangle('${p.id}','cancel')">Annulla</button>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');
  return `<div class="carte-trade-section"><h4 class="carte-win-title" style="font-size:0.95rem;margin-bottom:0.5rem">Proposte triangolo in corso</h4>${rows}</div>`;
}

function renderCardTradeContent() {
  const box = document.getElementById('carte-trade-content');
  if (!box) return;
  const data = window._cardTradeData;
  const cat = window._cardEventCatalog;
  if (!box || !data || !cat) return;
  const live = cat.settings?.live === true;
  const multiProfiles = (window._cardEventData?.profiles?.length || 0) > 1;

  if (!window._carteTradeSub || (!multiProfiles && window._carteTradeSub === 'self')) {
    window._carteTradeSub = multiProfiles ? 'self' : 'public';
  }
  if (!window._cartePublicWin || window._cartePublicWin === 'hub' || window._cartePublicWin === 'albums-hub' || window._cartePublicWin === 'albums-others') {
    window._cartePublicWin = 'suggested';
  }
  const sub = window._carteTradeSub;
  const f = _carteGetFilters();

  const filteredSelf = (data.selfMatches || []).filter((m) => {
    if (f.category !== 'all' && m.category && m.category !== f.category) {
      const catGive = m.card_a_to_b_meta?.category || m.category;
      const catGet = m.card_b_to_a_meta?.category || m.category;
      if (f.category !== catGive && f.category !== catGet) return false;
    }
    if (f.q) {
      const a = m.card_a_to_b_meta || { name_it: m.card_a_to_b, key: m.card_a_to_b };
      const b = m.card_b_to_a_meta || { name_it: m.card_b_to_a, key: m.card_b_to_a };
      if (f.direction === 'give') {
        // In self non c'è un "mio" lato unico: match se una delle due carte corrisponde
        if (!_carteCardTextMatch(a, f.q) && !_carteCardTextMatch(b, f.q)) return false;
      } else if (f.direction === 'get') {
        if (!_carteCardTextMatch(a, f.q) && !_carteCardTextMatch(b, f.q)) return false;
      } else if (!_carteCardTextMatch(a, f.q) && !_carteCardTextMatch(b, f.q)) {
        return false;
      }
    }
    return true;
  });

  const selfHtml = filteredSelf.length
    ? filteredSelf.map((m) => {
        const i = data.selfMatches.indexOf(m);
        const nameA = escH(m.profile_a.username || m.profile_a.coc_tag);
        const nameB = escH(m.profile_b.username || m.profile_b.coc_tag);
        const cardAB = escH(m.card_a_to_b_meta?.name_it || m.card_a_to_b);
        const cardBA = escH(m.card_b_to_a_meta?.name_it || m.card_b_to_a);
        const aIsNew = m.a_is_new !== false;
        const bIsNew = m.b_is_new !== false;
        const bothNew = aIsNew && bIsNew;
        const dot = bothNew ? '🟢' : '🟡';
        const dotTitle = bothNew
          ? 'Scambio utile: entrambi sbloccano una carta nuova'
          : 'Scambio possibile ma non necessario: uno o entrambi possiedono già la carta che riceverebbero';
        return `
      <div class="carte-self-row ${bothNew ? 'semaforo-green' : 'semaforo-yellow'}">
        <div class="carte-self-row-header">
          <span class="carte-self-row-players">${nameA} <span class="carte-match-arrow">⇄</span> ${nameB}</span>
          <span class="carte-self-row-dot" title="${escH(dotTitle)}">${dot}</span>
        </div>
        <div class="carte-self-row-cols">
          <div class="carte-self-row-col">
            <div class="carte-self-row-col-label">📤 Da offrire</div>
            <div class="carte-self-row-item">
              ${_cardMiniImg(m.card_a_to_b_meta)}
              <div><div class="carte-self-row-card-name">${cardAB}</div><div class="carte-self-row-sub">${nameA} cede</div></div>
            </div>
            <div class="carte-self-row-item">
              ${_cardMiniImg(m.card_b_to_a_meta)}
              <div><div class="carte-self-row-card-name">${cardBA}</div><div class="carte-self-row-sub">${nameB} cede</div></div>
            </div>
          </div>
          <div class="carte-self-row-col">
            <div class="carte-self-row-col-label">📥 Da ricevere</div>
            <div class="carte-self-row-item">
              ${_cardMiniImg(m.card_b_to_a_meta)}
              <div><div class="carte-self-row-card-name">${cardBA} ${aIsNew ? '🟢' : '🟡'}</div><div class="carte-self-row-sub">${nameA} riceve${aIsNew ? '' : ' (già posseduta)'}</div></div>
            </div>
            <div class="carte-self-row-item">
              ${_cardMiniImg(m.card_a_to_b_meta)}
              <div><div class="carte-self-row-card-name">${cardAB} ${bIsNew ? '🟢' : '🟡'}</div><div class="carte-self-row-sub">${nameB} riceve${bIsNew ? '' : ' (già posseduta)'}</div></div>
            </div>
          </div>
        </div>
        ${live ? `<button type="button" class="btn-secondary btn-sm" onclick="_openSelfTradeConfirmModal(${i})">Applica subito</button>` : ''}
      </div>`;
      }).join('')
    : `<div class="profilo-empty"><p style="color:var(--text-3)">${_carteFiltersActive() ? 'Nessuno scambio tra i tuoi profili con questi filtri.' : 'Nessuno scambio disponibile tra i tuoi profili collegati.'}</p></div>`;

  const selfTrianglesHtml = (data.selfTriangles || []).length
    ? (data.selfTriangles || []).map((t, i) => _carteTriangleRowHtml(t, i, { selfMode: true, live })).join('')
    : '';

  const subtabs = `
    <div class="subtab-bar" id="carte-trade-subtabs">
      ${multiProfiles ? `<button type="button" class="subtab-btn ${sub === 'self' ? 'active' : ''}" onclick="_switchCarteTradeSub('self',this)">Tra i tuoi profili</button>` : ''}
      <button type="button" class="subtab-btn ${sub === 'public' ? 'active' : ''}" onclick="_switchCarteTradeSub('public',this)">Scambi suggeriti</button>
    </div>`;

  box.innerHTML = `
    ${!live ? `<div class="profilo-empty" style="margin-bottom:1rem"><p style="color:var(--text-3)">⚠️ Evento in sola lettura: non è più possibile proporre o applicare nuovi scambi.</p></div>` : ''}
    ${_carteSearchBarHtml({ showTradeExtras: true })}
    ${subtabs}
    <div id="carte-trade-self" style="display:${sub === 'self' && multiProfiles ? 'block' : 'none'}">
      <div class="carte-trade-section">
        <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.7rem">
          🟢 sblocca una carta nuova · 🟡 possibile ma non necessario (già posseduta). Solo se hai 2+ profili CoC collegati.
        </p>
        ${selfHtml}
        ${selfTrianglesHtml ? `<h4 class="carte-win-title" style="font-size:0.95rem;margin:1rem 0 0.5rem">🔀 Triangoli tra i tuoi profili</h4>
        <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.5rem">Ciclo a 3 profili: Applica subito senza accettazioni multiple.</p>
        ${selfTrianglesHtml}` : ''}
      </div>
    </div>
    <div id="carte-trade-public" style="display:${sub === 'public' ? 'block' : 'none'}"></div>
  `;
  if (sub === 'public') _renderCartePublicWindow();
}

function _cartePublicWinHeader(title, backWin = 'suggested') {
  return `<div class="carte-win-header">
    <button type="button" class="btn-secondary btn-sm carte-win-back" onclick="_openCartePublicWin('${escH(backWin)}')">« Indietro</button>
    <h3 class="carte-win-title">${escH(title)}</h3>
  </div>`;
}

/** Filtra un match P2P (tu cedi card_give / ricevi card_get) rispetto ai filtri correnti. */
function _carteMatchPassesFilters(m, f) {
  if (f.playerQ) {
    const hay = _carteNormSearch([m.other_profile?.username, m.other_profile?.coc_tag, m.my_profile?.username, m.my_profile?.coc_tag].filter(Boolean).join(' '));
    if (!hay.includes(_carteNormSearch(f.playerQ))) return false;
  }
  if (f.category !== 'all') {
    const catKey = m.category || m.card_give_meta?.category || m.card_get_meta?.category;
    if (catKey && catKey !== f.category) return false;
  }
  if (f.q) {
    const give = m.card_give_meta || { name_it: m.card_give, key: m.card_give, category: m.category };
    const get = m.card_get_meta || { name_it: m.card_get, key: m.card_get, category: m.category };
    if (f.direction === 'give') {
      if (!_carteCardTextMatch(give, f.q)) return false;
    } else if (f.direction === 'get') {
      if (!_carteCardTextMatch(get, f.q)) return false;
    } else if (!_carteCardTextMatch(give, f.q) && !_carteCardTextMatch(get, f.q)) {
      return false;
    }
  } else if (f.direction === 'give' || f.direction === 'get') {
    // Senza testo: il verso da solo non nasconde i match (sono già scambi bilanciati).
  }
  return true;
}

/** Un mazzo pubblico è rilevante per i filtri (giocatore / carta / match). */
function _carteDeckPassesFilters(deck, f, cat) {
  const p = deck.profile || {};
  if (f.playerQ) {
    const hay = _carteNormSearch([p.username, p.coc_tag, p.coc_clan_name].filter(Boolean).join(' '));
    if (!hay.includes(_carteNormSearch(f.playerQ))) return false;
  }
  if (f.onlyMatches && !(deck.matches || []).length) return false;
  const matchesFiltered = (deck.matches || []).filter((m) => _carteMatchPassesFilters({ ...m, other_profile: p }, f));
  if (f.onlyMatches && !matchesFiltered.length) return false;

  const coll = deck.collection || {};
  const cardSearch = !!(f.q || f.direction !== 'any' || f.category !== 'all' || f.qty !== 'all' || f.onlyTradable);
  if (!cardSearch) return true;

  // Carta cercata sul mazzo altrui: Cedere (dal tuo punto di vista) → loro manca la carta
  // che tu potresti dare; Ricevere → loro hanno doppione della carta che ti manca.
  const cards = (cat?.cards || []).filter((c) => {
    if (f.category !== 'all' && c.category !== f.category) return false;
    if (!_carteCardTextMatch(c, f.q)) return false;
    return true;
  });
  if (!f.q && f.direction === 'any' && f.category === 'all' && !f.onlyTradable && f.qty === 'all') return true;

  if (matchesFiltered.length) return true;

  for (const c of cards) {
    const qty = coll[c.key] || 0;
    if (f.direction === 'give') {
      // Tu cedi: loro devono NON avere la carta (mancante)
      if (qty === 0) return true;
    } else if (f.direction === 'get') {
      // Tu ricevi: loro devono avere doppione
      if (qty >= 2) return true;
    } else {
      if (f.onlyTradable || f.qty === '2') { if (qty >= 2) return true; }
      else if (f.qty === '0') { if (qty === 0) return true; }
      else if (f.qty === '1') { if (qty === 1) return true; }
      else if (qty >= 0) return true;
    }
  }
  // Se c'è solo filtro giocatore già passato sopra
  if (!f.q && f.direction === 'any' && !f.onlyTradable && f.qty === 'all' && f.category === 'all') return true;
  return false;
}

function _carteDeckHighlightKeys(deck, f, cat) {
  const coll = deck.collection || {};
  const keys = new Set();
  const hasCardFilter = !!(f.q || f.direction !== 'any' || f.onlyTradable || f.qty !== 'all' || f.category !== 'all');
  if (!hasCardFilter) {
    // Solo player/match: evidenzia comunque le carte dei match filtrati
    for (const m of deck.matches || []) {
      if (!_carteMatchPassesFilters({ ...m, other_profile: deck.profile }, f)) continue;
      if (m.card_give) keys.add(m.card_give);
      if (m.card_get) keys.add(m.card_get);
    }
    return keys;
  }
  for (const c of cat?.cards || []) {
    if (f.category !== 'all' && c.category !== f.category) continue;
    if (f.q && !_carteCardTextMatch(c, f.q)) continue;
    const qty = coll[c.key] || 0;
    let ok = true;
    if (f.direction === 'give') ok = qty === 0;
    else if (f.direction === 'get') ok = qty >= 2;
    else if (f.onlyTradable || f.qty === '2') ok = qty >= 2;
    else if (f.qty === '0') ok = qty === 0;
    else if (f.qty === '1') ok = qty === 1;
    else ok = true; // solo testo/tipologia: evidenzia tutte le carte matchate
    if (ok) keys.add(c.key);
  }
  for (const m of deck.matches || []) {
    if (!_carteMatchPassesFilters({ ...m, other_profile: deck.profile }, f)) continue;
    if (m.card_give) keys.add(m.card_give);
    if (m.card_get) keys.add(m.card_get);
  }
  return keys;
}

function _formatLastModified(isoStr) {
  if (!isoStr) return null;
  try {
    return new Date(isoStr).toLocaleString('it-IT', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return null; }
}

function _renderCartePublicWindow() {
  const box = document.getElementById('carte-trade-public');
  if (!box) return;
  const data = window._cardTradeData;
  const live = window._cardEventCatalog?.settings?.live === true;
  const win = window._cartePublicWin || 'suggested';
  const myProfiles = window._cardEventData?.profiles || [];

  if (win === 'suggested') {
    const multiMine = myProfiles.length > 1;
    const f = _carteGetFilters();
    const filtered = (data?.matches || [])
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => _carteMatchPassesFilters(m, f));
    const matchesHtml = filtered.length
      ? filtered.map(({ m, i }) => `
        <div class="carte-self-row semaforo-green">
          <div class="carte-self-row-header">
            <span class="carte-self-row-players">con ${escH(m.other_profile?.username || m.other_profile?.coc_tag || '—')}</span>
            <span class="carte-self-row-dot" title="Scambio utile: entrambi sbloccano una carta nuova">🟢</span>
          </div>
          ${multiMine ? `<div class="carte-match-my-profile">👤 con il tuo profilo: <strong>${escH(m.my_profile?.username || m.my_profile?.coc_tag || '—')}</strong></div>` : ''}
          <div class="carte-self-row-cols">
            <div class="carte-self-row-col">
              <div class="carte-self-row-col-label">📤 Cedi</div>
              <div class="carte-self-row-item">
                ${_cardMiniImg(m.card_give_meta)}
                <div><div class="carte-self-row-card-name">${escH(m.card_give_meta?.name_it || m.card_give)}</div><div class="carte-self-row-sub">il tuo doppione</div></div>
              </div>
            </div>
            <div class="carte-self-row-col">
              <div class="carte-self-row-col-label">📥 Ricevi</div>
              <div class="carte-self-row-item">
                ${_cardMiniImg(m.card_get_meta)}
                <div><div class="carte-self-row-card-name">${escH(m.card_get_meta?.name_it || m.card_get)} 🟢</div><div class="carte-self-row-sub">carta nuova per te</div></div>
              </div>
            </div>
          </div>
          ${live ? `<div class="carte-row-actions">
            <button type="button" class="btn-secondary btn-sm" onclick="_applyFromMatch(${i})" title="Cedi subito il tuo doppione; l'altro vedrà che hai già confermato">⚡ Applica subito</button>
            <button type="button" class="btn-primary btn-sm" onclick="_proposeFromMatch(${i})">💬 Proponi scambio</button>
          </div>` : ''}
        </div>`).join('')
      : `<div class="profilo-empty"><p style="color:var(--text-3)">${_carteFiltersActive()
        ? 'Nessuno scambio suggerito con questi filtri.'
        : 'Nessuno scambio automatico con mazzi pubblici al momento. Serve: tu hai un doppione che all’altro manca, e lui ha un doppione (stessa tipologia) che manca a te.'}</p></div>`;
    const trianglesHtml = (data?.p2pTriangles || []).length
      ? (data.p2pTriangles || []).map((t, i) => _carteTriangleRowHtml(t, i, { selfMode: false, live })).join('')
      : '';
    const nRooms = data?.rooms?.length || 0;
    const nPending = (data?.rooms || []).reduce((s, r) => s + (r.pending_proposals || 0), 0);
    const quickLinks = `<div style="margin-bottom:0.6rem">
      <button type="button" class="btn-secondary btn-sm" onclick="_openCartePublicWin('albums-mine')">👤 I tuoi mazzi</button>
      <button type="button" class="btn-secondary btn-sm" style="margin-left:0.4rem" onclick="_openCartePublicWin('rooms')">💬 Conversazioni${nPending ? ` (${nPending})` : nRooms ? ` (${nRooms})` : ''}</button>
    </div>`;
    box.innerHTML = `
      <div class="carte-win-header" style="margin-bottom:0.2rem">
        <h3 class="carte-win-title" style="margin:0">Scambi suggeriti</h3>
      </div>
      <div class="carte-trade-section">
        ${quickLinks}
        <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.7rem">
          Match automatici: doppione ↔ carta mancante, stessa tipologia. Usa la barra di ricerca sopra per filtrare per carta o giocatore.
        </p>
        ${_carteTriangleProposalsHtml(live)}
        ${matchesHtml}
        ${trianglesHtml ? `<h4 class="carte-win-title" style="font-size:0.95rem;margin:1rem 0 0.5rem">🔀 Scambi a tre (triangoli)</h4>
        <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.5rem">Quando il 1↔1 non basta: ciclo a 3 profili. Proponi e attendi le altre due accettazioni.</p>
        ${trianglesHtml}` : ''}
      </div>
      <h4 class="carte-win-title" style="font-size:0.95rem;margin:1.2rem 0 0.3rem;padding:0 0.1rem">📚 Mazzi di altri giocatori</h4>
      ${_renderAlbumsWindow(live, 'others')}`;
    return;
  }

  if (win === 'rooms') {
    const roomsHtml = (data?.rooms || []).length
      ? data.rooms.map(r => {
          const preview = r.last_message ? escH((r.last_message.body || '').slice(0, 60)) : 'Nessun messaggio ancora';
          const pending = r.pending_proposals > 0 ? `<span class="carte-room-badge">${r.pending_proposals}</span>` : '';
          return `<button type="button" class="carte-room-item" onclick="_openCardRoom('${r.id}')">
            <div class="carte-room-name">${escH(r.other_profile?.username || r.other_profile?.coc_tag || '—')} ${pending}</div>
            <div class="carte-room-preview">${preview}</div>
          </button>`;
        }).join('')
      : `<div class="profilo-empty"><p style="color:var(--text-3)">Nessuna conversazione ancora.</p></div>`;
    box.innerHTML = `${_cartePublicWinHeader('Le tue conversazioni', 'suggested')}<div class="carte-trade-section">${roomsHtml}</div>`;
    return;
  }

  if (win === 'albums-mine') {
    box.innerHTML = `${_cartePublicWinHeader('I tuoi mazzi', 'suggested')}${_renderAlbumsWindow(live, 'mine')}`;
    return;
  }

  // Fallback → scambi suggeriti
  window._cartePublicWin = 'suggested';
  _renderCartePublicWindow();
}

function _renderFullAlbumGrid(collection, albumId, highlightKeys = null) {
  const cat = window._cardEventCatalog;
  if (!cat) return '';
  const f = _carteGetFilters();
  let filter = f.category && f.category !== 'all' ? f.category : (window._carteAlbumFilter || 'all');
  // Con ricerca testuale e tipologia "Tutte", mostra la categoria della prima hit evidenziata
  if (highlightKeys && highlightKeys.size && filter === 'all' && f.q) {
    const first = cat.cards.find((c) => highlightKeys.has(c.key));
    if (first) filter = first.category;
  }
  const cats = filter === 'all' ? cat.category_order : cat.category_order.filter((c) => c === filter);
  // Evidenzia solo se c'è effettivamente una ricerca testuale
  const searching = !!(highlightKeys && highlightKeys.size);
  // Filtraggio attivo se ci sono filtri qty/direction
  const hasActiveFilters = !!(f.qty !== 'all' || f.direction !== 'any' || f.onlyTradable);
  
  return cats.map((catKey) => {
    let cardsInCat = cat.cards.filter((c) => c.category === catKey);
    // Se ci sono filtri attivi, mostra solo le carte che passano
    if (hasActiveFilters) {
      cardsInCat = cardsInCat.filter((c) => {
        const qty = collection[c.key] || 0;
        if (!_cartePassesDirection(qty, f.direction)) return false;
        if (!_cartePassesQtyFilter(qty, f)) return false;
        return true;
      });
    }
    const found = cardsInCat.filter((c) => (collection[c.key] || 0) >= 1).length;
    const tiles = cardsInCat.map((c) => {
      const qty = collection[c.key] || 0;
      const stateCls = qty >= 2 ? 'state-2' : qty === 1 ? 'state-1' : 'state-0';
      const borderCls = CARTE_CAT_BORDER[c.category] || '';
      const isHit = searching && highlightKeys.has(c.key);
      // Rimuovo is-search-dim - tutte le carte si vedono sempre
      const hit = isHit ? 'is-search-hit' : '';
      return `<div class="carte-album-tile ${stateCls} ${borderCls} ${hit}" title="${escH(c.name_it)}${qty >= 2 ? ` ×${qty}` : qty === 1 ? ' (posseduta)' : ' (mancante)'}">
        <img src="${escH(c.icon_url)}" alt="${escH(c.name_it)}" loading="lazy" onerror="this.style.visibility='hidden'">
        ${qty >= 2 ? `<span class="carte-card-badge">x${qty}</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="carte-album-cat">
      <div class="carte-album-cat-label">
        <span class="carte-album-cat-dot ${CARTE_CAT_BORDER[catKey] || ''}"></span>
        ${escH(cat.category_label_it[catKey] || catKey)}
        <span class="carte-cat-count">${found}/${cardsInCat.length}</span>
      </div>
      <div class="carte-album-grid">${tiles}</div>
    </div>`;
  }).join('');
}

function _isAlbumCollapsed(albumId) {
  const map = window._carteAlbumCollapsed || {};
  if (Object.prototype.hasOwnProperty.call(map, albumId)) return !!map[albumId];
  // Default: tutti i mazzi in vista ridotta
  return true;
}

function _toggleAlbumCollapsed(albumId) {
  const map = window._carteAlbumCollapsed || (window._carteAlbumCollapsed = {});
  map[albumId] = !_isAlbumCollapsed(albumId);
  _renderCartePublicWindow();
}

function _setCarteAlbumFilter(catKey) {
  window._carteAlbumFilter = catKey || 'all';
  const f = _carteGetFilters();
  f.category = (catKey && catKey !== 'all') ? catKey : 'all';
  _renderCartePublicWindow();
}

function _renderAlbumsWindow(live, which = 'mine') {
  const cat = window._cardEventCatalog;
  const myProfiles = window._cardEventData?.profiles || [];
  const myCollections = window._cardEventData?.collections || {};
  const pub = window._cardPublicData || { decks: [] };
  const f = _carteGetFilters();
  if (f.category !== 'all') window._carteAlbumFilter = f.category;

  // Unica barra filtri è quella sopra in Scambi: qui solo legenda colori (senza secondo filtro).
  const legend = `
    <div class="carte-album-legend">
      <span><i class="carte-album-cat-dot cat-border-elixir"></i> Elisir</span>
      <span><i class="carte-album-cat-dot cat-border-dark"></i> Elisir nero</span>
      <span><i class="carte-album-cat-dot cat-border-builder"></i> Builder</span>
      <span><i class="carte-album-cat-dot cat-border-super"></i> Super truppe</span>
    </div>`;

  if (which === 'others') {
    const f = _carteGetFilters();
    const decks = (pub.decks || [])
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => _carteDeckPassesFilters(d, f, cat));
    const otherAlbums = decks.length
      ? decks.map(({ d, i }) => {
          const albumId = `other:${i}`;
          const highlightKeys = _carteDeckHighlightKeys(d, f, cat);
          const forceExpand = highlightKeys.size > 0 && _carteFiltersActive();
          const isCollapsed = forceExpand ? false : _isAlbumCollapsed(albumId);
          const p = d.profile;
          const coll = d.collection || {};
          const found = cat ? cat.cards.filter((c) => (coll[c.key] || 0) >= 1).length : 0;
          const total = cat?.total_cards || 0;
          const filteredMatches = (d.matches || []).filter((m) => _carteMatchPassesFilters({ ...m, other_profile: p }, f));
          const n = filteredMatches.length;
          const multiMine = myProfiles.length > 1;
          const deckTriangles = (window._cardTradeData?.p2pTriangles || [])
            .map((t, ti) => ({ t, ti }))
            .filter(({ t }) =>
              [t.profile_a?.id, t.profile_b?.id, t.profile_c?.id].includes(p.id),
            );
          const matchesPreview = (n || deckTriangles.length)
            ? `<div class="carte-album-matches">
                ${n ? `<div class="carte-album-matches-title">Possibili carte da scambiare · ${n}</div>
                ${filteredMatches.slice(0, 6).map((m) => {
                  const mi = (d.matches || []).indexOf(m);
                  return `
                  <div class="carte-album-match-row">
                    ${multiMine ? `<div class="carte-match-my-profile">👤 con il tuo profilo: <strong>${escH(m.my_profile?.username || m.my_profile?.coc_tag || '—')}</strong></div>` : ''}
                    <div class="carte-album-match-pair">
                      <div class="carte-album-match-side">
                        <span class="carte-album-match-lbl">Cedi</span>
                        ${_cardMiniImg(m.card_give_meta)}
                        <span>${escH(m.card_give_meta?.name_it || m.card_give)}</span>
                      </div>
                      <span class="carte-match-arrow">⇄</span>
                      <div class="carte-album-match-side">
                        <span class="carte-album-match-lbl">Ricevi</span>
                        ${_cardMiniImg(m.card_get_meta)}
                        <span>${escH(m.card_get_meta?.name_it || m.card_get)}</span>
                      </div>
                    </div>
                    ${live ? `<div class="carte-row-actions">
                      <button type="button" class="btn-secondary btn-sm" onclick="_applyFromPublicDeck(${i},${mi})" title="Cedi subito il tuo doppione; l'altro vedrà che hai già confermato">⚡ Applica subito</button>
                      <button type="button" class="btn-primary btn-sm" onclick="_proposeFromPublicDeck(${i},${mi})">💬 Proponi scambio</button>
                    </div>` : ''}
                  </div>`;
                }).join('')}
                ${n > 6 ? `<div class="carte-qty-modal-note" style="text-align:left;margin:0.35rem 0 0">+${n - 6} altri — apri chat o «Scambi suggeriti».</div>` : ''}` : ''}
                ${deckTriangles.length ? `<div class="carte-album-matches-title" style="margin-top:0.5rem">🔀 Triangoli che coinvolgono questo mazzo · ${deckTriangles.length}</div>
                ${deckTriangles.slice(0, 3).map(({ t, ti }) => _carteTriangleRowHtml(t, ti, { selfMode: false, live })).join('')}` : ''}
              </div>`
            : `<div class="carte-album-matches carte-album-matches-empty">${_carteFiltersActive() ? 'Nessuno scambio automatico con questi filtri.' : 'Nessuno scambio automatico con questo mazzo (serve doppione↔mancante, stessa tipologia).'}</div>`;
          const lastModStr = d.last_modified ? _formatLastModified(d.last_modified) : null;
          return `<div class="carte-album-card ${highlightKeys.size ? 'is-search-relevant' : ''}">
            <div class="carte-album-card-head">
              <div class="carte-album-card-title">
                <strong>${escH(p.username || p.coc_tag)}</strong>
                <span class="carte-album-card-meta">${found}/${total}${p.coc_clan_name ? ` · ${escH(p.coc_clan_name)}` : ''}${n ? ` · 🔄 ${n}` : ''}${lastModStr ? ` · agg. ${escH(lastModStr)}` : ''}</span>
              </div>
              <button type="button" class="btn-secondary btn-sm" onclick="_toggleAlbumCollapsed('${escH(albumId)}')">${isCollapsed ? 'Espandi' : 'Riduci'}</button>
              ${live ? `<button type="button" class="btn-primary btn-sm" onclick="_openPublicDeck(${i})">💬 Chat</button>` : ''}
            </div>
            ${matchesPreview}
            <div class="carte-album-card-body ${isCollapsed ? 'is-collapsed' : ''}">
              ${_renderFullAlbumGrid(coll, albumId, highlightKeys)}
            </div>
          </div>`;
        }).join('')
      : `<div class="profilo-empty"><p style="color:var(--text-3)">${_carteFiltersActive() ? 'Nessun mazzo corrisponde ai filtri.' : 'Nessun altro utente ha ancora inserito carte nella propria collezione.'}</p></div>`;
    const status = _carteFiltersActive()
      ? `<div class="carte-search-status">${decks.length} mazzo${decks.length === 1 ? '' : 'i'} con i filtri attivi · album evidenziato sulla tipologia cercata</div>`
      : '';
    return `
      <div class="carte-trade-section">
        ${legend}
        ${status}
        <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.7rem">
          Album pubblici con anteprima scambi. Usa i filtri sopra (tipologia / cedere / ricevere) — un’unica barra per tutta la sezione Scambi.
        </p>
        ${otherAlbums}
      </div>`;
  }

  const myAlbums = myProfiles.map((p) => {
    const albumId = `mine:${p.coc_tag}`;
    const isCollapsed = _isAlbumCollapsed(albumId);
    const coll = myCollections[p.coc_tag] || {};
    const found = cat ? cat.cards.filter(c => (coll[c.key] || 0) >= 1).length : 0;
    const total = cat?.total_cards || 0;
    return `<div class="carte-album-card">
      <div class="carte-album-card-head">
        <div class="carte-album-card-title">
          <strong>${escH(p.username || p.coc_tag)}</strong>
          <span class="carte-album-card-meta">${found}/${total} carte · 🌐 Mazzo pubblico</span>
        </div>
        <button type="button" class="btn-secondary btn-sm" onclick="_toggleAlbumCollapsed('${escH(albumId)}')">${isCollapsed ? 'Espandi' : 'Riduci'}</button>
      </div>
      <div class="carte-album-card-body ${isCollapsed ? 'is-collapsed' : ''}">
        ${_renderFullAlbumGrid(coll, albumId)}
      </div>
    </div>`;
  }).join('') || `<div class="profilo-empty"><p style="color:var(--text-3)">Nessun profilo CoC collegato.</p></div>`;

  return `
    <div class="carte-trade-section">
      ${legend}
      <p class="carte-qty-modal-note" style="text-align:left;margin-bottom:0.7rem">
        Scegli quali profili CoC rendere pubblici. L’album mostra tutto il catalogo: mancanti, possedute e doppioni. Di default ridotto.
      </p>
      ${myAlbums}
    </div>`;
}

async function _toggleProfileDeckPublic(profileId, isPublic) {
  if (!profileId) return;
  try {
    await cardsApi('cards-public-toggle', { method: 'POST', body: { profile_id: profileId, is_public: isPublic } });
    const p = (window._cardEventData?.profiles || []).find(x => x.id === profileId);
    if (p) p.card_deck_public = isPublic === true;
    if (profileId === _activeCardProfileId() && window._cardPublicData) {
      window._cardPublicData.myPublic = isPublic === true;
    }
    // Ricarica lista altrui non serve; aggiorna solo lo stato locale e ri-render
    window._cartePublicWin = 'albums-mine';
    _renderCartePublicWindow();
  } catch (e) {
    alert(e.message || 'Errore aggiornamento visibilità mazzo.');
    window._cartePublicWin = 'albums-mine';
    await loadCardTradeTab();
  }
}

async function _toggleMyDeckPublic(isPublic) {
  // Compat: toggle sul profilo attivo
  return _toggleProfileDeckPublic(_activeCardProfileId(), isPublic);
}

async function _openPublicDeck(idx) {
  const deck = window._cardPublicData?.decks?.[idx];
  const profileId = _activeCardProfileId();
  if (!deck || !profileId) return;
  try {
    const room = await cardsApi('cards-room-open', { method: 'POST', body: { profile_id: profileId, other_coc_tag: deck.profile.coc_tag } });
    await _openCardRoom(room.room.id, deck.matches || []);
  } catch (e) {
    alert(e.message || 'Errore apertura stanza.');
  }
}

async function _proposeFromPublicDeck(deckIdx, matchIdx, commitNow = false) {
  const deck = window._cardPublicData?.decks?.[deckIdx];
  const m = deck?.matches?.[matchIdx];
  if (!deck || !m) return;
  // Ogni match indica con quale mio profilo si applica (aggregato su tutti i profili collegati).
  const profileId = m.my_profile?.id || _activeCardProfileId();
  if (!profileId) return;
  const myTag = m.my_profile?.coc_tag || window._cardEventActiveTag;
  const myName = m.my_profile?.username || myTag || 'Tu';
  const sem = _carteP2pSemaforo(myTag, deck.profile.coc_tag, m.card_give, m.card_get);
  _openCarteTradeConfirmModal({
    title: commitNow ? 'Applica subito (solo il mio mazzo)' : 'Proponi scambio',
    nameA: myName,
    nameB: deck.profile.username || deck.profile.coc_tag,
    cardAMeta: m.card_give_meta,
    cardBMeta: m.card_get_meta,
    aIsNew: sem.aIsNew,
    bIsNew: sem.bIsNew,
    note: commitNow
      ? 'Cedi SUBITO il tuo doppione, senza bisogno del consenso dell’altro giocatore. Riceverai la carta richiesta solo quando anche lui completerà lo scambio (in chat vedrà che hai già confermato la tua parte).'
      : 'La proposta verrà inviata in chat. L’altro giocatore dovrà accettarla. Solo carte della stessa tipologia; ciascuno cede un doppione e riceve una carta mancante.',
    confirmLabel: commitNow ? 'Applica subito' : 'Proponi scambio delle carte',
    onConfirm: async () => {
      const room = await cardsApi('cards-room-open', { method: 'POST', body: { profile_id: profileId, other_coc_tag: deck.profile.coc_tag } });
      await cardsApi('cards-propose', {
        method: 'POST',
        body: { room_id: room.room.id, profile_id: profileId, card_give: m.card_give, card_get: m.card_get, commit: commitNow },
      });
      if (commitNow) { window._cardEventData = await profilesApi('cards-get'); renderCardEventContent(); }
      await _openCardRoom(room.room.id, (deck.matches || []).filter((_, i) => i !== matchIdx));
      await loadCardTradeTab();
    },
  });
}

function _applyFromPublicDeck(deckIdx, matchIdx) {
  return _proposeFromPublicDeck(deckIdx, matchIdx, true);
}

async function _proposeSuggested(idx, commitNow = false) {
  const m = (window._cardRoomSuggested || [])[idx];
  const roomState = window._cardRoomState;
  if (!m || !roomState) return;
  const me = roomState.me || {};
  const other = roomState.other || {};
  const sem = _carteP2pSemaforo(me.coc_tag, other.coc_tag, m.card_give, m.card_get);
  _openCarteTradeConfirmModal({
    title: commitNow ? 'Applica subito (solo il mio mazzo)' : 'Proponi scambio',
    nameA: me.username || me.coc_tag || 'Tu',
    nameB: other.username || other.coc_tag || 'Altro',
    cardAMeta: m.card_give_meta,
    cardBMeta: m.card_get_meta,
    aIsNew: sem.aIsNew,
    bIsNew: sem.bIsNew,
    note: commitNow
      ? 'Cedi SUBITO il tuo doppione, senza bisogno del consenso dell’altro giocatore. Riceverai la carta richiesta solo quando anche lui completerà lo scambio.'
      : 'La proposta verrà inviata in questa chat. L’altro giocatore dovrà accettarla.',
    confirmLabel: commitNow ? 'Applica subito' : 'Proponi scambio delle carte',
    onConfirm: async () => {
      await cardsApi('cards-propose', {
        method: 'POST',
        body: { room_id: roomState.room.id, profile_id: roomState.room.my_profile_id, card_give: m.card_give, card_get: m.card_get, commit: commitNow },
      });
      if (commitNow) { window._cardEventData = await profilesApi('cards-get'); renderCardEventContent(); }
      const roomId = roomState.room.id;
      const remaining = (window._cardRoomSuggested || []).filter((_, i) => i !== idx);
      await _openCardRoom(roomId, remaining);
      await loadCardTradeTab();
    },
  });
}

function _applySuggested(idx) {
  return _proposeSuggested(idx, true);
}

async function _proposeFromMatch(idx, commitNow = false) {
  const m = window._cardTradeData?.matches?.[idx];
  if (!m) return;
  // Ogni match indica con quale mio profilo si applica (aggregato su tutti i profili collegati).
  const profileId = m.my_profile?.id || _activeCardProfileId();
  if (!profileId) return;
  const myTag = m.my_profile?.coc_tag || window._cardEventActiveTag;
  const myName = m.my_profile?.username || myTag || 'Tu';
  const sem = _carteP2pSemaforo(myTag, m.other_profile?.coc_tag, m.card_give, m.card_get);
  _openCarteTradeConfirmModal({
    title: commitNow ? 'Applica subito (solo il mio mazzo)' : 'Proponi scambio',
    nameA: myName,
    nameB: m.other_profile?.username || m.other_profile?.coc_tag || 'Altro',
    cardAMeta: m.card_give_meta,
    cardBMeta: m.card_get_meta,
    aIsNew: sem.aIsNew,
    bIsNew: sem.bIsNew,
    note: commitNow
      ? 'Cedi SUBITO il tuo doppione, senza bisogno del consenso dell’altro giocatore. Riceverai la carta richiesta solo quando anche lui completerà lo scambio.'
      : 'La proposta verrà inviata in chat. L’altro giocatore dovrà accettarla. Stesse regole semaforo: 🟢 sblocca carta nuova · 🟡 già posseduta (negli scambi tra i tuoi profili).',
    confirmLabel: commitNow ? 'Applica subito' : 'Proponi scambio delle carte',
    onConfirm: async () => {
      const room = await cardsApi('cards-room-open', { method: 'POST', body: { profile_id: profileId, other_coc_tag: m.other_profile.coc_tag } });
      await cardsApi('cards-propose', {
        method: 'POST',
        body: { room_id: room.room.id, profile_id: profileId, card_give: m.card_give, card_get: m.card_get, commit: commitNow },
      });
      if (commitNow) { window._cardEventData = await profilesApi('cards-get'); renderCardEventContent(); }
      await _openCardRoom(room.room.id);
      await loadCardTradeTab();
    },
  });
}

function _applyFromMatch(idx) {
  return _proposeFromMatch(idx, true);
}

/** Semaforo P2P: verde = ricevente sblocca carta nuova (qty&lt;1). */
function _carteP2pSemaforo(myTag, otherTag, cardGive, cardGet) {
  const myColl = (window._cardEventData?.collections && window._cardEventData.collections[myTag]) || {};
  const roomOther = window._cardRoomState?.other;
  const otherColl = roomOther?.coc_tag === otherTag
    ? (window._cardRoomState.other_collection || {})
    : ((window._cardPublicData?.decks || []).find(d => d.profile?.coc_tag === otherTag)?.collection || {});
  return {
    aIsNew: (myColl[cardGet] || 0) < 1,
    bIsNew: (otherColl[cardGive] || 0) < 1,
  };
}

function _closeCarteTradeConfirmModal() {
  document.getElementById('carte-trade-confirm-modal')?.remove();
  window._carteTradeConfirmAction = null;
}

async function _confirmCarteTradeModal() {
  const fn = window._carteTradeConfirmAction;
  const btn = document.querySelector('#carte-trade-confirm-modal .carte-trade-confirm-go');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  try {
    if (typeof fn === 'function') await fn();
    _closeCarteTradeConfirmModal();
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || 'Conferma';
    }
    alert(e.message || 'Errore nello scambio.');
  }
}

/**
 * Modale conferma scambio (self o p2p) con animazione trasferimento e semaforo.
 * A cede cardAMeta → B; B cede cardBMeta → A.
 */
function _openCarteTradeConfirmModal({
  title = 'Conferma scambio',
  nameA,
  nameB,
  cardAMeta,
  cardBMeta,
  aIsNew = true,
  bIsNew = true,
  note = '',
  confirmLabel = 'Conferma',
  onConfirm,
}) {
  _closeCarteTradeConfirmModal();
  window._carteTradeConfirmAction = onConfirm;
  const bothNew = aIsNew !== false && bIsNew !== false;
  const cardA = escH(cardAMeta?.name_it || '—');
  const cardB = escH(cardBMeta?.name_it || '—');
  const nA = escH(nameA || 'Profilo 1');
  const nB = escH(nameB || 'Profilo 2');
  const modal = document.createElement('div');
  modal.id = 'carte-trade-confirm-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1000';
  modal.innerHTML = `
    <div class="modal-box carte-trade-confirm-box">
      <div class="modal-header">
        <h2 style="font-size:1rem">${escH(title)}</h2>
        <button type="button" class="modal-close" onclick="_closeCarteTradeConfirmModal()">✕</button>
      </div>
      <div class="carte-trade-confirm-body">
        <div class="carte-trade-stage ${bothNew ? 'is-green' : 'is-yellow'}">
          <div class="carte-trade-stage-heads">
            <div class="carte-trade-stage-profile">
              <span class="carte-trade-stage-badge">${escH(String(nameA || '?').slice(0, 1).toUpperCase())}</span>
              <strong>${nA}</strong>
              <span class="carte-trade-stage-sem" title="${aIsNew ? 'Sblocca una carta nuova' : 'Possiede già la carta ricevuta'}">${aIsNew ? '🟢 nuova' : '🟡 già sua'}</span>
            </div>
            <div class="carte-trade-stage-profile">
              <span class="carte-trade-stage-badge">${escH(String(nameB || '?').slice(0, 1).toUpperCase())}</span>
              <strong>${nB}</strong>
              <span class="carte-trade-stage-sem" title="${bIsNew ? 'Sblocca una carta nuova' : 'Possiede già la carta ricevuta'}">${bIsNew ? '🟢 nuova' : '🟡 già sua'}</span>
            </div>
          </div>
          <div class="carte-trade-stage-fly" aria-hidden="true">
            <div class="carte-trade-fly-card fly-ab">
              ${_cardMiniImg(cardAMeta)}
              <span>${cardA}</span>
            </div>
            <div class="carte-trade-fly-card fly-ba">
              ${_cardMiniImg(cardBMeta)}
              <span>${cardB}</span>
            </div>
          </div>
          <div class="carte-trade-stage-legend">
            <span>🟢 sblocca carta nuova</span>
            <span>🟡 già posseduta (self)</span>
          </div>
        </div>
        <ul class="carte-self-confirm-list">
          <li><strong>${nA}</strong> cede <strong>${cardA}</strong> → riceve <strong>${cardB}</strong> ${aIsNew ? '🟢' : '🟡'}</li>
          <li><strong>${nB}</strong> cede <strong>${cardB}</strong> → riceve <strong>${cardA}</strong> ${bIsNew ? '🟢' : '🟡'}</li>
        </ul>
        ${note ? `<p class="carte-qty-modal-note">${escH(note)}</p>` : ''}
        <div class="carte-qty-modal-actions">
          <button type="button" class="btn-secondary" onclick="_closeCarteTradeConfirmModal()">Annulla</button>
          <button type="button" class="btn-primary carte-trade-confirm-go" data-label="${escH(confirmLabel)}" onclick="_confirmCarteTradeModal()">${escH(confirmLabel)}</button>
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) _closeCarteTradeConfirmModal(); });
  document.body.appendChild(modal);
}

function _openSelfTradeConfirmModal(idx) {
  const m = window._cardTradeData?.selfMatches?.[idx];
  if (!m) return;
  const aIsNew = m.a_is_new !== false;
  const bIsNew = m.b_is_new !== false;
  _openCarteTradeConfirmModal({
    title: 'Conferma scambio tra i tuoi profili',
    nameA: m.profile_a.username || m.profile_a.coc_tag,
    nameB: m.profile_b.username || m.profile_b.coc_tag,
    cardAMeta: m.card_a_to_b_meta,
    cardBMeta: m.card_b_to_a_meta,
    aIsNew,
    bIsNew,
    note: bothNewNote(aIsNew, bIsNew),
    confirmLabel: 'Applica subito',
    onConfirm: async () => {
      await cardsApi('cards-self-apply', {
        method: 'POST',
        body: { profile_a: m.profile_a.id, profile_b: m.profile_b.id, card_a_to_b: m.card_a_to_b, card_b_to_a: m.card_b_to_a },
      });
      window._cardEventData = await profilesApi('cards-get');
      renderCardEventContent();
      await loadCardTradeTab();
    },
  });

  function bothNewNote(aNew, bNew) {
    if (aNew && bNew) {
      return '🟢 Entrambi i profili sbloccano una carta nuova. Le collezioni si aggiornano subito (sono i tuoi profili).';
    }
    return '🟡 Scambio possibile ma non necessario: uno o entrambi possiedono già la carta ricevuta. Le quantità si sommano comunque. Aggiornamento immediato.';
  }
}

async function _applySelfMatch(idx) {
  // Compat: conferma diretta senza riaprire la modale
  const m = window._cardTradeData?.selfMatches?.[idx];
  if (!m) return;
  _closeCarteTradeConfirmModal();
  try {
    await cardsApi('cards-self-apply', {
      method: 'POST',
      body: { profile_a: m.profile_a.id, profile_b: m.profile_b.id, card_a_to_b: m.card_a_to_b, card_b_to_a: m.card_b_to_a },
    });
    window._cardEventData = await profilesApi('cards-get');
    renderCardEventContent();
    await loadCardTradeTab();
  } catch (e) {
    alert(e.message || 'Errore applicazione scambio.');
  }
}

window._cardRoomState = null; // { room, me, other } dell'ultima stanza aperta
window._cardRoomSuggested = null; // match suggeriti da "Mazzi pubblici" per la stanza corrente

async function _openCardRoom(roomId, suggested = null) {
  // Mostra indicatore caricamento immediato
  _carteInlineNotice('⏳ Caricamento chat...', 500);
  try {
    const data = await cardsApi('cards-room-detail', { params: { room_id: roomId } });
    const sameRoom = window._cardRoomState?.room?.id === roomId;
    window._cardRoomState = data;
    window._cardRoomSuggested = suggested;
    if (!sameRoom) window._cartePropose = { give: null, get: null };
    renderCardRoomModal(data);
  } catch (e) {
    _carteInlineNotice('❌ ' + (e.message || 'Errore apertura stanza.'), 3000);
  }
}

function renderCardRoomModal(data) {
  document.getElementById('carte-room-modal')?.remove();
  const cat = window._cardEventCatalog;
  const live = cat?.settings?.live === true;
  const myId = data.room.my_profile_id;

  const messagesHtml = data.messages.map(m => {
    if (m.kind === 'system') return `<div class="carte-chat-system">${escH(m.body || '')}</div>`;
    const mine = m.sender_profile === myId;
    return `<div class="carte-chat-msg ${mine ? 'mine' : ''}">${escH(m.body || '')}</div>`;
  }).join('') || `<div class="carte-chat-system">Nessun messaggio. Scrivi per iniziare la trattativa.</div>`;

  const proposalsHtml = data.proposals.filter(p => p.status === 'pending').map(p => {
    const isProposer = p.proposer_profile === myId;
    const committedBadge = p.proposer_committed
      ? `<div class="carte-committed-badge">⚡ ${isProposer ? 'Hai già ceduto la tua carta' : `${escH(data.other.username || data.other.coc_tag)} ha già ceduto la sua carta`}: in attesa di completamento.</div>`
      : '';
    return `<div class="carte-proposal-card ${p.proposer_committed ? 'is-committed' : ''}">
      <div class="carte-match-cards">
        ${_cardMiniImg(p.card_give_meta)}
        <span class="carte-match-arrow">→</span>
        ${_cardMiniImg(p.card_get_meta)}
      </div>
      <div class="carte-match-info">
        <div class="carte-match-names">${isProposer ? 'Hai proposto' : `${escH(data.other.username || data.other.coc_tag)} propone`}: cede ${escH(p.card_give_meta?.name_it || p.card_give)} → riceve ${escH(p.card_get_meta?.name_it || p.card_get)}</div>
      </div>
      ${committedBadge}
      <div class="carte-proposal-actions">
        ${!isProposer && live ? `<button type="button" class="btn-primary btn-sm" onclick="_cardRoomRespond('${p.id}','accept')">${p.proposer_committed ? '⚡ Applica subito e completa' : '✓ Accetta'}</button>` : ''}
        ${!isProposer && live ? `<button type="button" class="btn-secondary btn-sm" onclick="_cardRoomRespond('${p.id}','reject')">✕ Rifiuta</button>` : ''}
        ${isProposer && !p.proposer_committed && live ? `<button type="button" class="btn-secondary btn-sm" onclick="_cardRoomCommit('${p.id}')">⚡ Applica subito (solo il mio mazzo)</button>` : ''}
        ${isProposer && live ? `<button type="button" class="btn-secondary btn-sm" onclick="_cardRoomRespond('${p.id}','cancel')">Annulla</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const suggested = window._cardRoomSuggested || [];
  const suggestedHtml = suggested.length && live ? `
    <div class="carte-suggested-list">
      <div class="carte-suggested-title">🔄 Scambi suggeriti con questo mazzo pubblico:</div>
      ${suggested.map((m, i) => `
        <div class="carte-match-card">
          <div class="carte-match-cards">
            ${_cardMiniImg(m.card_give_meta)}
            <span class="carte-match-arrow">⇄</span>
            ${_cardMiniImg(m.card_get_meta)}
          </div>
          <div class="carte-match-info">
            <div class="carte-match-names">Cedi <strong>${escH(m.card_give_meta?.name_it || m.card_give)}</strong> → ricevi <strong>${escH(m.card_get_meta?.name_it || m.card_get)}</strong></div>
          </div>
          <div class="carte-row-actions">
            <button type="button" class="btn-secondary btn-sm" onclick="_applySuggested(${i})">⚡ Applica subito</button>
            <button type="button" class="btn-primary btn-sm" onclick="_proposeSuggested(${i})">💬 Proponi</button>
          </div>
        </div>`).join('')}
    </div>` : '';

  const myTag = data.me.coc_tag;
  const myColl = (window._cardEventData?.collections && window._cardEventData.collections[myTag]) || {};
  const otherColl = data.other_collection || {};
  const sel = window._cartePropose || { give: null, get: null };
  window._cartePropose = sel;
  // Stesse regole di computeP2pMatches: doppione mio che l'altro non ha ↔ suo doppione che a me manca.
  const giveAll = (cat?.cards || []).filter(c => (myColl[c.key] || 0) >= 2 && (otherColl[c.key] || 0) === 0);
  const getAll = (cat?.cards || []).filter(c => (otherColl[c.key] || 0) >= 2 && (myColl[c.key] || 0) === 0);
  const giveSelCard = cat?.cards?.find(c => c.key === sel.give);
  const getSelCard = cat?.cards?.find(c => c.key === sel.get);
  const lockCat = giveSelCard?.category || getSelCard?.category || null;
  const giveOptions = lockCat ? giveAll.filter(c => c.category === lockCat) : giveAll;
  const getOptions = lockCat ? getAll.filter(c => c.category === lockCat) : getAll;
  const canSubmitPropose = !!(sel.give && sel.get);
  const proposeForm = live ? `
    <div class="carte-propose-form">
      <p class="carte-propose-rule">Solo carte della <strong>stessa tipologia</strong>. Tocca una carta per selezionarla: a sinistra i tuoi doppioni scambiabili con lui, a destra i suoi doppioni che a te mancano.</p>
      <div class="carte-propose-sides">
        <div class="carte-propose-side">
          <label class="carte-propose-label">📤 Cedi (il tuo doppione)</label>
          ${_carteProposeGridHtml(giveOptions, 'give', sel.give)}
        </div>
        <div class="carte-propose-arrow" aria-hidden="true">⇄</div>
        <div class="carte-propose-side">
          <label class="carte-propose-label">📥 Ricevi (suo doppione, a te manca)</label>
          ${_carteProposeGridHtml(getOptions, 'get', sel.get)}
        </div>
      </div>
      <div class="carte-row-actions">
        <button type="button" class="btn-secondary btn-sm" ${canSubmitPropose ? '' : 'disabled'} onclick="_cardRoomPropose(true)">⚡ Applica subito</button>
        <button type="button" class="btn-primary btn-sm" ${canSubmitPropose ? '' : 'disabled'} onclick="_cardRoomPropose(false)">💬 Proponi scambio</button>
      </div>
    </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'carte-room-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1000';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:480px;width:100%">
      <div class="modal-header">
        <h2 style="font-size:1rem">🔁 ${escH(data.other.username || data.other.coc_tag)}</h2>
        <button class="modal-close" onclick="document.getElementById('carte-room-modal').remove()">✕</button>
      </div>
      <div style="padding:1rem">
        ${proposalsHtml ? `<div class="carte-proposals-list">${proposalsHtml}</div>` : ''}
        ${suggestedHtml}
        ${proposeForm}
        <div class="carte-chat-box" id="carte-chat-box">${messagesHtml}</div>
        ${live ? `
        <div class="carte-chat-input-row">
          <input type="text" id="carte-chat-input" placeholder="Scrivi un messaggio…" maxlength="500" onkeydown="if(event.key==='Enter')_cardRoomSendMessage()">
          <button type="button" class="btn-primary btn-sm" onclick="_cardRoomSendMessage()">Invia</button>
        </div>` : ''}
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  const chatBox = document.getElementById('carte-chat-box');
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

async function _cardRoomSendMessage() {
  const input = document.getElementById('carte-chat-input');
  const text = (input?.value || '').trim();
  if (!text || !window._cardRoomState) return;
  try {
    await cardsApi('cards-room-send', {
      method: 'POST',
      body: { room_id: window._cardRoomState.room.id, profile_id: window._cardRoomState.room.my_profile_id, body: text },
    });
    if (input) input.value = '';
    await _openCardRoom(window._cardRoomState.room.id);
  } catch (e) {
    alert(e.message || 'Errore invio messaggio.');
  }
}

/** Griglia fotografica cliccabile per la sezione "Cedi"/"Ricevi" della proposta in chat. */
function _carteProposeGridHtml(cards, side, selectedKey) {
  if (!cards.length) {
    return `<div class="carte-propose-preview-empty">Nessuna carta disponibile${selectedKey ? ' in questa categoria' : ' con questo giocatore'}.</div>`;
  }
  return `<div class="carte-pick-grid">${cards.map(c => {
    const border = CARTE_CAT_BORDER[c.category] || '';
    const sel = c.key === selectedKey ? 'is-selected' : '';
    return `<button type="button" class="carte-pick-tile ${border} ${sel}" onclick="_pickCarteProposeCard('${side}','${escH(c.key)}')" title="${escH(c.name_it)}">
      <img src="${escH(c.icon_url)}" alt="${escH(c.name_it)}" loading="lazy" onerror="this.style.visibility='hidden'">
    </button>`;
  }).join('')}</div>`;
}

function _pickCarteProposeCard(side, key) {
  const sel = window._cartePropose || (window._cartePropose = { give: null, get: null });
  if (side === 'give') sel.give = sel.give === key ? null : key;
  else sel.get = sel.get === key ? null : key;
  // Se dopo il click le due carte non sono più della stessa categoria, resetta l'altro lato.
  const cat = window._cardEventCatalog;
  const giveCard = cat?.cards?.find(c => c.key === sel.give);
  const getCard = cat?.cards?.find(c => c.key === sel.get);
  if (giveCard && getCard && giveCard.category !== getCard.category) {
    if (side === 'give') sel.get = null; else sel.give = null;
  }
  if (window._cardRoomState) renderCardRoomModal(window._cardRoomState);
}

async function _cardRoomPropose(commitNow = false) {
  const sel = window._cartePropose || {};
  const give = sel.give;
  const get = sel.get;
  if (!give || !get || !window._cardRoomState) { alert('Seleziona entrambe le carte.'); return; }
  const cat = window._cardEventCatalog;
  const giveMeta = cat?.cards?.find(c => c.key === give);
  const getMeta = cat?.cards?.find(c => c.key === get);
  const roomState = window._cardRoomState;
  const me = roomState.me || {};
  const other = roomState.other || {};
  const sem = _carteP2pSemaforo(me.coc_tag, other.coc_tag, give, get);
  _openCarteTradeConfirmModal({
    title: commitNow ? 'Applica subito (solo il mio mazzo)' : 'Proponi scambio',
    nameA: me.username || me.coc_tag || 'Tu',
    nameB: other.username || other.coc_tag || 'Altro',
    cardAMeta: giveMeta,
    cardBMeta: getMeta,
    aIsNew: sem.aIsNew,
    bIsNew: sem.bIsNew,
    note: commitNow
      ? 'Cedi SUBITO il tuo doppione, senza bisogno del consenso dell’altro giocatore. Riceverai la carta richiesta solo quando anche lui completerà lo scambio.'
      : 'La proposta verrà inviata in questa chat. L’altro giocatore dovrà accettarla.',
    confirmLabel: commitNow ? 'Applica subito' : 'Proponi scambio delle carte',
    onConfirm: async () => {
      await cardsApi('cards-propose', {
        method: 'POST',
        body: { room_id: roomState.room.id, profile_id: roomState.room.my_profile_id, card_give: give, card_get: get, commit: commitNow },
      });
      window._cartePropose = { give: null, get: null };
      if (commitNow) { window._cardEventData = await profilesApi('cards-get'); renderCardEventContent(); }
      await _openCardRoom(roomState.room.id);
      await loadCardTradeTab();
    },
  });
}

/** Il proponente conferma la propria cessione (escrow) su una proposta già creata ma non ancora committed. */
async function _cardRoomCommit(proposalId) {
  if (!window._cardRoomState) return;
  if (!confirm('Confermi di cedere subito la tua carta per questa proposta? Non serve il consenso dell’altro giocatore: riceverai la carta richiesta solo quando anche lui completerà lo scambio.')) return;
  try {
    await cardsApi('cards-commit', {
      method: 'POST',
      body: { proposal_id: proposalId, profile_id: window._cardRoomState.room.my_profile_id },
    });
    window._cardEventData = await profilesApi('cards-get');
    renderCardEventContent();
    await _openCardRoom(window._cardRoomState.room.id);
    await loadCardTradeTab();
  } catch (e) {
    alert(e.message || 'Errore applicazione scambio.');
  }
}

async function _cardRoomRespond(proposalId, action) {
  if (!window._cardRoomState) return;
  const msg = action === 'accept'
    ? 'Confermi di accettare questo scambio? Le collezioni verranno aggiornate subito.'
    : action === 'reject'
      ? 'Rifiutare questa proposta?'
      : 'Annullare questa proposta?';
  if (!confirm(msg)) return;
  try {
    await cardsApi('cards-respond', {
      method: 'POST',
      body: { proposal_id: proposalId, profile_id: window._cardRoomState.room.my_profile_id, action },
    });
    // Aggiorna sempre "La mia collezione": accept aggiorna le quantità, cancel/reject
    // possono restituire un doppione ceduto in escrow ("Applica subito").
    window._cardEventData = await profilesApi('cards-get');
    renderCardEventContent();
    await _openCardRoom(window._cardRoomState.room.id);
    await loadCardTradeTab();
  } catch (e) {
    alert(e.message || 'Errore risposta proposta.');
  }
}

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
  const all = data || [];
  const active   = all.filter(m => !m.left_at);
  const exPlayers = all.filter(m => !!m.left_at).sort((a, b) => new Date(b.left_at) - new Date(a.left_at));
  renderMembers(active, exPlayers);
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

function renderMembers(members, exPlayers = []) {
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

    // Lega individuale giocatore (leagueTier dal DB = campo leagueTier CoC API)
    const leagueHtml = rankLeagueBadgeHtml(
      m.league_name
        ? {
            name: m.league_name,
            iconUrls: m.league_icon_url
              ? { small: m.league_icon_url, medium: m.league_icon_url, large: m.league_icon_url }
              : undefined,
          }
        : null
    );

    // Badge SVG per giocatori nuovi (< 7 giorni) — icona stella minuscola
    const newBadge = isNew
      ? `<svg class="new-player-badge" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-label="Nuovo membro" title="Nuovo membro (< 7 giorni)"><path d="M6 1l1.29 2.61 2.88.42-2.08 2.03.49 2.86L6 7.6 3.42 8.92l.49-2.86L1.83 4.03l2.88-.42z" fill="#27AE60"/></svg>`
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

  // ── Sezione Ex Player ────────────────────────────────────────────────────────
  const membersCard = document.querySelector("#members-table").closest('.card');
  let exSection = document.getElementById('ex-players-section');
  if (exSection) exSection.remove();

  if (exPlayers.length > 0) {
    exSection = document.createElement('div');
    exSection.id = 'ex-players-section';
    exSection.className = 'card';
    exSection.style.marginTop = '1rem';

    const exRows = exPlayers.map(m => {
      const leftDate = m.left_at ? new Date(m.left_at).toLocaleDateString('it-IT') : '—';
      return `<tr>
        <td class="col-th-cell">${thImgOut()}</td>
        <td class="col-member">
          <div class="member-name-wrap"><span class="member-name" style="color:var(--text-3)">${m.name}</span></div>
          <span class="member-tag">${m.tag}</span>
        </td>
        <td class="stat-cell">${m.trophies ?? '—'}</td>
        <td class="stat-cell" style="color:var(--red);font-size:0.78rem">${leftDate}</td>
      </tr>`;
    }).join('');

    exSection.innerHTML = `
      <div style="padding:0.75rem 1rem 0.5rem;display:flex;align-items:center;gap:0.5rem">
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-3)">🚪 Ex membri (${exPlayers.length})</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-th-hdr">TH</th>
              <th>Nome / Tag</th>
              <th>Trofei</th>
              <th>Uscito il</th>
            </tr>
          </thead>
          <tbody>${exRows}</tbody>
        </table>
      </div>`;

    membersCard.after(exSection);
  }
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
    const { data: { session } } = await db.auth.getSession();
    const headers = {};
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    const res = await fetch(`/api/sync-members${clanQ()}`, { method: 'POST', headers });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(`Risposta non valida (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || "Errore server");
    status.textContent = `✓ Sincronizzati ${data.synced} membri`;
    setTimeout(() => { status.textContent = ''; }, 4000);
    loadMembers();
  } catch (err) {
    const low = String(err.message || '').toLowerCase();
    let msg;
    if (low.includes('row-level security') || low.includes('rls')) {
      msg = 'Sincronizzazione temporaneamente non disponibile. Riprova tra qualche minuto.';
    } else if (low.includes('failed to fetch') || low.includes('networkerror')) {
      msg = '✗ Rete o server non raggiungibile. Riprova tra poco.';
    } else if (err.message && err.message.length < 220) {
      msg = `✗ ${err.message}`;
    } else {
      msg = '✗ Sincronizzazione fallita. Riprova più tardi.';
    }
    status.textContent = msg;
    setTimeout(() => { status.textContent = ''; }, 8000);
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
      // Distruzione media per attacco (coerente con tab Assegna Bonus)
      const destr = lp
        ? (lp.attacks_made > 0 ? (lp.destruction / lp.attacks_made).toFixed(1) + '%' : '—')
        : (h.attacks_made > 0 ? (h.destruction / h.attacks_made).toFixed(1) + '%' : '—');
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
            <th>⭐ Stelle</th><th title="Distruzione media per attacco">💥 Distruz. media</th>
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

    if (data.state !== 'notInWar' && data.state !== 'ended' && data.players?.length) {
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
        <input type="checkbox" class="assign-check" data-name="${qname}" ${hasBonus ? 'checked' : ''} data-stars="${p.stars ?? 0}" data-destruction="${p.destruction ?? 0}" data-attacks-made="${p.attacks_made ?? 0}" data-attacks-required="${p.attacks_required ?? 0}" data-bonus-score="${p.bonus_score ?? 0}" data-participated="${p.participated ? '1' : '0'}" style="accent-color:#f0a500;width:16px;height:16px">
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
      participated: cb.dataset.participated !== '0',
      stars:             parseInt(cb.dataset.stars || '0', 10),
      destruction:       parseFloat(cb.dataset.destruction || '0'),
      attacks_made:      parseInt(cb.dataset.attacksMade || '0', 10),
      attacks_required:  parseInt(cb.dataset.attacksRequired || '0', 10),
      bonus_score:       parseFloat(cb.dataset.bonusScore || '0'),
      still_in_clan: true
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

  // Criteri unificati con il bot Telegram (4 flag)
  const critParticipated  = document.getElementById('crit-participated').checked;
  const critFullAttacks   = document.getElementById('crit-full-attacks').checked;
  const critNoPrevBonus   = document.getElementById('crit-no-prev-bonus').checked;
  const critThWeight      = document.getElementById('crit-th-weight').checked;

  if (!season) { msg.textContent = '⚠ Seleziona una stagione.'; return; }

  const applyBtn = document.getElementById('bm-apply');
  applyBtn.textContent = 'Caricamento…';
  msg.textContent = '';
  div.innerHTML = '';
  bmCandidates = [];
  bmSelections = new Set();
  document.getElementById('bm-footer').style.display = 'none';

  // Prima prova con dati live, poi con storico DB
  let pool = [];
  let fromLive = false;

  if (cwlLiveData && cwlLiveData.length) {
    // Usa dati live CWL
    fromLive = true;
    pool = cwlLiveData.map(p => {
      const req  = Math.max(p.attacks_required, 1);
      const made = p.attacks_made;
      const avgD = made > 0 ? p.destruction / made : 0;
      // Formula merito CWL: (stelle/req)*40 + avgDestruction*0.2 + (made/req)*20
      const merit = (p.stars / req) * 40 + avgD * 0.2 + (made / req) * 20;
      return {
        player_name: p.name, stars: p.stars, destruction: p.destruction,
        attacks_made: made, attacks_required: req,
        avg_destr: avgD, participated: true, merit: Math.round(merit * 10) / 10,
        bonus_assigned: false, still_in_clan: true, th_level: p.th_level || 0
      };
    });
  } else {
    // Carica dati storici per season
    const qCrit = db.from('cwl_history').select('*').eq('season', season).eq('is_secondary', false);
    if (window._userClanTag) qCrit.eq('clan_tag', window._userClanTag);
    const { data: history, error } = await qCrit;

    if (error || !history?.length) {
      msg.textContent = '⚠ Nessun dato per questa stagione. Prima carica lo storico o i dati live dalla tab CWL.';
      applyBtn.textContent = '🔍 Applica Criteri';
      return;
    }

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
      still_in_clan: h.still_in_clan,
      th_level: h.th_level || 0
    }));
  }

  // Carica bonus stagione precedente per criterio "no prev bonus"
  let prevSeasonBonusNames = new Set();
  if (critNoPrevBonus) {
    const prevSeason = prevSeasonYM(season);
    if (prevSeason) {
      const qPrev = db.from('cwl_history')
        .select('player_name')
        .eq('season', prevSeason)
        .eq('bonus_assigned', true);
      if (window._userClanTag) qPrev.eq('clan_tag', window._userClanTag);
      const { data: prevData } = await qPrev;
      if (prevData) prevData.forEach(r => prevSeasonBonusNames.add(r.player_name));
    }
  }

  // Calcola mediana TH per peso TH
  let medianTh = 0;
  if (critThWeight) {
    const thValues = pool.map(p => p.th_level || 0).filter(th => th > 0).sort((a, b) => a - b);
    if (thValues.length) medianTh = thValues[Math.floor(thValues.length / 2)];
  }

  // Applica filtri (unificati con bot Telegram)
  let filtered = pool.filter(p => {
    if (!p.still_in_clan) return false;
    if (critParticipated && !p.participated) return false;
    if (critFullAttacks && p.attacks_required > 0) {
      if (p.attacks_made < p.attacks_required) return false;
    }
    if (critNoPrevBonus && prevSeasonBonusNames.has(p.player_name)) return false;
    return true;
  });

  // Applica peso TH al merito (se abilitato)
  if (critThWeight && medianTh > 0) {
    filtered = filtered.map(p => {
      const th = p.th_level || 0;
      const delta = medianTh - th;
      const factor = 1 + Math.max(-0.12, Math.min(0.12, delta * 0.012));
      const meritAdj = Math.round(p.merit * factor * 10) / 10;
      return { ...p, meritAdj };
    });
  } else {
    filtered = filtered.map(p => ({ ...p, meritAdj: p.merit }));
  }

  // Ordina per merito (aggiustato se peso TH attivo)
  filtered.sort((a, b) => (b.meritAdj || 0) - (a.meritAdj || 0) || a.player_name.localeCompare(b.player_name, 'it'));

  if (!filtered.length) {
    msg.textContent = '⚠ Nessun giocatore idoneo con i criteri selezionati.';
    applyBtn.textContent = '🔍 Applica Criteri';
    return;
  }

  bmCandidates = filtered;
  const topN = filtered.slice(0, count);
  topN.forEach(p => bmSelections.add(p.player_name));

  const critInfo = [];
  if (critParticipated) critInfo.push('solo partecipanti');
  if (critFullAttacks) critInfo.push('attacchi completi');
  if (critNoPrevBonus) critInfo.push('no bonus stagione prec.');
  if (critThWeight) critInfo.push(`peso TH (mediana: ${medianTh})`);
  const critText = critInfo.length ? critInfo.join(' · ') : 'roster attivo';

  const rows = filtered.map((p, i) => {
    const sel = bmSelections.has(p.player_name) ? 'checked' : '';
    const pos = i + 1;
    const meritDisplay = critThWeight ? `${p.meritAdj.toFixed(1)} (base: ${p.merit.toFixed(1)})` : p.merit.toFixed(1);
    const thDisplay = critThWeight ? ` <span style="color:var(--text-3);font-size:0.75rem">TH${p.th_level || '?'}</span>` : '';
    return `<tr>
      <td style="width:40px;text-align:center">${pos}</td>
      <td><label style="cursor:pointer"><input type="checkbox" ${sel} onchange="toggleBonusSelection('${escH(p.player_name).replace(/'/g, "&#39;")}',this.checked)"> <span class="member-name">${escH(p.player_name)}</span>${thDisplay}</label></td>
      <td style="text-align:center">${p.stars || 0}</td>
      <td style="text-align:center">${p.attacks_made || 0}/${p.attacks_required || 0}</td>
      <td style="text-align:center">${p.avg_destr.toFixed(1)}%</td>
      <td style="text-align:center;font-weight:600;color:var(--gold)">${meritDisplay}</td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <p style="font-size:0.82rem;color:var(--text-3);margin-bottom:0.6rem">
      ${fromLive ? '🔴 Dati CWL live' : `📊 Storico DB (${season})`} · Criteri: ${critText} · Top ${count} selezionati
    </p>
    <div class="table-wrap" style="max-height:320px;overflow-y:auto">
      <table>
        <thead><tr>
          <th style="width:40px">#</th>
          <th>Giocatore</th>
          <th style="width:60px">Stelle</th>
          <th style="width:70px">Attacchi</th>
          <th style="width:80px">Distr. ø</th>
          <th style="width:80px">Merito</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('bm-sel-count').textContent = bmSelections.size;
  document.getElementById('bm-footer').style.display = 'flex';
  applyBtn.textContent = '🔍 Applica Criteri';
  msg.textContent = '';
}

// Helper: stagione YYYY-MM precedente (allineato con bot Telegram)
function prevSeasonYM(season) {
  const base = String(season || '').trim().slice(0, 7);
  const [ys, ms] = base.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
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

  const res = await authFetch('/api/admin/users');
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
          <button class="btn-secondary btn-sm" onclick="_openAdminPwdModal('${u.id}', '${(username || loginId).replace(/'/g,"\\'")}')">🔑 Password</button>
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

  const res = await authFetch('/api/admin/users', {
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

  const res = await authFetch('/api/admin/users', {
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

function _openAdminPwdModal(userId, username) {
  document.getElementById('admin-pwd-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'admin-pwd-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:1000';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:380px;width:100%">
      <div class="modal-header">
        <h2 style="font-size:1rem">🔑 Password — ${escH(username)}</h2>
        <button class="modal-close" onclick="document.getElementById('admin-pwd-modal').remove()">✕</button>
      </div>
      <div id="admin-pwd-modal-body" style="padding:0.5rem 1.2rem 1.3rem">
        <p style="color:var(--text-3);font-size:0.88rem;margin:0 0 1rem">
          Genera una password temporanea per <strong>${escH(username)}</strong>.
          Verrà inviata automaticamente su Telegram (se collegato) e/o via email di recupero (Resend).
          Altrimenti potrai copiarla e comunicarla tu. Al primo accesso gli verrà chiesto di sceglierne una nuova.
        </p>
        <div style="display:flex;gap:0.6rem;justify-content:flex-end">
          <button type="button" class="btn-secondary" onclick="document.getElementById('admin-pwd-modal').remove()">Annulla</button>
          <button type="button" class="btn-primary" onclick="_generateAdminTempPassword('${userId}', '${escH(username).replace(/'/g, "\\'")}')">Genera e invia</button>
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function _generateAdminTempPassword(userId, username) {
  const body = document.getElementById('admin-pwd-modal-body');
  if (!body) return;
  body.innerHTML = '<p style="text-align:center;color:var(--text-3)">Generazione in corso…</p>';
  try {
    const res = await authFetch('/api/admin/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, generateTempPassword: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      body.innerHTML = `<p style="color:var(--red,#ef5350)">✗ ${escH(data.error || 'Errore durante la generazione.')}</p>
        <div style="text-align:right;margin-top:0.8rem"><button type="button" class="btn-secondary" onclick="document.getElementById('admin-pwd-modal').remove()">Chiudi</button></div>`;
      return;
    }
    const channels = [];
    if (data.sentViaTelegram) channels.push('Telegram');
    if (data.sentViaEmail) channels.push('email');
    const statusLine = channels.length
      ? `✅ Inviata automaticamente via <strong>${channels.join(' + ')}</strong> a <strong>${escH(username)}</strong>.`
      : `⚠️ <strong>${escH(username)}</strong> non ha Telegram collegato né email di recupero: copiala e comunicala tu.`;
    body.innerHTML = `
      <p style="margin:0 0 0.6rem">${statusLine}</p>
      <div style="display:flex;align-items:center;gap:0.5rem;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.6rem 0.8rem;margin-bottom:1rem">
        <code id="admin-pwd-value" style="flex:1;font-size:1rem;letter-spacing:0.03em">${escH(data.tempPassword)}</code>
        <button type="button" class="btn-secondary btn-sm" onclick="_copyAdminTempPassword(this)">📋 Copia</button>
      </div>
      <div style="text-align:right"><button type="button" class="btn-primary" onclick="document.getElementById('admin-pwd-modal').remove()">Fatto</button></div>`;
    showAdminMsg(`✅ Password temporanea generata per "${username}".`);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red,#ef5350)">Errore di connessione. Riprova.</p>
      <div style="text-align:right;margin-top:0.8rem"><button type="button" class="btn-secondary" onclick="document.getElementById('admin-pwd-modal').remove()">Chiudi</button></div>`;
  }
}

function _copyAdminTempPassword(btn) {
  const el = document.getElementById('admin-pwd-value');
  if (!el) return;
  navigator.clipboard?.writeText(el.textContent || '').then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copiata';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => {});
}

async function deleteUser(userId, username) {
  if (!confirm(`Eliminare l'utente "${username}"? Questa azione è irreversibile.`)) return;
  const res = await authFetch('/api/admin/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (res.ok) { showAdminMsg('✅ Utente eliminato.'); loadUsers(); }
  else { const e = await res.json().catch(() => ({})); showAdminMsg('✗ ' + (e.error || 'Errore.'), 'error'); }
}

document.getElementById('refresh-users').addEventListener('click', loadUsers);

// ── ADMIN: COCBOARDBOT (parità con /adminbot) ───────────────────────────────

let _botTicketMode = 'open';
let _botReportFilter = 'open,in_review';

function showBotAdminMsg(text, type = 'info') {
  const el = document.getElementById('botadmin-msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'admin-msg-box ' + (type === 'error' ? 'admin-msg-err' : 'admin-msg-ok');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4500);
}

function switchBotAdminTab(tab, btn) {
  applyBotAdminStaffUi();
  document.querySelectorAll('[data-botadmin-tab]').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['dashboard', 'tickets', 'reports', 'banned', 'moderators'].forEach((k) => {
    const el = document.getElementById(`botadmin-tab-${k}`);
    if (el) el.style.display = k === tab ? 'block' : 'none';
  });
  if (tab === 'dashboard') loadBotAdminDashboard();
  if (tab === 'tickets') loadBotTickets(_botTicketMode);
  if (tab === 'reports') loadBotGlobalReports(_botReportFilter);
  if (tab === 'banned') loadBotBannedUsers();
  if (tab === 'moderators') loadBotModeratorsAdmin();
}

async function botAdminFetch(view, extra = {}, method = 'GET', body = null) {
  const qs = new URLSearchParams({ scope: 'bot', view, ...extra });
  const opts = { method };
  if (body != null) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return authFetch(`/api/admin/users?${qs.toString()}`, opts);
}

async function loadBotAdminDashboard() {
  const box = document.getElementById('botadmin-dashboard');
  if (!box) return;
  if (!window._userBotAdminFull) {
    box.innerHTML = '<p class="wl-loading">Sezione riservata agli amministratori.</p>';
    return;
  }
  box.innerHTML = '<p class="wl-loading">Caricamento dashboard bot…</p>';
  const res = await botAdminFetch('dashboard');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    box.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore caricamento dashboard bot.'}</p>`;
    return;
  }
  const data = await res.json();
  const stats = data.stats || {};
  const reportOpen = Number(data.openGlobalReports || 0);
  box.innerHTML = `
    <h3 class="card-title">Stato bot</h3>
    <div class="admin-form-grid">
      <div class="admin-field"><label>Chat collegate</label><div><strong>${stats.linkedChats || 0}</strong></div></div>
      <div class="admin-field"><label>Chat in pausa</label><div><strong>${stats.pausedChats || 0}</strong></div></div>
      <div class="admin-field"><label>DAU</label><div><strong>${stats.dau || 0}</strong></div></div>
      <div class="admin-field"><label>WAU</label><div><strong>${stats.wau || 0}</strong></div></div>
      <div class="admin-field"><label>Segnalazioni globali aperte</label><div><strong>${reportOpen}</strong></div></div>
      <div class="admin-field"><label>Utenti bannati</label><div><strong>${Number(data.bannedUsersCount || 0)}</strong></div></div>
    </div>
    <div class="admin-form-footer">
      <button class="btn-secondary btn-sm" onclick="downloadBotMetricsCsv()">📄 Export CSV metriche</button>
    </div>
  `;
}

async function downloadBotMetricsCsv() {
  if (!window._userBotAdminFull) return;
  const res = await botAdminFetch('csv');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Errore export CSV.'}`, 'error');
    return;
  }
  const data = await res.json();
  const csv = String(data.csv || '');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cocboard-metrics-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showBotAdminMsg('✅ CSV metriche scaricato.');
}

async function loadBotTickets(mode = 'open') {
  _botTicketMode = mode;
  const box = document.getElementById('botadmin-tickets');
  const detail = document.getElementById('botadmin-ticket-detail');
  const f = document.getElementById('botadmin-ticket-filter');
  if (f) f.textContent = `Filtro: ${mode === 'mine' ? 'assegnati a me' : mode === 'closed' ? 'chiusi' : 'attivi'}`;
  if (detail) detail.style.display = 'none';
  if (!box) return;
  box.innerHTML = '<p class="wl-loading">Caricamento ticket…</p>';
  const res = await botAdminFetch('tickets', { mode });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    box.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore caricamento ticket.'}</p>`;
    return;
  }
  const data = await res.json();
  const rows = data.tickets || [];
  if (!rows.length) {
    box.innerHTML = '<p class="wl-loading">Nessun ticket trovato.</p>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Utente</th><th>Stato</th><th>Aggiornato</th><th>Azioni</th></tr></thead>
        <tbody>
          ${rows.map((t) => `
            <tr>
              <td><code>#${t.id}</code></td>
              <td><code>${t.telegram_user_id}</code></td>
              <td>${t.status}</td>
              <td>${new Date(t.updated_at).toLocaleString('it-IT')}</td>
              <td>
                <button class="btn-secondary btn-sm" onclick="openBotTicket(${t.id})">Apri</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function openBotTicket(ticketId) {
  const detail = document.getElementById('botadmin-ticket-detail');
  if (!detail) return;
  detail.style.display = 'block';
  detail.innerHTML = '<p class="wl-loading">Caricamento ticket…</p>';
  const res = await botAdminFetch('ticket', { id: String(ticketId) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    detail.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore dettaglio ticket.'}</p>`;
    return;
  }
  const data = await res.json();
  const t = data.ticket;
  const msgs = data.messages || [];
  const canBan = data.panel?.canBan === true;
  const banRow = canBan
    ? `<button class="btn-danger btn-sm" onclick="botTicketAction(${t.id}, 'ban')">🚫 Ban utente</button>
      <button class="btn-secondary btn-sm" onclick="botTicketAction(${t.id}, 'unban')">✅ Unban utente</button>`
    : '';
  detail.innerHTML = `
    <h3 class="card-title">🎫 Ticket #${t.id}</h3>
    <p style="margin-bottom:0.6rem">Utente: <code>${t.telegram_user_id}</code> · Stato: <b>${t.status}</b></p>
    <div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-bottom:0.8rem">
      <button class="btn-secondary btn-sm" onclick="botTicketAction(${t.id}, 'take')">✅ Presa in carico</button>
      <button class="btn-secondary btn-sm" onclick="botTicketAction(${t.id}, 'wait')">⏸ In attesa</button>
      <button class="btn-secondary btn-sm" onclick="botTicketAction(${t.id}, 'close')">🔒 Chiudi</button>
      ${banRow}
    </div>
    <div class="card" style="background:var(--bg-2);max-height:260px;overflow:auto;margin-bottom:0.8rem">
      ${(msgs || []).map((m) => `
        <div style="padding:0.4rem 0;border-bottom:1px solid var(--border)">
          <div style="font-size:0.78rem;color:var(--text-3)">${m.from_role} · ${new Date(m.created_at).toLocaleString('it-IT')}</div>
          <div>${(m.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '<i>[immagine]</i>'}</div>
        </div>
      `).join('')}
    </div>
    <div class="admin-form-grid">
      <div class="admin-field" style="grid-column:1/-1">
        <label>Rispondi all'utente (invia DM dal bot)</label>
        <textarea id="bot-ticket-reply-${t.id}" class="form-input-sm" style="min-height:90px"></textarea>
      </div>
    </div>
    <div class="admin-form-footer">
      <button class="btn-primary btn-sm" onclick="botTicketReply(${t.id})">💬 Invia risposta</button>
    </div>
  `;
}

async function botTicketAction(ticketId, action) {
  const res = await botAdminFetch('ticket_action', {}, 'PUT', { ticketId, action });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Azione ticket fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Azione ticket eseguita.');
  await openBotTicket(ticketId);
  await loadBotTickets(_botTicketMode);
}

async function botTicketReply(ticketId) {
  const ta = document.getElementById(`bot-ticket-reply-${ticketId}`);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return;
  const res = await botAdminFetch('ticket_reply', {}, 'POST', { ticketId, text });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Invio risposta fallito.'}`, 'error');
    return;
  }
  ta.value = '';
  showBotAdminMsg('✅ Risposta inviata all’utente.');
  await openBotTicket(ticketId);
}

async function loadBotGlobalReports(statuses = 'open,in_review') {
  _botReportFilter = statuses;
  const box = document.getElementById('botadmin-reports');
  const detail = document.getElementById('botadmin-report-detail');
  const f = document.getElementById('botadmin-report-filter');
  if (f) f.textContent = `Filtro: ${statuses}`;
  if (detail) detail.style.display = 'none';
  if (!box) return;
  box.innerHTML = '<p class="wl-loading">Caricamento segnalazioni…</p>';
  const res = await botAdminFetch('global_reports', { statuses });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    box.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore caricamento segnalazioni.'}</p>`;
    return;
  }
  const data = await res.json();
  const rows = data.reports || [];
  if (!rows.length) {
    box.innerHTML = '<p class="wl-loading">Nessuna segnalazione trovata.</p>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Stato</th><th>Segnalante</th><th>Motivo</th><th>Azioni</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><code>#${r.id}</code></td>
              <td>${r.status}</td>
              <td><code>${r.reporter_telegram_user_id}</code></td>
              <td>${String(r.reason || '').slice(0, 80).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
              <td><button class="btn-secondary btn-sm" onclick="openBotReport(${r.id})">Apri</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function openBotReport(reportId) {
  const detail = document.getElementById('botadmin-report-detail');
  if (!detail) return;
  detail.style.display = 'block';
  detail.innerHTML = '<p class="wl-loading">Caricamento segnalazione…</p>';
  const res = await botAdminFetch('global_report', { id: String(reportId) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    detail.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore dettaglio segnalazione.'}</p>`;
    return;
  }
  const data = await res.json();
  const report = data.report;
  const canBan = data.panel?.canBan === true;
  const targetKnown = report.reported_target_telegram_user_id != null;
  const banBtn = canBan ? `<button class="btn-danger btn-sm" onclick="botReportAction(${report.id}, 'ban')">🚫 Ban</button>` : '';
  const manualTargetBtn =
    !targetKnown && canBan ? `<button class="btn-secondary btn-sm" onclick="botReportManualTarget(${report.id})">🎯 Target manuale</button>` : '';
  detail.innerHTML = `
    <h3 class="card-title">🚩 Segnalazione #${report.id}</h3>
    <p>Stato: <b>${report.status}</b> · Segnalante: <code>${report.reporter_telegram_user_id}</code></p>
    <p>Target: ${targetKnown ? `<code>${report.reported_target_telegram_user_id}</code>` : '<i>non identificato</i>'}</p>
    <p>Motivo: ${(report.reason || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
    <div class="card" style="background:var(--bg-2);margin:0.6rem 0">${String(report.reported_message_text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <div style="display:flex;gap:0.45rem;flex-wrap:wrap">
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'take')">📌 Prendi in carico</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'archive')">✅ Archivia</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'unmute')">🔈 Unmute</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute2')">🔇 2h</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute4')">🔇 4h</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute8')">🔇 8h</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute16')">🔇 16h</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute24')">🔇 24h</button>
      <button class="btn-secondary btn-sm" onclick="botReportAction(${report.id}, 'mute48')">🔇 48h</button>
      ${banBtn}
      ${manualTargetBtn}
    </div>
  `;
}

async function botReportManualTarget(reportId) {
  if (!window._userBotAdminFull) {
    showBotAdminMsg('Solo gli amministratori possono impostare il target manuale.', 'error');
    return;
  }
  const v = prompt('Inserisci Telegram User ID target per questa segnalazione:');
  if (!v) return;
  const targetTelegramUserId = Number(v);
  if (!Number.isFinite(targetTelegramUserId)) {
    showBotAdminMsg('ID non valido.', 'error');
    return;
  }
  const res = await botAdminFetch('global_report_target', {}, 'PUT', { reportId, targetTelegramUserId });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Impostazione target manuale fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Target manuale salvato.');
  await openBotReport(reportId);
}

async function botReportAction(reportId, action) {
  const res = await botAdminFetch('global_report_action', {}, 'PUT', { reportId, action });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Azione segnalazione fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Azione segnalazione eseguita.');
  await openBotReport(reportId);
  await loadBotGlobalReports(_botReportFilter);
  if (window._userBotAdminFull) await loadBotAdminDashboard();
}

async function loadBotBannedUsers() {
  const box = document.getElementById('botadmin-banned');
  if (!box || !window._userBotAdminFull) return;
  box.innerHTML = '<p class="wl-loading">Caricamento utenti bannati…</p>';
  const res = await botAdminFetch('banned_users');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    box.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore caricamento bannati.'}</p>`;
    return;
  }
  const data = await res.json();
  const rows = data.users || [];
  if (!rows.length) {
    box.innerHTML = '<p class="wl-loading">Nessun utente bannato.</p>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Utente</th><th>Motivo</th><th>Aggiornato</th><th>Azioni</th></tr></thead>
        <tbody>
          ${rows.map((u) => `
            <tr>
              <td><code>${u.telegram_user_id}</code></td>
              <td>${String(u.reason || 'n/d').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
              <td>${new Date(u.updated_at).toLocaleString('it-IT')}</td>
              <td>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'unban')">✅ Unban</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'unmute')">🔈 Unmute</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute2')">🔇 2h</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute4')">🔇 4h</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute8')">🔇 8h</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute16')">🔇 16h</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute24')">🔇 24h</button>
                <button class="btn-secondary btn-sm" onclick="botUserRestrictionAction(${u.telegram_user_id}, 'mute48')">🔇 48h</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function botUserRestrictionAction(telegramUserId, action) {
  const res = await botAdminFetch('user_restriction_action', {}, 'PUT', { telegramUserId, action });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Azione utente fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Azione utente eseguita.');
  await loadBotBannedUsers();
  if (window._userBotAdminFull) await loadBotAdminDashboard();
}

async function loadBotModeratorsAdmin() {
  if (!window._userBotAdminFull) return;
  const box = document.getElementById('botadmin-moderators');
  if (!box) return;
  box.innerHTML = '<p class="wl-loading">Caricamento moderatori…</p>';
  const res = await botAdminFetch('moderators');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    box.innerHTML = `<p class="wl-err">❌ ${e.error || 'Errore caricamento moderatori.'}</p>`;
    return;
  }
  const { moderators } = await res.json();
  if (!moderators?.length) {
    box.innerHTML = '<p class="wl-loading">Nessun moderatore assegnato.</p>';
  } else {
    box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>Ruolo</th><th>Telegram</th><th></th></tr></thead>
        <tbody>
          ${moderators
            .map(
              (m) => `
            <tr>
              <td>${String(m.username || '—').replace(/</g, '&lt;')}</td>
              <td>${String(m.role || 'utente').replace(/</g, '&lt;')}</td>
              <td><code>${m.telegram_user_id != null ? m.telegram_user_id : '—'}</code></td>
              <td><button type="button" class="btn-danger btn-sm" onclick="removeBotModerator('${String(m.userId).replace(/'/g, "\\'")}')">Rimuovi</button></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
  }
  await populateBotModeratorUserSelect((moderators || []).map((m) => m.userId));
}

async function populateBotModeratorUserSelect(moderatorUserIds = []) {
  const sel = document.getElementById('botadmin-moderator-user-select');
  if (!sel) return;
  const modIds = new Set(moderatorUserIds);
  const res = await authFetch('/api/admin/users');
  if (!res.ok) {
    sel.innerHTML = '<option value="">— Errore lista utenti —</option>';
    return;
  }
  const { users } = await res.json();
  const opts = (users || []).filter((u) => !modIds.has(u.id) && (u.user_metadata?.role || '') !== 'admin');
  sel.innerHTML =
    '<option value="">— Seleziona utente —</option>' +
    opts
      .map((u) => {
        const un = u.user_metadata?.username || u.email?.split('@')[0] || 'utente';
        const role = u.user_metadata?.role || 'utente';
        return `<option value="${u.id}">${String(un).replace(/</g, '&lt;')} (${role})</option>`;
      })
      .join('');
}

async function addSelectedBotModerator() {
  const sel = document.getElementById('botadmin-moderator-user-select');
  const userId = sel?.value;
  if (!userId) {
    showBotAdminMsg('Seleziona un utente.', 'error');
    return;
  }
  const res = await authFetch('/api/admin/users', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, telegram_moderator: true }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Assegnazione fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Moderatore assegnato (serve account Telegram collegato al bot per il badge e le azioni).');
  await loadBotModeratorsAdmin();
}

async function removeBotModerator(userId) {
  if (!userId || !confirm('Rimuovere questo moderatore?')) return;
  const res = await authFetch('/api/admin/users', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, telegram_moderator: false }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showBotAdminMsg(`✗ ${e.error || 'Rimozione fallita.'}`, 'error');
    return;
  }
  showBotAdminMsg('✅ Moderatore rimosso.');
  await loadBotModeratorsAdmin();
}

document.getElementById('refresh-botadmin')?.addEventListener('click', async () => {
  if (window._userBotAdminFull) {
    await loadBotAdminDashboard();
    await loadBotBannedUsers();
    await loadBotModeratorsAdmin();
  }
  await loadBotTickets(_botTicketMode);
  await loadBotGlobalReports(_botReportFilter);
});

// ─────────────────────────────────────────────────────────────────────────────
// ── REGISTRI GUERRE ──────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function switchWarTab(tab, btn) {
  document.querySelectorAll('#tab-warlog .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('wl-classic').style.display = tab === 'classic' ? 'block' : 'none';
  document.getElementById('wl-cwl').style.display     = tab === 'cwl'     ? 'block' : 'none';
  document.getElementById('wl-capital').style.display = tab === 'capital' ? 'block' : 'none';
  if (tab === 'classic') loadWarLog();
  if (tab === 'cwl')     loadCwlSeasons();
  if (tab === 'capital') loadCapitalRaids();
}

// ── War Log classiche (API CoC) ──────────────────────
async function loadWarLog() {
  const div = document.getElementById('wl-classic-results');
  div.innerHTML = '<p class="wl-loading">Caricamento war log…</p>';
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const tag = window._userClanTag || '';
    const [r, cw] = await Promise.all([
      fetch(`/api/war-log${clanQ()}`, { signal: ctrl.signal }),
      tag ? fetchCurrentWarApi(tag) : Promise.resolve(null),
    ]);
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
    let items = (data.items || []).filter(w => {
      const wt = (w.warType || '').toLowerCase();
      if (wt === 'cwl') return false;
      if (!w.opponent?.name) return false;
      // Se le stelle superano il massimo possibile (teamSize * 3) è dati aggregati CWL
      const maxStars = (w.teamSize || 50) * 3;
      if ((w.clan?.stars || 0) > maxStars) return false;
      return true;
    });

    // Se currentwar è attiva/appena finita e non è già nel log, anteponila (con roster API)
    if (cw && ['preparation', 'inWar', 'warEnded'].includes(cw.state) && cw.opponent?.name) {
      const already = items.some(w => currentWarMatchesLogEntry(cw, w));
      if (!already) {
        const synth = {
          result: (() => {
            const a = cw.clan?.stars || 0, b = cw.opponent?.stars || 0;
            if (a > b) return 'win';
            if (a < b) return 'lose';
            return 'tie';
          })(),
          endTime: cw.endTime,
          teamSize: cw.teamSize,
          attacksPerMember: cw.attacksPerMember,
          clan: cw.clan,
          opponent: cw.opponent,
          _fromCurrentWar: true,
          _warState: cw.state,
        };
        items = [synth, ...items];
      } else {
        // Arricchisci la riga del log con members da currentwar (per dettaglio immediato)
        items = items.map(w => {
          if (!currentWarMatchesLogEntry(cw, w)) return w;
          return {
            ...w,
            clan: { ...(w.clan || {}), members: cw.clan?.members || w.clan?.members, badgeUrls: w.clan?.badgeUrls || cw.clan?.badgeUrls },
            opponent: { ...(w.opponent || {}), members: cw.opponent?.members || w.opponent?.members, badgeUrls: w.opponent?.badgeUrls || cw.opponent?.badgeUrls },
            attacksPerMember: w.attacksPerMember || cw.attacksPerMember,
            _fromCurrentWar: true,
            _warState: cw.state,
          };
        });
      }
    }

    if (!items.length) { div.innerHTML = '<p class="wl-loading">Nessuna war classica nel log.</p>'; return; }

    // Mappa per endTime — evita race condition se la lista si ricarica mentre un modal è aperto
    window._warLogMap = {};
    items.forEach((w, idx) => {
      const k = w.endTime || `live-${idx}`;
      window._warLogMap[k] = w;
      if (!w.endTime) w._mapKey = k;
    });

    const rows = items.map((w, idx) => {
      const mapKey = w.endTime || w._mapKey || String(idx);
      const date = w.endTime ? new Date(
        w.endTime.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')
      ).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'2-digit' }) : '—';

      const liveBadge = w._fromCurrentWar
        ? (w._warState === 'warEnded'
          ? ' <span class="wl-draw">Appena finita</span>'
          : w._warState === 'preparation'
            ? ' <span class="wl-draw">Preparazione</span>'
            : ' <span class="wl-win">In corso</span>')
        : '';

      const result = w.result === 'win' ? '<span class="wl-win">Vinta ✓</span>'
                   : w.result === 'lose' ? '<span class="wl-lose">Persa ✗</span>'
                   : '<span class="wl-draw">Patta =</span>';

      const stars     = `${w.clan?.stars ?? 0} ⭐ — ⭐ ${w.opponent?.stars ?? 0}`;
      const destrClan = w.clan?.destructionPercentage?.toFixed?.(1) ?? Number(w.clan?.destructionPercentage || 0).toFixed(1);
      const destrOpp  = w.opponent?.destructionPercentage?.toFixed?.(1) ?? Number(w.opponent?.destructionPercentage || 0).toFixed(1);
      const size      = w.teamSize ?? '?';

      const clanBadge  = w.clan?.badgeUrls?.small
        ? `<img src="${w.clan.badgeUrls.small}" alt="" class="wl-clan-badge">`  : '🛡️';
      const oppBadge   = w.opponent?.badgeUrls?.small
        ? `<img src="${w.opponent.badgeUrls.small}" alt="" class="wl-clan-badge">` : '🛡️';
      const clanLv  = w.clan?.clanLevel     ? `<span class="wl-clan-lv">Lv ${w.clan.clanLevel}</span>`     : '';
      const oppLv   = w.opponent?.clanLevel ? `<span class="wl-clan-lv">Lv ${w.opponent.clanLevel}</span>` : '';
      const oppName = w.opponent?.name ?? 'Sconosciuto';

      const ourClan = `<div class="wl-clan-cell">${clanBadge}<span>${w.clan?.name ?? 'Noi'}${clanLv}</span></div>`;
      const oppClan = `<div class="wl-clan-cell">${oppBadge}<span>${oppName}${oppLv}</span></div>`;
      const escKey = String(mapKey).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      return `<tr class="wl-row-clickable" onclick="openClassicWarDetail('${escKey}')">
        <td class="stat-cell">${date}${liveBadge}</td>
        <td>${result}</td>
        <td>${ourClan}</td>
        <td class="stat-cell" style="text-align:center">vs<br><span style="font-size:0.72rem;color:var(--text-3)">${size}v${size}</span></td>
        <td>${oppClan}</td>
        <td class="stat-cell">${stars}</td>
        <td class="stat-cell">${destrClan}% — ${destrOpp}%</td>
        <td class="stat-cell"><button class="btn-war-detail">Dettagli</button></td>
      </tr>`;
    }).join('');

    div.innerHTML = `
      <div class="table-wrap" style="margin-top:0.75rem">
        <table>
          <thead><tr>
            <th>Data</th><th>Risultato</th><th>Noi</th><th style="text-align:center">—</th>
            <th>Avversario</th><th>⭐ Noi — Loro</th><th>💥 Noi — Loro</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    _checkWarLiveBanner();
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

function _formatApiTime(raw) {
  if (!raw) return '—';
  try {
    return new Date(
      String(raw).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/, '$1-$2-$3T$4:$5:$6')
    ).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch (_) {
    return '—';
  }
}

async function loadCapitalRaids() {
  const div = document.getElementById('wl-capital-results');
  if (!div) return;
  div.innerHTML = '<p class="wl-loading">Caricamento weekend raid…</p>';

  try {
    const tag = window._userClanTag || '';
    let rows = [];

    // Fonte primaria: storico DB
    try {
      const dbRes = await db
        .from('capital_raids')
        .select('*')
        .eq('clan_tag', tag)
        .order('weekend_start', { ascending: false })
        .limit(12);
      if (!dbRes.error && Array.isArray(dbRes.data)) rows = dbRes.data;
    } catch (_) {}

    // Fallback: API live (se tabella non presente o vuota)
    if (!rows.length) {
      const r = await fetch(`/api/lookup?type=capital-raids&clanTag=${encodeURIComponent(tag)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        div.innerHTML = `<p class="wl-err">⚠️ ${data.error || 'Servizio raid non disponibile.'}</p>`;
        return;
      }
      rows = (Array.isArray(data.items) ? data.items : []).map((it) => {
        const members = Array.isArray(it?.members) ? it.members : [];
        const top = members
          .slice()
          .sort((a, b) => Number(b?.capitalResourcesLooted || 0) - Number(a?.capitalResourcesLooted || 0))[0] || null;
        return {
          weekend_start: it?.startTime || null,
          weekend_end: it?.endTime || null,
          capital_total_loot: Number(it?.capitalTotalLoot || 0),
          total_attacks: Number(it?.totalAttacks || 0),
          enemy_districts_destroyed: Number(it?.enemyDistrictsDestroyed || 0),
          raids_completed: Number(it?.raidsCompleted || 0),
          top_contributor_name: top?.name || null,
          top_contributor_loot: Number(top?.capitalResourcesLooted || 0),
          members,
        };
      });
    }

    if (!rows.length) {
      div.innerHTML = '<p class="wl-loading">Nessun weekend raid disponibile.</p>';
      return;
    }

    const cards = rows.map((r, ridx) => `
      <div class="raid-card raid-card--clickable" onclick="openCapitalRaidDetail(${ridx})" title="Clicca per il dettaglio membri">
        <div class="raid-card-top">
          <div><strong>${_formatApiTime(r.weekend_start)}</strong> <span style="color:var(--text-3)">→ ${_formatApiTime(r.weekend_end)}</span></div>
          <div class="raid-loot">💰 ${Number(r.capital_total_loot || 0).toLocaleString('it-IT')}</div>
        </div>
        <div class="raid-metrics">
          <span>⚔️ Attacchi: <b>${Number(r.total_attacks || 0)}</b></span>
          <span>🏚️ Distretti: <b>${Number(r.enemy_districts_destroyed || 0)}</b></span>
          <span>✅ Raid completati: <b>${Number(r.raids_completed || 0)}</b></span>
        </div>
        <div class="raid-top-player">🥇 Top contributore: <b>${r.top_contributor_name || '—'}</b> · ${Number(r.top_contributor_loot || 0).toLocaleString('it-IT')} loot</div>
        <div class="raid-card-hint">Dettagli membri →</div>
      </div>
    `).join('');

    window._capitalRaidRows = rows;
    div.innerHTML = `<div class="raid-list">${cards}</div>`;
  } catch (_) {
    div.innerHTML = '<p class="wl-err">⚠️ Impossibile caricare i weekend raid.</p>';
  }
}

function openCapitalRaidDetail(idx) {
  const r = (window._capitalRaidRows || [])[idx];
  if (!r) return;
  document.getElementById('capital-raid-detail-modal')?.remove();

  let members = r.members;
  if (typeof members === 'string') {
    try { members = JSON.parse(members); } catch (_) { members = []; }
  }
  if (!Array.isArray(members)) members = [];
  const sorted = members.slice().sort((a, b) =>
    Number(b?.capitalResourcesLooted || 0) - Number(a?.capitalResourcesLooted || 0)
  );

  const memberCards = sorted.length
    ? sorted.map((m, i) => {
        const loot = Number(m.capitalResourcesLooted || 0).toLocaleString('it-IT');
        const atks = m.attacks != null ? Number(m.attacks) : (m.attackCount != null ? Number(m.attackCount) : '—');
        return `<div class="wdm-member-card">
          <div class="wdm-member-header">
            <span class="wdm-pos">${i + 1}.</span>
            <span class="wdm-name">${m.name || '—'}</span>
            <span class="wdm-total-stars wdm-total-stars--good">💰 ${loot}</span>
          </div>
          <div class="wdm-atk-list">
            <div class="wdm-atk-row">
              <span class="wdm-atk-label">Attacchi</span>
              <span class="wdm-atk-pct">${atks}</span>
              <span class="wdm-atk-target mono" style="font-size:0.72rem;color:var(--text-3)">${m.tag || ''}</span>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<p class="wdm-no-data">Dettaglio membri non disponibile per questo weekend (verrà salvato automaticamente ai prossimi raid).</p>';

  const modal = document.createElement('div');
  modal.id = 'capital-raid-detail-modal';
  modal.className = 'cdm-overlay';
  modal.innerHTML = `
    <div class="cdm-box wdm-box" onclick="event.stopPropagation()">
      <div class="cdm-header">
        <div class="cdm-header-left">
          <div>
            <div class="cdm-header-season">Capital Raid</div>
            <div class="cdm-header-league" style="color:var(--text-3)">${_formatApiTime(r.weekend_start)} → ${_formatApiTime(r.weekend_end)}</div>
          </div>
        </div>
        <button class="cdm-close" onclick="closeCapitalRaidDetail()">✕</button>
      </div>
      <div class="cdm-war-header" style="grid-template-columns:1fr 1fr 1fr">
        <div class="cdm-war-side"><div class="cdm-war-stars">💰 ${Number(r.capital_total_loot || 0).toLocaleString('it-IT')}</div><div class="cdm-war-destr">Loot totale</div></div>
        <div class="cdm-war-side"><div class="cdm-war-stars">⚔️ ${Number(r.total_attacks || 0)}</div><div class="cdm-war-destr">Attacchi</div></div>
        <div class="cdm-war-side"><div class="cdm-war-stars">🏚️ ${Number(r.enemy_districts_destroyed || 0)}</div><div class="cdm-war-destr">Distretti</div></div>
      </div>
      <div class="wdm-panel" style="margin-top:0.75rem">${memberCards}</div>
    </div>`;
  modal.addEventListener('click', closeCapitalRaidDetail);
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('cdm-overlay--visible'));
}

function closeCapitalRaidDetail() {
  const modal = document.getElementById('capital-raid-detail-modal');
  if (!modal) return;
  modal.classList.remove('cdm-overlay--visible');
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
}

// ── DETTAGLIO WAR CLASSICA ────────────────────────────────────────────────────

function _parseWarMembersJson(maybe) {
  if (!maybe) return null;
  if (Array.isArray(maybe)) return maybe;
  if (typeof maybe === 'string') {
    try {
      const p = JSON.parse(maybe);
      return Array.isArray(p) ? p : null;
    } catch (_) { return null; }
  }
  return null;
}

/** Carica dettaglio roster da classic_wars (match esatto end_time, poi giorno+avversario). */
async function fetchClassicWarEnrichment(clanTag, war) {
  const tag = normClanTag(clanTag);
  if (!tag || !war?.endTime) return null;
  try {
    const { data } = await db.from('classic_wars')
      .select('*')
      .eq('clan_tag', tag)
      .eq('end_time', war.endTime)
      .maybeSingle();
    if (data && (_parseWarMembersJson(data.our_members)?.length || _parseWarMembersJson(data.opp_members)?.length)) {
      return data;
    }
    if (data) return data;

    const day = String(war.endTime).slice(0, 8);
    const opp = war.opponent?.tag ? normClanTag(war.opponent.tag) : null;
    const { data: list } = await db.from('classic_wars')
      .select('*')
      .eq('clan_tag', tag)
      .like('end_time', `${day}%`)
      .limit(8);
    if (!list?.length) return null;
    if (opp) {
      const byOpp = list.find(r => normClanTag(r.opp_tag) === opp);
      if (byOpp) return byOpp;
    }
    return list.find(r => _parseWarMembersJson(r.our_members)?.length) || list[0];
  } catch (_) {
    return null;
  }
}

/**
 * API CoC: solo /currentwar espone roster+attacchi (warlog = solo riepilogo).
 * Utile per war in corso e per warEnded finché non parte un nuovo matchmaking.
 */
async function fetchCurrentWarApi(clanTag) {
  const tag = normClanTag(clanTag);
  if (!tag) return null;
  try {
    const r = await fetch(`/api/war-log?type=current&clanTag=${encodeURIComponent(tag)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const raw = await r.json();
    const data = raw?.state ? raw : (raw?.data || raw);
    if (!data || data.state === 'notInWar' || !data.state) return null;
    if ((data.warType || '').toLowerCase() === 'cwl') return null;
    return data;
  } catch (_) {
    return null;
  }
}

function currentWarMatchesLogEntry(cw, w) {
  if (!cw || !w) return false;
  if (cw.endTime && w.endTime && String(cw.endTime) === String(w.endTime)) return true;
  const oppCw = cw.opponent?.tag ? normClanTag(cw.opponent.tag) : '';
  const oppW = w.opponent?.tag ? normClanTag(w.opponent.tag) : '';
  if (oppCw && oppW && oppCw === oppW) {
    if (!cw.endTime || !w.endTime) return true;
    return String(cw.endTime).slice(0, 8) === String(w.endTime).slice(0, 8);
  }
  return false;
}

/** Converte payload currentwar → shape classic_wars (per il modal dettaglio). */
function currentWarToEnrichment(cw) {
  if (!cw?.clan) return null;
  let result = 'tie';
  const our = cw.clan || {};
  const opp = cw.opponent || {};
  if ((our.stars || 0) > (opp.stars || 0)) result = 'win';
  else if ((our.stars || 0) < (opp.stars || 0)) result = 'lose';
  else if ((our.destructionPercentage || 0) > (opp.destructionPercentage || 0)) result = 'win';
  else if ((our.destructionPercentage || 0) < (opp.destructionPercentage || 0)) result = 'lose';

  const mapMembers = (arr) => (arr || []).map(m => ({
    tag: m.tag,
    name: m.name,
    townhallLevel: m.townhallLevel ?? m.townHallLevel ?? m.thLevel ?? null,
    mapPosition: m.mapPosition,
    attacks: (m.attacks || []).map(a => ({
      defenderTag: a.defenderTag,
      stars: a.stars,
      destructionPercentage: a.destructionPercentage,
      order: a.order,
    })),
  }));

  return {
    end_time: cw.endTime,
    result: cw.result || result,
    team_size: cw.teamSize ?? null,
    atk_per_member: cw.attacksPerMember ?? 2,
    our_tag: our.tag,
    our_name: our.name,
    our_badge: our.badgeUrls?.small ?? null,
    our_stars: our.stars ?? 0,
    our_destr: +(our.destructionPercentage ?? 0).toFixed(2),
    opp_tag: opp.tag,
    opp_name: opp.name,
    opp_badge: opp.badgeUrls?.small ?? null,
    opp_stars: opp.stars ?? 0,
    opp_destr: +(opp.destructionPercentage ?? 0).toFixed(2),
    our_members: mapMembers(our.members),
    opp_members: mapMembers(opp.members),
    _fromCurrentWarApi: true,
    _warState: cw.state,
  };
}

/**
 * @param {string} key — endTime war
 * @param {{ clanTag?: string, warMap?: object }} [opts]
 */
async function openClassicWarDetail(key, opts) {
  opts = opts || {};
  const warMap = opts.warMap || window._warLogMap || {};
  const w = warMap[key];
  if (!w) return;

  document.getElementById('classic-war-detail-modal')?.remove();

  const clanTag = normClanTag(opts.clanTag || window._userClanTag);
  let enriched = null;
  if (w.endTime && clanTag) {
    enriched = await fetchClassicWarEnrichment(clanTag, w);
  }

  // Se manca il roster in DB: prova currentwar CoC (in corso o appena terminata)
  let ourMembers = _parseWarMembersJson(enriched?.our_members);
  let oppMembers = _parseWarMembersJson(enriched?.opp_members);
  if (!ourMembers?.length) ourMembers = w.clan?.members || null;
  if (!oppMembers?.length) oppMembers = w.opponent?.members || null;
  if ((!ourMembers?.length && !oppMembers?.length) && clanTag) {
    const cw = await fetchCurrentWarApi(clanTag);
    if (cw && currentWarMatchesLogEntry(cw, w)) {
      enriched = currentWarToEnrichment(cw) || enriched;
      ourMembers = _parseWarMembersJson(enriched?.our_members);
      oppMembers = _parseWarMembersJson(enriched?.opp_members);
    } else if (cw && !w.endTime && ['preparation', 'inWar', 'warEnded'].includes(cw.state)) {
      // Riga live senza endTime nel log
      enriched = currentWarToEnrichment(cw) || enriched;
      ourMembers = _parseWarMembersJson(enriched?.our_members);
      oppMembers = _parseWarMembersJson(enriched?.opp_members);
    }
  }

  const fmtDate = w.endTime ? new Date(
    w.endTime.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')
  ).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' }) : '—';

  const resClass = w.result === 'win' ? 'cdm-result--win' : w.result === 'lose' ? 'cdm-result--lose' : 'cdm-result--draw';
  const resLabel = w.result === 'win' ? 'VITTORIA' : w.result === 'lose' ? 'SCONFITTA' : 'PAREGGIO';

  const clanBadge = w.clan?.badgeUrls?.small
    ? `<img src="${w.clan.badgeUrls.small}" class="cdm-war-badge" alt="">`
    : (enriched?.our_badge ? `<img src="${enriched.our_badge}" class="cdm-war-badge" alt="">` : '<span class="cdm-war-badge-ph">🛡️</span>');
  const oppBadge = w.opponent?.badgeUrls?.small
    ? `<img src="${w.opponent.badgeUrls.small}" class="cdm-war-badge" alt="">`
    : (enriched?.opp_badge ? `<img src="${enriched.opp_badge}" class="cdm-war-badge" alt="">` : '<span class="cdm-war-badge-ph">🛡️</span>');

  const size = (enriched?.team_size ?? w.teamSize) ?? '?';
  const atkPerMember = enriched?.atk_per_member ?? w.attacksPerMember ?? 2;

  // Mappa tag → {name, pos} — usa roster arricchito se presente (war-log non ha members)
  const defMap = {};
  [...(ourMembers || []), ...(oppMembers || [])].forEach(m => {
    if (m?.tag) defMap[m.tag] = { name: m.name, pos: m.mapPosition };
  });

  function starsRow(stars, maxStars) {
    return '★'.repeat(stars) + '☆'.repeat(Math.max(0, maxStars - stars));
  }

  function buildTeamCards(members) {
    if (!members?.length) {
      return `<p class="wdm-no-data">Dati non disponibili per questa war.<br>
        <span style="font-size:0.78rem;color:var(--text-3)">L'API CoC espone attacchi/roster solo sulla war corrente (in corso o appena finita). Le war più vecchie restano in archivio se salvate automaticamente.</span></p>`;
    }

    const sorted = [...members].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
    return sorted.map(m => {
      const thN = String(m.townhallLevel ?? 1).padStart(2, '0');
      const thSrc = (m.townhallLevel ?? 1) <= 18 ? `th/level_${thN}.webp` : `th/level_${thN}.png`;
      const thFb  = `onerror="this.onerror=null;this.src='th/level_${thN}.png'"`;

      const attacks = [...(m.attacks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const totalStars = attacks.reduce((s, a) => s + (a.stars ?? 0), 0);

      const atkRows = Array.from({ length: atkPerMember }, (_, i) => {
        const a = attacks[i];
        if (!a) {
          return `<div class="wdm-atk-row">
            <span class="wdm-atk-label">Attacco ${i + 1}</span>
            <span class="wdm-atk-unused">Non utilizzato</span>
          </div>`;
        }
        const def = defMap[a.defenderTag];
        const defLabel = def ? `${def.pos}. ${def.name}` : a.defenderTag ?? '?';
        const destr = (a.destructionPercentage ?? 0).toFixed(0);
        const stars = a.stars ?? 0;
        const starsHtml = `<span class="wdm-star-row wdm-star-row--${stars > 0 ? 'hit' : 'miss'}">${starsRow(stars, 3)}</span>`;
        return `<div class="wdm-atk-row">
          <span class="wdm-atk-label">Attacco ${i + 1}</span>
          <span class="wdm-atk-target">${defLabel}</span>
          <span class="wdm-atk-pct">${destr}%</span>
          ${starsHtml}
        </div>`;
      }).join('');

      const totalStarsHtml = `<span class="wdm-total-stars wdm-total-stars--${totalStars >= 5 ? 'great' : totalStars >= 3 ? 'good' : 'low'}">${totalStars}★</span>`;

      return `<div class="wdm-member-card">
        <div class="wdm-member-header">
          <span class="wdm-pos">${m.mapPosition ?? '—'}.</span>
          <img src="${thSrc}" ${thFb} class="wdm-th-img" alt="TH${m.townhallLevel ?? '?'}">
          <span class="wdm-name">${m.name ?? '—'}</span>
          ${totalStarsHtml}
        </div>
        <div class="wdm-atk-list">${atkRows}</div>
      </div>`;
    }).join('');
  }

  const ourCards = buildTeamCards(ourMembers);
  const oppCards = buildTeamCards(oppMembers);
  const ourName = w.clan?.name ?? enriched?.our_name ?? 'Noi';
  const oppName = w.opponent?.name ?? enriched?.opp_name ?? 'Avversario';
  const liveHint = enriched?._fromCurrentWarApi
    ? `<div style="font-size:0.75rem;color:var(--text-3);padding:0 0.25rem 0.5rem">Fonte: API CoC current war${enriched._warState ? ` (${enriched._warState})` : ''} — snapshot automatico</div>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'classic-war-detail-modal';
  modal.className = 'cdm-overlay';
  modal.innerHTML = `
    <div class="cdm-box wdm-box" onclick="event.stopPropagation()">
      <div class="cdm-header">
        <div class="cdm-header-left">
          <div>
            <div class="cdm-header-season">War Classica — ${fmtDate}</div>
            <div class="cdm-header-league" style="color:var(--text-3)">${size}v${size}</div>
          </div>
        </div>
        <button class="cdm-close" onclick="closeClassicWarDetail()">✕</button>
      </div>
      ${liveHint}

      <div class="cdm-war-header">
        <div class="cdm-war-side cdm-war-side--us">
          ${clanBadge}
          <div class="cdm-war-clan-name">${ourName}</div>
          <div class="cdm-war-stars">⭐ ${w.clan?.stars ?? enriched?.our_stars ?? 0}</div>
          <div class="cdm-war-destr">💥 ${(+(w.clan?.destructionPercentage ?? enriched?.our_destr ?? 0)).toFixed(1)}%</div>
        </div>
        <div class="cdm-war-vs">
          <div class="cdm-war-result ${resClass}">${resLabel}</div>
          <div class="cdm-war-vs-label">VS</div>
        </div>
        <div class="cdm-war-side cdm-war-side--opp">
          ${oppBadge}
          <div class="cdm-war-clan-name">${oppName}</div>
          <div class="cdm-war-stars">⭐ ${w.opponent?.stars ?? enriched?.opp_stars ?? 0}</div>
          <div class="cdm-war-destr">💥 ${(+(w.opponent?.destructionPercentage ?? enriched?.opp_destr ?? 0)).toFixed(1)}%</div>
        </div>
      </div>

      <div class="wdm-tab-bar">
        <button class="wdm-tab active" id="wdm-tab-us" onclick="_wdmTab('us')">
          ${clanBadge} ${ourName === 'Noi' ? 'La Nostra Squadra' : ourName}
        </button>
        <button class="wdm-tab" id="wdm-tab-opp" onclick="_wdmTab('opp')">
          ${oppBadge} ${oppName}
        </button>
      </div>
      <div id="wdm-panel-us" class="wdm-panel">${ourCards}</div>
      <div id="wdm-panel-opp" class="wdm-panel" style="display:none">${oppCards}</div>
    </div>`;

  modal.addEventListener('click', closeClassicWarDetail);
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('cdm-overlay--visible'));
}

function _wdmTab(tab) {
  document.getElementById('wdm-panel-us').style.display  = tab === 'us'  ? 'block' : 'none';
  document.getElementById('wdm-panel-opp').style.display = tab === 'opp' ? 'block' : 'none';
  document.getElementById('wdm-tab-us').classList.toggle('active',  tab === 'us');
  document.getElementById('wdm-tab-opp').classList.toggle('active', tab === 'opp');
}

function closeClassicWarDetail() {
  const modal = document.getElementById('classic-war-detail-modal');
  if (!modal) return;
  modal.classList.remove('cdm-overlay--visible');
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
}

// saveCurrentWar rimosso — le war vengono salvate automaticamente dal bot e dal cron Vercel

// ── CRONOLOGIA LEGHE CWL ─────────────────────────────────────────────────────

// Mappa posizione → testo italiano
const POS_LABELS = ['', '1° Primo', '2° Secondo', '3° Terzo', '4° Quarto',
                    '5° Quinto', '6° Sesto', '7° Settimo', '8° Ottavo'];
const POS_COLORS = ['', '#f0a500','#c0cce8','#e07040','#7aaccc',
                    '#7a9ab8','#7a9ab8','#5a7a98','#5a7a98'];
const POS_MEDALS = ['', '🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

// Mappa nome lega inglese (API) → italiano (UI)
const LEAGUE_EN_TO_IT = {
  // CWL war league (storiche)
  'Bronze League III':'Bronzo III','Bronze League II':'Bronzo II','Bronze League I':'Bronzo I',
  'Silver League III':'Argento III','Silver League II':'Argento II','Silver League I':'Argento I',
  'Gold League III':'Oro III','Gold League II':'Oro II','Gold League I':'Oro I',
  'Crystal League III':'Cristallo III','Crystal League II':'Cristallo II','Crystal League I':'Cristallo I',
  'Master League III':'Maestro III','Master League II':'Maestro II','Master League I':'Maestro I',
  'Champion League III':'Campione III','Champion League II':'Campione II','Champion League I':'Campione I',
  'Titan League III':'Titano III','Titan League II':'Titano II','Titan League I':'Titano I',
  'Legend League':'Leggenda',
  // Nuove leghe Ranked Battles (ottobre 2025)
  'Skeleton League I':'Scheletro I','Skeleton League II':'Scheletro II','Skeleton League III':'Scheletro III',
  'Skeleton League':'Scheletro',
  'Barbarian League I':'Barbaro I','Barbarian League II':'Barbaro II','Barbarian League III':'Barbaro III',
  'Barbarian League':'Barbaro',
  'Archer League I':'Arciera I','Archer League II':'Arciera II','Archer League III':'Arciera III',
  'Archer League':'Arciera',
  'Wizard League I':'Mago I','Wizard League II':'Mago II','Wizard League III':'Mago III',
  'Wizard League':'Mago',
  'Valkyrie League I':'Valchiria I','Valkyrie League II':'Valchiria II','Valkyrie League III':'Valchiria III',
  'Valkyrie League':'Valchiria',
  'Witch League I':'Strega I','Witch League II':'Strega II','Witch League III':'Strega III',
  'Witch League':'Strega',
  'Golem League I':'Golem I','Golem League II':'Golem II','Golem League III':'Golem III',
  'Golem League':'Golem',
  'P.E.K.K.A League I':'P.E.K.K.A I','P.E.K.K.A League II':'P.E.K.K.A II','P.E.K.K.A League III':'P.E.K.K.A III',
  'P.E.K.K.A League':'P.E.K.K.A',
  'Electro Titan League I':'Elettro Titano I','Electro Titan League II':'Elettro Titano II','Electro Titan League III':'Elettro Titano III',
  'Electro Titan League':'Elettro Titano',
  'Dragon League I':'Drago I','Dragon League II':'Drago II','Dragon League III':'Drago III',
  'Dragon League':'Drago',
  'Electro Dragon League I':'Elettro Drago I','Electro Dragon League II':'Elettro Drago II','Electro Dragon League III':'Elettro Drago III',
  'Electro Dragon League':'Elettro Drago',
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
  // season = 'YYYY-MM' oppure 'YYYY-MM-DD' (API CWL)
  const [y, m] = String(season || '').split('-');
  return `Stagione di ${MONTH_IT[+m] || season} ${y}`;
}

/** Chiave mese per dedup stagioni CWL: '2026-08-01' e '2026-08' → '2026-08' */
function seasonMonthKey(season) {
  const parts = String(season || '').split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return String(season || '');
}

function _cwlSeasonRichness(s, roundsMap) {
  let score = 0;
  if (s?.isLive) score += 100;
  if (s?.position != null) score += 10;
  if (s?.league) score += 5;
  if (s?.groupStandings?.length) score += 20;
  if (s?.players?.length) score += 10;
  const rounds = roundsMap?.[s?.season] || [];
  if (rounds.length) score += rounds.length;
  if (rounds.some(r => r?.clan?.members?.length || r?.defenderMap)) score += 50;
  if (String(s?.season || '').length > 7) score += 3; // preferisci YYYY-MM-DD da API
  return score;
}

/**
 * Unisce 'YYYY-MM' (war-log) con 'YYYY-MM-DD' (API/DB) dello stesso mese.
 * Se nello stesso mese ci sono due date API distinte (es. giugno doppia CWL), le tiene entrambe.
 */
function dedupeCwlSeasonEntries(merged, roundsMap) {
  const byMonth = new Map();
  for (const s of merged) {
    const mk = seasonMonthKey(s.season);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(s);
  }
  const out = [];
  for (const [, group] of byMonth) {
    const fullDates = group.filter(s => String(s.season).length > 7);
    if (fullDates.length >= 2) {
      out.push(...fullDates);
      continue;
    }
    const best = group.slice().sort(
      (a, b) => _cwlSeasonRichness(b, roundsMap) - _cwlSeasonRichness(a, roundsMap)
    )[0];
    for (const o of group) {
      if (o.season === best.season) continue;
      if (best.position == null && o.position != null) best.position = o.position;
      if (!best.league && o.league) best.league = o.league;
      if (best.stars == null && o.stars != null) best.stars = o.stars;
      if (best.destruction == null && o.destruction != null) best.destruction = o.destruction;
      if (best.attacks == null && o.attacks != null) best.attacks = o.attacks;
      if (best.wins == null && o.wins != null) best.wins = o.wins;
      if (best.losses == null && o.losses != null) best.losses = o.losses;
      if (!best.groupStandings && o.groupStandings) best.groupStandings = o.groupStandings;
      if (!best.players && o.players) best.players = o.players;
      const bestR = roundsMap[best.season];
      const otherR = roundsMap[o.season];
      const otherHasMembers = otherR?.some(r => r?.clan?.members?.length);
      const bestHasMembers = bestR?.some(r => r?.clan?.members?.length);
      if ((!bestR?.length && otherR?.length) || (otherHasMembers && !bestHasMembers)) {
        roundsMap[best.season] = otherR;
      }
      best.hasRounds = !!(roundsMap[best.season]?.length);
    }
    out.push(best);
  }
  out.sort((a, b) => b.season.localeCompare(a.season));
  return out;
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

  // Lancia in parallelo: Supabase + war-log (storico CWL) + cwl-stats (stagione corrente) + clan-info + cwl_wars storico
  const [dbResult, warLogResult, cwlResult, clanResult, cwlWarsResult] = await Promise.allSettled([
    db.from('cwl_seasons').select('*').eq('clan_tag', window._userClanTag || '').order('season', { ascending: false }),
    fetch(`/api/war-log${clanQ()}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/cwl-stats${clanQ()}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/clan-info${clanQ()}`).then(r => r.ok ? r.json() : null),
    db.from('cwl_wars').select('*').eq('clan_tag', window._userClanTag || '').order('season', { ascending: false }).order('round', { ascending: true })
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

  // ── cwl_wars DB: turni storici con dettaglio completo (attacchi, members) ──
  const cwlWarsRaw = cwlWarsResult?.status === 'fulfilled' ? cwlWarsResult.value : { data: null };
  if (cwlWarsRaw.data?.length) {
    const bySeason = {};
    cwlWarsRaw.data.forEach(w => {
      if (!bySeason[w.season]) bySeason[w.season] = [];
      bySeason[w.season].push({
        roundNumber:      w.round,
        state:            w.state || 'warEnded',
        startTime:        w.start_time || null,
        preparationStartTime: null,
        endTime:          w.end_time || null,
        teamSize:         w.team_size || 15,
        attacksPerMember: 1,
        result:           w.result || 'draw',
        clan: {
          tag: w.our_tag, name: w.our_name, badgeUrls: w.our_badge ? { small: w.our_badge } : null,
          stars: w.our_stars || 0,
          destruction: +(w.our_destr || 0),
          attacksUsed: (w.our_members || []).reduce((s, m) => s + (m.attacks?.length || 0), 0),
          members: w.our_members || []
        },
        opponent: {
          tag: w.opp_tag, name: w.opp_name || 'Sconosciuto',
          badgeUrls: w.opp_badge ? { small: w.opp_badge } : null,
          stars: w.opp_stars || 0,
          destruction: +(w.opp_destr || 0),
          attacksUsed: (w.opp_members || []).reduce((s, m) => s + (m.attacks?.length || 0), 0),
          members: w.opp_members || []
        },
        defenderMap: w.defender_map || {}
      });
    });
    Object.entries(bySeason).forEach(([season, rounds]) => {
      const prefer = !warSeasonRoundsMap[season] || !warSeasonRoundsMap[season][0]?.clan?.members?.length;
      if (prefer) warSeasonRoundsMap[season] = rounds;
      // Alias mese: i round war-log usano YYYY-MM, cwl_wars usa YYYY-MM-DD
      const mk = seasonMonthKey(season);
      if (mk && mk !== season) {
        if (!warSeasonRoundsMap[mk] || !warSeasonRoundsMap[mk][0]?.clan?.members?.length) {
          warSeasonRoundsMap[mk] = rounds;
        }
      }
    });
  }

  // ── Stagione corrente/live da cwl-stats ───────────────────────────────────
  if (cwlData && cwlData.state !== 'notInWar' && cwlData.season) {
    const key      = cwlData.season;
    const ourGroup = (cwlData.groupStandings || []).find(c => normClanTag(c.tag) === normClanTag(window._userClanTag));
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
      roundsData:     cwlData.roundsData             || null,
      players:        cwlData.players                || null
    };
    // Sostituisce i dati war-log per la stagione live con quelli più dettagliati da cwl-stats
    if (cwlData.roundsData?.length) warSeasonRoundsMap[key] = cwlData.roundsData;
  }

  // Salva globalmente per accesso dal modal dettaglio stagione (poi aggiornato dopo dedup)
  window._cwlSeasonRoundsMap = warSeasonRoundsMap;

  // ── Merge: unifica DB + war-log ───────────────────────────────────────────
  const allSeasons = new Set([...Object.keys(dbMap), ...Object.keys(warSeasonMap)]);
  const merged = [];
  allSeasons.forEach(s => {
    const d  = dbMap[s]       || {};
    const wl = warSeasonMap[s] || {};
    // Round anche sotto chiave mese (war-log YYYY-MM ↔ DB YYYY-MM-DD)
    const mk = seasonMonthKey(s);
    const rounds = warSeasonRoundsMap[s] || warSeasonRoundsMap[mk] || [];
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
      groupStandings: d.groupStandings || d.group_standings || null,
      players:        d.players        || d.roster          || null,
      hasRounds:      !!rounds.length
    });
  });
  merged.sort((a, b) => b.season.localeCompare(a.season));

  const deduped = dedupeCwlSeasonEntries(merged, warSeasonRoundsMap);
  window._cwlSeasonRoundsMap = warSeasonRoundsMap;
  window._cwlMergedSeasons = deduped;
  renderCwlSeasons(deduped, cwlSeasonsTableMissing);
}

// ── ANTEPRIMA CWL ─────────────────────────────────────────────────────────────

function toggleCwlGroup(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const btn = el.previousElementSibling;
  const isOpen = el.style.display === 'none';
  el.style.display = isOpen ? 'block' : 'none';
  if (btn) {
    btn.textContent = isOpen ? 'Nascondi classifica ▲' : 'Mostra classifica ▼';
    btn.setAttribute('aria-expanded', isOpen);
  }
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

      // Classifica gruppo (collassabile — bottone "Mostra classifica")
      let groupHtml = '';
      if (s.groupStandings?.length) {
        const rowsHtml = s.groupStandings.map((c, i) => {
          const isMyClan = normClanTag(c.tag) === normClanTag(window._userClanTag);
          const rankMedal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
          const bUrl = cocBadgeUrl(c.badgeUrls);
          const badge = bUrl
            ? `<img src="${bUrl}" class="cwl-group-badge" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='0.35'">`
            : '<span class="cwl-group-badge-ph">🛡️</span>';
          return `<div class="cwl-group-row${isMyClan ? ' cwl-group-row--us' : ''}">
            <span class="cwl-group-rank">${rankMedal}</span>
            ${badge}
            <span class="cwl-group-name">${isMyClan ? `<strong>${c.name}</strong>` : c.name}</span>
            <span class="cwl-group-stars">⭐ ${c.stars}</span>
            <span class="cwl-group-destr">💥 ${c.warCount ? (c.totalDestr/c.warCount).toFixed(0) : 0}%</span>
          </div>`;
        }).join('');
        const sid = `grp-${s.season.replace(/[^a-z0-9]/gi, '')}`;
        groupHtml = `
          <div class="cwl-group-toggle-wrap">
            <button class="cwl-group-toggle-btn" onclick="toggleCwlGroup('${sid}')" aria-expanded="false" aria-controls="${sid}">Mostra classifica ▼</button>
            <div class="cwl-group-standings" id="${sid}" style="display:none">
              ${rowsHtml}
            </div>
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

function openCwlSeasonDetail(season, modalExtra) {
  window._cwlOpenSeason = season;
  window._cwlModalAlienFocusTag = null;
  let rounds = (window._cwlSeasonRoundsMap || {})[season] || [];
  if (!rounds.length) {
    const mk = seasonMonthKey(season);
    rounds = (window._cwlSeasonRoundsMap || {})[mk] || [];
  }
  if (!rounds.length) return;
  let groupStandings = null;
  const allMerged = window._cwlMergedSeasons || [];
  const seasonObj  = allMerged.find(s => s.season === season);
  if (seasonObj?.groupStandings) groupStandings = seasonObj.groupStandings;
  const ctx = modalExtra && typeof modalExtra === 'object' ? modalExtra : null;
  _renderCwlDetailModal(season, rounds, groupStandings, seasonObj, ctx);
}

/** Apre il dettaglio CWL dal punto di vista di un altro clan dello stesso gruppo (solo stagione live). */
async function openCwlSeasonDetailAsClan(season, clanTag) {
  const tag = normClanTag(clanTag);
  if (normClanTag(tag) === normClanTag(window._userClanTag)) {
    openCwlSeasonDetail(season);
    return;
  }
  const merged = window._cwlMergedSeasons || [];
  const baseSeason = merged.find(s => s.season === season);
  if (!baseSeason?.isLive) {
    alert('La vista per altri clan è disponibile solo per la stagione CWL in corso.');
    return;
  }
  window._cwlOpenSeason = season;
  try {
    const r = await fetch(`/api/cwl-stats?clanTag=${encodeURIComponent(tag)}`);
    const d = await r.json();
    if (!r.ok) {
      alert(d.error || 'Errore caricamento CWL.');
      return;
    }
    if (d.state === 'notInWar' || !d.roundsData?.length) {
      alert('Nessun dato CWL per questo clan (deve essere in CWL con round attivi).');
      return;
    }
    const focusName = (d.groupStandings || []).find(c => normClanTag(c.tag) === normClanTag(tag))?.name
      || d.roundsData[0]?.clan?.name || 'Clan';
    const seasonObj = {
      season: d.season || season,
      league: d.leagueNameIt || baseSeason.league,
      position: d.ourPosition,
      isLive: d.state !== 'ended',
      groupStandings: d.groupStandings,
      players: d.players
    };
    _renderCwlDetailModal(season, d.roundsData, d.groupStandings, seasonObj, { focusClanTag: tag, focusClanName: focusName });
  } catch (e) {
    alert(e.message || 'Errore di rete');
  }
}

function _renderCwlDetailModal(season, rounds, groupStandings, seasonObj, modalContext) {
  document.getElementById('cwl-detail-modal')?.remove();

  const focusClanTag = normClanTag(modalContext?.focusClanTag || window._userClanTag);
  const focusClanName = modalContext?.focusClanName || window._clanName || 'Il tuo clan';
  window._cwlModalAlienFocusTag = modalContext?.focusClanTag || null;

  const league      = seasonObj?.league   || null;
  const position    = seasonObj?.position || null;
  const isLive      = seasonObj?.isLive   || false;
  const badgeUrl    = league ? (LEAGUE_BADGE[league] || null) : null;
  const leagueColor = league ? (LEAGUE_COLOR[league] || 'var(--gold)') : 'var(--gold)';
  const posMedal    = position ? (POS_MEDALS[+position] || `${position}°`) : null;
  const posLabel    = position ? (POS_LABELS[+position]  || `${position}°`) : null;
  const isAlienView = !!(modalContext?.focusClanTag && normClanTag(modalContext.focusClanTag) !== normClanTag(window._userClanTag));

  const hasDetailedData = rounds.some(r => r.defenderMap != null || r.clan?.members?.length);
  const TOTAL_ROUNDS = 7;
  let roundSlots;
  if (isLive || hasDetailedData) {
    roundSlots = [];
    for (let i = 1; i <= TOTAL_ROUNDS; i++) {
      const found = rounds.find(r => (r.roundNumber || 0) === i);
      roundSlots.push(found || { roundNumber: i, upcoming: true });
    }
  } else {
    roundSlots = rounds.slice(0, TOTAL_ROUNDS);
  }

  // Auto-select the active round (inWar → preparation → last non-upcoming)
  let activeRoundIdx = roundSlots.findIndex(r => r.state === 'inWar');
  if (activeRoundIdx < 0) activeRoundIdx = roundSlots.findIndex(r => r.state === 'preparation');
  if (activeRoundIdx < 0) {
    const lastPlayed = roundSlots.reduce((acc, r, i) => (!r.upcoming ? i : acc), -1);
    activeRoundIdx = lastPlayed >= 0 ? lastPlayed : 0;
  }

  if (modalContext?.initialRoundNumber != null) {
    const want = +modalContext.initialRoundNumber;
    if (want >= 1 && want <= TOTAL_ROUNDS) {
      const idxFound = roundSlots.findIndex((r) => (r.roundNumber || 0) === want);
      if (idxFound >= 0) activeRoundIdx = idxFound;
    }
  }

  // ── Panel: Classifica lega ──
  let standingsContent = '<p style="color:var(--text-3);padding:.5rem;font-size:.85rem">Dati classifica non disponibili per questa stagione.</p>';
  if (groupStandings?.length) {
    const seasonEsc = String(season).replace(/'/g, "\\'");
    standingsContent = `<div class="cdm-standings-list">
      ${groupStandings.map((c, i) => {
        const isUs = normClanTag(c.tag) === focusClanTag;
        const canPeekOther = !!(seasonObj?.isLive && normClanTag(c.tag) !== focusClanTag);
        const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
        const bu = cocBadgeUrl(c.badgeUrls);
        const clBadge = bu
          ? `<img src="${bu}" class="cdm-clan-badge" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=\\'cdm-clan-badge-ph\\'>🛡️</span>'">`
          : '<span class="cdm-clan-badge-ph">🛡️</span>';
        const avgD = c.warCount > 0 ? (c.totalDestr / c.warCount).toFixed(1) + '%' : (c.totalDestr ? c.totalDestr.toFixed(1) + '%' : '—');
        const tagEsc = String(c.tag || '').replace(/'/g, "\\'");
        const peekOn = canPeekOther
          ? ` onclick="event.stopPropagation();openCwlSeasonDetailAsClan('${seasonEsc}','${tagEsc}')" title="Apri dettaglio per ${c.name.replace(/"/g, '&quot;')}"`
          : '';
        const peekCls = canPeekOther ? ' cdm-standing-row--peek' : '';
        return `<div class="cdm-standing-row${isUs ? ' cdm-standing-row--us' : ''}${peekCls}"${peekOn}>
          <span class="cdm-rank">${medal}</span>
          ${clBadge}
          <span class="cdm-clan-name${isUs ? ' cdm-clan-name--us' : ''}">${c.name}</span>
          <span class="cdm-clan-stars">⭐ ${c.stars ?? 0}</span>
          <span class="cdm-clan-destr">💥 ${avgD}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Panel: Classifica player ──
  let playersContent = '<p style="color:var(--text-3);padding:.5rem;font-size:.85rem">Disponibile solo per stagioni live.</p>';
  const players = seasonObj?.players;
  if (players?.length) {
    const pRows = players.map((p, i) => {
      const avgDestr = p.attacks_made > 0 ? (p.destruction / p.attacks_made).toFixed(1) : '—';
      return `<tr>
        <td class="cdm-pi-pos">${i + 1}</td>
        <td class="cdm-pi-th">${thImgV(p.th_level)}</td>
        <td class="cdm-pi-name">${p.name}</td>
        <td class="cdm-pi-stat">⭐ ${p.stars}</td>
        <td class="cdm-pi-stat">${avgDestr !== '—' ? avgDestr + '%' : '—'}</td>
        <td class="cdm-pi-stat">${p.attacks_made}/${p.attacks_required}</td>
      </tr>`;
    }).join('');
    playersContent = `<div class="cdm-attacks-scroll"><table class="cdm-attacks-table">
      <thead><tr><th>#</th><th>TH</th><th>Giocatore</th><th>⭐</th><th>💥 avg</th><th>⚔</th></tr></thead>
      <tbody>${pRows}</tbody>
    </table></div>`;
  }

  // ── Round selector (Turni, Anteprima, Confronto) ──
  const roundDot = (r) => {
    if (r.upcoming) return '<span class="cdm-rdot cdm-rdot--soon" aria-hidden="true"></span>';
    const rc = { win:'cdm-rdot--win', lose:'cdm-rdot--lose', draw:'cdm-rdot--draw', ongoing:'cdm-rdot--go', preparation:'cdm-rdot--prep' }[r.result] || 'cdm-rdot--prep';
    return `<span class="cdm-rdot ${rc}" aria-hidden="true"></span>`;
  };
  const roundSelectorHtml = roundSlots.map((r, i) => {
    const cls = `cdm-round-tab${i === activeRoundIdx ? ' active' : ''}${r.upcoming ? ' cdm-round-tab--upcoming' : ''}`;
    return `<button type="button" class="${cls}" onclick="_cwlSelectRound(${i})" id="cdm-tab-${i}">${roundDot(r)} T${r.roundNumber || i + 1}</button>`;
  }).join('');

  // ── Panel: Turni (tabella attacchi) ──
  function renderRound(r, idx) {
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
    const oppBu = cocBadgeUrl(r.opponent?.badgeUrls);
    const ourBu = cocBadgeUrl(r.clan?.badgeUrls);
    const oppBadge = oppBu
      ? `<img src="${oppBu}" class="cdm-war-badge" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=\\'cdm-war-badge-ph\\'>🛡️</span>'">`
      : '<span class="cdm-war-badge-ph">🛡️</span>';
    const ourBadge = ourBu
      ? `<img src="${ourBu}" class="cdm-war-badge" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=\\'cdm-war-badge-ph\\'>🛡️</span>'">`
      : '<span class="cdm-war-badge-ph">🛡️</span>';
    const fmtDestr = (v) => v != null ? v.toFixed(1) + '%' : '—';
    const totalAtks = (r.teamSize || 15) * (r.attacksPerMember || 1);
    function buildAttackRows(sideMembers, defMap, atkPerMember) {
      const rows = [];
      const sortedM = [...(sideMembers || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
      sortedM.forEach(m => {
        const atks = m.attacks || [];
        atks.forEach(a => {
          const def = defMap[a.defenderTag] || { name: a.defenderTag || '—', thLevel: null };
          const destVal = a.destruction != null ? Number(a.destruction) : (a.destructionPercentage != null ? Number(a.destructionPercentage) : 0);
          const stars = '⭐'.repeat(a.stars || 0) + '☆'.repeat(3 - (a.stars || 0));
          rows.push(`<tr>
            <td class="cdm-atk-player">${thImgV(m.thLevel)}<span>${m.name}</span></td>
            <td class="cdm-atk-arrow">→</td>
            <td class="cdm-atk-player">${thImgV(def.thLevel)}<span>${def.name}</span></td>
            <td class="cdm-atk-stars">${stars}</td>
            <td class="cdm-atk-destr">${destVal.toFixed(1)}%</td>
          </tr>`);
        });
        const missing = atkPerMember - atks.length;
        for (let x = 0; x < missing; x++) {
          rows.push(`<tr class="cdm-atk-missed">
            <td class="cdm-atk-player">${thImgV(m.thLevel)}<span>${m.name}</span></td>
            <td class="cdm-atk-arrow">→</td>
            <td class="cdm-atk-player"><span style="color:var(--text-3)">—</span></td>
            <td colspan="2" style="color:var(--text-3);font-size:0.8rem">non attaccato</td>
          </tr>`);
        }
      });
      return rows;
    }
    let attacksHtml = '';
    const defMap = r.defenderMap || {};
    const atkPerMember = r.attacksPerMember || 1;
    const hasOurData = r.clan?.members?.length;
    const hasOppData = r.opponent?.members?.length;
    if (hasOurData || hasOppData) {
      const pid = `atk-${idx}`;
      const ourRows = hasOurData ? buildAttackRows(r.clan.members, defMap, atkPerMember) : [];
      const oppRows = hasOppData ? buildAttackRows(r.opponent.members, defMap, atkPerMember) : [];
      const ourTableHtml = ourRows.length
        ? `<div class="cdm-attacks-scroll"><table class="cdm-attacks-table"><thead><tr><th>Attaccante</th><th></th><th>Difensore</th><th>⭐</th><th>💥</th></tr></thead><tbody>${ourRows.join('')}</tbody></table></div>`
        : `<p style="color:var(--text-3);font-size:.8rem;padding:.5rem">Nessun dato disponibile</p>`;
      const oppTableHtml = oppRows.length
        ? `<div class="cdm-attacks-scroll"><table class="cdm-attacks-table"><thead><tr><th>Attaccante</th><th></th><th>Difensore</th><th>⭐</th><th>💥</th></tr></thead><tbody>${oppRows.join('')}</tbody></table></div>`
        : `<p style="color:var(--text-3);font-size:.8rem;padding:.5rem">Nessun dato disponibile</p>`;
      attacksHtml = `
      <div class="cdm-attacks-section">
        <div class="cdm-atk-switcher">
          <button type="button" class="cdm-atk-sw-btn cdm-atk-sw-btn--active" id="${pid}-btn-us" onclick="_cwlAtkSwitch('${pid}','us')">${focusClanName}</button>
          <button type="button" class="cdm-atk-sw-btn" id="${pid}-btn-opp" onclick="_cwlAtkSwitch('${pid}','opp')">${r.opponent?.name || 'Avversario'}</button>
        </div>
        <div id="${pid}-panel-us">${ourTableHtml}</div>
        <div id="${pid}-panel-opp" style="display:none">${oppTableHtml}</div>
      </div>`;
    }
    return `<div class="cdm-round-panel" id="cdm-round-${idx}">
      <div class="cdm-war-header">
        <div class="cdm-war-side cdm-war-side--us">
          ${ourBadge}
          <div class="cdm-war-clan-name">${focusClanName}</div>
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

  // ── Panel: Anteprima (composizione TH per round) ──
  function renderPreview(r) {
    if (r.upcoming) {
      return `<div class="cdm-upcoming-msg" style="min-height:100px">
        <div class="cdm-upcoming-icon">⚔</div>
        <div class="cdm-upcoming-label">Turno ${r.roundNumber} — Da giocare</div>
      </div>`;
    }
    const STATE_LABEL = { inWar:'⚔ In guerra', warStarted:'⚔ In guerra', preparation:'🕐 Preparazione', warEnded:'✅ Terminata', ended:'✅ Terminata', ongoing:'⚔ In corso' };
    const stateLabel = STATE_LABEL[r.state] || r.state || '—';
    let countdownHtml = '';
    const start = r.startTime ? parseCocApiTime(r.startTime) : null;
    const end = r.endTime ? parseCocApiTime(r.endTime) : null;
    const now = Date.now();
    if (r.state === 'preparation' && start) {
      const diff = start - now;
      if (diff > 0) {
        const mm = Math.ceil(diff / 60000);
        countdownHtml = `<span class="prev-countdown">⏱ Inizio battaglia tra ${mm < 60 ? mm + ' min' : Math.floor(mm / 60) + 'h ' + (mm % 60) + 'm'}</span>`;
      }
    } else if (end) {
      const diff = end - now;
      if (diff > 0) {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        countdownHtml = `<span class="prev-countdown">⏱ Fine tra ${h}h ${m}m</span>`;
      }
    }
    function thComp(members) {
      if (!members?.length) return '<span style="color:var(--text-3)">—</span>';
      const counts = {};
      members.forEach(m => {
        const lv = m.thLevel || 0;
        if (lv) counts[lv] = (counts[lv] || 0) + 1;
      });
      const entries = Object.entries(counts).sort((a, b) => +b[0] - +a[0]);
      if (!entries.length) return '<span style="color:var(--text-3)">—</span>';
      const summaryText = entries.map(([lv, n]) => `TH${lv}: ${n}`).join(' · ');
      const grid = entries.map(([lv, n]) =>
        `<div class="prev-th-item">${thImgV(+lv)}<span class="prev-th-count">${n} pl.</span></div>`
      ).join('');
      return `<div class="prev-th-summary">${summaryText}</div><div class="prev-th-grid">${grid}</div>`;
    }
    const ourBu = cocBadgeUrl(r.clan?.badgeUrls);
    const oppBu = cocBadgeUrl(r.opponent?.badgeUrls);
    const ourBadge = ourBu ? `<img src="${ourBu}" class="prev-clan-badge" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="prev-clan-badge-ph">🛡️</span>';
    const oppBadge = oppBu ? `<img src="${oppBu}" class="prev-clan-badge" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="prev-clan-badge-ph">🛡️</span>';
    return `<div class="prev-state-bar">
        <span class="prev-state-label">${stateLabel}</span>
        ${countdownHtml}
        <span class="prev-size">👥 ${r.teamSize || '?'} vs ${r.teamSize || '?'}</span>
      </div>
      <div class="prev-war-split">
        <div class="prev-war-side prev-war-side--us">
          <div class="prev-side-header">${ourBadge}<span>${focusClanName}</span></div>
          ${thComp(r.clan?.members)}
          <div class="prev-score">⭐ ${r.clan?.stars ?? 0} &nbsp; 💥 ${r.clan?.destruction != null ? r.clan.destruction.toFixed(1)+'%' : '0.0%'}</div>
        </div>
        <div class="prev-war-vs">VS</div>
        <div class="prev-war-side prev-war-side--opp">
          <div class="prev-side-header">${oppBadge}<span>${r.opponent?.name || 'Avversario'}</span></div>
          ${thComp(r.opponent?.members)}
          <div class="prev-score">⭐ ${r.opponent?.stars ?? 0} &nbsp; 💥 ${r.opponent?.destruction != null ? r.opponent.destruction.toFixed(1)+'%' : '0.0%'}</div>
        </div>
      </div>`;
  }

  const roundPanelsHtml   = roundSlots.map((r, i) =>
    `<div style="display:${i===activeRoundIdx?'block':'none'}" id="cdm-rpanel-${i}">${renderRound(r, i)}</div>`
  ).join('');
  const previewPanelsHtml = roundSlots.map((r, i) =>
    `<div style="display:${i===activeRoundIdx?'block':'none'}" id="cdm-ppanel-${i}">${renderPreview(r)}</div>`
  ).join('');
  const confrontoPanelsHtml = roundSlots.map((r, i) =>
    `<div style="display:${i===activeRoundIdx?'block':'none'}" id="cdm-cpanel-${i}" class="cdm-confronto-slot"><p class="cdm-confronto-placeholder" style="color:var(--text-3);font-size:0.85rem;padding:0.5rem">Seleziona la scheda Confronto per caricare i dati.</p></div>`
  ).join('');

  const leagueBadgeHtml = badgeUrl
    ? `<img src="${badgeUrl}" class="cdm-header-badge" alt="${league||''}">`
    : '';

  const CDM_ICO = {
    trophy: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M5 3h14v2h-1v3c0 2.5-1.6 4.5-4 4.9V15h2v2H8v-2h2v-2.1c-2.4-.4-4-2.4-4-4.9V5H5V3zm2 2v3c0 1.9 1.3 3.4 3 3.9 1.7-.5 3-2 3-3.9V5H7zm-4 0h2v3c0 1.1.3 2.1.8 3H3c-.6-1.3-1-2.7-1-4V5zm18 0v2c0 1.3-.4 2.7-1 4h-2.8c.5-.9.8-1.9.8-3V5h3z"/></svg>',
    chart: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 13h2v8H3v-8zm8-6h2v14h-2V7zm8 4h2v10h-2V11z"/></svg>',
    sword: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M14.5 2l1.4 1.4-4.3 4.3 2.1 2.1 4.3-4.3L19.5 7 9 17.5 6.5 20 4 17.5 6.5 15 16 5.5l-1.5-1.5 4-4zM7.2 18.3L8.8 19.9 7.1 21.6 5.5 20l1.7-1.7z"/></svg>',
    eye: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5C21.3 7.6 17 4.5 12 4.5zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
    balance: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>',
    sync: '<svg class="cdm-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5 0 1.13-.4 2.16-1.03 3l1.46 1.46A7.93 7.93 0 0 0 20 12c0-2.21-.9-4.22-2.35-5.65zM12 19c-2.76 0-5-2.24-5-5 0-1.13.4-2.16 1.03-3L6.57 9.54A7.93 7.93 0 0 0 4 12c0 3.31 2.69 6 6 6v3l5-5-5-5v3z"/></svg>'
  };

  // Default: Confronto se c'è un turno inWar attivo, Anteprima se live/dettagliata, altrimenti Turni
  const hasActiveWar = roundSlots[activeRoundIdx]?.state === 'inWar';
  let defaultTab = hasActiveWar ? 'confronto' : (isLive || hasDetailedData) ? 'preview' : 'rounds';
  if (modalContext?.forceCdmTab) {
    defaultTab = modalContext.forceCdmTab;
  }
  const roundTabsVisible = defaultTab === 'rounds' || defaultTab === 'preview' || defaultTab === 'confronto';

  const backHdr = isAlienView
    ? `<button type="button" class="cdm-back-btn" onclick="event.stopPropagation();openCwlSeasonDetail(window._cwlOpenSeason)"><svg class="cdm-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg> Indietro</button>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'cwl-detail-modal';
  modal.className = 'cdm-overlay';
  modal.innerHTML = `
    <div class="cdm-box" onclick="event.stopPropagation()">
      <div class="cdm-header">
        <div class="cdm-header-left">
          ${backHdr}
          ${leagueBadgeHtml}
          <div>
            <div class="cdm-header-season">${seasonLabel(season)}${isLive ? ' <span class="cwl-live-badge-sm"><span class="cwl-live-dot"></span> LIVE</span>' : ''}</div>
            ${league ? `<div class="cdm-header-league" style="color:${leagueColor}">${league}</div>` : ''}
            ${posMedal ? `<div class="cdm-header-pos">${posMedal} ${posLabel}</div>` : ''}
            ${isAlienView ? `<div class="cdm-header-viewas" style="font-size:0.78rem;color:var(--text-3)">Vista: ${focusClanName}</div>` : ''}
          </div>
        </div>
        <button type="button" class="cdm-close" onclick="closeCwlSeasonDetail()">✕</button>
      </div>
      <div class="cdm-modal-toolbar">
        <button type="button" class="btn-secondary btn-sm" onclick="refreshCwlDetailModal()">${CDM_ICO.sync} Aggiorna stato</button>
      </div>
      <div class="cdm-mtabs">
        <button type="button" class="cdm-mtab${defaultTab==='standings'?' cdm-mtab--active':''}" id="cdm-mtab-standings" onclick="switchCdmTab('standings')">${CDM_ICO.trophy} Lega</button>
        <button type="button" class="cdm-mtab${defaultTab==='players'?' cdm-mtab--active':''}" id="cdm-mtab-players" onclick="switchCdmTab('players')">${CDM_ICO.chart} Player</button>
        <button type="button" class="cdm-mtab${defaultTab==='rounds'?' cdm-mtab--active':''}" id="cdm-mtab-rounds" onclick="switchCdmTab('rounds')">${CDM_ICO.sword} Turni</button>
        <button type="button" class="cdm-mtab${defaultTab==='preview'?' cdm-mtab--active':''}" id="cdm-mtab-preview" onclick="switchCdmTab('preview')">${CDM_ICO.eye} Anteprima</button>
        <button type="button" class="cdm-mtab${defaultTab==='confronto'?' cdm-mtab--active':''}" id="cdm-mtab-confronto" onclick="switchCdmTab('confronto')">${CDM_ICO.balance} Confronto</button>
      </div>
      <div id="cdm-round-sel" class="cdm-round-tabs" style="display:${roundTabsVisible?'flex':'none'}">${roundSelectorHtml}</div>
      <div id="cdm-panel-standings" style="display:${defaultTab==='standings'?'block':'none'}">${standingsContent}</div>
      <div id="cdm-panel-players"   style="display:${defaultTab==='players'?'block':'none'}">${playersContent}</div>
      <div id="cdm-panel-rounds"    style="display:${defaultTab==='rounds'?'block':'none'}"><div class="cdm-round-content">${roundPanelsHtml}</div></div>
      <div id="cdm-panel-preview"   style="display:${defaultTab==='preview'?'block':'none'}">${previewPanelsHtml}</div>
      <div id="cdm-panel-confronto" style="display:${defaultTab==='confronto'?'block':'none'}">${confrontoPanelsHtml}</div>
    </div>`;

  modal.addEventListener('click', closeCwlSeasonDetail);
  document.body.appendChild(modal);
  window._cwlModalRoundSlots = roundSlots;
  window._cwlModalRoundIdx = activeRoundIdx;
  requestAnimationFrame(() => {
    modal.classList.add('cdm-overlay--visible');
    // Scroll the active round tab into view
    const activeTab = document.getElementById(`cdm-tab-${activeRoundIdx}`);
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'center' });
    // Load confronto data if opening on that tab
    if (defaultTab === 'confronto') refreshCwlConfrontoRound(activeRoundIdx);
  });
}

function _cwlAtkSwitch(pid, side) {
  document.getElementById(`${pid}-panel-us`).style.display  = side === 'us'  ? 'block' : 'none';
  document.getElementById(`${pid}-panel-opp`).style.display = side === 'opp' ? 'block' : 'none';
  document.getElementById(`${pid}-btn-us`).classList.toggle('cdm-atk-sw-btn--active',  side === 'us');
  document.getElementById(`${pid}-btn-opp`).classList.toggle('cdm-atk-sw-btn--active', side === 'opp');
}

function _cwlSelectRound(idx) {
  window._cwlModalRoundIdx = idx;
  document.querySelectorAll('.cdm-round-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('[id^="cdm-rpanel-"]').forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none'; });
  document.querySelectorAll('[id^="cdm-ppanel-"]').forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none'; });
  document.querySelectorAll('[id^="cdm-cpanel-"]').forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none'; });
  const ctab = document.getElementById('cdm-mtab-confronto');
  if (ctab?.classList.contains('cdm-mtab--active')) refreshCwlConfrontoRound(idx);
}

function switchCdmTab(tab) {
  const panels = { standings: 'cdm-panel-standings', players: 'cdm-panel-players', rounds: 'cdm-panel-rounds', preview: 'cdm-panel-preview', confronto: 'cdm-panel-confronto' };
  Object.entries(panels).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.cdm-mtab').forEach(b => b.classList.toggle('cdm-mtab--active', b.id === `cdm-mtab-${tab}`));
  const sel = document.getElementById('cdm-round-sel');
  if (sel) sel.style.display = (tab === 'rounds' || tab === 'preview' || tab === 'confronto') ? 'flex' : 'none';
  if (tab === 'confronto') refreshCwlConfrontoRound(window._cwlModalRoundIdx || 0);
}

function _toggleCwlConfrontoTool(roundIdx, tool) {
  const all = ['planner', 'alerts'];
  all.forEach(t => {
    const el = document.getElementById(`cdm-cf-${t}-${roundIdx}`);
    const btn = document.getElementById(`cdm-cf-btn-${t}-${roundIdx}`);
    const active = t === tool && el?.style.display !== 'block';
    if (el) el.style.display = active ? 'block' : 'none';
    if (btn) btn.classList.toggle('cdm-atk-sw-btn--active', active);
  });
}

/** Build planner rows for current round — multi-factor target scoring.
 *  Each target is assigned to at most one attacker (greedy unique assignment).
 *  Scoring factors (higher = better target):
 *   - Already 3-starred → excluded (score -9999)
 *   - Already assigned  → excluded
 *   - TH proximity      → -15 per TH level gap
 *   - Punching up       → extra -25 (harder base, risky attack)
 *   - Stars received    → +8 per missing star (more room to contribute)
 *   - Unattacked base   → +12 bonus (full stars available, no prior intel)
 *   - Mirror position   → +10 bonus (CWL strategic value)
 */
function _buildCwlAttackPlanner(round) {
  const attacksPerMember = round?.attacksPerMember || 1;
  const us = [...(round?.clan?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const them = [...(round?.opponent?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));

  // War rank = position within THIS war (1…N), regardless of clan roster position
  const usWarRank = new Map(us.map((m, i) => [m.tag, i + 1]));
  const themWarRank = new Map(them.map((m, i) => [m.tag, i + 1]));

  function scoreTarget(attacker, target) {
    const stars = target.bestOpponentAttack?.stars ?? 0;
    if (stars >= 3) return -9999;
    const thDiff = (attacker.thLevel || 0) - (target.thLevel || 0);
    let score = 100;
    score -= Math.abs(thDiff) * 15;
    if (thDiff < 0) score -= 25;
    score += (3 - stars) * 8;
    if (!target.bestOpponentAttack) score += 12;
    // Mirror bonus: same war rank (not raw mapPosition)
    if (usWarRank.get(attacker.tag) === themWarRank.get(target.tag)) score += 10;
    return score;
  }

  const assignedTags = new Set();
  const out = [];
  for (const a of us) {
    const done = (a.attacks || []).length;
    const missing = Math.max(0, attacksPerMember - done);
    if (missing <= 0) continue;

    // Pick best unassigned target (fallback to any unassigned if all 3-starred)
    const available = them.filter(t => !assignedTags.has(t.tag));
    const ranked = available
      .map(t => ({ target: t, score: scoreTarget(a, t) }))
      .sort((x, y) => y.score - x.score);

    const best = ranked[0]?.target ?? available[0] ?? them[0];
    if (best?.tag) assignedTags.add(best.tag);

    const targetStars = best?.bestOpponentAttack?.stars ?? 0;
    const targetDestPct = best?.bestOpponentAttack?.destructionPercentage ?? 0;
    const thDelta = (a.thLevel || 0) - (best?.thLevel || 0);

    out.push({
      attackerName: a.name || '—',
      attackerTag: a.tag || '',
      attackerPosition: usWarRank.get(a.tag) ?? '?',
      attackerThLevel: a.thLevel || 0,
      targetName: best?.name || '—',
      targetTag: best?.tag || '',
      targetPosition: themWarRank.get(best?.tag) ?? '?',
      targetThLevel: best?.thLevel || 0,
      targetStars,
      targetDestPct,
      missingAttacks: missing,
      thDelta,
    });
  }
  return out;
}

/** Build operational alerts for the round. */
function _buildCwlOperationalAlerts(round) {
  const alerts = [];
  const attacksPerMember = round?.attacksPerMember || 1;
  const us = [...(round?.clan?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const themByPos = new Map((round?.opponent?.members || []).map(m => [m.mapPosition, m]));
  const missing = us.reduce((acc, m) => acc + Math.max(0, attacksPerMember - ((m.attacks || []).length)), 0);
  if (missing > 0) {
    alerts.push({
      code: 'missing-attacks',
      severity: missing >= 3 ? 'high' : 'medium',
      message: `Attacchi ancora da fare: ${missing}.`,
    });
  }
  let strongMismatch = 0;
  us.forEach(m => {
    const opp = themByPos.get(m.mapPosition);
    if (!opp) return;
    if (Math.abs((m.thLevel || 0) - (opp.thLevel || 0)) >= 2) strongMismatch++;
  });
  if (strongMismatch > 0) {
    alerts.push({
      code: 'th-mismatch',
      severity: strongMismatch >= 3 ? 'high' : 'low',
      message: `Mirror con mismatch TH forti: ${strongMismatch}.`,
    });
  }
  if (!alerts.length) {
    alerts.push({ code: 'ok', severity: 'ok', message: 'Nessuna anomalia operativa rilevata.' });
  }
  return alerts;
}

/** Tabella confronto TH / player / somma eroi (villaggio principale) per mappa vs avversario */
async function refreshCwlConfrontoRound(roundIdx) {
  const slots = window._cwlModalRoundSlots;
  const panel = document.getElementById(`cdm-cpanel-${roundIdx}`);
  if (!panel || !slots?.[roundIdx]) return;
  const r = slots[roundIdx];
  if (r.upcoming) {
    panel.innerHTML = '<p class="cdm-confronto-empty">Turno non ancora disputato.</p>';
    return;
  }
  const sortM = arr => [...(arr || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const us = sortM(r.clan?.members);
  const them = sortM(r.opponent?.members);
  const n = Math.max(us.length, them.length);
  panel.innerHTML = '<div class="profilo-loading" style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem"><div class="spinner"></div><span>Caricamento livelli eroi…</span></div>';
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = us[i];
    const b = them[i];
    const hA = a ? await _getHeroLevelsSum(a.tag) : null;
    const hB = b ? await _getHeroLevelsSum(b.tag) : null;
    rows.push(`<tr>
      <td class="cdm-cf-pos">#${i + 1}</td>
      <td class="cdm-cf-th">${a ? thImgV(a.thLevel) : '—'}</td>
      <td class="cdm-cf-name">${a ? a.name : '—'}</td>
      <td class="cdm-cf-hero">${hA != null ? hA : '—'}</td>
      <td class="cdm-cf-vs">vs</td>
      <td class="cdm-cf-pos">#${i + 1}</td>
      <td class="cdm-cf-th">${b ? thImgV(b.thLevel) : '—'}</td>
      <td class="cdm-cf-name">${b ? b.name : '—'}</td>
      <td class="cdm-cf-hero">${hB != null ? hB : '—'}</td>
    </tr>`);
  }
  const plannerRows = _buildCwlAttackPlanner(r);
  const alerts = _buildCwlOperationalAlerts(r);
  const plannerHtml = plannerRows.length
    ? `<div class="cdm-attacks-scroll"><table class="cdm-attacks-table cdm-planner-table"><thead><tr>
        <th>#</th><th></th><th>Attaccante</th>
        <th></th>
        <th>#</th><th></th><th>Target consigliato</th><th>Stelle attuali</th><th>Δ TH</th><th>Atk</th>
      </tr></thead><tbody>${
      plannerRows.map(x => {
        const deltaClass = x.thDelta >= 2 ? 'cdm-td-easy' : x.thDelta <= -2 ? 'cdm-td-hard' : 'cdm-td-fair';
        const deltaSign = x.thDelta > 0 ? '+' : '';
        const starsHtml = x.targetStars >= 3
          ? '<span class="cdm-planner-stars cdm-stars-full">⭐⭐⭐</span>'
          : x.targetStars === 2
          ? '<span class="cdm-planner-stars">⭐⭐☆</span>'
          : x.targetStars === 1
          ? '<span class="cdm-planner-stars">⭐☆☆</span>'
          : '<span class="cdm-planner-stars cdm-stars-none">☆☆☆</span>';
        const destHint = x.targetStars > 0 ? ` <span class="cdm-planner-destr">${x.targetDestPct.toFixed(0)}%</span>` : '';
        return `<tr>
          <td class="cdm-cf-pos">#${x.attackerPosition}</td>
          <td class="cdm-cf-th">${thImgV(x.attackerThLevel)}</td>
          <td class="cdm-cf-name">${x.attackerName}</td>
          <td class="cdm-atk-arrow">→</td>
          <td class="cdm-cf-pos">#${x.targetPosition}</td>
          <td class="cdm-cf-th">${thImgV(x.targetThLevel)}</td>
          <td class="cdm-cf-name">${x.targetName}</td>
          <td class="cdm-planner-stars-cell">${starsHtml}${destHint}</td>
          <td class="${deltaClass}">${deltaSign}${x.thDelta}</td>
          <td style="text-align:center">${x.missingAttacks}</td>
        </tr>`;
      }).join('')
    }</tbody></table></div>`
    : '<p class="cdm-confronto-empty">Nessun attacco da pianificare per questo turno.</p>';
  const alertsHtml = `<div class="cdm-attacks-scroll"><table class="cdm-attacks-table"><thead><tr><th>Severità</th><th>Segnalazione</th></tr></thead><tbody>${
    alerts.map(a => `<tr><td>${a.severity === 'high' ? '🔴 Alta' : a.severity === 'medium' ? '🟠 Media' : a.severity === 'low' ? '🟡 Bassa' : '🟢 OK'}</td><td>${a.message}</td></tr>`).join('')
  }</tbody></table></div>`;
  panel.innerHTML = `<div class="cdm-attacks-scroll"><table class="cdm-confronto-table">
    <thead><tr>
      <th>#</th><th>TH</th><th>Player</th><th>Σ eroi</th>
      <th class="cdm-cf-vs-th">vs</th>
      <th>#</th><th>TH</th><th>Player</th><th>Σ eroi</th>
    </tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <div class="cdm-atk-switcher" style="margin-top:.5rem">
      <button type="button" class="cdm-atk-sw-btn" id="cdm-cf-btn-planner-${roundIdx}" onclick="_toggleCwlConfrontoTool(${roundIdx}, 'planner')">Planner attacchi turno</button>
      <button type="button" class="cdm-atk-sw-btn" id="cdm-cf-btn-alerts-${roundIdx}" onclick="_toggleCwlConfrontoTool(${roundIdx}, 'alerts')">Alert operativi</button>
    </div>
    <div id="cdm-cf-planner-${roundIdx}" style="display:none;margin-top:.45rem">${plannerHtml}</div>
    <div id="cdm-cf-alerts-${roundIdx}" style="display:none;margin-top:.45rem">${alertsHtml}</div>`;
}

function closeCwlSeasonDetail() {
  const modal = document.getElementById('cwl-detail-modal');
  if (!modal) return;
  modal.classList.remove('cdm-overlay--visible');
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
}

/** Ricarica dati CWL live e riapre il modal sulla stessa stagione */
async function refreshCwlDetailModal() {
  const season = window._cwlOpenSeason;
  if (!season) return;
  try {
    await loadCwlSeasons();
    const alien = window._cwlModalAlienFocusTag;
    if (alien && normClanTag(alien) !== normClanTag(window._userClanTag)) {
      await openCwlSeasonDetailAsClan(season, alien);
    } else {
      openCwlSeasonDetail(season);
    }
  } catch (e) {
    console.error(e);
  }
}

// ── IL MIO PROFILO ────────────────────────────────────────────────────────────

let _profileData = null;
let _profiloActiveTab = 'home';

async function loadProfile() {
  const session = (await db.auth.getSession())?.data?.session;
  const cocTag  = session?.user?.user_metadata?.coc_tag;

  const noTag    = document.getElementById('profilo-no-tag');
  const loading  = document.getElementById('profilo-loading');
  const content  = document.getElementById('profilo-content');

  if (!cocTag) {
    if (noTag)   noTag.style.display   = 'flex';
    if (content) content.style.display = 'none';
    return;
  }
  if (noTag)   noTag.style.display   = 'none';
  if (loading) loading.style.display = 'flex';
  if (content) content.style.display = 'none';

  try {
    const r = await fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(cocTag)}`);
    const data = await r.json();
    if (r.ok) {
      _profileData = data;
      renderProfile(data);
      if (loading) loading.style.display = 'none';
      if (content) content.style.display = 'block';
      return;
    }
    const errMsg = _lookupApiError(data);
    const tryRoster =
      /accessDenied|invalidIp|invalid\s*ip|notFound|serviceUnavailable|503|502/i.test(errMsg) ||
      r.status === 403 ||
      r.status === 502 ||
      r.status === 503;
    if (tryRoster) {
      const row = await _fetchMemberRowForProfile(cocTag);
      if (row) {
        const partial = _profileFromMemberRow(row, session?.user?.user_metadata || {});
        _profileData = partial;
        renderProfile(partial);
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
        return;
      }
    }
    const hint =
      /accessDenied|invalidIp/i.test(errMsg)
        ? ' Verifica su developer.clashofclans.com che l’IP del proxy (Render) sia nella whitelist della chiave API.'
        : '';
    throw new Error(errMsg + hint);
  } catch (e) {
    if (loading) loading.style.display = 'none';
    if (content) {
      content.style.display = 'block';
      content.innerHTML = `<p style="color:var(--red);padding:1rem">Errore: ${e.message}</p>`;
    }
  }
}

function renderProfile(p) {
  _ensureProfiloIds();
  renderPlayerView(p, 'profilo');
}

function _ensureProfiloIds() {
  // Map prefixed IDs to the static HTML IDs from index.html
  // profilo-tab-home/builder/capital already exist
  // We just need the mapping to be aware of which prefix maps where
}

function renderPlayerView(p, prefix) {
  const isHome = prefix === 'profilo';
  const leagueForBadge = _playerLeagueForBadge(p);
  const leagueHtml = leagueForBadge
    ? rankLeagueBadgeHtml(leagueForBadge, { imgClass: 'profilo-league-badge' })
    : '';
  const clanHtml = p.clan
    ? `<span class="profilo-clan-ref">${p.clan.name}</span>`
    : '<span class="profilo-clan-ref" style="color:var(--text-3)">Nessun clan</span>';
  const roleHtml = p.role ? `<span class="badge badge-gold">${cocRole(p.role).label}</span>` : '';
  const copyBtn = !isHome
    ? `<button class="btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${p.tag}').then(()=>this.textContent='Copiato!').then(()=>setTimeout(()=>this.textContent='Copia Tag',1500))">Copia Tag</button>`
    : '';
  const favBtnHtml = !isHome ? _favBtn('players', p.tag, p.name) : '';

  const rosterNotice =
    isHome && p._profileSource === 'roster'
      ? `<div class="profilo-sync-notice" role="status">Profilo da roster del clan (Supabase): l’API CoC non risponde da questo server (es. <code>accessDenied.invalidIp</code>). Eroi, truppe e statistiche avanzate non sono disponibili finché l’IP del proxy non è in whitelist sulla chiave API.</div>`
      : '';

  const headerEl = document.getElementById(`${prefix}-header-card`);
  if (headerEl) headerEl.innerHTML = `${rosterNotice}
    <div class="profilo-hero-top">
      ${thImgV(p.townHallLevel || 1)}
      <div class="profilo-hero-info">
        <div class="profilo-hero-name">${p.name}</div>
        <div class="profilo-hero-tag mono">${p.tag}</div>
        <div class="profilo-hero-meta">${clanHtml}${roleHtml ? ' '+roleHtml : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem">
        ${leagueHtml}
        <div style="display:flex;gap:0.4rem;align-items:center">${copyBtn}${favBtnHtml}</div>
      </div>
    </div>
    <div class="profilo-stats-row">
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--gold)"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z"/></svg>
        <span class="profilo-stat-val">${p.trophies ?? '—'}</span>
        <span class="profilo-stat-lbl">Trofei</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:#f0a500"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        <span class="profilo-stat-val">${p.warStars ?? '—'}</span>
        <span class="profilo-stat-lbl">Stelle War</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--green)"><path d="M4 16l4.586-4.586a2 2 0 0 1 2.828 0L16 16m-2-2l1.586-1.586a2 2 0 0 1 2.828 0L20 14m-6-6h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/></svg>
        <span class="profilo-stat-val">${p.attackWins ?? '—'}</span>
        <span class="profilo-stat-lbl">Att. Vinti</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--blue)"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
        <span class="profilo-stat-val">${p.defenseWins ?? '—'}</span>
        <span class="profilo-stat-lbl">Dif. Vinte</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--gold)"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
        <span class="profilo-stat-val">${p.donations ?? '—'}</span>
        <span class="profilo-stat-lbl">Donate</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--text-3)"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        <span class="profilo-stat-val">${p.donationsReceived ?? '—'}</span>
        <span class="profilo-stat-lbl">Ricevute</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--text-2)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <span class="profilo-stat-val">Lv ${p.expLevel ?? '—'}</span>
        <span class="profilo-stat-lbl">Esperienza</span>
      </div>
      ${p.builderHallLevel ? `<div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--text-3)"><path d="M19 3H5v2h1v14H4v2h16v-2h-2V5h1V3zm-4 16h-6v-5h6v5zm0-7h-6V8h6v4z"/></svg>
        <span class="profilo-stat-val">BH${p.builderHallLevel}</span>
        <span class="profilo-stat-lbl">Builder</span>
      </div>` : ''}
      ${p.clanCapitalContributions ? `<div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:#f0a500"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l6 2.67V11c0 3.5-2.33 6.79-6 7.93-3.67-1.14-6-4.43-6-7.93V7.67L12 5z"/></svg>
        <span class="profilo-stat-val">${(p.clanCapitalContributions/1000).toFixed(0)}k</span>
        <span class="profilo-stat-lbl">Capital</span>
      </div>` : ''}
    </div>`;

  // Mappa prefix → IDs container
  const ids = {
    heroes:      `${prefix}-heroes`,
    equipment:   `${prefix}-equipment`,
    pets:        `${prefix}-pets`,
    troops:      `${prefix}-troops`,
    superTroops: `${prefix}-super-troops`,
    spells:      `${prefix}-spells`,
    siege:       `${prefix}-siege`,
    achHome:     `${prefix}-ach-home`,
    bhStats:     `${prefix}-bh-stats`,
    builderH:    `${prefix}-builder-heroes`,
    builderU:    `${prefix}-builder-units`,
    builderA:    `${prefix}-builder-ach`,
    capStats:    `${prefix}-capital-stats`,
    capTroops:   `${prefix}-capital-troops`,
    petsSec:     `${prefix}-pets-sec`,
  };
  // Per 'profilo' il prefisso dei section IDs è ps-
  // Per 'cp' il prefisso è cp-
  const secPfx = prefix === 'profilo' ? 'ps' : prefix;

  const isHomeV = x => !x.village || x.village === 'home';
  const heroes   = (p.heroes||[]).filter(isHomeV);
  const equipment= (p.heroEquipment||[]).filter(x=>!x.village||x.village==='home');
  // L'API CoC non restituisce mai un campo `pets` separato: i famigli arrivano dentro
  // `p.troops`, mescolati alle truppe normali. Filtrarli da `p.pets` (che non esiste)
  // lasciava la sezione famigli sempre vuota per ogni giocatore.
  const pets     = (p.troops||[]).filter(x=>isHomeV(x)&&PETS_SET.has(x.name));
  const troopsAll= (p.troops||[]).filter(x=>isHomeV(x)&&!PETS_SET.has(x.name)&&!SIEGE_SET.has(x.name)&&!SUPER_TROOP_SET.has(x.name));
  const superTroops = (p.troops||[]).filter(x=>isHomeV(x)&&SUPER_TROOP_SET.has(x.name));
  const spells   = (p.spells||[]).filter(isHomeV);
  const siege    = (p.troops||[]).filter(x=>isHomeV(x)&&SIEGE_SET.has(x.name));
  const achHome  = (p.achievements||[]).filter(a=>a.village==='home'||!a.village);

  _renderUnits(ids.heroes,       heroes,    'heroes');
  _renderEquipmentGrouped(ids.equipment, equipment);
  _renderUnits(ids.pets,         pets,      'pets');
  _renderUnits(ids.troops,    troopsAll, 'troops');
  _renderUnits(ids.superTroops, superTroops, 'troops');
  _renderUnits(ids.spells,    spells,    'spells');
  _renderUnits(ids.siege,     siege,     'troops');
  _renderAchievements(ids.achHome, achHome);

  const petsSec = document.getElementById(`${secPfx}-pets-sec`)||document.getElementById(`${prefix}-pets-sec`);
  if (petsSec) petsSec.style.display = pets.length ? 'block' : 'none';

  // Builder
  const bhEl = document.getElementById(ids.bhStats);
  const bhLvl = p.builderHallLevel || null;
  const bhImg = bhLvl ? bhImgUrl(bhLvl) : '';
  if (bhEl) bhEl.innerHTML = `<div class="profilo-bh-card">
    ${bhImg
      ? `<img src="${bhImg}" alt="Base del Costruttore" class="profilo-bh-icon-img" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
         <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" style="color:var(--gold);opacity:.8;display:none"><path d="M19 3H5v2h1v14H4v2h16v-2h-2V5h1V3zm-4 16h-6v-5h6v5zm0-7h-6V8h6v4z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" style="color:var(--gold);opacity:.8"><path d="M19 3H5v2h1v14H4v2h16v-2h-2V5h1V3zm-4 16h-6v-5h6v5zm0-7h-6V8h6v4z"/></svg>`}
    <div>
      <div class="profilo-bh-label">Base del Costruttore</div>
      <div class="profilo-bh-val">BH ${p.builderHallLevel??'—'}</div>
      <div class="profilo-bh-sub">${p.builderBaseTrophies??'—'} trofei · Massimo: ${p.builderBaseBestTrophies??'—'}</div>
    </div>
  </div>`;

  const builderHeroes = (p.heroes||[]).filter(x=>x.village==='builderBase');
  const builderTroops = (p.troops||[]).filter(x=>x.village==='builderBase');
  const achBuilder = (p.achievements||[]).filter(a=>a.village==='builderBase');
  _renderUnits(ids.builderH, builderHeroes, 'heroes');
  _renderUnits(ids.builderU, builderTroops, 'troops');
  _renderAchievements(ids.builderA, achBuilder);

  // Capital
  const capEl = document.getElementById(ids.capStats);
  if (capEl) capEl.innerHTML = `<div class="profilo-bh-card">
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" style="color:#f0a500;opacity:.8"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l6 2.67V11c0 3.5-2.33 6.79-6 7.93-3.67-1.14-6-4.43-6-7.93V7.67L12 5z"/></svg>
    <div>
      <div class="profilo-bh-label">Capitale del Clan</div>
      <div class="profilo-bh-val">${(p.clanCapitalContributions??0).toLocaleString('it')} Capital Gold contribuiti</div>
    </div>
  </div>`;

  const capTroops = (p.troops||[]).filter(x=>x.village==='clanCapital');
  _renderUnits(ids.capTroops, capTroops, 'troops');
}

// ── URL DIRETTI WIKI (Fandom) per unità non coperte da coc.guide ─────────────
// La CoC API non restituisce iconUrls per gli eroi nuovi, equipment e pets.
// coc.guide non ha questi contenuti → usiamo static.wikia.nocookie.net come CDN.
const UNIT_WIKI_URL = {
  // Eroi nuovi
  'Minion Prince':    'https://static.wikia.nocookie.net/clashofclans/images/8/89/Minion_Prince_Icon.png/revision/latest',
  'Dragon Duke':      'https://static.wikia.nocookie.net/clashofclans/images/2/2e/Dragon_Duke_info.png/revision/latest',
  'Battle Copter':    'https://static.wikia.nocookie.net/clashofclans/images/4/40/Battle_Copter_Icon.png/revision/latest',
  // Equipment Re dei Barbari
  'Spiky Ball':       'https://static.wikia.nocookie.net/clashofclans/images/d/d9/Spiky_Ball.png/revision/latest',
  'Snake Bracelet':   'https://static.wikia.nocookie.net/clashofclans/images/5/56/Snake_Bracelet.png/revision/latest',
  'Stick Horse':      'https://static.wikia.nocookie.net/clashofclans/images/c/c7/Stick_Horse.png/revision/latest',
  'Barbarian Puppet': 'https://static.wikia.nocookie.net/clashofclans/images/9/96/Barbarian_Puppet.png/revision/latest',
  'Rage Vial':        'https://static.wikia.nocookie.net/clashofclans/images/8/89/Rage_Vial.png/revision/latest',
  // Equipment Regina degli Arcieri
  'Action Figure':    'https://static.wikia.nocookie.net/clashofclans/images/7/70/Action_Figure.png/revision/latest',
  'Archer Puppet':    'https://static.wikia.nocookie.net/clashofclans/images/d/d4/Archer_Puppet.png/revision/latest',
  // Equipment Grande Custode
  'Fireball':         'https://static.wikia.nocookie.net/clashofclans/images/4/49/Fireball_Equipment.png/revision/latest',
  'Lavaloon Puppet':  'https://static.wikia.nocookie.net/clashofclans/images/b/b6/Lavaloon_Puppet.png/revision/latest',
  // Equipment Campionessa Reale
  'Frost Flake':      'https://static.wikia.nocookie.net/clashofclans/images/4/4c/Frost_Flake.png/revision/latest',
  'Royal Gem':        'https://static.wikia.nocookie.net/clashofclans/images/b/b9/Royal_Gem.png/revision/latest',
  // Equipment Principe degli Sgherri
  'Dark Crown':       'https://static.wikia.nocookie.net/clashofclans/images/7/7e/Dark_Crown.png/revision/latest',
  'Meteor Staff':     'https://static.wikia.nocookie.net/clashofclans/images/0/07/Meteor_Staff.png/revision/latest',
  'Henchmen Puppet':  'https://static.wikia.nocookie.net/clashofclans/images/d/dc/Henchmen_Puppet.png/revision/latest',
  'Dark Orb':         'https://static.wikia.nocookie.net/clashofclans/images/c/cc/Dark_Orb.png/revision/latest',
  'Metal Pants':      'https://static.wikia.nocookie.net/clashofclans/images/0/04/Metal_Pants.png/revision/latest',
  'Noble Iron':       'https://static.wikia.nocookie.net/clashofclans/images/4/4b/Noble_Iron.png/revision/latest',
  // Equipment Duca Drago
  'Fire Heart':       'https://static.wikia.nocookie.net/clashofclans/images/8/86/Fire_Heart.png/revision/latest',
  'Stun Blaster':     'https://static.wikia.nocookie.net/clashofclans/images/3/34/Stun_Blaster.png/revision/latest',
  'Flame Blower':     'https://static.wikia.nocookie.net/clashofclans/images/8/89/Flame_Blower.png/revision/latest',
  // Equipment altri
  'Heroic Torch':     'https://static.wikia.nocookie.net/clashofclans/images/8/8a/Heroic_Torch.png/revision/latest',
  // Famigli (coc.guide /pet/ non esiste → wiki per tutti)
  'L.A.S.S.I':       'https://static.wikia.nocookie.net/clashofclans/images/5/5a/LASSI_field.png/revision/latest',
  'Electro Owl':      'https://static.wikia.nocookie.net/clashofclans/images/8/88/Electro_Owl_field.png/revision/latest',
  'Mighty Yak':       'https://static.wikia.nocookie.net/clashofclans/images/6/66/Mighty_Yak_field.png/revision/latest',
  'Unicorn':          'https://static.wikia.nocookie.net/clashofclans/images/7/7e/Unicorn.png/revision/latest',
  'Spirit Fox':       'https://static.wikia.nocookie.net/clashofclans/images/0/06/Spirit_Fox_field.png/revision/latest',
  'Sneezy':           'https://static.wikia.nocookie.net/clashofclans/images/5/54/Sneezy1.png/revision/latest',
  'Greedy Raven':     'https://static.wikia.nocookie.net/clashofclans/images/a/a6/Greedy_Raven1.png/revision/latest',
  'Frosty':           'https://static.wikia.nocookie.net/clashofclans/images/8/8b/Frosty_field.png/revision/latest',
  // Super Truppe senza copertura coc.guide
  'Super Valkyrie':   'https://static.wikia.nocookie.net/clashofclans/images/2/25/Super_Valkyrie_Info.png/revision/latest',
  // ── Truppe base/dark elixir con slug coc.guide inesistente o rotto (verificato ago 2026) ──
  'Meteor Golem':     'https://static.wikia.nocookie.net/clashofclans/images/2/21/Meteor_Golem_info.png/revision/latest',
  'Minion':           'https://static.wikia.nocookie.net/clashofclans/images/a/a4/Minion_info.png/revision/latest',
  'Hog Rider':        'https://static.wikia.nocookie.net/clashofclans/images/5/54/Hog_Rider_info.png/revision/latest',
  'Valkyrie':         'https://static.wikia.nocookie.net/clashofclans/images/7/7d/Valkyrie_info.png/revision/latest',
  'Witch':            'https://static.wikia.nocookie.net/clashofclans/images/4/4a/Witch_info.png/revision/latest',
  'Lava Hound':       'https://static.wikia.nocookie.net/clashofclans/images/0/0a/Lava_Hound_info.png/revision/latest',
  'Druid':            'https://static.wikia.nocookie.net/clashofclans/images/9/9a/Druid_info.png/revision/latest',
  'Furnace':          'https://static.wikia.nocookie.net/clashofclans/images/2/23/Furnace_info.png/revision/latest',
  'Ruin Witch':       'https://static.wikia.nocookie.net/clashofclans/images/2/23/Ruin_Witch_info.png/revision/latest',
  // ── Truppe builder base con slug coc.guide inesistente o rotto ──
  'Beta Minion':      'https://static.wikia.nocookie.net/clashofclans/images/6/63/Beta_Minion_info.png/revision/latest',
  'Drop Ship':        'https://static.wikia.nocookie.net/clashofclans/images/1/17/Drop_Ship_info.png/revision/latest',
  // "Super P.E.K.K.A" builder base è stata rinominata "Power P.E.K.K.A" in game (l'API CoC
  // ora restituisce questo nome): copriamo entrambe le chiavi per compatibilità.
  'Power P.E.K.K.A':  'https://static.wikia.nocookie.net/clashofclans/images/1/1f/Power_P.E.K.K.A_info.png/revision/latest',
  'Super P.E.K.K.A':  'https://static.wikia.nocookie.net/clashofclans/images/1/1f/Power_P.E.K.K.A_info.png/revision/latest',
  // ── Super truppe con slug coc.guide inesistente o rotto ──
  'Super Barbarian':      'https://static.wikia.nocookie.net/clashofclans/images/1/1c/Super_Barbarian_info.png/revision/latest',
  'Super Archer':         'https://static.wikia.nocookie.net/clashofclans/images/e/ea/Super_Archer_info.png/revision/latest',
  'Super Giant':          'https://static.wikia.nocookie.net/clashofclans/images/d/d9/Super_Giant_info.png/revision/latest',
  'Sneaky Goblin':        'https://static.wikia.nocookie.net/clashofclans/images/f/ff/Sneaky_Goblin_info.png/revision/latest',
  'Super Wall Breaker':   'https://static.wikia.nocookie.net/clashofclans/images/b/b1/Super_Wall_Breaker_info.png/revision/latest',
  'Rocket Balloon':       'https://static.wikia.nocookie.net/clashofclans/images/9/9e/Rocket_Balloon_info.png/revision/latest',
  'Inferno Dragon':       'https://static.wikia.nocookie.net/clashofclans/images/d/de/Inferno_Dragon_info.png/revision/latest',
  'Super Yeti':           'https://static.wikia.nocookie.net/clashofclans/images/1/19/Super_Yeti_info.png/revision/latest',
  'Super Witch':          'https://static.wikia.nocookie.net/clashofclans/images/7/7c/Super_Witch_info.png/revision/latest',
  // ── Macchine d'assedio / truppe nuove (aggiunte in game, ago 2026) ──
  'Troop Launcher':       'https://static.wikia.nocookie.net/clashofclans/images/c/c2/Troop_Launcher_info.png/revision/latest',
  'Electrofire Wizard':   'https://static.wikia.nocookie.net/clashofclans/images/2/2e/Electrofire_Wizard_info.png/revision/latest',
  // ── Equipaggiamento con slug coc.guide inesistente (verificato ago 2026) ──
  'Invisibility Vial':    'https://static.wikia.nocookie.net/clashofclans/images/0/08/Invisibility_Vial.png/revision/latest',
  'Giant Arrow':          'https://static.wikia.nocookie.net/clashofclans/images/b/bb/Giant_Arrow.png/revision/latest',
  'Healer Puppet':        'https://static.wikia.nocookie.net/clashofclans/images/d/dd/Healer_Puppet.png/revision/latest',
  'Rage Gem':             'https://static.wikia.nocookie.net/clashofclans/images/8/8f/Rage_Gem.png/revision/latest',
  'Rocket Backpack':      'https://static.wikia.nocookie.net/clashofclans/images/8/8f/Rocket_Backpack.png/revision/latest',
  'Electro Fangs':        'https://static.wikia.nocookie.net/clashofclans/images/2/2c/Electro_Fangs.png/revision/latest',
  // ── Incantesimo nuovo (Anime Fury update, giu 2026) ──
  'Angry Spell':          'https://static.wikia.nocookie.net/clashofclans/images/9/92/Angry_Spell_info.png/revision/latest',
  // ── Macchine d'assedio con slug coc.guide inesistente ──
  'Flame Flinger':        'https://static.wikia.nocookie.net/clashofclans/images/f/f4/Flame_Flinger_info.png/revision/latest',
  'Sky Wagon':            'https://static.wikia.nocookie.net/clashofclans/images/f/fd/Sky_Wagon_info.png/revision/latest',
  // ── Eroi builder con slug coc.guide inesistente ──
  'Battle Machine':       'https://static.wikia.nocookie.net/clashofclans/images/f/f1/Battle_Machine_info.png/revision/latest',
};

// ── ANTEPRIME BASE DEL COSTRUTTORE (edificio) per livello, Fandom Wiki ────────
const BH_WIKI_URL = {
  1:  'https://static.wikia.nocookie.net/clashofclans/images/1/19/Builder_Hall1.png/revision/latest',
  2:  'https://static.wikia.nocookie.net/clashofclans/images/0/03/Builder_Hall2.png/revision/latest',
  3:  'https://static.wikia.nocookie.net/clashofclans/images/3/38/Builder_Hall3.png/revision/latest',
  4:  'https://static.wikia.nocookie.net/clashofclans/images/b/be/Builder_Hall4.png/revision/latest',
  5:  'https://static.wikia.nocookie.net/clashofclans/images/2/22/Builder_Hall5.png/revision/latest',
  6:  'https://static.wikia.nocookie.net/clashofclans/images/2/29/Builder_Hall6.png/revision/latest',
  7:  'https://static.wikia.nocookie.net/clashofclans/images/7/7f/Builder_Hall7.png/revision/latest',
  8:  'https://static.wikia.nocookie.net/clashofclans/images/0/0e/Builder_Hall8.png/revision/latest',
  9:  'https://static.wikia.nocookie.net/clashofclans/images/4/43/Builder_Hall9.png/revision/latest',
  10: 'https://static.wikia.nocookie.net/clashofclans/images/8/87/Builder_Hall10.png/revision/latest',
};
function bhImgUrl(level) {
  const n = Math.max(1, Math.min(10, parseInt(level, 10) || 1));
  return BH_WIKI_URL[n] || '';
}

// ── MAPPA CDN UNITÀ (API name → coc.guide category + slug) ───────────────────
const UNIT_COC_SLUG = {
  // ── Eroi Villaggio Base ────────────────────────────────────────────────────
  'Barbarian King':     {c:'hero',  s:'barbarian-king'},
  'Archer Queen':       {c:'hero',  s:'archer-queen'},
  'Grand Warden':       {c:'hero',  s:'grand-warden'},
  'Royal Champion':     {c:'hero',  s:'royal-champion'},
  'Minion Prince':      {c:'hero',  s:'minion-prince'},
  'Dragon Duke':        {c:'hero',  s:'dragon-duke'},
  // ── Eroi Builder / Capitale ───────────────────────────────────────────────
  'Battle Machine':     {c:'hero',  s:'battle-machine'},
  'Battle Copter':      {c:'hero',  s:'battle-copter'},
  'B.O.B':              {c:'hero',  s:'bob'},
  // ── Truppe — slug diverso dall'auto-generazione ───────────────────────────
  'Baby Dragon':        {c:'troop', s:'babydragon'},
  'Inferno Dragon':     {c:'troop', s:'infernodragon'},
  'Lava Hound':         {c:'troop', s:'lavahound'},
  'Headhunter':         {c:'troop', s:'headhunter'},
  'Hog Rider':          {c:'troop', s:'hog-rider'},
  'Wall Breaker':       {c:'troop', s:'wall-breaker'},
  'Ram Rider':          {c:'troop', s:'ram-rider'},
  'Apprentice Warden':  {c:'troop', s:'apprentice-warden'},
  'Druid':              {c:'troop', s:'druid'},
  'Thrower':            {c:'troop', s:'thrower'},
  'Super Barbarian':    {c:'troop', s:'super-barbarian'},
  'Super Archer':       {c:'troop', s:'super-archer'},
  'Super Giant':        {c:'troop', s:'super-giant'},
  'Sneaky Goblin':      {c:'troop', s:'sneaky-goblin'},
  'Super Wall Breaker': {c:'troop', s:'super-wall-breaker'},
  'Rocket Balloon':     {c:'troop', s:'rocket-balloon'},
  'Super Witch':        {c:'troop', s:'super-witch'},
  'Ice Hound':          {c:'troop', s:'ice-hound'},
  'Super Bowler':       {c:'troop', s:'super-bowler'},
  'Super Dragon':       {c:'troop', s:'super-dragon'},
  'Electro Titan':      {c:'troop', s:'electro-titan'},
  'Root Rider':         {c:'troop', s:'root-rider'},
  'Super Miner':        {c:'troop', s:'super-miner'},
  'Super Hog Rider':    {c:'troop', s:'super-hog-rider'},
  'Dragon Rider':       {c:'troop', s:'dragon-rider'},
  'Minion':             {c:'troop', s:'minion'},
  // ── Incantesimi (nomi CDN diversi dai nomi API) ────────────────────────────
  'Lightning Spell':    {c:'spell', s:'lighningstorm'},
  'Healing Spell':      {c:'spell', s:'healingwave'},
  'Rage Spell':         {c:'spell', s:'speedup'},
  'Freeze Spell':       {c:'spell', s:'freeze'},
  'Jump Spell':         {c:'spell', s:'jump'},
  'Earthquake Spell':   {c:'spell', s:'earthquake'},
  'Haste Spell':        {c:'spell', s:'haste'},
  'Clone Spell':        {c:'spell', s:'duplicate'},
  'Invisibility Spell': {c:'spell', s:'invisibility'},
  'Recall Spell':       {c:'spell', s:'recall'},
  'Bat Spell':          {c:'spell', s:'spawnbats'},
  'Skeleton Spell':     {c:'spell', s:'spawnskele'},
  'Poison Spell':       {c:'spell', s:'poison'},
  'Overgrowth Spell':   {c:'spell', s:'overgrowth'},
  'Goblin Spell':       {c:'spell', s:'goblin'},
  'Revive Spell':       {c:'spell', s:'revive'},
  'Fireball Spell':     {c:'spell', s:'fireball'},
  // ── Famigli ───────────────────────────────────────────────────────────────
  'L.A.S.S.I':          {c:'pet',   s:'lassi'},
  'Electro Owl':        {c:'pet',   s:'electro-owl'},
  'Mighty Yak':         {c:'pet',   s:'mighty-yak'},
  'Unicorn':            {c:'pet',   s:'unicorn'},
  'Frosty':             {c:'pet',   s:'frosty'},
  'Diggy':              {c:'pet',   s:'diggy'},
  'Poison Lizard':      {c:'pet',   s:'poison-lizard'},
  'Phoenix':            {c:'pet',   s:'phoenix'},
  'Spirit Fox':         {c:'pet',   s:'spirit-fox'},
  'Angry Jelly':        {c:'pet',   s:'angry-jelly'},
  'Sneezy':             {c:'pet',   s:'sneezy'},
  'Greedy Raven':       {c:'pet',   s:'greedy-raven'},
  // ── Builder Base ──────────────────────────────────────────────────────────
  'Raged Barbarian':    {c:'troop', s:'barbarian2'},
  'Sneaky Archer':      {c:'troop', s:'archer2'},
  'Boxer Giant':        {c:'troop', s:'giant2'},
  'Beta Minion':        {c:'troop', s:'minion2'},
  'Bomber':             {c:'troop', s:'bomber2'},
  'Cannon Cart':        {c:'troop', s:'moving-cannon'},
  'Night Witch':        {c:'troop', s:'dark-witch'},
  'Drop Ship':          {c:'troop', s:'drop-ship'},
  'Super P.E.K.K.A':    {c:'troop', s:'pekka2'},
  'Hog Glider':         {c:'troop', s:'hog-glider'},
  // ── Macchine d'assedio ────────────────────────────────────────────────────
  'Wall Wrecker':       {c:'troop', s:'siege-machine-ram'},
  'Battle Blimp':       {c:'troop', s:'siege-machine-flyer'},
  'Stone Slammer':      {c:'troop', s:'siege-catapult'},
  'Siege Barracks':     {c:'troop', s:'siege-machine-carrier'},
  'Log Launcher':       {c:'troop', s:'siege-log-launcher'},
  'Flame Flinger':      {c:'troop', s:'flame-flinger'},
  'Battle Drill':       {c:'troop', s:'battle-drill'},
  'Sky Wagon':          {c:'troop', s:'sky-wagon'},
  // ── Equipaggiamento eroi ──────────────────────────────────────────────────
  // Re dei Barbari
  'Barbarian Puppet':   {c:'equipment', s:'barbarian-puppet'},
  'Rage Vial':          {c:'equipment', s:'rage-vial'},
  'Earthquake Boots':   {c:'equipment', s:'earthquake-boots'},
  'Vampstache':         {c:'equipment', s:'vampstache'},
  'Giant Gauntlet':     {c:'equipment', s:'giant-gauntlet'},
  'Spiky Ball':         {c:'equipment', s:'spiky-ball'},
  // Regina degli Arcieri
  'Archer Puppet':      {c:'equipment', s:'archer-puppet'},
  'Invisibility Vial':  {c:'equipment', s:'invisibility-vial'},
  'Giant Arrow':        {c:'equipment', s:'giant-arrow'},
  'Healer Puppet':      {c:'equipment', s:'healer-puppet'},
  'Frozen Arrow':       {c:'equipment', s:'frozen-arrow'},
  'Magic Mirror':       {c:'equipment', s:'magic-mirror'},
  // Grande Custode
  'Eternal Tome':       {c:'equipment', s:'eternal-tome'},
  'Life Gem':           {c:'equipment', s:'life-gem'},
  'Rage Gem':           {c:'equipment', s:'rage-gem'},
  'Healing Tome':       {c:'equipment', s:'healing-tome'},
  'Fireball':           {c:'equipment', s:'fireball'},
  'Lavaloon Puppet':    {c:'equipment', s:'lavaloon-puppet'},
  // Campione Reale
  'Royal Gem':          {c:'equipment', s:'royal-gem'},
  'Seeking Shield':     {c:'equipment', s:'seeking-shield'},
  'Hog Rider Puppet':   {c:'equipment', s:'hog-rider-puppet'},
  'Haste Vial':         {c:'equipment', s:'haste-vial'},
  'Rocket Spear':       {c:'equipment', s:'rocket-spear'},
  'Metal Pants':        {c:'equipment', s:'metal-pants'},
  // Principe degli Sgherri
  'Dark Orb':           {c:'equipment', s:'dark-orb'},
  'Henchmen Puppet':    {c:'equipment', s:'henchmen-puppet'},
  // Campione Reale (aggiunte mancanti)
  'Electro Boots':      {c:'equipment', s:'electro-boots'},
  'Frost Flake':        {c:'equipment', s:'frost-flake'},
  // Principe degli Sgherri (aggiunte mancanti)
  'Dark Crown':         {c:'equipment', s:'dark-crown'},
  'Meteor Staff':       {c:'equipment', s:'meteor-staff'},
  'Noble Iron':         {c:'equipment', s:'noble-iron'},
  // Re dei Barbari (aggiunte mancanti)
  'Snake Bracelet':     {c:'equipment', s:'snake-bracelet'},
  'Stick Horse':        {c:'equipment', s:'stick-horse'},
  // Regina degli Arcieri (aggiunte mancanti)
  'Action Figure':      {c:'equipment', s:'action-figure'},
  // Grande Custode (aggiunte mancanti)
  'Heroic Torch':       {c:'equipment', s:'heroic-torch'},
  // Duca Drago
  'Fire Heart':         {c:'equipment', s:'fire-heart'},
  'Flame Blower':       {c:'equipment', s:'flame-blower'},
  'Stun Blaster':       {c:'equipment', s:'stun-blaster'},
  'Electro Fangs':      {c:'equipment', s:'electro-fangs'},
  'Rocket Backpack':    {c:'equipment', s:'rocket-backpack'},
  // ── Truppe / incantesimi recenti (slug coc.guide; mirror GH sotto) ───────────
  'Furnace':            {c:'troop', s:'furnace'},
  'Meteor Golem':       {c:'troop', s:'meteor-golem'},
  'Ice Block Spell':    {c:'spell', s:'ice-block-spell'},
  'Totem Spell':        {c:'spell', s:'totem-spell'},
  'Super Yeti':         {c:'troop', s:'super-yeti'},
  'Super Valkyrie':     {c:'troop', s:'super-valkyrie'},
};

/** Path opzionale `units/...` per asset venduti in repo (sovrascrive catena se presente). */
const UNIT_LOCAL_IMAGE = {};

/**
 * Mirror immagini da Zacatac3/clash_widgets (Assets.xcassets), path relativo alla cartella xcassets.
 * @see https://github.com/Zacatac3/clash_widgets
 */
const GH_WIDGETS_BASE = 'https://raw.githubusercontent.com/Zacatac3/clash_widgets/main/clash_widgets/Assets.xcassets';

const UNIT_GH_WIDGETS_PATH = {
  'Minion Prince': 'heroes/minion_prince.imageset/100.png',
  'Battle Copter': 'builder_base/battle_copter.imageset/300.png',
  'Furnace': 'lab/furnace.imageset/120(3).png',
  'Meteor Golem': 'lab/meteor_golem.imageset/120.png',
  'Ice Block Spell': 'lab/ice_block_spell.imageset/120(6).png',
  'Totem Spell': 'lab/totem_spell.imageset/120(9).png',
  'L.A.S.S.I': 'pets/l_a_s_s_i.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC9pQnVZdFVQcGNjYnZHaEw2Njh3cy5wbmcifQ_supercell_98198naVqmJ2j4cjQuCwnkdKVCIusG1eFAFg40gXKJw.png',
  'Mighty Yak': 'pets/mighty_yak.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC81ODJDWlcyZzhMc0tkYmdOWGdOYS5wbmcifQ_supercell_mz-qEWrGI4WC0oo6PrxoTJAM7XNdW7GK2ceDC44DFF0.png',
  'Electro Owl': 'pets/electro_owl.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC93dVdaSkVqYlNXSmF3Z29kcDlvci5wbmcifQ_supercell_bYw4mQC4xHFAtlqyYw4tXLgm3-gKxgtliXOAFN0oqUU.png',
  'Unicorn': 'pets/unicorn.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC9aSGdOTmNWRlRWUFZOZWF0ZmsyQi5wbmcifQ_supercell_QWSFErv6lnbsYREMZ6mx9eej5rUYNkjhJAfq7B9lvJQ.png',
  'Spirit Fox': 'pets/spirit_fox.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC9aQkpOWFYyYWdnTmNrUWpBTGc5eS5wbmcifQ_supercell_QUOkTvJfRuEYsiXO_v2olK7OxSvgiGG-auY7wSFwbYY.png',
  'Sneezy': 'pets/sneezy.imageset/eyJwYXRoIjoic3VwZXJjZWxsXC9maWxlXC9ROHpLVFJESHNKcnJmTkJuQ0s2My5wbmcifQ_supercell_YoJvpbIiHioEqD7d3LTqPv7EEc6O_XquWLDSkHsL450.png',
  'Barbarian Puppet': 'equipment/barbarian_puppet.imageset/100(2).png',
  'Rage Vial': 'equipment/rage_vial.imageset/100(3).png',
  'Spiky Ball': 'equipment/spiky_ball.imageset/100(7).png',
  'Snake Bracelet': 'equipment/snake_bracelet.imageset/100(8).png',
  'Archer Puppet': 'equipment/archer_puppet.imageset/100(9).png',
  'Action Figure': 'equipment/action_figure.imageset/100(15).png',
  'Henchmen Puppet': 'equipment/henchmen_puppet.imageset/100(16).png',
  'Dark Orb': 'equipment/dark_orb.imageset/100(17).png',
  'Metal Pants': 'equipment/metal_pants.imageset/100(18).png',
  'Noble Iron': 'equipment/noble_iron.imageset/100(19).png',
  'Dark Crown': 'equipment/dark_crown.imageset/100(20).png',
  'Meteor Staff': 'equipment/meteor_staff.imageset/100(21).png',
  'Fireball': 'equipment/fireball.imageset/100(26).png',
  'Lavaloon Puppet': 'equipment/lavaloon_puppet.imageset/100(27).png',
  'Heroic Torch': 'equipment/heroic_torch.imageset/100(28).png',
  'Royal Gem': 'equipment/royal_gem.imageset/100(29).png',
  'Frost Flake': 'equipment/frost_flake.imageset/100(35).png',
  'Stick Horse': 'equipment/stick_horse.imageset/Stick_Horse.png',
};

function getGhWidgetsUrl(name) {
  const rel = UNIT_GH_WIDGETS_PATH[name];
  return rel ? `${GH_WIDGETS_BASE}/${rel}` : '';
}

// ── NOMI ITALIANI UNITÀ ───────────────────────────────────────────────────────
const UNIT_NAME_IT = {
  // Eroi
  'Barbarian King':'Re dei Barbari','Archer Queen':'Regina degli Arcieri',
  'Grand Warden':'Gran Sorvegliante','Royal Champion':'Campionessa Reale',
  'Minion Prince':'Principe degli Sgherri','Dragon Duke':'Duca Drago',
  'Battle Machine':'Macchina da Battaglia','Battle Copter':'Elicottero da Battaglia','B.O.B':'B.O.B',
  // Truppe home — nomi ufficiali IT verificati su coc.guide/it (dati estratti dal gioco)
  'Barbarian':'Barbaro','Archer':'Arciere','Giant':'Gigante','Goblin':'Goblin',
  'Wall Breaker':'Spaccamuro','Balloon':'Mongolfiera','Wizard':'Stregone',
  'Healer':'Guaritore','Dragon':'Drago','P.E.K.K.A':'P.E.K.K.A',
  'Minion':'Sgherro','Hog Rider':'Domatore di Cinghiali',
  'Valkyrie':'Valchiria','Golem':'Golem','Witch':'Strega',
  'Lava Hound':'Mastino Lavico','Bowler':'Bocciatore',
  'Baby Dragon':'Cucciolo di Drago','Miner':'Minatore',
  'Super Barbarian':'Superbarbaro','Sneaky Goblin':'Goblin Furtivo',
  'Super Giant':'Supergigante','Rocket Balloon':'Mongolfiera Razzo',
  'Inferno Dragon':'Drago Infernale','Super Witch':'Superstrega',
  'Ice Hound':'Mastino Glaciale','Super Bowler':'Superbocciatore',
  'Super Dragon':'Superdrago','Electro Dragon':'Drago Elettro',
  'Yeti':'Yeti','Dragon Rider':'Cavalcadraghi',
  'Electro Titan':'Titana delle Folgori','Root Rider':'Guardiana delle Selve',
  'Thrower':'Lanciatore','Super Archer':'Superarciere',
  'Super Wall Breaker':'Superspaccamuro','Super Miner':'Superminatore',
  'Super Hog Rider':'Superdomatore di Cinghiali','Super Yeti':'Super Yeti',
  'Super Minion':'Supersgherro','Ram Rider':'Domatrice di Arieti',
  'Furnace':'Fornace','Meteor Golem':'Golem Meteorite',
  'Apprentice Warden':'Apprendista Sorvegliante',
  // Incantesimi
  'Lightning Spell':'Fulmine','Healing Spell':'Guarigione','Rage Spell':'Rabbia',
  'Freeze Spell':'Congelamento','Jump Spell':'Salto','Earthquake Spell':'Terremoto',
  'Haste Spell':'Velocità','Clone Spell':'Clone','Invisibility Spell':'Invisibilità',
  'Recall Spell':'Richiamo','Bat Spell':'Pipistrelli','Skeleton Spell':'Scheletri',
  'Goblin Spell':'Goblin','Overgrowth Spell':'Ipercrescita',
  'Ice Block Spell':'Blocco di ghiaccio','Totem Spell':'Totem',
  'Poison Spell':'Veleno',
  'Dark Spell':'Oscuro',
  // Macchine d'assedio — nomi confermati coc.guide/it dove disponibili
  'Wall Wrecker':'Sgretolamuri','Battle Blimp':'Dirigibile',
  'Stone Slammer':'Frantumatore di Pietre','Siege Barracks':'Caserma Volante',
  'Log Launcher':'Sputatronchi','Flame Flinger':'Sganciapietre',
  'Battle Drill':'Trivella da Battaglia',
  'Sky Wagon':'Vagone del Cielo',
  // Equipaggiamento — nuovi items
  'Snake Bracelet':'Bracciale Serpente','Action Figure':'Action Figure',
  'Heroic Torch':'Torcia Eroica','Frost Flake':'Fiocco di Gelo',
  'Dark Crown':'Corona Oscura','Meteor Staff':'Bastone Meteora',
  'Noble Iron':'Ferro Nobile','Fire Heart':'Cuore di Fuoco',
  'Flame Blower':'Mantice Sputafuoco','Stun Blaster':'Rivoltella Sonica',
  'Electro Fangs':'Zanne Elettriche',
  'Rocket Backpack':'Zaino a Razzo',
  'Earthquake Boots':'Stivali del Terremoto',
  // Famigli
  'L.A.S.S.I':'L.A.S.S.I','Electro Owl':'Gufo Elettro','Mighty Yak':'Yak Possente',
  'Unicorn':'Unicorno','Frosty':'Gelido','Diggy':'Scavino',
  'Poison Lizard':'Lucertola Velenosa','Phoenix':'Fenice',
  'Spirit Fox':'Volpe Spirito','Angry Jelly':'Medusa Arrabbiata',
  'Greedy Raven':'Corvo Alalesta',
  'Sneezy':'Starnuto',
  // Truppe builder — nomi confermati coc.guide/it
  'Raged Barbarian':'Barbaro Furioso','Sneaky Archer':'Arciere Furtivo',
  'Boxer Giant':'Gigante Pugile','Beta Minion':'Beta Servitore',
  'Bomber':'Bombarolo',
  'Cannon Cart':'Cannone a Rotelle','Night Witch':'Strega Notturna',
  'Drop Ship':'Nave Lanciatore','Super P.E.K.K.A':'Super P.E.K.K.A',
  'Hog Glider':'Domatore Volante',
  // Truppe capitale
  'Super Wizard':'Superstregone','Super Valkyrie':'Supervalchiria',
  // Rinomina in game (ago 2026) e nuove aggiunte
  'Power P.E.K.K.A':'P.E.K.K.A Micidiale','Troop Launcher':'Lancia-Truppe',
  'Electrofire Wizard':'Mago Elettrofuoco',
};

function _unitNameIt(name) { return UNIT_NAME_IT[name] || name; }

/** Ultimo fallback: slug coc.guide (spesso 404 per contenuti nuovi). */
function getCocGuideUrl(name, category) {
  if (!name) return '';
  if (UNIT_COC_SLUG[name]) {
    const {c, s} = UNIT_COC_SLUG[name];
    return `https://coc.guide/static/imgs/${c}/${s}.png`;
  }
  const CAT = {heroes:'hero',troops:'troop',spells:'spell',pets:'pet',equipment:'equipment'};
  const cat = CAT[category] || category || 'troop';
  const slug = name.toLowerCase().replace(/['.()]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-');
  return `https://coc.guide/static/imgs/${cat}/${slug}.png`;
}

function getAssetUrl(name, category) {
  if (UNIT_WIKI_URL[name]) return UNIT_WIKI_URL[name];
  return getCocGuideUrl(name, category);
}

// TODO: rimuovere se non usata altrove
function _unitFallbackColor(name) {
  let h = 0;
  for (const c of (name||'')) h = ((h<<5)-h)+c.charCodeAt(0);
  const cols = ['#8B4513','#2980B9','#27AE60','#8E44AD','#E67E22','#C0392B','#16A085','#D35400'];
  return cols[Math.abs(h)%cols.length];
}

const PETS_SET = new Set(['L.A.S.S.I','Electro Owl','Mighty Yak','Unicorn','Frosty','Diggy','Poison Lizard','Phoenix','Spirit Fox','Angry Jelly','Sneezy','Greedy Raven']);
const SIEGE_SET = new Set(['Wall Wrecker','Battle Blimp','Stone Slammer','Siege Barracks','Log Launcher','Flame Flinger','Battle Drill','Sky Wagon','Troop Launcher']);
// Super Truppe (potenziamenti temporanei sbloccabili con gemme): sezione separata in "Il mio profilo"
const SUPER_TROOP_SET = new Set(['Super Barbarian','Super Archer','Super Giant','Sneaky Goblin','Super Wall Breaker','Rocket Balloon','Super Wizard','Super Dragon','Inferno Dragon','Super Miner','Super Yeti','Super Minion','Super Hog Rider','Super Valkyrie','Super Witch','Ice Hound','Super Bowler']);

// ── MAPPA EQUIPAGGIAMENTO → EROE PROPRIETARIO ─────────────────────────────────
// Fonte: wiki ufficiale Supercell (marzo 2026)
const HERO_EQUIPMENT_MAP = {
  // Re dei Barbari (8 items)
  'Barbarian Puppet':'Barbarian King','Rage Vial':'Barbarian King',
  'Earthquake Boots':'Barbarian King','Vampstache':'Barbarian King',
  'Giant Gauntlet':'Barbarian King','Spiky Ball':'Barbarian King',
  'Snake Bracelet':'Barbarian King',
  'Stick Horse':'Barbarian King',
  // Regina degli Arcieri (7 items)
  'Archer Puppet':'Archer Queen','Invisibility Vial':'Archer Queen',
  'Giant Arrow':'Archer Queen','Healer Puppet':'Archer Queen',
  'Frozen Arrow':'Archer Queen','Magic Mirror':'Archer Queen',
  'Action Figure':'Archer Queen',
  // Grande Custode (7 items)
  'Eternal Tome':'Grand Warden','Life Gem':'Grand Warden',
  'Rage Gem':'Grand Warden','Healing Tome':'Grand Warden',
  'Fireball':'Grand Warden','Lavaloon Puppet':'Grand Warden',
  'Heroic Torch':'Grand Warden',
  // Campione Reale (7 items) — Electro Boots appartiene qui, NON al Duca Drago
  'Royal Gem':'Royal Champion','Seeking Shield':'Royal Champion',
  'Hog Rider Puppet':'Royal Champion','Haste Vial':'Royal Champion',
  'Rocket Spear':'Royal Champion','Electro Boots':'Royal Champion',
  'Frost Flake':'Royal Champion',
  // Principe degli Sgherri (6 items) — Metal Pants appartiene qui, NON al Campione Reale
  'Dark Orb':'Minion Prince','Henchmen Puppet':'Minion Prince',
  'Metal Pants':'Minion Prince','Dark Crown':'Minion Prince',
  'Meteor Staff':'Minion Prince','Noble Iron':'Minion Prince',
  // Duca Drago (5 items)
  'Fire Heart':'Dragon Duke','Flame Blower':'Dragon Duke',
  'Stun Blaster':'Dragon Duke','Electro Fangs':'Dragon Duke',
  'Rocket Backpack':'Dragon Duke',
};
const HERO_ORDER_EQUIP = ['Barbarian King','Archer Queen','Grand Warden','Royal Champion','Minion Prince','Dragon Duke'];

// Renderizza equipaggiamento raggruppato per eroe
function _renderEquipmentGrouped(containerId, equipment) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!equipment || !equipment.length) {
    el.innerHTML = '<span class="profilo-empty-units">Nessun equipaggiamento sbloccato</span>';
    return;
  }

  // Raggruppa per eroe
  const groups = {};
  HERO_ORDER_EQUIP.forEach(h => { groups[h] = []; });
  groups['__altro__'] = [];
  equipment.forEach(item => {
    const hero = HERO_EQUIPMENT_MAP[item.name];
    const key = (hero && groups[hero] !== undefined) ? hero : '__altro__';
    groups[key].push(item);
  });

  function unitCardHtml(u) {
    const nameIt  = _unitNameIt(u.name);
    const pair    = _unitImgSrcPair(u, 'equipment');
    const lvl     = u.level ?? 0;
    const maxLvl  = u.maxLevel ?? 0;
    const isMax   = maxLvl > 0 && lvl >= maxLvl;
    const isLocked= lvl === 0;
    return `<div class="profilo-unit-card${isMax?' profilo-unit-max':''}${isLocked?' profilo-unit-locked':''}" title="${nameIt}">
      <div class="profilo-unit-img-wrap">
        <img src="${pair.src}" alt="${nameIt}" class="profilo-unit-img" loading="lazy" decoding="async" referrerpolicy="no-referrer"${_unitImgDataFbChainAttr(pair.fbChain)}
          onerror="_profiloUnitImgOnError(this)">
        <div class="profilo-unit-fallback profilo-unit-fallback--neutral" style="display:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3l-1.9 5.8H4.2l4.8 3.5-1.8 5.7L12 14.5l4.8 3.5-1.8-5.7 4.8-3.5h-5.9z"/>
          </svg>
        </div>
        ${!isLocked ? `<span class="unit-lv-badge${isMax?' unit-lv-badge--max':''}">${lvl}</span>` : ''}
      </div>
    </div>`;
  }

  let html = '';
  HERO_ORDER_EQUIP.forEach(heroKey => {
    const items = groups[heroKey];
    if (!items || !items.length) return;
    const label = heroKey === '__altro__' ? 'Altro' : _unitNameIt(heroKey);
    html += `<div class="profilo-equip-group">
      <div class="profilo-equip-group-label">${label}</div>
      <div class="profilo-units-grid">${items.map(unitCardHtml).join('')}</div>
    </div>`;
  });
  el.innerHTML = html;
}

function _renderUnits(containerId, units, cdnCategory) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!units || !units.length) {
    el.innerHTML = '<span class="profilo-empty-units">Nessuna unità sbloccata</span>';
    return;
  }
  el.innerHTML = units.map(u => {
    const nameIt  = _unitNameIt(u.name);
    const pair    = _unitImgSrcPair(u, cdnCategory);
    const lvl     = u.level ?? 0;
    const maxLvl  = u.maxLevel ?? 0;
    const isMax   = maxLvl > 0 && lvl >= maxLvl;
    const isLocked= lvl === 0;
    return `<div class="profilo-unit-card${isMax?' profilo-unit-max':''}${isLocked?' profilo-unit-locked':''}" title="${nameIt}">
      <div class="profilo-unit-img-wrap">
        <img src="${pair.src}" alt="${nameIt}" class="profilo-unit-img" loading="lazy" decoding="async" referrerpolicy="no-referrer"${_unitImgDataFbChainAttr(pair.fbChain)}
          onerror="_profiloUnitImgOnError(this)">
        <div class="profilo-unit-fallback profilo-unit-fallback--neutral" style="display:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3l-1.9 5.8H4.2l4.8 3.5-1.8 5.7L12 14.5l4.8 3.5-1.8-5.7 4.8-3.5h-5.9z"/>
          </svg>
        </div>
        ${!isLocked ? `<span class="unit-lv-badge${isMax?' unit-lv-badge--max':''}">${lvl}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _renderAchievements(containerId, achievements) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!achievements.length) { el.innerHTML = '<span class="profilo-empty-units">Nessun obiettivo</span>'; return; }
  el.innerHTML = achievements.map(a => {
    const done = a.value >= a.target;
    const pct  = a.target ? Math.min(100, Math.round((a.value / a.target) * 100)) : 100;
    return `<div class="profilo-ach-row${done ? ' profilo-ach-done' : ''}">
      <div class="profilo-ach-icon">${done
        ? '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="opacity:.35"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
      }</div>
      <div class="profilo-ach-body">
        <div class="profilo-ach-name">${a.name}</div>
        ${!done ? `<div class="profilo-ach-bar-wrap"><div class="profilo-ach-bar" style="width:${pct}%"></div></div>
        <div class="profilo-ach-prog">${a.value.toLocaleString('it')} / ${a.target.toLocaleString('it')}</div>` : ''}
      </div>
      ${a.stars ? `<div class="profilo-ach-stars">${'⭐'.repeat(a.stars)}</div>` : ''}
    </div>`;
  }).join('');
}

function switchProfiloTab(tab, btn) {
  ['home','builder','capital'].forEach(t => {
    const el = document.getElementById(`profilo-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#tab-profilo .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _profiloActiveTab = tab;
}

// ── CERCA ─────────────────────────────────────────────────────────────────────

// ── PREFERITI (localStorage) ──────────────────────────────────────────────────
let _favs = (() => {
  try { return JSON.parse(localStorage.getItem('coc_favorites') || '{"clans":{},"players":{}}'); }
  catch(_) { return {clans:{}, players:{}}; }
})();
function _saveFavs() { localStorage.setItem('coc_favorites', JSON.stringify(_favs)); }
function _syncFavBtnDOM(type, tag) {
  const id = `fav-btn-${type}_${String(tag).replace(/[^a-zA-Z0-9]/g, '_')}`;
  const btn = document.getElementById(id);
  if (!btn) return;
  const active = _isFav(type, tag);
  btn.classList.toggle('btn-fav--active', active);
  btn.title = active ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('fill', active ? 'currentColor' : 'none');
}
function toggleFavClan(tag, name, badge) {
  if (_favs.clans[tag]) delete _favs.clans[tag];
  else _favs.clans[tag] = { tag, name, badge: badge||'', ts: Date.now() };
  _saveFavs();
  _syncFavBtnDOM('clans', tag);
  _updateFavUI();
}
function toggleFavPlayer(tag, name) {
  if (_favs.players[tag]) delete _favs.players[tag];
  else _favs.players[tag] = { tag, name, ts: Date.now() };
  _saveFavs();
  _syncFavBtnDOM('players', tag);
  _updateFavUI();
}
function _isFav(type, tag) { return !!_favs[type]?.[tag]; }
function _favBtn(type, tag, name, badge) {
  const active = _isFav(type, tag);
  const onclick = type==='clans'
    ? `toggleFavClan('${tag.replace(/'/g,"\\'")}','${name.replace(/'/g,"\\'")}','${(badge||'').replace(/'/g,"\\'")}')`
    : `toggleFavPlayer('${tag.replace(/'/g,"\\'")}','${name.replace(/'/g,"\\'")}')`;
  return `<button type="button" class="btn-fav${active?' btn-fav--active':''}" onclick="${onclick};event.stopPropagation()" title="${active?'Rimuovi dai preferiti':'Aggiungi ai preferiti'}" id="fav-btn-${type}_${tag.replace(/[^a-zA-Z0-9]/g,'_')}">
    <svg viewBox="0 0 24 24" fill="${active?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
  </button>`;
}
function _updateFavUI() {
  // Aggiorna tutti i btn-fav nella pagina
  document.querySelectorAll('[id^="fav-btn-"]').forEach(btn => {
    const id = btn.id.replace('fav-btn-','');
    // cerca tag corrispondente (meno affidabile, ma sufficiente)
    const isActive = btn.classList.contains('btn-fav--active');
    // re-render dell'icona già fatto via onclick; aggiorna solo aria/title
  });
  renderFavoriti();
}
function renderFavoriti() {
  const el = document.getElementById('cerca-preferiti-content');
  if (!el) return;
  const clans   = Object.values(_favs.clans||{}).sort((a,b)=>b.ts-a.ts);
  const players = Object.values(_favs.players||{}).sort((a,b)=>b.ts-a.ts);
  if (!clans.length && !players.length) {
    el.innerHTML = '<div class="profilo-empty"><p>Nessun preferito salvato.<br><span style="font-size:0.78rem;color:var(--text-3)">Aggiungi clan e giocatori dalla ricerca.</span></p></div>';
    return;
  }
  let html = '';
  if (clans.length) {
    html += '<div style="margin-bottom:1rem"><div class="profilo-sub-label" style="margin-bottom:0.5rem">Clan</div>';
    html += clans.map(c => `
      <div class="fav-row">
        ${c.badge ? `<img src="${c.badge}" class="cerca-clan-badge" alt="" style="width:32px;height:32px">` : ''}
        <span class="fav-name" onclick="openCercaClan('${c.tag}')" style="cursor:pointer">${c.name} <span class="mono" style="font-size:0.75rem;color:var(--text-3)">${c.tag}</span></span>
        <button type="button" class="btn-fav btn-fav--active" onclick="toggleFavClan('${c.tag.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}','${(c.badge||'').replace(/'/g,"\\'")}')">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        </button>
      </div>`).join('');
    html += '</div>';
  }
  if (players.length) {
    html += '<div><div class="profilo-sub-label" style="margin-bottom:0.5rem">Giocatori</div>';
    html += players.map(p => `
      <div class="fav-row">
        <span class="fav-name" onclick="openCercaPlayer('${p.tag}')" style="cursor:pointer">${p.name} <span class="mono" style="font-size:0.75rem;color:var(--text-3)">${p.tag}</span></span>
        <button type="button" class="btn-fav btn-fav--active" onclick="toggleFavPlayer('${p.tag.replace(/'/g,"\\'")}','${p.name.replace(/'/g,"\\'")}')">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        </button>
      </div>`).join('');
    html += '</div>';
  }
  el.innerHTML = html;
}

let _cercaType = 'clan';

function _switchCercaSubtab(tab, btn) {
  document.getElementById('cerca-sub-ricerca').style.display  = tab==='ricerca'  ? 'block' : 'none';
  document.getElementById('cerca-sub-preferiti').style.display = tab==='preferiti' ? 'block' : 'none';
  document.querySelectorAll('#cerca-search-area .subtab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab==='preferiti') renderFavoriti();
}

function setCercaType(type) {
  _cercaType = type;
  document.getElementById('cerca-type-clan').classList.toggle('active', type === 'clan');
  document.getElementById('cerca-type-player').classList.toggle('active', type === 'player');
  const hint = document.getElementById('cerca-hint');
  if (hint) hint.textContent = type === 'clan'
    ? 'Cerca per nome (min 3 caratteri) o tag (#ABC123)'
    : 'Inserisci il tag esatto del giocatore (es. #2J2ABC)';
  const input = document.getElementById('cerca-input');
  if (input) input.placeholder = type === 'clan' ? 'Nome clan o tag #ABC…' : 'Tag giocatore #ABC…';
}

async function eseguiCerca() {
  const q = (document.getElementById('cerca-input')?.value || '').trim();
  const results = document.getElementById('cerca-results');
  if (!q) return;
  if (_cercaType === 'player' && !q.startsWith('#')) {
    results.innerHTML = '<p class="cerca-error">I giocatori si cercano solo per tag (es. #2J2ABC)</p>';
    return;
  }
  results.innerHTML = '<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Ricerca in corso…</span></div>';
  try {
    let url;
    if (_cercaType === 'player') {
      url = `/api/lookup?type=player&playerTag=${encodeURIComponent(q)}`;
    } else {
      url = `/api/lookup?type=search-clans&q=${encodeURIComponent(q)}`;
    }
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Nessun risultato');
    if (_cercaType === 'player') {
      renderCercaPlayer(data, results);
    } else {
      renderCercaClans(data.items || [], results);
    }
  } catch (e) {
    results.innerHTML = `<p class="cerca-error">${e.message}</p>`;
  }
}

document.getElementById('cerca-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') eseguiCerca();
});

function renderCercaPlayer(p, container) {
  const leagueFor = _playerLeagueForBadge(p);
  const leagueHtml = leagueFor
    ? rankLeagueBadgeHtml(leagueFor, { imgClass: 'cerca-league-badge' })
    : '';
  const fav = _favBtn('players', p.tag, p.name);
  container.innerHTML = `
    <div class="cerca-player-card">
      <div class="cerca-player-card-head">
      <div class="cerca-player-left">
        ${thImg(p.townHallLevel)}
        <div>
          <div class="cerca-player-name">${p.name}</div>
          <div class="cerca-player-tag mono">${p.tag}</div>
          ${p.clan ? `<div class="cerca-player-clan">${p.clan.name}</div>` : ''}
        </div>
        ${leagueHtml}
      </div>
      ${fav}
      </div>
      <div class="profilo-stats-row" style="margin-top:0.75rem">
        <div class="profilo-stat"><span class="profilo-stat-val">${p.trophies??'—'}</span><span class="profilo-stat-lbl">Trofei</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">${p.warStars??'—'}</span><span class="profilo-stat-lbl">Stelle War</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">${p.donations??'—'}</span><span class="profilo-stat-lbl">Donate</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">${p.expLevel??'—'}</span><span class="profilo-stat-lbl">Livello</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">TH${p.townHallLevel??'—'}</span><span class="profilo-stat-lbl">Town Hall</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">BH${p.builderHallLevel??'—'}</span><span class="profilo-stat-lbl">Builder</span></div>
      </div>
      <button class="btn-primary btn-sm" style="margin-top:0.75rem;width:100%" onclick="openCercaPlayer('${p.tag}')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        Apri Profilo Completo
      </button>
    </div>`;
}

function renderCercaClans(clans, container) {
  if (!clans.length) {
    container.innerHTML = '<div class="profilo-empty"><p>Nessun clan trovato.</p></div>';
    return;
  }
  container.innerHTML = clans.map(c => {
    const badge = c.badgeUrls?.small || c.badgeUrls?.medium || '';
    const typeLabel = CLAN_TYPE_LABELS[c.type] || c.type || '';
    const fav = _favBtn('clans', c.tag, c.name, badge);
    return `<div class="cerca-clan-card">
      <div class="cerca-clan-card-head">
      <div class="cerca-clan-left">
        ${badge ? `<img src="${badge}" alt="" class="cerca-clan-badge">` : ''}
        <div style="flex:1;min-width:0">
          <div class="cerca-clan-name">${c.name}</div>
          <div class="cerca-clan-tag mono">${c.tag}</div>
          ${c.description ? `<div class="cerca-clan-desc">${c.description.slice(0,90)}${c.description.length>90?'…':''}</div>` : ''}
        </div>
      </div>
      ${fav}
      </div>
      <div class="cerca-clan-stats">
        <div class="profilo-stat"><span class="profilo-stat-val">${c.members??'—'}/50</span><span class="profilo-stat-lbl">Membri</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">${c.clanLevel??'—'}</span><span class="profilo-stat-lbl">Livello</span></div>
        <div class="profilo-stat"><span class="profilo-stat-val">${c.clanPoints??'—'}</span><span class="profilo-stat-lbl">Trofei</span></div>
        ${typeLabel?`<div class="profilo-stat"><span class="profilo-stat-val">${typeLabel}</span><span class="profilo-stat-lbl">Tipo</span></div>`:''}
      </div>
      <button class="btn-primary btn-sm" style="margin-top:0.75rem;width:100%" onclick="openCercaClan('${c.tag}')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        Apri Clan Completo
      </button>
    </div>`;
  }).join('');
}

// ── CERCA — NAVIGAZIONE DETTAGLI ─────────────────────────────────────────────

let _cercaStack = []; // [{type:'search'},{type:'clan',tag},{type:'player',tag,fromClan}]

function _showCercaArea(area) {
  document.getElementById('cerca-search-area').style.display  = area === 'search' ? 'block' : 'none';
  document.getElementById('cerca-detail-clan').style.display  = area === 'clan'   ? 'block' : 'none';
  document.getElementById('cerca-detail-player').style.display= area === 'player' ? 'block' : 'none';
}

function cercaTorna() {
  _cercaStack.pop();
  const prev = _cercaStack[_cercaStack.length-1];
  if (!prev || prev.type === 'search') {
    _showCercaArea('search');
  } else if (prev.type === 'clan') {
    _showCercaArea('clan');
  } else {
    _showCercaArea('search');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cercaPlayerTorna() {
  _cercaStack.pop();
  const prev = _cercaStack[_cercaStack.length-1];
  if (prev?.type === 'clan') {
    _showCercaArea('clan');
  } else {
    _showCercaArea('search');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Inizializza stack quando si entra nel tab cerca
const _origActivateTab = activateTab;
// patch activateTab per resettare lo stack cerca
document.querySelectorAll('.tab-btn, .bnav-btn').forEach(btn => {
  // già gestito da activateTab, qui aggiungiamo solo il reset stack
});

async function openCercaClan(tag) {
  if (!_cercaStack.length) _cercaStack.push({type:'search'});
  _cercaStack.push({type:'clan', tag});
  _showCercaArea('clan');
  window.scrollTo({top:0,behavior:'smooth'});

  const backBtn = document.getElementById('cerca-back-btn');
  if (backBtn) backBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg> Torna ai risultati`;

  const container = document.getElementById('cerca-clan-content');
  container.innerHTML = `<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento clan…</span></div>`;

  try {
    const [infoR, membR] = await Promise.all([
      fetch(`/api/clan-info?clanTag=${encodeURIComponent(tag)}`),
      fetch(`/api/clan-members?clanTag=${encodeURIComponent(tag)}`),
    ]);
    const info  = await infoR.json();
    const membs = await membR.json();
    if (!infoR.ok) throw new Error(info.error || 'Clan non trovato');
    _renderCercaClanDetail(info, membs.items || membs || [], tag, container);
  } catch(e) {
    container.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

function _renderCercaClanDetail(info, members, clanTag, container) {
  const badge = info.badgeUrls?.medium || info.badgeUrls?.small || '';
  const typeLabel = CLAN_TYPE_LABELS[info.type] || '';

  container.innerHTML = `
    <div class="cc-header">
      ${badge?`<img src="${badge}" alt="" class="cc-badge">`:''}
      <div class="cc-info">
        <div class="cc-name">${info.name}</div>
        <div class="cc-tag mono">${info.tag}</div>
        <div class="cc-meta">
          <span class="badge badge-gold">Lv. ${info.clanLevel??'—'}</span>
          ${typeLabel?`<span class="badge badge-gray">${typeLabel}</span>`:''}
          ${_favBtn('clans', info.tag, info.name, badge)}
        </div>
        ${info.clanPoints?`<div style="font-size:0.8rem;color:var(--text-3)">🏆 ${info.clanPoints.toLocaleString('it')} trofei${info.location?.name?' · 📍 '+info.location.name:''}</div>`:''}
        ${info.warLeague?.name?`<div style="font-size:0.8rem;color:var(--gold-dim)">⚔️ ${info.warLeague.name}</div>`:''}
        ${info.description?`<div class="cc-desc">${info.description}</div>`:''}
      </div>
    </div>
    <div class="profilo-stats-row" style="margin-bottom:1.25rem">
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--gold)"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 13.17 10.33 12 8 12zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5C23 13.17 18.33 12 16 12z"/></svg>
        <span class="profilo-stat-val">${info.members??'—'}/50</span>
        <span class="profilo-stat-lbl">Membri</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:#f0a500"><path d="M7 3H4v5c0 1.5.8 2.8 2 3.6V13H4v2h16v-2h-2v-1.4c1.2-.8 2-2.1 2-3.6V3h-3V1H7v2z"/></svg>
        <span class="profilo-stat-val">${info.clanPoints??'—'}</span>
        <span class="profilo-stat-lbl">Trofei</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--green)"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>
        <span class="profilo-stat-val">${info.warWins??'—'}</span>
        <span class="profilo-stat-lbl">War Vinte</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--blue)"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg>
        <span class="profilo-stat-val">${info.warWinStreak??'—'}</span>
        <span class="profilo-stat-lbl">Streak</span>
      </div>
    </div>
    <div class="subtab-bar">
      <button class="subtab-btn active" onclick="_switchCercaClanTab('members',this)">Membri</button>
      <button class="subtab-btn" onclick="_switchCercaClanTab('warlog',this)">War Classiche</button>
      <button class="subtab-btn" onclick="_switchCercaClanTab('cwl',this)">Cronologia CWL</button>
    </div>
    <div id="cc-tab-members">${_renderCercaMembersList(members, clanTag)}</div>
    <div id="cc-tab-warlog" style="display:none"><div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento…</span></div></div>
    <div id="cc-tab-cwl" style="display:none"><div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento…</span></div></div>
  `;

  _loadCercaWarLog(clanTag);
  _loadCercaCwlHistory(clanTag);
}

function _switchCercaClanTab(tab, btn) {
  ['members','warlog','cwl'].forEach(t => {
    const el = document.getElementById(`cc-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cerca-clan-content .subtab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function _renderCercaMembersList(members, clanTag) {
  if (!members || !members.length) return '<div class="profilo-empty"><p>Nessun membro trovato.</p></div>';
  const sorted = [...members].sort((a,b)=>{
    const ro={leader:0,coLeader:1,admin:2,member:3};
    return (ro[a.role]??3)-(ro[b.role]??3)||(b.trophies||0)-(a.trophies||0);
  });
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr>
      <th class="col-league">Lega</th>
      <th class="col-th-hdr">TH</th>
      <th>Nome / Tag · Ruolo</th>
      <th>Trofei</th>
      <th class="col-extra">Don. / Ric.</th>
    </tr></thead>
    <tbody>
      ${sorted.map(m=>{
        const role=cocRole(m.role);
        const lbHtml = rankLeagueBadgeHtml(m.league);
        return `<tr class="cc-member-row" onclick="openCercaPlayer('${m.tag}','${clanTag}')">
          <td class="col-league">${lbHtml}</td>
          <td class="col-th-cell">${thImgV(m.townHallLevel)}</td>
          <td>
            <div style="font-weight:600;font-size:0.88rem">${m.name}</div>
            <div class="tag-cell">${m.tag} · <span class="${role.cls}">${role.label}</span></div>
          </td>
          <td class="mono" style="font-size:0.85rem">${m.trophies??'—'}</td>
          <td class="col-extra mono" style="font-size:0.82rem;color:var(--text-3)">${m.donations??0}/${m.donationsReceived??0}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div></div>`;
}

async function _loadCercaWarLog(clanTag, tabId = 'cc-tab-warlog') {
  const cont = document.getElementById(tabId);
  if (!cont) return;
  window._cercaClanTag = normClanTag(clanTag);
  try {
    const r = await fetch(`/api/war-log?clanTag=${encodeURIComponent(clanTag)}`);
    const data = await r.json();
    if (r.status === 403 || data.reason === 'accessDenied') {
      cont.innerHTML = '<div class="profilo-empty"><p>⚠️ War log privato. Il clan ha il registro guerra impostato su privato.</p></div>';
      return;
    }
    if (!r.ok) throw new Error(data.error||'Errore');
    const wars = (data.items||[]).filter(w=>{
      const wt=(w.warType||'').toLowerCase();
      if(wt==='cwl') return false;
      if(!w.opponent?.name) return false;
      const maxStars=(w.teamSize||50)*3;
      if((w.clan?.stars||0)>maxStars) return false;
      return true;
    }).slice(0,20);
    if (!wars.length) { cont.innerHTML='<div class="profilo-empty"><p>Nessuna war classica nel log.</p></div>'; return; }

    window._cercaWarLogItems = wars;
    window._cercaWarLogMap = {};
    wars.forEach(w => { if (w.endTime) window._cercaWarLogMap[w.endTime] = w; });

    const rows = wars.map((w, widx)=>{
      const date = w.endTime ? new Date(
        w.endTime.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,'$1-$2-$3T$4:$5:$6')
      ).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
      const result = w.result==='win'  ? '<span class="wl-win">Vinta ✓</span>'
                   : w.result==='lose' ? '<span class="wl-lose">Persa ✗</span>'
                   : '<span class="wl-draw">Patta =</span>';
      const size = w.teamSize??'?';
      const clanBadge = w.clan?.badgeUrls?.small
        ? `<img src="${w.clan.badgeUrls.small}" alt="" class="wl-clan-badge">` : '🛡️';
      const oppBadge  = w.opponent?.badgeUrls?.small
        ? `<img src="${w.opponent.badgeUrls.small}" alt="" class="wl-clan-badge">` : '🛡️';
      const clanLv = w.clan?.clanLevel     ? `<span class="wl-clan-lv">Lv ${w.clan.clanLevel}</span>` : '';
      const oppLv  = w.opponent?.clanLevel ? `<span class="wl-clan-lv">Lv ${w.opponent.clanLevel}</span>` : '';
      const clanCell = `<div class="wl-clan-cell">${clanBadge}<span>${w.clan?.name??'—'}${clanLv}</span></div>`;
      const oppCell  = `<div class="wl-clan-cell">${oppBadge}<span>${w.opponent?.name??'—'}${oppLv}</span></div>`;
      const starsNoi = w.clan?.stars??0;
      const starsLoro= w.opponent?.stars??0;
      const destNoi  = (+(w.clan?.destructionPercentage??0)).toFixed(1);
      const destLoro = (+(w.opponent?.destructionPercentage??0)).toFixed(1);
      return `<tr class="wl-row-clickable" onclick="openCercaWarDetail(${widx})">
        <td class="stat-cell">${date}</td>
        <td>${result}</td>
        <td>${clanCell}</td>
        <td class="stat-cell" style="text-align:center">vs<br><span style="font-size:0.72rem;color:var(--text-3)">${size}v${size}</span></td>
        <td>${oppCell}</td>
        <td class="stat-cell">${starsNoi}⭐ — ${starsLoro}⭐</td>
        <td class="stat-cell">${destNoi}% — ${destLoro}%</td>
        <td class="stat-cell"><button class="btn-war-detail" type="button">Dettagli</button></td>
      </tr>`;
    }).join('');

    cont.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);margin:0.5rem 0 0.25rem">Clicca su una riga per vedere i dettagli (roster e attacchi se salvati).</p>
    <div class="table-wrap" style="margin-top:0.25rem">
      <table>
        <thead><tr>
          <th>Data</th><th>Risultato</th><th>Clan</th>
          <th style="text-align:center">—</th><th>Avversario</th>
          <th>⭐ Noi — Loro</th><th>💥 Noi — Loro</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  } catch(e) {
    cont.innerHTML=`<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

async function openCercaWarDetail(idx) {
  const w = (window._cercaWarLogItems || [])[idx];
  if (!w) return;
  if (!window._cercaWarLogMap) window._cercaWarLogMap = {};
  const key = w.endTime || String(idx);
  window._cercaWarLogMap[key] = w;
  await openClassicWarDetail(key, {
    clanTag: window._cercaClanTag || w.clan?.tag,
    warMap: window._cercaWarLogMap,
  });
}

async function _loadCercaCwlHistory(clanTag) {
  const cont = document.getElementById('cc-tab-cwl');
  if (!cont) return;
  const tag = normClanTag(clanTag);
  try {
    const [seasonsRes, warsRes] = await Promise.all([
      db.from('cwl_seasons').select('*').eq('clan_tag', tag).order('season', { ascending: false }).limit(20),
      db.from('cwl_wars').select('*').eq('clan_tag', tag).order('season', { ascending: false }).order('round', { ascending: true }),
    ]);
    if (seasonsRes.error) throw new Error(seasonsRes.error.message);
    const data = seasonsRes.data || [];
    if (!data.length) {
      cont.innerHTML=`<div class="profilo-empty">
        <p style="font-size:0.85rem;color:var(--text-3);margin-bottom:0.75rem">Nessuna cronologia salvata per questo clan.</p>
        <button class="btn-secondary btn-sm" onclick="_loadCercaCwlLive('${tag.replace(/'/g,"\\'")}',this)">
          🔄 Carica CWL attuale dall'API
        </button>
        <div id="cc-cwl-live-result" style="margin-top:0.75rem"></div>
      </div>`;
      return;
    }

    // Prepara round map come in loadCwlSeasons (per aprire lo stesso modal dettaglio)
    const roundsMap = {};
    (warsRes.data || []).forEach(w => {
      if (!roundsMap[w.season]) roundsMap[w.season] = [];
      roundsMap[w.season].push({
        roundNumber: w.round,
        state: w.state || 'warEnded',
        startTime: w.start_time || null,
        endTime: w.end_time || null,
        teamSize: w.team_size || 15,
        attacksPerMember: 1,
        result: w.result || 'draw',
        clan: {
          tag: w.our_tag, name: w.our_name, badgeUrls: w.our_badge ? { small: w.our_badge } : null,
          stars: w.our_stars || 0, destruction: +(w.our_destr || 0),
          attacksUsed: (_parseWarMembersJson(w.our_members) || []).reduce((s, m) => s + (m.attacks?.length || 0), 0),
          members: _parseWarMembersJson(w.our_members) || []
        },
        opponent: {
          tag: w.opp_tag, name: w.opp_name || 'Sconosciuto',
          badgeUrls: w.opp_badge ? { small: w.opp_badge } : null,
          stars: w.opp_stars || 0, destruction: +(w.opp_destr || 0),
          attacksUsed: (_parseWarMembersJson(w.opp_members) || []).reduce((s, m) => s + (m.attacks?.length || 0), 0),
          members: _parseWarMembersJson(w.opp_members) || []
        },
        defenderMap: w.defender_map || {}
      });
    });
    Object.keys(roundsMap).forEach(s => {
      const mk = seasonMonthKey(s);
      if (mk !== s && !roundsMap[mk]) roundsMap[mk] = roundsMap[s];
    });
    window._cercaCwlRoundsMap = roundsMap;
    window._cercaCwlSeasons = data;
    window._cercaCwlClanTag = tag;

    cont.innerHTML = data.map(s=>{
      const leagueIt=LEAGUE_EN_TO_IT[s.league]||s.league||'—';
      const lb=LEAGUE_BADGE[leagueIt];
      const pos=s.position||0;
      const hasRounds = !!(roundsMap[s.season]?.length || roundsMap[seasonMonthKey(s.season)]?.length);
      const seasonEsc = String(s.season).replace(/'/g, "\\'");
      return `<div class="cwl-season-card${hasRounds ? ' cwl-season-card--clickable' : ''}"${hasRounds ? ` onclick="openCercaCwlSeasonDetail('${seasonEsc}')" title="Clicca per vedere i turni"` : ''}>
        <div class="cwl-card-left">
          <div class="cwl-card-month">${seasonLabel(s.season)}</div>
          <div class="cwl-card-league">
            ${lb?`<img src="${lb}" class="cwl-league-img" alt="">`:''}<span class="cwl-league-name">${leagueIt}</span>
          </div>
        </div>
        <div class="cwl-card-mid">
          <div class="cwl-pos-badge">${POS_MEDALS[pos]||''}</div>
          ${POS_LABELS[pos]?`<div class="cwl-league-sub">${POS_LABELS[pos]}</div>`:''}
        </div>
        <div class="cwl-card-right cwl-card-stats">
          ${s.wins!=null?`<div class="cwl-stat-item"><span class="cwl-stat-val">${s.wins}</span><span class="cwl-stat-lbl">Vittorie</span></div>`:''}
          ${s.stars!=null?`<div class="cwl-stat-item"><span class="cwl-stat-val">${s.stars}⭐</span><span class="cwl-stat-lbl">Stelle</span></div>`:''}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    cont.innerHTML=`<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

function openCercaCwlSeasonDetail(season) {
  const roundsMap = window._cercaCwlRoundsMap || {};
  let rounds = roundsMap[season] || roundsMap[seasonMonthKey(season)] || [];
  if (!rounds.length) return;
  const seasonObj = (window._cercaCwlSeasons || []).find(s => s.season === season) || { season };
  const focusTag = window._cercaCwlClanTag || seasonObj.clan_tag;
  const focusName = seasonObj.our_name || rounds[0]?.clan?.name || 'Clan';
  _renderCwlDetailModal(season, rounds, seasonObj.group_standings || null, {
    season,
    league: LEAGUE_EN_TO_IT[seasonObj.league] || seasonObj.league,
    position: seasonObj.position,
    groupStandings: seasonObj.group_standings || null,
    players: seasonObj.roster || null,
  }, { focusClanTag: focusTag, focusClanName: focusName });
}

async function _loadCercaCwlLive(clanTag, btn) {
  const resultDiv = document.getElementById('cc-cwl-live-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Caricamento…'; }
  try {
    const r = await fetch(`/api/cwl-stats?clanTag=${encodeURIComponent(clanTag)}`);
    const d = await r.json();
    if (!r.ok || d.state === 'notInWar') {
      if (resultDiv) resultDiv.innerHTML = '<p style="font-size:0.82rem;color:var(--text-3)">Nessuna CWL attiva per questo clan al momento.</p>';
      return;
    }
    // Mostra CWL live
    const season = d.season || '—';
    const league = d.leagueName || '—';
    const rounds = (d.rounds||[]);
    const html = `<div class="cwl-season-card" style="margin-bottom:0">
      <div class="cwl-card-left">
        <div class="cwl-card-month">CWL Attuale</div>
        <div class="cwl-card-league"><span class="cwl-league-name">${league}</span></div>
      </div>
      <div class="cwl-card-right cwl-card-stats">
        <div class="cwl-stat-item"><span class="cwl-stat-val">${rounds.length}</span><span class="cwl-stat-lbl">Round</span></div>
        ${d.groupStandings?`<div class="cwl-stat-item"><span class="cwl-stat-val">${d.groupStandings.length}</span><span class="cwl-stat-lbl">Clan nel gruppo</span></div>`:''}
      </div>
    </div>`;
    if (resultDiv) resultDiv.innerHTML = html;
  } catch(e) {
    if (resultDiv) resultDiv.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Carica CWL attuale dall\'API'; }
  }
}

async function openCercaPlayer(playerTag, fromClanTag) {
  if (!_cercaStack.length) _cercaStack.push({type:'search'});
  _cercaStack.push({type:'player', tag:playerTag, fromClan:fromClanTag||null});
  _showCercaArea('player');
  window.scrollTo({top:0,behavior:'smooth'});

  const backBtn = document.getElementById('cerca-back-player-btn');
  if (backBtn) backBtn.innerHTML = fromClanTag
    ? `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg> Torna al clan`
    : `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg> Torna ai risultati`;

  const container = document.getElementById('cerca-player-content');
  container.innerHTML = `<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento profilo…</span></div>`;

  try {
    const r = await fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(playerTag)}`);
    const p = await r.json();
    if (!r.ok) throw new Error(p.error||'Errore');

    container.innerHTML = `
      <div id="cp-header-card" class="profilo-hero-card" data-player-tag="${p.tag}" data-player-name="${p.name.replace(/"/g,'&quot;')}"></div>
      <div class="subtab-bar">
        <button class="subtab-btn active" onclick="_switchCpTab('home',this)">Villaggio Base</button>
        <button class="subtab-btn" onclick="_switchCpTab('builder',this)">Base Costruttore</button>
        <button class="subtab-btn" onclick="_switchCpTab('capital',this)">Capitale</button>
      </div>
      <div id="cp-tab-home">
        <div class="profilo-section">
          <h3 class="profilo-section-title">Eroi &amp; Famigli</h3>
          <div class="profilo-sub-group">
            <div class="profilo-sub-label">Eroi</div>
            <div id="cp-heroes" class="profilo-units-grid"></div>
          </div>
          <div class="profilo-sub-group" id="cp-pets-sec">
            <div class="profilo-sub-label">Famigli</div>
            <div id="cp-pets" class="profilo-units-grid"></div>
          </div>
        </div>
        <div class="profilo-section"><h3 class="profilo-section-title">Equipaggiamento Eroi</h3><div id="cp-equipment"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe</h3><div id="cp-troops" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Super Truppe</h3><div id="cp-super-troops" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Incantesimi</h3><div id="cp-spells" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Macchine d'Assedio</h3><div id="cp-siege" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Obiettivi Villaggio</h3><div id="cp-ach-home" class="profilo-achievements-list"></div></div>
      </div>
      <div id="cp-tab-builder" style="display:none">
        <div id="cp-bh-stats" class="profilo-bh-stats"></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Eroi Builder</h3><div id="cp-builder-heroes" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe Builder</h3><div id="cp-builder-units" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Obiettivi Builder</h3><div id="cp-builder-ach" class="profilo-achievements-list"></div></div>
      </div>
      <div id="cp-tab-capital" style="display:none">
        <div id="cp-capital-stats" class="profilo-bh-stats"></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe Capitale</h3><div id="cp-capital-troops" class="profilo-units-grid"></div></div>
      </div>`;

    renderPlayerView(p, 'cp');
  } catch(e) {
    container.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

function _switchCpTab(tab, btn) {
  ['home','builder','capital'].forEach(t=>{
    const el=document.getElementById(`cp-tab-${t}`);
    if(el) el.style.display=t===tab?'block':'none';
  });
  document.querySelectorAll('#cerca-player-content .subtab-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

// Reset stack quando si cambia tab
document.querySelectorAll('.tab-btn,.bnav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{ if(btn.dataset.tab==='cerca') _cercaStack=[{type:'search'}]; });
});

// ── CLASSIFICHE ──────────────────────────────────────────────────────────────
// `global` deve essere la stringa letterale richiesta dalla CoC API per il mondiale
const RANK_LOCATIONS = { global: 'global', italy: '32000094' };

let _rankType      = 'players'; // players | clans
let _rankLocaleId  = RANK_LOCATIONS.italy;
let _rankActiveBtnId = 'rank-btn-local';
let _rankLocations = null; // cache lista locations CoC API

function switchRankType(type) {
  _rankType = type;
  document.getElementById('rank-btn-players').classList.toggle('active', type==='players');
  document.getElementById('rank-btn-clans').classList.toggle('active', type==='clans');
  loadRankings();
}

function switchRankLocale(localeId, displayName, btnId) {
  if (!localeId) return;
  _rankLocaleId = localeId;
  document.querySelectorAll('#rank-controls .rank-geo-toggles .toggle-btn').forEach(b => b.classList.remove('active'));
  const sel = document.getElementById('rank-country-select');
  if (sel) {
    sel.classList.remove('rank-select--active');
    if (btnId === 'rank-btn-global' || btnId === 'rank-btn-local') sel.value = '';
  }
  _rankActiveBtnId = btnId || null;
  if (btnId) {
    const next = document.getElementById(btnId);
    if (next) next.classList.add('active');
  }
  loadRankings();
}

function switchRankLocaleFromSelect() {
  const sel = document.getElementById('rank-country-select');
  if (!sel || !sel.value) return;
  _rankLocaleId = sel.value;
  document.querySelectorAll('#rank-controls .rank-geo-toggles .toggle-btn').forEach(b => b.classList.remove('active'));
  sel.classList.add('rank-select--active');
  _rankActiveBtnId = null;
  loadRankings();
}

async function _initRankCountrySelect() {
  const sel = document.getElementById('rank-country-select');
  if (!sel || sel.dataset.ready === '1') return;
  sel.dataset.ready = '1';
  try {
    if (!_rankLocations) {
      const locR = await fetch('/api/lookup?type=locations');
      if (!locR.ok) return;
      const locData = await locR.json();
      _rankLocations = locData.items || [];
    }
    const items = (_rankLocations || []).filter(x => x.isCountry).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));
    sel.innerHTML = '<option value="">Altro paese…</option>' + items.map(x =>
      `<option value="${String(x.id).replace(/"/g, '')}">${String(x.name || x.id).replace(/</g, '')}</option>`
    ).join('');
    sel.addEventListener('change', () => {
      if (!sel.value) {
        sel.classList.remove('rank-select--active');
        switchRankLocale(RANK_LOCATIONS.italy, 'Italia', 'rank-btn-local');
        return;
      }
      switchRankLocaleFromSelect();
    });
  } catch (_) {}
}

async function loadRankings() {
  const el = document.getElementById('rankings-content');
  if (!el) return;
  await _initRankCountrySelect();
  el.innerHTML = '<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento classifica…</span></div>';
  const type = _rankType;
  try {
    const r = await fetch(`/api/lookup?type=rankings&rankType=${type}&locationId=${encodeURIComponent(_rankLocaleId)}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Errore API');
    const items = d.items || [];
    if (!items.length) { el.innerHTML = '<div class="profilo-empty"><p>Nessun dato disponibile.</p></div>'; return; }
    if (type === 'players') _renderRankPlayers(el, items);
    else _renderRankClans(el, items);
  } catch(e) {
    el.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

// ── GEOLOCALIZZAZIONE PAESE ───────────────────────────────────────────────────

async function _detectUserCountry() {
  try {
    // Step 1: rileva country code via IP
    const geoR = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
    if (!geoR.ok) return;
    const geo = await geoR.json();
    const countryCode = geo.country_code;
    const countryName = geo.country_name;
    if (!countryCode) return;

    // Step 2: ottieni lista locations CoC (con cache in memoria)
    if (!_rankLocations) {
      const locR = await fetch('/api/lookup?type=locations');
      if (!locR.ok) return;
      const locData = await locR.json();
      _rankLocations = locData.items || [];
    }

    // Step 3: trova la location CoC corrispondente al paese
    const match = _rankLocations.find(l => l.isCountry && l.countryCode === countryCode);
    if (!match) return;

    const btn = document.getElementById('rank-btn-local');
    if (!btn) return;
    btn.textContent = match.name || countryName || 'Paese';
    btn.dataset.locId = String(match.id);
    btn.style.display = '';

    const sel = document.getElementById('rank-country-select');
    const usingCustom = sel?.classList.contains('rank-select--active');
    const onGlobal = _rankActiveBtnId === 'rank-btn-global';
    if (usingCustom || onGlobal) return;

    _rankLocaleId = String(match.id);
    const tab = document.getElementById('tab-rankings');
    if (tab && tab.style.display !== 'none') loadRankings();
  } catch(_) {
    // Geolocalizzazione non disponibile — resta predefinito Italia
  }
}

// ── SHOW/HIDE area detail inline ─────────────────────────────────────────────

function _showRankDetail(which) {
  document.getElementById('rank-controls').style.display   = 'none';
  document.getElementById('rankings-content').style.display = 'none';
  document.getElementById('rank-detail-area').style.display = 'block';
  document.getElementById('rank-player-detail').style.display = which === 'player' ? 'block' : 'none';
  document.getElementById('rank-clan-detail').style.display   = which === 'clan'   ? 'block' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function _rankDetailBack() {
  document.getElementById('rank-detail-area').style.display  = 'none';
  document.getElementById('rank-controls').style.display     = '';
  document.getElementById('rankings-content').style.display  = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── PROFILO PLAYER INLINE ─────────────────────────────────────────────────────

async function openRankPlayer(playerTag) {
  _showRankDetail('player');
  const container = document.getElementById('rank-player-detail');
  container.innerHTML = '<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento profilo…</span></div>';
  try {
    const r = await fetch(`/api/lookup?type=player&playerTag=${encodeURIComponent(playerTag)}`);
    const p = await r.json();
    if (!r.ok) throw new Error(p.error || 'Errore');
    container.innerHTML = `
      <div id="rk-header-card" class="profilo-hero-card" data-player-tag="${p.tag}" data-player-name="${p.name.replace(/"/g,'&quot;')}"></div>
      <div class="subtab-bar">
        <button class="subtab-btn active" onclick="_switchRkTab('home',this)">Villaggio Base</button>
        <button class="subtab-btn" onclick="_switchRkTab('builder',this)">Base Costruttore</button>
        <button class="subtab-btn" onclick="_switchRkTab('capital',this)">Capitale</button>
      </div>
      <div id="rk-tab-home">
        <div class="profilo-section">
          <h3 class="profilo-section-title">Eroi &amp; Famigli</h3>
          <div class="profilo-sub-group">
            <div class="profilo-sub-label">Eroi</div>
            <div id="rk-heroes" class="profilo-units-grid"></div>
          </div>
          <div class="profilo-sub-group" id="rk-pets-sec">
            <div class="profilo-sub-label">Famigli</div>
            <div id="rk-pets" class="profilo-units-grid"></div>
          </div>
        </div>
        <div class="profilo-section"><h3 class="profilo-section-title">Equipaggiamento Eroi</h3><div id="rk-equipment"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe</h3><div id="rk-troops" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Super Truppe</h3><div id="rk-super-troops" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Incantesimi</h3><div id="rk-spells" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Macchine d'Assedio</h3><div id="rk-siege" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Obiettivi Villaggio</h3><div id="rk-ach-home" class="profilo-achievements-list"></div></div>
      </div>
      <div id="rk-tab-builder" style="display:none">
        <div id="rk-bh-stats" class="profilo-bh-stats"></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Eroi Builder</h3><div id="rk-builder-heroes" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe Builder</h3><div id="rk-builder-units" class="profilo-units-grid"></div></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Obiettivi Builder</h3><div id="rk-builder-ach" class="profilo-achievements-list"></div></div>
      </div>
      <div id="rk-tab-capital" style="display:none">
        <div id="rk-capital-stats" class="profilo-bh-stats"></div>
        <div class="profilo-section"><h3 class="profilo-section-title">Truppe Capitale</h3><div id="rk-capital-troops" class="profilo-units-grid"></div></div>
      </div>`;
    renderPlayerView(p, 'rk');
  } catch(e) {
    container.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

function _switchRkTab(tab, btn) {
  ['home','builder','capital'].forEach(t => {
    const el = document.getElementById(`rk-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#rank-player-detail .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── PROFILO CLAN INLINE ───────────────────────────────────────────────────────

async function openRankClan(tag) {
  _showRankDetail('clan');
  const container = document.getElementById('rank-clan-detail');
  container.innerHTML = '<div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento clan…</span></div>';
  try {
    const [infoR, membR] = await Promise.all([
      fetch(`/api/clan-info?clanTag=${encodeURIComponent(tag)}`),
      fetch(`/api/clan-members?clanTag=${encodeURIComponent(tag)}`),
    ]);
    const info  = await infoR.json();
    const membs = await membR.json();
    if (!infoR.ok) throw new Error(info.error || 'Clan non trovato');
    _renderRankClanDetail(info, membs.items || membs || [], tag, container);
  } catch(e) {
    container.innerHTML = `<div class="cerca-error">Errore: ${e.message}</div>`;
  }
}

function _renderRankClanDetail(info, members, clanTag, container) {
  const badge = info.badgeUrls?.medium || info.badgeUrls?.small || '';
  const typeLabel = CLAN_TYPE_LABELS[info.type] || '';
  container.innerHTML = `
    <div class="cc-header">
      ${badge?`<img src="${badge}" alt="" class="cc-badge">`:''}
      <div class="cc-info">
        <div class="cc-name">${info.name}</div>
        <div class="cc-tag mono">${info.tag}</div>
        <div class="cc-meta">
          <span class="badge badge-gold">Lv. ${info.clanLevel??'—'}</span>
          ${typeLabel?`<span class="badge badge-gray">${typeLabel}</span>`:''}
          ${_favBtn('clans', info.tag, info.name, badge)}
        </div>
        ${info.clanPoints?`<div style="font-size:0.8rem;color:var(--text-3)">🏆 ${info.clanPoints.toLocaleString('it')} trofei${info.location?.name?' · 📍 '+info.location.name:''}</div>`:''}
        ${info.warLeague?.name?`<div style="font-size:0.8rem;color:var(--gold-dim)">⚔️ ${info.warLeague.name}</div>`:''}
        ${info.description?`<div class="cc-desc">${info.description}</div>`:''}
      </div>
    </div>
    <div class="profilo-stats-row" style="margin-bottom:1.25rem">
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--gold)"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 13.17 10.33 12 8 12zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5C23 13.17 18.33 12 16 12z"/></svg>
        <span class="profilo-stat-val">${info.members??'—'}/50</span>
        <span class="profilo-stat-lbl">Membri</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:#f0a500"><path d="M7 3H4v5c0 1.5.8 2.8 2 3.6V13H4v2h16v-2h-2v-1.4c1.2-.8 2-2.1 2-3.6V3h-3V1H7v2z"/></svg>
        <span class="profilo-stat-val">${info.clanPoints??'—'}</span>
        <span class="profilo-stat-lbl">Trofei</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--green)"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>
        <span class="profilo-stat-val">${info.warWins??'—'}</span>
        <span class="profilo-stat-lbl">War Vinte</span>
      </div>
      <div class="profilo-stat">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:var(--blue)"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg>
        <span class="profilo-stat-val">${info.warWinStreak??'—'}</span>
        <span class="profilo-stat-lbl">Streak</span>
      </div>
    </div>
    <div class="subtab-bar">
      <button class="subtab-btn active" onclick="_switchRkClanTab('members',this)">Membri</button>
      <button class="subtab-btn" onclick="_switchRkClanTab('warlog',this)">War Classiche</button>
    </div>
    <div id="rk-cc-tab-members">${_renderRankMembersList(members, clanTag)}</div>
    <div id="rk-cc-tab-warlog" style="display:none"><div class="profilo-loading" style="display:flex"><div class="spinner"></div><span>Caricamento…</span></div></div>
  `;
  _loadCercaWarLog(clanTag, 'rk-cc-tab-warlog');
}

function _renderRankMembersList(members, clanTag) {
  if (!members || !members.length) return '<div class="profilo-empty"><p>Nessun membro trovato.</p></div>';
  const sorted = [...members].sort((a,b)=>{
    const ro={leader:0,coLeader:1,admin:2,member:3};
    return (ro[a.role]??3)-(ro[b.role]??3)||(b.trophies||0)-(a.trophies||0);
  });
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr>
      <th class="col-league">Lega</th>
      <th class="col-th-hdr">TH</th>
      <th>Giocatore</th>
      <th class="stat-cell">Trofei</th>
    </tr></thead>
    <tbody>${sorted.map(m=>{
      const lbHtml = rankLeagueBadgeHtml(m.league);
      const roleLabel = {leader:'Leader',coLeader:'Co-leader',admin:'Anziano',member:'Membro'}[m.role]||m.role||'';
      return `<tr class="cc-member-row" onclick="openRankPlayer('${m.tag.replace(/'/g,"\\'")}')">
        <td class="col-league">${lbHtml}</td>
        <td class="col-th-cell">${thImgV(m.townHallLevel)}</td>
        <td>
          <div style="font-weight:600">${m.name}</div>
          <div class="mono" style="font-size:0.7rem;color:var(--text-3)">${roleLabel}</div>
        </td>
        <td class="stat-cell">${(m.trophies||0).toLocaleString('it')} 🏆</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div></div>`;
}

function _switchRkClanTab(tab, btn) {
  ['members','warlog'].forEach(t => {
    const el = document.getElementById(`rk-cc-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#rank-clan-detail .subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function _renderRankPlayers(el, items) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Giocatore</th><th>Clan</th><th>Trofei</th><th>Att. vinti</th><th>Dif. vinte</th>
    </tr></thead>
    <tbody>
      ${items.map((p,i) => {
        const lbHtml = rankLeagueBadgeHtml(_rankingPlayerLeague(p));
        const cb = cocBadgeUrl(p.clan?.badgeUrls);
        const clanLabel = p.clan?.name || '—';
        const clanCell = cb
          ? `<div class="rank-clan-cell"><img src="${cb}" alt="" class="rank-clan-badge-img" loading="lazy" referrerpolicy="no-referrer" width="28" height="28" data-player-tag="${String(p.tag || '').replace(/"/g,'')}" onerror="this.outerHTML='<span class=\\'cdm-clan-badge-ph\\'>🛡️</span>'"><span>${clanLabel}</span></div>`
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
  _repairRankingClanBadges(el, items);
}

/**
 * Fallback anti-anomalia: i ranking possono arrivare con stemmi riciclati (bug/limitazione API).
 * Se gli URL badge unici sono meno dei clan distinti, carichiamo gli stemmi da /api/clan-info.
 */
async function _repairRankingClanBadges(container, items) {
  try {
    if (!container || !items || !items.length) return;
    const withClan = items.filter(p => p?.clan?.tag);
    if (withClan.length < 2) return;
    const clanTags = new Set(withClan.map(p => normClanTag(p.clan.tag)).filter(Boolean));
    const badgeSet = new Set(
      withClan.map(p => cocBadgeUrl(p?.clan?.badgeUrls)).filter(Boolean)
    );
    if (clanTags.size < 2 || badgeSet.size >= clanTags.size) return;

    const tagToBadge = {};
    const uniqueTags = [...clanTags].slice(0, 50);
    await Promise.all(
      uniqueTags.map(async (ct) => {
        try {
          const r = await fetch(`/api/clan-info?clanTag=${encodeURIComponent(ct)}`, { cache: 'no-store' });
          if (!r.ok) return;
          const d = await r.json();
          const bu = cocBadgeUrl(d?.badgeUrls);
          if (bu) tagToBadge[normClanTag(ct)] = bu;
        } catch (_) {}
      })
    );

    for (const p of items) {
      const ct = p?.clan?.tag ? normClanTag(p.clan.tag) : '';
      const fixed = ct && tagToBadge[ct];
      if (!fixed || !p.tag) continue;
      const escTag = String(p.tag).replace(/"/g, '');
      const img = container.querySelector(`img.rank-clan-badge-img[data-player-tag="${escTag}"]`);
      if (img) img.src = fixed;
    }
  } catch (_) {}
}

function _renderRankClans(el, items) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Clan</th><th>Membri</th><th>Trofei</th>
    </tr></thead>
    <tbody>
      ${items.map((c,i) => {
        const badge = cocBadgeUrl(c.badgeUrls);
        const rankClass = i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':'';
        return `<tr class="cc-member-row" onclick="openRankClan('${c.tag.replace(/'/g,"\\'")}')">
          <td class="stat-cell"><span class="rank-num ${rankClass}">${c.rank??i+1}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.4rem">
              ${badge?`<img src="${badge}" class="cerca-clan-badge" style="width:28px;height:28px" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=\\'cdm-clan-badge-ph\\'>🛡️</span>'">`:'' }
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

/* ═══════════════════════════════════════════════════════════════
   GUERRA CLASSICA LIVE  (banner + modale dentro Registri Guerre)
   ═══════════════════════════════════════════════════════════════ */

let _warLiveData = null;
let _warLiveCountdownTimer = null;

function parseCocTimeWeb(t) {
  if (!t) return null;
  const m = t.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
}

function _wlStateLabel(state) {
  if (state === 'preparation') return '🛡 Giorno di preparazione';
  if (state === 'inWar') return '⚔️ Giorno della battaglia';
  if (state === 'warEnded') return '🏁 Guerra terminata';
  return '';
}

function _wlStateLabelShort(state) {
  if (state === 'preparation') return 'Preparazione';
  if (state === 'inWar') return 'In guerra';
  if (state === 'warEnded') return 'Terminata';
  return '';
}

function escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function heroLevel(member, heroName) {
  if (!member || !member.heroes) return '—';
  const h = member.heroes.find(x => x.name === heroName);
  return h ? h.level : '—';
}

/** Fetches current war and populates the banner in wl-classic */
async function _checkWarLiveBanner() {
  const banner = document.getElementById('war-live-banner');
  if (!banner) return;
  try {
    const clanTag = window._userClanTag || '';
    const r = await fetch('/api/war-log?type=current' + (clanTag ? '&clanTag=' + encodeURIComponent(clanTag) : ''));
    const raw = await r.json();
    const data = raw.state ? raw : (raw.data || raw);
    if (!data || data.state === 'notInWar' || !data.state) {
      banner.style.display = 'none';
      _warLiveData = null;
      return;
    }
    _warLiveData = data;
    const us = data.clan || {}, them = data.opponent || {};
    const usBadge = us.badgeUrls?.small
      ? `<img src="${us.badgeUrls.small}" class="wlb-badge" alt="">`
      : '<span class="wlb-badge-ph">🛡️</span>';
    const themBadge = them.badgeUrls?.small
      ? `<img src="${them.badgeUrls.small}" class="wlb-badge" alt="">`
      : '<span class="wlb-badge-ph">🛡️</span>';

    const stateClass = data.state === 'preparation' ? 'wlb--prep' : data.state === 'inWar' ? 'wlb--battle' : 'wlb--ended';

    banner.className = `war-live-banner ${stateClass}`;
    banner.style.display = '';
    banner.innerHTML = `
      <div class="wlb-top">
        <span class="wlb-live-dot"></span>
        <strong>⚔️ War classica in corso</strong>
        <span class="wlb-state">${_wlStateLabel(data.state)}</span>
      </div>
      <div class="wlb-matchup">
        <div class="wlb-clan">
          ${usBadge}
          <span class="wlb-clan-name">${escH(us.name || '—')}</span>
        </div>
        <div class="wlb-vs">VS</div>
        <div class="wlb-clan">
          ${themBadge}
          <span class="wlb-clan-name">${escH(them.name || '—')}</span>
        </div>
      </div>
      <button class="btn-primary btn-sm wlb-detail-btn" onclick="openWarLiveModal()">Vedi dettagli war live</button>`;
  } catch (_) {
    banner.style.display = 'none';
  }
}

function _wlModalCountdown(data, el) {
  if (_warLiveCountdownTimer) clearInterval(_warLiveCountdownTimer);
  if (!el || !data) return;
  function update() {
    const now = Date.now();
    let target, label;
    if (data.state === 'preparation') {
      target = parseCocTimeWeb(data.startTime);
      label = 'Inizio guerra';
    } else if (data.state === 'inWar') {
      target = parseCocTimeWeb(data.endTime);
      label = 'Fine guerra';
    } else {
      el.textContent = '';
      return;
    }
    if (!target) { el.textContent = ''; return; }
    const diff = target.getTime() - now;
    if (diff <= 0) { el.textContent = label + ': terminato'; clearInterval(_warLiveCountdownTimer); return; }
    const h = Math.floor(diff / 3600000);
    const min = Math.floor((diff % 3600000) / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    el.textContent = label + ': ' + (h > 0 ? h + 'h ' : '') + min + 'm ' + sec + 's';
  }
  update();
  _warLiveCountdownTimer = setInterval(update, 1000);
}

function _wlWinProbability(data) {
  if (!data || data.state === 'preparation') return null;
  const us = data.clan, them = data.opponent;
  if (!us || !them) return null;
  const usStar = us.stars || 0, themStar = them.stars || 0;
  const teamSize = data.teamSize || 1;
  const diff = usStar - themStar;
  let pct = 50 + (diff / (teamSize * 3)) * 120;
  pct = Math.min(99, Math.max(1, Math.round(pct)));
  let cls = 'wl-wp-neutral', label;
  if (pct >= 70) { cls = 'wl-wp-win'; label = 'Probabile vittoria'; }
  else if (pct <= 30) { cls = 'wl-wp-loss'; label = 'Probabile sconfitta'; }
  else { label = 'In bilico'; }
  return { pct, cls, label };
}

function _wlMissingAttacksAlert(data) {
  if (!data || data.state !== 'inWar') return '';
  const endTime = parseCocTimeWeb(data.endTime);
  if (!endTime) return '';
  const hoursLeft = (endTime.getTime() - Date.now()) / 3600000;
  if (hoursLeft > 6) return '';
  const members = (data.clan && data.clan.members) || [];
  const maxAtk = data.attacksPerMember || 2;
  const missing = members.filter(m => (m.attacks ? m.attacks.length : 0) < maxAtk);
  if (!missing.length) return '';
  const urgency = hoursLeft < 2 ? 'wl-alert-urgent' : 'wl-alert-warn';
  return `<div class="wl-alert ${urgency}">
    ⚠️ <strong>${missing.length} giocator${missing.length===1?'e':'i'}</strong> con attacch${missing.length===1?'o':'i'} mancant${missing.length===1?'e':'i'} — ${Math.round(hoursLeft*10)/10}h rimaste
  </div>`;
}

/** Build player cards (us or them) for modal Panoramica.
 *  During preparation: roster only (TH + name).
 *  During inWar/warEnded: full attack detail cards like openClassicWarDetail. */
function _wlBuildPlayersHtml(data, side) {
  const sideData = side === 'us' ? data.clan : data.opponent;
  if (!sideData?.members?.length) return '<p class="wl-empty">Nessun dato.</p>';
  const members = [...sideData.members].sort((a, b) => a.mapPosition - b.mapPosition);
  const maxAtk = data.attacksPerMember || 2;
  const isPrep = data.state === 'preparation';

  // Build tag→{name, pos, thLevel} lookup from both sides for defender resolution
  const defMap = {};
  [...(data.clan?.members || []), ...(data.opponent?.members || [])].forEach(m => {
    defMap[m.tag] = { name: m.name, pos: m.mapPosition, thLevel: m.townhallLevel };
  });

  function starsRow(stars, max) { return '★'.repeat(stars) + '☆'.repeat(Math.max(0, max - stars)); }

  const cards = members.map(m => {
    const thN = String(m.townhallLevel || 1).padStart(2, '0');
    const thImg = `<img src="th/webp/level_${thN}.webp" class="wdm-th-img" alt="TH${m.townhallLevel}" loading="lazy">`;

    if (isPrep) {
      return `<div class="wdm-member-card">
        <div class="wdm-member-header">
          <span class="wdm-pos">${m.mapPosition ?? '—'}.</span>
          ${thImg}
          <span class="wdm-name">${escH(m.name)}</span>
        </div>
      </div>`;
    }

    const attacks = [...(m.attacks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const totalStars = attacks.reduce((s, a) => s + (a.stars ?? 0), 0);

    const atkRows = Array.from({ length: maxAtk }, (_, i) => {
      const a = attacks[i];
      if (!a) {
        return `<div class="wdm-atk-row">
          <span class="wdm-atk-label">Attacco ${i + 1}</span>
          <span class="wdm-atk-unused">Non utilizzato</span>
        </div>`;
      }
      const def = defMap[a.defenderTag];
      const defThN = def?.thLevel ? String(def.thLevel).padStart(2, '0') : null;
      const defThImg = defThN
        ? `<img src="th/webp/level_${defThN}.webp" class="wdm-atk-def-th" alt="TH${def.thLevel}" loading="lazy">`
        : '';
      const defLabel = def ? `${def.pos}. ${escH(def.name)}` : (a.defenderTag ?? '?');
      const destr = (a.destructionPercentage ?? 0).toFixed(0);
      const stars = a.stars ?? 0;
      const starsHtml = `<span class="wdm-star-row wdm-star-row--${stars > 0 ? 'hit' : 'miss'}">${starsRow(stars, 3)}</span>`;
      return `<div class="wdm-atk-row">
        <span class="wdm-atk-label">Attacco ${i + 1}</span>
        ${defThImg}
        <span class="wdm-atk-target">${defLabel}</span>
        <span class="wdm-atk-pct">${destr}%</span>
        ${starsHtml}
      </div>`;
    }).join('');

    const totalStarsHtml = `<span class="wdm-total-stars wdm-total-stars--${totalStars >= 5 ? 'great' : totalStars >= 3 ? 'good' : 'low'}">${totalStars}★</span>`;

    return `<div class="wdm-member-card">
      <div class="wdm-member-header">
        <span class="wdm-pos">${m.mapPosition ?? '—'}.</span>
        ${thImg}
        <span class="wdm-name">${escH(m.name)}</span>
        ${totalStarsHtml}
      </div>
      <div class="wdm-atk-list">${atkRows}</div>
    </div>`;
  }).join('');

  return cards;
}

/** Open war live detail modal — modeled after CWL detail modal */
async function openWarLiveModal() {
  document.getElementById('war-live-modal')?.remove();
  if (_warLiveCountdownTimer) { clearInterval(_warLiveCountdownTimer); _warLiveCountdownTimer = null; }

  let data = _warLiveData;
  if (!data) {
    try {
      const clanTag = window._userClanTag || '';
      const r = await fetch('/api/war-log?type=current' + (clanTag ? '&clanTag=' + encodeURIComponent(clanTag) : ''));
      const raw = await r.json();
      data = raw.state ? raw : (raw.data || raw);
      _warLiveData = data;
    } catch (_) { return; }
  }
  if (!data || data.state === 'notInWar' || !data.state) return;

  const us = data.clan || {}, them = data.opponent || {};
  const usBadge = us.badgeUrls?.small
    ? `<img src="${us.badgeUrls.small}" class="cdm-war-badge" alt="" loading="lazy">`
    : '<span class="cdm-war-badge-ph">🛡️</span>';
  const themBadge = them.badgeUrls?.small
    ? `<img src="${them.badgeUrls.small}" class="cdm-war-badge" alt="" loading="lazy">`
    : '<span class="cdm-war-badge-ph">🛡️</span>';

  // ── Panoramica panel ──
  const wp = _wlWinProbability(data);
  const alertHtml = _wlMissingAttacksAlert(data);
  let wpHtml = '';
  if (wp) {
    wpHtml = `<div class="wl-wp-bar-wrap">
      <div class="wl-wp-label ${wp.cls}">${wp.label} (${wp.pct}%)</div>
      <div class="wl-wp-bar"><div class="wl-wp-fill ${wp.cls}" style="width:${wp.pct}%"></div></div>
    </div>`;
  }
  const maxAtk = data.attacksPerMember || 2;
  const usTotal = (data.teamSize || 0) * maxAtk;

  const overviewHtml = `
    ${alertHtml}
    <div class="wl-vs-header">
      <div class="wl-vs-side">
        ${usBadge}
        <div class="wl-vs-name">${escH(us.name || '—')}</div>
        <div class="wl-vs-stars">⭐ ${us.stars || 0}</div>
        <div class="wl-vs-dest">${us.destructionPercentage != null ? us.destructionPercentage.toFixed(2) + '%' : '—'}</div>
        <div class="cdm-war-attacks">⚔ ${us.attacks || 0}/${usTotal}</div>
      </div>
      <div class="wl-vs-center">
        <div class="wl-vs-size">${data.teamSize || '?'}v${data.teamSize || '?'}</div>
        <div class="wl-vs-vs">VS</div>
      </div>
      <div class="wl-vs-side wl-vs-right">
        ${themBadge}
        <div class="wl-vs-name">${escH(them.name || '—')}</div>
        <div class="wl-vs-stars">⭐ ${them.stars || 0}</div>
        <div class="wl-vs-dest">${them.destructionPercentage != null ? them.destructionPercentage.toFixed(2) + '%' : '—'}</div>
        <div class="cdm-war-attacks">⚔ ${them.attacks || 0}/${usTotal}</div>
      </div>
    </div>
    ${wpHtml}`;

  const usPlayersHtml = _wlBuildPlayersHtml(data, 'us');
  const themPlayersHtml = _wlBuildPlayersHtml(data, 'them');

  // ── TH / Anteprima panel (same layout as CWL Anteprima) ──
  const usMembers = us.members || [], themMembers = them.members || [];
  const STATE_LABEL_PREV = { inWar:'In guerra', warStarted:'In guerra', preparation:'Preparazione', warEnded:'Terminata' };
  const stateLabel = STATE_LABEL_PREV[data.state] || data.state || '—';
  let countdownHtmlPrev = '';
  const startT = data.startTime ? parseCocTimeWeb(data.startTime) : null;
  const endT = data.endTime ? parseCocTimeWeb(data.endTime) : null;
  const nowT = Date.now();
  if (data.state === 'preparation' && startT) {
    const diff = startT - nowT;
    if (diff > 0) { const mm = Math.ceil(diff / 60000); countdownHtmlPrev = `<span class="prev-countdown">⏱ Inizio tra ${mm < 60 ? mm + ' min' : Math.floor(mm/60) + 'h ' + (mm%60) + 'm'}</span>`; }
  } else if (endT) {
    const diff = endT - nowT;
    if (diff > 0) { const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000); countdownHtmlPrev = `<span class="prev-countdown">⏱ Fine tra ${h}h ${m}m</span>`; }
  }

  function wlThComp(members) {
    if (!members?.length) return '<span style="color:var(--text-3)">—</span>';
    const counts = {};
    members.forEach(m => { const lv = m.townhallLevel || 0; if (lv) counts[lv] = (counts[lv] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => +b[0] - +a[0]);
    if (!entries.length) return '<span style="color:var(--text-3)">—</span>';
    const summaryText = entries.map(([lv, n]) => `TH${lv}: ${n}`).join(' · ');
    const grid = entries.map(([lv, n]) => {
      const thN = String(lv).padStart(2, '0');
      return `<div class="prev-th-item">${thImgV(+lv)}<span class="prev-th-count">${n} pl.</span></div>`;
    }).join('');
    return `<div class="prev-th-summary">${summaryText}</div><div class="prev-th-grid">${grid}</div>`;
  }

  const thHtml = `<div class="prev-state-bar">
      <span class="prev-state-label">${stateLabel}</span>
      ${countdownHtmlPrev}
      <span class="prev-size">👥 ${data.teamSize || '?'} vs ${data.teamSize || '?'}</span>
    </div>
    <div class="prev-war-split">
      <div class="prev-war-side prev-war-side--us">
        <div class="prev-side-header">${usBadge}<span>${escH(us.name || 'Noi')}</span></div>
        ${wlThComp(usMembers)}
        <div class="prev-score">⭐ ${us.stars ?? 0} &nbsp; 💥 ${us.destructionPercentage != null ? us.destructionPercentage.toFixed(1) + '%' : '0.0%'}</div>
      </div>
      <div class="prev-war-vs">VS</div>
      <div class="prev-war-side prev-war-side--opp">
        <div class="prev-side-header">${themBadge}<span>${escH(them.name || 'Avversario')}</span></div>
        ${wlThComp(themMembers)}
        <div class="prev-score">⭐ ${them.stars ?? 0} &nbsp; 💥 ${them.destructionPercentage != null ? them.destructionPercentage.toFixed(1) + '%' : '0.0%'}</div>
      </div>
    </div>`;

  // ── Confronto panel loaded async on tab switch ──
  const confrontoHtml = '<div class="profilo-loading" style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem"><div class="spinner"></div><span>Seleziona la scheda Confronto per caricare i dati.</span></div>';

  // ── Build modal ──
  const WL_ICO = {
    sync:    '<svg class="cdm-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5 0 1.13-.4 2.16-1.03 3l1.46 1.46A7.93 7.93 0 0 0 20 12c0-2.21-.9-4.22-2.35-5.65zM12 19c-2.76 0-5-2.24-5-5 0-1.13.4-2.16 1.03-3L6.57 9.54A7.93 7.93 0 0 0 4 12c0 3.31 2.69 6 6 6v3l5-5-5-5v3z"/></svg>',
    chart:   '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 13h2v8H3v-8zm8-6h2v14h-2V7zm8 4h2v10h-2V11z"/></svg>',
    eye:     '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5C21.3 7.6 17 4.5 12 4.5zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
    balance: '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>',
    sword:   '<svg class="cdm-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M14.5 2l1.4 1.4-4.3 4.3 2.1 2.1 4.3-4.3L19.5 7 9 17.5 6.5 20 4 17.5 6.5 15 16 5.5l-1.5-1.5 4-4zM7.2 18.3L8.8 19.9 7.1 21.6 5.5 20l1.7-1.7z"/></svg>',
  };

  const defaultTab = data.state === 'inWar' ? 'panoramica' : 'panoramica';

  const modal = document.createElement('div');
  modal.id = 'war-live-modal';
  modal.className = 'cdm-overlay';
  modal.innerHTML = `
    <div class="cdm-box wdm-box" onclick="event.stopPropagation()">
      <div class="cdm-header">
        <div class="cdm-header-left">
          <div>
            <div class="cdm-header-season">${WL_ICO.sword} War Classica Live</div>
            <div class="cdm-header-league" style="color:var(--text-3)">${_wlStateLabel(data.state)} — ${data.teamSize || '?'}v${data.teamSize || '?'}</div>
          </div>
        </div>
        <span id="wlm-countdown" class="wl-live-countdown" style="margin-left:auto;margin-right:0.5rem"></span>
        <button class="cdm-close" onclick="closeWarLiveModal()">✕</button>
      </div>
      <div class="cdm-modal-toolbar">
        <button type="button" class="btn-secondary btn-sm" onclick="refreshWarLiveModal()">${WL_ICO.sync} Aggiorna stato</button>
      </div>
      <div class="cdm-mtabs">
        <button type="button" class="cdm-mtab cdm-mtab--active" id="wlm-mtab-panoramica" onclick="_wlmSwitchTab('panoramica')">${WL_ICO.chart} Panoramica</button>
        <button type="button" class="cdm-mtab" id="wlm-mtab-th" onclick="_wlmSwitchTab('th')">${WL_ICO.eye} Anteprima</button>
        <button type="button" class="cdm-mtab" id="wlm-mtab-confronto" onclick="_wlmSwitchTab('confronto')">${WL_ICO.balance} Confronto</button>
      </div>

      <div id="wlm-panel-panoramica">
        ${overviewHtml}
        <div class="cdm-atk-switcher" style="margin-top:0.75rem">
          <button type="button" class="cdm-atk-sw-btn cdm-atk-sw-btn--active" id="wlm-players-btn-us" onclick="_wlmPlayerSwitch('us')">${escH(us.name || 'Noi')}</button>
          <button type="button" class="cdm-atk-sw-btn" id="wlm-players-btn-them" onclick="_wlmPlayerSwitch('them')">${escH(them.name || 'Avversario')}</button>
        </div>
        <div id="wlm-players-us">${usPlayersHtml}</div>
        <div id="wlm-players-them" style="display:none">${themPlayersHtml}</div>
      </div>

      <div id="wlm-panel-th" style="display:none">
        ${thHtml}
      </div>

      <div id="wlm-panel-confronto" style="display:none">
        ${confrontoHtml}
      </div>
    </div>`;

  modal.addEventListener('click', closeWarLiveModal);
  document.body.appendChild(modal);
  _wlmConfrontoLoaded = false;
  requestAnimationFrame(() => {
    modal.classList.add('cdm-overlay--visible');
    const cdEl = document.getElementById('wlm-countdown');
    if (cdEl) _wlModalCountdown(data, cdEl);
  });
}

function _wlmSwitchTab(tab) {
  const panels = ['panoramica', 'th', 'confronto'];
  panels.forEach(p => {
    const el = document.getElementById(`wlm-panel-${p}`);
    if (el) el.style.display = p === tab ? 'block' : 'none';
    const btn = document.getElementById(`wlm-mtab-${p}`);
    if (btn) btn.classList.toggle('cdm-mtab--active', p === tab);
  });
  if (tab === 'confronto' && !window._wlmConfrontoLoaded) _wlmLoadConfronto();
}

let _wlmConfrontoLoaded = false;

/** Async: load confronto panel with hero sums + planner */
async function _wlmLoadConfronto() {
  const panel = document.getElementById('wlm-panel-confronto');
  if (!panel || !_warLiveData) return;
  _wlmConfrontoLoaded = true;

  const data = _warLiveData;
  const us = data.clan || {}, them = data.opponent || {};
  const usMembers = [...(us.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const themMembers = [...(them.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const n = Math.max(usMembers.length, themMembers.length);
  const maxAtk = data.attacksPerMember || 2;

  panel.innerHTML = '<div class="profilo-loading" style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem"><div class="spinner"></div><span>Caricamento livelli eroi…</span></div>';

  // Fetch hero sums for all players
  const heroRows = [];
  for (let i = 0; i < n; i++) {
    const a = usMembers[i], b = themMembers[i];
    const hA = a ? await _getHeroLevelsSum(a.tag) : null;
    const hB = b ? await _getHeroLevelsSum(b.tag) : null;
    const thNA = a ? String(a.townhallLevel || 1).padStart(2,'0') : null;
    const thNB = b ? String(b.townhallLevel || 1).padStart(2,'0') : null;
    const thImgA = thNA ? `<img src="th/webp/level_${thNA}.webp" alt="TH${a.townhallLevel}" class="wl-th-icon" loading="lazy">` : '—';
    const thImgB = thNB ? `<img src="th/webp/level_${thNB}.webp" alt="TH${b.townhallLevel}" class="wl-th-icon" loading="lazy">` : '—';
    heroRows.push(`<tr>
      <td class="cdm-cf-pos">#${i + 1}</td>
      <td class="cdm-cf-th">${thImgA}</td>
      <td class="cdm-cf-name">${a ? escH(a.name) : '—'}</td>
      <td class="cdm-cf-hero">${hA != null ? hA : '—'}</td>
      <td class="cdm-cf-vs">vs</td>
      <td class="cdm-cf-pos">#${i + 1}</td>
      <td class="cdm-cf-th">${thImgB}</td>
      <td class="cdm-cf-name">${b ? escH(b.name) : '—'}</td>
      <td class="cdm-cf-hero">${hB != null ? hB : '—'}</td>
    </tr>`);
  }

  // Planner (CWL-style scoring — works in preparation + battle)
  const plannerHtml = _wlBuildPlanner(data, usMembers, themMembers, maxAtk);

  panel.innerHTML = `
    <div class="cdm-attacks-scroll"><table class="cdm-confronto-table">
      <thead><tr>
        <th>#</th><th>TH</th><th>Player</th><th>Σ eroi</th>
        <th class="cdm-cf-vs-th">vs</th>
        <th>#</th><th>TH</th><th>Player</th><th>Σ eroi</th>
      </tr></thead><tbody>${heroRows.join('')}</tbody>
    </table></div>
    <h4 style="margin:1rem 0 0.5rem;font-size:0.9rem;color:var(--text-1)">📋 Planner attacchi</h4>
    ${plannerHtml}`;
}

/** Ore rimanenti in guerra (solo inWar + endTime valido). */
function _wlWarHoursLeft(data) {
  if (data.state !== 'inWar' || !data.endTime) return null;
  const t = parseCocTimeWeb(data.endTime);
  if (!t) return null;
  const diff = t.getTime() - Date.now();
  return diff > 0 ? diff / 3600000 : 0;
}

/** Score planner (lower = migliore) — allineato a telegram-bot/lib/format.js */
function _wlPlannerScorePrimary(attackerTh, s) {
  const thDiff = Math.abs(attackerTh - (s.th ?? 0));
  return thDiff * 2 + (s.bestStars ?? 0) * 5 + (s.times ?? 0) * 3;
}
function _wlPlannerScoreSecondary(attackerTh, s) {
  let sc = _wlPlannerScorePrimary(attackerTh, s);
  if ((s.bestStars ?? 0) === 2) sc -= 10;
  return sc;
}

function _wlPlannerStarsHtml(targetStars, targetDestPct) {
  const starsHtml = targetStars >= 3
    ? '<span class="cdm-planner-stars cdm-stars-full">⭐⭐⭐</span>'
    : targetStars === 2
    ? '<span class="cdm-planner-stars">⭐⭐☆</span>'
    : targetStars === 1
    ? '<span class="cdm-planner-stars">⭐☆☆</span>'
    : '<span class="cdm-planner-stars cdm-stars-none">☆☆☆</span>';
  const destHint = targetStars > 0 ? ` <span class="cdm-planner-destr">${targetDestPct.toFixed(0)}%</span>` : '';
  return starsHtml + destHint;
}

/** Cinque celle: #, TH, nome, stelle, Δ TH — per un target planner */
function _wlPlannerTargetFiveCells(attacker, pick, themWarRank, emptyHint) {
  if (!pick?.opp) {
    const msg = emptyHint
      ? `<i>Nessuna base disponibile (${emptyHint})</i>`
      : '<i>Nessuna base</i>';
    return `<td class="cdm-cf-pos">—</td><td class="cdm-cf-th">—</td><td class="cdm-cf-name" style="color:var(--text-3)">${msg}</td><td class="cdm-planner-stars-cell">—</td><td>—</td>`;
  }
  const { s, opp } = pick;
  const targetStars = s.bestStars ?? 0;
  const targetDestPct = s.bestDest ?? 0;
  const thDelta = (attacker.townhallLevel || 0) - (s.th ?? opp.townhallLevel ?? 0);
  const deltaClass = thDelta >= 2 ? 'cdm-td-easy' : thDelta <= -2 ? 'cdm-td-hard' : 'cdm-td-fair';
  const deltaSign = thDelta > 0 ? '+' : '';
  const bThN = String(opp.townhallLevel || 1).padStart(2, '0');
  const bThImg = `<img src="th/webp/level_${bThN}.webp" alt="TH${opp.townhallLevel}" class="wl-th-icon" loading="lazy">`;
  return `<td class="cdm-cf-pos">#${themWarRank.get(opp.tag) ?? '?'}</td>
      <td class="cdm-cf-th">${bThImg}</td>
      <td class="cdm-cf-name">${escH(opp.name || '—')}</td>
      <td class="cdm-planner-stars-cell">${_wlPlannerStarsHtml(targetStars, targetDestPct)}</td>
      <td class="${deltaClass}">${deltaSign}${thDelta}</td>`;
}

/** Planner guerra classica — stessa logica del bot Telegram (primario + secondario condizionato). */
function _wlBuildPlanner(data, usMembers, themMembers, maxAtk) {
  const usWarRank = new Map(usMembers.map((m, i) => [m.tag, i + 1]));
  const themWarRank = new Map(themMembers.map((m, i) => [m.tag, i + 1]));

  const warStateRaw = data.state || '';
  const warState = warStateRaw === 'ended' ? 'warEnded' : warStateRaw;
  const atkPer = maxAtk || 2;

  const defStatus = {};
  for (const opp of themMembers) {
    const atksOnBase = usMembers.flatMap(m => (m.attacks || []).filter(a => a.defenderTag === opp.tag));
    const best = atksOnBase.reduce(
      (b, a) => (a.stars > b.stars || (a.stars === b.stars && a.destructionPercentage > b.destructionPercentage)) ? a : b,
      { stars: 0, destructionPercentage: 0 }
    );
    defStatus[opp.tag] = {
      pos: opp.mapPosition, name: opp.name, th: opp.townhallLevel,
      bestStars: best.stars, bestDest: best.destructionPercentage, times: atksOnBase.length,
    };
  }

  const totalWarMembers = usMembers.length || (data.teamSize ?? 0);
  const soglia = Math.floor(totalWarMembers / 2) + 1;
  const attackedCount = usMembers.filter(m => (m.attacks?.length ?? 0) >= 1).length;
  const mostrarSecondo = warState === 'inWar' && atkPer >= 2 && attackedCount >= soglia;

  const needAtk = usMembers.filter(m => (m.attacks?.length ?? 0) < atkPer);
  const openBases = themMembers.filter(opp => (defStatus[opp.tag]?.bestStars ?? 0) < 3);

  if (warState === 'warEnded') {
    return '<p class="wl-empty">🏁 Guerra terminata — nessun suggerimento (war chiusa).</p>';
  }

  if (!needAtk.length) {
    return '<p class="wl-empty">✅ Tutti gli attacchi sono stati usati.</p>';
  }

  let hint = '';
  if (warState === 'preparation') {
    hint = '<p class="wl-planner-hint" style="margin:0 0 .6rem;font-size:.82rem;color:var(--text-3)">🛡 Preparazione: solo target primari (1 per giocatore, esclusivi).</p>';
  } else if (warState === 'inWar' && !mostrarSecondo) {
    hint = '<p class="wl-planner-hint" style="margin:0 0 .6rem;font-size:.82rem;color:var(--text-3)">⚔️ Solo target primari finché non raggiunta la soglia sul 1° attacco.</p>';
  } else if (mostrarSecondo) {
    hint = `<p class="wl-planner-hint" style="margin:0 0 .6rem;font-size:.82rem;color:var(--text-3)">⚔️ Soglia 1° attacchi raggiunta (${attackedCount}/${totalWarMembers}, ≥${soglia}): anche target per il 2° attacco.</p>`;
  }

  const needOrder = [...needAtk].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const assignedPrimary = new Set();
  const primaryByTag = new Map();

  for (const m of needOrder) {
    const attackerTh = m.townhallLevel ?? 0;
    const available = openBases.filter(opp => !assignedPrimary.has(opp.tag));
    const scored = available
      .map(opp => {
        const s = defStatus[opp.tag];
        return { s, opp, score: _wlPlannerScorePrimary(attackerTh, s) };
      })
      .sort((a, b) => a.score - b.score || (a.s.pos ?? 99) - (b.s.pos ?? 99));
    const best = scored[0];
    if (best) {
      assignedPrimary.add(best.opp.tag);
      primaryByTag.set(m.tag, best);
    } else {
      primaryByTag.set(m.tag, null);
    }
  }

  const secondaryByTag = new Map();
  if (mostrarSecondo) {
    const hoursLeft = _wlWarHoursLeft(data);
    const timeGe4h = hoursLeft != null && hoursLeft >= 4;
    const excludedFromPool = new Set();
    if (timeGe4h) {
      for (const m of usMembers) {
        if ((m.attacks?.length ?? 0) !== 0) continue;
        const prim = primaryByTag.get(m.tag);
        if (prim?.opp?.tag) excludedFromPool.add(prim.opp.tag);
      }
    }
    const poolOpp = themMembers.filter(opp => {
      if ((defStatus[opp.tag]?.bestStars ?? 0) >= 3) return false;
      if (excludedFromPool.has(opp.tag)) return false;
      return true;
    });
    const needSecondary = needOrder.filter(m => (m.attacks?.length ?? 0) >= 1 && (m.attacks?.length ?? 0) < atkPer);
    const assignedSec = new Set();
    for (const m of needSecondary) {
      const attackerTh = m.townhallLevel ?? 0;
      const available = poolOpp.filter(opp => !assignedSec.has(opp.tag));
      const scored = available
        .map(opp => {
          const s = defStatus[opp.tag];
          return { s, opp, score: _wlPlannerScoreSecondary(attackerTh, s) };
        })
        .sort((a, b) => a.score - b.score || (a.s.pos ?? 99) - (b.s.pos ?? 99));
      const best = scored[0];
      if (best) {
        assignedSec.add(best.opp.tag);
        secondaryByTag.set(m.tag, best);
      } else {
        secondaryByTag.set(m.tag, null);
      }
    }
  }

  const showSecondCol = atkPer >= 2 && mostrarSecondo;
  const rows = [];
  for (const a of needAtk) {
    const missing = atkPer - (a.attacks?.length ?? 0);
    const prim = primaryByTag.get(a.tag);
    const aThN = String(a.townhallLevel || 1).padStart(2, '0');
    const aThImg = `<img src="th/webp/level_${aThN}.webp" alt="TH${a.townhallLevel}" class="wl-th-icon" loading="lazy">`;

    let secCells = '';
    if (showSecondCol) {
      const showSec = (a.attacks?.length ?? 0) >= 1 && (a.attacks?.length ?? 0) < atkPer;
      if (showSec) {
        const sec = secondaryByTag.get(a.tag);
        secCells = _wlPlannerTargetFiveCells(a, sec, themWarRank, '2° att.');
      } else {
        secCells = '<td class="cdm-cf-pos">—</td><td class="cdm-cf-th">—</td><td class="cdm-cf-name" style="color:var(--text-3)">—</td><td class="cdm-planner-stars-cell">—</td><td>—</td>';
      }
    }

    rows.push(`<tr>
      <td class="cdm-cf-pos">#${usWarRank.get(a.tag) ?? '?'}</td>
      <td class="cdm-cf-th">${aThImg}</td>
      <td class="cdm-cf-name">${escH(a.name)}</td>
      <td class="cdm-atk-arrow">→</td>
      ${_wlPlannerTargetFiveCells(a, prim, themWarRank)}
      ${showSecondCol ? secCells : ''}
      <td style="text-align:center">${missing}</td>
    </tr>`);
  }

  const headSecond = showSecondCol
    ? '<th>#</th><th></th><th>2° villaggio</th><th>Stelle</th><th>Δ TH</th>'
    : '';
  return `${hint}<div class="cdm-attacks-scroll"><table class="cdm-attacks-table cdm-planner-table"><thead><tr>
    <th>#</th><th></th><th>Attaccante</th>
    <th></th>
    <th>#</th><th></th><th>1° villaggio</th><th>Stelle</th><th>Δ TH</th>
    ${headSecond}
    <th>Atk</th>
  </tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function _wlmPlayerSwitch(side) {
  document.getElementById('wlm-players-us').style.display = side === 'us' ? 'block' : 'none';
  document.getElementById('wlm-players-them').style.display = side === 'them' ? 'block' : 'none';
  document.getElementById('wlm-players-btn-us').classList.toggle('cdm-atk-sw-btn--active', side === 'us');
  document.getElementById('wlm-players-btn-them').classList.toggle('cdm-atk-sw-btn--active', side === 'them');
}

function closeWarLiveModal() {
  if (_warLiveCountdownTimer) { clearInterval(_warLiveCountdownTimer); _warLiveCountdownTimer = null; }
  const modal = document.getElementById('war-live-modal');
  if (!modal) return;
  modal.classList.remove('cdm-overlay--visible');
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
}

async function refreshWarLiveModal() {
  _warLiveData = null;
  _wlmConfrontoLoaded = false;
  _cwlHeroLvlCache = {};
  await openWarLiveModal();
  await _checkWarLiveBanner();
}


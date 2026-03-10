const COC_CLAN_TAG = '%232J2VLPP9R';

const db = window.sb;

// Mappatura ruoli CoC API → etichette italiane
// Nota: nell'API CoC "admin" = Anziano (Elder), NON admin app
const COC_ROLES = {
    leader:   { label: 'Capo',      cls: 'role-leader' },
    coLeader: { label: 'Co-Capo',   cls: 'role-coleader' },
    admin:    { label: 'Anziano',   cls: 'role-elder' },
    member:   { label: 'Membro',    cls: 'role-member' }
};

const ROLE_ORDER = { leader: 0, coLeader: 1, admin: 2, member: 3 };

function cocRole(role) {
    return COC_ROLES[role] || { label: role || '—', cls: 'role-member' };
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

db.auth.onAuthStateChange((_event, session) => {
    if (session) showApp(session.user);
    else showLogin();
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.auth.signInWithPassword({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
    });
    if (error) showLoginError(error.message);
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.auth.signUp({
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value
    });
    if (error) showLoginError(error.message);
    else showLoginError('Controlla la tua email per confermare la registrazione.', 'info');
});

document.getElementById('show-signup').addEventListener('click', () => {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('show-signup').style.display = 'none';
    document.getElementById('signup-form').style.display = 'flex';
    document.getElementById('show-login').style.display = 'block';
    document.getElementById('login-error').style.display = 'none';
});

document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('show-login').style.display = 'none';
    document.getElementById('login-form').style.display = 'flex';
    document.getElementById('show-signup').style.display = 'block';
    document.getElementById('login-error').style.display = 'none';
});

document.getElementById('logout-btn').addEventListener('click', () => db.auth.signOut());

function showLoginError(msg, type = 'error') {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.className = type === 'info' ? 'info-msg' : 'error-msg';
    el.style.display = 'block';
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
}

function showApp(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('user-email').textContent = user.email;

    const isAdmin = user.user_metadata?.role === 'admin';
    if (isAdmin) {
        document.getElementById('user-role-badge').style.display = 'inline';
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline-block');
    }

    loadMembers();
}

// ── TABS ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(s => s.style.display = 'none');
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
        if (btn.dataset.tab === 'admin') loadUsers();
    });
});

// ── MEMBRI ────────────────────────────────────────────────────────────────────

async function loadMembers() {
    const { data } = await db.from('members').select('*').order('name');
    renderMembers(data || []);
}

function thImg(level) {
    if (!level) return '<span class="th-unknown">?</span>';
    const n = String(level).padStart(2, '0');
    return `<div class="th-cell">
        <img src="th/level_${n}.png" alt="TH${level}" class="th-img">
        <span class="th-label">TH${level}</span>
    </div>`;
}

function renderMembers(members) {
    const tbody = document.querySelector('#members-table tbody');
    tbody.innerHTML = '';
    const now = new Date();

    // Ordina: Capo → Co-Capo → Anziano → Membro, poi per TH desc, poi per nome
    members.sort((a, b) => {
        const ra = ROLE_ORDER[a.role] ?? 4;
        const rb = ROLE_ORDER[b.role] ?? 4;
        if (ra !== rb) return ra - rb;
        if ((b.th_level ?? 0) !== (a.th_level ?? 0)) return (b.th_level ?? 0) - (a.th_level ?? 0);
        return (a.name || '').localeCompare(b.name || '');
    });

    members.forEach(m => {
        const joinDate = m.first_seen ? new Date(m.first_seen) : now;
        const isNew = Math.floor((now - joinDate) / 86400000) < 7;
        const role = cocRole(m.role);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="th-col">${thImg(m.th_level)}</td>
            <td>
                <span class="member-name">${m.name}</span>
                ${isNew ? '<span class="new-badge">NUOVO</span>' : ''}
                <br><span class="tag-cell">${m.tag}</span>
            </td>
            <td><span class="role-badge ${role.cls}">${role.label}</span></td>
            <td class="stat-cell">${m.trophies ?? '—'}</td>
            <td class="stat-cell">${m.donations ?? '—'} / ${m.donations_received ?? '—'}</td>
            <td class="stat-cell">${m.clan_rank ?? '—'}</td>
            <td class="date-cell">${joinDate.toLocaleDateString('it-IT')}</td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('sync-btn').addEventListener('click', async () => {
    const status = document.getElementById('sync-status');
    status.textContent = 'Sincronizzazione in corso…';
    try {
        const res = await fetch('/api/sync-members');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Errore server');
        status.textContent = `✓ Sincronizzati ${data.synced} membri`;
        loadMembers();
    } catch (err) {
        status.textContent = '✗ ' + err.message;
    }
});

// ── CWL ────────────────────────────────────────────────────────────────────────

let cwlLiveData = null; // cache stats live

async function loadCwlHistory() {
    const { data } = await db.from('cwl_history')
        .select('*')
        .order('bonus_score', { ascending: false });
    return data || [];
}

function renderCwlTable(history, live) {
    const div = document.getElementById('bonus-results');

    // Mappa live per nome (approssimazione, idealmente per tag)
    const liveMap = {};
    if (live) live.forEach(p => { liveMap[p.name.toLowerCase()] = p; });

    // Dividi: attivi vs ex-player vs secondari
    const active    = history.filter(h => h.still_in_clan && !h.is_secondary);
    const exPlayers = history.filter(h => !h.still_in_clan);
    const secondary = history.filter(h => h.is_secondary);

    function buildRows(rows) {
        return rows.map((h, i) => {
            const lp = liveMap[h.player_name.toLowerCase()];
            const stars = lp ? lp.stars : '—';
            const destr = lp ? lp.destruction.toFixed(1) + '%' : '—';
            const atk   = lp ? `${lp.attacks_made}/${lp.attacks_required}` : '—';
            const participated = h.participated
                ? '<span class="cwl-yes">✓ Marzo</span>'
                : '<span class="cwl-no">✗</span>';
            const statusCls = !h.still_in_clan ? 'cwl-exmember' : '';
            return `<tr class="${statusCls}">
                <td class="stat-cell">${i + 1}</td>
                <td class="member-name">${h.player_name}</td>
                <td>${participated}</td>
                <td class="stat-cell">${stars}</td>
                <td class="stat-cell">${destr}</td>
                <td class="stat-cell">${atk}</td>
                <td class="stat-cell"><strong>${h.bonus_score}</strong></td>
            </tr>`;
        }).join('');
    }

    div.innerHTML = `
        <div class="table-wrap">
        <table id="cwl-table">
            <thead>
                <tr>
                    <th>#</th><th>Nome</th><th>CWL Marzo</th>
                    <th>⭐ Stelle</th><th>💥 Distruzione</th>
                    <th>⚔ Attacchi</th><th>Bonus</th>
                </tr>
            </thead>
            <tbody>
                ${buildRows(active)}
                ${exPlayers.length ? `
                    <tr class="cwl-section-row"><td colspan="7">Ex-Player</td></tr>
                    ${buildRows(exPlayers)}
                ` : ''}
                ${secondary.length ? `
                    <tr class="cwl-section-row"><td colspan="7">Account Secondari</td></tr>
                    ${buildRows(secondary)}
                ` : ''}
            </tbody>
        </table>
        </div>
    `;
}

document.getElementById('load-cwl-history').addEventListener('click', async () => {
    const btn = document.getElementById('load-cwl-history');
    btn.textContent = 'Caricamento…';
    const history = await loadCwlHistory();
    renderCwlTable(history, cwlLiveData);
    btn.textContent = 'Storico Marzo';
});

document.getElementById('fetch-cwl-live').addEventListener('click', async () => {
    const btn = document.getElementById('fetch-cwl-live');
    const status = document.getElementById('cwl-status');
    btn.textContent = 'Caricamento…';
    status.textContent = '';
    try {
        const res = await fetch('/api/cwl-stats');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.state === 'notInWar') {
            status.textContent = 'CWL non in corso al momento.';
            btn.textContent = 'Aggiorna da API CoC';
            return;
        }
        cwlLiveData = data.players;
        const season = data.season ? ` — Stagione ${data.season}` : '';
        status.textContent = `✓ Stats CWL live aggiornate${season}`;
        const history = await loadCwlHistory();
        renderCwlTable(history, cwlLiveData);
    } catch (err) {
        status.textContent = '✗ ' + err.message;
    }
    btn.textContent = 'Aggiorna da API CoC';
});

// ── ADMIN: GESTIONE UTENTI ────────────────────────────────────────────────────

async function loadUsers() {
    const msg = document.getElementById('admin-msg');
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '<tr><td colspan="4">Caricamento…</td></tr>';

    const res = await fetch('/api/admin/users');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        msg.textContent = err.error || 'Errore. Verifica SUPABASE_SERVICE_ROLE_KEY su Vercel.';
        msg.className = 'error-msg';
        msg.style.display = 'block';
        tbody.innerHTML = '';
        return;
    }

    const { users } = await res.json();
    msg.style.display = 'none';
    tbody.innerHTML = '';
    users.forEach(u => {
        const isAdmin = u.user_metadata?.role === 'admin';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.email}</td>
            <td>${isAdmin ? '<strong>Admin</strong>' : 'Utente'}</td>
            <td>${new Date(u.created_at).toLocaleDateString('it-IT')}</td>
            <td>
                <button onclick="toggleAdmin('${u.id}',${isAdmin})">${isAdmin ? 'Rimuovi Admin' : 'Rendi Admin'}</button>
                <button class="btn-danger" onclick="deleteUser('${u.id}')">Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleAdmin(userId, isAdmin) {
    await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: isAdmin ? '' : 'admin' })
    });
    loadUsers();
}

async function deleteUser(userId) {
    if (!confirm('Eliminare questo utente?')) return;
    await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    loadUsers();
}

document.getElementById('refresh-users').addEventListener('click', loadUsers);

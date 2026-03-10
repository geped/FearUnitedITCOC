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
  if (session) {
    showApp(session.user);
  } else {
    showLogin();
  }
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("email").value,
    password: document.getElementById("password").value,
  });
  if (error) showLoginError(error.message);
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

function showApp(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("user-email").textContent = user.email;

  const isAdmin = user.user_metadata?.role === "admin";
  if (isAdmin) {
    document.getElementById("user-role-badge").style.display = "inline";
    // Mostra elementi admin-only rispettando il tipo di elemento
    document.querySelectorAll(".admin-only").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      el.style.display =
        tag === "button" || tag === "span" ? "inline-block" : "block";
    });
    // Imposta la stagione bonus al mese corrente
    const seasonInput = document.getElementById("bonus-season");
    if (seasonInput) seasonInput.value = new Date().toISOString().slice(0, 7);
  }

  loadMembers();
}

// ── TABS ──────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((s) => (s.style.display = "none"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).style.display = "block";
    if (btn.dataset.tab === "admin") loadUsers();
  });
});

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
            <td class="stat-cell">${m.trophies ?? "—"}</td>
            <td class="stat-cell">${m.donations ?? "—"} / ${m.donations_received ?? "—"}</td>
            <td class="stat-cell">${m.clan_rank ?? "—"}</td>
            <td class="date-cell">${joinDate.toLocaleDateString("it-IT")}</td>
        `;
    tbody.appendChild(tr);
  });
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
    .from("cwl_history")
    .select("*")
    .order("bonus_score", { ascending: false });
  return data || [];
}

function renderCwlTable(history, live) {
  const div = document.getElementById("bonus-results");

  const liveMap = {};
  if (live)
    live.forEach((p) => {
      liveMap[p.name.toLowerCase()] = p;
    });

  const active = history.filter((h) => h.still_in_clan && !h.is_secondary);
  const exPlayers = history.filter((h) => !h.still_in_clan);
  const secondary = history.filter((h) => h.is_secondary);

  function buildRows(rows) {
    return rows
      .map((h, i) => {
        const lp = liveMap[h.player_name.toLowerCase()];
        const stars = lp ? lp.stars : h.stars != null ? h.stars : "—";
        const destr = lp
          ? lp.destruction.toFixed(1) + "%"
          : h.destruction
            ? h.destruction.toFixed(1) + "%"
            : "—";
        const atk = lp
          ? `${lp.attacks_made}/${lp.attacks_required}`
          : h.attacks_made
            ? `${h.attacks_made}/${h.attacks_required}`
            : "—";
        const participated = h.participated
          ? '<span class="cwl-yes">✓ CWL</span>'
          : '<span class="cwl-no">✗</span>';
        const statusCls = !h.still_in_clan ? "cwl-exmember" : "";
        const bonusBadge = h.bonus_assigned
          ? ' <span class="bonus-badge" title="Bonus assegnato">🏆</span>'
          : "";
        return `<tr class="${statusCls}">
                <td class="stat-cell">${i + 1}</td>
                <td class="member-name">${h.player_name}${bonusBadge}</td>
                <td>${participated}</td>
                <td class="stat-cell">${stars}</td>
                <td class="stat-cell">${destr}</td>
                <td class="stat-cell">${atk}</td>
                <td class="stat-cell"><strong>${h.bonus_score}</strong></td>
            </tr>`;
      })
      .join("");
  }

  div.innerHTML = `
        <div class="table-wrap">
        <table id="cwl-table">
            <thead>
                <tr>
                    <th>#</th><th>Nome</th><th>CWL</th>
                    <th>⭐ Stelle</th><th>💥 Distruzione</th>
                    <th>⚔ Attacchi</th><th>Score</th>
                </tr>
            </thead>
            <tbody>
                ${buildRows(active)}
                ${
                  exPlayers.length
                    ? `
                    <tr class="cwl-section-row"><td colspan="7">Ex-Player</td></tr>
                    ${buildRows(exPlayers)}
                `
                    : ""
                }
                ${
                  secondary.length
                    ? `
                    <tr class="cwl-section-row"><td colspan="7">Account Secondari</td></tr>
                    ${buildRows(secondary)}
                `
                    : ""
                }
            </tbody>
        </table>
        </div>
    `;
}

document
  .getElementById("load-cwl-history")
  .addEventListener("click", async () => {
    const btn = document.getElementById("load-cwl-history");
    btn.textContent = "Caricamento…";
    const history = await loadCwlHistory();
    renderCwlTable(history, cwlLiveData);
    btn.textContent = "Storico Marzo";
  });

document
  .getElementById("fetch-cwl-live")
  .addEventListener("click", async () => {
    const btn = document.getElementById("fetch-cwl-live");
    const status = document.getElementById("cwl-status");
    btn.textContent = "Caricamento…";
    status.textContent = "";
    try {
      const res = await fetch("/api/cwl-stats");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.state === "notInWar") {
        status.textContent = "CWL non in corso al momento.";
        btn.textContent = "Aggiorna da API CoC";
        return;
      }
      cwlLiveData = data.players;
      const season = data.season ? ` — Stagione ${data.season}` : "";
      status.textContent = `✓ Stats CWL live aggiornate${season}`;
      const history = await loadCwlHistory();
      renderCwlTable(history, cwlLiveData);
    } catch (err) {
      status.textContent = "✗ " + err.message;
    }
    btn.textContent = "Aggiorna da API CoC";
  });

// ── BONUS ASSIGNMENT ──────────────────────────────────────────────────────────

let bonusSelections = new Set();
let bonusCandidates = [];

document
  .getElementById("generate-bonus")
  .addEventListener("click", async () => {
    const season = document.getElementById("bonus-season").value;
    const count = parseInt(document.getElementById("bonus-count").value) || 6;
    const msg = document.getElementById("bonus-msg");

    if (!season) {
      msg.textContent = "⚠ Seleziona una stagione.";
      return;
    }

    msg.textContent = "Calcolo in corso…";
    bonusCandidates = [];
    bonusSelections = new Set();
    document.getElementById("bonus-player-list").innerHTML = "";

    if (cwlLiveData && cwlLiveData.length) {
      // ── Dati live: calcola merit score dalla formula ──
      bonusCandidates = cwlLiveData
        .filter((p) => p.attacks_made > 0)
        .map((p) => {
          const req = Math.max(p.attacks_required, 1);
          const made = p.attacks_made;
          const merit =
            (p.stars / req) * 40 +
            (p.destruction / made) * 0.2 +
            (made / req) * 20;
          return {
            player_name: p.name,
            merit: Math.round(merit * 10) / 10,
            stars: p.stars,
            destruction: p.destruction,
            attacks_made: made,
            attacks_required: req,
            participated: true,
            th_level: p.th_level,
          };
        });
      bonusCandidates.sort((a, b) => b.merit - a.merit);
      msg.textContent = `Dati live CWL. ${bonusCandidates.length} idonei. Auto-selezionati top ${Math.min(count, bonusCandidates.length)}.`;
    } else {
      // ── Dati storici dal DB ──
      const { data: history, error } = await db
        .from("cwl_history")
        .select("*")
        .eq("season", season)
        .eq("still_in_clan", true)
        .eq("is_secondary", false);

      if (error || !history?.length) {
        msg.textContent =
          "⚠ Nessun dato per questa stagione. Carica prima lo storico CWL o i dati live.";
        return;
      }

      bonusCandidates = history
        .filter((h) => h.participated)
        .map((h) => ({
          player_name: h.player_name,
          merit: h.bonus_score || 0,
          stars: h.stars || 0,
          destruction: h.destruction || 0,
          attacks_made: h.attacks_made || 0,
          attacks_required: h.attacks_required || 0,
          participated: true,
          bonus_assigned: h.bonus_assigned || false,
        }));
      bonusCandidates.sort((a, b) => b.merit - a.merit);
      msg.textContent = `Storico ${season}. ${bonusCandidates.length} partecipanti. Auto-selezionati top ${Math.min(count, bonusCandidates.length)}.`;
    }

    bonusSelections = new Set(
      bonusCandidates.slice(0, count).map((c) => c.player_name),
    );
    renderBonusPlayerList();
    document.getElementById("save-bonus").style.display = "inline-block";
  });

function renderBonusPlayerList() {
  const div = document.getElementById("bonus-player-list");
  if (!bonusCandidates.length) {
    div.innerHTML = "";
    return;
  }

  const rows = bonusCandidates
    .map((c, i) => {
      const checked = bonusSelections.has(c.player_name) ? "checked" : "";
      const topCls = i < 3 ? "bonus-top" : "";
      const atkStr =
        c.attacks_required > 0
          ? `${c.attacks_made}/${c.attacks_required}`
          : "—";
      const avgDestr =
        c.attacks_made > 0
          ? (c.destruction / c.attacks_made).toFixed(1) + "%"
          : "—";
      const merit = typeof c.merit === "number" ? c.merit.toFixed(1) : c.merit;
      return `<tr class="${topCls}">
            <td style="text-align:center">
                <input type="checkbox" data-name="${c.player_name}" ${checked}
                    onchange="toggleBonus('${c.player_name}', this.checked)">
            </td>
            <td class="member-name">${i + 1}. ${c.player_name}</td>
            <td class="stat-cell">${merit}</td>
            <td class="stat-cell">${c.stars}</td>
            <td class="stat-cell">${avgDestr}</td>
            <td class="stat-cell">${atkStr}</td>
        </tr>`;
    })
    .join("");

  div.innerHTML = `
        <div class="table-wrap" style="margin-top:0.75rem">
        <table>
            <thead>
                <tr>
                    <th style="width:40px;text-align:center">✓</th>
                    <th>Giocatore</th>
                    <th title="Merit score calcolato">Score</th>
                    <th>⭐</th>
                    <th>💥 avg</th>
                    <th>⚔</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
        <p style="margin-top:0.6rem;font-size:0.83rem;color:#5a7a98">
            Bonus selezionati: <strong id="bonus-count-display">${bonusSelections.size}</strong>
        </p>
    `;
}

function toggleBonus(playerName, checked) {
  if (checked) bonusSelections.add(playerName);
  else bonusSelections.delete(playerName);
  const display = document.getElementById("bonus-count-display");
  if (display) display.textContent = bonusSelections.size;
}

document.getElementById("save-bonus").addEventListener("click", async () => {
  const season = document.getElementById("bonus-season").value;
  const msg = document.getElementById("bonus-msg");

  if (!bonusCandidates.length) {
    msg.textContent = "⚠ Prima genera i suggerimenti.";
    return;
  }

  msg.textContent = "Salvataggio in corso…";

  const upsertData = bonusCandidates.map((c) => ({
    player_name: c.player_name,
    season,
    participated: c.participated ?? false,
    stars: Math.round(c.stars || 0),
    destruction: parseFloat((c.destruction || 0).toFixed(2)),
    attacks_made: c.attacks_made || 0,
    attacks_required: c.attacks_required || 0,
    bonus_score: Math.round(c.merit || 0),
    bonus_assigned: bonusSelections.has(c.player_name),
    still_in_clan: true,
    is_secondary: false,
  }));

  const { error } = await db
    .from("cwl_history")
    .upsert(upsertData, { onConflict: "player_name,season" });

  if (error) {
    msg.textContent = "✗ " + error.message;
    return;
  }

  const names = [...bonusSelections].join(", ");
  msg.textContent = `✓ ${bonusSelections.size} bonus assegnati per ${season}: ${names}`;
});

// ── ADMIN: GESTIONE UTENTI ────────────────────────────────────────────────────

async function loadUsers() {
  const msg = document.getElementById("admin-msg");
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = '<tr><td colspan="4">Caricamento…</td></tr>';

  const res = await fetch("/api/admin/users");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    msg.textContent =
      err.error || "Errore. Verifica SUPABASE_SERVICE_ROLE_KEY su Vercel.";
    msg.className = "error-msg";
    msg.style.display = "block";
    tbody.innerHTML = "";
    return;
  }

  const { users } = await res.json();
  msg.style.display = "none";
  tbody.innerHTML = "";
  users.forEach((u) => {
    const isAdmin = u.user_metadata?.role === "admin";
    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td>${u.email}</td>
            <td>${isAdmin ? "<strong>Admin</strong>" : "Utente"}</td>
            <td>${new Date(u.created_at).toLocaleDateString("it-IT")}</td>
            <td>
                <button onclick="toggleAdmin('${u.id}',${isAdmin})">${isAdmin ? "Rimuovi Admin" : "Rendi Admin"}</button>
                <button class="btn-danger" onclick="deleteUser('${u.id}')">Elimina</button>
            </td>
        `;
    tbody.appendChild(tr);
  });
}

async function toggleAdmin(userId, isAdmin) {
  await fetch("/api/admin/users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, role: isAdmin ? "" : "admin" }),
  });
  loadUsers();
}

async function deleteUser(userId) {
  if (!confirm("Eliminare questo utente?")) return;
  await fetch("/api/admin/users", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  loadUsers();
}

document.getElementById("refresh-users").addEventListener("click", loadUsers);

'use strict';

/**
 * Multi-profilo CoC — logica condivisa (Vercel API).
 * Compatibilità: sincronizza il profilo attivo in auth.users.user_metadata
 * così web/bot esistenti continuano a leggere coc_tag / role / clan.
 * Admin sito resta account-level (prefs.account_is_admin + metadata.account_is_admin).
 */

const { createClient } = require('@supabase/supabase-js');

const MAX_PROFILES = 10;

const COC_ROLE_MAP = {
  leader: 'capo',
  coLeader: 'co-capo',
  admin: 'anziano',
  member: 'membro',
};

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti.');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeTag(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const u = String(raw).trim().toUpperCase().replace(/^#+/, '');
  return u ? `#${u}` : null;
}

function mapClanRole(cocApiRole) {
  return COC_ROLE_MAP[cocApiRole] || 'membro';
}

function isAccountAdminFromUser(user, prefs) {
  if (prefs?.account_is_admin === true) return true;
  const meta = user?.user_metadata || {};
  if (meta.account_is_admin === true) return true;
  if (user?.app_metadata?.is_admin === true) return true;
  return String(meta.role || '').toLowerCase() === 'admin';
}

function profileToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    coc_tag: row.coc_tag,
    username: row.username,
    clan_role: row.clan_role,
    coc_clan_tag: row.coc_clan_tag,
    coc_clan_name: row.coc_clan_name,
    coc_clan_badge_url: row.coc_clan_badge_url,
    town_hall_level: row.town_hall_level != null ? Number(row.town_hall_level) : null,
    label: row.label || null,
    created_at: row.created_at,
    card_deck_public: row.card_deck_public === true,
  };
}

/**
 * Scrive metadata Auth allineati al profilo attivo senza perdere admin account.
 */
async function syncUserMetadata(admin, userId, profile, prefs, existingUser) {
  const user = existingUser || (await admin.auth.admin.getUserById(userId)).data?.user;
  if (!user) throw new Error('Utente Auth non trovato.');
  const prev = user.user_metadata || {};
  const accountAdmin = isAccountAdminFromUser(user, prefs);

  const nextMeta = {
    ...prev,
    account_is_admin: accountAdmin,
    username: profile?.username || prev.username || null,
    coc_tag: profile?.coc_tag || null,
    coc_clan_tag: profile?.coc_clan_tag || null,
    coc_clan_name: profile?.coc_clan_name || null,
    coc_clan_badge_url: profile?.coc_clan_badge_url || null,
    clan_role: profile?.clan_role || prev.clan_role || null,
    active_profile_id: profile?.id || null,
    // Compat: role usato da require-role / bot / web
    role: accountAdmin ? 'admin' : (profile?.clan_role || prev.role || 'utente'),
  };

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: nextMeta,
    ...(accountAdmin ? { app_metadata: { ...(user.app_metadata || {}), is_admin: true } } : {}),
  });
  if (error) throw error;
  return data?.user || user;
}

async function getPrefs(admin, userId) {
  const { data, error } = await admin
    .from('user_account_prefs')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function listProfiles(admin, userId) {
  const { data, error } = await admin
    .from('user_coc_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function upsertPrefs(admin, userId, patch) {
  const prev = await getPrefs(admin, userId);
  const row = {
    user_id: userId,
    active_profile_id: prev?.active_profile_id ?? null,
    default_profile_id: prev?.default_profile_id ?? null,
    always_ask_profile: prev?.always_ask_profile === true,
    mini_app_profile_id: prev?.mini_app_profile_id ?? null,
    account_is_admin: prev?.account_is_admin === true,
    created_at: prev?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  };
  const { data, error } = await admin
    .from('user_account_prefs')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Migrazione lazy: utenti legacy → 1 profilo da user_metadata.
 */
async function fetchLivePlayer(playerTag) {
  const proxyUrl = process.env.RENDER_PROXY_URL;
  if (!proxyUrl) return null;
  const tag = normalizeTag(playerTag);
  if (!tag) return null;
  try {
    const r = await fetch(`${proxyUrl}/player?playerTag=${encodeURIComponent(tag)}`, {
      headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Aggiorna un profilo (e opzionalmente metadata Auth) dai dati live CoC.
 */
async function refreshProfileRowFromLive(admin, profile, { syncMetaUser = null, prefs = null } = {}) {
  const player = await fetchLivePlayer(profile.coc_tag);
  if (!player?.tag) return profile;

  const patch = {
    username: player.name || profile.username,
    clan_role: mapClanRole(player.role),
    coc_clan_tag: normalizeTag(player.clan?.tag) || null,
    coc_clan_name: player.clan?.name || null,
    coc_clan_badge_url:
      player.clan?.badgeUrls?.medium || player.clan?.badgeUrls?.small || null,
    town_hall_level: Number(player.townHallLevel) || profile.town_hall_level || null,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error } = await admin
    .from('user_coc_profiles')
    .update(patch)
    .eq('id', profile.id)
    .select('*')
    .single();
  if (error) throw error;

  if (syncMetaUser) {
    await syncUserMetadata(admin, syncMetaUser.id, updated, prefs, syncMetaUser);
  }
  return updated || { ...profile, ...patch };
}

/**
 * Refresh live di tutti i profili; sincronizza metadata sull'attivo.
 */
async function refreshAllProfilesLive(admin, user, profiles, prefs) {
  const out = [];
  let active = null;
  const activeId = prefs?.active_profile_id || prefs?.default_profile_id || profiles[0]?.id;
  for (const p of profiles) {
    const isActive = p.id === activeId;
    try {
      const refreshed = await refreshProfileRowFromLive(admin, p, {
        syncMetaUser: isActive ? user : null,
        prefs,
      });
      out.push(refreshed);
      if (isActive) active = refreshed;
    } catch (e) {
      console.warn('[profiles] refresh live', p.coc_tag, e.message);
      out.push(p);
      if (isActive) active = p;
    }
  }
  return { profiles: out, active: active || out[0] || null };
}

async function ensureMigrated(admin, user) {
  const userId = user.id;
  let profiles = await listProfiles(admin, userId);
  let prefs = await getPrefs(admin, userId);
  const meta = user.user_metadata || {};
  const accountAdmin =
    String(meta.role || '').toLowerCase() === 'admin' ||
    meta.account_is_admin === true ||
    user.app_metadata?.is_admin === true;

  if (!profiles.length) {
    const tag = normalizeTag(meta.coc_tag);
    if (tag) {
      const clanRole =
        String(meta.role || '').toLowerCase() === 'admin'
          ? (meta.clan_role && ['capo', 'co-capo', 'anziano', 'membro', 'utente'].includes(meta.clan_role)
            ? meta.clan_role
            : 'membro')
          : (['capo', 'co-capo', 'anziano', 'membro', 'utente'].includes(String(meta.role || ''))
            ? meta.role
            : 'membro');
      const { data: inserted, error } = await admin
        .from('user_coc_profiles')
        .insert({
          user_id: userId,
          coc_tag: tag,
          username: meta.username || null,
          clan_role: clanRole,
          coc_clan_tag: normalizeTag(meta.coc_clan_tag),
          coc_clan_name: meta.coc_clan_name || null,
          coc_clan_badge_url: meta.coc_clan_badge_url || null,
        })
        .select('*')
        .single();
      if (error) {
        // Race / già creato da altro processo
        if (!String(error.message || '').includes('duplicate') && error.code !== '23505') {
          throw error;
        }
      } else if (inserted) {
        profiles = [inserted];
      } else {
        profiles = await listProfiles(admin, userId);
      }
    }
  }

  if (!prefs) {
    const first = profiles[0] || null;
    prefs = await upsertPrefs(admin, userId, {
      active_profile_id: first?.id || null,
      default_profile_id: first?.id || null,
      always_ask_profile: false,
      mini_app_profile_id: null,
      account_is_admin: accountAdmin,
    });
  } else if (accountAdmin && !prefs.account_is_admin) {
    prefs = await upsertPrefs(admin, userId, { account_is_admin: true });
  }

  // Allinea metadata se manca active_profile_id o coc_tag
  const active =
    profiles.find((p) => p.id === prefs.active_profile_id) ||
    profiles.find((p) => p.id === prefs.default_profile_id) ||
    profiles[0] ||
    null;

  if (active && (meta.active_profile_id !== active.id || normalizeTag(meta.coc_tag) !== normalizeTag(active.coc_tag))) {
    await syncUserMetadata(admin, userId, active, prefs, user);
  } else if (accountAdmin && meta.account_is_admin !== true) {
    await syncUserMetadata(admin, userId, active, prefs, user);
  }

  return { profiles, prefs, active };
}

function needsProfileSelection(prefs, profiles) {
  if (!profiles.length) return true;
  if (prefs?.always_ask_profile) return true;
  if (profiles.length === 1) return false;
  // 2+ profili: chiedi solo se non c'è un predefinito valido
  if (prefs?.default_profile_id) {
    return !profiles.some((p) => p.id === prefs.default_profile_id);
  }
  return true;
}

async function bootstrapForUser(user, opts = {}) {
  const admin = adminClient();
  let { profiles, prefs, active } = await ensureMigrated(admin, user);

  // Sempre aggiorna clan/ruolo live da CoC (evita clan vecchio in metadata)
  if (opts.skipLiveRefresh !== true && profiles.length) {
    try {
      const live = await refreshAllProfilesLive(admin, user, profiles, prefs);
      profiles = live.profiles;
      active = live.active;
      // Ricarica prefs (metadata può essere cambiato)
      prefs = (await getPrefs(admin, user.id)) || prefs;
    } catch (e) {
      console.warn('[profiles] bootstrap live refresh', e.message);
    }
  }

  const needs_selection = needsProfileSelection(prefs, profiles);
  return {
    ok: true,
    max_profiles: MAX_PROFILES,
    profiles: profiles.map(profileToPublic),
    prefs: {
      active_profile_id: prefs?.active_profile_id || null,
      default_profile_id: prefs?.default_profile_id || null,
      always_ask_profile: prefs?.always_ask_profile === true,
      mini_app_profile_id: prefs?.mini_app_profile_id || null,
      account_is_admin: prefs?.account_is_admin === true,
    },
    active: profileToPublic(active),
    needs_selection,
  };
}

async function switchActiveProfile(user, profileId, opts = {}) {
  const admin = adminClient();
  const { profiles, prefs } = await ensureMigrated(admin, user);
  let target = profiles.find((p) => p.id === profileId);
  if (!target) {
    const err = new Error('Profilo non trovato.');
    err.status = 404;
    throw err;
  }

  // Refresh live prima di attivare
  try {
    target = await refreshProfileRowFromLive(admin, target);
  } catch (e) {
    console.warn('[profiles] switch live refresh', e.message);
  }

  // Solo allinea metadata Auth (es. Mini App dedicata) senza cambiare profilo attivo salvato
  if (opts.metadataOnly === true) {
    const updatedUser = await syncUserMetadata(admin, user.id, target, prefs, user);
    return {
      ok: true,
      active: profileToPublic(target),
      prefs: {
        active_profile_id: prefs.active_profile_id,
        default_profile_id: prefs.default_profile_id,
        always_ask_profile: prefs.always_ask_profile === true,
        mini_app_profile_id: prefs.mini_app_profile_id,
        account_is_admin: prefs.account_is_admin === true,
      },
      user_metadata: updatedUser?.user_metadata || null,
      metadata_only: true,
    };
  }

  const patch = { active_profile_id: target.id };
  if (opts.setDefault === true) {
    patch.default_profile_id = target.id;
    patch.always_ask_profile = false;
  }
  if (opts.clearAlwaysAsk === true) {
    patch.always_ask_profile = false;
  }
  const nextPrefs = await upsertPrefs(admin, user.id, patch);
  const updatedUser = await syncUserMetadata(admin, user.id, target, nextPrefs, user);

  // Aggiorna player_tag sulle sessioni Telegram dell'utente (non tocca clan_tag override)
  await admin
    .from('telegram_links')
    .update({ player_tag: target.coc_tag, updated_at: new Date().toISOString() })
    .eq('supabase_user_id', user.id);

  return {
    ok: true,
    active: profileToPublic(target),
    prefs: {
      active_profile_id: nextPrefs.active_profile_id,
      default_profile_id: nextPrefs.default_profile_id,
      always_ask_profile: nextPrefs.always_ask_profile === true,
      mini_app_profile_id: nextPrefs.mini_app_profile_id,
      account_is_admin: nextPrefs.account_is_admin === true,
    },
    user_metadata: updatedUser?.user_metadata || null,
  };
}

async function setDefaultProfile(user, profileIdOrNull) {
  const admin = adminClient();
  const { profiles, prefs } = await ensureMigrated(admin, user);
  let defaultId = null;
  if (profileIdOrNull) {
    const target = profiles.find((p) => p.id === profileIdOrNull);
    if (!target) {
      const err = new Error('Profilo non trovato.');
      err.status = 404;
      throw err;
    }
    defaultId = target.id;
  }
  const nextPrefs = await upsertPrefs(admin, user.id, {
    default_profile_id: defaultId,
    always_ask_profile: defaultId ? false : prefs.always_ask_profile,
  });
  return { ok: true, prefs: nextPrefs };
}

async function setAlwaysAsk(user, alwaysAsk) {
  const admin = adminClient();
  await ensureMigrated(admin, user);
  const nextPrefs = await upsertPrefs(admin, user.id, {
    always_ask_profile: alwaysAsk === true,
    ...(alwaysAsk === true ? { default_profile_id: null } : {}),
  });
  return { ok: true, prefs: nextPrefs };
}

async function setMiniAppProfile(user, profileIdOrNull) {
  const admin = adminClient();
  const { profiles } = await ensureMigrated(admin, user);
  let miniId = null;
  if (profileIdOrNull) {
    const target = profiles.find((p) => p.id === profileIdOrNull);
    if (!target) {
      const err = new Error('Profilo non trovato.');
      err.status = 404;
      throw err;
    }
    miniId = target.id;
  }
  const nextPrefs = await upsertPrefs(admin, user.id, { mini_app_profile_id: miniId });
  return { ok: true, prefs: nextPrefs };
}

/**
 * Aggiunge un profilo a un utente già autenticato (verifica token CoC già fatta dal caller).
 * @param {object} player - oggetto player CoC API
 */
async function addProfileForUser(user, player) {
  const admin = adminClient();
  const { profiles, prefs } = await ensureMigrated(admin, user);
  if (profiles.length >= MAX_PROFILES) {
    const err = new Error(`Hai raggiunto il massimo di ${MAX_PROFILES} profili.`);
    err.status = 400;
    throw err;
  }
  const playerTag = normalizeTag(player?.tag);
  if (!playerTag) {
    const err = new Error('Tag giocatore non valido.');
    err.status = 400;
    throw err;
  }

  const { data: existingTag } = await admin
    .from('user_coc_profiles')
    .select('id, user_id')
    .eq('coc_tag', playerTag)
    .maybeSingle();
  if (existingTag) {
    const err = new Error(
      existingTag.user_id === user.id
        ? 'Questo villaggio è già collegato al tuo account.'
        : 'Questo tag è già associato a un altro account CoCBoard.',
    );
    err.status = 409;
    throw err;
  }

  const clanRole = mapClanRole(player.role);
  const insertRow = {
    user_id: user.id,
    coc_tag: playerTag,
    username: player.name || null,
    clan_role: clanRole,
    coc_clan_tag: normalizeTag(player.clan?.tag) || null,
    coc_clan_name: player.clan?.name || null,
    coc_clan_badge_url:
      player.clan?.badgeUrls?.medium || player.clan?.badgeUrls?.small || null,
  };
  const { data: created, error } = await admin
    .from('user_coc_profiles')
    .insert(insertRow)
    .select('*')
    .single();
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }

  // Se era il primo profilo (edge), o nessun attivo → attiva
  let nextPrefs = prefs;
  if (!prefs?.active_profile_id) {
    nextPrefs = await upsertPrefs(admin, user.id, {
      active_profile_id: created.id,
      default_profile_id: prefs?.default_profile_id || created.id,
    });
    await syncUserMetadata(admin, user.id, created, nextPrefs, user);
  } else if (profiles.length >= 1) {
    // Dal 2° profilo in poi: togli predefinito così al prossimo login si sceglie
    // (salvo che l'utente abbia già impostato always_ask o un default esplicito dopo)
    nextPrefs = await upsertPrefs(admin, user.id, {
      default_profile_id: null,
      always_ask_profile: false,
    });
  }

  return { ok: true, profile: profileToPublic(created), count: profiles.length + 1 };
}

/**
 * Crea il primo profilo subito dopo register-with-coc (createUser).
 */
async function createInitialProfileForNewUser(userId, player, opts = {}) {
  const admin = adminClient();
  const playerTag = normalizeTag(player?.tag);
  const clanRole = mapClanRole(player.role);
  const { data: created, error } = await admin
    .from('user_coc_profiles')
    .insert({
      user_id: userId,
      coc_tag: playerTag,
      username: player.name || null,
      clan_role: clanRole,
      coc_clan_tag: normalizeTag(player.clan?.tag) || null,
      coc_clan_name: player.clan?.name || null,
      coc_clan_badge_url:
        player.clan?.badgeUrls?.medium || player.clan?.badgeUrls?.small || null,
    })
    .select('*')
    .single();
  if (error) throw error;

  const prefs = await upsertPrefs(admin, userId, {
    active_profile_id: created.id,
    default_profile_id: created.id,
    always_ask_profile: false,
    mini_app_profile_id: null,
    account_is_admin: opts.accountIsAdmin === true,
  });

  return { profile: created, prefs };
}

async function removeProfile(user, profileId) {
  const admin = adminClient();
  const { profiles, prefs } = await ensureMigrated(admin, user);
  const target = profiles.find((p) => p.id === profileId);
  if (!target) {
    const err = new Error('Profilo non trovato.');
    err.status = 404;
    throw err;
  }
  if (profiles.length <= 1) {
    const err = new Error(
      'Non puoi scollegare l’unico profilo. Per rimuoverlo elimina l’intero account CoCBoard.',
    );
    err.status = 400;
    err.code = 'LAST_PROFILE';
    throw err;
  }
  if (prefs.default_profile_id === profileId) {
    const err = new Error(
      'Questo è il profilo predefinito. Imposta prima un altro predefinito (o “Chiedi sempre”), poi scollegalo.',
    );
    err.status = 400;
    err.code = 'IS_DEFAULT';
    throw err;
  }

  const { error } = await admin.from('user_coc_profiles').delete().eq('id', profileId).eq('user_id', user.id);
  if (error) throw error;

  let nextPrefs = prefs;
  if (prefs.active_profile_id === profileId) {
    const fallback =
      profiles.find((p) => p.id === prefs.default_profile_id && p.id !== profileId) ||
      profiles.find((p) => p.id !== profileId);
    nextPrefs = await upsertPrefs(admin, user.id, { active_profile_id: fallback?.id || null });
    if (fallback) await syncUserMetadata(admin, user.id, fallback, nextPrefs, user);
  }

  return { ok: true, removed_id: profileId };
}

/**
 * Wipe account: profili, prefs, sessioni telegram_links dell'utente, Auth user.
 * Non tocca telegram_chat_links dei gruppi (restano sul clan); azzera solo linked_by_profile_id.
 */
async function deleteAccountWipe(user) {
  const admin = adminClient();
  const userId = user.id;

  const profiles = await listProfiles(admin, userId);
  const ids = profiles.map((p) => p.id);
  if (ids.length) {
    await admin.from('telegram_chat_links').update({ linked_by_profile_id: null }).in('linked_by_profile_id', ids);
  }

  await admin.from('user_account_prefs').delete().eq('user_id', userId);
  await admin.from('user_coc_profiles').delete().eq('user_id', userId);
  await admin.from('telegram_links').delete().eq('supabase_user_id', userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
  return { ok: true, wiped: true };
}

/**
 * Risolve email Auth interna da username o #tag (qualsiasi profilo collegato).
 */
async function resolveLoginEmailFromInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (s.includes('@')) return s.toLowerCase();

  const admin = adminClient();
  const asTag = s.startsWith('#') ? normalizeTag(s) : normalizeTag(`#${s}`);

  // 1) Match diretto su profilo
  if (asTag) {
    const { data: byTag } = await admin
      .from('user_coc_profiles')
      .select('user_id')
      .eq('coc_tag', asTag)
      .maybeSingle();
    if (byTag?.user_id) {
      const { data: u } = await admin.auth.admin.getUserById(byTag.user_id);
      if (u?.user?.email) return u.user.email;
    }
  }

  // 2) Fallback sintetico (primo villaggio / username) — come legacy
  if (s.startsWith('#')) {
    return s.slice(1).toLowerCase() + '@cocboard.internal';
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_') + '@cocboard.internal';
}

async function getUserFromJwt(token) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase anon non configurato.');
  const sb = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error('Token non valido o scaduto.');
    err.status = 401;
    throw err;
  }
  return data.user;
}

function bearerFromReq(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
}

module.exports = {
  MAX_PROFILES,
  COC_ROLE_MAP,
  normalizeTag,
  mapClanRole,
  adminClient,
  isAccountAdminFromUser,
  profileToPublic,
  syncUserMetadata,
  ensureMigrated,
  needsProfileSelection,
  bootstrapForUser,
  switchActiveProfile,
  setDefaultProfile,
  setAlwaysAsk,
  setMiniAppProfile,
  addProfileForUser,
  createInitialProfileForNewUser,
  removeProfile,
  deleteAccountWipe,
  resolveLoginEmailFromInput,
  getUserFromJwt,
  bearerFromReq,
  refreshProfileRowFromLive,
  refreshAllProfilesLive,
  fetchLivePlayer,
  listProfiles,
  getPrefs,
};

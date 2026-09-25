'use strict';

/**
 * Progresso villaggio — CRUD snapshot privati + ownership.
 */

const profilesUtil = require('./user-profiles');
const { parseVillageExport } = require('./village-progress-parser');
const { calculateProgress } = require('./village-progress-calc');
const { loadDataset } = require('./village-progress-dataset');

const MAX_SNAPSHOTS_PER_TAG = 12;

function metaFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    coc_tag: row.coc_tag,
    profile_id: row.profile_id,
    game_timestamp: row.game_timestamp,
    th_level: row.th_level,
    bh_level: row.bh_level,
    dataset_version: row.dataset_version,
    source: row.source,
    created_at: row.created_at,
    summary: row.summary,
  };
}

async function resolveOwnedProfile(admin, user, cocTag) {
  const tag = profilesUtil.normalizeTag(cocTag);
  if (!tag) {
    const e = new Error('Tag giocatore non valido.');
    e.status = 400;
    throw e;
  }
  const profiles = await profilesUtil.listProfiles(admin, user.id);
  const profile = profiles.find((p) => profilesUtil.normalizeTag(p.coc_tag) === tag);
  if (!profile) {
    const e = new Error('Questo tag non è collegato al tuo account CoCBoard.');
    e.status = 403;
    throw e;
  }
  return profile;
}

async function listSnapshots(admin, user, cocTag) {
  const profiles = await profilesUtil.listProfiles(admin, user.id);
  if (!profiles.length) return { ok: true, profiles: [], snapshots: [], latest: null };

  let tags = profiles.map((p) => p.coc_tag);
  if (cocTag) {
    const profile = await resolveOwnedProfile(admin, user, cocTag);
    tags = [profile.coc_tag];
  }

  const { data, error } = await admin
    .from('village_progress_snapshots')
    .select(
      'id, user_id, profile_id, coc_tag, game_timestamp, th_level, bh_level, summary, dataset_version, source, created_at'
    )
    .eq('user_id', user.id)
    .in('coc_tag', tags)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const snapshots = (data || []).map(metaFromRow);
  return {
    ok: true,
    profiles: profiles.map(profilesUtil.profileToPublic),
    snapshots,
    latest: snapshots[0] || null,
    dataset_version: loadDataset().version,
  };
}

async function getSnapshot(admin, user, snapshotId, { includeRaw = false } = {}) {
  if (!snapshotId) {
    const e = new Error('id obbligatorio.');
    e.status = 400;
    throw e;
  }
  const cols = includeRaw
    ? '*'
    : 'id, user_id, profile_id, coc_tag, game_timestamp, th_level, bh_level, summary, dataset_version, source, created_at';
  const { data, error } = await admin
    .from('village_progress_snapshots')
    .select(cols)
    .eq('id', snapshotId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const e = new Error('Snapshot non trovato.');
    e.status = 404;
    throw e;
  }
  const out = metaFromRow(data);
  if (includeRaw) out.raw_json = data.raw_json;
  return { ok: true, snapshot: out };
}

async function pruneOld(admin, userId, cocTag) {
  const { data, error } = await admin
    .from('village_progress_snapshots')
    .select('id')
    .eq('user_id', userId)
    .eq('coc_tag', cocTag)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length <= MAX_SNAPSHOTS_PER_TAG) return;
  const toDelete = rows.slice(MAX_SNAPSHOTS_PER_TAG).map((r) => r.id);
  if (!toDelete.length) return;
  const { error: delErr } = await admin.from('village_progress_snapshots').delete().in('id', toDelete);
  if (delErr) throw delErr;
}

async function importExport(admin, user, rawInput) {
  const parsed = parseVillageExport(rawInput);
  const profile = await resolveOwnedProfile(admin, user, parsed.tag);
  const summary = calculateProgress(parsed);
  const ds = loadDataset();

  const row = {
    user_id: user.id,
    profile_id: profile.id,
    coc_tag: profile.coc_tag,
    game_timestamp: parsed.gameTimestamp,
    th_level: summary.th_level,
    bh_level: summary.bh_level,
    raw_json: parsed.raw,
    summary,
    dataset_version: ds.version,
    source: 'in_game_export',
  };

  const { data, error } = await admin
    .from('village_progress_snapshots')
    .insert(row)
    .select(
      'id, user_id, profile_id, coc_tag, game_timestamp, th_level, bh_level, summary, dataset_version, source, created_at'
    )
    .single();

  if (error) {
    if (error.code === '23505') {
      const e = new Error('Questo export è già stato importato (stesso timestamp di gioco).');
      e.status = 409;
      e.code = 'duplicate_export';
      throw e;
    }
    throw error;
  }

  await pruneOld(admin, user.id, profile.coc_tag);
  return { ok: true, snapshot: metaFromRow(data) };
}

async function deleteSnapshot(admin, user, snapshotId) {
  if (!snapshotId) {
    const e = new Error('id obbligatorio.');
    e.status = 400;
    throw e;
  }
  const { data, error } = await admin
    .from('village_progress_snapshots')
    .delete()
    .eq('id', snapshotId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const e = new Error('Snapshot non trovato.');
    e.status = 404;
    throw e;
  }
  return { ok: true, deleted: data.id };
}

/** Solo calcolo in-memory (utile test / preview senza DB). */
function previewExport(rawInput) {
  const parsed = parseVillageExport(rawInput);
  const summary = calculateProgress(parsed);
  return {
    ok: true,
    tag: parsed.tag,
    game_timestamp: parsed.gameTimestamp,
    summary,
  };
}

module.exports = {
  listSnapshots,
  getSnapshot,
  importExport,
  deleteSnapshot,
  previewExport,
  resolveOwnedProfile,
  MAX_SNAPSHOTS_PER_TAG,
};

'use strict';

/**
 * Client profili multi-CoC verso /api/lookup (Vercel).
 * Usato dal bot Telegram dopo login.
 */

function apiBase() {
  const b = process.env.COCBOARD_API_BASE;
  if (!b || !String(b).trim()) throw new Error('COCBOARD_API_BASE non configurata.');
  return String(b).replace(/\/$/, '');
}

async function callProfiles(type, accessToken, { method = 'GET', body = null } = {}) {
  const url = new URL('/api/lookup', apiBase() + '/');
  url.searchParams.set('type', type);
  const opts = {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(25000),
  };
  if (body != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url.href, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = data.code;
    err.body = data;
    throw err;
  }
  return data;
}

async function bootstrap(accessToken) {
  return callProfiles('profiles-bootstrap', accessToken, { method: 'GET' });
}

async function switchProfile(accessToken, profileId, opts = {}) {
  return callProfiles('profiles-switch', accessToken, {
    method: 'POST',
    body: {
      profile_id: profileId,
      set_default: opts.setDefault === true,
      clear_always_ask: opts.clearAlwaysAsk === true,
      metadata_only: opts.metadataOnly === true,
    },
  });
}

async function setDefault(accessToken, profileId) {
  return callProfiles('profiles-set-default', accessToken, {
    method: 'POST',
    body: { profile_id: profileId },
  });
}

async function setAlwaysAsk(accessToken, alwaysAsk) {
  return callProfiles('profiles-always-ask', accessToken, {
    method: 'POST',
    body: { always_ask: alwaysAsk === true },
  });
}

async function setMiniApp(accessToken, profileIdOrNull) {
  return callProfiles('profiles-mini-app', accessToken, {
    method: 'POST',
    body: { profile_id: profileIdOrNull },
  });
}

async function removeProfile(accessToken, profileId) {
  return callProfiles('profiles-remove', accessToken, {
    method: 'POST',
    body: { profile_id: profileId },
  });
}

async function resolveLoginEmail(username) {
  const url = new URL('/api/lookup', apiBase() + '/');
  url.searchParams.set('type', 'resolve-login');
  const r = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data.email;
}

async function addProfile(accessToken, playerTag, apiToken) {
  const url = new URL('/api/register-with-coc', apiBase() + '/');
  const r = await fetch(url.href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'add-profile', playerTag, apiToken }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function deleteAccount(accessToken) {
  const url = new URL('/api/register-with-coc', apiBase() + '/');
  const r = await fetch(url.href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'delete-account', confirm: 'ELIMINA' }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

module.exports = {
  bootstrap,
  switchProfile,
  setDefault,
  setAlwaysAsk,
  setMiniApp,
  removeProfile,
  resolveLoginEmail,
  addProfile,
  deleteAccount,
};

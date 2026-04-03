'use strict';

const { createClient } = require('@supabase/supabase-js');
const db = require('./supabase');
const { resolveLoginEmail } = require('./auth-resolve');

function requireAnonEnv() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    const err = new Error(
      'Manca SUPABASE_ANON_KEY o SUPABASE_URL sul server del bot (es. Render → Environment). ' +
        'Copia la chiave «anon» da Supabase → Project Settings → API. ' +
        'Non basta la service_role: serve anche l’anon per il login.'
    );
    err.code = 'MISSING_SUPABASE_ANON';
    throw err;
  }
  if (url.includes('supabase.com/dashboard')) {
    const err = new Error(
      'SUPABASE_URL non valida: usa solo https://xxxx.supabase.co (pagina API del progetto), non l’URL della dashboard.'
    );
    err.code = 'BAD_SUPABASE_URL';
    throw err;
  }
  return { url, key };
}

function anonClient() {
  const { url, key } = requireAnonEnv();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInWithEmailPassword(email, password) {
  const client = anonClient();
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    const fallback = email.replace('@cocboard.internal', '@fearunited.internal');
    if (fallback !== email) {
      const r2 = await client.auth.signInWithPassword({ email: fallback, password });
      if (!r2.error) return r2;
    }
    throw new Error(error.message.includes('Invalid') ? 'Credenziali errate.' : error.message);
  }
  return data;
}

async function signInWithPasswordFromInput(rawUsername, password) {
  const email = resolveLoginEmail(rawUsername);
  if (!email) throw new Error('Nome utente vuoto.');
  return signInWithEmailPassword(email, password);
}

async function getValidSession(telegramUserId) {
  try {
    const row = await db.getAuthTokensRow(telegramUserId);
    if (!row?.auth_refresh_token) return null;

    const client = anonClient();

    if (row.auth_access_token) {
      const { data, error } = await client.auth.setSession({
        access_token: row.auth_access_token,
        refresh_token: row.auth_refresh_token,
      });
      if (!error && data?.session) {
        return { user: data.session.user, session: data.session };
      }
    }

    const { data: ref, error: e2 } = await client.auth.refreshSession({
      refresh_token: row.auth_refresh_token,
    });
    if (e2 || !ref?.session) {
      try {
        await db.clearAuthSession(telegramUserId);
      } catch (_) {}
      return null;
    }
    await db.saveAuthSession(telegramUserId, ref.session, ref.session.user);
    return { user: ref.session.user, session: ref.session };
  } catch (e) {
    const c = e && e.cause;
    console.error(
      '[cocboard-bot] getValidSession / Supabase:',
      e.message,
      c ? `(cause: ${c.code || ''} ${c.message || c})` : ''
    );
    return null;
  }
}

module.exports = {
  anonClient,
  signInWithEmailPassword,
  signInWithPasswordFromInput,
  getValidSession,
};

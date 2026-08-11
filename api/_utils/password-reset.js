'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const profiles = require('./user-profiles');
const resend = require('./resend');

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const REQUEST_COOLDOWN_MS = 60 * 1000;

function adminSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service non configurato.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

function makeOtpCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

function isInternalAuthEmail(email) {
  const e = String(email || '').toLowerCase();
  return e.endsWith('@cocboard.internal') || e.endsWith('@fearunited.internal');
}

function recoveryEmailOf(user) {
  if (!user) return null;
  const meta = user.user_metadata?.email;
  if (meta && String(meta).includes('@') && !isInternalAuthEmail(meta)) {
    return String(meta).trim().toLowerCase();
  }
  const e = user.email;
  if (e && !isInternalAuthEmail(e)) return String(e).trim().toLowerCase();
  return null;
}

function displayUsername(user) {
  return (
    user?.user_metadata?.username ||
    (user?.email && isInternalAuthEmail(user.email) ? user.email.split('@')[0] : null) ||
    'giocatore'
  );
}

async function findUserByRecoveryEmail(sb, email) {
  const target = String(email).toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    for (const u of users) {
      if (recoveryEmailOf(u) === target) return u;
      if (String(u.email || '').toLowerCase() === target) return u;
    }
    if (users.length < 200) break;
    page += 1;
    if (page > 20) break;
  }
  return null;
}

/**
 * Risolve l'utente Auth da username / #tag / email di recupero.
 */
async function findAuthUserForReset(rawInput) {
  const sb = adminSb();
  const s = String(rawInput || '').trim();
  if (!s) return null;

  if (s.includes('@') && !isInternalAuthEmail(s)) {
    const byRecovery = await findUserByRecoveryEmail(sb, s);
    if (byRecovery) return byRecovery;
    const { data } = await sb.auth.admin.getUserByEmail(s.toLowerCase());
    if (data?.user) return data.user;
  }

  const authEmail = await profiles.resolveLoginEmailFromInput(s);
  if (!authEmail) return null;

  let { data } = await sb.auth.admin.getUserByEmail(authEmail);
  if (data?.user) return data.user;

  if (authEmail.endsWith('@cocboard.internal')) {
    const legacy = authEmail.replace('@cocboard.internal', '@fearunited.internal');
    const r2 = await sb.auth.admin.getUserByEmail(legacy);
    if (r2?.data?.user) return r2.data.user;
  }
  return null;
}

/**
 * Richiede OTP. Risposta sempre generica per non rivelare se l'account esiste.
 */
async function requestPasswordReset(rawInput) {
  const generic = {
    ok: true,
    message:
      'Se l’account ha un’email di recupero, abbiamo inviato un codice a 6 cifre. Controlla la posta (e lo spam).',
  };

  if (!resend.resendConfigured()) {
    return {
      ok: false,
      error: 'Invio email non configurato. Contatta un amministratore tramite il bot Telegram.',
      status: 503,
    };
  }

  const user = await findAuthUserForReset(rawInput);
  const email = recoveryEmailOf(user);
  if (!user || !email) {
    // Stessa risposta generica (anti user-enumeration)
    return generic;
  }

  const sb = adminSb();
  const { data: existing } = await sb
    .from('password_reset_otps')
    .select('created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing?.created_at) {
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < REQUEST_COOLDOWN_MS) {
      return {
        ok: false,
        error: 'Attendi un minuto prima di richiedere un nuovo codice.',
        status: 429,
      };
    }
  }

  const code = makeOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { error: upErr } = await sb.from('password_reset_otps').upsert(
    {
      user_id: user.id,
      email,
      code_hash: codeHash,
      attempts: 0,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (upErr) {
    // Tabella assente → messaggio chiaro
    if (upErr.code === '42P01' || /does not exist/i.test(upErr.message || '')) {
      return {
        ok: false,
        error: 'Tabella password_reset_otps non trovata. Esegui schema-password-reset-otps.sql su Supabase.',
        status: 500,
      };
    }
    console.error('[password-reset] upsert', upErr);
    return { ok: false, error: 'Impossibile avviare il recupero.', status: 500 };
  }

  const username = displayUsername(user);
  const sent = await resend.sendEmail({
    to: email,
    subject: 'Codice recupero password CoCBoard',
    html: resend.otpResetEmailHtml({ username, code }),
    text: `Codice CoCBoard: ${code} (scade in 15 minuti)`,
  });

  if (!sent.ok) {
    console.error('[password-reset] send', sent.error, sent.detail);
    return {
      ok: false,
      error: sent.error || 'Invio email non riuscito. Riprova tra poco o contatta un amministratore.',
      status: 502,
    };
  }

  return {
    ...generic,
    emailHint: resend.maskEmail(email),
  };
}

/**
 * Conferma OTP e imposta nuova password.
 */
async function confirmPasswordReset({ rawInput, code, newPassword }) {
  const pwd = String(newPassword || '');
  if (pwd.length < 6) {
    return { ok: false, error: 'La password deve avere almeno 6 caratteri.', status: 400 };
  }
  const otp = String(code || '').trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(otp)) {
    return { ok: false, error: 'Inserisci il codice a 6 cifre ricevuto via email.', status: 400 };
  }

  const user = await findAuthUserForReset(rawInput);
  if (!user) {
    return { ok: false, error: 'Codice non valido o scaduto.', status: 400 };
  }

  const sb = adminSb();
  const { data: row, error } = await sb
    .from('password_reset_otps')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, error: 'Codice non valido o scaduto.', status: 400 };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sb.from('password_reset_otps').delete().eq('user_id', user.id);
    return { ok: false, error: 'Codice scaduto. Richiedine uno nuovo.', status: 400 };
  }

  if ((row.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await sb.from('password_reset_otps').delete().eq('user_id', user.id);
    return { ok: false, error: 'Troppi tentativi. Richiedi un nuovo codice.', status: 429 };
  }

  if (hashOtp(otp) !== row.code_hash) {
    await sb
      .from('password_reset_otps')
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq('user_id', user.id);
    return { ok: false, error: 'Codice non valido.', status: 400 };
  }

  const merged = { ...(user.user_metadata || {}), must_change_password: false };
  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, {
    password: pwd,
    user_metadata: merged,
  });
  if (upErr) {
    return { ok: false, error: upErr.message || 'Impossibile aggiornare la password.', status: 500 };
  }

  await sb.from('password_reset_otps').delete().eq('user_id', user.id);

  return {
    ok: true,
    message: 'Password aggiornata. Ora puoi accedere con la nuova password.',
  };
}

module.exports = {
  requestPasswordReset,
  confirmPasswordReset,
  findAuthUserForReset,
  recoveryEmailOf,
  displayUsername,
};

'use strict';

/**
 * Client Resend condiviso (benvenuto, reset password, avvisi).
 * Env: RESEND_API_KEY (obbligatoria per inviare), RESEND_FROM (mittente verificato),
 *      RESEND_REPLY_TO (opzionale).
 */

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim());
}

function resendFrom() {
  const from = (process.env.RESEND_FROM || '').trim();
  if (from) return from;
  // Fallback sandbox Resend (funziona solo verso l'email del tuo account Resend)
  return 'CoCBoard <onboarding@resend.dev>';
}

/**
 * @param {{ to: string|string[], subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: true, id?: string } | { ok: false, skipped?: boolean, error: string }>}
 */
async function sendEmail(opts) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, skipped: true, error: 'RESEND_API_KEY non configurata.' };
  }
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  const recipients = to.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'Destinatario mancante.' };
  if (!opts.subject || !opts.html) return { ok: false, error: 'subject/html obbligatori.' };

  const body = {
    from: resendFrom(),
    to: recipients,
    subject: String(opts.subject),
    html: String(opts.html),
  };
  if (opts.text) body.text = String(opts.text);
  const replyTo = (process.env.RESEND_REPLY_TO || '').trim();
  if (replyTo) body.reply_to = replyTo;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.message || data?.error || `Resend HTTP ${r.status}`;
      console.error('[resend]', msg, data);
      return { ok: false, error: String(msg) };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error('[resend]', e.message);
    return { ok: false, error: e.message || 'Errore rete Resend.' };
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteHomeUrl() {
  return (
    (process.env.COCBOARD_SITE_HOME_URL || process.env.COCBOARD_API_BASE || 'https://cocboard.vercel.app')
      .trim()
      .replace(/\/$/, '') || 'https://cocboard.vercel.app'
  );
}

function welcomeEmailHtml({ username, playerTag, role }) {
  const home = siteHomeUrl();
  const u = escapeHtml(username);
  const tag = escapeHtml(playerTag);
  const roleSafe = escapeHtml(role || 'utente');
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2 style="margin:0 0 12px">Ciao ${u}, benvenuto su CoCBoard</h2>
      <p>Il tuo account è collegato al villaggio Clash of Clans.</p>
      <ul>
        <li><strong>Username di accesso:</strong> ${u}</li>
        <li><strong>Tag:</strong> ${tag}</li>
        <li><strong>Ruolo:</strong> ${roleSafe}</li>
      </ul>
      <p>Accedi alla dashboard: <a href="${home}">${home}</a></p>
      <p style="color:#666;font-size:13px">Se hai indicato un'email di recupero, potrai usarla per reimpostare la password in autonomia.</p>
    </div>`;
}

function tempPasswordEmailHtml({ username, tempPassword }) {
  const home = siteHomeUrl();
  const u = escapeHtml(username);
  const pw = escapeHtml(tempPassword);
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2 style="margin:0 0 12px">Password temporanea CoCBoard</h2>
      <p>Ciao <strong>${u}</strong>, un amministratore ha reimpostato la tua password.</p>
      <p style="font-size:18px;letter-spacing:0.04em"><code style="background:#f4f4f4;padding:8px 12px;border-radius:6px">${pw}</code></p>
      <p>Accedi su <a href="${home}">${home}</a>: al primo accesso ti verrà chiesto di sceglierne una nuova.</p>
      <p style="color:#666;font-size:13px">Se non hai richiesto tu questo reset, contatta un amministratore tramite il bot Telegram CoCBoard.</p>
    </div>`;
}

function otpResetEmailHtml({ username, code }) {
  const u = escapeHtml(username || 'giocatore');
  const c = escapeHtml(code);
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2 style="margin:0 0 12px">Codice di recupero password</h2>
      <p>Ciao <strong>${u}</strong>, usa questo codice per impostare una nuova password su CoCBoard:</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700"><code style="background:#f4f4f4;padding:10px 16px;border-radius:8px">${c}</code></p>
      <p>Il codice scade tra <strong>15 minuti</strong>. Se non hai richiesto tu il reset, ignora questa email.</p>
    </div>`;
}

function maskEmail(email) {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = local.length <= 2 ? local[0] + '*' : local.slice(0, 2) + '***';
  return `${shown}@${domain}`;
}

module.exports = {
  resendConfigured,
  resendFrom,
  sendEmail,
  escapeHtml,
  siteHomeUrl,
  welcomeEmailHtml,
  tempPasswordEmailHtml,
  otpResetEmailHtml,
  maskEmail,
};

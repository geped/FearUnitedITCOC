'use strict';

/**
 * Invio email transazionali (benvenuto, reset password, avvisi).
 *
 * Provider (priorità):
 * 1) Brevo — BREVO_API_KEY (+ BREVO_FROM o RESEND_FROM = Gmail verificato come Single Sender)
 *    Gratis ~300 mail/giorno, SENZA dominio proprio.
 * 2) Resend — RESEND_API_KEY (+ RESEND_FROM). Senza dominio: solo verso l'email account Resend.
 *
 * Opzionale: RESEND_REPLY_TO / BREVO_REPLY_TO
 */

function brevoConfigured() {
  return Boolean(process.env.BREVO_API_KEY && String(process.env.BREVO_API_KEY).trim());
}

function resendKeyConfigured() {
  return Boolean(process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim());
}

/** True se almeno un provider può inviare. */
function resendConfigured() {
  return brevoConfigured() || resendKeyConfigured();
}

function activeProvider() {
  if (brevoConfigured()) return 'brevo';
  if (resendKeyConfigured()) return 'resend';
  return null;
}

/** Accetta `CoCBoard <a@b.it>` oppure solo `a@b.it`. */
function normalizeFromAddress(raw, displayName = 'CoCBoard') {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('<') && s.includes('>')) return s;
  if (s.includes('@')) return `${displayName} <${s}>`;
  return s;
}

function parseFromAddress(raw, fallbackName = 'CoCBoard') {
  const normalized = normalizeFromAddress(raw, fallbackName);
  const m = normalized.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    return {
      name: (m[1] || fallbackName).trim() || fallbackName,
      email: m[2].trim().toLowerCase(),
    };
  }
  if (normalized.includes('@')) {
    return { name: fallbackName, email: normalized.toLowerCase() };
  }
  return null;
}

function configuredFromRaw() {
  return (
    (process.env.BREVO_FROM || '').trim() ||
    (process.env.RESEND_FROM || '').trim() ||
    ''
  );
}

function resendFrom() {
  const from = normalizeFromAddress(configuredFromRaw(), 'CoCBoard');
  if (from) return from;
  if (activeProvider() === 'brevo') {
    // Brevo richiede un Single Sender verificato (es. Gmail): non c'è sandbox utile
    return '';
  }
  return 'CoCBoard <onboarding@resend.dev>';
}

function resendReplyTo() {
  const raw = (
    (process.env.BREVO_REPLY_TO || '').trim() ||
    (process.env.RESEND_REPLY_TO || '').trim()
  );
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

function friendlyEmailError(err, provider) {
  const e = String(err || '').toLowerCase();
  if (provider === 'brevo') {
    if (e.includes('sender') || e.includes('unrecognised') || e.includes('unrecognized') || e.includes('not verified')) {
      return 'Mittente Brevo non verificato. In Brevo → Senders: verifica la tua Gmail e imposta BREVO_FROM=quella@gmail.com su Vercel.';
    }
    if (e.includes('api') && (e.includes('key') || e.includes('unauthorized') || e.includes('401'))) {
      return 'BREVO_API_KEY non valida su Vercel (Production). Controlla la chiave e rifai il redeploy.';
    }
    return 'Invio email non riuscito (Brevo). Controlla BREVO_API_KEY e mittente verificato, poi riprova.';
  }
  if (e.includes('domain') || e.includes('not verified') || e.includes('unverified')) {
    return 'Dominio mittente non verificato su Resend. Senza dominio usa Brevo (gratis) oppure RESEND_FROM=CoCBoard <onboarding@resend.dev> (solo verso la tua email Resend).';
  }
  if (e.includes('api key') || e.includes('unauthorized') || e.includes('invalid api')) {
    return 'RESEND_API_KEY non valida su Vercel (Production). Controlla la chiave e rifai il redeploy.';
  }
  if (e.includes('from') || e.includes('sender')) {
    return 'Mittente non valido. Con Brevo usa la Gmail verificata; con Resend serve dominio o onboarding@resend.dev.';
  }
  if (e.includes('only send testing') || e.includes('testing emails')) {
    return 'Resend in modalità test: senza dominio puoi inviare solo all’email del tuo account Resend. Usa Brevo per inviare a tutti gratis.';
  }
  return 'Invio email non riuscito. Controlla il provider email su Vercel, poi riprova.';
}

async function sendViaBrevo({ recipients, subject, html, text, fromParsed, replyTo }) {
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (!fromParsed?.email) {
    return {
      ok: false,
      error:
        'BREVO_FROM mancante. Imposta su Vercel la tua Gmail verificata come Single Sender (es. BREVO_FROM=tua@gmail.com).',
    };
  }
  const payload = {
    sender: { name: fromParsed.name || 'CoCBoard', email: fromParsed.email },
    to: recipients.map((email) => ({ email })),
    subject: String(subject),
    htmlContent: String(html),
  };
  if (text) payload.textContent = String(text);
  if (replyTo) payload.replyTo = { email: replyTo };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      data?.message ||
      (Array.isArray(data?.message) ? data.message.join(', ') : null) ||
      data?.error ||
      `Brevo HTTP ${r.status}`;
    console.error('[brevo]', msg, { from: fromParsed, to: recipients, data });
    return { ok: false, error: friendlyEmailError(msg, 'brevo'), detail: String(msg) };
  }
  return { ok: true, id: data?.messageId || data?.messageIds?.[0] };
}

async function sendViaResend({ recipients, subject, html, text, from, replyTo }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const body = {
    from,
    to: recipients,
    subject: String(subject),
    html: String(html),
  };
  if (text) body.text = String(text);
  if (replyTo) body.reply_to = replyTo;

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
    console.error('[resend]', msg, { from: body.from, to: body.to, data });
    return { ok: false, error: friendlyEmailError(msg, 'resend'), detail: String(msg) };
  }
  return { ok: true, id: data?.id };
}

/**
 * @param {{ to: string|string[], subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: true, id?: string } | { ok: false, skipped?: boolean, error: string, detail?: string }>}
 */
async function sendEmail(opts) {
  const provider = activeProvider();
  if (!provider) {
    return {
      ok: false,
      skipped: true,
      error: 'Nessun provider email configurato (BREVO_API_KEY o RESEND_API_KEY).',
    };
  }

  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  const recipients = to.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'Destinatario mancante.' };
  if (!opts.subject || !opts.html) return { ok: false, error: 'subject/html obbligatori.' };

  const replyTo = resendReplyTo();
  const fromParsed = parseFromAddress(configuredFromRaw(), 'CoCBoard');

  try {
    if (provider === 'brevo') {
      return await sendViaBrevo({
        recipients,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        fromParsed,
        replyTo,
      });
    }
    const from = resendFrom();
    return await sendViaResend({
      recipients,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      from,
      replyTo,
    });
  } catch (e) {
    console.error(`[${provider}]`, e.message);
    return {
      ok: false,
      error: friendlyEmailError(e.message, provider),
      detail: e.message || `Errore rete ${provider}.`,
    };
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
  brevoConfigured,
  activeProvider,
  resendFrom,
  resendReplyTo,
  friendlyResendError: friendlyEmailError,
  sendEmail,
  escapeHtml,
  siteHomeUrl,
  welcomeEmailHtml,
  tempPasswordEmailHtml,
  otpResetEmailHtml,
  maskEmail,
};

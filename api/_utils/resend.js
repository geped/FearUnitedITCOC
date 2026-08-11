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

function configuredFromRaw(provider) {
  if (provider === 'brevo') {
    // Non usare RESEND_FROM come fallback: spesso è un dominio non verificato su Brevo.
    return (process.env.BREVO_FROM || '').trim();
  }
  return (
    (process.env.BREVO_FROM || '').trim() ||
    (process.env.RESEND_FROM || '').trim() ||
    ''
  );
}

function resendFrom() {
  const from = normalizeFromAddress(configuredFromRaw('resend'), 'CoCBoard');
  if (from) return from;
  if (activeProvider() === 'brevo') {
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

function friendlyEmailError(err, provider, extra = {}) {
  const e = String(err || '').toLowerCase();
  if (provider === 'brevo') {
    // Prima degli altri check: "unrecognised IP" contiene "unrecognised" e veniva
    // confuso con mittente non verificato.
    if (
      e.includes('ip address') ||
      e.includes('authorised_ips') ||
      e.includes('authorized_ips') ||
      (e.includes('unrecognised') && e.includes('ip')) ||
      (e.includes('unrecognized') && e.includes('ip'))
    ) {
      return (
        'Brevo blocca le chiamate dagli IP di Vercel. Apri https://app.brevo.com/security/authorised_ips ' +
        'e disattiva la restrizione IP (o autorizza tutti gli IP). Su Vercel gli IP cambiano sempre: non si possono whitelistare uno a uno.'
      );
    }
    if (e.includes('sender') || e.includes('not verified')) {
      const tried = extra.fromEmail ? ` (hai usato: ${extra.fromEmail})` : '';
      return (
        'Mittente Brevo non accettato' +
        tried +
        '. Su Vercel imposta BREVO_FROM=info.cocboard@gmail.com (la Gmail verificata in Mittenti), poi redeploy.'
      );
    }
    if (e.includes('api') && (e.includes('key') || e.includes('unauthorized') || e.includes('401'))) {
      return 'BREVO_API_KEY non valida su Vercel (Production). Usa la chiave da «Chiavi API e MCP», poi redeploy.';
    }
    const detail = String(err || '').trim();
    return detail
      ? `Invio email non riuscito (Brevo): ${detail}`
      : 'Invio email non riuscito (Brevo). Controlla BREVO_API_KEY e BREVO_FROM, poi riprova.';
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
        'BREVO_FROM mancante o non valido. Su Vercel Production imposta BREVO_FROM=info.cocboard@gmail.com (mittente verificato), poi redeploy.',
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
      (typeof data?.message === 'string' && data.message) ||
      (Array.isArray(data?.message) ? data.message.join(', ') : null) ||
      data?.error ||
      `Brevo HTTP ${r.status}`;
    console.error('[brevo]', msg, { from: fromParsed, to: recipients, data });
    return {
      ok: false,
      error: friendlyEmailError(msg, 'brevo', { fromEmail: fromParsed.email }),
      detail: String(msg),
    };
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
  const fromParsed = parseFromAddress(configuredFromRaw(provider), 'CoCBoard');

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

function telegramBotUrl() {
  const u = (process.env.TELEGRAM_BOT_USERNAME || 'cocboardbot').replace(/^@/, '').trim() || 'cocboardbot';
  return `https://t.me/${u}`;
}

function brandLogoUrl() {
  return `${siteHomeUrl()}/assets/cocboardbot-no-bg.png`;
}

/** Colori e font allineati a style.css (:root CoC Dark Theme). */
function siteTheme() {
  const home = siteHomeUrl();
  return {
    fontUi: "'Supercell Magic', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontMono: "'IBM Plex Mono', ui-monospace, monospace",
    fontForm: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontFaceUrl: `${home}/fonts/SupercellMagic-Regular.ttf`,
    bg: '#0D0B08',
    bg1: '#110E09',
    bg2: '#1A150E',
    bg3: '#221A0F',
    border: '#2A2010',
    border2: '#3A3020',
    gold: '#C9A962',
    goldDim: 'rgba(201,169,98,0.12)',
    text: '#EEEAE0',
    text2: '#C8BCA8',
    text3: '#7A6A50',
    blue: '#2980B9',
    radius: '3px',
    radiusSm: '2px',
  };
}

function welcomeEmailHtml({ username, playerTag, role }) {
  const home = siteHomeUrl();
  const botUrl = telegramBotUrl();
  const logo = brandLogoUrl();
  const t = siteTheme();
  const u = escapeHtml(username);
  const tag = escapeHtml(playerTag);
  const roleSafe = escapeHtml(role || 'utente');
  const homeSafe = escapeHtml(home);
  const botSafe = escapeHtml(botUrl);
  const botUser = escapeHtml((process.env.TELEGRAM_BOT_USERNAME || 'cocboardbot').replace(/^@/, '') || 'cocboardbot');
  return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style type="text/css">
    @font-face {
      font-family: 'Supercell Magic';
      src: url('${escapeHtml(t.fontFaceUrl)}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${t.bg};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${t.bg};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:420px;background:${t.bg1};border:1px solid ${t.border};border-radius:${t.radius};overflow:hidden;box-shadow:0 0 40px rgba(0,0,0,0.7),0 0 28px rgba(201,169,98,0.04);">
          <tr>
            <td align="center" style="padding:32px 28px 16px;background:radial-gradient(ellipse 70% 50% at 50% 0%, rgba(201,169,98,0.08) 0%, transparent 70%), ${t.bg1};">
              <img src="${escapeHtml(logo)}" alt="CoCBoard" width="88" height="88" style="display:block;width:88px;height:88px;border:0;outline:none;">
              <div style="font-family:${t.fontUi};font-size:28px;font-weight:400;color:${t.gold};letter-spacing:1.5px;margin-top:14px;line-height:1.2;">CoCBoard</div>
              <div style="font-family:${t.fontMono};font-size:11px;color:${t.text3};letter-spacing:2px;text-transform:uppercase;margin-top:6px;">Gestione clan, CWL e giocatori</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 4px;">
              <h1 style="margin:12px 0 10px;font-family:${t.fontUi};font-size:18px;font-weight:400;color:${t.text};line-height:1.35;letter-spacing:0.02em;">Ciao ${u}, benvenuto!</h1>
              <p style="margin:0 0 16px;font-family:${t.fontForm};font-size:14px;line-height:1.6;color:${t.text2};">
                Il tuo account è collegato al villaggio Clash of Clans. Ecco i tuoi dati di accesso:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${t.bg2};border:1px solid ${t.border2};border-radius:${t.radius};margin:0 0 18px;">
                <tr>
                  <td style="padding:12px 14px;border-bottom:1px solid ${t.border};">
                    <div style="font-family:${t.fontMono};font-size:10px;color:${t.text3};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Username di accesso</div>
                    <div style="font-family:${t.fontUi};font-size:15px;color:${t.text};letter-spacing:0.02em;">${u}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;border-bottom:1px solid ${t.border};">
                    <div style="font-family:${t.fontMono};font-size:10px;color:${t.text3};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Tag</div>
                    <div style="font-family:${t.fontMono};font-size:14px;color:${t.gold};letter-spacing:0;">${tag}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;">
                    <div style="font-family:${t.fontMono};font-size:10px;color:${t.text3};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Ruolo</div>
                    <div style="font-family:${t.fontUi};font-size:15px;color:${t.text};letter-spacing:0.02em;">${roleSafe}</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 10px;">
                <tr>
                  <td align="center" style="border-radius:${t.radiusSm};background:${t.gold};">
                    <a href="${homeSafe}" style="display:block;padding:12px 18px;font-family:${t.fontUi};font-size:14px;font-weight:400;color:${t.bg};text-decoration:none;letter-spacing:0.03em;">Apri la dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 18px;font-family:${t.fontForm};font-size:12px;line-height:1.5;color:${t.text3};text-align:center;">
                Oppure vai su <a href="${homeSafe}" style="color:${t.gold};text-decoration:none;">${homeSafe}</a>
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${t.goldDim};border:1px solid ${t.border2};border-radius:${t.radius};margin:0 0 16px;">
                <tr>
                  <td style="padding:14px;">
                    <div style="font-family:${t.fontUi};font-size:14px;color:${t.gold};margin-bottom:6px;letter-spacing:0.02em;">Usa CoCBoard anche su Telegram</div>
                    <p style="margin:0 0 12px;font-family:${t.fontForm};font-size:13px;line-height:1.55;color:${t.text2};">
                      Stesso account: clan, profilo, cerca, classifica e altro dal bot.
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="border-radius:${t.radiusSm};background:${t.bg3};border:1px solid ${t.border2};">
                          <a href="${botSafe}" style="display:inline-block;padding:10px 14px;font-family:${t.fontUi};font-size:13px;color:${t.text2};text-decoration:none;letter-spacing:0.02em;">Apri @${botUser}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-family:${t.fontForm};font-size:12px;line-height:1.55;color:${t.text3};">
                Se hai indicato un’email di recupero, potrai usarla per reimpostare la password in autonomia.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 22px;border-top:1px solid ${t.border};">
              <p style="margin:0;font-family:${t.fontForm};font-size:11px;line-height:1.55;color:${t.text3};">
                <strong style="color:${t.text2};font-family:${t.fontUi};font-weight:400;">Non rispondere a questa email.</strong>
                I messaggi inviati a questo indirizzo non vengono letti. Per assistenza usa il bot Telegram CoCBoard.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

const { createClient } = require('@supabase/supabase-js');
const profiles = require('./_utils/user-profiles');

const COC_ROLE_MAP = profiles.COC_ROLE_MAP;

function normalizeTag(raw) {
    return profiles.normalizeTag(raw);
}

async function verifyPlayerToken(playerTag, apiToken) {
    const proxyUrl = process.env.RENDER_PROXY_URL;
    if (!proxyUrl) {
        const err = new Error('RENDER_PROXY_URL non configurato.');
        err.status = 500;
        throw err;
    }
    const proxyRes = await fetch(`${proxyUrl}/verify-player-token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-sync-key': process.env.SYNC_SECRET || '',
        },
        body: JSON.stringify({ playerTag, apiToken }),
    });
    const proxyData = await proxyRes.json().catch(() => ({}));
    if (!proxyRes.ok) {
        const err = new Error(proxyData.error || 'Verifica fallita.');
        err.status = proxyRes.status;
        throw err;
    }
    return proxyData.player;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const action = String(body.action || 'register').trim().toLowerCase();

    // ── Aggiungi profilo a account esistente (JWT) ──────────────────────────
    if (action === 'add-profile') {
        try {
            const token = profiles.bearerFromReq(req);
            if (!token) return res.status(401).json({ error: 'Autenticazione richiesta.' });
            const user = await profiles.getUserFromJwt(token);
            const { playerTag: rawTag, apiToken } = body;
            if (!rawTag || !apiToken) {
                return res.status(400).json({ error: 'Tag giocatore e chiave API sono obbligatori.' });
            }
            const playerTag = normalizeTag(rawTag);
            const player = await verifyPlayerToken(playerTag, apiToken);
            // Assicura che il player restituito abbia il tag normalizzato
            if (!player.tag) player.tag = playerTag;
            const result = await profiles.addProfileForUser(user, player);
            return res.status(201).json(result);
        } catch (e) {
            return res.status(e.status || 500).json({ error: e.message || 'Errore.' });
        }
    }

    // ── Elimina intero account CoCBoard (JWT + conferma) ────────────────────
    if (action === 'delete-account') {
        try {
            const token = profiles.bearerFromReq(req);
            if (!token) return res.status(401).json({ error: 'Autenticazione richiesta.' });
            const user = await profiles.getUserFromJwt(token);
            const confirm = String(body.confirm || '').trim().toUpperCase();
            if (confirm !== 'ELIMINA') {
                return res.status(400).json({
                    error: 'Conferma non valida. Digita ELIMINA per procedere.',
                    code: 'CONFIRM_REQUIRED',
                });
            }
            const result = await profiles.deleteAccountWipe(user);
            return res.status(200).json(result);
        } catch (e) {
            return res.status(e.status || 500).json({ error: e.message || 'Errore.' });
        }
    }

    // ── Registrazione classica (primo account) ──────────────────────────────
    const { playerTag: rawTag, apiToken, password, email: realEmail } = body;

    if (!rawTag || !apiToken || !password) {
        return res.status(400).json({ error: 'Tag giocatore, chiave API e password sono obbligatori.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La password deve essere di almeno 6 caratteri.' });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurato.' });

    const playerTag = normalizeTag(rawTag);

    let player;
    try {
        player = await verifyPlayerToken(playerTag, apiToken);
    } catch (err) {
        if (err.status === 502 || String(err.message || '').includes('proxy')) {
            return res.status(502).json({ error: 'Impossibile contattare il proxy. Riprova.' });
        }
        return res.status(err.status || 500).json({ error: err.message || 'Verifica fallita.' });
    }

    // Tag già usato come profilo su altro/stesso account?
    try {
        const adminCheck = profiles.adminClient();
        const { data: existingProf } = await adminCheck
            .from('user_coc_profiles')
            .select('id, user_id')
            .eq('coc_tag', playerTag)
            .maybeSingle();
        if (existingProf) {
            return res.status(409).json({
                error: 'Questo tag è già associato a un account. Accedi con il tuo tag come nome utente, oppure aggiungi il profilo dal menu Profili.',
            });
        }
    } catch (_) {}

    const appRole = COC_ROLE_MAP[player.role] || 'membro';
    const username = player.name;
    const clanTag     = player.clan?.tag  || null;
    const clanName    = player.clan?.name || null;
    const clanBadge   = player.clan?.badgeUrls?.medium
                     || player.clan?.badgeUrls?.small
                     || null;

    const emailBase = playerTag.replace('#', '').toLowerCase();
    const email = `${emailBase}@cocboard.internal`;

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            role:                appRole,
            clan_role:           appRole,
            account_is_admin:    false,
            username,
            coc_tag:             playerTag,
            coc_clan_tag:        clanTag,
            coc_clan_name:       clanName,
            coc_clan_badge_url:  clanBadge,
            ...(realEmail ? { email: realEmail } : {}),
        }
    });

    if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('email') && msg.includes('exist')) {
            return res.status(409).json({ error: 'Questo tag è già associato a un account. Accedi con il tuo tag come nome utente.' });
        }
        return res.status(500).json({ error: error.message });
    }

    // Crea riga profilo + prefs (migrazione/bootstrap)
    try {
        if (!player.tag) player.tag = playerTag;
        const { profile } = await profiles.createInitialProfileForNewUser(data.user.id, player);
        await profiles.syncUserMetadata(
            profiles.adminClient(),
            data.user.id,
            profile,
            { account_is_admin: false },
            data.user,
        );
    } catch (profErr) {
        console.error('[register-with-coc] profile bootstrap failed:', profErr.message);
        // Account Auth già creato: non rollback automatico (utente può fare bootstrap lazy al login)
    }

    if (realEmail && process.env.RESEND_API_KEY) {
        try {
            const resend = require('./_utils/resend');
            await resend.sendEmail({
                to: realEmail,
                subject: 'Benvenuto su CoCBoard',
                html: resend.welcomeEmailHtml({
                    username,
                    playerTag,
                    role: appRole,
                }),
            });
        } catch (emailErr) {
            console.error('Errore invio email di benvenuto:', emailErr);
        }
    }

    return res.status(201).json({
        ok: true,
        username,
        role: appRole,
        coc_tag:    playerTag,
        coc_clan_tag:   clanTag,
        coc_clan_name:  clanName,
        hasClan:        !!clanTag,
        email,
    });
};

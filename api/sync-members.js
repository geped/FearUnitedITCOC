const { createClient } = require('@supabase/supabase-js');
const { isAccountAdmin } = require('./_utils/require-role');

function isAuthorizedSecret(req) {
    const authHeader = req.headers['authorization'] || '';
    const provided = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const syncSecret = (process.env.SYNC_SECRET || '').trim();
    if (!cronSecret && !syncSecret) return { ok: false, reason: 'CRON_SECRET o SYNC_SECRET non configurati.' };
    const ok = (cronSecret && provided === cronSecret) || (syncSecret && provided === syncSecret);
    return ok ? { ok: true } : { ok: false, reason: 'Non autorizzato.' };
}

function normClan(raw) {
    if (raw == null || !String(raw).trim()) return null;
    const u = String(raw).trim().toUpperCase().replace(/^#+/, '');
    return u ? `#${u}` : null;
}

/** JWT utente: admin account oppure capo/co-capo sul clan richiesto. */
async function authorizeUserJwtForClan(req, clanTag) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) return { ok: false, reason: 'Autenticazione richiesta.' };

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { ok: false, reason: 'Token non valido o scaduto.' };

    if (isAccountAdmin(user)) return { ok: true, user };

    const meta = user.user_metadata || {};
    const clanRole = String(meta.clan_role || meta.role || '').toLowerCase();
    const canEdit = ['capo', 'co-capo', 'admin'].includes(clanRole) || isAccountAdmin(user);
    if (!canEdit) {
        return { ok: false, reason: 'Solo Capo / Co-Capo / Admin possono sincronizzare.' };
    }

    const userClan = normClan(meta.coc_clan_tag);
    const want = normClan(clanTag);
    if (!want) return { ok: false, reason: 'clanTag obbligatorio.' };
    if (!userClan || userClan !== want) {
        return {
            ok: false,
            reason: 'Puoi sincronizzare solo il clan del profilo attivo. Cambia profilo se serve.',
        };
    }
    return { ok: true, user };
}

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });

        const secretAuth = isAuthorizedSecret(req);
        if (!secretAuth.ok) {
            const userAuth = await authorizeUserJwtForClan(req, clanTag);
            if (!userAuth.ok) {
                return res.status(401).json({ error: userAuth.reason || secretAuth.reason });
            }
        }

        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata su Vercel.' });

        // Attende il risveglio del proxy (Render free: cold start ~15–40s).
        try {
            await fetch(`${proxyUrl}/health`, { signal: AbortSignal.timeout(35000) });
        } catch (_) {
            /* prosegui comunque */
        }

        const response = await fetch(
            `${proxyUrl}/sync?clanTag=${encodeURIComponent(clanTag)}`,
            {
                method: 'POST',
                headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
                signal: AbortSignal.timeout(50000),
            }
        );
        const raw = await response.text();
        let data = {};
        try {
            data = JSON.parse(raw);
        } catch (_) {
            throw new Error(
                response.ok
                    ? 'Risposta proxy non valida.'
                    : `Proxy HTTP ${response.status}: ${raw.slice(0, 200)}`
            );
        }
        if (!response.ok) throw new Error(data.error || `Errore proxy (${response.status})`);
        res.status(200).json(data);
    } catch (err) {
        const msg = err.name === 'TimeoutError' || err.message?.includes('timed out')
            ? 'Timeout: il server di sync è ancora in avvio (Render). Riprova tra 30–60 secondi.'
            : err.message;
        res.status(500).json({ error: msg });
    }
};

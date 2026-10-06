const { createClient } = require('@supabase/supabase-js');
const fetch = require('../shared/fetch-with-timeout').createBoundedFetch(45000);
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
        if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

        const clanTag = req.query.clanTag || req.body?.clanTag;
        const secretAuth = isAuthorizedSecret(req);
        if (req.method === 'GET' && !secretAuth.ok) return res.status(401).json({ error: secretAuth.reason });
        if (!clanTag && req.method === 'POST') return res.status(400).json({ error: 'clanTag obbligatorio.' });
        if (!secretAuth.ok) {
            const userAuth = await authorizeUserJwtForClan(req, clanTag);
            if (!userAuth.ok) {
                return res.status(401).json({ error: userAuth.reason || secretAuth.reason });
            }
        }

        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata su Vercel.' });

        if (!clanTag) {
            const deadline = AbortSignal.timeout(50000);
            const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
                auth: { autoRefreshToken: false, persistSession: false },
                global: { fetch: (url, options) => fetch(url, { ...options, signal: deadline }) },
            });
            const { data, error } = await db.from('members').select('clan_tag').not('clan_tag', 'is', null);
            if (error) throw error;
            const tags = [...new Set((data || []).map(row => row.clan_tag).filter(Boolean))];
            const results = [];
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(3, tags.length) }, async () => {
                while (cursor < tags.length) {
                    const tag = tags[cursor++];
                    try {
                        const response = await fetch(`${proxyUrl}/sync?clanTag=${encodeURIComponent(tag)}`, {
                            method: 'POST', headers: { 'x-sync-key': process.env.SYNC_SECRET || '' }, signal: deadline,
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || `Proxy HTTP ${response.status}`);
                        results.push({ clan_tag: tag, ok: true, result });
                    } catch (err) {
                        results.push({ clan_tag: tag, ok: false, error: err.message });
                    }
                }
            }));
            return res.status(results.some(row => !row.ok) ? 502 : 200).json({ results });
        }

        // A single request also wakes Render; avoid stacking 35s + 50s
        // of waits inside a function capped at 60s.
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

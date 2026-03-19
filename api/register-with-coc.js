const { createClient } = require('@supabase/supabase-js');

const COC_ROLE_MAP = {
    leader:   'capo',
    coLeader: 'co-capo',
    admin:    'anziano',   // nell'API CoC "admin" = Anziano (Elder)
    member:   'membro',
};

function normalizeTag(raw) {
    const t = raw.trim().toUpperCase();
    return t.startsWith('#') ? t : '#' + t;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { playerTag: rawTag, apiToken, password, email: realEmail } = req.body || {};

    if (!rawTag || !apiToken || !password) {
        return res.status(400).json({ error: 'Tag giocatore, chiave API e password sono obbligatori.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La password deve essere di almeno 6 caratteri.' });
    }

    const proxyUrl = process.env.RENDER_PROXY_URL;
    if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurato.' });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurato.' });

    const playerTag = normalizeTag(rawTag);

    // 1. Verifica token e recupera info giocatore tramite render-proxy (IP fisso whitelistato)
    let player;
    try {
        const proxyRes = await fetch(`${proxyUrl}/verify-player-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sync-key': process.env.SYNC_SECRET || '',
            },
            body: JSON.stringify({ playerTag, apiToken }),
        });
        const proxyData = await proxyRes.json();
        if (!proxyRes.ok) {
            return res.status(proxyRes.status).json({ error: proxyData.error || 'Verifica fallita.' });
        }
        player = proxyData.player;
    } catch (err) {
        return res.status(502).json({ error: 'Impossibile contattare il proxy. Riprova.' });
    }

    // 2. Determina ruolo in base alla posizione nel clan
    const appRole = COC_ROLE_MAP[player.role] || 'membro';
    const username = player.name;

    // 3. Info clan (null se il giocatore non è in nessun clan)
    const clanTag     = player.clan?.tag  || null;
    const clanName    = player.clan?.name || null;
    const clanBadge   = player.clan?.badgeUrls?.medium
                     || player.clan?.badgeUrls?.small
                     || null;

    // 4. Email interna: tag senza # in lowercase
    const emailBase = playerTag.replace('#', '').toLowerCase();
    const email = `${emailBase}@cocboard.internal`;

    // 5. Crea l'utente su Supabase
    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    // Controlla se esiste già un account con questa email
    const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (existing?.users?.some(u => u.email === email)) {
        return res.status(409).json({ error: 'Questo tag è già associato a un account. Accedi con il tuo tag come nome utente.' });
    }

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            role:                appRole,
            username,
            coc_tag:             playerTag,
            coc_clan_tag:        clanTag,
            coc_clan_name:       clanName,
            coc_clan_badge_url:  clanBadge,
            ...(realEmail ? { email: realEmail } : {}),
        }
    });

    if (error) return res.status(500).json({ error: error.message });

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

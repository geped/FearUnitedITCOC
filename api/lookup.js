module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const { type } = req.query;
        let proxyPath;
        if (type === 'player') {
            const tag = req.query.playerTag;
            if (!tag) return res.status(400).json({ error: 'playerTag obbligatorio.' });
            proxyPath = `/player?playerTag=${encodeURIComponent(tag)}`;
        } else if (type === 'search-clans') {
            const q = req.query.q;
            if (!q) return res.status(400).json({ error: 'q obbligatorio.' });
            proxyPath = `/search-clans?q=${encodeURIComponent(q)}`;
        } else if (type === 'rankings') {
            const rankType = req.query.rankType;
            const locationId = req.query.locationId;
            if (!rankType || !locationId) return res.status(400).json({ error: 'rankType e locationId obbligatori.' });
            proxyPath = `/rankings?type=${encodeURIComponent(rankType)}&locationId=${encodeURIComponent(locationId)}`;
        } else if (type === 'locations') {
            proxyPath = '/locations';
        } else if (type === 'current-war') {
            const clanTag = req.query.clanTag;
            if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
            proxyPath = `/current-war?clanTag=${encodeURIComponent(clanTag)}`;
        } else if (type === 'capital-raids') {
            const clanTag = req.query.clanTag;
            if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
            proxyPath = `/capital-raids?clanTag=${encodeURIComponent(clanTag)}`;
        } else if (type === 'proxy-ip') {
            // IP pubblico in uscita del proxy Render (quello da whitelist su developer.clashofclans.com)
            proxyPath = '/myip';
        } else if (type === 'telegram-handoff') {
            const code = (req.query.code || '').trim();
            if (!code || code.length < 16) {
                return res.status(400).json({ error: 'code obbligatorio.' });
            }
            const supabaseUrl = process.env.SUPABASE_URL;
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            const anonKey = process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !serviceKey || !anonKey) {
                return res.status(500).json({ error: 'Supabase non configurato sul server.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const admin = createClient(supabaseUrl, serviceKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data: row, error: selErr } = await admin
                .from('telegram_links')
                .select(
                    'telegram_user_id, auth_access_token, auth_refresh_token, webapp_handoff_code, webapp_handoff_expires_at'
                )
                .eq('webapp_handoff_code', code)
                .maybeSingle();
            if (selErr) {
                return res.status(500).json({ error: selErr.message });
            }
            if (!row || row.webapp_handoff_code !== code) {
                return res.status(401).json({ error: 'Codice non valido o già usato.' });
            }
            const exp = row.webapp_handoff_expires_at ? new Date(row.webapp_handoff_expires_at) : null;
            if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
                await admin
                    .from('telegram_links')
                    .update({ webapp_handoff_code: null, webapp_handoff_expires_at: null })
                    .eq('telegram_user_id', row.telegram_user_id);
                return res.status(401).json({ error: 'Codice scaduto.' });
            }
            if (!row.auth_refresh_token) {
                return res.status(401).json({ error: 'Sessione non disponibile.' });
            }
            let access_token = row.auth_access_token;
            let refresh_token = row.auth_refresh_token;
            try {
                const tokRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
                    method: 'POST',
                    headers: {
                        apikey: anonKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ refresh_token: row.auth_refresh_token }),
                });
                const tokJson = await tokRes.json().catch(() => ({}));
                if (tokRes.ok && tokJson.access_token && tokJson.refresh_token) {
                    access_token = tokJson.access_token;
                    refresh_token = tokJson.refresh_token;
                    await admin
                        .from('telegram_links')
                        .update({
                            auth_access_token: access_token,
                            auth_refresh_token: refresh_token,
                            auth_expires_at: tokJson.expires_at
                                ? new Date(tokJson.expires_at * 1000).toISOString()
                                : null,
                        })
                        .eq('telegram_user_id', row.telegram_user_id);
                }
            } catch (_) {
                /* usa token in DB se refresh fallisce */
            }
            await admin
                .from('telegram_links')
                .update({ webapp_handoff_code: null, webapp_handoff_expires_at: null })
                .eq('telegram_user_id', row.telegram_user_id);
            return res.status(200).json({ access_token, refresh_token });
        } else if (type === 'ping') {
            // Keep-alive esterno verso Render: il self-ping su localhost non evita spin-down / cambio IP.
            const authHeader = req.headers['authorization'] || '';
            const cronSecret = process.env.CRON_SECRET || '';
            const syncSecret = process.env.SYNC_SECRET || '';
            const providedKey = authHeader.replace('Bearer ', '').trim();
            if (!cronSecret && !syncSecret) {
                return res.status(401).json({ error: 'CRON_SECRET o SYNC_SECRET non configurati.' });
            }
            const validCron = cronSecret && providedKey === cronSecret;
            const validSync = syncSecret && providedKey === syncSecret;
            if (!validCron && !validSync) {
                return res.status(401).json({ error: 'Non autorizzato.' });
            }
            // Render cold start può superare 26s; cron-job.org ha max 30s → un solo fetch lungo (meglio di 2×13s).
            const started = Date.now();
            const fetchTimeoutMs = 28000;
            let r;
            let lastErr;
            try {
                r = await fetch(`${proxyUrl}/health`, {
                    signal: AbortSignal.timeout(fetchTimeoutMs),
                });
            } catch (e) {
                lastErr = e;
            }
            if (!r) {
                return res.status(502).json({
                    ok: false,
                    error: lastErr?.message || 'fetch fallita',
                    hint: 'Render cold start o timeout; riprova tra qualche minuto o controlla dashboard Render.',
                });
            }
            const ms = Date.now() - started;
            return res.status(200).json({ ok: r.ok, status: r.status, ms });
        } else if (type === 'session-clan') {
            if (req.method !== 'GET') {
                return res.status(405).json({ error: 'Metodo non consentito.' });
            }
            const authHeader = req.headers.authorization || '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
            if (!token) {
                return res.status(401).json({ error: 'Autenticazione richiesta.' });
            }
            const supabaseUrl = process.env.SUPABASE_URL;
            const anonKey = process.env.SUPABASE_ANON_KEY;
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!supabaseUrl || !anonKey || !serviceKey) {
                return res.status(500).json({ error: 'Supabase non configurato sul server.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const userSb = createClient(supabaseUrl, anonKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data: authData, error: authErr } = await userSb.auth.getUser(token);
            const sbUser = authData?.user;
            if (authErr || !sbUser) {
                return res.status(401).json({ error: 'Token non valido o scaduto.' });
            }
            const normCoCTag = (raw) => {
                if (raw == null || !String(raw).trim()) return null;
                const u = String(raw).trim().toUpperCase().replace(/^#+/, '');
                return u ? `#${u}` : null;
            };
            const meta = sbUser.user_metadata || {};
            let playerTag = normCoCTag(meta.coc_tag);
            const admin = createClient(supabaseUrl, serviceKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data: linkRow } = await admin
                .from('telegram_links')
                .select('player_tag, clan_tag')
                .eq('supabase_user_id', sbUser.id)
                .maybeSingle();
            const savedClan = normCoCTag(linkRow?.clan_tag);
            if (!playerTag && linkRow?.player_tag) {
                playerTag = normCoCTag(linkRow.player_tag);
            }
            const syncKey = process.env.SYNC_SECRET || '';
            const proxyFetch = async (path) => {
                const r = await fetch(`${proxyUrl}${path}`, {
                    headers: { 'x-sync-key': syncKey },
                });
                const data = await r.json().catch(() => ({}));
                return { r, data };
            };
            if (savedClan) {
                const { r, data } = await proxyFetch(`/clan-info?clanTag=${encodeURIComponent(savedClan)}`);
                if (r.ok && data?.tag) {
                    return res.status(200).json({
                        clan: {
                            tag: data.tag,
                            name: data.name,
                            badgeUrls: data.badgeUrls,
                        },
                        source: 'telegram_clan_override',
                    });
                }
                return res.status(200).json({
                    clan: { tag: savedClan, name: savedClan, badgeUrls: null },
                    source: 'telegram_clan_override_minimal',
                });
            }
            if (!playerTag) {
                return res.status(200).json({ clan: null, source: 'no_player_tag' });
            }
            const { r, data } = await proxyFetch(`/player?playerTag=${encodeURIComponent(playerTag)}`);
            if (!r.ok) {
                return res.status(200).json({
                    clan: null,
                    source: 'coc_api_error',
                    detail: data.error || data.reason || String(r.status),
                });
            }
            const c = data.clan;
            if (!c?.tag) {
                return res.status(200).json({ clan: null, source: 'player_not_in_clan' });
            }
            return res.status(200).json({ clan: c, source: 'coc_api' });
        } else {
            return res.status(400).json({
                error:
                    'type non valido. Usa: player, search-clans, rankings, locations, current-war, proxy-ip, ping, telegram-handoff, session-clan',
            });
        }
        const r = await fetch(`${proxyUrl}${proxyPath}`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok && data && typeof data === 'object' && data.error == null) {
            const msg =
                data.message ||
                (data.reason && data.message ? `${data.reason}: ${data.message}` : data.reason) ||
                'Errore proxy CoC';
            data.error = typeof msg === 'string' ? msg : JSON.stringify(data);
        }
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

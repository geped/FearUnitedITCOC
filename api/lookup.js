// Cache bot username per l'intera vita dell'istanza serverless.
let _cachedBotUsername = null;
async function fetchBotUsername(botToken) {
    if (_cachedBotUsername) return _cachedBotUsername;
    try {
        const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
            signal: AbortSignal.timeout(4000),
        });
        const d = await r.json().catch(() => ({}));
        if (d.ok && d.result?.username) _cachedBotUsername = d.result.username;
    } catch (_) {}
    return _cachedBotUsername;
}

/**
 * Valida Telegram Mini App initData (HMAC-SHA256).
 * @returns {number|null} Telegram user id del chiamante, o null se non valido.
 */
function parseTelegramInitData(initData, botToken) {
    const crypto = require('crypto');
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) return null;
        params.delete('hash');
        const checkString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const expected = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
        if (hash !== expected) return null;
        const authDate = Number(params.get('auth_date') || 0);
        if (Date.now() / 1000 - authDate > 86400) return null; // scaduto dopo 24h
        const userData = JSON.parse(params.get('user') || '{}');
        return Number(userData.id || 0) || null;
    } catch (_) {
        return null;
    }
}

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
        } else if (type === 'recruit-list') {
            // Lista pubblica annunci reclutamento attivi.
            // Fa JOIN con telegram_recruitment_submissions per ottenere body_html pulito,
            // clan_profile_url e submitter_display separatamente dal post_text.
            const supabaseUrl = process.env.SUPABASE_URL;
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!supabaseUrl || !serviceKey) {
                return res.status(500).json({ error: 'Supabase non configurato.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const admin = createClient(supabaseUrl, serviceKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const nowIso = new Date().toISOString();
            const { data: rows, error: dbErr } = await admin
                .from('telegram_recruitment_posts')
                .select([
                    'id',
                    'post_text',
                    'photo_file_id',
                    'approved_at',
                    'expires_at',
                    'submitter_telegram_user_id',
                    'telegram_recruitment_submissions(body_html, body_text, clan_profile_url, submitter_display, tg_contact_1, tg_contact_2)',
                ].join(', '))
                .gt('expires_at', nowIso)
                .order('approved_at', { ascending: false })
                .limit(20);
            if (dbErr) return res.status(500).json({ error: dbErr.message });
            const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
            const recruitSyncKey = process.env.SYNC_SECRET || '';
            const ownerIdsRaw = (process.env.BOT_OWNER_TELEGRAM_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);

            // Recupera username bot (per deep link "Rimuovi" da browser).
            const botUsername = botToken ? await fetchBotUsername(botToken) : null;

            function escHtml(s) {
                return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }

            /** A capo nel testo Telegram → <br> per la pagina web (senza rompere <pre>). */
            function bodyHtmlForWebDisplay(html) {
                if (html == null) return '';
                const s = String(html);
                if (!s.trim()) return s;
                if (/<\s*pre\b/i.test(s)) return s;
                return s.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
            }

            // Estrae #CLANTAG dal link clashofclans.com nel post_text (fallback badge)
            function extractTagFromPost(html) {
                const m = (html || '').match(/[?&]tag=([0-9A-Za-z]+)/);
                return m ? '#' + m[1].toUpperCase() : null;
            }

            // Cache badge per clan (fallback se manca clan_profile_url)
            const badgeCache = new Map();
            async function fetchClanBadge(tag) {
                if (badgeCache.has(tag)) return badgeCache.get(tag);
                try {
                    const r = await fetch(proxyUrl + '/clan-info?clanTag=' + encodeURIComponent(tag),
                        { headers: { 'x-sync-key': recruitSyncKey }, signal: AbortSignal.timeout(5000) });
                    if (!r.ok) { badgeCache.set(tag, null); return null; }
                    const d = await r.json().catch(() => ({}));
                    const url = (d.badgeUrls && (d.badgeUrls.medium || d.badgeUrls.large || d.badgeUrls.small)) || null;
                    badgeCache.set(tag, url);
                    return url;
                } catch (_) { badgeCache.set(tag, null); return null; }
            }

            const posts = await Promise.all((rows || []).map(async (r) => {
                const sub = r.telegram_recruitment_submissions;
                // Corpo pulito: body_html dalla submission (già HTML Telegram), o body_text escaped.
                let body_html = '';
                if (sub?.body_html && String(sub.body_html).trim()) {
                    body_html = sub.body_html;
                } else if (sub?.body_text) {
                    body_html = escHtml(sub.body_text);
                } else {
                    // Fallback: strappa header e link dal post_text legacy
                    let txt = r.post_text || '';
                    const bodyStart = txt.indexOf('\n\n');
                    if (bodyStart >= 0) txt = txt.slice(bodyStart + 2);
                    const linkIdx = txt.lastIndexOf('\n\n🔗');
                    if (linkIdx >= 0) txt = txt.slice(0, linkIdx);
                    body_html = txt.trim();
                }

                body_html = bodyHtmlForWebDisplay(body_html);

                const clan_url = sub?.clan_profile_url || null;
                const submitter_display = sub?.submitter_display || null;
                const is_verified_clan = Boolean(r.post_text && r.post_text.includes('Clan CoCBoard'));

                let photo_url = null;
                const fid = r.photo_file_id || '';
                if (fid) {
                    if (fid.startsWith('https://')) {
                        photo_url = fid;
                    } else if (botToken) {
                        photo_url = '/api/lookup?type=rphoto&pid=' + encodeURIComponent(String(r.id));
                    }
                }
                // Nessuna foto utente: mostra stemma clan se ricavabile
                if (!photo_url && clan_url) {
                    const tag = extractTagFromPost(clan_url);
                    if (tag) photo_url = await fetchClanBadge(tag);
                }
                if (!photo_url && !clan_url) {
                    const tag = extractTagFromPost(r.post_text);
                    if (tag) photo_url = await fetchClanBadge(tag);
                }

                const tg_contacts = [sub?.tg_contact_1, sub?.tg_contact_2].filter(Boolean);
                return {
                    id: r.id,
                    body_html,
                    clan_url,
                    submitter_display,
                    submitter_tg_id: r.submitter_telegram_user_id || null,
                    is_verified_clan,
                    photo_url,
                    tg_contacts,
                    approved_at: r.approved_at,
                    expires_at: r.expires_at,
                };
            }));
            return res.status(200).json({ posts, bot_username: botUsername, owner_ids: ownerIdsRaw });
        } else if (type === 'rphoto') {
            // Proxy immagine annuncio reclutamento (Telegram file_id → bytes). Evita URL con token in <img> e problemi 403/referrer sul CDN Telegram.
            if (req.method !== 'GET') {
                return res.status(405).json({ error: 'Metodo non consentito.' });
            }
            const rawId = String(req.query.pid || req.query.id || '').trim();
            if (!rawId || !/^\d+$/.test(rawId)) {
                return res.status(400).json({ error: 'pid obbligatorio.' });
            }
            const supabaseUrl = process.env.SUPABASE_URL;
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!supabaseUrl || !serviceKey) {
                return res.status(500).json({ error: 'Supabase non configurato.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const admin = createClient(supabaseUrl, serviceKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const nowIso = new Date().toISOString();
            const { data: row, error: rowErr } = await admin
                .from('telegram_recruitment_posts')
                .select('photo_file_id')
                .eq('id', Number(rawId))
                .gt('expires_at', nowIso)
                .maybeSingle();
            if (rowErr) {
                res.setHeader('X-Error-Reason', 'db-error');
                return res.status(500).json({ error: 'Errore DB: ' + rowErr.message });
            }
            if (!row) {
                res.setHeader('X-Error-Reason', 'post-not-found');
                return res.status(404).json({ error: 'Annuncio non trovato o scaduto.' });
            }
            if (!row.photo_file_id) {
                res.setHeader('X-Error-Reason', 'no-photo');
                return res.status(404).json({ error: 'Questo annuncio non ha foto.' });
            }
            const fid = String(row.photo_file_id).trim();
            const botTok = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

            async function sendBytes(buf, contentType, cacheSec) {
                res.setHeader('Content-Type', contentType || 'application/octet-stream');
                res.setHeader('Cache-Control', 'public, max-age=' + cacheSec + ', s-maxage=' + cacheSec);
                return res.status(200).send(buf);
            }

            if (fid.startsWith('https://')) {
                try {
                    const upstream = await fetch(fid, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
                    if (!upstream.ok) {
                        res.setHeader('X-Error-Reason', 'upstream-http-' + upstream.status);
                        return res.status(502).json({ error: 'Upstream HTTP ' + upstream.status });
                    }
                    const ct = upstream.headers.get('content-type') || 'image/jpeg';
                    const buf = Buffer.from(await upstream.arrayBuffer());
                    return sendBytes(buf, ct, 3600);
                } catch (e) {
                    res.setHeader('X-Error-Reason', 'upstream-fetch-error');
                    return res.status(502).json({ error: 'Errore fetch immagine: ' + (e.message || 'timeout') });
                }
            }
            if (!botTok) {
                res.setHeader('X-Error-Reason', 'no-bot-token');
                return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN non configurato su Vercel.' });
            }
            let filePath;
            try {
                const tgRes = await fetch(
                    'https://api.telegram.org/bot' + botTok + '/getFile?file_id=' + encodeURIComponent(fid),
                    { signal: AbortSignal.timeout(12000) }
                );
                const tgData = await tgRes.json().catch(() => ({}));
                if (!tgRes.ok || !tgData.ok || !tgData.result || !tgData.result.file_path) {
                    const tgErr = tgData.description || ('HTTP ' + tgRes.status);
                    res.setHeader('X-Error-Reason', 'getfile-failed');
                    return res.status(404).json({ error: 'Telegram getFile fallito: ' + tgErr });
                }
                filePath = tgData.result.file_path;
            } catch (e) {
                res.setHeader('X-Error-Reason', 'getfile-timeout');
                return res.status(502).json({ error: 'Timeout getFile Telegram: ' + (e.message || 'timeout') });
            }
            const fileUrl =
                'https://api.telegram.org/file/bot' +
                botTok +
                '/' +
                String(filePath).split('/').map(encodeURIComponent).join('/');
            try {
                const imgRes = await fetch(fileUrl, { signal: AbortSignal.timeout(25000) });
                if (!imgRes.ok) {
                    res.setHeader('X-Error-Reason', 'imgdownload-http-' + imgRes.status);
                    return res.status(502).json({ error: 'Download immagine Telegram HTTP ' + imgRes.status });
                }
                const ct = imgRes.headers.get('content-type') || 'image/jpeg';
                const buf = Buffer.from(await imgRes.arrayBuffer());
                return sendBytes(buf, ct, 1800);
            } catch (e) {
                res.setHeader('X-Error-Reason', 'imgdownload-error');
                return res.status(502).json({ error: 'Errore download immagine: ' + (e.message || 'timeout') });
            }
        } else if (type === 'recruit-remove') {
            // Rimozione annuncio da Mini App (initData) o da bot deep-link (non serve auth qui).
            // Solo POST/DELETE.
            if (req.method !== 'POST' && req.method !== 'DELETE') {
                return res.status(405).json({ error: 'Metodo non consentito.' });
            }
            const rawId = String(req.query.pid || '').trim();
            if (!rawId || !/^\d+$/.test(rawId)) {
                return res.status(400).json({ error: 'pid obbligatorio.' });
            }
            const botTokRem = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
            if (!botTokRem) {
                return res.status(503).json({ error: 'Bot non configurato.' });
            }
            const ownerIdsEnv = (process.env.BOT_OWNER_TELEGRAM_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
            const authHdr = req.headers['authorization'] || '';
            const initDataRaw = authHdr.startsWith('tma ') ? authHdr.slice(4).trim() : null;
            if (!initDataRaw) {
                return res.status(401).json({ error: 'initData Telegram richiesto.' });
            }
            const callerTgId = parseTelegramInitData(initDataRaw, botTokRem);
            if (!callerTgId) {
                return res.status(401).json({ error: 'initData non valido o scaduto.' });
            }
            const supabaseUrlR = process.env.SUPABASE_URL;
            const serviceKeyR = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!supabaseUrlR || !serviceKeyR) {
                return res.status(500).json({ error: 'Supabase non configurato.' });
            }
            const { createClient: createClientR } = require('@supabase/supabase-js');
            const adminR = createClientR(supabaseUrlR, serviceKeyR, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const nowIsoR = new Date().toISOString();
            const { data: postRow, error: postErr } = await adminR
                .from('telegram_recruitment_posts')
                .select('id, submitter_telegram_user_id')
                .eq('id', Number(rawId))
                .gt('expires_at', nowIsoR)
                .maybeSingle();
            if (postErr) return res.status(500).json({ error: 'Errore DB: ' + postErr.message });
            if (!postRow) return res.status(404).json({ error: 'Annuncio non trovato o già scaduto.' });
            const isOwner = ownerIdsEnv.includes(callerTgId);
            const isSubmitter = postRow.submitter_telegram_user_id === callerTgId;
            if (!isOwner && !isSubmitter) {
                return res.status(403).json({ error: 'Non sei il proprietario di questo annuncio.' });
            }
            const { error: delErr } = await adminR
                .from('telegram_recruitment_posts')
                .delete()
                .eq('id', Number(rawId));
            if (delErr) return res.status(500).json({ error: 'Errore rimozione: ' + delErr.message });
            return res.status(200).json({ ok: true });
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
        } else if (
          type === 'profiles' ||
          type === 'profiles-bootstrap' ||
          type === 'profiles-switch' ||
          type === 'profiles-set-default' ||
          type === 'profiles-always-ask' ||
          type === 'profiles-mini-app' ||
          type === 'profiles-remove' ||
          type === 'resolve-login'
        ) {
            const profilesUtil = require('./_utils/user-profiles');

            if (type === 'resolve-login') {
                if (req.method !== 'POST' && req.method !== 'GET') {
                    return res.status(405).json({ error: 'Metodo non consentito.' });
                }
                const input =
                    (req.method === 'POST' ? (req.body && req.body.username) : null) ||
                    req.query.username ||
                    req.query.q ||
                    '';
                try {
                    const email = await profilesUtil.resolveLoginEmailFromInput(input);
                    if (!email) return res.status(400).json({ error: 'username obbligatorio.' });
                    return res.status(200).json({ ok: true, email });
                } catch (e) {
                    return res.status(500).json({ error: e.message });
                }
            }

            const token = profilesUtil.bearerFromReq(req);
            if (!token) return res.status(401).json({ error: 'Autenticazione richiesta.' });

            let user;
            try {
                user = await profilesUtil.getUserFromJwt(token);
            } catch (e) {
                return res.status(e.status || 401).json({ error: e.message });
            }

            try {
                if (type === 'profiles' || type === 'profiles-bootstrap') {
                    if (req.method !== 'GET' && req.method !== 'POST') {
                        return res.status(405).json({ error: 'Metodo non consentito.' });
                    }
                    const data = await profilesUtil.bootstrapForUser(user);
                    return res.status(200).json(data);
                }

                if (type === 'profiles-switch') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id || body.profileId;
                    if (!profileId) return res.status(400).json({ error: 'profile_id obbligatorio.' });
                    const data = await profilesUtil.switchActiveProfile(user, profileId, {
                        setDefault: body.set_default === true || body.setDefault === true,
                        clearAlwaysAsk: body.clear_always_ask === true,
                        metadataOnly: body.metadata_only === true || body.metadataOnly === true,
                    });
                    return res.status(200).json(data);
                }

                if (type === 'profiles-set-default') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id ?? body.profileId ?? null;
                    const data = await profilesUtil.setDefaultProfile(user, profileId || null);
                    return res.status(200).json(data);
                }

                if (type === 'profiles-always-ask') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const data = await profilesUtil.setAlwaysAsk(
                        user,
                        body.always_ask === true || body.alwaysAsk === true,
                    );
                    return res.status(200).json(data);
                }

                if (type === 'profiles-mini-app') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id ?? body.profileId ?? null;
                    const data = await profilesUtil.setMiniAppProfile(user, profileId || null);
                    return res.status(200).json(data);
                }

                if (type === 'profiles-remove') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id || body.profileId;
                    if (!profileId) return res.status(400).json({ error: 'profile_id obbligatorio.' });
                    const data = await profilesUtil.removeProfile(user, profileId);
                    return res.status(200).json(data);
                }
            } catch (e) {
                return res.status(e.status || 500).json({
                    error: e.message || 'Errore profili.',
                    code: e.code || undefined,
                });
            }
            return res.status(400).json({ error: 'type profili non gestito.' });
        } else if (
          type === 'cards-catalog' ||
          type === 'cards-get' ||
          type === 'cards-save' ||
          type === 'cards-admin-toggle' ||
          type === 'cards-matches' ||
          type === 'cards-self-matches' ||
          type === 'cards-rooms' ||
          type === 'cards-room-open' ||
          type === 'cards-room-detail' ||
          type === 'cards-room-send' ||
          type === 'cards-propose' ||
          type === 'cards-respond' ||
          type === 'cards-self-apply' ||
          type === 'cards-trade-log' ||
          type === 'cards-public-list' ||
          type === 'cards-public-toggle'
        ) {
            const cardEvent = require('./_utils/card-event');
            const cardTrades = require('./_utils/card-trades');
            const profilesUtil = require('./_utils/user-profiles');
            const admin = profilesUtil.adminClient();

            if (type === 'cards-catalog') {
                if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                try {
                    const settings = await cardEvent.getSettings(admin);
                    return res.status(200).json(cardEvent.catalogPayload(settings));
                } catch (e) {
                    return res.status(500).json({ error: e.message });
                }
            }

            const token = profilesUtil.bearerFromReq(req);
            if (!token) return res.status(401).json({ error: 'Autenticazione richiesta.' });
            let user;
            try {
                user = await profilesUtil.getUserFromJwt(token);
            } catch (e) {
                return res.status(e.status || 401).json({ error: e.message });
            }

            try {
                if (type === 'cards-get') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const settings = await cardEvent.getSettings(admin);
                    const data = await cardEvent.getCollectionsForUser(admin, user.id);
                    return res.status(200).json({
                        ok: true,
                        ...data,
                        settings: { enabled: settings.enabled === true, ends_at: settings.ends_at, live: cardEvent.isEventLive(settings) },
                    });
                }

                if (type === 'cards-save') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const cocTag = body.coc_tag || body.cocTag;
                    const cardKey = body.card_key || body.cardKey;
                    const qtyState = body.qty_state ?? body.qtyState;
                    if (!cocTag || !cardKey || qtyState == null) {
                        return res.status(400).json({ error: 'coc_tag, card_key e qty_state sono obbligatori.' });
                    }
                    const data = await cardEvent.saveCardState(admin, user, { cocTag, cardKey, qtyState });
                    return res.status(200).json(data);
                }

                if (type === 'cards-admin-toggle') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const isAdmin = profilesUtil.isAccountAdminFromUser(user, await profilesUtil.getPrefs(admin, user.id));
                    if (!isAdmin) return res.status(403).json({ error: 'Solo admin.' });
                    const body = req.body || {};
                    const data = await cardEvent.setEnabled(admin, body.enabled === true);
                    return res.status(200).json({ ok: true, settings: data });
                }

                if (type === 'cards-matches') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const profileId = req.query.profile_id || req.query.profileId;
                    if (!profileId) return res.status(400).json({ error: 'profile_id obbligatorio.' });
                    const data = await cardTrades.getMatchesForProfile(admin, user, profileId);
                    return res.status(200).json(data);
                }

                if (type === 'cards-self-matches') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const data = await cardTrades.getSelfMatches(admin, user);
                    return res.status(200).json(data);
                }

                if (type === 'cards-rooms') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const data = await cardTrades.listRoomsForUser(admin, user);
                    return res.status(200).json(data);
                }

                if (type === 'cards-room-open') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id || body.profileId;
                    const otherCocTag = body.other_coc_tag || body.otherCocTag;
                    if (!profileId || !otherCocTag) {
                        return res.status(400).json({ error: 'profile_id e other_coc_tag sono obbligatori.' });
                    }
                    const data = await cardTrades.getOrCreateRoom(admin, user, profileId, otherCocTag);
                    return res.status(200).json(data);
                }

                if (type === 'cards-room-detail') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const roomId = req.query.room_id || req.query.roomId;
                    if (!roomId) return res.status(400).json({ error: 'room_id obbligatorio.' });
                    const data = await cardTrades.getRoomDetail(admin, user, roomId);
                    return res.status(200).json(data);
                }

                if (type === 'cards-room-send') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const roomId = body.room_id || body.roomId;
                    const profileId = body.profile_id || body.profileId;
                    if (!roomId || !profileId || !body.body) {
                        return res.status(400).json({ error: 'room_id, profile_id e body sono obbligatori.' });
                    }
                    const data = await cardTrades.sendRoomMessage(admin, user, roomId, profileId, body.body);
                    return res.status(200).json(data);
                }

                if (type === 'cards-propose') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const roomId = body.room_id || body.roomId;
                    const profileId = body.profile_id || body.profileId;
                    const cardGive = body.card_give || body.cardGive;
                    const cardGet = body.card_get || body.cardGet;
                    if (!roomId || !profileId || !cardGive || !cardGet) {
                        return res.status(400).json({ error: 'room_id, profile_id, card_give e card_get sono obbligatori.' });
                    }
                    const data = await cardTrades.proposeTrade(admin, user, roomId, profileId, cardGive, cardGet);
                    return res.status(200).json(data);
                }

                if (type === 'cards-respond') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const proposalId = body.proposal_id || body.proposalId;
                    const profileId = body.profile_id || body.profileId;
                    const action = body.action;
                    if (!proposalId || !profileId || !['accept', 'reject', 'cancel'].includes(action)) {
                        return res.status(400).json({ error: 'proposal_id, profile_id e action (accept|reject|cancel) sono obbligatori.' });
                    }
                    const data = await cardTrades.respondProposal(admin, user, proposalId, profileId, action);
                    return res.status(200).json(data);
                }

                if (type === 'cards-self-apply') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileA = body.profile_a || body.profileA;
                    const profileB = body.profile_b || body.profileB;
                    const cardAToB = body.card_a_to_b || body.cardAToB;
                    const cardBToA = body.card_b_to_a || body.cardBToA;
                    if (!profileA || !profileB || !cardAToB || !cardBToA) {
                        return res.status(400).json({ error: 'profile_a, profile_b, card_a_to_b e card_b_to_a sono obbligatori.' });
                    }
                    const data = await cardTrades.applySelfTrade(admin, user, profileA, profileB, cardAToB, cardBToA);
                    return res.status(200).json(data);
                }

                if (type === 'cards-trade-log') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const data = await cardTrades.getTradeLog(admin, user);
                    return res.status(200).json(data);
                }

                if (type === 'cards-public-list') {
                    if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const profileId = req.query.profile_id || req.query.profileId;
                    if (!profileId) return res.status(400).json({ error: 'profile_id obbligatorio.' });
                    const data = await cardTrades.listPublicDecks(admin, user, profileId);
                    return res.status(200).json(data);
                }

                if (type === 'cards-public-toggle') {
                    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
                    const body = req.body || {};
                    const profileId = body.profile_id || body.profileId;
                    if (!profileId) return res.status(400).json({ error: 'profile_id obbligatorio.' });
                    const data = await cardTrades.setProfilePublic(admin, user, profileId, body.is_public === true || body.isPublic === true);
                    return res.status(200).json(data);
                }
            } catch (e) {
                return res.status(e.status || 500).json({ error: e.message || 'Errore evento carte.', code: e.code || undefined });
            }
            return res.status(400).json({ error: 'type cards non gestito.' });
        } else {
            return res.status(400).json({
                error:
                    'type non valido. Usa: player, search-clans, rankings, locations, current-war, proxy-ip, ping, telegram-handoff, session-clan, recruit-list, rphoto, profiles, profiles-switch, resolve-login, cards-catalog, cards-get, cards-save, cards-matches, cards-self-matches, cards-rooms, cards-room-open, cards-room-detail, cards-room-send, cards-propose, cards-respond, cards-self-apply, cards-trade-log, cards-public-list, cards-public-toggle',
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

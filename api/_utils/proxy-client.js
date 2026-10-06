const fetch = require('../../shared/fetch-with-timeout').createBoundedFetch(45000);
/**
 * Client condiviso per le chiamate al render-proxy.
 * Centralizza URL, headers e gestione errori — evita duplicazione negli endpoint Vercel.
 *
 * Uso:
 *   const { proxyFetch } = require('./_utils/proxy-client');
 *   const data = await proxyFetch(res, '/clan-info', { clanTag });
 */

/**
 * Chiama il render-proxy e restituisce il JSON parsato.
 * In caso di errore scrive direttamente la risposta HTTP tramite `res` e restituisce null.
 *
 * @param {object} res      - Vercel response object
 * @param {string} path     - Path sul proxy (es. '/clan-info')
 * @param {object} params   - Query params da aggiungere (es. { clanTag: '#ABC' })
 * @returns {object|null}   - JSON del proxy, oppure null se già risposto con errore
 */
async function proxyFetch(res, path, params = {}) {
    const proxyUrl = process.env.RENDER_PROXY_URL;
    if (!proxyUrl) {
        res.status(500).json({ error: 'RENDER_PROXY_URL non configurata su Vercel.' });
        return null;
    }

    const qs = Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const url = `${proxyUrl}${path}${qs ? '?' + qs : ''}`;

    try {
        const response = await fetch(url, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' }
        });

        const data = await response.json();

        if (!response.ok) {
            res.status(response.status).json({ error: data.error || `Proxy error ${response.status}` });
            return null;
        }

        return data;
    } catch (err) {
        const timeout = ['TimeoutError', 'AbortError'].includes(err.name);
        res.setHeader('Cache-Control', 'no-store');
        if (timeout) res.setHeader('Retry-After', '30');
        console.error('[proxy-fetch]', { path, code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR' });
        res.status(timeout ? 503 : 502).json({
            error: timeout ? 'Il server è in avvio o non risponde. Riprova tra 30 secondi.' : 'Risposta del server non disponibile.',
            code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
        });
        return null;
    }
}

module.exports = { proxyFetch };

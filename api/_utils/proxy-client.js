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

    const response = await fetch(url, {
        headers: { 'x-sync-key': process.env.SYNC_SECRET || '' }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        res.status(response.status).json({ error: data.error || `Proxy error ${response.status}` });
        return null;
    }

    return data;
}

module.exports = { proxyFetch };

/**
 * Keep-alive per il render-proxy su Render.com (piano gratuito).
 * Pinga il proxy ogni 14 minuti per evitare lo spin-down (15min di inattività).
 * Chiamato dal cron Vercel definito in vercel.json.
 */
module.exports = async (_req, res) => {
    const proxyUrl = process.env.RENDER_PROXY_URL;
    if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });

    try {
        const start = Date.now();
        const response = await fetch(`${proxyUrl}/health`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
            signal: AbortSignal.timeout(10000)
        });
        const ms = Date.now() - start;
        res.status(200).json({ ok: true, status: response.status, ms });
    } catch (err) {
        // Non critico — il proxy potrebbe essere in cold start proprio ora
        res.status(200).json({ ok: false, error: err.message });
    }
};

module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const { type, locationId } = req.query;
        if (!type || !locationId) return res.status(400).json({ error: 'type e locationId obbligatori.' });
        const r = await fetch(
            `${proxyUrl}/rankings?type=${encodeURIComponent(type)}&locationId=${encodeURIComponent(locationId)}`,
            { headers: { 'x-sync-key': process.env.SYNC_SECRET || '' } }
        );
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

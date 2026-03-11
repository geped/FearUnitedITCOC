module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });

        const response = await fetch(`${proxyUrl}/war-log`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' }
        });
        const data = await response.json();
        if (!response.ok) {
            // Pass through reason field so frontend can distinguish accessDenied vs server error
            return res.status(response.status).json(data);
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

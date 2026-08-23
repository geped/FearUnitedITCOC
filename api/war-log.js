const { proxyFetch } = require('./_utils/proxy-client');

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        const type = req.query.type;

        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });

        if (type === 'current') {
            const data = await proxyFetch(res, '/current-war', { clanTag });
            if (data) {
                // Guerra live: cache breve, sufficiente ad assorbire refresh multipli
                // ravvicinati (countdown, più utenti sulla stessa guerra).
                res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
                res.status(200).json(data);
            }
        } else {
            const data = await proxyFetch(res, '/war-log', { clanTag });
            if (data) {
                // Storico guerre: cambia solo a fine guerra, cache più lunga.
                res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800');
                res.status(200).json(data);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

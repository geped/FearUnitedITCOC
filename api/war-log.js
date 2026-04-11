const { proxyFetch } = require('./_utils/proxy-client');

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        const type = req.query.type;

        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });

        if (type === 'current') {
            const data = await proxyFetch(res, '/current-war', { clanTag });
            if (data) res.status(200).json(data);
        } else {
            const data = await proxyFetch(res, '/war-log', { clanTag });
            if (data) res.status(200).json(data);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

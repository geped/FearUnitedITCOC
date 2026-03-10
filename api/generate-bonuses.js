const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

function calculateMerit(stats, history) {
    let score = (stats.stars || 0) * 100 + (stats.destructionPercentage || 0);
    if (stats.attacksRequired != null && stats.attacksMade != null) {
        score -= (stats.attacksRequired - stats.attacksMade) * 500;
    }
    if (history?.received_last_month) score = 0;
    return Math.max(score, 0);
}

module.exports = async (_req, res) => {
    try {
        const { data: members } = await supabase.from('members').select('*');
        const { data: history } = await supabase.from('cwl_bonuses').select('*');

        const historyMap = {};
        (history || []).forEach(h => { historyMap[h.tag] = h; });

        const computed = (members || []).map(m => {
            const stats = { stars: 0, destructionPercentage: 0, attacksMade: 0, attacksRequired: 0 };
            return { ...m, score: calculateMerit(stats, historyMap[m.tag]) };
        }).sort((a, b) => b.score - a.score);

        const { error } = await supabase.from('cwl_bonuses').upsert(
            computed.map((m, idx) => ({
                tag: m.tag, name: m.name, score: m.score, rank: idx + 1,
                assigned_at: new Date().toISOString(), received_last_month: false
            })),
            { onConflict: 'tag' }
        );
        if (error) throw new Error(error.message);

        res.status(200).json({ ok: true, count: computed.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

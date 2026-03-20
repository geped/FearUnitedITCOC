const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Formula merito CWL — allineata con app.js Bonus Manager
// merit = (stelle / attacchi_richiesti) * 40
//       + (distruzione_media%) * 0.2
//       + (attacchi_effettuati / attacchi_richiesti) * 20
// Max teorico: ~60.2 punti (tutti gli attacchi, stelle perfette, 100% distruzione)
// Se il giocatore ha ricevuto il bonus il mese scorso → score = 0 (anti-duplicati)
function calculateMerit(stats, history) {
    const req  = Math.max(stats.attacksRequired || 0, 1);
    const made = stats.attacksMade || 0;
    const avgD = made > 0 ? (stats.destructionPercentage || 0) / made : 0;
    let score  = (stats.stars / req) * 40 + avgD * 0.2 + (made / req) * 20;
    if (history?.received_last_month) score = 0;
    return Math.round(score * 10) / 10;
}

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag || req.body?.clanTag || null;

        // Leggi membri attivi
        const membersQ = supabase.from('members').select('*');
        if (clanTag) membersQ.eq('clan_tag', clanTag);
        const { data: members } = await membersQ;

        // Leggi storico bonus (anti-duplicati mese scorso)
        const bonusQ = supabase.from('cwl_bonuses').select('*');
        if (clanTag) bonusQ.eq('clan_tag', clanTag);
        const { data: bonusHistory } = await bonusQ;
        const bonusMap = {};
        (bonusHistory || []).forEach(h => { bonusMap[h.tag] = h; });

        // Leggi stats CWL dell'ultima stagione disponibile
        const seasonQ = supabase.from('cwl_history')
            .select('season').order('season', { ascending: false }).limit(1);
        if (clanTag) seasonQ.eq('clan_tag', clanTag);
        const { data: latestSeasonData } = await seasonQ;
        const latestSeason = latestSeasonData?.[0]?.season || null;

        const cwlStatsMap = {};
        if (latestSeason) {
            const statsQ = supabase.from('cwl_history')
                .select('player_name, stars, destruction, attacks_made, attacks_required, bonus_score')
                .eq('season', latestSeason);
            if (clanTag) statsQ.eq('clan_tag', clanTag);
            const { data: cwlStats } = await statsQ;
            (cwlStats || []).forEach(s => { cwlStatsMap[s.player_name] = s; });
        }

        const computed = (members || []).map(m => {
            const cwl = cwlStatsMap[m.name] || {};
            const stats = {
                stars:                cwl.stars || 0,
                destructionPercentage: cwl.destruction || 0,
                attacksMade:          cwl.attacks_made || 0,
                attacksRequired:      cwl.attacks_required || 0
            };
            return { ...m, score: calculateMerit(stats, bonusMap[m.tag]) };
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

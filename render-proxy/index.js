const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const COC_CLAN_TAG = '%232J2VLPP9R';
const COC_CLAN_TAG_RAW = '#2J2VLPP9R';

function supabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function cocHeaders() {
    return { Authorization: `Bearer ${process.env.COC_API_TOKEN}` };
}

// ── SYNC MEMBERS ────────────────────────────────────────────────────────────

async function syncMembers() {
    const res = await fetch(
        `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/members`,
        { headers: cocHeaders() }
    );
    if (!res.ok) throw new Error(`CoC API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const members = (data.items || []).map(m => ({
        tag: m.tag,
        name: m.name,
        role: m.role,
        th_level: m.townHallLevel ?? null,
        trophies: m.trophies ?? null,
        donations: m.donations ?? null,
        donations_received: m.donationsReceived ?? null,
        exp_level: m.expLevel ?? null,
        clan_rank: m.clanRank ?? null
    }));
    const { error } = await supabase().from('members').upsert(members, { onConflict: 'tag' });
    if (error) throw new Error(error.message);
    return members.length;
}

// ── MAPPA NOMI LEGA EN → IT ──────────────────────────────────────────────────

const LEAGUE_EN_TO_IT = {
    'Bronze League III':'Bronzo III','Bronze League II':'Bronzo II','Bronze League I':'Bronzo I',
    'Silver League III':'Argento III','Silver League II':'Argento II','Silver League I':'Argento I',
    'Gold League III':'Oro III','Gold League II':'Oro II','Gold League I':'Oro I',
    'Crystal League III':'Cristallo III','Crystal League II':'Cristallo II','Crystal League I':'Cristallo I',
    'Master League III':'Maestro III','Master League II':'Maestro II','Master League I':'Maestro I',
    'Champion League III':'Campione III','Champion League II':'Campione II','Champion League I':'Campione I',
    'Titan League III':'Titano III','Titan League II':'Titano II','Titan League I':'Titano I',
    'Legend League':'Leggenda'
};

// ── CWL LIVE STATS ──────────────────────────────────────────────────────────

async function getCwlStats() {
    // 1. Leaguegroup + clan info in parallelo
    const [lgRes, clanRes] = await Promise.all([
        fetch(`https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/currentwar/leaguegroup`, { headers: cocHeaders() }),
        fetch(`https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}`, { headers: cocHeaders() })
    ]);

    if (!lgRes.ok) {
        const text = await lgRes.text();
        if (lgRes.status === 404) return { state: 'notInWar', players: [] };
        throw new Error(`LeagueGroup API ${lgRes.status}: ${text}`);
    }
    const lg = await lgRes.json();
    if (lg.state === 'notInWar') return { state: 'notInWar', players: [] };

    const clanData = clanRes.ok ? await clanRes.json() : null;
    const leagueNameEn = clanData?.warLeague?.name || null;
    const leagueNameIt = leagueNameEn ? (LEAGUE_EN_TO_IT[leagueNameEn] || leagueNameEn) : null;

    // 2. Trova il nostro clan nel gruppo
    const myClan = (lg.clans || []).find(c => c.tag === COC_CLAN_TAG_RAW);
    if (!myClan) return { state: 'notInWar', players: [] };

    // Inizializza stats giocatori
    const stats = {};
    (myClan.members || []).forEach(m => {
        stats[m.tag] = {
            tag: m.tag, name: m.name, th_level: m.townHallLevel,
            stars: 0, destruction: 0, attacks_made: 0, attacks_required: 0
        };
    });

    // Inizializza classifica gruppo (tutti e 8 i clan)
    const groupMap = {};
    (lg.clans || []).forEach(c => {
        groupMap[c.tag] = { tag: c.tag, name: c.name, stars: 0, totalDestr: 0, warCount: 0 };
    });

    // 3. Fetch tutte le guerre in parallelo
    const warTags = (lg.rounds || []).flatMap(r => r.warTags || []).filter(t => t !== '#0');
    const warResults = await Promise.all(warTags.map(async wt => {
        const r = await fetch(
            `https://api.clashofclans.com/v1/clanwarleagues/wars/${encodeURIComponent(wt)}`,
            { headers: cocHeaders() }
        );
        if (!r.ok) return null;
        const w = await r.json();
        return w.state === 'notInWar' ? null : w;
    }));

    for (const war of warResults) {
        if (!war) continue;
        const isEnded = war.state === 'warEnded' || war.state === 'ended';

        // Aggiorna classifica gruppo
        for (const side of [war.clan, war.opponent]) {
            if (!side || !groupMap[side.tag]) continue;
            if (isEnded) {
                groupMap[side.tag].stars      += side.stars || 0;
                groupMap[side.tag].totalDestr += side.destructionPercentage || 0;
                groupMap[side.tag].warCount++;
            }
        }

        // Aggiorna stats giocatori nostro clan
        const ourSide = war.clan?.tag === COC_CLAN_TAG_RAW ? war.clan
                      : war.opponent?.tag === COC_CLAN_TAG_RAW ? war.opponent
                      : null;
        if (!ourSide) continue;
        (ourSide.members || []).forEach(m => {
            if (!stats[m.tag]) return;
            stats[m.tag].attacks_required += war.attacksPerMember || 1;
            (m.attacks || []).forEach(a => {
                stats[m.tag].stars       += a.stars;
                stats[m.tag].destruction += a.destructionPercentage;
                stats[m.tag].attacks_made++;
            });
        });
    }

    // 4. Calcola classifica finale (stelle desc → distruzione desc)
    const groupStandings = Object.values(groupMap).sort((a, b) =>
        b.stars !== a.stars ? b.stars - a.stars : b.totalDestr - a.totalDestr
    );
    const ourIdx     = groupStandings.findIndex(c => c.tag === COC_CLAN_TAG_RAW);
    const ourPosition = ourIdx >= 0 ? ourIdx + 1 : null;
    const ourGroup    = groupMap[COC_CLAN_TAG_RAW];

    const players = Object.values(stats).sort((a, b) =>
        b.stars !== a.stars ? b.stars - a.stars : b.destruction - a.destruction
    );

    // 5. Auto-salva su Supabase quando CWL terminata con tutti i round
    if (lg.state === 'ended' && ourPosition && ourGroup?.warCount >= 7 && lg.season) {
        const avgDestr = parseFloat((ourGroup.totalDestr / ourGroup.warCount).toFixed(2));
        try {
            await supabase().from('cwl_seasons').upsert(
                {
                    season:      lg.season,
                    league:      leagueNameIt,
                    position:    ourPosition,
                    stars:       ourGroup.stars,
                    destruction: avgDestr
                },
                { onConflict: 'season' }
            );
        } catch (_) {}
    }

    return {
        state:         lg.state,
        season:        lg.season,
        leagueNameEn,
        leagueNameIt,
        ourPosition,
        groupStandings,
        players
    };
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
    const key = req.headers['x-sync-key'];
    if (!process.env.SYNC_SECRET || key !== process.env.SYNC_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.json({ ok: true, service: 'FearUnited CoC Proxy' }));

app.get('/myip', async (_req, res) => {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/sync', authMiddleware, async (_req, res) => {
    try {
        const count = await syncMembers();
        res.json({ ok: true, synced: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/cwl-live', authMiddleware, async (_req, res) => {
    try {
        const data = await getCwlStats();
        res.json({ ok: true, ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/war-log', authMiddleware, async (_req, res) => {
    try {
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/warlog?limit=30`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error', detail: data });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/clan-info', authMiddleware, async (_req, res) => {
    try {
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
        res.json({
            name: data.name,
            tag: data.tag,
            badgeUrls: data.badgeUrls,
            clanLevel: data.clanLevel,
            warLeague: data.warLeague || null,
            members: data.members
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/clan-members', authMiddleware, async (_req, res) => {
    try {
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/members`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
        const items = (data.items || []).map(m => ({ name: m.name, tag: m.tag, role: m.role }));
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));

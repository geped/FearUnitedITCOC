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

// ── CWL LIVE STATS ──────────────────────────────────────────────────────────

async function getCwlStats() {
    // 1. Ottieni il league group corrente
    const lgRes = await fetch(
        `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/currentwar/leaguegroup`,
        { headers: cocHeaders() }
    );
    if (!lgRes.ok) {
        const text = await lgRes.text();
        if (lgRes.status === 404) return { state: 'notInWar', players: [] };
        throw new Error(`LeagueGroup API ${lgRes.status}: ${text}`);
    }
    const lg = await lgRes.json();
    if (lg.state === 'notInWar') return { state: 'notInWar', players: [] };

    // 2. Trova il nostro clan nel gruppo
    const myClan = (lg.clans || []).find(c => c.tag === COC_CLAN_TAG_RAW);
    if (!myClan) return { state: 'notInWar', players: [] };

    // Inizializza stats per ogni membro
    const stats = {};
    (myClan.members || []).forEach(m => {
        stats[m.tag] = {
            tag: m.tag, name: m.name, th_level: m.townHallLevel,
            stars: 0, destruction: 0, attacks_made: 0, attacks_required: 0
        };
    });

    // 3. Itera su ogni round e raccoglie le stats
    const warTags = (lg.rounds || []).flatMap(r => r.warTags || []).filter(t => t !== '#0');
    for (const warTag of warTags) {
        const wRes = await fetch(
            `https://api.clashofclans.com/v1/clanwarleagues/wars/${encodeURIComponent(warTag)}`,
            { headers: cocHeaders() }
        );
        if (!wRes.ok) continue;
        const war = await wRes.json();
        if (war.state === 'notInWar') continue;

        const ourSide = war.clan?.tag === COC_CLAN_TAG_RAW ? war.clan
                      : war.opponent?.tag === COC_CLAN_TAG_RAW ? war.opponent
                      : null;
        if (!ourSide) continue;

        (ourSide.members || []).forEach(m => {
            if (!stats[m.tag]) return;
            stats[m.tag].attacks_required += war.attacksPerMember || 1;
            (m.attacks || []).forEach(a => {
                stats[m.tag].stars += a.stars;
                stats[m.tag].destruction += a.destructionPercentage;
                stats[m.tag].attacks_made++;
            });
        });
    }

    const players = Object.values(stats).sort((a, b) => {
        if (b.stars !== a.stars) return b.stars - a.stars;
        return b.destruction - a.destruction;
    });

    return { state: lg.state, season: lg.season, players };
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));

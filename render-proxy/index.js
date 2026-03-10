const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const COC_CLAN_TAG = '%232J2VLPP9R';

async function syncMembers() {
    const res = await fetch(
        `https://api.clashofclans.com/v1/clans/${COC_CLAN_TAG}/members`,
        { headers: { Authorization: `Bearer ${process.env.COC_API_TOKEN}` } }
    );
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`CoC API ${res.status}: ${body}`);
    }
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

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
    );
    const { error } = await supabase.from('members').upsert(members, { onConflict: 'tag' });
    if (error) throw new Error(error.message);

    return members.length;
}

function authMiddleware(req, res, next) {
    const key = req.headers['x-sync-key'];
    if (!process.env.SYNC_SECRET || key !== process.env.SYNC_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Health check
app.get('/', (_req, res) => res.json({ ok: true, service: 'FearUnited CoC Proxy' }));

// Returns the outbound IP of this server — use this to whitelist in CoC API token
app.get('/myip', async (_req, res) => {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        const { ip } = await r.json();
        res.json({ ip });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trigger sync: CoC API → Supabase
app.post('/sync', authMiddleware, async (_req, res) => {
    try {
        const count = await syncMembers();
        res.json({ ok: true, synced: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));

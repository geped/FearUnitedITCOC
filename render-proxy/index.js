const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Clan tag viene passato come parametro da ogni richiesta — nessun valore hardcoded

// Normalizza e URL-encoda il clan tag ricevuto come parametro
function parseClanTag(raw) {
    if (!raw) return null;
    const t = raw.trim().toUpperCase();
    return t.startsWith('#') ? t : '#' + t;
}
function encodeTag(tag) { return encodeURIComponent(tag); }

function supabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function cocHeaders() {
    return { Authorization: `Bearer ${process.env.COC_API_TOKEN}` };
}

// ── SYNC MEMBERS ────────────────────────────────────────────────────────────

async function syncMembers(clanTagRaw) {
    const clanTag = parseClanTag(clanTagRaw);
    if (!clanTag) throw new Error('clan_tag obbligatorio per la sincronizzazione.');
    const res = await fetch(
        `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/members`,
        { headers: cocHeaders() }
    );
    if (!res.ok) throw new Error(`CoC API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const members = (data.items || []).map(m => ({
        tag: m.tag,
        name: m.name,
        role: m.role,
        clan_tag: clanTag,
        th_level: m.townHallLevel ?? null,
        trophies: m.trophies ?? null,
        donations: m.donations ?? null,
        donations_received: m.donationsReceived ?? null,
        exp_level: m.expLevel ?? null,
        clan_rank: m.clanRank ?? null,
        league_name: m.league?.name ?? null,
        league_icon_url: m.league?.iconUrls?.small ?? null
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

async function getCwlStats(clanTagRaw) {
    const COC_CLAN_TAG_RAW = parseClanTag(clanTagRaw);
    if (!COC_CLAN_TAG_RAW) throw new Error('clan_tag obbligatorio.');
    const COC_CLAN_TAG = encodeTag(COC_CLAN_TAG_RAW);

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
        groupMap[c.tag] = { tag: c.tag, name: c.name, stars: 0, totalDestr: 0, warCount: 0, teamSize: 0 };
    });

    // 3. Fetch tutte le guerre in parallelo
    // Mappa warTag → roundNumber (1-7)
    const warTagToRound = {};
    (lg.rounds || []).forEach((round, idx) => {
        (round.warTags || []).filter(t => t !== '#0').forEach(wt => {
            warTagToRound[wt] = idx + 1;
        });
    });
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

    const roundsData = [];

    for (let i = 0; i < warTags.length; i++) {
        const wt  = warTags[i];
        const war = warResults[i];
        if (!war) continue;
        const isEnded = war.state === 'warEnded' || war.state === 'ended';

        // Aggiorna classifica gruppo
        for (const side of [war.clan, war.opponent]) {
            if (!side || !groupMap[side.tag]) continue;
            if (isEnded) {
                groupMap[side.tag].stars      += side.stars || 0;
                groupMap[side.tag].totalDestr += side.destructionPercentage || 0;
                groupMap[side.tag].warCount++;
                groupMap[side.tag].teamSize    = groupMap[side.tag].teamSize || war.teamSize || 15;
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

        // Raccoglie dati per turno (roundsData)
        const theirSide = war.clan?.tag === COC_CLAN_TAG_RAW ? war.opponent : war.clan;
        let result = 'ongoing';
        if (isEnded) {
            const os = ourSide.stars || 0, ts = theirSide?.stars || 0;
            if (os > ts) result = 'win';
            else if (os < ts) result = 'lose';
            else if ((ourSide.destructionPercentage||0) > (theirSide?.destructionPercentage||0)) result = 'win';
            else if ((ourSide.destructionPercentage||0) < (theirSide?.destructionPercentage||0)) result = 'lose';
            else result = 'draw';
        } else if (war.state === 'preparation') {
            result = 'preparation';
        }
        // Mappa tag difensori → nome+TH per lookup negli attacchi
        const defenderMap = {};
        (theirSide?.members || []).forEach(m => {
            defenderMap[m.tag] = { name: m.name, thLevel: m.townHallLevel };
        });
        // Anche i nostri membri sono possibili difensori (attacchi ricevuti)
        (ourSide.members || []).forEach(m => {
            defenderMap[m.tag] = { name: m.name, thLevel: m.townHallLevel };
        });
        const ourMembers = (ourSide.members || []).map(m => ({
            tag: m.tag, name: m.name, thLevel: m.townHallLevel,
            attacks: (m.attacks || []).map(a => ({
                defenderTag: a.defenderTag, stars: a.stars,
                destruction: a.destructionPercentage, order: a.order
            }))
        }));
        roundsData.push({
            roundNumber:      warTagToRound[wt] || (roundsData.length + 1),
            state:            war.state,
            endTime:          war.endTime,
            teamSize:         war.teamSize || 15,
            attacksPerMember: war.attacksPerMember || 1,
            result,
            clan: {
                tag: ourSide.tag, name: ourSide.name, badgeUrls: ourSide.badgeUrls,
                stars: ourSide.stars || 0,
                destruction: +(ourSide.destructionPercentage || 0).toFixed(2),
                attacksUsed: ourMembers.reduce((s, m) => s + m.attacks.length, 0),
                members: ourMembers
            },
            opponent: {
                tag: theirSide?.tag, name: theirSide?.name || 'Sconosciuto',
                badgeUrls: theirSide?.badgeUrls,
                stars: theirSide?.stars || 0,
                destruction: +(theirSide?.destructionPercentage || 0).toFixed(2),
                attacksUsed: (theirSide?.members || []).reduce((s, m) => s + (m.attacks?.length || 0), 0)
            },
            defenderMap
        });
    }
    roundsData.sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));

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
        // destruction = totalDestr × teamSize  (formato CoC, numero intero)
        const teamSize   = ourGroup.teamSize || 15;
        const gameDestr  = Math.round(ourGroup.totalDestr * teamSize);
        try {
            await supabase().from('cwl_seasons').upsert(
                {
                    season:      lg.season,
                    league:      leagueNameIt,
                    position:    ourPosition,
                    stars:       ourGroup.stars,
                    destruction: gameDestr
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
        teamSize:      (groupMap[COC_CLAN_TAG_RAW]?.teamSize) || 15,
        groupStandings,
        players,
        roundsData
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

app.get('/', (_req, res) => res.json({ ok: true, service: 'CoCBoard Proxy' }));

app.get('/myip', async (_req, res) => {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/sync', authMiddleware, async (req, res) => {
    try {
        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const count = await syncMembers(clanTag);
        res.json({ ok: true, synced: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/cwl-live', authMiddleware, async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const data = await getCwlStats(clanTag);
        res.json({ ok: true, ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/war-log', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/warlog?limit=100`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error', detail: data });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/clan-info', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}`,
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

app.post('/verify-player-token', authMiddleware, async (req, res) => {
    const { playerTag, apiToken } = req.body || {};
    if (!playerTag || !apiToken) {
        return res.status(400).json({ error: 'playerTag e apiToken obbligatori.' });
    }

    const tagEncoded = encodeURIComponent(playerTag);

    // 1. Verifica il token in-game del giocatore
    let verifyStatus;
    try {
        const vRes = await fetch(
            `https://api.clashofclans.com/v1/players/${tagEncoded}/verifytoken`,
            {
                method: 'POST',
                headers: { ...cocHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: apiToken }),
            }
        );
        const vData = await vRes.json();
        verifyStatus = vData.status;
    } catch (err) {
        return res.status(502).json({ error: 'Impossibile contattare la CoC API.' });
    }

    if (verifyStatus !== 'ok') {
        return res.status(401).json({ error: 'Chiave API non valida. Verifica il token in-game e riprova.' });
    }

    // 2. Recupera le info del giocatore
    try {
        const pRes = await fetch(
            `https://api.clashofclans.com/v1/players/${tagEncoded}`,
            { headers: cocHeaders() }
        );
        if (!pRes.ok) throw new Error(`CoC API ${pRes.status}`);
        const player = await pRes.json();
        res.json({ ok: true, player });
    } catch (err) {
        res.status(502).json({ error: 'Impossibile recuperare le info del giocatore.' });
    }
});

// Endpoint debug temporaneo — mostra campi league raw dal primo membro
app.get('/debug-league', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/members`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason });
        // Ritorna i primi 3 membri con tutti i campi legati a league
        const sample = (data.items || []).slice(0, 5).map(m => ({
            name: m.name,
            trophies: m.trophies,
            league: m.league,
            leagueTier: m.leagueTier,
            builderBaseLeague: m.builderBaseLeague,
            allLeagueKeys: Object.keys(m).filter(k => k.toLowerCase().includes('league'))
        }));
        res.json({ sample });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/clan-members', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/members`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
        const items = (data.items || []).map(m => ({ name: m.name, tag: m.tag, role: m.role, townHallLevel: m.townHallLevel }));
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));

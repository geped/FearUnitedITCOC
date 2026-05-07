const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

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

/** Tag clan confrontabili (# + maiuscolo) — API a volte omette # */
function normClanTag(t) {
    if (!t) return t;
    const s = String(t).trim().toUpperCase();
    return s.startsWith('#') ? s : '#' + s;
}

/** Town Hall da oggetto membro guerra/roster CoC API (camelCase ufficiale) */
function memberThLevel(m) {
    if (!m) return null;
    const v = m.townHallLevel ?? m.townhallLevel;
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function supabase() {
    // Usa SERVICE_ROLE_KEY per le scritture dal proxy (bypassa RLS — solo operazioni interne)
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    return createClient(process.env.SUPABASE_URL, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: { transport: WebSocket }
    });
}

function cocHeaders() {
    return { Authorization: `Bearer ${process.env.COC_API_TOKEN}` };
}

/**
 * L'API `/locations/.../rankings/players` (e builder-base) può riusare lo stesso `badgeUrls`
 * per clan con `tag` diversi. Arricchiamo con GET /v1/clans/{tag}.
 */
async function enrichRankingPlayerClanBadges(items) {
    if (!items || !Array.isArray(items) || !items.length) return;
    const tagSet = new Set();
    for (const pl of items) {
        const raw = pl.clan && pl.clan.tag;
        if (raw) tagSet.add(normClanTag(raw));
    }
    const badgeKeys = new Set(
        items.map((pl) => {
            const bu = pl.clan && pl.clan.badgeUrls;
            return bu ? (bu.small || bu.medium || bu.large || '') : '';
        }).filter(Boolean)
    );
    if (tagSet.size < 2 || badgeKeys.size > 1) return;

    const clanBadgeMap = {};
    const tags = [...tagSet];
    const chunkSize = 10;
    const headers = cocHeaders();
    for (let i = 0; i < tags.length; i += chunkSize) {
        const chunk = tags.slice(i, i + chunkSize);
        await Promise.all(
            chunk.map(async (ct) => {
                try {
                    const cr = await fetch(
                        `https://api.clashofclans.com/v1/clans/${encodeTag(ct)}`,
                        { headers }
                    );
                    const cd = await cr.json();
                    if (cr.ok && cd.badgeUrls) clanBadgeMap[ct] = cd.badgeUrls;
                } catch (_) {}
            })
        );
    }
    for (const pl of items) {
        if (!pl.clan || !pl.clan.tag) continue;
        const k = normClanTag(pl.clan.tag);
        if (clanBadgeMap[k]) pl.clan.badgeUrls = clanBadgeMap[k];
    }
}

// ── SYNC MEMBERS ────────────────────────────────────────────────────────────

// ── SALVA WAR CONCLUSA ──────────────────────────────────────────────────────

async function saveEndedWar(clanTagRaw) {
    const clanTag = parseClanTag(clanTagRaw);
    if (!clanTag) throw new Error('clan_tag obbligatorio.');

    const r = await fetch(
        `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/currentwar`,
        { headers: cocHeaders() }
    );
    if (!r.ok) return { skipped: true, reason: `CoC API ${r.status}` };
    const war = await r.json();

    if (war.state !== 'warEnded') return { skipped: true, reason: `state=${war.state}` };
    if ((war.warType || '').toLowerCase() === 'cwl') return { skipped: true, reason: 'cwl' };

    const ourSide = war.clan;
    const oppSide = war.opponent;

    // Determina risultato
    let result = 'tie';
    if ((ourSide.stars || 0) > (oppSide.stars || 0)) result = 'win';
    else if ((ourSide.stars || 0) < (oppSide.stars || 0)) result = 'lose';
    else if ((ourSide.destructionPercentage || 0) > (oppSide.destructionPercentage || 0)) result = 'win';
    else if ((ourSide.destructionPercentage || 0) < (oppSide.destructionPercentage || 0)) result = 'lose';

    const row = {
        clan_tag:       clanTag,
        end_time:       war.endTime,
        result,
        team_size:      war.teamSize ?? null,
        atk_per_member: war.attacksPerMember ?? 2,
        our_tag:        ourSide.tag,
        our_name:       ourSide.name,
        our_badge:      ourSide.badgeUrls?.small ?? null,
        our_stars:      ourSide.stars ?? 0,
        our_destr:      +(ourSide.destructionPercentage ?? 0).toFixed(2),
        opp_tag:        oppSide.tag,
        opp_name:       oppSide.name,
        opp_badge:      oppSide.badgeUrls?.small ?? null,
        opp_stars:      oppSide.stars ?? 0,
        opp_destr:      +(oppSide.destructionPercentage ?? 0).toFixed(2),
        our_members:    (ourSide.members || []).map(m => ({
            tag: m.tag, name: m.name,
            townhallLevel: memberThLevel(m), mapPosition: m.mapPosition,
            attacks: (m.attacks || []).map(a => ({
                defenderTag: a.defenderTag, stars: a.stars,
                destructionPercentage: a.destructionPercentage, order: a.order
            }))
        })),
        opp_members:    (oppSide.members || []).map(m => ({
            tag: m.tag, name: m.name,
            townhallLevel: memberThLevel(m), mapPosition: m.mapPosition,
            attacks: (m.attacks || []).map(a => ({
                defenderTag: a.defenderTag, stars: a.stars,
                destructionPercentage: a.destructionPercentage, order: a.order
            }))
        }))
    };

    const { error } = await supabase()
        .from('classic_wars')
        .upsert(row, { onConflict: 'clan_tag,end_time' });
    if (error) throw new Error(error.message);
    return { saved: true, endTime: war.endTime, result };
}

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
        league_name: m.leagueTier?.name ?? null,
        league_icon_url: m.leagueTier?.iconUrls?.small ?? null,
        left_at: null  // membro attivo: azzera left_at (gestisce i rientri)
    }));

    const sb = supabase();

    // Upsert membri attivi (include azzeramento left_at per i rientri)
    const { error } = await sb.from('members').upsert(members, { onConflict: 'tag' });
    if (error) throw new Error(error.message);

    // Soft delete: segna come usciti i membri non più nell'elenco API
    const liveTags = members.map(m => m.tag);
    if (liveTags.length > 0) {
        // PostgREST richiede stringhe tra virgolette nel filtro `in.(...)` (i tag contengono #)
        const inList = `(${liveTags.map(t => `"${String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
        const { error: delErr } = await sb
            .from('members')
            .update({ left_at: new Date().toISOString() })
            .eq('clan_tag', clanTag)
            .is('left_at', null)
            .not('tag', 'in', inList);
        if (delErr) throw new Error(delErr.message);
    }

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
    const COC_CLAN_TAG_NORM = normClanTag(COC_CLAN_TAG_RAW);
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

    // 2. Trova il nostro clan nel gruppo (tag normalizzato — API può variare #)
    const myClan = (lg.clans || []).find(c => normClanTag(c.tag) === COC_CLAN_TAG_NORM);
    if (!myClan) return { state: 'notInWar', players: [] };

    // Inizializza stats giocatori
    const stats = {};
    (myClan.members || []).forEach(m => {
        stats[m.tag] = {
            tag: m.tag, name: m.name, th_level: memberThLevel(m),
            stars: 0, destruction: 0, attacks_made: 0, attacks_required: 0
        };
    });

    // Inizializza classifica gruppo (tutti e 8 i clan)
    const groupMap = {};
    (lg.clans || []).forEach(c => {
        const t = normClanTag(c.tag);
        groupMap[t] = {
            tag: t, name: c.name, badgeUrls: c.badgeUrls ?? null,
            stars: 0, totalDestr: 0, warCount: 0, teamSize: 0
        };
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

        // Classifica gruppo: stelle e distruzione anche per guerre in corso (non solo ended)
        for (const side of [war.clan, war.opponent]) {
            if (!side?.tag) continue;
            const tg = normClanTag(side.tag);
            if (!groupMap[tg]) continue;
            groupMap[tg].stars += side.stars || 0;
            groupMap[tg].totalDestr += side.destructionPercentage || 0;
            groupMap[tg].teamSize = groupMap[tg].teamSize || war.teamSize || 15;
            if (isEnded || war.state === 'inWar') {
                groupMap[tg].warCount++;
            }
        }

        // Aggiorna stats giocatori nostro clan
        const ourSide = war.clan?.tag && normClanTag(war.clan.tag) === COC_CLAN_TAG_NORM ? war.clan
            : war.opponent?.tag && normClanTag(war.opponent.tag) === COC_CLAN_TAG_NORM ? war.opponent
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
        const theirSide = normClanTag(war.clan?.tag) === COC_CLAN_TAG_NORM ? war.opponent : war.clan;
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
            defenderMap[m.tag] = { name: m.name, thLevel: memberThLevel(m) };
        });
        (ourSide.members || []).forEach(m => {
            defenderMap[m.tag] = { name: m.name, thLevel: memberThLevel(m) };
        });
        const ourMembers = (ourSide.members || []).map(m => ({
            tag: m.tag, name: m.name, thLevel: memberThLevel(m), mapPosition: m.mapPosition ?? null,
            attacks: (m.attacks || []).map(a => ({
                defenderTag: a.defenderTag, stars: a.stars,
                destruction: a.destructionPercentage, order: a.order
            }))
        }));
        const fullDefenderMap = { ...defenderMap };
        (ourSide.members || []).forEach(m => {
            fullDefenderMap[m.tag] = { name: m.name, thLevel: memberThLevel(m) };
        });
        (theirSide?.members || []).forEach(m => {
            fullDefenderMap[m.tag] = { name: m.name, thLevel: memberThLevel(m) };
        });

        const oppMembers = (theirSide?.members || []).map(m => ({
            tag: m.tag, name: m.name, thLevel: memberThLevel(m), mapPosition: m.mapPosition ?? null,
            attacks: (m.attacks || []).map(a => ({
                defenderTag: a.defenderTag, stars: a.stars,
                destruction: a.destructionPercentage, order: a.order
            }))
        }));

        roundsData.push({
            roundNumber:      warTagToRound[wt] || (roundsData.length + 1),
            state:            war.state,
            startTime:        war.startTime || null,
            preparationStartTime: war.preparationStartTime || null,
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
                attacksUsed: oppMembers.reduce((s, m) => s + m.attacks.length, 0),
                members: oppMembers
            },
            defenderMap: fullDefenderMap
        });
    }
    roundsData.sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));

    // Stemmi da ogni guerra (league group spesso non badgeUrls completi)
    for (const rd of roundsData) {
        for (const side of [rd.clan, rd.opponent]) {
            if (!side?.tag) continue;
            const tg = normClanTag(side.tag);
            if (!groupMap[tg] || !side.badgeUrls) continue;
            const cur = groupMap[tg].badgeUrls;
            const hasSmall = !!(cur && cur.small);
            if (!hasSmall) {
                groupMap[tg].badgeUrls = { ...(cur || {}), ...side.badgeUrls };
            }
        }
    }

    // 4. Calcola classifica finale (stelle desc → distruzione desc)
    const groupStandings = Object.values(groupMap).sort((a, b) =>
        b.stars !== a.stars ? b.stars - a.stars : b.totalDestr - a.totalDestr
    );
    const ourIdx = groupStandings.findIndex(c => normClanTag(c.tag) === COC_CLAN_TAG_NORM);
    const ourPosition = ourIdx >= 0 ? ourIdx + 1 : null;
    const ourGroup = groupMap[COC_CLAN_TAG_NORM];

    const players = Object.values(stats).sort((a, b) =>
        b.stars !== a.stars ? b.stars - a.stars : b.destruction - a.destruction
    );

    const result = {
        state:         lg.state,
        season:        lg.season,
        leagueNameEn,
        leagueNameIt,
        ourPosition,
        teamSize:      (groupMap[COC_CLAN_TAG_NORM]?.teamSize) || 15,
        groupStandings,
        players,
        roundsData
    };

    // Side-effect: salva automaticamente turni conclusi, roster e cwl_history
    saveCwlData(COC_CLAN_TAG_RAW, result).catch(() => {});

    return result;
}

// ── AUTO-SAVE CWL DATA ──────────────────────────────────────────────────────

async function saveCwlData(clanTag, cwl) {
    if (!cwl?.season || !cwl.roundsData?.length) return;
    const sb = supabase();
    const tag = parseClanTag(clanTag);
    if (!tag) return;

    // 1. Salva ogni turno concluso in cwl_wars
    const endedRounds = cwl.roundsData.filter(r =>
        r.state === 'warEnded' || r.state === 'ended'
    );
    for (const rd of endedRounds) {
        try {
            await sb.from('cwl_wars').upsert({
                clan_tag:     tag,
                season:       cwl.season,
                round:        rd.roundNumber,
                war_tag:      null,
                state:        rd.state,
                team_size:    rd.teamSize,
                start_time:   rd.startTime || null,
                end_time:     rd.endTime || null,
                result:       rd.result,
                our_tag:      rd.clan?.tag || null,
                our_name:     rd.clan?.name || null,
                our_badge:    rd.clan?.badgeUrls?.small || null,
                our_stars:    rd.clan?.stars ?? 0,
                our_destr:    rd.clan?.destruction ?? 0,
                opp_tag:      rd.opponent?.tag || null,
                opp_name:     rd.opponent?.name || null,
                opp_badge:    rd.opponent?.badgeUrls?.small || null,
                opp_stars:    rd.opponent?.stars ?? 0,
                opp_destr:    rd.opponent?.destruction ?? 0,
                our_members:  rd.clan?.members || [],
                opp_members:  rd.opponent?.members || [],
                defender_map: rd.defenderMap || {},
                saved_at:     new Date().toISOString()
            }, { onConflict: 'clan_tag,season,round' });
        } catch (_) {}
    }

    // 2. Salva/aggiorna cwl_seasons con group_standings e roster
    try {
        const seasonRow = {
            season:          cwl.season,
            clan_tag:        tag,
            group_standings: cwl.groupStandings || null,
            roster:          cwl.players || null
        };
        if (cwl.leagueNameIt) seasonRow.league = cwl.leagueNameIt;
        if (cwl.ourPosition)  seasonRow.position = cwl.ourPosition;
        const ourGroup = (cwl.groupStandings || []).find(c => normClanTag(c.tag) === normClanTag(tag));
        if (ourGroup) {
            seasonRow.stars       = ourGroup.stars;
            seasonRow.destruction = Math.round(ourGroup.totalDestr * (cwl.teamSize || 15));
        }
        await sb.from('cwl_seasons').upsert(seasonRow, { onConflict: 'season,clan_tag' });
    } catch (_) {}

    // 3. Auto-popola cwl_history per ogni giocatore del roster
    if (cwl.players?.length && (cwl.state === 'ended' || endedRounds.length >= 7)) {
        try {
            const historyRows = cwl.players.map(p => {
                const req  = Math.max(p.attacks_required || 1, 1);
                const made = p.attacks_made || 0;
                const stars = p.stars || 0;
                const destr = p.destruction || 0;
                const avgD  = made > 0 ? destr / made : 0;
                const score = Math.round(((stars / req) * 40 + avgD * 0.2 + (made / req) * 20) * 10) / 10;
                return {
                    clan_tag:         tag,
                    player_name:      p.name,
                    season:           cwl.season,
                    participated:     made > 0,
                    stars,
                    destruction:      parseFloat(destr.toFixed(2)),
                    attacks_made:     made,
                    attacks_required: p.attacks_required || 0,
                    bonus_score:      Math.round(score),
                    still_in_clan:    true,
                    is_secondary:     false
                };
            });
            await sb.from('cwl_history').upsert(historyRows, {
                onConflict: 'player_name,season,clan_tag'
            });
        } catch (_) {}
    }
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

app.get('/', (_req, res) => res.json({ ok: true, service: 'CoCBoard Proxy', version: 'leagueTier-2026-03-18' }));

// Keep-alive endpoint — usato dal cron Vercel ogni 14 min per evitare spin-down Render
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
        const [count, warResult] = await Promise.all([
            syncMembers(clanTag),
            saveEndedWar(clanTag).catch(e => ({ error: e.message }))
        ]);
        res.json({ ok: true, synced: count, war: warResult });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/save-war', authMiddleware, async (req, res) => {
    try {
        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const result = await saveEndedWar(clanTag);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/save-all-wars', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase()
            .from('members')
            .select('clan_tag')
            .not('clan_tag', 'is', null);
        if (error) return res.status(500).json({ error: error.message });

        const tags = [...new Set((data || []).map(r => r.clan_tag).filter(Boolean))];
        if (!tags.length) return res.json({ ok: true, clans: 0, results: [] });

        const settled = await Promise.allSettled(tags.map(tag => saveEndedWar(tag)));
        const results = tags.map((tag, i) => ({
            clan_tag: tag,
            ...(settled[i].status === 'fulfilled'
                ? settled[i].value
                : { error: settled[i].reason?.message }),
        }));

        res.json({ ok: true, clans: tags.length, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/save-all-cwl', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase()
            .from('members')
            .select('clan_tag')
            .not('clan_tag', 'is', null);
        if (error) return res.status(500).json({ error: error.message });

        const tags = [...new Set((data || []).map(r => r.clan_tag).filter(Boolean))];
        if (!tags.length) return res.json({ ok: true, clans: 0, results: [] });

        const settled = await Promise.allSettled(tags.map(async tag => {
            const cwl = await getCwlStats(tag);
            return { state: cwl?.state, season: cwl?.season, rounds: cwl?.roundsData?.length || 0 };
        }));
        const results = tags.map((tag, i) => ({
            clan_tag: tag,
            ...(settled[i].status === 'fulfilled'
                ? settled[i].value
                : { error: settled[i].reason?.message }),
        }));

        res.json({ ok: true, clans: tags.length, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/player', authMiddleware, async (req, res) => {
    try {
        const playerTag = parseClanTag(req.query.playerTag);
        if (!playerTag) return res.status(400).json({ error: 'playerTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/players/${encodeTag(playerTag)}`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error', detail: data });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/search-clans', authMiddleware, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.status(400).json({ error: 'Parametro q obbligatorio.' });
        let url, r, data;
        if (q.startsWith('#')) {
            const tag = parseClanTag(q);
            url = `https://api.clashofclans.com/v1/clans/${encodeTag(tag)}`;
            r = await fetch(url, { headers: cocHeaders() });
            data = await r.json();
            if (!r.ok) return res.status(r.status).json({ error: data.reason || 'Clan non trovato' });
            return res.json({ items: [data] });
        } else {
            if (q.length < 3) return res.status(400).json({ error: 'Il nome deve essere di almeno 3 caratteri.' });
            url = `https://api.clashofclans.com/v1/clans?name=${encodeURIComponent(q)}&limit=20`;
            r = await fetch(url, { headers: cocHeaders() });
            data = await r.json();
            if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
            return res.json(data);
        }
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

app.get('/current-war', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/currentwar`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error', detail: data });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/capital-raids', authMiddleware, async (req, res) => {
    try {
        const clanTag = parseClanTag(req.query.clanTag);
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `https://api.clashofclans.com/v1/clans/${encodeTag(clanTag)}/capitalraidseasons?limit=2`,
            { headers: cocHeaders() }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error', detail: data });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
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
            members: data.members,
            description: data.description || '',
            type: data.type || '',
            location: data.location || null,
            clanPoints: data.clanPoints ?? 0,
            clanBuilderBasePoints: data.clanBuilderBasePoints ?? 0,
            warWins: data.warWins ?? 0,
            warLosses: data.warLosses ?? null,
            warTies: data.warTies ?? null,
            warWinStreak: data.warWinStreak ?? 0,
            isWarLogPublic: data.isWarLogPublic ?? false,
            requiredTrophies: data.requiredTrophies ?? 0,
            warFrequency: data.warFrequency || '',
            labels: data.labels || []
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
        const items = (data.items || []).map(m => {
            const lt = m.leagueTier;
            const leg = m.league;
            const league = lt && (lt.name || lt.iconUrls)
                ? {
                    id: lt.id ?? leg?.id,
                    name: lt.name || leg?.name || null,
                    iconUrls: lt.iconUrls || leg?.iconUrls || {},
                }
                : leg
                  ? { id: leg.id, name: leg.name, iconUrls: leg.iconUrls || {} }
                  : null;
            return {
                name: m.name, tag: m.tag, role: m.role,
                townHallLevel: m.townHallLevel,
                trophies: m.trophies ?? 0,
                donations: m.donations ?? 0,
                donationsReceived: m.donationsReceived ?? 0,
                clanRank: m.clanRank ?? null,
                expLevel: m.expLevel ?? null,
                league,
            };
        });
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/rankings', authMiddleware, async (req, res) => {
    try {
        const { type, locationId } = req.query;
        if (!type || !locationId) return res.status(400).json({ error: 'type e locationId obbligatori.' });
        const validTypes = ['players', 'clans', 'players-builder-base', 'clans-builder-base'];
        if (!validTypes.includes(type)) return res.status(400).json({ error: 'type non valido.' });
        const url = `https://api.clashofclans.com/v1/locations/${encodeURIComponent(locationId)}/rankings/${encodeURIComponent(type)}?limit=50`;
        const r = await fetch(url, { headers: cocHeaders() });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
        if ((type === 'players' || type === 'players-builder-base') && data.items) {
            await enrichRankingPlayerClanBadges(data.items);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/locations', authMiddleware, async (req, res) => {
    try {
        const url = 'https://api.clashofclans.com/v1/locations?limit=300';
        const r = await fetch(url, { headers: cocHeaders() });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.reason || 'CoC API error' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Risolve un Telegram file_id in URL CDN pubblico usando il BOT_TOKEN
// Chiamato da api/lookup.js type=tg-photo (token resta server-side)
app.get('/tg-file', authMiddleware, async (req, res) => {
    const fileId = (req.query.file_id || '').trim();
    if (!fileId) return res.status(400).json({ error: 'file_id obbligatorio' });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN non configurato' });
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const data = await r.json();
        if (!data.ok || !data.result?.file_path) return res.status(404).json({ error: 'File non trovato' });
        const url = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
        return res.json({ url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[cocboard] Unified service listening on port ${PORT}`);

    // Self-ping ogni 13 minuti. URL esterno (RENDER_EXTERNAL_URL) evita spin-down
    // anche senza richieste reali — più affidabile del solo localhost.
    // Fallback a localhost in sviluppo locale.
    const selfUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
    const pingUrl = selfUrl ? `${selfUrl}/health` : `http://localhost:${PORT}/health`;
    const KEEP_ALIVE_MS = 13 * 60 * 1000;
    setInterval(() => {
        fetch(pingUrl, { signal: AbortSignal.timeout(10000) })
            .then(() => console.log('[keep-alive] ping ok', new Date().toISOString()))
            .catch(err => console.warn('[keep-alive] ping failed:', err.message));
    }, KEEP_ALIVE_MS);

    // Monta bot Telegram sullo stesso Express server (unified service)
    const { mountOnApp } = require('../telegram-bot/index');
    mountOnApp(app).catch(e => console.error('[bot] startup error:', e.message));
});

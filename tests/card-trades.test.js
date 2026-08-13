'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./_fake-supabase');
const cardTrades = require('../api/_utils/card-trades');

const USER_A = 'user-a';
const USER_B = 'user-b';

function seedBase() {
  return makeFakeSupabase({
    card_event_settings: [{ id: 1, enabled: true, ends_at: '2099-01-01T00:00:00Z' }],
    user_coc_profiles: [
      { id: 'p-a1', user_id: USER_A, coc_tag: '#AAA1', username: 'Alice', clan_role: 'membro' },
      { id: 'p-a2', user_id: USER_A, coc_tag: '#AAA2', username: 'Alice2', clan_role: 'membro' },
      { id: 'p-b1', user_id: USER_B, coc_tag: '#BBB1', username: 'Bob', clan_role: 'membro' },
    ],
    card_event_collections: [
      // Alice1: doppione Barbarian (elixir), manca Archer
      { coc_tag: '#AAA1', card_key: 'elx_barbarian', category: 'elixir', qty_state: 2 },
      { coc_tag: '#AAA1', card_key: 'elx_archer', category: 'elixir', qty_state: 0 },
      // Bob1: doppione Archer, manca Barbarian
      { coc_tag: '#BBB1', card_key: 'elx_archer', category: 'elixir', qty_state: 2 },
      { coc_tag: '#BBB1', card_key: 'elx_barbarian', category: 'elixir', qty_state: 0 },
      // Alice2: doppione Goblin (elixir) per test self-trade
      { coc_tag: '#AAA2', card_key: 'elx_goblin', category: 'elixir', qty_state: 2 },
      { coc_tag: '#AAA1', card_key: 'elx_goblin', category: 'elixir', qty_state: 0 },
    ],
  });
}

function fakeUser(id) {
  return { id };
}

describe('card-trades: getOrCreateRoom', () => {
  it('rifiuta la creazione di una stanza p2p tra profili dello stesso account', async () => {
    const admin = seedBase();
    await assert.rejects(
      () => cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#AAA2'),
      (e) => e.code === 'USE_SELF_ROOM',
    );
  });

  it('crea la stanza con profile_lo/profile_hi ordinati indipendentemente da chi la apre', async () => {
    const admin = seedBase();
    const r1 = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    assert.equal(admin.db.tables.card_event_rooms.length, 1);
    const r2 = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_B), 'p-b1', '#AAA1');
    assert.equal(admin.db.tables.card_event_rooms.length, 1, 'riusa la stessa stanza, non ne crea una seconda');
    assert.equal(r1.room.id, r2.room.id);
  });
});

describe('card-trades: proposeTrade', () => {
  let admin, roomId;
  beforeEach(async () => {
    admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    roomId = opened.room.id;
  });

  it('rifiuta categorie diverse tra card_give e card_get', async () => {
    await assert.rejects(
      () => cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'dke_minion'),
      /stessa categoria/,
    );
  });

  it('rifiuta se il proponente non ha un doppione della carta che cede', async () => {
    await assert.rejects(
      () => cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_archer', 'elx_barbarian'),
      /doppione/,
    );
  });

  it('rifiuta se il proponente ha già sbloccato la carta richiesta', async () => {
    // Alice1 ha già 1x Goblin? in questo seed ha 0, quindi impostiamo un caso "già sbloccata"
    admin.db.tables.card_event_collections.push({ coc_tag: '#AAA1', card_key: 'elx_wizard', category: 'elixir', qty_state: 1 });
    admin.db.tables.card_event_collections.push({ coc_tag: '#BBB1', card_key: 'elx_wizard', category: 'elixir', qty_state: 2 });
    await assert.rejects(
      () => cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'elx_wizard'),
      /già sbloccato/,
    );
  });

  it('rifiuta se il destinatario non ha il doppione richiesto', async () => {
    admin.db.tables.card_event_collections.find((c) => c.coc_tag === '#BBB1' && c.card_key === 'elx_archer').qty_state = 1;
    await assert.rejects(
      () => cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'elx_archer'),
      /non ha un doppione/,
    );
  });

  it('crea la proposta e un messaggio quando tutte le regole sono rispettate', async () => {
    const result = await cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'elx_archer');
    assert.equal(result.ok, true);
    assert.equal(result.proposal.status, 'pending');
    assert.equal(result.proposal.card_give, 'elx_barbarian');
    assert.equal(result.proposal.card_get, 'elx_archer');
    const messages = admin.db.tables.card_event_room_messages.filter((m) => m.room_id === roomId);
    assert.equal(messages.some((m) => m.kind === 'proposal'), true);
  });
});

describe('card-trades: respondProposal', () => {
  let admin, roomId, proposalId;
  beforeEach(async () => {
    admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    roomId = opened.room.id;
    const proposed = await cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'elx_archer');
    proposalId = proposed.proposal.id;
  });

  it('il proponente non può accettare la propria proposta', async () => {
    await assert.rejects(
      () => cardTrades.respondProposal(admin, fakeUser(USER_A), proposalId, 'p-a1', 'accept'),
      /Non puoi accettare/,
    );
  });

  it('solo il proponente può annullare la propria proposta', async () => {
    await assert.rejects(
      () => cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, 'p-b1', 'cancel'),
      /Solo chi ha proposto/,
    );
  });

  it('accettare applica lo scambio: aggiorna le collezioni di entrambi e registra lo storico', async () => {
    const res = await cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, 'p-b1', 'accept');
    assert.equal(res.status, 'accepted');

    const coll = admin.db.tables.card_event_collections;
    const get = (tag, key) => coll.find((c) => c.coc_tag === tag && c.card_key === key).qty_state;
    assert.equal(get('#AAA1', 'elx_barbarian'), 1, 'Alice ha ceduto il doppione Barbarian');
    assert.equal(get('#AAA1', 'elx_archer'), 1, 'Alice ha ricevuto Archer');
    assert.equal(get('#BBB1', 'elx_archer'), 1, 'Bob ha ceduto il doppione Archer');
    assert.equal(get('#BBB1', 'elx_barbarian'), 1, 'Bob ha ricevuto Barbarian');

    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposalId);
    assert.equal(proposal.status, 'accepted');

    assert.equal(admin.db.tables.card_event_trade_log.length, 1);
    assert.equal(admin.db.tables.card_event_trade_log[0].kind, 'p2p');
  });

  it('rifiutare marca la proposta come rejected senza toccare le collezioni', async () => {
    const before = JSON.stringify(admin.db.tables.card_event_collections);
    await cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, 'p-b1', 'reject');
    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposalId);
    assert.equal(proposal.status, 'rejected');
    assert.equal(JSON.stringify(admin.db.tables.card_event_collections), before);
  });
});

describe('card-trades: escrow — "Applica subito" a due fasi', () => {
  let admin, roomId, proposalId;
  beforeEach(async () => {
    admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    roomId = opened.room.id;
    const proposed = await cardTrades.proposeTrade(admin, fakeUser(USER_A), roomId, 'p-a1', 'elx_barbarian', 'elx_archer');
    proposalId = proposed.proposal.id;
  });

  const qty = (admin, tag, key) =>
    admin.db.tables.card_event_collections.find((c) => c.coc_tag === tag && c.card_key === key)?.qty_state;

  it('commitProposal scala subito il doppione del proponente, senza toccare l\'altro lato', async () => {
    const res = await cardTrades.commitProposal(admin, fakeUser(USER_A), proposalId, 'p-a1');
    assert.equal(res.ok, true);
    assert.equal(res.proposal.proposer_committed, true);
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 1, 'Alice ha già ceduto il doppione');
    assert.equal(qty(admin, '#AAA1', 'elx_archer'), 0, 'Alice non ha ancora ricevuto nulla');
    assert.equal(qty(admin, '#BBB1', 'elx_archer'), 2, 'Bob non ha ancora ceduto nulla');
    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposalId);
    assert.equal(proposal.status, 'pending', 'resta pending finché Bob non completa');
  });

  it('solo il proponente può confermare la propria cessione', async () => {
    await assert.rejects(
      () => cardTrades.commitProposal(admin, fakeUser(USER_B), proposalId, 'p-b1'),
      /Solo chi ha proposto/,
    );
  });

  it('commitProposal senza profile_id (bottone da notifica Telegram) risolve automaticamente il proponente', async () => {
    const res = await cardTrades.commitProposal(admin, fakeUser(USER_A), proposalId, null);
    assert.equal(res.proposal.proposer_committed, true);
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 1);
  });

  it('respondProposal senza profile_id (bottone da notifica Telegram) risolve automaticamente il destinatario', async () => {
    const res = await cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, null, 'accept');
    assert.equal(res.status, 'accepted');
  });

  it('proposeTrade con commitNow crea e conferma la cessione in un solo passaggio ("Applica subito")', async () => {
    const admin2 = seedBase();
    const opened2 = await cardTrades.getOrCreateRoom(admin2, fakeUser(USER_A), 'p-a1', '#BBB1');
    const res = await cardTrades.proposeTrade(
      admin2, fakeUser(USER_A), opened2.room.id, 'p-a1', 'elx_barbarian', 'elx_archer', { commitNow: true },
    );
    assert.equal(res.proposal.proposer_committed, true);
    assert.equal(qty(admin2, '#AAA1', 'elx_barbarian'), 1);
  });

  it('accettare una proposta già confermata (escrow) non decrementa due volte il proponente', async () => {
    await cardTrades.commitProposal(admin, fakeUser(USER_A), proposalId, 'p-a1');
    const res = await cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, 'p-b1', 'accept');
    assert.equal(res.status, 'accepted');
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 1, 'Alice ha ceduto una sola volta (escrow, non due)');
    assert.equal(qty(admin, '#AAA1', 'elx_archer'), 1, 'Alice riceve Archer al completamento');
    assert.equal(qty(admin, '#BBB1', 'elx_archer'), 1, 'Bob ha ceduto il suo doppione');
    assert.equal(qty(admin, '#BBB1', 'elx_barbarian'), 1, 'Bob riceve Barbarian al completamento');
  });

  it('annullare una proposta confermata (escrow) restituisce il doppione al proponente', async () => {
    await cardTrades.commitProposal(admin, fakeUser(USER_A), proposalId, 'p-a1');
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 1);
    const res = await cardTrades.respondProposal(admin, fakeUser(USER_A), proposalId, 'p-a1', 'cancel');
    assert.equal(res.status, 'cancelled');
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 2, 'il doppione ceduto in escrow torna ad Alice');
  });

  it('rifiutare una proposta confermata (escrow) restituisce il doppione al proponente', async () => {
    await cardTrades.commitProposal(admin, fakeUser(USER_A), proposalId, 'p-a1');
    const res = await cardTrades.respondProposal(admin, fakeUser(USER_B), proposalId, 'p-b1', 'reject');
    assert.equal(res.status, 'rejected');
    assert.equal(qty(admin, '#AAA1', 'elx_barbarian'), 2, 'il doppione ceduto in escrow torna ad Alice');
  });
});

describe('card-trades: revalidateProposalsForTag (proposte "stale")', () => {
  it('marca "stale" una proposta pending se l\'altro lato perde il doppione richiesto', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    const proposed = await cardTrades.proposeTrade(admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'elx_barbarian', 'elx_archer');

    // Bob non ha più il doppione Archer (es. l'ha aggiornato lui stesso nel frattempo).
    admin.db.tables.card_event_collections.find((c) => c.coc_tag === '#BBB1' && c.card_key === 'elx_archer').qty_state = 1;

    await cardTrades.revalidateProposalsForTag(admin, '#BBB1');
    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposed.proposal.id);
    assert.equal(proposal.status, 'stale');
    const sysMsg = admin.db.tables.card_event_room_messages.find((m) => m.kind === 'system' && /non è più applicabile/.test(m.body || ''));
    assert.ok(sysMsg, 'inserisce un messaggio di sistema che spiega l\'invalidazione');
  });

  it('quando la proposta invalidata era già "committed" (escrow), rimborsa il doppione al proponente', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    const proposed = await cardTrades.proposeTrade(
      admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'elx_barbarian', 'elx_archer', { commitNow: true },
    );
    const get = (tag, key) => admin.db.tables.card_event_collections.find((c) => c.coc_tag === tag && c.card_key === key)?.qty_state;
    assert.equal(get('#AAA1', 'elx_barbarian'), 1, 'Alice ha già ceduto in escrow');

    admin.db.tables.card_event_collections.find((c) => c.coc_tag === '#BBB1' && c.card_key === 'elx_archer').qty_state = 0;
    await cardTrades.revalidateProposalsForTag(admin, '#BBB1');

    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposed.proposal.id);
    assert.equal(proposal.status, 'stale');
    assert.equal(proposal.proposer_committed, false);
    assert.equal(get('#AAA1', 'elx_barbarian'), 2, 'il doppione ceduto in escrow torna ad Alice');
  });

  it('non tocca le proposte ancora valide', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    const proposed = await cardTrades.proposeTrade(admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'elx_barbarian', 'elx_archer');
    await cardTrades.revalidateProposalsForTag(admin, '#BBB1');
    const proposal = admin.db.tables.card_event_proposals.find((p) => p.id === proposed.proposal.id);
    assert.equal(proposal.status, 'pending');
  });
});

describe('card-trades: applySelfTrade', () => {
  it('rifiuta lo scambio tra lo stesso profilo', async () => {
    const admin = seedBase();
    await assert.rejects(
      () => cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a1', 'elx_barbarian', 'elx_goblin'),
      /due profili diversi/,
    );
  });

  it('rifiuta categorie diverse', async () => {
    const admin = seedBase();
    await assert.rejects(
      () => cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a2', 'elx_barbarian', 'dke_minion'),
      /stessa categoria/,
    );
  });

  it('applica lo scambio diretto tra due profili dello stesso account', async () => {
    const admin = seedBase();
    // Alice1 cede Barbarian (2->1), riceve Goblin (0->1); Alice2 cede Goblin (2->1), riceve Barbarian (0->1)
    admin.db.tables.card_event_collections.push({ coc_tag: '#AAA2', card_key: 'elx_barbarian', category: 'elixir', qty_state: 0 });
    const res = await cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a2', 'elx_barbarian', 'elx_goblin');
    assert.equal(res.ok, true);
    const coll = admin.db.tables.card_event_collections;
    const get = (tag, key) => coll.find((c) => c.coc_tag === tag && c.card_key === key).qty_state;
    assert.equal(get('#AAA1', 'elx_barbarian'), 1);
    assert.equal(get('#AAA1', 'elx_goblin'), 1);
    assert.equal(get('#AAA2', 'elx_goblin'), 1);
    assert.equal(get('#AAA2', 'elx_barbarian'), 1);
    assert.equal(admin.db.tables.card_event_trade_log[0].kind, 'self');
  });

  it('lo scambio self funziona anche se il ricevente possiede già la carta: la quantità si somma', async () => {
    const admin = seedBase();
    // Alice2 possiede già 1x Barbarian (non 0): con lo scambio self deve sommarsi a 2, non essere rifiutato.
    admin.db.tables.card_event_collections.push({ coc_tag: '#AAA2', card_key: 'elx_barbarian', category: 'elixir', qty_state: 1 });
    const res = await cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a2', 'elx_barbarian', 'elx_goblin');
    assert.equal(res.ok, true);
    const coll = admin.db.tables.card_event_collections;
    const get = (tag, key) => coll.find((c) => c.coc_tag === tag && c.card_key === key).qty_state;
    assert.equal(get('#AAA2', 'elx_barbarian'), 2, 'Alice2 aveva già 1 copia: ora ne ha 2 (sommata)');
    assert.equal(get('#AAA1', 'elx_barbarian'), 1, 'Alice1 ha ceduto il doppione');
  });

  it('lo scambio self funziona anche con più di 2 copie sul lato che cede (resta doppione dopo la cessione)', async () => {
    const admin = seedBase();
    admin.db.tables.card_event_collections.find((c) => c.coc_tag === '#AAA1' && c.card_key === 'elx_barbarian').qty_state = 4;
    admin.db.tables.card_event_collections.push({ coc_tag: '#AAA2', card_key: 'elx_barbarian', category: 'elixir', qty_state: 0 });
    const res = await cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a2', 'elx_barbarian', 'elx_goblin');
    assert.equal(res.ok, true);
    const coll = admin.db.tables.card_event_collections;
    const get = (tag, key) => coll.find((c) => c.coc_tag === tag && c.card_key === key).qty_state;
    assert.equal(get('#AAA1', 'elx_barbarian'), 3, 'Alice1 aveva 4 copie: dopo la cessione ne restano 3 (ancora doppione)');
  });

  it('regola invariata: con una sola copia (non doppione) non si può mai cedere una carta, nemmeno in self-trade', async () => {
    const admin = seedBase();
    // Alice1 ha solo 1x Barbarian (non un doppione): lo scambio deve essere rifiutato,
    // altrimenti Alice1 resterebbe senza la carta che aveva già sbloccato.
    admin.db.tables.card_event_collections.find((c) => c.coc_tag === '#AAA1' && c.card_key === 'elx_barbarian').qty_state = 1;
    await assert.rejects(
      () => cardTrades.applySelfTrade(admin, fakeUser(USER_A), 'p-a1', 'p-a2', 'elx_barbarian', 'elx_goblin'),
      /doppione/,
    );
    const coll = admin.db.tables.card_event_collections;
    const get = (tag, key) => coll.find((c) => c.coc_tag === tag && c.card_key === key).qty_state;
    assert.equal(get('#AAA1', 'elx_barbarian'), 1, 'Nessuna modifica: Alice1 mantiene la sua unica copia');
  });
});

describe('card-trades: mazzi pubblici', () => {
  it('setProfilePublic aggiorna il flag card_deck_public del profilo', async () => {
    const admin = seedBase();
    const res = await cardTrades.setProfilePublic(admin, fakeUser(USER_A), 'p-a1', true);
    assert.equal(res.ok, true);
    assert.equal(res.profile.card_deck_public, true);
    const row = admin.db.tables.user_coc_profiles.find((p) => p.id === 'p-a1');
    assert.equal(row.card_deck_public, true);
  });

  it('listPublicDecks esclude i profili del proprio account e quelli non pubblici', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_A), 'p-a2', true); // proprio account: va escluso
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true); // altro account: deve comparire
    const res = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(res.ok, true);
    assert.equal(res.decks.length, 1);
    assert.equal(res.decks[0].profile.coc_tag, '#BBB1');
  });

  it('listPublicDecks include i possibili scambi con quel profilo (calcolo da collezioni)', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    const res = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(res.decks[0].matches.length, 1);
    assert.equal(res.decks[0].matches[0].card_give, 'elx_barbarian');
    assert.equal(res.decks[0].matches[0].card_get, 'elx_archer');
  });

  it('listPublicDecks trova match anche se le carte mancanti non hanno riga qty=0', async () => {
    const admin = seedBase();
    // Rimuovi le righe "mancante" (qty=0): in produzione spesso non esistono
    admin.db.tables.card_event_collections = admin.db.tables.card_event_collections.filter(
      (r) => r.qty_state !== 0,
    );
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    const res = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(res.decks[0].matches.length, 1);
    assert.equal(res.decks[0].matches[0].card_give, 'elx_barbarian');
  });

  it('getMatchesForProfile mostra i match di tutti i mazzi (ogni mazzo è pubblico)', async () => {
    const admin = seedBase();
    const res = await cardTrades.getMatchesForProfile(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(res.matches.length, 1);
    assert.equal(res.matches[0].other_profile.coc_tag, '#BBB1');
    assert.equal(res.matches[0].i_unlock, true);
  });

  it('computeP2pMatches: stessa categoria, doppione vs mancante', () => {
    const matches = cardTrades.computeP2pMatches(
      { elx_barbarian: 2 },
      { elx_archer: 2 },
    );
    assert.ok(matches.some((m) => m.card_give === 'elx_barbarian' && m.card_get === 'elx_archer'));
    const hit = matches.find((m) => m.card_give === 'elx_barbarian' && m.card_get === 'elx_archer');
    assert.equal(hit.i_unlock, true);
    assert.equal(hit.they_unlock, true);
  });

  it('computeP2pMatches: visibile anche se solo l\'altro sblocca (io ricevo doppione)', () => {
    const matches = cardTrades.computeP2pMatches(
      { elx_barbarian: 2, elx_archer: 1 },
      { elx_archer: 2 },
    );
    const hit = matches.find((m) => m.card_give === 'elx_barbarian' && m.card_get === 'elx_archer');
    assert.ok(hit, 'il match deve apparire anche se io ho già arciere');
    assert.equal(hit.i_unlock, false);
    assert.equal(hit.they_unlock, true);
  });

  it('getMatchesForProfile mostra il match a entrambi i lati (anche se uno riceve doppione)', async () => {
    const admin = seedBase();
    // Bob possiede già Barbaro: Alice sblocca Arciere, Bob riceve un doppione Barbaro.
    const barb = admin.db.tables.card_event_collections.find(
      (r) => r.coc_tag === '#BBB1' && r.card_key === 'elx_barbarian',
    );
    barb.qty_state = 1;
    const fromAlice = await cardTrades.getMatchesForProfile(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(fromAlice.matches.length, 1);
    assert.equal(fromAlice.matches[0].i_unlock, true);
    assert.equal(fromAlice.matches[0].they_unlock, false);
    const fromBob = await cardTrades.getMatchesForProfile(admin, fakeUser(USER_B), 'p-b1');
    assert.ok(fromBob.matches.some((m) => m.card_give === 'elx_archer' && m.card_get === 'elx_barbarian' && m.i_unlock === false));
  });

  it('listPublicDecks include il "post" con la collezione completa del mazzo pubblicato', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    const res = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(res.decks.length, 1);
    // Bob (#BBB1) nel seed ha: elx_archer qty=2, elx_barbarian qty=0 → il post mostra solo le carte possedute.
    assert.deepEqual(res.decks[0].collection, { elx_archer: 2 });
  });

  it('my_public è sempre true: ogni mazzo è pubblico', async () => {
    const admin = seedBase();
    const before = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(before.my_public, true);
    await cardTrades.setProfilePublic(admin, fakeUser(USER_A), 'p-a1', true);
    const after = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(after.my_public, true);
  });
});

describe('card-trades: notifiche outbox (bot Telegram)', () => {
  it('sendRoomMessage accoda una notifica "message" per il destinatario', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    await cardTrades.sendRoomMessage(admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'Ciao, scambiamo?');
    const outbox = admin.db.tables.card_event_notify_outbox || [];
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].kind, 'message');
    assert.equal(outbox[0].user_id, USER_B);
  });

  it('proposeTrade accoda una notifica "proposal" per il destinatario', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    await cardTrades.proposeTrade(admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'elx_barbarian', 'elx_archer');
    const outbox = (admin.db.tables.card_event_notify_outbox || []).filter((r) => r.kind === 'proposal');
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].user_id, USER_B);
    assert.equal(outbox[0].payload.card_give_name, 'Barbaro');
  });

  it('accettare una proposta accoda una notifica "trade_done" per il proponente', async () => {
    const admin = seedBase();
    const opened = await cardTrades.getOrCreateRoom(admin, fakeUser(USER_A), 'p-a1', '#BBB1');
    const proposed = await cardTrades.proposeTrade(admin, fakeUser(USER_A), opened.room.id, 'p-a1', 'elx_barbarian', 'elx_archer');
    await cardTrades.respondProposal(admin, fakeUser(USER_B), proposed.proposal.id, 'p-b1', 'accept');
    const outbox = (admin.db.tables.card_event_notify_outbox || []).filter((r) => r.kind === 'trade_done');
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].user_id, USER_A, 'notifica destinata a chi ha proposto lo scambio');
  });

  it('notifyMatchesForTag accoda notifiche "match" per entrambi i lati senza duplicati', async () => {
    const admin = seedBase();
    await cardTrades.notifyMatchesForTag(admin, '#AAA1');
    let outbox = admin.db.tables.card_event_notify_outbox || [];
    assert.equal(outbox.length, 2);
    const forA = outbox.find((r) => r.user_id === USER_A);
    const forB = outbox.find((r) => r.user_id === USER_B);
    assert.ok(forA && forA.payload.other_coc_tag === '#BBB1');
    assert.ok(forB && forB.payload.other_coc_tag === '#AAA1');
    assert.equal(forA.payload.i_unlock, true);
    assert.equal(forB.payload.i_unlock, true);
    assert.equal(forA.payload.my_coc_tag, '#AAA1');
    assert.equal(forA.payload.other_username, 'Bob');

    await cardTrades.notifyMatchesForTag(admin, '#AAA1');
    outbox = admin.db.tables.card_event_notify_outbox || [];
    assert.equal(outbox.length, 2, 'nessuna riga duplicata per lo stesso match');
  });

  it('notifyMatchesForTag accoda anche match unilaterali (solo un lato sblocca)', async () => {
    const admin = seedBase();
    const barb = admin.db.tables.card_event_collections.find(
      (r) => r.coc_tag === '#BBB1' && r.card_key === 'elx_barbarian',
    );
    barb.qty_state = 1;
    await cardTrades.notifyMatchesForTag(admin, '#AAA1');
    const outbox = (admin.db.tables.card_event_notify_outbox || []).filter((r) => r.kind === 'match');
    assert.equal(outbox.length, 2);
    const forA = outbox.find((r) => r.user_id === USER_A);
    const forB = outbox.find((r) => r.user_id === USER_B);
    assert.equal(forA.payload.i_unlock, true);
    assert.equal(forB.payload.i_unlock, false);
  });
});

describe('card-trades: matching (enrichment su collezioni)', () => {
  it('getMatchesForProfile arricchisce i risultati con profilo e metadati carta', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    const data = await cardTrades.getMatchesForProfile(admin, fakeUser(USER_A), 'p-a1');
    assert.equal(data.ok, true);
    assert.equal(data.matches.length, 1);
    const m = data.matches[0];
    assert.equal(m.other_profile.coc_tag, '#BBB1');
    assert.equal(m.card_give_meta.name_it, 'Barbaro');
    assert.equal(m.card_get_meta.name_it, 'Arciere');
  });

  it('getSelfMatches arricchisce i risultati con i profili coinvolti', async () => {
    const admin = seedBase();
    admin.db.rpcStubs = {
      find_self_card_matches: [
        { profile_a: 'p-a1', coc_tag_a: '#AAA1', profile_b: 'p-a2', coc_tag_b: '#AAA2', card_a_to_b: 'elx_barbarian', card_b_to_a: 'elx_goblin', category: 'elixir' },
      ],
    };
    const data = await cardTrades.getSelfMatches(admin, fakeUser(USER_A));
    assert.equal(data.matches.length, 1);
    assert.equal(data.matches[0].profile_a.coc_tag, '#AAA1');
    assert.equal(data.matches[0].profile_b.coc_tag, '#AAA2');
  });

  it('getSelfMatches marca "semaforo verde" quando nessuno dei due possiede già la carta ricevuta', async () => {
    const admin = seedBase();
    admin.db.rpcStubs = {
      find_self_card_matches: [
        {
          profile_a: 'p-a1', coc_tag_a: '#AAA1', profile_b: 'p-a2', coc_tag_b: '#AAA2',
          card_a_to_b: 'elx_barbarian', card_b_to_a: 'elx_goblin', category: 'elixir',
          a_already_has_target: false, b_already_has_target: false,
        },
      ],
    };
    const data = await cardTrades.getSelfMatches(admin, fakeUser(USER_A));
    assert.equal(data.matches[0].a_is_new, true);
    assert.equal(data.matches[0].b_is_new, true);
  });

  it('getMatchesForProfile aggrega gli scambi su TUTTI i profili quando profile_id è omesso', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    // p-a2 (Alice2) ha un doppione Goblin: anche lui trova un match con Bob (Goblin -> Archer),
    // dato che Bob ha Archer in doppione e non possiede Goblin.
    const res = await cardTrades.getMatchesForProfile(admin, fakeUser(USER_A), null);
    assert.equal(res.ok, true);
    assert.equal(res.profiles.length, 2);
    assert.equal(res.matches.length, 2, 'un match per ciascuno dei 2 profili di Alice');
    const byGive = Object.fromEntries(res.matches.map((m) => [m.card_give, m]));
    assert.equal(byGive.elx_barbarian.my_profile.coc_tag, '#AAA1');
    assert.equal(byGive.elx_goblin.my_profile.coc_tag, '#AAA2');
  });

  it('listPublicDecks aggrega gli scambi su TUTTI i profili quando profile_id è omesso', async () => {
    const admin = seedBase();
    await cardTrades.setProfilePublic(admin, fakeUser(USER_B), 'p-b1', true);
    const res = await cardTrades.listPublicDecks(admin, fakeUser(USER_A), null);
    assert.equal(res.decks.length, 1);
    assert.equal(res.decks[0].matches.length, 2);
    const tags = res.decks[0].matches.map((m) => m.my_profile.coc_tag).sort();
    assert.deepEqual(tags, ['#AAA1', '#AAA2']);
  });

  it('getSelfMatches marca "semaforo giallo" per il lato che possiede già la carta che riceverebbe', async () => {
    const admin = seedBase();
    // Caso segnalato: Geped2 cede Drago Elettro ma ha già Golem Meteorite; Geped4 cede
    // Golem Meteorite ma ha già Drago Elettro → scambio possibile ma "non necessario" per entrambi.
    admin.db.rpcStubs = {
      find_self_card_matches: [
        {
          profile_a: 'p-a1', coc_tag_a: '#AAA1', profile_b: 'p-a2', coc_tag_b: '#AAA2',
          card_a_to_b: 'elx_dragon', card_b_to_a: 'elx_golem', category: 'elixir',
          a_already_has_target: true, b_already_has_target: true,
        },
      ],
    };
    const data = await cardTrades.getSelfMatches(admin, fakeUser(USER_A));
    assert.equal(data.matches[0].a_is_new, false, 'A possiede già Golem Meteorite: giallo, non verde');
    assert.equal(data.matches[0].b_is_new, false, 'B possiede già Drago Elettro: giallo, non verde');
  });
});

/**
 * Fixture anonimizzata: TH14 + BH10 ridotto (subset reale-like).
 * Usata dai test parser/calc — non contiene dati personali reali.
 */
module.exports = {
  tag: '#TESTVP99',
  timestamp: 1700000000,
  helpers: [{ data: 93000000, lvl: 4 }],
  buildings: [
    { data: 1000001, lvl: 14 },
    { data: 1000010, lvl: 15, cnt: 50 },
    { data: 1000010, lvl: 16, cnt: 275 },
    { data: 1000008, lvl: 19, cnt: 7 },
    { data: 1000009, lvl: 19, cnt: 8 },
    { data: 1000013, lvl: 15, cnt: 4 },
    { data: 1000000, lvl: 12, cnt: 4 },
    { data: 1000006, lvl: 16, cnt: 1 },
    { data: 1000007, lvl: 14, cnt: 1 },
    { data: 1000004, lvl: 15, cnt: 7 },
    { data: 1000002, lvl: 15, cnt: 7 },
    { data: 1000005, lvl: 15, cnt: 4 },
    { data: 1000003, lvl: 15, cnt: 4 },
    { data: 1000015, lvl: 5, cnt: 5 },
  ],
  traps: [
    { data: 12000000, lvl: 11, cnt: 6 },
    { data: 12000001, lvl: 10, cnt: 6 },
  ],
  units: [
    { data: 4000000, lvl: 11 },
    { data: 4000001, lvl: 11 },
  ],
  siege_machines: [{ data: 4000051, lvl: 4 }],
  heroes: [
    { data: 28000000, lvl: 90 },
    { data: 28000001, lvl: 90 },
  ],
  spells: [{ data: 26000000, lvl: 10 }],
  pets: [{ data: 73000000, lvl: 10 }],
  equipment: [{ data: 90000000, lvl: 15 }],
  buildings2: [
    { data: 1000034, lvl: 10, cnt: 1 },
    { data: 1000033, lvl: 9, cnt: 180 },
  ],
  traps2: [{ data: 12000010, lvl: 4, cnt: 6 }],
  units2: [{ data: 4000031, lvl: 18 }],
  heroes2: [{ data: 28000003, lvl: 30 }],
};

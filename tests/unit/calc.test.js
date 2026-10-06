// Unit tests for the restock calculations (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../calc.js');
const Sample = require('../../sample.js');

function fixture() {
  return {
    wards: [{ id: 'a', name: 'Ward A', route: 1 }, { id: 'b', name: 'Ward B', route: 2 }, { id: 'c', name: 'Ward C', route: 3 }],
    fluids: [
      { id: 'f1', name: 'Fluid One', pack: '1000 mL', upc: 10, loc: 'Bay B · Shelf 1', min: 20, stock: 25 },
      { id: 'f2', name: 'Fluid Two', pack: '500 mL', upc: 20, loc: 'Bay A · Shelf 1', min: 70, stock: 50 },
      { id: 'f3', name: 'Fluid Three', pack: '100 mL', upc: 50, loc: 'Bay C · Shelf 1', min: 5, stock: 100 },
    ],
    pars: { a: { f1: 10, f2: 8, f3: 6 }, b: { f1: 12, f2: 4, f3: 0 }, c: { f1: 2 } },
    history: [],
    today: { date: '2026-10-06', received: [], walks: {}, deliv: {}, picked: {} },
  };
}

test('topUp never goes negative and is null until counted', () => {
  assert.equal(C.topUp(20, 7), 13);
  assert.equal(C.topUp(20, 20), 0);
  assert.equal(C.topUp(20, 25), 0);
  assert.equal(C.topUp(20, 0), 20);
  assert.equal(C.topUp(20, null), null);
  assert.equal(C.topUp(20, ''), null);
});

test('cartonsFor rounds up to whole cartons', () => {
  assert.equal(C.cartonsFor(0, 10), 0);
  assert.equal(C.cartonsFor(1, 10), 1);
  assert.equal(C.cartonsFor(10, 10), 1);
  assert.equal(C.cartonsFor(11, 10), 2);
  assert.equal(C.cartonsFor(23, 20), 2);
  assert.equal(C.cartonsFor(5, 0), 5); // bad units per carton falls back to 1
});

test('receivedUnits handles plain quantity and cartons x units per carton', () => {
  assert.equal(C.receivedUnits({ mode: 'units', qty: 37 }), 37);
  assert.equal(C.receivedUnits({ mode: 'cartons', cartons: 6, upc: 20 }), 120);
  assert.equal(C.receivedUnits({ mode: 'cartons', cartons: 3, upc: 0 }), 3);
});

test('pick list totals across wards, sorted by store location, with per-ward breakdown', () => {
  const s = fixture();
  s.today.walks.a = { t: 'x', counts: { f1: 3, f2: 8, f3: 2 }, topups: { f1: 7, f2: 0, f3: 4 } };
  s.today.walks.b = { t: 'y', counts: { f1: 0, f2: 1 }, topups: { f1: 12, f2: 3 } };
  const pl = C.pickList(s);
  assert.deepEqual(pl.combined.map(l => [l.fluidId, l.qty]), [['f2', 3], ['f1', 19], ['f3', 4]]);
  assert.equal(pl.total, 26);
  assert.deepEqual(pl.perWard.map(w => w.wardId), ['a', 'b']);
  assert.deepEqual(pl.perWard[0].lines.map(l => [l.fluidId, l.qty]), [['f1', 7], ['f3', 4]]);
  assert.deepEqual(pl.perWard[1].lines.map(l => [l.fluidId, l.qty]), [['f2', 3], ['f1', 12]]);
});

test('order list: below minimum, shortages, pending deliveries and carton rounding', () => {
  const s = fixture();
  s.today.walks.a = { t: 'x', counts: {}, topups: { f1: 7, f2: 0, f3: 4 } };
  s.today.walks.b = { t: 'y', counts: {}, topups: { f1: 12, f2: 3 } };
  // before delivery: projected = stock - pending
  let rows = C.orderList(s);
  const r1 = rows.find(r => r.fluidId === 'f1');
  assert.equal(r1.projected, 25 - 19);
  assert.equal(r1.units, 20 - 6);
  // deliver everything; b/f1 short 2, a/f3 short 1 (store already decremented by the app)
  s.today.deliv = { a: { f1: { done: true, short: 0 }, f3: { done: true, short: 1 } }, b: { f1: { done: true, short: 2 }, f2: { done: true, short: 0 } } };
  s.fluids[0].stock = 25 - 7 - 10; s.fluids[1].stock = 50 - 3; s.fluids[2].stock = 100 - 3;
  rows = C.orderList(s);
  const by = Object.fromEntries(rows.map(r => [r.fluidId, r]));
  assert.equal(by.f1.units, (20 - 8) + 2);       // below min + shortage
  assert.equal(by.f1.cartons, 2);                // 14 units / 10 per carton
  assert.equal(by.f2.units, 70 - 47);            // below min only
  assert.equal(by.f2.cartons, 2);                // 23 / 20 -> 2
  assert.equal(by.f3.units, 1);                  // shortage only
  assert.equal(by.f3.cartons, 1);
  assert.deepEqual(by.f1.reasons.map(r => r.code), ['min', 'short']);
  assert.deepEqual(by.f3.reasons.map(r => r.code), ['short']);
  const text = C.orderText(rows, Object.fromEntries(s.fluids.map(f => [f.id, f])), 'cartons', 'x');
  assert.match(text, /Fluid Two 500 mL: 2 cartons \(40 units, 20\/carton\)/);
});

test('order list uses recent daily usage ("needed tomorrow")', () => {
  const s = fixture();
  s.fluids[2].stock = 30; s.fluids[2].min = 5;
  s.history = ['2026-10-01', '2026-10-02', '2026-10-03'].map(d => ({ date: d, walks: { a: { topups: { f3: 40 } } } }));
  const r = C.orderList(s).find(x => x.fluidId === 'f3');
  assert.equal(Math.round(r.forecast), 40);
  assert.equal(r.units, 10);
  assert.deepEqual(r.reasons.map(x => x.code), ['forecast']);
});

test('delivery plan follows route order and computes delivered = need - short', () => {
  const s = fixture();
  s.wards[0].route = 2; s.wards[1].route = 1;
  s.today.walks.a = { topups: { f1: 7 } }; s.today.walks.b = { topups: { f1: 12 } };
  s.today.deliv = { b: { f1: { done: true, short: 2 } } };
  const p = C.deliveryPlan(s);
  assert.deepEqual(p.map(w => w.wardId), ['b', 'a']);
  assert.equal(p[0].lines[0].delivered, 10);
  assert.equal(p[1].lines[0].delivered, 0);
  assert.deepEqual(C.pendingByFluid(s), { f1: 7 });
});

test('par suggestions: raise when the shelf keeps running out, lower when barely used, need 7+ days', () => {
  const s = fixture();
  const mk = (n, tA, tB) => Array.from({ length: n }, (_, i) => ({ date: '2026-09-' + String(10 + i).padStart(2, '0'), walks: { a: { counts: { f1: 10 - tA }, topups: { f1: tA } }, b: { counts: { f1: 12 - tB }, topups: { f1: tB } } } }));
  s.history = mk(6, 10, 1);
  assert.equal(C.parSuggestions(s).length, 0);
  s.history = mk(8, 10, 1);
  const sg = C.parSuggestions(s);
  const up = sg.find(x => x.wardId === 'a'); const down = sg.find(x => x.wardId === 'b');
  assert.equal(up.direction, 'up'); assert.ok(up.newPar > 10);
  assert.equal(down.direction, 'down'); assert.ok(down.newPar < 12 && down.newPar >= 1);
  assert.equal(s.pars.a.f1, 10); // never changes pars
});

test('archiveToday keeps walks, delivered, shortages and received', () => {
  const s = fixture();
  s.today.walks.a = { t: 't', counts: { f1: 3 }, topups: { f1: 7 } };
  s.today.deliv = { a: { f1: { done: true, short: 2 } } };
  s.today.received = [{ fluidId: 'f1', mode: 'cartons', cartons: 2, upc: 10 }];
  const r = C.archiveToday(s);
  assert.deepEqual(r.delivered, { a: { f1: 5 } });
  assert.deepEqual(r.short, { a: { f1: 2 } });
  assert.deepEqual(r.received, { f1: 20 });
  assert.equal(C.dayUsage(r), 7);
  assert.equal(C.archiveToday(fixture()), null);
});

test('CSV round trip with commas, quotes and the · character', () => {
  const rows = [['Fluid', 'Store location'], ['Compound Sodium Lactate (Hartmann\'s)', 'Bay C · Shelf 1'], ['A "quoted", name', '']];
  assert.deepEqual(C.parseCSV('\uFEFF' + C.toCSV(rows)), rows.filter(r => r.some(c => c)));
});

test('import validation: round trip keeps ids, catches bad rows, previews changes', () => {
  const s = fixture();
  const t = C.buildTables(s);
  const v = C.validateImport({ wards: C.parseCSV(C.toCSV(t.wards)), fluids: C.parseCSV(C.toCSV(t.fluids)), pars: C.parseCSV(C.toCSV(t.pars)) }, s);
  assert.equal(v.ok, true, v.errors.join('\n'));
  assert.deepEqual(v.next.wards.map(w => w.id), ['a', 'b', 'c']);
  assert.deepEqual(v.next.pars.a, { f1: 10, f2: 8, f3: 6 });
  assert.equal(v.next.fluids.find(f => f.id === 'f2').upc, 20);

  const bad = C.validateImport({
    fluids: [['Fluid', 'Pack size', 'Units per carton', 'Store minimum'], ['Fluid One', '1000 mL', 'ten', '5'], ['Fluid One', '1000 mL', '10', '5'], ['', '', '', '3']],
    pars: [['Fluid', 'Pack size', 'Ward A', 'Ward Z'], ['Fluid Nine', '1 L', '3', '1']],
  }, s);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /must be a whole number/.test(e)));
  assert.ok(bad.errors.some(e => /Ward Z/.test(e)));
  assert.ok(bad.errors.some(e => /not in the fluids list/.test(e)));
  assert.ok(bad.errors.some(e => /name is empty/.test(e)));

  const add = C.validateImport({ wards: [['Ward', 'Route order'], ['Ward B', 1], ['Ward A', 2], ['Ward New', 3]] }, s, p => p + 'new');
  assert.equal(add.ok, true);
  assert.equal(add.summary.wards.added, 1);
  assert.equal(add.summary.wards.removed, 1);
  assert.deepEqual(add.next.wards.map(w => w.name), ['Ward B', 'Ward A', 'Ward New']);
  assert.equal(add.next.pars.c, undefined);
});

test('detectTable recognises the three tables', () => {
  const t = C.buildTables(fixture());
  assert.equal(C.detectTable(t.wards, 'wards.csv'), 'wards');
  assert.equal(C.detectTable(t.fluids, 'fluids.csv'), 'fluids');
  assert.equal(C.detectTable(t.pars, 'pars.csv'), 'pars');
  assert.equal(C.detectTable(t.pars, 'export.csv'), 'pars');
});

test('sample data: 5 made-up wards, 12 fluids, 14 days of history, has par suggestions, no patient fields', () => {
  const s = Sample.build('2026-10-06');
  assert.equal(s.wards.length, 5); assert.equal(s.fluids.length, 12); assert.equal(s.history.length, 14);
  assert.ok(C.parSuggestions(s).length >= 3);
  const json = JSON.stringify(s).toLowerCase();
  for (const word of ['patient', 'mrn', 'dob', 'urn', 'bed']) assert.ok(!json.includes('"' + word), word);
});

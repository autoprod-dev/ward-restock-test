/* Ward Restock by Autoprod - SAMPLE DATA ONLY.
 * Made-up wards, made-up store locations and made-up quantities so the app has something to show.
 * Not clinically accurate and not from any real hospital. Stock data only: no patient fields. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WRSample = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WARDS = ['Ward 4 South', 'Ward 5 North', 'Emergency (ED)', 'PICU', 'Day Stay'];
  // name, pack, units per carton (sample), store location, store minimum, starting store stock,
  // pars for [Ward 4 South, Ward 5 North, Emergency (ED), PICU, Day Stay]
  const FLUIDS = [
    ['Sodium Chloride 0.9%', '1000 mL', 10, 'Bay A · Shelf 1', 60, 150, [20, 20, 40, 4, 10]],
    ['Sodium Chloride 0.9%', '500 mL', 20, 'Bay A · Shelf 2', 40, 100, [10, 10, 20, 6, 6]],
    ['Sodium Chloride 0.9%', '100 mL', 50, 'Bay A · Shelf 3', 50, 160, [20, 20, 30, 20, 10]],
    ['Glucose 5%', '1000 mL', 10, 'Bay B · Shelf 1', 20, 50, [6, 6, 10, 0, 4]],
    ['Glucose 5%', '500 mL', 20, 'Bay B · Shelf 2', 20, 45, [6, 6, 8, 6, 0]],
    ['Glucose 10%', '500 mL', 20, 'Bay B · Shelf 3', 10, 24, [0, 0, 4, 6, 0]],
    ["Compound Sodium Lactate (Hartmann's)", '1000 mL', 10, 'Bay C · Shelf 1', 40, 90, [12, 12, 30, 4, 10]],
    ['Plasma-Lyte 148', '1000 mL', 10, 'Bay C · Shelf 2', 30, 26, [8, 8, 20, 6, 6]],
    ['Sodium Chloride 0.45% + Glucose 5%', '1000 mL', 10, 'Bay D · Shelf 1', 10, 30, [6, 6, 4, 6, 0]],
    ['Sodium Chloride 0.9% + Glucose 5%', '1000 mL', 10, 'Bay D · Shelf 2', 10, 20, [4, 4, 4, 2, 0]],
    ['Sodium Chloride 0.9% + Potassium Chloride 20 mmol', '1000 mL', 10, 'Bay D · Shelf 3', 20, 32, [6, 6, 6, 0, 2]],
    ['Water for Injection', '100 mL', 50, 'Bay E · Shelf 1', 25, 70, [10, 10, 20, 10, 6]],
  ];
  // Usage profile (share of par used per day) for a few lines, so History has par suggestions to show.
  const PROFILE = { 'w3:f8': 1.05, 'w3:f7': 0.95, 'w4:f3': 0.98, 'w2:f4': 0.12, 'w5:f12': 0.1, 'w5:f1': 0.15, 'w1:f9': 0.14 };

  function rng(seed) { // mulberry32: same sample every time
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function build(todayStr, days) {
    days = days || 14;
    const wards = WARDS.map((name, i) => ({ id: 'w' + (i + 1), name, route: i + 1 }));
    const fluids = FLUIDS.map((r, i) => ({ id: 'f' + (i + 1), name: r[0], pack: r[1], upc: r[2], loc: r[3], min: r[4], stock: r[5] }));
    const pars = {};
    wards.forEach((w, wi) => { pars[w.id] = {}; FLUIDS.forEach((r, fi) => { pars[w.id]['f' + (fi + 1)] = r[6][wi]; }); });
    const rand = rng(20261006);
    const ratio = {};
    for (const w of wards) for (const f of fluids) ratio[w.id + ':' + f.id] = PROFILE[w.id + ':' + f.id] || (0.35 + rand() * 0.35);
    const base = todayStr ? new Date(todayStr + 'T12:00:00') : new Date();
    const history = [];
    for (let k = days; k >= 1; k--) {
      const d = new Date(base); d.setDate(d.getDate() - k);
      const dow = d.getDay();
      const rec = { date: ymd(d), walks: {}, delivered: {}, short: {}, received: {}, sample: true };
      wards.forEach((w, wi) => {
        if (w.id === 'w5' && (dow === 0 || dow === 6)) return; // Day Stay closed at weekends
        const counts = {}; const topups = {};
        const t = new Date(d); t.setHours(7 + wi, 10 + Math.floor(rand() * 40), 0, 0);
        for (const f of fluids) {
          const par = pars[w.id][f.id]; if (!par) continue;
          const used = Math.min(par, Math.max(0, Math.round(par * ratio[w.id + ':' + f.id] * (0.75 + rand() * 0.5))));
          counts[f.id] = par - used; topups[f.id] = used;
        }
        rec.walks[w.id] = { t: t.toISOString(), counts, topups };
        rec.delivered[w.id] = Object.assign({}, topups);
      });
      if (k % 3 === 0) fluids.forEach(f => { if (rand() < 0.5) rec.received[f.id] = f.upc * (2 + Math.floor(rand() * 4)); });
      history.push(rec);
    }
    return { wards, fluids, pars, history };
  }
  return { build, WARDS, FLUIDS };
});

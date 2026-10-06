/* Ward Restock by Autoprod - pure calculations (no DOM). Used by the app and by the unit tests.
 * Everything here is plain data in, plain data out. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WRCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
  function int0(v) { return Math.max(0, Math.round(num(v))); }
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });
  }

  /* ---------- core restock maths ---------- */
  // Top-up for one shelf line: never negative. Returns null while the line has not been counted.
  function topUp(par, onHand) {
    if (!has(onHand)) return null;
    return Math.max(0, int0(par) - int0(onHand));
  }
  // Whole cartons needed to cover `units` (always rounds UP).
  function cartonsFor(units, unitsPerCarton) {
    const u = int0(units);
    const per = Math.max(1, Math.floor(num(unitsPerCarton)) || 1);
    return u <= 0 ? 0 : Math.ceil(u / per);
  }
  // Units received from a pallet line: either a plain quantity or cartons x units per carton.
  function receivedUnits(entry) {
    if (!entry) return 0;
    if (entry.mode === 'cartons') return int0(entry.cartons) * Math.max(1, int0(entry.upc));
    return int0(entry.qty);
  }

  function wardsInRoute(wards) {
    return (wards || []).slice().sort((a, b) => (num(a.route) - num(b.route)) || naturalCompare(a.name, b.name));
  }
  function fluidsByLocation(fluids) {
    return (fluids || []).slice().sort((a, b) => naturalCompare(a.loc, b.loc) || naturalCompare(fluidLabel(a), fluidLabel(b)));
  }
  function fluidLabel(f) { return f ? (f.name + (f.pack ? ' ' + f.pack : '')) : ''; }
  function fluidKey(name, pack) { return (String(name || '').trim() + '|' + String(pack || '').trim()).toLowerCase().replace(/\s+/g, ' '); }
  function parOf(pars, wardId, fluidId) { return int0(((pars || {})[wardId] || {})[fluidId]); }
  // The fluids stocked on a ward (par > 0), in store-location order.
  function wardFluids(state, wardId) {
    return fluidsByLocation(state.fluids).filter(f => parOf(state.pars, wardId, f.id) > 0);
  }

  /* ---------- pick list ---------- */
  // Combined totals across every walked ward (sorted by store location) plus a per-ward breakdown.
  function pickList(state) {
    const t = state.today || {};
    const walks = t.walks || {};
    const fluids = fluidsByLocation(state.fluids);
    const wards = wardsInRoute(state.wards).filter(w => walks[w.id]);
    const combined = [];
    for (const f of fluids) {
      const per = [];
      let qty = 0;
      for (const w of wards) {
        const q = int0((walks[w.id].topups || {})[f.id]);
        if (q > 0) { per.push({ wardId: w.id, qty: q }); qty += q; }
      }
      if (qty > 0) combined.push({ fluidId: f.id, qty, loc: f.loc || '', wards: per });
    }
    const perWard = wards.map(w => ({
      wardId: w.id,
      walkedAt: walks[w.id].t,
      lines: fluids.map(f => ({ fluidId: f.id, qty: int0((walks[w.id].topups || {})[f.id]), loc: f.loc || '' })).filter(l => l.qty > 0),
    }));
    const total = combined.reduce((s, l) => s + l.qty, 0);
    return { combined, perWard, total };
  }

  /* ---------- delivery ---------- */
  // Per-ward checklist in route order. delivered = need - short once a line is ticked.
  function deliveryPlan(state) {
    const t = state.today || {};
    const walks = t.walks || {};
    const deliv = t.deliv || {};
    const fluids = fluidsByLocation(state.fluids);
    return wardsInRoute(state.wards).filter(w => walks[w.id]).map(w => {
      const lines = fluids.map(f => {
        const need = int0((walks[w.id].topups || {})[f.id]);
        const d = (deliv[w.id] || {})[f.id] || {};
        const short = Math.min(need, int0(d.short));
        return { fluidId: f.id, need, done: !!d.done, short, delivered: d.done ? need - short : 0 };
      }).filter(l => l.need > 0);
      return { wardId: w.id, lines, done: lines.length > 0 && lines.every(l => l.done), empty: lines.length === 0 };
    });
  }
  // Units still to be taken out of the store today (walked but not yet ticked as shelved).
  function pendingByFluid(state) {
    const out = {};
    for (const w of deliveryPlan(state)) for (const l of w.lines) if (!l.done) out[l.fluidId] = (out[l.fluidId] || 0) + l.need;
    return out;
  }
  function shortagesByFluid(state) {
    const out = {};
    for (const w of deliveryPlan(state)) for (const l of w.lines) if (l.done && l.short > 0) {
      (out[l.fluidId] = out[l.fluidId] || { qty: 0, wards: [] });
      out[l.fluidId].qty += l.short;
      out[l.fluidId].wards.push({ wardId: w.wardId, qty: l.short });
    }
    return out;
  }

  /* ---------- history / usage ---------- */
  // Usage for a day = the top-ups the walks found (what was used since the shelf was last filled).
  function dayUsage(rec, filter) {
    filter = filter || {};
    let total = 0;
    for (const wid of Object.keys(rec.walks || {})) {
      if (filter.wardId && wid !== filter.wardId) continue;
      const tu = rec.walks[wid].topups || {};
      for (const fid of Object.keys(tu)) {
        if (filter.fluidId && fid !== filter.fluidId) continue;
        total += int0(tu[fid]);
      }
    }
    return total;
  }
  // Merge history records by date (oldest first) so one chart bar = one calendar day.
  function historyDates(history) {
    return Array.from(new Set((history || []).map(r => r.date))).sort();
  }
  function usageByDay(history, filter, days) {
    const dates = historyDates(history);
    const pick = days ? dates.slice(-days) : dates;
    return pick.map(d => ({ date: d, total: (history || []).filter(r => r.date === d).reduce((s, r) => s + dayUsage(r, filter), 0) }));
  }
  // Average daily usage of a fluid across all wards over the last `days` recorded days (0 when no history).
  function forecastDaily(history, fluidId, days) {
    const series = usageByDay(history, { fluidId }, days || 7);
    if (!series.length) return 0;
    return series.reduce((s, d) => s + d.total, 0) / series.length;
  }
  function averagesBy(history, keyFn, days) {
    const dates = historyDates(history).slice(-(days || 14));
    const set = new Set(dates);
    const totals = {};
    for (const r of history || []) {
      if (!set.has(r.date)) continue;
      for (const wid of Object.keys(r.walks || {})) {
        const tu = r.walks[wid].topups || {};
        for (const fid of Object.keys(tu)) {
          const k = keyFn(wid, fid);
          totals[k] = (totals[k] || 0) + int0(tu[fid]);
        }
      }
    }
    const n = dates.length || 1;
    const out = {};
    for (const k of Object.keys(totals)) out[k] = { total: totals[k], perDay: totals[k] / n, days: dates.length };
    return out;
  }

  /* ---------- ordering ---------- */
  // projected = store stock (already reduced by ticked deliveries) - deliveries still to go out today.
  // Order when projected < store minimum or < recent daily usage; bring the store back up to
  // max(minimum, recent daily usage) and add any shortage still owed to a ward.
  function orderList(state, opts) {
    opts = opts || {};
    const days = opts.forecastDays || 7;
    const pending = pendingByFluid(state);
    const shortages = shortagesByFluid(state);
    const rows = [];
    for (const f of fluidsByLocation(state.fluids)) {
      const stock = Math.round(num(f.stock));
      const pend = pending[f.id] || 0;
      const projected = stock - pend;
      const min = int0(f.min);
      const forecast = forecastDaily(state.history, f.id, days);
      const fc = Math.ceil(forecast - 1e-9);
      const target = Math.max(min, fc);
      const shortage = shortages[f.id] ? shortages[f.id].qty : 0;
      const reasons = [];
      if (projected < min) reasons.push({ code: 'min', text: 'Below store minimum (' + projected + ' left, min ' + min + ')' });
      if (projected < fc && fc > min) reasons.push({ code: 'forecast', text: 'Needed tomorrow (about ' + fc + ' used a day lately)' });
      if (shortage > 0) reasons.push({ code: 'short', text: 'Shortage owed: ' + shortage, wards: shortages[f.id].wards });
      const units = Math.max(0, target - projected) + shortage;
      if (units > 0) {
        const upc = Math.max(1, int0(f.upc) || 1);
        const cartons = cartonsFor(units, upc);
        rows.push({ fluidId: f.id, stock, pending: pend, projected, min, forecast, target, shortage, units, upc, cartons, cartonUnits: cartons * upc, reasons });
      }
    }
    return rows;
  }
  function orderText(rows, fluidsById, mode, dateLabel) {
    const lines = ['Ward Restock order' + (dateLabel ? ' - ' + dateLabel : '')];
    for (const r of rows) {
      const f = fluidsById[r.fluidId];
      const q = mode === 'cartons'
        ? r.cartons + (r.cartons === 1 ? ' carton' : ' cartons') + ' (' + r.cartonUnits + ' units, ' + r.upc + '/carton)'
        : r.units + (r.units === 1 ? ' unit' : ' units');
      lines.push('- ' + fluidLabel(f) + ': ' + q);
    }
    if (!rows.length) lines.push('Nothing to order.');
    return lines.join('\n');
  }

  /* ---------- par suggestions ---------- */
  // Needs 7+ walked days for a ward x fluid. Never changes anything: returns suggestions only.
  function parSuggestions(state, opts) {
    opts = opts || {};
    const minDays = opts.minDays || 7;
    const lookback = opts.days || 14;
    const dates = historyDates(state.history).slice(-lookback);
    const set = new Set(dates);
    const out = [];
    for (const w of wardsInRoute(state.wards)) {
      for (const f of fluidsByLocation(state.fluids)) {
        const par = parOf(state.pars, w.id, f.id);
        if (par <= 0) continue;
        const samples = [];
        for (const r of state.history || []) {
          if (!set.has(r.date)) continue;
          const wk = (r.walks || {})[w.id];
          if (!wk || !wk.topups || !has(wk.topups[f.id])) continue;
          samples.push({ topup: int0(wk.topups[f.id]), onHand: wk.counts && has(wk.counts[f.id]) ? int0(wk.counts[f.id]) : null });
        }
        const n = samples.length;
        if (n < minDays) continue;
        const tops = samples.map(s => s.topup).sort((a, b) => a - b);
        const avg = tops.reduce((s, x) => s + x, 0) / n;
        const peak = tops[n - 1];
        const p90 = tops[Math.min(n - 1, Math.ceil(n * 0.9) - 1)];
        const ranOut = samples.filter(s => s.onHand === 0 || s.topup >= par).length;
        const nearEmpty = samples.filter(s => s.topup >= 0.7 * par).length;
        const lowDays = samples.filter(s => s.topup <= 0.5 * par).length;
        const avgTxt = (Math.round(avg * 10) / 10);
        if (ranOut / n >= 0.3 || (avg >= 0.85 * par && nearEmpty / n >= 0.8)) {
          const newPar = Math.max(par + 1, Math.ceil(Math.max(avg, p90) * 1.3));
          out.push({ wardId: w.id, fluidId: f.id, par, newPar, direction: 'up', days: n, avg, peak, ranOut,
            reason: 'Shelf ran out on ' + ranOut + ' of ' + n + ' days (average top-up ' + avgTxt + ' of par ' + par + '). Raise par so it lasts until the next walk.' });
        } else if (avg <= 0.35 * par && lowDays / n >= 0.8) {
          const newPar = Math.min(par - 1, Math.max(1, Math.ceil(p90 * 1.25)));
          if (newPar < par && newPar >= 1) out.push({ wardId: w.id, fluidId: f.id, par, newPar, direction: 'down', days: n, avg, peak, ranOut,
            reason: 'Average top-up only ' + avgTxt + ' a day against par ' + par + ' over ' + n + ' days (most ever ' + peak + '). Lower par to free shelf space and stock.' });
        }
      }
    }
    return out;
  }

  /* ---------- day archive ---------- */
  function archiveToday(state) {
    const t = state.today || {};
    const rec = { date: t.date, walks: {}, delivered: {}, short: {}, received: {} };
    for (const wid of Object.keys(t.walks || {})) {
      const w = t.walks[wid];
      rec.walks[wid] = { t: w.t, counts: Object.assign({}, w.counts), topups: Object.assign({}, w.topups) };
    }
    for (const w of deliveryPlan(state)) for (const l of w.lines) {
      if (l.done) (rec.delivered[w.wardId] = rec.delivered[w.wardId] || {})[l.fluidId] = l.delivered;
      if (l.done && l.short) (rec.short[w.wardId] = rec.short[w.wardId] || {})[l.fluidId] = l.short;
    }
    for (const r of t.received || []) rec.received[r.fluidId] = (rec.received[r.fluidId] || 0) + receivedUnits(r);
    const empty = !Object.keys(rec.walks).length && !Object.keys(rec.received).length;
    return empty ? null : rec;
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  /* ---------- table export / import (wards, fluids, pars) ---------- */
  const H = {
    wards: ['Ward', 'Route order'],
    fluids: ['Fluid', 'Pack size', 'Units per carton', 'Store location', 'Store minimum', 'Store stock'],
    parsLead: ['Fluid', 'Pack size'],
  };
  function buildTables(state) {
    const wards = wardsInRoute(state.wards);
    const fluids = fluidsByLocation(state.fluids);
    return {
      wards: [H.wards].concat(wards.map((w, i) => [w.name, i + 1])),
      fluids: [H.fluids].concat(fluids.map(f => [f.name, f.pack || '', int0(f.upc) || 1, f.loc || '', int0(f.min), Math.round(num(f.stock))])),
      pars: [H.parsLead.concat(wards.map(w => w.name))].concat(fluids.map(f => [f.name, f.pack || ''].concat(wards.map(w => parOf(state.pars, w.id, f.id))))),
    };
  }
  const norm = s => String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const ALIASES = {
    ward: ['ward', 'ward name', 'name'], route: ['route order', 'route', 'order', 'route #'],
    fluid: ['fluid', 'fluid name', 'name', 'item'], pack: ['pack size', 'pack', 'size', 'volume'],
    upc: ['units per carton', 'per carton', 'carton qty', 'units/carton'], loc: ['store location', 'location', 'bay', 'shelf', 'bay/shelf'],
    min: ['store minimum', 'minimum', 'min', 'store min'], stock: ['store stock', 'stock', 'on hand', 'current store stock'],
  };
  function colIndex(header, key) {
    const h = header.map(norm);
    for (const a of ALIASES[key]) { const i = h.indexOf(a); if (i >= 0) return i; }
    return -1;
  }
  // Work out which table a sheet/CSV holds from its header row (and optional sheet/file name).
  function detectTable(rows, name) {
    const header = (rows && rows[0]) || [];
    const n = norm(name);
    const hasFluid = colIndex(header, 'fluid') >= 0;
    if (/\bpar/.test(n) && hasFluid) return 'pars';
    if (colIndex(header, 'upc') >= 0 || colIndex(header, 'min') >= 0 || colIndex(header, 'stock') >= 0 || colIndex(header, 'loc') >= 0) return 'fluids';
    if (/fluid/.test(n) && hasFluid) return 'fluids';
    if (colIndex(header, 'route') >= 0 || (/ward/.test(n) && colIndex(header, 'ward') >= 0)) return 'wards';
    if (hasFluid && header.length > 2) return 'pars';
    return null;
  }
  function readCount(v, label, rowNo, errors, opts) {
    opts = opts || {};
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (s === '') { if (opts.required) errors.push('Row ' + rowNo + ': ' + label + ' is empty.'); return opts.dflt !== undefined ? opts.dflt : 0; }
    const x = Number(s);
    if (!Number.isFinite(x) || x < 0 || Math.round(x) !== x) { errors.push('Row ' + rowNo + ': ' + label + ' "' + s + '" must be a whole number 0 or more.'); return null; }
    if (opts.min1 && x < 1) { errors.push('Row ' + rowNo + ': ' + label + ' must be at least 1.'); return null; }
    return x;
  }
  /* tables: {wards?: rows, fluids?: rows, pars?: rows} (arrays of arrays, header first).
   * Returns {ok, errors, warnings, next:{wards,fluids,pars}, summary}. Matching is by name so ids
   * (and history) survive a round trip. Tables not supplied are kept as they are. */
  function validateImport(tables, current, makeId) {
    makeId = makeId || ((p, i) => p + '_' + Date.now().toString(36) + '_' + i);
    const errors = []; const warnings = []; const summary = {};
    let wards = current.wards.map(w => Object.assign({}, w));
    let fluids = current.fluids.map(f => Object.assign({}, f));
    let pars = JSON.parse(JSON.stringify(current.pars || {}));

    if (tables.wards) {
      const rows = tables.wards; const hdr = rows[0] || [];
      const iW = colIndex(hdr, 'ward'); const iR = colIndex(hdr, 'route');
      const errs = [];
      if (iW < 0) errs.push('Wards: no "Ward" column found.');
      const byName = new Map(current.wards.map(w => [norm(w.name), w]));
      const seen = new Set(); const next = [];
      if (iW >= 0) rows.slice(1).forEach((r, i) => {
        const rowNo = i + 2; const name = String(r[iW] === undefined || r[iW] === null ? '' : r[iW]).trim();
        if (!name) { if (r.some(c => String(c).trim())) errs.push('Wards row ' + rowNo + ': ward name is empty.'); return; }
        if (seen.has(norm(name))) { errs.push('Wards row ' + rowNo + ': "' + name + '" is listed twice.'); return; }
        seen.add(norm(name));
        const route = iR >= 0 ? readCount(r[iR], 'Route order', rowNo, errs, { dflt: next.length + 1 }) : next.length + 1;
        const old = byName.get(norm(name));
        next.push({ id: old ? old.id : makeId('w', i), name, route: route === null ? next.length + 1 : route, _new: !old });
      });
      if (iW >= 0 && !next.length) errs.push('Wards: no wards found.');
      errors.push(...errs.map(e => e.startsWith('Wards') ? e : 'Wards ' + e.charAt(0).toLowerCase() + e.slice(1)));
      const removed = current.wards.filter(w => !seen.has(norm(w.name)));
      summary.wards = { rows: next.length, added: next.filter(w => w._new).length, removed: removed.length, removedNames: removed.map(w => w.name) };
      next.sort((a, b) => a.route - b.route).forEach((w, i) => { w.route = i + 1; delete w._new; });
      wards = next;
    }
    if (tables.fluids) {
      const rows = tables.fluids; const hdr = rows[0] || [];
      const idx = {}; ['fluid', 'pack', 'upc', 'loc', 'min', 'stock'].forEach(k => { idx[k] = colIndex(hdr, k); });
      const errs = [];
      if (idx.fluid < 0) errs.push('Fluids: no "Fluid" column found.');
      const byKey = new Map(current.fluids.map(f => [fluidKey(f.name, f.pack), f]));
      const seen = new Set(); const next = [];
      if (idx.fluid >= 0) rows.slice(1).forEach((r, i) => {
        const rowNo = i + 2; const cell = k => (idx[k] >= 0 && r[idx[k]] !== undefined && r[idx[k]] !== null) ? String(r[idx[k]]).trim() : '';
        const name = cell('fluid'); const pack = cell('pack');
        if (!name) { if (r.some(c => String(c).trim())) errs.push('Fluids row ' + rowNo + ': fluid name is empty.'); return; }
        const key = fluidKey(name, pack);
        if (seen.has(key)) { errs.push('Fluids row ' + rowNo + ': "' + name + ' ' + pack + '" is listed twice.'); return; }
        seen.add(key);
        const e0 = errs.length;
        const upc = readCount(cell('upc'), 'Units per carton', rowNo, errs, { dflt: 1, min1: true });
        const min = readCount(cell('min'), 'Store minimum', rowNo, errs, { dflt: 0 });
        const stock = readCount(cell('stock'), 'Store stock', rowNo, errs, { dflt: 0 });
        if (errs.length > e0) return;
        if (idx.upc < 0 || cell('upc') === '') warnings.push('Fluids row ' + rowNo + ': no units per carton, using 1.');
        const old = byKey.get(key);
        next.push({ id: old ? old.id : makeId('f', i), name, pack, upc, loc: cell('loc'), min, stock, _new: !old });
      });
      if (idx.fluid >= 0 && !next.length) errs.push('Fluids: no fluids found.');
      errors.push(...errs.map(e => e.startsWith('Fluids') ? e : 'Fluids ' + e.charAt(0).toLowerCase() + e.slice(1)));
      const removed = current.fluids.filter(f => !seen.has(fluidKey(f.name, f.pack)));
      summary.fluids = { rows: next.length, added: next.filter(f => f._new).length, removed: removed.length, removedNames: removed.map(fluidLabel) };
      next.forEach(f => delete f._new);
      fluids = next;
    }
    // keep pars only for wards/fluids that still exist
    const wardIds = new Set(wards.map(w => w.id)); const fluidIds = new Set(fluids.map(f => f.id));
    const kept = {};
    for (const wid of Object.keys(pars)) if (wardIds.has(wid)) {
      kept[wid] = {};
      for (const fid of Object.keys(pars[wid])) if (fluidIds.has(fid)) kept[wid][fid] = pars[wid][fid];
    }
    pars = kept;
    if (tables.pars) {
      const rows = tables.pars; const hdr = rows[0] || [];
      const iF = colIndex(hdr, 'fluid'); const iP = colIndex(hdr, 'pack');
      const errs = [];
      if (iF < 0) errs.push('Pars: no "Fluid" column found.');
      const wardByName = new Map(wards.map(w => [norm(w.name), w]));
      const fluidByKey = new Map(fluids.map(f => [fluidKey(f.name, f.pack), f]));
      const fluidByLabel = new Map(fluids.map(f => [norm(fluidLabel(f)), f]));
      const cols = [];
      hdr.forEach((h, i) => {
        if (i === iF || i === iP || !String(h || '').trim()) return;
        const w = wardByName.get(norm(h));
        if (w) cols.push({ i, w }); else errs.push('Pars: column "' + String(h).trim() + '" does not match any ward.');
      });
      const next = {};
      let cells = 0; let set = 0;
      const seenF = new Set();
      if (iF >= 0) rows.slice(1).forEach((r, i) => {
        const rowNo = i + 2; const name = String(r[iF] === undefined || r[iF] === null ? '' : r[iF]).trim();
        const pack = iP >= 0 ? String(r[iP] === undefined || r[iP] === null ? '' : r[iP]).trim() : '';
        if (!name) { if (r.some(c => String(c).trim())) errs.push('Pars row ' + rowNo + ': fluid name is empty.'); return; }
        const f = fluidByKey.get(fluidKey(name, pack)) || (iP < 0 ? fluidByLabel.get(norm(name)) : null);
        if (!f) { errs.push('Pars row ' + rowNo + ': "' + (name + ' ' + pack).trim() + '" is not in the fluids list.'); return; }
        if (seenF.has(f.id)) { errs.push('Pars row ' + rowNo + ': "' + fluidLabel(f) + '" is listed twice.'); return; }
        seenF.add(f.id);
        for (const c of cols) {
          const v = readCount(r[c.i], 'Par for ' + c.w.name, rowNo, errs, { dflt: 0 });
          if (v === null) continue;
          (next[c.w.id] = next[c.w.id] || {})[f.id] = v; cells++; if (v > 0) set++;
        }
      });
      errors.push(...errs.map(e => e.startsWith('Pars') ? e : 'Pars ' + e.charAt(0).toLowerCase() + e.slice(1)));
      summary.pars = { cells, nonZero: set, wards: cols.length, fluids: seenF.size };
      // wards/fluids not in the sheet keep their current pars
      for (const wid of Object.keys(next)) pars[wid] = Object.assign({}, pars[wid] || {}, next[wid]);
    } else if (tables.wards && summary.wards && summary.wards.added) {
      warnings.push('New wards have no pars yet: set them in Setup → Pars or import a Pars sheet.');
    }
    if (summary.wards && summary.wards.removed) warnings.push('Removing ' + summary.wards.removed + ' ward(s): ' + summary.wards.removedNames.join(', ') + '.');
    if (summary.fluids && summary.fluids.removed) warnings.push('Removing ' + summary.fluids.removed + ' fluid(s): ' + summary.fluids.removedNames.join(', ') + '.');
    return { ok: errors.length === 0, errors, warnings, summary, next: { wards, fluids, pars } };
  }

  return {
    num, int0, naturalCompare, topUp, cartonsFor, receivedUnits, wardsInRoute, fluidsByLocation, fluidLabel, fluidKey,
    parOf, wardFluids, pickList, deliveryPlan, pendingByFluid, shortagesByFluid, dayUsage, historyDates, usageByDay,
    forecastDaily, averagesBy, orderList, orderText, parSuggestions, archiveToday, toCSV, parseCSV, buildTables,
    detectTable, validateImport, HEADERS: H,
  };
});

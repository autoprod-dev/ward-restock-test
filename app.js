/* Ward Restock by Autoprod.
 * Offline, single-page app. All data lives in this browser's localStorage on this device:
 * no server, no login, no analytics, no network calls after the page has loaded.
 * Stock data only - there are no patient fields anywhere. */
'use strict';
(function () {
const C = window.WRCalc;
const KEY = 'wardRestock.v1';
const APP_VERSION = '1.1.1';
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const view = $('#view');
let S = null;              // app state
let importPreview = null;  // pending import (nothing applied until "Apply")
let routeName = 'today';
let scanEngine = '';     // which QR decoder the last scan used

/* ---------- small helpers ---------- */
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dateOf(s) { return new Date(s + 'T12:00:00'); }
function fmtDate(s, opts) { return dateOf(s).toLocaleDateString('en-AU', opts || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtShort(s) { const d = dateOf(s); return d.getDate() + '/' + (d.getMonth() + 1); }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''; }
function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function int0(v) { return C.int0(v); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function fluidById(id) { return S.fluids.find(f => f.id === id); }
function wardById(id) { return S.wards.find(w => w.id === id); }
function fl(f) { return f ? C.fluidLabel(f) : '(deleted fluid)'; }
/* box mode: everything handed out or ordered is in whole boxes (cartons), pieces second */
function BX() { return !!S.settings.boxes; }
function inBoxes(f) { return BX() && C.upcKnown(f); }
function codeTag(f) { return f && f.code ? '<span class="pcode">' + esc(f.code) + '</span> ' : ''; }
function checkChip(f) { return C.needsCartonCheck(f) ? ' <span class="chip warn ck" title="Units per carton not confirmed">check carton</span>' : ''; }
// big number + small caption for a quantity cell
function qtyCell(units, f) {
  if (!BX()) { const hint = cartonHint(units, f); return units + (hint ? '<small>' + esc(hint) + '</small>' : ''); }
  if (!C.upcKnown(f)) return units + '<small>' + esc(C.unitWord(f, units)) + '</small>';
  const b = C.boxesFor(units, f); const pcs = b * C.upcOf(f);
  return b + '<small>' + (b === 1 ? 'box' : 'boxes') + ' · ' + pcs + ' ' + esc(C.unitWord(f, pcs)) + '</small>';
}
function totalBoxes(lines) { return lines.reduce((s, l) => s + (C.upcKnown(fluidById(l.fluidId)) ? C.boxesFor(l.qty !== undefined ? l.qty : l.need, fluidById(l.fluidId)) : 0), 0); }
function cartonHint(units, f) {
  const per = Math.max(1, int0(f && f.upc) || 1);
  if (per <= 1 || units < per) return '';
  const c = Math.floor(units / per), r = units % per;
  return c + ' ctn' + (r ? ' + ' + r : '');
}
const ICON = {
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H3v-8h18v8h-3M6 14h12v7H6z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></svg>',
};

/* ---------- state ---------- */
function freshToday(date) { return { date: date || ymd(), received: [], walks: {}, drafts: {}, deliv: {}, picked: {}, receiveSkipped: false, orderDone: false }; }
function defaultSettings() { return { orderMode: 'units', theme: 'light', labelWard: '', labelsPerPage: 8, boxes: true }; }
function sampleState() {
  const b = window.WRSample.build(ymd());
  return { v: 1, isSample: true, sampleHistory: true, setup: null, wards: b.wards, fluids: b.fluids, pars: b.pars, history: b.history, today: freshToday(), settings: defaultSettings() };
}
function emptyState() { return { v: 1, isSample: false, sampleHistory: false, wards: [], fluids: [], pars: {}, history: [], today: freshToday(), settings: defaultSettings() }; }
function normalise(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.wards) || !Array.isArray(s.fluids)) throw new Error('Not a Ward Restock backup');
  s.v = 1; s.pars = s.pars || {}; s.history = Array.isArray(s.history) ? s.history : [];
  s.settings = Object.assign(defaultSettings(), s.settings || {});
  s.today = Object.assign(freshToday(), s.today || {});
  ['walks', 'drafts', 'deliv', 'picked'].forEach(k => { if (!s.today[k] || typeof s.today[k] !== 'object') s.today[k] = {}; });
  if (!Array.isArray(s.today.received)) s.today.received = [];
  s.wards.forEach((w, i) => { w.id = w.id || uid('w'); w.name = String(w.name || 'Ward ' + (i + 1)); w.route = int0(w.route) || i + 1; w.on = w.on !== false; w.note = String(w.note || ''); });
  // upc 0 = carton size not known yet (shows 'check carton')
  s.fluids.forEach(f => { f.id = f.id || uid('f'); f.name = String(f.name || 'Fluid'); f.pack = String(f.pack || ''); f.upc = f.upc === undefined ? 1 : int0(f.upc); f.loc = String(f.loc || ''); f.min = int0(f.min); f.stock = Math.round(Number(f.stock) || 0);
    f.code = String(f.code || ''); f.unit = String(f.unit || 'bag'); f.upcOk = f.upcOk !== false; f.note = String(f.note || ''); });
  s.setup = s.setup && typeof s.setup === 'object' ? s.setup : null;
  return s;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalise(JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data', e); }
  return sampleState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save on this device (storage full or blocked).'); }
  chrome();
}
// Any change to wards, fluids or pars means it is no longer the untouched sample.
function touchSetup() { if (S.isSample) S.isSample = false; }

/* ---------- undo + toast + dialogs ---------- */
let toastTimer = null;
function toast(msg, opts) {
  opts = opts || {};
  const el = $('#toast');
  el.innerHTML = '<div class="t"><span class="grow">' + esc(msg) + '</span>' + (opts.undo ? '<button type="button" data-toast="undo">Undo</button>' : '') + (opts.action ? '<button type="button" data-toast="act">' + esc(opts.action.label) + '</button>' : '') + '</div>';
  const b = $('[data-toast="undo"]', el); if (b) b.onclick = () => { hideToast(); opts.undo(); };
  const a = $('[data-toast="act"]', el); if (a) a.onclick = () => { hideToast(); opts.action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.undo || opts.action ? 10000 : 3500);
}
function hideToast() { $('#toast').innerHTML = ''; }
// Destructive actions: snapshot, act, save, offer Undo.
function undoable(msg, fn) {
  const snap = JSON.stringify(S);
  fn();
  save(); render();
  toast(msg, { undo: () => { S = normalise(JSON.parse(snap)); save(); render(); toast('Undone.'); } });
}
function modal(opts) {
  const d = $('#dlg');
  return new Promise(resolve => {
    d.innerHTML = '<form method="dialog"><div class="dbody"><h2 id="dlgTitle">' + esc(opts.title) + '</h2>' + (opts.html || '<p>' + esc(opts.body || '') + '</p>') + '</div><div class="dacts">' +
      (opts.buttons || [{ label: 'Cancel', value: '' }, { label: 'OK', value: 'ok', cls: 'primary' }]).map(b => '<button class="btn ' + (b.cls || '') + '" value="' + esc(b.value) + '" type="submit">' + esc(b.label) + '</button>').join('') + '</div></form>';
    const done = () => { d.removeEventListener('close', done); const v = d.returnValue; resolve(v ? { value: v, form: $('form', d) } : null); };
    d.returnValue = '';
    d.addEventListener('close', done);
    if (opts.onOpen) opts.onOpen(d);
    d.showModal();
    const first = $(opts.focus || '.dacts .btn:last-child', d); if (first) first.focus();
  });
}
async function confirmBox(title, body, okLabel, danger) {
  const r = await modal({ title, body, buttons: [{ label: 'Cancel', value: '' }, { label: okLabel || 'OK', value: 'ok', cls: danger ? 'danger solid' : 'primary' }] });
  return !!r;
}

/* ---------- steps (the "today" state) ---------- */
function stockedWards() { return C.wardsInRoute(S.wards).filter(w => C.wardFluids(S, w.id).length); }
function onWards() { return C.wardsInRoute(S.wards).filter(w => w.on !== false); }
function steps() {
  const t = S.today;
  const pl = C.pickList(S);
  const dp = C.deliveryPlan(S);
  const sw = stockedWards();
  const walked = sw.filter(w => t.walks[w.id]).length;
  const anyWalk = Object.keys(t.walks).length > 0;
  const pickKeys = pl.combined.map(l => 'c:' + l.fluidId);
  const picked = pickKeys.filter(k => t.picked[k]).length;
  const lines = dp.reduce((a, w) => a.concat(w.lines), []);
  const shelved = lines.filter(l => l.done).length;
  const st = (done, part) => done ? 'done' : part ? 'part' : 'todo';
  const out = [
    { key: 'receive', label: 'Receive', status: st(t.received.length > 0 || t.receiveSkipped), detail: t.received.length ? plural(t.received.length, 'pallet line') + ' logged' : t.receiveSkipped ? 'Nothing to receive today' : 'Log pallets into the store' },
    { key: 'walk', label: 'Ward walk', status: st(sw.length > 0 && (walked >= sw.length || (walked > 0 && (picked > 0 || shelved > 0 || t.orderDone))), walked > 0), detail: walked + ' of ' + sw.length + ' wards walked' },
    { key: 'pick', label: 'Pick list', status: anyWalk ? st(picked === pickKeys.length, picked > 0) : 'todo', detail: !anyWalk ? 'After a ward walk' : pickKeys.length ? picked + ' of ' + pickKeys.length + ' lines picked' : 'Nothing to pick' },
    { key: 'deliver', label: 'Delivery', status: anyWalk ? st(shelved === lines.length, shelved > 0) : 'todo', detail: !anyWalk ? 'After picking' : lines.length ? shelved + ' of ' + lines.length + ' lines shelved' : 'Nothing to deliver' },
    { key: 'order', label: 'Ordering', status: st(t.orderDone), detail: t.orderDone ? 'Order sent' : 'Tomorrow\'s order' },
  ];
  const cur = out.find(s => s.status !== 'done');
  out.forEach(s => { s.current = s === cur; });
  return out;
}

/* ---------- chrome: banners, nav state, theme ---------- */
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = $('meta[name="theme-color"]'); if (m) m.content = dark ? '#10233f' : '#0a4fb8';
}
function chrome() {
  applyTheme();
  const b = [];
  if (S.isSample) b.push('<div class="banner sample row nowrap" role="note"><span class="grow"><strong>SAMPLE DATA</strong> (made up). To use yours: <b>Setup → Import / export</b> → Load setup or Excel.</span><a class="btn sm" href="#setup/io">Replace</a></div>');
  if (S.today.date !== ymd()) b.push('<div class="banner day" role="note">Still on the round from <b>' + esc(fmtDate(S.today.date)) + '</b>. <div class="row"><button class="btn sm primary" type="button" data-act="newday">Start new day</button></div></div>');
  $('#banners').innerHTML = b.join('');
  const stp = steps();
  $$('.bottomnav a, .topbar a[data-nav]').forEach(a => {
    const isCur = a.dataset.nav === routeName;
    if (isCur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    const s = stp.find(x => x.key === a.dataset.step);
    if (s) {
      a.classList.toggle('done', s.status === 'done');
      a.classList.toggle('part', s.status === 'part');
      a.classList.toggle('next', s.current);
      const st = $('[data-status]', a); if (st) st.textContent = ', step ' + (stp.indexOf(s) + 1) + ', ' + (s.status === 'done' ? 'done' : s.status === 'part' ? 'in progress' : 'to do') + (s.current ? ', next step' : '');
    }
  });
}

/* ---------- router ---------- */
const VIEWS = {};
function parseHash() { const h = (location.hash || '#today').slice(1).split('/'); return { name: VIEWS[h[0]] ? h[0] : 'today', arg: h[1] || '', arg2: h[2] || '' }; }
let lastHash = '';
function render(opts) {
  const r = parseHash();
  const changed = location.hash !== lastHash;
  lastHash = location.hash;
  routeName = r.name;
  const y = window.scrollY;
  view.innerHTML = VIEWS[r.name](r);
  chrome();
  if (changed && !(opts && opts.keepScroll)) { window.scrollTo(0, 0); if (opts && opts.focus) view.focus({ preventScroll: true }); }
  else window.scrollTo(0, y);
  document.title = (r.name === 'today' ? '' : (TITLES[r.name] || '') + ' · ') + 'Ward Restock by Autoprod (TEST)';
  if (AFTER[r.name]) AFTER[r.name](r);
}
const TITLES = { receive: 'Receiving', walk: 'Ward walk', pick: 'Pick list', deliver: 'Delivery', order: 'Ordering', history: 'History', setup: 'Setup' };
const AFTER = {};
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { if (/^#setup=/.test(location.hash)) { openSetupLink(); return; } render({ focus: true }); });

/* ---------- stepper helper ---------- */
function stepper(id, value, label, opts) {
  opts = opts || {};
  const v = value === null || value === undefined ? '' : value;
  return '<div class="stepper" data-stepper="' + esc(id) + '">' +
    '<button type="button" data-step="-1" aria-label="Decrease ' + esc(label) + '">−</button>' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="' + esc(id) + '" value="' + esc(v) + '" placeholder="' + esc(opts.placeholder || '–') + '" aria-label="' + esc(label) + '"' + (opts.max !== undefined ? ' data-max="' + opts.max + '"' : '') + (opts.min !== undefined ? ' data-min="' + opts.min + '"' : '') + '>' +
    '<button type="button" data-step="1" aria-label="Increase ' + esc(label) + '">+</button></div>';
}
function readStepper(input) { const s = String(input.value).trim(); if (s === '') return null; const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : null; }
// one delegated handler for every stepper on the page; fires 'wr-change' on the input
document.addEventListener('click', e => {
  const b = e.target.closest('.stepper button[data-step]');
  if (!b) return;
  const inp = $('input', b.parentElement);
  const cur = readStepper(inp);
  const min = inp.dataset.min !== undefined ? int0(inp.dataset.min) : 0;
  const max = inp.dataset.max !== undefined ? int0(inp.dataset.max) : Infinity;
  let n = cur === null ? (b.dataset.step === '1' ? 1 : 0) : cur + Number(b.dataset.step);
  n = Math.max(min, Math.min(max, n));
  inp.value = n;
  inp.dispatchEvent(new CustomEvent('wr-change', { bubbles: true }));
});
document.addEventListener('input', e => {
  if (e.target.matches('.stepper input')) {
    const cleaned = e.target.value.replace(/[^0-9]/g, '');
    if (cleaned !== e.target.value) e.target.value = cleaned;
    e.target.dispatchEvent(new CustomEvent('wr-change', { bubbles: true }));
  }
});

/* ================= TODAY ================= */
VIEWS.today = () => {
  const stp = steps();
  const cur = stp.find(s => s.current);
  const orders = C.orderList(S);
  const below = orders.filter(r => r.reasons.some(x => x.code === 'min')).length;
  const shorts = Object.values(C.shortagesByFluid(S)).reduce((s, x) => s + x.qty, 0);
  const pl = C.pickList(S);
  const href = { receive: '#receive', walk: '#walk', pick: '#pick', deliver: '#deliver', order: '#order' };
  return '<h1>Today</h1><p class="sub">' + esc(fmtDate(S.today.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + (S.setup ? ' · <span class="setupname">' + esc(S.setup.name) + '</span>' : '') + '</p>' +
    '<ol class="steps" aria-label="Today\'s steps">' + stp.map((s, i) =>
      '<li class="' + s.status + (s.current ? ' current' : '') + '"><a href="' + href[s.key] + '"><span class="num" aria-hidden="true">' + (s.status === 'done' ? '✓' : i + 1) + '</span><span><span class="lbl">' + esc(s.label) + '</span><br><span class="det">' + esc(s.detail) + '</span></span>' +
      '<span class="chip ' + (s.status === 'done' ? 'ok' : s.current ? 'info' : s.status === 'part' ? 'warn' : '') + '">' + (s.status === 'done' ? 'Done' : s.current ? 'Next' : s.status === 'part' ? 'Started' : 'To do') + '</span></a></li>').join('') + '</ol>' +
    '<div class="stats">' +
      '<div class="stat"><span class="muted small">To top up today' + (BX() ? ' (boxes)' : '') + '</span><b>' + (BX() ? totalBoxes(pl.combined) : pl.total) + '</b></div>' +
      '<div class="stat"><span class="muted small">Fluids to order</span><b>' + orders.length + '</b></div>' +
      '<div class="stat"><span class="muted small">Below store min</span><b>' + below + '</b></div>' +
      '<div class="stat"><span class="muted small">Shortages today</span><b>' + shorts + '</b></div>' +
    '</div>' +
    '<div class="actionbar">' + (cur
      ? '<a class="btn primary big block" href="' + href[cur.key] + '">Next: ' + esc(cur.label) + ' →</a>'
      : '<button class="btn primary big block" type="button" data-act="newday">All done · Start new day</button>') + '</div>' +
    (cur ? '<div class="btnrow"><button class="btn" type="button" data-act="newday">Start new day</button></div>' : '') +
    '<p class="muted small">Start new day saves today\'s walks, deliveries and shortages into History and clears the steps. Store stock is kept.</p>';
};
async function startNewDay() {
  const rec = C.archiveToday(S);
  const ok = await confirmBox('Start a new day?', rec
    ? 'Today\'s walks, deliveries and shortages move into History and the five steps start again. Store stock stays as it is.'
    : 'Nothing was walked or received today, so nothing goes into History. The steps start again.', 'Start new day');
  if (!ok) return;
  undoable('New day started. ' + (rec ? 'Yesterday is in History.' : ''), () => {
    if (rec) { S.history.push(rec); if (S.history.length > 400) S.history = S.history.slice(-400); }
    S.today = freshToday();
  });
  go('#today');
}

/* ================= 1. RECEIVING ================= */
let recvState = { fluidId: '', mode: 'cartons', qty: null, cartons: null, upc: null };
VIEWS.receive = () => {
  const fluids = C.fluidsByLocation(S.fluids);
  if (!fluids.length) return '<h1><span class="stepno">1</span>Receiving</h1><div class="card empty">No fluids yet. Add them in <a href="#setup/fluids">Setup → Fluids</a>.</div>';
  if (!fluidById(recvState.fluidId)) recvState.fluidId = fluids[0].id;
  const f = fluidById(recvState.fluidId);
  const upc = recvState.upc === null ? f.upc : recvState.upc;
  const units = C.receivedUnits({ mode: recvState.mode, qty: recvState.qty, cartons: recvState.cartons, upc });
  const list = S.today.received.slice().reverse();
  return '<h1><span class="stepno">1</span>Receiving</h1><p class="sub">Log each pallet line in to add it to store stock.</p>' +
    '<div class="card">' +
      '<label class="field"><span>Fluid</span><select id="rcvFluid">' + fluids.map(x => '<option value="' + esc(x.id) + '"' + (x.id === f.id ? ' selected' : '') + '>' + esc(fl(x)) + '</option>').join('') + '</select></label>' +
      '<p class="muted small" id="rcvStock">' + codeTag(f) + 'In store now: <b>' + f.stock + '</b> · ' + esc(f.loc || 'no location') + ' · ' + (C.upcKnown(f) ? f.upc + ' per carton' : 'carton size not set') + checkChip(f) + '</p>' +
      '<div class="seg" role="group" aria-label="Count by"><button type="button" data-rmode="cartons" aria-pressed="' + (recvState.mode === 'cartons') + '">Cartons × per carton</button><button type="button" data-rmode="units" aria-pressed="' + (recvState.mode === 'units') + '">Units</button></div>' +
      (recvState.mode === 'units'
        ? '<label class="field" for="rcvQty"><span>Quantity (units)</span></label>' + stepper('rcvQty', recvState.qty, 'Quantity in units', { placeholder: '0' })
        : '<label class="field" for="rcvCartons"><span>Cartons</span></label>' + stepper('rcvCartons', recvState.cartons, 'Number of cartons', { placeholder: '0' }) +
          '<label class="field"><span>Units per carton</span><input type="text" inputmode="numeric" id="rcvUpc" value="' + esc(upc) + '"></label>') +
      '<p class="big" id="rcvTotal" aria-live="polite" style="font-size:1.15rem;font-weight:800;margin-top:10px">' + esc(rcvText(f, units)) + '</p>' +
      '<button class="btn primary big block" type="button" data-act="receive"' + (units > 0 ? '' : ' disabled') + '>Add to store stock</button>' +
    '</div>' +
    '<h2>Received today (' + list.length + ')</h2>' +
    (list.length ? '<ul class="list card tight">' + list.map(r => {
      const x = fluidById(r.fluidId);
      return '<li class="line" style="grid-template-columns:1fr auto auto"><span><span class="nm">' + esc(fl(x)) + '</span><br><span class="meta">' + esc(fmtTime(r.t)) + (r.mode === 'cartons' ? ' · ' + r.cartons + ' × ' + r.upc : '') + '</span></span><span class="q">+' + r.units + '</span>' +
        '<button class="btn sm danger" type="button" data-act="unreceive" data-id="' + esc(r.id) + '" aria-label="Remove ' + esc(fl(x)) + ' plus ' + r.units + '">' + ICON.trash + '</button></li>';
    }).join('') + '</ul>' : '<div class="card empty">Nothing logged yet today.</div>') +
    (S.today.received.length || S.today.receiveSkipped ? '' : '<div class="btnrow"><button class="btn" type="button" data-act="skipreceive">No delivery today · skip</button></div>') +
    (S.today.received.length || S.today.receiveSkipped ? '<div class="btnrow"><a class="btn big" href="#walk">Done receiving · Ward walk →</a></div>' : '');
};
function rcvText(f, units) {
  if (BX() && recvState.mode === 'cartons') return 'Adds ' + units + ' ' + C.unitWord(f, units) + ' (' + plural(int0(recvState.cartons), 'box', 'boxes') + ') → store ' + (f.stock + units);
  return 'Adds ' + units + ' units → store ' + (f.stock + units);
}
function updateReceiveTotal() {
  const f = fluidById(recvState.fluidId); if (!f) return;
  const upc = recvState.upc === null ? f.upc : recvState.upc;
  const units = C.receivedUnits({ mode: recvState.mode, qty: recvState.qty, cartons: recvState.cartons, upc });
  $('#rcvTotal').textContent = rcvText(f, units);
  $('[data-act="receive"]').disabled = !(units > 0);
}
view.addEventListener('wr-change', e => {
  if (routeName !== 'receive') return;
  if (e.target.id === 'rcvQty') recvState.qty = readStepper(e.target);
  if (e.target.id === 'rcvCartons') recvState.cartons = readStepper(e.target);
  updateReceiveTotal();
});
view.addEventListener('input', e => {
  if (e.target.id === 'rcvUpc') { const v = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); recvState.upc = Number.isFinite(v) ? v : 0; updateReceiveTotal(); }
});
view.addEventListener('change', e => {
  if (e.target.id === 'rcvFluid') { recvState.fluidId = e.target.value; recvState.upc = null; render(); }
});
function doReceive() {
  const f = fluidById(recvState.fluidId); if (!f) return;
  const upc = recvState.upc === null ? f.upc : Math.max(1, recvState.upc);
  const units = C.receivedUnits({ mode: recvState.mode, qty: recvState.qty, cartons: recvState.cartons, upc });
  if (units <= 0) return;
  S.today.received.push({ id: uid('r'), t: new Date().toISOString(), fluidId: f.id, mode: recvState.mode, qty: recvState.mode === 'units' ? units : null, cartons: recvState.mode === 'cartons' ? int0(recvState.cartons) : null, upc, units });
  f.stock += units;
  recvState.qty = null; recvState.cartons = null; recvState.upc = null;
  save(); render();
  toast('Added ' + units + ' × ' + fl(f) + '. Store now ' + f.stock + '.');
}

/* ================= 2. WARD WALK ================= */
VIEWS.walk = (r) => {
  if (r.arg && wardById(r.arg)) return walkWard(wardById(r.arg));
  const wards = onWards();
  if (!wards.length) return '<h1><span class="stepno">2</span>Ward walk</h1><div class="card empty">No wards yet. Add them in <a href="#setup/wards">Setup → Wards</a>.</div>';
  const walked = wards.filter(w => S.today.walks[w.id]).length;
  return '<h1><span class="stepno">2</span>Ward walk</h1><p class="sub">Pick a ward, count what is on the shelf. Top-ups work themselves out. ' + walked + ' of ' + stockedWards().length + ' walked.</p>' +
    wards.map(w => {
      const n = C.wardFluids(S, w.id).length;
      const wk = S.today.walks[w.id];
      const tot = wk ? (BX() ? totalBoxes(Object.keys(wk.topups).map(fid => ({ fluidId: fid, qty: int0(wk.topups[fid]) })).filter(l => fluidById(l.fluidId))) + ' boxes' : Object.values(wk.topups).reduce((s, x) => s + int0(x), 0)) : 0;
      const draft = S.today.drafts[w.id] ? Object.keys(S.today.drafts[w.id]).length : 0;
      return '<a class="wardbtn' + (wk ? ' walked' : '') + '" href="#walk/' + esc(w.id) + '"><span class="grow"><span class="nm">' + esc(w.name) + '</span><br><span class="muted small">' +
        (n ? plural(n, 'fluid line') : 'No pars set') + (wk ? ' · walked ' + esc(fmtTime(wk.t)) : draft ? ' · ' + draft + ' counted so far' : '') + '</span></span>' +
        (wk ? '<span class="chip ok">✓ ' + tot + ' to top up</span>' : '<span class="chip">Not walked</span>') + '</a>';
    }).join('') +
    (walked ? '<div class="actionbar"><a class="btn primary big block" href="#pick">Next: Pick list →</a></div>' : '');
};
function walkCounts(wardId) {
  const t = S.today;
  if (!t.drafts[wardId]) t.drafts[wardId] = t.walks[wardId] ? Object.assign({}, t.walks[wardId].counts) : {};
  return t.drafts[wardId];
}
function walkWard(w) {
  const fluids = C.wardFluids(S, w.id);
  const counts = walkCounts(w.id);
  const wk = S.today.walks[w.id];
  const counted = fluids.filter(f => counts[f.id] !== undefined && counts[f.id] !== null).length;
  return '<div class="walkhead"><a class="btn sm ghost" href="#walk" aria-label="Back to all wards">←</a><div class="grow"><h1>' + esc(w.name) + '</h1><span class="muted small">' + (wk ? 'Saved ' + esc(fmtTime(wk.t)) : 'Not saved yet') + ' · <span id="walkCounted">' + counted + ' of ' + fluids.length + '</span> counted</span></div>' +
    (fluids.length ? '<button class="btn sm" type="button" data-act="scan" aria-label="Scan a shelf label">' + ICON.cam + 'Scan</button>' : '') + '</div>' +
    '<p class="sub small">' + (BX() ? 'Count the <b>boxes</b> on the shelf (count a part box if it is at least half full). <b>Full</b> = at par.' : 'Count what is on the shelf. <b>Full</b> = at par.') + '</p>' +
    (fluids.length ? '' : '<div class="card empty">No pars set for this ward. Set them in <a href="#setup/pars">Setup → Pars</a>.</div>') +
    fluids.map(f => {
      const par = C.effPar(S, w.id, f);
      const c = counts[f.id];
      const tu = C.topUp(par, c);
      const bx = inBoxes(f);
      return '<section class="fcard' + (tu !== null ? ' counted' : '') + '" id="fc-' + esc(f.id) + '" data-fid="' + esc(f.id) + '" aria-label="' + esc(fl(f)) + '">' +
        '<div class="fhead"><div><div class="fname">' + esc(f.name) + '</div><div class="fmeta">' + esc(f.pack) + ' · <b>Par ' + (bx ? esc(C.boxText(par, f)) : par) + '</b> · ' + codeTag(f) + esc(f.loc) + '</div></div>' +
        '<div class="topup ' + (tu === null ? '' : tu > 0 ? 'need' : 'zero') + '" aria-live="polite"><span class="tl">Top up' + (bx ? ' boxes' : '') + '</span><span class="tv" data-topup>' + (tu === null ? '–' : bx ? tu / C.upcOf(f) : tu) + '</span></div></div>' +
        '<div class="frow"><div><div class="lbl">' + (bx ? 'Boxes on shelf' : 'On shelf') + '</div>' + stepper('cnt-' + f.id, c === undefined || c === null ? c : bx ? Math.ceil(c / C.upcOf(f)) : c, (bx ? 'Boxes on shelf, ' : 'On shelf, ') + fl(f), { max: 999 }) + '</div>' +
        '<button class="btn full" type="button" data-act="full" data-fid="' + esc(f.id) + '" aria-label="' + esc(fl(f)) + ' is full (' + (bx ? esc(C.boxText(par, f)) : par) + ')">Full</button></div></section>';
    }).join('') +
    (fluids.length ? '<div class="actionbar"><button class="btn primary big block" type="button" data-act="savewalk" data-ward="' + esc(w.id) + '"' + (counted < fluids.length ? ' aria-disabled="true"' : '') + '>' + walkSaveLabel(w.id) + '</button></div>' : '');
}
function walkSaveLabel(wardId) {
  const fluids = C.wardFluids(S, wardId); const counts = walkCounts(wardId);
  const left = fluids.filter(f => counts[f.id] === undefined || counts[f.id] === null).length;
  if (left) return 'Count ' + left + ' more to save';
  if (BX()) return 'Save walk · ' + plural(fluids.reduce((s, f) => s + C.boxesFor(C.topUp(C.effPar(S, wardId, f), counts[f.id]), f), 0), 'box', 'boxes') + ' to top up';
  const tot = fluids.reduce((s, f) => s + C.topUp(C.parOf(S.pars, wardId, f.id), counts[f.id]), 0);
  return 'Save walk · ' + tot + ' to top up';
}
function setCount(wardId, fid, value, inputEl) {
  const counts = walkCounts(wardId);
  if (value === null) delete counts[fid]; else counts[fid] = value;
  save();
  const card = $('#fc-' + CSS.escape(fid));
  if (card) {
    const f = fluidById(fid); const bx = inBoxes(f); const per = C.upcOf(f);
    const par = C.effPar(S, wardId, f);
    const tu = C.topUp(par, value);
    if (inputEl !== $('input', card)) $('input', card).value = value === null ? '' : bx ? Math.ceil(value / per) : value;
    $('[data-topup]', card).textContent = tu === null ? '–' : bx ? tu / per : tu;
    const box = $('.topup', card); box.className = 'topup ' + (tu === null ? '' : tu > 0 ? 'need' : 'zero');
    card.classList.toggle('counted', tu !== null);
  }
  const wc = $('#walkCounted');
  if (wc) { const fs = C.wardFluids(S, wardId); wc.textContent = fs.filter(f => counts[f.id] !== undefined && counts[f.id] !== null).length + ' of ' + fs.length; }
  const b = $('[data-act="savewalk"]');
  if (b) { b.textContent = walkSaveLabel(wardId); const left = /^Count/.test(b.textContent); if (left) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); }
}
view.addEventListener('wr-change', e => {
  if (routeName !== 'walk') return;
  const card = e.target.closest('.fcard'); if (!card) return;
  const v = readStepper(e.target); const f = fluidById(card.dataset.fid);
  setCount(parseHash().arg, card.dataset.fid, v !== null && inBoxes(f) ? v * C.upcOf(f) : v, e.target);
});
function saveWalk(wardId) {
  const w = wardById(wardId); const fluids = C.wardFluids(S, wardId); const counts = walkCounts(wardId);
  const left = fluids.filter(f => counts[f.id] === undefined || counts[f.id] === null);
  if (left.length) {
    const card = $('#fc-' + CSS.escape(left[0].id));
    if (card) { card.scrollIntoView({ block: 'center' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); $('input', card).focus({ preventScroll: true }); }
    toast('Count ' + plural(left.length, 'more line') + ' first (' + fl(left[0]) + ').');
    return;
  }
  const topups = {}; const cnt = {};
  fluids.forEach(f => { cnt[f.id] = counts[f.id]; topups[f.id] = C.topUp(C.effPar(S, wardId, f), counts[f.id]); });
  // a re-walk replaces the old one: undo any shelving already ticked for this ward
  let cleared = false;
  const dv = S.today.deliv[wardId] || {};
  for (const fid of Object.keys(dv)) { if (dv[fid].done) { const f = fluidById(fid); if (f) f.stock += int0(dv[fid].applied); cleared = true; } }
  delete S.today.deliv[wardId];
  S.today.walks[wardId] = { t: new Date().toISOString(), counts: cnt, topups };
  delete S.today.drafts[wardId];
  save();
  const tot = BX() ? plural(totalBoxes(Object.keys(topups).map(fid => ({ fluidId: fid, qty: topups[fid] }))), 'box', 'boxes') : Object.values(topups).reduce((s, x) => s + x, 0);
  toast(w.name + ' saved: ' + tot + ' to top up.' + (cleared ? ' Its delivery ticks were reset.' : ''));
  go('#walk');
}

/* ================= 3. PICK LIST ================= */
function wardShort(w) { return w ? w.name : '?'; }
VIEWS.pick = () => {
  const pl = C.pickList(S);
  const head = '<h1><span class="stepno">3</span>Pick list</h1>';
  if (!pl.perWard.length) return head + '<div class="card empty">Walk a ward first, then its top-ups show here.<div class="btnrow"><a class="btn primary" href="#walk">Go to ward walk</a></div></div>';
  const t = S.today;
  const pickedN = pl.combined.filter(l => t.picked['c:' + l.fluidId]).length;
  return head + '<p class="sub">' + plural(pl.perWard.length, 'walked ward') + ' · <b>' + (BX() ? plural(totalBoxes(pl.combined), 'box', 'boxes') : pl.total + '</b> units') + (BX() ? '</b>' : '') + ' · ' + pickedN + ' of ' + pl.combined.length + ' picked. Sorted by store location.</p>' +
    '<p class="printonly">Ward Restock by Autoprod · ' + esc(fmtDate(t.date)) + ' · printed ' + esc(fmtTime(new Date().toISOString())) + '</p>' +
    '<div class="btnrow noprint tight3"><a class="btn sm" href="#pick-combined" data-jump="pick-combined">Combined</a><a class="btn sm" href="#pick-wards" data-jump="pick-wards">By ward</a><button class="btn sm" type="button" data-act="print">' + ICON.print + 'Print</button></div>' +
    '<h2 id="pick-combined">Combined totals</h2>' +
    (pl.combined.length ? '<ul class="list card tight">' + pl.combined.map(l => {
      const f = fluidById(l.fluidId); const k = 'c:' + l.fluidId; const done = !!t.picked[k];
      const wq = q => BX() && C.upcKnown(f) ? C.boxesFor(q, f) : q;
      return '<li class="line' + (done ? ' done' : '') + '"><label class="tick"><input type="checkbox" data-pick="' + esc(k) + '"' + (done ? ' checked' : '') + ' aria-label="Picked ' + esc(fl(f)) + ', ' + (BX() ? C.boxText(l.qty, f) : l.qty) + '"></label>' +
        '<span><span class="nm">' + esc(fl(f)) + checkChip(f) + '</span><br><span class="meta">' + codeTag(f) + '<b>' + esc(l.loc || 'No location') + '</b> · ' + l.wards.map(x => esc(wardShort(wardById(x.wardId))) + ' ' + wq(x.qty)).join(' · ') + '</span></span>' +
        '<span class="q">' + qtyCell(l.qty, f) + '</span></li>';
    }).join('') + '</ul>' : '<div class="card empty">Every walked shelf was full. Nothing to pick.</div>') +
    '<h2 id="pick-wards">By ward (for loading the trolley)</h2>' +
    pl.perWard.map(pw => {
      const w = wardById(pw.wardId);
      const tot = BX() ? plural(totalBoxes(pw.lines), 'box', 'boxes') : pw.lines.reduce((s, l) => s + l.qty, 0) + ' units';
      return '<section class="card tight"><div class="row"><h3 class="grow">' + esc(w.name) + '</h3><span class="chip">' + tot + '</span></div>' +
        (pw.lines.length ? '<ul class="list">' + pw.lines.map(l => {
          const f = fluidById(l.fluidId); const k = 'w:' + pw.wardId + ':' + l.fluidId; const done = !!t.picked[k];
          return '<li class="line' + (done ? ' done' : '') + '"><label class="tick"><input type="checkbox" data-pick="' + esc(k) + '"' + (done ? ' checked' : '') + ' aria-label="Loaded for ' + esc(w.name) + ': ' + esc(fl(f)) + ', ' + (BX() ? C.boxText(l.qty, f) : l.qty) + '"></label>' +
            '<span><span class="nm">' + esc(fl(f)) + '</span><br><span class="meta">' + codeTag(f) + esc(l.loc) + '</span></span><span class="q">' + (BX() ? qtyCell(l.qty, f) : l.qty) + '</span></li>';
        }).join('') + '</ul>' : '<p class="muted">All full · nothing for this ward.</p>') + '</section>';
    }).join('') +
    '<div class="actionbar"><a class="btn primary big block" href="#deliver">Next: Delivery →</a></div>';
};
view.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.pick;
  if (!k) return;
  if (e.target.checked) S.today.picked[k] = true; else delete S.today.picked[k];
  // ticking every per-ward line of a fluid also ticks its combined line, and the other way round
  if (k.startsWith('c:')) {
    const fid = k.slice(2);
    C.pickList(S).perWard.forEach(pw => { if (pw.lines.some(l => l.fluidId === fid)) { if (e.target.checked) S.today.picked['w:' + pw.wardId + ':' + fid] = true; else delete S.today.picked['w:' + pw.wardId + ':' + fid]; } });
  } else {
    const fid = k.split(':')[2];
    const all = C.pickList(S).perWard.filter(pw => pw.lines.some(l => l.fluidId === fid)).every(pw => S.today.picked['w:' + pw.wardId + ':' + fid]);
    if (all) S.today.picked['c:' + fid] = true; else delete S.today.picked['c:' + fid];
  }
  save(); render({ keepScroll: true });
});

/* ================= 4. DELIVERY ================= */
VIEWS.deliver = () => {
  const plan = C.deliveryPlan(S);
  const head = '<h1><span class="stepno">4</span>Delivery</h1>';
  if (!plan.length) return head + '<div class="card empty">Nothing to deliver yet. Walk a ward first.<div class="btnrow"><a class="btn primary" href="#walk">Go to ward walk</a></div></div>';
  const lines = plan.reduce((a, w) => a.concat(w.lines), []);
  const done = lines.filter(l => l.done).length;
  return head + '<p class="sub">Tick each line once it is on the shelf. ' + done + ' of ' + lines.length + ' shelved.</p>' +
    '<section class="card tight" aria-labelledby="routeTitle"><h2 id="routeTitle" style="margin:4px 0 0">Route order</h2><p class="muted small" style="margin:0 0 4px">Drag <b>⠿</b> or use the arrows. Saved for next time.</p>' +
    '<ol class="list" id="route">' + plan.map((pw, i) => {
      const w = wardById(pw.wardId);
      const nDone = pw.lines.filter(l => l.done).length;
      return '<li class="wardcard routerow" data-ward="' + esc(w.id) + '">' +
        '<button class="btn sm ghost handle" type="button" aria-label="Drag to reorder ' + esc(w.name) + '" data-drag>' + ICON.grip + '</button>' +
        '<span class="stopn" aria-hidden="true">' + (i + 1) + '</span>' +
        '<a class="grow rname" href="#stop-' + esc(w.id) + '" data-jump="stop-' + esc(w.id) + '">' + esc(w.name) + '<br><span class="muted small">' + (pw.empty ? 'Nothing to drop off' : nDone + ' of ' + pw.lines.length + ' shelved') + '</span></a>' +
        '<button class="btn sm" type="button" data-move="-1" data-ward="' + esc(w.id) + '" aria-label="Move ' + esc(w.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        '<button class="btn sm" type="button" data-move="1" data-ward="' + esc(w.id) + '" aria-label="Move ' + esc(w.name) + ' down"' + (i === plan.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button></li>';
    }).join('') + '</ol></section>' +
    plan.map((pw, i) => {
      const w = wardById(pw.wardId);
      const nDone = pw.lines.filter(l => l.done).length;
      return '<section class="card wardsec" id="stop-' + esc(w.id) + '" data-wardsec="' + esc(w.id) + '"><div class="row nowrap"><h3 class="grow"><span class="muted small">Stop ' + (i + 1) + '</span><br>' + esc(w.name) + '</h3>' +
        '<span class="chip ' + (pw.done || pw.empty ? 'ok' : '') + '">' + (pw.empty ? 'Nothing' : (pw.done ? '✓ ' : '') + nDone + '/' + pw.lines.length) + '</span></div>' +
        (pw.empty ? '<p class="muted">Shelves were full. Nothing to drop off.</p>' : pw.lines.map(l => {
          const f = fluidById(l.fluidId);
          return '<div class="dline' + (l.done ? ' done' : '') + '" data-fid="' + esc(l.fluidId) + '"><label class="tick"><input type="checkbox" data-shelve="' + esc(w.id) + '|' + esc(l.fluidId) + '"' + (l.done ? ' checked' : '') + ' aria-label="Shelved ' + esc(fl(f)) + ' on ' + esc(w.name) + '"></label>' +
            '<span class="nmcol"><span class="nm">' + esc(fl(f)) + '</span><br><span class="meta">' + codeTag(f) + '</span>' + (l.short ? '<br><span class="chip warn">Short ' + (inBoxes(f) ? plural(l.short / C.upcOf(f), 'box', 'boxes') : l.short) + ' · delivered ' + (inBoxes(f) ? l.delivered / C.upcOf(f) : l.delivered) + '</span>' : '') + '</span>' +
            '<span class="qcol"><span class="q">' + (BX() ? qtyCell(l.need, f) : l.need) + '</span><button class="btn sm shortbtn' + (l.short ? ' danger' : '') + '" type="button" data-short="' + esc(w.id) + '|' + esc(l.fluidId) + '" aria-label="' + (l.short ? 'Edit shortage' : 'Short: flag a shortage') + ', ' + esc(fl(f)) + ' on ' + esc(w.name) + '">' + (l.short ? 'Edit' : 'Short') + '</button></span></div>';
        }).join('')) + '</section>';
    }).join('') +
    '<div class="actionbar"><a class="btn primary big block" href="#order">' + (done === lines.length ? 'Next: Ordering →' : 'Ordering (' + (lines.length - done) + ' lines left)') + '</a></div>';
};
function setDelivery(wardId, fid, done, short) {
  const t = S.today;
  const dv = (t.deliv[wardId] = t.deliv[wardId] || {});
  const cur = dv[fid] || {};
  const f = fluidById(fid);
  if (cur.done && f) f.stock += int0(cur.applied);        // undo the old store movement first
  const need = int0(((t.walks[wardId] || {}).topups || {})[fid]);
  const s = Math.min(need, int0(short));
  if (done) { const applied = need - s; if (f) f.stock -= applied; dv[fid] = { done: true, short: s, applied }; }
  else dv[fid] = { done: false, short: 0, applied: 0 };
}
view.addEventListener('change', e => {
  const v = e.target.dataset && e.target.dataset.shelve;
  if (!v) return;
  const [wid, fid] = v.split('|');
  const cur = ((S.today.deliv[wid] || {})[fid]) || {};
  setDelivery(wid, fid, e.target.checked, e.target.checked ? cur.short : 0);
  save(); render({ keepScroll: true });
});
async function flagShort(wid, fid) {
  const w = wardById(wid); const f = fluidById(fid);
  const per = inBoxes(f) ? C.upcOf(f) : 1; const unitLbl = per > 1 ? ' boxes' : '';
  const need = int0(S.today.walks[wid].topups[fid]) / per;
  const cur = ((S.today.deliv[wid] || {})[fid]) || {};
  const start = cur.short ? cur.short / per : 1;
  const r = await modal({
    title: 'Short on ' + w.name,
    html: '<p><b>' + esc(fl(f)) + '</b><br>Needed ' + need + unitLbl + '. How many' + unitLbl + ' could you <b>not</b> deliver?</p>' + stepper('shortQty', start, per > 1 ? 'Boxes short' : 'Units short', { min: 0, max: need }) +
      '<p id="shortNote" class="muted" aria-live="polite" style="margin-top:10px">Delivered ' + (need - start) + ' of ' + need + unitLbl + '. The shortage goes on tomorrow\'s order.</p>',
    buttons: (cur.short ? [{ label: 'Clear shortage', value: 'clear', cls: 'danger' }] : []).concat([{ label: 'Cancel', value: '' }, { label: 'Save shortage', value: 'ok', cls: 'primary' }]),
    focus: '#shortQty',
    onOpen: d => { d.addEventListener('wr-change', () => { const n = Math.min(need, readStepper($('#shortQty', d)) || 0); $('#shortNote', d).textContent = 'Delivered ' + (need - n) + ' of ' + need + unitLbl + '. The shortage goes on tomorrow\'s order.'; }); },
  });
  if (!r) return;
  if (r.value === 'clear') { setDelivery(wid, fid, !!cur.done, 0); save(); render({ keepScroll: true }); toast('Shortage cleared.'); return; }
  const n = Math.min(need, readStepper($('#shortQty', r.form)) || 0);
  setDelivery(wid, fid, true, n * per);
  save(); render({ keepScroll: true });
  toast(n ? 'Short ' + n + unitLbl + ' × ' + fl(f) + ' flagged. It is on tomorrow\'s order.' : 'Delivered in full.');
}
// Route order: walked wards are reordered among their own slots in the full route.
function applyRouteOrder(walkedIdsInNewOrder) {
  const all = C.wardsInRoute(S.wards);
  const set = new Set(walkedIdsInNewOrder);
  const queue = walkedIdsInNewOrder.slice();
  const merged = all.map(w => set.has(w.id) ? wardById(queue.shift()) : w);
  merged.forEach((w, i) => { w.route = i + 1; });
  touchSetup();
  save();
}
function moveWard(wid, dir) {
  const ids = C.deliveryPlan(S).map(p => p.wardId);
  const i = ids.indexOf(wid); const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  applyRouteOrder(ids);
  render({ keepScroll: true });
  const btn = $('[data-move="' + dir + '"][data-ward="' + CSS.escape(wid) + '"]');
  (btn && !btn.disabled ? btn : $('[data-move][data-ward="' + CSS.escape(wid) + '"]:not([disabled])'))?.focus();
  toast(wardById(wid).name + ' is now stop ' + (j + 1) + '.');
}
// pointer-based drag (works with touch, pen and mouse); the handle has touch-action:none
let drag = null;
view.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-drag]'); if (!h) return;
  const item = h.closest('.wardcard'); if (!item) return;
  e.preventDefault();
  h.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, item, list: item.parentElement, handle: h, moved: false };
  item.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const y = e.clientY;
  const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  // move the neighbours rather than the dragged card, so the pointer capture is never lost
  let prev = drag.item.previousElementSibling, next = drag.item.nextElementSibling;
  while (prev && y < mid(prev)) { drag.list.insertBefore(prev, drag.item.nextSibling); drag.moved = true; prev = drag.item.previousElementSibling; }
  while (next && y > mid(next)) { drag.list.insertBefore(next, drag.item); drag.moved = true; next = drag.item.nextElementSibling; }
  if (y < 90) window.scrollBy(0, -12); else if (y > window.innerHeight - 140) window.scrollBy(0, 12);
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag; drag = null;
  d.item.classList.remove('dragging');
  if (d.moved) {
    const ids = $$('.wardcard', d.list).map(x => x.dataset.ward);
    applyRouteOrder(ids);
    render({ keepScroll: true });
    toast('Route order saved.');
  }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ================= 5. ORDERING ================= */
VIEWS.order = () => {
  const rows = C.orderList(S);
  const mode = BX() ? 'boxes' : S.settings.orderMode;
  const pend = C.pendingByFluid(S);
  const pendingTotal = Object.values(pend).reduce((s, x) => s + x, 0);
  return '<h1><span class="stepno">5</span>Tomorrow\'s order</h1>' +
    '<p class="sub">Projected store stock = store stock − deliveries still to go out' + (pendingTotal ? ' (<b>' + pendingTotal + '</b> units not shelved yet)' : '') + '. Anything under the store minimum or tomorrow\'s usual use is ordered, plus shortages.</p>' +
    '<p class="printonly">Ward Restock by Autoprod · ' + esc(fmtDate(ymd())) + '</p>' +
    (BX() ? '<p class="small muted">Ordered in whole boxes (rounded up). Switch in Setup → Data.</p>' : '<div class="seg" role="group" aria-label="Order in"><button type="button" data-omode="units" aria-pressed="' + (mode === 'units') + '">Units</button><button type="button" data-omode="cartons" aria-pressed="' + (mode === 'cartons') + '">Cartons</button></div>') +
    (rows.length ? '<ul class="list" id="orderList">' + rows.map(r => {
      const f = fluidById(r.fluidId);
      const q = mode === 'boxes' ? (C.upcKnown(f) ? r.cartons + ' <span class="u">' + (r.cartons === 1 ? 'box' : 'boxes') + '</span> <small>= ' + r.cartonUnits + ' ' + esc(C.unitWord(f, r.cartonUnits)) + ' (' + r.upc + '/box)</small>' : r.units + ' <span class="u">' + esc(C.unitWord(f, r.units)) + '</span>')
        : mode === 'cartons'
        ? r.cartons + ' <span class="u">' + (r.cartons === 1 ? 'carton' : 'cartons') + '</span> <small>= ' + r.cartonUnits + ' units (' + r.upc + '/ctn)</small>'
        : r.units + ' <span class="u">' + (r.units === 1 ? 'unit' : 'units') + '</span>';
      return '<li class="card orow" data-fid="' + esc(r.fluidId) + '"><div class="row nowrap" style="align-items:flex-start"><div class="grow"><div class="fname">' + esc(fl(f)) + checkChip(f) + '</div>' + (f.code ? '<div class="fmeta">' + codeTag(f) + '</div>' : '') +
        '<div class="fmeta">Store ' + r.stock + (r.pending ? ' − ' + r.pending + ' to deliver' : '') + ' → <b>' + r.projected + '</b> · min ' + r.min + (r.forecast ? ' · uses ~' + Math.ceil(r.forecast) + '/day' : '') + '</div></div>' +
        '<div class="q" data-qty>' + q + '</div></div><div class="wrapchips">' + r.reasons.map(x => '<span class="chip ' + (x.code === 'short' ? 'danger' : x.code === 'min' ? 'warn' : 'info') + '">' + esc(x.code === 'short' ? 'Shortage ' + x.wards.map(sw => (wardById(sw.wardId) || {}).name + ' ' + sw.qty).join(', ') : x.code === 'min' ? 'Below min' : 'Needed tomorrow') + '</span>').join('') + '</div></li>';
    }).join('') + '</ul>' : '<div class="card empty">Nothing to order: every fluid is above its store minimum and there are no shortages.</div>') +
    '<div class="btnrow"><button class="btn" type="button" data-act="copyorder">' + ICON.copy + 'Copy as text</button>' +
      '<button class="btn" type="button" data-act="shareorder"' + (navigator.share ? '' : ' aria-disabled="true" title="Sharing is not available in this browser"') + '>' + ICON.share + 'Share</button>' +
      '<button class="btn" type="button" data-act="print">' + ICON.print + 'Print</button></div>' +
    (navigator.share ? '' : '<p class="muted small noprint">Share is not available in this browser: use Copy or Print.</p>') +
    '<details class="card noprint"><summary style="min-height:48px;display:flex;align-items:center;font-weight:700;cursor:pointer">Store stock, all fluids</summary><div class="scrollx" style="margin-top:8px"><table class="data"><thead><tr><th>Fluid</th><th class="n">Store</th><th class="n">To deliver</th><th class="n">Projected</th><th class="n">Min</th></tr></thead><tbody>' +
      C.fluidsByLocation(S.fluids).map(f => { const p = pend[f.id] || 0; const pr = f.stock - p; return '<tr><td>' + esc(fl(f)) + '<br><span class="muted small">' + esc(f.loc) + '</span></td><td class="n">' + f.stock + '</td><td class="n">' + p + '</td><td class="n"><b>' + pr + '</b></td><td class="n">' + f.min + '</td></tr>'; }).join('') +
    '</tbody></table></div></details>' +
    '<div class="actionbar">' + (S.today.orderDone ? '<button class="btn primary big block" type="button" data-act="newday">Order sent ✓ · Start new day</button>' : '<button class="btn primary big block" type="button" data-act="orderdone">Mark order as sent</button>') + '</div>';
};
function orderTextNow() {
  const byId = {}; S.fluids.forEach(f => { byId[f.id] = f; });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  return C.orderText(C.orderList(S), byId, BX() ? 'boxes' : S.settings.orderMode, 'for ' + fmtDate(ymd(tomorrow)));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove(); return ok;
  }
}

/* ================= 6. HISTORY ================= */
let histFilter = { wardId: '', fluidId: '' };
function barChartSvg(series, label) {
  const W = 360, H = 190, padL = 30, padB = 34, padT = 18, padR = 6;
  const max = Math.max(1, ...series.map(d => d.total));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = (W - padL - padR) / Math.max(1, series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = step * i; const y = H - padB - (H - padB - padT) * v / top; g += '<line class="axis" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke-width="' + (i ? .6 : 1.4) + '"/><text x="' + (padL - 4) + '" y="' + (y + 4) + '" text-anchor="end">' + v + '</text>'; }
  series.forEach((d, i) => {
    const h = (H - padB - padT) * d.total / top; const x = padL + i * bw + bw * 0.14; const y = H - padB - h;
    const isToday = d.date === ymd();
    g += '<rect class="bar' + (isToday ? ' alt' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2"><title>' + esc(fmtDate(d.date)) + ': ' + d.total + '</title></rect>';
    if (series.length <= 16) g += '<text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="middle" style="font-size:9px">' + d.total + '</text>';
    if (series.length <= 16 || i % 2 === 0) g += '<text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (H - padB + 14) + '" text-anchor="middle" style="font-size:9.5px">' + esc(fmtShort(d.date)) + '</text><text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (H - padB + 26) + '" text-anchor="middle" style="font-size:8.5px">' + esc(dateOf(d.date).toLocaleDateString('en-AU', { weekday: 'narrow' })) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + g + '</svg>';
}
function hbars(items) {
  const max = Math.max(1, ...items.map(i => i.v));
  return items.map(i => '<div class="hbar"><span>' + esc(i.label) + '</span><span class="trk"><span class="fill" style="display:block;width:' + (100 * i.v / max).toFixed(1) + '%"></span></span><b>' + (Math.round(i.v * 10) / 10) + '</b></div>').join('');
}
VIEWS.history = () => {
  const h = S.history;
  const wards = C.wardsInRoute(S.wards); const fluids = C.fluidsByLocation(S.fluids);
  if (!h.length) return '<h1>History</h1><div class="card empty">No history yet. Each <b>Start new day</b> adds the day\'s walks here.</div>';
  const series = C.usageByDay(h, { wardId: histFilter.wardId || undefined, fluidId: histFilter.fluidId || undefined }, 14);
  const days = C.historyDates(h).slice(-14).length;
  const byWard = C.averagesBy(h.filter(() => true), (w, f) => (!histFilter.fluidId || f === histFilter.fluidId) ? w : '_', 14);
  const byFluid = C.averagesBy(h, (w, f) => (!histFilter.wardId || w === histFilter.wardId) ? f : '_', 14);
  const sugg = C.parSuggestions(S);
  const filterLabel = (histFilter.wardId ? wardById(histFilter.wardId)?.name : 'All wards') + ' · ' + (histFilter.fluidId ? fl(fluidById(histFilter.fluidId)) : 'all fluids');
  return '<h1>History</h1><p class="sub">Usage = top-ups found on each ward walk. Last ' + plural(days, 'recorded day') + '.</p>' +
    (S.sampleHistory ? '<div class="row nowrap card tight" role="note"><span class="grow small">Includes 14 days of made-up <b>sample history</b>.</span><button class="btn sm danger" type="button" data-act="clearsamplehist">Clear it</button></div>' : '') +
    '<div class="grid2"><label class="field"><span>Ward</span><select id="hWard"><option value="">All wards</option>' + wards.map(w => '<option value="' + esc(w.id) + '"' + (w.id === histFilter.wardId ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Fluid</span><select id="hFluid"><option value="">All fluids</option>' + fluids.map(f => '<option value="' + esc(f.id) + '"' + (f.id === histFilter.fluidId ? ' selected' : '') + '>' + esc(fl(f)) + '</option>').join('') + '</select></label></div>' +
    '<section class="card chart"><h3>Units used per day</h3><p class="muted small">' + esc(filterLabel) + '</p>' + barChartSvg(series, 'Units used per day, ' + filterLabel + ': ' + series.map(d => fmtShort(d.date) + ' ' + d.total).join(', ')) + '</section>' +
    '<section class="card"><h3>Average per day by ward</h3>' + hbars(wards.map(w => ({ label: w.name, v: (byWard[w.id] || {}).perDay || 0 }))) + '</section>' +
    '<section class="card"><h3>Average per day by fluid' + (histFilter.wardId ? ' · ' + esc(wardById(histFilter.wardId)?.name) : '') + '</h3>' + hbars(fluids.map(f => ({ label: fl(f), v: (byFluid[f.id] || {}).perDay || 0 })).filter(x => x.v > 0)) + '</section>' +
    '<h2 id="suggestions">Suggested par changes (' + sugg.length + ')</h2><p class="muted small">From 7+ days of walks. Suggestions only: pars never change by themselves. Change them in <a href="#setup/pars">Setup → Pars</a>.</p>' +
    (sugg.length ? sugg.map(s => { const w = wardById(s.wardId); const f = fluidById(s.fluidId);
      return '<article class="card sugg ' + s.direction + '"><div class="row nowrap"><div class="grow"><b>' + esc(w.name) + '</b><br>' + esc(fl(f)) + '</div><div class="pp" aria-label="Par ' + s.par + ' to ' + s.newPar + '">' + s.par + ' → ' + s.newPar + ' ' + (s.direction === 'up' ? '▲' : '▼') + '</div></div><p class="small">' + esc(s.reason) + '</p></article>'; }).join('')
      : '<div class="card empty">No par changes suggested. Usage fits the current pars (or there are fewer than 7 days of walks).</div>') +
    '<h2>Day log</h2><div class="scrollx"><table class="data"><thead><tr><th>Day</th><th class="n">Wards</th><th class="n">Used</th><th class="n">Short</th><th class="n">Received</th></tr></thead><tbody>' +
      h.slice().reverse().slice(0, 30).map(r => '<tr><td>' + esc(fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td class="n">' + Object.keys(r.walks || {}).length + '</td><td class="n">' + C.dayUsage(r) +
        '</td><td class="n">' + Object.values(r.short || {}).reduce((s, x) => s + Object.values(x).reduce((a, b) => a + int0(b), 0), 0) + '</td><td class="n">' + Object.values(r.received || {}).reduce((s, x) => s + int0(x), 0) + '</td></tr>').join('') +
    '</tbody></table></div>';
};
view.addEventListener('change', e => {
  if (e.target.id === 'hWard') { histFilter.wardId = e.target.value; render({ keepScroll: true }); }
  if (e.target.id === 'hFluid') { histFilter.fluidId = e.target.value; render({ keepScroll: true }); }
});

/* ================= 7. SETUP ================= */
const SETUP_TABS = [['wards', 'Wards'], ['fluids', 'Fluids'], ['pars', 'Pars'], ['io', 'Import / export'], ['labels', 'QR labels'], ['data', 'Data']];
VIEWS.setup = (r) => {
  const tab = SETUP_TABS.some(t => t[0] === r.arg) ? r.arg : 'wards';
  const tabs = '<nav class="tabs noprint" aria-label="Setup sections">' + SETUP_TABS.map(t => '<a href="#setup/' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>').join('') + '</nav>';
  return '<h1 class="noprint">Setup</h1>' + tabs + SETUP[tab](r);
};
const SETUP = {};
SETUP.wards = () => {
  const wards = C.wardsInRoute(S.wards);
  const offN = wards.filter(w => w.on === false).length;
  return '<p class="sub">Name each ward and set the delivery route order (top = first stop). Untick <b>On round</b> for wards you do not stock.' + (offN ? ' ' + offN + ' of ' + wards.length + ' are off.' : '') + '</p>' +
    '<ol class="list">' + wards.map((w, i) => '<li class="card tight"><div class="row nowrap"><span class="chip" aria-label="Route stop ' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<input type="text" class="grow" data-wardname="' + esc(w.id) + '" value="' + esc(w.name) + '" aria-label="Ward name, stop ' + (i + 1) + '">' +
      '</div><div class="row" style="margin-top:6px"><button class="btn sm" type="button" data-wmove="-1" data-ward="' + esc(w.id) + '" aria-label="Move ' + esc(w.name) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
      '<button class="btn sm" type="button" data-wmove="1" data-ward="' + esc(w.id) + '" aria-label="Move ' + esc(w.name) + ' later"' + (i === wards.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
      '<label class="check onoff"><input type="checkbox" data-wardon="' + esc(w.id) + '"' + (w.on !== false ? ' checked' : '') + '><span>On round</span></label>' +
      '<span class="muted small grow">' + (w.on === false ? 'Off: not walked' : plural(C.wardFluids(S, w.id).length, 'fluid') + ' with a par') + '</span>' +
      '<button class="btn sm danger" type="button" data-delward="' + esc(w.id) + '" aria-label="Delete ' + esc(w.name) + '">' + ICON.trash + 'Delete</button></div>' + (w.note ? '<p class="muted small wnote">' + esc(w.note) + '</p>' : '') + '</li>').join('') + '</ol>' +
    '<div class="card"><label class="field"><span>New ward name</span><input type="text" id="newWard" placeholder="e.g. Ward 6 East" maxlength="60"></label><button class="btn primary block" type="button" data-act="addward">Add ward</button></div>';
};
let fluidsOnlyCheck = false;
SETUP.fluids = () => {
  const all = C.fluidsByLocation(S.fluids);
  const nCheck = all.filter(C.needsCartonCheck).length;
  if (!nCheck) fluidsOnlyCheck = false;
  const fluids = fluidsOnlyCheck ? all.filter(C.needsCartonCheck) : all;
  const fld = (f, k, label, cls, numeric) => '<label class="field ' + (cls || '') + '"><span>' + label + '</span><input type="text"' + (numeric ? ' inputmode="numeric"' : '') + ' data-fluid="' + esc(f.id) + '" data-k="' + k + '" value="' + esc(f[k]) + '"></label>';
  return '<p class="sub">Fluids in the store. Units per carton (pieces in one box) is used for receiving, box counts and ordering.</p>' +
    (nCheck ? '<div class="card tight row nowrap" role="note"><span class="grow small"><span class="chip warn ck">check carton</span> ' + plural(nCheck, 'fluid') + ' with a blank or unconfirmed carton size. Check the box, fix the number, then tap <b>Confirm</b>.</span>' +
      '<button class="btn sm" type="button" data-act="fluidscheck" aria-pressed="' + fluidsOnlyCheck + '">' + (fluidsOnlyCheck ? 'Show all' : 'Show only these') + '</button></div>' : '') +
    '<button class="btn primary block" type="button" data-act="addfluid">Add fluid</button>' +
    fluids.map(f => '<section class="card" aria-label="' + esc(fl(f)) + '" data-fcard="' + esc(f.id) + '">' + (C.needsCartonCheck(f) ? '<div class="row nowrap ckrow"><span class="grow small"><span class="chip warn ck">check carton</span> ' + esc(f.note || (C.upcKnown(f) ? 'Carton size not confirmed.' : 'Carton size not set.')) + '</span>' +
        (C.upcKnown(f) ? '<button class="btn sm primary" type="button" data-confirmupc="' + esc(f.id) + '" aria-label="Confirm ' + esc(f.upc) + '/box for ' + esc(fl(f)) + '">Confirm ' + esc(f.upc) + '/box</button>' : '') + '</div>' : (f.note ? '<p class="muted small">' + esc(f.note) + '</p>' : '')) +
      '<div class="grid2">' + fld(f, 'name', 'Fluid name', 'full') + fld(f, 'pack', 'Volume / pack') + fld(f, 'code', 'Product code') + fld(f, 'upc', 'Units per carton', '', true) +
      fld(f, 'loc', 'Store location (bay · shelf)') + fld(f, 'min', 'Store minimum', '', true) + fld(f, 'stock', 'Store stock now', '', true) + '</div>' +
      '<div class="row"><button class="btn sm danger right" type="button" data-delfluid="' + esc(f.id) + '" aria-label="Delete ' + esc(fl(f)) + '">' + ICON.trash + 'Delete</button></div></section>').join('');
};
SETUP.pars = () => {
  const wards = C.wardsInRoute(S.wards); const fluids = C.fluidsByLocation(S.fluids);
  if (!wards.length || !fluids.length) return '<div class="card empty">Add wards and fluids first.</div>';
  const offN = wards.length - onWards().length;
  return '<p class="sub">Par = how many ' + (BX() ? '<b>boxes</b>' : '') + ' should be on that ward\'s shelf after a top-up. 0 = not stocked there. Scroll sideways inside the grid for more wards.' + (offN ? ' Wards that are off the round are hidden (' + offN + ').' : '') + '</p>' +
    '<div class="scrollx" style="max-height:70vh"><table class="pars"><thead><tr><th class="fl" scope="col">Fluid' + (BX() ? ' (boxes)' : '') + '</th>' + onWards().map(w => '<th scope="col">' + esc(w.name) + '</th>').join('') + '</tr></thead><tbody>' +
    fluids.map(f => '<tr><th class="fl" scope="row">' + esc(f.name) + '<br><span class="muted small">' + esc(f.pack) + (f.code ? ' · ' + esc(f.code) : '') + (inBoxes(f) ? ' · ' + f.upc + '/box' : '') + '</span>' + checkChip(f) + '</th>' + onWards().map(w => { const p = inBoxes(f) ? C.boxesFor(C.parOf(S.pars, w.id, f.id), f) : C.parOf(S.pars, w.id, f.id); return '<td><input type="text" inputmode="numeric" class="' + (p ? '' : 'zero') + '" data-par="' + esc(w.id) + '|' + esc(f.id) + '" value="' + p + '" aria-label="Par for ' + esc(fl(f)) + ' on ' + esc(w.name) + '"></td>'; }).join('') + '</tr>').join('') +
    '</tbody></table></div>';
};
view.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.wardname) {
    const w = wardById(t.dataset.wardname); const v = t.value.trim();
    if (!v) { t.value = w.name; toast('A ward needs a name.'); return; }
    if (S.wards.some(x => x !== w && x.name.toLowerCase() === v.toLowerCase())) { t.value = w.name; toast('There is already a ward called ' + v + '.'); return; }
    w.name = v.slice(0, 60); touchSetup(); save(); toast('Saved.');
  }
  if (t.dataset.fluid) {
    const f = fluidById(t.dataset.fluid); const k = t.dataset.k; let v = t.value.trim();
    if (k === 'name' && !v) { t.value = f.name; toast('A fluid needs a name.'); return; }
    if (['upc', 'min', 'stock'].includes(k)) {
      if (!/^\d+$/.test(v)) { t.setAttribute('aria-invalid', 'true'); toast('Use a whole number 0 or more.'); return; }
      v = parseInt(v, 10); if (k === 'upc' && v < 1) v = 1;
    }
    if (k === 'code') v = v.slice(0, 30);
    t.removeAttribute('aria-invalid');
    f[k] = v;
    // typing a carton size counts as checking it
    if (k === 'upc' && !f.upcOk) { f.upcOk = true; touchSetup(); save(); render({ keepScroll: true }); toast('Saved. Carton size confirmed: ' + v + ' per box.'); return; }
    touchSetup(); save(); toast('Saved.');
  }
  if (t.dataset.par) {
    const [wid, fid] = t.dataset.par.split('|'); const s = t.value.trim() === '' ? '0' : t.value.trim();
    if (!/^\d+$/.test(s)) { t.setAttribute('aria-invalid', 'true'); toast('Par must be a whole number 0 or more.'); return; }
    t.removeAttribute('aria-invalid');
    const v = parseInt(s, 10); t.value = v; t.classList.toggle('zero', !v);
    const f = fluidById(fid);
    (S.pars[wid] = S.pars[wid] || {})[fid] = inBoxes(f) ? v * C.upcOf(f) : v; touchSetup(); save();
  }
  if (t.dataset.wardon) { const w = wardById(t.dataset.wardon); w.on = t.checked; touchSetup(); save(); render({ keepScroll: true }); toast(w.name + (w.on ? ' is on the round.' : ' is off the round.')); }
});

/* ---------- import / export ---------- */
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
  return loaded[src];
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const README_ROWS = [['Ward Restock by Autoprod: import template'], [''],
  ['1. Wards sheet: one row per ward. Route order = delivery order (1 = first stop).'],
  ['2. Fluids sheet: one row per fluid line. Fluid + Pack size together must be unique.'],
  ['   Units per carton is used for receiving and ordering in cartons. Store minimum triggers ordering.'],
  ['3. Pars sheet: one row per fluid, one column per ward (column names must match the Wards sheet). 0 = not stocked.'],
  ['   If the first column is headed "Fluid (boxes)" the pars are whole boxes; "Fluid" means single units.'],
  ['4. Save, then in the app: Setup > Import / export > Choose file. Check the preview, then Apply.'],
  [''], ['Stock data only: do not add patient information.']];
SETUP.io = () => {
  const st = S.setup;
  return '<section class="card" id="loadSetup"><h3>Load setup</h3>' +
    (st ? '<p class="small"><span class="chip ok">Loaded</span> <b class="setupname">' + esc(st.name) + '</b><br><span class="muted">' + plural(onWards().length, 'ward') + ' on the round · ' + plural(S.fluids.length, 'fluid') + ' · loaded ' + esc(fmtDate(String(st.loadedAt || '').slice(0, 10) || ymd())) + (st.from === 'link' ? ' from a link' : ' from a file') + '</span></p>'
      : '<p class="small">' + (S.isSample ? 'Showing the made-up <b>sample data</b>.' : 'Your own wards and fluids (no setup file loaded).') + '</p>') +
    '<p class="small muted">A setup file (.json) or setup link replaces the wards, fluids and pars. It stays only on this phone: it is never uploaded or sent anywhere.</p>' +
    '<label class="btn block primary" for="setupFile">Load setup file (.json)…</label><input id="setupFile" class="sr-only" type="file" accept=".json,application/json">' +
    (S.isSample ? '' : '<div class="btnrow"><button class="btn danger" type="button" data-act="resetsample">Back to sample data</button></div>') + '</section>' +
    '<p class="sub">Swap in your own wards, fluids and pars. Download the Excel template (it holds your current data), edit it, then import it. Nothing changes until you press Apply.</p>' +
    '<section class="card"><h3>Export</h3><div class="btnrow"><button class="btn primary" type="button" data-act="exportxlsx">' + ICON.dl + 'Excel template (.xlsx)</button></div>' +
    '<div class="btnrow"><button class="btn sm" type="button" data-act="exportcsv" data-table="wards">wards.csv</button><button class="btn sm" type="button" data-act="exportcsv" data-table="fluids">fluids.csv</button><button class="btn sm" type="button" data-act="exportcsv" data-table="pars">pars.csv</button></div></section>' +
    '<section class="card"><h3>Import</h3><p class="small muted">An .xlsx with Wards, Fluids and/or Pars sheets, or one or more of the CSV files above.</p>' +
    '<label class="btn block primary" for="importFile">Choose file(s)…</label><input id="importFile" class="sr-only" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple></section>' +
    (importPreview ? renderImportPreview() : '');
};
function renderImportPreview() {
  const p = importPreview; const v = p.result;
  const sumLine = (k, label) => v.summary[k] ? '<li><b>' + label + ':</b> ' + (k === 'pars' ? v.summary.pars.cells + ' cells for ' + v.summary.pars.fluids + ' fluids × ' + v.summary.pars.wards + ' wards (' + v.summary.pars.nonZero + ' stocked)' : v.summary[k].rows + ' rows · ' + v.summary[k].added + ' new · ' + v.summary[k].removed + ' removed') + '</li>' : '';
  const tbl = (rows, title) => rows ? '<h3 style="margin-top:12px">' + esc(title) + ' <span class="muted small">(' + (rows.length - 1) + ' rows' + (rows.length > 9 ? ', first 8 shown' : '') + ')</span></h3><div class="scrollx"><table class="data"><thead><tr>' + rows[0].map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.slice(1, 9).map(r => '<tr>' + rows[0].map((_, i) => '<td>' + esc(r[i] === undefined ? '' : r[i]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '';
  return '<section class="card" id="importPreview" aria-labelledby="ipTitle"><h2 id="ipTitle" style="margin-top:0">Import preview</h2><p class="muted small">From ' + esc(p.files.join(', ')) + '. Nothing has changed yet.</p>' +
    '<ul>' + sumLine('wards', 'Wards') + sumLine('fluids', 'Fluids') + sumLine('pars', 'Pars') + '</ul>' +
    (v.errors.length ? '<h3 class="errors">' + plural(v.errors.length, 'problem') + ' to fix first</h3><ul class="errors">' + v.errors.slice(0, 30).map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '<p class="chip ok">✓ Looks good</p>') +
    (v.warnings.length ? '<ul class="warnings">' + v.warnings.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '') +
    (S.sampleHistory && v.ok ? '<p class="small">Applying also clears the made-up sample history and today\'s steps.</p>' : '') +
    tbl(p.tables.wards, 'Wards') + tbl(p.tables.fluids, 'Fluids') + tbl(p.tables.pars, 'Pars') +
    '<div class="btnrow"><button class="btn" type="button" data-act="cancelimport">Cancel</button><button class="btn primary" type="button" data-act="applyimport"' + (v.ok ? '' : ' disabled') + '>Apply import</button></div></section>';
}
async function exportXlsx() {
  await loadScript('vendor/xlsx.full.min.js');
  const X = window.XLSX; const t = C.buildTables(S);
  const wb = X.utils.book_new();
  const add = (rows, name, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
  add(t.wards, 'Wards', [24, 12]);
  add(t.fluids, 'Fluids', [44, 12, 16, 20, 15, 12]);
  add(t.pars, 'Pars', [44, 12].concat(t.pars[0].slice(2).map(() => 16)));
  add(README_ROWS, 'Read me', [110]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  download('ward-restock-template-' + ymd() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Excel template downloaded.');
}
function exportCsv(table) {
  const t = C.buildTables(S);
  download(table + '.csv', new Blob(['\uFEFF' + C.toCSV(t[table])], { type: 'text/csv;charset=utf-8' }));
}
async function readImportFiles(files) {
  const tables = {}; const names = []; const notes = [];
  for (const file of files) {
    names.push(file.name);
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      const rows = C.parseCSV(await file.text());
      const kind = C.detectTable(rows, file.name);
      if (kind) tables[kind] = rows; else notes.push(file.name + ': could not tell if this is wards, fluids or pars (check the header row).');
    } else {
      await loadScript('vendor/xlsx.full.min.js');
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      for (const sn of wb.SheetNames) {
        if (/read ?me/i.test(sn)) continue;
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '', blankrows: false }).map(r => r.map(c => String(c).trim())).filter(r => r.some(c => c !== ''));
        if (!rows.length) continue;
        const kind = C.detectTable(rows, sn);
        if (kind) tables[kind] = rows; else notes.push('Sheet "' + sn + '" skipped: not wards, fluids or pars.');
      }
    }
  }
  const result = C.validateImport(tables, S, (p, i) => uid(p) + i);
  if (!tables.wards && !tables.fluids && !tables.pars) result.errors.push('No wards, fluids or pars found in ' + names.join(', ') + '.'), result.ok = false;
  result.warnings.unshift(...notes);
  importPreview = { files: names, tables, result };
  render({ keepScroll: true });
  const el = $('#importPreview'); if (el) el.scrollIntoView({ block: 'start' });
}
function applyImport() {
  if (!importPreview || !importPreview.result.ok) return;
  const n = importPreview.result.next;
  undoable('Import applied.', () => {
    S.wards = n.wards; S.fluids = n.fluids; S.pars = n.pars;
    if (S.sampleHistory) { S.history = S.history.filter(r => !r.sample); S.sampleHistory = false; S.today = freshToday(); }
    S.isSample = false;
    importPreview = null;
  });
}

/* ---------- 8. QR shelf labels ---------- */
let labelSel = null; // fluid ids chosen for printing (null = all stocked on the chosen ward)
function qrPayload(f) { return 'WR1:' + f.name + '|' + f.pack; }
function qrSvg(text, label) {
  if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8']) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const m = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ',' + (r + m) + 'h1v1h-1z';
  return '<svg viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label) + '"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
SETUP.labels = () => {
  const wards = C.wardsInRoute(S.wards); const fluids = C.fluidsByLocation(S.fluids);
  if (!fluids.length) return '<div class="card empty">Add fluids first.</div>';
  const wid = wardById(S.settings.labelWard) ? S.settings.labelWard : (wards[0] ? wards[0].id : '');
  const stocked = new Set(wid ? C.wardFluids(S, wid).map(f => f.id) : fluids.map(f => f.id));
  const sel = labelSel ? new Set(labelSel.filter(id => fluidById(id))) : stocked;
  const per = S.settings.labelsPerPage === 12 ? 12 : 8;
  const chosen = fluids.filter(f => sel.has(f.id));
  return '<div class="labels-print"><p class="sub noprint">Shelf labels with a QR code. Scan one during a ward walk to jump straight to that fluid.</p>' +
    '<div class="card noprint"><label class="field"><span>Show par for ward</span><select id="lblWard">' + wards.map(w => '<option value="' + esc(w.id) + '"' + (w.id === wid ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select></label>' +
    '<div class="seg" role="group" aria-label="Labels per A4 page"><button type="button" data-lper="8" aria-pressed="' + (per === 8) + '">8 per page</button><button type="button" data-lper="12" aria-pressed="' + (per === 12) + '">12 per page</button></div>' +
    '<details><summary style="min-height:48px;display:flex;align-items:center;font-weight:700;cursor:pointer">Fluids (' + chosen.length + ' of ' + fluids.length + ' chosen)</summary>' +
    '<div class="btnrow"><button class="btn sm" type="button" data-act="lblall">All</button><button class="btn sm" type="button" data-act="lblward">Stocked on ward</button><button class="btn sm" type="button" data-act="lblnone">None</button></div>' +
    fluids.map(f => '<label class="check"><input type="checkbox" data-lbl="' + esc(f.id) + '"' + (sel.has(f.id) ? ' checked' : '') + '><span>' + esc(fl(f)) + '</span></label>').join('') + '</details>' +
    '<button class="btn primary big block" type="button" data-act="printlabels"' + (chosen.length ? '' : ' disabled') + '>' + ICON.print + 'Print ' + plural(chosen.length, 'label') + ' (' + plural(Math.ceil(chosen.length / per), 'A4 page') + ')</button></div>' +
    '<h2 class="noprint">Print preview</h2><div class="a4wrap" id="labelPages" data-ward="' + esc(wid) + '" data-per="' + per + '"><div class="empty">Loading QR codes…</div></div></div>';
};
AFTER.setup = async (r) => {
  if (r.arg !== 'labels') return;
  const box = $('#labelPages'); if (!box) return;
  try { await loadScript('vendor/qrcode.js'); } catch (e) { box.innerHTML = '<div class="empty">Could not load the QR generator.</div>'; return; }
  if (!$('#labelPages')) return;
  const wid = box.dataset.ward; const w = wardById(wid); const per = int0(box.dataset.per) || 8;
  const ids = new Set($$('[data-lbl]:checked').map(i => i.dataset.lbl));
  const chosen = C.fluidsByLocation(S.fluids).filter(f => ids.has(f.id));
  const cols = per === 12 ? 3 : 2; const rows = 4;
  const pages = [];
  for (let i = 0; i < chosen.length; i += per) pages.push(chosen.slice(i, i + per));
  box.innerHTML = pages.length ? pages.map((pg, pi) => '<div class="a4page" aria-label="A4 page ' + (pi + 1) + ' of ' + pages.length + '"><div class="grid" style="grid-template-columns:repeat(' + cols + ',1fr);grid-template-rows:repeat(' + rows + ',1fr)">' +
    pg.map(f => '<div class="qlabel" data-fid="' + esc(f.id) + '" style="' + (cols === 3 ? 'grid-template-columns:1fr;text-align:center;justify-items:center' : '') + '">' +
      '<div style="' + (cols === 3 ? 'width:62%' : '') + '">' + qrSvg(qrPayload(f), 'QR code for ' + fl(f)) + '</div>' +
      '<div><div class="ln">' + esc(f.name) + '</div><div class="lp">' + esc(f.pack) + (f.code ? ' · <b>' + esc(f.code) + '</b>' : '') + '</div>' +
      (w ? '<div class="lpar">PAR ' + (inBoxes(f) ? esc(C.boxText(C.effPar(S, w.id, f), f)) : C.parOf(S.pars, w.id, f.id)) + '</div><div class="lw">' + esc(w.name) + '</div>' : '') +
      '<div class="lloc">Store: ' + esc(f.loc || '-') + '</div><div class="lbrand">Ward Restock by Autoprod</div></div></div>').join('') +
    '</div></div>').join('') : '<div class="empty">No fluids chosen.</div>';
};

/* ---------- data tab ---------- */
SETUP.data = () => {
  const t = S.settings.theme;
  return '<section class="card"><h3>Display</h3><div class="seg" role="group" aria-label="Theme"><button type="button" data-theme-set="light" aria-pressed="' + (t === 'light') + '">Light</button><button type="button" data-theme-set="dark" aria-pressed="' + (t === 'dark') + '">Dark</button><button type="button" data-theme-set="auto" aria-pressed="' + (t === 'auto') + '">Auto</button></div></section>' +
    '<section class="card"><h3>Work in whole boxes</h3><p class="small muted">On: pars, shelf counts, pick list, delivery and orders are in boxes (cartons), with pieces shown second. Off: single units.</p><div class="seg" role="group" aria-label="Work in whole boxes"><button type="button" data-boxes="1" aria-pressed="' + BX() + '">Boxes</button><button type="button" data-boxes="0" aria-pressed="' + !BX() + '">Single units</button></div></section>' +
    '<section class="card"><h3>Backup</h3><p class="small muted">Everything is stored only in this browser on this device. Download a backup now and then, and to move to a new phone.</p>' +
    '<div class="btnrow"><button class="btn" type="button" data-act="backup">' + ICON.dl + 'Download backup (.json)</button><label class="btn" for="restoreFile">Restore backup…</label></div><input id="restoreFile" class="sr-only" type="file" accept=".json,application/json"></section>' +
    '<section class="card"><h3>Start again</h3><div class="btnrow"><button class="btn danger" type="button" data-act="resetsample">Reset to sample data</button><button class="btn danger" type="button" data-act="clearall">Clear all data</button></div></section>' +
    '<section class="card small"><h3>About</h3><p>Ward Restock by Autoprod · version ' + APP_VERSION + ' (test site). Works offline. No accounts, no tracking, no data leaves this device.</p>' +
    '<p>Stock data only. Do not enter patient information. Sample data is made up and is not clinical guidance.</p>' +
    '<p>Bundled libraries: <a href="vendor/licenses/sheetjs-LICENSE.txt">SheetJS (Apache-2.0)</a>, <a href="vendor/licenses/jsQR-LICENSE.txt">jsQR (Apache-2.0)</a>, <a href="vendor/licenses/qrcode-generator-LICENSE.txt">QR Code Generator (MIT)</a>.</p></section>';
};

/* ---------- private setup: file or link (#setup=<compressed base64>) ---------- */
// The link payload lives after '#', which browsers never send to any server. It is read here,
// then removed from the address bar straight away.
function setupError(errors) {
  modal({ title: 'Could not load this setup', html: '<p>Nothing was changed.</p><ul class="errors">' + errors.slice(0, 12).map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' + (errors.length > 12 ? '<p class="small">…and ' + (errors.length - 12) + ' more.</p>' : ''), buttons: [{ label: 'OK', value: 'ok', cls: 'primary' }] });
}
async function decodeSetupPayload(p) {
  let b64 = decodeURIComponent(p).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (b64.length % 4) b64 += '=';
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch (e) { throw new Error('The setup link is damaged or cut short (not valid base64). Try the setup file instead.'); }
  if (!('DecompressionStream' in window)) throw new Error('This browser cannot open setup links. Update it, or load the setup file instead.');
  let text;
  try { text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); } catch (e) { throw new Error('The setup link is damaged or cut short (could not unpack it). Try the setup file instead.'); }
  try { return JSON.parse(text); } catch (e) { throw new Error('The setup link did not contain a valid setup.'); }
}
async function openSetupLink() {
  if (!/^#setup=/.test(location.hash)) return false;
  const payload = location.hash.slice(7);
  history.replaceState(null, '', location.pathname + location.search + '#setup/io');   // strip the payload from the URL now
  render();
  try { applySetup(await decodeSetupPayload(payload), 'link'); } catch (e) { setupError([e.message]); }
  return true;
}
async function applySetup(obj, from) {
  const v = C.validateSetup(obj);
  if (!v.ok) { setupError(v.errors); return; }
  const on = v.wards.filter(w => w.on).length; const chk = v.fluids.filter(C.needsCartonCheck).length;
  const hasWork = !S.isSample && (S.history.some(r => !r.sample) || Object.keys(S.today.walks).length || S.today.received.length);
  const ok = await confirmBox('Load "' + v.name + '"?', v.wards.length + ' wards (' + on + ' on the round, ' + (v.wards.length - on) + ' off) and ' + v.fluids.length + ' fluids' + (chk ? ' (' + chk + ' to check carton size)' : '') + '. ' +
    'This replaces the wards, fluids, pars, history and today\'s work on this phone' + (hasWork ? ', including your own history (download a backup first if you need it)' : '') + '. It stays on this phone only.', 'Load setup');
  if (!ok) return;
  undoable('Loaded ' + v.name + '. Set pars in Setup → Pars.', () => {
    const keep = S.settings;
    S = { v: 1, isSample: false, sampleHistory: false, setup: { name: v.name, loadedAt: new Date().toISOString(), from }, wards: v.wards, fluids: v.fluids, pars: v.pars, history: [], today: freshToday(), settings: Object.assign(defaultSettings(), { theme: keep.theme, boxes: true }) };
    importPreview = null; labelSel = null;
  });
  go('#setup/io');
}

/* ---------- QR scanner (camera only on tap) ---------- */
async function openScanner(onCode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot use the camera here. Find the fluid in the list instead.'); return; }
  let stream = null, timer = null, stopped = false;
  const d = $('#dlg');
  const stop = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  const p = modal({ title: 'Scan a shelf label', html: '<div class="scanbox"><video id="scanVideo" playsinline muted autoplay></video><div class="aim" aria-hidden="true"></div></div><p id="scanMsg" class="muted" aria-live="polite">Starting camera…</p>', buttons: [{ label: 'Close', value: '' }] });
  p.then(stop);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    $('#scanMsg', d).textContent = e && e.name === 'NotAllowedError' ? 'Camera blocked. Allow the camera in your browser settings, or find the fluid in the list.' : 'No camera available. Find the fluid in the list instead.';
    return;
  }
  if (stopped) { stop(); return; }
  const video = $('#scanVideo', d); video.srcObject = stream;
  try { await video.play(); } catch (e) { /* autoplay attribute covers it */ }
  let detector = null;
  if ('BarcodeDetector' in window) {
    try { const fm = await window.BarcodeDetector.getSupportedFormats(); if (fm.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
  }
  scanEngine = detector ? 'BarcodeDetector' : 'jsQR';
  if (!detector) { try { await loadScript('vendor/jsQR.js'); } catch (e) { $('#scanMsg', d).textContent = 'Scanner could not start.'; return; } }
  $('#scanMsg', d).textContent = 'Point at the QR code on the shelf label.';
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (stopped) return;
    let text = null;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) { const codes = await detector.detect(video); if (codes.length) text = codes[0].rawValue; }
        else {
          const sc = Math.min(1, 720 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * sc); canvas.height = Math.round(video.videoHeight * sc);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) text = code.data;
        }
      }
    } catch (e) { /* keep trying */ }
    if (text) { stop(); d.close(''); onCode(text); return; }
    timer = setTimeout(tick, 160);
  };
  tick();
}
function onScan(text) {
  const m = /^WR1:(.*)\|(.*)$/.exec(String(text).trim());
  const f = m ? S.fluids.find(x => C.fluidKey(x.name, x.pack) === C.fluidKey(m[1], m[2])) : null;
  if (!f) { toast('That QR code is not a Ward Restock shelf label for a fluid in Setup.'); return; }
  const card = $('#fc-' + CSS.escape(f.id));
  if (!card) { toast(fl(f) + ' is not stocked on this ward (par 0).'); return; }
  card.scrollIntoView({ block: 'center' });
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  $('input', card).focus({ preventScroll: true });
  toast('Found ' + fl(f) + '.');
}

/* ================= events ================= */
function doPrint(kind) {
  document.body.dataset.print = kind || routeName;
  window.print();
  setTimeout(() => { delete document.body.dataset.print; }, 500);
}
document.addEventListener('click', async e => {
  const t = e.target.closest('button, a, [data-act]');
  if (!t) return;
  const ds = t.dataset;
  if (t.getAttribute('href') && ds.jump) { e.preventDefault(); const el = document.getElementById(ds.jump); if (el) el.scrollIntoView({ block: 'start' }); return; }
  if (ds.rmode) { recvState.mode = ds.rmode; render({ keepScroll: true }); return; }
  if (ds.omode) { S.settings.orderMode = ds.omode; save(); render({ keepScroll: true }); return; }
  if (ds.lper) { S.settings.labelsPerPage = int0(ds.lper); save(); render({ keepScroll: true }); return; }
  if (ds.boxes !== undefined && t.closest('.seg')) { S.settings.boxes = ds.boxes === '1'; save(); render({ keepScroll: true }); toast(BX() ? 'Working in whole boxes.' : 'Working in single units.'); return; }
  if (ds.confirmupc) { const f = fluidById(ds.confirmupc); f.upcOk = true; touchSetup(); save(); render({ keepScroll: true }); toast(fl(f) + ': ' + f.upc + ' per box confirmed.'); return; }
  if (ds.themeSet) { S.settings.theme = ds.themeSet; save(); render({ keepScroll: true }); return; }
  if (ds.move) { moveWard(ds.ward, Number(ds.move)); return; }
  if (ds.short) { const [w, f] = ds.short.split('|'); flagShort(w, f); return; }
  if (ds.wmove) {
    const list = C.wardsInRoute(S.wards); const i = list.findIndex(w => w.id === ds.ward); const j = i + Number(ds.wmove);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; list.forEach((w, k) => { w.route = k + 1; });
    touchSetup(); save(); render({ keepScroll: true });
    $('[data-wmove="' + ds.wmove + '"][data-ward="' + CSS.escape(ds.ward) + '"]:not([disabled])')?.focus();
    return;
  }
  if (ds.delward) {
    const w = wardById(ds.delward);
    undoable('Deleted ' + w.name + '.', () => {
      S.wards = S.wards.filter(x => x !== w); delete S.pars[w.id];
      delete S.today.walks[w.id]; delete S.today.drafts[w.id];
      const dv = S.today.deliv[w.id] || {}; Object.keys(dv).forEach(fid => { if (dv[fid].done) { const f = fluidById(fid); if (f) f.stock += int0(dv[fid].applied); } });
      delete S.today.deliv[w.id];
      C.wardsInRoute(S.wards).forEach((x, k) => { x.route = k + 1; });
      touchSetup();
    });
    return;
  }
  if (ds.delfluid) {
    const f = fluidById(ds.delfluid);
    undoable('Deleted ' + fl(f) + '.', () => { S.fluids = S.fluids.filter(x => x !== f); Object.values(S.pars).forEach(p => { delete p[f.id]; }); touchSetup(); });
    return;
  }
  const act = ds.act;
  if (!act) return;
  switch (act) {
    case 'newday': startNewDay(); break;
    case 'receive': doReceive(); break;
    case 'unreceive': {
      const r = S.today.received.find(x => x.id === ds.id); if (!r) break;
      const f = fluidById(r.fluidId);
      undoable('Removed ' + r.units + ' × ' + fl(f) + ' from today\'s receiving.', () => { S.today.received = S.today.received.filter(x => x !== r); if (f) f.stock -= r.units; });
      break;
    }
    case 'skipreceive': S.today.receiveSkipped = true; save(); go('#walk'); break;
    case 'scan': openScanner(onScan); break;
    case 'full': {
      const wid = parseHash().arg; setCount(wid, ds.fid, C.effPar(S, wid, fluidById(ds.fid)));
      break;
    }
    case 'savewalk': saveWalk(ds.ward); break;
    case 'print': doPrint(); break;
    case 'copyorder': {
      const ok = await copyText(orderTextNow());
      if (ok) { S.today.orderDone = true; save(); render({ keepScroll: true }); toast('Order copied. Paste it into your email or message.'); }
      else toast('Could not copy here. Use Print instead.');
      break;
    }
    case 'shareorder': {
      if (!navigator.share) { toast('Sharing is not available in this browser. Use Copy or Print.'); break; }
      try { await navigator.share({ title: 'Ward Restock order', text: orderTextNow() }); S.today.orderDone = true; save(); render({ keepScroll: true }); }
      catch (err) { if (err && err.name !== 'AbortError') toast('Could not share. Use Copy instead.'); }
      break;
    }
    case 'orderdone': S.today.orderDone = true; save(); render({ keepScroll: true }); toast('Order marked as sent.'); break;
    case 'clearsamplehist': undoable('Sample history cleared.', () => { S.history = S.history.filter(r => !r.sample); S.sampleHistory = false; }); break;
    case 'addward': {
      const inp = $('#newWard'); const name = inp.value.trim();
      if (!name) { inp.focus(); toast('Type a ward name first.'); break; }
      if (S.wards.some(w => w.name.toLowerCase() === name.toLowerCase())) { toast('There is already a ward called ' + name + '.'); break; }
      S.wards.push({ id: uid('w'), name: name.slice(0, 60), route: S.wards.length + 1 }); touchSetup(); save(); render({ keepScroll: true }); toast('Added ' + name + '. Set its pars in Setup → Pars.');
      break;
    }
    case 'addfluid': {
      const f = { id: uid('f'), name: 'New fluid', pack: '1000 mL', upc: 10, loc: '', min: 0, stock: 0 };
      S.fluids.push(f); touchSetup(); save(); render();
      const inp = $('[data-fluid="' + CSS.escape(f.id) + '"][data-k="name"]'); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.select(); }
      break;
    }
    case 'exportxlsx': try { await exportXlsx(); } catch (err) { toast('Excel export failed: ' + err.message); } break;
    case 'exportcsv': exportCsv(ds.table); toast(ds.table + '.csv downloaded.'); break;
    case 'fluidscheck': fluidsOnlyCheck = !fluidsOnlyCheck; render({ keepScroll: true }); break;
    case 'cancelimport': importPreview = null; render({ keepScroll: true }); break;
    case 'applyimport': applyImport(); break;
    case 'lblall': labelSel = S.fluids.map(f => f.id); render({ keepScroll: true }); break;
    case 'lblnone': labelSel = []; render({ keepScroll: true }); break;
    case 'lblward': labelSel = null; render({ keepScroll: true }); break;
    case 'printlabels': doPrint('labels'); break;
    case 'backup': download('ward-restock-backup-' + ymd() + '.json', new Blob([JSON.stringify(Object.assign({ app: 'Ward Restock by Autoprod', exported: new Date().toISOString() }, S), null, 1)], { type: 'application/json' })); toast('Backup downloaded.'); break;
    case 'resetsample': if (await confirmBox('Reset to sample data?', 'This replaces all wards, fluids, pars, history and today with the made-up sample.', 'Reset', true)) { undoable('Sample data restored.', () => { S = sampleState(); S.settings.theme = 'light'; }); } break;
    case 'clearall': if (await confirmBox('Clear all data?', 'This deletes every ward, fluid, par, history day and today\'s work from this device.', 'Clear all data', true)) { undoable('All data cleared.', () => { const th = S.settings.theme; S = emptyState(); S.settings.theme = th; }); } break;
  }
});
view.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'importFile' && t.files.length) { try { await readImportFiles(Array.from(t.files)); } catch (err) { toast('Could not read that file: ' + err.message); } t.value = ''; }
  if (t.id === 'setupFile' && t.files.length) {
    const file = t.files[0]; t.value = '';
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (err) { setupError(['That file is not valid JSON, so it cannot be a Ward Restock setup file.']); return; }
    applySetup(obj, 'file');
  }
  if (t.id === 'restoreFile' && t.files.length) {
    const file = t.files[0]; t.value = '';
    let data;
    try { data = normalise(JSON.parse(await file.text())); } catch (err) { toast('That is not a Ward Restock backup file.'); return; }
    delete data.app; delete data.exported;
    if (await confirmBox('Restore this backup?', 'Replaces everything on this device with ' + file.name + ' (' + plural(data.wards.length, 'ward') + ', ' + plural(data.fluids.length, 'fluid') + ', ' + plural(data.history.length, 'history day') + ').', 'Restore')) {
      undoable('Backup restored.', () => { S = data; });
    }
  }
  if (t.id === 'lblWard') { S.settings.labelWard = t.value; labelSel = null; save(); render({ keepScroll: true }); }
  if (t.dataset.lbl !== undefined) {
    const ids = $$('[data-lbl]:checked').map(i => i.dataset.lbl); labelSel = ids; render({ keepScroll: true });
  }
});
view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'newWard') { e.preventDefault(); $('[data-act="addward"]').click(); }
});
window.addEventListener('afterprint', () => { delete document.body.dataset.print; });
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ================= start ================= */
S = load();
// A new calendar day with nothing done yet simply rolls over; a day with work waits for "Start new day".
if (S.today.date !== ymd()) {
  const t = S.today;
  const idle = !Object.keys(t.walks).length && !t.received.length && !Object.keys(t.drafts).length;
  if (idle) S.today = freshToday();
}
save();
if (/^#setup=/.test(location.hash)) openSetupLink(); else render();
window.WR = { get state() { return S; }, get scanEngine() { return scanEngine; }, version: APP_VERSION };

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready.', { action: { label: 'Reload', fn: () => { window.__wrUpdating = true; nw.postMessage('SKIP_WAITING'); } } });
        });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !window.__wrUpdating) return; reloaded = true; location.reload(); });
  });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
})();

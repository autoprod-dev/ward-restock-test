// Import/export round trips, QR labels + scanning, offline, layout and other checks (320 and 390 px).
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const XLSX = require('../../vendor/xlsx.full.min.js');
const { fresh, state, restoreFixture, noHorizontalScroll, nav } = require('./helpers');

function summarize(s) {
  const wards = s.wards.slice().sort((a, b) => a.route - b.route);
  const wn = Object.fromEntries(s.wards.map(w => [w.id, w.name]));
  const fn = Object.fromEntries(s.fluids.map(f => [f.id, f.name + '|' + f.pack]));
  const pars = {};
  for (const wid of Object.keys(s.pars)) for (const fid of Object.keys(s.pars[wid])) if (wn[wid] && fn[fid]) pars[wn[wid] + ' / ' + fn[fid]] = Number(s.pars[wid][fid]);
  return {
    wards: wards.map(w => w.name),
    fluids: s.fluids.map(f => [f.name, f.pack, f.upc, f.loc, f.min, f.stock].join(' ~ ')).sort(),
    pars,
  };
}
async function clearAll(page) {
  await nav(page, '#setup/data');
  await page.getByRole('button', { name: 'Clear all data' }).click();
  await page.locator('dialog .btn', { hasText: 'Clear all data' }).click();
  await expect(page.locator('#toast')).toContainText('All data cleared');
  expect((await state(page)).wards).toHaveLength(0);
}
async function downloadFrom(page, selector, file) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename() };
}

test('CSV export and import round trip (with preview)', async ({ page }, info) => {
  await fresh(page);
  await expect(page.locator('.banner.sample')).toContainText('SAMPLE DATA');
  await nav(page, '#setup/io');
  const files = [];
  for (const t of ['wards', 'fluids', 'pars']) files.push((await downloadFrom(page, `[data-act="exportcsv"][data-table="${t}"]`, info.outputPath(t + '.csv'))).file);
  expect(fs.readFileSync(files[1], 'utf8')).toContain('Bay A · Shelf 1');
  const before = summarize(await state(page));
  await clearAll(page);
  await nav(page, '#setup/io');
  await page.setInputFiles('#importFile', files);
  const pv = page.locator('#importPreview');
  await expect(pv).toContainText('Nothing has changed yet');
  await expect(pv).toContainText('Looks good');
  await expect(pv).toContainText('Wards: 5 rows · 5 new · 0 removed');
  await expect(pv).toContainText('Fluids: 12 rows · 12 new');
  await expect(pv.locator('table')).toHaveCount(3);
  await noHorizontalScroll(page);
  expect((await state(page)).wards).toHaveLength(0); // preview only
  await pv.getByRole('button', { name: 'Apply import' }).click();
  await expect(page.locator('#toast')).toContainText('Import applied');
  expect(summarize(await state(page))).toEqual(before);
});

test('Excel template export, edit and import round trip', async ({ page }, info) => {
  await fresh(page);
  await nav(page, '#setup/io');
  const { file, name } = await downloadFrom(page, '[data-act="exportxlsx"]', info.outputPath('template.xlsx'));
  expect(name).toMatch(/^ward-restock-template-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = XLSX.read(fs.readFileSync(file));
  expect(wb.SheetNames).toEqual(['Wards', 'Fluids', 'Pars', 'Read me']);
  const pars = XLSX.utils.sheet_to_json(wb.Sheets.Pars, { header: 1 });
  expect(pars[0]).toEqual(['Fluid', 'Pack size', 'Ward 4 South', 'Ward 5 North', 'Emergency (ED)', 'PICU', 'Day Stay']);
  const before = summarize(await state(page));

  // round trip unchanged
  await clearAll(page);
  await nav(page, '#setup/io');
  await page.setInputFiles('#importFile', file);
  await expect(page.locator('#importPreview')).toContainText('Looks good');
  await page.getByRole('button', { name: 'Apply import' }).click();
  expect(summarize(await state(page))).toEqual(before);
  await expect(page.locator('.banner.sample')).toHaveCount(0);

  // edit the template like a user would: a new ward, a changed par, then import again
  const w = XLSX.utils.sheet_to_json(wb.Sheets.Wards, { header: 1 }); w.push(['Ward 6 East', 6]);
  wb.Sheets.Wards = XLSX.utils.aoa_to_sheet(w);
  const row = pars.findIndex(r => r[0] === 'Sodium Chloride 0.9%' && r[1] === '1000 mL');
  pars[row][5] = 7; pars[0].push('Ward 6 East'); pars.slice(1).forEach(r => r.push(r === pars[row] ? 9 : 0));
  wb.Sheets.Pars = XLSX.utils.aoa_to_sheet(pars);
  const edited = info.outputPath('edited.xlsx'); fs.writeFileSync(edited, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  await page.setInputFiles('#importFile', edited);
  await expect(page.locator('#importPreview')).toContainText('Wards: 6 rows · 1 new · 0 removed');
  await page.getByRole('button', { name: 'Apply import' }).click();
  const after = summarize(await state(page));
  expect(after.wards).toEqual(before.wards.concat('Ward 6 East'));
  expect(after.pars['PICU / Sodium Chloride 0.9%|1000 mL']).toBe(7);
  expect(after.pars['Ward 6 East / Sodium Chloride 0.9%|1000 mL']).toBe(9);
});

test('import preview catches problems and applies nothing', async ({ page }, info) => {
  await fresh(page);
  const before = summarize(await state(page));
  const bad = info.outputPath('fluids.csv');
  fs.writeFileSync(bad, 'Fluid,Pack size,Units per carton,Store location,Store minimum,Store stock\nGlucose 5%,1000 mL,ten,Bay B,20,50\nGlucose 5%,1000 mL,10,Bay B,20,50\n,,,,,3\n');
  await nav(page, '#setup/io');
  await page.setInputFiles('#importFile', bad);
  const pv = page.locator('#importPreview');
  await expect(pv).toContainText('problems to fix first');
  await expect(pv).toContainText('"ten" must be a whole number');
  await expect(pv).toContainText('listed twice');
  await expect(pv.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  await pv.getByRole('button', { name: 'Cancel' }).click();
  await expect(pv).toHaveCount(0);
  expect(summarize(await state(page))).toEqual(before);
});

test('JSON backup and restore', async ({ page }, info) => {
  await restoreFixture(page);
  await nav(page, '#setup/data');
  const { file } = await downloadFrom(page, '[data-act="backup"]', info.outputPath('backup.json'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data.wards.map(w => w.name)).toEqual(['Ward Alpha', 'Ward Bravo', 'Ward Charlie']);
  await page.getByRole('button', { name: 'Reset to sample data' }).click();
  await page.locator('dialog .btn', { hasText: 'Reset' }).click();
  await expect(page.locator('#toast')).toContainText('Sample data restored');
  expect((await state(page)).wards).toHaveLength(5);
  await restoreFixture(page, file);
  expect((await state(page)).wards.map(w => w.name)).toEqual(['Ward Alpha', 'Ward Bravo', 'Ward Charlie']);
});

test('QR shelf labels: pages, print layout and a decodable QR', async ({ page }) => {
  await fresh(page);
  await nav(page, '#setup/labels');
  const labels = page.locator('.qlabel');
  await expect(labels).toHaveCount(11);              // 11 fluids stocked on Ward 4 South
  await expect(page.locator('.a4page')).toHaveCount(2); // 8 per page
  await expect(labels.first()).toContainText('PAR 20');
  await expect(labels.first()).toContainText('Ward 4 South');
  await expect(labels.first()).toContainText('Store: Bay A · Shelf 1');
  await page.locator('[data-lper="12"]').click();
  await expect(page.locator('.a4page')).toHaveCount(1);
  await page.selectOption('#lblWard', 'w4'); // PICU
  await expect(labels).toHaveCount(10);              // PICU stocks 10 of the 12
  await noHorizontalScroll(page);
  const svg = labels.first().locator('svg');
  await svg.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const png = PNG.sync.read(await svg.screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(code && code.data).toBe('WR1:Sodium Chloride 0.9%|1000 mL');
  // print view shows only the label sheets
  await page.evaluate(() => { document.body.dataset.print = 'labels'; });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.bottomnav')).toBeHidden();
  await expect(page.locator('[data-act="printlabels"]')).toBeHidden();
  await expect(page.locator('.a4page').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('pick list print view is clean', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => { const s = window.WR.state; s.today.walks.w1 = { t: new Date().toISOString(), counts: { f1: 5 }, topups: { f1: 15 } }; localStorage.setItem('wardRestock.v1', JSON.stringify(s)); });
  await page.reload();
  await nav(page, '#pick');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.bottomnav')).toBeHidden();
  await expect(page.locator('.banner')).toHaveCount(1);
  await expect(page.locator('.banner')).toBeHidden();
  await expect(page.locator('#pick-combined')).toBeVisible();
  await expect(page.locator('#pick-wards')).toBeVisible();
  await expect(page.locator('.printonly').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('installs and works fully offline after the first load, with no outside requests', async ({ page, context }) => {
  const outside = [];
  page.on('request', r => { if (!r.url().startsWith('http://localhost:4173/ward-restock-test/') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) outside.push(r.url()); });
  await fresh(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(() => fetch('manifest.webmanifest').then(r => r.json()));
  expect(manifest.display).toBe('standalone');
  await nav(page, '#receive');
  await page.locator('[data-rmode="units"]').click();
  await page.fill('#rcvQty', '7');
  await page.getByRole('button', { name: 'Add to store stock' }).click();
  await expect(page.getByRole('heading', { name: 'Received today (1)' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Received today (1)' })).toBeVisible();
  await nav(page, '#setup/labels');
  await expect(page.locator('.qlabel').first()).toBeVisible(); // QR generator from the offline cache
  await nav(page, '#setup/io');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="exportxlsx"]').click()]); // SheetJS from the cache
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  await context.setOffline(false);
  expect(outside).toEqual([]);
});

test('no sideways scrolling on any screen', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const s = window.WR.state;
    s.today.walks.w1 = { t: new Date().toISOString(), counts: {}, topups: { f1: 9, f2: 4, f7: 3 } };
    s.today.walks.w3 = { t: new Date().toISOString(), counts: {}, topups: { f1: 22, f8: 20, f12: 7 } };
    s.today.deliv.w3 = { f8: { done: true, short: 6, applied: 14 } };
    localStorage.setItem('wardRestock.v1', JSON.stringify(s));
  });
  await page.reload();
  for (const h of ['#today', '#receive', '#walk', '#walk/w3', '#pick', '#deliver', '#order', '#history', '#setup/wards', '#setup/fluids', '#setup/pars', '#setup/io', '#setup/labels', '#setup/data']) {
    await nav(page, h);
    await page.waitForTimeout(150);
    await noHorizontalScroll(page);
  }
  await page.locator('[data-omode]').first().isVisible().catch(() => {});
});

test('tap targets are at least 48 px and steppers at least 56 px', async ({ page }) => {
  await fresh(page);
  await nav(page, '#walk/w1');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('main button, main a.btn, .bottomnav a, .topbar a')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20), Math.round(r.width), Math.round(r.height)]; }));
  for (const [t, w, h] of sizes) { expect(w, t).toBeGreaterThanOrEqual(48); expect(h, t).toBeGreaterThanOrEqual(48); }
  const step = await page.locator('.stepper button').first().boundingBox();
  expect(step.width).toBeGreaterThanOrEqual(56); expect(step.height).toBeGreaterThanOrEqual(56);
});

test('touch drag reorders the delivery route', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium');
  await fresh(page);
  await page.evaluate(() => { const s = window.WR.state; ['w1', 'w2', 'w3'].forEach(w => { s.today.walks[w] = { t: new Date().toISOString(), counts: {}, topups: { f12: 2 } }; }); localStorage.setItem('wardRestock.v1', JSON.stringify(s)); });
  await page.reload();
  await nav(page, '#deliver');
  const order = () => page.locator('#route > li').evaluateAll(els => els.map(e => e.dataset.ward));
  await expect.poll(order).toEqual(['w1', 'w2', 'w3']);
  const h = page.locator('#route > li[data-ward="w3"] [data-drag]');
  await h.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const hb = await h.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = hb.x + hb.width / 2; let y = hb.y + hb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  // finger slides up to the top edge; the list auto-scrolls until Ward 4 South is passed
  for (let i = 0; i < 120; i++) {
    y = Math.max(85, y - 25) + (i % 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    if ((await order())[0] === 'w3') break;
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(order).toEqual(['w3', 'w1', 'w2']);
  expect((await state(page)).wards.find(w => w.id === 'w3').route).toBe(1);
});

test('privacy basics: noindex, robots.txt, strict CSP, no patient fields', async ({ page, request }) => {
  await fresh(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("connect-src 'self'");
  const robots = await (await request.get('robots.txt')).text();
  expect(robots).toMatch(/User-agent: \*\s+Disallow: \//);
  const html = (await page.content()).toLowerCase();
  expect(html).not.toMatch(/patient|mrn|date of birth/);
});

test('dark mode and the sample banner', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.banner.sample')).toContainText('Setup → Import / export');
  await nav(page, '#setup/data');
  await page.locator('[data-theme-set="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // editing your own setup removes the sample banner
  await nav(page, '#setup/pars');
  await page.fill('[data-par="w1|f1"]', '18');
  await page.locator('[data-par="w1|f1"]').blur();
  await expect(page.locator('.banner.sample')).toHaveCount(0);
});

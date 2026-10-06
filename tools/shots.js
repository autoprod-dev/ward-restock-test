// Screenshots at 390x844 (3x) + one at 320 px. Run with the test server up: node tools/shots.js
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const XLSX = require('../vendor/xlsx.full.min.js');
const BASE = 'http://localhost:4173/ward-restock-test/';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function scenario(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    const s = window.WR.state;
    const now = new Date(); const at = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
    s.today.received = [
      { id: 'r1', t: at(6, 42), fluidId: 'f1', mode: 'cartons', cartons: 6, upc: 10, qty: null, units: 60 },
      { id: 'r2', t: at(6, 48), fluidId: 'f3', mode: 'cartons', cartons: 2, upc: 50, qty: null, units: 100 },
    ];
    s.fluids.find(f => f.id === 'f1').stock += 60; s.fluids.find(f => f.id === 'f3').stock += 100;
    s.fluids.find(f => f.id === 'f5').stock = 21; s.fluids.find(f => f.id === 'f11').stock = 24; s.fluids.find(f => f.id === 'f6').stock = 12;
    const walk = (wid, used, t) => { const counts = {}, topups = {}; for (const [fid, par] of Object.entries(s.pars[wid])) { if (!par) continue; const u = Math.min(par, used[fid] !== undefined ? used[fid] : Math.round(par * 0.5)); counts[fid] = par - u; topups[fid] = u; } s.today.walks[wid] = { t, counts, topups }; };
    walk('w1', { f1: 9, f2: 4, f3: 8, f4: 2, f5: 3, f7: 5, f8: 3, f9: 1, f10: 2, f11: 3, f12: 4 }, at(7, 25));
    walk('w3', { f1: 24, f2: 11, f3: 14, f4: 5, f5: 3, f6: 2, f7: 27, f8: 20, f9: 2, f10: 1, f11: 2, f12: 9 }, at(7, 58));
    localStorage.setItem('wardRestock.v1', JSON.stringify(s));
  });
  await page.reload();
}
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(350); };
const shot = async (page, name, opts) => { await page.evaluate(() => { document.getElementById('toast').innerHTML = ''; }); return page.screenshot(Object.assign({ path: path.join(OUT, name) }, opts || {})); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-AU', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await scenario(page);

  await go(page, '#today'); await shot(page, '01-today.png');

  await go(page, '#receive');
  await page.selectOption('#rcvFluid', 'f8');
  for (let i = 0; i < 4; i++) await page.locator('[data-stepper="rcvCartons"] button[data-step="1"]').click();
  await shot(page, '02-receiving.png');

  await go(page, '#walk'); await shot(page, '03a-ward-walk-wards.png');
  await go(page, '#walk/w2');
  const counts = { f1: 12, f2: 7, f3: 16, f4: 6 };
  for (const [fid, v] of Object.entries(counts)) await page.fill('#cnt-' + fid, String(v));
  await page.locator('#fc-f4 [data-act="full"]').click();
  await page.locator('#fc-f5 button[data-step="1"]').click(); await page.locator('#fc-f5 button[data-step="1"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '03-ward-walk.png');

  await go(page, '#pick');
  await page.locator('#pick-combined + ul input[type="checkbox"]').nth(0).check();
  await page.locator('#pick-combined + ul input[type="checkbox"]').nth(1).check();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '04-pick-list-combined.png');
  await page.evaluate(() => { const el = document.getElementById('pick-wards'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await page.waitForTimeout(200);
  await shot(page, '05-pick-list-by-ward.png');

  await go(page, '#deliver');
  // ED first: move it up with the accessible button, tick lines and flag Plasma-Lyte short
  await page.getByRole('button', { name: 'Move Emergency (ED) up' }).click();
  await page.waitForTimeout(150);
  for (const fid of ['f1', 'f2', 'f3', 'f4']) await page.locator(`[data-shelve="w3|${fid}"]`).check();
  await page.locator('[data-short="w3|f8"]').click();
  for (let i = 0; i < 5; i++) await page.locator('dialog [data-stepper="shortQty"] button[data-step="1"]').click();
  await shot(page, '06a-delivery-shortage-dialog.png');
  await page.locator('dialog .btn', { hasText: 'Save shortage' }).click();
  await page.waitForTimeout(200);
  // mid-drag shot: Ward 4 South's handle being dragged
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-shelve="w3|f8"]').evaluate(el => el.closest('.dline').scrollIntoView({ block: 'center' }));
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(200);
  await shot(page, '06-delivery-shortage.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const h = page.locator('#route > li[data-ward="w1"] [data-drag]');
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 14, { steps: 3 });
  await shot(page, '06b-delivery-route-drag.png');
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 2 });
  await page.mouse.up();
  for (const fid of ['f5', 'f6', 'f7']) await page.locator(`[data-shelve="w3|${fid}"]`).check();

  await go(page, '#order');
  await page.locator('[data-omode="units"]').click(); await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '07-ordering-units.png');
  await page.locator('[data-omode="cartons"]').click(); await page.waitForTimeout(150);
  await shot(page, '08-ordering-cartons.png');

  await go(page, '#history'); await shot(page, '09-history.png');
  await page.evaluate(() => { const el = document.getElementById('suggestions'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await page.waitForTimeout(200);
  await shot(page, '10-history-par-suggestions.png');

  await go(page, '#setup/pars'); await shot(page, '11-setup-pars-grid.png');

  // import preview: export the template, add a ward and an error, import it
  await go(page, '#setup/io');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="exportxlsx"]').click()]);
  const tmp = path.join(require('os').tmpdir(), 'wr-template.xlsx'); await dl.saveAs(tmp);
  const wb = XLSX.read(fs.readFileSync(tmp));
  const w = XLSX.utils.sheet_to_json(wb.Sheets.Wards, { header: 1 }); w.push(['Ward 6 East', 6]); wb.Sheets.Wards = XLSX.utils.aoa_to_sheet(w);
  const p = XLSX.utils.sheet_to_json(wb.Sheets.Pars, { header: 1 }); p[0].push('Ward 6 East'); p.slice(1).forEach((r, i) => r.push(i === 2 ? 'twelve' : 8)); wb.Sheets.Pars = XLSX.utils.aoa_to_sheet(p);
  const edited = path.join(require('os').tmpdir(), 'my-wards.xlsx'); fs.writeFileSync(edited, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  await page.setInputFiles('#importFile', edited);
  await page.waitForTimeout(400);
  await page.evaluate(() => { const el = document.getElementById('importPreview'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await page.waitForTimeout(200);
  await shot(page, '12-import-preview.png');
  await page.locator('[data-act="cancelimport"]').click();

  await go(page, '#setup/labels');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const el = document.getElementById('labelPages'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120); });
  await page.waitForTimeout(200);
  await shot(page, '13-qr-labels-preview.png');
  // true print preview: render the print to an A4 PDF and rasterise page 1
  await page.evaluate(() => { document.body.dataset.print = 'labels'; });
  await page.emulateMedia({ media: 'print' });
  const pdf = path.join(require('os').tmpdir(), 'wr-labels.pdf');
  await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(OUT, '13b-qr-labels-print-a4')]);
  await page.evaluate(() => { delete document.body.dataset.print; });

  // pick list printed on A4 too
  await go(page, '#pick');
  await page.emulateMedia({ media: 'print' });
  const pdf2 = path.join(require('os').tmpdir(), 'wr-pick.pdf');
  await page.pdf({ path: pdf2, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  execFileSync('pdftoppm', ['-png', '-r', '90', '-f', '1', '-l', '1', '-singlefile', pdf2, path.join(OUT, '05b-pick-list-print-a4')]);

  // 320 px ward walk
  const ctx2 = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-AU' });
  const p2 = await ctx2.newPage();
  await scenario(p2);
  await go(p2, '#walk/w4');
  await p2.fill('#cnt-f1', '1'); await p2.locator('#fc-f2 [data-act="full"]').click();
  await p2.evaluate(() => window.scrollTo(0, 0));
  await shot(p2, '14-ward-walk-320px.png');
  const sw = await p2.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  console.log('320 scrollWidth', sw);
  await browser.close();
  console.log(fs.readdirSync(OUT).join('\n'));
})();

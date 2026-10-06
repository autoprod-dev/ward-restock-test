// v1.1: private setup (file + #setup= link), product codes, whole boxes, 'check carton' marker.
// Uses a small MADE-UP setup only.
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const zlib = require('zlib');
const { fresh, state, nav, noHorizontalScroll } = require('./helpers');

const SETUP = {
  format: 'ward-restock-setup', version: 1, name: 'Test setup',
  wards: [{ name: 'Ward One' }, { name: 'Ward Two', on: true }, { name: 'Maybe Ward', on: false, note: 'uncertain' }],
  fluids: [
    { name: 'Fluid X', pack: '1000 mL', code: 'X-1000', upc: 12 },
    { name: 'Fluid Y', pack: '500 mL', code: 'Y-0500', upc: 18, upcOk: false, note: 'carton size from an old list' },
    { name: 'Fluid Z', pack: '100 mL', code: '', upc: null, note: 'carton size not found' },
  ],
  pars: [{ ward: 'Ward One', fluid: 'X-1000', boxes: 3 }, { ward: 'Ward One', fluid: 'Fluid Y|500 mL', boxes: 2 }, { ward: 'Ward Two', fluid: 'X-1000', boxes: 1 }],
};
const link = o => '#setup=' + zlib.deflateRawSync(Buffer.from(JSON.stringify(o))).toString('base64url');

test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

test('setup file: bad file is rejected clearly, good file loads, back to sample', async ({ page }, info) => {
  await fresh(page);
  await nav(page, '#setup/io');
  const bad = info.outputPath('bad.json'); fs.writeFileSync(bad, JSON.stringify({ format: 'ward-restock-setup', wards: [{ name: 'A' }, { name: 'a' }], fluids: [{ name: 'F', upc: 'ten' }] }));
  await page.setInputFiles('#setupFile', bad);
  await expect(page.locator('dialog')).toContainText('Could not load this setup');
  await expect(page.locator('dialog')).toContainText('"a" is listed twice');
  await expect(page.locator('dialog')).toContainText('must be a whole number');
  await page.locator('dialog .btn', { hasText: 'OK' }).click();
  expect((await state(page)).isSample).toBe(true);

  const good = info.outputPath('good.json'); fs.writeFileSync(good, JSON.stringify(SETUP));
  await page.setInputFiles('#setupFile', good);
  await expect(page.locator('dialog')).toContainText('3 wards (2 on the round, 1 off) and 3 fluids (2 to check carton size)');
  await page.locator('dialog .btn', { hasText: 'Load setup' }).click();
  await expect(page.locator('#loadSetup')).toContainText('Test setup');
  const s = await state(page);
  expect(s.setup.name).toBe('Test setup'); expect(s.history).toHaveLength(0); expect(s.isSample).toBe(false);
  expect(s.pars.w1.f1).toBe(36); expect(s.pars.w1.f2).toBe(36);
  await expect(page.locator('.banner.sample')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to sample data' }).click();
  await page.locator('dialog .btn', { hasText: 'Reset' }).click();
  await expect(page.locator('.banner.sample')).toBeVisible();
  expect((await state(page)).setup).toBeNull();
});

test('setup link loads, is stripped from the URL, then a full round runs in boxes', async ({ page }) => {
  await page.goto('./' + link(SETUP));
  await expect(page.locator('dialog')).toContainText('Load "Test setup"?');
  expect(page.url()).not.toContain('setup=');
  await page.locator('dialog .btn', { hasText: 'Load setup' }).click();
  await expect(page.locator('#loadSetup')).toContainText('from a link');

  // check-carton markers show and clear
  await nav(page, '#setup/fluids');
  await expect(page.locator('.ckrow')).toHaveCount(2);
  await page.getByRole('button', { name: 'Confirm 18/box for Fluid Y 500 mL' }).click();
  await expect(page.locator('.ckrow')).toHaveCount(1);
  await page.locator('[data-k="upc"]').last().fill('48'); await page.locator('[data-k="upc"]').last().press('Tab');
  await expect(page.locator('.ckrow')).toHaveCount(0);
  await page.locator('[data-k="code"]').last().fill('Z-0100'); await page.locator('[data-k="code"]').last().press('Tab');
  expect((await state(page)).fluids[2]).toMatchObject({ upc: 48, upcOk: true, code: 'Z-0100' });

  // off wards are hidden from the walk
  await nav(page, '#walk');
  await expect(page.locator('.wardbtn')).toHaveCount(2);
  await page.getByRole('link', { name: /Ward One/ }).click();
  await expect(page.locator('#fc-f1')).toContainText('Par 3 boxes (36 bags)');
  await expect(page.locator('#fc-f1')).toContainText('X-1000');
  await page.fill('#cnt-f1', '1');
  await expect(page.locator('#fc-f1 [data-topup]')).toHaveText('2');
  await page.locator('#fc-f2 [data-act="full"]').click();
  await expect(page.locator('#cnt-f2')).toHaveValue('2');
  await page.locator('[data-act="savewalk"]').click();
  await expect(page.locator('#toast')).toContainText('2 boxes to top up');
  expect((await state(page)).today.walks.w1.topups).toEqual({ f1: 24, f2: 0 });

  await nav(page, '#pick');
  await expect(page.locator('.sub')).toContainText('2 boxes');
  await expect(page.locator('#pick-combined + ul .q').first()).toHaveText('2boxes · 24 bags');
  await noHorizontalScroll(page);

  await nav(page, '#deliver');
  await page.locator('[data-short="w1|f1"]').click();
  await expect(page.locator('dialog')).toContainText('Needed 2 boxes');
  await page.locator('dialog .btn', { hasText: 'Save shortage' }).click();
  await expect(page.locator('.dline .chip.warn')).toContainText('Short 1 box · delivered 1');
  expect((await state(page)).fluids[0].stock).toBe(-12);

  await nav(page, '#order');
  await expect(page.locator('.orow[data-fid="f1"] [data-qty]')).toContainText('2 boxes = 24 bags (12/box)');
  await page.getByRole('button', { name: 'Copy as text' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('- X-1000 Fluid X 1000 mL: 2 boxes (24 bags)');
});

test('box mode: pars sheet is exported in boxes and labels show code and boxes', async ({ page }) => {
  await fresh(page);
  const t = await page.evaluate(() => window.WRCalc.buildTables(window.WR.state));
  expect(t.pars[0][0]).toBe('Fluid (boxes)');
  expect(t.fluids[0]).toContain('Product code');
  await nav(page, '#setup/labels');
  await expect(page.locator('.qlabel').first()).toContainText('DEMO-001');
});

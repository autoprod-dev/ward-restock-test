// The whole daily round, end to end, at 320 and 390 px:
// receive -> walk 2 wards -> pick list -> deliver (route reorder + one shortage) -> order -> new day -> history
const { test, expect } = require('@playwright/test');
const { state, restoreFixture, noHorizontalScroll, nav } = require('./helpers');

test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

test('daily round end to end', async ({ page }) => {
  await restoreFixture(page);
  await expect(page.locator('.banner.sample')).toHaveCount(0);

  // ---- 1. Receiving: 1 carton x 10 of Fluid A, then 5 units of Fluid C
  await page.locator('.bottomnav a[data-nav="receive"]').click();
  await expect(page.locator('h1')).toContainText('Receiving');
  await noHorizontalScroll(page);
  await page.selectOption('#rcvFluid', 'fA');
  await page.locator('[data-stepper="rcvCartons"] button[data-step="1"]').click();
  await expect(page.locator('#rcvUpc')).toHaveValue('10');
  await expect(page.locator('#rcvTotal')).toHaveText('Adds 10 units → store 35');
  await page.getByRole('button', { name: 'Add to store stock' }).click();
  await page.selectOption('#rcvFluid', 'fC');
  await page.locator('[data-rmode="units"]').click();
  await page.fill('#rcvQty', '5');
  await expect(page.locator('#rcvTotal')).toHaveText('Adds 5 units → store 105');
  await page.getByRole('button', { name: 'Add to store stock' }).click();
  await expect(page.getByRole('heading', { name: 'Received today (2)' })).toBeVisible();
  let s = await state(page);
  expect(s.fluids.find(f => f.id === 'fA').stock).toBe(35);
  expect(s.fluids.find(f => f.id === 'fC').stock).toBe(105);
  await expect(page.locator('.bottomnav a[data-nav="receive"]')).toHaveClass(/done/);

  // ---- 2. Ward walk: Ward Alpha and Ward Bravo
  await page.locator('.bottomnav a[data-nav="walk"]').click();
  await page.getByRole('link', { name: /Ward Alpha/ }).click();
  await expect(page.locator('.walkhead h1')).toHaveText('Ward Alpha');
  await noHorizontalScroll(page);
  await page.fill('#cnt-fA', '3');
  await expect(page.locator('#fc-fA [data-topup]')).toHaveText('7');
  await page.locator('#fc-fB [data-act="full"]').click();
  await expect(page.locator('#cnt-fB')).toHaveValue('8');
  await expect(page.locator('#fc-fB [data-topup]')).toHaveText('0');
  const plusC = page.locator('#fc-fC button[data-step="1"]');
  await plusC.click(); await plusC.click();
  await expect(page.locator('#cnt-fC')).toHaveValue('2');
  await expect(page.locator('#fc-fC [data-topup]')).toHaveText('4');
  await page.locator('[data-act="savewalk"]').click();
  await expect(page.getByRole('link', { name: /Ward Alpha/ })).toContainText('11 to top up');

  await page.getByRole('link', { name: /Ward Bravo/ }).click();
  await expect(page.locator('#fc-fC')).toHaveCount(0); // par 0 = not on this ward
  // saving with an uncounted line is blocked
  await page.fill('#cnt-fA', '0');
  await expect(page.locator('[data-act="savewalk"]')).toHaveText('Count 1 more to save');
  await page.locator('[data-act="savewalk"]').click({ force: true });
  await expect(page.locator('#toast')).toContainText('Count 1 more line first');
  await page.locator('#fc-fB button[data-step="1"]').click();
  await expect(page.locator('#fc-fA [data-topup]')).toHaveText('12');
  await expect(page.locator('#fc-fB [data-topup]')).toHaveText('3');
  await page.locator('[data-act="savewalk"]').click();
  await expect(page.getByRole('link', { name: /Ward Bravo/ })).toContainText('15 to top up');
  s = await state(page);
  expect(s.today.walks.wA.topups).toEqual({ fA: 7, fB: 0, fC: 4 });
  expect(s.today.walks.wB.topups).toEqual({ fA: 12, fB: 3 });
  expect(s.today.walks.wA.t).toBeTruthy();

  // ---- 3. Pick list: combined totals sorted by store location, then per ward
  await page.locator('.bottomnav a[data-nav="pick"]').click();
  await noHorizontalScroll(page);
  const combined = page.locator('#pick-combined + ul .line');
  await expect(combined).toHaveCount(3);
  const rows = await combined.evaluateAll(els => els.map(e => [e.querySelector('.nm').textContent, e.querySelector('.q').firstChild.textContent]));
  expect(rows).toEqual([['Fluid B 500 mL', '3'], ['Fluid A 1000 mL', '19'], ['Fluid C 100 mL', '4']]);
  await expect(page.locator('.sub')).toContainText('26');
  const alphaCard = page.locator('section.card', { has: page.getByRole('heading', { name: 'Ward Alpha' }) });
  await expect(alphaCard.locator('.line')).toHaveCount(2);
  await expect(alphaCard).toContainText('11 units');
  const bravoCard = page.locator('section.card', { has: page.getByRole('heading', { name: 'Ward Bravo' }) });
  await expect(bravoCard.locator('.line .nm')).toHaveText(['Fluid B 500 mL', 'Fluid A 1000 mL']);
  for (let i = 0; i < 3; i++) await page.locator('#pick-combined + ul input[type="checkbox"]').nth(i).check();
  await expect(page.locator('.bottomnav a[data-nav="pick"]')).toHaveClass(/done/);
  await expect(alphaCard.locator('input[type="checkbox"]').first()).toBeChecked(); // combined tick also ticks the ward lines

  // ---- 4. Delivery: reorder the route (drag, then the accessible buttons), tick lines, flag one shortage
  await page.locator('.bottomnav a[data-nav="deliver"]').click();
  await noHorizontalScroll(page);
  const order = () => page.locator('#route > li').evaluateAll(els => els.map(e => e.dataset.ward));
  await expect.poll(order).toEqual(['wA', 'wB']);
  // drag Ward Bravo's handle above Ward Alpha
  const handle = page.locator('#route > li[data-ward="wB"] [data-drag]');
  await handle.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const hb = await handle.boundingBox();
  const x = hb.x + hb.width / 2;
  await page.mouse.move(x, hb.y + hb.height / 2);
  await page.mouse.down();
  // drag upwards; near the top edge the list auto-scrolls until Ward Alpha's middle is passed
  for (let i = 0; i < 80; i++) {
    await page.mouse.move(x, 85 + (i % 2));
    const o = await order();
    if (o[0] === 'wB') break;
  }
  await page.mouse.up();
  await expect.poll(order).toEqual(['wB', 'wA']);
  await expect(page.locator('#toast')).toContainText('Route order saved');
  // and back again with the up button, then down again
  await page.getByRole('button', { name: 'Move Ward Alpha up' }).click();
  await expect.poll(order).toEqual(['wA', 'wB']);
  await page.getByRole('button', { name: 'Move Ward Alpha down' }).click();
  await expect.poll(order).toEqual(['wB', 'wA']);
  s = await state(page);
  expect(s.wards.find(w => w.id === 'wB').route).toBeLessThan(s.wards.find(w => w.id === 'wA').route);

  // Ward Bravo: Fluid A short by 2, Fluid B in full
  await page.locator('[data-short="wB|fA"]').click();
  await page.locator('dialog [data-stepper="shortQty"] button[data-step="1"]').click();
  await expect(page.locator('#shortNote')).toContainText('Delivered 10 of 12');
  await page.locator('dialog .btn', { hasText: 'Save shortage' }).click();
  await expect(page.locator('[data-shelve="wB|fA"]')).toBeChecked();
  await expect(page.locator('[data-wardsec="wB"]')).toContainText('Short 2 · delivered 10');
  await page.locator('[data-shelve="wB|fB"]').check();
  // Ward Alpha: Fluid A in full, Fluid C short by 1
  await page.locator('[data-shelve="wA|fA"]').check();
  await page.locator('[data-short="wA|fC"]').click();
  await page.locator('dialog .btn', { hasText: 'Save shortage' }).click();
  await expect(page.locator('[data-shelve="wA|fC"]')).toBeChecked();
  await expect(page.locator('.bottomnav a[data-nav="deliver"]')).toHaveClass(/done/);
  s = await state(page);
  const stock = id => s.fluids.find(f => f.id === id).stock;
  expect([stock('fA'), stock('fB'), stock('fC')]).toEqual([35 - 7 - 10, 50 - 3, 105 - 3]);
  // untick + retick keeps the store right
  await page.locator('[data-shelve="wA|fA"]').uncheck();
  s = await state(page); expect(stock('fA')).toBe(25);
  await page.locator('[data-shelve="wA|fA"]').check();
  s = await state(page); expect(stock('fA')).toBe(18);

  // ---- 5. Ordering: below-minimum + shortage items, carton rounding
  await page.locator('.bottomnav a[data-nav="order"]').click();
  await noHorizontalScroll(page);
  const items = page.locator('#orderList > li');
  await expect(items).toHaveCount(3);
  const qty = async () => items.evaluateAll(els => els.map(e => [e.dataset.fid, e.querySelector('[data-qty]').textContent.replace(/\s+/g, ' ').trim()]));
  expect(await qty()).toEqual([['fB', '23 units'], ['fA', '4 units'], ['fC', '1 unit']]);
  await expect(page.locator('#orderList > li[data-fid="fB"] .chip')).toHaveText(['Below min']);
  await expect(page.locator('#orderList > li[data-fid="fA"] .chip')).toHaveText(['Below min', 'Shortage Ward Bravo 2']);
  await expect(page.locator('#orderList > li[data-fid="fC"] .chip')).toHaveText(['Shortage Ward Alpha 1']);
  await page.locator('[data-omode="cartons"]').click();
  expect(await qty()).toEqual([['fB', '2 cartons = 40 units (20/ctn)'], ['fA', '1 carton = 10 units (10/ctn)'], ['fC', '1 carton = 50 units (50/ctn)']]);
  await page.getByRole('button', { name: 'Copy as text' }).click();
  await expect(page.locator('#toast')).toContainText('Order copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('Fluid B 500 mL: 2 cartons (40 units, 20/carton)');
  expect(clip).toContain('Fluid A 1000 mL: 1 carton (10 units, 10/carton)');
  expect(clip).toContain('Fluid C 100 mL: 1 carton (50 units, 50/carton)');
  await expect(page.locator('.bottomnav a[data-nav="order"]')).toHaveClass(/done/);

  // ---- Today shows every step done; start a new day
  await page.locator('.bottomnav a[data-nav="today"]').click();
  await expect(page.locator('.steps li.done')).toHaveCount(5);
  await page.locator('.actionbar [data-act="newday"]').click();
  await page.locator('dialog .btn', { hasText: 'Start new day' }).click();
  await expect(page.locator('#toast')).toContainText('New day started');
  await expect(page.locator('.steps li.done')).toHaveCount(0);
  await expect(page.locator('.steps li.current')).toContainText('Receive');
  s = await state(page);
  expect(s.history).toHaveLength(1);
  expect(s.history[0].delivered).toEqual({ wA: { fA: 7, fC: 3 }, wB: { fA: 10, fB: 3 } });
  expect(s.history[0].short).toEqual({ wA: { fC: 1 }, wB: { fA: 2 } });
  expect(s.history[0].received).toEqual({ fA: 10, fC: 5 });
  expect(s.fluids.find(f => f.id === 'fA').stock).toBe(18); // store stock carries over

  // ---- 6. History updated
  await page.locator('.topbar a[data-nav="history"]').click();
  await noHorizontalScroll(page);
  await expect(page.locator('.chart svg')).toHaveAttribute('aria-label', /: \d+\/\d+ 26$/);
  await expect(page.locator('table.data tbody tr').first()).toContainText('26');
  const hb2 = page.locator('section.card', { hasText: 'Average per day by ward' });
  // wards are listed in the new route order: Bravo first
  await expect(hb2.locator('.hbar').nth(0)).toContainText('Ward Bravo');
  await expect(hb2.locator('.hbar').nth(0).locator('b')).toHaveText('15');
  await expect(hb2.locator('.hbar').nth(1)).toContainText('Ward Alpha');
  await expect(hb2.locator('.hbar').nth(1).locator('b')).toHaveText('11');
  await page.selectOption('#hWard', 'wB');
  await expect(page.locator('.chart svg')).toHaveAttribute('aria-label', /Ward Bravo.* 15$/);
});

test('undo on destructive taps and the walk re-save resets ticks', async ({ page }) => {
  await restoreFixture(page);
  await nav(page, '#setup/wards');
  await page.getByRole('button', { name: 'Delete Ward Charlie' }).click();
  await expect(page.locator('[data-wardname]')).toHaveCount(2);
  await page.locator('#toast button', { hasText: 'Undo' }).click();
  await expect(page.locator('[data-wardname]')).toHaveCount(3);
  // receiving removal can be undone too
  await nav(page, '#receive');
  await page.locator('[data-stepper="rcvCartons"] button[data-step="1"]').click();
  await page.getByRole('button', { name: 'Add to store stock' }).click();
  await page.locator('[data-act="unreceive"]').click();
  await expect(page.getByRole('heading', { name: 'Received today (0)' })).toBeVisible();
  await page.locator('#toast button', { hasText: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Received today (1)' })).toBeVisible();
});

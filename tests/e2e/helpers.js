const path = require('path');
const { expect } = require('@playwright/test');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'flow.json');

async function fresh(page) {
  await page.goto('./');
  await expect(page.locator('#view h1')).toBeVisible();
}
async function state(page) { return page.evaluate(() => JSON.parse(JSON.stringify(window.WR.state))); }
async function restoreFixture(page, file) {
  await page.goto('./#setup/data');
  await page.setInputFiles('#restoreFile', file || FIXTURE);
  await page.locator('dialog .btn', { hasText: 'Restore' }).click();
  await expect(page.locator('#toast')).toContainText('Backup restored');
}
async function noHorizontalScroll(page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'page must not scroll sideways').toBeLessThanOrEqual(w);
}
async function nav(page, hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForFunction(h => location.hash === h, hash);
}
module.exports = { fresh, state, restoreFixture, noHorizontalScroll, nav, FIXTURE };

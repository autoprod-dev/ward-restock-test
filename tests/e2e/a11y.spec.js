// Accessibility: axe-core checks (incl. WCAG AA colour contrast) on every screen, light and dark.
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const AXE = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { fresh, nav } = require('./helpers');
test.use({ bypassCSP: true }); // only so the axe script can be injected

for (const theme of ['light', 'dark']) {
  test(`axe: no serious issues on any screen (${theme})`, async ({ page }) => {
    await fresh(page);
    await page.evaluate(theme => {
      const s = window.WR.state; s.settings.theme = theme;
      s.today.walks.w1 = { t: new Date().toISOString(), counts: {}, topups: { f1: 9, f2: 4 } };
      s.today.deliv.w1 = { f1: { done: true, short: 2, applied: 7 } };
      localStorage.setItem('wardRestock.v1', JSON.stringify(s));
    }, theme);
    await page.reload();
    const problems = [];
    for (const h of ['#today', '#receive', '#walk', '#walk/w3', '#pick', '#deliver', '#order', '#history', '#setup/wards', '#setup/fluids', '#setup/pars', '#setup/io', '#setup/data']) {
      await nav(page, h);
      await page.waitForTimeout(150);
      await page.evaluate(() => { document.getElementById('toast').innerHTML = ''; });
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
        return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' ' + (n.any[0] ? n.any[0].message : '')).join(' | '));
      });
      res.forEach(r => problems.push(h + ' ' + r));
    }
    expect(problems).toEqual([]);
  });
}

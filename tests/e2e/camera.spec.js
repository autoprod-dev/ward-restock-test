// QR scanning with a fake camera that shows a printed shelf label (exercises the scanner end to end).
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const os = require('os'); const path = require('path');
const qrcode = require('qrcode-generator');
const { fresh, nav } = require('./helpers');

// A fake camera that shows a printed shelf label (exercises the scanner end to end).
const Y4M = path.join(os.tmpdir(), 'ward-restock-qr.y4m');
(function makeY4m() {
  const qr = qrcode(0, 'M'); qr.addData("WR1:Compound Sodium Lactate (Hartmann's)|1000 mL"); qr.make();
  const n = qr.getModuleCount(); const W = 640, H = 480, cell = 9, size = (n + 8) * cell;
  const ox = Math.floor((W - size) / 2), oy = Math.floor((H - size) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c))
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) Y[(oy + (r + 4) * cell + y) * W + ox + (c + 4) * cell + x] = 16;
  const UV = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frames = []; for (let i = 0; i < 5; i++) frames.push(Buffer.from('FRAME\n'), Y, UV);
  fs.writeFileSync(Y4M, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)].concat(frames)));
})();
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] } });
test('scanning a shelf label jumps to that fluid on the ward walk', async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await fresh(page);
    await nav(page, '#walk/w3');
    expect(await page.evaluate(() => typeof window.jsQR)).toBe('undefined'); // nothing loaded until the camera is used
    await page.getByRole('button', { name: 'Scan a shelf label' }).click();
    await expect(page.locator('#toast')).toContainText("Found Compound Sodium Lactate (Hartmann's) 1000 mL", { timeout: 15000 });
    await expect(page.locator('dialog')).not.toHaveAttribute('open', '');
    await expect(page.locator('#cnt-f7')).toBeFocused();
    await expect(page.locator('#fc-f7')).toBeInViewport();
    expect(['BarcodeDetector', 'jsQR']).toContain(await page.evaluate(() => window.WR.scanEngine));
    // the camera is switched off again
    expect(await page.evaluate(() => document.querySelector('#scanVideo') ? !!document.querySelector('#scanVideo').srcObject?.active : false)).toBe(false);
  });

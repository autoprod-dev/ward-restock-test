const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/ward-restock-test/', locale: 'en-AU', hasTouch: true, isMobile: true, deviceScaleFactor: 2, acceptDownloads: true, actionTimeout: 10000 },
  projects: [
    { name: 'w320', use: { viewport: { width: 320, height: 640 } } },
    { name: 'w390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'node tests/server.js', url: 'http://localhost:4173/ward-restock-test/', reuseExistingServer: true },
});

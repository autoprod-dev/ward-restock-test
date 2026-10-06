# Ward Restock by Autoprod (TEST)

A mobile-first, offline web app for a wards delivery stock controller who restocks IV fluids.
Test site: https://autoprod-dev.github.io/ward-restock-test/

**The daily round:** Receive → Ward walk → Pick list → Delivery → Order, then *Start new day* (archives into History).
Setup holds wards, fluids, pars (grid editor), CSV / Excel import and export with a preview, JSON backup and restore,
and printable QR shelf labels.

## Privacy

- All data stays in this browser's `localStorage` on the device. No server, no login, no analytics, no network calls after load
  (enforced by a Content-Security-Policy with `connect-src 'self'`).
- Stock data only. There are no patient fields anywhere.
- Not for search engines: `noindex` meta tag and `robots.txt` disallow.

## Sample data

The app starts with clearly marked **SAMPLE DATA**: made-up wards, ~12 common IV fluid lines, made-up store locations,
quantities, pars and 14 days of generated history. It is sample stock data only, not clinical guidance, and is not taken from
any real hospital. Replace it from *Setup → Import / export* (Excel template) or edit it in Setup.

## Files

| Path | What |
| --- | --- |
| `index.html`, `app.css`, `app.js` | The app (single page, hash routes) |
| `calc.js` | Pure calculations: top-ups, pick list, delivery, ordering, par suggestions, CSV, import validation |
| `sample.js` | Deterministic sample data generator |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: installable, works fully offline |
| `vendor/` | Bundled libraries (no CDN): SheetJS 0.18.5, jsQR 1.4.0, QR Code Generator 2.0.4, with licences |
| `tests/` | Unit tests (`node --test`) and Playwright e2e tests at 320 and 390 px |
| `tools/shots.js` | Screenshot script |

## Run the tests

```
npm install
npx playwright install chromium   # if the browser is not installed yet
npm test                          # unit + e2e (starts a local server on port 4173)
```

## Licences

Bundled libraries keep their own licences in `vendor/licenses/`: SheetJS Community Edition (Apache-2.0),
jsQR (Apache-2.0), QR Code Generator by Kazuhiko Arase (MIT). "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

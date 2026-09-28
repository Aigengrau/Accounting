/**
 * Browser smoke test.
 *
 * Serves the app over HTTP (ES modules and the service worker both need a real
 * origin), drives it in Chromium, and checks that each screen renders, that an
 * entry can be added, and that the figures propagate.
 *
 *   node scripts/smoke.mjs [--screenshots]
 *
 * Requires Playwright, which is a dev-time dependency only. The app itself has
 * no dependencies at all.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = process.argv.includes('--screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const requested = new Set();
const missing = new Set();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  requested.add(path);

  const filePath = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Service-Worker-Allowed': '/',
    });
    res.end(body);
  } catch {
    missing.add(path);
    res.writeHead(404).end('Not found');
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

/**
 * Resolves Playwright from wherever it happens to live. It is a dev-time tool,
 * so it may be installed locally, globally, or only in the npx cache.
 */
async function loadPlaywright() {
  const candidates = ['playwright'];
  const { existsSync, readdirSync } = await import('node:fs');
  const npxCache = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')
    : null;

  if (npxCache && existsSync(npxCache)) {
    for (const dir of readdirSync(npxCache)) {
      const candidate = join(npxCache, dir, 'node_modules', 'playwright', 'index.mjs');
      if (existsSync(candidate)) candidates.push(pathToFileURL(candidate).href);
    }
  }

  for (const spec of candidates) {
    try {
      return await import(spec);
    } catch { /* try the next location */ }
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // a phone, which is the target
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: !!condition, detail });
};

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.nav-item', { timeout: 10_000 });

  check('app boots', await page.locator('.app-title').count() > 0);
  check('bottom navigation renders', await page.locator('.nav-item').count() >= 5);
  check('empty state shown for a fresh install',
    (await page.locator('.empty-state').count()) > 0);

  if (SHOT) await page.screenshot({ path: 'scratch-01-empty.png' });

  // ---------------------------------------------------- add an income entry
  await page.locator('.empty-state .btn-primary, .fab').first().click();
  await page.waitForSelector('.quick-grid');
  check('quick-add sheet opens', await page.locator('.quick-tile').count() > 10);

  await page.locator('.quick-tile', { hasText: 'Client payment received' }).click();
  await page.waitForSelector('.sheet-body .input');

  // USD income where the bank converted: the exact case this app is built for.
  await page.locator('.sheet-body [name="amount"]').fill('5000');
  await page.locator('.sheet-body [name="currency"]').selectOption('USD');
  await page.waitForTimeout(200);

  check('FX block appears for a foreign currency',
    (await page.locator('.segmented-item', { hasText: 'Bank converted' }).count()) > 0);

  await page.locator('.sheet-body [name="jpyCredited"]').fill('742300');
  await page.locator('.sheet-body [name="fees"]').fill('2200');
  await page.waitForTimeout(200);

  const preview = await page.locator('.rate-preview-main').first().textContent();
  check('derived rate previewed', preview?.includes('742,300'), preview || '');

  const note = await page.locator('.rate-preview-note').first().textContent();
  check('rate derived as 148.90 from credited yen plus fee',
    note?.includes('148.9'), note || '');

  await page.locator('.sheet-body [name="date"]').fill('2025-03-15');
  await page.locator('.sheet-body [name="description"]').fill('Client A — March retainer');
  await page.locator('.sheet-body [name="bankName"]').fill('SMBC');

  await page.locator('.sheet-body [name="save"]').click();
  await page.waitForTimeout(900);

  check('entry sheet closed after saving', (await page.locator('.sheet-overlay').count()) === 0);

  check('entry saved and dashboard rebuilt',
    (await page.locator('.empty-state').count()) === 0);

  // ------------------------------------------------------- walk the screens
  const screens = [
    { nav: 'Entries', expect: '.list-row' },
    { nav: 'Tax', expect: '.deriv-row' },
    { nav: 'Advice', expect: '.advice-item' },
    { nav: 'Books', expect: '.segmented-item' },
    { nav: 'Home', expect: '.stat' },
  ];

  for (const s of screens) {
    await page.locator('.nav-item', { hasText: s.nav }).click();
    await page.waitForTimeout(400);
    const count = await page.locator(s.expect).count();
    check(`${s.nav} screen renders`, count > 0, `${s.expect} count ${count}`);
    if (SHOT) await page.screenshot({ path: `scratch-${s.nav.toLowerCase()}.png`, fullPage: true });
  }

  // ------------------------------------------------------- charts and books
  await page.locator('.nav-item', { hasText: 'Home' }).click();
  await page.waitForTimeout(400);
  check('burden chart drawn', (await page.locator('.chart-bar').count()) > 0);
  check('chart has a table fallback', (await page.locator('.chart-table').count()) > 0);

  await page.locator('.nav-item', { hasText: 'Books' }).click();
  await page.waitForTimeout(400);
  const booksText = await page.locator('.view').innerText();
  check('books report balancing', booksText.includes('Books balance'), booksText.slice(0, 120));

  // ------------------------------------------------------- settings screen
  await page.locator('.app-header .nav-item').last().click();
  await page.waitForTimeout(500);
  check('settings screen renders', (await page.locator('.card').count()) > 5);
  if (SHOT) await page.screenshot({ path: 'scratch-settings.png', fullPage: true });

  // ------------------------------------------- layout under a realistic year
  // One transaction proves nothing about layout. Seed a full year through the
  // app's own store so the screens render with numbers of realistic width.
  await page.locator('.nav-item', { hasText: 'Home' }).click();
  await page.waitForTimeout(300);

  const seeded = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { lockRate } = await import('./js/fx.js');

    await store.updateSettings({
      name: 'Test User', city: 'Shibuya-ku', arrivalDate: '2023-04-01',
      primaryBank: 'SMBC', hasSpouse: true, spouseIncome: 0, spouseAge: 33,
      householdSize: 2, age: 35, paidNationalPension: 210_120,
      paidHealthInsurance: 384_000, filedKaigyoTodoke: true,
      filedBlueReturnApplication: true, smallEnterpriseMutual: 240_000,
    });

    // Monthly USD retainer landing on a Japanese account, bank-converted.
    for (let m = 1; m <= 12; m++) {
      const month = String(m).padStart(2, '0');
      const credited = 690_000 + m * 3_500;
      await store.saveTransaction({
        kind: 'income', date: `2025-${month}-25`, account: '400', settlement: '110',
        amount: 4600, currency: 'USD', jpyCredited: credited, fees: 2_200,
        rateSource: 'bank_actual', bankName: 'SMBC',
        sourceNote: `SMBC statement 2025-${month}-25`,
        description: 'Northwind Ltd — monthly retainer',
        incomeSource: 'japan', paidIn: 'japan', workPerformedIn: 'japan',
        isExportExempt: true,
      });
      // Rent, apportioned for a home office.
      await store.saveTransaction({
        kind: 'expense', date: `2025-${month}-01`, account: '575', settlement: '110',
        amount: 138_000, currency: 'JPY', businessRatio: 0.25,
        ratioBasis: 'work room 12m² of 48m² total floor area', description: 'Rent',
      });
      await store.saveTransaction({
        kind: 'expense', date: `2025-${month}-10`, account: '520', settlement: '110',
        amount: 9_800, currency: 'JPY', businessRatio: 0.6,
        ratioBasis: 'usage log', description: 'Internet and mobile',
      });
      await store.saveTransaction({
        kind: 'expense', date: `2025-${month}-05`, account: '510', settlement: '110',
        amount: 14_500, currency: 'JPY', businessRatio: 0.25,
        ratioBasis: 'same basis as rent', description: 'Electricity and gas',
      });
    }

    await store.saveTransaction({
      kind: 'expense', date: '2025-05-20', account: '545', settlement: '110',
      amount: 268_000, currency: 'JPY', description: 'MacBook Pro (少額減価償却資産の特例)',
    });
    await store.saveTransaction({
      kind: 'transfer', date: '2025-06-25', from: '110', to: '140',
      amount: 400_000, currency: 'JPY', description: 'Personal drawing',
    });

    return store.getState().transactions.length;
  });

  check('seeded a full year', seeded >= 50, `${seeded} transactions`);
  await page.waitForTimeout(900);

  for (const s of screens) {
    await page.locator('.nav-item', { hasText: s.nav }).click();
    await page.waitForTimeout(500);
    const count = await page.locator(s.expect).count();
    check(`${s.nav} renders with a full year`, count > 0);
    if (SHOT) await page.screenshot({ path: `scratch-full-${s.nav.toLowerCase()}.png`, fullPage: true });
  }

  // With real numbers the tax actually bites, so the figures should be non-trivial.
  await page.locator('.nav-item', { hasText: 'Tax' }).click();
  await page.waitForTimeout(500);
  const taxText = await page.locator('.view').innerText();
  check('income tax computed on a real year', /所得税/.test(taxText));
  check('resident tax computed', /住民税/.test(taxText));

  await page.locator('.nav-item', { hasText: 'Books' }).click();
  await page.waitForTimeout(500);
  const fullBooks = await page.locator('.view').innerText();
  check('books still balance with a full year', fullBooks.includes('Books balance'),
    fullBooks.slice(0, 200));

  // ---------------------------------------------------------- dark mode
  await context.close();
  const darkCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2,
  });
  const darkPage = await darkCtx.newPage();
  await darkPage.goto(base, { waitUntil: 'networkidle' });
  await darkPage.waitForSelector('.nav-item');
  const bg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark mode applies its own palette', bg === 'rgb(13, 13, 13)', bg);
  if (SHOT) await darkPage.screenshot({ path: 'scratch-dark.png' });
  await darkCtx.close();
} catch (err) {
  check('smoke run completed', false, err.message);
} finally {
  await browser.close();
  server.close();
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no 404s for app assets', missing.size === 0, [...missing].join(', '));

console.log('');
for (const r of results) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass || !r.detail ? '' : `\n      ${r.detail}`}`);
}
const failedCount = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount > 0 ? 1 : 0);

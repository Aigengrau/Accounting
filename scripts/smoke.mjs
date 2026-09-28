/**
 * Browser smoke test.
 *
 * Serves the app and drives it in Chromium: sets a starting balance, records
 * spending and foreign income, checks the arithmetic, then turns on the passcode
 * and confirms the data really is encrypted on disk.
 *
 *   node scripts/smoke.mjs [--screenshots]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = process.argv.includes('--screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

const missing = new Set();
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  try {
    const body = await readFile(join(ROOT, normalize(path).slice(1)));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    missing.add(path);
    res.writeHead(404).end('Not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* look in the npx cache */ }
  const cache = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
  if (cache && existsSync(cache)) {
    for (const d of readdirSync(cache)) {
      const c = join(cache, d, 'node_modules', 'playwright', 'index.mjs');
      if (existsSync(c)) return import(pathToFileURL(c).href);
    }
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));

const results = [];
const check = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });
const balanceText = () => page.locator('.balance-value').innerText();

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.nav-item', { timeout: 10_000 });

  // ------------------------------------------------------- starting balance
  check('app boots', (await page.locator('.app-name').count()) > 0);
  check('asks for starting cash first', (await page.locator('.welcome').count()) > 0);
  if (SHOT) await page.screenshot({ path: 'scratch-welcome.png' });

  await page.locator('[name="startingCash"]').fill('85000');
  await page.locator('[name="start"]').click();
  await page.waitForTimeout(500);
  check('balance shows the starting cash', (await balanceText()).includes('85,000'), await balanceText());

  // ------------------------------------------------------------- an expense
  await page.locator('.fab-out').click();
  await page.waitForSelector('.sheet-body [name="amount"]');
  await page.locator('.sheet-body [name="amount"]').fill('1250');
  await page.locator('.cat-tile', { hasText: 'Groceries' }).click();
  await page.locator('.sheet-body [name="note"]').fill('Life supermarket');
  await page.locator('.sheet-body [name="save"]').click();
  await page.waitForTimeout(600);
  check('expense subtracts from the balance', (await balanceText()).includes('83,750'), await balanceText());

  // -------------------------------------------------- foreign income in USD
  await page.locator('.fab-in').click();
  await page.waitForSelector('.sheet-body [name="amount"]');
  await page.locator('.sheet-body [name="amount"]').fill('500');
  await page.locator('.sheet-body [name="currency"]').selectOption('USD');
  await page.waitForTimeout(250);
  check('asks for the yen actually received',
    (await page.locator('.sheet-body [name="jpy"]').count()) > 0);
  await page.locator('.sheet-body [name="jpy"]').fill('74000');
  await page.locator('.cat-tile', { hasText: 'Apartment rent' }).click();
  await page.locator('.sheet-body [name="save"]').click();
  await page.waitForTimeout(600);
  check('foreign income adds its yen value, not its face amount',
    (await balanceText()).includes('157,750'), await balanceText());

  if (SHOT) await page.screenshot({ path: 'scratch-home.png', fullPage: true });

  const homeText = await page.locator('.view').innerText();
  check('spending breakdown appears', /Where it went/i.test(homeText));
  check('income sources are tracked separately', /Money in during/i.test(homeText));
  check('apartment rent is named as a source', /Apartment rent/i.test(homeText));

  // ------------------------------------------------------------ cash count
  await page.locator('.balance-count').click();
  await page.waitForSelector('.sheet-body [name="actual"]');
  await page.locator('.sheet-body [name="actual"]').fill('155000');
  await page.waitForTimeout(250);
  const countHint = await page.locator('.sheet-body .field-hint').first().innerText();
  check('cash count explains the difference', /less than recorded/i.test(countHint), countHint);
  await page.locator('.sheet-body [name="save"]').click();
  await page.waitForTimeout(600);
  check('balance matches the counted cash', (await balanceText()).includes('155,000'), await balanceText());

  // ---------------------------------------------------------------- history
  await page.locator('.nav-item', { hasText: 'History' }).click();
  await page.waitForTimeout(400);
  check('history lists every entry', (await page.locator('.list-row').count()) === 3,
    `${await page.locator('.list-row').count()} rows`);
  if (SHOT) await page.screenshot({ path: 'scratch-history.png', fullPage: true });

  await page.locator('.segmented-item', { hasText: 'In' }).click();
  await page.waitForTimeout(300);
  check('the In filter narrows to income', (await page.locator('.list-row').count()) === 1);

  // -------------------------------------------------------------- passcode
  await page.locator('.nav-item', { hasText: 'Settings' }).click();
  await page.waitForTimeout(400);
  if (SHOT) await page.screenshot({ path: 'scratch-settings.png', fullPage: true });

  await page.locator('.btn', { hasText: 'Set a passcode' }).click();
  await page.waitForSelector('.sheet-body [name="passcode"]');
  await page.locator('.sheet-body [name="passcode"]').fill('my secret phrase');
  await page.locator('.sheet-body [name="confirm"]').fill('my secret phrase');
  await page.locator('.sheet-body [name="save"]').click();
  await page.waitForTimeout(1500); // key derivation is deliberately slow

  const settingsText = await page.locator('.view').innerText();
  check('settings reports the data as encrypted', /Encrypted/i.test(settingsText));

  // The real test: read the raw database and confirm nothing is legible.
  const raw = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('aoiro-basic');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const value = await new Promise((res, rej) => {
      const r = db.transaction('vault').objectStore('vault').get('data');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return JSON.stringify(value);
  });
  check('stored data is ciphertext, not readable JSON',
    !raw.includes('Life supermarket') && !raw.includes('apartment') && raw.includes('ciphertext'),
    raw.slice(0, 90));

  // --------------------------------------------------------- lock / unlock
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('reopening asks for the passcode', (await page.locator('.lock-screen').count()) > 0);
  if (SHOT) await page.screenshot({ path: 'scratch-lock.png' });

  await page.locator('.lock-input').fill('wrong passcode');
  await page.locator('[name="unlock"]').click();
  await page.waitForTimeout(1600);
  check('a wrong passcode is refused',
    /wrong passcode/i.test(await page.locator('.lock-error').innerText()));

  await page.locator('.lock-input').fill('my secret phrase');
  await page.locator('[name="unlock"]').click();
  await page.waitForTimeout(1800);
  check('the right passcode unlocks', (await page.locator('.balance-value').count()) > 0);
  check('the data survived encryption intact', (await balanceText()).includes('155,000'),
    await balanceText());

  // ------------------------------------------------------------- dark mode
  const darkCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2,
  });
  const darkPage = await darkCtx.newPage();
  await darkPage.goto(base, { waitUntil: 'networkidle' });
  await darkPage.waitForSelector('.welcome, .lock-screen, .balance-card');
  const bg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark mode uses its own palette', bg === 'rgb(14, 14, 13)', bg);
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
check('no missing assets', missing.size === 0, [...missing].join(', '));

console.log('');
for (const r of results) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass || !r.detail ? '' : `\n      ${r.detail}`}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

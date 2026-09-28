import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8',
  '.css':'text/css;charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (req,res) => {
  let p = decodeURIComponent(new URL(req.url,'http://l').pathname);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, normalize(p).slice(1)));
    res.writeHead(200,{'Content-Type':MIME[extname(p)]||'application/octet-stream'}); res.end(body);
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0,r));
const base = `http://127.0.0.1:${server.address().port}/`;

const cache = join(process.env.LOCALAPPDATA,'npm-cache','_npx');
let pw;
for (const d of readdirSync(cache)) {
  const c = join(cache,d,'node_modules','playwright','index.mjs');
  if (existsSync(c)) { pw = await import(pathToFileURL(c).href); break; }
}
const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport:{width:412,height:900}, deviceScaleFactor:2 })).newPage();
await page.goto(base,{waitUntil:'networkidle'});
await page.waitForSelector('.nav-item');

await page.evaluate(async () => {
  const store = await import('./js/store.js');
  await store.updateSettings({ name:'T', city:'Shibuya-ku', arrivalDate:'2023-04-01', primaryBank:'SMBC',
    hasSpouse:true, spouseIncome:0, spouseAge:33, householdSize:2, age:35,
    paidNationalPension:210120, paidHealthInsurance:384000,
    filedKaigyoTodoke:true, filedBlueReturnApplication:true, smallEnterpriseMutual:240000 });
  for (let m=1;m<=12;m++){
    const mm=String(m).padStart(2,'0');
    await store.saveTransaction({ kind:'income', date:`2025-${mm}-25`, account:'400', settlement:'110',
      amount:4600, currency:'USD', jpyCredited:690000+m*3500, fees:2200, rateSource:'bank_actual',
      bankName:'SMBC', sourceNote:`SMBC stmt 2025-${mm}-25`, description:'Northwind Ltd — monthly retainer',
      incomeSource:'japan', paidIn:'japan', workPerformedIn:'japan', isExportExempt:true });
    await store.saveTransaction({ kind:'expense', date:`2025-${mm}-01`, account:'575', settlement:'110',
      amount:138000, currency:'JPY', businessRatio:0.25, ratioBasis:'work room 12m² of 48m²', description:'Rent' });
    await store.saveTransaction({ kind:'expense', date:`2025-${mm}-10`, account:'520', settlement:'110',
      amount:9800, currency:'JPY', businessRatio:0.6, ratioBasis:'usage log', description:'Internet and mobile' });
  }
  await store.saveTransaction({ kind:'expense', date:'2025-05-20', account:'545', settlement:'110',
    amount:268000, currency:'JPY', description:'MacBook Pro' });
  await store.setTaxYear(2025);
});
await page.waitForTimeout(1200);

const shots = [
  { view:'tax', sel:'.compare-grid', file:'scratch-crop-compare.png' },
  { view:'tax', sel:'.card:has(.deriv)', file:'scratch-crop-deriv.png', nth:2 },
  { view:'transactions', sel:'.card', file:'scratch-crop-entries.png', nth:1 },
];
for (const s of shots) {
  await page.evaluate((v) => import('./js/store.js').then(m=>m.setView(v)), s.view);
  await page.waitForTimeout(600);
  const el = page.locator(s.sel).nth(s.nth ?? 0);
  if (await el.count()) { await el.screenshot({ path: s.file }); console.log('wrote', s.file); }
  else console.log('MISSING', s.sel);
}
await browser.close(); server.close();

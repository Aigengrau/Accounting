/**
 * Tests for the parts where a mistake costs real money: the balance arithmetic,
 * amount parsing, and the encryption.
 *
 *   node scripts/test.mjs
 */

import { parseAmount, yen, formatCurrency, monthKey, friendlyDate, today } from '../js/money.js';
import { category, categoriesFor } from '../js/categories.js';
import {
  deriveKey, encryptJson, decryptJson, randomSalt, ratePasscode, isAvailable,
} from '../js/crypto.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, message: err.message }); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; } catch (err) { failures.push({ name, message: err.message }); }
}
function eq(a, b, label = '') {
  if (a !== b) throw new Error(`${label || 'value'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

// ------------------------------------------------------------ amount parsing

test('plain numbers parse', () => {
  eq(parseAmount('1200'), 1200);
  eq(parseAmount('0'), 0);
  eq(parseAmount('12.5'), 12.5);
});

test('typed-in commas and symbols are tolerated', () => {
  eq(parseAmount('1,200'), 1200);
  eq(parseAmount('¥1,200'), 1200);
  eq(parseAmount('$45.50'), 45.5);
  eq(parseAmount('₽3 000'), 3000);
  eq(parseAmount(' 800 '), 800);
});

test('full-width digits from a Japanese keyboard parse', () => {
  eq(parseAmount('１２００'), 1200);
  eq(parseAmount('１，２００'), 1200);
});

test('nonsense becomes zero rather than NaN', () => {
  eq(parseAmount('abc'), 0);
  eq(parseAmount(''), 0);
  eq(parseAmount(null), 0);
  eq(parseAmount(undefined), 0);
});

test('negative amounts survive, since adjustments need them', () => {
  eq(parseAmount('-500'), -500);
});

// ------------------------------------------------------------- formatting

test('yen is always whole and comma-grouped', () => {
  eq(yen(1200), '¥1,200');
  eq(yen(1200.7), '¥1,201');
  eq(yen(0), '¥0');
  eq(yen(-3400), '¥-3,400');
  eq(yen(1234567), '¥1,234,567');
});

test('other currencies keep their decimals', () => {
  eq(formatCurrency(45.5, 'USD'), '$45.50');
  eq(formatCurrency(3000, 'RUB'), '₽3,000.00');
  eq(formatCurrency(1200, 'JPY'), '¥1,200');
});

test('month keys group correctly', () => {
  eq(monthKey('2026-09-28'), '2026-09');
  eq(monthKey('2026-01-01'), '2026-01');
});

test('today reads as Today, not a date', () => {
  eq(friendlyDate(today()), 'Today');
});

// -------------------------------------------------------------- categories

test('every category resolves to a label and icon', () => {
  for (const type of ['expense', 'income']) {
    for (const c of categoriesFor(type)) {
      ok(c.label, `${c.id} has a label`);
      ok(c.icon, `${c.id} has an icon`);
    }
  }
});

test('an unknown category degrades instead of throwing', () => {
  eq(category('nonsense').label, 'nonsense');
});

test('apartment rent and freelance are separate income sources', () => {
  const ids = categoriesFor('income').map((c) => c.id);
  ok(ids.includes('apartment'), 'apartment rent');
  ok(ids.includes('freelance'), 'freelance');
});

// ----------------------------------------------------------- balance logic

// Mirrors store.signedJpy and store.cashBalance without importing IndexedDB.
const signedJpy = (e) => (e.type === 'income' ? e.jpy : e.type === 'adjust' ? e.jpy : -e.jpy);
const balanceOf = (start, entries) => entries.reduce((s, e) => s + signedJpy(e), start);

test('income adds, expense subtracts', () => {
  eq(balanceOf(10_000, [
    { type: 'income', jpy: 50_000 },
    { type: 'expense', jpy: 1_200 },
    { type: 'expense', jpy: 800 },
  ]), 58_000);
});

test('a cash count shortfall is subtracted', () => {
  // Recorded 20,000 but the wallet holds 18,500: a -1,500 adjustment.
  eq(balanceOf(20_000, [{ type: 'adjust', jpy: -1_500 }]), 18_500);
});

test('a cash count surplus is added', () => {
  eq(balanceOf(20_000, [{ type: 'adjust', jpy: 1_500 }]), 21_500);
});

test('balance can go negative without breaking', () => {
  eq(balanceOf(1_000, [{ type: 'expense', jpy: 5_000 }]), -4_000);
});

test('foreign income counts at its yen value, not its face amount', () => {
  // $500 that produced 74,000 yen must move the balance by 74,000.
  eq(balanceOf(0, [{ type: 'income', jpy: 74_000, amount: 500, currency: 'USD' }]), 74_000);
});

// ------------------------------------------------------------- encryption

await testAsync('WebCrypto is available under Node', () => {
  ok(isAvailable(), 'crypto.subtle present');
});

await testAsync('a round trip returns the same data', async () => {
  const salt = randomSalt();
  const key = await deriveKey('correct horse battery', salt);
  const data = { entries: [{ id: 'a', jpy: 1200, note: 'Lawson' }], settings: { startingCash: 5000 } };
  const blob = await encryptJson(key, data);
  const back = await decryptJson(key, blob);
  eq(JSON.stringify(back), JSON.stringify(data));
});

await testAsync('the ciphertext does not contain the plaintext', async () => {
  const salt = randomSalt();
  const key = await deriveKey('passcode', salt);
  const blob = await encryptJson(key, { note: 'SECRETVALUE', jpy: 999999 });
  const bytes = new Uint8Array(blob.ciphertext);
  const asText = Buffer.from(bytes).toString('latin1');
  ok(!asText.includes('SECRETVALUE'), 'plaintext leaked into the ciphertext');
  ok(!asText.includes('999999'), 'the amount leaked into the ciphertext');
});

await testAsync('the wrong passcode fails instead of returning garbage', async () => {
  const salt = randomSalt();
  const right = await deriveKey('right-one', salt);
  const wrong = await deriveKey('wrong-one', salt);
  const blob = await encryptJson(right, { secret: true });
  let threw = false;
  try { await decryptJson(wrong, blob); } catch { threw = true; }
  ok(threw, 'decryption with the wrong key must throw');
});

await testAsync('each encryption uses a fresh IV', async () => {
  const salt = randomSalt();
  const key = await deriveKey('same-passcode', salt);
  const a = await encryptJson(key, { x: 1 });
  const b = await encryptJson(key, { x: 1 });
  ok(a.iv.join(',') !== b.iv.join(','), 'IV must never repeat under one key');
  ok(a.ciphertext.join(',') !== b.ciphertext.join(','), 'identical input must not produce identical output');
});

await testAsync('the same passcode with a different salt yields a different key', async () => {
  const blob = await encryptJson(await deriveKey('pass', randomSalt()), { x: 1 });
  const other = await deriveKey('pass', randomSalt());
  let threw = false;
  try { await decryptJson(other, blob); } catch { threw = true; }
  ok(threw, 'salt must make the key unique');
});

test('weak passcodes are rejected, reasonable ones accepted', () => {
  eq(ratePasscode('').ok, false);
  eq(ratePasscode('12').ok, false);
  eq(ratePasscode('1234').ok, false, 'sequential');
  eq(ratePasscode('0000').ok, false, 'repeated');
  eq(ratePasscode('8462').ok, true);
  eq(ratePasscode('my secret phrase').level, 'strong');
});

// ---------------------------------------------------------------- report

console.log('');
if (failures.length) {
  console.log('FAILURES');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('');
}
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

/**
 * State and storage.
 *
 * Everything lives in one IndexedDB record on this device. When a passcode is
 * set, that record is encrypted and the key exists only in memory while the app
 * is unlocked.
 *
 * Writing the whole set on every change is not clever, but for a personal cash
 * book it is instant and it makes the encrypted case trivial — there is one blob
 * to encrypt and one to decrypt, so there is no way for half the data to end up
 * in a different state from the other half.
 */

import { deriveKey, encryptJson, decryptJson, randomSalt, isAvailable } from './crypto.js';
import { today, monthKey } from './money.js';

const DB_NAME = 'aoiro-basic';
const DB_VERSION = 1;
const VAULT = 'vault';
const DATA_KEY = 'data';
const META_KEY = 'meta';

let dbPromise = null;
let cryptoKey = null;       // held only while unlocked; never persisted
const listeners = new Set();

let state = {
  ready: false,
  locked: false,
  encrypted: false,
  entries: [],
  settings: defaultSettings(),
  view: 'home',
  toast: null,
};

export function defaultSettings() {
  return {
    currencies: ['JPY', 'USD', 'RUB'],
    startingCash: 0,
    startingCashDate: today(),
    lastBackup: null,
    theme: 'auto',
  };
}

// ------------------------------------------------------------------ database

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser cannot store data locally.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULT)) db.createObjectStore(VAULT);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('Another tab has the app open. Close it and reload.'));
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT, mode);
    const store = tx.objectStore(VAULT);
    let request;
    try { request = fn(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
  }));
}

const readRaw = (key) => idb('readonly', (s) => s.get(key));
const writeRaw = (key, value) => idb('readwrite', (s) => s.put(value, key));

// ------------------------------------------------------------- subscriptions

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

// ---------------------------------------------------------------- lifecycle

/**
 * Boots the app.
 * Returns `{ locked: true }` when a passcode is set, in which case nothing is
 * readable until `unlock` succeeds.
 */
export async function init() {
  const meta = (await readRaw(META_KEY)) || { encrypted: false };

  if (meta.encrypted) {
    setState({ ready: true, locked: true, encrypted: true });
    return state;
  }

  const payload = (await readRaw(DATA_KEY)) || null;
  applyPayload(payload);
  setState({ ready: true, locked: false, encrypted: false });

  // Ask the browser not to evict this data when storage runs low.
  navigator.storage?.persist?.().catch(() => {});
  return state;
}

/** Attempts to unlock. A wrong passcode fails the AES-GCM tag, so it throws. */
export async function unlock(passcode) {
  const meta = await readRaw(META_KEY);
  if (!meta?.encrypted) throw new Error('No passcode is set.');

  const key = await deriveKey(passcode, new Uint8Array(meta.salt));
  const blob = await readRaw(DATA_KEY);

  if (!blob) {
    // Passcode set but nothing saved yet. Accept it and start clean.
    cryptoKey = key;
    applyPayload(null);
    setState({ locked: false, encrypted: true });
    return true;
  }

  let payload;
  try {
    payload = await decryptJson(key, blob);
  } catch {
    throw new Error('Wrong passcode.');
  }

  cryptoKey = key;
  applyPayload(payload);
  // Always land on the balance. Returning to whatever screen was open when the
  // app locked is disorienting — you unlock to see how much you have.
  setState({ locked: false, encrypted: true, view: 'home' });
  navigator.storage?.persist?.().catch(() => {});
  return true;
}

/** Drops the key from memory. Data stays encrypted on disk. */
export function lock() {
  cryptoKey = null;
  setState({ locked: true, entries: [], settings: defaultSettings() });
}

function applyPayload(payload) {
  setState({
    entries: Array.isArray(payload?.entries) ? payload.entries.sort(byDateDesc) : [],
    settings: { ...defaultSettings(), ...(payload?.settings || {}) },
  });
}

async function persist() {
  const payload = { version: 1, entries: state.entries, settings: state.settings };
  if (state.encrypted) {
    if (!cryptoKey) throw new Error('The app is locked.');
    await writeRaw(DATA_KEY, await encryptJson(cryptoKey, payload));
  } else {
    await writeRaw(DATA_KEY, payload);
  }
}

// ------------------------------------------------------------------ passcode

/** Turns on encryption and rewrites the existing data under the new key. */
export async function setPasscode(passcode) {
  if (!isAvailable()) throw new Error('This browser cannot encrypt data.');
  const salt = randomSalt();
  const key = await deriveKey(passcode, salt);
  cryptoKey = key;
  await writeRaw(META_KEY, { encrypted: true, salt: Array.from(salt) });
  setState({ encrypted: true });
  await persist();
}

/** Turns encryption off, after checking the current passcode. */
export async function removePasscode(currentPasscode) {
  const meta = await readRaw(META_KEY);
  if (!meta?.encrypted) return;
  const key = await deriveKey(currentPasscode, new Uint8Array(meta.salt));
  const blob = await readRaw(DATA_KEY);
  if (blob) {
    try { await decryptJson(key, blob); } catch { throw new Error('Wrong passcode.'); }
  }
  cryptoKey = null;
  setState({ encrypted: false });
  await writeRaw(META_KEY, { encrypted: false });
  await persist();
}

export async function changePasscode(current, next) {
  await removePasscode(current);
  await setPasscode(next);
}

// -------------------------------------------------------------------- writes

const newId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `e${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`);
const byDateDesc = (a, b) => (b.date === a.date
  ? String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  : String(b.date).localeCompare(String(a.date)));

/**
 * Saves an entry.
 *
 * `jpy` is what the money is worth in yen and is what every total uses. For a
 * yen entry it equals the amount; for foreign currency you supply what you
 * actually received.
 */
export async function saveEntry(draft) {
  const amount = Number(draft.amount) || 0;
  const currency = draft.currency || 'JPY';
  const jpy = currency === 'JPY' ? Math.round(amount) : Math.round(Number(draft.jpy) || 0);

  const type = ['income', 'adjust'].includes(draft.type) ? draft.type : 'expense';
  let rate = 1;
  if (currency !== 'JPY') rate = amount ? jpy / amount : 0;

  const entry = {
    id: draft.id || newId(),
    type,
    date: draft.date || today(),
    amount,
    currency,
    jpy,
    rate,
    category: draft.category || (draft.type === 'income' ? 'other-income' : 'other'),
    note: (draft.note || '').trim(),
    // Room to add bank accounts later without reshaping anything.
    account: draft.account || 'cash',
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const entries = [...state.entries.filter((e) => e.id !== entry.id), entry].sort(byDateDesc);
  setState({ entries });
  await persist();
  return entry;
}

export async function deleteEntry(id) {
  setState({ entries: state.entries.filter((e) => e.id !== id) });
  await persist();
}

export async function updateSettings(patch) {
  setState({ settings: { ...state.settings, ...patch } });
  await persist();
  return state.settings;
}

/**
 * Records a cash count.
 *
 * Real cash never quite matches a running total — small purchases go unrecorded.
 * Rather than pretend, this books the difference as a visible adjustment so the
 * balance matches the notes in your pocket.
 */
export async function recordCashCount(actualJpy, date = today()) {
  const difference = Math.round(actualJpy) - cashBalance();
  if (difference === 0) return null;
  // The amount is signed: negative means cash you spent without recording it.
  return saveEntry({
    type: 'adjust',
    date,
    amount: difference,
    currency: 'JPY',
    category: 'other',
    note: difference > 0
      ? 'Cash count — more than expected'
      : 'Cash count — unrecorded spending',
  });
}

// ----------------------------------------------------------------- selectors

/** Signed yen effect of an entry on your cash. */
export function signedJpy(entry) {
  // Adjustments are stored already signed; income adds, everything else subtracts.
  if (entry.type === 'income' || entry.type === 'adjust') return entry.jpy;
  return -entry.jpy;
}

export function cashBalance() {
  const start = Number(state.settings.startingCash) || 0;
  return state.entries.reduce((sum, e) => sum + signedJpy(e), start);
}

export function entriesForMonth(key) {
  return state.entries.filter((e) => monthKey(e.date) === key);
}

export function monthTotals(key) {
  const rows = entriesForMonth(key);
  const income = rows.filter((e) => e.type === 'income').reduce((s, e) => s + e.jpy, 0);
  const spent = rows.filter((e) => e.type === 'expense').reduce((s, e) => s + e.jpy, 0);
  const adjusted = rows.filter((e) => e.type === 'adjust').reduce((s, e) => s + e.jpy, 0);
  return { income, spent, adjusted, net: income - spent + adjusted, count: rows.length };
}

/** Spending by category for a month, largest first. */
export function spendingByCategory(key) {
  const totals = new Map();
  for (const e of entriesForMonth(key)) {
    if (e.type !== 'expense') continue;
    totals.set(e.category, (totals.get(e.category) || 0) + e.jpy);
  }
  return [...totals.entries()]
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Income by source for a year — the figures you will need if you ever file. */
export function incomeByYear(year) {
  const totals = new Map();
  for (const e of state.entries) {
    if (e.type !== 'income') continue;
    if (!String(e.date).startsWith(String(year))) continue;
    totals.set(e.category, (totals.get(e.category) || 0) + e.jpy);
  }
  return [...totals.entries()]
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function monthsWithEntries() {
  return [...new Set(state.entries.map((e) => monthKey(e.date)))]
    .sort((a, b) => b.localeCompare(a));
}

// ------------------------------------------------------------------ ui state

export function setView(view) {
  setState({ view });
}

export function toast(message, kind = 'info') {
  setState({ toast: { message, kind, at: Date.now() } });
  setTimeout(() => {
    if (state.toast && Date.now() - state.toast.at >= 2800) setState({ toast: null });
  }, 2900);
}

// ------------------------------------------------------------ backup, wipe

export async function exportBackup() {
  await updateSettings({ lastBackup: new Date().toISOString() });
  return {
    format: 'aoiro-basic-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entryCount: state.entries.length,
    entries: state.entries,
    settings: state.settings,
  };
}

export async function importBackup(backup) {
  if (backup?.format !== 'aoiro-basic-backup') throw new Error('That is not a backup from this app.');
  if (!Array.isArray(backup.entries)) throw new Error('That backup has no entries in it.');
  setState({
    entries: backup.entries.sort(byDateDesc),
    settings: { ...defaultSettings(), ...(backup.settings || {}) },
  });
  await persist();
  return backup.entries.length;
}

export async function wipeEverything() {
  cryptoKey = null;
  await idb('readwrite', (s) => s.clear());
  setState({
    entries: [], settings: defaultSettings(), encrypted: false, locked: false,
  });
}

export function daysSinceBackup() {
  const last = state.settings.lastBackup;
  if (!last) return Infinity;
  return (Date.now() - new Date(last).getTime()) / 86_400_000;
}

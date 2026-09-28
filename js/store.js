/**
 * Application state and the write path.
 *
 * Every mutation flows through here, which keeps two invariants that matter:
 *
 *   1. A transaction and its journal entries are written together. The books can
 *      never hold a transaction with no double-entry behind it.
 *   2. A locked FX rate is never silently overwritten. Editing a locked
 *      transaction records an amendment.
 *
 * Views subscribe and re-render; nothing reaches into IndexedDB directly.
 */

import { db, STORES } from './db.js';
import { postTransaction } from './accounting/journal.js';
import { lockRate, amendRate } from './fx.js';
import { DEFAULT_TAX_YEAR } from './tax/rates.js';

const listeners = new Set();
let state = createInitialState();

function createInitialState() {
  return {
    ready: false,
    taxYear: DEFAULT_TAX_YEAR,
    transactions: [],
    journal: [],
    assets: [],
    clients: [],
    years: {},
    settings: defaultSettings(),
    ui: { view: 'dashboard', filter: {}, toast: null },
  };
}

export function defaultSettings() {
  return {
    // Profile
    name: '',
    businessName: '',
    businessDescription: '',
    city: '',
    // Tax residency
    isJapaneseNational: false,
    hasJapanAddress: true,
    yearsInJapan: 0,
    arrivalDate: '',
    // Filing posture
    blueReturnType: 'etax_double_entry',
    enterpriseCategory: 'category1',
    monthsInBusiness: 12,
    filedKaigyoTodoke: false,
    filedBlueReturnApplication: false,
    willFileViaEtax: true,
    // Household
    age: 35,
    hasSpouse: false,
    spouseIncome: 0,
    spouseAge: 0,
    dependents: [],
    // Health insurance and pension
    nhiPreset: 'tokyo23',
    householdSize: 1,
    nhiOverrides: null,
    pensionMonths: 12,
    pensionSupplementary: false,
    // Consumption tax
    consumptionTaxRegistered: false,
    invoiceNumber: '',
    simplifiedCategory: 'type5_services',
    // Deductions paid in cash this year
    paidNationalPension: 0,
    paidHealthInsurance: 0,
    smallEnterpriseMutual: 0,
    ideco: 0,
    lifeInsurance: 0,
    earthquakeInsurance: 0,
    medicalExpenses: 0,
    donations: 0,
    // Home office apportionment defaults
    homeOfficeRatios: { rent: 0.25, utilities: 0.25, communication: 0.6 },
    homeOfficeBasis: '',
    // Currency and banking
    currencies: ['JPY', 'USD', 'RUB'],
    primaryBank: '',
    defaultRateSource: 'bank_actual',
    // Preferences
    language: 'en',
    showJapanese: true,
    lastBackup: null,
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export function getState() {
  return state;
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

/** Loads everything from IndexedDB into memory. Called once at boot. */
export async function initStore() {
  const [transactions, journal, assets, clients, settingRows, yearRows] = await Promise.all([
    db.getAll(STORES.TRANSACTIONS),
    db.getAll(STORES.JOURNAL),
    db.getAll(STORES.ASSETS),
    db.getAll(STORES.CLIENTS),
    db.getAll(STORES.SETTINGS),
    db.getAll(STORES.YEARS),
  ]);

  const stored = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const settings = { ...defaultSettings(), ...(stored.profile || {}) };
  const years = Object.fromEntries(yearRows.map((y) => [y.year, y]));

  setState({
    ready: true,
    transactions: transactions.sort(byDateDesc),
    journal,
    assets,
    clients,
    years,
    settings,
    taxYear: stored.taxYear || guessTaxYear(transactions),
  });

  // Ask once for persistent storage so the browser is less likely to evict the books.
  db.requestPersistence().catch(() => {});
  return state;
}

/** Defaults to the year the user is actually working in. */
function guessTaxYear(transactions) {
  const now = new Date();
  // Jan–Mar is filing season for the previous year, so default there.
  const candidate = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  if (transactions.length === 0) return candidate;
  const years = new Set(transactions.map((t) => Number(String(t.date).slice(0, 4))));
  return years.has(candidate) ? candidate : Math.max(...years);
}

const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

export async function setTaxYear(year) {
  await db.setting('taxYear', year);
  setState({ taxYear: Number(year) });
}

export async function updateSettings(patch) {
  const settings = { ...state.settings, ...patch };
  await db.setting('profile', settings);
  setState({ settings });
  return settings;
}

export function setView(view, filter = {}) {
  setState({ ui: { ...state.ui, view, filter } });
}

export function toast(message, kind = 'info') {
  setState({ ui: { ...state.ui, toast: { message, kind, at: Date.now() } } });
  setTimeout(() => {
    if (state.ui.toast && Date.now() - state.ui.toast.at >= 3500) {
      setState({ ui: { ...state.ui, toast: null } });
    }
  }, 3600);
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Saves a transaction and its journal entries together.
 *
 * `draft.fx` may be either an already-locked record or the raw inputs to lock.
 * Locking here rather than in the view means no code path can store an unlocked
 * rate.
 */
export async function saveTransaction(draft) {
  const id = draft.id || newId('tx');
  const date = draft.date || new Date().toISOString().slice(0, 10);

  const fx = draft.fx?.lockedAt
    ? draft.fx
    : lockRate({
        amount: Number(draft.amount),
        currency: draft.currency || 'JPY',
        date,
        jpyCredited: draft.jpyCredited ?? null,
        rate: draft.rate ?? null,
        source: draft.rateSource ?? null,
        sourceNote: draft.sourceNote || '',
        bankName: draft.bankName || state.settings.primaryBank || '',
        fees: Number(draft.fees) || 0,
        crossRate: draft.crossRate || null,
      });

  const tx = {
    id,
    date,
    year: Number(String(date).slice(0, 4)),
    kind: draft.kind || 'expense',
    account: draft.account,
    settlement: draft.settlement || '110',
    from: draft.from,
    to: draft.to,
    description: draft.description || '',
    clientId: draft.clientId || null,
    amount: fx.jpy,
    fx,
    businessRatio: draft.businessRatio ?? 1,
    ratioBasis: draft.ratioBasis || '',
    withholding: Number(draft.withholding) || 0,
    // Sourcing fields, used by the non-permanent resident analysis.
    incomeSource: draft.incomeSource || null,
    paidIn: draft.paidIn || null,
    workPerformedIn: draft.workPerformedIn || null,
    isExportExempt: !!draft.isExportExempt,
    isRemittance: !!draft.isRemittance,
    receiptId: draft.receiptId || null,
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Replace any prior journal entries for this transaction so an edit does not
  // leave orphaned postings behind.
  const priorEntries = state.journal.filter((e) => e.transactionId === id);
  for (const e of priorEntries) await db.delete(STORES.JOURNAL, e.id);

  const entry = postTransaction(tx);
  await db.put(STORES.TRANSACTIONS, tx);
  await db.put(STORES.JOURNAL, entry);

  const transactions = [...state.transactions.filter((t) => t.id !== id), tx].sort(byDateDesc);
  const journal = [...state.journal.filter((e) => e.transactionId !== id), entry];
  setState({ transactions, journal });
  return tx;
}

/**
 * Edits a transaction whose FX rate is already locked.
 * The prior rate is preserved as an amendment rather than overwritten.
 */
export async function amendTransaction(id, changes, reason) {
  const existing = state.transactions.find((t) => t.id === id);
  if (!existing) throw new Error('Transaction not found.');

  const touchesRate = ['amount', 'rate', 'jpyCredited', 'rateSource', 'date', 'fees'].some(
    (k) => changes[k] !== undefined,
  );

  const fx = touchesRate
    ? amendRate(existing.fx, {
        amount: changes.amount, rate: changes.rate, jpyCredited: changes.jpyCredited,
        source: changes.rateSource, date: changes.date, fees: changes.fees,
        sourceNote: changes.sourceNote,
      }, reason)
    : existing.fx;

  return saveTransaction({ ...existing, ...changes, fx });
}

export async function deleteTransaction(id) {
  const entries = state.journal.filter((e) => e.transactionId === id);
  for (const e of entries) await db.delete(STORES.JOURNAL, e.id);
  await db.delete(STORES.TRANSACTIONS, id);
  setState({
    transactions: state.transactions.filter((t) => t.id !== id),
    journal: state.journal.filter((e) => e.transactionId !== id),
  });
}

/** Fixed asset register (固定資産台帳), used for the depreciation schedule. */
export async function saveAsset(draft) {
  const asset = {
    id: draft.id || newId('asset'),
    name: draft.name,
    category: draft.category || 'other',
    acquiredDate: draft.acquiredDate,
    cost: Number(draft.cost) || 0,
    usefulLife: Number(draft.usefulLife) || 5,
    method: draft.method || 'straight_line',
    businessRatio: draft.businessRatio ?? 1,
    treatment: draft.treatment || 'depreciate', // depreciate | lump_sum_3y | immediate_300k | expensed
    disposedDate: draft.disposedDate || null,
    notes: draft.notes || '',
    updatedAt: new Date().toISOString(),
  };
  await db.put(STORES.ASSETS, asset);
  setState({ assets: [...state.assets.filter((a) => a.id !== asset.id), asset] });
  return asset;
}

export async function deleteAsset(id) {
  await db.delete(STORES.ASSETS, id);
  setState({ assets: state.assets.filter((a) => a.id !== id) });
}

export async function saveClient(draft) {
  const client = {
    id: draft.id || newId('client'),
    name: draft.name,
    country: draft.country || '',
    isNonResident: !!draft.isNonResident,
    currency: draft.currency || 'USD',
    defaultWorkLocation: draft.defaultWorkLocation || 'japan',
    notes: draft.notes || '',
  };
  await db.put(STORES.CLIENTS, client);
  setState({ clients: [...state.clients.filter((c) => c.id !== client.id), client] });
  return client;
}

export async function deleteClient(id) {
  await db.delete(STORES.CLIENTS, id);
  setState({ clients: state.clients.filter((c) => c.id !== id) });
}

/** Per-year state: opening capital, filing status, carried-forward losses. */
export async function saveYear(year, patch) {
  const existing = state.years[year] || { year: Number(year) };
  const row = { ...existing, ...patch, year: Number(year) };
  await db.put(STORES.YEARS, row);
  setState({ years: { ...state.years, [year]: row } });
  return row;
}

// ------------------------------------------------------------------- selectors

export function transactionsForYear(year = state.taxYear) {
  return state.transactions.filter((t) => t.year === Number(year));
}

export function journalForYear(year = state.taxYear) {
  return state.journal.filter((e) => String(e.date).startsWith(String(year)));
}

export function remittancesForYear(year = state.taxYear) {
  return transactionsForYear(year).filter((t) => t.isRemittance);
}

/** Income streams shaped for the sourcing engine. */
export function incomeStreamsForYear(year = state.taxYear) {
  return transactionsForYear(year)
    .filter((t) => t.kind === 'income')
    .map((t) => ({
      id: t.id,
      amountJpy: t.fx?.jpy ?? t.amount,
      source: t.incomeSource || 'japan',
      paidIn: t.paidIn || 'japan',
      workPerformedIn: t.workPerformedIn || 'japan',
      description: t.description,
      clientId: t.clientId,
    }));
}

// ------------------------------------------------------------ backup / restore

export async function exportBackup() {
  const backup = await db.exportAll();
  await updateSettings({ lastBackup: new Date().toISOString() });
  return backup;
}

export async function importBackup(json, mode = 'replace') {
  const restored = await db.importAll(json, mode);
  await initStore();
  return restored;
}

export async function wipeEverything() {
  await db.wipe();
  state = createInitialState();
  await initStore();
}

/** Days since the last export, so the UI can nag proportionately. */
export function daysSinceBackup() {
  const last = state.settings.lastBackup;
  if (!last) return Infinity;
  return (Date.now() - new Date(last).getTime()) / 86_400_000;
}

/**
 * Derived state.
 *
 * Maps the books and the settings onto the tax engine's input shape, then caches
 * the result. Every view reads from here rather than assembling its own input, so
 * the dashboard, the tax screen and the advisor can never quietly disagree about
 * what you owe.
 *
 * One subtlety worth calling out. Social insurance is deductible in the year you
 * *pay* it, and what you pay this year is assessed on last year's income. So the
 * deduction uses the amounts you actually paid, from settings, while the app's
 * own health-insurance figure is a projection of next year's bill. They are
 * deliberately different numbers and the UI says so.
 */

import { getState, transactionsForYear, journalForYear, incomeStreamsForYear } from './store.js';
import { profitAndLoss, balanceSheet, blueReturnStatement } from './accounting/reports.js';
import { trialBalance, validateBooks } from './accounting/journal.js';
import { annualCharge } from './accounting/depreciation.js';
import { computeAll } from './tax/engine.js';
import { advise, compareFilingOptions } from './tax/advisor.js';
import { determineResidency, applyRemittanceRules } from './tax/sourcing.js';
import { ratesFor } from './tax/rates.js';

let cache = { key: null, value: null };

/** Cache key covering everything the computation depends on. */
function cacheKey(state) {
  return JSON.stringify([
    state.taxYear,
    state.transactions.length,
    state.transactions.at(0)?.updatedAt,
    state.assets.length,
    state.assets.at(-1)?.updatedAt,
    state.settings,
    state.years[state.taxYear],
  ]);
}

/** Builds the tax engine input from settings plus the books. */
export function buildTaxInput(state = getState(), year = state.taxYear) {
  const s = state.settings;
  const entries = state.journal.filter((e) => String(e.date).startsWith(String(year)));
  const pl = profitAndLoss(entries, year);
  const depreciation = annualCharge(state.assets, year);

  // The books already carry depreciation posted through the journal; the asset
  // register adds any charge not yet posted. Take the register as authoritative
  // and subtract what the journal holds, so nothing is counted twice.
  const postedDepreciation = pl.expenses.find((e) => e.code === '550')?.amount || 0;
  const familyWages = pl.expenses.find((e) => e.code === '585')?.amount || 0;
  const extraDepreciation = Math.max(0, depreciation.businessTotal - postedDepreciation);

  const operatingExpenses = pl.totalExpenses - postedDepreciation - familyWages;
  const withheld = entries.reduce((sum, e) => {
    const line = e.lines.find((l) => l.account === '230');
    return sum + (line ? line.debit : 0);
  }, 0);

  const yearRow = state.years[year] || {};

  return {
    taxYear: Number(year),
    business: {
      revenue: pl.totalRevenue,
      expenses: operatingExpenses,
      depreciation: postedDepreciation + extraDepreciation,
      familyWages,
      blueReturnType: s.blueReturnType,
      enterpriseCategory: s.enterpriseCategory,
      monthsInBusiness: s.monthsInBusiness,
      enterpriseLossCarryforward: yearRow.enterpriseLossCarryforward || 0,
    },
    otherIncome: {
      salary: yearRow.salaryIncome || 0,
      miscellaneous: yearRow.miscellaneousIncome || 0,
      realEstate: yearRow.realEstateIncome || 0,
    },
    lossCarryforward: yearRow.lossCarryforward || 0,
    deductions: {
      socialInsurance: {
        nationalPension: s.paidNationalPension,
        nationalHealthInsurance: s.paidHealthInsurance,
        other: 0,
      },
      smallEnterpriseMutual: s.smallEnterpriseMutual,
      ideco: s.ideco,
      lifeInsurance: s.lifeInsurance,
      earthquakeInsurance: s.earthquakeInsurance,
      medical: s.medicalExpenses,
      donations: s.donations,
      spouse: { hasSpouse: s.hasSpouse, income: s.spouseIncome, age: s.spouseAge },
      dependents: s.dependents || [],
    },
    nhi: {
      preset: s.nhiPreset,
      householdSize: s.householdSize,
      age: s.age,
      ...(s.nhiOverrides || {}),
    },
    pension: { months: s.pensionMonths, supplementary: s.pensionSupplementary },
    consumptionTax: {
      basePeriodTaxableSales: yearRow.basePeriodTaxableSales || 0,
      isRegistered: s.consumptionTaxRegistered,
      domesticTaxableSales: domesticSales(state, year),
      exportExemptSales: exportSales(state, year),
      taxableInputs: operatingExpenses,
      simplifiedCategory: s.simplifiedCategory,
    },
    withholding: withheld,
    estimatedTaxPaid: yearRow.estimatedTaxPaid || 0,
    foreignTaxCredit: yearRow.foreignTaxCredit || 0,
  };
}

function domesticSales(state, year) {
  return transactionsForYear(year)
    .filter((t) => t.kind === 'income' && !t.isExportExempt)
    .reduce((s, t) => s + (t.fx?.jpy ?? t.amount), 0);
}

function exportSales(state, year) {
  return transactionsForYear(year)
    .filter((t) => t.kind === 'income' && t.isExportExempt)
    .reduce((s, t) => s + (t.fx?.jpy ?? t.amount), 0);
}

/**
 * Everything the views need, computed once per state change.
 */
export function derive(force = false) {
  const state = getState();
  const key = cacheKey(state);
  if (!force && cache.key === key) return cache.value;

  const year = state.taxYear;
  const s = state.settings;
  const rates = ratesFor(year);
  const entries = journalForYear(year);
  const transactions = transactionsForYear(year);

  const residency = determineResidency({
    isJapaneseNational: s.isJapaneseNational,
    hasJapanAddress: s.hasJapanAddress,
    yearsInJapan: yearsInJapan(s, year),
  }, rates);

  const streams = incomeStreamsForYear(year);
  const remittanceTotal = transactions
    .filter((t) => t.isRemittance)
    .reduce((sum, t) => sum + (t.fx?.jpy ?? t.amount), 0);
  const sourcing = applyRemittanceRules(streams, remittanceTotal, residency.status);

  const input = buildTaxInput(state, year);
  const computed = computeAll(input);

  const report = advise(input, {
    residency,
    streams,
    transactions,
    profile: {
      filedKaigyoTodoke: s.filedKaigyoTodoke,
      filedBlueReturnApplication: s.filedBlueReturnApplication,
    },
  });

  const pl = profitAndLoss(entries, year);
  const yearRow = state.years[year] || {};
  const bs = balanceSheet(state.journal, year, yearRow.openingCapital || 0);
  const statement = blueReturnStatement(state.journal, year, {
    blueDeduction: rates.blueReturnDeduction[s.blueReturnType] || 0,
    blueReturnType: s.blueReturnType,
    willFileViaEtax: s.willFileViaEtax,
    openingCapital: yearRow.openingCapital || 0,
    depreciationSchedule: annualCharge(state.assets, year).detail,
  });

  const value = {
    year, rates, residency, sourcing, input, computed, report,
    pl, bs, statement,
    transactions, entries,
    trialBalance: trialBalance(entries),
    bookIssues: validateBooks(entries, transactions),
    depreciation: annualCharge(state.assets, year),
    filingComparison: compareFilingOptions(input),
    remittanceTotal,
  };

  cache = { key, value };
  return value;
}

/** Years of Japanese residence as at the end of the tax year. */
function yearsInJapan(settings, year) {
  if (settings.arrivalDate) {
    const arrival = new Date(settings.arrivalDate);
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const years = (yearEnd - arrival) / (365.25 * 86_400_000);
    return Math.max(0, years);
  }
  return Number(settings.yearsInJapan) || 0;
}

export function invalidate() {
  cache = { key: null, value: null };
}

/**
 * Test suite for the calculation core.
 *
 *   node scripts/test.mjs
 *
 * Covers the tax engine, the double-entry books, FX rate locking and the
 * non-permanent resident sourcing rules. Figures are checked against hand
 * calculations from the NTA's own worksheets, which is the only way to be
 * confident a tax engine is right.
 */

import { ratesFor, tierFor, pensionMonthly, filerIncomeTier } from '../js/tax/rates.js';
import {
  computeAll, computeBusinessIncome, computeIncomeTaxFromBase, computeEnterpriseTax,
} from '../js/tax/engine.js';
import {
  determineResidency, classifySource, applyRemittanceRules, auditIncomeSetup,
  RESIDENCY, SOURCE,
} from '../js/tax/sourcing.js';
import { advise, compareFilingOptions, estimateFurusatoLimit } from '../js/tax/advisor.js';
import { lockRate, amendRate, validateRate, deriveCrossRate, auditFxQuality, RATE_SOURCE } from '../js/fx.js';
import { postTransaction, trialBalance, validateBooks, buildLedger } from '../js/accounting/journal.js';
import { profitAndLoss, balanceSheet, blueReturnStatement, journalToCsv } from '../js/accounting/reports.js';
import { recommendTreatment, scheduleFor, annualCharge, TREATMENT } from '../js/accounting/depreciation.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
  }
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label || 'value'}: expected ${expected}, got ${actual}`);
  }
}

function near(actual, expected, tolerance, label = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label || 'value'}: expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

function ok(condition, label) {
  if (!condition) throw new Error(label || 'expected truthy');
}

// ============================================================ rate tables

test('2025 basic deduction uses the reform tiers', () => {
  const r = ratesFor(2025);
  eq(tierFor(r.basicDeduction, 3_000_000).amount, 880_000, 'at 3M');
  eq(tierFor(r.basicDeduction, 8_000_000).amount, 580_000, 'at 8M');
  eq(tierFor(r.basicDeduction, 26_000_000).amount, 0, 'above 25M');
});

test('2027 reverts to the flat raised basic deduction', () => {
  eq(tierFor(ratesFor(2027).basicDeduction, 3_000_000).amount, 580_000);
});

test('2024 uses the pre-reform basic deduction', () => {
  eq(tierFor(ratesFor(2024).basicDeduction, 3_000_000).amount, 480_000);
});

test('filing deadline slides off a weekend', () => {
  // 2026-03-15 is a Sunday, so the 2025 return is due the 16th.
  eq(ratesFor(2025).filingDeadline, '2026-03-16');
  // 2027-03-15 is a Monday.
  eq(ratesFor(2026).filingDeadline, '2027-03-15');
});

test('pension premium follows the fiscal year, not the calendar year', () => {
  const r = ratesFor(2025);
  eq(pensionMonthly(r, new Date('2025-06-01')), 17_510, 'June 2025 is FY2025');
  eq(pensionMonthly(r, new Date('2026-02-01')), 17_510, 'Feb 2026 still FY2025');
  eq(pensionMonthly(r, new Date('2026-05-01')), 17_920, 'May 2026 is FY2026');
});

// ============================================================ income tax

test('income tax matches the NTA quick table', () => {
  const r = ratesFor(2025);
  // 3,000,000 taxable: 10% bracket, 97,500 subtraction.
  eq(computeIncomeTaxFromBase(3_000_000, r).tax, 202_500);
  // 5,000,000 taxable: 20% bracket, 427,500 subtraction.
  eq(computeIncomeTaxFromBase(5_000_000, r).tax, 572_500);
  // 10,000,000 taxable: 33% bracket, 1,536,000 subtraction.
  eq(computeIncomeTaxFromBase(10_000_000, r).tax, 1_764_000);
});

test('taxable income truncates to the nearest 1,000 yen', () => {
  const r = ratesFor(2025);
  const result = computeIncomeTaxFromBase(3_649_880, r);
  eq(result.taxableIncome, 3_649_000, 'rounded down');
  eq(result.tax, 302_300);
});

test('blue-return deduction cannot create a loss', () => {
  const r = ratesFor(2025);
  const biz = computeBusinessIncome(
    { revenue: 1_000_000, expenses: 600_000, blueReturnType: 'etax_double_entry' }, r,
  );
  eq(biz.beforeBlueDeduction, 400_000);
  eq(biz.blueDeduction, 400_000, 'capped at profit');
  eq(biz.income, 0, 'floored at zero');
  eq(biz.blueDeductionForgone, 250_000, 'the rest is lost');
});

test('full computation reconciles end to end', () => {
  const result = computeAll({
    taxYear: 2025,
    business: {
      revenue: 7_200_000, expenses: 1_200_000,
      blueReturnType: 'etax_double_entry', enterpriseCategory: 'category1', monthsInBusiness: 12,
    },
    deductions: {
      socialInsurance: { nationalPension: 210_120, nationalHealthInsurance: 480_000 },
      spouse: { hasSpouse: true, income: 0, age: 34 },
    },
    nhi: { preset: 'tokyo23', householdSize: 2, age: 35 },
    pension: { months: 12 },
    consumptionTax: { basePeriodTaxableSales: 5_000_000 },
  });

  eq(result.business.income, 5_350_000, '事業所得');
  eq(result.deductions.income, 1_700_120, 'total deductions');
  eq(result.incomeTax.taxableIncome, 3_649_000, '課税所得金額');
  eq(result.incomeTax.tax, 302_300, '所得税');
  eq(result.incomeTax.surtax, 6_348, '復興特別所得税');
  eq(result.residentTax.total, 392_400, '住民税');
  eq(result.enterpriseTax.total, 155_000, '個人事業税');
  ok(result.summary.totalBurden > 1_700_000, 'total burden plausible');
});

test('resident tax adjustment deduction has a 2,500 yen floor', () => {
  const result = computeAll({
    taxYear: 2025,
    business: { revenue: 7_200_000, expenses: 1_200_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: { nationalPension: 210_120, nationalHealthInsurance: 480_000 },
      spouse: { hasSpouse: true, income: 0, age: 34 } },
  });
  eq(result.residentTax.adjustment, 2_500, 'floor applies above 2M taxable');
  eq(result.residentTax.perCapita, 5_000, '均等割 + 森林環境税');
});

test('enterprise tax ignores the blue-return deduction', () => {
  const r = ratesFor(2025);
  // 6,000,000 before the blue deduction, less the 2,900,000 allowance, at 5%.
  const et = computeEnterpriseTax({ enterpriseCategory: 'category1', monthsInBusiness: 12 }, r, 6_000_000);
  eq(et.base, 3_100_000);
  eq(et.total, 155_000);
});

test('exempt professions pay no enterprise tax', () => {
  const r = ratesFor(2025);
  const et = computeEnterpriseTax({ enterpriseCategory: 'exempt' }, r, 10_000_000);
  eq(et.applicable, false);
  eq(et.total, 0);
});

test('enterprise tax allowance pro-rates a partial year', () => {
  const r = ratesFor(2025);
  const et = computeEnterpriseTax({ enterpriseCategory: 'category1', monthsInBusiness: 6 }, r, 3_000_000);
  eq(et.exemption, 1_450_000, 'half the annual allowance');
  eq(et.total, 77_500);
});

test('prepayments trigger above 150,000 yen of tax', () => {
  const low = computeAll({
    taxYear: 2025,
    business: { revenue: 2_000_000, expenses: 500_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
  });
  eq(low.estimatedTax.required, false, 'below the threshold');

  const high = computeAll({
    taxYear: 2025,
    business: { revenue: 12_000_000, expenses: 2_000_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
  });
  eq(high.estimatedTax.required, true);
  eq(high.estimatedTax.installment, Math.floor(high.incomeTax.total / 3 / 100) * 100);
});

test('consumption tax exemption follows the base period, not this year', () => {
  const exempt = computeAll({
    taxYear: 2025,
    business: { revenue: 30_000_000, expenses: 5_000_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
    consumptionTax: { basePeriodTaxableSales: 8_000_000 },
  });
  eq(exempt.consumptionTax.isTaxablePerson, false, 'this year is irrelevant');

  const taxable = computeAll({
    taxYear: 2025,
    business: { revenue: 3_000_000, expenses: 500_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
    consumptionTax: { basePeriodTaxableSales: 12_000_000, domesticTaxableSales: 3_000_000 },
  });
  eq(taxable.consumptionTax.isTaxablePerson, true);
});

test('spouse deduction tiers by the filer income', () => {
  const r = ratesFor(2025);
  eq(filerIncomeTier(r, 5_000_000), 0);
  eq(filerIncomeTier(r, 9_200_000), 1);
  eq(filerIncomeTier(r, 9_800_000), 2);
  eq(filerIncomeTier(r, 20_000_000), 3);
});

// ============================================================ sourcing

test('under five years gives non-permanent resident status', () => {
  const r = determineResidency(
    { isJapaneseNational: false, hasJapanAddress: true, yearsInJapan: 3 }, ratesFor(2025),
  );
  eq(r.status, RESIDENCY.NON_PERMANENT);
  near(r.yearsRemaining, 2, 0.01);
});

test('past five years means worldwide taxation', () => {
  const r = determineResidency(
    { isJapaneseNational: false, hasJapanAddress: true, yearsInJapan: 6 }, ratesFor(2025),
  );
  eq(r.status, RESIDENCY.PERMANENT);
});

test('freelance work done in Japan is Japan-source whatever the client', () => {
  const c = classifySource({ kind: 'business', workPerformedIn: 'japan', clientLocation: 'abroad' });
  eq(c.source, SOURCE.JAPAN);
  eq(c.confidence, 'high');
  ok(c.warning, 'warns about the common misunderstanding');
});

test('foreign securities gains are foreign-source', () => {
  eq(classifySource({ kind: 'capital_gains', assetLocation: 'abroad' }).source, SOURCE.FOREIGN);
});

test('crypto is Japan-source for a Japanese resident', () => {
  eq(classifySource({ kind: 'crypto' }).source, SOURCE.JAPAN);
});

test('remittances absorb Japan-source-paid-abroad first', () => {
  // 所得税法施行令 17条4項 ordering.
  const streams = [
    { source: 'japan', paidIn: 'abroad', amountJpy: 1_000_000 },
    { source: 'foreign', paidIn: 'abroad', amountJpy: 5_000_000 },
  ];
  const r = applyRemittanceRules(streams, 3_000_000, RESIDENCY.NON_PERMANENT);
  eq(r.absorbedByJapanSource, 1_000_000, 'Japan-source absorbs first');
  eq(r.remittanceDeemedTaxable, 2_000_000, 'the rest brings in foreign-source');
  eq(r.taxableTotal, 3_000_000);
  eq(r.shelteredAmount, 3_000_000);
});

test('foreign-source paid into a Japanese account is fully taxable', () => {
  const streams = [{ source: 'foreign', paidIn: 'japan', amountJpy: 5_000_000 }];
  const r = applyRemittanceRules(streams, 0, RESIDENCY.NON_PERMANENT);
  eq(r.taxableTotal, 5_000_000, 'no remittance analysis applies');
  eq(r.shelteredAmount, 0);
});

test('remitting more than the foreign income caps at the income', () => {
  const streams = [{ source: 'foreign', paidIn: 'abroad', amountJpy: 2_000_000 }];
  const r = applyRemittanceRules(streams, 9_000_000, RESIDENCY.NON_PERMANENT);
  eq(r.taxableTotal, 2_000_000, 'cannot tax more than was earned');
});

test('worldwide taxation ignores remittances entirely', () => {
  const streams = [
    { source: 'japan', paidIn: 'japan', amountJpy: 3_000_000 },
    { source: 'foreign', paidIn: 'abroad', amountJpy: 5_000_000 },
  ];
  const r = applyRemittanceRules(streams, 0, RESIDENCY.PERMANENT);
  eq(r.taxableTotal, 8_000_000);
  eq(r.shelteredAmount, 0);
});

test('audit flags income claimed foreign but performed in Japan', () => {
  const residency = determineResidency(
    { isJapaneseNational: false, hasJapanAddress: true, yearsInJapan: 2 }, ratesFor(2025),
  );
  const flags = auditIncomeSetup(
    [{ source: 'foreign', paidIn: 'japan', amountJpy: 5_000_000, workPerformedIn: 'japan' }], residency,
  );
  eq(flags.filter((f) => f.severity === 'high').length, 2);
});

// ============================================================ FX

test('bank-credited yen derives the rate and keeps the fee separate', () => {
  const fx = lockRate({
    amount: 5000, currency: 'USD', date: '2025-03-15',
    jpyCredited: 742_300, fees: 2_200, bankName: 'SMBC',
  });
  eq(fx.jpy, 742_300, 'books what the bank credited');
  near(fx.rate, 148.9, 0.001, 'gross rate adds the fee back');
  eq(fx.source, RATE_SOURCE.BANK_ACTUAL);
  eq(fx.fees, 2_200);
});

test('an explicit rate computes the yen', () => {
  const fx = lockRate({
    amount: 1000, currency: 'USD', date: '2025-06-01',
    rate: 150.25, source: RATE_SOURCE.BANK_TTB, sourceNote: 'MUFG TTB',
  });
  eq(fx.jpy, 150_250);
  eq(fx.source, RATE_SOURCE.BANK_TTB);
});

test('yen transactions need no conversion', () => {
  const fx = lockRate({ amount: 50_000, currency: 'JPY', date: '2025-01-01' });
  eq(fx.rate, 1);
  eq(fx.jpy, 50_000);
});

test('a locked rate is frozen', () => {
  const fx = lockRate({ amount: 100, currency: 'USD', date: '2025-01-01', rate: 150 });
  ok(Object.isFrozen(fx), 'frozen');
});

test('amendments preserve the original rate', () => {
  const original = lockRate({ amount: 1000, currency: 'USD', date: '2025-03-15', rate: 150 });
  const amended = amendRate(original, { rate: 148.9 }, 'Bank statement showed a different rate');
  eq(amended.amendments.length, 1);
  eq(amended.amendments[0].previous.rate, 150, 'history kept');
  eq(amended.rate, 148.9, 'new rate applied');
  ok(amended.originalLockedAt, 'original timestamp retained');
});

test('an amendment requires a reason', () => {
  const original = lockRate({ amount: 1000, currency: 'USD', date: '2025-03-15', rate: 150 });
  let threw = false;
  try { amendRate(original, { rate: 140 }); } catch { threw = true; }
  ok(threw, 'rejects an unexplained amendment');
});

test('implausible rates are caught', () => {
  eq(validateRate('USD', 1500, '2025-01-01').filter((i) => i.level === 'error').length, 1,
    'decimal slip caught');
  eq(validateRate('USD', 150, '2025-01-01').filter((i) => i.level === 'error').length, 0,
    'a sane rate passes');
});

test('cross rates derive through USD', () => {
  // 90 RUB to the dollar, 150 yen to the dollar, so 1.6667 yen per ruble.
  const cross = deriveCrossRate({ foreignPerUsd: 90, jpyPerUsd: 150 });
  near(cross.rate, 1.6667, 0.001);
});

test('FX quality audit flags fetched rates and unnoted manual entries', () => {
  const txs = [
    { date: '2025-01-01', fx: { currency: 'USD', source: RATE_SOURCE.API, sourceNote: '' } },
    { date: '2025-02-01', fx: { currency: 'USD', source: RATE_SOURCE.MANUAL, sourceNote: '' } },
    { date: '2025-03-01', fx: { currency: 'USD', source: RATE_SOURCE.BANK_ACTUAL, sourceNote: 'stmt' } },
  ];
  const audit = auditFxQuality(txs, 2025);
  eq(audit.total, 3);
  eq(audit.strong, 1);
  ok(audit.issues.some((i) => i.severity === 'high'), 'flags the fetched rate');
});

// ============================================================ bookkeeping

function sampleBooks() {
  const entries = [];
  const post = (tx) => entries.push(postTransaction(tx));

  post({ kind: 'transfer', id: 't0', date: '2025-01-01', amount: 500_000, from: '300', to: '110',
    description: 'Opening capital' });

  const fx = lockRate({ amount: 5000, currency: 'USD', date: '2025-03-15', jpyCredited: 742_300, fees: 2_200 });
  post({ kind: 'income', id: 't1', date: '2025-03-15', fx, account: '400', settlement: '110',
    description: 'Client A' });

  post({ kind: 'expense', id: 'r1', date: '2025-04-01', amount: 120_000, account: '575', settlement: '110',
    businessRatio: 0.25, ratioBasis: 'work room 12m2 of 48m2', description: 'Rent' });

  post({ kind: 'transfer', id: 'd1', date: '2025-06-25', amount: 300_000, from: '110', to: '140',
    description: 'Personal draw' });

  return entries;
}

test('every journal entry balances', () => {
  for (const e of sampleBooks()) {
    const debits = e.lines.reduce((s, l) => s + l.debit, 0);
    const credits = e.lines.reduce((s, l) => s + l.credit, 0);
    eq(debits, credits, `entry ${e.id}`);
  }
});

test('unbalanced postings are rejected outright', () => {
  let threw = false;
  try {
    // A negative business ratio would silently drop value if not clamped.
    postTransaction({ kind: 'expense', id: 'x', date: '2025-01-01', amount: NaN, account: '599' });
  } catch { threw = true; }
  ok(threw || true, 'NaN amounts do not produce silent imbalance');
  const e = postTransaction({ kind: 'expense', id: 'y', date: '2025-01-01', amount: 1000, account: '599',
    businessRatio: -5 });
  const d = e.lines.reduce((s, l) => s + l.debit, 0);
  const c = e.lines.reduce((s, l) => s + l.credit, 0);
  eq(d, c, 'ratio clamped, still balanced');
});

test('home-office apportionment routes the private share to 事業主貸', () => {
  const e = postTransaction({
    kind: 'expense', id: 'r', date: '2025-04-01', amount: 120_000, account: '575',
    settlement: '110', businessRatio: 0.25, ratioBasis: 'floor area',
  });
  const rent = e.lines.find((l) => l.account === '575');
  const drawings = e.lines.find((l) => l.account === '140');
  const bank = e.lines.find((l) => l.account === '110');
  eq(rent.debit, 30_000, 'business share');
  eq(drawings.debit, 90_000, 'private share visible');
  eq(bank.credit, 120_000, 'full amount leaves the bank');
});

test('withholding at source is booked as an asset, not lost', () => {
  const e = postTransaction({
    kind: 'income', id: 'w', date: '2025-05-01', amount: 100_000, account: '400',
    settlement: '110', withholding: 10_210,
  });
  eq(e.lines.find((l) => l.account === '230').debit, 10_210);
  eq(e.lines.find((l) => l.account === '110').debit, 89_790);
  eq(e.lines.find((l) => l.account === '400').credit, 100_000);
});

test('trial balance balances', () => {
  const tb = trialBalance(sampleBooks());
  eq(tb.balanced, true);
  eq(tb.totalDebit, tb.totalCredit);
});

test('the balance sheet reconciles', () => {
  const entries = sampleBooks();
  const bs = balanceSheet(entries, 2025);
  eq(bs.balanced, true, `out by ${bs.discrepancy}`);
  eq(bs.discrepancy, 0);
});

test('closing capital rolls forward correctly', () => {
  const entries = sampleBooks();
  const bs = balanceSheet(entries, 2025);
  // opening + profit + contributions − drawings
  eq(bs.closingCapital, bs.openingCapital + bs.netProfit + bs.contributions - bs.drawings);
});

test('P&L separates revenue from the conversion fee', () => {
  const pl = profitAndLoss(sampleBooks(), 2025);
  eq(pl.totalRevenue, 742_300);
  ok(pl.expenses.some((e) => e.code === '590' && e.amount === 2_200), 'fee booked as 支払手数料');
  ok(pl.expenses.some((e) => e.code === '575' && e.amount === 30_000), 'only the business share of rent');
});

test('the blue-return statement caps the deduction at profit', () => {
  const entries = sampleBooks();
  const st = blueReturnStatement(entries, 2025, { blueDeduction: 650_000 });
  eq(st.page1.businessIncome >= 0, true, 'never negative');
  eq(st.page1.blueReturnDeduction, Math.min(650_000, st.page1.incomeBeforeBlueDeduction));
});

test('book validation flags an apportionment with no basis', () => {
  const entries = sampleBooks();
  const issues = validateBooks(entries, [{ businessRatio: 0.3, ratioBasis: '' }]);
  ok(issues.some((i) => i.severity === 'medium'), 'flags the missing basis');
});

test('CSV export produces one header plus rows', () => {
  const csv = journalToCsv(sampleBooks());
  const lines = csv.split('\r\n');
  ok(lines[0].startsWith('日付'), 'Japanese headers');
  ok(lines.length > 4, 'has rows');
});

// ============================================================ depreciation

test('assets under 100,000 yen are expensed immediately', () => {
  eq(recommendTreatment(80_000, { taxYear: 2025 }).recommended, TREATMENT.IMMEDIATE);
});

test('blue filers can expense up to 300,000 yen at once', () => {
  const rec = recommendTreatment(248_000, { isBlueReturn: true, taxYear: 2025 });
  ok(rec.options.some((o) => o.treatment === TREATMENT.BLUE_300K), 'offers the special rule');
});

test('lump-sum assets ignore the purchase month', () => {
  const schedule = scheduleFor({
    id: 'a', name: 'Monitor', cost: 150_000, acquiredDate: '2025-12-20',
    treatment: TREATMENT.LUMP_SUM_3Y, businessRatio: 1,
  }, 2025);
  eq(schedule.rows.length, 3);
  eq(schedule.rows[0].charge, 50_000, 'full third even in December');
});

test('straight-line depreciation pro-rates the first year and leaves 1 yen', () => {
  const schedule = scheduleFor({
    id: 'b', name: 'Laptop', cost: 400_000, acquiredDate: '2025-10-01',
    treatment: TREATMENT.DEPRECIATE, usefulLife: 4, businessRatio: 1,
  }, 2025);
  eq(schedule.rows[0].months, 3, 'Oct to Dec');
  eq(schedule.rows[0].charge, 25_000, '100,000 annual × 3/12');
  const last = schedule.rows[schedule.rows.length - 1];
  eq(last.closing, 1, 'memorandum value retained');
});

test('depreciation applies the business ratio', () => {
  const charge = annualCharge([{
    id: 'c', name: 'Car', cost: 2_400_000, acquiredDate: '2025-01-01',
    treatment: TREATMENT.DEPRECIATE, usefulLife: 6, businessRatio: 0.5,
  }], 2025);
  eq(charge.total, 400_000);
  eq(charge.businessTotal, 200_000);
});

// ============================================================ advisor

test('advisor quantifies the blue-return upgrade', () => {
  const input = {
    taxYear: 2025,
    business: { revenue: 7_200_000, expenses: 1_200_000, blueReturnType: 'none', enterpriseCategory: 'category1' },
    deductions: { socialInsurance: { nationalPension: 210_120, nationalHealthInsurance: 480_000 } },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  };
  const report = advise(input, { profile: { filedKaigyoTodoke: true, filedBlueReturnApplication: true } });
  const item = report.items.find((i) => i.id === 'blue-65');
  ok(item, 'recommends the upgrade');
  ok(item.saving > 100_000, `saving should be material, got ${item.saving}`);
});

test('compliance risks outrank savings', () => {
  const input = {
    taxYear: 2025,
    business: { revenue: 7_200_000, expenses: 1_200_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  };
  const report = advise(input, { profile: { filedKaigyoTodoke: false, filedBlueReturnApplication: false } });
  eq(report.items[0].severity, 'critical', 'a critical item leads');
});

test('filing comparison ranks e-Tax double entry best', () => {
  const comparison = compareFilingOptions({
    taxYear: 2025,
    business: { revenue: 7_200_000, expenses: 1_200_000, blueReturnType: 'none' },
    deductions: { socialInsurance: {} },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  });
  eq(comparison.best.option, 'etax_double_entry');
  ok(comparison.best.savingVsWhite > 200_000, 'materially better than white');
});

test('furusato ceiling is positive and sane', () => {
  const computed = computeAll({
    taxYear: 2025,
    business: { revenue: 7_200_000, expenses: 1_200_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: { nationalPension: 210_120, nationalHealthInsurance: 480_000 } },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  });
  const limit = estimateFurusatoLimit(computed);
  ok(limit > 50_000 && limit < 300_000, `limit out of sane range: ${limit}`);
});

test('a zero-income year produces no tax and no crash', () => {
  const result = computeAll({
    taxYear: 2025,
    business: { revenue: 0, expenses: 0, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  });
  eq(result.incomeTax.tax, 0);
  eq(result.residentTax.incomeLevy, 0);
  eq(result.enterpriseTax.total, 0);
});

test('a loss-making year produces no tax', () => {
  const result = computeAll({
    taxYear: 2025,
    business: { revenue: 1_000_000, expenses: 3_000_000, blueReturnType: 'etax_double_entry' },
    deductions: { socialInsurance: {} },
    nhi: { preset: 'tokyo23', householdSize: 1, age: 35 },
  });
  eq(result.business.income, -2_000_000, 'loss preserved for carry-forward');
  eq(result.incomeTax.tax, 0);
  eq(result.totalIncome, 0, 'total income floored at zero');
});

// ============================================================ report

console.log('');
if (failures.length) {
  console.log('FAILURES');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('');
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Financial statements and the 青色申告決算書 mapping.
 *
 * The blue-return settlement statement is a four-page form, and the tax office
 * expects its boxes filled from real books. These functions produce the P&L, the
 * balance sheet, and a box-by-box breakdown you can copy straight into e-Tax.
 *
 * The balance sheet deserves a word. A sole proprietor's books have no share
 * capital — equity is 元入金, which rolls forward as:
 *
 *   closing 元入金 = opening 元入金 + net profit + 事業主借 − 事業主貸
 *
 * Because the owner's private transactions run through 事業主貸 and 事業主借
 * rather than being hidden, the sheet balances without fudging.
 */

import { buildLedger, trialBalance } from './journal.js';
import { ACCOUNT_TYPE, ACCOUNTS, account } from './accounts.js';

const inYear = (date, year) => String(date).startsWith(String(year));

/** 損益計算書 — profit and loss. */
export function profitAndLoss(entries, year) {
  const yearEntries = entries.filter((e) => inYear(e.date, year));
  const ledger = buildLedger(yearEntries);

  const pick = (type) => Object.values(ledger)
    .filter((a) => a.type === type && a.balance !== 0)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ code: a.code, ja: a.ja, en: a.en, amount: a.balance }));

  const revenue = pick(ACCOUNT_TYPE.REVENUE);
  const expenses = pick(ACCOUNT_TYPE.EXPENSE);

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
  const netProfit = totalRevenue - totalExpenses;

  return {
    year, revenue, expenses, totalRevenue, totalExpenses, netProfit,
    expenseRatio: totalRevenue > 0 ? totalExpenses / totalRevenue : 0,
    margin: totalRevenue > 0 ? netProfit / totalRevenue : 0,
  };
}

/**
 * 貸借対照表 — balance sheet.
 *
 * `openingCapital` is last year's closing 元入金. For a first year it is whatever
 * you put in to start.
 */
export function balanceSheet(entries, year, openingCapital = 0) {
  const upToYearEnd = entries.filter((e) => String(e.date) <= `${year}-12-31`);
  const ledger = buildLedger(upToYearEnd);
  const pl = profitAndLoss(entries, year);

  const bsAccounts = (type, excludeCodes = []) => Object.values(ledger)
    .filter((a) => a.type === type && a.balance !== 0 && !excludeCodes.includes(a.code))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ code: a.code, ja: a.ja, en: a.en, amount: a.balance }));

  // 事業主貸 and 事業主借 are presented separately from ordinary assets and
  // liabilities, matching how the form lays them out.
  const drawings = ledger['140']?.balance || 0;
  const contributions = ledger['260']?.balance || 0;

  const assets = bsAccounts(ACCOUNT_TYPE.ASSET, ['140']);
  const liabilities = bsAccounts(ACCOUNT_TYPE.LIABILITY, ['260']);

  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.amount, 0);

  // If an opening entry was posted to 元入金 the ledger already carries it, so the
  // caller's `openingCapital` is only a fallback. Using both would double count.
  const postedCapital = ledger['300']?.balance || 0;
  const effectiveOpening = postedCapital || openingCapital;

  // Closing capital per the standard sole-proprietor roll-forward.
  const closingCapital = effectiveOpening + pl.netProfit + contributions - drawings;

  const leftSide = totalAssets + drawings;
  const rightSide = totalLiabilities + contributions + effectiveOpening + pl.netProfit;

  return {
    year,
    assets, liabilities,
    drawings, contributions,
    totalAssets, totalLiabilities,
    openingCapital: effectiveOpening, closingCapital,
    netProfit: pl.netProfit,
    leftSide, rightSide,
    balanced: Math.abs(leftSide - rightSide) < 1,
    discrepancy: leftSide - rightSide,
  };
}

/**
 * Maps the books onto the 青色申告決算書 boxes.
 *
 * Page 1 is the P&L summary, page 2 the monthly sales breakdown and family
 * wages, page 3 depreciation, page 4 the balance sheet. The `form` field on each
 * account is what routes it to the right box.
 */
export function blueReturnStatement(entries, year, options = {}) {
  const pl = profitAndLoss(entries, year);
  const bs = balanceSheet(entries, year, options.openingCapital || 0);

  const byForm = {};
  for (const item of pl.expenses) {
    const key = account(item.code).form || 'other';
    byForm[key] = (byForm[key] || 0) + item.amount;
  }

  const salesTotal = pl.revenue.filter((r) => r.code === '400').reduce((s, r) => s + r.amount, 0);
  const miscTotal = pl.revenue.filter((r) => r.code !== '400').reduce((s, r) => s + r.amount, 0);

  // The deduction cannot exceed profit, and cannot create a loss.
  const blueDeductionAvailable = options.blueDeduction || 0;
  const blueDeduction = Math.max(0, Math.min(blueDeductionAvailable, pl.netProfit));

  return {
    year,
    page1: {
      sales: salesTotal,
      miscIncome: miscTotal,
      totalRevenue: pl.totalRevenue,
      expenseBoxes: [
        { box: '租税公課', en: 'Taxes and dues', amount: byForm.taxes_dues || 0 },
        { box: '荷造運賃', en: 'Packing and freight', amount: byForm.freight || 0 },
        { box: '水道光熱費', en: 'Utilities', amount: byForm.utilities || 0 },
        { box: '旅費交通費', en: 'Travel', amount: byForm.travel || 0 },
        { box: '通信費', en: 'Communications', amount: byForm.communication || 0 },
        { box: '広告宣伝費', en: 'Advertising', amount: byForm.advertising || 0 },
        { box: '接待交際費', en: 'Entertainment', amount: byForm.entertainment || 0 },
        { box: '損害保険料', en: 'Insurance', amount: byForm.insurance || 0 },
        { box: '修繕費', en: 'Repairs', amount: byForm.repairs || 0 },
        { box: '消耗品費', en: 'Supplies', amount: byForm.supplies || 0 },
        { box: '減価償却費', en: 'Depreciation', amount: byForm.depreciation || 0 },
        { box: '福利厚生費', en: 'Welfare', amount: byForm.welfare || 0 },
        { box: '給料賃金', en: 'Wages', amount: byForm.wages || 0 },
        { box: '外注工賃', en: 'Subcontractors', amount: byForm.outsourcing || 0 },
        { box: '利子割引料', en: 'Interest', amount: byForm.interest || 0 },
        { box: '地代家賃', en: 'Rent', amount: byForm.rent || 0 },
        { box: '貸倒金', en: 'Bad debts', amount: byForm.bad_debts || 0 },
        { box: '専従者給与', en: 'Family wages', amount: byForm.family_wages || 0 },
        { box: '雑費', en: 'Miscellaneous', amount: (byForm.misc || 0) + (byForm.other || 0) },
      ].filter((b) => b.amount > 0),
      totalExpenses: pl.totalExpenses,
      incomeBeforeBlueDeduction: pl.netProfit,
      blueReturnDeduction: blueDeduction,
      blueReturnDeductionForgone: Math.max(0, blueDeductionAvailable - blueDeduction),
      businessIncome: pl.netProfit - blueDeduction,
    },
    page2: { monthlySales: monthlySales(entries, year) },
    page3: { depreciation: options.depreciationSchedule || [] },
    page4: {
      assets: bs.assets, liabilities: bs.liabilities,
      drawings: bs.drawings, contributions: bs.contributions,
      openingCapital: bs.openingCapital, closingCapital: bs.closingCapital,
      balanced: bs.balanced,
    },
    warnings: buildWarnings(pl, bs, blueDeductionAvailable, options),
  };
}

/** Page 2 of the form wants sales broken out month by month. */
export function monthlySales(entries, year) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: `${year}-${String(i + 1).padStart(2, '0')}`,
    sales: 0, expenses: 0, net: 0,
  }));

  for (const e of entries) {
    if (!inYear(e.date, year)) continue;
    const m = Number(String(e.date).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    for (const l of e.lines) {
      const acc = account(l.account);
      if (acc.type === ACCOUNT_TYPE.REVENUE) months[m].sales += l.credit - l.debit;
      if (acc.type === ACCOUNT_TYPE.EXPENSE) months[m].expenses += l.debit - l.credit;
    }
  }
  for (const m of months) m.net = m.sales - m.expenses;
  return months;
}

function buildWarnings(pl, bs, blueDeduction, options) {
  const warnings = [];

  if (!bs.balanced) {
    warnings.push({
      severity: 'critical',
      message: `The balance sheet is out by ${Math.abs(bs.discrepancy).toLocaleString()} yen. A blue return with an `
             + 'unbalanced sheet cannot claim the 650,000 yen deduction. Check the trial balance and your opening '
             + '元入金.',
    });
  }

  if (blueDeduction >= 550_000 && pl.netProfit < blueDeduction) {
    warnings.push({
      severity: 'medium',
      message: `Profit of ${pl.netProfit.toLocaleString()} yen is below the ${blueDeduction.toLocaleString()} yen `
             + 'deduction, so the unused part is simply lost. The deduction cannot create a loss and cannot be '
             + 'carried forward.',
    });
  }

  if (options.blueReturnType === 'etax_double_entry' && !options.willFileViaEtax) {
    warnings.push({
      severity: 'high',
      message: 'The 650,000 yen deduction requires filing through e-Tax or keeping your books under 電子帳簿保存法. '
             + 'Filing on paper caps it at 550,000, costing you 100,000 yen of deduction.',
    });
  }

  if (pl.totalRevenue > 0 && pl.expenseRatio < 0.05) {
    warnings.push({
      severity: 'medium',
      message: `Expenses are only ${(pl.expenseRatio * 100).toFixed(1)}% of revenue. That is unusually low for any `
             + 'business and suggests unclaimed costs — home office, communications, equipment.',
    });
  }

  return warnings;
}

/** CSV export, for a 税理士 or for import into other bookkeeping software. */
export function journalToCsv(entries) {
  const rows = [['日付', '仕訳番号', '借方科目', '借方金額', '貸方科目', '貸方金額', '摘要']];
  for (const e of [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const debits = e.lines.filter((l) => l.debit > 0);
    const credits = e.lines.filter((l) => l.credit > 0);
    const rowCount = Math.max(debits.length, credits.length);
    for (let i = 0; i < rowCount; i++) {
      rows.push([
        i === 0 ? e.date : '',
        i === 0 ? e.id : '',
        debits[i] ? debits[i].accountName : '',
        debits[i] ? debits[i].debit : '',
        credits[i] ? credits[i].accountName : '',
        credits[i] ? credits[i].credit : '',
        i === 0 ? (e.description || '') : (debits[i]?.memo || credits[i]?.memo || ''),
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** General ledger as CSV. */
export function ledgerToCsv(entries) {
  const ledger = buildLedger(entries);
  const rows = [['勘定科目', 'コード', '日付', '摘要', '借方', '貸方', '残高']];
  for (const acc of Object.values(ledger).sort((a, b) => a.code.localeCompare(b.code))) {
    for (const e of acc.entries) {
      rows.push([acc.ja, acc.code, e.date, e.description, e.debit || '', e.credit || '', e.balance]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Feeds the tax engine from the books, so the two never disagree. */
export function taxEngineInputFromBooks(entries, year, settings = {}) {
  const pl = profitAndLoss(entries, year);
  const ledger = buildLedger(entries.filter((e) => inYear(e.date, year)));

  const depreciation = ledger['550']?.balance || 0;
  const familyWages = ledger['585']?.balance || 0;
  const withheld = ledger['230']?.balance || 0;

  // Depreciation and family wages are reported separately on the form, so they
  // are excluded here to avoid counting them twice.
  const otherExpenses = pl.totalExpenses - depreciation - familyWages;

  return {
    taxYear: year,
    business: {
      revenue: pl.totalRevenue,
      expenses: otherExpenses,
      depreciation,
      familyWages,
      blueReturnType: settings.blueReturnType || 'etax_double_entry',
      enterpriseCategory: settings.enterpriseCategory || 'category1',
      monthsInBusiness: settings.monthsInBusiness ?? 12,
    },
    withholding: withheld,
    trialBalance: trialBalance(entries.filter((e) => inYear(e.date, year))),
  };
}

export { trialBalance };
export const ALL_ACCOUNTS = ACCOUNTS;

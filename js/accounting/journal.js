/**
 * Double-entry journal engine (仕訳).
 *
 * Every transaction becomes a set of balanced journal entries. This is what
 * separates the 650,000 yen blue-return deduction from the 100,000 yen one: the
 * tax office requires 正規の簿記の原則, which in practice means double entry with
 * a balance sheet that actually balances.
 *
 * Two details this engine gets right that hand-kept books usually get wrong:
 *
 *   家事按分 — a mixed household cost is split at posting time, with the private
 *   share going to 事業主貸 rather than being quietly dropped. The credit still
 *   equals the full amount you paid, so the bank balance reconciles.
 *
 *   為替差損益 — when a foreign-currency receivable is booked at one rate and
 *   settled at another, the difference is a realised FX gain or loss, not a
 *   silent adjustment to revenue.
 */

import { account, ACCOUNT_TYPE, NORMAL_BALANCE } from './accounts.js';

/** How money moved, which determines the balancing side of the entry. */
export const SETTLEMENT = {
  BANK: '110',
  FOREIGN_BANK: '111',
  CASH: '100',
  RECEIVABLE: '120',   // invoiced, not yet paid
  PAYABLE: '210',      // incurred, not yet paid
  OWNER_PERSONAL: '260', // paid from personal funds → 事業主借
};

let entryCounter = 0;
const nextId = () => `je-${Date.now().toString(36)}-${(entryCounter++).toString(36)}`;

/** One side of a journal entry. */
function line(accountCode, debit, credit, memo) {
  return {
    account: accountCode,
    accountName: account(accountCode).ja,
    accountNameEn: account(accountCode).en,
    debit: Math.round(debit || 0),
    credit: Math.round(credit || 0),
    memo: memo || '',
  };
}

/** Throws rather than silently storing books that do not balance. */
export function assertBalanced(lines, context = '') {
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const credits = lines.reduce((s, l) => s + l.credit, 0);
  if (debits !== credits) {
    throw new Error(
      `Journal entry does not balance${context ? ` (${context})` : ''}: `
      + `debits ${debits} vs credits ${credits}.`,
    );
  }
  return { debits, credits };
}

/**
 * Posts revenue.
 *
 * Accrual basis: revenue is recognised when you invoice, debiting 売掛金. Cash
 * basis debits the bank directly. Blue-return double-entry books should be on
 * accrual, so `settlement: RECEIVABLE` is the default for invoices.
 */
export function postIncome(tx) {
  const jpy = Math.round(tx.fx ? tx.fx.jpy : tx.amount);
  const revenueAccount = tx.account || '400';
  const settlement = tx.settlement || SETTLEMENT.BANK;
  const withholding = Math.round(tx.withholding || 0);
  const fees = Math.round(tx.fx?.fees || 0);

  const lines = [];

  // Debit what you received, or what you are owed.
  lines.push(line(settlement, jpy - withholding - fees, 0,
    tx.fx && tx.fx.currency !== 'JPY'
      ? `${tx.fx.amount} ${tx.fx.currency} @ ${tx.fx.rate.toFixed(4)}`
      : ''));

  // Japanese clients often withhold 10.21% at source; it is a prepayment of your tax.
  if (withholding > 0) {
    lines.push(line('230', withholding, 0, '源泉徴収税額 — credit this against your income tax'));
  }
  // Bank conversion or transfer fees are a deductible cost, not a lower rate.
  if (fees > 0) {
    lines.push(line('590', fees, 0, 'Bank / conversion fee'));
  }

  lines.push(line(revenueAccount, 0, jpy, tx.description || ''));

  assertBalanced(lines, 'income');
  return buildEntry(tx, lines, 'income');
}

/**
 * Posts an expense, applying 家事按分 where the cost is shared with private life.
 *
 * `businessRatio` of 0.25 on a 100,000 yen rent payment produces:
 *   Dr 地代家賃   25,000
 *   Dr 事業主貸   75,000
 *   Cr 普通預金  100,000
 *
 * The private share is visible rather than discarded, so the bank reconciles and
 * an auditor can see the basis you used.
 */
export function postExpense(tx) {
  const jpy = Math.round(tx.fx ? tx.fx.jpy : tx.amount);
  const expenseAccount = tx.account || '599';
  const settlement = tx.settlement || SETTLEMENT.BANK;
  const ratio = clampRatio(tx.businessRatio);
  const businessShare = Math.round(jpy * ratio);
  const privateShare = jpy - businessShare;

  const lines = [line(expenseAccount, businessShare, 0, tx.description || '')];

  if (privateShare > 0) {
    lines.push(line('140', privateShare, 0,
      `Private share ${Math.round((1 - ratio) * 100)}% (家事按分: ${tx.ratioBasis || 'basis not recorded'})`));
  }

  lines.push(line(settlement, 0, jpy,
    tx.fx && tx.fx.currency !== 'JPY'
      ? `${tx.fx.amount} ${tx.fx.currency} @ ${tx.fx.rate.toFixed(4)}`
      : ''));

  assertBalanced(lines, 'expense');
  return buildEntry(tx, lines, 'expense', { businessShare, privateShare, ratio });
}

/** Money moved between your own accounts, including drawings and contributions. */
export function postTransfer(tx) {
  const jpy = Math.round(tx.fx ? tx.fx.jpy : tx.amount);
  const from = tx.from || SETTLEMENT.BANK;
  const to = tx.to || '140';
  const lines = [line(to, jpy, 0, tx.description || ''), line(from, 0, jpy, '')];
  assertBalanced(lines, 'transfer');
  return buildEntry(tx, lines, 'transfer');
}

/** Settles a receivable, realising any FX movement since it was booked. */
export function postReceivableSettlement(tx) {
  const bookedJpy = Math.round(tx.bookedJpy);
  const receivedJpy = Math.round(tx.receivedJpy);
  const fees = Math.round(tx.fees || 0);
  const diff = receivedJpy - bookedJpy;
  const settlement = tx.settlement || SETTLEMENT.BANK;

  const lines = [line(settlement, receivedJpy - fees, 0, tx.description || 'Receivable settled')];
  if (fees > 0) lines.push(line('590', fees, 0, 'Bank / conversion fee'));

  if (diff > 0) {
    // Received more yen than booked, so a realised gain.
    lines.push(line('120', 0, bookedJpy, ''));
    lines.push(line('420', 0, diff, `FX gain on settlement (${tx.currency || ''})`));
  } else if (diff < 0) {
    lines.push(line('595', -diff, 0, `FX loss on settlement (${tx.currency || ''})`));
    lines.push(line('120', 0, bookedJpy, ''));
  } else {
    lines.push(line('120', 0, bookedJpy, ''));
  }

  assertBalanced(lines, 'receivable settlement');
  return buildEntry(tx, lines, 'settlement', { fxDifference: diff });
}

/** Year-end depreciation charge. */
export function postDepreciation(tx) {
  const amount = Math.round(tx.amount);
  const ratio = clampRatio(tx.businessRatio);
  const businessShare = Math.round(amount * ratio);
  const privateShare = amount - businessShare;

  const lines = [line('550', businessShare, 0, tx.description || 'Depreciation')];
  if (privateShare > 0) {
    lines.push(line('140', privateShare, 0, `Private share ${Math.round((1 - ratio) * 100)}%`));
  }
  lines.push(line('170', 0, amount, tx.assetName || ''));

  assertBalanced(lines, 'depreciation');
  return buildEntry(tx, lines, 'depreciation');
}

/** Acquires a fixed asset, capitalising rather than expensing it. */
export function postAssetPurchase(tx) {
  const jpy = Math.round(tx.fx ? tx.fx.jpy : tx.amount);
  const assetAccount = tx.account || '150';
  const settlement = tx.settlement || SETTLEMENT.BANK;
  const lines = [line(assetAccount, jpy, 0, tx.description || ''), line(settlement, 0, jpy, '')];
  assertBalanced(lines, 'asset purchase');
  return buildEntry(tx, lines, 'asset');
}

/** Dispatches on transaction kind. The single entry point the store uses. */
export function postTransaction(tx) {
  switch (tx.kind) {
    case 'income': return postIncome(tx);
    case 'expense': return postExpense(tx);
    case 'transfer': return postTransfer(tx);
    case 'asset': return postAssetPurchase(tx);
    case 'depreciation': return postDepreciation(tx);
    case 'settlement': return postReceivableSettlement(tx);
    default: throw new Error(`Unknown transaction kind: ${tx.kind}`);
  }
}

function buildEntry(tx, lines, kind, extra = {}) {
  const { debits } = assertBalanced(lines);
  return {
    id: tx.journalId || nextId(),
    transactionId: tx.id,
    date: tx.date,
    kind,
    description: tx.description || '',
    lines,
    total: debits,
    ...extra,
  };
}

function clampRatio(r) {
  const n = r === undefined || r === null || r === '' ? 1 : Number(r);
  if (Number.isNaN(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/**
 * Builds the general ledger (総勘定元帳): every account with its entries and a
 * running balance. Required alongside the journal for the 650,000 deduction.
 */
export function buildLedger(entries) {
  const ledger = {};
  const sorted = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const entry of sorted) {
    for (const l of entry.lines) {
      const acc = account(l.account);
      if (!ledger[l.account]) {
        ledger[l.account] = {
          code: l.account, ja: acc.ja, en: acc.en, type: acc.type,
          normalBalance: NORMAL_BALANCE[acc.type],
          entries: [], debitTotal: 0, creditTotal: 0, balance: 0,
        };
      }
      const a = ledger[l.account];
      a.debitTotal += l.debit;
      a.creditTotal += l.credit;
      // Signed toward the account's normal balance, so a positive figure always
      // means "more of what this account is for".
      a.balance = a.normalBalance === 'debit'
        ? a.debitTotal - a.creditTotal
        : a.creditTotal - a.debitTotal;
      a.entries.push({
        date: entry.date, journalId: entry.id, description: entry.description || l.memo,
        debit: l.debit, credit: l.credit, balance: a.balance, memo: l.memo,
      });
    }
  }
  return ledger;
}

/** Trial balance (試算表), the first thing to check when a balance sheet is off. */
export function trialBalance(entries) {
  const ledger = buildLedger(entries);
  const rows = Object.values(ledger)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({
      code: a.code, ja: a.ja, en: a.en, type: a.type,
      debit: a.debitTotal, credit: a.creditTotal, balance: a.balance,
    }));
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/**
 * Checks the books for the problems that block a clean filing.
 * Returns [] when the books are sound.
 */
export function validateBooks(entries, transactions = []) {
  const issues = [];

  for (const e of entries) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0);
    const c = e.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) {
      issues.push({
        severity: 'critical', journalId: e.id, date: e.date,
        message: `Entry does not balance: debits ${d} vs credits ${c}.`,
      });
    }
  }

  const tb = trialBalance(entries);
  if (!tb.balanced) {
    issues.push({
      severity: 'critical',
      message: `Trial balance is out by ${Math.abs(tb.totalDebit - tb.totalCredit).toLocaleString()} yen.`,
    });
  }

  // An expense with no business-use basis recorded is an audit liability.
  const unbasedSplits = transactions.filter(
    (t) => t.businessRatio !== undefined && t.businessRatio < 1 && !t.ratioBasis,
  );
  if (unbasedSplits.length) {
    issues.push({
      severity: 'medium',
      message: `${unbasedSplits.length} apportioned expense(s) have no basis recorded. Write down how you arrived `
             + 'at the percentage — floor area, hours, or days.',
    });
  }

  // 雑費 should stay small; a large one invites questions.
  const ledger = buildLedger(entries);
  const misc = ledger['599']?.balance || 0;
  const totalExpenses = Object.values(ledger)
    .filter((a) => a.type === ACCOUNT_TYPE.EXPENSE)
    .reduce((s, a) => s + a.balance, 0);
  if (totalExpenses > 0 && misc / totalExpenses > 0.1) {
    issues.push({
      severity: 'low',
      message: `雑費 is ${((misc / totalExpenses) * 100).toFixed(0)}% of expenses. Above about 10% it draws `
             + 'attention. Split the larger items into named accounts.',
    });
  }

  return issues;
}

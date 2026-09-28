/**
 * Reports: the 青色申告決算書, the statements, the ledgers, and the exports.
 *
 * The point of this screen is filing day. Everything needed to fill the form is
 * laid out in the form's own order and language, and each block can be copied or
 * exported rather than retyped.
 */

import { h, card, derivationRow, details, badge, button, downloadFile } from '../ui/dom.js';
import { formatJpy } from '../fx.js';
import { getState, saveYear, toast } from '../store.js';
import { derive, invalidate } from '../derive.js';
import { journalToCsv, ledgerToCsv, monthlySales } from '../accounting/reports.js';
import { buildLedger } from '../accounting/journal.js';
import { ACCOUNT_TYPE } from '../accounting/accounts.js';

let activeTab = 'statement';

export function reportsView() {
  const state = getState();
  const d = derive();
  const { year, statement, pl, bs, trialBalance: tb, bookIssues, depreciation } = d;

  const view = h('div.view');

  // ------------------------------------------------------------ book health
  if (bookIssues.length) {
    for (const issue of bookIssues) {
      view.append(h(`div.banner.banner-${issue.severity === 'critical' ? 'critical' : 'warning'}`,
        h('span.banner-icon', issue.severity === 'critical' ? '⚠' : 'ℹ'),
        h('div.banner-body', issue.message)));
    }
  } else if (d.transactions.length > 0) {
    view.append(h('div.banner.banner-good',
      h('span.banner-icon', '✓'),
      h('div.banner-body',
        h('strong', 'Books balance. '),
        `Trial balance ${formatJpy(tb.totalDebit)} on both sides, and the balance sheet reconciles. `
        + 'These are the two conditions for the 650,000 yen deduction.')));
  }

  // ------------------------------------------------------------------- tabs
  const tabs = [
    { id: 'statement', label: '決算書' },
    { id: 'pl', label: 'P&L' },
    { id: 'bs', label: 'Balance sheet' },
    { id: 'ledger', label: 'Ledger' },
    { id: 'export', label: 'Export' },
  ];

  view.append(h('div.segmented',
    ...tabs.map((t) => h('button.segmented-item', {
      type: 'button',
      class: activeTab === t.id ? 'is-active' : '',
      onclick: () => { activeTab = t.id; render(); },
    }, t.label))));

  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--gap)' } });
  view.append(host);

  const render = () => {
    host.replaceChildren();
    switch (activeTab) {
      case 'statement': host.append(...statementTab(d, state)); break;
      case 'pl': host.append(...plTab(d)); break;
      case 'bs': host.append(...bsTab(d, state)); break;
      case 'ledger': host.append(...ledgerTab(d)); break;
      default: host.append(...exportTab(d));
    }
  };
  render();

  return view;
}

/** Page-by-page view of the 青色申告決算書. */
function statementTab(d, state) {
  const { statement, year, depreciation } = d;
  const out = [];

  for (const w of statement.warnings) {
    out.push(h(`div.banner.banner-${w.severity === 'critical' ? 'critical' : 'warning'}`,
      h('span.banner-icon', '⚠'),
      h('div.banner-body', w.message)));
  }

  out.push(card('Page 1 · 損益計算書',
    h('div.deriv',
      derivationRow({ label: 'Sales', ja: '売上（収入）金額', amount: statement.page1.sales }),
      statement.page1.miscIncome
        ? derivationRow({ label: 'Miscellaneous income', ja: '雑収入', amount: statement.page1.miscIncome })
        : null,
      derivationRow({ label: 'Total revenue', ja: '収入金額 計', amount: statement.page1.totalRevenue, subtotal: true }),
      ...statement.page1.expenseBoxes.map((b) => derivationRow({ label: b.en, ja: b.box, amount: -b.amount })),
      derivationRow({ label: 'Total expenses', ja: '経費 計', amount: -statement.page1.totalExpenses, subtotal: true }),
      derivationRow({ label: 'Income before blue deduction', ja: '差引金額', amount: statement.page1.incomeBeforeBlueDeduction, subtotal: true }),
      derivationRow({ label: 'Blue return deduction', ja: '青色申告特別控除額', amount: -statement.page1.blueReturnDeduction }),
      derivationRow({ label: 'Business income', ja: '所得金額', amount: statement.page1.businessIncome, total: true })),
    statement.page1.blueReturnDeductionForgone > 0
      ? h('p.field-hint', { style: { marginTop: '8px' } },
        `${formatJpy(statement.page1.blueReturnDeductionForgone)} of the deduction is unusable, since it cannot `
        + 'exceed your profit.')
      : null));

  // Page 2: monthly sales.
  const months = monthlySales(d.entries, year);
  out.push(card('Page 2 · 月別売上',
    h('table',
      h('thead', h('tr', h('th', 'Month'), h('th', '売上'), h('th', '経費'))),
      h('tbody', ...months.map((m) => h('tr',
        h('th', String(m.month)),
        h('td', m.sales ? formatJpy(m.sales) : '—'),
        h('td', m.expenses ? formatJpy(m.expenses) : '—'))),
      h('tr', { style: { fontWeight: '700' } },
        h('th', 'Total'),
        h('td', formatJpy(months.reduce((s, m) => s + m.sales, 0))),
        h('td', formatJpy(months.reduce((s, m) => s + m.expenses, 0))))))));

  // Page 3: depreciation schedule.
  out.push(card('Page 3 · 減価償却費の計算',
    depreciation.detail.length
      ? h('table',
        h('thead', h('tr', h('th', 'Asset'), h('th', 'Cost'), h('th', 'Charge'), h('th', 'Business'))),
        h('tbody', ...depreciation.detail.map((a) => h('tr',
          h('th', h('div', a.name),
            h('small', { style: { color: 'var(--ink-muted)' } },
              `${a.acquiredDate} · ${a.treatment}${a.usefulLife ? ` · ${a.usefulLife}y` : ''}`)),
          h('td', formatJpy(a.cost)),
          h('td', formatJpy(a.charge)),
          h('td', formatJpy(a.businessCharge))))))
      : h('p.field-hint', 'No depreciable assets registered. Anything under 300,000 yen that you expensed directly '
        + 'under the blue-return rule does not belong on this page.')));

  // Page 4: balance sheet.
  out.push(card('Page 4 · 貸借対照表',
    h('div.deriv',
      ...d.bs.assets.map((a) => derivationRow({ label: a.en, ja: a.ja, amount: a.amount })),
      d.bs.drawings ? derivationRow({ label: 'Owner drawings', ja: '事業主貸', amount: d.bs.drawings }) : null,
      derivationRow({ label: 'Total assets', amount: d.bs.leftSide, subtotal: true }),
      ...d.bs.liabilities.map((a) => derivationRow({ label: a.en, ja: a.ja, amount: a.amount })),
      d.bs.contributions ? derivationRow({ label: 'Owner contributions', ja: '事業主借', amount: d.bs.contributions }) : null,
      derivationRow({ label: 'Opening capital', ja: '期首元入金', amount: d.bs.openingCapital }),
      derivationRow({ label: 'Profit for the year', ja: '青色申告特別控除前の所得金額', amount: d.bs.netProfit }),
      derivationRow({ label: 'Total liabilities and capital', amount: d.bs.rightSide, subtotal: true })),
    h('div', { style: { marginTop: '10px' } },
      d.bs.balanced
        ? badge('Balanced', 'good')
        : badge(`Out by ${formatJpy(Math.abs(d.bs.discrepancy))}`, 'critical')),
    h('p.field-hint', { style: { marginTop: '8px' } },
      `Closing capital for ${year} is ${formatJpy(d.bs.closingCapital)}, which becomes next year's opening figure. `
      + 'Set it in Settings when you roll over.')));

  return out;
}

function plTab(d) {
  const { pl } = d;
  return [card('損益計算書 · Profit and loss',
    h('div.deriv',
      ...pl.revenue.map((r) => derivationRow({ label: r.en, ja: r.ja, amount: r.amount })),
      derivationRow({ label: 'Total revenue', amount: pl.totalRevenue, subtotal: true }),
      ...pl.expenses.map((r) => derivationRow({ label: r.en, ja: r.ja, amount: -r.amount })),
      derivationRow({ label: 'Total expenses', amount: -pl.totalExpenses, subtotal: true }),
      derivationRow({ label: 'Net profit', ja: '当期純利益', amount: pl.netProfit, total: true })),
    h('div.stat-grid', { style: { marginTop: '14px' } },
      h('div.stat',
        h('span.stat-label', 'Expense ratio'),
        h('span.stat-value', `${(pl.expenseRatio * 100).toFixed(1)}%`),
        h('span.stat-sub', 'of revenue')),
      h('div.stat',
        h('span.stat-label', 'Margin'),
        h('span.stat-value', `${(pl.margin * 100).toFixed(1)}%`))))];
}

function bsTab(d, state) {
  const { bs, trialBalance: tb, year } = d;
  const out = [];

  out.push(card('貸借対照表 · Balance sheet',
    h('div.two-col',
      h('div',
        h('h3', { style: { marginBottom: '8px' } }, 'Assets · 資産'),
        h('div.deriv',
          ...bs.assets.map((a) => derivationRow({ label: a.en, ja: a.ja, amount: a.amount })),
          bs.drawings ? derivationRow({ label: 'Owner drawings', ja: '事業主貸', amount: bs.drawings }) : null,
          derivationRow({ label: 'Total', amount: bs.leftSide, total: true }))),
      h('div',
        h('h3', { style: { marginBottom: '8px' } }, 'Liabilities and capital · 負債・資本'),
        h('div.deriv',
          ...bs.liabilities.map((a) => derivationRow({ label: a.en, ja: a.ja, amount: a.amount })),
          bs.contributions ? derivationRow({ label: 'Owner contributions', ja: '事業主借', amount: bs.contributions }) : null,
          derivationRow({ label: 'Opening capital', ja: '期首元入金', amount: bs.openingCapital }),
          derivationRow({ label: 'Profit', amount: bs.netProfit }),
          derivationRow({ label: 'Total', amount: bs.rightSide, total: true }))))));

  out.push(card('Opening capital · 元入金',
    h('p.field-hint', { style: { marginBottom: '10px' } },
      'The closing figure from last year. Leave it at zero for your first year of trading unless you started with '
      + 'business assets or cash.'),
    h('label.field',
      h('span.field-label', `Opening capital for ${year}`),
      h('input.input.input-money', {
        type: 'text', inputmode: 'decimal',
        value: state.years[year]?.openingCapital || 0,
        onchange: async (e) => {
          const v = Number(String(e.target.value).replace(/[^\d.-]/g, '')) || 0;
          await saveYear(year, { openingCapital: v });
          invalidate();
          toast('Opening capital saved');
        },
      }))));

  out.push(card('試算表 · Trial balance',
    h('table',
      h('thead', h('tr', h('th', 'Account'), h('th', 'Debit'), h('th', 'Credit'))),
      h('tbody', ...tb.rows.map((r) => h('tr',
        h('th', h('div', r.ja), h('small', { style: { color: 'var(--ink-muted)' } }, r.en)),
        h('td', r.debit ? formatJpy(r.debit) : '—'),
        h('td', r.credit ? formatJpy(r.credit) : '—'))),
      h('tr', { style: { fontWeight: '700' } },
        h('th', 'Total'),
        h('td', formatJpy(tb.totalDebit)),
        h('td', formatJpy(tb.totalCredit)))))));

  return out;
}

function ledgerTab(d) {
  const ledger = buildLedger(d.entries);
  const accounts = Object.values(ledger).sort((a, b) => a.code.localeCompare(b.code));

  if (accounts.length === 0) {
    return [card(null, h('p.field-hint', 'No entries yet.'))];
  }

  return [
    card('総勘定元帳 · General ledger',
      h('p.field-hint', { style: { marginBottom: '10px' } },
        'Required alongside the journal for the 650,000 yen deduction. Each account with every posting and a '
        + 'running balance.'),
      ...accounts.map((acc) => details(
        h('span', { style: { display: 'flex', justifyContent: 'space-between', width: '100%' } },
          h('span', `${acc.ja} · ${acc.en}`),
          h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, formatJpy(acc.balance))),
        h('table',
          h('thead', h('tr', h('th', 'Date'), h('th', 'Debit'), h('th', 'Credit'), h('th', 'Balance'))),
          h('tbody', ...acc.entries.map((e) => h('tr',
            h('th', h('div', e.date), e.description
              ? h('small', { style: { color: 'var(--ink-muted)' } }, e.description) : null),
            h('td', e.debit ? formatJpy(e.debit) : '—'),
            h('td', e.credit ? formatJpy(e.credit) : '—'),
            h('td', formatJpy(e.balance)))))))))];
}

function exportTab(d) {
  const { year, entries } = d;

  const exports = [
    {
      label: '仕訳帳 · Journal (CSV)',
      hint: 'Every journal entry in debit/credit form. This is what a 税理士 will ask for first.',
      run: () => downloadFile(`aoiro-journal-${year}.csv`, withBom(journalToCsv(entries)), 'text/csv'),
    },
    {
      label: '総勘定元帳 · General ledger (CSV)',
      hint: 'Per-account postings with running balances.',
      run: () => downloadFile(`aoiro-ledger-${year}.csv`, withBom(ledgerToCsv(entries)), 'text/csv'),
    },
    {
      label: '決算書 figures (JSON)',
      hint: 'Structured settlement statement, box by box, for transferring into e-Tax.',
      run: () => downloadFile(`aoiro-statement-${year}.json`, JSON.stringify(d.statement, null, 2)),
    },
    {
      label: 'Tax computation (JSON)',
      hint: 'Every intermediate figure behind the tax estimate, so the arithmetic can be checked independently.',
      run: () => downloadFile(`aoiro-tax-${year}.json`, JSON.stringify(d.computed, null, 2)),
    },
  ];

  return [
    card('Exports',
      h('p.field-hint', { style: { marginBottom: '12px' } },
        'CSV files carry a byte-order mark so Excel opens Japanese account names correctly rather than as mojibake.'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        ...exports.map((x) => h('div',
          button(x.label, { class: 'btn-block', onclick: x.run }),
          h('p.field-hint', { style: { marginTop: '4px' } }, x.hint))))),

    card('Filing checklist',
      h('div.list',
        ...[
          'Books balance and the balance sheet reconciles',
          'Every foreign-currency entry carries a bank rate, not a fetched one',
          'Apportioned expenses have their basis recorded',
          'Receipts kept for seven years, electronic ones stored electronically',
          '青色申告決算書 filled from page 1 through page 4',
          '確定申告書 B completed with your deductions',
          'Filed through e-Tax, which is what earns the extra 100,000 of deduction',
        ].map((item) => h('div.list-row', { style: { cursor: 'default' } },
          h('span', { style: { color: 'var(--ink-muted)', width: '18px' } }, '○'),
          h('span.list-main', h('span.list-title', { style: { whiteSpace: 'normal' } }, item)))))),
  ];
}

/** Excel needs a BOM to read UTF-8 CSV without mangling Japanese. */
function withBom(csv) {
  return `﻿${csv}`;
}

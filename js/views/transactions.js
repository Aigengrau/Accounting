/**
 * Transaction list, with the FX audit trail exposed.
 *
 * Grouped by month, filterable, and every row opens a detail sheet showing the
 * journal entry the transaction produced. Seeing the double entry matters: it is
 * what you are being given the 650,000 yen deduction for.
 */

import { h, card, button, badge, sheet, confirmDialog, details } from '../ui/dom.js';
import { formatJpy, formatCurrency, RATE_SOURCE_META, auditFxQuality } from '../fx.js';
import { getState, transactionsForYear, deleteTransaction, toast } from '../store.js';
import { ACCOUNTS_BY_CODE, QUICK_CATEGORIES } from '../accounting/accounts.js';
import { derive } from '../derive.js';
import { openEntryForm, openQuickAdd } from './entry.js';

let activeFilter = 'all';

export function transactionsView() {
  const state = getState();
  const year = state.taxYear;
  const all = transactionsForYear(year);
  const view = h('div.view');

  if (all.length === 0) {
    view.append(card(null, h('div.empty-state',
      h('h3', `No entries for ${year}`),
      h('p', 'Every entry here becomes a balanced double-entry posting, which is what the blue return requires.'),
      button('Add an entry', { class: 'btn-primary', onclick: openQuickAdd }))));
    return view;
  }

  // ---------------------------------------------------------------- filters
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'income', label: 'Income' },
    { id: 'expense', label: 'Expenses' },
    { id: 'foreign', label: 'Foreign currency' },
    { id: 'weak', label: 'Weak FX records' },
  ];

  view.append(h('div.segmented',
    ...filters.map((f) => h('button.segmented-item', {
      type: 'button',
      class: activeFilter === f.id ? 'is-active' : '',
      onclick: () => { activeFilter = f.id; rerender(); },
    }, f.label))));

  const listHost = h('div');
  view.append(listHost);

  const rerender = () => {
    listHost.replaceChildren();
    const rows = applyFilter(all, activeFilter);

    if (rows.length === 0) {
      listHost.append(card(null, h('div.empty-state', h('p', 'Nothing matches that filter.'))));
      return;
    }

    // FX quality summary, shown when it is actually relevant.
    if (activeFilter === 'foreign' || activeFilter === 'weak') {
      const audit = auditFxQuality(all, year);
      if (audit.total > 0) {
        listHost.append(card('Record quality',
          h('p', { style: { fontSize: '0.85rem' } },
            `${audit.strong} of ${audit.total} foreign-currency entries rest on strong evidence `
            + `(${audit.score}%). Strong means the yen your bank actually credited, or your bank's published rate.`),
          ...audit.issues.map((i) => h('div.banner.banner-warning', { style: { marginTop: '8px' } },
            h('span.banner-icon', '⚠'),
            h('div.banner-body', h('strong', i.title), h('div', i.detail))))));
      }
    }

    // Grouped by month, newest first.
    const groups = new Map();
    for (const tx of rows) {
      const key = String(tx.date).slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx);
    }

    for (const [month, txs] of groups) {
      const net = txs.reduce((s, t) => s + (t.kind === 'income' ? t.amount : -t.amount), 0);
      listHost.append(card(
        h('span', { style: { display: 'flex', justifyContent: 'space-between' } },
          h('span', monthLabel(month)),
          h('span', { style: { textTransform: 'none', letterSpacing: 0 } }, formatJpy(net))),
        h('div.list', ...txs.map((tx) => transactionRow(tx, rerender)))));
    }
  };

  rerender();
  return view;
}

function applyFilter(rows, filter) {
  switch (filter) {
    case 'income': return rows.filter((t) => t.kind === 'income');
    case 'expense': return rows.filter((t) => t.kind === 'expense');
    case 'foreign': return rows.filter((t) => t.fx?.currency && t.fx.currency !== 'JPY');
    case 'weak': return rows.filter((t) => t.fx?.currency !== 'JPY'
      && (RATE_SOURCE_META[t.fx?.source]?.weight || 0) < 4);
    default: return rows;
  }
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m) - 1]} ${y}`;
}

function transactionRow(tx, rerender) {
  const acc = ACCOUNTS_BY_CODE[tx.account];
  const isForeign = tx.fx?.currency && tx.fx.currency !== 'JPY';
  const weak = isForeign && (RATE_SOURCE_META[tx.fx.source]?.weight || 0) < 4;

  return h('button.list-row', { onclick: () => openDetail(tx, rerender) },
    h('span.list-main',
      h('span.list-title', tx.description || acc?.en || 'Entry'),
      h('span.list-meta',
        h('span', String(tx.date).slice(5)),
        acc ? h('span', acc.ja) : null,
        isForeign ? badge(`${formatCurrency(tx.fx.amount, tx.fx.currency)} @ ${tx.fx.rate.toFixed(2)}`, weak ? 'warning' : 'neutral') : null,
        tx.businessRatio < 1 ? badge(`${Math.round(tx.businessRatio * 100)}% business`, 'accent') : null,
        tx.isRemittance ? badge('remittance', 'accent') : null,
        tx.fx?.amendments?.length ? badge(`${tx.fx.amendments.length} amendment`, 'warning') : null)),
    h('span.list-amount', { class: tx.kind === 'income' ? 'is-income' : '' },
      `${tx.kind === 'income' ? '+' : ''}${formatJpy(tx.amount)}`));
}

/** Detail sheet: what was booked, at what rate, and the journal entry behind it. */
function openDetail(tx, rerender) {
  const state = getState();
  const entries = state.journal.filter((e) => e.transactionId === tx.id);
  const acc = ACCOUNTS_BY_CODE[tx.account];
  const isForeign = tx.fx?.currency && tx.fx.currency !== 'JPY';
  const meta = RATE_SOURCE_META[tx.fx?.source];

  const body = h('div');

  body.append(h('div.stat-grid',
    h('div.stat',
      h('span.stat-label', 'Booked in yen'),
      h('span.stat-value', formatJpy(tx.amount))),
    isForeign ? h('div.stat',
      h('span.stat-label', 'Original'),
      h('span.stat-value', formatCurrency(tx.fx.amount, tx.fx.currency))) : null));

  body.append(h('div.deriv', { style: { marginTop: '14px' } },
    row('Date', tx.date),
    row('Account', acc ? `${acc.ja} — ${acc.en}` : tx.account),
    tx.description ? row('Description', tx.description) : null,
    tx.businessRatio < 1 ? row('Business share', `${Math.round(tx.businessRatio * 100)}%`) : null,
    tx.ratioBasis ? row('Basis', tx.ratioBasis) : null,
    tx.withholding ? row('Withheld at source', formatJpy(tx.withholding)) : null,
    tx.incomeSource ? row('Income source', tx.incomeSource === 'japan' ? 'Japan-source (国内源泉)' : 'Foreign-source (国外源泉)') : null,
    tx.workPerformedIn ? row('Work performed', tx.workPerformedIn) : null,
    tx.isExportExempt ? row('Consumption tax', 'Export-exempt (輸出免税)') : null));

  // ------------------------------------------------------------ FX audit trail
  if (isForeign) {
    body.append(h('h3', { style: { marginTop: '20px', marginBottom: '8px' } }, 'Exchange rate record'));
    body.append(h('div.rate-preview',
      h('span.rate-preview-main', `${tx.fx.rate.toFixed(4)} JPY per ${tx.fx.currency}`),
      h('span.rate-preview-note', `${meta?.label || tx.fx.source} · evidence ${meta?.audit || 'unknown'}`),
      tx.fx.bankName ? h('span.rate-preview-note', `Bank: ${tx.fx.bankName}`) : null,
      tx.fx.fees ? h('span.rate-preview-note', `Fee ${formatJpy(tx.fx.fees)}, booked as 支払手数料`) : null,
      tx.fx.sourceNote ? h('span.rate-preview-note', tx.fx.sourceNote) : null,
      h('span.rate-preview-note', `Locked ${new Date(tx.fx.lockedAt).toLocaleString()}`)));

    if (tx.fx.amendments?.length) {
      body.append(details(`${tx.fx.amendments.length} amendment(s)`,
        ...tx.fx.amendments.map((a) => h('div', { style: { fontSize: '0.8rem', marginBottom: '8px' } },
          h('strong', new Date(a.amendedAt).toLocaleString()),
          h('div', a.reason),
          h('div', { style: { color: 'var(--ink-muted)' } },
            `was ${a.previous.rate.toFixed(4)} → ${formatJpy(a.previous.jpy)} (${a.previous.source})`)))));
    }
  }

  // ------------------------------------------------------------ journal entry
  if (entries.length) {
    body.append(h('h3', { style: { marginTop: '20px', marginBottom: '8px' } }, 'Journal entry (仕訳)'));
    for (const entry of entries) {
      body.append(h('table',
        h('thead', h('tr', h('th', 'Account'), h('th', 'Debit'), h('th', 'Credit'))),
        h('tbody', ...entry.lines.map((l) => h('tr',
          h('th', h('div', l.accountName), l.memo ? h('small', { style: { color: 'var(--ink-muted)' } }, l.memo) : null),
          h('td', l.debit ? formatJpy(l.debit) : ''),
          h('td', l.credit ? formatJpy(l.credit) : ''))))));
    }
  }

  const { close } = sheet('Entry detail', body);

  body.append(h('div.btn-row', { style: { marginTop: '20px' } },
    button('Edit', {
      onclick: () => {
        close();
        const category = QUICK_CATEGORIES.find((c) => c.account === tx.account)
          || { kind: tx.kind, account: tx.account, label: 'Edit entry' };
        openEntryForm(category, tx);
      },
    }),
    button('Delete', {
      class: 'btn-danger',
      onclick: async () => {
        const ok = await confirmDialog('Delete this entry?',
          'The transaction and its journal entries will be removed. This cannot be undone.', 'Delete');
        if (!ok) return;
        await deleteTransaction(tx.id);
        toast('Entry deleted');
        close();
        rerender();
      },
    })));
}

function row(label, value) {
  return h('div.deriv-row',
    h('span.deriv-label', label),
    h('span', { style: { textAlign: 'right', fontSize: '0.86rem' } }, value));
}

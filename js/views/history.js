/**
 * History.
 *
 * Every entry, newest first, grouped by month with a running total per month.
 * Filters are three buttons, not a form.
 */

import { h, card, button, icon } from '../ui.js';
import { yen, monthKey, monthLabel, friendlyDate } from '../money.js';
import { category } from '../categories.js';
import { getState, monthTotals } from '../store.js';
import { openEdit, openAdd, describe, subtitle } from './entry.js';

let filter = 'all';

export function historyView() {
  const state = getState();
  const view = h('div.view');

  if (state.entries.length === 0) {
    view.append(card(null, h('div.empty',
      h('p', 'Nothing recorded yet.'),
      button('Add something', { class: 'btn-primary', onclick: () => openAdd('expense') }))));
    return view;
  }

  view.append(h('div.segmented',
    ...[
      { id: 'all', label: 'All' },
      { id: 'expense', label: 'Out' },
      { id: 'income', label: 'In' },
    ].map((f) => h('button.segmented-item', {
      type: 'button',
      class: filter === f.id ? 'is-active' : '',
      onclick: () => { filter = f.id; rerender(); },
    }, f.label))));

  const host = h('div.stack');
  view.append(host);

  const rerender = () => {
    host.replaceChildren();

    const rows = state.entries.filter((e) => {
      if (filter === 'all') return true;
      if (filter === 'expense') return e.type === 'expense' || e.type === 'adjust';
      return e.type === 'income';
    });

    if (rows.length === 0) {
      host.append(card(null, h('div.empty', h('p', 'Nothing matches that filter.'))));
      return;
    }

    const groups = new Map();
    for (const e of rows) {
      const k = monthKey(e.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }

    for (const [key, entries] of groups) {
      const totals = monthTotals(key);
      host.append(card(
        h('span.month-head',
          h('span', monthLabel(key)),
          h('span.month-figures',
            h('span.good', `+${yen(totals.income)}`),
            h('span.bad', `−${yen(totals.spent)}`))),
        h('div.list', ...entries.map(entryRow))));
    }
  };

  rerender();
  return view;
}

function entryRow(entry) {
  const isIncome = entry.type === 'income';
  const isAdjust = entry.type === 'adjust';
  const amount = isAdjust
    ? `${entry.jpy >= 0 ? '+' : '−'}${yen(Math.abs(entry.jpy))}`
    : `${isIncome ? '+' : '−'}${yen(entry.jpy)}`;

  return h('button.list-row', { onclick: () => openEdit(entry) },
    h('span.row-icon', { class: isIncome ? 'is-in' : isAdjust ? 'is-adjust' : '' },
      icon(category(entry.category).icon, 18)),
    h('span.row-main',
      h('span.row-title', describe(entry)),
      h('span.row-sub', friendlyDate(entry.date), ' · ', subtitle(entry))),
    h('span.row-amount', { class: isIncome ? 'is-in' : isAdjust ? 'is-adjust' : '' }, amount));
}

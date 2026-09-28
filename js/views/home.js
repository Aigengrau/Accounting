/**
 * Home.
 *
 * One question above all: how much cash do I have? That is the biggest thing on
 * the screen. Then this month in and out, then what you have been spending on,
 * then the last few entries.
 */

import { h, card, button, icon, sheet, field, input, bar } from '../ui.js';
import { yen, monthKey, monthLabel, today, parseAmount, friendlyDate } from '../money.js';
import { category } from '../categories.js';
import {
  getState, cashBalance, monthTotals, spendingByCategory, entriesForMonth,
  incomeByYear, recordCashCount, updateSettings, toast, setView, daysSinceBackup,
} from '../store.js';
import { openAdd, openEdit, describe, subtitle } from './entry.js';

export function homeView() {
  const state = getState();
  const view = h('div.view');
  const thisMonth = monthKey(today());
  const totals = monthTotals(thisMonth);
  const balance = cashBalance();

  // ------------------------------------------------------------ first run
  if (state.entries.length === 0 && !state.settings.startingCash) {
    view.append(welcomeCard());
    return view;
  }

  // ------------------------------------------------------------ the balance
  view.append(h('section.balance-card',
    h('span.balance-label', 'Cash on hand'),
    h('span.balance-value', { class: balance < 0 ? 'is-negative' : '' }, yen(balance)),
    h('button.balance-count', {
      type: 'button',
      onclick: () => openCashCount(balance),
    }, icon('wallet', 15), 'Count my cash')));

  // ------------------------------------------------------------ this month
  view.append(h('div.inout-row',
    h('div.inout.is-in',
      h('span.inout-label', icon('up', 15), 'In'),
      h('span.inout-value', yen(totals.income))),
    h('div.inout.is-out',
      h('span.inout-label', icon('down', 15), 'Out'),
      h('span.inout-value', yen(totals.spent)))));

  view.append(h('p.month-note',
    `${monthLabel(thisMonth)} — `,
    totals.net >= 0
      ? h('span.good', `${yen(totals.net)} more than you spent`)
      : h('span.bad', `${yen(-totals.net)} more out than in`)));

  // ------------------------------------------------------- spending mix
  const spending = spendingByCategory(thisMonth);
  if (spending.length) {
    const max = spending[0].amount;
    view.append(card('Where it went this month',
      h('div.breakdown', ...spending.slice(0, 6).map((row) => h('div.breakdown-row',
        h('span.breakdown-icon', icon(category(row.id).icon, 18)),
        h('span.breakdown-main',
          h('span.breakdown-label', category(row.id).label),
          bar(row.amount / max, 'accent')),
        h('span.breakdown-amount', yen(row.amount))))),
      spending.length > 6
        ? h('p.field-hint', { style: { marginTop: '10px' } },
          `and ${spending.length - 6} more categor${spending.length - 6 === 1 ? 'y' : 'ies'}`)
        : null));
  }

  // -------------------------------------------------------- income sources
  const year = new Date().getFullYear();
  const income = incomeByYear(year);
  if (income.length) {
    const total = income.reduce((s, r) => s + r.amount, 0);
    view.append(card(`Money in during ${year}`,
      h('div.breakdown', ...income.map((row) => h('div.breakdown-row',
        h('span.breakdown-icon', icon(category(row.id).icon, 18)),
        h('span.breakdown-main',
          h('span.breakdown-label', category(row.id).label),
          bar(row.amount / income[0].amount, 'good')),
        h('span.breakdown-amount', yen(row.amount))))),
      h('p.field-hint', { style: { marginTop: '10px' } },
        `${yen(total)} so far this year. Keeping rent and freelance money apart now means the figures are `
        + 'already sorted if you ever need them for a tax return.')));
  }

  // --------------------------------------------------------- recent entries
  const recent = state.entries.slice(0, 6);
  if (recent.length) {
    view.append(card('Recent',
      h('div.list', ...recent.map(entryRow)),
      h('div.btn-row', { style: { marginTop: '10px' } },
        button('See everything', { onclick: () => setView('history') }))));
  }

  // ---------------------------------------------------------- backup nudge
  const days = daysSinceBackup();
  if (state.entries.length >= 8 && (days === Infinity || days > 45)) {
    view.append(h('div.banner.banner-warn',
      h('span.banner-icon', icon('alert', 18)),
      h('div.banner-body',
        h('strong', days === Infinity ? 'No backup yet. ' : 'Backup is getting old. '),
        'Everything is stored on this phone only. If you lose it or clear the browser, it is gone.',
        h('div.banner-actions',
          button('Back up now', { class: 'btn-sm', onclick: () => setView('settings') })))));
  }

  return view;
}

function entryRow(entry) {
  const isIncome = entry.type === 'income';
  const isAdjust = entry.type === 'adjust';
  const amount = isAdjust
    ? `${entry.jpy >= 0 ? '+' : ''}${yen(entry.jpy)}`
    : `${isIncome ? '+' : '−'}${yen(entry.jpy)}`;

  return h('button.list-row', { onclick: () => openEdit(entry) },
    h('span.row-icon', { class: isIncome ? 'is-in' : isAdjust ? 'is-adjust' : '' },
      icon(category(entry.category).icon, 18)),
    h('span.row-main',
      h('span.row-title', describe(entry)),
      h('span.row-sub', friendlyDate(entry.date), ' · ', subtitle(entry))),
    h('span.row-amount', { class: isIncome ? 'is-in' : isAdjust ? 'is-adjust' : '' }, amount));
}

/**
 * Cash count.
 *
 * Small cash purchases go unrecorded — that is just what cash is like. Rather
 * than let the balance drift into fiction, you count what is in your wallet and
 * the difference is booked openly.
 */
function openCashCount(currentBalance) {
  let value = '';
  const body = h('div');
  const { close } = sheet('Count your cash', body);

  const preview = h('p.field-hint');
  const update = () => {
    const actual = parseAmount(value);
    if (!value) { preview.textContent = ''; return; }
    const diff = Math.round(actual) - currentBalance;
    preview.textContent = diff === 0
      ? 'That matches exactly.'
      : diff > 0
        ? `${yen(diff)} more than recorded — probably money in you had not added yet.`
        : `${yen(-diff)} less than recorded — probably small cash purchases you did not record.`;
  };

  body.append(h('p.dialog-message',
    `The app thinks you have ${yen(currentBalance)}. Count what is actually in your wallet and enter it. `
    + 'The difference gets recorded so your balance stays honest.'));

  body.append(field('How much do you actually have?', h('input.input.amount-input', {
    type: 'text', inputmode: 'decimal', name: 'actual', placeholder: '0',
    oninput: (e) => { value = e.target.value; update(); },
  })));
  body.append(preview);

  body.append(h('div.btn-row', { style: { marginTop: '18px' } },
    button('Cancel', { class: 'btn-ghost', onclick: close }),
    button('Save', {
      class: 'btn-primary', name: 'save',
      onclick: async () => {
        if (!value) { toast('Enter an amount', 'error'); return; }
        const entry = await recordCashCount(parseAmount(value));
        toast(entry ? 'Balance updated' : 'Already matched', 'success');
        close();
      },
    })));

  requestAnimationFrame(() => body.querySelector('.amount-input')?.focus());
}

/** Shown once, before there is anything to look at. */
function welcomeCard() {
  let value = '';
  return h('section.card.welcome',
    h('h2', 'How much cash do you have right now?'),
    h('p', 'Count what is in your wallet and enter it. From then on, add money as it comes in and goes out, '
      + 'and the balance keeps itself up to date.'),
    h('input.input.amount-input', {
      type: 'text', inputmode: 'decimal', name: 'startingCash', placeholder: '0',
      oninput: (e) => { value = e.target.value; },
    }),
    h('div.btn-row', { style: { marginTop: '14px' } },
      button('Start', {
        class: 'btn-primary btn-block', name: 'start',
        onclick: async () => {
          const amount = parseAmount(value);
          if (!amount) { toast('Enter how much you have', 'error'); return; }
          await updateSettings({ startingCash: amount, startingCashDate: today() });
          toast('Ready — now add things as they happen', 'success');
        },
      })),
    h('p.field-hint', { style: { marginTop: '12px' } },
      'Everything stays on this phone. Nothing is sent anywhere, and there is no account to create.'));
}

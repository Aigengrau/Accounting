/**
 * Deadline calendar.
 *
 * Japanese tax obligations arrive spread across the year and nothing warns you in
 * advance. Resident tax lands in June for income you earned last year; enterprise
 * tax in August; prepayments in July and November. This screen puts them all on
 * one timeline with the amounts attached.
 */

import { h, card, badge, button } from '../ui/dom.js';
import { formatJpy } from '../fx.js';
import { getState, setView } from '../store.js';
import { derive } from '../derive.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function calendarView() {
  const state = getState();
  const d = derive();
  const { computed, rates, year } = d;

  const view = h('div.view');
  const today = new Date();
  const events = buildEvents(d, rates, year, state);

  const upcoming = events.filter((e) => new Date(e.date) >= today).sort(byDate);
  const past = events.filter((e) => new Date(e.date) < today).sort(byDate);

  view.append(h('p.view-intro',
    `Everything due as a result of your ${year} figures. Amounts are estimates from the app's own computation, `
    + 'and the real bills will state the exact figure.'));

  if (upcoming.length) {
    view.append(card('Coming up',
      h('div', ...upcoming.map((e) => deadlineRow(e, today)))));
  }

  // The annual rhythm, so the shape of the year is visible at a glance.
  view.append(card('The annual cycle',
    h('div', ...ANNUAL_CYCLE.map((e) => h('div.deadline',
      h('span.deadline-date',
        h('span.deadline-day', e.day),
        h('span.deadline-month', e.month)),
      h('span.deadline-body',
        h('span.deadline-title', e.title),
        h('span.deadline-detail', e.detail))))),
    h('p.field-hint', { style: { marginTop: '10px' } },
      'Resident tax and health insurance are both assessed on last year’s income, so a strong year is followed '
      + 'by twelve months of higher bills. That lag is the single biggest cash-flow trap in Japanese self-employment.')));

  if (past.length) {
    view.append(card('Already passed',
      h('div', ...past.map((e) => deadlineRow(e, today)))));
  }

  view.append(h('div.btn-row',
    button('See the figures behind these', { class: 'btn-block', onclick: () => setView('tax') })));

  return view;
}

function byDate(a, b) {
  return String(a.date).localeCompare(String(b.date));
}

function buildEvents(d, rates, year, state) {
  const { computed } = d;
  const events = [];
  const next = year + 1;

  // Filing.
  events.push({
    date: rates.filingDeadline,
    title: '確定申告 — final income tax return',
    detail: `The filing window opens February 16, ${next}. File through e-Tax to keep the full 650,000 yen `
          + 'blue-return deduction.',
    amount: computed.incomeTax.refund > 0 ? null : computed.incomeTax.balanceDue,
    amountLabel: computed.incomeTax.refund > 0
      ? `${formatJpy(computed.incomeTax.refund)} refund expected`
      : null,
    severity: 'critical',
  });

  // Consumption tax.
  if (computed.consumptionTax.isTaxablePerson) {
    events.push({
      date: `${next}-${rates.consumptionTax.filingDeadline}`,
      title: '消費税 return',
      detail: 'Filed separately from income tax, two weeks after the income tax deadline.',
      amount: computed.consumptionTax.total,
      severity: 'high',
    });
  }

  // Blue return application, for anyone not yet approved.
  if (!state.settings.filedBlueReturnApplication) {
    events.push({
      date: `${next}-03-15`,
      title: '青色申告承認申請書 — hard deadline',
      detail: `Must be filed by March 15 to apply to ${next} income. There is no late filing and no exception.`,
      severity: 'critical',
    });
  }

  // Prepayments.
  if (computed.estimatedTax.required) {
    for (const inst of computed.estimatedTax.installments) {
      events.push({
        date: inst.due,
        title: `予定納税 ${inst.label} — prepayment`,
        detail: 'Billed automatically because this year’s tax exceeded 150,000 yen. Apply by July 15 to reduce '
              + 'it if your income has dropped.',
        amount: inst.amount,
        severity: 'high',
      });
    }
  }

  // Resident tax instalments.
  const residentInstalment = Math.ceil(computed.residentTax.total / 4 / 100) * 100;
  if (computed.residentTax.total > 0) {
    rates.residentTax.installments.forEach((due, i) => {
      const [m] = due.split('-');
      const y = Number(m) === 1 ? next + 1 : next;
      events.push({
        date: `${y}-${due}`,
        title: `住民税 instalment ${i + 1} of 4`,
        detail: `Billed by your city from June ${next}, based on ${year} income.`,
        amount: residentInstalment,
        severity: 'medium',
      });
    });
  }

  // Enterprise tax.
  if (computed.enterpriseTax.total > 0) {
    rates.enterpriseTax.installments.forEach((due, i) => {
      events.push({
        date: `${next}-${due}`,
        title: `個人事業税 instalment ${i + 1} of 2`,
        detail: 'From the prefecture, not the city. Deductible as 租税公課 in the year you pay it.',
        amount: Math.ceil(computed.enterpriseTax.total / 2 / 100) * 100,
        severity: 'medium',
      });
    });
  }

  // Health insurance.
  if (computed.nhi.total > 0) {
    events.push({
      date: `${next}-06-30`,
      title: '国民健康保険 assessment arrives',
      detail: `Based on ${year} income, payable across roughly ten instalments from June ${next} to March `
            + `${next + 1}.`,
      amount: computed.nhi.total,
      amountLabel: `${formatJpy(computed.nhi.total)} for the year`,
      severity: 'medium',
    });
  }

  // Year-end actions that only work before December 31.
  events.push({
    date: `${year}-12-31`,
    title: 'Year-end deadline for deductions',
    detail: 'Contributions to 小規模企業共済 and iDeCo, ふるさと納税 donations, and equipment purchases all have to '
          + 'be completed and paid by today to count for this year. A December prepayment of up to twelve months of '
          + '小規模企業共済 can pull a large deduction forward.',
    severity: 'high',
  });

  return events;
}

function deadlineRow(event, today) {
  const date = new Date(event.date);
  const isPast = date < today;
  const daysAway = Math.ceil((date - today) / 86_400_000);
  const isSoon = !isPast && daysAway <= 30;

  return h('div.deadline', { class: `${isPast ? 'is-past' : ''} ${isSoon ? 'is-soon' : ''}`.trim() },
    h('span.deadline-date',
      h('span.deadline-day', String(date.getUTCDate())),
      h('span.deadline-month', MONTHS[date.getUTCMonth()])),
    h('span.deadline-body',
      h('span.deadline-title', event.title,
        isSoon ? h('span', { style: { marginLeft: '6px' } }, badge(`${daysAway}d`, 'critical')) : null),
      h('span.deadline-detail', event.detail),
      event.amountLabel
        ? h('span.deadline-amount', event.amountLabel)
        : event.amount
          ? h('span.deadline-amount', formatJpy(event.amount))
          : null,
      h('span.deadline-detail', { style: { color: 'var(--ink-muted)', marginTop: '2px' } }, event.date)));
}

/** The fixed shape of a Japanese tax year, independent of your numbers. */
const ANNUAL_CYCLE = [
  { day: '16', month: 'FEB', title: 'Filing window opens', detail: '確定申告 accepted from February 16.' },
  { day: '15', month: 'MAR', title: 'Filing deadline', detail: 'Income tax return due, and the last day to apply for blue-return status for the current year.' },
  { day: '31', month: 'MAR', title: 'Consumption tax due', detail: 'Separate return, two weeks after income tax.' },
  { day: '30', month: 'JUN', title: 'Resident tax and health insurance assessed', detail: 'Bills arrive based on last year’s income.' },
  { day: '31', month: 'JUL', title: 'First prepayment', detail: '予定納税 first instalment, if last year’s tax reached 150,000 yen.' },
  { day: '31', month: 'AUG', title: 'Enterprise tax, first half', detail: '個人事業税 from the prefecture.' },
  { day: '30', month: 'NOV', title: 'Second prepayment', detail: '予定納税 second instalment.' },
  { day: '30', month: 'NOV', title: 'Enterprise tax, second half', detail: 'Second 個人事業税 instalment.' },
  { day: '31', month: 'DEC', title: 'Last day for this year’s deductions', detail: 'Pension schemes, donations and equipment must be paid for by today.' },
];

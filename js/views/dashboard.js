/**
 * Dashboard.
 *
 * Answers the three questions a freelancer actually has, in order:
 * how much should I be setting aside, where is the money going, and is anything
 * about to go wrong.
 */

import { h, card, button } from '../ui/dom.js';
import { statTile, rankedBars, monthlyColumns, meter } from '../ui/charts.js';
import { formatJpy } from '../fx.js';
import { getState, setView, daysSinceBackup } from '../store.js';
import { derive } from '../derive.js';
import { monthlySales } from '../accounting/reports.js';
import { ratesAreStale } from '../tax/rates.js';
import { openQuickAdd } from './entry.js';

export function dashboardView() {
  const state = getState();
  const d = derive();
  const { computed, report, pl, year, rates } = d;
  const summary = computed.summary;

  const view = h('div.view');

  // ------------------------------------------------------------- empty state
  if (d.transactions.length === 0) {
    view.append(card(null,
      h('div.empty-state',
        h('h3', `Nothing recorded for ${year} yet`),
        h('p', 'Add your first entry and the books, the tax estimate and the advice all build themselves from it.'),
        button('Add your first entry', { class: 'btn-primary', onclick: openQuickAdd }))));
    view.append(setupChecklist(state));
    return view;
  }

  // ---------------------------------------------------------------- banners
  const banners = buildBanners(state, d, rates);
  if (banners.length) view.append(...banners);

  // ------------------------------------------------------------- hero figure
  view.append(h('div.stat-grid',
    statTile({
      label: 'Set aside monthly',
      ja: '毎月の積立',
      value: formatJpy(summary.monthlySetAside),
      sub: `${formatJpy(summary.totalBurden)} total for ${year}`,
      tone: 'hero',
    }),
    statTile({
      label: 'Net after everything',
      value: formatJpy(pl.totalRevenue - pl.totalExpenses - summary.totalBurden),
      sub: `from ${formatJpy(pl.totalRevenue)} revenue`,
    })));

  view.append(h('div.stat-grid',
    statTile({
      label: 'Effective rate',
      value: `${(summary.effectiveRate * 100).toFixed(1)}%`,
      sub: 'of revenue, all levies',
    }),
    statTile({
      label: 'Marginal rate',
      value: `${(summary.marginalRate * 100).toFixed(0)}%`,
      sub: `next ${formatJpy(100_000)} deduction saves ${formatJpy(summary.marginalRate * 100_000)}`,
    })));

  // -------------------------------------------------------- burden breakdown
  const burdenRows = summary.breakdown.map((b) => ({
    label: b.label,
    ja: b.ja,
    value: b.amount,
    share: summary.totalBurden > 0 ? b.amount / summary.totalBurden : 0,
    series: b.key === 'nhi' || b.key === 'pension' ? 'insurance' : 'tax',
  }));

  view.append(card('Where it goes',
    rankedBars(burdenRows, { title: `${year} tax and insurance burden` }),
    h('p.field-hint', { style: { marginTop: '10px' } },
      'Health insurance and pension are not taxes, but they are compulsory and income-linked, so leaving them out '
      + 'of the picture understates what you owe by a wide margin.')));

  // ------------------------------------------------------------ monthly flow
  view.append(card('Month by month',
    monthlyColumns(monthlySales(d.entries, year), { title: `${year} revenue and expenses` })));

  // ------------------------------------------------------------------ meters
  const ct = computed.consumptionTax;
  const meters = [];
  meters.push(meter({
    label: 'Consumption tax threshold',
    value: pl.totalRevenue,
    limit: rates.consumptionTax.exemptionThreshold,
    note: pl.totalRevenue > rates.consumptionTax.exemptionThreshold
      ? `Above 10 million yen. You become a 課税事業者 for ${year + 2}, two years from now — budget for it before then.`
      : 'Export-exempt sales to foreign clients count toward this line even though they carry no tax.',
  }));

  const mutualMax = rates.pensionSchemes.smallEnterprise.annualMax;
  if (state.settings.smallEnterpriseMutual < mutualMax) {
    meters.push(meter({
      label: '小規模企業共済 used',
      value: state.settings.smallEnterpriseMutual,
      limit: mutualMax,
      warnAt: 2, // more is better here, so never warn
      note: `${formatJpy(mutualMax - state.settings.smallEnterpriseMutual)} of deductible room unused. `
          + 'The money stays yours.',
    }));
  }

  view.append(card('Thresholds', h('div', { style: { display: 'grid', gap: '16px' } }, ...meters)));

  // --------------------------------------------------------------- top advice
  const topAdvice = report.items.filter((i) => i.severity === 'critical' || i.severity === 'high').slice(0, 3);
  if (topAdvice.length) {
    view.append(card('Worth acting on',
      h('div.advice', ...topAdvice.map((item) => h('div.advice-item', { dataset: { severity: item.severity } },
        h('div.advice-head',
          h('span.advice-title', item.title),
          item.saving > 0 ? h('span.advice-saving', formatJpy(item.saving)) : null)))),
      h('div.btn-row', { style: { marginTop: '12px' } },
        button('See all advice', { onclick: () => setView('advisor') }))));
  }

  view.append(h('p.disclaimer',
    'Every figure here is an estimate produced from the numbers you entered and the rate tables in this app. '
    + 'It is not tax advice and it is not a substitute for a 税理士. Check anything that matters against the NTA '
    + 'before you file.'));

  return view;
}

function buildBanners(state, d, rates) {
  const banners = [];
  const { report, bookIssues, sourcing, residency } = d;

  // Books that do not balance block the 650,000 deduction, so lead with it.
  const critical = bookIssues.filter((i) => i.severity === 'critical');
  if (critical.length) {
    banners.push(h('div.banner.banner-critical',
      h('span.banner-icon', '⚠'),
      h('div.banner-body',
        h('strong', 'Your books do not balance. '),
        critical[0].message,
        h('div.banner-actions', button('Open reports', { class: 'btn-sm', onclick: () => setView('reports') })))));
  }

  const criticalAdvice = report.items.filter((i) => i.severity === 'critical');
  if (criticalAdvice.length) {
    banners.push(h('div.banner.banner-critical',
      h('span.banner-icon', '⚠'),
      h('div.banner-body',
        h('strong', criticalAdvice[0].title),
        h('div', { style: { marginTop: '3px' } }, criticalAdvice[0].body.split('\n')[0]),
        h('div.banner-actions', button('Details', { class: 'btn-sm', onclick: () => setView('advisor') })))));
  }

  // Backup nagging, proportionate to how long it has been.
  const days = daysSinceBackup();
  if (days === Infinity && d.transactions.length >= 5) {
    banners.push(h('div.banner.banner-warning',
      h('span.banner-icon', '↓'),
      h('div.banner-body',
        h('strong', 'You have never exported a backup. '),
        'Your books live only in this browser. Clearing site data would delete them permanently.',
        h('div.banner-actions', button('Export now', { class: 'btn-sm', onclick: () => setView('settings') })))));
  } else if (Number.isFinite(days) && days > 30) {
    banners.push(h('div.banner.banner-warning',
      h('span.banner-icon', '↓'),
      h('div.banner-body',
        `Last backup was ${Math.floor(days)} days ago.`,
        h('div.banner-actions', button('Export', { class: 'btn-sm', onclick: () => setView('settings') })))));
  }

  // The five-year crossover, which is worth planning around well in advance.
  if (residency.crossoverWarning) {
    banners.push(h('div.banner.banner-info',
      h('span.banner-icon', 'ℹ'),
      h('div.banner-body', h('strong', 'Tax residency changing soon. '), residency.crossoverWarning)));
  }

  if (sourcing.shelteredAmount > 0) {
    banners.push(h('div.banner.banner-good',
      h('span.banner-icon', '✓'),
      h('div.banner-body',
        h('strong', `${formatJpy(sourcing.shelteredAmount)} outside the Japanese tax net. `),
        'Foreign-source income paid abroad and not remitted. Keep the records proving it stayed out.')));
  }

  if (ratesAreStale(rates)) {
    banners.push(h('div.banner.banner-warning',
      h('span.banner-icon', '⚠'),
      h('div.banner-body',
        `The tax rate tables were last verified ${rates.meta.verified}. Statutory figures change every year — `
        + 'check them against the NTA before filing.')));
  }

  return banners;
}

function setupChecklist(state) {
  const s = state.settings;
  const steps = [
    { done: !!s.name, label: 'Fill in your profile and city', view: 'settings' },
    { done: !!s.arrivalDate || s.yearsInJapan > 0, label: 'Set when you arrived in Japan, for the 5-year rule', view: 'settings' },
    { done: s.filedKaigyoTodoke, label: 'File your 開業届 with the tax office', view: 'settings' },
    { done: s.filedBlueReturnApplication, label: 'File the 青色申告承認申請書 (deadline: March 15)', view: 'settings' },
    { done: !!s.primaryBank, label: 'Name your main bank, for exchange rates', view: 'settings' },
  ];

  return card('Set-up',
    h('div.list', ...steps.map((step) => h('button.list-row', {
      onclick: () => setView(step.view),
    },
    h('span', { style: { color: step.done ? 'var(--good)' : 'var(--ink-muted)', fontSize: '1.1rem', width: '20px' } },
      step.done ? '✓' : '○'),
    h('span.list-main', h('span.list-title', {
      style: step.done ? { color: 'var(--ink-muted)', textDecoration: 'line-through' } : {},
    }, step.label))))));
}

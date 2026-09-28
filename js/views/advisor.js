/**
 * Advisor view.
 *
 * Recommendations sorted by consequence: compliance risks first, then savings by
 * size. Every item states what it is worth in yen, what to do, and which statute
 * it rests on, so each one can be checked rather than taken on faith.
 */

import { h, card, badge, details, button } from '../ui/dom.js';
import { statTile } from '../ui/charts.js';
import { formatJpy } from '../fx.js';
import { getState, setView } from '../store.js';
import { derive } from '../derive.js';
import { REMITTANCE_TRAPS } from '../tax/sourcing.js';
import { NOT_DEDUCTIBLE } from '../accounting/accounts.js';

const CATEGORY_LABELS = {
  compliance: 'Compliance',
  sourcing: 'Income sourcing',
  planning: 'Planning',
  deduction: 'Deductions',
  structure: 'Structure',
  classification: 'Classification',
  election: 'Elections',
  cashflow: 'Cash flow',
  timing: 'Timing',
  records: 'Records',
  value: 'Good value',
};

const SEVERITY_BADGE = {
  critical: ['Act now', 'critical'],
  high: ['Important', 'warning'],
  medium: ['Worth doing', 'neutral'],
  low: ['Consider', 'neutral'],
};

export function advisorView() {
  const state = getState();
  const d = derive();
  const { report, residency, year } = d;

  const view = h('div.view');

  // ------------------------------------------------------------------ summary
  const quantified = report.items.filter((i) => i.saving > 0);
  view.append(h('div.stat-grid',
    statTile({
      label: 'Identified savings',
      value: formatJpy(report.totalIdentifiedSaving),
      sub: `across ${quantified.length} quantified item${quantified.length === 1 ? '' : 's'}`,
      tone: report.totalIdentifiedSaving > 0 ? 'good' : 'neutral',
    }),
    statTile({
      label: 'Needs attention',
      value: String(report.counts.critical + report.counts.high),
      sub: `${report.counts.critical} urgent`,
      tone: report.counts.critical > 0 ? 'critical' : 'neutral',
    })));

  view.append(h('p.view-intro',
    'Ordered by consequence, not by how easy they are. Compliance risks come before savings, because a missed '
    + 'deadline costs more than any optimisation gains.'));

  // ------------------------------------------------------------------- items
  view.append(h('div.advice', ...report.items.map(adviceItem)));

  // --------------------------------------------------- remittance trap primer
  if (residency.status === 'non_permanent') {
    view.append(card('What counts as a remittance',
      h('p.field-hint', { style: { marginBottom: '10px' } },
        'As a 非永住者 the amount you bring into Japan can itself create taxable income. These all count, and '
        + 'the last few surprise people.'),
      h('div.list', ...REMITTANCE_TRAPS.map((t) => h('div.list-row', { style: { cursor: 'default' } },
        h('span.list-main',
          h('span.list-title', t.title),
          h('span.list-meta', { style: { whiteSpace: 'normal', lineHeight: '1.45' } }, t.detail)))))));
  }

  // ---------------------------------------------------- non-deductible primer
  view.append(card('What you cannot deduct',
    h('p.field-hint', { style: { marginBottom: '10px' } },
      'Claiming these is the fastest way to turn a routine filing into an audit.'),
    h('div.list', ...NOT_DEDUCTIBLE.map((n) => h('div.list-row', { style: { cursor: 'default' } },
      h('span.list-main',
        h('span.list-title', n.item),
        h('span.list-meta', { style: { whiteSpace: 'normal', lineHeight: '1.45' } }, n.reason)))))));

  // -------------------------------------------------------------- disclaimer
  view.append(h('p.disclaimer',
    'This is a rule-based reading of the general position for a foreign sole proprietor in Japan, applied to the '
    + 'figures you entered. It is not professional tax advice. Each item names the statute behind it so you can '
    + 'check the reasoning, and anything with real money attached is worth an hour with a 税理士 who works with '
    + 'foreign residents — that hour usually pays for itself several times over.'));

  view.append(h('div.btn-row',
    button('Back to the numbers', { class: 'btn-block', onclick: () => setView('tax') })));

  return view;
}

function adviceItem(item) {
  const [badgeText, badgeKind] = SEVERITY_BADGE[item.severity] || SEVERITY_BADGE.low;

  return h('details.advice-item', { dataset: { severity: item.severity } },
    h('summary.advice-head',
      h('span.advice-title', item.title),
      item.saving > 0 ? h('span.advice-saving', formatJpy(item.saving)) : null),
    h('div.advice-body',
      h('div', { style: { marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        badge(badgeText, badgeKind),
        badge(CATEGORY_LABELS[item.category] || item.category, 'neutral')),
      h('p', item.body),
      item.action
        ? h('div.advice-action', h('strong', 'What to do'), item.action)
        : null,
      item.link
        ? h('p', { style: { marginTop: '8px' } },
          h('a', { href: item.link.url, target: '_blank', rel: 'noopener noreferrer' }, item.link.label, ' ↗'))
        : null,
      item.statute ? h('p.advice-statute', item.statute) : null));
}

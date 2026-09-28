/**
 * Tax view.
 *
 * Shows every levy with its full derivation, because a tax figure you cannot
 * trace is a tax figure you cannot defend — at the tax office or to yourself.
 * Each section expands to the line-by-line arithmetic and cites the statute.
 */

import { h, card, derivationRow, details, badge, button } from '../ui/dom.js';
import { statTile, rankedBars } from '../ui/charts.js';
import { formatJpy } from '../fx.js';
import { getState, setView } from '../store.js';
import { derive } from '../derive.js';
import { RESIDENCY_LABELS } from '../tax/sourcing.js';
import { estimateFurusatoLimit } from '../tax/advisor.js';

export function taxView() {
  const state = getState();
  const d = derive();
  const { computed, rates, year, residency, sourcing, filingComparison } = d;
  const s = computed.summary;

  const view = h('div.view');

  // ------------------------------------------------------------------ headline
  view.append(h('div.stat-grid',
    statTile({
      label: `Total for ${year}`,
      value: formatJpy(s.totalBurden),
      sub: `${(s.effectiveRate * 100).toFixed(1)}% of revenue`,
      tone: 'hero',
    }),
    statTile({
      label: 'Due at filing',
      ja: '申告納税額',
      value: formatJpy(computed.incomeTax.refund > 0 ? computed.incomeTax.refund : computed.incomeTax.balanceDue),
      sub: computed.incomeTax.refund > 0 ? 'refund' : `by ${rates.filingDeadline}`,
      tone: computed.incomeTax.refund > 0 ? 'good' : 'neutral',
    })));

  // ------------------------------------------------------------ residency card
  view.append(card('Your tax position',
    h('div.deriv',
      derivationRow({ label: 'Residency status', ja: RESIDENCY_LABELS[residency.status]?.ja }),
      h('div.deriv-note', h('span.deriv-label', residency.reason))),
    sourcing.explanation.length
      ? details('How your income is taxed',
        ...sourcing.explanation.map((e) => h('p', { style: { fontSize: '0.84rem', marginBottom: '8px' } }, e)),
        h('p.advice-statute', sourcing.statute))
      : null,
    h('div.deriv', { style: { marginTop: '10px' } },
      derivationRow({ label: 'Japan-source income', ja: '国内源泉所得', amount: sourcing.japanSourceTaxable }),
      sourcing.foreignSourceTaxable > 0
        ? derivationRow({ label: 'Foreign-source, taxable', ja: '国外源泉所得（課税）', amount: sourcing.foreignSourceTaxable })
        : null,
      sourcing.shelteredAmount > 0
        ? derivationRow({ label: 'Foreign-source, outside the net', amount: sourcing.shelteredAmount })
        : null)));

  // -------------------------------------------------------------- the breakdown
  view.append(card('All levies',
    rankedBars(s.breakdown.map((b) => ({
      label: b.label, ja: b.ja, value: b.amount,
      share: s.totalBurden > 0 ? b.amount / s.totalBurden : 0,
      series: b.key === 'nhi' || b.key === 'pension' ? 'insurance' : 'tax',
    })), { title: 'Breakdown' })));

  // -------------------------------------------------------- business income
  view.append(card('Business income · 事業所得',
    h('div.deriv', ...computed.business.lines.map(derivationRow)),
    computed.business.blueDeductionForgone > 0
      ? h('div.banner.banner-warning', { style: { marginTop: '10px' } },
        h('span.banner-icon', '⚠'),
        h('div.banner-body',
          `${formatJpy(computed.business.blueDeductionForgone)} of your blue-return deduction is unused, because `
          + 'the deduction cannot exceed your profit. It cannot be carried forward either.'))
      : null));

  // ------------------------------------------------------------ income tax
  view.append(card('Income tax · 所得税',
    h('div.deriv', ...computed.incomeTax.lines.map(derivationRow)),
    details('Deductions in detail · 所得控除',
      h('div.deriv', ...computed.deductions.lines.map((l) => derivationRow({
        label: l.label, ja: l.ja, amount: l.amount,
      }))),
      h('div.deriv-note', { style: { marginTop: '6px' } },
        h('span.deriv-label',
          'Resident tax uses smaller amounts for most of these, which is why the two taxable-income figures differ.')),
      ...computed.deductions.lines.filter((l) => l.note).map((l) =>
        h('p.field-hint', { style: { marginTop: '6px' } }, l.note))),
    h('p.advice-statute', `Bracket: ${(computed.incomeTax.bracket.rate * 100).toFixed(0)}% `
      + `· 所得税法 89条 · 復興財源確保法 13条`)));

  // ---------------------------------------------------------- resident tax
  const rt = computed.residentTax;
  view.append(card('Resident tax · 住民税',
    h('div.deriv', ...rt.lines.map(derivationRow),
      derivationRow({ label: 'Total', amount: rt.total, total: true })),
    h('p.field-hint', { style: { marginTop: '8px' } },
      rt.exempt
        ? 'Your income is below the non-taxable threshold, so no resident tax is due.'
        : `Billed by your city from June ${year + 1}, in four instalments. It is charged on `
          + `${year} income even if ${year + 1} turns out to be much worse — which is what makes it the levy that `
          + 'catches people out.')));

  // -------------------------------------------------------- enterprise tax
  const et = computed.enterpriseTax;
  view.append(card('Enterprise tax · 個人事業税',
    et.applicable
      ? h('div', h('div.deriv', ...et.lines.map(derivationRow)), h('p.field-hint', { style: { marginTop: '8px' } }, et.note))
      : h('div',
        h('div', { style: { marginBottom: '8px' } }, badge('Not applicable', 'good')),
        h('p.field-hint', et.note)),
    h('p.advice-statute', '地方税法 72条の2')));

  // ---------------------------------------------------------- consumption tax
  const ct = computed.consumptionTax;
  view.append(card('Consumption tax · 消費税',
    ct.isTaxablePerson
      ? h('div',
        h('div.deriv', ...ct.lines.map(derivationRow),
          derivationRow({ label: 'Payable', amount: ct.total, total: true })),
        h('p.field-hint', { style: { marginTop: '8px' } }, ct.note))
      : h('div',
        h('div', { style: { marginBottom: '8px' } }, badge('Exempt', 'good')),
        h('p.field-hint', ct.note)),
    h('p.advice-statute', '消費税法 9条, 37条')));

  // ------------------------------------------------- health insurance, pension
  view.append(card('Health insurance · 国民健康保険',
    h('div.deriv', ...computed.nhi.lines.map(derivationRow)),
    h('div.banner.banner-info', { style: { marginTop: '10px' } },
      h('span.banner-icon', 'ℹ'),
      h('div.banner-body', computed.nhi.note)),
    h('p.field-hint', { style: { marginTop: '8px' } },
      `This is a projection of the bill you will receive in ${year + 1}, based on ${year} income. The `
      + `${formatJpy(state.settings.paidHealthInsurance)} in your deductions is what you actually paid during `
      + `${year}, which was assessed on ${year - 1} income. The two are different numbers on purpose.`)));

  view.append(card('National pension · 国民年金',
    h('div.deriv',
      derivationRow({ label: `Monthly premium × ${computed.pension.months}`, amount: computed.pension.monthly * computed.pension.months }),
      computed.pension.supplementary
        ? derivationRow({ label: '付加年金 (400/month)', amount: computed.pension.supplementary })
        : null,
      derivationRow({ label: 'Annual total', amount: computed.pension.total, total: true })),
    h('p.field-hint', { style: { marginTop: '8px' } }, computed.pension.note)));

  // ------------------------------------------------------------- prepayments
  if (computed.estimatedTax.required) {
    view.append(card('Prepayments · 予定納税',
      h('div.deriv', ...computed.estimatedTax.installments.map((i) => derivationRow({
        label: `${i.label} — due ${i.due}`, amount: i.amount,
      })), derivationRow({ label: 'Total prepayable', amount: computed.estimatedTax.total, total: true })),
      h('div.banner.banner-warning', { style: { marginTop: '10px' } },
        h('span.banner-icon', '⚠'),
        h('div.banner-body', computed.estimatedTax.note))));
  }

  // -------------------------------------------------------- filing comparison
  view.append(card('What your filing choice is worth',
    h('div.compare-grid', ...filingComparison.results.map((r) => h('div.compare-row', {
      class: r.option === state.settings.blueReturnType ? 'is-best' : '',
    },
    h('span.compare-main',
      h('span.compare-name', r.en, ' ', r.option === state.settings.blueReturnType ? badge('current', 'accent') : null),
      h('span.compare-effort', `${r.ja} · ${r.effort}`)),
    h('span.compare-figures',
      h('span.compare-burden', formatJpy(r.totalBurden)),
      r.savingVsWhite > 0 ? h('span.compare-saving', `saves ${formatJpy(r.savingVsWhite)}`) : null)))),
    details('What else the blue return gives you',
      h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '0.84rem', lineHeight: '1.6' } },
        ...Object.values(filingComparison.extras).map((e) => h('li', e))))));

  // -------------------------------------------------------------- furusato
  const furusato = estimateFurusatoLimit(computed);
  if (furusato > 0) {
    view.append(card('ふるさと納税 ceiling',
      h('div.stat-grid', statTile({
        label: 'Approximate limit',
        value: formatJpy(furusato),
        sub: 'donate up to this and only 2,000 yen is a real cost',
      })),
      h('p.field-hint', { style: { marginTop: '8px' } },
        'An estimate derived from your resident tax and marginal rate. It moves with your final income, so leave '
        + 'some headroom rather than donating right up to the line.')));
  }

  // ---------------------------------------------------------------- sources
  view.append(card('Where these figures come from',
    h('p.field-hint', `Rate tables for ${rates.year}, last verified ${rates.meta.verified}. ${rates.meta.caveat}`),
    h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px', fontSize: '0.8rem', lineHeight: '1.7' } },
      ...rates.meta.sources.map((src) => h('li',
        h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.label))))));

  view.append(h('div.btn-row',
    button('See what to do about it', { class: 'btn-primary btn-block', onclick: () => setView('advisor') })));

  return view;
}

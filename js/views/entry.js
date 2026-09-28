/**
 * Transaction entry.
 *
 * The screen that decides whether the books get kept, so it is built around one
 * rule: the fastest correct path must be the default path.
 *
 * Two things are handled deliberately here rather than left to the user:
 *
 *   FX rate locking. When money arrives in a foreign currency, the first field
 *   asked for is the yen the bank actually credited — not a rate to look up. That
 *   makes the strongest possible audit record the least effort, and the rate is
 *   derived from it.
 *
 *   家事按分. Any account flagged as shareable with private life gets a business-use
 *   slider pre-filled from settings, so a mixed cost is never silently claimed in
 *   full.
 */

import { h, field, input, moneyInput, select, checkbox, button, sheet, parseMoney, todayIso } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  CURRENCIES, RATE_SOURCE, RATE_SOURCE_META, formatJpy, validateRate,
  fetchReferenceRate, deriveCrossRate,
} from '../fx.js';
import { QUICK_CATEGORIES, ACCOUNTS, ACCOUNTS_BY_CODE, EXPENSE_ACCOUNTS, NOT_DEDUCTIBLE } from '../accounting/accounts.js';
import { getState, saveTransaction, setTaxYear, toast } from '../store.js';
import { recommendTreatment } from '../accounting/depreciation.js';

/** The quick-pick grid that opens when you press the add button. */
export function openQuickAdd() {
  const tiles = QUICK_CATEGORIES.map((cat) => h('button.quick-tile', {
    type: 'button',
    class: cat.kind === 'income' ? 'is-income' : '',
    onclick: () => { close(); openEntryForm(cat); },
  }, icon(cat.icon), h('span', cat.label)));

  const { close } = sheet('What are you recording?', h('div',
    h('div.quick-grid', ...tiles),
    h('p.field-hint', { style: { marginTop: '14px' } },
      'Pick the closest match. You can change the account afterwards, and the app posts the double-entry for you.')));
}

/**
 * The entry form itself.
 * @param {object} category a QUICK_CATEGORIES entry
 * @param {object} existing a transaction to edit, if any
 */
export function openEntryForm(category, existing = null) {
  const state = getState();
  const settings = state.settings;
  const isIncome = category.kind === 'income';
  const isTransfer = category.kind === 'transfer';

  // ------------------------------------------------------------------ state
  const draft = {
    id: existing?.id,
    kind: existing?.kind || (isIncome ? 'income' : isTransfer ? 'transfer' : 'expense'),
    date: existing?.date || todayIso(),
    account: existing?.account || category.account,
    currency: existing?.fx?.currency || (isIncome ? (settings.currencies[1] || 'JPY') : 'JPY'),
    amount: existing?.fx?.amount ?? '',
    jpyCredited: '',
    rate: '',
    rateSource: settings.defaultRateSource || RATE_SOURCE.BANK_ACTUAL,
    fees: existing?.fx?.fees ?? '',
    bankName: existing?.fx?.bankName || settings.primaryBank || '',
    sourceNote: existing?.fx?.sourceNote || '',
    description: existing?.description || '',
    clientId: existing?.clientId || '',
    settlement: existing?.settlement || '110',
    businessRatio: existing?.businessRatio ?? defaultRatio(category, settings),
    ratioBasis: existing?.ratioBasis || settings.homeOfficeBasis || '',
    withholding: existing?.withholding ?? '',
    // Sourcing, for the non-permanent resident analysis.
    incomeSource: existing?.incomeSource || 'japan',
    paidIn: existing?.paidIn || 'japan',
    workPerformedIn: existing?.workPerformedIn || 'japan',
    isExportExempt: existing?.isExportExempt ?? true,
    isRemittance: existing?.isRemittance ?? false,
    from: existing?.from || '110',
    to: existing?.to || category.account,
  };

  const body = h('div');
  const { close } = sheet(existing ? 'Edit entry' : category.label, body);

  // Re-rendered in place whenever a choice changes what else is relevant.
  const render = () => {
    body.replaceChildren();

    // ---------------------------------------------------------- amount block
    const currencyOptions = settings.currencies.map((c) => ({
      value: c, label: `${c} — ${CURRENCIES[c]?.label || c}`,
    }));

    const amountInput = moneyInput({
      name: 'amount',
      value: draft.amount,
      placeholder: '0',
      oninput: (e) => { draft.amount = e.target.value; updateRatePreview(); },
    });

    const currencySelect = select(currencyOptions, {
      name: 'currency',
      value: draft.currency,
      onchange: (e) => { draft.currency = e.target.value; render(); },
    });

    body.append(h('div.field-row',
      field('Amount', amountInput),
      field('Currency', currencySelect)));

    // ------------------------------------------------------- FX rate locking
    const ratePreview = h('div.rate-preview');
    const updateRatePreview = () => renderRatePreview(ratePreview, draft);

    if (draft.currency !== 'JPY') {
      body.append(buildFxBlock(draft, { render, updateRatePreview, ratePreview }));
    }

    // ------------------------------------------------------------ core fields
    body.append(field('Date', input({
      type: 'date', name: 'date', value: draft.date,
      onchange: (e) => { draft.date = e.target.value; updateRatePreview(); },
    }), draft.currency !== 'JPY'
      ? 'Use the date the money actually moved. The exchange rate must match this date.'
      : null));

    body.append(field('Description', input({
      name: 'description',
      value: draft.description,
      placeholder: isIncome ? 'Client name and what for' : 'What it was for',
      oninput: (e) => { draft.description = e.target.value; },
    }), 'Specific beats vague. In seven years this is all you will have.'));

    // ------------------------------------------------------------- account
    if (!isTransfer) {
      const accountOptions = (isIncome
        ? ACCOUNTS.filter((a) => a.type === 'revenue')
        : EXPENSE_ACCOUNTS
      ).map((a) => ({ value: a.code, label: `${a.ja} — ${a.en}` }));

      body.append(field('Account (勘定科目)', select(accountOptions, {
        name: 'account',
        value: draft.account,
        onchange: (e) => { draft.account = e.target.value; render(); },
      }), ACCOUNTS_BY_CODE[draft.account]?.hint));
    }

    // ------------------------------------------- 家事按分 business-use split
    const accountMeta = ACCOUNTS_BY_CODE[draft.account];
    if (!isIncome && !isTransfer && (accountMeta?.homeOfficeEligible || draft.businessRatio < 1)) {
      body.append(buildRatioBlock(draft, render));
    }

    // ------------------------------------------- income-specific: sourcing
    if (isIncome) {
      body.append(buildSourcingBlock(draft, render, settings));
      body.append(field('Tax withheld by the payer (源泉徴収税額)', moneyInput({
        name: 'withholding',
        value: draft.withholding, placeholder: '0',
        oninput: (e) => { draft.withholding = e.target.value; },
      }), 'Japanese clients often withhold 10.21%. Leave at zero for foreign clients, who normally withhold nothing.'));
    }

    // --------------------------------------------- settlement / where it went
    if (!isTransfer) {
      body.append(field(isIncome ? 'Received into' : 'Paid from', select([
        { value: '110', label: '普通預金 — Japanese bank account' },
        { value: '111', label: '外貨預金 — Foreign currency account' },
        { value: '100', label: '現金 — Cash' },
        { value: isIncome ? '120' : '210', label: isIncome ? '売掛金 — Invoiced, not yet paid' : '未払金 — Incurred, not yet paid' },
        ...(isIncome ? [] : [{ value: '260', label: '事業主借 — Personal card or cash' }]),
      ], {
        value: draft.settlement,
        onchange: (e) => { draft.settlement = e.target.value; },
      })));
    } else {
      body.append(h('div.field-row',
        field('From', select(transferAccounts(), {
          value: draft.from, onchange: (e) => { draft.from = e.target.value; },
        })),
        field('To', select(transferAccounts(), {
          value: draft.to, onchange: (e) => { draft.to = e.target.value; },
        }))));
    }

    // ------------------------------------------------- large purchase warning
    const amountJpy = estimateJpy(draft);
    if (!isIncome && !isTransfer && amountJpy >= 100_000) {
      body.append(buildAssetAdvice(amountJpy, draft));
    }

    // ------------------------------------------------- non-deductible reminder
    if (draft.account === '599' || draft.account === '530') {
      body.append(h('details.disclosure',
        h('summary', 'What cannot go here'),
        h('div.disclosure-body',
          h('ul', { style: { margin: '0', paddingLeft: '18px', fontSize: '0.8rem', lineHeight: '1.5' } },
            ...NOT_DEDUCTIBLE.slice(0, 6).map((n) => h('li', h('strong', n.item), ' — ', n.reason))))));
    }

    // ------------------------------------------------------------- save row
    body.append(h('div.btn-row', { style: { marginTop: '18px' } },
      button('Cancel', { class: 'btn-ghost', onclick: close }),
      button(existing ? 'Save changes' : 'Save', {
        class: 'btn-primary',
        name: 'save',
        onclick: async () => {
          try {
            const saved = await commit(draft);
            close();
            // An entry dated in another year would otherwise vanish from view,
            // so follow it rather than leaving the user wondering.
            if (saved.year !== getState().taxYear) {
              await setTaxYear(saved.year);
              toast(`Saved to ${saved.year} — switched year to show it`, 'success');
            } else {
              toast(existing ? 'Entry updated' : 'Entry saved', 'success');
            }
          } catch (err) {
            toast(err.message || 'Could not save', 'error');
          }
        },
      })));

    updateRatePreview();
  };

  render();
}

function transferAccounts() {
  return [
    { value: '110', label: '普通預金 — Bank' },
    { value: '111', label: '外貨預金 — Foreign currency' },
    { value: '100', label: '現金 — Cash' },
    { value: '140', label: '事業主貸 — Taken for personal use' },
    { value: '260', label: '事業主借 — Personal money in' },
    { value: '300', label: '元入金 — Opening capital' },
  ];
}

function defaultRatio(category, settings) {
  if (!category.homeOffice) return 1;
  const r = settings.homeOfficeRatios || {};
  if (category.id === 'rent') return r.rent ?? 0.25;
  if (category.id === 'utilities') return r.utilities ?? 0.25;
  if (category.id === 'internet') return r.communication ?? 0.6;
  return 0.5;
}

/**
 * The FX block.
 *
 * Ordered so the strongest evidence is the least work: the yen your bank
 * actually credited comes first, and a rate only has to be entered when the bank
 * did not convert for you.
 */
function buildFxBlock(draft, { render, updateRatePreview, ratePreview }) {
  const meta = CURRENCIES[draft.currency] || {};
  const wrap = h('fieldset.fieldset', h('legend', 'Exchange rate'));

  wrap.append(h('div.segmented',
    ...[
      { value: RATE_SOURCE.BANK_ACTUAL, label: 'Bank converted' },
      { value: RATE_SOURCE.BANK_TTB, label: 'Bank TTB' },
      { value: RATE_SOURCE.MANUAL, label: 'Manual' },
    ].map((opt) => h('button.segmented-item', {
      type: 'button',
      class: draft.rateSource === opt.value ? 'is-active' : '',
      onclick: () => { draft.rateSource = opt.value; render(); },
    }, opt.label))));

  const metaInfo = RATE_SOURCE_META[draft.rateSource];
  wrap.append(h('p.field-hint', { style: { marginTop: '8px' } }, metaInfo?.hint));

  if (draft.rateSource === RATE_SOURCE.BANK_ACTUAL) {
    wrap.append(field('Yen actually credited', moneyInput({
      name: 'jpyCredited',
      value: draft.jpyCredited, placeholder: '0',
      oninput: (e) => { draft.jpyCredited = e.target.value; updateRatePreview(); },
    }), 'Copy the yen figure from your bank statement. The rate is derived from it, so it matches your records '
      + 'exactly and needs no external source.'));

    wrap.append(field('Conversion or transfer fee, if shown separately', moneyInput({
      name: 'fees',
      value: draft.fees, placeholder: '0',
      oninput: (e) => { draft.fees = e.target.value; updateRatePreview(); },
    }), 'Recorded as a deductible 支払手数料 and added back when deriving the rate, so the fee does not disguise '
      + 'itself as a worse exchange rate.'));
  } else {
    const rateRow = field(`Rate (JPY per 1 ${draft.currency})`, moneyInput({
      name: 'rate',
      value: draft.rate, placeholder: '0.0000',
      oninput: (e) => { draft.rate = e.target.value; updateRatePreview(); },
    }));
    wrap.append(rateRow);

    // Offer a reference lookup, clearly labelled as not an official source.
    wrap.append(h('div.btn-row',
      button('Look up a reference rate', {
        class: 'btn-sm btn-ghost',
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Fetching…';
          const result = await fetchReferenceRate(draft.currency, draft.date);
          e.target.disabled = false;
          e.target.textContent = 'Look up a reference rate';
          if (result) {
            draft.rate = result.rate.toFixed(4);
            draft.rateSource = RATE_SOURCE.API;
            draft.sourceNote = `Reference rate from ${result.fetchedFrom} for ${result.rateDate}. `
                             + 'Replace with a bank rate before filing.';
            render();
            toast('Reference rate filled in — replace it with your bank rate before filing');
          } else {
            toast('Could not fetch a rate. Enter it from your bank.', 'error');
          }
        },
      })));

    if (meta.requiresCrossRate) {
      wrap.append(buildCrossRateHelper(draft, render));
    }

    wrap.append(field('Where this rate came from', input({
      name: 'sourceNote',
      value: draft.sourceNote,
      placeholder: 'e.g. MUFG TTB 2025-03-15',
      oninput: (e) => { draft.sourceNote = e.target.value; },
    }), 'An unexplained rate is the weakest position in an audit. One line is enough.'));
  }

  wrap.append(field('Bank', input({
    name: 'bankName',
    value: draft.bankName, placeholder: 'e.g. SMBC, MUFG, Japan Post',
    oninput: (e) => { draft.bankName = e.target.value; },
  })));

  wrap.append(ratePreview);

  if (meta.officialSources?.length) {
    wrap.append(h('details.disclosure',
      h('summary', `Official rate sources for ${draft.currency}`),
      h('div.disclosure-body',
        meta.warning ? h('p.field-hint', meta.warning) : null,
        h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '0.8rem', lineHeight: '1.6' } },
          ...meta.officialSources.map((s) => h('li',
            h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label)))))));
  }

  return wrap;
}

/** Derives a JPY rate through USD, for currencies no Japanese bank quotes. */
function buildCrossRateHelper(draft, render) {
  const box = h('div.card.card-sunken', { style: { marginBottom: '14px' } });
  box.append(h('h3', { style: { fontSize: '0.8rem', marginBottom: '8px' } }, 'Build a cross rate through USD'));

  let foreignPerUsd = draft.crossRate?.legs?.foreignPerUsd || '';
  let jpyPerUsd = draft.crossRate?.legs?.jpyPerUsd || '';

  const result = h('p.field-hint');
  const recalc = () => {
    const a = parseMoney(foreignPerUsd);
    const b = parseMoney(jpyPerUsd);
    if (a > 0 && b > 0) {
      const cross = deriveCrossRate({ foreignPerUsd: a, jpyPerUsd: b });
      draft.rate = cross.rate.toFixed(4);
      draft.crossRate = cross;
      draft.sourceNote = cross.note;
      result.textContent = cross.note;
    } else {
      result.textContent = 'Enter both legs to derive the rate.';
    }
  };

  box.append(h('div.field-row',
    field(`${draft.currency} per USD`, moneyInput({
      value: foreignPerUsd, placeholder: '0.0000',
      oninput: (e) => { foreignPerUsd = e.target.value; recalc(); },
    })),
    field('JPY per USD', moneyInput({
      value: jpyPerUsd, placeholder: '0.00',
      oninput: (e) => { jpyPerUsd = e.target.value; recalc(); },
    }))));
  box.append(result);
  box.append(h('div.btn-row',
    button('Use this rate', { class: 'btn-sm', onclick: () => render() })));
  recalc();
  return box;
}

/** Live preview of what will actually be booked, plus validation. */
function renderRatePreview(el, draft) {
  el.replaceChildren();
  if (draft.currency === 'JPY') return;

  const amount = parseMoney(draft.amount);
  if (!amount) {
    el.append(h('span.rate-preview-note', 'Enter an amount to see what will be booked.'));
    return;
  }

  let rate = 0;
  let jpy = 0;
  if (draft.rateSource === RATE_SOURCE.BANK_ACTUAL) {
    const credited = parseMoney(draft.jpyCredited);
    if (!credited) {
      el.append(h('span.rate-preview-note', 'Enter the yen your bank credited.'));
      return;
    }
    jpy = credited;
    rate = (credited + parseMoney(draft.fees)) / amount;
  } else {
    rate = parseMoney(draft.rate);
    if (!rate) {
      el.append(h('span.rate-preview-note', 'Enter a rate.'));
      return;
    }
    jpy = Math.round(amount * rate);
  }

  const meta = RATE_SOURCE_META[draft.rateSource];
  el.append(h('span.rate-preview-main', `${formatJpy(jpy)}`));
  el.append(h('span.rate-preview-note',
    `${amount.toLocaleString()} ${draft.currency} at ${rate.toFixed(4)} JPY. `
    + `Evidence strength: ${meta?.audit || 'unknown'}.`));

  el.append(h('div.fx-strength',
    h('span.fx-pips', ...Array.from({ length: 5 }, (_, i) => h('span.fx-pip', {
      class: i < (meta?.weight || 0) ? (meta.weight >= 4 ? 'is-on' : 'is-weak') : '',
    })))));

  for (const issue of validateRate(draft.currency, rate, draft.date)) {
    el.append(h(`span.rate-preview-note`, {
      style: { color: issue.level === 'error' ? 'var(--critical-text)' : 'var(--ink-muted)' },
    }, `${issue.level === 'error' ? '⚠ ' : ''}${issue.message}`));
  }
}

/** 家事按分 — the business-use slider, with its basis recorded. */
function buildRatioBlock(draft, render) {
  const wrap = h('fieldset.fieldset', h('legend', '家事按分 — business use'));
  const pct = Math.round((draft.businessRatio ?? 1) * 100);

  const readout = h('span.meter-value', `${pct}% business`);
  const slider = h('input', {
    type: 'range', min: '0', max: '100', step: '5', value: pct,
    style: { width: '100%', accentColor: 'var(--accent)' },
    oninput: (e) => {
      draft.businessRatio = Number(e.target.value) / 100;
      readout.textContent = `${e.target.value}% business`;
      splitNote.textContent = describeSplit(draft);
    },
  });

  const splitNote = h('p.field-hint', describeSplit(draft));

  wrap.append(h('div.meter-head', h('span.meter-label', 'Business share'), readout));
  wrap.append(slider);
  wrap.append(splitNote);
  wrap.append(field('Basis for the split', input({
    name: 'ratioBasis',
    value: draft.ratioBasis,
    placeholder: 'e.g. work room 12m² of 48m² total',
    oninput: (e) => { draft.ratioBasis = e.target.value; },
  }), 'Write it down once and reuse it. This single line is what makes the percentage defensible.'));
  return wrap;
}

function describeSplit(draft) {
  const jpy = estimateJpy(draft);
  if (!jpy) return 'The private share is posted to 事業主貸, not discarded, so your bank balance still reconciles.';
  const biz = Math.round(jpy * (draft.businessRatio ?? 1));
  return `${formatJpy(biz)} deductible, ${formatJpy(jpy - biz)} to 事業主貸 (private).`;
}

/**
 * Income sourcing.
 *
 * Worth the extra taps, because it drives the whole non-permanent resident
 * analysis — and because the honest answer to "where did you do the work"
 * usually means the income is Japan-source whatever the client's location.
 */
function buildSourcingBlock(draft, render, settings) {
  const wrap = h('fieldset.fieldset', h('legend', 'Where this income comes from'));

  wrap.append(field('Where you did the work', select([
    { value: 'japan', label: 'In Japan' },
    { value: 'abroad', label: 'Entirely outside Japan' },
    { value: 'mixed', label: 'Both — needs apportioning' },
  ], {
    value: draft.workPerformedIn,
    onchange: (e) => {
      draft.workPerformedIn = e.target.value;
      // Work in Japan means Japan-source, so keep the two consistent.
      if (e.target.value === 'japan') draft.incomeSource = 'japan';
      render();
    },
  })));

  if (draft.workPerformedIn === 'japan') {
    wrap.append(h('div.banner.banner-info',
      h('span.banner-icon', 'ℹ'),
      h('div.banner-body',
        h('strong', 'Japan-source income.'),
        ' Work performed while you are physically in Japan is Japan-source and fully taxable, however the client '
        + 'is located, whatever currency you invoiced, and wherever the money landed. Your non-permanent resident '
        + 'status does not shelter it.')));
    draft.incomeSource = 'japan';
  } else {
    wrap.append(field('Income source', select([
      { value: 'foreign', label: 'Foreign-source (国外源泉所得)' },
      { value: 'japan', label: 'Japan-source (国内源泉所得)' },
    ], {
      value: draft.incomeSource,
      onchange: (e) => { draft.incomeSource = e.target.value; render(); },
    })));

    wrap.append(field('Where it was paid', select([
      { value: 'japan', label: 'Into a Japanese account' },
      { value: 'abroad', label: 'Into a foreign account' },
    ], {
      value: draft.paidIn,
      onchange: (e) => { draft.paidIn = e.target.value; render(); },
    })));

    if (draft.incomeSource === 'foreign' && draft.paidIn === 'japan') {
      wrap.append(h('div.banner.banner-warning',
        h('span.banner-icon', '⚠'),
        h('div.banner-body',
          h('strong', 'Paid in Japan, so taxable in full.'),
          ' Foreign-source income paid into a Japanese account is taxable immediately — no remittance analysis '
          + 'applies. Had it been paid abroad and left there, it would not be taxable this year.')));
    }
  }

  wrap.append(checkbox('Client is a non-resident, and the service is used outside Japan', {
    checked: draft.isExportExempt,
    onchange: (e) => { draft.isExportExempt = e.target.checked; },
  }));
  wrap.append(h('p.field-hint',
    'This makes the sale export-exempt (輸出免税) for consumption tax: zero-rated rather than exempt, so it still '
    + 'counts toward the 10 million yen registration threshold but carries no output tax.'));

  return wrap;
}

/** Nudges a large purchase toward the right depreciation treatment. */
function buildAssetAdvice(amountJpy, draft) {
  const { options } = recommendTreatment(amountJpy, {
    isBlueReturn: getState().settings.blueReturnType !== 'none',
    taxYear: Number(String(draft.date).slice(0, 4)),
  });

  return h('div.banner.banner-info',
    h('span.banner-icon', 'ℹ'),
    h('div.banner-body',
      h('strong', `${formatJpy(amountJpy)} is over the 100,000 yen line.`),
      ' You have a choice about timing:',
      h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', lineHeight: '1.5' } },
        ...options.map((o) => h('li',
          h('strong', o.label), ` — ${formatJpy(o.firstYearDeduction)} deductible this year. `,
          h('span', { style: { color: 'var(--ink-muted)' } }, o.note)))),
      h('p', { style: { marginTop: '8px', marginBottom: 0 } },
        'Save it here as a normal expense to take the whole cost now, or add it under Assets to depreciate it.')));
}

function estimateJpy(draft) {
  const amount = parseMoney(draft.amount);
  if (!amount) return 0;
  if (draft.currency === 'JPY') return amount;
  if (draft.rateSource === RATE_SOURCE.BANK_ACTUAL) return parseMoney(draft.jpyCredited);
  return Math.round(amount * parseMoney(draft.rate));
}

/** Validates, then hands the draft to the store, which locks the rate and posts. */
async function commit(draft) {
  const amount = parseMoney(draft.amount);
  if (!amount) throw new Error('Enter an amount.');
  if (!draft.date) throw new Error('Enter a date.');

  if (draft.currency !== 'JPY') {
    if (draft.rateSource === RATE_SOURCE.BANK_ACTUAL) {
      if (!parseMoney(draft.jpyCredited)) {
        throw new Error('Enter the yen your bank credited, or switch to entering a rate.');
      }
    } else if (!parseMoney(draft.rate)) {
      throw new Error('Enter an exchange rate.');
    }
    const rate = draft.rateSource === RATE_SOURCE.BANK_ACTUAL
      ? (parseMoney(draft.jpyCredited) + parseMoney(draft.fees)) / amount
      : parseMoney(draft.rate);
    const blocking = validateRate(draft.currency, rate, draft.date).filter((i) => i.level === 'error');
    if (blocking.length) throw new Error(blocking[0].message);
  }

  return saveTransaction({
    ...draft,
    amount,
    jpyCredited: draft.rateSource === RATE_SOURCE.BANK_ACTUAL ? parseMoney(draft.jpyCredited) : null,
    rate: draft.rateSource === RATE_SOURCE.BANK_ACTUAL ? null : parseMoney(draft.rate),
    fees: parseMoney(draft.fees),
    withholding: parseMoney(draft.withholding),
  });
}

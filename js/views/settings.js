/**
 * Settings.
 *
 * Grouped so each block maps onto one real-world thing: who you are for tax
 * purposes, how you file, your household, what you paid, and your data.
 *
 * Every field that feeds a calculation carries a note explaining what it changes,
 * because a tax app whose inputs are opaque produces numbers nobody trusts.
 */

import {
  h, card, field, input, select, checkbox, button, details,
  downloadFile, confirmDialog, parseMoney, badge,
} from '../ui/dom.js';
import { formatJpy, CURRENCIES } from '../fx.js';
import {
  getState, updateSettings, exportBackup, importBackup, wipeEverything,
  toast, saveYear, daysSinceBackup,
} from '../store.js';
import { derive, invalidate } from '../derive.js';
import { ratesFor, SUPPORTED_YEARS, pensionMonthly } from '../tax/rates.js';
import { db } from '../db.js';

export function settingsView() {
  const state = getState();
  const s = state.settings;
  const d = derive();
  const rates = d.rates;
  const year = state.taxYear;

  const view = h('div.view');

  const save = async (patch) => {
    await updateSettings(patch);
    invalidate();
  };

  const money = (key, label, hint) => field(label, input({
    type: 'text', inputmode: 'decimal', class: 'input input-money',
    value: s[key] || 0,
    onchange: (e) => save({ [key]: parseMoney(e.target.value) }),
  }), hint);

  // ------------------------------------------------------------------ profile
  view.append(card('You',
    field('Name', input({
      value: s.name, placeholder: 'As it appears on your residence card',
      onchange: (e) => save({ name: e.target.value }),
    })),
    field('Business name (屋号)', input({
      value: s.businessName, placeholder: 'Optional',
      onchange: (e) => save({ businessName: e.target.value }),
    }), 'Optional, and purely cosmetic for tax. A sole proprietor files under their own name.'),
    field('What your business does', input({
      value: s.businessDescription, placeholder: 'e.g. software development, translation, design',
      onchange: (e) => save({ businessDescription: e.target.value }),
    }), 'This determines your enterprise tax category, which is worth 5% of your profit. Be precise.'),
    field('City or ward', input({
      value: s.city, placeholder: 'e.g. Shibuya-ku, Osaka-shi',
      onchange: (e) => save({ city: e.target.value }),
    }), 'Health insurance rates are set per municipality.')));

  // ---------------------------------------------------------- tax residency
  view.append(card('Tax residency',
    h('p.field-hint', { style: { marginBottom: '12px' } },
      'This has nothing to do with your visa. A spouse visa lets you work without restriction; what matters for tax '
      + 'is only how long you have been resident here.'),
    field('When you arrived in Japan', input({
      type: 'date', value: s.arrivalDate,
      onchange: (e) => save({ arrivalDate: e.target.value }),
    }), 'Used to count the five years within the last ten that separate a 非永住者 from worldwide taxation.'),
    !s.arrivalDate
      ? field('Or: years resident in the last 10', input({
        type: 'number', step: '0.5', min: '0', max: '10', value: s.yearsInJapan,
        onchange: (e) => save({ yearsInJapan: Number(e.target.value) }),
      }))
      : null,
    checkbox('I am a Japanese national', {
      checked: s.isJapaneseNational,
      onchange: (e) => save({ isJapaneseNational: e.target.checked }),
    }),
    h('div.banner.banner-info', { style: { marginTop: '10px' } },
      h('span.banner-icon', 'ℹ'),
      h('div.banner-body',
        h('strong', 'Currently: '), d.residency.reason))));

  // ------------------------------------------------------------ filing posture
  view.append(card('How you file',
    field('Filing type', select([
      { value: 'etax_double_entry', label: '青色申告 — 650,000 deduction (double entry + e-Tax)' },
      { value: 'paper_double_entry', label: '青色申告 — 550,000 deduction (double entry, paper)' },
      { value: 'simple', label: '青色申告 — 100,000 deduction (simple books)' },
      { value: 'none', label: '白色申告 — no special deduction' },
    ], {
      value: s.blueReturnType,
      onchange: (e) => save({ blueReturnType: e.target.value }),
    }), `Currently worth ${formatJpy(rates.blueReturnDeduction[s.blueReturnType] || 0)} of deduction.`),

    field('Enterprise tax category', select([
      { value: 'category1', label: '第1種事業 — 5% (contracting, most IT work)' },
      { value: 'category2', label: '第2種事業 — 4% (livestock, fishing)' },
      { value: 'category3', label: '第3種事業 — 5% (professional services)' },
      { value: 'category3_reduced', label: '第3種事業 — 3% (massage, therapy)' },
      { value: 'exempt', label: 'Not listed — exempt (writing, art, composing)' },
    ], {
      value: s.enterpriseCategory,
      onchange: (e) => save({ enterpriseCategory: e.target.value }),
    }), 'Only the 70 categories in 地方税法 72条の2 are taxed. Writers, painters and composers are not among them '
      + 'and pay nothing. Ask your prefectural tax office which applies to you — it is worth 5%.'),

    field('Months trading this year', input({
      type: 'number', min: '1', max: '12', value: s.monthsInBusiness,
      onchange: (e) => save({ monthsInBusiness: Number(e.target.value) }),
    }), 'Under 12 pro-rates the 2,900,000 yen enterprise tax allowance.'),

    checkbox('I have filed my 開業届', {
      checked: s.filedKaigyoTodoke,
      onchange: (e) => save({ filedKaigyoTodoke: e.target.checked }),
    }),
    checkbox('My 青色申告承認申請書 is approved', {
      checked: s.filedBlueReturnApplication,
      onchange: (e) => save({ filedBlueReturnApplication: e.target.checked }),
    }),
    checkbox('I will file through e-Tax', {
      checked: s.willFileViaEtax,
      onchange: (e) => save({ willFileViaEtax: e.target.checked }),
    }),
    h('p.field-hint', 'Paper filing caps the blue-return deduction at 550,000 however good your books are.')));

  // ------------------------------------------------------------- consumption tax
  view.append(card('Consumption tax',
    checkbox('I am registered for consumption tax (インボイス登録済)', {
      checked: s.consumptionTaxRegistered,
      onchange: (e) => save({ consumptionTaxRegistered: e.target.checked }),
    }),
    s.consumptionTaxRegistered
      ? field('Invoice registration number', input({
        value: s.invoiceNumber, placeholder: 'T1234567890123',
        onchange: (e) => save({ invoiceNumber: e.target.value }),
      }))
      : null,
    field('Taxable sales two years ago (基準期間)', input({
      type: 'text', inputmode: 'decimal', class: 'input input-money',
      value: state.years[year]?.basePeriodTaxableSales || 0,
      onchange: async (e) => {
        await saveYear(year, { basePeriodTaxableSales: parseMoney(e.target.value) });
        invalidate();
        toast('Saved');
      },
    }), `Sales in ${year - 2} decide whether you are a taxable person in ${year}. Export-exempt sales count toward `
      + 'the 10 million yen threshold even though they carry no tax.'),
    field('Simplified scheme category', select(
      Object.entries(rates.consumptionTax.deemedPurchaseRates).map(([k, v]) => ({
        value: k, label: `${k.replace(/^type\d_/, '')} — ${(v * 100).toFixed(0)}% deemed input`,
      })), {
        value: s.simplifiedCategory,
        onchange: (e) => save({ simplifiedCategory: e.target.value }),
      }), 'Only relevant if you elect 簡易課税. Most freelance services are type 5, at 50%.')));

  // ------------------------------------------------------------------ household
  view.append(card('Household',
    field('Your age', input({
      type: 'number', min: '0', max: '120', value: s.age,
      onchange: (e) => save({ age: Number(e.target.value) }),
    }), 'Ages 40 to 64 pay the nursing care portion of health insurance.'),
    field('People in your household on your insurance', input({
      type: 'number', min: '1', max: '15', value: s.householdSize,
      onchange: (e) => save({ householdSize: Number(e.target.value) }),
    }), 'Each person adds a per-capita charge to national health insurance.'),
    checkbox('I have a spouse', {
      checked: s.hasSpouse,
      onchange: (e) => save({ hasSpouse: e.target.checked }),
    }),
    s.hasSpouse
      ? h('div',
        field('Spouse’s annual income (合計所得金額)', input({
          type: 'text', inputmode: 'decimal', class: 'input input-money',
          value: s.spouseIncome || 0,
          onchange: (e) => save({ spouseIncome: parseMoney(e.target.value) }),
        }), `Under ${formatJpy(rates.spouseDeduction.spouseIncomeCeiling)} gives you the full 配偶者控除. Above that, `
          + 'the sliding 配偶者特別控除 applies up to about 1,330,000. This is income after the salary deduction, '
          + 'not gross pay.'),
        field('Spouse’s age', input({
          type: 'number', min: '0', max: '120', value: s.spouseAge || 0,
          onchange: (e) => save({ spouseAge: Number(e.target.value) }),
        })))
      : null,
    dependentsEditor(state, save)));

  // ------------------------------------------ health insurance and pension
  view.append(card('Health insurance and pension',
    field('Health insurance rates', select(
      Object.entries(rates.nhiPresets).map(([k, v]) => ({ value: k, label: v.label })), {
        value: s.nhiPreset,
        onchange: (e) => save({ nhiPreset: e.target.value }),
      }), 'Every municipality sets its own rates and revises them each April. Pick the closest, then override below '
        + 'from your own 保険料決定通知書 for an exact figure.'),
    nhiOverrides(s, rates, save),
    field('Months of pension contributions', input({
      type: 'number', min: '0', max: '12', value: s.pensionMonths,
      onchange: (e) => save({ pensionMonths: Number(e.target.value) }),
    }), `Currently ${formatJpy(pensionMonthly(rates, new Date(`${year}-06-01`)))} a month.`),
    checkbox('I pay 付加年金 (400 yen a month)', {
      checked: s.pensionSupplementary,
      onchange: (e) => save({ pensionSupplementary: e.target.checked }),
    }),
    h('p.field-hint', '400 yen a month buys 200 yen × months of extra annual pension for life. It breaks even after '
      + 'two years of collecting, which makes it the best-value option a 第1号被保険者 has.')));

  // --------------------------------------------------- deductions actually paid
  view.append(card(`What you paid during ${year}`,
    h('p.field-hint', { style: { marginBottom: '12px' } },
      'These are deductible in the year you hand over the cash, not the year they were assessed. What you paid in '
      + `${year} was billed on ${year - 1} income, which is why it will not match the app’s projection for `
      + `${year}. Both numbers are correct; they answer different questions.`),
    money('paidNationalPension', 'National pension paid', '国民年金保険料. Fully deductible, no cap.'),
    money('paidHealthInsurance', 'Health insurance paid', '国民健康保険料. Fully deductible, no cap.'),
    money('smallEnterpriseMutual', '小規模企業共済 contributions',
      `Up to ${formatJpy(rates.pensionSchemes.smallEnterprise.annualMax)} a year, fully deductible, and the money `
      + 'stays yours.'),
    money('ideco', 'iDeCo contributions',
      `Up to ${formatJpy(rates.pensionSchemes.ideco.annualMax)} a year. Separate ceiling from 小規模企業共済, so both `
      + 'can be used, but locked until you are 60.'),
    money('lifeInsurance', 'Life insurance premiums',
      `Capped at ${formatJpy(rates.insuranceDeductions.life.totalMax)} for income tax.`),
    money('earthquakeInsurance', 'Earthquake insurance premiums',
      `Capped at ${formatJpy(rates.insuranceDeductions.earthquake.max)}.`),
    money('medicalExpenses', 'Medical expenses',
      'Only the amount above the lesser of 5% of income or 100,000 yen is deductible. Includes your household.'),
    money('donations', 'Donations including ふるさと納税',
      'Everything above 2,000 yen reduces income tax and resident tax.')));

  // --------------------------------------------------------- other income
  view.append(card('Other income', details('Income outside your business',
    otherIncomeField(state, 'salaryIncome', 'Employment income (gross)',
      'Gross pay before the salary deduction, which the app applies for you.'),
    otherIncomeField(state, 'miscellaneousIncome', 'Miscellaneous income (雑所得)',
      'Crypto gains, occasional one-off work, foreign pension.'),
    otherIncomeField(state, 'realEstateIncome', 'Rental income (不動産所得)', 'Net of expenses.'),
    otherIncomeField(state, 'lossCarryforward', 'Losses carried forward',
      'Blue-return losses from the previous three years.'),
    otherIncomeField(state, 'estimatedTaxPaid', 'Prepayments already made (予定納税額)', ''),
    otherIncomeField(state, 'foreignTaxCredit', 'Foreign tax credit (外国税額控除)',
      'Foreign tax already paid on income also taxed here. Relevant once you are taxed on worldwide income.'))));

  // ----------------------------------------------------------------- currency
  view.append(card('Currency and banking',
    field('Main bank', input({
      value: s.primaryBank, placeholder: 'e.g. SMBC',
      onchange: (e) => save({ primaryBank: e.target.value }),
    }), 'The bank whose published rates you will use. Stick to one for the whole year.'),
    field('Currencies you use', h('div', ...Object.keys(CURRENCIES).map((code) => checkbox(
      `${code} — ${CURRENCIES[code].label}`, {
        checked: s.currencies.includes(code),
        disabled: code === 'JPY',
        onchange: (e) => {
          const next = e.target.checked
            ? [...new Set([...s.currencies, code])]
            : s.currencies.filter((c) => c !== code);
          save({ currencies: next.includes('JPY') ? next : ['JPY', ...next] });
        },
      })))),
    field('Default rate source', select([
      { value: 'bank_actual', label: 'Yen my bank actually credited (strongest)' },
      { value: 'bank_ttb', label: 'Bank TTB (statutory default for income)' },
      { value: 'bank_ttm', label: 'Bank TTM (must be consistent all year)' },
      { value: 'manual', label: 'Manual entry' },
    ], {
      value: s.defaultRateSource,
      onchange: (e) => save({ defaultRateSource: e.target.value }),
    }), 'When your bank converts incoming foreign currency itself, the yen it credited is both the most accurate '
      + 'figure and the easiest to defend. Nothing to look up.')));

  // ------------------------------------------------------------ home office
  view.append(card('Home office defaults (家事按分)',
    h('p.field-hint', { style: { marginBottom: '12px' } },
      'Pre-fills the business-use share on shared household costs. You can override per entry.'),
    ratioField('rent', 'Rent', s, save, 'Usually by floor area. A work room at a quarter of your home is 25%.'),
    ratioField('utilities', 'Utilities', s, save, 'Usually by working hours, or the same as rent.'),
    ratioField('communication', 'Internet and phone', s, save, 'Often 50–80% for someone working from home.'),
    field('Standard basis note', input({
      value: s.homeOfficeBasis, placeholder: 'e.g. work room 12m² of 48m² total floor area',
      onchange: (e) => save({ homeOfficeBasis: e.target.value }),
    }), 'Written onto every apportioned expense. This one line is what makes the percentage defensible.')));

  // ------------------------------------------------------------------ data
  view.append(dataCard(state));

  // ----------------------------------------------------------------- about
  view.append(card('About',
    h('p.field-hint',
      `Tax tables for ${rates.year}, last verified ${rates.meta.verified}. ${rates.meta.caveat}`),
    h('p.field-hint', { style: { marginTop: '8px' } },
      'Everything you enter stays on this device. There is no server and no account, and no part of this app sends '
      + 'your financial data anywhere.'),
    field('Theme', select([
      { value: 'auto', label: 'Match my system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ], {
      value: localStorage.getItem('aoiro-theme') || 'auto',
      onchange: (e) => {
        const v = e.target.value;
        try { localStorage.setItem('aoiro-theme', v); } catch { /* private mode */ }
        if (v === 'auto') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      },
    }))));

  return view;
}

function ratioField(key, label, s, save, hint) {
  const ratios = s.homeOfficeRatios || {};
  const pct = Math.round((ratios[key] ?? 0.25) * 100);
  const readout = h('span.meter-value', `${pct}%`);
  return h('div.field',
    h('div.meter-head', h('span.field-label', label), readout),
    h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: pct,
      style: { width: '100%', accentColor: 'var(--accent)' },
      oninput: (e) => { readout.textContent = `${e.target.value}%`; },
      onchange: (e) => save({
        homeOfficeRatios: { ...ratios, [key]: Number(e.target.value) / 100 },
      }),
    }),
    hint ? h('span.field-hint', hint) : null);
}

function otherIncomeField(state, key, label, hint) {
  const year = state.taxYear;
  return field(label, input({
    type: 'text', inputmode: 'decimal', class: 'input input-money',
    value: state.years[year]?.[key] || 0,
    onchange: async (e) => {
      await saveYear(year, { [key]: parseMoney(e.target.value) });
      invalidate();
      toast('Saved');
    },
  }), hint);
}

function dependentsEditor(state, save) {
  const deps = state.settings.dependents || [];

  const rows = deps.map((dep, i) => h('div.card.card-sunken', { style: { marginBottom: '8px' } },
    h('div.field-row',
      field('Age', input({
        type: 'number', min: '0', max: '120', value: dep.age || 0,
        onchange: (e) => {
          const next = [...deps];
          next[i] = { ...dep, age: Number(e.target.value) };
          save({ dependents: next });
        },
      })),
      field('Relationship', input({
        value: dep.relationship || '',
        placeholder: 'child, parent…',
        onchange: (e) => {
          const next = [...deps];
          next[i] = { ...dep, relationship: e.target.value };
          save({ dependents: next });
        },
      }))),
    checkbox('Lives outside Japan', {
      checked: dep.livesAbroad,
      onchange: (e) => {
        const next = [...deps];
        next[i] = { ...dep, livesAbroad: e.target.checked };
        save({ dependents: next });
      },
    }),
    dep.livesAbroad
      ? h('div',
        field('Remittances sent to them this year', input({
          type: 'text', inputmode: 'decimal', class: 'input input-money',
          value: dep.remittancesReceived || 0,
          onchange: (e) => {
            const next = [...deps];
            next[i] = { ...dep, remittancesReceived: parseMoney(e.target.value) };
            save({ dependents: next });
          },
        }), 'A relative abroad aged 30 to 69 only qualifies as a student, as disabled, or on 380,000 yen or more of '
          + 'remittances in the year. Keep every transfer receipt — the tax office asks for them.'),
        checkbox('Is a student', {
          checked: dep.isStudent,
          onchange: (e) => {
            const next = [...deps];
            next[i] = { ...dep, isStudent: e.target.checked };
            save({ dependents: next });
          },
        }))
      : null,
    h('div.btn-row',
      button('Remove', {
        class: 'btn-sm btn-ghost',
        onclick: () => save({ dependents: deps.filter((_, j) => j !== i) }),
      }))));

  return h('div',
    h('span.field-label', { style: { display: 'block', marginBottom: '8px' } }, 'Dependents (扶養親族)'),
    ...rows,
    button('Add a dependent', {
      class: 'btn-sm',
      onclick: () => save({ dependents: [...deps, { age: 0, livesAbroad: false }] }),
    }),
    h('p.field-hint', { style: { marginTop: '6px' } },
      'Dependents aged 16 and over give a deduction. Under 16 gives none, only the child allowance.'));
}

function nhiOverrides(s, rates, save) {
  const preset = rates.nhiPresets[s.nhiPreset];
  const o = s.nhiOverrides || {};

  const rateInput = (part, label) => field(label, input({
    type: 'number', step: '0.0001', min: '0', max: '1',
    value: o[part]?.incomeRate ?? preset[part].incomeRate,
    onchange: (e) => save({
      nhiOverrides: {
        ...o,
        [part]: { ...(o[part] || {}), incomeRate: Number(e.target.value) },
      },
    }),
  }), 'As a decimal: 0.0869 means 8.69%.');

  const capitaInput = (part, label) => field(label, input({
    type: 'text', inputmode: 'decimal', class: 'input input-money',
    value: o[part]?.perCapita ?? preset[part].perCapita,
    onchange: (e) => save({
      nhiOverrides: {
        ...o,
        [part]: { ...(o[part] || {}), perCapita: parseMoney(e.target.value) },
      },
    }),
  }));

  return details('Override with your own city’s rates',
    h('p.field-hint', { style: { marginBottom: '12px' } },
      'Copy these from your 保険料決定通知書 or your city’s website. Doing it once turns the health insurance '
      + 'figure from an estimate into an exact number, and it is the largest single line for most freelancers.'),
    h('h3', { style: { margin: '10px 0 6px' } }, '医療分 · Medical'),
    rateInput('medical', 'Income-based rate (所得割率)'),
    capitaInput('medical', 'Per person (均等割額)'),
    h('h3', { style: { margin: '14px 0 6px' } }, '支援金分 · Elderly support'),
    rateInput('support', 'Income-based rate'),
    capitaInput('support', 'Per person'),
    h('h3', { style: { margin: '14px 0 6px' } }, '介護分 · Nursing care (ages 40–64)'),
    rateInput('nursing', 'Income-based rate'),
    capitaInput('nursing', 'Per person'),
    h('div.btn-row', { style: { marginTop: '12px' } },
      button('Reset to preset', {
        class: 'btn-sm btn-ghost',
        onclick: () => save({ nhiOverrides: null }),
      })));
}

function dataCard(state) {
  const days = daysSinceBackup();
  const usageLine = h('p.field-hint');
  db.usage().then((u) => {
    if (u) {
      usageLine.textContent = `Using ${(u.usage / 1_048_576).toFixed(1)} MB of roughly `
        + `${(u.quota / 1_048_576).toFixed(0)} MB available.`;
    }
  }).catch(() => {});

  return card('Your data',
    h('div.banner.banner-warning',
      h('span.banner-icon', '↓'),
      h('div.banner-body',
        h('strong', 'Back up regularly. '),
        'Your books exist only in this browser. Clearing site data, switching browser, or resetting your phone '
        + 'deletes them with no way back. The export below is a single JSON file holding everything.',
        days !== Infinity
          ? h('div', { style: { marginTop: '4px' } },
            `Last backup: ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago.`)
          : h('div', { style: { marginTop: '4px' } }, badge('never backed up', 'critical')))),

    h('div.btn-row', { style: { marginTop: '12px' } },
      button('Export everything', {
        class: 'btn-primary',
        onclick: async () => {
          try {
            const backup = await exportBackup();
            const stamp = new Date().toISOString().slice(0, 10);
            downloadFile(`aoiro-backup-${stamp}.json`, JSON.stringify(backup, null, 2));
            toast('Backup exported', 'success');
          } catch (err) {
            toast(err.message || 'Export failed', 'error');
          }
        },
      }),
      button('Import a backup', { onclick: () => pickImportFile() })),

    usageLine,

    details('Danger zone',
      h('p.field-hint', { style: { marginBottom: '10px' } },
        'Deletes every transaction, journal entry, asset and setting on this device. Export first.'),
      button('Delete all my data', {
        class: 'btn-danger btn-block',
        onclick: async () => {
          const ok = await confirmDialog('Delete everything?',
            'Every transaction, journal entry, asset and setting will be permanently deleted from this device. '
            + 'This cannot be undone. Make sure you have exported a backup first.',
            'Delete everything');
          if (!ok) return;
          await wipeEverything();
          invalidate();
          toast('All data deleted');
        },
      })));
}

function pickImportFile() {
  const picker = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const ok = await confirmDialog('Replace your current data?',
        `This backup holds ${json.counts?.transactions ?? '?'} transactions, exported `
        + `${json.exportedAt ? new Date(json.exportedAt).toLocaleString() : 'at an unknown time'}. `
        + 'Importing replaces everything currently on this device.',
        'Import and replace');
      if (!ok) return;
      const restored = await importBackup(json, 'replace');
      invalidate();
      toast(`Restored ${restored} records`, 'success');
    } catch (err) {
      toast(err.message || 'Could not read that file', 'error');
    } finally {
      picker.remove();
    }
  });
  document.body.append(picker);
  picker.click();
}

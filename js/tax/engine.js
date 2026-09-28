/**
 * The tax computation engine.
 *
 * Computes, for one tax year, every levy a Japanese sole proprietor faces:
 *
 *   所得税 + 復興特別所得税   national income tax and its 2.1% surtax
 *   住民税                     resident tax (10% plus a flat per-capita levy)
 *   個人事業税                 prefectural enterprise tax
 *   消費税                     consumption tax, where registered
 *   国民健康保険               national health insurance
 *   国民年金                   national pension
 *
 * Statutory rounding is applied where it matters: taxable income truncates to
 * the nearest 1,000 yen, and the final amount due truncates to the nearest 100.
 * Skipping those produces figures that disagree with the NTA's own worksheet by
 * a few hundred yen, which is exactly the kind of mismatch that wastes an
 * afternoon at the tax office.
 *
 * Everything returns a `lines` array alongside the totals so the UI can show the
 * derivation. A tax number you cannot trace is a tax number you cannot defend.
 */

import { ratesFor, tierFor, filerIncomeTier, pensionMonthly } from './rates.js';
import { RESIDENCY } from './sourcing.js';

const floorTo = (n, unit) => Math.floor(Math.max(0, n) / unit) * unit;
const yen = (n) => Math.round(n);

/** 事業所得: revenue less expenses less the blue-return deduction. */
export function computeBusinessIncome(business, rates) {
  const revenue = Number(business.revenue) || 0;
  const expenses = Number(business.expenses) || 0;
  const depreciation = Number(business.depreciation) || 0;
  const familyWages = Number(business.familyWages) || 0; // 専従者給与

  const beforeBlueDeduction = revenue - expenses - depreciation - familyWages;

  // The blue-return deduction cannot create or deepen a loss.
  const blueKey = business.blueReturnType || 'none';
  const blueMax = rates.blueReturnDeduction[blueKey] ?? 0;
  const blueDeduction = Math.max(0, Math.min(blueMax, beforeBlueDeduction));

  const lines = [
    { label: '売上 (revenue)', ja: '売上金額', amount: revenue },
    { label: 'Expenses', ja: '必要経費', amount: -expenses },
  ];
  if (depreciation) lines.push({ label: 'Depreciation', ja: '減価償却費', amount: -depreciation });
  if (familyWages) lines.push({ label: 'Family employee wages', ja: '専従者給与', amount: -familyWages });
  lines.push({ label: 'Income before blue-return deduction', ja: '青色控除前所得', amount: beforeBlueDeduction, subtotal: true });
  if (blueMax > 0) {
    lines.push({ label: 'Blue return deduction', ja: '青色申告特別控除', amount: -blueDeduction });
    if (blueDeduction < blueMax) {
      lines.push({
        label: `Deduction capped at income (${yen(blueMax).toLocaleString()} available)`,
        note: true,
      });
    }
  }

  const income = beforeBlueDeduction - blueDeduction;
  lines.push({ label: '事業所得 (business income)', ja: '事業所得', amount: income, total: true });

  return {
    revenue,
    expenses: expenses + depreciation + familyWages,
    beforeBlueDeduction,
    blueDeduction,
    blueDeductionForgone: Math.max(0, blueMax - blueDeduction),
    income,
    lines,
  };
}

/** 給与所得控除 — the salary deduction, if the user also draws a salary. */
function salaryDeduction(gross) {
  if (gross <= 0) return 0;
  if (gross <= 1_900_000) return Math.min(gross, 650_000);
  if (gross <= 3_600_000) return gross * 0.3 + 80_000;
  if (gross <= 6_600_000) return gross * 0.2 + 440_000;
  if (gross <= 8_500_000) return gross * 0.1 + 1_100_000;
  return 1_950_000;
}

/** 所得控除 — every personal deduction, computed for income tax and resident tax in parallel. */
export function computeDeductions(input, rates, totalIncome) {
  const d = input.deductions || {};
  const lines = [];
  let income = 0;
  let resident = 0;

  const add = (label, ja, incomeAmt, residentAmt, note) => {
    if (incomeAmt <= 0 && residentAmt <= 0) return;
    lines.push({ label, ja, amount: incomeAmt, residentAmount: residentAmt, note });
    income += incomeAmt;
    resident += residentAmt;
  };

  // 社会保険料控除 — fully deductible, no cap. Usually the largest single item.
  const si = d.socialInsurance || {};
  const socialTotal = (Number(si.nationalPension) || 0)
    + (Number(si.nationalHealthInsurance) || 0)
    + (Number(si.other) || 0);
  add('Social insurance premiums', '社会保険料控除', socialTotal, socialTotal,
    'National pension and health insurance paid in cash during the year, including any back-payments.');

  // 小規模企業共済等掛金控除 — iDeCo plus the small-enterprise mutual aid scheme.
  const mutualAid = (Number(d.smallEnterpriseMutual) || 0) + (Number(d.ideco) || 0);
  add('iDeCo / small enterprise mutual aid', '小規模企業共済等掛金控除', mutualAid, mutualAid);

  // 生命保険料控除
  const life = Number(d.lifeInsurance) || 0;
  const lifeCap = rates.insuranceDeductions.life;
  add('Life insurance premiums', '生命保険料控除',
    Math.min(life, lifeCap.totalMax), Math.min(life, lifeCap.residentTotalMax));

  // 地震保険料控除
  const quake = Number(d.earthquakeInsurance) || 0;
  const quakeCap = rates.insuranceDeductions.earthquake;
  add('Earthquake insurance premiums', '地震保険料控除',
    Math.min(quake, quakeCap.max), Math.min(quake, quakeCap.residentMax));

  // 医療費控除 — only the excess over the lesser of 5% of income or 100,000.
  const medicalSpend = Number(d.medical) || 0;
  if (medicalSpend > 0) {
    const md = rates.medicalDeduction;
    const floor = Math.min(totalIncome * md.floorRate, md.floorCap);
    const medical = Math.min(Math.max(0, medicalSpend - floor), md.max);
    add('Medical expenses', '医療費控除', medical, medical,
      `Only the amount above ${yen(floor).toLocaleString()} yen counts.`);
  }

  // 寄附金控除 — the income-tax side of ふるさと納税.
  const donations = Number(d.donations) || 0;
  if (donations > 0) {
    const dd = rates.donationDeduction;
    const incomeDonation = Math.max(0, Math.min(donations, totalIncome * dd.incomeLimitRate) - dd.floor);
    add('Donations', '寄附金控除', incomeDonation, 0,
      'Resident tax handles donations as a tax credit rather than an income deduction.');
  }

  // 配偶者控除 / 配偶者特別控除
  const sp = d.spouse || {};
  if (sp.hasSpouse) {
    const spouseIncome = Number(sp.income) || 0;
    const tier = filerIncomeTier(rates, totalIncome);
    const row = rates.spouseDeduction.byFilerIncome[tier];
    const elderly = Number(sp.age) >= 70;

    if (spouseIncome <= rates.spouseDeduction.spouseIncomeCeiling) {
      add('Spouse deduction', '配偶者控除',
        elderly ? row.elderly : row.amount,
        elderly ? row.residentElderly : row.resident);
    } else {
      const sRow = tierFor(rates.spouseSpecialDeduction, spouseIncome);
      const idx = Math.min(tier, 2);
      add('Spouse special deduction', '配偶者特別控除',
        sRow.amounts[idx] || 0, sRow.resident[idx] || 0);
    }
  }

  // 扶養控除. Relatives living abroad face extra conditions since 2023.
  const deps = Array.isArray(d.dependents) ? d.dependents : [];
  let depIncome = 0;
  let depResident = 0;
  let overseasWarning = false;
  for (const dep of deps) {
    const age = Number(dep.age) || 0;
    if (age < 16) continue; // under 16 gives no deduction, only the child allowance
    let band = rates.dependentDeduction.general;
    if (age >= 19 && age <= 22) band = rates.dependentDeduction.specific;
    else if (age >= 70) band = dep.cohabiting ? rates.dependentDeduction.elderlyCohabiting : rates.dependentDeduction.elderly;

    if (dep.livesAbroad && age >= 30 && age <= 69
        && !dep.isStudent && !dep.isDisabled && !(Number(dep.remittancesReceived) >= 380_000)) {
      overseasWarning = true;
      continue; // fails the 国外居住親族 test
    }
    if (dep.livesAbroad) overseasWarning = true;
    depIncome += band.income;
    depResident += band.resident;
  }
  if (depIncome > 0) {
    add('Dependents', '扶養控除', depIncome, depResident,
      overseasWarning
        ? 'Relatives abroad aged 30–69 qualify only as students, as disabled, or on 380,000 yen or more of '
          + 'remittances in the year. Keep the transfer receipts.'
        : undefined);
  }

  // Status-based deductions.
  if (d.disability) add('Disability', '障害者控除', d.disabilitySevere ? 400_000 : 270_000, d.disabilitySevere ? 300_000 : 260_000);
  if (d.singleParent) add('Single parent', 'ひとり親控除', 350_000, 300_000);
  else if (d.widow) add('Widow', '寡婦控除', 270_000, 260_000);
  if (d.workingStudent) add('Working student', '勤労学生控除', 270_000, 260_000);

  // 基礎控除 — last, because its size depends on total income.
  const basic = tierFor(rates.basicDeduction, totalIncome).amount;
  const basicResident = tierFor(rates.residentBasicDeduction, totalIncome).amount;
  add('Basic deduction', '基礎控除', basic, basicResident);

  return {
    income, resident, lines,
    basic, basicResident,
    socialTotal, mutualAid,
    donations,
    personalDeductionCount: 1 + (sp.hasSpouse ? 1 : 0) + deps.length,
  };
}

/** National income tax from the 速算表. */
export function computeIncomeTaxFromBase(taxableIncome, rates) {
  const rounded = floorTo(taxableIncome, 1000); // 千円未満切捨て
  const bracket = tierFor(rates.incomeTaxBrackets, rounded);
  const tax = Math.max(0, rounded * bracket.rate - bracket.subtract);
  return { taxableIncome: rounded, bracket, tax: Math.floor(tax) };
}

/** 住民税 — 所得割 plus 均等割, less the 調整控除. */
export function computeResidentTax(input, rates, totalIncome, residentDeductions, donations) {
  const rt = rates.residentTax;
  const taxable = floorTo(totalIncome - residentDeductions, 1000);

  const prefectural = Math.floor(taxable * rt.incomeRate.prefectural);
  const municipal = Math.floor(taxable * rt.incomeRate.municipal);

  // 調整控除 compensates for the deduction gap between the two taxes.
  const adj = rt.adjustmentDeduction;
  let adjustment = 0;
  if (taxable > 0) {
    const gap = adj.basicGap;
    adjustment = taxable <= adj.threshold
      ? Math.min(gap, taxable) * adj.rate
      : Math.max(adj.floor, (gap - (taxable - adj.threshold)) * adj.rate);
    adjustment = Math.floor(Math.max(0, adjustment));
  }

  // ふるさと納税 lands here as a credit, not a deduction.
  let donationCredit = 0;
  if (donations > 0) {
    const base = Math.max(0, Math.min(donations, totalIncome * rates.donationDeduction.residentLimitRate) - 2000);
    donationCredit = Math.floor(base * 0.1); // 基本分 10%; the 特例分 top-up is estimated separately
  }

  const incomeLevy = Math.max(0, prefectural + municipal - adjustment - donationCredit);
  const perCapita = taxable > 0 || totalIncome > rt.exemptionThresholds.single
    ? rt.perCapita.prefectural + rt.perCapita.municipal + rt.perCapita.forest
    : 0;

  const exempt = totalIncome <= rt.exemptionThresholds.single && (input.deductions?.dependents?.length ?? 0) === 0;

  return {
    taxableIncome: taxable,
    prefectural, municipal,
    adjustment, donationCredit,
    incomeLevy: exempt ? 0 : floorTo(incomeLevy, 100),
    perCapita: exempt ? 0 : perCapita,
    total: exempt ? 0 : floorTo(incomeLevy, 100) + perCapita,
    exempt,
    lines: [
      { label: 'Taxable income (resident tax)', ja: '課税所得金額', amount: taxable, subtotal: true },
      { label: 'Prefectural 4%', ja: '都道府県民税', amount: prefectural },
      { label: 'Municipal 6%', ja: '市町村民税', amount: municipal },
      { label: 'Adjustment deduction', ja: '調整控除', amount: -adjustment },
      ...(donationCredit ? [{ label: 'Donation credit', ja: '寄附金税額控除', amount: -donationCredit }] : []),
      { label: 'Per-capita levy', ja: '均等割 + 森林環境税', amount: perCapita },
    ],
  };
}

/**
 * 個人事業税.
 *
 * Two traps worth knowing: the blue-return deduction is *not* allowed against
 * this tax, and whole professions are outside its scope. Writers, painters and
 * composers are not among the 70 listed categories and pay nothing.
 */
export function computeEnterpriseTax(business, rates, businessIncomeBeforeBlue) {
  const et = rates.enterpriseTax;
  const category = business.enterpriseCategory || 'category1';
  const rate = et.rates[category] ?? et.rates.category1;

  if (rate === 0) {
    return {
      applicable: false, total: 0, rate: 0, category,
      note: 'Your business category is not among the 70 listed in 地方税法 72条の2, so no enterprise tax is due. '
          + 'Writing, translation as authorship, painting and composing typically fall outside it. Nothing to file.',
      lines: [],
    };
  }

  const months = Math.min(12, Math.max(1, Number(business.monthsInBusiness) || 12));
  const exemption = Math.floor(et.exemption * (months / 12));
  const losses = Number(business.enterpriseLossCarryforward) || 0;
  const base = Math.max(0, businessIncomeBeforeBlue - losses - exemption);
  const total = floorTo(base * rate, 100);

  return {
    applicable: true,
    rate, category, exemption, base, total,
    monthsProrated: months < 12,
    note: total === 0
      ? `No enterprise tax due: income stays under the ${yen(exemption).toLocaleString()} yen 事業主控除.`
      : 'Paid in two instalments, in August and November. It is deductible as 租税公課 in the year you pay it.',
    lines: [
      { label: 'Business income before blue-return deduction', ja: '青色控除前所得', amount: businessIncomeBeforeBlue },
      { label: 'Blue-return deduction is not allowed here', note: true },
      ...(losses ? [{ label: 'Loss carry-forward', ja: '損失繰越', amount: -losses }] : []),
      { label: `Proprietor deduction${months < 12 ? ` (${months}/12 months)` : ''}`, ja: '事業主控除', amount: -exemption },
      { label: 'Taxable base', ja: '課税標準', amount: base, subtotal: true },
      { label: `Rate ${(rate * 100).toFixed(0)}%`, amount: total, total: true },
    ],
  };
}

/** 国民健康保険. Municipality-specific, so the settings always win over the preset. */
export function computeNationalHealthInsurance(input, rates, totalIncome) {
  const cfg = input.nhi || {};
  const preset = rates.nhiPresets[cfg.preset || 'tokyo23'];
  const p = {
    baseDeduction: cfg.baseDeduction ?? preset.baseDeduction,
    medical: { ...preset.medical, ...(cfg.medical || {}) },
    support: { ...preset.support, ...(cfg.support || {}) },
    nursing: { ...preset.nursing, ...(cfg.nursing || {}) },
  };

  const householdSize = Math.max(1, Number(cfg.householdSize) || 1);
  const age = Number(cfg.age) || 35;
  const needsNursing = age >= 40 && age <= 64;

  const base = Math.max(0, totalIncome - p.baseDeduction);

  const part = (spec, include) => {
    if (!include) return { income: 0, perCapita: 0, total: 0 };
    const incomePart = base * spec.incomeRate;
    const perCapita = spec.perCapita * householdSize;
    return {
      income: Math.floor(incomePart),
      perCapita,
      total: Math.min(spec.cap, Math.floor(incomePart + perCapita)),
    };
  };

  const medical = part(p.medical, true);
  const support = part(p.support, true);
  const nursing = part(p.nursing, needsNursing);
  const total = floorTo(medical.total + support.total + nursing.total, 100);

  return {
    base, total, medical, support, nursing, needsNursing, householdSize,
    preset: cfg.preset || 'tokyo23',
    isEstimate: true,
    note: 'Rates differ in every municipality and change each April. Replace these with the figures on your own '
        + '保険料決定通知書 for an exact number.',
    lines: [
      { label: 'Assessment base (total income less 430,000)', ja: '算定基礎額', amount: base, subtotal: true },
      { label: 'Medical portion', ja: '医療分', amount: medical.total },
      { label: 'Elderly support portion', ja: '後期高齢者支援金分', amount: support.total },
      ...(needsNursing ? [{ label: 'Nursing care portion (ages 40–64)', ja: '介護分', amount: nursing.total }] : []),
      { label: 'Annual premium', amount: total, total: true },
    ],
  };
}

/** 国民年金 — a flat premium, so this is mostly a reminder of the fixed cost. */
export function computeNationalPension(input, rates) {
  const cfg = input.pension || {};
  const monthly = pensionMonthly(rates, new Date(`${rates.year}-06-01`));
  const months = Math.min(12, Math.max(0, Number(cfg.months ?? 12)));
  const supplementary = cfg.supplementary ? rates.nationalPension.supplementaryMonthly * months : 0;
  const exempted = cfg.exemptionRate ? monthly * months * Number(cfg.exemptionRate) : 0;
  const total = Math.max(0, monthly * months + supplementary - exempted);

  return {
    monthly, months, supplementary, total,
    note: cfg.supplementary
      ? '付加年金 costs 400 yen a month and pays back 200 yen × months every year for life. It breaks even after '
        + 'two years of pension, which makes it the best-value option available to a 第1号被保険者.'
      : 'Consider 付加年金: 400 yen a month buys 200 yen × months of extra annual pension for life, so it repays '
        + 'itself in two years.',
  };
}

/**
 * 消費税.
 *
 * The critical wrinkle for foreign-facing freelancers: services genuinely
 * consumed outside Japan are export-exempt (輸出免税) — zero-rated but still
 * counted toward the 10 million yen registration threshold. So you can cross the
 * threshold, become a taxable person, and still owe nothing on those sales while
 * reclaiming input tax on your Japanese costs.
 */
export function computeConsumptionTax(input, rates) {
  const ct = input.consumptionTax || {};
  const c = rates.consumptionTax;

  const baseperiodSales = Number(ct.basePeriodTaxableSales) || 0;
  const registered = !!ct.isRegistered;
  const domesticSales = Number(ct.domesticTaxableSales) || 0;
  const exportSales = Number(ct.exportExemptSales) || 0;
  const taxableInputs = Number(ct.taxableInputs) || 0;

  const overThreshold = baseperiodSales > c.exemptionThreshold;
  const isTaxablePerson = overThreshold || registered;

  if (!isTaxablePerson) {
    return {
      isTaxablePerson: false, total: 0, overThreshold, baseperiodSales,
      note: `Exempt: taxable sales two years ago were ${yen(baseperiodSales).toLocaleString()} yen, under the `
          + `${(c.exemptionThreshold / 10_000).toLocaleString()}0,000 yen threshold. You charge and file nothing. `
          + 'Note that export-exempt sales still count toward this threshold even though they carry no tax.',
      lines: [],
    };
  }

  const outputTax = Math.floor(domesticSales * c.standardRate);
  const methods = {};

  // 一般課税
  methods.general = {
    label: 'General method (一般課税)',
    tax: floorTo(Math.max(0, outputTax - Math.floor(taxableInputs * c.standardRate / (1 + c.standardRate))), 100),
  };

  // 簡易課税
  if (baseperiodSales <= c.simplifiedSchemeCeiling) {
    const deemed = c.deemedPurchaseRates[ct.simplifiedCategory || 'type5_services'];
    methods.simplified = {
      label: `Simplified method (簡易課税, ${(deemed * 100).toFixed(0)}% deemed input)`,
      tax: floorTo(outputTax * (1 - deemed), 100),
    };
  }

  // 2割特例
  if (registered && !overThreshold && rates.year <= c.twentyPercentRule.availableThrough) {
    methods.twentyPercent = {
      label: '20% special rule (2割特例)',
      tax: floorTo(outputTax * c.twentyPercentRule.rate, 100),
    };
  }

  const best = Object.entries(methods).sort((a, b) => a[1].tax - b[1].tax)[0];

  return {
    isTaxablePerson: true, overThreshold, registered, baseperiodSales,
    domesticSales, exportSales, outputTax,
    methods,
    bestMethod: best ? best[0] : null,
    total: best ? best[1].tax : 0,
    note: exportSales > 0
      ? `${yen(exportSales).toLocaleString()} yen of your sales are export-exempt (輸出免税) — zero-rated because `
        + 'the service is consumed outside Japan. They count toward the threshold but carry no output tax, and you '
        + 'can still reclaim input tax on Japanese costs. Keep contracts showing the client is a non-resident.'
      : 'Filed separately from income tax, due March 31.',
    lines: [
      { label: 'Domestic taxable sales', ja: '課税売上高', amount: domesticSales },
      ...(exportSales ? [{ label: 'Export-exempt sales (0%)', ja: '輸出免税売上', amount: exportSales }] : []),
      { label: 'Output tax', ja: '課税標準額に対する消費税額', amount: outputTax, subtotal: true },
      ...Object.values(methods).map((m) => ({ label: m.label, amount: m.tax })),
    ],
  };
}

/** 予定納税 — two prepayments next year if this year's tax reaches 150,000. */
export function computeEstimatedTax(baseTax, rates) {
  const et = rates.estimatedTax;
  if (baseTax < et.threshold) {
    return { required: false, installment: 0, total: 0, installments: [] };
  }
  const installment = floorTo(baseTax * et.fraction, 100);
  return {
    required: true,
    installment,
    total: installment * 2,
    installments: et.installments.map((i) => ({
      ...i, amount: installment, due: `${rates.year + 1}-${i.due}`,
    })),
    note: `Because this year's tax reached ${yen(et.threshold).toLocaleString()} yen, the tax office will bill you `
        + `${yen(installment).toLocaleString()} yen in July and again in November of ${rates.year + 1}, as a `
        + 'prepayment against that year. Set the money aside now — this is the single most common cash-flow shock '
        + 'for a second-year freelancer.',
  };
}

/**
 * Runs the whole computation.
 * @returns a summary plus every intermediate figure, so nothing is a black box.
 */
export function computeAll(input) {
  const rates = ratesFor(input.taxYear);
  const business = input.business || {};

  const biz = computeBusinessIncome(business, rates);

  // Other income sources.
  const other = input.otherIncome || {};
  const salaryGross = Number(other.salary) || 0;
  const salaryIncome = Math.max(0, salaryGross - salaryDeduction(salaryGross));
  const miscIncome = Number(other.miscellaneous) || 0;
  const realEstateIncome = Number(other.realEstate) || 0;

  // 合計所得金額, which sets the basic-deduction tier and spouse eligibility.
  const grossTotalIncome = biz.income + salaryIncome + miscIncome + realEstateIncome;

  // 純損失の繰越控除 — blue-return loss carry-forward.
  const carryforward = rates.lossCarryforward.blueReturnOnly && business.blueReturnType === 'none'
    ? 0
    : Math.min(Number(input.lossCarryforward) || 0, Math.max(0, grossTotalIncome));
  const totalIncome = Math.max(0, grossTotalIncome - carryforward);

  const deductions = computeDeductions(input, rates, totalIncome);

  // National income tax.
  const taxableIncome = Math.max(0, totalIncome - deductions.income);
  const nat = computeIncomeTaxFromBase(taxableIncome, rates);

  // 復興特別所得税, levied on the base income tax.
  const surtaxApplies = rates.year <= rates.reconstructionSurtax.throughYear;
  const surtax = surtaxApplies ? Math.floor(nat.tax * rates.reconstructionSurtax.rate) : 0;

  const withholding = Number(input.withholding) || 0;
  const estimatedPaid = Number(input.estimatedTaxPaid) || 0;
  const foreignTaxCredit = Math.min(Number(input.foreignTaxCredit) || 0, nat.tax + surtax);

  const incomeTaxTotal = nat.tax + surtax;
  const balanceDue = floorTo(incomeTaxTotal - withholding - estimatedPaid - foreignTaxCredit, 100);
  const refund = balanceDue < 0 ? -balanceDue : 0;

  // Other levies.
  const resident = computeResidentTax(input, rates, totalIncome, deductions.resident, deductions.donations);
  const enterprise = computeEnterpriseTax(business, rates, biz.beforeBlueDeduction);
  const nhi = computeNationalHealthInsurance(input, rates, totalIncome);
  const pension = computeNationalPension(input, rates);
  const consumption = computeConsumptionTax(input, rates);
  const estimated = computeEstimatedTax(incomeTaxTotal, rates);

  // Marginal rate, used to price any extra deduction.
  const bracket = nat.bracket;
  const marginalRate = bracket.rate * (1 + (surtaxApplies ? rates.reconstructionSurtax.rate : 0))
    + rates.residentTax.incomeRate.prefectural + rates.residentTax.incomeRate.municipal
    + (enterprise.applicable ? enterprise.rate : 0)
    + (nhi.medical.total < rates.nhiPresets[nhi.preset].medical.cap
      ? (nhi.medical.income > 0 ? Number(input.nhi?.medical?.incomeRate ?? rates.nhiPresets[nhi.preset].medical.incomeRate) : 0)
      : 0);

  const totalTax = incomeTaxTotal + resident.total + enterprise.total + consumption.total;
  const totalBurden = totalTax + nhi.total + pension.total;

  const netIncome = biz.revenue - biz.expenses - totalBurden + (refund > 0 ? 0 : 0);

  return {
    rates,
    taxYear: rates.year,
    business: biz,
    otherIncome: { salaryGross, salaryIncome, miscIncome, realEstateIncome },
    grossTotalIncome,
    carryforward,
    totalIncome,
    deductions,
    incomeTax: {
      ...nat, surtax, total: incomeTaxTotal,
      withholding, estimatedPaid, foreignTaxCredit,
      balanceDue: Math.max(0, balanceDue), refund,
      lines: [
        { label: 'Total income', ja: '合計所得金額', amount: totalIncome, subtotal: true },
        { label: 'Total deductions', ja: '所得控除合計', amount: -deductions.income },
        { label: 'Taxable income (rounded down to 1,000)', ja: '課税所得金額', amount: nat.taxableIncome, subtotal: true },
        { label: `Income tax at ${(bracket.rate * 100).toFixed(0)}%`, ja: '所得税額', amount: nat.tax },
        ...(surtax ? [{ label: 'Reconstruction surtax 2.1%', ja: '復興特別所得税', amount: surtax }] : []),
        ...(withholding ? [{ label: 'Tax already withheld', ja: '源泉徴収税額', amount: -withholding }] : []),
        ...(estimatedPaid ? [{ label: 'Estimated tax already paid', ja: '予定納税額', amount: -estimatedPaid }] : []),
        ...(foreignTaxCredit ? [{ label: 'Foreign tax credit', ja: '外国税額控除', amount: -foreignTaxCredit }] : []),
        { label: refund > 0 ? 'Refund due' : 'Balance due', amount: refund > 0 ? refund : Math.max(0, balanceDue), total: true },
      ],
    },
    residentTax: resident,
    enterpriseTax: enterprise,
    nhi,
    pension,
    consumptionTax: consumption,
    estimatedTax: estimated,
    summary: {
      revenue: biz.revenue,
      expenses: biz.expenses,
      totalTax,
      totalBurden,
      netIncome,
      effectiveRate: biz.revenue > 0 ? totalBurden / biz.revenue : 0,
      effectiveRateOnIncome: totalIncome > 0 ? totalBurden / totalIncome : 0,
      marginalRate,
      monthlySetAside: Math.ceil(totalBurden / 12 / 1000) * 1000,
      breakdown: [
        { key: 'incomeTax', label: 'Income tax', ja: '所得税', amount: nat.tax },
        { key: 'surtax', label: 'Reconstruction surtax', ja: '復興特別所得税', amount: surtax },
        { key: 'residentTax', label: 'Resident tax', ja: '住民税', amount: resident.total },
        { key: 'enterpriseTax', label: 'Enterprise tax', ja: '個人事業税', amount: enterprise.total },
        { key: 'consumptionTax', label: 'Consumption tax', ja: '消費税', amount: consumption.total },
        { key: 'nhi', label: 'Health insurance', ja: '国民健康保険', amount: nhi.total },
        { key: 'pension', label: 'National pension', ja: '国民年金', amount: pension.total },
      ].filter((b) => b.amount > 0),
    },
  };
}

/**
 * Recomputes with one field changed, to price a decision exactly.
 * Used by the advisor to answer "what does this actually save me?"
 */
export function marginalImpact(input, mutate) {
  const before = computeAll(input);
  const modified = structuredClone(input);
  mutate(modified);
  const after = computeAll(modified);
  return {
    before, after,
    taxSaved: before.summary.totalBurden - after.summary.totalBurden,
    burdenBefore: before.summary.totalBurden,
    burdenAfter: after.summary.totalBurden,
  };
}

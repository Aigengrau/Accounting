/**
 * Fixed asset register and depreciation (固定資産台帳・減価償却).
 *
 * Which treatment an asset gets is decided by its cost, and the thresholds are
 * worth memorising because they change the timing of the deduction:
 *
 *   under 100,000       expense at once as 消耗品費
 *   100,000–199,999     一括償却資産, one third a year for three years, ignoring
 *                       the purchase month entirely
 *   under 300,000       blue filers only: expense at once under 少額減価償却資産の
 *                       特例, up to 3,000,000 yen of such assets a year
 *   300,000 and over    depreciate over the statutory useful life
 *
 * Straight line (定額法) is the default method for a sole proprietor. Declining
 * balance (定率法) requires an election filed in advance, so it is offered but not
 * assumed.
 *
 * First-year depreciation is pro-rated by month, counting the month of
 * acquisition as a whole month.
 */

import { ratesFor } from '../tax/rates.js';

export const TREATMENT = {
  IMMEDIATE: 'immediate',         // under 100,000 → straight to expense
  LUMP_SUM_3Y: 'lump_sum_3y',     // 一括償却資産
  BLUE_300K: 'immediate_300k',    // 少額減価償却資産の特例
  DEPRECIATE: 'depreciate',       // ordinary depreciation
};

/**
 * Recommends a treatment and explains the trade-off.
 * Timing is the whole game: pull the deduction forward in a strong year, push it
 * into the future when this year's income is already low.
 */
export function recommendTreatment(cost, { isBlueReturn = true, taxYear, blue300kUsedThisYear = 0 } = {}) {
  const rates = ratesFor(taxYear);
  const d = rates.depreciation;
  const options = [];

  if (cost < d.immediateExpense) {
    return {
      recommended: TREATMENT.IMMEDIATE,
      options: [{
        treatment: TREATMENT.IMMEDIATE,
        label: 'Expense immediately (消耗品費)',
        firstYearDeduction: cost,
        note: `Under ${d.immediateExpense.toLocaleString()} yen, so there is no choice to make and no asset to `
            + 'register.',
      }],
    };
  }

  if (cost < d.lumpSum3Year) {
    options.push({
      treatment: TREATMENT.LUMP_SUM_3Y,
      label: 'Lump-sum over 3 years (一括償却資産)',
      firstYearDeduction: Math.floor(cost / 3),
      note: 'One third a year for three years, and the purchase month is ignored — so buying in December still '
          + 'gives a full third this year. It also stays outside 償却資産税, unlike ordinary depreciation.',
    });
  }

  if (isBlueReturn && cost < d.blueReturnImmediate) {
    const headroom = d.blueReturnAnnualCap - blue300kUsedThisYear;
    if (headroom >= cost) {
      options.push({
        treatment: TREATMENT.BLUE_300K,
        label: 'Expense immediately (少額減価償却資産の特例)',
        firstYearDeduction: cost,
        note: `Blue-return privilege: the whole cost this year. You have ${headroom.toLocaleString()} yen of the `
            + `${d.blueReturnAnnualCap.toLocaleString()} yen annual cap left. Best when this year's income is high.`,
      });
    }
  }

  const life = d.usefulLives.other;
  options.push({
    treatment: TREATMENT.DEPRECIATE,
    label: `Depreciate over ${life} years (定額法)`,
    firstYearDeduction: Math.floor(cost / life),
    note: 'Spreads the deduction. Preferable when you expect higher income in later years, since a deduction is '
        + 'worth more against a higher marginal rate.',
  });

  // Prefer the immediate write-off when available; it is what most freelancers want.
  const preferred = options.find((o) => o.treatment === TREATMENT.BLUE_300K)
    || options.find((o) => o.treatment === TREATMENT.LUMP_SUM_3Y)
    || options[0];

  return { recommended: preferred.treatment, options };
}

/**
 * Builds the depreciation schedule for one asset across its whole life.
 * Straight line leaves a 1 yen memorandum value, per Japanese practice.
 */
export function scheduleFor(asset, taxYear) {
  const rates = ratesFor(taxYear);
  const d = rates.depreciation;
  const cost = Number(asset.cost) || 0;
  const ratio = clamp01(asset.businessRatio ?? 1);
  const acquired = new Date(asset.acquiredDate);
  const startYear = acquired.getUTCFullYear();
  const monthsFirstYear = 12 - acquired.getUTCMonth(); // month of acquisition counts in full

  const rows = [];

  switch (asset.treatment) {
    case TREATMENT.IMMEDIATE:
    case TREATMENT.BLUE_300K:
      rows.push({
        year: startYear, opening: cost, charge: cost, closing: 0,
        businessCharge: Math.floor(cost * ratio), months: monthsFirstYear,
        note: asset.treatment === TREATMENT.BLUE_300K ? '少額減価償却資産の特例' : '消耗品費',
      });
      break;

    case TREATMENT.LUMP_SUM_3Y: {
      const annual = Math.floor(cost / 3);
      let remaining = cost;
      for (let i = 0; i < 3; i++) {
        const charge = i === 2 ? remaining : annual; // last year absorbs the rounding
        rows.push({
          year: startYear + i, opening: remaining, charge,
          closing: remaining - charge, businessCharge: Math.floor(charge * ratio),
          months: 12, note: '一括償却資産 (month of purchase ignored)',
        });
        remaining -= charge;
      }
      break;
    }

    default: {
      const life = Number(asset.usefulLife) || d.usefulLives[asset.category] || d.usefulLives.other;
      const annual = Math.floor(cost / life);
      let remaining = cost;
      for (let i = 0; i <= life; i++) {
        if (remaining <= 1) break;
        const months = i === 0 ? monthsFirstYear : 12;
        let charge = Math.floor(annual * (months / 12));
        // Stop at a 1 yen memorandum value (備忘価額).
        if (remaining - charge < 1) charge = remaining - 1;
        if (charge <= 0) break;
        rows.push({
          year: startYear + i, opening: remaining, charge,
          closing: remaining - charge, businessCharge: Math.floor(charge * ratio),
          months, note: i === 0 && months < 12 ? `${months}/12 months in first year` : '',
        });
        remaining -= charge;
      }
      break;
    }
  }

  return {
    assetId: asset.id, name: asset.name, cost, businessRatio: ratio,
    treatment: asset.treatment, rows,
    totalCharged: rows.reduce((s, r) => s + r.charge, 0),
  };
}

/** Total depreciation charge for one year, across every asset. */
export function annualCharge(assets, year) {
  let total = 0;
  let businessTotal = 0;
  const detail = [];

  for (const asset of assets) {
    if (asset.disposedDate && String(asset.disposedDate) < `${year}-01-01`) continue;
    const schedule = scheduleFor(asset, year);
    const row = schedule.rows.find((r) => r.year === Number(year));
    if (!row) continue;
    total += row.charge;
    businessTotal += row.businessCharge;
    detail.push({
      assetId: asset.id, name: asset.name, category: asset.category,
      acquiredDate: asset.acquiredDate, cost: asset.cost,
      treatment: asset.treatment, usefulLife: asset.usefulLife,
      charge: row.charge, businessCharge: row.businessCharge,
      businessRatio: asset.businessRatio ?? 1,
      opening: row.opening, closing: row.closing, note: row.note,
    });
  }

  return { year: Number(year), total, businessTotal, detail };
}

/** Warns when the 少額減価償却資産 annual cap is close or exceeded. */
export function blue300kUsage(assets, year, taxYear = year) {
  const rates = ratesFor(taxYear);
  const cap = rates.depreciation.blueReturnAnnualCap;
  const used = assets
    .filter((a) => a.treatment === TREATMENT.BLUE_300K && String(a.acquiredDate).startsWith(String(year)))
    .reduce((s, a) => s + (Number(a.cost) || 0), 0);

  return {
    used, cap, remaining: Math.max(0, cap - used),
    exceeded: used > cap,
    warning: used > cap
      ? `You have claimed ${used.toLocaleString()} yen under 少額減価償却資産の特例, over the `
        + `${cap.toLocaleString()} yen annual cap. The excess must be depreciated normally instead.`
      : null,
  };
}

function clamp01(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

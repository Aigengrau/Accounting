/**
 * Japan tax parameters, one frozen config per tax year.
 *
 * Every number here is a statutory figure that can change with each year's tax
 * reform (税制改正). Nothing in the engine hardcodes a rate — it all comes from
 * here, so updating for a new year means adding one object at the bottom.
 *
 * `meta.verified` is the date a human last checked these against the NTA. The
 * UI surfaces it and warns once the config is more than a year stale.
 *
 * Municipality-specific figures (national health insurance above all) are not
 * statutory nationwide. They ship as editable presets; the engine always
 * prefers the user's own settings over a preset.
 */

/** Progressive national income tax table (所得税の速算表). Unchanged since 2015. */
const INCOME_TAX_BRACKETS = [
  { upTo: 1_950_000, rate: 0.05, subtract: 0 },
  { upTo: 3_300_000, rate: 0.10, subtract: 97_500 },
  { upTo: 6_950_000, rate: 0.20, subtract: 427_500 },
  { upTo: 9_000_000, rate: 0.23, subtract: 636_000 },
  { upTo: 18_000_000, rate: 0.33, subtract: 1_536_000 },
  { upTo: 40_000_000, rate: 0.40, subtract: 2_796_000 },
  { upTo: Infinity, rate: 0.45, subtract: 4_796_000 },
];

/**
 * 基礎控除 for income tax, 2025 and 2026 only.
 *
 * The 2025 reform (令和7年度税制改正) raised the flat figure from 480,000 to
 * 580,000, then layered a two-year-only bonus on top for lower incomes. Both
 * are folded into one table; BASIC_DEDUCTION_FROM_2027 is what it reverts to.
 */
const BASIC_DEDUCTION_2025_2026 = [
  { upTo: 1_320_000, amount: 950_000 },
  { upTo: 3_360_000, amount: 880_000 },
  { upTo: 4_890_000, amount: 680_000 },
  { upTo: 6_550_000, amount: 630_000 },
  { upTo: 23_500_000, amount: 580_000 },
  { upTo: 24_000_000, amount: 480_000 },
  { upTo: 24_500_000, amount: 320_000 },
  { upTo: 25_000_000, amount: 160_000 },
  { upTo: Infinity, amount: 0 },
];

/** 2027 onward: the two-year bonus lapses, leaving the raised flat figure. */
const BASIC_DEDUCTION_FROM_2027 = [
  { upTo: 23_500_000, amount: 580_000 },
  { upTo: 24_000_000, amount: 480_000 },
  { upTo: 24_500_000, amount: 320_000 },
  { upTo: 25_000_000, amount: 160_000 },
  { upTo: Infinity, amount: 0 },
];

/** Pre-reform basic deduction, for 2024 and earlier. */
const BASIC_DEDUCTION_LEGACY = [
  { upTo: 24_000_000, amount: 480_000 },
  { upTo: 24_500_000, amount: 320_000 },
  { upTo: 25_000_000, amount: 160_000 },
  { upTo: Infinity, amount: 0 },
];

/** 住民税の基礎控除. The 2025 reform left this at 430,000. */
const RESIDENT_BASIC_DEDUCTION = [
  { upTo: 24_000_000, amount: 430_000 },
  { upTo: 24_500_000, amount: 290_000 },
  { upTo: 25_000_000, amount: 150_000 },
  { upTo: Infinity, amount: 0 },
];

/** 配偶者控除. Tiered by the filer's income, not the spouse's. */
const SPOUSE_DEDUCTION = {
  spouseIncomeCeiling: 580_000, // raised from 480,000 by the 2025 reform
  byFilerIncome: [
    { upTo: 9_000_000, amount: 380_000, elderly: 480_000, resident: 330_000, residentElderly: 380_000 },
    { upTo: 9_500_000, amount: 260_000, elderly: 320_000, resident: 220_000, residentElderly: 260_000 },
    { upTo: 10_000_000, amount: 130_000, elderly: 160_000, resident: 110_000, residentElderly: 130_000 },
    { upTo: Infinity, amount: 0, elderly: 0, resident: 0, residentElderly: 0 },
  ],
};

/**
 * 配偶者特別控除. Sliding scale once the spouse earns past the 配偶者控除 range.
 * Each row caps the spouse's 合計所得金額; `amounts` is indexed by the same
 * filer-income tier used by SPOUSE_DEDUCTION.
 */
const SPOUSE_SPECIAL_DEDUCTION = [
  { upTo: 1_050_000, amounts: [380_000, 260_000, 130_000], resident: [330_000, 220_000, 110_000] },
  { upTo: 1_100_000, amounts: [360_000, 240_000, 120_000], resident: [330_000, 220_000, 110_000] },
  { upTo: 1_150_000, amounts: [310_000, 210_000, 110_000], resident: [310_000, 210_000, 110_000] },
  { upTo: 1_200_000, amounts: [260_000, 180_000, 90_000], resident: [260_000, 180_000, 90_000] },
  { upTo: 1_250_000, amounts: [210_000, 140_000, 70_000], resident: [210_000, 140_000, 70_000] },
  { upTo: 1_300_000, amounts: [160_000, 110_000, 60_000], resident: [160_000, 110_000, 60_000] },
  { upTo: 1_330_000, amounts: [110_000, 80_000, 40_000], resident: [110_000, 80_000, 40_000] },
  { upTo: 1_360_000, amounts: [60_000, 40_000, 20_000], resident: [60_000, 40_000, 20_000] },
  { upTo: 1_400_000, amounts: [30_000, 20_000, 10_000], resident: [30_000, 20_000, 10_000] },
  { upTo: Infinity, amounts: [0, 0, 0], resident: [0, 0, 0] },
];

/** 扶養控除 by dependent category. */
const DEPENDENT_DEDUCTION = {
  general: { income: 380_000, resident: 330_000 },            // ages 16–18, 23–69
  specific: { income: 630_000, resident: 450_000 },           // ages 19–22 (特定扶養親族)
  elderly: { income: 480_000, resident: 380_000 },            // 70+
  elderlyCohabiting: { income: 580_000, resident: 450_000 },  // 70+ 同居老親等
  dependentIncomeCeiling: 580_000, // raised from 480,000 by the 2025 reform
};

/** 青色申告特別控除. Capped at business income — it cannot manufacture a loss. */
const BLUE_RETURN_DEDUCTION = {
  etax_double_entry: 650_000,  // double-entry + balance sheet + e-Tax (or 電子帳簿保存)
  paper_double_entry: 550_000, // double-entry + balance sheet, filed on paper
  simple: 100_000,             // 簡易簿記
  none: 0,                     // 白色申告
};

/** 個人事業税. The 業主控除 means most small freelancers owe nothing. */
const ENTERPRISE_TAX = {
  exemption: 2_900_000, // 事業主控除, pro-rated for a partial first year
  rates: {
    category1: 0.05,          // 第1種事業, 37 categories incl. 請負業 (most IT contracting)
    category2: 0.04,          // 第2種事業: 畜産業, 水産業, 薪炭製造業
    category3: 0.05,          // 第3種事業, most professional services
    category3_reduced: 0.03,  // あん摩・マッサージ・装蹄師業
    exempt: 0,                // not among the 70 listed categories (文筆業, 画家, 作曲家…)
  },
  installments: ['08-31', '11-30'],
};

/** 消費税. */
const CONSUMPTION_TAX = {
  standardRate: 0.10,
  reducedRate: 0.08,
  exemptionThreshold: 10_000_000,       // 基準期間 (two years prior) taxable sales
  specificPeriodThreshold: 10_000_000,  // 特定期間 (first six months of prior year)
  simplifiedSchemeCeiling: 50_000_000,  // 簡易課税 eligibility
  /** 簡易課税 みなし仕入率 by business category (事業区分). */
  deemedPurchaseRates: {
    type1_wholesale: 0.90,
    type2_retail: 0.80,
    type3_manufacturing: 0.70,
    type4_other: 0.60,
    type5_services: 0.50,   // most freelance services land here
    type6_realestate: 0.40,
  },
  /** 2割特例 — 20% of output tax, for invoice-driven registrants. */
  twentyPercentRule: { rate: 0.20, availableThrough: 2026 },
  filingDeadline: '03-31',
};

/** 復興特別所得税 — 2.1% surtax on national income tax, running through 2037. */
const RECONSTRUCTION_SURTAX = { rate: 0.021, throughYear: 2037 };

/** 住民税. The 所得割 rate is near-universal; 均等割 varies slightly by city. */
const RESIDENT_TAX = {
  incomeRate: { prefectural: 0.04, municipal: 0.06 },
  perCapita: { prefectural: 1_000, municipal: 3_000, forest: 1_000 }, // 均等割 + 森林環境税
  /**
   * 調整控除 offsets the gap between income-tax and resident-tax personal
   * deductions. The statutory basic-deduction gap stayed at 50,000 after the
   * 2025 reform, even though the income-tax figure rose to 580,000.
   */
  adjustmentDeduction: { basicGap: 50_000, threshold: 2_000_000, rate: 0.05, floor: 2_500 },
  /** 非課税限度額 for 1級地 (most major cities). */
  exemptionThresholds: { perPerson: 350_000, withDependents: 310_000, single: 450_000 },
  installments: ['06-30', '08-31', '10-31', '01-31'],
};

/** 国民年金 — a flat monthly premium, set per fiscal year (April to March). */
const NATIONAL_PENSION = {
  monthlyByFiscalYear: { 2024: 16_980, 2025: 17_510, 2026: 17_920 },
  supplementaryMonthly: 400, // 付加年金: 400/mo buys 200 × months of extra annual pension
};

/**
 * 国民健康保険 presets. These are not statutory — every municipality sets its
 * own rates annually. Treat them as a starting point and overwrite them from
 * your own 保険料通知書. The base is 総所得金額等 less the resident-tax 基礎控除.
 */
const NHI_PRESETS = {
  tokyo23: {
    label: 'Tokyo 23 wards (東京23区)',
    baseDeduction: 430_000,
    medical: { incomeRate: 0.0869, perCapita: 49_100, cap: 660_000 },
    support: { incomeRate: 0.0280, perCapita: 16_500, cap: 260_000 },
    nursing: { incomeRate: 0.0244, perCapita: 16_500, cap: 170_000 }, // ages 40–64 only
  },
  osaka: {
    label: 'Osaka City (大阪市)',
    baseDeduction: 430_000,
    medical: { incomeRate: 0.0879, perCapita: 34_707, cap: 660_000 },
    support: { incomeRate: 0.0319, perCapita: 12_612, cap: 260_000 },
    nursing: { incomeRate: 0.0288, perCapita: 17_685, cap: 170_000 },
  },
  yokohama: {
    label: 'Yokohama (横浜市)',
    baseDeduction: 430_000,
    medical: { incomeRate: 0.0819, perCapita: 34_400, cap: 660_000 },
    support: { incomeRate: 0.0301, perCapita: 13_060, cap: 260_000 },
    nursing: { incomeRate: 0.0250, perCapita: 15_800, cap: 170_000 },
  },
  fukuoka: {
    label: 'Fukuoka (福岡市)',
    baseDeduction: 430_000,
    medical: { incomeRate: 0.0956, perCapita: 26_781, cap: 660_000 },
    support: { incomeRate: 0.0333, perCapita: 9_331, cap: 260_000 },
    nursing: { incomeRate: 0.0304, perCapita: 14_112, cap: 170_000 },
  },
  custom: {
    label: 'Custom — enter your own city rates',
    baseDeduction: 430_000,
    medical: { incomeRate: 0.085, perCapita: 40_000, cap: 660_000 },
    support: { incomeRate: 0.030, perCapita: 14_000, cap: 260_000 },
    nursing: { incomeRate: 0.025, perCapita: 16_000, cap: 170_000 },
  },
};

/** Retirement-style deductions — the largest voluntary levers a freelancer has. */
const PENSION_SCHEMES = {
  ideco: { monthlyMax: 68_000, annualMax: 816_000, label: 'iDeCo (第1号被保険者)' },
  smallEnterprise: { monthlyMax: 70_000, annualMax: 840_000, label: '小規模企業共済' },
  nationalPensionFund: { monthlyMax: 68_000, label: '国民年金基金' },
  note: 'iDeCo and 国民年金基金 share one 68,000/month ceiling; 小規模企業共済 has its own. '
      + 'All three fall under 小規模企業共済等掛金控除, which has no combined cap.',
};

/** Insurance-premium deductions, using post-2012 new-contract figures. */
const INSURANCE_DEDUCTIONS = {
  life: {
    perCategoryMax: 40_000, totalMax: 120_000,
    residentPerCategoryMax: 28_000, residentTotalMax: 70_000,
  },
  earthquake: { max: 50_000, residentMax: 25_000 },
};

/** 医療費控除 — expenses beyond the lesser of 5% of income or 100,000. */
const MEDICAL_DEDUCTION = { floorRate: 0.05, floorCap: 100_000, max: 2_000_000 };

/** 寄附金控除, the mechanism behind ふるさと納税. */
const DONATION_DEDUCTION = { floor: 2_000, incomeLimitRate: 0.40, residentLimitRate: 0.30 };

/** Fixed-asset thresholds. The 300,000 rule is blue-return only. */
const DEPRECIATION = {
  immediateExpense: 100_000,       // under this → 消耗品費
  lumpSum3Year: 200_000,           // under this → 一括償却資産, one third per year
  blueReturnImmediate: 300_000,    // 少額減価償却資産の特例
  blueReturnAnnualCap: 3_000_000,  // total claimable per year under that rule
  /** Statutory useful lives (法定耐用年数) in years. */
  usefulLives: {
    computer: 4, server: 5, smartphone: 4, tablet: 4, camera: 5,
    furniture: 8, officeEquipment: 5, software: 5, website: 5,
    car: 6, bicycle: 2, airConditioner: 6, other: 5,
  },
};

/** 予定納税 — two prepayments once the prior year's tax reaches 150,000. */
const ESTIMATED_TAX = {
  threshold: 150_000,
  fraction: 1 / 3,
  installments: [{ due: '07-31', label: '第1期' }, { due: '11-30', label: '第2期' }],
};

/** Loss carry-forward, a blue-return privilege. */
const LOSS_CARRYFORWARD = { years: 3, blueReturnOnly: true };

/**
 * 非永住者 test: a non-Japanese national resident in Japan for five years or
 * less out of the previous ten. Past that, worldwide income is taxable.
 */
const NON_PERMANENT_RESIDENT = { yearsThreshold: 5, lookbackYears: 10 };

const SOURCES = [
  { label: '所得税の速算表', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm' },
  { label: '基礎控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm' },
  { label: '青色申告特別控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2072.htm' },
  { label: '非永住者の課税範囲', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2010.htm' },
  { label: '外貨建取引の換算 (所基通57の3)', url: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/07/03.htm' },
  { label: '国民年金保険料', url: 'https://www.nenkin.go.jp/service/kokunen/hokenryo/20150428.html' },
  { label: '個人事業税 (東京都)', url: 'https://www.tax.metro.tokyo.lg.jp/kazei/kojin_jigyo.html' },
];

/** The filing deadline slides forward when March 15 lands on a weekend. */
function filingDeadline(taxYear) {
  const base = new Date(Date.UTC(taxYear + 1, 2, 15));
  const day = base.getUTCDay();
  if (day === 0) base.setUTCDate(16);      // Sunday → Monday
  else if (day === 6) base.setUTCDate(17); // Saturday → Monday
  return base.toISOString().slice(0, 10);
}

function buildYear(year, overrides = {}) {
  return Object.freeze({
    year,
    meta: {
      verified: '2026-09-28',
      sources: SOURCES,
      caveat: 'Statutory figures change every year. Verify against the NTA before you file.',
    },
    filingDeadline: filingDeadline(year),
    incomeTaxBrackets: INCOME_TAX_BRACKETS,
    basicDeduction: BASIC_DEDUCTION_2025_2026,
    residentBasicDeduction: RESIDENT_BASIC_DEDUCTION,
    spouseDeduction: SPOUSE_DEDUCTION,
    spouseSpecialDeduction: SPOUSE_SPECIAL_DEDUCTION,
    dependentDeduction: DEPENDENT_DEDUCTION,
    blueReturnDeduction: BLUE_RETURN_DEDUCTION,
    enterpriseTax: ENTERPRISE_TAX,
    consumptionTax: CONSUMPTION_TAX,
    reconstructionSurtax: RECONSTRUCTION_SURTAX,
    residentTax: RESIDENT_TAX,
    nationalPension: NATIONAL_PENSION,
    nhiPresets: NHI_PRESETS,
    pensionSchemes: PENSION_SCHEMES,
    insuranceDeductions: INSURANCE_DEDUCTIONS,
    medicalDeduction: MEDICAL_DEDUCTION,
    donationDeduction: DONATION_DEDUCTION,
    depreciation: DEPRECIATION,
    estimatedTax: ESTIMATED_TAX,
    lossCarryforward: LOSS_CARRYFORWARD,
    nonPermanentResident: NON_PERMANENT_RESIDENT,
    ...overrides,
  });
}

export const TAX_YEARS = {
  2024: buildYear(2024, {
    basicDeduction: BASIC_DEDUCTION_LEGACY,
    spouseDeduction: { ...SPOUSE_DEDUCTION, spouseIncomeCeiling: 480_000 },
    dependentDeduction: { ...DEPENDENT_DEDUCTION, dependentIncomeCeiling: 480_000 },
  }),
  2025: buildYear(2025),
  2026: buildYear(2026),
  2027: buildYear(2027, { basicDeduction: BASIC_DEDUCTION_FROM_2027 }),
};

export const DEFAULT_TAX_YEAR = 2025;
export const SUPPORTED_YEARS = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);

/** Falls back to the nearest supported year rather than throwing. */
export function ratesFor(year) {
  if (TAX_YEARS[year]) return TAX_YEARS[year];
  const nearest = SUPPORTED_YEARS.reduce(
    (best, y) => (Math.abs(y - year) < Math.abs(best - year) ? y : best),
    SUPPORTED_YEARS[0],
  );
  return TAX_YEARS[nearest];
}

/** Walks a `{ upTo, … }` table and returns the first row the value fits in. */
export function tierFor(table, value) {
  return table.find((row) => value <= row.upTo) ?? table[table.length - 1];
}

/** Index of the filer-income tier, shared by the two spouse deductions. */
export function filerIncomeTier(rates, filerTotalIncome) {
  const idx = rates.spouseDeduction.byFilerIncome.findIndex((r) => filerTotalIncome <= r.upTo);
  return idx === -1 ? rates.spouseDeduction.byFilerIncome.length - 1 : idx;
}

/** Pension premiums run April–March, so Jan–Mar belong to the prior fiscal year. */
export function pensionMonthly(rates, date = new Date()) {
  const fy = date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
  const table = rates.nationalPension.monthlyByFiscalYear;
  const years = Object.keys(table).map(Number);
  if (table[fy]) return table[fy];
  return table[fy < Math.min(...years) ? Math.min(...years) : Math.max(...years)];
}

/** True when the rate config has not been checked in over a year. */
export function ratesAreStale(rates, today = new Date()) {
  const verified = new Date(rates.meta.verified);
  const ageDays = (today - verified) / 86_400_000;
  return ageDays > 365;
}

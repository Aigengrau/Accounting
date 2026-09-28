/**
 * The advisory engine.
 *
 * Rule-based, and deliberately quantified: every recommendation is re-run
 * through the tax engine so it can state what it actually saves in yen rather
 * than gesturing at "tax efficiency". A tip that does not name a number is not
 * worth acting on.
 *
 * Recommendations are scored and sorted by annual saving, with compliance risks
 * promoted above savings — an unfiled 青色申告承認申請書 costs more than any
 * optimisation gains.
 *
 * None of this is professional tax advice. It encodes the general rules and
 * points at the statute so you can check the reasoning or take it to a 税理士.
 */

import { computeAll, marginalImpact } from './engine.js';
import { auditIncomeSetup, RESIDENCY } from './sourcing.js';
import { auditFxQuality } from '../fx.js';

const jp = (n) => `¥${Math.round(n).toLocaleString('en-US')}`;

const SEVERITY_WEIGHT = { critical: 10_000_000, high: 1_000_000, medium: 0, low: -1_000_000 };

/**
 * Produces the full advisory report.
 *
 * @param {object} input        tax engine input
 * @param {object} context      { residency, streams, transactions, profile }
 */
export function advise(input, context = {}) {
  const base = computeAll(input);
  const rates = base.rates;
  const items = [];
  const profile = context.profile || {};

  const push = (item) => items.push(item);

  // ---------------------------------------------------------------- compliance

  if (!profile.filedKaigyoTodoke) {
    push({
      id: 'kaigyo-todoke',
      severity: 'high',
      category: 'compliance',
      title: 'File your 開業届 if you have not',
      saving: 0,
      body: 'The 個人事業の開業・廃業等届出書 is due within one month of starting business. It is free, one page, '
          + 'and filing it is what makes you a recognised sole proprietor. Without it you cannot hold blue-return '
          + 'status, which is worth the 650,000 yen deduction on its own.',
      action: 'Take it to your local tax office, or file through e-Tax. Bring your residence card and My Number.',
      statute: '所得税法 229条',
    });
  }

  if (!profile.filedBlueReturnApplication && input.business?.blueReturnType !== 'none') {
    push({
      id: 'blue-application',
      severity: 'critical',
      category: 'compliance',
      title: 'The blue-return application has a hard deadline',
      saving: 0,
      body: 'The 所得税の青色申告承認申請書 must be filed by March 15 of the year you want it to apply to, or within '
          + 'two months of starting business. Miss it and you file white for the whole year — there is no late '
          + 'filing and no exception. The app is set up for blue-return bookkeeping, so confirm the application is '
          + 'actually on file.',
      action: 'Check with your tax office whether your application is registered. If not, file it now so it '
            + 'applies to next year.',
      statute: '所得税法 144条',
    });
  }

  // --------------------------------------------------- income sourcing hazards

  if (context.residency && context.streams?.length) {
    for (const flag of auditIncomeSetup(context.streams, context.residency)) {
      push({
        id: `sourcing-${flag.title.slice(0, 20)}`,
        severity: flag.severity === 'high' ? 'critical' : flag.severity,
        category: 'sourcing',
        title: flag.title,
        saving: 0,
        body: flag.detail,
        action: flag.action,
        statute: flag.statute,
      });
    }
  }

  // The single most valuable thing a non-permanent resident can plan around.
  if (context.residency?.status === RESIDENCY.NON_PERMANENT) {
    const yearsLeft = context.residency.yearsRemaining ?? 0;
    push({
      id: 'npr-window',
      severity: yearsLeft <= 1.5 ? 'high' : 'medium',
      category: 'planning',
      title: `Your non-permanent resident window closes in about ${yearsLeft.toFixed(1)} years`,
      saving: 0,
      body: 'While you are a 非永住者, foreign-source income that is paid abroad and kept abroad falls outside '
          + 'Japanese tax. That covers foreign rent, dividends, interest and — most valuably — capital gains on '
          + 'foreign securities. It does not cover freelance work you perform while sitting in Japan, which is '
          + 'Japan-source however it is paid.\n\n'
          + 'Once you pass five years of residence in the last ten, your worldwide income becomes taxable, '
          + 'including gains that accrued entirely before you arrived in Japan.',
      action: 'If you hold appreciated foreign assets, consider realising the gains before the crossover and '
            + 'keeping the proceeds outside Japan. Afterwards the same sale is fully taxable here. Worth one '
            + 'paid hour with a 税理士 who handles expatriates.',
      statute: '所得税法 7条1項2号',
    });
  }

  // ------------------------------------------------------- blue-return posture

  const blueType = input.business?.blueReturnType || 'none';
  if (blueType !== 'etax_double_entry') {
    const impact = marginalImpact(input, (m) => { m.business.blueReturnType = 'etax_double_entry'; });
    if (impact.taxSaved > 0) {
      push({
        id: 'blue-65',
        severity: 'high',
        category: 'deduction',
        title: 'Move to the 650,000 yen blue-return deduction',
        saving: impact.taxSaved,
        body: `You are currently claiming the ${blueType === 'none' ? 'white return (no deduction)' : blueType.replace(/_/g, ' ')} `
            + `treatment. The full 650,000 yen deduction needs double-entry bookkeeping, a balance sheet, and filing `
            + `through e-Tax (or keeping your books under 電子帳簿保存法). This app produces all three.`,
        action: 'Keep entering transactions here, then file through e-Tax rather than on paper. Paper filing caps '
              + 'the deduction at 550,000 even with perfect books.',
        statute: '租税特別措置法 25条の2',
      });
    }
  }

  // ------------------------------------------- the two big voluntary shelters

  const currentMutual = Number(input.deductions?.smallEnterpriseMutual) || 0;
  const mutualMax = rates.pensionSchemes.smallEnterprise.annualMax;
  if (currentMutual < mutualMax && base.totalIncome > 1_000_000) {
    const headroom = mutualMax - currentMutual;
    const impact = marginalImpact(input, (m) => {
      m.deductions = m.deductions || {};
      m.deductions.smallEnterpriseMutual = mutualMax;
    });
    push({
      id: 'small-enterprise-mutual',
      severity: 'medium',
      category: 'deduction',
      title: '小規模企業共済 is the strongest deduction available to you',
      saving: impact.taxSaved,
      body: `You can contribute up to ${jp(mutualMax)} a year (1,000–70,000 yen a month) and deduct every yen. `
          + `You have ${jp(headroom)} of headroom. Unlike an expense, the money stays yours — it comes back as a `
          + `lump sum when you close the business or retire, taxed then under the far gentler 退職所得 rules. `
          + `At your marginal rate of ${(base.summary.marginalRate * 100).toFixed(0)}%, filling the headroom saves `
          + `${jp(impact.taxSaved)} of tax while setting aside ${jp(headroom)} of your own savings.`,
      action: 'Apply through 中小機構 or most banks. You can change the monthly amount later, and pause it if cash '
            + 'gets tight. Contributions must be paid within the calendar year to count, and you may prepay up to '
            + '12 months in December to pull a deduction forward.',
      statute: '所得税法 75条',
      link: { label: '中小機構 小規模企業共済', url: 'https://www.smrj.go.jp/kyosai/skyosai/' },
    });
  }

  const currentIdeco = Number(input.deductions?.ideco) || 0;
  const idecoMax = rates.pensionSchemes.ideco.annualMax;
  if (currentIdeco < idecoMax && base.totalIncome > 1_000_000) {
    const impact = marginalImpact(input, (m) => {
      m.deductions = m.deductions || {};
      m.deductions.ideco = idecoMax;
    });
    push({
      id: 'ideco',
      severity: 'medium',
      category: 'deduction',
      title: `iDeCo adds up to ${jp(idecoMax)} of deductible room`,
      saving: impact.taxSaved,
      body: `As a 第1号被保険者 you may contribute up to 68,000 yen a month. This sits in the same deduction `
          + `category as 小規模企業共済 but has its own separate ceiling, so you can use both — together up to `
          + `${jp(idecoMax + mutualMax)} a year of fully deductible contributions.\n\n`
          + 'The trade-off is real: iDeCo money is locked until you are 60, with no early access on hardship. '
          + '小規模企業共済 is the more flexible of the two, so fill that first.',
      action: 'Open an account with a low-fee provider (SBI or Rakuten). Note that the 68,000 yen ceiling is shared '
            + 'with 国民年金基金 and 付加年金, so subtract those if you use them.',
      statute: '所得税法 75条',
    });
  }

  // 付加年金 — small money, absurd return.
  if (!input.pension?.supplementary) {
    push({
      id: 'fuka-nenkin',
      severity: 'low',
      category: 'value',
      title: '付加年金 pays for itself in two years',
      saving: 0,
      body: 'An extra 400 yen a month on top of your national pension buys 200 yen × (months paid) of additional '
          + 'annual pension, for life. Forty years of contributions costs 192,000 yen and returns 96,000 yen every '
          + 'year forever. It breaks even after two years of collecting, and the contributions are deductible too. '
          + 'There is no better-value option open to a 第1号被保険者.',
      action: 'Apply at your city hall pension desk. Note it is mutually exclusive with 国民年金基金, and it shares '
            + 'the iDeCo ceiling, so it reduces your iDeCo room by 400 yen a month.',
      statute: '国民年金法 87条の2',
    });
  }

  // ------------------------------------------------ health insurance structure

  // The creators' health insurance union is a dramatic saving for eligible trades
  // and almost nobody knows it exists.
  if (base.nhi.total > 300_000) {
    const unionAnnual = 21_100 * 12; // approximate 2025 rate, medical portion, single member
    const saving = base.nhi.total - unionAnnual;
    if (saving > 50_000) {
      push({
        id: 'bunbi-kokuho',
        severity: 'high',
        category: 'structure',
        title: 'Check whether you qualify for 文芸美術国民健康保険組合',
        saving,
        body: `Your municipal health insurance is income-based and comes to roughly ${jp(base.nhi.total)} a year. `
            + `The 文芸美術国民健康保険組合 charges a flat premium — around 21,100 yen a month regardless of income, `
            + `about ${jp(unionAnnual)} a year. On your income that is roughly ${jp(saving)} saved annually, and the `
            + `gap widens as you earn more.\n\n`
            + 'Eligibility runs through membership of an affiliated professional association, and it covers design, '
            + 'illustration, writing, photography, translation and several adjacent creative trades. Whether '
            + 'software development qualifies depends on the specific association, so ask before assuming.',
        action: 'Find an affiliated association matching your work, join it, then apply to the union. This is one '
              + 'of the largest single savings available to a creative freelancer in Japan.',
        link: { label: '文芸美術国民健康保険組合', url: 'https://www.bunbi.com/' },
      });
    }
  }

  if (base.totalIncome < 1_000_000 && base.nhi.total > 50_000) {
    push({
      id: 'nhi-reduction',
      severity: 'medium',
      category: 'structure',
      title: 'You may qualify for a health insurance reduction',
      saving: 0,
      body: 'Municipalities reduce the per-capita portion of national health insurance by 70%, 50% or 20% for low '
          + 'household income, and will also reduce premiums after a sharp income drop, illness or disaster. It is '
          + 'not automatic in every city.',
      action: 'Ask your city hall about 国民健康保険料の減額・減免. Bring last year’s return.',
    });
  }

  // --------------------------------------------------------- enterprise tax

  if (base.enterpriseTax.applicable && base.enterpriseTax.total > 0) {
    push({
      id: 'enterprise-category',
      severity: 'medium',
      category: 'classification',
      title: 'Confirm your enterprise tax category — some professions owe nothing',
      saving: base.enterpriseTax.total,
      body: `You are being charged ${jp(base.enterpriseTax.total)} of 個人事業税 as a `
          + `${base.enterpriseTax.category.replace('category', 'Category ')} business. That tax applies only to the `
          + `70 categories listed in 地方税法 72条の2, and several creative professions are simply absent from the `
          + `list — writing (文筆業), painting, composing, and some forms of authorship pay nothing at all.\n\n`
          + 'Programming and system development are usually treated as 請負業 and taxed, but the classification '
          + 'turns on what your contracts actually describe. Work sold as authored content sits differently from '
          + 'work sold as contracted development.',
      action: 'Call your prefectural tax office (都道府県税事務所) and ask which category your work falls in. If your '
            + 'income is genuinely from authorship, say so — the difference is the whole 5%.',
      statute: '地方税法 72条の2',
    });
  }

  // ------------------------------------------------------------ home office

  const revenue = base.business.revenue;
  const expenseRatio = revenue > 0 ? base.business.expenses / revenue : 0;
  if (expenseRatio < 0.15 && revenue > 2_000_000) {
    push({
      id: 'kaji-anbun',
      severity: 'high',
      category: 'deduction',
      title: `Your expenses are only ${(expenseRatio * 100).toFixed(0)}% of revenue — you are probably under-claiming`,
      saving: 0,
      body: 'If you work from home, a proportion of your household costs is deductible: rent, electricity, gas, '
          + 'water, internet, and phone. The mechanism is 家事按分 — you apportion each cost between business and '
          + 'private use on a defensible basis, usually floor area for rent and working hours for utilities.\n\n'
          + 'A typical home-based freelancer claims 20–30% of rent and 30–50% of internet. At your marginal rate of '
          + `${(base.summary.marginalRate * 100).toFixed(0)}%, every 100,000 yen you correctly claim is about `
          + `${jp(base.summary.marginalRate * 100_000)} less tax.`,
      action: 'Measure your work area as a share of your home and apply that percentage to rent. Write the basis '
            + 'down once and use it consistently. The app has a 家事按分 field on every expense.',
      statute: '所得税法 45条, 所得税基本通達 45-2',
    });
  }

  // ------------------------------------------------- small asset expensing

  push({
    id: 'shogaku-genka',
    severity: 'low',
    category: 'timing',
    title: 'Blue filers can expense assets up to 300,000 yen immediately',
    saving: 0,
    body: 'Normally anything over 100,000 yen has to be depreciated over its statutory life — four years for a '
        + 'laptop. As a blue filer you may instead write off the whole cost in the year of purchase for items under '
        + '300,000 yen, up to 3,000,000 yen of such purchases a year (少額減価償却資産の特例).',
    action: 'If you need equipment and this year’s income is high, buy before December 31. If next year looks '
          + 'better, wait. The asset must be in service by year end, not merely ordered.',
    statute: '租税特別措置法 28条の2',
  });

  // ------------------------------------------------------- ふるさと納税

  const furusatoLimit = estimateFurusatoLimit(base);
  if (furusatoLimit > 10_000 && !(input.deductions?.donations > 0)) {
    push({
      id: 'furusato',
      severity: 'low',
      category: 'value',
      title: `ふるさと納税: roughly ${jp(furusatoLimit)} of your resident tax can become goods`,
      saving: 0,
      body: `Donate to any municipality and everything above 2,000 yen comes off your income and resident tax, while `
          + `you keep a return gift worth about 30% of the donation. It is not a tax saving — it is a transfer of `
          + `tax you already owe into rice, meat and fruit. Your approximate ceiling this year is `
          + `${jp(furusatoLimit)}; donate beyond it and the excess is a plain gift.`,
      action: 'Donate by December 31. As someone who files a tax return anyway, ignore the ワンストップ特例 and just '
            + 'enter the donations on your return. Keep the 受領証明書 from each municipality.',
      statute: '所得税法 78条, 地方税法 37条の2',
    });
  }

  // ------------------------------------------------ spouse as an employee

  const spouse = input.deductions?.spouse;
  if (spouse?.hasSpouse && base.business.income > 3_000_000 && !input.business?.familyWages) {
    push({
      id: 'senju-sha',
      severity: 'medium',
      category: 'structure',
      title: 'Paying your spouse a salary can split income across two brackets',
      saving: 0,
      body: 'A blue filer may pay a 青色事業専従者給与 to a spouse who genuinely works in the business, and deduct '
          + 'the whole amount with no statutory cap as long as it is reasonable for the work done. That moves income '
          + `out of your ${(base.incomeTax.bracket.rate * 100).toFixed(0)}% bracket into your spouse’s, which is `
          + 'often 5% or nil.\n\n'
          + 'The trade-off: once you pay a 専従者給与 you lose the 配偶者控除 entirely, so it only pays off above '
          + 'roughly 1,000,000 yen of salary. The work also has to be real, substantial and documented — this is a '
          + 'well-known audit target.',
      action: 'File 青色事業専従者給与に関する届出書 by March 15, stating the role and amount. Then pay it monthly by '
            + 'bank transfer, never in cash, and keep a record of what your spouse actually does.',
      statute: '所得税法 57条',
    });
  }

  // ------------------------------------------------------- consumption tax

  const ct = base.consumptionTax;
  if (!ct.isTaxablePerson && ct.baseperiodSales > rates.consumptionTax.exemptionThreshold * 0.8) {
    push({
      id: 'ct-threshold',
      severity: 'high',
      category: 'planning',
      title: 'You are approaching the consumption tax threshold',
      saving: 0,
      body: `Taxable sales of ${jp(ct.baseperiodSales)} are close to the 10,000,000 yen line. Cross it and you become `
          + 'a 課税事業者 two years later — the lag catches people out, because the bill arrives in a year that may '
          + 'be much leaner than the one that triggered it.\n\n'
          + 'Export-exempt sales to foreign clients count toward the threshold even though they carry no tax, so '
          + 'foreign revenue can push you over without generating any consumption tax to collect.',
      action: 'Model the two-year-ahead liability now. If most of your sales are export-exempt, registering may '
            + 'actually put you in refund position, since you reclaim input tax on Japanese costs against zero '
            + 'output tax.',
      statute: '消費税法 9条',
    });
  }

  if (ct.isTaxablePerson && ct.exportSales > 0) {
    push({
      id: 'ct-export',
      severity: 'high',
      category: 'deduction',
      title: 'Your foreign-client sales are export-exempt, and may generate a refund',
      saving: 0,
      body: `${jp(ct.exportSales)} of your sales are services consumed outside Japan, which makes them 輸出免税 — `
          + 'zero-rated rather than exempt. The distinction matters: zero-rated sales still let you reclaim the '
          + 'consumption tax you paid on Japanese business costs. With little or no domestic output tax to offset, '
          + 'that reclaim comes back as a cash refund.',
      action: 'Choose 一般課税 rather than 簡易課税, since simplified filing cannot produce a refund. Keep contracts '
            + 'and correspondence proving each client is a non-resident and the benefit is received abroad.',
      statute: '消費税法 7条, 消費税法施行令 17条2項7号',
    });
  }

  if (ct.isTaxablePerson && ct.methods && Object.keys(ct.methods).length > 1) {
    const sorted = Object.entries(ct.methods).sort((a, b) => a[1].tax - b[1].tax);
    const [bestKey, bestVal] = sorted[0];
    const [, worstVal] = sorted[sorted.length - 1];
    if (worstVal.tax - bestVal.tax > 10_000) {
      push({
        id: 'ct-method',
        severity: 'medium',
        category: 'election',
        title: `Choose the right consumption tax method — the spread is ${jp(worstVal.tax - bestVal.tax)}`,
        saving: worstVal.tax - bestVal.tax,
        body: sorted.map(([, v]) => `${v.label}: ${jp(v.tax)}`).join('\n')
            + `\n\nCheapest on these figures: ${bestVal.label}.`,
        action: bestKey === 'simplified'
          ? 'Electing 簡易課税 requires 消費税簡易課税制度選択届出書 filed before the start of the tax period, and '
            + 'binds you for two years. It also blocks any refund, so do not elect it if you have large '
            + 'export-exempt sales.'
          : 'No election needed for 一般課税. Keep every qualifying invoice, since input tax credit now depends on '
            + 'holding 適格請求書 from registered suppliers.',
        statute: '消費税法 37条',
      });
    }
  }

  // --------------------------------------------------------- cash flow

  if (base.estimatedTax.required) {
    push({
      id: 'yotei-nozei',
      severity: 'high',
      category: 'cashflow',
      title: `Set aside ${jp(base.estimatedTax.installment)} for each of two prepayments next year`,
      saving: 0,
      body: base.estimatedTax.note,
      action: `Reserve ${jp(base.estimatedTax.installment)} for July 31 and the same again for November 30 of `
            + `${rates.year + 1}. If ${rates.year + 1} is clearly worse than ${rates.year}, you can apply to reduce `
            + 'the prepayment with a 予定納税額の減額申請 by July 15.',
      statute: '所得税法 104条, 111条',
    });
  }

  const monthly = base.summary.monthlySetAside;
  push({
    id: 'set-aside',
    severity: 'medium',
    category: 'cashflow',
    title: `Reserve ${jp(monthly)} a month against this year's liabilities`,
    saving: 0,
    body: `Your total burden of ${jp(base.summary.totalBurden)} covers income tax, resident tax, enterprise tax, `
        + `health insurance and pension. That is ${(base.summary.effectiveRate * 100).toFixed(0)}% of revenue, and `
        + 'the bills arrive spread across the following year — resident tax in June, enterprise tax in August and '
        + 'November, health insurance across ten instalments. Nothing warns you in advance.',
    action: `Move ${jp(monthly)} into a separate account every month and treat it as gone. The account is the whole `
          + 'technique; freelancers who do this are never surprised.',
  });

  // ---------------------------------------------------- FX record quality

  if (context.transactions?.length) {
    const fxAudit = auditFxQuality(context.transactions, base.taxYear);
    for (const issue of fxAudit.issues) {
      push({
        id: `fx-${issue.title.slice(0, 20)}`,
        severity: issue.severity === 'high' ? 'high' : issue.severity,
        category: 'records',
        title: issue.title,
        saving: 0,
        body: issue.detail,
        action: 'Open the FX log and fix these before filing. Once you file, correcting a rate means an amended '
              + 'return.',
        statute: '所得税基本通達 57の3-2',
      });
    }
  }

  // ------------------------------------------------------------ record keeping

  push({
    id: 'record-retention',
    severity: 'low',
    category: 'compliance',
    title: 'Keep your books for seven years',
    saving: 0,
    body: 'Blue filers must retain journals, ledgers, invoices and receipts for seven years — five for some '
        + 'secondary documents. Since January 2024, anything you receive electronically must be stored '
        + 'electronically with searchable date, amount and counterparty; printing a PDF invoice and filing the paper '
        + 'no longer satisfies 電子帳簿保存法.',
    action: 'Name files consistently as date_counterparty_amount and keep them in one folder per year. Export from '
          + 'this app regularly and keep the JSON alongside them.',
    statute: '電子帳簿保存法 7条',
  });

  // Sort compliance risk first, then by yen saved.
  items.sort((a, b) => {
    const wa = (SEVERITY_WEIGHT[a.severity] || 0) + (a.saving || 0);
    const wb = (SEVERITY_WEIGHT[b.severity] || 0) + (b.saving || 0);
    return wb - wa;
  });

  const totalIdentified = items.reduce((s, i) => s + (i.saving || 0), 0);

  return {
    computed: base,
    items,
    totalIdentifiedSaving: totalIdentified,
    counts: {
      critical: items.filter((i) => i.severity === 'critical').length,
      high: items.filter((i) => i.severity === 'high').length,
      medium: items.filter((i) => i.severity === 'medium').length,
      low: items.filter((i) => i.severity === 'low').length,
    },
  };
}

/**
 * Approximates the ふるさと納税 ceiling.
 *
 * The real formula inverts the 特例分 credit and depends on the resident-tax
 * 所得割 and your marginal income-tax rate. This is the standard approximation
 * and lands within a few percent; the app labels it as an estimate rather than
 * pretending otherwise.
 */
export function estimateFurusatoLimit(computed) {
  const residentLevy = computed.residentTax.incomeLevy;
  if (residentLevy <= 0) return 0;
  const marginal = computed.incomeTax.bracket.rate;
  const surtaxFactor = 1.021;
  // 特例分 covers 100% − 10% − (marginal × 1.021), and caps at 20% of the levy.
  const denom = 1 - 0.1 - marginal * surtaxFactor;
  if (denom <= 0) return 0;
  const limit = (residentLevy * 0.2) / denom + 2000;
  return Math.floor(limit / 1000) * 1000;
}

/**
 * Compares filing postures side by side, so the choice is made on numbers.
 */
export function compareFilingOptions(input) {
  const options = ['none', 'simple', 'paper_double_entry', 'etax_double_entry'];
  const labels = {
    none: { en: 'White return', ja: '白色申告', effort: 'Minimal records' },
    simple: { en: 'Blue, simple books', ja: '青色 (簡易簿記)', effort: 'Single-entry cash book' },
    paper_double_entry: { en: 'Blue, double entry, paper', ja: '青色 (複式・紙)', effort: 'Double-entry books' },
    etax_double_entry: { en: 'Blue, double entry, e-Tax', ja: '青色 (複式・e-Tax)', effort: 'Double-entry books + e-Tax' },
  };

  const results = options.map((opt) => {
    const variant = structuredClone(input);
    variant.business = variant.business || {};
    variant.business.blueReturnType = opt;
    const computed = computeAll(variant);
    return {
      option: opt,
      ...labels[opt],
      deduction: computed.business.blueDeduction,
      totalBurden: computed.summary.totalBurden,
      totalTax: computed.summary.totalTax,
      netIncome: computed.business.revenue - computed.business.expenses - computed.summary.totalBurden,
    };
  });

  const worst = Math.max(...results.map((r) => r.totalBurden));
  for (const r of results) r.savingVsWhite = worst - r.totalBurden;

  return {
    results,
    best: results.reduce((b, r) => (r.totalBurden < b.totalBurden ? r : b), results[0]),
    extras: {
      lossCarryforward: 'Blue return only: carry losses forward three years.',
      familySalary: 'Blue return only: deduct a spouse or family salary with no statutory cap.',
      smallAssets: 'Blue return only: expense assets under 300,000 yen immediately.',
      reserve: 'Blue return only: 貸倒引当金, a bad-debt reserve.',
    },
  };
}

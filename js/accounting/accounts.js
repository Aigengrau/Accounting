/**
 * Chart of accounts (勘定科目).
 *
 * The account codes follow the layout of the 青色申告決算書, so the report
 * generator can map straight onto the boxes on the form rather than guessing.
 * Every account carries its Japanese name, because that is what appears on the
 * form and what a 税理士 or tax office clerk will ask you about.
 *
 * `homeOfficeEligible` marks accounts where 家事按分 normally applies — the
 * apportionment of a household cost between business and private use.
 */

export const ACCOUNT_TYPE = {
  ASSET: 'asset',        // 資産
  LIABILITY: 'liability', // 負債
  EQUITY: 'equity',      // 資本
  REVENUE: 'revenue',    // 収益
  EXPENSE: 'expense',    // 費用
};

/** Debit increases assets and expenses; credit increases the rest. */
export const NORMAL_BALANCE = {
  [ACCOUNT_TYPE.ASSET]: 'debit',
  [ACCOUNT_TYPE.EXPENSE]: 'debit',
  [ACCOUNT_TYPE.LIABILITY]: 'credit',
  [ACCOUNT_TYPE.EQUITY]: 'credit',
  [ACCOUNT_TYPE.REVENUE]: 'credit',
};

const A = ACCOUNT_TYPE;

export const ACCOUNTS = [
  // ---------------------------------------------------------------- 資産 assets
  { code: '100', ja: '現金', en: 'Cash', type: A.ASSET, group: 'current', bs: true },
  { code: '110', ja: '普通預金', en: 'Bank account', type: A.ASSET, group: 'current', bs: true,
    hint: 'One account per bank. Keep your JPY and foreign-currency accounts separate.' },
  { code: '111', ja: '外貨預金', en: 'Foreign currency account', type: A.ASSET, group: 'current', bs: true,
    hint: 'Revalue at year end; the difference is 為替差損益.' },
  { code: '120', ja: '売掛金', en: 'Accounts receivable', type: A.ASSET, group: 'current', bs: true,
    hint: 'Invoiced but unpaid. Recognise revenue here when you invoice, not when you are paid.' },
  { code: '130', ja: '前払金', en: 'Prepaid expenses', type: A.ASSET, group: 'current', bs: true },
  { code: '135', ja: '前払費用', en: 'Deferred charges', type: A.ASSET, group: 'current', bs: true },
  { code: '140', ja: '事業主貸', en: 'Owner drawings', type: A.ASSET, group: 'equity-contra', bs: true,
    hint: 'Money you take out for personal use, and the private share of any mixed cost. Not an expense.' },
  { code: '150', ja: '工具器具備品', en: 'Equipment', type: A.ASSET, group: 'fixed', bs: true, depreciable: true },
  { code: '151', ja: '一括償却資産', en: 'Lump-sum depreciable assets', type: A.ASSET, group: 'fixed', bs: true,
    hint: 'Items between 100,000 and 200,000 yen, written off one third per year over three years.' },
  { code: '152', ja: 'ソフトウェア', en: 'Software', type: A.ASSET, group: 'fixed', bs: true, depreciable: true },
  { code: '160', ja: '車両運搬具', en: 'Vehicles', type: A.ASSET, group: 'fixed', bs: true, depreciable: true },
  { code: '170', ja: '減価償却累計額', en: 'Accumulated depreciation', type: A.ASSET, group: 'fixed', bs: true, contra: true },
  { code: '180', ja: '敷金・保証金', en: 'Deposits', type: A.ASSET, group: 'fixed', bs: true },

  // ----------------------------------------------------------- 負債 liabilities
  { code: '200', ja: '買掛金', en: 'Accounts payable', type: A.LIABILITY, group: 'current', bs: true },
  { code: '210', ja: '未払金', en: 'Accrued expenses', type: A.LIABILITY, group: 'current', bs: true,
    hint: 'Costs incurred this year but paid next. Accruing them pulls the deduction into this year.' },
  { code: '220', ja: '前受金', en: 'Deferred revenue', type: A.LIABILITY, group: 'current', bs: true,
    hint: 'Paid in advance for work not yet done. Not revenue until you perform.' },
  { code: '230', ja: '預り金', en: 'Withholdings payable', type: A.LIABILITY, group: 'current', bs: true },
  { code: '240', ja: '未払消費税', en: 'Consumption tax payable', type: A.LIABILITY, group: 'current', bs: true },
  { code: '250', ja: '借入金', en: 'Loans payable', type: A.LIABILITY, group: 'long', bs: true },
  { code: '260', ja: '事業主借', en: 'Owner contributions', type: A.LIABILITY, group: 'equity-contra', bs: true,
    hint: 'Private money you put into the business, including business costs paid from a personal card.' },

  // --------------------------------------------------------------- 資本 equity
  { code: '300', ja: '元入金', en: 'Owner capital', type: A.EQUITY, group: 'equity', bs: true,
    hint: 'Rolls forward each year: prior capital + prior profit + 事業主借 − 事業主貸.' },

  // -------------------------------------------------------------- 収益 revenue
  { code: '400', ja: '売上高', en: 'Sales', type: A.REVENUE, group: 'operating', pl: true, form: 'sales' },
  { code: '410', ja: '雑収入', en: 'Miscellaneous income', type: A.REVENUE, group: 'other', pl: true, form: 'misc_income' },
  { code: '420', ja: '為替差益', en: 'FX gain', type: A.REVENUE, group: 'other', pl: true, form: 'misc_income',
    hint: 'Arises when a receivable or foreign balance is worth more in yen when settled than when booked.' },

  // ------------------------------------------- 費用 expenses, 決算書 order
  { code: '500', ja: '租税公課', en: 'Taxes and dues', type: A.EXPENSE, group: 'operating', pl: true, form: 'taxes_dues',
    hint: 'Enterprise tax, business-use property tax, stamp duty, trade association fees. '
        + 'Income tax, resident tax and your own pension are NOT deductible here.' },
  { code: '505', ja: '荷造運賃', en: 'Packing and freight', type: A.EXPENSE, group: 'operating', pl: true, form: 'freight' },
  { code: '510', ja: '水道光熱費', en: 'Utilities', type: A.EXPENSE, group: 'operating', pl: true, form: 'utilities',
    homeOfficeEligible: true, hint: 'Electricity, gas, water. Apportion by work area or hours if you work from home.' },
  { code: '515', ja: '旅費交通費', en: 'Travel and transport', type: A.EXPENSE, group: 'operating', pl: true, form: 'travel',
    hint: 'Train, bus, taxi, flights, hotels for business. Keep the purpose and who you met.' },
  { code: '520', ja: '通信費', en: 'Communications', type: A.EXPENSE, group: 'operating', pl: true, form: 'communication',
    homeOfficeEligible: true, hint: 'Internet, mobile, postage, domains, hosting. Typically 50–80% business.' },
  { code: '525', ja: '広告宣伝費', en: 'Advertising', type: A.EXPENSE, group: 'operating', pl: true, form: 'advertising' },
  { code: '530', ja: '接待交際費', en: 'Entertainment', type: A.EXPENSE, group: 'operating', pl: true, form: 'entertainment',
    hint: 'Client meals and gifts. Record who attended and why — this is the most scrutinised line on the form.' },
  { code: '535', ja: '損害保険料', en: 'Insurance', type: A.EXPENSE, group: 'operating', pl: true, form: 'insurance',
    homeOfficeEligible: true, hint: 'Business insurance and the business share of home contents insurance. '
        + 'Life and health insurance belong in personal deductions, not here.' },
  { code: '540', ja: '修繕費', en: 'Repairs', type: A.EXPENSE, group: 'operating', pl: true, form: 'repairs' },
  { code: '545', ja: '消耗品費', en: 'Supplies', type: A.EXPENSE, group: 'operating', pl: true, form: 'supplies',
    hint: 'Items under 100,000 yen, or under 300,000 as a blue filer using 少額減価償却資産の特例.' },
  { code: '550', ja: '減価償却費', en: 'Depreciation', type: A.EXPENSE, group: 'operating', pl: true, form: 'depreciation' },
  { code: '555', ja: '福利厚生費', en: 'Employee welfare', type: A.EXPENSE, group: 'operating', pl: true, form: 'welfare',
    hint: 'Only meaningful once you have employees. A sole proprietor cannot spend this on themselves.' },
  { code: '560', ja: '給料賃金', en: 'Wages', type: A.EXPENSE, group: 'operating', pl: true, form: 'wages' },
  { code: '565', ja: '外注工賃', en: 'Subcontractors', type: A.EXPENSE, group: 'operating', pl: true, form: 'outsourcing',
    hint: 'Work you contract out. Watch the withholding rules for certain Japanese payees.' },
  { code: '570', ja: '利子割引料', en: 'Interest paid', type: A.EXPENSE, group: 'operating', pl: true, form: 'interest' },
  { code: '575', ja: '地代家賃', en: 'Rent', type: A.EXPENSE, group: 'operating', pl: true, form: 'rent',
    homeOfficeEligible: true, hint: 'Office rent, or the business share of home rent by floor area. '
        + 'Typically 20–30% for a home-based freelancer.' },
  { code: '580', ja: '貸倒金', en: 'Bad debts', type: A.EXPENSE, group: 'operating', pl: true, form: 'bad_debts' },
  { code: '585', ja: '専従者給与', en: 'Family employee wages', type: A.EXPENSE, group: 'operating', pl: true, form: 'family_wages',
    hint: 'Blue return only, and you must have filed the 届出書 in advance. Claiming this forfeits 配偶者控除.' },
  { code: '590', ja: '支払手数料', en: 'Fees and commissions', type: A.EXPENSE, group: 'operating', pl: true, form: 'other',
    hint: 'Bank transfer fees, payment platform fees, FX conversion fees, professional fees.' },
  { code: '591', ja: '研修費', en: 'Training', type: A.EXPENSE, group: 'operating', pl: true, form: 'other',
    hint: 'Courses and books directly relevant to your work. Japanese lessons are generally not deductible.' },
  { code: '592', ja: '新聞図書費', en: 'Books and subscriptions', type: A.EXPENSE, group: 'operating', pl: true, form: 'other' },
  { code: '593', ja: '会議費', en: 'Meetings', type: A.EXPENSE, group: 'operating', pl: true, form: 'other',
    hint: 'Coffee and light meals during business discussion. Cheaper to defend than 接待交際費.' },
  { code: '595', ja: '為替差損', en: 'FX loss', type: A.EXPENSE, group: 'other', pl: true, form: 'other' },
  { code: '599', ja: '雑費', en: 'Miscellaneous', type: A.EXPENSE, group: 'operating', pl: true, form: 'misc',
    hint: 'Keep this small. A large 雑費 line invites questions, so create a named account instead.' },
];

export const ACCOUNTS_BY_CODE = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a]));

export function account(code) {
  const a = ACCOUNTS_BY_CODE[code];
  if (!a) throw new Error(`Unknown account code: ${code}`);
  return a;
}

export function accountsOfType(type) {
  return ACCOUNTS.filter((a) => a.type === type);
}

export const EXPENSE_ACCOUNTS = ACCOUNTS.filter((a) => a.type === ACCOUNT_TYPE.EXPENSE);
export const REVENUE_ACCOUNTS = ACCOUNTS.filter((a) => a.type === ACCOUNT_TYPE.REVENUE);
export const HOME_OFFICE_ACCOUNTS = ACCOUNTS.filter((a) => a.homeOfficeEligible);

/**
 * Plain-language categories for quick phone entry, each mapped to a real account.
 * Typing on a phone at a convenience store, nobody wants to pick 勘定科目 codes.
 */
export const QUICK_CATEGORIES = [
  { id: 'client-payment', label: 'Client payment received', icon: 'inbox', account: '400', kind: 'income' },
  { id: 'software', label: 'Software / subscription', icon: 'cloud', account: '520', kind: 'expense' },
  { id: 'hardware', label: 'Computer / equipment', icon: 'cpu', account: '545', kind: 'expense', checkAsset: true },
  { id: 'internet', label: 'Internet / phone', icon: 'wifi', account: '520', kind: 'expense', homeOffice: true },
  { id: 'rent', label: 'Rent', icon: 'home', account: '575', kind: 'expense', homeOffice: true },
  { id: 'utilities', label: 'Electricity / gas / water', icon: 'zap', account: '510', kind: 'expense', homeOffice: true },
  { id: 'transport', label: 'Train / taxi / travel', icon: 'train', account: '515', kind: 'expense' },
  { id: 'meeting', label: 'Coffee / meeting', icon: 'coffee', account: '593', kind: 'expense' },
  { id: 'client-meal', label: 'Client meal / gift', icon: 'gift', account: '530', kind: 'expense' },
  { id: 'books', label: 'Books / courses', icon: 'book', account: '592', kind: 'expense' },
  { id: 'fees', label: 'Bank / platform fees', icon: 'percent', account: '590', kind: 'expense' },
  { id: 'subcontract', label: 'Paid a subcontractor', icon: 'users', account: '565', kind: 'expense' },
  { id: 'tax-dues', label: 'Business tax / dues', icon: 'file', account: '500', kind: 'expense' },
  { id: 'supplies', label: 'Office supplies', icon: 'package', account: '545', kind: 'expense' },
  { id: 'drawing', label: 'Money taken for personal use', icon: 'out', account: '140', kind: 'transfer' },
  { id: 'owner-funds', label: 'Personal money into business', icon: 'in', account: '260', kind: 'transfer' },
  { id: 'other-expense', label: 'Something else', icon: 'more', account: '599', kind: 'expense' },
];

/**
 * Costs people commonly try to deduct that are not deductible, with the reason.
 * Surfaced in the UI at entry time, which is the only moment it is useful.
 */
export const NOT_DEDUCTIBLE = [
  { item: 'Income tax and resident tax', reason: 'Personal taxes on profit are never a business expense.' },
  { item: 'Your own national pension and health insurance', reason: 'These are personal deductions (社会保険料控除) '
    + 'on your return, not business expenses. Claiming them twice is a common error.' },
  { item: 'Your own life or medical insurance', reason: 'Personal deduction (生命保険料控除), capped at 120,000 yen.' },
  { item: 'Your own salary', reason: 'A sole proprietor has no salary. Money you take out is 事業主貸.' },
  { item: 'Fines and traffic tickets', reason: 'Explicitly non-deductible by statute.' },
  { item: 'Everyday clothing', reason: 'Only genuine uniforms or protective gear qualify. A suit does not.' },
  { item: 'Solo meals', reason: 'Eating alone while working is a personal cost, not 接待交際費 or 会議費.' },
  { item: 'Japanese language lessons', reason: 'Treated as general self-improvement unless you can show they are '
    + 'specifically required to perform the work you are paid for.' },
  { item: 'Commuting to your own home office', reason: 'There is no journey to deduct.' },
  { item: 'Medical costs', reason: 'Personal deduction (医療費控除) above the 100,000 yen floor.' },
];

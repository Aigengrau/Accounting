/**
 * Categories for everyday spending and income.
 *
 * Deliberately short. A list you can scan in one glance gets used; a list of
 * forty accounting codes gets abandoned by week two. Everything here is personal
 * spending — there is no business bookkeeping in this version.
 */

export const EXPENSE_CATEGORIES = [
  { id: 'groceries', label: 'Groceries', icon: 'basket' },
  { id: 'eating-out', label: 'Eating out', icon: 'bowl' },
  { id: 'rent', label: 'Rent', icon: 'home' },
  { id: 'utilities', label: 'Utilities', icon: 'bolt' },
  { id: 'transport', label: 'Transport', icon: 'train' },
  { id: 'phone', label: 'Phone & internet', icon: 'wifi' },
  { id: 'health', label: 'Health', icon: 'heart' },
  { id: 'household', label: 'Household', icon: 'box' },
  { id: 'clothing', label: 'Clothing', icon: 'shirt' },
  { id: 'fun', label: 'Fun', icon: 'star' },
  { id: 'family', label: 'Money sent home', icon: 'send' },
  { id: 'other', label: 'Other', icon: 'dots' },
];

/**
 * Income sources.
 *
 * Kept separate because the distinction matters later: rent from a property
 * abroad and freelance work are taxed under different rules in Japan, and having
 * them tagged from the start means the figures are usable when you do need to
 * file.
 */
export const INCOME_CATEGORIES = [
  { id: 'apartment', label: 'Apartment rent', icon: 'key', note: 'Rent from the flat you let out' },
  { id: 'freelance', label: 'Freelance work', icon: 'laptop', note: 'Paid for work you did' },
  { id: 'gift', label: 'Gift or transfer', icon: 'gift', note: 'Money given to you' },
  { id: 'other-income', label: 'Other', icon: 'dots' },
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

const BY_ID = Object.fromEntries(ALL_CATEGORIES.map((c) => [c.id, c]));

export function category(id) {
  return BY_ID[id] || { id, label: id, icon: 'dots' };
}

export function categoriesFor(type) {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/**
 * Currencies and formatting.
 *
 * You hold cash in yen but receive money from abroad, so an entry records both
 * what arrived and what it was worth in yen. Everything totals in yen, because
 * that is the currency you actually spend.
 */

export const CURRENCIES = {
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, label: 'Japanese yen' },
  USD: { code: 'USD', symbol: '$', decimals: 2, label: 'US dollar' },
  RUB: { code: 'RUB', symbol: '₽', decimals: 2, label: 'Russian ruble' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, label: 'Euro' },
};

export const DEFAULT_CURRENCIES = ['JPY', 'USD', 'RUB'];

/** Yen, always whole — nobody deals in fractions of a yen. */
export function yen(amount) {
  const n = Math.round(Number(amount) || 0);
  return `¥${n.toLocaleString('en-US')}`;
}

/** Yen without the symbol, for places that supply their own. */
export function yenPlain(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('en-US');
}

export function formatCurrency(amount, currency) {
  const meta = CURRENCIES[currency] || { symbol: '', decimals: 2 };
  return `${meta.symbol}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  })}`;
}

/**
 * Reads a typed amount, tolerating what people actually type on a phone:
 * commas, currency symbols, spaces, and full-width digits from a Japanese IME.
 */
export function parseAmount(value) {
  if (value === null || value === undefined) return 0;
  const normalised = String(value)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, '')
    .replace(/[,\s¥￥$₽€£]/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Today in the device's own timezone, not UTC. */
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function monthKey(date) {
  return String(date).slice(0, 7);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(key) {
  const [y, m] = String(key).split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** "Today", "Yesterday", then a plain date. */
export function friendlyDate(date) {
  const d = String(date);
  if (d === today()) return 'Today';
  const yesterday = new Date(Date.now() - 86_400_000);
  const y = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10);
  if (d === y) return 'Yesterday';
  const parsed = new Date(`${d}T00:00:00`);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Optional reference exchange rate, for when you want a rough yen figure and do
 * not already know what you got. Fails quietly offline — the app never depends
 * on the network.
 */
export async function fetchRate(currency) {
  if (currency === 'JPY') return 1;
  const endpoints = [
    `https://api.frankfurter.app/latest?from=${currency}&to=JPY`,
    `https://api.exchangerate.host/latest?base=${currency}&symbols=JPY`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const json = await res.json();
      const rate = json?.rates?.JPY;
      if (typeof rate === 'number' && rate > 0) return rate;
    } catch {
      // Offline, or the service is down. Try the next, then give up.
    }
  }
  return null;
}

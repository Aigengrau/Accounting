/**
 * Foreign-exchange conversion with a locked, auditable rate per transaction.
 *
 * Japanese tax law requires every foreign-currency transaction to be booked in
 * yen at the rate prevailing on the transaction date (所基通57の3-2). The
 * strict reading is: TTB for income, TTS for payments, TTM acceptable if applied
 * consistently all year. Your own bank's published rates are the intended
 * source, not a third-party API.
 *
 * The strongest evidence, though, is the amount of yen your bank actually
 * credited. When your bank converts incoming USD itself, the yen figure on the
 * statement *is* the correct booking amount and the implied rate is derived from
 * it — nothing to look up and nothing to argue about in an audit. So that is the
 * default path here, and everything else is a fallback.
 *
 * Once a rate is locked it becomes immutable. Later corrections are recorded as
 * amendments rather than overwriting history, which is what an auditor expects
 * to see.
 */

/** Rate sources, ordered by how well they stand up to scrutiny. */
export const RATE_SOURCE = {
  BANK_ACTUAL: 'bank_actual', // derived from yen actually credited — strongest
  BANK_TTB: 'bank_ttb',       // your bank's published TTB, the statutory default for income
  BANK_TTM: 'bank_ttm',       // midpoint, acceptable if used consistently
  BANK_TTS: 'bank_tts',       // selling rate, for payments you make
  MANUAL: 'manual',           // typed in, with a source note
  API: 'api',                 // fetched reference rate — not an official source
};

export const RATE_SOURCE_META = {
  [RATE_SOURCE.BANK_ACTUAL]: {
    label: 'Actual bank conversion',
    ja: '銀行実際レート',
    weight: 5,
    audit: 'strongest',
    hint: 'Enter the yen your bank actually credited. The rate is derived from it, so it matches your statement '
        + 'exactly and needs no external reference.',
    evidence: 'Bank statement or passbook line showing the yen credited.',
  },
  [RATE_SOURCE.BANK_TTB]: {
    label: 'Bank TTB (buying)',
    ja: '対顧客電信買相場',
    weight: 4,
    audit: 'strong',
    hint: 'The statutory default for converting income. Use your main bank’s published TTB for the date the '
        + 'money arrived.',
    evidence: 'Screenshot or PDF of the bank’s published rate table for that date.',
  },
  [RATE_SOURCE.BANK_TTM]: {
    label: 'Bank TTM (middle)',
    ja: '対顧客電信売買相場の仲値',
    weight: 3,
    audit: 'acceptable',
    hint: 'Accepted if you apply it consistently to every transaction for the whole year. Do not mix TTM and TTB '
        + 'across the year.',
    evidence: 'Bank’s published rate table for that date.',
  },
  [RATE_SOURCE.BANK_TTS]: {
    label: 'Bank TTS (selling)',
    ja: '対顧客電信売相場',
    weight: 4,
    audit: 'strong',
    hint: 'Use for money you pay out in foreign currency, such as foreign subscriptions or contractors.',
    evidence: 'Bank’s published rate table for that date.',
  },
  [RATE_SOURCE.MANUAL]: {
    label: 'Manual entry',
    ja: '手入力',
    weight: 2,
    audit: 'needs note',
    hint: 'Record where the rate came from. Without a source note this is the weakest position in an audit.',
    evidence: 'Whatever you cite in the source note. Attach it.',
  },
  [RATE_SOURCE.API]: {
    label: 'Fetched reference rate',
    ja: '参考レート',
    weight: 1,
    audit: 'reference only',
    hint: 'A mid-market reference, not an official rate. Fine for forecasting; replace it with a bank rate before '
        + 'you file.',
    evidence: 'None. Not acceptable on its own as filing support.',
  },
};

/** Currencies, with where to find each one's official Japanese rate. */
export const CURRENCIES = {
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, label: 'Japanese yen', isBase: true },
  USD: {
    code: 'USD', symbol: '$', decimals: 2, label: 'US dollar',
    officialSources: [
      { label: 'MUFG daily rates (三菱UFJ銀行 外国為替相場)', url: 'https://www.bk.mufg.jp/ippan/kinri/list_j/kinri/kawase.html' },
      { label: 'MUFG historical rates (past dates)', url: 'https://www.murc-kawasesouba.jp/fx/index.php' },
      { label: 'SMBC rates (三井住友銀行)', url: 'https://www.smbc.co.jp/market/' },
      { label: 'Mizuho rates (みずほ銀行)', url: 'https://www.mizuhobank.co.jp/market/quote.html' },
    ],
    plausibleBand: [80, 250], // yen per dollar; anything outside is almost certainly a typo
  },
  RUB: {
    code: 'RUB', symbol: '₽', decimals: 2, label: 'Russian ruble',
    officialSources: [
      { label: 'Central Bank of Russia official rate (RUB/USD)', url: 'https://www.cbr.ru/eng/currency_base/daily/' },
      { label: 'MUFG historical cross rates', url: 'https://www.murc-kawasesouba.jp/fx/index.php' },
    ],
    plausibleBand: [0.5, 5],
    warning: 'Japanese banks generally do not publish a TTB for the ruble. Derive a cross rate through USD '
           + '(RUB→USD from the Central Bank of Russia, then USD→JPY from your bank’s TTB for the same date) '
           + 'and record both legs in the source note. Where rubles land in a Japanese account after conversion, '
           + 'always prefer the actual credited yen instead.',
    requiresCrossRate: true,
  },
  EUR: {
    code: 'EUR', symbol: '€', decimals: 2, label: 'Euro',
    officialSources: [
      { label: 'MUFG daily rates', url: 'https://www.bk.mufg.jp/ippan/kinri/list_j/kinri/kawase.html' },
    ],
    plausibleBand: [90, 280],
  },
  GBP: {
    code: 'GBP', symbol: '£', decimals: 2, label: 'British pound',
    officialSources: [
      { label: 'MUFG daily rates', url: 'https://www.bk.mufg.jp/ippan/kinri/list_j/kinri/kawase.html' },
    ],
    plausibleBand: [110, 320],
  },
};

export const DEFAULT_CURRENCIES = ['JPY', 'USD', 'RUB'];

/**
 * Builds a locked conversion record.
 *
 * Two ways to call it:
 *   1. Pass `jpyCredited` — the rate is derived, source BANK_ACTUAL. Preferred.
 *   2. Pass `rate` with a `source` — the yen amount is computed.
 *
 * @returns {object} an immutable conversion record for storage on a transaction
 */
export function lockRate({
  amount,
  currency,
  date,
  jpyCredited = null,
  rate = null,
  source = null,
  sourceNote = '',
  bankName = '',
  fees = 0,
  crossRate = null,
}) {
  if (currency === 'JPY') {
    return Object.freeze({
      currency: 'JPY',
      amount,
      jpy: amount,
      rate: 1,
      source: RATE_SOURCE.BANK_ACTUAL,
      rateDate: date,
      sourceNote: 'Yen transaction, no conversion.',
      lockedAt: new Date().toISOString(),
      fees: 0,
      amendments: [],
    });
  }

  if (!amount || amount <= 0) throw new Error('Amount must be greater than zero.');

  let resolvedRate;
  let resolvedSource;
  let resolvedJpy;
  let grossJpy = null;

  if (jpyCredited !== null && jpyCredited !== undefined && jpyCredited !== '') {
    // The bank already did the conversion, so its number wins.
    resolvedJpy = Math.round(Number(jpyCredited));
    // Fees are added back to recover the gross rate the bank applied, so the
    // derived rate reflects the true exchange rate and the fee stays a
    // separately deductible expense rather than silently depressing the rate.
    grossJpy = resolvedJpy + Math.round(Number(fees) || 0);
    resolvedRate = grossJpy / amount;
    resolvedSource = RATE_SOURCE.BANK_ACTUAL;
  } else {
    if (!rate || Number(rate) <= 0) {
      throw new Error('Provide either the yen credited by your bank, or an explicit rate.');
    }
    resolvedRate = Number(rate);
    resolvedSource = source || RATE_SOURCE.MANUAL;
    resolvedJpy = Math.round(amount * resolvedRate);
  }

  return Object.freeze({
    currency,
    amount: Number(amount),
    jpy: resolvedJpy,
    grossJpy,
    rate: resolvedRate,
    source: resolvedSource,
    rateDate: date,
    sourceNote: sourceNote || RATE_SOURCE_META[resolvedSource]?.evidence || '',
    bankName,
    fees: Number(fees) || 0,
    crossRate,
    lockedAt: new Date().toISOString(),
    amendments: [],
  });
}

/**
 * Corrects a locked rate without destroying the original.
 * The prior values move into `amendments`, so the history stays reviewable.
 */
export function amendRate(locked, changes, reason) {
  if (!reason) throw new Error('An amendment needs a reason.');
  const amendment = {
    amendedAt: new Date().toISOString(),
    reason,
    previous: {
      rate: locked.rate, jpy: locked.jpy, source: locked.source,
      rateDate: locked.rateDate, sourceNote: locked.sourceNote,
    },
  };
  const next = lockRate({
    amount: changes.amount ?? locked.amount,
    currency: locked.currency,
    date: changes.date ?? locked.rateDate,
    jpyCredited: changes.jpyCredited ?? null,
    rate: changes.rate ?? (changes.jpyCredited ? null : locked.rate),
    source: changes.source ?? locked.source,
    sourceNote: changes.sourceNote ?? locked.sourceNote,
    bankName: changes.bankName ?? locked.bankName,
    fees: changes.fees ?? locked.fees,
    crossRate: changes.crossRate ?? locked.crossRate,
  });
  return Object.freeze({
    ...next,
    amendments: [...(locked.amendments || []), amendment],
    originalLockedAt: locked.originalLockedAt || locked.lockedAt,
  });
}

/**
 * Sanity-checks a rate before locking. Catches the decimal-place slips that are
 * easy to make on a phone keyboard and expensive to discover a year later.
 */
export function validateRate(currency, rate, date) {
  const issues = [];
  const meta = CURRENCIES[currency];
  if (!meta) {
    issues.push({ level: 'error', message: `Unknown currency ${currency}.` });
    return issues;
  }
  if (meta.plausibleBand) {
    const [lo, hi] = meta.plausibleBand;
    if (rate < lo || rate > hi) {
      issues.push({
        level: 'error',
        message: `${rate} yen per ${currency} sits outside the plausible range of ${lo}–${hi}. `
               + 'Check for a misplaced decimal point.',
      });
    }
  }
  if (date) {
    const d = new Date(date);
    const now = new Date();
    if (d > now) issues.push({ level: 'warning', message: 'The rate date is in the future.' });
    if (d.getUTCFullYear() < 2000) issues.push({ level: 'warning', message: 'The rate date looks wrong.' });
  }
  if (meta.requiresCrossRate) {
    issues.push({ level: 'info', message: meta.warning });
  }
  return issues;
}

/** Derives a JPY rate via USD, for currencies no Japanese bank quotes directly. */
export function deriveCrossRate({ foreignPerUsd, jpyPerUsd }) {
  if (!foreignPerUsd || !jpyPerUsd) throw new Error('Both legs of the cross rate are required.');
  const jpyPerForeign = jpyPerUsd / foreignPerUsd;
  return {
    rate: jpyPerForeign,
    legs: { foreignPerUsd, jpyPerUsd },
    note: `Cross rate: ${jpyPerUsd} JPY/USD ÷ ${foreignPerUsd} per USD = ${jpyPerForeign.toFixed(4)} JPY.`,
  };
}

/**
 * Fetches a reference rate. Explicitly marked unofficial — useful for
 * forecasting a tax bill mid-year, never as filing support.
 *
 * Fails soft: the app must stay fully usable offline.
 */
export async function fetchReferenceRate(currency, date) {
  if (currency === 'JPY') return { rate: 1, source: RATE_SOURCE.API, official: false };
  const day = date || new Date().toISOString().slice(0, 10);
  const endpoints = [
    `https://api.frankfurter.app/${day}?from=${currency}&to=JPY`,
    `https://api.exchangerate.host/${day}?base=${currency}&symbols=JPY`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      const rate = json?.rates?.JPY;
      if (typeof rate === 'number' && rate > 0) {
        return {
          rate,
          source: RATE_SOURCE.API,
          official: false,
          fetchedFrom: new URL(url).host,
          rateDate: json.date || day,
          warning: 'Reference rate only. Replace it with your bank’s rate before filing.',
        };
      }
    } catch {
      // Offline or blocked. Try the next endpoint, then give up quietly.
    }
  }
  return null;
}

/** Formats an amount in its own currency. */
export function formatCurrency(amount, currency) {
  const meta = CURRENCIES[currency] || { symbol: '', decimals: 2 };
  const n = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return `${meta.symbol}${n}`;
}

/** Formats yen — always whole, since tax figures are rounded to the yen. */
export function formatJpy(amount) {
  return `¥${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}

/**
 * Year-level review of FX record quality, so weak entries surface while there is
 * still time to fix them rather than during an audit.
 */
export function auditFxQuality(transactions, taxYear) {
  const foreign = transactions.filter(
    (t) => t.fx && t.fx.currency !== 'JPY' && String(t.date).startsWith(String(taxYear)),
  );
  if (foreign.length === 0) return { total: 0, issues: [], score: 100 };

  const issues = [];
  const bySource = {};
  for (const t of foreign) {
    bySource[t.fx.source] = (bySource[t.fx.source] || 0) + 1;
  }

  const apiCount = bySource[RATE_SOURCE.API] || 0;
  if (apiCount > 0) {
    issues.push({
      severity: 'high',
      title: `${apiCount} transaction(s) still on a fetched reference rate`,
      detail: 'Fetched rates are not an official source. Replace them with your bank’s actual or published '
            + 'rate before filing.',
    });
  }

  const unnotedManual = foreign.filter(
    (t) => t.fx.source === RATE_SOURCE.MANUAL && !t.fx.sourceNote?.trim(),
  );
  if (unnotedManual.length > 0) {
    issues.push({
      severity: 'medium',
      title: `${unnotedManual.length} manual rate(s) with no source note`,
      detail: 'Record where each rate came from. An unexplained rate is the weakest possible audit position.',
    });
  }

  // Mixing TTM with TTB across a year breaks the consistency condition that
  // makes TTM acceptable in the first place.
  const ttm = bySource[RATE_SOURCE.BANK_TTM] || 0;
  const ttb = bySource[RATE_SOURCE.BANK_TTB] || 0;
  if (ttm > 0 && ttb > 0) {
    issues.push({
      severity: 'medium',
      title: 'TTM and TTB mixed within one year',
      detail: 'TTM is only acceptable when applied consistently. Pick one convention for the whole year — TTB is '
            + 'the statutory default for income.',
    });
  }

  const noEvidence = foreign.filter((t) => !t.fx.bankName && t.fx.source !== RATE_SOURCE.BANK_ACTUAL);
  if (noEvidence.length > 0) {
    issues.push({
      severity: 'low',
      title: `${noEvidence.length} transaction(s) with no bank named`,
      detail: 'Naming the bank whose rate you used makes the figure verifiable.',
    });
  }

  const strong = foreign.filter(
    (t) => (RATE_SOURCE_META[t.fx.source]?.weight || 0) >= 4,
  ).length;
  const score = Math.round((strong / foreign.length) * 100);

  return { total: foreign.length, strong, bySource, issues, score };
}

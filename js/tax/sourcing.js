/**
 * Income sourcing and the 非永住者 remittance rules.
 *
 * This is the part foreigners most often get wrong, so the module is written to
 * explain itself: every determination returns the reasoning and the statute
 * behind it, not just a boolean.
 *
 * The single most common mistake: assuming that a foreign client, a foreign
 * currency, or a foreign bank account makes income "foreign-source". For a
 * self-employed person it does not. Business income is sourced where the
 * business is carried on. If you sit in Japan doing the work, you have a
 * permanent establishment in Japan, and the income is attributable to it —
 * which makes it Japan-source and fully taxable from day one.
 *
 * References
 *   所得税法 7条1項2号   — scope of taxation for a 非永住者
 *   所得税法 161条       — what counts as 国内源泉所得
 *   所得税法 95条4項     — what counts as 国外源泉所得
 *   所得税法施行令 17条  — the remittance ordering rules
 */

/** Tax residency status. Distinct from immigration status — a spouse visa is irrelevant here. */
export const RESIDENCY = {
  NON_RESIDENT: 'non_resident',
  NON_PERMANENT: 'non_permanent',   // 非永住者
  PERMANENT: 'permanent',           // 永住者 (for tax; nothing to do with PR immigration status)
};

export const RESIDENCY_LABELS = {
  [RESIDENCY.NON_RESIDENT]: { en: 'Non-resident', ja: '非居住者' },
  [RESIDENCY.NON_PERMANENT]: { en: 'Non-permanent resident', ja: '非永住者' },
  [RESIDENCY.PERMANENT]: { en: 'Permanent resident (tax)', ja: '永住者' },
};

/** Where income is sourced. */
export const SOURCE = { JAPAN: 'japan', FOREIGN: 'foreign' };

/** Where the money was actually paid. Decisive for a 非永住者. */
export const PAID_IN = { JAPAN: 'japan', ABROAD: 'abroad' };

/**
 * Determines tax residency.
 *
 * `yearsInJapan` is cumulative time with a 住所 or 居所 in Japan within the last
 * ten years. It is counted in actual elapsed periods, not calendar years, so
 * store it as a fractional number of years.
 */
export function determineResidency({ isJapaneseNational = false, hasJapanAddress = true, yearsInJapan = 0 }, rates) {
  if (!hasJapanAddress) {
    return {
      status: RESIDENCY.NON_RESIDENT,
      reason: 'No 住所 or 居所 in Japan, so only Japan-source income is taxable, generally by withholding.',
      statute: '所得税法 2条1項5号',
    };
  }
  if (isJapaneseNational) {
    return {
      status: RESIDENCY.PERMANENT,
      reason: 'Japanese nationals resident in Japan are always taxed on worldwide income.',
      statute: '所得税法 7条1項1号',
    };
  }
  const { yearsThreshold, lookbackYears } = rates.nonPermanentResident;
  if (yearsInJapan <= yearsThreshold) {
    const remaining = yearsThreshold - yearsInJapan;
    return {
      status: RESIDENCY.NON_PERMANENT,
      reason: `Non-Japanese national with ${yearsInJapan.toFixed(1)} of the last ${lookbackYears} years in Japan, `
            + `at or under the ${yearsThreshold}-year threshold. Foreign-source income is taxable only where it is `
            + 'paid in Japan or remitted to Japan.',
      statute: '所得税法 2条1項4号, 7条1項2号',
      yearsRemaining: remaining,
      crossoverWarning: remaining <= 1
        ? `You cross into worldwide taxation in about ${(remaining * 12).toFixed(0)} months. Plan any foreign-asset `
          + 'disposals before then, because after the crossover the gains become taxable in Japan.'
        : null,
    };
  }
  return {
    status: RESIDENCY.PERMANENT,
    reason: `Over ${yearsThreshold} years of residence within the last ${lookbackYears}, so worldwide income is `
          + 'taxable. Foreign taxes paid may be creditable under 外国税額控除.',
    statute: '所得税法 7条1項1号',
  };
}

/**
 * Classifies one income stream as Japan- or foreign-source.
 *
 * `workPerformedIn` is the decisive input for services and business income.
 * Everything else — client location, currency, which bank was paid — affects
 * paperwork, not sourcing.
 */
export function classifySource(stream) {
  const {
    kind = 'business',
    workPerformedIn = 'japan',
    clientLocation = 'abroad',
    assetLocation = 'abroad',
    employerLocation = 'abroad',
  } = stream;

  switch (kind) {
    case 'business':
    case 'freelance':
    case 'services': {
      if (workPerformedIn === 'japan') {
        return {
          source: SOURCE.JAPAN,
          confidence: 'high',
          reason: 'You performed the work while physically in Japan, which gives you a permanent establishment '
                + 'here. Business income attributable to a Japanese PE is Japan-source regardless of where the '
                + 'client sits, what currency you invoiced in, or which bank was paid.',
          statute: '所得税法 161条1項1号',
          warning: clientLocation === 'abroad'
            ? 'A foreign client does not make this foreign-source income. This is the most common and most '
              + 'expensive misunderstanding among foreign freelancers in Japan.'
            : null,
        };
      }
      if (workPerformedIn === 'abroad') {
        return {
          source: SOURCE.FOREIGN,
          confidence: 'medium',
          reason: 'Work performed entirely outside Japan, through a business carried on outside Japan, is '
                + 'foreign-source. Keep travel records proving where you were on the working days.',
          statute: '所得税法 95条4項1号',
          warning: 'If any part of the engagement was done from Japan, that portion is Japan-source and the '
                 + 'income must be apportioned. Partial performance in Japan is the usual audit trigger.',
        };
      }
      return {
        source: SOURCE.JAPAN,
        confidence: 'low',
        reason: 'Work was split between Japan and abroad. The Japan portion is Japan-source and must be '
              + 'apportioned on a reasonable basis, usually working days or hours.',
        statute: '所得税法 161条1項1号',
        warning: 'Record the day-by-day split now. Reconstructing it years later during an audit is very hard.',
        requiresApportionment: true,
      };
    }

    case 'employment':
      return workPerformedIn === 'japan'
        ? {
            source: SOURCE.JAPAN,
            confidence: 'high',
            reason: 'Employment income is sourced where the work is performed, not where the employer is.',
            statute: '所得税法 161条1項12号イ',
            warning: employerLocation === 'abroad'
              ? 'A foreign employer paying into a foreign account does not change this. You likely have no '
                + 'Japanese withholding agent, so you must declare it yourself.'
              : null,
          }
        : {
            source: SOURCE.FOREIGN,
            confidence: 'high',
            reason: 'Employment income for work performed outside Japan is foreign-source.',
            statute: '所得税法 95条4項10号',
          };

    case 'rental':
      return assetLocation === 'japan'
        ? {
            source: SOURCE.JAPAN, confidence: 'high',
            reason: 'Rental income is sourced where the property sits.',
            statute: '所得税法 161条1項7号',
          }
        : {
            source: SOURCE.FOREIGN, confidence: 'high',
            reason: 'Rent from property outside Japan is foreign-source. For a 非永住者 this is genuinely '
                  + 'shelterable, unlike your freelance income.',
            statute: '所得税法 95条4項',
          };

    case 'dividends':
    case 'interest':
      return assetLocation === 'japan'
        ? {
            source: SOURCE.JAPAN, confidence: 'high',
            reason: 'Paid by a Japanese issuer or a Japanese branch, so Japan-source.',
            statute: '所得税法 161条1項8号, 9号',
          }
        : {
            source: SOURCE.FOREIGN, confidence: 'high',
            reason: 'Paid by a foreign issuer, so foreign-source. Genuinely shelterable for a 非永住者 while '
                  + 'it stays outside Japan.',
            statute: '所得税法 95条4項',
          };

    case 'capital_gains':
      return assetLocation === 'japan'
        ? {
            source: SOURCE.JAPAN, confidence: 'high',
            reason: 'Gains on Japanese real estate or certain Japanese shares are Japan-source.',
            statute: '所得税法 161条1項5号',
          }
        : {
            source: SOURCE.FOREIGN, confidence: 'high',
            reason: 'Gains on foreign securities are foreign-source. The most valuable 非永住者 shelter there '
                  + 'is: realise foreign gains before you cross the five-year line and keep the proceeds abroad.',
            statute: '所得税法 95条4項',
          };

    case 'crypto':
      return {
        source: SOURCE.JAPAN,
        confidence: 'medium',
        reason: 'The NTA treats crypto gains as 雑所得 sourced at the holder’s residence, so being resident '
              + 'in Japan makes them Japan-source even on a foreign exchange.',
        statute: '所得税法 161条, NTA 仮想通貨FAQ',
        warning: 'Crypto is taxed as miscellaneous income at your full marginal rate, with no 20% separate '
               + 'rate and no loss carry-forward. Offshore exchanges do not help a Japanese tax resident.',
      };

    case 'pension':
      return employerLocation === 'japan'
        ? { source: SOURCE.JAPAN, confidence: 'high', reason: 'Japanese pension, so Japan-source.', statute: '所得税法 161条1項12号ロ' }
        : { source: SOURCE.FOREIGN, confidence: 'high', reason: 'Foreign pension, so foreign-source.', statute: '所得税法 95条4項' };

    default:
      return {
        source: SOURCE.JAPAN,
        confidence: 'low',
        reason: 'Unclassified income defaults to Japan-source, which is the conservative assumption.',
        statute: '所得税法 161条',
        warning: 'Confirm the correct classification with a 税理士 before filing.',
      };
  }
}

/**
 * Applies the 非永住者 remittance rules to a year's income streams.
 *
 * The ordering rule matters and is counter-intuitive: remittances are deemed to
 * consist *first* of Japan-source income that was paid outside Japan, and only
 * the remainder is treated as carrying in foreign-source income. Since
 * Japan-source income is already fully taxable, the practical effect is that
 * remitting money whose origin is Japan-source "uses up" the remittance without
 * adding new tax.
 *
 * @param {Array}  streams     Income streams, each already carrying a `source`.
 * @param {number} remittances Total brought into Japan during the year.
 */
export function applyRemittanceRules(streams, remittances, residencyStatus) {
  const bucket = (source, paidIn) => streams
    .filter((s) => s.source === source && s.paidIn === paidIn)
    .reduce((sum, s) => sum + (s.amountJpy || 0), 0);

  const japanPaidInJapan = bucket(SOURCE.JAPAN, PAID_IN.JAPAN);
  const japanPaidAbroad = bucket(SOURCE.JAPAN, PAID_IN.ABROAD);
  const foreignPaidInJapan = bucket(SOURCE.FOREIGN, PAID_IN.JAPAN);
  const foreignPaidAbroad = bucket(SOURCE.FOREIGN, PAID_IN.ABROAD);

  const japanSourceTotal = japanPaidInJapan + japanPaidAbroad;

  // Worldwide taxation: sourcing and payment location stop mattering.
  if (residencyStatus === RESIDENCY.PERMANENT) {
    const total = japanSourceTotal + foreignPaidInJapan + foreignPaidAbroad;
    return {
      taxableTotal: total,
      japanSourceTaxable: japanSourceTotal,
      foreignSourceTaxable: foreignPaidInJapan + foreignPaidAbroad,
      shelteredAmount: 0,
      remittanceDeemedTaxable: 0,
      explanation: ['As a permanent resident for tax purposes, your worldwide income is taxable. '
                  + 'Remittances are irrelevant. Foreign tax paid may be creditable under 外国税額控除.'],
      statute: '所得税法 7条1項1号',
    };
  }

  if (residencyStatus === RESIDENCY.NON_RESIDENT) {
    return {
      taxableTotal: japanSourceTotal,
      japanSourceTaxable: japanSourceTotal,
      foreignSourceTaxable: 0,
      shelteredAmount: foreignPaidInJapan + foreignPaidAbroad,
      remittanceDeemedTaxable: 0,
      explanation: ['As a non-resident, only Japan-source income is taxable.'],
      statute: '所得税法 7条1項3号',
    };
  }

  // 非永住者. Foreign-source income paid in Japan is taxable in full; foreign-source
  // income paid abroad is taxable only up to what the remittance is deemed to carry in.
  const explanation = [];

  explanation.push(
    `Japan-source income of ${fmt(japanSourceTotal)} is taxable in full, wherever it was paid. `
    + 'For a freelancer working from Japan this is normally the whole business income.',
  );

  if (foreignPaidInJapan > 0) {
    explanation.push(
      `Foreign-source income of ${fmt(foreignPaidInJapan)} was paid in Japan, which makes it taxable in full `
      + 'immediately — no remittance analysis applies. Money landing in a Japanese bank account counts as paid '
      + 'in Japan.',
    );
  }

  // 所得税法施行令 17条4項: the remittance absorbs Japan-source-paid-abroad first.
  const absorbedByJapanSource = Math.min(remittances, japanPaidAbroad);
  const remainingRemittance = Math.max(0, remittances - japanPaidAbroad);
  const remittanceDeemedTaxable = Math.min(remainingRemittance, foreignPaidAbroad);
  const sheltered = Math.max(0, foreignPaidAbroad - remittanceDeemedTaxable);

  if (remittances > 0) {
    if (absorbedByJapanSource > 0) {
      explanation.push(
        `Of ${fmt(remittances)} remitted, ${fmt(absorbedByJapanSource)} is deemed to come first from Japan-source `
        + 'income that was paid abroad. That income is already taxable, so this part of the remittance adds no '
        + 'new tax (所令17条4項).',
      );
    }
    if (remittanceDeemedTaxable > 0) {
      explanation.push(
        `The remaining ${fmt(remainingRemittance)} of remittance brings ${fmt(remittanceDeemedTaxable)} of `
        + 'foreign-source income into the Japanese tax net.',
      );
    }
  }

  if (sheltered > 0) {
    explanation.push(
      `${fmt(sheltered)} of foreign-source income stays outside the Japanese tax net this year because it was `
      + 'paid abroad and not remitted. Keep it out of Japan and keep the records — this shelter ends the moment '
      + 'you pass five years of residence.',
    );
  }

  const foreignSourceTaxable = foreignPaidInJapan + remittanceDeemedTaxable;

  return {
    taxableTotal: japanSourceTotal + foreignSourceTaxable,
    japanSourceTaxable: japanSourceTotal,
    foreignSourceTaxable,
    shelteredAmount: sheltered,
    remittanceDeemedTaxable,
    absorbedByJapanSource,
    buckets: { japanPaidInJapan, japanPaidAbroad, foreignPaidInJapan, foreignPaidAbroad },
    explanation,
    statute: '所得税法 7条1項2号, 所得税法施行令 17条',
  };
}

/**
 * Things that count as a remittance but that people routinely forget.
 * Listed so the UI can warn before the user under-reports.
 */
export const REMITTANCE_TRAPS = [
  {
    title: 'Foreign credit card used in Japan',
    detail: 'Spending in Japan on a card settled from a foreign account is a remittance. Paying the bill from '
          + 'abroad does not avoid it — the economic benefit arrived in Japan.',
  },
  {
    title: 'Cash carried in',
    detail: 'Physically bringing cash or traveller’s cheques into Japan is a remittance, declared at customs '
          + 'above one million yen or equivalent.',
  },
  {
    title: 'Foreign ATM withdrawal inside Japan',
    detail: 'Withdrawing yen in Japan from a foreign account is a remittance for the amount withdrawn.',
  },
  {
    title: 'Payment made on your behalf',
    detail: 'A foreign party settling a Japanese bill for you — rent, tuition, medical — is treated as a '
          + 'remittance to you.',
  },
  {
    title: 'Transfer between your own accounts',
    detail: 'Moving your own money from your foreign account to your Japanese account is still a remittance. '
          + 'Ownership is irrelevant; crossing the border is what counts.',
  },
  {
    title: 'Crypto moved to a Japanese exchange',
    detail: 'Transferring crypto to a Japanese exchange and selling it there is treated as bringing value into '
          + 'Japan.',
  },
];

/**
 * Flags structural problems with how income is being received, ahead of filing.
 * Ordered most severe first.
 */
export function auditIncomeSetup(streams, residency) {
  const flags = [];

  const foreignSourceIntoJapan = streams.filter(
    (s) => s.source === SOURCE.FOREIGN && s.paidIn === PAID_IN.JAPAN,
  );
  if (foreignSourceIntoJapan.length > 0 && residency.status === RESIDENCY.NON_PERMANENT) {
    flags.push({
      severity: 'high',
      title: 'Foreign-source income paid straight into a Japanese account',
      detail: 'Because it is paid in Japan, this income is taxable in full right away and your non-permanent '
            + 'resident status shelters none of it. Had the same income been paid to a foreign account and left '
            + 'there, it would not have been taxable this year.',
      action: 'If the income is genuinely foreign-source, have the client pay a foreign account instead and '
            + 'remit only what you need to live on. If it is Japan-source — which freelance work done from '
            + 'Japan normally is — this makes no difference and you can ignore it.',
      statute: '所得税法 7条1項2号',
    });
  }

  const claimedForeignButWorkedInJapan = streams.filter(
    (s) => s.source === SOURCE.FOREIGN && s.workPerformedIn === 'japan',
  );
  if (claimedForeignButWorkedInJapan.length > 0) {
    flags.push({
      severity: 'high',
      title: 'Income marked foreign-source but performed in Japan',
      detail: 'Work done while physically in Japan is Japan-source, whatever the client’s location. This '
            + 'classification would very likely fail an audit, with penalty tax and interest on top.',
      action: 'Reclassify as Japan-source, or document specifically why 所得税法 161条 does not apply.',
      statute: '所得税法 161条1項1号',
    });
  }

  const needApportionment = streams.filter((s) => s.workPerformedIn === 'mixed');
  if (needApportionment.length > 0) {
    flags.push({
      severity: 'medium',
      title: 'Income needing a Japan/abroad split',
      detail: `${needApportionment.length} stream(s) involve work in both places and must be apportioned.`,
      action: 'Record working days in each country and apportion on that basis. Keep boarding passes and '
            + 'immigration stamps.',
      statute: '所得税法 161条1項1号',
    });
  }

  if (residency.crossoverWarning) {
    flags.push({
      severity: 'medium',
      title: 'Five-year crossover approaching',
      detail: residency.crossoverWarning,
      action: 'Consider realising foreign capital gains and restructuring foreign holdings before the crossover.',
      statute: '所得税法 2条1項4号',
    });
  }

  return flags;
}

function fmt(n) {
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}

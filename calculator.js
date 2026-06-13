// @ts-check
/*
 * Pure simulation math for the retirement calculator.
 * No DOM access — loaded via <script> in the browser and require()'d by test.js.
 *
 * All rate parameters are human-readable percentages (27.5 means 27.5 %).
 * Money values are EUR. The simulation runs in nominal terms; conversion to
 * real (today's purchasing power) values is presentation-only and happens in app.js.
 *
 * Type-checked with `tsc --checkJs` (see tsconfig.json / `npm run typecheck`);
 * the JSDoc typedefs below are the authoritative shapes for params and results.
 */

/**
 * @typedef {{ value: number, unit: 'percent' | 'amount' }} ContributionIncrease
 * @typedef {{ enabled: boolean, year: number }} AllocationSwitch
 *
 * @typedef {Object} Asset
 * @property {string} id
 * @property {number} [allocationStart] split of the starting amount (defaults to `allocation`)
 * @property {number} allocation        split of the monthly contributions
 * @property {number} [allocationLate]  split after the switch year
 * @property {number} [withdrawalShare] share sold to fund the withdrawal (defaults to 0)
 * @property {number} annualReturn      price appreciation, % p.a.
 * @property {number} dividendYield     distributions, % p.a.
 * @property {number} ter               fund costs, % p.a.
 *
 * @typedef {Object} Params
 * @property {number} startingAmount
 * @property {number} startingCostBasis
 * @property {number} monthlyContribution
 * @property {ContributionIncrease} contributionIncrease
 * @property {number} yearsToRetirement
 * @property {Asset[]} assets
 * @property {AllocationSwitch} allocationSwitch
 * @property {boolean} reinvestDividends
 * @property {number} scenarioSpread
 * @property {number} monthlyWithdrawal
 * @property {boolean} withdrawalInflationAdjusted
 * @property {number} kest
 * @property {number} inflation
 * @property {number} maxRetirementYears
 * @property {'amount' | 'stableValue'} goalType
 * @property {number} targetAmount
 *
 * The shape after withDefaults(): the optional allocation/withdrawal fields are
 * resolved to numbers, so the simulation never has to re-handle missing values.
 * @typedef {Asset & { allocationStart: number, allocationLate: number, withdrawalShare: number }} ResolvedAsset
 * @typedef {Omit<Params, 'assets'> & { assets: ResolvedAsset[] }} ResolvedParams
 *
 * @typedef {{ id: string, value: number, basis: number, growthRate: number, dividendRate: number, withdrawalShare: number }} Bucket
 *
 * @typedef {Object} MonthRecord
 * @property {number} month
 * @property {number} value
 * @property {number} basis
 * @property {number} contributions
 * @property {number} dividends net dividends received this month
 * @property {number[]} perAsset bucket values, same order as params.assets
 * @property {'accumulation' | 'drawdown'} phase
 *
 * @typedef {Object} AssetResult
 * @property {string} id
 * @property {number} value
 * @property {number} basis
 * @property {number} netIfSold
 *
 * @typedef {Object} SaleRecord
 * @property {string} id
 * @property {number} gross
 * @property {number} net
 * @property {number} kest
 *
 * @typedef {Object} FirstRetirementYear
 * @property {number} withdrawalsNet
 * @property {{ gross: number, net: number, kest: number }} dividends
 * @property {SaleRecord[]} sales
 *
 * @typedef {Object} Summary
 * @property {number} accumulationMonths
 * @property {{ value: number, basis: number, netIfSold: number, perAsset: AssetResult[] }} atRetirement
 * @property {number} totalContributions
 * @property {number} totalGrowth
 * @property {{ gross: number, net: number, paidOut: number }} dividends
 * @property {number} dividendsPerYearAtRetirement
 * @property {number} kestOnDividends
 * @property {number} kestOnSales
 * @property {number | null} runOutMonth
 * @property {number | null} lastsYears
 * @property {number} finalValue
 * @property {boolean} keepsGrowing
 * @property {FirstRetirementYear} firstRetirementYear
 *
 * @typedef {{ months: MonthRecord[], summary: Summary }} SimulationResult
 */

/** @type {Params} */
const DEFAULT_PARAMS = {
  startingAmount: 10000,
  // Cost basis of the starting amount (the part that is already-taxed invested capital).
  startingCostBasis: 10000,
  monthlyContribution: 500,
  // Applied at every year boundary during accumulation. unit: 'percent' | 'amount'
  contributionIncrease: { value: 0, unit: 'percent' },
  yearsToRetirement: 30,

  // allocationStart splits the starting amount, allocation the monthly contributions,
  // allocationLate the contributions after the switch year. Each in %, should sum to
  // 100 across assets (UI warns; math normalizes).
  // annualReturn = price appreciation, dividendYield = distributions, ter = fund costs; all % p.a.
  // withdrawalShare: which assets are sold to fund the retirement withdrawal (in %,
  // should sum to 100). Once those run dry, selling falls back to the remaining
  // assets proportionally by value.
  assets: [
    { id: 'etf', allocationStart: 70, allocation: 70, allocationLate: 50, withdrawalShare: 90, annualReturn: 6.5, dividendYield: 0, ter: 0.2 },
    { id: 'bonds', allocationStart: 10, allocation: 10, allocationLate: 10, withdrawalShare: 0, annualReturn: 2.5, dividendYield: 0, ter: 0.1 },
    { id: 'stocks', allocationStart: 10, allocation: 10, allocationLate: 10, withdrawalShare: 10, annualReturn: 7, dividendYield: 0, ter: 0 },
    { id: 'dividendStocks', allocationStart: 10, allocation: 10, allocationLate: 30, withdrawalShare: 0, annualReturn: 4, dividendYield: 3, ter: 0 },
  ],
  // From year `year` on, contributions are split by allocationLate instead of allocation.
  // Existing holdings are never sold/rebalanced (no tax event).
  allocationSwitch: { enabled: false, year: 20 },

  reinvestDividends: true,
  // min/max scenarios shift every asset's annualReturn by -/+ this many percentage points.
  scenarioSpread: 3,

  // Desired net (after KESt) monthly withdrawal in retirement.
  monthlyWithdrawal: 2000,
  // If true the withdrawal keeps today's purchasing power (indexed with inflation from t=0).
  withdrawalInflationAdjusted: true,

  kest: 27.5,
  inflation: 2,

  // Drawdown simulation cap.
  maxRetirementYears: 60,

  // Goal mode for the goal-seek block:
  //   'amount'      – reach a fixed targetAmount at retirement (real terms).
  //   'stableValue' – the portfolio's real value must not decrease over the
  //                   drawdown phase, i.e. it funds the withdrawals indefinitely
  //                   while keeping today's purchasing power intact.
  goalType: 'amount',
  // Goal (amount mode): desired value at retirement, expressed in today's
  // purchasing power. The target block solves how each lever would reach it.
  targetAmount: 1000000,
};

/**
 * Fill missing/legacy fields with defaults. Accepts a partial (e.g. an older
 * saved/exported file) and returns a complete, simulate-ready params object
 * whose assets have every optional allocation/withdrawal field resolved.
 * @param {Partial<Params>} [partial]
 * @returns {ResolvedParams}
 */
function withDefaults(partial) {
  const p = Object.assign({}, DEFAULT_PARAMS, partial);
  p.contributionIncrease = Object.assign({}, DEFAULT_PARAMS.contributionIncrease, partial && partial.contributionIncrease);
  p.allocationSwitch = Object.assign({}, DEFAULT_PARAMS.allocationSwitch, partial && partial.allocationSwitch);
  const assets = (p.assets || DEFAULT_PARAMS.assets).map((a) => {
    // Fields added after older files were saved fall back: the allocation
    // columns mirror the contribution split, withdrawalShare to 0 ("no
    // preference" => value-proportional selling).
    const allocation = a.allocation;
    return {
      ...a,
      allocationStart: a.allocationStart ?? allocation,
      allocationLate: a.allocationLate ?? allocation,
      withdrawalShare: a.withdrawalShare ?? 0,
    };
  });
  return { ...p, assets };
}

/** @param {number} annualPercent @returns {number} */
function monthlyRate(annualPercent) {
  // Clamp so a pathological input (< -100 % p.a.) cannot produce NaN.
  const annual = Math.max(annualPercent / 100, -0.99);
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/** @param {number[]} weights @returns {number[]} */
function normalizeWeights(weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / sum);
}

/** @param {ResolvedParams} params @param {number} year @returns {number[]} */
function activeAllocation(params, year) {
  const late = params.allocationSwitch.enabled && year >= params.allocationSwitch.year;
  return normalizeWeights(params.assets.map((a) => (late ? a.allocationLate : a.allocation)));
}

/**
 * Net proceeds if the whole portfolio were sold today (KESt on gains only).
 * @param {Bucket[]} buckets @param {number} kest @returns {number}
 */
function netLiquidationValue(buckets, kest) {
  return buckets.reduce((sum, b) => sum + b.value - Math.max(0, b.value - b.basis) * kest, 0);
}

/**
 * Run one simulation with a given scenario shift (percentage points added to
 * every asset's annual return). Returns { months, summary }.
 *
 * months: one entry per simulated month:
 *   { month, value, basis, contributions, phase: 'accumulation' | 'drawdown' }
 * @param {Partial<Params>} rawParams
 * @param {number} [scenarioShift]
 * @returns {SimulationResult}
 */
function simulate(rawParams, scenarioShift = 0) {
  const params = withDefaults(rawParams);
  const kest = params.kest / 100;

  const buckets = params.assets.map((a) => ({
    id: a.id,
    value: 0,
    basis: 0,
    growthRate: monthlyRate(a.annualReturn + scenarioShift - a.ter),
    dividendRate: a.dividendYield / 100 / 12,
    withdrawalShare: Math.max(0, a.withdrawalShare),
  }));

  // Starting amount has its own allocation (the current holdings); its cost basis
  // is distributed proportionally (capped at the starting amount).
  const startWeights = normalizeWeights(params.assets.map((a) => a.allocationStart));
  const startBasis = Math.min(Math.max(params.startingCostBasis, 0), params.startingAmount);
  buckets.forEach((b, i) => {
    b.value = params.startingAmount * startWeights[i];
    b.basis = startBasis * startWeights[i];
  });

  /** @type {MonthRecord[]} */
  const months = [];
  let totalContributions = params.startingAmount;
  let dividendsGross = 0;
  let dividendsNet = 0;
  let dividendsPaidOut = 0;
  let kestOnDividends = 0;
  let kestOnSales = 0;

  const totalValue = () => buckets.reduce((s, b) => s + b.value, 0);
  const totalBasis = () => buckets.reduce((s, b) => s + b.basis, 0);

  /** @param {number} month @param {'accumulation' | 'drawdown'} phase @param {number} [dividends] */
  const record = (month, phase, dividends = 0) => {
    months.push({
      month, value: totalValue(), basis: totalBasis(), contributions: totalContributions,
      dividends, // net dividends received in this month
      perAsset: buckets.map((b) => b.value), // same order as params.assets
      phase,
    });
  };

  // Pays this month's dividends on every bucket; KESt is withheld immediately.
  // Returns this month's { net, gross, tax } (net not yet reinvested).
  const payDividends = () => {
    let net = 0;
    let gross = 0;
    let tax = 0;
    for (const b of buckets) {
      const g = b.value * b.dividendRate;
      if (g <= 0) continue;
      gross += g;
      tax += g * kest;
      net += g - g * kest;
    }
    dividendsGross += gross;
    kestOnDividends += tax;
    dividendsNet += net;
    return { net, gross, tax };
  };

  const applyGrowth = () => {
    for (const b of buckets) b.value *= 1 + b.growthRate;
  };

  // Reinvest an amount proportionally to current bucket values (already-taxed money,
  // so it raises the cost basis too).
  /** @param {number} amount */
  const reinvest = (amount) => {
    const v = totalValue();
    if (v <= 0 || amount <= 0) return;
    for (const b of buckets) {
      const share = amount * (b.value / v);
      b.value += share;
      b.basis += share;
    }
  };

  // --- Accumulation phase ---------------------------------------------------
  const accumulationMonths = Math.round(params.yearsToRetirement * 12);
  let contribution = params.monthlyContribution;

  record(0, 'accumulation');
  for (let m = 0; m < accumulationMonths; m++) {
    const year = Math.floor(m / 12);
    if (m > 0 && m % 12 === 0) {
      const inc = params.contributionIncrease;
      contribution = inc.unit === 'percent' ? contribution * (1 + inc.value / 100) : contribution + inc.value;
    }

    const weights = activeAllocation(params, year);
    buckets.forEach((b, i) => {
      b.value += contribution * weights[i];
      b.basis += contribution * weights[i];
    });
    totalContributions += contribution;

    const { net } = payDividends();
    if (params.reinvestDividends) reinvest(net);
    else dividendsPaidOut += net;

    applyGrowth();
    record(m + 1, 'accumulation', net);
  }

  const valueAtRetirement = totalValue();
  const basisAtRetirement = totalBasis();
  // Net dividend income per year the portfolio yields at the moment of retirement.
  const dividendsPerYearAtRetirement = buckets.reduce(
    (s, b) => s + b.value * b.dividendRate * 12 * (1 - kest), 0,
  );
  const atRetirement = {
    value: valueAtRetirement,
    basis: basisAtRetirement,
    netIfSold: netLiquidationValue(buckets, kest),
    perAsset: buckets.map((b) => ({
      id: b.id,
      value: b.value,
      basis: b.basis,
      netIfSold: b.value - Math.max(0, b.value - b.basis) * kest,
    })),
  };

  // --- Drawdown phase ---------------------------------------------------------
  const drawdownMonths = Math.round(params.maxRetirementYears * 12);
  let runOutMonth = null; // absolute month index (from t=0) when the money is gone

  // Where the money comes from in the first year of retirement — makes the
  // withdrawal mechanics explicit (sales per asset, dividends, KESt).
  const firstRetirementYear = {
    withdrawalsNet: 0,
    dividends: { gross: 0, net: 0, kest: 0 },
    sales: buckets.map((b) => ({ id: b.id, gross: 0, net: 0, kest: 0 })),
  };

  for (let m = 0; m < drawdownMonths; m++) {
    const absMonth = accumulationMonths + m;
    const inFirstYear = m < 12;
    let target = params.monthlyWithdrawal;
    if (params.withdrawalInflationAdjusted) {
      target *= Math.pow(1 + params.inflation / 100, absMonth / 12);
    }

    // 1. Dividends keep being paid; they cover the withdrawal first.
    const div = payDividends();
    const netDividends = div.net;
    if (inFirstYear) {
      firstRetirementYear.dividends.gross += div.gross;
      firstRetirementYear.dividends.net += div.net;
      firstRetirementYear.dividends.kest += div.tax;
    }
    let needNet = target - netDividends;
    if (needNet < 0) {
      reinvest(-needNet); // surplus dividends flow back into the portfolio
      needNet = 0;
    }

    // 2. Cover the rest by selling. Sales are split by each asset's withdrawalShare;
    //    once the preferred assets are empty (or no shares are configured at all),
    //    selling falls back to the remaining buckets proportionally by value.
    //    An asset may not cover its share near depletion, so loop until the
    //    need is met or nothing is left.
    let guard = 0;
    while (needNet > 1e-9 && guard++ < buckets.length + 2) {
      const sellable = buckets.filter((b) => b.value > 1e-9);
      const v = sellable.reduce((s, b) => s + b.value, 0);
      if (v <= 1e-9) break;
      const shareSum = sellable.reduce((s, b) => s + b.withdrawalShare, 0);
      const weightOf = shareSum > 0
        ? (/** @type {Bucket} */ b) => b.withdrawalShare / shareSum
        : (/** @type {Bucket} */ b) => b.value / v;
      const needThisPass = needNet;
      for (const b of sellable) {
        const netWanted = needThisPass * weightOf(b);
        if (netWanted <= 0) continue;
        // `sellable` only holds buckets with value > 1e-9, so the zero guards on
        // the next line and at `b.value || 1` below can't actually fire — they
        // stay as defence in depth. c8-ignored so they don't dent branch coverage.
        /* c8 ignore next */
        const gainFrac = b.value > 0 ? Math.max(0, (b.value - b.basis) / b.value) : 0;
        let gross = netWanted / (1 - gainFrac * kest);
        let net;
        let tax;
        if (gross >= b.value) {
          // Sell the whole bucket.
          gross = b.value;
          tax = Math.max(0, b.value - b.basis) * kest;
          net = b.value - tax;
          b.value = 0;
          b.basis = 0;
        } else {
          tax = gross * gainFrac * kest;
          net = gross - tax;
          /* c8 ignore next */
          b.basis -= b.basis * (gross / (b.value || 1));
          b.value -= gross;
        }
        kestOnSales += tax;
        if (inFirstYear) {
          const fy = firstRetirementYear.sales[buckets.indexOf(b)];
          fy.gross += gross;
          fy.net += net;
          fy.kest += tax;
        }
        needNet -= net;
      }
    }

    if (inFirstYear) {
      firstRetirementYear.withdrawalsNet += target - Math.max(0, needNet);
    }

    if (needNet > 1e-6) {
      // Portfolio exhausted this month.
      buckets.forEach((b) => { b.value = 0; b.basis = 0; });
      runOutMonth = absMonth;
      record(absMonth + 1, 'drawdown', netDividends);
      break;
    }

    applyGrowth();
    record(absMonth + 1, 'drawdown', netDividends);
  }

  return {
    months,
    summary: {
      accumulationMonths,
      atRetirement,
      totalContributions,
      totalGrowth: valueAtRetirement - totalContributions,
      dividends: { gross: dividendsGross, net: dividendsNet, paidOut: dividendsPaidOut },
      dividendsPerYearAtRetirement,
      kestOnDividends,
      kestOnSales,
      runOutMonth,
      // Years the withdrawal lasted; null means it survived the whole simulated cap.
      lastsYears: runOutMonth === null ? null : (runOutMonth - accumulationMonths) / 12,
      finalValue: totalValue(),
      // The portfolio ends the simulation higher than it started retirement.
      keepsGrowing: runOutMonth === null && totalValue() > valueAtRetirement,
      firstRetirementYear,
    },
  };
}

/**
 * Run min / avg / max scenarios (returns shifted by -spread / 0 / +spread pp).
 * @param {Partial<Params>} rawParams
 * @returns {{ min: SimulationResult, avg: SimulationResult, max: SimulationResult }}
 */
function simulateScenarios(rawParams) {
  const params = withDefaults(rawParams);
  return {
    min: simulate(params, -params.scenarioSpread),
    avg: simulate(params, 0),
    max: simulate(params, params.scenarioSpread),
  };
}

// --- Target goal-seek --------------------------------------------------------

/**
 * Value at retirement (avg scenario) deflated to today's purchasing power.
 * `shift` is the return-rate lever: percentage points added to every asset.
 * The deflator uses p.yearsToRetirement, so it self-adjusts when the
 * years-to-retirement lever moves p.
 * @param {Params} p a fully-defaulted params object (callers pass withDefaults output)
 * @param {number} [shift]
 * @returns {number}
 */
function realValueAtRetirement(p, shift = 0) {
  const v = simulate(p, shift).summary.atRetirement.value;
  return v / Math.pow(1 + p.inflation / 100, p.yearsToRetirement);
}

/**
 * Portfolio value at the end of the drawdown horizon (avg scenario), deflated to
 * today's purchasing power. Used by the stable-value goal: the portfolio keeps
 * its real value through retirement iff this is >= realValueAtRetirement.
 * The final value is measured at yearsToRetirement + maxRetirementYears (or it is
 * zero, if the money ran out earlier — in which case the deflator is irrelevant).
 * @param {Params} p a fully-defaulted params object (callers pass withDefaults output)
 * @param {number} [shift]
 * @returns {number}
 */
function realFinalValue(p, shift = 0) {
  const v = simulate(p, shift).summary.finalValue;
  return v / Math.pow(1 + p.inflation / 100, p.yearsToRetirement + p.maxRetirementYears);
}

/**
 * Solve f(x) === 0 for a monotonically increasing f by bisection.
 * Returns { value } on success, or { status } when the target isn't bracketed
 * in the searchable range:
 *   'belowFloor'  – even the lowest x overshoots (would need to go lower than lo)
 *   'unreachable' – even the highest x falls short (target out of range)
 * `expandHi` (optional) doubles hi until f(hi) >= 0 or the cap is hit.
 * @param {(x: number) => number} f
 * @param {number} lo
 * @param {number} hi
 * @param {{ expandHi?: boolean, cap?: number, iterations?: number }} [opts]
 * @returns {{ value: number } | { status: 'belowFloor' | 'unreachable' }}
 */
function bisect(f, lo, hi, { expandHi = false, cap = 1e9, iterations = 100 } = {}) {
  if (f(lo) > 0) return { status: 'belowFloor' };
  if (expandHi) {
    while (f(hi) < 0 && hi < cap) hi *= 2;
  }
  if (f(hi) < 0) return { status: 'unreachable' };
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return { value: (lo + hi) / 2 };
}

/**
 * For each lever (held independently, all else fixed), find the value it would
 * need to reach the configured goal in the avg scenario. Each lever's
 * goal-distance is monotonically increasing in that lever, so bisection converges.
 *
 * Two goal modes (params.goalType):
 *   'amount'      – hit params.targetAmount (real, today's purchasing power) at
 *                   retirement. Objective: realValueAtRetirement − targetAmount.
 *   'stableValue' – the portfolio's real value must not shrink over the drawdown
 *                   phase. Objective: realFinalValue − realValueAtRetirement, i.e.
 *                   what's left at the end (real) minus what you started retirement
 *                   with (real). >= 0 means the withdrawals are funded indefinitely.
 *
 * Note: with a non-positive real return the years lever can be non-monotonic;
 * the belowFloor/unreachable statuses cover any non-bracketed case gracefully.
 * @param {Partial<Params>} rawParams
 */
function solveTargets(rawParams) {
  const params = withDefaults(rawParams);
  const stable = params.goalType === 'stableValue';
  const current = realValueAtRetirement(params);
  // Real value left at the end of the drawdown horizon — only meaningful for the
  // stable-value goal, where it is compared against `current`.
  const finalReal = realFinalValue(params);

  // f(p, shift) === 0 exactly when the lever configured by (p, shift) meets the
  // goal; positive when it overshoots. Monotonically increasing in every lever.
  const objective = stable
    ? (/** @type {Params} */ p, /** @type {number} */ shift) => realFinalValue(p, shift) - realValueAtRetirement(p, shift)
    : (/** @type {Params} */ p, /** @type {number} */ shift) => realValueAtRetirement(p, shift) - params.targetAmount;

  /** @typedef {{ current: number, lo: number, hi: number, expandHi?: boolean, apply: (x: number) => { p: Params, shift: number } }} LeverSpec */
  // Each lever: a search range and how it maps x -> a (params, scenario-shift) pair.
  /** @type {Record<string, LeverSpec>} */
  const specs = {
    monthlyContribution: {
      current: params.monthlyContribution, lo: 0, hi: 1e5, expandHi: true,
      apply: (x) => ({ p: { ...params, monthlyContribution: x }, shift: 0 }),
    },
    contributionIncrease: {
      current: params.contributionIncrease.value, lo: -50, hi: 100,
      apply: (x) => ({ p: { ...params, contributionIncrease: { value: x, unit: 'percent' } }, shift: 0 }),
    },
    yearsToRetirement: {
      current: params.yearsToRetirement, lo: 0, hi: 80,
      apply: (x) => ({ p: { ...params, yearsToRetirement: x }, shift: 0 }),
    },
    startingAmount: {
      current: params.startingAmount, lo: 0, hi: 1e6, expandHi: true,
      apply: (x) => ({ p: { ...params, startingAmount: x }, shift: 0 }),
    },
    returnShift: {
      current: 0, lo: -20, hi: 50,
      apply: (x) => ({ p: params, shift: x }),
    },
  };

  /** @type {Record<string, { current: number, needed: number | null, status: string }>} */
  const levers = {};
  for (const [key, spec] of Object.entries(specs)) {
    const f = (/** @type {number} */ x) => { const { p, shift } = spec.apply(x); return objective(p, shift); };
    const res = bisect(f, spec.lo, spec.hi, { expandHi: spec.expandHi });
    levers[key] = 'value' in res
      ? { current: spec.current, needed: res.value, status: 'ok' }
      : { current: spec.current, needed: null, status: res.status };
  }

  return {
    goalType: stable ? 'stableValue' : 'amount',
    // Amount goal: the fixed target. Stable-value goal: the value you start
    // retirement with — the bar the end-of-drawdown value must clear.
    target: stable ? current : params.targetAmount,
    current,
    finalReal,
    reached: stable ? finalReal >= current : current >= params.targetAmount,
    levers,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_PARAMS, withDefaults, simulate, simulateScenarios,
    realValueAtRetirement, realFinalValue, solveTargets,
  };
}

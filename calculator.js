/*
 * Pure simulation math for the retirement calculator.
 * No DOM access — loaded via <script> in the browser and require()'d by test.js.
 *
 * All rate parameters are human-readable percentages (27.5 means 27.5 %).
 * Money values are EUR. The simulation runs in nominal terms; conversion to
 * real (today's purchasing power) values is presentation-only and happens in app.js.
 */

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
  assets: [
    { id: 'etf', allocationStart: 70, allocation: 70, allocationLate: 50, annualReturn: 6.5, dividendYield: 0, ter: 0.2 },
    { id: 'bonds', allocationStart: 10, allocation: 10, allocationLate: 10, annualReturn: 2.5, dividendYield: 0, ter: 0.1 },
    { id: 'stocks', allocationStart: 10, allocation: 10, allocationLate: 10, annualReturn: 7, dividendYield: 0, ter: 0 },
    { id: 'dividendStocks', allocationStart: 10, allocation: 10, allocationLate: 30, annualReturn: 4, dividendYield: 3, ter: 0 },
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
};

function withDefaults(partial) {
  const p = Object.assign({}, DEFAULT_PARAMS, partial);
  p.contributionIncrease = Object.assign({}, DEFAULT_PARAMS.contributionIncrease, partial && partial.contributionIncrease);
  p.allocationSwitch = Object.assign({}, DEFAULT_PARAMS.allocationSwitch, partial && partial.allocationSwitch);
  p.assets = (p.assets || DEFAULT_PARAMS.assets).map((a) => {
    const asset = Object.assign({}, a);
    if (asset.allocationStart == null) asset.allocationStart = asset.allocation;
    return asset;
  });
  return p;
}

function monthlyRate(annualPercent) {
  // Clamp so a pathological input (< -100 % p.a.) cannot produce NaN.
  const annual = Math.max(annualPercent / 100, -0.99);
  return Math.pow(1 + annual, 1 / 12) - 1;
}

function normalizeWeights(weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / sum);
}

function activeAllocation(params, year) {
  const late = params.allocationSwitch.enabled && year >= params.allocationSwitch.year;
  return normalizeWeights(params.assets.map((a) => (late ? a.allocationLate : a.allocation)));
}

// Net proceeds if the whole portfolio were sold today (KESt on gains only).
function netLiquidationValue(buckets, kest) {
  return buckets.reduce((sum, b) => sum + b.value - Math.max(0, b.value - b.basis) * kest, 0);
}

/**
 * Run one simulation with a given scenario shift (percentage points added to
 * every asset's annual return). Returns { months, summary }.
 *
 * months: one entry per simulated month:
 *   { month, value, basis, contributions, phase: 'accumulation' | 'drawdown' }
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
  }));

  // Starting amount has its own allocation (the current holdings); its cost basis
  // is distributed proportionally (capped at the starting amount).
  const startWeights = normalizeWeights(params.assets.map((a) => a.allocationStart));
  const startBasis = Math.min(Math.max(params.startingCostBasis, 0), params.startingAmount);
  buckets.forEach((b, i) => {
    b.value = params.startingAmount * startWeights[i];
    b.basis = startBasis * startWeights[i];
  });

  const months = [];
  let totalContributions = params.startingAmount;
  let dividendsGross = 0;
  let dividendsNet = 0;
  let dividendsPaidOut = 0;
  let kestOnDividends = 0;
  let kestOnSales = 0;

  const totalValue = () => buckets.reduce((s, b) => s + b.value, 0);
  const totalBasis = () => buckets.reduce((s, b) => s + b.basis, 0);

  const record = (month, phase, dividends = 0) => {
    months.push({
      month, value: totalValue(), basis: totalBasis(), contributions: totalContributions,
      dividends, // net dividends received in this month
      perAsset: buckets.map((b) => b.value), // same order as params.assets
      phase,
    });
  };

  // Pays this month's dividends on every bucket; KESt is withheld immediately.
  // Returns total net dividends paid this month (not yet reinvested).
  const payDividends = () => {
    let net = 0;
    for (const b of buckets) {
      const gross = b.value * b.dividendRate;
      if (gross <= 0) continue;
      const tax = gross * kest;
      dividendsGross += gross;
      kestOnDividends += tax;
      net += gross - tax;
    }
    dividendsNet += net;
    return net;
  };

  const applyGrowth = () => {
    for (const b of buckets) b.value *= 1 + b.growthRate;
  };

  // Reinvest an amount proportionally to current bucket values (already-taxed money,
  // so it raises the cost basis too).
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

    const net = payDividends();
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

  for (let m = 0; m < drawdownMonths; m++) {
    const absMonth = accumulationMonths + m;
    let target = params.monthlyWithdrawal;
    if (params.withdrawalInflationAdjusted) {
      target *= Math.pow(1 + params.inflation / 100, absMonth / 12);
    }

    // 1. Dividends keep being paid; they cover the withdrawal first.
    const netDividends = payDividends();
    let needNet = target - netDividends;
    if (needNet < 0) {
      reinvest(-needNet); // surplus dividends flow back into the portfolio
      needNet = 0;
    }

    // 2. Cover the rest by selling, proportionally by value. An asset whose gains
    //    are above average may not cover its proportional share near depletion,
    //    so loop over the remaining buckets until the need is met or nothing is left.
    let guard = 0;
    while (needNet > 1e-9 && guard++ < buckets.length + 2) {
      const sellable = buckets.filter((b) => b.value > 1e-9);
      const v = sellable.reduce((s, b) => s + b.value, 0);
      if (v <= 1e-9) break;
      const needThisPass = needNet;
      for (const b of sellable) {
        const netWanted = needThisPass * (b.value / v);
        const gainFrac = b.value > 0 ? Math.max(0, (b.value - b.basis) / b.value) : 0;
        let gross = netWanted / (1 - gainFrac * kest);
        let net;
        if (gross >= b.value) {
          // Sell the whole bucket.
          const tax = Math.max(0, b.value - b.basis) * kest;
          net = b.value - tax;
          kestOnSales += tax;
          b.value = 0;
          b.basis = 0;
        } else {
          const tax = gross * gainFrac * kest;
          net = gross - tax;
          kestOnSales += tax;
          b.basis -= b.basis * (gross / (b.value || 1));
          b.value -= gross;
        }
        needNet -= net;
      }
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
    },
  };
}

/** Run min / avg / max scenarios (returns shifted by -spread / 0 / +spread pp). */
function simulateScenarios(rawParams) {
  const params = withDefaults(rawParams);
  return {
    min: simulate(params, -params.scenarioSpread),
    avg: simulate(params, 0),
    max: simulate(params, params.scenarioSpread),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_PARAMS, withDefaults, simulate, simulateScenarios };
}

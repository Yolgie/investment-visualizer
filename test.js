/* Unit tests for calculator.js — run with `node test.js`. */

const {
  DEFAULT_PARAMS, withDefaults, simulate, simulateScenarios, realValueAtRetirement, solveTargets,
} = require('./calculator.js');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}

function singleAsset(over = {}) {
  return [Object.assign({
    id: 'a', allocationStart: 100, allocation: 100, allocationLate: 100,
    annualReturn: 0, dividendYield: 0, ter: 0,
  }, over)];
}

const base = {
  startingAmount: 10000,
  startingCostBasis: 10000,
  monthlyContribution: 500,
  contributionIncrease: { value: 0, unit: 'percent' },
  yearsToRetirement: 30,
  assets: singleAsset(),
  allocationSwitch: { enabled: false, year: 20 },
  reinvestDividends: true,
  scenarioSpread: 3,
  monthlyWithdrawal: 2000,
  withdrawalInflationAdjusted: false,
  kest: 27.5,
  inflation: 2,
  maxRetirementYears: 5,
};

// 1. Zero return, no dividends: value at retirement equals everything paid in.
{
  const r = simulate(base);
  const expected = 10000 + 500 * 360;
  check('zero return: value = contributions', approx(r.summary.atRetirement.value, expected),
    `${r.summary.atRetirement.value} != ${expected}`);
  check('zero return: growth = 0', approx(r.summary.totalGrowth, 0, 1e-9));
}

// 2. KESt only on gains: with zero return there are no gains, so no tax on sales.
{
  const r = simulate(base);
  check('no gains: kestOnSales = 0', r.summary.kestOnSales === 0, r.summary.kestOnSales);
  check('no gains: netIfSold = value', approx(r.summary.atRetirement.netIfSold, r.summary.atRetirement.value));
}

// 3. Net withdrawal grossing-up: 50 % of the portfolio is unrealized gain.
{
  const p = Object.assign({}, base, {
    startingAmount: 100000, startingCostBasis: 50000,
    yearsToRetirement: 0, monthlyContribution: 0, monthlyWithdrawal: 2000,
  });
  const r = simulate(p);
  const gross = 2000 / (1 - 0.5 * 0.275);
  check('grossing-up: first month sale', approx(r.months[1].value, 100000 - gross),
    `${r.months[1].value} != ${100000 - gross}`);
}

// 4. Inflation indexing of the withdrawal.
{
  const p = Object.assign({}, base, {
    startingAmount: 1000000, startingCostBasis: 1000000,
    yearsToRetirement: 0, monthlyContribution: 0,
    monthlyWithdrawal: 1000, withdrawalInflationAdjusted: true, inflation: 2,
    maxRetirementYears: 3,
  });
  const r = simulate(p);
  const dropY0 = r.months[1].value - r.months[2].value; // withdrawal in absMonth 1
  const dropY1 = r.months[13].value - r.months[14].value; // withdrawal in absMonth 13
  check('inflation-indexed withdrawal grows', approx(dropY1 / dropY0, Math.pow(1.02, 1), 1e-4),
    `${dropY1 / dropY0}`);
}

// 5. Depletion detection: 10 000 at 1 000/month lasts exactly 10 months.
{
  const p = Object.assign({}, base, {
    yearsToRetirement: 0, monthlyContribution: 0,
    startingAmount: 10000, startingCostBasis: 10000, monthlyWithdrawal: 1000,
  });
  const r = simulate(p);
  check('depletion month detected', r.summary.runOutMonth === 10, r.summary.runOutMonth);
  check('lastsYears = 10/12', approx(r.summary.lastsYears, 10 / 12));
}

// 6. Invested-capital-thereof changes tax, not growth.
{
  const high = simulate(Object.assign({}, base, {
    assets: singleAsset({ annualReturn: 5 }), startingCostBasis: 10000,
  }));
  const low = simulate(Object.assign({}, base, {
    assets: singleAsset({ annualReturn: 5 }), startingCostBasis: 0,
  }));
  check('cost basis does not affect gross value', approx(high.summary.atRetirement.value, low.summary.atRetirement.value));
  const extraTax = 10000 * 0.275;
  check('lower basis = more KESt if sold',
    approx(high.summary.atRetirement.netIfSold - low.summary.atRetirement.netIfSold, extraTax),
    `${high.summary.atRetirement.netIfSold - low.summary.atRetirement.netIfSold} != ${extraTax}`);
}

// 7. Annual contribution increase, percent and fixed amount.
{
  const pct = simulate(Object.assign({}, base, {
    startingAmount: 0, startingCostBasis: 0, yearsToRetirement: 2, monthlyContribution: 100,
    contributionIncrease: { value: 100, unit: 'percent' },
  }));
  check('contribution increase %', approx(pct.summary.atRetirement.value, 12 * 100 + 12 * 200),
    pct.summary.atRetirement.value);

  const fix = simulate(Object.assign({}, base, {
    startingAmount: 0, startingCostBasis: 0, yearsToRetirement: 2, monthlyContribution: 100,
    contributionIncrease: { value: 50, unit: 'amount' },
  }));
  check('contribution increase €', approx(fix.summary.atRetirement.value, 12 * 100 + 12 * 150),
    fix.summary.atRetirement.value);
}

// 8. Scenario ordering: min ≤ avg ≤ max.
{
  const s = simulateScenarios(Object.assign({}, base, { assets: singleAsset({ annualReturn: 6 }) }));
  const { min, avg, max } = s;
  check('min ≤ avg at retirement', min.summary.atRetirement.value <= avg.summary.atRetirement.value);
  check('avg ≤ max at retirement', avg.summary.atRetirement.value <= max.summary.atRetirement.value);
}

// 9. Dividends are taxed at KESt; reinvestment raises the cost basis.
{
  const p = Object.assign({}, base, {
    startingAmount: 10000, startingCostBasis: 10000, monthlyContribution: 0,
    yearsToRetirement: 1, assets: singleAsset({ dividendYield: 12 }),
  });
  const r = simulate(p);
  check('dividends collected', r.summary.dividends.gross > 0);
  check('KESt withheld on dividends',
    approx(r.summary.kestOnDividends, r.summary.dividends.gross * 0.275),
    `${r.summary.kestOnDividends} != ${r.summary.dividends.gross * 0.275}`);
  // Price return is 0, so all value above the start came from taxed, reinvested
  // dividends — the cost basis must equal the value (no unrealized gains).
  const last = r.months[r.months.length - 1];
  check('reinvested dividends raise basis', approx(last.basis, last.value), `${last.basis} != ${last.value}`);
}

// 10. Drawdown uses dividends before selling: high yield covers the withdrawal fully.
{
  const p = Object.assign({}, base, {
    startingAmount: 1000000, startingCostBasis: 1000000, monthlyContribution: 0,
    yearsToRetirement: 0, monthlyWithdrawal: 2000,
    assets: singleAsset({ dividendYield: 12 }), // 10 000 gross / 7 250 net per month
    maxRetirementYears: 2,
  });
  const r = simulate(p);
  check('dividends cover withdrawal: no sales tax', r.summary.kestOnSales === 0, r.summary.kestOnSales);
  check('dividends cover withdrawal: portfolio survives', r.summary.runOutMonth === null);
  check('surplus dividends reinvested: value grows', r.summary.finalValue > 1000000, r.summary.finalValue);
}

// 11. A 4-asset portfolio with 100 % in one asset equals the single-bucket run.
{
  const multi = Object.assign({}, base, {
    assets: [
      { id: 'a', allocation: 100, allocationLate: 100, annualReturn: 6, dividendYield: 2, ter: 0.2 },
      { id: 'b', allocation: 0, allocationLate: 0, annualReturn: 3, dividendYield: 0, ter: 0.1 },
      { id: 'c', allocation: 0, allocationLate: 0, annualReturn: 7, dividendYield: 0, ter: 0 },
      { id: 'd', allocation: 0, allocationLate: 0, annualReturn: 4, dividendYield: 3, ter: 0 },
    ],
  });
  const single = Object.assign({}, base, {
    assets: singleAsset({ annualReturn: 6, dividendYield: 2, ter: 0.2 }),
  });
  const a = simulate(multi);
  const b = simulate(single);
  check('100%-one-asset == single bucket (retirement value)',
    approx(a.summary.atRetirement.value, b.summary.atRetirement.value));
  check('100%-one-asset == single bucket (final value)', approx(a.summary.finalValue, b.summary.finalValue));
}

// 12. Allocation switch redirects contributions without touching existing holdings.
{
  const p = Object.assign({}, base, {
    startingAmount: 0, startingCostBasis: 0, monthlyContribution: 100, yearsToRetirement: 2,
    allocationSwitch: { enabled: true, year: 1 },
    assets: [
      { id: 'early', allocation: 100, allocationLate: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'late', allocation: 0, allocationLate: 100, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  });
  const r = simulate(p);
  const perAsset = Object.fromEntries(r.summary.atRetirement.perAsset.map((x) => [x.id, x]));
  check('allocation switch: early bucket holds year-0 contributions', approx(perAsset.early.value, 1200),
    perAsset.early.value);
  check('allocation switch: late bucket holds year-1 contributions', approx(perAsset.late.value, 1200),
    perAsset.late.value);
}

// 13. allocationStart splits the starting amount independently of contributions.
{
  const p = Object.assign({}, base, {
    startingAmount: 5000, startingCostBasis: 5000, monthlyContribution: 100, yearsToRetirement: 1,
    assets: [
      { id: 'hold', allocationStart: 100, allocation: 0, allocationLate: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'save', allocationStart: 0, allocation: 100, allocationLate: 100, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  });
  const r = simulate(p);
  const perAsset = Object.fromEntries(r.summary.atRetirement.perAsset.map((x) => [x.id, x]));
  check('allocationStart: starting amount in hold bucket', approx(perAsset.hold.value, 5000), perAsset.hold.value);
  check('allocationStart: contributions in save bucket', approx(perAsset.save.value, 1200), perAsset.save.value);
}

// 13b. Assets without allocationStart fall back to the contribution allocation.
{
  const p = Object.assign({}, base, {
    assets: [{ id: 'a', allocation: 100, allocationLate: 100, annualReturn: 0, dividendYield: 0, ter: 0 }],
  });
  const r = simulate(p);
  check('allocationStart fallback to allocation', approx(r.summary.atRetirement.value, 10000 + 500 * 360),
    r.summary.atRetirement.value);
}

// 14. dividendsPerYearAtRetirement: net annual dividend income on the retirement-day value.
{
  const p = Object.assign({}, base, {
    startingAmount: 10000, startingCostBasis: 10000, monthlyContribution: 0, yearsToRetirement: 1,
    reinvestDividends: false, // value stays 10 000 with zero price return
    assets: singleAsset({ dividendYield: 12 }),
  });
  const r = simulate(p);
  const expected = 10000 * 0.12 * (1 - 0.275);
  check('dividends per year at retirement', approx(r.summary.dividendsPerYearAtRetirement, expected),
    `${r.summary.dividendsPerYearAtRetirement} != ${expected}`);
}

// 15. Monthly records carry the net dividends; they add up to the summary total.
{
  const p = Object.assign({}, base, {
    yearsToRetirement: 2, assets: singleAsset({ dividendYield: 4 }), maxRetirementYears: 1,
  });
  const r = simulate(p);
  const recorded = r.months.reduce((s, m) => s + m.dividends, 0);
  check('monthly dividend records sum to total', approx(recorded, r.summary.dividends.net),
    `${recorded} != ${r.summary.dividends.net}`);
}

// 16. Monthly records carry per-asset values that add up to the total.
{
  const r = simulate(Object.assign({}, base, {
    assets: [
      { id: 'a', allocationStart: 60, allocation: 30, allocationLate: 30, annualReturn: 5, dividendYield: 1, ter: 0.2 },
      { id: 'b', allocationStart: 40, allocation: 70, allocationLate: 70, annualReturn: 3, dividendYield: 0, ter: 0 },
    ],
    yearsToRetirement: 3, maxRetirementYears: 2,
  }));
  const ok = r.months.every((m) => Math.abs(m.perAsset.reduce((s, v) => s + v, 0) - m.value) < 1e-6);
  check('per-asset record values sum to total', ok);
  check('per-asset record has one entry per asset', r.months[0].perAsset.length === 2);
}

// 17. Withdrawal source: sales come only from assets with withdrawalShare > 0.
{
  const p = Object.assign({}, base, {
    startingAmount: 200000, startingCostBasis: 200000, monthlyContribution: 0, yearsToRetirement: 0,
    monthlyWithdrawal: 1000, maxRetirementYears: 2,
    assets: [
      { id: 'sell', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: 100, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'keep', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  });
  const r = simulate(p);
  const last = r.months[r.months.length - 1];
  check('withdrawal source: kept asset untouched', approx(last.perAsset[1], 100000), last.perAsset[1]);
  check('withdrawal source: sold asset shrinks', approx(last.perAsset[0], 100000 - 24 * 1000), last.perAsset[0]);
}

// 18. Withdrawal source fallback: after the preferred asset is empty, the rest is sold
//     and the money lasts until everything is gone.
{
  const p = Object.assign({}, base, {
    startingAmount: 20000, startingCostBasis: 20000, monthlyContribution: 0, yearsToRetirement: 0,
    monthlyWithdrawal: 1000, maxRetirementYears: 5,
    assets: [
      { id: 'sell', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: 100, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'keep', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  });
  const r = simulate(p);
  check('withdrawal fallback: lasts the full 20 months', r.summary.runOutMonth === 20, r.summary.runOutMonth);
}

// 19. No withdrawalShare configured (all 0 / legacy inputs): proportional by value.
{
  const p = Object.assign({}, base, {
    startingAmount: 200000, startingCostBasis: 200000, monthlyContribution: 0, yearsToRetirement: 0,
    monthlyWithdrawal: 1000, maxRetirementYears: 1,
    assets: [
      { id: 'a', allocationStart: 50, allocation: 50, allocationLate: 50, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'b', allocationStart: 50, allocation: 50, allocationLate: 50, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  });
  const r = simulate(p);
  const last = r.months[r.months.length - 1];
  check('legacy: proportional selling across both', approx(last.perAsset[0], last.perAsset[1]),
    `${last.perAsset[0]} != ${last.perAsset[1]}`);
}

// 20. First-retirement-year breakdown: all from sales, no tax when basis = value.
{
  const p = Object.assign({}, base, {
    startingAmount: 100000, startingCostBasis: 100000, monthlyContribution: 0,
    yearsToRetirement: 0, monthlyWithdrawal: 1000, maxRetirementYears: 3,
  });
  const fy = simulate(p).summary.firstRetirementYear;
  const salesNet = fy.sales.reduce((s, x) => s + x.net, 0);
  check('first year: sales cover 12 withdrawals', approx(salesNet, 12000), salesNet);
  check('first year: no KESt without gains', fy.sales.reduce((s, x) => s + x.kest, 0) === 0);
  check('first year: withdrawalsNet matches', approx(fy.withdrawalsNet, 12000), fy.withdrawalsNet);
}

// 21. First-year KESt: 50 % unrealized gains stay 50 % with zero growth.
{
  const p = Object.assign({}, base, {
    startingAmount: 100000, startingCostBasis: 50000, monthlyContribution: 0,
    yearsToRetirement: 0, monthlyWithdrawal: 1000, maxRetirementYears: 3,
  });
  const fy = simulate(p).summary.firstRetirementYear;
  const gross = fy.sales.reduce((s, x) => s + x.gross, 0);
  const kestPaid = fy.sales.reduce((s, x) => s + x.kest, 0);
  const expGross = 12 * (1000 / (1 - 0.5 * 0.275));
  check('first year: grossed-up sales', approx(gross, expGross, 1e-9), `${gross} != ${expGross}`);
  check('first year: KESt = gross - net', approx(kestPaid, gross - 12000), kestPaid);
}

// 22. Dividends cover the withdrawal: no sales in the breakdown, keepsGrowing icon case.
{
  const p = Object.assign({}, base, {
    startingAmount: 1000000, startingCostBasis: 1000000, monthlyContribution: 0,
    yearsToRetirement: 0, monthlyWithdrawal: 2000,
    assets: singleAsset({ dividendYield: 12 }),
    maxRetirementYears: 2,
  });
  const s = simulate(p).summary;
  check('dividends-only: no sales recorded', s.firstRetirementYear.sales.every((x) => x.gross === 0));
  check('dividends-only: dividend KESt recorded', s.firstRetirementYear.dividends.kest > 0);
  check('keepsGrowing flag set', s.keepsGrowing === true);
}

// 23. keepsGrowing is false when the portfolio depletes.
{
  const p = Object.assign({}, base, {
    startingAmount: 10000, startingCostBasis: 10000, monthlyContribution: 0,
    yearsToRetirement: 0, monthlyWithdrawal: 1000,
  });
  check('keepsGrowing false on depletion', simulate(p).summary.keepsGrowing === false);
}

// 24. solveTargets round-trip: each solved lever lands back on the (real) target.
{
  const p = Object.assign({}, base, {
    startingAmount: 10000, startingCostBasis: 10000, monthlyContribution: 500,
    yearsToRetirement: 30, inflation: 2, assets: singleAsset({ annualReturn: 6 }),
    targetAmount: 700000,
  });
  const sol = solveTargets(p);
  const apply = {
    monthlyContribution: (x) => ({ ...p, monthlyContribution: x }),
    contributionIncrease: (x) => ({ ...p, contributionIncrease: { value: x, unit: 'percent' } }),
    yearsToRetirement: (x) => ({ ...p, yearsToRetirement: x }),
    startingAmount: (x) => ({ ...p, startingAmount: x }),
  };
  for (const key of Object.keys(apply)) {
    const lever = sol.levers[key];
    check(`solve ${key}: status ok`, lever.status === 'ok', lever.status);
    const got = realValueAtRetirement(apply[key](lever.needed));
    // The years lever lands on a whole-month boundary, so allow a looser tolerance.
    const eps = key === 'yearsToRetirement' ? 2e-2 : 1e-4;
    check(`solve ${key}: hits target`, approx(got, p.targetAmount, eps), `${got} != ${p.targetAmount}`);
  }
  // returnShift maps to the scenario shift, not a params field.
  const rs = sol.levers.returnShift;
  check('solve returnShift: status ok', rs.status === 'ok', rs.status);
  const gotRs = realValueAtRetirement(p, rs.needed);
  check('solve returnShift: hits target', approx(gotRs, p.targetAmount, 1e-4), `${gotRs} != ${p.targetAmount}`);
}

// 25. Target statuses: an already-surpassed target floors out, an absurd one is unreachable.
{
  const p = Object.assign({}, base, {
    monthlyContribution: 500, yearsToRetirement: 30, inflation: 2,
    assets: singleAsset({ annualReturn: 6 }),
  });
  const tiny = solveTargets({ ...p, targetAmount: 1 });
  check('tiny target: reached flag set', tiny.reached === true);
  check('tiny target: monthly contribution belowFloor',
    tiny.levers.monthlyContribution.status === 'belowFloor', tiny.levers.monthlyContribution.status);

  const huge = solveTargets({ ...p, targetAmount: 1e15 });
  check('huge target: not reached', huge.reached === false);
  check('huge target: return shift unreachable',
    huge.levers.returnShift.status === 'unreachable', huge.levers.returnShift.status);
}

// 26. Backwards-compat contract: withDefaults fills fields added after older
//     saved/exported files were written (the README's "non-breaking" promise).
{
  const legacy = {
    startingAmount: 5000, startingCostBasis: 5000, monthlyContribution: 200, yearsToRetirement: 10,
    assets: [
      // No allocationStart, no withdrawalShare — the shape of a pre-feature file.
      { id: 'etf', allocation: 60, allocationLate: 60, annualReturn: 5, dividendYield: 0, ter: 0.2 },
      { id: 'bonds', allocation: 40, allocationLate: 40, annualReturn: 2, dividendYield: 0, ter: 0.1 },
    ],
    // No targetAmount, contributionIncrease or allocationSwitch either.
  };
  const p = withDefaults(legacy);
  check('compat: allocationStart falls back to allocation',
    p.assets[0].allocationStart === 60 && p.assets[1].allocationStart === 40);
  check('compat: withdrawalShare defaults to 0',
    p.assets[0].withdrawalShare === 0 && p.assets[1].withdrawalShare === 0);
  check('compat: targetAmount default filled', p.targetAmount === DEFAULT_PARAMS.targetAmount, p.targetAmount);
  check('compat: contributionIncrease default filled',
    p.contributionIncrease.value === 0 && p.contributionIncrease.unit === 'percent');
  check('compat: allocationSwitch default filled',
    p.allocationSwitch.enabled === false && p.allocationSwitch.year === DEFAULT_PARAMS.allocationSwitch.year);
  const r = simulate(legacy);
  check('compat: a legacy file still simulates to a finite value',
    Number.isFinite(r.summary.atRetirement.value) && r.summary.atRetirement.value > 0);
}

// 26b. withDefaults supplies the whole default portfolio when assets is absent.
{
  const p = withDefaults({ startingAmount: 1000 });
  check('compat: missing assets -> default portfolio', p.assets.length === DEFAULT_PARAMS.assets.length);
  check('compat: default assets carry allocationStart',
    p.assets.every((a) => typeof a.allocationStart === 'number'));
  // A malformed file with an explicit null assets list also falls back.
  const nulled = withDefaults({ assets: null });
  check('compat: explicit null assets -> default portfolio',
    nulled.assets.length === DEFAULT_PARAMS.assets.length);
}

// 27. Defensive guards keep pathological inputs finite (never NaN).
{
  // A price return below -100 %/yr is clamped by monthlyRate, not turned into NaN.
  const crash = simulate(Object.assign({}, base, {
    yearsToRetirement: 5, assets: singleAsset({ annualReturn: -150 }),
  }));
  check('guard: sub -100% return stays finite', Number.isFinite(crash.summary.atRetirement.value));
  check('guard: sub -100% return destroys value',
    crash.summary.atRetirement.value < crash.summary.totalContributions);

  // All allocations zero: normalizeWeights falls back to an equal split.
  const zero = simulate(Object.assign({}, base, {
    startingAmount: 1000, startingCostBasis: 1000, monthlyContribution: 120, yearsToRetirement: 1,
    assets: [
      { id: 'a', allocationStart: 0, allocation: 0, allocationLate: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'b', allocationStart: 0, allocation: 0, allocationLate: 0, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  }));
  const per = zero.summary.atRetirement.perAsset;
  check('guard: all-zero allocations split equally', approx(per[0].value, per[1].value) && per[0].value > 0,
    `${per[0].value} != ${per[1].value}`);
  check('guard: all-zero allocations stay finite', per.every((a) => Number.isFinite(a.value)));

  // A negative withdrawalShare is clamped to 0 ("don't sell from here").
  const neg = simulate(Object.assign({}, base, {
    startingAmount: 200000, startingCostBasis: 200000, monthlyContribution: 0, yearsToRetirement: 0,
    monthlyWithdrawal: 1000, maxRetirementYears: 2,
    assets: [
      { id: 'sell', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: 100, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'keep', allocationStart: 50, allocation: 50, allocationLate: 50, withdrawalShare: -50, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  }));
  const lastNeg = neg.months[neg.months.length - 1];
  check('guard: negative withdrawalShare treated as 0', approx(lastNeg.perAsset[1], 100000), lastNeg.perAsset[1]);
}

// 28. Allocations need not sum to 100 — the math normalizes by ratio.
{
  // Contribution column sums to 200 (60 + 140) but should still split 30/70.
  const r = simulate(Object.assign({}, base, {
    startingAmount: 0, startingCostBasis: 0, monthlyContribution: 100, yearsToRetirement: 1,
    assets: [
      { id: 'a', allocationStart: 30, allocation: 60, allocationLate: 60, annualReturn: 0, dividendYield: 0, ter: 0 },
      { id: 'b', allocationStart: 70, allocation: 140, allocationLate: 140, annualReturn: 0, dividendYield: 0, ter: 0 },
    ],
  }));
  const per = Object.fromEntries(r.summary.atRetirement.perAsset.map((x) => [x.id, x.value]));
  // 1 200 contributed over the year, split 60:140 -> 360 / 840.
  check('normalize: contributions split by ratio, not raw %', approx(per.a, 360) && approx(per.b, 840),
    `${per.a} / ${per.b}`);
}

// 29. reinvestDividends:false routes net dividends into summary.dividends.paidOut.
{
  const p = Object.assign({}, base, {
    startingAmount: 10000, startingCostBasis: 10000, monthlyContribution: 0, yearsToRetirement: 1,
    reinvestDividends: false, assets: singleAsset({ dividendYield: 12 }),
  });
  const r = simulate(p);
  // Zero price return + no reinvestment: value holds at 10 000 the whole year, so
  // each month pays 10 000 · 1 % gross = 100 (72.5 net), 12 months -> 870 paid out.
  const expectedPaidOut = 12 * (10000 * 0.12 / 12) * (1 - 0.275);
  check('paidOut: collects net accumulation dividends', approx(r.summary.dividends.paidOut, expectedPaidOut),
    `${r.summary.dividends.paidOut} != ${expectedPaidOut}`);
  check('paidOut: value unchanged without reinvestment', approx(r.summary.atRetirement.value, 10000),
    r.summary.atRetirement.value);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

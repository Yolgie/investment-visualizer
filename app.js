/* DOM wiring: reads inputs, runs the simulation, renders chart + summary,
 * handles i18n and the opt-in localStorage persistence. */

/* global I18N, DEFAULT_PARAMS, simulateScenarios, solveTargets */

const STORAGE_KEY = 'retirement-calc-v1';
const LANG_KEY = 'retirement-calc-lang';
const START_YEAR = new Date().getFullYear();
const ASSET_LABEL_KEYS = {
  etf: 'assetEtf',
  bonds: 'assetBonds',
  stocks: 'assetStocks',
  dividendStocks: 'assetDividendStocks',
};

let lang = localStorage.getItem(LANG_KEY)
  || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en');

const t = (key) => (I18N[lang] && I18N[lang][key]) || key;
const $ = (id) => document.getElementById(id);

function fmtMoney(v) {
  return new Intl.NumberFormat(lang === 'de' ? 'de-AT' : 'en-AT', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(v);
}

// Plain number with a fixed number of decimals, localized (de-AT uses a comma).
function fmtNum(v, decimals = 1) {
  return new Intl.NumberFormat(lang === 'de' ? 'de-AT' : 'en-AT', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v);
}

// ---------------------------------------------------------------- form I/O --

function setFormValues(params, ui) {
  $('startingAmount').value = params.startingAmount;
  $('startingCostBasis').value = params.startingCostBasis;
  $('monthlyContribution').value = params.monthlyContribution;
  $('contributionIncreaseValue').value = params.contributionIncrease.value;
  $('contributionIncreaseUnit').value = params.contributionIncrease.unit;
  $('yearsToRetirement').value = params.yearsToRetirement;
  $('goalType').value = params.goalType || 'amount';
  $('targetAmount').value = params.targetAmount;
  $('allocationSwitchEnabled').checked = params.allocationSwitch.enabled;
  $('allocationSwitchYear').value = params.allocationSwitch.year;
  $('reinvestDividends').checked = params.reinvestDividends;
  $('monthlyWithdrawal').value = params.monthlyWithdrawal;
  $('withdrawalInflationAdjusted').checked = params.withdrawalInflationAdjusted;
  $('kest').value = params.kest;
  $('inflation').value = params.inflation;
  $('scenarioSpread').value = params.scenarioSpread;
  $('maxRetirementYears').value = params.maxRetirementYears;
  $('displayReal').checked = !!(ui && ui.displayReal);

  for (const row of document.querySelectorAll('#allocationTable tbody tr')) {
    const asset = params.assets.find((a) => a.id === row.dataset.asset);
    if (!asset) continue;
    const defaults = DEFAULT_PARAMS.assets.find((a) => a.id === asset.id) || {};
    for (const input of row.querySelectorAll('input')) {
      const field = input.dataset.field;
      // Fall back for inputs stored before the field existed: withdrawalShare
      // gets its default, allocation columns mirror the contribution split.
      const fallback = field === 'withdrawalShare' ? (defaults.withdrawalShare ?? 0) : (asset.allocation ?? 0);
      input.value = asset[field] ?? fallback;
    }
  }
}

function num(el, fallback = 0) {
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function readParams() {
  const assets = [];
  for (const row of document.querySelectorAll('#allocationTable tbody tr')) {
    const asset = { id: row.dataset.asset };
    for (const input of row.querySelectorAll('input')) {
      asset[input.dataset.field] = num(input);
    }
    assets.push(asset);
  }
  return {
    startingAmount: num($('startingAmount')),
    startingCostBasis: num($('startingCostBasis')),
    monthlyContribution: num($('monthlyContribution')),
    contributionIncrease: {
      value: num($('contributionIncreaseValue')),
      unit: $('contributionIncreaseUnit').value,
    },
    yearsToRetirement: Math.max(1, num($('yearsToRetirement'), 30)),
    goalType: $('goalType').value,
    targetAmount: Math.max(0, num($('targetAmount'), 1000000)),
    assets,
    allocationSwitch: {
      enabled: $('allocationSwitchEnabled').checked,
      year: Math.max(1, num($('allocationSwitchYear'), 20)),
    },
    reinvestDividends: $('reinvestDividends').checked,
    scenarioSpread: Math.max(0, num($('scenarioSpread'))),
    monthlyWithdrawal: num($('monthlyWithdrawal')),
    withdrawalInflationAdjusted: $('withdrawalInflationAdjusted').checked,
    kest: num($('kest'), 27.5),
    inflation: num($('inflation')),
    maxRetirementYears: Math.max(1, num($('maxRetirementYears'), 60)),
  };
}

// ------------------------------------------------------------- persistence --

function persist() {
  if (!$('saveInputs').checked) return;
  const state = { params: readParams(), displayReal: $('displayReal').checked };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage full or blocked — calculator still works */ }
}

function restore() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* blocked */ }
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    setFormValues(Object.assign({}, DEFAULT_PARAMS, state.params), state);
    $('saveInputs').checked = true;
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------- export / import ----

function exportInputs() {
  const state = {
    app: 'retirement-calc',
    version: 1,
    exportedAt: new Date().toISOString(),
    params: readParams(),
    displayReal: $('displayReal').checked,
  };
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'retirement-calc-inputs.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importInputs(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const state = JSON.parse(reader.result);
      if (!state || typeof state !== 'object' || !state.params || !Array.isArray(state.params.assets)) {
        throw new Error('not a calculator export');
      }
      setFormValues(Object.assign({}, DEFAULT_PARAMS, state.params), state);
      recalc();
      persist();
    } catch {
      alert(t('importError'));
    }
  };
  reader.readAsText(file);
}

// ------------------------------------------------------- allocation checks --

function updateAllocationUI(params) {
  const lateVisible = params.allocationSwitch.enabled;
  for (const el of document.querySelectorAll('.late-col')) {
    el.classList.toggle('hidden', !lateVisible);
  }
  $('allocationSwitchYearRow').classList.toggle('hidden', !lateVisible);
  for (const el of document.querySelectorAll('.switch-year-label')) {
    el.textContent = params.allocationSwitch.year;
  }

  const startSum = params.assets.reduce((s, a) => s + a.allocationStart, 0);
  const sum = params.assets.reduce((s, a) => s + a.allocation, 0);
  const lateSum = params.assets.reduce((s, a) => s + a.allocationLate, 0);
  const withdrawalSum = params.assets.reduce((s, a) => s + a.withdrawalShare, 0);
  const startSumEl = $('allocationStartSum');
  const sumEl = $('allocationSum');
  const lateSumEl = $('allocationLateSum');
  const withdrawalSumEl = $('withdrawalShareSum');
  startSumEl.textContent = `${startSum} %`;
  sumEl.textContent = `${sum} %`;
  lateSumEl.textContent = `${lateSum} %`;
  withdrawalSumEl.textContent = `${withdrawalSum} %`;
  const startBad = Math.abs(startSum - 100) > 0.01;
  const bad = Math.abs(sum - 100) > 0.01;
  const lateBad = lateVisible && Math.abs(lateSum - 100) > 0.01;
  const withdrawalBad = Math.abs(withdrawalSum - 100) > 0.01;
  startSumEl.classList.toggle('sum-bad', startBad);
  sumEl.classList.toggle('sum-bad', bad);
  lateSumEl.classList.toggle('sum-bad', lateBad);
  withdrawalSumEl.classList.toggle('sum-bad', withdrawalBad);

  const badColumns = [];
  if (startBad) badColumns.push(`${t('allocationStart')} (${startSum} %)`);
  if (bad) badColumns.push(`${t('allocation')} (${sum} %)`);
  if (lateBad) badColumns.push(`${t('allocationLate')} ${params.allocationSwitch.year} (${lateSum} %)`);
  if (withdrawalBad) badColumns.push(`${t('withdrawalShare')} (${withdrawalSum} %)`);
  const warningEl = $('allocationWarning');
  warningEl.classList.toggle('hidden', badColumns.length === 0);
  warningEl.textContent = t('allocationWarning').replace('{columns}', badColumns.join(', '));
}

// -------------------------------------------------------------------- chart --

let chart = null;
let assetChart = null;
let pieChart = null;
let allocationPie = null;
const ASSET_COLORS = {
  etf: { border: '#2563eb', fill: 'rgba(37,99,235,0.35)' },
  bonds: { border: '#64748b', fill: 'rgba(100,116,139,0.35)' },
  stocks: { border: '#16a34a', fill: 'rgba(22,163,74,0.35)' },
  dividendStocks: { border: '#d97706', fill: 'rgba(217,119,6,0.35)' },
};
// Context for the tooltip's dividends-per-year line, refreshed on every render.
let tooltipData = null;

const retirementLinePlugin = {
  id: 'retirementLine',
  afterDatasetsDraw(c, _args, opts) {
    if (!opts || opts.year == null) return;
    const { ctx, chartArea, scales } = c;
    const x = scales.x.getPixelForValue(opts.year);
    if (x < chartArea.left || x > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = '#9ca3af';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(` ${opts.label || ''}`, x, chartArea.top + 12);
    ctx.restore();
  },
};

function toSeries(months, inflation, displayReal, pick) {
  return months.map((m) => {
    const deflator = displayReal ? Math.pow(1 + inflation / 100, m.month / 12) : 1;
    return { x: START_YEAR + m.month / 12, y: pick(m) / deflator };
  });
}

// Net dividends received during the calendar year that contains the given month record.
function dividendsInYearOf(month) {
  if (!tooltipData) return 0;
  const yearIdx = Math.max(0, Math.ceil(month / 12) - 1);
  return tooltipData.months.reduce((sum, r) => {
    if (r.month === 0 || Math.ceil(r.month / 12) - 1 !== yearIdx) return sum;
    const deflator = tooltipData.displayReal
      ? Math.pow(1 + tooltipData.inflation / 100, r.month / 12) : 1;
    return sum + r.dividends / deflator;
  }, 0);
}

function renderChart(scenarios, params, displayReal) {
  const { avg, min, max } = scenarios;
  const infl = params.inflation;
  tooltipData = { months: avg.months, inflation: infl, displayReal };

  const basisAvg = toSeries(avg.months, infl, displayReal, (m) => Math.min(m.basis, m.value));
  const totalAvg = toSeries(avg.months, infl, displayReal, (m) => m.value);
  const totalMin = toSeries(min.months, infl, displayReal, (m) => m.value);
  const totalMax = toSeries(max.months, infl, displayReal, (m) => m.value);

  const datasets = [
    {
      label: t('chartBand'), data: totalMin, borderColor: 'rgba(37,99,235,0.35)',
      borderWidth: 1, borderDash: [4, 3], pointRadius: 0, fill: false, order: 4,
    },
    {
      label: t('chartBand'), data: totalMax, borderColor: 'rgba(37,99,235,0.35)',
      backgroundColor: 'rgba(37,99,235,0.07)', borderWidth: 1, borderDash: [4, 3],
      pointRadius: 0, fill: '-1', order: 3,
    },
    {
      label: t('chartContributions'), data: basisAvg, borderColor: 'rgba(100,116,139,0.9)',
      backgroundColor: 'rgba(100,116,139,0.25)', borderWidth: 1.5, pointRadius: 0,
      fill: 'origin', order: 2,
    },
    {
      label: t('chartTotal'), data: totalAvg, borderColor: '#2563eb',
      backgroundColor: 'rgba(37,99,235,0.18)', borderWidth: 2, pointRadius: 0,
      fill: 2, order: 1,
    },
  ];

  const logScale = $('logScale').checked;
  // Linear: frame the chart around the avg scenario so it owns the real estate;
  // the max line is allowed to run off the top. Log: let it autoscale so the
  // whole min–max band, max line included, stays inside the viewport.
  const avgPeak = totalAvg.reduce((m, p) => Math.max(m, p.y), 0);
  const yScale = logScale
    ? {
        type: 'logarithmic',
        ticks: { callback: (v) => fmtMoney(v) },
      }
    : {
        type: 'linear',
        beginAtZero: true,
        max: avgPeak > 0 ? avgPeak * 1.05 : undefined,
        ticks: { callback: (v) => fmtMoney(v) },
      };

  const retirementYear = START_YEAR + params.yearsToRetirement;
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: t('chartYear') },
        ticks: { callback: (v) => Math.round(v), maxTicksLimit: 15 },
      },
      y: yScale,
    },
    plugins: {
      retirementLine: { year: retirementYear, label: t('chartRetirement') },
      legend: {
        labels: {
          // The min line duplicates the band's legend entry — show only one.
          filter: (item) => item.datasetIndex !== 0,
        },
      },
      tooltip: {
        callbacks: {
          title: (items) => `${t('chartYear')} ${Math.round(items[0].parsed.x)}`,
          label: (item) => `${item.dataset.label}: ${fmtMoney(item.parsed.y)}`,
          afterBody: (items) => {
            const month = Math.round((items[0].parsed.x - START_YEAR) * 12);
            const perYear = dividendsInYearOf(month);
            return perYear > 0.5 ? `${t('chartDividendsPerYear')}: ${fmtMoney(perYear)}` : '';
          },
        },
      },
    },
  };

  if (chart) {
    chart.data.datasets = datasets;
    chart.options = options;
    chart.update('none');
  } else {
    chart = new Chart($('chart'), {
      type: 'line',
      data: { datasets },
      options,
      plugins: [retirementLinePlugin],
    });
  }
}

// Stacked area chart: each asset's value over time (avg scenario), visibly
// separated like paid-in capital vs. total value in the main chart.
function renderAssetChart(scenarios, params, displayReal) {
  const months = scenarios.avg.months;
  const infl = params.inflation;
  const fallbackColors = ['#2563eb', '#64748b', '#16a34a', '#d97706'];

  const datasets = params.assets.map((asset, i) => {
    const color = ASSET_COLORS[asset.id] || { border: fallbackColors[i % 4], fill: fallbackColors[i % 4] };
    return {
      label: t(ASSET_LABEL_KEYS[asset.id] || asset.id),
      data: toSeries(months, infl, displayReal, (m) => m.perAsset[i]),
      borderColor: color.border,
      backgroundColor: color.fill,
      borderWidth: 1,
      pointRadius: 0,
      fill: i === 0 ? 'origin' : '-1', // stack the areas on top of each other
    };
  });

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: t('chartYear') },
        ticks: { callback: (v) => Math.round(v), maxTicksLimit: 15 },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { callback: (v) => fmtMoney(v) },
      },
    },
    plugins: {
      retirementLine: { year: START_YEAR + params.yearsToRetirement, label: t('chartRetirement') },
      tooltip: {
        callbacks: {
          title: (items) => `${t('chartYear')} ${Math.round(items[0].parsed.x)}`,
          label: (item) => `${item.dataset.label}: ${fmtMoney(item.parsed.y)}`,
        },
      },
    },
  };

  if (assetChart) {
    assetChart.data.datasets = datasets;
    assetChart.options = options;
    assetChart.update('none');
  } else {
    assetChart = new Chart($('assetChart'), {
      type: 'line',
      data: { datasets },
      options,
      plugins: [retirementLinePlugin],
    });
  }
}

// Draws each slice's share as a big percentage label inside the pie.
const pieLabelPlugin = {
  id: 'pieLabels',
  afterDatasetsDraw(c) {
    const data = c.data.datasets[0].data;
    const total = data.reduce((s, v) => s + v, 0);
    if (total <= 0) return;
    const meta = c.getDatasetMeta(0);
    const { ctx } = c;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const pct = (data[i] / total) * 100;
      if (pct < 4) return; // a label would not fit on a sliver
      const pos = arc.getCenterPoint();
      ctx.fillText(`${Math.round(pct)} %`, pos.x, pos.y);
    });
    ctx.restore();
  },
};

function renderPie(scenarios, params, displayReal) {
  const s = scenarios.avg.summary;
  // Deflating divides all slices by the same factor, so proportions are
  // unchanged — only the tooltip amounts switch to today's purchasing power.
  const deflator = displayReal
    ? Math.pow(1 + params.inflation / 100, s.accumulationMonths / 12) : 1;
  // Paid-in money: the cost basis of the starting amount ("invested capital
  // thereof") plus all monthly contributions. Pre-existing gains in the
  // starting amount count as growth.
  const paidIn = Math.min(
    Math.max(0, Math.min(params.startingCostBasis, params.startingAmount))
      + Math.max(0, s.totalContributions - params.startingAmount),
    s.atRetirement.value,
  );
  const growth = Math.max(0, s.atRetirement.value - paidIn);
  const data = {
    labels: [t('pieContributions'), t('pieGrowth')],
    datasets: [{
      data: [paidIn / deflator, growth / deflator],
      backgroundColor: ['rgba(37,99,235,0.7)', 'rgba(22,163,74,0.7)'],
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: { callbacks: { label: (item) => `${item.label}: ${fmtMoney(item.parsed)}` } },
    },
  };
  if (pieChart) {
    pieChart.data = data;
    pieChart.options = options;
    pieChart.update('none');
  } else {
    pieChart = new Chart($('pieChart'), { type: 'pie', data, options, plugins: [pieLabelPlugin] });
  }
}

// Portfolio split by asset class at retirement (avg scenario).
function renderAllocationPie(scenarios, params, displayReal) {
  const s = scenarios.avg.summary;
  // Deflating scales every slice equally, so proportions stay the same.
  const deflator = displayReal
    ? Math.pow(1 + params.inflation / 100, s.accumulationMonths / 12) : 1;
  const assets = s.atRetirement.perAsset;
  const data = {
    labels: assets.map((a) => t(ASSET_LABEL_KEYS[a.id] || a.id)),
    datasets: [{
      data: assets.map((a) => a.value / deflator),
      backgroundColor: assets.map((a) => (ASSET_COLORS[a.id] || {}).border || '#94a3b8'),
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: { callbacks: { label: (item) => `${item.label}: ${fmtMoney(item.parsed)}` } },
    },
  };
  if (allocationPie) {
    allocationPie.data = data;
    allocationPie.options = options;
    allocationPie.update('none');
  } else {
    allocationPie = new Chart($('allocationPie'), { type: 'pie', data, options, plugins: [pieLabelPlugin] });
  }
}

// ------------------------------------------------------------------ summary --

function deflate(value, params, displayReal, atMonth) {
  if (!displayReal) return value;
  return value / Math.pow(1 + params.inflation / 100, atMonth / 12);
}

function lastsText(summary, params) {
  if (summary.runOutMonth === null) {
    return t('summaryLastsForever').replace('{years}', params.maxRetirementYears);
  }
  const years = Math.round(summary.lastsYears * 10) / 10;
  const endYear = Math.round(START_YEAR + summary.runOutMonth / 12);
  return t('summaryLastsYears').replace('{years}', years).replace('{endYear}', endYear);
}

// Compact form for the range line: "13.2 years" or "> 60 years (end of simulation)".
function lastsShort(summary, params) {
  if (summary.runOutMonth === null) {
    return t('summaryLastsShortMore').replace('{years}', params.maxRetirementYears);
  }
  return t('summaryLastsShort').replace('{years}', Math.round(summary.lastsYears * 10) / 10);
}

function card(title, value, range) {
  return `<div class="card"><h3>${title}</h3><div class="value">${value}</div>${
    range ? `<div class="range">${t('summaryRange')}: ${range}</div>` : ''}</div>`;
}

function renderSummary(scenarios, params, displayReal) {
  const { avg, min, max } = scenarios;
  const retMonth = avg.summary.accumulationMonths;
  const d = (v) => fmtMoney(deflate(v, params, displayReal, retMonth));

  const cards = [
    card(
      t('summaryAtRetirement'),
      d(avg.summary.atRetirement.value),
      `${d(min.summary.atRetirement.value)} – ${d(max.summary.atRetirement.value)}`,
    ),
    card(t('summaryNetIfSold'), d(avg.summary.atRetirement.netIfSold)),
    card(t('summaryContributions'), fmtMoney(avg.summary.totalContributions)),
    card(
      t('summaryGrowth'),
      d(avg.summary.totalGrowth),
      `${d(min.summary.totalGrowth)} – ${d(max.summary.totalGrowth)}`,
    ),
    card(t('summaryDividends'), fmtMoney(avg.summary.dividends.net)),
    card(t('summaryDividendsPerYear'), d(avg.summary.dividendsPerYearAtRetirement)),
    card(t('summaryKestPaid'), fmtMoney(avg.summary.kestOnSales)),
    card(
      t('summaryLasts'),
      (avg.summary.keepsGrowing
        ? `<span class="grow-icon" title="${t('keepsGrowing')}">📈</span> ` : '')
        + lastsText(avg.summary, params),
      `${lastsShort(min.summary, params)} – ${lastsShort(max.summary, params)}`,
    ),
  ];
  $('summary').innerHTML = cards.join('');
}

// Where the first retirement year's money comes from: sales per asset,
// dividends, and the KESt withheld on each.
function renderWithdrawalBreakdown(scenarios, params, displayReal) {
  const s = scenarios.avg.summary;
  const fy = s.firstRetirementYear;
  const retMonth = s.accumulationMonths;
  const d = (v) => fmtMoney(deflate(v, params, displayReal, retMonth));

  const rows = [];
  if (fy.dividends.gross > 0.5) {
    rows.push({ label: t('wbDividends'), ...fy.dividends });
  }
  for (const sale of fy.sales) {
    if (sale.gross <= 0.5) continue;
    rows.push({
      label: t('wbSalesOf').replace('{asset}', t(ASSET_LABEL_KEYS[sale.id] || sale.id)),
      gross: sale.gross, net: sale.net, kest: sale.kest,
    });
  }
  const total = rows.reduce(
    (acc, r) => ({ gross: acc.gross + r.gross, kest: acc.kest + r.kest, net: acc.net + r.net }),
    { gross: 0, kest: 0, net: 0 },
  );

  $('withdrawalTable').innerHTML = `
    <thead><tr>
      <th>${t('wbSource')}</th>
      <th>${t('wbGross')}</th>
      <th>${t('wbKest')}</th>
      <th>${t('wbNet')}</th>
    </tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>
        <td>${r.label}</td><td>${d(r.gross)}</td><td>${d(r.kest)}</td><td>${d(r.net)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr>
      <td>${t('wbTotal')}</td><td>${d(total.gross)}</td><td>${d(total.kest)}</td><td>${d(total.net)}</td>
    </tr></tfoot>`;
}

function renderPerAsset(scenarios, params, displayReal) {
  const retMonth = scenarios.avg.summary.accumulationMonths;
  const d = (v) => fmtMoney(deflate(v, params, displayReal, retMonth));
  const rows = scenarios.avg.summary.atRetirement.perAsset.map((a) => `
    <tr>
      <td>${t(ASSET_LABEL_KEYS[a.id] || a.id)}</td>
      <td>${d(a.value)}</td>
      <td>${d(a.netIfSold)}</td>
    </tr>`).join('');
  $('perAssetTable').innerHTML = `
    <thead><tr>
      <th>${t('asset')}</th>
      <th>${t('summaryAtRetirement')}</th>
      <th>${t('summaryNetIfSold')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

// ------------------------------------------------------------- target block --

// How each lever's values are formatted, in display order. `unit` controls the
// "change" cell: money/years use absolute deltas, percent/pp show the figure.
function targetLeverMeta() {
  return [
    { key: 'monthlyContribution', label: t('monthlyContribution'), fmt: fmtMoney, unit: 'money' },
    { key: 'contributionIncrease', label: t('contributionIncrease'), fmt: (v) => `${fmtNum(v)} %`, unit: 'percent' },
    { key: 'yearsToRetirement', label: t('yearsToRetirement'), fmt: (v) => `${fmtNum(v)} ${t('unitYears')}`, unit: 'years' },
    { key: 'startingAmount', label: t('startingAmount'), fmt: fmtMoney, unit: 'money' },
    { key: 'returnShift', label: t('targetLeverReturn'), fmt: (v) => `${v > 0 ? '+' : ''}${fmtNum(v)} pp`, unit: 'pp' },
  ];
}

function targetChangeCell(meta, lever) {
  if (lever.status === 'belowFloor') return t('targetBelowFloor');
  if (lever.status === 'unreachable') return t('targetUnreachable');
  const delta = lever.needed - lever.current;
  if (Math.abs(delta) < (meta.unit === 'money' ? 1 : 0.05)) return '–';
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${meta.fmt(Math.abs(delta))}`;
}

// Shows/hides the goal inputs that only apply to one mode.
function updateGoalUI(params) {
  const stable = params.goalType === 'stableValue';
  $('targetAmountRow').classList.toggle('hidden', stable);
  $('goalStableHint').classList.toggle('hidden', !stable);
}

function renderTarget(params) {
  const result = solveTargets(params);
  if (result.goalType === 'stableValue') {
    // The bar is the value you retire on (result.current); the end-of-drawdown
    // real value (result.finalReal) must clear it for the portfolio to hold up.
    const start = fmtMoney(result.current);
    const end = fmtMoney(result.finalReal);
    const gap = fmtMoney(Math.abs(result.finalReal - result.current));
    $('targetIntro').textContent = (result.reached ? t('goalStableReached') : t('goalStableShort'))
      .replace('{start}', start).replace('{end}', end).replace('{gap}', gap)
      .replace('{years}', params.maxRetirementYears);
  } else {
    const projected = fmtMoney(result.current);
    const target = fmtMoney(result.target);
    const gap = fmtMoney(Math.abs(result.current - result.target));
    $('targetIntro').textContent = (result.reached ? t('targetIntroReached') : t('targetIntroShort'))
      .replace('{projected}', projected).replace('{target}', target).replace('{gap}', gap);
  }

  const rows = targetLeverMeta().map((meta) => {
    const lever = result.levers[meta.key];
    const needed = lever.status === 'ok' ? meta.fmt(lever.needed) : '–';
    return `<tr>
      <td>${meta.label}</td>
      <td>${meta.fmt(lever.current)}</td>
      <td>${needed}</td>
      <td>${targetChangeCell(meta, lever)}</td>
    </tr>`;
  }).join('');

  $('targetTable').innerHTML = `
    <thead><tr>
      <th>${t('targetLever')}</th>
      <th>${t('targetCurrent')}</th>
      <th>${t('targetNeeded')}</th>
      <th>${t('targetChange')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

// --------------------------------------------------------------------- i18n --

function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  $('langToggle').textContent = t('languageToggle');
}

function setLanguage(next) {
  lang = next;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* blocked */ }
  applyI18n();
  recalc();
}

// --------------------------------------------------------------------- main --

function recalc() {
  const params = readParams();
  const displayReal = $('displayReal').checked;
  updateAllocationUI(params);
  updateGoalUI(params);
  const scenarios = simulateScenarios(params);
  renderChart(scenarios, params, displayReal);
  renderAssetChart(scenarios, params, displayReal);
  renderSummary(scenarios, params, displayReal);
  renderTarget(params);
  renderWithdrawalBreakdown(scenarios, params, displayReal);
  renderPerAsset(scenarios, params, displayReal);
  renderPie(scenarios, params, displayReal);
  renderAllocationPie(scenarios, params, displayReal);
}

function init() {
  if (!restore()) setFormValues(DEFAULT_PARAMS, { displayReal: false });
  applyI18n();
  recalc();

  $('inputs').addEventListener('input', () => {
    recalc();
    persist();
  });

  $('saveInputs').addEventListener('change', () => {
    if ($('saveInputs').checked) persist();
    else {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* blocked */ }
    }
  });

  $('resetDefaults').addEventListener('click', () => {
    setFormValues(DEFAULT_PARAMS, { displayReal: false });
    recalc();
    persist();
  });

  $('exportInputs').addEventListener('click', exportInputs);
  $('importInputs').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', () => {
    const file = $('importFile').files[0];
    if (file) importInputs(file);
    $('importFile').value = ''; // allow re-importing the same file
  });

  $('logScale').addEventListener('change', recalc);

  $('langToggle').addEventListener('click', () => setLanguage(lang === 'de' ? 'en' : 'de'));
}

init();

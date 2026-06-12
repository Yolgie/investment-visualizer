/* DOM wiring: reads inputs, runs the simulation, renders chart + summary,
 * handles i18n and the opt-in localStorage persistence. */

/* global I18N, DEFAULT_PARAMS, simulateScenarios */

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

// ---------------------------------------------------------------- form I/O --

function setFormValues(params, ui) {
  $('startingAmount').value = params.startingAmount;
  $('startingCostBasis').value = params.startingCostBasis;
  $('monthlyContribution').value = params.monthlyContribution;
  $('contributionIncreaseValue').value = params.contributionIncrease.value;
  $('contributionIncreaseUnit').value = params.contributionIncrease.unit;
  $('yearsToRetirement').value = params.yearsToRetirement;
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
    for (const input of row.querySelectorAll('input')) {
      input.value = asset[input.dataset.field];
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

  const sum = params.assets.reduce((s, a) => s + a.allocation, 0);
  const lateSum = params.assets.reduce((s, a) => s + a.allocationLate, 0);
  const sumEl = $('allocationSum');
  const lateSumEl = $('allocationLateSum');
  sumEl.textContent = `${sum} %`;
  lateSumEl.textContent = `${lateSum} %`;
  const bad = Math.abs(sum - 100) > 0.01;
  const lateBad = lateVisible && Math.abs(lateSum - 100) > 0.01;
  sumEl.classList.toggle('sum-bad', bad);
  lateSumEl.classList.toggle('sum-bad', lateBad);
  $('allocationWarning').classList.toggle('hidden', !(bad || lateBad));
}

// -------------------------------------------------------------------- chart --

let chart = null;

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

function renderChart(scenarios, params, displayReal) {
  const { avg, min, max } = scenarios;
  const infl = params.inflation;

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
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => fmtMoney(v) },
      },
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
    card(t('summaryKestPaid'), fmtMoney(avg.summary.kestOnSales)),
    card(
      t('summaryLasts'),
      lastsText(avg.summary, params),
      `${lastsText(min.summary, params)} | ${lastsText(max.summary, params)}`,
    ),
  ];
  $('summary').innerHTML = cards.join('');
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
  const scenarios = simulateScenarios(params);
  renderChart(scenarios, params, displayReal);
  renderSummary(scenarios, params, displayReal);
  renderPerAsset(scenarios, params, displayReal);
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

  $('langToggle').addEventListener('click', () => setLanguage(lang === 'de' ? 'en' : 'de'));
}

init();

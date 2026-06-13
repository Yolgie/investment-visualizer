/*
 * End-to-end scenario tests. Where smoke.js only checks the page boots and the
 * charts render, this drives full user journeys in a real Chromium and asserts
 * on the rendered output: language toggle, opt-in persistence, export/import
 * round-trip, reset, the allocation switch + warning, the nominal/real and
 * log-scale toggles, the goal-seek table, and a dividend-funded drawdown.
 *
 * Each scenario runs in its own browser context so localStorage is isolated.
 * Run via `mise run e2e` (installs Playwright + Chromium on demand, like
 * `mise run verify`). Exits non-zero on any failure.
 */

'use strict';

const { startServer } = require('./server.js');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run `mise run e2e` (it installs it on demand).');
  process.exit(2);
}

// ------------------------------------------------------------------ helpers --

// Money is rendered with maximumFractionDigits: 0, so there are no decimals —
// stripping every non-digit (keeping a leading minus) yields the euro integer.
function parseMoney(text) {
  if (text == null) return NaN;
  const neg = /-/.test(text);
  const digits = text.replace(/[^\d]/g, '');
  return (neg ? -1 : 1) * Number(digits);
}

// renderSummary() emits the cards in this fixed order; address them by key.
const CARD_INDEX = {
  summaryAtRetirement: 0,
  summaryNetIfSold: 1,
  summaryContributions: 2,
  summaryGrowth: 3,
  summaryDividends: 4,
  summaryDividendsPerYear: 5,
  summaryKestPaid: 6,
  summaryLasts: 7,
};

function cardValue(page, key) {
  return page.locator('#summary .card').nth(CARD_INDEX[key]).locator('.value').textContent();
}

// Set a per-asset table cell (data-field) for the row with the given data-asset.
// The allocation table lives in the collapsible portfolio <details>, so open it
// first — page.fill() would otherwise wait on a hidden input.
async function setAssetField(page, asset, field, value) {
  await page.evaluate(() => { document.getElementById('portfolioSection').open = true; });
  await page.fill(`#allocationTable tr[data-asset="${asset}"] input[data-field="${field}"]`, String(value));
}

// y-axis scale type of a rendered chart ("linear" | "logarithmic").
function yScaleType(page, canvasId) {
  return page.evaluate((id) => window.Chart.getChart(document.getElementById(id)).options.scales.y.type, canvasId);
}

// Drive a fresh, isolated page; returns { page, jsErrors, close }.
async function freshPage(browser, url) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.Chart && !!window.Chart.getChart(document.getElementById('chart')));
  return { page, jsErrors, close: () => context.close() };
}

// ---------------------------------------------------------------- scenarios --

const scenarios = [
  // 1. Default projection renders a coherent, internally consistent summary.
  async ({ page }, expect) => {
    const atRetirement = parseMoney(await cardValue(page, 'summaryAtRetirement'));
    const paidIn = parseMoney(await cardValue(page, 'summaryContributions'));
    const growth = parseMoney(await cardValue(page, 'summaryGrowth'));
    expect('default: positive growth at retirement', growth > 0, `growth=${growth}`);
    expect('default: value ≈ paid-in + growth', Math.abs(atRetirement - (paidIn + growth)) <= 2,
      `${atRetirement} vs ${paidIn}+${growth}`);
    expect('default: per-asset table has all four assets',
      (await page.locator('#perAssetTable tbody tr').count()) === 4);
    expect('default: target intro is populated',
      (await page.locator('#targetIntro').textContent()).length > 0);
    expect('default: both pies have non-zero data', await page.evaluate(() => {
      const sum = (id) => window.Chart.getChart(document.getElementById(id))
        .data.datasets[0].data.reduce((s, v) => s + v, 0);
      return sum('pieChart') > 0 && sum('allocationPie') > 0;
    }));
  },

  // 2. Language toggle flips every label and persists across a reload.
  async ({ page }, expect) => {
    expect('lang: starts in English', (await page.getAttribute('html', 'lang')) === 'en');
    await page.click('#langToggle');
    expect('lang: html lang -> de', (await page.getAttribute('html', 'lang')) === 'de');
    expect('lang: heading translated', (await page.locator('h2[data-i18n="savingsPhase"]').textContent()) === 'Ansparphase');
    expect('lang: document title translated', (await page.title()) === 'Spar- & Pensionsrechner');
    expect('lang: toggle button shows the other language', (await page.locator('#langToggle').textContent()) === 'EN');
    await page.reload({ waitUntil: 'networkidle' });
    expect('lang: persists across reload', (await page.getAttribute('html', 'lang')) === 'de');
  },

  // 3. Opt-in persistence: nothing is stored until the box is checked; unchecking clears it.
  async ({ page }, expect) => {
    await page.fill('#monthlyContribution', '999');
    await page.reload({ waitUntil: 'networkidle' });
    expect('persist: not saved while opt-out', (await page.inputValue('#monthlyContribution')) === '500');
    expect('persist: opt-out box stays unchecked', !(await page.isChecked('#saveInputs')));

    await page.check('#saveInputs');
    await page.fill('#monthlyContribution', '888');
    await page.reload({ waitUntil: 'networkidle' });
    expect('persist: saved value restored', (await page.inputValue('#monthlyContribution')) === '888');
    expect('persist: opt-in box restored as checked', await page.isChecked('#saveInputs'));

    await page.uncheck('#saveInputs');
    await page.reload({ waitUntil: 'networkidle' });
    expect('persist: unchecking clears storage', (await page.inputValue('#monthlyContribution')) === '500');
  },

  // 4. Export → reset → import round-trips the inputs through a JSON file.
  async ({ page }, expect) => {
    await page.fill('#startingAmount', '54321');
    await page.fill('#monthlyWithdrawal', '1234');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportInputs'),
    ]);
    const fs = require('fs');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect('export: app + version stamp', exported.app === 'retirement-calc' && exported.version === 1,
      JSON.stringify({ app: exported.app, version: exported.version }));
    expect('export: captures changed inputs',
      exported.params.startingAmount === 54321 && exported.params.monthlyWithdrawal === 1234);

    await page.click('#resetDefaults');
    expect('reset clears the change before import', (await page.inputValue('#startingAmount')) === '10000');

    await page.setInputFiles('#importFile', await download.path());
    await page.waitForFunction(() => document.getElementById('startingAmount').value === '54321');
    expect('import: restores starting amount', (await page.inputValue('#startingAmount')) === '54321');
    expect('import: restores withdrawal', (await page.inputValue('#monthlyWithdrawal')) === '1234');
  },

  // 5. Reset to defaults restores the documented DEFAULT_PARAMS.
  async ({ page }, expect) => {
    await page.fill('#startingAmount', '1');
    await page.fill('#monthlyContribution', '1');
    await page.fill('#yearsToRetirement', '5');
    await page.click('#resetDefaults');
    expect('reset: startingAmount', (await page.inputValue('#startingAmount')) === '10000');
    expect('reset: monthlyContribution', (await page.inputValue('#monthlyContribution')) === '500');
    expect('reset: yearsToRetirement', (await page.inputValue('#yearsToRetirement')) === '30');
  },

  // 6. The allocation switch reveals the late-allocation column and its year label.
  async ({ page }, expect) => {
    await page.evaluate(() => { document.getElementById('portfolioSection').open = true; });
    expect('switch: late column hidden by default', await page.locator('th.late-col').first().isHidden());
    await page.check('#allocationSwitchEnabled');
    expect('switch: late column shown when enabled', await page.locator('th.late-col').first().isVisible());
    expect('switch: year row shown', await page.locator('#allocationSwitchYearRow').isVisible());
    await page.fill('#allocationSwitchYear', '15');
    expect('switch: column header echoes the year',
      (await page.locator('.switch-year-label').first().textContent()).trim() === '15');
  },

  // 7. The allocation warning appears when a column no longer sums to 100 %.
  async ({ page }, expect) => {
    expect('warn: hidden with valid defaults', await page.locator('#allocationWarning').isHidden());
    await setAssetField(page, 'etf', 'allocation', 0); // ETF-only default → column now sums to 0 %
    expect('warn: shown when contribution column != 100', await page.locator('#allocationWarning').isVisible());
    expect('warn: sum cell flagged', await page.locator('#allocationSum').evaluate((el) => el.classList.contains('sum-bad')));
    expect('warn: sum cell shows 0 %', (await page.locator('#allocationSum').textContent()).trim() === '0 %');
    expect('warn: message names the contribution column',
      (await page.locator('#allocationWarning').textContent()).includes('Contribution'));
    await setAssetField(page, 'etf', 'allocation', 100);
    expect('warn: hidden again once fixed', await page.locator('#allocationWarning').isHidden());
  },

  // 8. The nominal/real toggle deflates the displayed figures.
  async ({ page }, expect) => {
    const nominalGrowth = parseMoney(await cardValue(page, 'summaryGrowth'));
    await page.locator('#parametersSection').evaluate((d) => { d.open = true; });
    await page.check('#displayReal');
    const realGrowth = parseMoney(await cardValue(page, 'summaryGrowth'));
    expect('real: deflated growth is smaller', realGrowth < nominalGrowth && realGrowth > 0,
      `real=${realGrowth} nominal=${nominalGrowth}`);
    await page.uncheck('#displayReal');
    expect('real: toggling back restores the nominal figure',
      parseMoney(await cardValue(page, 'summaryGrowth')) === nominalGrowth);
  },

  // 9. The log-scale checkbox switches the main chart's y-axis type.
  async ({ page }, expect) => {
    expect('log: linear by default', (await yScaleType(page, 'chart')) === 'linear');
    await page.check('#logScale');
    expect('log: logarithmic when checked', (await yScaleType(page, 'chart')) === 'logarithmic');
    await page.uncheck('#logScale');
    expect('log: linear again when unchecked', (await yScaleType(page, 'chart')) === 'linear');
  },

  // 10. Goal-seek: an out-of-reach target asks the levers to rise; a trivial one is already met.
  async ({ page }, expect) => {
    await page.fill('#targetAmount', '100000000');
    let intro = await page.locator('#targetIntro').textContent();
    expect('goal: huge target reads as below goal', intro.includes('below the goal'), intro);
    const contribRow = page.locator('#targetTable tbody tr').first();
    expect('goal: a lever shows an upward change', (await contribRow.locator('td').last().textContent()).includes('↑'));

    await page.fill('#targetAmount', '1');
    intro = await page.locator('#targetIntro').textContent();
    expect('goal: tiny target reads as reached', intro.includes('above the goal'), intro);
    expect('goal: contribution lever flagged not-reachable-alone',
      (await contribRow.locator('td').last().textContent()).includes('not reachable with this lever alone'));
  },

  // 11. A dividend-funded drawdown never sells: the portfolio keeps growing.
  async ({ page }, expect) => {
    await page.fill('#startingAmount', '1000000');
    await page.fill('#startingCostBasis', '1000000');
    await page.fill('#monthlyContribution', '0');
    await page.fill('#yearsToRetirement', '1');
    await page.fill('#monthlyWithdrawal', '2000');
    for (const asset of ['etf', 'bonds', 'stocks', 'dividendStocks']) {
      await setAssetField(page, asset, 'annualReturn', 0);
      await setAssetField(page, asset, 'dividendYield', 12);
    }
    expect('drawdown: "money lasts" card shows the growth icon',
      (await page.locator('#summary .grow-icon').count()) === 1);
    const lasts = await cardValue(page, 'summaryLasts');
    expect('drawdown: lasts the whole simulation', lasts.includes('longer than the simulated'), lasts);

    const sources = await page.locator('#withdrawalTable tbody tr td:first-child').allTextContents();
    expect('drawdown: dividends fund the withdrawal', sources.some((s) => s.includes('Dividends')), sources.join('|'));
    expect('drawdown: nothing is sold', !sources.some((s) => s.includes('Sale of')), sources.join('|'));
  },

  // 12. Importing a non-calculator file is rejected with an alert, nothing changes.
  async ({ page }, expect) => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const badFile = path.join(os.tmpdir(), 'e2e-not-a-calc-export.json');
    fs.writeFileSync(badFile, JSON.stringify({ hello: 'world' })); // valid JSON, wrong shape

    const before = await page.inputValue('#startingAmount');
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog'),
      page.setInputFiles('#importFile', badFile),
    ]);
    expect('import-error: shows an alert', dialog.message().length > 0, dialog.message());
    await dialog.dismiss();
    expect('import-error: inputs left unchanged', (await page.inputValue('#startingAmount')) === before);
  },

  // 13. Export/import round-trips the displayReal (nominal/real) view flag.
  async ({ page }, expect) => {
    const fs = require('fs');
    await page.locator('#parametersSection').evaluate((d) => { d.open = true; });
    await page.check('#displayReal');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportInputs'),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect('view: export captures displayReal', exported.displayReal === true);

    await page.click('#resetDefaults');
    expect('view: reset clears displayReal', !(await page.isChecked('#displayReal')));

    await page.setInputFiles('#importFile', await download.path());
    await page.waitForFunction(() => document.getElementById('displayReal').checked === true);
    expect('view: import restores displayReal', await page.isChecked('#displayReal'));
  },

  // 14. Stable-value goal: switching modes hides the amount input, shows the
  //     stable hint, and reframes the intro around real-value erosion/preservation.
  async ({ page }, expect) => {
    expect('stable: amount input visible in amount mode', await page.isVisible('#targetAmountRow'));
    expect('stable: stable hint hidden in amount mode', !(await page.isVisible('#goalStableHint')));

    await page.selectOption('#goalType', 'stableValue');
    expect('stable: amount input hidden in stable mode', !(await page.isVisible('#targetAmountRow')));
    expect('stable: stable hint shown in stable mode', await page.isVisible('#goalStableHint'));

    // Defaults (modest pot, €2000/mo) erode the real value over the drawdown.
    const intro = await page.locator('#targetIntro').textContent();
    expect('stable: intro reframed around real value', intro.includes('Real value'), intro);
    expect('stable: intro mentions the drawdown horizon', intro.includes('drawdown'), intro);
    const contribRow = page.locator('#targetTable tbody tr').first();
    expect('stable: a lever shows an upward change',
      (await contribRow.locator('td').last().textContent()).includes('↑'));

    // A huge pot with a tiny withdrawal already holds its value.
    await page.fill('#startingAmount', '5000000');
    await page.fill('#startingCostBasis', '5000000');
    await page.fill('#monthlyWithdrawal', '500');
    const reached = await page.locator('#targetIntro').textContent();
    expect('stable: rich setup holds its real value', reached.includes('Real value holds up'), reached);
  },

  // 15. Monte Carlo: the on-demand run renders the chart, percentile cards,
  //     best/worst callouts and the percentile goal-seek; the log toggle redraws it.
  async ({ page }, expect) => {
    await page.locator('#parametersSection').evaluate((d) => { d.open = true; });
    await page.fill('#monteCarloRuns', '60');
    expect('mc: results hidden before running', await page.locator('#mcResults').isHidden());

    await page.click('#runMonteCarlo');
    await page.waitForFunction(() => window.Chart && !!window.Chart.getChart(document.getElementById('monteCarloChart')));
    expect('mc: results shown after running', await page.locator('#mcResults').isVisible());
    expect('mc: four summary cards', (await page.locator('#mcSummary .card').count()) === 4);

    const prob = await page.locator('#mcSummary .card').first().locator('.value').textContent();
    expect('mc: probability rendered as a percentage', /%/.test(prob), prob);
    expect('mc: best/worst callouts present', (await page.locator('#mcExtremes span').count()) === 2);
    expect('mc: goal table populated', (await page.locator('#mcGoalTable tbody tr').count()) > 0);

    // The goal block defaults to the 10th percentile; switching to the 90th re-solves
    // from the cached result (more optimistic, so the projected value rises).
    expect('mc: goal percentile defaults to 10th', (await page.inputValue('#mcGoalPercentile')) === '10');
    // The intro reads "Projection {projected} — …"; the segment before the em-dash
    // holds exactly the projected value, so parseMoney() of it is unambiguous.
    const projection = async () => parseMoney((await page.locator('#mcGoalIntro').textContent()).split('—')[0]);
    const projP10 = await projection();
    await page.selectOption('#mcGoalPercentile', '90');
    expect('mc: goal table still populated after switching percentile',
      (await page.locator('#mcGoalTable tbody tr').count()) > 0);
    const projP90 = await projection();
    expect('mc: 90th-percentile projection exceeds the 10th', projP90 > projP10, `${projP90} vs ${projP10}`);

    // The log-scale toggle redraws the cached MC chart without re-running it.
    await page.check('#logScale');
    expect('mc: log scale applies to the MC chart', (await yScaleType(page, 'monteCarloChart')) === 'logarithmic');
  },

  // 16. Per-asset volatility survives an export → reset → import round-trip.
  async ({ page }, expect) => {
    const fs = require('fs');
    const volSel = '#allocationTable tr[data-asset="etf"] input[data-field="volatility"]';
    await setAssetField(page, 'etf', 'volatility', 23);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportInputs'),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    const etf = exported.params.assets.find((a) => a.id === 'etf');
    expect('vol: export captures volatility', etf.volatility === 23, JSON.stringify(etf));

    await page.click('#resetDefaults');
    expect('vol: reset restores default volatility', (await page.inputValue(volSel)) === '15');

    await page.setInputFiles('#importFile', await download.path());
    await page.waitForFunction(() => document.querySelector('#allocationTable tr[data-asset="etf"] input[data-field="volatility"]').value === '23');
    expect('vol: import restores volatility', (await page.inputValue(volSel)) === '23');
  },
];

// -------------------------------------------------------------------- runner --

(async () => {
  const server = await startServer();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  const failures = [];
  let ran = 0;
  const browser = await chromium.launch();

  for (const [i, scenario] of scenarios.entries()) {
    const name = `scenario ${i + 1}`;
    const expect = (label, ok, detail) => {
      ran++;
      if (ok) console.log(`  ok  ${label}`);
      else { failures.push(label); console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
    };
    const ctx = await freshPage(browser, url);
    try {
      await scenario(ctx, expect, url);
      expect(`${name}: no JS errors`, ctx.jsErrors.length === 0, ctx.jsErrors.join('; '));
    } catch (err) {
      failures.push(name);
      console.error(`FAIL  ${name} — threw: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  server.close();

  console.log(`\n${ran} checks, ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();

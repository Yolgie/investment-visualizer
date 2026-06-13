/*
 * Headless-browser smoke test. Serves the static site and drives it with a real
 * Chromium to catch what the unit tests can't: JS errors on load, charts that
 * fail to render, missing summary/table output.
 *
 * Run via `mise run verify` (installs Playwright + Chromium on demand). Requires
 * the `playwright` package — the mise task installs it with `npm install --no-save`
 * so it never lands in package.json / CI. Exits non-zero on any failure and
 * writes a full-page screenshot to $SMOKE_SCREENSHOT (default /tmp).
 */

'use strict';

const { startServer } = require('./server.js');

const SCREENSHOT = process.env.SMOKE_SCREENSHOT || '/tmp/retirement-calc-smoke.png';

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run `mise run verify` (it installs it on demand).');
  process.exit(2);
}

(async () => {
  const server = await startServer();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  const failures = [];
  const expect = (name, ok, detail) => {
    if (ok) console.log(`  ok  ${name}`);
    else { failures.push(name); console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(`console: ${m.text()}`); });

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    expect('page title is set', (await page.title()).length > 0);

    const canvases = await page.evaluate(() => {
      const ids = ['chart', 'assetChart', 'pieChart', 'allocationPie'];
      if (!window.Chart) return null;
      return ids.map((id) => {
        const c = document.getElementById(id);
        return { id, ok: !!c && c.width > 0 && !!window.Chart.getChart(c) };
      });
    });
    expect('window.Chart is available', canvases !== null);
    for (const c of canvases || []) expect(`chart "${c.id}" rendered`, c.ok);

    expect('summary cards present', (await page.locator('#summary .card').count()) > 0);
    expect('target table populated', (await page.locator('#targetTable tbody tr').count()) > 0);
    expect('per-asset table populated', (await page.locator('#perAssetTable tbody tr').count()) > 0);
    expect('withdrawal breakdown populated', (await page.locator('#withdrawalTable tbody tr').count()) > 0);

    // A change to inputs must recompute without throwing.
    await page.fill('#monthlyContribution', '750');
    await page.waitForTimeout(100);

    expect('no JS errors on load/interaction', jsErrors.length === 0, jsErrors.join('; '));

    await page.screenshot({ path: SCREENSHOT, fullPage: true });
    console.log(`\nScreenshot: ${SCREENSHOT}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();

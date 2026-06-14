# Savings & Retirement Calculator (Austria) 🇦🇹

A tiny, browser-only investment visualization and retirement calculator with a
simplified **Austrian tax model (KESt)**. No backend, no build step — just static
files, ready for GitHub Pages.

**Features**

- Accumulation phase: starting amount (with separate cost basis), monthly
  contributions, optional annual contribution increase (% or €)
- Portfolio split across asset classes (ETFs, bonds, stocks, dividend stocks),
  each with its own price return, dividend yield and TER, and three separate
  allocations: current holdings (starting amount), current contributions, and
  an optional future contribution split from year X
- Dividends mechanic: distributions are taxed immediately at KESt and can be
  reinvested during accumulation; in retirement they cover the withdrawal
  before anything is sold. The chart tooltip shows net dividends per year,
  and the summary shows the annual dividend income at retirement
- Composition pie chart at retirement (paid-in capital vs. growth, with
  percentage labels); pre-existing gains in the starting amount count as growth
- Withdrawal breakdown for the first retirement year: dividends and sales per
  asset, each with gross / KESt / net
- A growth icon on the "money lasts" card when the portfolio keeps growing
  despite the withdrawals
- Optional allocation switch: redirect new contributions to a second split
  from year X (e.g. more dividend stocks near retirement) — without selling
  existing holdings (no tax event)
- Drawdown phase: net (after-KESt) monthly withdrawal, optionally indexed to
  inflation, with correct grossing-up of sales based on the unrealized-gain share
- Withdrawal source column: choose which asset classes are sold in retirement
  (e.g. 90 % ETFs / 10 % stocks); once they run dry, the rest is sold
  proportionally
- Composition pie uses the paid-in capital: pre-existing gains in the starting
  amount count as growth, not as paid-in money
- Min / average / max return scenarios (configurable ± spread) shown as a band
- **Monte Carlo volatility simulation** (on-demand): a per-asset annual return
  volatility drives a configurable number of runs (default 1000) with random
  monthly returns (lognormal, so factors stay positive and outcomes are
  realistically right-skewed), drawn as a spaghetti chart with nested 5/95, 10/90
  and 25/75 percentile bands plus mean and median lines. Reports the probability
  the money lasts, p10/p50/p90 of the value at retirement, and the best/worst run.
  A separate compact goal-seek block answers "how far would each lever (incl. the
  sustainable withdrawal) have to move to still hit the goal on a given run?" — the
  run is selectable by percentile (5th…95th) from a dropdown.
- Nominal vs. real (today's purchasing power) display toggle
- German / English language toggle
- Second chart with the portfolio value stacked by asset class over time
- **Opt-in** persistence: inputs are only stored in your browser's localStorage
  if you check the box — nothing ever leaves your machine
- Export / import of all inputs as a JSON file (for sharing or backup)

> ⚠️ **Disclaimer:** This is a simplified model for visualization purposes —
> not tax or investment advice. The annual taxation of accumulating funds
> (*ausschüttungsgleiche Erträge*) can **optionally** be included via a
> parameter, using a per-asset estimate of the internally earned income.

## Run locally

```sh
python3 -m http.server   # then open http://localhost:8000
```

Chart.js is vendored in `vendor/` (copied from the npm package), so the site
is fully offline-capable — opening `index.html` directly works without a
network connection.

## Tests & lint

```sh
npm ci             # dev tooling only — the site itself has no build step
npm test           # unit tests for the simulation math (node test.js)
npm run test:coverage  # same tests under a 100% coverage gate on calculator.js (c8)
npm run typecheck  # tsc --checkJs over calculator.js (static analysis, no build/emit)
npm run lint       # eslint (needs Node >= 20)
mise run verify  # headless-browser smoke test (loads the page, checks the
                 # charts render and there are no JS errors; see test/smoke.js)
mise run e2e     # end-to-end browser scenarios: language toggle, opt-in
                 # persistence, export/import round-trip, reset, allocation
                 # switch + warning, nominal/real and log-scale toggles,
                 # goal-seek table, dividend-funded drawdown (see test/e2e.js)
```

The browser tests need Playwright + Chromium. `mise run verify` / `mise run e2e`
install them on demand, and the `setup` task — run automatically on `mise install`
via a `postinstall` hook — provisions them at container startup. `mise run setup`
is idempotent, so it's safe to re-run.

`calculator.js` (the pure simulation math) is held at **100% coverage** by
`test.js`; `npm run test:coverage` enforces it via [c8](https://github.com/bcoe/c8)
(config in `.c8rc.json`) and CI fails below the bar. It is also **type-checked**
with `tsc --checkJs` (`npm run typecheck`, config in `tsconfig.json`) — the site
still ships plain JS with no build step; the JSDoc typedefs at the top of
`calculator.js` are the authoritative param/result shapes. The DOM layer
(`app.js`, `i18n.js`) is covered behaviorally by the smoke/e2e suites rather than
by the coverage gate or the type-checker, so neither includes it.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Build and deployment**: choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Done — no build step required.

## Configurable model parameters

Everything is editable on the page: KESt rate (default 27.5 %), inflation,
per-asset returns / dividend yields / TER / volatility, scenario spread, number
of Monte Carlo runs, simulated retirement duration.

Default per-asset volatilities (annual standard deviation of returns) are ETFs
15 %, bonds 5 %, stocks 20 %, dividend stocks 14 % — roughly historical
annualized figures, all editable. `volatility` and `monteCarloRuns` were added
non-breakingly (defaults in `withDefaults()` and `setFormValues()`), so existing
saved/exported files keep loading and the storage version stays `1`.

## Updating Chart.js

Chart.js comes from npm and is committed as a static copy in `vendor/`.
Dependabot opens PRs for new versions; after a bump, run

```sh
npm ci && npm run sync-vendor
```

and commit the result. CI fails if `vendor/` is out of sync with the
installed npm version.

## Data format & compatibility

Inputs are persisted (opt-in localStorage) and exported/imported as JSON with a
versioned shape:

```json
{ "app": "retirement-calc", "version": 1, "params": { … }, "displayReal": false }
```

- **localStorage key:** `retirement-calc-v1` (language is stored separately under
  `retirement-calc-lang` and is not gated by the opt-in).
- **`params`** mirrors the object `calculator.simulate()` consumes — see
  `DEFAULT_PARAMS` in `calculator.js` for the authoritative shape.
- **Backwards compatibility is a contract:** older saved/exported files must keep
  loading. New fields are added *non-breakingly* by giving them defaults in two
  places — `withDefaults()` (`calculator.js`) for the math and the form loader in
  `setFormValues()` (`app.js`) for the UI. This is how `allocationStart` and
  `withdrawalShare` were added without breaking existing data.
- **If you ever make a breaking change** to `params` (rename/repurpose a field,
  change units), bump the storage key to `-v2` and the export `version`, and add
  a migration that upgrades old objects — otherwise old files load silently wrong.

## Future ideas

- [x] *Ausschüttungsgleiche Erträge*: optional annual taxation of accumulating
      funds with cost-basis step-up. A master toggle in the Parameters section
      reveals a per-asset deemed-income rate (% p.a.) in the portfolio table; the
      yearly KESt is deducted from the position and the gross income steps up the
      cost basis. Off by default (projection unchanged).
- [x] Monte Carlo volatility simulation: configurable volatility % and number of
      runs, percentile bands, probability the money lasts. `simulate()` takes an
      optional `{ rng }` so each month's per-asset growth factor is drawn from a
      lognormal (mean-preserving: `E[return]` matches the entered rate while the
      median path shows realistic volatility drag); `simulateMonteCarlo()`
      aggregates the runs into percentile bands. The percentile goal-seek reuses
      the deterministic solver via an *equivalent return shift* (the constant shift
      that reproduces a percentile's value at retirement) — an approximation
      calibrated at the current inputs, labeled as such in the UI, rather than
      re-running the Monte Carlo inside every bisection step (which would be far too
      slow in the browser).
- [ ] Rebalancing mechanics at retirement: periodically sell/buy to restore a
      target allocation once drawdown starts (note: rebalancing realizes gains,
      so it triggers KESt — the model would need to account for that), and/or a
      glide path that shifts toward bonds approaching retirement. Currently the
      portfolio keeps its allocation untouched; only new contributions can be
      redirected (via the allocation switch) and the withdrawal-source column
      controls which assets are sold down first.
- [ ] Custom / additional asset rows
- [ ] State pension as income offset during drawdown
- [ ] Multiple saved scenarios side by side

## License

[MIT](LICENSE)

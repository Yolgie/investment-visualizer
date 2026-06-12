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
- Nominal vs. real (today's purchasing power) display toggle
- German / English language toggle
- Second chart with the portfolio value stacked by asset class over time
- **Opt-in** persistence: inputs are only stored in your browser's localStorage
  if you check the box — nothing ever leaves your machine
- Export / import of all inputs as a JSON file (for sharing or backup)

> ⚠️ **Disclaimer:** This is a simplified model for visualization purposes —
> not tax or investment advice. In particular, the annual taxation of
> accumulating funds (*ausschüttungsgleiche Erträge*) is **not** modeled.

## Run locally

```sh
python3 -m http.server   # then open http://localhost:8000
```

Chart.js is vendored in `vendor/` (copied from the npm package), so the site
is fully offline-capable — opening `index.html` directly works without a
network connection.

## Tests & lint

```sh
npm ci        # dev tooling only — the site itself has no build step
npm test      # unit tests for the simulation math (node test.js)
npm run lint  # eslint (needs Node >= 20)
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Build and deployment**: choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Done — no build step required.

## Configurable model parameters

Everything is editable on the page: KESt rate (default 27.5 %), inflation,
per-asset returns / dividend yields / TER, scenario spread, simulated
retirement duration.

## Updating Chart.js

Chart.js comes from npm and is committed as a static copy in `vendor/`.
Dependabot opens PRs for new versions; after a bump, run

```sh
npm ci && npm run sync-vendor
```

and commit the result. CI fails if `vendor/` is out of sync with the
installed npm version.

## Future ideas

- [ ] *Ausschüttungsgleiche Erträge*: annual taxation of accumulating ETFs with
      cost-basis step-up (the big missing piece of the Austrian tax model)
- [ ] Monte Carlo volatility simulation: configurable volatility % and number of
      runs, percentile bands, probability the money lasts. The single-run
      simulation core is already shaped to accept a per-month return sequence.
- [ ] Rebalancing / glide path toward bonds approaching retirement
      (currently the portfolio keeps its allocation; only new contributions
      can be redirected)
- [ ] Custom / additional asset rows
- [ ] State pension as income offset during drawdown
- [ ] Multiple saved scenarios side by side

## License

[MIT](LICENSE)

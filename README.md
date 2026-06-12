# Savings & Retirement Calculator (Austria) 🇦🇹

A tiny, browser-only investment visualization and retirement calculator with a
simplified **Austrian tax model (KESt)**. No backend, no build step — just static
files, ready for GitHub Pages.

**Features**

- Accumulation phase: starting amount (with separate cost basis), monthly
  contributions, optional annual contribution increase (% or €)
- Portfolio split across asset classes (ETFs, bonds, stocks, dividend stocks),
  each with its own allocation, price return, dividend yield and TER
- Dividends mechanic: distributions are taxed immediately at KESt and can be
  reinvested during accumulation; in retirement they cover the withdrawal
  before anything is sold
- Optional allocation switch: redirect new contributions to a second split
  from year X (e.g. more dividend stocks near retirement) — without selling
  existing holdings (no tax event)
- Drawdown phase: net (after-KESt) monthly withdrawal, optionally indexed to
  inflation, with correct grossing-up of sales based on the unrealized-gain share
- Min / average / max return scenarios (configurable ± spread) shown as a band
- Nominal vs. real (today's purchasing power) display toggle
- German / English language toggle
- **Opt-in** persistence: inputs are only stored in your browser's localStorage
  if you check the box — nothing ever leaves your machine

> ⚠️ **Disclaimer:** This is a simplified model for visualization purposes —
> not tax or investment advice. In particular, the annual taxation of
> accumulating funds (*ausschüttungsgleiche Erträge*) is **not** modeled.

## Run locally

```sh
python3 -m http.server   # then open http://localhost:8000
```

(Opening `index.html` directly also works; Chart.js is loaded from a CDN, so
you need to be online.)

## Tests & lint

```sh
npm ci        # dev tooling only — the site itself has no build step
npm test      # unit tests for the simulation math (node test.js)
npm run lint  # eslint
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Build and deployment**: choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Done — no build step required.

## Configurable model parameters

Everything is editable on the page: KESt rate (default 27.5 %), inflation,
per-asset returns / dividend yields / TER, scenario spread, simulated
retirement duration. Chart.js is pinned to a fixed version via CDN URL in
`index.html` — bumping it is a manual edit (Dependabot only covers the npm dev
dependencies and GitHub Actions).

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

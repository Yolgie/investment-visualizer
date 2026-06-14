# Negative contribution / withdrawal handling — notes & TODO

Status: **not started** — design spitballing needed before implementation.

## The question

How are negative values in the monthly **contribution** and monthly **withdrawal**
treated? Does a negative contribution sell something, and does a negative
withdrawal buy something (rebalancing)?

## Current behaviour (as of this writing)

Negatives are reachable: the `min="0"` on the inputs (`index.html`) is only a
browser-spinner hint. `num()` (`app.js:76`) does **not** clamp, so a typed-in
negative value flows straight into `simulate()`.

The two directions are **not symmetric**, and neither models a real sale or a
rebalance:

### Negative monthly contribution (accumulation phase)

`calculator.js:402-406`:
```js
buckets.forEach((b, i) => {
  b.value += contribution * weights[i];
  b.basis += contribution * weights[i];
});
```

- Subtracts money split by **`weights` = the contribution allocation**
  (`allocation` / `allocationLate`), *not* by current holdings.
- **Reduces `basis` alongside `value`.** No KESt, no gain calculation — the
  tax-aware sale logic (`gainFrac`, KESt) only exists in the drawdown loop. This
  is a "raw" cash deduction, not a sale.
- Can drive a bucket **negative** if its allocation weight exceeds its balance
  (nothing floors it at 0 here).

→ Does **not** sell anything in any tax/rebalance-meaningful sense.

### Negative monthly withdrawal (drawdown phase)

`calculator.js:462-466`:
```js
let needNet = target - netDividends;
if (needNet < 0) {
  reinvest(-needNet); // surplus dividends flow back into the portfolio
  needNet = 0;
}
```

- A negative `target` makes `needNet` negative, hitting the existing
  "surplus dividends" branch → `reinvest(-needNet)`.
- `reinvest` (`calculator.js:379-387`) adds **proportionally to current bucket
  value** and **raises basis** (treats it as fresh, already-taxed capital).

→ A negative withdrawal **does** effectively buy / add to the portfolio, like a
contribution made during retirement. But it's proportional to current value, so
it **preserves** the existing allocation — it does not rebalance toward targets.

### The asymmetry to fix

- Negative **withdrawal**: money going in → correctly **raises** basis.
- Negative **contribution**: money coming out → **lowers** basis with **no tax
  event**, and can distort allocation / go negative.

Two directions use different, ad-hoc accounting.

## Desired direction (rough, still spitballing)

Use negative values *correctly* rather than disallowing them:

1. **Negative contribution during ramp-up → trigger a real sale.**
   Route it through the tax-aware sale logic that currently only runs in the
   drawdown phase (split by `withdrawalShare`, compute `gainFrac`, withhold KESt,
   reduce basis proportionally, fall back to value-proportional selling once
   preferred buckets are dry). Effectively: "withdraw early / stop and draw down
   before retirement."

2. **Negative withdrawal during drawdown → buy with the money.**
   Roughly what `reinvest` already does, but decide intent: plain
   proportional-to-value buy (keeps allocation, current behaviour) vs. a
   rebalancing buy (steer toward target weights). Needs a decision.

### Open questions to resolve before coding

- Should the drawdown-phase sale logic be factored out so both phases share one
  "sell N net, tax-aware" helper? (Likely yes — avoids the two-accountings
  problem.)
- For the negative-withdrawal buy: keep allocation (proportional) or actually
  rebalance toward `allocation` / `allocationLate` targets?
- What does a negative contribution *mean* semantically alongside the
  `contributionIncrease` lever (which can itself eventually push contributions
  negative over the years)?
- Interaction with the goal-seek levers in `solveTargets` (ranges assume
  monotonic, mostly non-negative levers).
- Until this is built: should `num()` / `readParams` clamp at read time so the
  current half-broken negative path can't be hit by accident? (`min="0"` alone
  doesn't enforce it.)

## Relevant code

- `app.js:76` — `num()` (no clamp)
- `app.js:81-108` — `readParams()`
- `calculator.js:394-414` — accumulation loop (contribution applied here)
- `calculator.js:446-533` — drawdown loop (withdrawal + tax-aware sale logic)
- `calculator.js:379-387` — `reinvest()`

# Token Radar

[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/xabit24/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/xabit24/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

**Token Radar** is a program plus the web dashboard it writes. It reads a sealed
snapshot of every protocol DefiLlama tracks, finds the ones that still record no
token and are not a wrapped or staked product of one that trades, ranks them by
what their launch would be worth, and shows a reader how to farm each one.

Built for [make.fun's **Build the best token launch radar**](https://make.fun/c/token-radar-01)
bounty (`token-radar-01`).

## What it does

- Reads the sealed snapshot at `/input/snapshot.json` (758 protocols at or above
  $5M of TVL, 40 on the watchlist, as of 2026-11-14).
- Covers the **whole watchlist** (40/40) and adds the **early radar**: every
  pre-token protocol that passes the watchlist's own exclusion rules — no
  bridge, liquid-staking or exchange product, no versioned pool, no wrapped or
  staked product of a token that already trades — with no size ceiling, so a
  large pre-token protocol is a launch candidate too. This run: **198 ranked
  rows** (40 watchlist + 158 early).
- Ranks by **implied value**, computed only from the snapshot's own figures.
  Live-token protocols are set aside with their market caps shown, never mixed
  into the ranking.
- Gives every protocol **launch odds** — the chance it ever launches a token,
  from the snapshot alone — and an **expected value** (implied value times the
  launch odds). Chains and payment infrastructure are capped at 5%: a chain or
  a payment rail is structurally unlikely to launch a token.
- Gives every protocol a **farm plan**: seven concrete steps with what each
  costs and how long it takes, derived from the protocol's category, chains,
  TVL and age — never from a hand-written list of names — plus a netting line
  and a **verdict** (Farm / Thin / Skip) from whether the expected airdrop
  covers the farm cost at $25 an hour.
- Writes a static dashboard (`dashboard/`) that renders offline from `data.js`:
  a sortable, filterable board, a detail view for every protocol, the live-token
  comparables, the model itself, a model sandbox, and a ledger of all 758
  protocols with their status.

## The model (radar-3)

```
implied = round( tvl_usd x size multiple (by TVL) x category factor
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

- **Size multiple, fitted from the snapshot's own live-token protocols.**
  Their market-cap-to-TVL ratio falls as TVL grows: the smallest quintile's
  median is 0.888x, the largest's is 0.048x — an 18x fall — so a flat 0.25x
  overvalues the largest protocols by roughly ten times. The fitted tiers
  follow that shape, smoothed and floored so the largest protocols keep a
  0.15x multiple (the top tiers rest on only a few live comparables):

  | TVL | size multiple |
  | --- | --- |
  | under $10M | 0.40x |
  | $10M–$50M | 0.35x |
  | $50M–$200M | 0.28x |
  | $200M–$1B | 0.20x |
  | $1B and over | 0.15x |

  The largest protocol on the board, Steakhouse Financial, moves from
  $543.6M under the flat 0.25x to **$326.2M** under the fitted curve; Sentora
  Curator, the second-largest pre-token protocol ($2,757.6M TVL), enters the
  board at #2 with $313.3M.
- **Category factor** is the category's comparable multiple: the median
  market-cap-to-TVL of the protocols in that category that already trade,
  divided by the same median across all live-token protocols, clamped to
  [0.5, 2.0]. A category with fewer than 3 live comparables uses 1.0.
  The factors are recomputed from the snapshot on every run, so a future
  snapshot re-prices every category from its own live comparables.
- **Growth** is the seven-day TVL change, clamped so one wild week cannot
  decide a ranking (one protocol in this snapshot moved +4,448% in a week).
- **Maturity** is the time since the protocol was first listed — the best
  record of how long it has run with no token; an unlisted age uses 365 days.

### Launch odds and expected value

```
odds = clamp( category base x age factor x growth factor, 0.02, 0.95 )
expected value = implied value x odds
```

- **Category base** is the category's own share of live-token protocols
  (Laplace-smoothed). Risk Curators, for example, are 0.13 — only 5 of 39
  have a token — so Steakhouse and Sentora get low odds despite their size.
- **Age factor** is 1 / (1 + age_days / 365): the odds halve each year a
  protocol runs with no token.
- **Growth factor** is 1 + clamp(growth, -20, 50) / 100 x 0.5.
- Chains and payment infrastructure are capped at 5% — Lightning Network and
  Hive Protocol are structurally unlikely to launch a token, and the detail
  drawer says so. 14 of 198 rows have odds over 50%.

### Farm economics and verdicts

```
expected airdrop = (implied value x odds) x 5% / farmer count
farmer count     = clamp( round(TVL / $100,000), 100, 10,000 )
farm cost        = capital + gas + hours x $25
net              = expected airdrop - farm cost
hourly           = net / hours
verdict          = Farm  if net > 0 and hourly >= $25
                   Thin  if net > 0 and hourly < $25
                   Skip  if net <= 0
```

The 5% is the assumed share of a launch that goes to farmers; the farmer
count grows with TVL, so a large protocol's expected airdrop is split across
many more farmers. The farm cost is the capital (scaled to the protocol's
TVL), the gas for the setup, weekly and claim transactions, and the hours at
$25 an hour. This run: **140 Farm, 14 Thin, 44 Skip**. The largest protocols
are often Skip — Steakhouse, Sentora, Gauntlet and Veda all cost more to
farm than they are expected to return, because their launch odds are low and
their farmer counts are high. The best farms are the smaller, higher-odds
protocols: Bittensor dTAO (#9, odds 61%, net $349, $166/hour) and BitFi Basis
(#7, odds 21%, net $190, $138/hour).

### Does the size curve earn its place?

`scripts/validate-model.mjs` runs a leave-one-out blind test over the 119
live-token protocols: each protocol's market cap is predicted from a model
fit on all the others, category factors refit without it. Results:

| | size curve | flat 0.25x baseline |
| --- | --- | --- |
| median absolute log error | **1.4575** | 1.5811 |
| Spearman rank correlation | 0.4076 | 0.4089 |
| top-quintile error (largest TVL) | **1.7391** | 2.0515 |

The size curve beats the flat baseline on the median error and clearly on
the largest protocols, where it matters most; the rank correlation is a tie.
The absolute error is still large — a typical prediction is off by a factor
of e^1.46, about 4.3x — so the ranking is a signal, not a valuation. The
train tier medians (0.65x under $10M, 0.37x at $10M–$50M, 0.17x at
$50M–$200M, 0.04x at $200M–$1B, 0.02x at $1B and over) show the same
declining shape as the fitted tiers, which are floored and smoothed so the
top tiers are not driven to the raw medians of a handful of comparables.

No protocol name is ever special-cased: the same function scores every row.
"Records no token" means DefiLlama's index lists no market cap, no CoinGecko
id and no symbol for it — a record, not proof — and a token launch is never
guaranteed. The implied value is this entry's own estimate, never a price.

## The dashboard

`dashboard/` renders offline from `data.js` — no network, no fonts, no
images fetched. It has:

- A **KPI strip**: watchlist covered (40/40), pre-token rows scored (198),
  live-token rows set aside (24), total and median implied value, total
  expected value, and rows with launch odds over 50% (14).
- The **board**: sortable by implied value, expected value, launch odds,
  TVL, growth, name or age; filterable by search, category, chain, minimum
  TVL ($5M / $10M / $50M / $100M) and a Watchlist-only toggle. Each row shows
  its implied value, expected value, launch odds and farm verdict.
- A **detail drawer** per protocol: the model's own inputs and the recomputed
  implied value (it should match board.json), the launch odds and expected
  value, the live-token comparables, the farm plan with its netting line and
  verdict, and one-line risk notes (no token after N years, few live
  comparables, low odds, a sharp TVL fall).
- A **model sandbox**: sliders for the size-multiple scale, the growth weight
  and the maturity range that recompute the board live, so a reader can see
  how sensitive the ranking is to each term. Nothing in the sandbox changes
  board.json.
- A **ledger tab**: all 758 protocols with their status — watchlist,
  pre-token and ranked, live-token and set aside, or excluded with a reason
  (bridge, liquid staking or exchange product; versioned pool; wrapped or
  staked product of a token that already trades).
- A **live-token tab**: the 24 live-token protocols set aside, with their
  market caps and market-cap-to-TVL ratios — the comparables the category
  factors are built from.

## Run it

Node.js 22.18 or later, standard library only, no install.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's
data), `out/dashboard/` (the static page), `out/screenshots/` (the three
screenshots) and `out/dossier.json` (built with `vendor/makefun-board.ts`).
Open `out/dashboard/index.html` in a browser; it renders with no network.

The three screenshots under `screenshots/` are the board, a protocol's detail
view and a filtered view, each rendered from this dashboard in a headless
browser.

## Layout

```
main.ts                  the program: snapshot in, board + dashboard + dossier out
lib/model.ts             the radar-3 model, the board, the farm plans, the ledger
vendor/makefun-board.ts  make.fun's dossier library, byte for byte from the kit
scripts/validate-model.mjs  the leave-one-out blind test of the size curve
dashboard/               the static page: index.html, app.css, app.js
screenshots/             board, detail and filtered views
```

To validate the model against a snapshot:

```sh
node scripts/validate-model.mjs --input <path to snapshot.json>
```

## Data

The snapshot is DefiLlama's public protocol index
(`https://api.llama.fi/protocols`), frozen by the bounty at 2026-11-14. The
entry reads it read-only and derives everything from it.

## License

MIT — see [LICENSE](LICENSE).

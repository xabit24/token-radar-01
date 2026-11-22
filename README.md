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
  pre-token protocol below the $50M floor that passes the watchlist's own
  exclusion rules — no bridge, liquid-staking or exchange product, no versioned
  pool, no wrapped or staked product of a token that already trades. This run:
  **178 ranked rows** (40 watchlist + 138 early).
- Ranks by **implied value**, computed only from the snapshot's own figures.
  Live-token protocols are set aside with their market caps shown, never mixed
  into the ranking.
- Gives every protocol a **farm plan**: seven concrete steps with what each
  costs and how long it takes, derived from the protocol's category, chains,
  TVL and age — never from a hand-written list of names.
- Writes a static dashboard (`dashboard/`) that renders offline from `data.js`:
  a sortable, filterable board, a detail view for every protocol, the live-token
  comparables, and the model itself.

## The model (radar-2)

```
implied = round( tvl_usd x 0.25 x category factor
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

- **Base multiple 0.25** is the median market-cap-to-TVL of the live-token
  protocols in this snapshot (0.246) — the market's own pricing of a
  protocol's TVL.
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

No protocol name is ever special-cased: the same function scores every row.
"Records no token" means DefiLlama's index lists no market cap, no CoinGecko
id and no symbol for it — a record, not proof — and a token launch is never
guaranteed. The implied value is this entry's own estimate, never a price.

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
lib/model.ts             the radar-2 model, the board, the farm plans
vendor/makefun-board.ts  make.fun's dossier library, byte for byte from the kit
dashboard/               the static page: index.html, app.css, app.js
screenshots/             board, detail and filtered views
```

## Data

The snapshot is DefiLlama's public protocol index
(`https://api.llama.fi/protocols`), frozen by the bounty at 2026-11-14. The
entry reads it read-only and derives everything from it.

## License

MIT — see [LICENSE](LICENSE).

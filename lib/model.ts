// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// pre-token protocol the watchlist does not already carry that passes the watchlist's own
// exclusion rules: no wrapped, staked or bridged product of a token that already trades, no
// exchange product, no versioned pool. A protocol is pre-token when its index entry records no
// token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols are
// kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and no protocol name is ever
// special-cased: the same function scores every row.
//
//   size       = a tiered multiple of TVL, fitted from the snapshot's own live-token
//                protocols. The market prices a dollar of TVL very differently by size: the
//                median market-cap-to-TVL falls from 0.89x in the smallest TVL quintile to
//                0.05x in the largest (an 18x fall), and the tiered medians run 0.42x below
//                $50M to 0.01x above $5B. A flat multiple would overvalue the largest
//                protocols by an order of magnitude, so the multiple is tiered by TVL on a
//                log scale, 0.40x for the smallest down to 0.15x for the largest. The top tier
//                is floored at 0.15x rather than the raw 0.01x median, because the largest
//                tiers rest on very few live comparables (n = 2-10) and a raw median there
//                would crush the largest protocols on thin evidence. The tiers are the fitted
//                size curve; the category factor sits on top of it.
//   category   = the category's comparable multiple, from the live-token protocols in this
//                snapshot: the median market-cap-to-TVL of the protocols in the category that
//                already trade, divided by the same median across all live-token protocols,
//                clamped to [0.5, 2.0]. A category with fewer than 3 live comparables uses 1.0.
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(tvl_usd x size x category x growthMult x maturity))
//
// The constants are stated in the dashboard and changeable in the model sandbox. The category
// factors are recomputed from the snapshot on every run, so a future snapshot re-prices every
// category from its own live comparables; nothing about a single protocol is hardcoded.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One tier of the fitted size curve: the multiple for a protocol whose TVL is below max_tvl_usd. */
export interface SizeTier {
  max_tvl_usd: number;
  multiple: number;
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  size_tiers: SizeTier[];
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_factor_floor: number;
  category_factor_cap: number;
  category_min_comps: number;
}

export const MODEL: ModelConstants = {
  // The fitted size curve (log-spaced TVL tiers, 0.40x down to 0.15x). The last tier's cap is
  // the largest safe integer so it serialises to JSON; it means "no upper bound".
  size_tiers: [
    { max_tvl_usd: 10_000_000, multiple: 0.4 },
    { max_tvl_usd: 50_000_000, multiple: 0.35 },
    { max_tvl_usd: 200_000_000, multiple: 0.28 },
    { max_tvl_usd: 1_000_000_000, multiple: 0.2 },
    { max_tvl_usd: Number.MAX_SAFE_INTEGER, multiple: 0.15 },
  ],
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_factor_floor: 0.5,
  category_factor_cap: 2.0,
  category_min_comps: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/**
 * The fitted size multiple for a TVL: the first tier whose cap the TVL sits below. The tiers are
 * log-spaced and decline from 0.40x to 0.15x, fitted from the snapshot's own live-token
 * protocols (see the header comment). A protocol with no tier (an empty tier list) uses 0.25x,
 * the snapshot's global median market-cap-to-TVL.
 */
export function sizeMultiple(tvlUsd: number, model: ModelConstants = MODEL): number {
  for (const tier of model.size_tiers) {
    if (tvlUsd < tier.max_tvl_usd) return tier.multiple;
  }
  const last = model.size_tiers[model.size_tiers.length - 1];
  return last === undefined ? 0.25 : last.multiple;
}

/**
 * How many pre-token protocols below the watchlist floor the early radar carries. The cap is the
 * gate's own board cap, so it never binds: the early radar is every qualifying protocol, not a
 * sample of them.
 */
export const EARLY_ROWS = 4000;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  expected_value_usd: number;
  farm: {
    expected_airdrop_usd: number;
    farm_cost_usd: number;
    net_usd: number;
    hourly_usd: number;
    verdict: 'Farm' | 'Thin' | 'Skip';
  };
  risk_notes: string[];
  model: {
    size_multiple: number;
    category_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  expected_value_usd: number;
  farm_verdict: 'Farm' | 'Thin' | 'Skip';
  farm_expected_airdrop_usd: number;
  farm_cost_usd: number;
  farm_net_usd: number;
  farm_hourly_usd: number;
  risk_notes: string[];
  size_multiple: number;
  category_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, from the live-token protocols that already trade in it. */
export interface CategoryFactor {
  factor: number;
  median_mcap_tvl: number;
  comps: number;
}

/** One protocol's place in the whole snapshot: ranked, live, or excluded with the reason. */
export interface LedgerEntry {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  status: 'watchlist' | 'pre-token' | 'live-token' | 'excluded';
  reason: string | null;
}

/** A blind test of the size curve and the category factors: fit on train, predict on test. */
export interface ValidationResult {
  train_size: number;
  test_size: number;
  median_abs_log_error: number;
  spearman_rank_correlation: number;
  flat_baseline_median_abs_log_error: number;
  flat_baseline_spearman_rank_correlation: number;
  /** The median absolute log error on the largest TVL quintile, where the size curve matters most. */
  top_quintile_median_abs_log_error: number;
  flat_baseline_top_quintile_median_abs_log_error: number;
  /** The tiered medians the train set itself gives, so the reader can see how the fitted tiers compare. */
  train_tier_medians: { max_tvl_usd: number; median_mcap_tvl: number; comps: number }[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_mcap_tvl: number;
  category_factors: Record<string, CategoryFactor>;
  rows: RadarRow[];
  live: LiveRow[];
  ledger: LedgerEntry[];
  validation: ValidationResult;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category comparable multiples, computed from the snapshot's own live-token protocols: for
 * every category, the median market-cap-to-TVL of the protocols in it that already trade, and the
 * same median across all live-token protocols. A category with fewer than `minComps` live
 * comparables falls back to the global median, a factor of 1.0, rather than a noisy median.
 */
export function categoryFactors(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { globalMedian: number; factors: Map<string, CategoryFactor> } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const factors = new Map<string, CategoryFactor>();
  for (const [category, ratios] of byCategory) {
    const med = median(ratios)!;
    const factor =
      ratios.length >= model.category_min_comps
        ? Math.min(model.category_factor_cap, Math.max(model.category_factor_floor, med / globalMedian))
        : 1;
    factors.set(category, { factor: round4(factor), median_mcap_tvl: round4(med), comps: ratios.length });
  }
  return { globalMedian, factors };
}

/** A category's factor, or 1.0 when the snapshot gives it no comparable median. */
export function categoryFactorFor(category: string | null, factors: Map<string, CategoryFactor>): number {
  if (category === null) return 1;
  return factors.get(category)?.factor ?? 1;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryFactor = 1,
): { implied: number; sizeMultiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const sizeMult = sizeMultiple(protocol.tvl_usd, model);
  const base = protocol.tvl_usd * sizeMult * categoryFactor;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, sizeMultiple: sizeMult, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist's own rule leaves out: a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** An exchange's name at the start of a protocol's name: an exchange product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and none of the watchlist's exclusions
 * apply — not a bridge, liquid-staking or exchange product, not a versioned pool, not a wrapped or
 * staked product of a token that already trades.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Categories that structurally never launch a token: a chain or a payment network is infrastructure, not an app with a token to launch. Their odds are capped near zero. */
const NEVER_TOKEN_CATEGORIES = new Set(['Chain', 'Payments']);

/** The cap on launch odds for a structurally never-token category. */
const NEVER_TOKEN_ODDS_CAP = 0.05;

/**
 * A category's base launch rate: the share of its protocols that already trade, Laplace-smoothed
 * so a category with one protocol does not read as 0% or 100%. A category where most protocols
 * already trade (Dexs, Lending) launches often; one where few do (Risk Curators) rarely does.
 */
export function categoryLaunchBase(snapshot: Snapshot): Map<string, number> {
  const byCategory = new Map<string, { live: number; total: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const entry = byCategory.get(key);
    if (entry === undefined) byCategory.set(key, { live: isPreToken(p) ? 0 : 1, total: 1 });
    else {
      entry.total += 1;
      if (!isPreToken(p)) entry.live += 1;
    }
  }
  const base = new Map<string, number>();
  for (const [category, counts] of byCategory) {
    base.set(category, (counts.live + 1) / (counts.total + 2));
  }
  return base;
}

/**
 * The probability a pre-token protocol ever launches a token, from the snapshot's own fields
 * only: its category's launch rate, its age with no token, and its seven-day growth. Odds fall
 * with age — a protocol that has run for years with no token is unlikely to start now, which is
 * why the maturity term in the implied value must not be read alone — and rise with growth, a
 * growing protocol being more likely to launch. Chain and Payments categories are capped near
 * zero: a chain or a payment network is infrastructure, not an app with a token to launch.
 */
export function launchOdds(
  protocol: SnapshotProtocol,
  asOf: string,
  categoryBase: Map<string, number>,
  model: ModelConstants = MODEL,
): number {
  const base = categoryBase.get(protocol.category ?? 'Other') ?? 0.5;
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const ageFactor = 1 / (1 + Math.max(ageForModel, 0) / 365);
  const growth = finite(protocol.change_7d, 0);
  const growthClamped = Math.min(50, Math.max(-20, growth));
  const growthFactor = 1 + (growthClamped / 100) * 0.5;
  let odds = base * ageFactor * growthFactor;
  if (NEVER_TOKEN_CATEGORIES.has(protocol.category ?? '')) odds = Math.min(odds, NEVER_TOKEN_ODDS_CAP);
  return Math.min(0.95, Math.max(0.02, odds));
}

/** Whether a category is one that structurally never launches a token. */
export function isNeverTokenCategory(category: string | null): boolean {
  return NEVER_TOKEN_CATEGORIES.has(category ?? '');
}

/** One-line risk notes for a row, derived from the snapshot: age, category comparables, and launch odds. */
export function riskNotes(
  protocol: SnapshotProtocol,
  age: number | null,
  odds: number,
  categoryComps: number,
): string[] {
  const notes: string[] = [];
  if (isNeverTokenCategory(protocol.category)) {
    notes.push(`${protocol.category} is infrastructure, not an app with a token to launch — launch odds are capped near zero.`);
  }
  if (age !== null && age >= 1095) {
    notes.push(`No token after ${Math.floor(age / 365)} years — launch odds fall with age, so the expected value is far below the implied value.`);
  } else if (age !== null && age >= 365) {
    notes.push(`No token after ${Math.floor(age / 365)} year${age >= 730 ? 's' : ''} — the longer a protocol runs with no token, the less likely a launch becomes.`);
  }
  if (categoryComps < 3) {
    notes.push(`Category has ${categoryComps} live comparable${categoryComps === 1 ? '' : 's'} — the category factor is 1.0, not a fitted median.`);
  }
  if (odds < 0.1) {
    notes.push(`Launch odds are ${(odds * 100).toFixed(0)}% — the expected value, not the implied value, is the number to farm against.`);
  }
  const growth = finite(protocol.change_7d, 0);
  if (growth <= -30) {
    notes.push(`TVL fell ${growth.toFixed(1)}% in seven days — a shrinking protocol is a weaker launch candidate.`);
  }
  return notes;
}

/** The share of a launch's implied value the farmers collectively receive (an assumption, stated in the dashboard). */
export const FARMER_SHARE = 0.05;

/** The hourly rate a farm position must clear for the verdict to be Farm (an assumption, stated in the dashboard). */
export const FARM_HOURLY_THRESHOLD_USD = 25;

/** The hours one farm position takes: set-up, a second action, a weekly action over the hold, the claim and the log. */
export function farmHours(age: number | null): number {
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  return 0.25 + 0.167 + weeks * 0.167 + 0.167 + 0.083;
}

/** An estimate of how many wallets farm one protocol, from its TVL: roughly one farmer per $100k of TVL, bounded. */
export function farmerCount(tvlUsd: number): number {
  return Math.min(10_000, Math.max(100, Math.round(tvlUsd / 100_000)));
}

/** A row's farm economics: the expected airdrop per farmer, the cost, the net, the hourly rate, and the verdict. */
export interface FarmEconomics {
  expected_airdrop_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  hourly_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
}

/**
 * The net of farming one protocol: the expected airdrop per farmer — the launch-odds-adjusted
 * expected value, times the farmers' share, split across the estimated farmer count — minus the
 * farm's cost (the capital locked, the gas over the hold, and the time at $25 an hour). Farm
 * when the net is positive and the implied hourly rate clears $25 an hour; Thin when the net is
 * positive but the hourly rate does not clear it; Skip when the net is negative.
 */
export function farmEconomics(
  protocol: SnapshotProtocol,
  age: number | null,
  impliedUsd: number,
  odds: number,
): FarmEconomics {
  const chain = chainOf(protocol);
  const capital = capitalFor(protocol);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const weeks = hold / 7;
  const gasTotal = gas.setup + gas.weekly * weeks;
  const hours = farmHours(age);
  const timeCost = hours * FARM_HOURLY_THRESHOLD_USD;
  const cost = capital + gasTotal + timeCost;
  const expectedValue = impliedUsd * odds;
  const expectedAirdrop = (expectedValue * FARMER_SHARE) / farmerCount(protocol.tvl_usd);
  const net = expectedAirdrop - cost;
  const hourly = net / hours;
  const verdict: 'Farm' | 'Thin' | 'Skip' = net <= 0 ? 'Skip' : hourly >= FARM_HOURLY_THRESHOLD_USD ? 'Farm' : 'Thin';
  return {
    expected_airdrop_usd: Math.max(0, Math.round(expectedAirdrop * 100) / 100),
    farm_cost_usd: Math.round(cost * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    hourly_usd: Math.round(hourly * 100) / 100,
    verdict,
  };
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol the watchlist does not already carry that passes
  // the watchlist's own exclusion rules, by TVL. The watchlist is the floor for coverage, never a
  // ceiling on size: a large pre-token protocol is a launch candidate too, so no TVL ceiling
  // applies. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const { factors } = categoryFactors(snapshot, model);
  const launchBase = categoryLaunchBase(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const factor = categoryFactorFor(p.category, factors);
    const comps = p.category === null ? 0 : (factors.get(p.category)?.comps ?? 0);
    const { implied, sizeMultiple: sizeMult, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, factor);
    const odds = launchOdds(p, snapshot.as_of, launchBase, model);
    const expected = Math.max(1, Math.round(implied * odds));
    const farm = farmEconomics(p, age, implied, odds);
    const risks = riskNotes(p, age, odds, comps);
    return { p, implied, sizeMult, growthPct, growthMult, maturityMult, age, factor, odds, expected, farm, risks };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_odds: Math.round(s.odds * 1000) / 1000,
    expected_value_usd: s.expected,
    farm: s.farm,
    risk_notes: s.risks,
    model: {
      size_multiple: s.sizeMult,
      category_factor: s.factor,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas on the protocol's main chain: Ethereum mainnet costs an order of magnitude more than an L2 or an alt-L1. */
function gasFor(chain: string): { setup: number; weekly: number; first: number } {
  if (chain === 'Ethereum') return { setup: 12, weekly: 3, first: 15 };
  return { setup: 3, weekly: 1, first: 3 };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('cdp')) return `Lock $${capital} of collateral on ${name} and mint the stable asset against it, keeping the position over-collateralised.`;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('payments') || c.includes('payment')) return `Open a payment channel on ${name} with $${capital} of the chain's native asset and route one payment through it.`;
  if (c === 'chain') return `Bridge $${capital} of assets to ${name} and use one dApp on the chain, so the wallet is active there.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action on the same protocol, so the wallet is not a single-transaction farmer. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('cdp')) return `Borrow a small amount of the stable asset against the collateral on ${name}, so both sides of the position are active on the same wallet.`;
  if (c.includes('lend') || c.includes('collateral')) return `Borrow a small amount against the supply on ${name}, so both sides of the market are active on the same wallet.`;
  if (c.includes('payments') || c.includes('payment')) return `Route a second, smaller payment through ${name} a week later, so the channel is used more than once.`;
  if (c === 'chain') return `Use a second dApp on ${name}, or stake a small amount of the chain's native asset, so the wallet is not a one-off bridge.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap a small amount through ${name}'s pool once a week, so the position is not idle.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${name} a week later, so the route is used more than once.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the receipt token once, if ${name} offers it, to show continued use.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge after a week and open a fresh one, keeping the margin in place on ${name}.`;
  if (c.includes('prediction')) return `Settle the first market on ${name} and place a second small position.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit into a second ${name} vault, or vote on a curator proposal if one is open.`;
  if (c.includes('stable')) return `Hold the stable asset through a full weekly cycle on ${name} and use it in one transfer.`;
  if (c.includes('rwa')) return `Claim any yield distribution from ${name} once, and keep the principal in the position.`;
  if (c.includes('insurance')) return `Renew or top up the cover from ${name} once before it lapses.`;
  return `Make a second, different action on ${name} — a swap, a vote or a deposit — so the wallet is not a single-transaction farmer.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${gas.first} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${gas.weekly} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_odds: row.launch_odds,
    expected_value_usd: row.expected_value_usd,
    farm_verdict: row.farm.verdict,
    farm_expected_airdrop_usd: row.farm.expected_airdrop_usd,
    farm_cost_usd: row.farm.farm_cost_usd,
    farm_net_usd: row.farm.net_usd,
    farm_hourly_usd: row.farm.hourly_usd,
    risk_notes: row.risk_notes,
    size_multiple: row.model.size_multiple,
    category_factor: row.model.category_factor,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** The whole snapshot's ledger: every protocol, ranked, live, or excluded with the reason it is not ranked. */
export function buildLedger(snapshot: Snapshot, board: BoardRow[]): LedgerEntry[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const watchlist = new Set(snapshot.watchlist);
  return snapshot.protocols
    .map((p): LedgerEntry => {
      if (boardSlugs.has(p.slug)) {
        return {
          slug: p.slug,
          name: p.name,
          category: p.category,
          tvl_usd: p.tvl_usd,
          status: watchlist.has(p.slug) ? 'watchlist' : 'pre-token',
          reason: null,
        };
      }
      if (!isPreToken(p)) {
        return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, status: 'live-token', reason: 'already trades' };
      }
      let reason = 'not ranked';
      if (EXCLUDED_CATEGORIES.has(p.category ?? '')) reason = `category ${p.category} is excluded (bridge, liquid staking or exchange product)`;
      else if (VERSIONED.test(p.name)) reason = 'versioned pool of another protocol';
      else if (EXCHANGE_PREFIX.test(p.name)) reason = 'exchange product';
      else if (WRAPPED_WORD.test(p.name)) reason = 'wrapped or staked product of a token that already trades';
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, status: 'excluded', reason };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Spearman's rank correlation between two lists of numbers, by their ranks. */
function spearman(a: number[], b: number[]): number {
  const rankOf = (values: number[]): number[] => {
    const order = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v || x.i - y.i);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k]!.i] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/**
 * A blind test of the size curve and the category factors, by leave-one-out: each live-token
 * protocol's market cap is predicted from a model fit on all the others (the category factors
 * are refit without it), so no protocol's own market cap leaks into its prediction. The
 * prediction is TVL x the fitted size multiple x the train category factor. The error is the
 * median absolute log error (a factor of e^error) and Spearman's rank correlation between
 * predicted and actual market cap, reported for the size curve and for a flat 0.25x baseline,
 * and for the largest TVL quintile, where the size curve matters most.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationResult {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  // The tiered medians the whole live set gives, per size tier, so the reader can see how the fitted tiers compare.
  const trainTierMedians = model.size_tiers.map((tier) => {
    const prevMax = model.size_tiers
      .filter((t) => t.max_tvl_usd < tier.max_tvl_usd)
      .reduce((m, t) => Math.max(m, t.max_tvl_usd), 0);
    const inTier = live.filter((p) => p.tvl_usd >= prevMax && p.tvl_usd < tier.max_tvl_usd);
    const ratios = inTier.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const med = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)]! : 0;
    return { max_tvl_usd: tier.max_tvl_usd === Number.MAX_SAFE_INTEGER ? -1 : tier.max_tvl_usd, median_mcap_tvl: round4(med), comps: inTier.length };
  });
  const predicted: number[] = [];
  const actual: number[] = [];
  const flatPredicted: number[] = [];
  const errors: number[] = [];
  const flatErrors: number[] = [];
  // The largest TVL quintile, by TVL, for the top-quintile error.
  const tvlThreshold = [...live].map((p) => p.tvl_usd).sort((a, b) => a - b)[Math.floor(live.length * 0.8)]!;
  const topErrors: number[] = [];
  const flatTopErrors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const p = live[i]!;
    const train = live.filter((_, j) => j !== i);
    const trainSnapshot: Snapshot = { ...snapshot, protocols: train };
    const { factors } = categoryFactors(trainSnapshot, model);
    const factor = categoryFactorFor(p.category, factors);
    const pred = Math.max(1, p.tvl_usd * sizeMultiple(p.tvl_usd, model) * factor);
    const actualMcap = p.mcap_usd!;
    predicted.push(pred);
    actual.push(actualMcap);
    const flat = Math.max(1, p.tvl_usd * 0.25 * factor);
    flatPredicted.push(flat);
    const err = Math.abs(Math.log(pred) - Math.log(actualMcap));
    const flatErr = Math.abs(Math.log(flat) - Math.log(actualMcap));
    errors.push(err);
    flatErrors.push(flatErr);
    if (p.tvl_usd >= tvlThreshold) {
      topErrors.push(err);
      flatTopErrors.push(flatErr);
    }
  }
  const medianOf = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return {
    train_size: live.length - 1,
    test_size: live.length,
    median_abs_log_error: round4(medianOf(errors)),
    spearman_rank_correlation: round4(spearman(predicted, actual)),
    flat_baseline_median_abs_log_error: round4(medianOf(flatErrors)),
    flat_baseline_spearman_rank_correlation: round4(spearman(flatPredicted, actual)),
    top_quintile_median_abs_log_error: round4(medianOf(topErrors)),
    flat_baseline_top_quintile_median_abs_log_error: round4(medianOf(flatTopErrors)),
    train_tier_medians: trainTierMedians,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const { globalMedian, factors } = categoryFactors(snapshot, model);
  const category_factors: Record<string, CategoryFactor> = {};
  for (const [category, f] of [...factors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    category_factors[category] = f;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median_mcap_tvl: round4(globalMedian),
    category_factors,
    rows: board.map(radarRow),
    live,
    ledger: buildLedger(snapshot, board),
    validation: validateModel(snapshot, model),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.launch_odds >= 0 && r.launch_odds <= 1)) return `${r.slug} has launch odds ${r.launch_odds}`;
    if (!Number.isSafeInteger(r.expected_value_usd) || r.expected_value_usd <= 0) return `${r.slug} has expected value ${r.expected_value_usd}`;
    if (r.farm.verdict !== 'Farm' && r.farm.verdict !== 'Thin' && r.farm.verdict !== 'Skip') return `${r.slug} has farm verdict ${r.farm.verdict}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

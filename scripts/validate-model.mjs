// Validate the token radar's model against the sealed snapshot (Node 22, standard library only).
//
// Leave-one-out blind test: each live-token protocol's market cap is predicted from a model fit
// on all the others (the category factors are refit without it), so no protocol's own market cap
// leaks into its prediction. The prediction is TVL x the fitted size multiple x the train
// category factor. It reports the median absolute log error (a factor of e^error) and Spearman's
// rank correlation, for the size curve and for a flat 0.25x baseline, and for the largest TVL
// quintile, where the size curve matters most. Run it from the repository root:
//
//   node scripts/validate-model.mjs --input <path to snapshot.json>
//
// It prints one JSON object to stdout and exits non-zero when the size curve is worse than the
// flat baseline on both the median absolute log error and the rank correlation — a size curve
// that helps on neither earns no place.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, validateModel } from '../lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', join(repo, '..', 'token-radar-01-kit', 'input', 'snapshot.json'));
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const result = validateModel(snapshot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
const worseOnError = result.median_abs_log_error > result.flat_baseline_median_abs_log_error;
const worseOnRank = result.spearman_rank_correlation < result.flat_baseline_spearman_rank_correlation;
if (worseOnError && worseOnRank) {
  process.stderr.write(
    `validate-model: the fitted size curve is worse than the flat 0.25x baseline on both the median abs log error (${result.median_abs_log_error} vs ${result.flat_baseline_median_abs_log_error}) and the rank correlation (${result.spearman_rank_correlation} vs ${result.flat_baseline_spearman_rank_correlation}); the size curve earns no place\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `validate-model: size curve vs flat 0.25x baseline — median abs log error ${result.median_abs_log_error} vs ${result.flat_baseline_median_abs_log_error}, Spearman ${result.spearman_rank_correlation} vs ${result.flat_baseline_spearman_rank_correlation}, top-quintile error ${result.top_quintile_median_abs_log_error} vs ${result.flat_baseline_top_quintile_median_abs_log_error} (${result.test_size} leave-one-out predictions)\n`,
);

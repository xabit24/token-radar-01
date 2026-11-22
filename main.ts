// Radar runner for token-radar-01 — model radar-3.
//
// The judge runs this file. It loads the sealed DefiLlama snapshot, scores every
// pre-token protocol with the radar-3 model from lib/model.ts, and writes the
// artefacts the judge reads: the ranked board, the dashboard's dataset, the
// dashboard files, the three screenshots, and the dossier. Nothing here touches
// the network and nothing here signs anything; the snapshot is the only input.
//
// The model itself lives in lib/model.ts. This file is the plumbing around it:
// argument parsing, the gate's own sanity checks on the board, the file copies,
// and a short report on what the run produced — the fitted size curve, the
// blind-test result, the launch odds, and the farm verdict split — so a human
// can see at a glance whether the radar behaved.
//
// Running it outside the grader container (from this directory):
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
// The --output flag does the same job as MAKEFUN_OUTPUT_DIR; the flag wins.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as radarModel from './lib/model.ts';
import * as boardLib from './vendor/makefun-board.ts';

const repoRoot = url.fileURLToPath(new URL('./', import.meta.url));

/** The dossier text limit the gate enforces (reference/gate.json). */
const DOSSIER_TEXT_LIMIT = 65536;

/** How many screenshots a hand-in may carry, and how large each one may be. */
const SHOT_LIMIT = 4;
const SHOT_MAX_BYTES = 524288;

/** Screenshot names are letters, digits, dots, underscores and dashes, 1 to 128 chars. */
const SHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** How many screenshots a hand-in must carry at least. */
const SHOTS_REQUIRED = 3;

/** Stop the run with a message on stderr and a non-zero exit. */
function die(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value after `--name <value>` or `--name=<value>`, else the fallback. */
function flagValue(flag: string, fallback: string): string {
  const argv = process.argv;
  const bare = argv.indexOf(`--${flag}`);
  if (bare >= 0 && bare + 1 < argv.length) return argv[bare + 1] as string;
  const joined = argv.find((a) => a.startsWith(`--${flag}=`));
  if (joined !== undefined) return joined.slice(flag.length + 3);
  return fallback;
}

/** A dollar figure with thousands separators and no decimals. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Copy a directory's regular files into `dst`, skipping dotfiles, and return the names copied. */
function copyDir(src: string, dst: string): string[] {
  if (!fs.existsSync(src)) return [];
  fs.mkdirSync(dst, { recursive: true });
  return fs
    .readdirSync(src)
    .filter((name) => name.charAt(0) !== '.' && fs.statSync(path.join(src, name)).isFile())
    .map((name) => {
      fs.copyFileSync(path.join(src, name), path.join(dst, name));
      return name;
    });
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : path.join(inputArg, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = radarModel.parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const { board, radar } = radarModel.buildRadar(snapshot);
const problem = radarModel.boardIssue(board, snapshot);
if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

const top = board[0];
const bottom = board[board.length - 1];
const verdicts = { Farm: 0, Thin: 0, Skip: 0 };
for (const row of board) verdicts[row.farm.verdict] += 1;
const highOdds = board.filter((row) => row.launch_odds > 0.5).length;
const expectedTotal = board.reduce((sum, row) => sum + row.expected_value_usd, 0);
const impliedTotal = board.reduce((sum, row) => sum + row.implied_value_usd, 0);
const tiers = radarModel.MODEL.size_tiers
  .map((t) => `${t.multiple}x under ${t.max_tvl_usd >= Number.MAX_SAFE_INTEGER ? 'any TVL' : dollars(t.max_tvl_usd)}`)
  .join(', ');
const validation = radar.validation;
process.stdout.write(
  `token radar: model ${radarModel.MODEL_VERSION}, ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: size curve ${tiers}\n` +
    `token radar: blind test (leave-one-out, ${validation.test_size} live protocols): median abs log error ${validation.median_abs_log_error} vs flat ${validation.flat_baseline_median_abs_log_error}; top-quintile ${validation.top_quintile_median_abs_log_error} vs flat ${validation.flat_baseline_top_quintile_median_abs_log_error}\n` +
    `token radar: ${board.length} rows ranked (${radar.early_size} early, ${radar.live_size} live set aside); #1 ${top?.name} at ${dollars(top?.implied_value_usd ?? 0)}, last ${bottom?.name} at ${dollars(bottom?.implied_value_usd ?? 0)}\n` +
    `token radar: implied total ${dollars(impliedTotal)}, expected total (odds-adjusted) ${dollars(expectedTotal)}, ${highOdds} rows with launch odds above 50%\n` +
    `token radar: farm verdicts Farm ${verdicts.Farm}, Thin ${verdicts.Thin}, Skip ${verdicts.Skip}\n`,
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
fs.writeFileSync(path.join(outDir, 'data.js'), radarModel.dataScript(radar));

const dashboardFiles = copyDir(path.join(repoRoot, 'dashboard'), path.join(outDir, 'dashboard'));
const shots = copyDir(path.join(repoRoot, 'screenshots'), path.join(outDir, 'screenshots'));
if (shots.length < SHOTS_REQUIRED) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const shot of shots) {
  if (!SHOT_NAME.test(shot)) {
    die(`screenshots/${shot}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
const dossierCaps = {
  text_max_bytes: DOSSIER_TEXT_LIMIT,
  screenshots: { max: SHOT_LIMIT, max_bytes: SHOT_MAX_BYTES },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};
fs.writeFileSync(path.join(outDir, 'dossier.json'), boardLib.buildDossier(outDir, dossierCaps));

process.stdout.write(
  `token radar: wrote ${path.join(outDir, 'board.json')}, ${path.join(outDir, 'data.js')}, ${path.join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${path.join(outDir, 'screenshots')} (${shots.length} images) and ${path.join(outDir, 'dossier.json')}\n`,
);

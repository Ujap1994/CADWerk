/**
 * Compares fresh benchmark results with stored baselines and fails on regressions.
 *
 * Baselines live in bench/baselines/<suite>-<platform>-<arch>.json and come from
 * CI runs of the main branch (download the "benchmarks-*" artifacts). Without a
 * baseline for the current machine, the comparison is skipped.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { benchRoot, type BenchReport } from './lib.ts';

const threshold = Number(process.env.BENCH_THRESHOLD ?? '1.3');
/** Cases faster than this are dominated by noise and not compared. */
const MIN_MS = 2;
/** CI machines have no real GPU, so render results are reported but never fail the build. */
const ADVISORY_SUITES = new Set(['render']);

const resultsDir = path.join(benchRoot, 'results');
const files = existsSync(resultsDir) ? readdirSync(resultsDir).filter((file) => file.endsWith('.json')) : [];
let regressions = 0;

for (const file of files) {
  const baselineFile = path.join(benchRoot, 'baselines', file);
  if (!existsSync(baselineFile)) {
    console.log(`${file}: no baseline, skipping comparison`);
    continue;
  }
  const current = JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8')) as BenchReport;
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as BenchReport;
  const advisory = ADVISORY_SUITES.has(current.suite);
  // Best-of-N times are far less noisy than medians on shared machines.
  const time = (result: { minMs: number; medianMs: number }) => (result.minMs > 0 ? result.minMs : result.medianMs);
  const currentCalibration = current.cases.calibration;
  const baselineCalibration = baseline.cases.calibration;
  const machineFactor = currentCalibration && baselineCalibration ? time(currentCalibration) / time(baselineCalibration) : 1;
  const rows = [];
  for (const [name, result] of Object.entries(current.cases)) {
    const reference = baseline.cases[name];
    // Single measurements (start-up times) are too noisy on shared machines to gate on.
    if (name === 'calibration' || !reference || time(reference) < MIN_MS || result.iterations < 3 || reference.iterations < 3) continue;
    const ratio = time(result) / time(reference) / machineFactor;
    const slower = ratio > threshold;
    const status = slower ? (advisory ? 'slower (advisory)' : 'REGRESSION') : ratio < 1 / threshold ? 'faster' : 'ok';
    if (status === 'REGRESSION') regressions++;
    rows.push({ case: name, 'baseline ms': time(reference), 'current ms': time(result), ratio: Math.round(ratio * 100) / 100, status });
  }
  console.log(`\n${file} (threshold ×${threshold}, machine factor ×${Math.round(machineFactor * 100) / 100}${advisory ? ', advisory' : ''})`);
  console.table(rows);
}

if (regressions > 0) {
  console.error(`\n${regressions} benchmark regression(s) above ×${threshold}.`);
  process.exit(1);
}

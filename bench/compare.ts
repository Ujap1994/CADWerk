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
  const rows = [];
  for (const [name, result] of Object.entries(current.cases)) {
    const reference = baseline.cases[name];
    if (!reference || reference.medianMs < MIN_MS) continue;
    const ratio = result.medianMs / reference.medianMs;
    const status = ratio > threshold ? 'REGRESSION' : ratio < 1 / threshold ? 'faster' : 'ok';
    if (status === 'REGRESSION') regressions++;
    rows.push({ case: name, 'baseline ms': reference.medianMs, 'current ms': result.medianMs, ratio: Math.round(ratio * 100) / 100, status });
  }
  console.log(`\n${file} (threshold ×${threshold})`);
  console.table(rows);
}

if (regressions > 0) {
  console.error(`\n${regressions} benchmark regression(s) above ×${threshold}.`);
  process.exit(1);
}

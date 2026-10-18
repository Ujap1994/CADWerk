import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const benchRoot = path.dirname(fileURLToPath(import.meta.url));

export interface CaseResult {
  medianMs: number;
  p95Ms: number;
  minMs: number;
  iterations: number;
  /** Extra numbers worth tracking (triangle counts, sizes, ...). */
  info?: Record<string, number>;
}

export interface BenchReport {
  suite: string;
  meta: { platform: string; arch: string; cpu: string; cores: number; memoryGb: number; node: string; commit: string; date: string; ci: boolean };
  cases: Record<string, CaseResult>;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

export function summarize(samples: number[], info?: Record<string, number>): CaseResult {
  return {
    medianMs: round(percentile(samples, 50)),
    p95Ms: round(percentile(samples, 95)),
    minMs: round(Math.min(...samples)),
    iterations: samples.length,
    ...(info ? { info } : {}),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Runs `fn` after `warmup` untimed runs and returns the timing summary. */
export function measure(fn: (iteration: number) => void, { iterations = 10, warmup = 2 } = {}): CaseResult {
  for (let i = 0; i < warmup; i++) fn(-1 - i);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

/**
 * A fixed CPU workload measured in every run. Comparisons divide by its change, so a
 * slower (shared) CI machine does not look like a regression of ParaWerk itself.
 */
export function calibration(): CaseResult {
  let sink = 0;
  const result = measure(() => {
    let x = 0;
    for (let i = 0; i < 3_000_000; i++) x = (x + Math.sqrt(i) * 1.0000001) % 1e9;
    sink += x;
  }, { iterations: 15, warmup: 3 });
  if (sink < 0) console.log(sink);
  return result;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export function meta(): BenchReport['meta'] {
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    commit: gitCommit(),
    date: new Date().toISOString(),
    ci: process.env.CI === 'true',
  };
}

export function resultFile(suite: string): string {
  return path.join(benchRoot, 'results', `${suite}-${process.platform}-${process.arch}.json`);
}

export function writeReport(report: BenchReport): string {
  const file = resultFile(report.suite);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

export function printReport(report: BenchReport): void {
  console.log(`\n${report.suite} benchmarks · ${report.meta.cpu} · ${report.meta.platform}-${report.meta.arch} · ${report.meta.commit}`);
  const rows = Object.entries(report.cases).map(([name, result]) => ({
    case: name,
    'median ms': result.medianMs,
    'p95 ms': result.p95Ms,
    runs: result.iterations,
    info: result.info ? Object.entries(result.info).map(([k, v]) => `${k}=${v}`).join(' ') : '',
  }));
  console.table(rows);
}

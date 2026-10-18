import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp } from '../../tests/e2e/harness.ts';
import { meta, resultFile, type BenchReport, type CaseResult } from '../lib.ts';

/**
 * Render benchmarks: orbit synthetic assemblies of growing size and record frame times.
 * Uncapped frame rate (PARAWERK_BENCH=1 disables vsync), real GPU when available.
 * Run: npm run bench:render   Results: bench/results/render-<platform>-<arch>.json
 *
 * The scale ladder grows with every phase (ROADMAP.md, section 6).
 */
const LADDER: { components: number; instanced: boolean }[] = [
  { components: 10, instanced: true },
  { components: 100, instanced: true },
  { components: 1_000, instanced: true },
  { components: 10_000, instanced: true },
  { components: 50_000, instanced: true },
  { components: 100, instanced: false },
  { components: 1_000, instanced: false },
  { components: 5_000, instanced: false },
];

test('orbit synthetic assemblies', async () => {
  const quick = process.env.BENCH_QUICK === '1';
  const ladder = quick ? LADDER.filter((step) => step.components <= 1_000) : LADDER;
  const { app, page } = await launchApp({ width: 1600, height: 1000, env: { PARAWERK_BENCH: '1' } });
  const cases: Record<string, CaseResult> = {};

  for (const step of ladder) {
    const load = await page.evaluate(({ components, instanced }) => {
      const hooks = (window as unknown as { __parawerk: { viewport: { loadBenchmarkScene(c: number, i: boolean): { triangles: number; drawCalls: number } } } }).__parawerk;
      const start = performance.now();
      const info = hooks.viewport.loadBenchmarkScene(components, instanced);
      return { ...info, loadMs: performance.now() - start };
    }, step);
    const result = await page.evaluate(async (frames) => {
      const hooks = (window as unknown as { __parawerk: { viewport: { runOrbitBenchmark(f: number): Promise<{ fps: number; frameMsMedian: number; frameMsP95: number; cpuMsMedian: number; triangles: number; drawCalls: number }> } } }).__parawerk;
      await hooks.viewport.runOrbitBenchmark(30);
      return hooks.viewport.runOrbitBenchmark(frames);
    }, quick ? 90 : 240);
    const name = `orbit.${step.components}.${step.instanced ? 'instanced' : 'individual'}`;
    cases[name] = {
      medianMs: Math.round(result.frameMsMedian * 100) / 100,
      p95Ms: Math.round(result.frameMsP95 * 100) / 100,
      minMs: Math.round(result.cpuMsMedian * 100) / 100,
      iterations: quick ? 90 : 240,
      info: { fps: Math.round(result.fps), triangles: load.triangles, drawCalls: result.drawCalls, loadMs: Math.round(load.loadMs), cpuMs: Math.round(result.cpuMsMedian * 100) / 100 },
    };
    console.log(`${name}: ${Math.round(result.fps)} fps, p95 ${result.frameMsP95.toFixed(1)} ms, ${load.triangles.toLocaleString('en')} triangles, ${result.drawCalls} draw calls`);
  }
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { clearBenchmarkScene(): void } } }).__parawerk.viewport.clearBenchmarkScene());
  await app.close();

  const report: BenchReport = { suite: 'render', meta: meta(), cases };
  const file = resultFile('render');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
});

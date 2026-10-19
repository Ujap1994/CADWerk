import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp } from '../../tests/e2e/harness.ts';
import { meta, resultFile, summarize, type BenchReport, type CaseResult } from '../lib.ts';
import { rectangleChain } from '../solver/parawerk.ts';

/**
 * Sketch interaction benchmarks: drag a point of growing sketches in the app and measure each
 * step (solver round trip in the worker + sketch graphics update + GPU-synchronized frame).
 * Phase 1 target: 60 fps (16.7 ms per step) with 500 entities.
 * Run: npm run bench:render   Results: bench/results/sketch-<platform>-<arch>.json
 */
const LADDER = [50, 500, 2_000];

interface DragResult {
  total: number[];
  solve: number[];
  graphics: number[];
}

test('drag points in sketches of growing size', async () => {
  const quick = process.env.BENCH_QUICK === '1';
  const steps = quick ? 40 : 120;
  const { app, page } = await launchApp({ width: 1600, height: 1000, env: { PARAWERK_BENCH: '1' } });
  const cases: Record<string, CaseResult> = {};

  for (const entities of LADDER) {
    // Rectangles of 8 entities each, linked corner to corner; without dimensions, so they can move.
    const { sketch } = rectangleChain(Math.round(entities / 8), 7);
    sketch.constraints = sketch.constraints.filter((constraint) => constraint.type !== 'distance');
    const last = sketch.entities.filter((entity) => entity.type === 'point').at(-1)?.id ?? '';
    await page.evaluate((data) => {
      const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; commands: { editFeature(id: string): void } } }).__parawerk;
      const features = [{ id: 'bench', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: data }];
      hooks.setState({ history: { features, past: [], future: [] }, savedFeatures: features, sketch: null });
      hooks.commands.editFeature('bench');
    }, sketch);
    const result = await page.evaluate(
      async ({ point, count }) => {
        const hooks = (window as unknown as { __parawerk: { sketch: { dragBenchmark(id: string, n: number): Promise<DragResult> } } }).__parawerk;
        await hooks.sketch.dragBenchmark(point, 10);
        return hooks.sketch.dragBenchmark(point, count);
      },
      { point: last, count: steps },
    );
    const name = `drag.${entities}`;
    const solve = summarize(result.solve);
    const graphics = summarize(result.graphics);
    cases[name] = summarize(result.total, { entities: sketch.entities.length, solveMs: solve.medianMs, graphicsMs: graphics.medianMs, fps: Math.round(1000 / Math.max(1e-3, summarize(result.total).medianMs)) });
    console.log(`${name}: median ${cases[name].medianMs} ms per step (solve ${solve.medianMs}, graphics ${graphics.medianMs}), p95 ${cases[name].p95Ms} ms`);
    await page.evaluate(() => (window as unknown as { __parawerk: { commands: { cancelSketch(): Promise<void> } } }).__parawerk.commands.cancelSketch());
  }
  await app.close();

  const report: BenchReport = { suite: 'sketch', meta: meta(), cases };
  const file = resultFile('sketch');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
});

/**
 * 2D constraint solver benchmarks (PlaneGCS WebAssembly), the candidate for the Phase 1 sketcher.
 * Run: npm run bench:solver   Results: bench/results/solver-<platform>-<arch>.json
 */
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs';
import { solveSketch } from '../../src/sketch/solver/index.ts';
import { calibration, measure, meta, printReport, summarize, writeReport, type BenchReport, type CaseResult } from '../lib.ts';
import { rectangleChain } from './parawerk.ts';

type Primitive = Record<string, unknown> & { id: string; type: string };

/** A chain of fully dimensioned rectangles: 7 constraints per rectangle, start positions perturbed. */
function sketch(rectangles: number, seed: number): { primitives: Primitive[]; constraints: number } {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const primitives: Primitive[] = [];
  let constraints = 0;
  for (let r = 0; r < rectangles; r++) {
    const ox = r * 12;
    const oy = r * 7;
    const corners = [[0, 0], [10, 0], [10, 6], [0, 6]];
    corners.forEach(([x, y], i) => {
      primitives.push({ id: `p${r}_${i}`, type: 'point', x: ox + (x as number) + (random() - 0.5) * 3, y: oy + (y as number) + (random() - 0.5) * 3, fixed: r === 0 && i === 0 });
    });
    for (let i = 0; i < 4; i++) primitives.push({ id: `l${r}_${i}`, type: 'line', p1_id: `p${r}_${i}`, p2_id: `p${r}_${(i + 1) % 4}` });
    primitives.push({ id: `c${r}_h0`, type: 'horizontal_l', l_id: `l${r}_0` });
    primitives.push({ id: `c${r}_v1`, type: 'vertical_l', l_id: `l${r}_1` });
    primitives.push({ id: `c${r}_h2`, type: 'horizontal_l', l_id: `l${r}_2` });
    primitives.push({ id: `c${r}_v3`, type: 'vertical_l', l_id: `l${r}_3` });
    primitives.push({ id: `c${r}_w`, type: 'p2p_distance', p1_id: `p${r}_0`, p2_id: `p${r}_1`, distance: 10 });
    primitives.push({ id: `c${r}_hgt`, type: 'p2p_distance', p1_id: `p${r}_1`, p2_id: `p${r}_2`, distance: 6 });
    constraints += 6;
    if (r > 0) {
      primitives.push({ id: `c${r}_link`, type: 'p2p_coincident', p1_id: `p${r}_0`, p2_id: `p${r - 1}_2` });
      constraints += 1;
    }
  }
  return { primitives, constraints };
}

const cases: Record<string, CaseResult> = {};
cases['calibration'] = calibration();
const initStart = performance.now();
const module = await init_planegcs_module();
cases['solver.init'] = summarize([performance.now() - initStart]);

// One connected sketch per size. Sizes above the solver's memory limit are recorded as failures
// (PlaneGCS solves one dense system; see docs/adr/0005-sketch-solver.md).
const sizes = (process.env.SOLVER_SIZES ?? '8,36,72').split(',').map(Number);
for (const rectangles of sizes) {
  const { constraints } = sketch(rectangles, 1);
  let status = -1;
  const result = measure((i) => {
    const wrapper = new GcsWrapper(new module.GcsSystem());
    try {
      wrapper.push_primitives_and_params(sketch(rectangles, i + 10).primitives as never);
      status = wrapper.solve();
      wrapper.apply_solution();
    } finally {
      wrapper.destroy_gcs_module();
    }
  }, { iterations: rectangles > 100 ? 5 : 15, warmup: 1 });
  cases[`planegcs.solve.${constraints}constraints`] = { ...result, info: { constraints, status } };
  console.log(`planegcs solved ${constraints} constraints: ${result.medianMs} ms`);
}

// ParaWerk's own sparse solver (src/sketch/solver) on the same connected sketches, larger sizes too.
for (const rectangles of [8, 36, 72, 143, 286]) {
  const { constraints } = rectangleChain(rectangles, 1);
  let converged = false;
  const result = measure((i) => {
    converged = solveSketch(rectangleChain(rectangles, i + 10).sketch, { analyze: false }).converged;
  }, { iterations: rectangles > 100 ? 5 : 15, warmup: 1 });
  cases[`parawerk.solve.${constraints}constraints`] = { ...result, info: { constraints, converged: converged ? 1 : 0 } };
  console.log(`parawerk solved ${constraints} constraints: ${result.medianMs} ms`);
}

// Interactive dragging and definition analysis on a solved sketch with about 1,000 constraints.
const solved = solveSketch(rectangleChain(143, 3).sketch, { analyze: false }).sketch;
const last = solved.entities.find((e) => e.id === 'p142_2');
if (last?.type === 'point') {
  cases['parawerk.drag.1000constraints'] = measure((i) => {
    solveSketch(solved, { drag: { kind: 'point', id: 'p142_2', x: last.x + (i % 5), y: last.y + 1 }, analyze: false });
  }, { iterations: 20, warmup: 2 });
}
cases['parawerk.analyze.1000constraints'] = measure(() => solveSketch(solved, { analyze: true }), { iterations: 5, warmup: 1 });

const report: BenchReport = { suite: 'solver', meta: meta(), cases };
printReport(report);
console.log(`Results written to ${writeReport(report)}`);

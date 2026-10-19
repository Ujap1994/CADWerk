import { Vector3 } from 'three';
import * as commands from './commands.ts';
import { sketchHighlight } from './sketch/controller.ts';
import { sketchSolver } from './sketch/solver.ts';
import { kernel, whenIdle } from './state/rebuild.ts';
import { getState, setState } from './state/store.ts';
import { viewport } from './viewport/registry.ts';

/**
 * Hooks for the end-to-end tests and benchmarks. Installed only when the app
 * was started by the test harness (PARAWERK_E2E=1).
 */
export function installTestHooks(): void {
  const hooks = {
    getState,
    setState,
    commands,
    whenIdle,
    memory: () => kernel().memory(),
    viewport: {
      loadBenchmarkScene: (components: number, instanced: boolean) => viewport()?.loadBenchmarkScene(components, instanced),
      clearBenchmarkScene: () => viewport()?.clearBenchmarkScene(),
      runOrbitBenchmark: (frames: number) => viewport()?.runOrbitBenchmark(frames),
      debugInfo: () => viewport()?.debugInfo(),
      project: (x: number, y: number, z: number) => viewport()?.project(new Vector3(x, y, z)),
      relationGlyphs: () => viewport()?.relationGlyphsOnScreen() ?? [],
      zoomToFit: () => viewport()?.zoomToFit(false),
    },
    sketch: {
      /**
       * Drags a point of the open sketch in `steps` steps like the mouse would, and measures each
       * step: solving in the worker, updating the sketch graphics and rendering a GPU-synchronized frame.
       */
      dragBenchmark: async (pointId: string, steps: number) => {
        const sketch = getState().sketch?.draft.sketch;
        const point = sketch?.entities.find((entity) => entity.id === pointId);
        const engine = viewport();
        if (!sketch || point?.type !== 'point' || !engine) throw new Error('no open sketch with that point');
        const session = sketchSolver().startDrag(sketch);
        const total: number[] = [];
        const solve: number[] = [];
        const graphics: number[] = [];
        for (let i = 0; i < steps; i++) {
          const start = performance.now();
          const solution = await session.move({ kind: 'point', id: pointId, x: point.x + i * 0.2, y: point.y + i * 0.1 });
          const solved = performance.now();
          if (solution) engine.setActiveSketch(solution.sketch, sketchHighlight(getState()));
          const updated = performance.now();
          engine.renderSynchronously();
          total.push(performance.now() - start);
          solve.push(solved - start);
          graphics.push(updated - solved);
        }
        await session.end();
        return { total, solve, graphics };
      },
    },
  };
  (window as unknown as { __parawerk: typeof hooks }).__parawerk = hooks;
}

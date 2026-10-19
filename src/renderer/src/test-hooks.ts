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
      /**
       * Draws a line in the open sketch like the mouse would: the first point is clicked, then the
       * pointer moves along the sketch in `steps` steps. Each step is measured: snapping and the tool
       * preview, then a GPU-synchronized frame.
       */
      drawBenchmark: (steps: number) => {
        const sketch = getState().sketch?.draft.sketch;
        const engine = viewport();
        if (!sketch || !engine) throw new Error('no open sketch');
        const points = sketch.entities.flatMap((entity) => (entity.type === 'point' ? [[entity.x, entity.y] as const] : []));
        const [minU, minV] = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
        const [maxU, maxV] = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
        // Along the sketch, slightly off its diagonal so the pointer passes geometry without sitting on it.
        const at = (t: number): [number, number] => [minU + (maxU - minU) * t + 1.3, minV + (maxV - minV) * t - 0.7];
        commands.setSketchTool('line');
        engine.simulateSketchPointer(...at(0.02), 'click');
        const total: number[] = [];
        const tool: number[] = [];
        for (let i = 0; i < steps; i++) {
          const start = performance.now();
          engine.simulateSketchPointer(...at(0.05 + (0.9 * i) / steps), 'hover');
          const previewed = performance.now();
          engine.renderSynchronously();
          total.push(performance.now() - start);
          tool.push(previewed - start);
        }
        // The line was never finished, so the sketch is unchanged.
        commands.setSketchTool(null);
        return { total, tool };
      },
    },
  };
  (window as unknown as { __parawerk: typeof hooks }).__parawerk = hooks;
}

import { Vector3 } from 'three';
import * as commands from './commands.ts';
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
      zoomToFit: () => viewport()?.zoomToFit(false),
    },
  };
  (window as unknown as { __parawerk: typeof hooks }).__parawerk = hooks;
}

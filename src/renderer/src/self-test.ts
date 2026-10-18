import type { SelfTestCheck, SelfTestResult } from '../../shared/ipc.ts';
import type { Feature } from '../../shared/model/feature.ts';
import { kernel, whenIdle } from './state/rebuild.ts';
import { getState, setState, store } from './state/store.ts';

/** Volume of a box whose 12 edges are rounded with radius r. */
function roundedBoxVolume(a: number, b: number, c: number, r: number): number {
  const [x, y, z] = [a - 2 * r, b - 2 * r, c - 2 * r];
  return x * y * z + 2 * r * (x * y + x * z + y * z) + Math.PI * r * r * (x + y + z) + (4 / 3) * Math.PI * r ** 3;
}

function waitForKernel(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (getState().kernelStatus === 'ready') return resolve(true);
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = store.subscribe((state) => {
      if (state.kernelStatus === 'ready') {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Installation check for `ParaWerk --self-test`: starts the geometry kernel, builds a
 * filleted box, compares its volume with the analytic value and exports STEP.
 */
export async function runSelfTest(): Promise<SelfTestResult> {
  const start = performance.now();
  const checks: SelfTestCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const canvas = document.createElement('canvas');
  check('webgl2', canvas.getContext('webgl2') !== null, 'WebGL 2 context for the 3D view');

  const kernelReady = await waitForKernel(120_000);
  check('kernel', kernelReady, `geometry kernel started after ${Math.round(performance.now() - start)} ms`);
  if (kernelReady) {
    try {
      const features: Feature[] = [
        { id: 'self-test-box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
        { id: 'self-test-fillet', type: 'fillet', radius: 5, edges: Array.from({ length: 12 }, (_, index) => ({ kind: 'edge-index' as const, index })) },
      ];
      setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
      await whenIdle();
      const volume = getState().rebuild?.properties?.volume ?? Number.NaN;
      const expected = roundedBoxVolume(100, 60, 40, 5);
      check('modeling', Math.abs(volume - expected) < 0.1, `filleted box volume ${volume.toFixed(3)} mm³ (expected ${expected.toFixed(3)})`);
      check('display mesh', getState().display.body !== null, 'tessellation for the 3D view');
      const step = await kernel().exportModel({ features, format: 'step' });
      const header = new TextDecoder().decode(step.slice(0, 13));
      check('step export', header === 'ISO-10303-21;', `${step.length} bytes`);
    } catch (error) {
      check('modeling', false, error instanceof Error ? error.message : String(error));
    }
  }

  return { ok: checks.every((c) => c.ok), durationMs: Math.round(performance.now() - start), checks };
}

import { Kernel, type BackendName } from './kernel.ts';

/**
 * Creates a kernel with the chosen backend (Node: tests and benchmarks). The app's
 * worker constructs its backend directly, so only one WebAssembly build is bundled.
 */
export async function createKernel(backend: BackendName = 'parawerk', wasmUrl?: string): Promise<Kernel> {
  if (backend === 'replicad') {
    const { ReplicadBackend } = await import('./backends/replicad.ts');
    return new Kernel(await ReplicadBackend.create(wasmUrl));
  }
  const { ParaWerkBackend } = await import('./backends/parawerk.ts');
  return new Kernel(await ParaWerkBackend.create(wasmUrl));
}

import { SolverClient, type SolverWorker } from './solver-client.ts';

let client: SolverClient | null = null;

/** The sketch solver worker; started on first use, so parts without sketches never load it. */
export function sketchSolver(): SolverClient {
  client ??= new SolverClient(
    () => new Worker(new URL('../../../sketch/worker.ts', import.meta.url), { type: 'module', name: 'parawerk-sketch-solver' }) as unknown as SolverWorker,
  );
  return client;
}

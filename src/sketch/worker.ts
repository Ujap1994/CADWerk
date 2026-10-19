import { handleSolverRequest } from './handler.ts';
import type { SolverRequestMessage, SolverResponseMessage } from './protocol.ts';

/** The subset of DedicatedWorkerGlobalScope used here (the DOM and WebWorker libs cannot be combined). */
interface WorkerScope {
  postMessage(message: SolverResponseMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SolverRequestMessage>) => void): void;
}

const scope = self as unknown as WorkerScope;
scope.addEventListener('message', (event) => scope.postMessage(handleSolverRequest(event.data)));

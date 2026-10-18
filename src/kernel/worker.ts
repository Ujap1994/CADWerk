import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { Kernel, NothingToExportError } from './kernel.ts';
import { describeError } from './occt.ts';
import type { KernelRequestMessage, KernelResponseMessage } from './protocol.ts';

/** The subset of DedicatedWorkerGlobalScope used here (the DOM and WebWorker libs cannot be combined). */
interface WorkerScope {
  postMessage(message: KernelResponseMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<KernelRequestMessage>) => void): void;
}

const scope = self as unknown as WorkerScope;
const initStart = performance.now();
const kernelPromise = Kernel.create(wasmUrl);

kernelPromise.then(
  (kernel) => {
    scope.postMessage({ kind: 'ready', initMs: performance.now() - initStart });
    // Let queued requests run first; warm up when the worker is idle.
    setTimeout(() => {
      try {
        scope.postMessage({ kind: 'warm', warmUpMs: kernel.warmUp() });
      } catch (error) {
        console.warn('Kernel warm-up failed', error);
      }
    }, 0);
  },
  (error: unknown) => scope.postMessage({ kind: 'fatal', error: String(error) }),
);

scope.addEventListener('message', (event) => {
  const message = event.data;
  void kernelPromise.then((kernel) => {
    try {
      switch (message.type) {
        case 'rebuild': {
          const { result, transfer } = kernel.rebuild(message.payload);
          scope.postMessage({ kind: 'reply', id: message.id, ok: true, result }, transfer);
          break;
        }
        case 'export': {
          const bytes = kernel.exportModel(message.payload);
          scope.postMessage({ kind: 'reply', id: message.id, ok: true, result: bytes }, [bytes.buffer as ArrayBuffer]);
          break;
        }
        case 'memory':
          scope.postMessage({ kind: 'reply', id: message.id, ok: true, result: kernel.memoryStats() });
          break;
      }
    } catch (error) {
      const text = error instanceof NothingToExportError ? 'nothing-to-export' : describeError(kernel.oc, error);
      scope.postMessage({ kind: 'reply', id: message.id, ok: false, error: text });
    }
  });
});

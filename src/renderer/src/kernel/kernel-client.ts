import type {
  ExportRequest,
  KernelRequest,
  KernelRequestMessage,
  KernelResponseMessage,
  MemoryStats,
  MeshPayload,
  RebuildRequest,
  RebuildResult,
} from '../../../kernel/protocol.ts';

export class KernelCrashedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelCrashedError';
  }
}

export interface KernelEvents {
  onReady(initMs: number): void;
  onWarm(warmUpMs: number): void;
  /** The worker died and was restarted; pending requests were rejected. */
  onRestart(reason: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Meshes kept on the client so unchanged bodies are never transferred twice. */
const MESH_CACHE_SIZE = 12;

/**
 * Restart the worker when its WebAssembly heap exceeds this size. WebAssembly
 * memory never shrinks, so a fresh worker is the only way to return memory
 * after a large model; the document lives in the UI and is rebuilt.
 */
const HEAP_RESTART_BYTES = 1536 * 1024 * 1024;

export interface ClientRebuildResult {
  result: RebuildResult;
  /** Mesh per captured index (null when there is no body at that point). */
  meshes: Map<number, MeshPayload | null>;
}

/** Runs the geometry kernel in a Web Worker and restarts it after crashes. */
export class KernelClient {
  private readonly createWorker: () => Worker;
  private readonly events: KernelEvents;
  private worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly meshCache = new Map<string, MeshPayload>();
  private disposed = false;

  constructor(createWorker: () => Worker, events: KernelEvents) {
    this.createWorker = createWorker;
    this.events = events;
    this.worker = this.spawn();
  }

  async rebuild(request: Omit<RebuildRequest, 'knownMeshKeys'>): Promise<ClientRebuildResult> {
    const result = (await this.send({
      type: 'rebuild',
      payload: { ...request, knownMeshKeys: [...this.meshCache.keys()] },
    })) as RebuildResult;

    const meshes = new Map<number, MeshPayload | null>();
    for (const capture of result.captures) {
      if (capture.meshKey === null) {
        meshes.set(capture.index, null);
        continue;
      }
      if (capture.mesh) this.remember(capture.mesh);
      const mesh = capture.mesh ?? this.meshCache.get(capture.meshKey) ?? null;
      if (mesh) this.touch(mesh);
      meshes.set(capture.index, mesh);
    }
    return { result, meshes };
  }

  async exportModel(request: ExportRequest): Promise<Uint8Array> {
    return (await this.send({ type: 'export', payload: request })) as Uint8Array;
  }

  async memory(): Promise<MemoryStats> {
    return (await this.send({ type: 'memory' })) as MemoryStats;
  }

  /** Restarts the worker if its heap has grown too large; call when idle. */
  async recycleIfNeeded(): Promise<boolean> {
    if (this.pending.size > 0) return false;
    const stats = await this.memory();
    if (stats.wasmHeapBytes < HEAP_RESTART_BYTES || this.pending.size > 0) return false;
    this.restart('memory');
    return true;
  }

  restart(reason: string): void {
    this.worker.terminate();
    this.rejectAll(new KernelCrashedError(reason));
    this.worker = this.spawn();
    this.events.onRestart(reason);
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
    this.rejectAll(new KernelCrashedError('disposed'));
  }

  private spawn(): Worker {
    const worker = this.createWorker();
    worker.addEventListener('message', (event: MessageEvent<KernelResponseMessage>) => this.onMessage(event.data));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      if (!this.disposed) this.restart(event.message || 'worker error');
    });
    return worker;
  }

  private onMessage(message: KernelResponseMessage): void {
    switch (message.kind) {
      case 'ready':
        this.events.onReady(message.initMs);
        break;
      case 'warm':
        this.events.onWarm(message.warmUpMs);
        break;
      case 'fatal':
        this.rejectAll(new KernelCrashedError(message.error));
        break;
      case 'reply': {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error));
        break;
      }
    }
  }

  private send(request: KernelRequest): Promise<unknown> {
    const id = this.nextId++;
    const message: KernelRequestMessage = { ...request, id };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private remember(mesh: MeshPayload): void {
    this.meshCache.set(mesh.key, mesh);
    while (this.meshCache.size > MESH_CACHE_SIZE) {
      const oldest = this.meshCache.keys().next().value;
      if (oldest === undefined) break;
      this.meshCache.delete(oldest);
    }
  }

  private touch(mesh: MeshPayload): void {
    this.meshCache.delete(mesh.key);
    this.meshCache.set(mesh.key, mesh);
  }
}

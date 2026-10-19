import type { SketchConstraint, SketchData } from '../../../shared/model/sketch.ts';
import type { SolverRequest, SolverRequestMessage, SolverResponseMessage } from '../../../sketch/protocol.ts';
import type { DragTarget, SketchSolution } from '../../../sketch/solver/index.ts';

export class SolverCrashedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolverCrashedError';
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** The parts of a Worker the client uses (lets tests run the solver in-process). */
export interface SolverWorker {
  postMessage(message: SolverRequestMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SolverResponseMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

/**
 * Runs the sketch solver in a Web Worker, so even a pathological sketch never blocks
 * the UI. The worker is restarted after a crash; pending requests are rejected.
 */
export class SolverClient {
  private readonly createWorker: () => SolverWorker;
  private worker: SolverWorker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;

  constructor(createWorker: () => SolverWorker) {
    this.createWorker = createWorker;
    this.worker = this.spawn();
  }

  async solve(sketch: SketchData, options: { drag?: DragTarget; analyze?: boolean } = {}): Promise<SketchSolution> {
    const request: SolverRequest = options.drag
      ? { type: 'solve', sketch, drag: options.drag, analyze: options.analyze ?? true }
      : { type: 'solve', sketch, analyze: options.analyze ?? true };
    return (await this.send(request)) as SketchSolution;
  }

  /** Whether adding `candidate` would over-define the sketch (it should become a driven dimension). */
  async isRedundant(sketch: SketchData, candidate: SketchConstraint): Promise<boolean> {
    return (await this.send({ type: 'redundant', sketch, candidate })) as boolean;
  }

  /** Starts dragging geometry of `sketch`; see {@link DragSession}. */
  startDrag(sketch: SketchData): DragSession {
    return new DragSession(this, sketch);
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
    this.rejectAll(new SolverCrashedError('disposed'));
  }

  private spawn(): SolverWorker {
    const worker = this.createWorker();
    worker.addEventListener('message', (event: MessageEvent<SolverResponseMessage>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      event.preventDefault();
      if (this.disposed) return;
      this.worker.terminate();
      this.rejectAll(new SolverCrashedError(event.message || 'solver worker error'));
      this.worker = this.spawn();
    });
    return worker;
  }

  private send(request: SolverRequest): Promise<unknown> {
    if (this.disposed) return Promise.reject(new SolverCrashedError('disposed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

/**
 * Interactive dragging with latest-wins scheduling: at most one solve is in flight;
 * while it runs, only the newest target is kept and older ones resolve with null.
 * Each solve starts from the previous result, so geometry follows the cursor smoothly
 * however fast the mouse moves, and the solver never builds up a backlog.
 */
export class DragSession {
  private readonly client: SolverClient;
  private base: SketchData;
  private inFlight: Promise<void> | null = null;
  private queued: { target: DragTarget; resolve(solution: SketchSolution | null): void } | null = null;
  private lastTarget: DragTarget | null = null;

  constructor(client: SolverClient, sketch: SketchData) {
    this.client = client;
    this.base = sketch;
  }

  /** Geometry after the latest finished drag step. */
  get sketch(): SketchData {
    return this.base;
  }

  /** Requests a drag step; resolves with the solution, or null if a newer move replaced it. */
  move(target: DragTarget): Promise<SketchSolution | null> {
    this.lastTarget = target;
    return new Promise((resolve) => {
      this.queued?.resolve(null);
      this.queued = { target, resolve };
      this.pump();
    });
  }

  /** Waits for outstanding steps and returns the final geometry with its definition status. */
  async end(): Promise<SketchSolution> {
    while (this.inFlight || this.queued) await (this.inFlight ?? Promise.resolve());
    const target = this.lastTarget;
    return this.client.solve(this.base, target ? { drag: target, analyze: true } : { analyze: true });
  }

  private pump(): void {
    if (this.inFlight || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    this.inFlight = this.client.solve(this.base, { drag: job.target, analyze: false }).then(
      (solution) => {
        if (solution.converged) this.base = solution.sketch;
        job.resolve(solution);
      },
      () => job.resolve(null),
    ).finally(() => {
      this.inFlight = null;
      this.pump();
    });
  }
}

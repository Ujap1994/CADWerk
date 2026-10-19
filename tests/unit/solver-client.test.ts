import { describe, expect, it } from 'vitest';
import type { SketchData } from '../../src/shared/model/sketch.ts';
import { handleSolverRequest } from '../../src/sketch/handler.ts';
import type { SolverRequestMessage, SolverResponseMessage } from '../../src/sketch/protocol.ts';
import { SolverClient, SolverCrashedError, type SolverWorker } from '../../src/renderer/src/sketch/solver-client.ts';

/** Runs the solver in-process with asynchronous replies, like a real worker. */
class FakeWorker implements SolverWorker {
  readonly requests: SolverRequestMessage[] = [];
  private readonly listeners: { message: ((event: MessageEvent<SolverResponseMessage>) => void)[]; error: ((event: ErrorEvent) => void)[] } = { message: [], error: [] };
  terminated = false;
  crashNext = false;

  postMessage(message: SolverRequestMessage): void {
    this.requests.push(structuredClone(message));
    setTimeout(() => {
      if (this.terminated) return;
      if (this.crashNext) {
        this.crashNext = false;
        for (const listener of this.listeners.error) listener({ message: 'boom', preventDefault() {} } as ErrorEvent);
        return;
      }
      const reply = handleSolverRequest(structuredClone(message));
      for (const listener of this.listeners.message) listener({ data: structuredClone(reply) } as MessageEvent<SolverResponseMessage>);
    }, 1);
  }

  addEventListener(type: 'message' | 'error', listener: never): void {
    (this.listeners[type] as unknown[]).push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new SolverClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

/** A horizontal line from the origin with a free end point. */
const line: SketchData = {
  entities: [
    { id: 'a', type: 'point', x: 0, y: 0 },
    { id: 'b', type: 'point', x: 10, y: 1 },
    { id: 'l', type: 'line', p1: 'a', p2: 'b' },
  ],
  constraints: [
    { id: 'c1', type: 'coincident', a: 'a', b: 'origin' },
    { id: 'c2', type: 'horizontal', line: 'l' },
  ],
};

function point(sketch: SketchData, id: string) {
  const entity = sketch.entities.find((e) => e.id === id);
  if (entity?.type !== 'point') throw new Error(`no point ${id}`);
  return entity;
}

describe('sketch solver client', () => {
  it('solves and analyzes in the worker', async () => {
    const { client } = setup();
    const solution = await client.solve(line);
    expect(solution.converged).toBe(true);
    expect(point(solution.sketch, 'b').y).toBeCloseTo(0, 9);
    expect(solution.status?.sketch).toBe('under');
  });

  it('checks redundancy', async () => {
    const { client } = setup();
    expect(await client.isRedundant(line, { id: 'h', type: 'horizontal', line: 'l' })).toBe(true);
    expect(await client.isRedundant(line, { id: 'd', type: 'distance', a: 'a', b: 'b', value: 5, driving: true })).toBe(false);
  });

  it('drags with latest-wins scheduling and continues from the previous result', async () => {
    const { client, workers } = setup();
    const session = client.startDrag((await client.solve(line)).sketch);
    const before = workers[0]!.requests.length;
    const moves = [1, 2, 3, 4, 5].map((i) => session.move({ kind: 'point', id: 'b', x: 10 + i, y: 3 }));
    const results = await Promise.all(moves);
    // The first move runs at once; the three in between are superseded by the last.
    expect(results.map((r) => r !== null)).toEqual([true, false, false, false, true]);
    expect(workers[0]!.requests.length - before).toBe(2);
    expect(point(session.sketch, 'b').x).toBeCloseTo(15, 6);
    expect(point(session.sketch, 'b').y).toBeCloseTo(0, 9);

    const final = await session.end();
    expect(final.status?.sketch).toBe('under');
    expect(point(final.sketch, 'b').x).toBeCloseTo(15, 6);
  });

  it('keeps the geometry when a drag cannot be honored', async () => {
    const { client } = setup();
    const fixed: SketchData = { ...line, constraints: [...line.constraints, { id: 'd', type: 'distance', a: 'a', b: 'b', value: 10, driving: true }] };
    const start = (await client.solve(fixed)).sketch;
    const session = client.startDrag(start);
    await session.move({ kind: 'point', id: 'b', x: 30, y: 0 });
    // Fully defined: the end point springs back to its solved position.
    expect(point(session.sketch, 'b').x).toBeCloseTo(10, 6);
  });

  it('restarts the worker after a crash and rejects pending requests', async () => {
    const { client, workers } = setup();
    workers[0]!.crashNext = true;
    await expect(client.solve(line)).rejects.toBeInstanceOf(SolverCrashedError);
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect((await client.solve(line)).converged).toBe(true);
  });

  it('reports solver errors without crashing', () => {
    const reply = handleSolverRequest({ id: 1, type: 'solve', sketch: null as unknown as SketchData, analyze: true });
    expect(reply.ok).toBe(false);
  });

  it('rejects requests after dispose', async () => {
    const { client } = setup();
    client.dispose();
    await expect(client.solve(line)).rejects.toBeInstanceOf(SolverCrashedError);
  });
});

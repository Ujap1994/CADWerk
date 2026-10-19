import { describe, expect, it } from 'vitest';
import { extendAt, trimAt, trimPiece } from '../../src/renderer/src/sketch/trim.ts';
import type { SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** A horizontal line crossed by two vertical lines; a circle on its right part. */
const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 100, 0),
    { id: 'h', type: 'line', p1: 'a', p2: 'b' },
    point('c', 20, -10),
    point('d', 20, 10),
    { id: 'v1', type: 'line', p1: 'c', p2: 'd' },
    point('e', 50, -10),
    point('f', 50, 10),
    { id: 'v2', type: 'line', p1: 'e', p2: 'f' },
    point('m', 80, 0),
    { id: 'k', type: 'circle', center: 'm', radius: 10 },
  ],
  constraints: [{ id: 'hz', type: 'horizontal', line: 'h' }],
};

function consistent(result: SketchData): void {
  expect(() => parseSketchData(JSON.parse(JSON.stringify(result)))).not.toThrow();
  const solution = solveSketch(result);
  expect(solution.converged).toBe(true);
  for (const entity of result.entities) {
    const solved = solution.sketch.entities.find((e) => e.id === entity.id) as SketchEntity;
    if (entity.type === 'point' && solved.type === 'point') {
      expect(solved.x).toBeCloseTo(entity.x, 6);
      expect(solved.y).toBeCloseTo(entity.y, 6);
    }
  }
}

const ends = (result: SketchData, id: string) => {
  const line = result.entities.find((e) => e.id === id);
  if (line?.type !== 'line') throw new Error(`${id} is not a line`);
  const at = (pid: string) => result.entities.find((e) => e.id === pid) as { x: number; y: number };
  return [at(line.p1), at(line.p2)].map((p) => [Math.round(p.x), Math.round(p.y)]);
};

describe('trim', () => {
  it('removes the middle piece of a line and keeps both rest pieces collinear', () => {
    const piece = trimPiece(sketch, 'h', [35, 0]);
    expect([piece?.from, piece?.to]).toEqual([0.2, 0.5]);
    const result = trimAt(sketch, 'h', [35, 0]);
    if (!result.ok) throw new Error(result.error);
    expect(ends(result.sketch, 'h')).toEqual([
      [0, 0],
      [20, 0],
    ]);
    const rest = result.sketch.entities.find((e) => e.type === 'line' && e.id !== 'h' && e.id !== 'v1' && e.id !== 'v2');
    expect(rest && ends(result.sketch, rest.id)).toEqual([
      [50, 0],
      [100, 0],
    ]);
    expect(result.sketch.constraints.map((c) => c.type).sort()).toEqual(['collinear', 'horizontal', 'pointOnLine', 'pointOnLine']);
    consistent(result.sketch);
  });

  it('shortens a line at its end and removes its loose end point', () => {
    const result = trimAt(sketch, 'h', [5, 0]);
    if (!result.ok) throw new Error(result.error);
    expect(ends(result.sketch, 'h')).toEqual([
      [20, 0],
      [100, 0],
    ]);
    expect(result.sketch.entities.some((e) => e.id === 'a')).toBe(false);
    consistent(result.sketch);
  });

  it('turns a circle into an arc and deletes curves nothing crosses', () => {
    const result = trimAt(sketch, 'k', [80, 10]);
    if (!result.ok) throw new Error(result.error);
    const arc = result.sketch.entities.find((e) => e.id === 'k');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    // The upper half was clicked: the lower half from (90, 0) round to (70, 0) remains.
    const start = result.sketch.entities.find((e) => e.id === arc.start) as { x: number; y: number };
    expect([Math.round(start.x), Math.round(start.y)]).toEqual([70, 0]);
    consistent(result.sketch);
    const lonely: SketchData = { entities: [point('p', 0, 50), point('q', 10, 50), { id: 'x', type: 'line', p1: 'p', p2: 'q' }], constraints: [] };
    const removed = trimAt(lonely, 'x', [5, 50]);
    expect(removed.ok && removed.sketch.entities).toEqual([]);
  });
});

describe('extend', () => {
  it('lengthens a line to the next curve and keeps it there', () => {
    const open: SketchData = {
      entities: [point('a', 0, 0), point('b', 30, 0), { id: 'h', type: 'line', p1: 'a', p2: 'b' }, point('c', 50, -10), point('d', 50, 10), { id: 'v', type: 'line', p1: 'c', p2: 'd' }],
      constraints: [],
    };
    const result = extendAt(open, 'h', [28, 0]);
    if (!result.ok) throw new Error(result.error);
    expect(ends(result.sketch, 'h')).toEqual([
      [0, 0],
      [50, 0],
    ]);
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnLine', point: 'b', line: 'v' })]);
    consistent(result.sketch);
    expect(extendAt(open, 'h', [2, 0])).toEqual({ ok: false, error: 'no-target' });
  });

  it('refuses ends that other curves share or that constraints hold', () => {
    const connected: SketchData = {
      entities: [point('a', 0, 0), point('b', 30, 0), point('z', 30, 20), { id: 'h', type: 'line', p1: 'a', p2: 'b' }, { id: 'up', type: 'line', p1: 'b', p2: 'z' }, point('c', 50, -10), point('d', 50, 10), { id: 'v', type: 'line', p1: 'c', p2: 'd' }],
      constraints: [],
    };
    expect(extendAt(connected, 'h', [28, 0])).toEqual({ ok: false, error: 'connected' });
    const held: SketchData = { ...connected, entities: connected.entities.filter((e) => e.id !== 'up' && e.id !== 'z'), constraints: [{ id: 'fx', type: 'fix', point: 'b' }] };
    expect(extendAt(held, 'h', [28, 0])).toEqual({ ok: false, error: 'constrained' });
  });
});

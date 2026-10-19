import { describe, expect, it } from 'vitest';
import { chamferCorner, cornerAt, filletCorner } from '../../src/renderer/src/sketch/corners.ts';
import { ORIGIN_ID, type SketchData } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** A 50 × 30 rectangle with its first corner at the origin, fully defined. */
const rectangle: SketchData = {
  entities: [
    point('b', 50, 0),
    point('c', 50, 30),
    point('d', 0, 30),
    { id: 'l1', type: 'line', p1: ORIGIN_ID, p2: 'b' },
    { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
    { id: 'l3', type: 'line', p1: 'c', p2: 'd' },
    { id: 'l4', type: 'line', p1: 'd', p2: ORIGIN_ID },
  ],
  constraints: [
    { id: 'h1', type: 'horizontal', line: 'l1' },
    { id: 'v1', type: 'vertical', line: 'l2' },
    { id: 'h2', type: 'horizontal', line: 'l3' },
    { id: 'v2', type: 'vertical', line: 'l4' },
    { id: 'w', type: 'distance', a: ORIGIN_ID, b: 'b', value: 50, driving: true },
    { id: 'h', type: 'distance', a: 'b', b: 'c', value: 30, driving: true },
  ],
};

function expectValidAndSolved(sketch: SketchData): void {
  expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
  const solution = solveSketch(sketch);
  expect(solution.converged).toBe(true);
  expect(solution.unsatisfied).toEqual([]);
  // Nothing moves: the result already satisfies everything.
  for (const entity of sketch.entities) {
    const solved = solution.sketch.entities.find((e) => e.id === entity.id);
    if (entity.type === 'point' && solved?.type === 'point') {
      expect(solved.x).toBeCloseTo(entity.x, 6);
      expect(solved.y).toBeCloseTo(entity.y, 6);
    }
  }
  expect(solution.status?.sketch).toBe('full');
}

describe('corners', () => {
  it('finds the two lines of a corner', () => {
    expect(cornerAt(rectangle, 'b')?.first.id).toBe('l1');
    expect(cornerAt(rectangle, 'nothing')).toBeNull();
  });

  it('rounds a corner with a tangent arc and keeps the sketch fully defined', () => {
    const result = filletCorner(rectangle, 'b', 5);
    if (!result.ok) throw new Error(result.error);
    const sketch = result.sketch;
    const arc = sketch.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const at = (id: string) => sketch.entities.find((e) => e.id === id) as { x: number; y: number };
    const near = (actual: { x: number; y: number }, x: number, y: number) => {
      expect(actual.x).toBeCloseTo(x, 9);
      expect(actual.y).toBeCloseTo(y, 9);
    };
    near(at(arc.center), 45, 5);
    // The lines end at the tangent points; the old corner stays as a virtual sharp on both.
    const l1 = sketch.entities.find((e) => e.id === 'l1');
    const l2 = sketch.entities.find((e) => e.id === 'l2');
    if (l1?.type !== 'line' || l2?.type !== 'line') throw new Error('lines missing');
    near(at(l1.p2), 45, 0);
    near(at(l2.p1), 50, 5);
    expect(sketch.constraints.filter((c) => c.type === 'pointOnLine').map((c) => (c as { point: string }).point)).toEqual(['b', 'b']);
    expect(sketch.constraints.filter((c) => c.type === 'tangent')).toHaveLength(2);
    expect(sketch.constraints.find((c) => c.type === 'radius')).toMatchObject({ value: 5, driving: true });
    expectValidAndSolved(sketch);
  });

  it('rounds the corner at the origin, too', () => {
    const result = filletCorner(rectangle, ORIGIN_ID, 4);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.constraints.filter((c) => c.type === 'pointOnLine').map((c) => (c as { point: string }).point)).toEqual([ORIGIN_ID, ORIGIN_ID]);
    expectValidAndSolved(result.sketch);
  });

  it('bevels a corner with two dimensioned distances', () => {
    const result = chamferCorner(rectangle, 'c', 6);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.entities.filter((e) => e.type === 'line')).toHaveLength(5);
    expect(result.sketch.constraints.filter((c) => c.type === 'distance' && (c as { a: string }).a === 'c')).toHaveLength(2);
    expectValidAndSolved(result.sketch);
  });

  it('refuses radii and distances that do not fit, and points that are no corner', () => {
    expect(filletCorner(rectangle, 'b', 40)).toEqual({ ok: false, error: 'too-large' });
    expect(chamferCorner(rectangle, 'b', 30)).toEqual({ ok: false, error: 'too-large' });
    const straight: SketchData = {
      entities: [point('a', 0, 0), point('m', 10, 0), point('z', 20, 0), { id: 'x', type: 'line', p1: 'a', p2: 'm' }, { id: 'y', type: 'line', p1: 'm', p2: 'z' }],
      constraints: [],
    };
    expect(filletCorner(straight, 'm', 2)).toEqual({ ok: false, error: 'straight' });
    expect(filletCorner(rectangle, 'nothing', 2)).toEqual({ ok: false, error: 'not-a-corner' });
  });
});

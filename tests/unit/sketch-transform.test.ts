import { describe, expect, it } from 'vitest';
import { circularPattern, copySelection, linearPattern, mirrorAxis, mirrorSelection, movedPoints } from '../../src/renderer/src/sketch/transform.ts';
import type { SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** A vertical centerline, a polyline that starts on it, an arc and a circle on its right. */
const sketch: SketchData = {
  entities: [
    point('c1', 0, -50),
    point('c2', 0, 50),
    { id: 'axis', type: 'line', p1: 'c1', p2: 'c2', construction: true },
    point('a', 0, 0),
    point('b', 30, 0),
    point('e', 30, 20),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'l2', type: 'line', p1: 'b', p2: 'e' },
    point('ac', 30, 30),
    point('as', 30, 20),
    point('ae', 20, 30),
    { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
    point('m', 40, -20),
    { id: 'k', type: 'circle', center: 'm', radius: 5 },
  ],
  constraints: [],
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

const added = (result: SketchData) => result.entities.slice(sketch.entities.length);
const xy = (result: SketchData, id: string) => {
  const p = result.entities.find((e) => e.id === id) as { x: number; y: number };
  return [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6];
};

describe('mirror', () => {
  it('takes the construction line (or the last line) of the selection as the axis', () => {
    expect(mirrorAxis(sketch, ['l1', 'axis', 'l2'])).toBe('axis');
    expect(mirrorAxis(sketch, ['k', 'l1'])).toBe('l1');
    expect(mirrorAxis(sketch, ['l1'])).toBeNull();
  });

  it('mirrors lines, arcs and circles with symmetric relations, sharing points on the axis', () => {
    const result = mirrorSelection(sketch, ['l1', 'l2', 'arc', 'k', 'axis']);
    if (!result.ok) throw new Error(result.error);
    const copies = added(result.sketch);
    expect(copies.filter((e) => e.type === 'line')).toHaveLength(2);
    // The mirrored first line starts at the shared point on the axis.
    const firstCopy = copies.find((e) => e.type === 'line');
    expect(firstCopy?.type === 'line' && firstCopy.p1).toBe('a');
    const mirroredArc = copies.find((e) => e.type === 'arc');
    if (mirroredArc?.type !== 'arc') throw new Error('no arc');
    // Mirroring reverses the direction: the copy runs from the image of the end to the image of the start.
    expect(xy(result.sketch, mirroredArc.start)).toEqual([-20, 30]);
    expect(xy(result.sketch, mirroredArc.center)).toEqual([-30, 30]);
    const relations = result.sketch.constraints.map((c) => c.type);
    // b, e, the arc's three points and the circle's center; a lies on the axis and is shared.
    expect(relations.filter((t) => t === 'symmetric')).toHaveLength(6);
    expect(relations).toContain('equal');
    consistent(result.sketch);
  });

  it('refuses without an axis or without anything to mirror', () => {
    expect(mirrorSelection(sketch, ['k'])).toEqual({ ok: false, error: 'no-axis' });
    expect(mirrorSelection(sketch, ['axis'])).toEqual({ ok: false, error: 'nothing-selected' });
  });
});

describe('patterns and copies', () => {
  it('repeats a circle in a row with equal radii', () => {
    const result = linearPattern(sketch, ['k'], [15, 0], 4);
    if (!result.ok) throw new Error(result.error);
    const circles = result.sketch.entities.filter((e) => e.type === 'circle');
    expect(circles).toHaveLength(4);
    expect(circles.map((c) => (c.type === 'circle' ? xy(result.sketch, c.center)[0] : 0))).toEqual([40, 55, 70, 85]);
    expect(result.sketch.constraints.filter((c) => c.type === 'equal')).toHaveLength(3);
    consistent(result.sketch);
  });

  it('spreads copies evenly around a center', () => {
    const full = circularPattern(sketch, ['k'], [0, 0], 6);
    if (!full.ok) throw new Error(full.error);
    const centers = full.sketch.entities.filter((e) => e.type === 'circle').map((c) => (c.type === 'circle' ? xy(full.sketch, c.center) : [0, 0]));
    expect(centers).toHaveLength(6);
    for (const [x, y] of centers) expect(Math.hypot(x as number, y as number)).toBeCloseTo(Math.hypot(40, 20), 6);
    consistent(full.sketch);
    // Over 90° the first and last copy sit at both ends.
    const quarter = circularPattern(sketch, ['k'], [0, 0], 3, Math.PI / 2);
    if (!quarter.ok) throw new Error(quarter.error);
    const last = quarter.sketch.entities.filter((e) => e.type === 'circle').at(-1);
    expect(last?.type === 'circle' && xy(quarter.sketch, last.center)).toEqual([20, 40]);
  });

  it('copies and moves the selection', () => {
    const copied = copySelection(sketch, ['l1', 'l2'], [0, -60]);
    if (!copied.ok) throw new Error(copied.error);
    expect(added(copied.sketch).filter((e) => e.type === 'line')).toHaveLength(2);
    expect(added(copied.sketch).filter((e) => e.type === 'point').map((p) => xy(copied.sketch, p.id))).toEqual([
      [0, -60],
      [30, -60],
      [30, -40],
    ]);
    const moves = movedPoints(sketch, ['l2'], [5, 0], Math.PI / 2, [30, 0]);
    expect(moves.map((m) => [Math.round(m.x), Math.round(m.y)])).toEqual([
      [35, 0],
      [15, 0],
    ]);
    expect(linearPattern(sketch, [], [1, 0], 3)).toEqual({ ok: false, error: 'nothing-selected' });
  });
});

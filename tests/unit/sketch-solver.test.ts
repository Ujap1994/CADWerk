import { describe, expect, it } from 'vitest';
import type { SketchConstraint, SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { ORIGIN_ID } from '../../src/shared/model/sketch.ts';
import { buildSystem } from '../../src/sketch/solver/equations.ts';
import { isRedundant, solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });

/** A rectangle p1..p4 with lines and the usual relations (like the rectangle tool creates). */
function rectangle(prefix: string, x: number, y: number, w: number, h: number, jitter = 0): SketchData {
  const j = (k: number) => jitter * Math.sin(k * 12.9898 + x * 0.1 + y * 0.37);
  const p = [`${prefix}p1`, `${prefix}p2`, `${prefix}p3`, `${prefix}p4`];
  const l = [`${prefix}l1`, `${prefix}l2`, `${prefix}l3`, `${prefix}l4`];
  const entities: SketchEntity[] = [
    point(p[0] as string, x + j(1), y + j(2)),
    point(p[1] as string, x + w + j(3), y + j(4)),
    point(p[2] as string, x + w + j(5), y + h + j(6)),
    point(p[3] as string, x + j(7), y + h + j(8)),
    line(l[0] as string, p[0] as string, p[1] as string),
    line(l[1] as string, p[1] as string, p[2] as string),
    line(l[2] as string, p[2] as string, p[3] as string),
    line(l[3] as string, p[3] as string, p[0] as string),
  ];
  const constraints: SketchConstraint[] = [
    { id: `${prefix}h1`, type: 'horizontal', line: l[0] as string },
    { id: `${prefix}v1`, type: 'vertical', line: l[1] as string },
    { id: `${prefix}h2`, type: 'horizontal', line: l[2] as string },
    { id: `${prefix}v2`, type: 'vertical', line: l[3] as string },
  ];
  return { entities, constraints };
}

function pointOf(sketch: SketchData, id: string): [number, number] {
  const entity = sketch.entities.find((e) => e.id === id);
  if (entity?.type !== 'point') throw new Error(`no point ${id}`);
  return [entity.x, entity.y];
}

function residualMax(sketch: SketchData): number {
  const system = buildSystem(sketch.entities, sketch.constraints);
  return Math.max(0, ...system.equations.map((e) => Math.abs(e.residual(system.values))));
}

describe('definition status', () => {
  it('reports an unconstrained point and line as under-defined', () => {
    const result = solveSketch({ entities: [point('a', 1, 2), point('b', 5, 6), line('l', 'a', 'b')], constraints: [] });
    expect(result.status?.sketch).toBe('under');
    expect(result.status?.entities.l).toBe('under');
  });

  it('reports a dimensioned rectangle anchored at the origin as fully defined', () => {
    const rect = rectangle('r', 0, 0, 100, 60, 0);
    rect.constraints.push(
      { id: 'anchor', type: 'coincident', a: 'rp1', b: ORIGIN_ID },
      { id: 'width', type: 'distance', a: 'rp1', b: 'rp2', value: 100, driving: true },
      { id: 'height', type: 'distance', a: 'rp2', b: 'rp3', value: 60, driving: true },
    );
    const result = solveSketch(rect);
    expect(result.converged).toBe(true);
    expect(result.status?.sketch).toBe('full');
    for (const id of ['rl1', 'rl2', 'rl3', 'rl4', 'rp1', 'rp3']) expect(result.status?.entities[id]).toBe('full');
  });

  it('keeps a rectangle without anchor under-defined (it can still move)', () => {
    const rect = rectangle('r', 10, 10, 100, 60);
    rect.constraints.push(
      { id: 'width', type: 'distance', a: 'rp1', b: 'rp2', value: 100, driving: true },
      { id: 'height', type: 'distance', a: 'rp2', b: 'rp3', value: 60, driving: true },
    );
    expect(solveSketch(rect).status?.sketch).toBe('under');
  });

  it('marks partially defined geometry individually', () => {
    // A horizontal line from the origin with fixed length: fully defined. A second free line: under.
    const sketch: SketchData = {
      entities: [point('a', 0, 0), point('b', 50, 3), line('l', 'a', 'b'), point('c', 10, 10), point('d', 20, 30), line('m', 'c', 'd')],
      constraints: [
        { id: 'o', type: 'coincident', a: 'a', b: ORIGIN_ID },
        { id: 'h', type: 'horizontal', line: 'l' },
        { id: 'len', type: 'distance', a: 'a', b: 'b', value: 50, driving: true },
      ],
    };
    const result = solveSketch(sketch);
    expect(result.status?.entities.l).toBe('full');
    expect(result.status?.entities.m).toBe('under');
  });
});

describe('solving', () => {
  it('applies a changed dimension with the smallest change', () => {
    const rect = rectangle('r', 0, 0, 100, 60);
    rect.constraints.push(
      { id: 'anchor', type: 'coincident', a: 'rp1', b: ORIGIN_ID },
      { id: 'width', type: 'distance', a: 'rp1', b: 'rp2', value: 150, driving: true },
      { id: 'height', type: 'distance', a: 'rp2', b: 'rp3', value: 60, driving: true },
    );
    const result = solveSketch(rect);
    expect(result.converged).toBe(true);
    const [x2] = pointOf(result.sketch, 'rp2');
    const [, y3] = pointOf(result.sketch, 'rp3');
    expect(x2).toBeCloseTo(150, 6);
    expect(y3).toBeCloseTo(60, 6);
  });

  it('satisfies every relation type from a perturbed start', () => {
    const sketch: SketchData = {
      entities: [
        point('a', 0, 0), point('b', 40, 5), line('l1', 'a', 'b'),
        point('c', 5, 30), point('d', 38, 36), line('l2', 'c', 'd'),
        point('e', 60, 0), point('f', 62, 40), line('l3', 'e', 'f'),
        point('cc', 100, 20), { id: 'circle', type: 'circle', center: 'cc', radius: 12 },
        point('ac', 20, 80), point('as', 35, 80), point('ae', 20, 96), { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
        point('m', 22, 3), point('s1', 70, 60), point('s2', 90, 64), point('on', 101, 33),
      ],
      constraints: [
        { id: 'h', type: 'horizontal', line: 'l1' },
        { id: 'par', type: 'parallel', a: 'l1', b: 'l2' },
        { id: 'perp', type: 'perpendicular', a: 'l1', b: 'l3' },
        { id: 'eq', type: 'equal', a: 'l1', b: 'l2' },
        { id: 'mid', type: 'midpoint', point: 'm', line: 'l1' },
        { id: 'tan', type: 'tangent', a: 'l3', b: 'circle' },
        { id: 'sym', type: 'symmetric', a: 's1', b: 's2', line: 'l3' },
        { id: 'onc', type: 'pointOnCircle', point: 'on', circle: 'circle' },
        { id: 'eqr', type: 'equal', a: 'circle', b: 'arc' },
        { id: 'r', type: 'radius', circle: 'circle', value: 15, driving: true },
        { id: 'ang', type: 'angle', a: 'l1', b: 'l2', value: 0, driving: false },
        { id: 'dist', type: 'distance', a: 'c', b: 'l1', value: 30, driving: true },
      ],
    };
    const result = solveSketch(sketch);
    expect(result.unsatisfied).toEqual([]);
    expect(result.converged).toBe(true);
    expect(residualMax(result.sketch)).toBeLessThan(1e-7);
    const circle = result.sketch.entities.find((e) => e.id === 'circle');
    expect(circle?.type === 'circle' && circle.radius).toBeCloseTo(15, 6);
  });

  it('keeps arcs consistent (start and end on the same radius)', () => {
    const sketch: SketchData = {
      entities: [point('c', 0, 0), point('s', 10, 0), point('e', 0, 14), { id: 'arc', type: 'arc', center: 'c', start: 's', end: 'e' }],
      constraints: [],
    };
    const result = solveSketch(sketch);
    const [cx, cy] = pointOf(result.sketch, 'c');
    const [sx, sy] = pointOf(result.sketch, 's');
    const [ex, ey] = pointOf(result.sketch, 'e');
    expect(Math.hypot(sx - cx, sy - cy)).toBeCloseTo(Math.hypot(ex - cx, ey - cy), 7);
  });
});

describe('dragging', () => {
  it('lets under-defined geometry follow the cursor', () => {
    const sketch: SketchData = { entities: [point('a', 0, 0), point('b', 50, 0), line('l', 'a', 'b')], constraints: [{ id: 'h', type: 'horizontal', line: 'l' }] };
    const result = solveSketch(sketch, { drag: { kind: 'point', id: 'b', x: 70, y: 20 }, analyze: false });
    expect(result.converged).toBe(true);
    const [bx, by] = pointOf(result.sketch, 'b');
    const [, ay] = pointOf(result.sketch, 'a');
    // b moves to the cursor; the horizontal relation pulls a along instead of pushing b back.
    expect(bx).toBeCloseTo(70, 3);
    expect(by).toBeCloseTo(20, 1);
    expect(ay).toBeCloseTo(by, 7);
  });

  it('does not move fully defined geometry', () => {
    const sketch: SketchData = {
      entities: [point('a', 0, 0), point('b', 50, 0), line('l', 'a', 'b')],
      constraints: [
        { id: 'o', type: 'coincident', a: 'a', b: ORIGIN_ID },
        { id: 'h', type: 'horizontal', line: 'l' },
        { id: 'len', type: 'distance', a: 'a', b: 'b', value: 50, driving: true },
      ],
    };
    const result = solveSketch(sketch, { drag: { kind: 'point', id: 'b', x: 80, y: 30 }, analyze: false });
    const [bx, by] = pointOf(result.sketch, 'b');
    expect(Math.hypot(bx - 50, by)).toBeLessThan(1e-6);
  });

  it('moves a whole line by dragging both end points together', () => {
    const sketch: SketchData = {
      entities: [point('a', 0, 0), point('b', 50, 0), line('l', 'a', 'b')],
      constraints: [
        { id: 'h', type: 'horizontal', line: 'l' },
        { id: 'len', type: 'distance', a: 'a', b: 'b', value: 50, driving: true },
      ],
    };
    const drag = { kind: 'points' as const, points: [{ id: 'a', x: 10, y: 15 }, { id: 'b', x: 60, y: 15 }] };
    const result = solveSketch(sketch, { drag, analyze: false });
    expect(result.converged).toBe(true);
    expect(pointOf(result.sketch, 'a')[0]).toBeCloseTo(10, 6);
    expect(pointOf(result.sketch, 'a')[1]).toBeCloseTo(15, 6);
    expect(pointOf(result.sketch, 'b')[0]).toBeCloseTo(60, 6);
  });

  it('changes a circle radius by dragging its edge', () => {
    const sketch: SketchData = { entities: [point('c', 0, 0), { id: 'k', type: 'circle', center: 'c', radius: 10 }], constraints: [] };
    const result = solveSketch(sketch, { drag: { kind: 'radius', id: 'k', radius: 25 } });
    const circle = result.sketch.entities.find((e) => e.id === 'k');
    expect(circle?.type === 'circle' && circle.radius).toBeCloseTo(25, 6);
  });
});

describe('over-definition', () => {
  const fullRectangle = () => {
    const rect = rectangle('r', 0, 0, 100, 60);
    rect.constraints.push(
      { id: 'anchor', type: 'coincident', a: 'rp1', b: ORIGIN_ID },
      { id: 'width', type: 'distance', a: 'rp1', b: 'rp2', value: 100, driving: true },
      { id: 'height', type: 'distance', a: 'rp2', b: 'rp3', value: 60, driving: true },
    );
    return rect;
  };

  it('reports conflicting dimensions and keeps the geometry unchanged', () => {
    const rect = fullRectangle();
    rect.constraints.push({ id: 'conflict', type: 'horizontalDistance', a: 'rp1', b: 'rp2', value: 80, driving: true });
    const result = solveSketch(rect);
    expect(result.converged).toBe(false);
    expect(result.unsatisfied.length).toBeGreaterThan(0);
    expect(result.status?.sketch).toBe('over');
    expect(pointOf(result.sketch, 'rp2')[0]).toBeCloseTo(100, 6);
  });

  it('detects redundant constraints before they are added', () => {
    const rect = fullRectangle();
    const diagonal: SketchConstraint = { id: 'diag', type: 'distance', a: 'rp1', b: 'rp3', value: Math.hypot(100, 60), driving: true };
    expect(isRedundant(rect.entities, rect.constraints, diagonal)).toBe(true);
    const horizontalAgain: SketchConstraint = { id: 'h-again', type: 'horizontal', line: 'rl1' };
    expect(isRedundant(rect.entities, rect.constraints, horizontalAgain)).toBe(true);
    const free = rectangle('r', 0, 0, 100, 60);
    const width: SketchConstraint = { id: 'w', type: 'distance', a: 'rp1', b: 'rp2', value: 100, driving: true };
    expect(isRedundant(free.entities, free.constraints, width)).toBe(false);
  });

  it('reports missing references instead of failing', () => {
    const result = solveSketch({ entities: [point('a', 0, 0)], constraints: [{ id: 'bad', type: 'horizontal', line: 'nope' }] });
    expect(result.invalid).toEqual(['bad']);
  });
});

describe('scale', () => {
  it('solves many independent rectangles quickly (decomposition)', () => {
    const sketch: SketchData = { entities: [], constraints: [] };
    for (let i = 0; i < 200; i++) {
      const rect = rectangle(`k${i}_`, (i % 20) * 150, Math.floor(i / 20) * 100, 100, 60, 2);
      sketch.entities.push(...rect.entities);
      sketch.constraints.push(...rect.constraints, { id: `k${i}_w`, type: 'distance', a: `k${i}_p1`, b: `k${i}_p2`, value: 100, driving: true });
    }
    const start = performance.now();
    const result = solveSketch(sketch);
    const elapsed = performance.now() - start;
    expect(result.converged).toBe(true);
    expect(result.status?.sketch).toBe('under');
    expect(elapsed).toBeLessThan(2000);
  });
});

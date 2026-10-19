import { describe, expect, it } from 'vitest';
import { dragTarget } from '../../src/renderer/src/sketch/drag.ts';
import { dxfToSketch, sketchToDxf } from '../../src/renderer/src/sketch/dxf.ts';
import { curvePolyline, deleteEntities, hitTest, pointPositions, splineOf } from '../../src/renderer/src/sketch/geometry.ts';
import { snapCursor } from '../../src/renderer/src/sketch/snap.ts';
import { segmentsPerSpan, splineLength, splinePoint, splinePolyline, splineThrough } from '../../src/renderer/src/sketch/spline.ts';
import { createTool, type ToolEvent } from '../../src/renderer/src/sketch/tools.ts';
import { linearPattern } from '../../src/renderer/src/sketch/transform.ts';
import type { SketchData, SketchSpline } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });
const EMPTY: SketchData = { entities: [], constraints: [] };

const base: SketchData = {
  entities: [point('a', 0, 0), point('b', 20, 15), point('c', 40, 0), point('d', 60, 10), { id: 's', type: 'spline', points: ['a', 'b', 'c', 'd'] }],
  constraints: [],
};

describe('spline math', () => {
  it('passes through its fit points with continuous curvature and straight ends', () => {
    const spline = splineThrough([[0, 0], [20, 15], [40, 0], [60, 10]]);
    if (!spline) throw new Error('no spline');
    spline.points.forEach(([x, y], i) => {
      expect(splinePoint(spline, spline.knots[i] as number)).toEqual([expect.closeTo(x, 9), expect.closeTo(y, 9)]);
    });
    // Natural end conditions: no bending at the ends.
    expect(spline.second[0]).toEqual([0, 0]);
    expect(spline.second.at(-1)).toEqual([0, 0]);
    // C1 and C2 at an inner point: one-sided differences agree.
    const k = spline.knots[1] as number;
    const e = 1e-4;
    const [p0, p1, p2] = [splinePoint(spline, k - e), splinePoint(spline, k), splinePoint(spline, k + e)];
    const left = [(p1[0] - p0[0]) / e, (p1[1] - p0[1]) / e];
    const right = [(p2[0] - p1[0]) / e, (p2[1] - p1[1]) / e];
    expect(right[0]).toBeCloseTo(left[0] as number, 2);
    expect(right[1]).toBeCloseTo(left[1] as number, 2);
  });

  it('is a straight line through two points and ignores repeated points', () => {
    const spline = splineThrough([[0, 0], [0, 0], [10, 10]]);
    if (!spline) throw new Error('no spline');
    expect(spline.points).toHaveLength(2);
    expect(splinePoint(spline, (spline.knots[1] as number) / 2)).toEqual([expect.closeTo(5, 9), expect.closeTo(5, 9)]);
    expect(splineThrough([[1, 1], [1, 1]])).toBeNull();
  });

  it('is tessellated within the tolerance', () => {
    const spline = splineThrough([[0, 0], [20, 15], [40, 0], [60, 10]]);
    if (!spline) throw new Error('no spline');
    const perSpan = segmentsPerSpan(spline, 0.01);
    const coarse = splinePolyline(spline, perSpan);
    const fine = splinePolyline(spline, 400);
    // Every point of the true curve is within the tolerance of the coarse polyline.
    const distance = (p: readonly number[]) =>
      Math.min(
        ...coarse.slice(1).map((b, i) => {
          const a = coarse[i] as readonly number[];
          const [dx, dy] = [(b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number)];
          const t = Math.max(0, Math.min(1, (((p[0] as number) - (a[0] as number)) * dx + ((p[1] as number) - (a[1] as number)) * dy) / (dx * dx + dy * dy)));
          return Math.hypot((p[0] as number) - (a[0] as number) - t * dx, (p[1] as number) - (a[1] as number) - t * dy);
        }),
      );
    expect(Math.max(...fine.map(distance))).toBeLessThan(0.0105);
    expect(splineLength(spline)).toBeGreaterThan(Math.hypot(20, 15) + Math.hypot(20, 15) + Math.hypot(20, 10));
  });
});

describe('splines in sketches', () => {
  it('are valid in files, need at least two points and are drawn through their points', () => {
    expect(() => parseSketchData(JSON.parse(JSON.stringify(base)))).not.toThrow();
    expect(() => parseSketchData({ entities: [point('a', 0, 0), { id: 's', type: 'spline', points: ['a'] }], constraints: [] })).toThrow();
    expect(() => parseSketchData({ entities: [point('a', 0, 0), { id: 's', type: 'spline', points: ['a', 'zz'] }], constraints: [] })).toThrow();
    const polyline = curvePolyline(base.entities[4] as SketchSpline, pointPositions(base), 0.05) ?? [];
    expect(polyline[0]).toEqual([0, 0]);
    expect(polyline.at(-1)).toEqual([60, 10]);
  });

  it('are picked at the curve and follow their points in the solver', () => {
    const positions = pointPositions(base);
    const spline = splineOf(base.entities[4] as SketchSpline, positions);
    if (!spline) throw new Error('no spline');
    const on = splinePoint(spline, ((spline.knots[1] as number) + (spline.knots[2] as number)) / 2);
    expect(hitTest(base, positions, on[0], on[1] + 0.2, 0.5)?.id).toBe('s');
    const result = solveSketch({ ...base, constraints: [{ id: 'h', type: 'horizontalPoints', a: 'a', b: 'c' }, { id: 'o', type: 'coincident', a: 'a', b: 'origin' }] });
    expect(result.converged).toBe(true);
    expect(result.status?.entities.s).toBe('under');
    const full = solveSketch({ ...base, constraints: ['a', 'b', 'c', 'd'].map((id) => ({ id: `f${id}`, type: 'fix' as const, point: id })) });
    expect(full.status?.entities.s).toBe('full');
  });

  it('snap only at their fit points (no relation keeps a point on a spline yet)', () => {
    const positions = pointPositions(base);
    const spline = splineOf(base.entities[4] as SketchSpline, positions);
    if (!spline) throw new Error('no spline');
    const on = splinePoint(spline, ((spline.knots[1] as number) + (spline.knots[2] as number)) / 2);
    expect(snapCursor(base, positions, on[0], on[1], { tolerance: 1, alignTolerance: 0.1 }).target.kind).not.toBe('curve');
    expect(snapCursor(base, positions, 20.3, 15.2, { tolerance: 1, alignTolerance: 0.1 }).target).toEqual({ kind: 'point', id: 'b' });
  });

  it('are drawn point by point, each point one undo step, and ended by a second click', () => {
    const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.6 });
    const tool = createTool('spline');
    let sketch = EMPTY;
    const steps: SketchData[] = [];
    for (const [u, v] of [[0, 0], [20, 15], [40, 3], [60, 12], [60, 12]] as const) {
      tool.hover(sketch, event(u, v));
      const step = tool.click(sketch, event(u, v));
      if (step.commit) {
        sketch = step.commit;
        steps.push(sketch);
      }
    }
    expect(steps).toHaveLength(3);
    expect(tool.busy).toBe(false);
    const splines = sketch.entities.filter((entity) => entity.type === 'spline');
    expect(splines).toHaveLength(1);
    expect((splines[0] as SketchSpline).points).toHaveLength(4);
    // The first point snapped to the origin.
    expect((splines[0] as SketchSpline).points[0]).toBe('origin');
    expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
  });

  it('move as a whole when dragged, are copied by patterns and vanish with their points', () => {
    const target = dragTarget(base, { id: 's', type: 'spline', distance: 0 }, { u: 30, v: 5 }, { u: 35, v: 5 });
    expect(target).toMatchObject({ kind: 'points' });
    expect(target?.kind === 'points' ? target.points.map((p) => p.x) : []).toEqual([5, 25, 45, 65]);
    const result = linearPattern(base, ['s'], [0, 50], 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.entities.filter((entity) => entity.type === 'spline')).toHaveLength(2);
    expect(deleteEntities(base, ['c']).entities.some((entity) => entity.type === 'spline')).toBe(false);
  });
});

describe('DXF', () => {
  it('exports splines as fine open polylines and imports fit-point splines', () => {
    const { text, entities } = sketchToDxf(base);
    expect(entities).toBe(1);
    expect(text).toContain('POLYLINE');
    const text2 = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '74', '3', '11', '0', '21', '0', '31', '0', '11', '20', '21', '15', '31', '0', '11', '40', '21', '0', '31', '0',
      '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '73', '4', '10', '0', '20', '0', '30', '0', '10', '1', '20', '1', '30', '0',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const result = dxfToSketch(text2, EMPTY);
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual({ SPLINE: 1 });
    const spline = result.sketch.entities.find((entity) => entity.type === 'spline') as SketchSpline;
    expect(spline.points).toHaveLength(3);
  });
});

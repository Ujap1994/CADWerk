import { describe, expect, it } from 'vitest';
import {
  arcGeometry,
  curvePolyline,
  deleteEntities,
  distanceToCurve,
  hitTest,
  pointPositions,
  segmentCount,
} from '../../src/renderer/src/sketch/geometry.ts';
import { ORIGIN_ID, type SketchData } from '../../src/shared/model/sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** Two lines sharing a corner, a circle and a quarter arc. */
const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 50, 0),
    point('c', 50, 30),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
    point('m', 100, 0),
    { id: 'k', type: 'circle', center: 'm', radius: 10 },
    point('ac', 0, 100),
    point('as', 20, 100),
    point('ae', 0, 120),
    { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
    point('free', -40, -40),
  ],
  constraints: [
    { id: 'h', type: 'horizontal', line: 'l1' },
    { id: 'v', type: 'vertical', line: 'l2' },
    { id: 'o', type: 'coincident', a: 'a', b: ORIGIN_ID },
    { id: 'r', type: 'radius', circle: 'k', value: 10, driving: true },
  ],
};
const positions = pointPositions(sketch);

describe('sketch display geometry', () => {
  it('measures arcs counterclockwise from start to end', () => {
    const quarter = arcGeometry([0, 0], [1, 0], [0, 1]);
    expect(quarter.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(arcGeometry([0, 0], [0, 1], [1, 0]).sweep).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(arcGeometry([0, 0], [1, 0], [1, 0]).sweep).toBeCloseTo(2 * Math.PI, 12);
  });

  it('tessellates circles finely enough for the zoom level, within limits', () => {
    const coarse = segmentCount(10, 2 * Math.PI, 1);
    const fine = segmentCount(10, 2 * Math.PI, 0.001);
    expect(fine).toBeGreaterThan(coarse);
    expect(fine).toBeLessThanOrEqual(720);
    expect(segmentCount(1e-6, 2 * Math.PI, 1)).toBeGreaterThanOrEqual(12);
    // The polyline stays within the allowed deviation (0.2 px).
    const circle = sketch.entities.find((e) => e.id === 'k');
    if (circle?.type !== 'circle') throw new Error('circle missing');
    const polyline = curvePolyline(circle, positions, 0.05);
    if (!polyline) throw new Error('no polyline');
    for (let i = 1; i < polyline.length; i++) {
      const [x0, y0] = polyline[i - 1] as readonly [number, number];
      const [x1, y1] = polyline[i] as readonly [number, number];
      const middle = Math.hypot((x0 + x1) / 2 - 100, (y0 + y1) / 2);
      expect(10 - middle).toBeLessThanOrEqual(0.2 * 0.05 + 1e-9);
    }
    expect(polyline[0]?.[0]).toBeCloseTo(110, 12);
    expect(polyline.at(-1)?.[0]).toBeCloseTo(110, 12);
  });

  it('measures distances to lines, circles and arcs', () => {
    const [line, , circle, arc] = ['l1', 'l2', 'k', 'arc'].map((id) => {
      const entity = sketch.entities.find((e) => e.id === id);
      if (!entity || entity.type === 'point') throw new Error(id);
      return entity;
    }) as [never, never, never, never];
    expect(distanceToCurve(line, positions, 25, 4)).toBeCloseTo(4, 12);
    expect(distanceToCurve(line, positions, -3, 4)).toBeCloseTo(5, 12);
    expect(distanceToCurve(circle, positions, 100, 0)).toBeCloseTo(10, 12);
    expect(distanceToCurve(circle, positions, 113, 0)).toBeCloseTo(3, 12);
    // On the arc's side: distance to the circle; outside its sweep: distance to the nearer end.
    expect(distanceToCurve(arc, positions, 15, 115)).toBeCloseTo(Math.hypot(15, 15) - 20, 12);
    expect(distanceToCurve(arc, positions, 0, 80)).toBeCloseTo(Math.hypot(20, 20), 12);
  });
});

describe('sketch hit testing', () => {
  it('prefers points over the curves they belong to', () => {
    expect(hitTest(sketch, positions, 49, 1, 2)).toMatchObject({ id: 'b', type: 'point' });
    expect(hitTest(sketch, positions, 25, 1, 2)).toMatchObject({ id: 'l1', type: 'line' });
    expect(hitTest(sketch, positions, 109, 1, 2)).toMatchObject({ id: 'k', type: 'circle' });
    expect(hitTest(sketch, positions, 14.2, 114.2, 1)).toMatchObject({ id: 'arc', type: 'arc' });
    expect(hitTest(sketch, positions, 25, 10, 2)).toBeNull();
  });
});

describe('deleting sketch entities', () => {
  it('removes a line with its own end points and its relations, but keeps shared points', () => {
    const next = deleteEntities(sketch, ['l1']);
    const ids = next.entities.map((e) => e.id);
    expect(ids).not.toContain('l1');
    expect(ids).not.toContain('a');
    expect(ids).toContain('b');
    expect(next.constraints.map((c) => c.id)).toEqual(['v', 'r']);
  });

  it('removes the curves built on a deleted point', () => {
    const next = deleteEntities(sketch, ['b']);
    expect(next.entities.map((e) => e.id)).toEqual(['m', 'k', 'ac', 'as', 'ae', 'arc', 'free']);
    expect(next.constraints.map((c) => c.id)).toEqual(['r']);
  });

  it('removes constraints by id and keeps the sketch object when nothing changes', () => {
    expect(deleteEntities(sketch, ['r']).constraints.map((c) => c.id)).toEqual(['h', 'v', 'o']);
    expect(deleteEntities(sketch, ['nothing'])).toBe(sketch);
    expect(deleteEntities(sketch, ['free']).entities).toHaveLength(sketch.entities.length - 1);
  });
});

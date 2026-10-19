import { describe, expect, it } from 'vitest';
import { boundaries, extensionTargets, parameterOf, pointAt, shapeOf } from '../../src/renderer/src/sketch/intersect.ts';
import { pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import type { SketchData } from '../../src/shared/model/sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** A horizontal line crossed by a vertical line and a circle; a short line ending on it; a free point on it. */
const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 100, 0),
    { id: 'h', type: 'line', p1: 'a', p2: 'b' },
    point('c', 20, -10),
    point('d', 20, 10),
    { id: 'v', type: 'line', p1: 'c', p2: 'd' },
    point('m', 60, 0),
    { id: 'k', type: 'circle', center: 'm', radius: 10 },
    point('e', 85, 0),
    point('f', 85, 20),
    { id: 'stub', type: 'line', p1: 'e', p2: 'f' },
    point('g', 10, 30),
    point('i', 30, 30),
    { id: 'short', type: 'line', p1: 'g', p2: 'i' },
  ],
  constraints: [],
};

describe('curve shapes', () => {
  it('maps points to parameters and back', () => {
    const positions = pointPositions(sketch);
    const line = shapeOf(sketch.entities.find((e) => e.id === 'h') as never, positions);
    if (!line) throw new Error('no shape');
    expect(parameterOf(line, [25, 3])).toBeCloseTo(0.25, 12);
    expect(pointAt(line, 0.5)).toEqual([50, 0]);
    const circle = shapeOf(sketch.entities.find((e) => e.id === 'k') as never, positions);
    if (!circle) throw new Error('no shape');
    expect(parameterOf(circle, [60, 10])).toBeCloseTo(0.25, 12);
  });
});

describe('boundaries along a curve', () => {
  it('finds crossings and points that end on the curve, in order', () => {
    const result = boundaries(sketch, 'h');
    // The circle's center lies on the line too, but centers do not split curves.
    expect(result.map((b) => Math.round(b.at[0]))).toEqual([20, 50, 70, 85]);
    expect(result[0]).toMatchObject({ curve: 'v' });
    expect(result[3]).toMatchObject({ point: 'e', curve: 'stub' });
    expect(result.map((b) => b.t)).toEqual([...result.map((b) => b.t)].sort((x, y) => x - y));
  });

  it('splits circles at their crossings and ignores curves that only cross extensions', () => {
    expect(boundaries(sketch, 'k').map((b) => [Math.round(b.at[0]), Math.round(b.at[1])])).toEqual([
      [70, 0],
      [50, 0],
    ]);
    // The vertical line does not reach the short line at y = 30 …
    expect(boundaries(sketch, 'short')).toEqual([]);
    // … unless extensions count.
    expect(boundaries(sketch, 'short', { extended: true }).map((b) => b.at)).toEqual([[20, 30]]);
  });
});

describe('extension targets', () => {
  it('finds what a line runs into beyond its ends', () => {
    // The stub (85, 0) → (85, 20) extended downwards does not hit anything; the vertical line upwards
    // runs into the short line at y = 30.
    expect(extensionTargets(sketch, 'v', 'end').map((b) => b.at)).toEqual([[20, 30]]);
    expect(extensionTargets(sketch, 'stub', 'end')).toEqual([]);
    expect(extensionTargets(sketch, 'v', 'start')).toEqual([]);
  });
});

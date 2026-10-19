import { describe, expect, it } from 'vitest';
import {
  angleRays,
  arrowStrokes,
  dimensionAnchor,
  dimensionGraphic,
  displayValue,
  measure,
  proposeDimension,
  storedAngle,
  visibleAngle,
  type DimensionDraft,
} from '../../src/renderer/src/sketch/dimensions.ts';
import { pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import type { SketchData } from '../../src/shared/model/sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

/** A slanted line a–b, a horizontal line c–d, a circle, an arc and a free point. */
const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 30, 40),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    point('c', 0, -20),
    point('d', 60, -20),
    { id: 'l2', type: 'line', p1: 'c', p2: 'd' },
    point('m', 100, 0),
    { id: 'k', type: 'circle', center: 'm', radius: 10 },
    point('ac', 150, 0),
    point('as', 160, 0),
    point('ae', 150, 10),
    { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
    point('free', 20, 10),
  ],
  constraints: [],
};

describe('proposing dimensions', () => {
  it('measures a line as aligned, horizontal or vertical distance depending on where the label goes', () => {
    expect(proposeDimension(sketch, ['l1'], [0, 40])).toMatchObject({ type: 'distance', a: 'a', b: 'b', value: 50 });
    expect(proposeDimension(sketch, ['l1'], [15, 60])).toMatchObject({ type: 'horizontalDistance', value: 30 });
    expect(proposeDimension(sketch, ['l1'], [50, 20])).toMatchObject({ type: 'verticalDistance', value: 40 });
    // An axis-parallel line always gets a plain distance.
    expect(proposeDimension(sketch, ['l2'], [30, -30])).toMatchObject({ type: 'distance', value: 60 });
  });

  it('gives circles a diameter, arcs a radius, crossing lines an angle and parallel lines their gap', () => {
    expect(proposeDimension(sketch, ['k'], [120, 20])).toMatchObject({ type: 'diameter', circle: 'k', value: 20 });
    expect(proposeDimension(sketch, ['arc'], [170, 20])).toMatchObject({ type: 'radius', circle: 'arc', value: 10 });
    const angle = proposeDimension(sketch, ['l2', 'l1'], [30, 0]);
    expect(angle?.type).toBe('angle');
    const parallel: SketchData = { ...sketch, entities: [...sketch.entities, point('e', 0, 10), point('f', 60, 10), { id: 'l3', type: 'line', p1: 'e', p2: 'f' }] };
    expect(proposeDimension(parallel, ['l2', 'l3'], [70, 0])).toMatchObject({ type: 'distance', a: 'l2', b: 'l3', value: 30 });
  });

  it('dimensions points, points to lines and circles at their centers', () => {
    expect(proposeDimension(sketch, ['free', 'l2'], [30, 0])).toMatchObject({ type: 'distance', a: 'free', b: 'l2', value: 30 });
    expect(proposeDimension(sketch, ['k', 'free'], [60, 30])).toMatchObject({ type: 'horizontalDistance', a: 'm', b: 'free', value: 80 });
    expect(proposeDimension(sketch, ['origin', 'm'], [50, 0])).toMatchObject({ type: 'distance', a: 'origin', b: 'm', value: 100 });
    expect(proposeDimension(sketch, ['free'], [0, 0])).toBeNull();
  });

  it('stores the label position relative to the anchor', () => {
    const draft = proposeDimension(sketch, ['l1'], [0, 40]) as DimensionDraft;
    expect(dimensionAnchor(sketch, draft)).toEqual([15, 20]);
    expect(draft.offset).toEqual([-15, 20]);
  });
});

describe('angle dimensions', () => {
  it('show the angle between the rays towards the lines and convert typed angles for the solver', () => {
    const positions = pointPositions(sketch);
    const draft = proposeDimension(sketch, ['l2', 'l1'], [30, 0]) as Extract<DimensionDraft, { type: 'angle' }>;
    const rays = angleRays(sketch, positions, 'l2', 'l1');
    expect(rays?.origin[0]).toBeCloseTo(-15, 9);
    expect(rays?.origin[1]).toBeCloseTo(-20, 9);
    const seen = (visibleAngle(sketch, draft, draft.value) * 180) / Math.PI;
    expect(seen).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 9);
    // Typing 30° and solving turns the slanted line to 30° against the horizontal one.
    const value = storedAngle(sketch, draft, Math.PI / 6);
    const solved = solveSketch({ ...sketch, constraints: [{ ...draft, id: 'ang', value }] }).sketch;
    expect(displayValue(solved, { ...draft, value })).toBeCloseTo(30, 6);
    expect(measure(solved, draft)).toBeCloseTo(value, 6);
  });
});

describe('dimension graphics', () => {
  it('draws extension lines, a dimension line with arrows at both ends and puts the label at the offset', () => {
    const draft = proposeDimension(sketch, ['l2'], [30, -35]) as DimensionDraft;
    const graphic = dimensionGraphic(sketch, draft, 0.1);
    expect(graphic?.label).toEqual([30, -35]);
    expect(graphic?.lines).toHaveLength(3);
    expect(graphic?.arrows.map((arrow) => arrow.tip)).toEqual([
      [0, -35],
      [60, -35],
    ]);
    const [stroke] = arrowStrokes({ tip: [0, 0], direction: [1, 0] }, 2);
    expect(stroke?.[1][0]).toBeCloseTo(-2, 9);
  });

  it('draws radius and diameter leaders through the center towards the label', () => {
    const diameter = dimensionGraphic(sketch, proposeDimension(sketch, ['k'], [130, 0]) as DimensionDraft, 0.1);
    expect(diameter?.arrows.map((arrow) => arrow.tip)).toEqual([
      [110, 0],
      [90, 0],
    ]);
    expect(diameter?.lines).toEqual([[[90, 0], [130, 0]]]);
    const radius = dimensionGraphic(sketch, proposeDimension(sketch, ['arc'], [155, 0]) as DimensionDraft, 0.1);
    // A label inside the arc: the leader ends at the rim.
    expect(radius?.lines).toEqual([[[150, 0], [160, 0]]]);
  });

  it('shows driven dimensions with the measured value', () => {
    const driven = { ...(proposeDimension(sketch, ['l1'], [0, 40]) as DimensionDraft), driving: false, value: 12 };
    expect(displayValue(sketch, driven)).toBeCloseTo(50, 9);
    expect(displayValue(sketch, { ...driven, driving: true })).toBe(12);
  });
});

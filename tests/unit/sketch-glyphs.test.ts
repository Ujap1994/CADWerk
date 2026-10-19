import { describe, expect, it } from 'vitest';
import { pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import { RELATION_SYMBOLS, relationGlyphs } from '../../src/renderer/src/sketch/glyphs.ts';
import type { SketchConstraint, SketchData } from '../../src/shared/model/sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

const base: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 100, 0),
    point('c', 100, 60),
    point('d', 0, 60),
    { id: 'bottom', type: 'line', p1: 'a', p2: 'b' },
    { id: 'right', type: 'line', p1: 'b', p2: 'c' },
    { id: 'top', type: 'line', p1: 'c', p2: 'd' },
    { id: 'left', type: 'line', p1: 'd', p2: 'a' },
    point('m', 200, 0),
    { id: 'hole', type: 'circle', center: 'm', radius: 10 },
    point('free', 300, 20),
  ],
  constraints: [],
};

const glyphsOf = (constraints: SketchConstraint[], mmPerPixel = 0.5) => {
  const sketch = { ...base, constraints };
  return relationGlyphs(sketch, pointPositions(sketch), mmPerPixel);
};

describe('relation glyphs', () => {
  it('puts the symbol of a line relation next to the middle of the line, outside its outline', () => {
    const [glyph, ...rest] = glyphsOf([{ id: 'h', type: 'horizontal', line: 'bottom' }]);
    expect(rest).toEqual([]);
    expect(glyph).toMatchObject({ key: 'h:bottom', relation: 'h', kind: 'horizontal', symbol: 'H' });
    expect(glyph?.at[0]).toBeCloseTo(50);
    expect(glyph?.at[1]).toBeCloseTo(-6.5); // 13 px at 0.5 mm per pixel, below the rectangle
  });

  it('keeps every side of an outline outside, whatever its drawing direction', () => {
    // "top" runs right to left, "left" runs top to bottom.
    const [top, right, left] = glyphsOf([
      { id: 'h', type: 'horizontal', line: 'top' },
      { id: 'v1', type: 'vertical', line: 'right' },
      { id: 'v2', type: 'vertical', line: 'left' },
    ]);
    expect(top?.at).toEqual([expect.closeTo(50), expect.closeTo(66.5)]);
    expect(right?.at).toEqual([expect.closeTo(106.5), expect.closeTo(30)]);
    expect(left?.at).toEqual([expect.closeTo(-6.5), expect.closeTo(30)]);
    expect(left?.symbol).toBe('V');
  });

  it('puts symbols of a line on its own above it, or left of it', () => {
    const sketch: SketchData = {
      entities: [point('p', 0, 0), point('q', -40, 0), { id: 'line', type: 'line', p1: 'p', p2: 'q' }, point('r', 50, 0), point('s', 50, -30), { id: 'post', type: 'line', p1: 'r', p2: 's' }],
      constraints: [
        { id: 'h', type: 'horizontal', line: 'line' },
        { id: 'v', type: 'vertical', line: 'post' },
      ],
    };
    const [above, left] = relationGlyphs(sketch, pointPositions(sketch), 1);
    expect(above?.at).toEqual([expect.closeTo(-20), expect.closeTo(13)]);
    expect(left?.at).toEqual([expect.closeTo(37), expect.closeTo(-15)]);
  });

  it('shows a relation of two entities at both of them', () => {
    const glyphs = glyphsOf([{ id: 'par', type: 'parallel', a: 'bottom', b: 'top' }]);
    expect(glyphs.map((glyph) => glyph.key)).toEqual(['par:bottom', 'par:top']);
    expect(glyphs.every((glyph) => glyph.relation === 'par' && glyph.symbol === '∥')).toBe(true);
  });

  it('lines up several symbols of one entity next to each other', () => {
    const glyphs = glyphsOf([
      { id: 'h', type: 'horizontal', line: 'bottom' },
      { id: 'eq', type: 'equal', a: 'bottom', b: 'top' },
    ]).filter((glyph) => glyph.key.endsWith(':bottom'));
    expect(glyphs.map((glyph) => glyph.at[0])).toEqual([expect.closeTo(45.75), expect.closeTo(54.25)]);
    expect(glyphs.map((glyph) => glyph.at[1])).toEqual([expect.closeTo(-6.5), expect.closeTo(-6.5)]);
  });

  it('places symbols of circles outside the radius and of points beside the point', () => {
    const [onCircle, tangent] = glyphsOf([
      { id: 'on', type: 'pointOnCircle', point: 'free', circle: 'hole' },
      { id: 'tan', type: 'tangent', a: 'right', b: 'hole' },
    ]).filter((glyph) => glyph.key === 'on:free' || glyph.key === 'tan:hole');
    expect(onCircle?.symbol).toBe('◦');
    expect(onCircle?.at).toEqual([expect.closeTo(300 + 0.7 * 6.5), expect.closeTo(20 - 0.9 * 6.5)]);
    const distance = Math.hypot((tangent?.at[0] ?? 0) - 200, tangent?.at[1] ?? 0);
    expect(distance).toBeCloseTo(16.5);
  });

  it('keeps a constant screen distance when zooming', () => {
    const [near] = glyphsOf([{ id: 'h', type: 'horizontal', line: 'bottom' }], 0.1);
    const [far] = glyphsOf([{ id: 'h', type: 'horizontal', line: 'bottom' }], 2);
    expect(near?.at[1]).toBeCloseTo(-1.3);
    expect(far?.at[1]).toBeCloseTo(-26);
  });

  it('leaves dimensions and unknown entities out', () => {
    expect(
      glyphsOf([
        { id: 'dim', type: 'distance', a: 'a', b: 'b', value: 100, driving: true },
        { id: 'gone', type: 'horizontal', line: 'missing' },
      ]),
    ).toEqual([]);
  });

  it('has a short symbol for every relation kind', () => {
    for (const symbol of Object.values(RELATION_SYMBOLS)) expect(symbol.length).toBeLessThanOrEqual(2);
  });
});

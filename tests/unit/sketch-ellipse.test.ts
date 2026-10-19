import { describe, expect, it } from 'vitest';
import { dxfToSketch, sketchToDxf } from '../../src/renderer/src/sketch/dxf.ts';
import { closestOnEllipse, curvePolyline, ellipseGeometry, ellipseOf, hitTest, pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import { relationGlyphs } from '../../src/renderer/src/sketch/glyphs.ts';
import { boundaries } from '../../src/renderer/src/sketch/intersect.ts';
import { applicableRelations } from '../../src/renderer/src/sketch/relations.ts';
import { snapCursor } from '../../src/renderer/src/sketch/snap.ts';
import { createTool, type ToolEvent } from '../../src/renderer/src/sketch/tools.ts';
import { linearPattern } from '../../src/renderer/src/sketch/transform.ts';
import { trimAt } from '../../src/renderer/src/sketch/trim.ts';
import type { SketchData, SketchEllipse } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });
const EMPTY: SketchData = { entities: [], constraints: [] };

/** An ellipse 2 × 30 by 2 × 15 around (10, 5), its major axis horizontal. */
const base: SketchData = {
  entities: [point('c', 10, 5), point('ma', 40, 5), point('mi', 10, 20), { id: 'e', type: 'ellipse', center: 'c', major: 'ma', minor: 'mi' }],
  constraints: [],
};
const positions = pointPositions(base);
const ellipse = ellipseOf(base.entities[3] as SketchEllipse, positions);

describe('ellipse geometry', () => {
  it('finds the nearest point on the ellipse', () => {
    if (!ellipse) throw new Error('no ellipse');
    expect(closestOnEllipse(ellipse, [10, 30]).at).toEqual([expect.closeTo(10, 9), expect.closeTo(20, 9)]);
    expect(closestOnEllipse(ellipse, [50, 5]).distance).toBeCloseTo(10, 9);
    // A point inside: still the nearest point on the curve (the end of the minor axis is nearest here).
    expect(closestOnEllipse(ellipse, [10, 8]).distance).toBeCloseTo(12, 6);
    // Rotated ellipse: the axis points are on it.
    const rotated = ellipseGeometry([0, 0], [20, 20], [-5, 5]);
    expect(closestOnEllipse(rotated, [20, 20]).distance).toBeCloseTo(0, 9);
    expect(closestOnEllipse(rotated, [-5, 5]).distance).toBeCloseTo(0, 9);
  });

  it('is tessellated within the display tolerance and closed', () => {
    const polyline = curvePolyline(base.entities[3] as SketchEllipse, positions, 0.05) ?? [];
    expect(polyline.length).toBeGreaterThan(40);
    expect(polyline.at(-1)).toEqual([expect.closeTo(40, 9), expect.closeTo(5, 9)]);
    if (!ellipse) throw new Error('no ellipse');
    // The middle of each chord is no further than 0.2 px (0.01 mm) from the curve.
    for (let i = 1; i < polyline.length; i++) {
      const [a, b] = [polyline[i - 1] as [number, number], polyline[i] as [number, number]];
      expect(closestOnEllipse(ellipse, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).distance).toBeLessThan(0.0101);
    }
  });

  it('is picked at its curve, its axis points before it', () => {
    expect(hitTest(base, positions, 25, 5 + 15 * Math.sin(Math.acos(0.5)) + 0.2, 0.5)?.id).toBe('e');
    expect(hitTest(base, positions, 40.1, 5, 0.5)?.id).toBe('ma');
    expect(hitTest(base, positions, 25, 5, 0.5)).toBeNull();
  });
});

describe('drawing and snapping', () => {
  const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.6 });

  it('draws an ellipse from its center, an axis end and the width; a horizontal axis stays horizontal', () => {
    const tool = createTool('ellipse');
    let sketch = EMPTY;
    for (const [u, v] of [[50, 50], [80, 50.2], [70, 62]] as const) {
      tool.hover(sketch, event(u, v));
      const step = tool.click(sketch, event(u, v));
      if (step.commit) sketch = step.commit;
    }
    const drawn = sketch.entities.find((entity) => entity.type === 'ellipse');
    expect(drawn).toMatchObject({ type: 'ellipse' });
    expect(sketch.constraints.map((c) => c.type)).toEqual(['horizontalPoints']);
    expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
    const solved = solveSketch(sketch);
    expect(solved.converged).toBe(true);
    expect(solved.unsatisfied).toEqual([]);
    const geometry = ellipseOf(drawn as SketchEllipse, pointPositions(sketch));
    expect(geometry?.a).toBeCloseTo(30, 9);
    expect(geometry?.b).toBeCloseTo(12, 9);
  });

  it('snaps onto the ellipse and to where an alignment crosses it', () => {
    const near = snapCursor(base, positions, 14, 20.2, { tolerance: 1, alignTolerance: 0.6 });
    expect(near.target).toEqual({ kind: 'curve', curve: 'e', curveType: 'ellipse' });
    if (!ellipse) throw new Error('no ellipse');
    expect(closestOnEllipse(ellipse, [near.u, near.v]).distance).toBeLessThan(1e-9);
    // Aligned horizontally with an anchor at y = 5 + 7.5: the crossing with the ellipse.
    const crossing = snapCursor(base, positions, 36.2, 12.6, { tolerance: 1, alignTolerance: 0.6, anchor: [-30, 12.5] });
    expect(crossing.v).toBeCloseTo(12.5, 9);
    expect(crossing.u).toBeCloseTo(10 + 30 * Math.sqrt(1 - 0.25), 9);
  });
});

describe('relations and editing', () => {
  it('offers on-curve for a point and tangent for a line', () => {
    const sketch: SketchData = { ...base, entities: [...base.entities, point('p', 0, 30), point('q', 30, 30), { id: 'l', type: 'line', p1: 'p', p2: 'q' }] };
    expect(applicableRelations(sketch, ['p', 'e']).map((option) => option.kind)).toEqual(['onCurve']);
    expect(applicableRelations(sketch, ['l', 'e']).map((option) => option.kind)).toEqual(['tangent']);
    expect(applicableRelations(sketch, ['e'])).toEqual([]);
  });

  it('trims a line where it crosses the ellipse; the new end stays on the ellipse', () => {
    // At y = 10 (not through the axis point, which would simply become the new end).
    const sketch: SketchData = { ...base, entities: [...base.entities, point('p', -40, 10), point('q', 60, 10), { id: 'l', type: 'line', p1: 'p', p2: 'q' }] };
    const half = 30 * Math.sqrt(1 - (5 / 15) ** 2);
    expect(boundaries(sketch, 'l').map((b) => b.at[0])).toEqual([expect.closeTo(10 - half, 9), expect.closeTo(10 + half, 9)]);
    const result = trimAt(sketch, 'l', [50, 10]);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnCircle', circle: 'e' })]);
    expect(solveSketch(result.sketch).unsatisfied).toEqual([]);
    // The ellipse itself cannot be cut into elliptical arcs.
    expect(trimAt(result.sketch, 'e', [10, 20])).toEqual({ ok: false, error: 'ellipse' });
  });

  it('finds crossings with circles', () => {
    const sketch: SketchData = { ...base, entities: [...base.entities, point('k', 40, 5), { id: 'circle', type: 'circle', center: 'k', radius: 10 }] };
    const crossings = boundaries(sketch, 'circle');
    expect(crossings).toHaveLength(2);
    if (!ellipse) throw new Error('no ellipse');
    for (const crossing of crossings) {
      expect(closestOnEllipse(ellipse, crossing.at).distance).toBeLessThan(1e-9);
      expect(Math.hypot(crossing.at[0] - 40, crossing.at[1] - 5)).toBeCloseTo(10, 9);
    }
  });

  it('is copied by patterns with its axis points', () => {
    const result = linearPattern(base, ['e'], [100, 0], 2);
    if (!result.ok) throw new Error(result.error);
    const copies = result.sketch.entities.filter((entity) => entity.type === 'ellipse');
    expect(copies).toHaveLength(2);
    const copy = ellipseOf(copies[1] as SketchEllipse, pointPositions(result.sketch));
    expect(copy?.center).toEqual([110, 5]);
    expect(copy?.a).toBeCloseTo(30, 9);
  });

  it('shows relation symbols outside the ellipse', () => {
    const sketch: SketchData = {
      entities: [...base.entities, point('p', 30, 5 + 15 * Math.sqrt(1 - (20 / 30) ** 2))],
      constraints: [{ id: 'on', type: 'pointOnCircle', point: 'p', circle: 'e' }],
    };
    const [glyph] = relationGlyphs(sketch, pointPositions(sketch), 1);
    // The symbol of a point on a curve sits at the point.
    expect(glyph?.key).toBe('on:p');
  });
});

describe('DXF', () => {
  it('exports an ellipse as a fine closed polyline (R12 has no ellipses)', () => {
    const { text, entities } = sketchToDxf(base);
    expect(entities).toBe(1);
    expect(text).toContain('POLYLINE');
    const vertices = text.split('\n').filter((line) => line === 'VERTEX').length;
    expect(vertices).toBeGreaterThan(100);
    // Read back: a closed chain of lines on the ellipse.
    const imported = dxfToSketch(text, EMPTY);
    const lines = imported.sketch.entities.filter((entity) => entity.type === 'line');
    expect(lines).toHaveLength(vertices);
    if (!ellipse) throw new Error('no ellipse');
    for (const [, at] of pointPositions(imported.sketch)) if (at[0] !== 0 || at[1] !== 0) expect(closestOnEllipse(ellipse, at).distance).toBeLessThan(1e-6);
  });

  it('imports full ellipses of newer DXF files and skips elliptical arcs', () => {
    const text = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'ELLIPSE', '8', '0', '10', '10', '20', '5', '30', '0', '11', '0', '21', '30', '31', '0', '40', '0.5', '41', '0', '42', String(2 * Math.PI),
      '0', 'ELLIPSE', '8', '0', '10', '0', '20', '0', '30', '0', '11', '10', '21', '0', '31', '0', '40', '0.5', '41', '0', '42', '1.5',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const result = dxfToSketch(text, EMPTY);
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual({ ELLIPSE: 1 });
    const imported = result.sketch.entities.find((entity) => entity.type === 'ellipse') as SketchEllipse;
    const geometry = ellipseOf(imported, pointPositions(result.sketch));
    expect(geometry?.center).toEqual([10, 5]);
    expect(geometry?.a).toBeCloseTo(30, 9);
    expect(geometry?.b).toBeCloseTo(15, 9);
    expect(geometry?.axis).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9)]);
  });
});

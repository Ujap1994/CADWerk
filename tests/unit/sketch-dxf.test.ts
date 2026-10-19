import { describe, expect, it } from 'vitest';
import { dxfToSketch, sketchToDxf } from '../../src/renderer/src/sketch/dxf.ts';
import { arcGeometry, pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import type { SketchData } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });
const EMPTY: SketchData = { entities: [], constraints: [] };

const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 40, 0),
    point('c', 40, 20),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
    point('m', 20, 10),
    { id: 'k', type: 'circle', center: 'm', radius: 4.5 },
    point('d', 20, 20),
    point('ac', 0, 20),
    { id: 'arc', type: 'arc', center: 'ac', start: 'a', end: 'd' },
    point('x1', -10, 10),
    point('x2', 50, 10),
    { id: 'axis', type: 'line', p1: 'x1', p2: 'x2', construction: true },
  ],
  constraints: [],
};

/** Minimal DXF text from group code / value pairs. */
const dxf = (...pairs: (string | number)[]) => `${pairs.join('\n')}\n`;

describe('DXF export', () => {
  it('writes lines, circles and arcs in millimeters and leaves construction geometry out', () => {
    const { text, entities } = sketchToDxf(sketch);
    expect(entities).toBe(4);
    expect(text).toContain('$INSUNITS\n70\n4');
    expect(text.match(/\nLINE\n/g)).toHaveLength(2);
    expect(text).toContain('\nCIRCLE\n');
    expect(text).toContain('\n40\n4.5\n');
    expect(text.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('reads its own output back with the same geometry, connected at shared end points', () => {
    const { sketch: back, imported } = dxfToSketch(sketchToDxf(sketch).text, EMPTY);
    expect(imported).toBe(4);
    expect(() => parseSketchData(JSON.parse(JSON.stringify(back)))).not.toThrow();
    expect(back.entities.filter((e) => e.type === 'line')).toHaveLength(2);
    expect(back.entities.find((e) => e.type === 'circle')).toMatchObject({ radius: 4.5 });
    const arc = back.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const positions = pointPositions(back);
    const geometry = arcGeometry(positions.get(arc.center) as never, positions.get(arc.start) as never, positions.get(arc.end) as never);
    expect(geometry.radius).toBeCloseTo(20, 6);
    expect(geometry.sweep).toBeCloseTo(Math.PI / 2, 6);
    // a is shared by a line and the arc; with b, c, d and the two centers that makes six points.
    expect(back.entities.filter((e) => e.type === 'point')).toHaveLength(6);
  });
});

describe('DXF import', () => {
  it('reads closed lightweight polylines with bulges as lines and arcs', () => {
    // A slot outline: two straight edges and two half circles (bulge 1 = 180°).
    const text = dxf(0, 'SECTION', 2, 'ENTITIES', 0, 'LWPOLYLINE', 8, 0, 90, 4, 70, 1, 10, 0, 20, 0, 10, 30, 20, 0, 42, 1, 10, 30, 20, 10, 10, 0, 20, 10, 42, 1, 0, 'ENDSEC', 0, 'EOF');
    const { sketch: result, imported } = dxfToSketch(text, EMPTY);
    expect(imported).toBe(1);
    expect(result.entities.filter((e) => e.type === 'line')).toHaveLength(2);
    const arcs = result.entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(2);
    const positions = pointPositions(result);
    for (const arc of arcs) {
      if (arc.type !== 'arc') continue;
      const g = arcGeometry(positions.get(arc.center) as never, positions.get(arc.start) as never, positions.get(arc.end) as never);
      expect(g.radius).toBeCloseTo(5, 9);
      expect(g.sweep).toBeCloseTo(Math.PI, 9);
    }
  });

  it('scales inch drawings, reads R12 polylines and mirrored arcs, and reports what it skipped', () => {
    const text = dxf(
      0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 1, 0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, 0, 10, 0, 20, 0, 11, 1, 21, 0,
      0, 'POLYLINE', 8, 0, 66, 1, 70, 0,
      0, 'VERTEX', 8, 0, 10, 0, 20, 1,
      0, 'VERTEX', 8, 0, 10, 1, 20, 1,
      0, 'SEQEND',
      0, 'ARC', 8, 0, 10, 2, 20, 0, 40, 1, 50, 0, 51, 90, 230, -1,
      0, 'TEXT', 8, 0, 1, 'hello',
      0, 'SPLINE', 8, 0,
      0, 'TEXT', 8, 0, 1, 'again',
      0, 'ENDSEC', 0, 'EOF',
    );
    const { sketch: result, imported, skipped } = dxfToSketch(text, EMPTY);
    expect(imported).toBe(3);
    expect(skipped).toEqual({ TEXT: 2, SPLINE: 1 });
    const positions = pointPositions(result);
    const line = result.entities.find((e) => e.type === 'line');
    if (line?.type !== 'line') throw new Error('no line');
    expect(positions.get(line.p2)?.[0]).toBeCloseTo(25.4, 9);
    // The mirrored arc (extrusion -Z) around (-2, 0) inch spans from 90° to 180°.
    const arc = result.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    expect(positions.get(arc.center)?.[0]).toBeCloseTo(-50.8, 9);
    expect(positions.get(arc.start)?.[1]).toBeCloseTo(25.4, 9);
  });

  it('refuses files that are not DXF', () => {
    expect(() => dxfToSketch('hello\nworld\nthis is not\n', EMPTY)).toThrow();
  });
});

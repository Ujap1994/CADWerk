/**
 * DXF exchange for sketches: export as DXF R12 (lines, circles, arcs in millimeters; R12 has no
 * ellipses and splines, so they become fine polylines; construction geometry is left out, so laser and
 * CNC software cut only the real outline) and import of the common 2D entities. Imported geometry
 * is connected where end points coincide.
 */

import type { SketchData } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { arcGeometry, ellipseOf, ellipsePoint, pointPositions, splineOf, type Point2 } from './geometry.ts';
import { segmentsPerSpan, splinePolyline } from './spline.ts';

/** Largest distance of an exported ellipse or spline polyline from the true curve, in millimeters. */
const CURVE_TOLERANCE = 0.005;

function number(value: number): string {
  const text = (Math.round(value * 1e6) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

/** The sketch as DXF R12 text. */
export function sketchToDxf(sketch: SketchData): { text: string; entities: number } {
  const positions = pointPositions(sketch);
  const lines: string[] = [];
  const pair = (code: number, value: string | number) => lines.push(String(code), typeof value === 'number' ? number(value) : value);
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  pair(9, '$INSUNITS');
  pair(70, '4');
  pair(9, '$MEASUREMENT');
  pair(70, '1');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  let entities = 0;
  /** An R12 polyline (POLYLINE, VERTEX …, SEQEND) through the given points. */
  const polyline = (points: readonly Point2[], closed: boolean) => {
    pair(0, 'POLYLINE');
    pair(8, '0');
    pair(66, '1');
    pair(10, 0);
    pair(20, 0);
    pair(30, 0);
    pair(70, closed ? '1' : '0');
    for (const [x, y] of points) {
      pair(0, 'VERTEX');
      pair(8, '0');
      pair(10, x);
      pair(20, y);
      pair(30, 0);
    }
    pair(0, 'SEQEND');
    pair(8, '0');
  };
  for (const entity of sketch.entities) {
    if (entity.construction) continue;
    if (entity.type === 'line') {
      const a = positions.get(entity.p1);
      const b = positions.get(entity.p2);
      if (!a || !b) continue;
      pair(0, 'LINE');
      pair(8, '0');
      pair(10, a[0]);
      pair(20, a[1]);
      pair(30, 0);
      pair(11, b[0]);
      pair(21, b[1]);
      pair(31, 0);
      entities++;
    } else if (entity.type === 'circle') {
      const c = positions.get(entity.center);
      if (!c) continue;
      pair(0, 'CIRCLE');
      pair(8, '0');
      pair(10, c[0]);
      pair(20, c[1]);
      pair(30, 0);
      pair(40, entity.radius);
      entities++;
    } else if (entity.type === 'arc') {
      const c = positions.get(entity.center);
      const s = positions.get(entity.start);
      const e = positions.get(entity.end);
      if (!c || !s || !e) continue;
      const arc = arcGeometry(c, s, e);
      const degrees = (radians: number) => (((radians * 180) / Math.PI) % 360 + 360) % 360;
      pair(0, 'ARC');
      pair(8, '0');
      pair(10, c[0]);
      pair(20, c[1]);
      pair(30, 0);
      pair(40, arc.radius);
      pair(50, degrees(arc.startAngle));
      pair(51, degrees(arc.startAngle + arc.sweep));
      entities++;
    } else if (entity.type === 'ellipse') {
      const ellipse = ellipseOf(entity, positions);
      if (!ellipse) continue;
      const radius = Math.max(ellipse.a, ellipse.b);
      const step = radius > CURVE_TOLERANCE ? 2 * Math.acos(1 - CURVE_TOLERANCE / radius) : Math.PI / 6;
      const count = Math.min(4096, Math.max(24, Math.ceil((2 * Math.PI) / step)));
      polyline(Array.from({ length: count }, (_, i) => ellipsePoint(ellipse, (2 * Math.PI * i) / count)), true);
      entities++;
    } else if (entity.type === 'spline') {
      const spline = splineOf(entity, positions);
      if (!spline) continue;
      polyline(splinePolyline(spline, segmentsPerSpan(spline, CURVE_TOLERANCE)), false);
      entities++;
    }
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return { text: `${lines.join('\n')}\n`, entities };
}

/** Millimeters per drawing unit for $INSUNITS (unknown or unitless: millimeters). */
const UNIT_SCALE: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

interface RawEntity {
  type: string;
  codes: [number, string][];
}

function parsePairs(text: string): [number, string][] {
  const rows = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = Number.parseInt((rows[i] as string).trim(), 10);
    if (Number.isNaN(code)) throw new Error('not a DXF file');
    pairs.push([code, (rows[i + 1] as string).trim()]);
  }
  return pairs;
}

export interface DxfImport {
  sketch: SketchData;
  /** Entities that became sketch geometry. */
  imported: number;
  /** Entity types that were not imported, with their counts (e.g. TEXT, SPLINE). */
  skipped: Record<string, number>;
}

/** Adds the 2D geometry of a DXF file to `base`. */
export function dxfToSketch(text: string, base: SketchData): DxfImport {
  const pairs = parsePairs(text);
  let scale = 1;
  const entities: RawEntity[] = [];
  let section = '';
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i] as [number, string];
    if (code === 0 && value === 'SECTION') {
      section = pairs[i + 1]?.[1] ?? '';
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      section = '';
      continue;
    }
    if (section === 'HEADER' && code === 9 && value === '$INSUNITS') scale = UNIT_SCALE[Number(pairs[i + 1]?.[1])] ?? 1;
    if (section === 'ENTITIES' && code === 0) entities.push({ type: value, codes: [] });
    else if (section === 'ENTITIES' && entities.length > 0 && code !== 0) entities.at(-1)?.codes.push([code, value]);
  }

  const builder = new SketchBuilder(base);
  const extent = Math.max(1, ...pairs.filter(([code]) => code === 10 || code === 20).map(([, v]) => Math.abs(Number(v) * scale) || 0));
  const tolerance = 1e-7 * extent;
  const points = new Map<string, string>();
  /** One shared point per position, so imported outlines are connected. */
  const pointAt = (p: Point2): string => {
    const key = `${Math.round(p[0] / tolerance)},${Math.round(p[1] / tolerance)}`;
    let id = points.get(key);
    if (!id) {
      id = builder.freePoint(p[0], p[1]);
      points.set(key, id);
    }
    return id;
  };
  const skipped: Record<string, number> = {};
  let imported = 0;

  const values = (entity: RawEntity, code: number) => entity.codes.filter(([c]) => c === code).map(([, v]) => Number(v));
  const first = (entity: RawEntity, code: number, fallback = 0) => values(entity, code)[0] ?? fallback;
  /** Entities with a negative extrusion direction are mirrored in x (a common way to store mirrored arcs). */
  const mirrored = (entity: RawEntity) => first(entity, 230, 1) < 0;
  const at = (entity: RawEntity, x: number, y: number): Point2 => [(mirrored(entity) ? -x : x) * scale, y * scale];

  const addArc = (center: Point2, radius: number, startDeg: number, endDeg: number) => {
    const start: Point2 = [center[0] + radius * Math.cos((startDeg * Math.PI) / 180), center[1] + radius * Math.sin((startDeg * Math.PI) / 180)];
    const end: Point2 = [center[0] + radius * Math.cos((endDeg * Math.PI) / 180), center[1] + radius * Math.sin((endDeg * Math.PI) / 180)];
    builder.arc(builder.freePoint(...center), pointAt(start), pointAt(end));
  };
  /** A polyline segment from a to b with a bulge (tan of a quarter of the included angle; 0 = straight). */
  const addSegment = (a: Point2, b: Point2, bulge: number) => {
    if (Math.abs(bulge) < 1e-12) {
      builder.line(pointAt(a), pointAt(b));
      return;
    }
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = 4 * Math.atan(bulge);
    const radius = chord / (2 * Math.sin(Math.abs(angle) / 2));
    const middle: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const toCenter = radius * Math.cos(Math.abs(angle) / 2);
    const normal: Point2 = [-(b[1] - a[1]) / chord, (b[0] - a[0]) / chord];
    const side = bulge > 0 ? 1 : -1;
    const center: Point2 = [middle[0] + normal[0] * toCenter * side, middle[1] + normal[1] * toCenter * side];
    // Positive bulge runs counterclockwise from a to b.
    if (bulge > 0) builder.arc(builder.freePoint(...center), pointAt(a), pointAt(b));
    else builder.arc(builder.freePoint(...center), pointAt(b), pointAt(a));
  };
  const addPolyline = (vertices: { at: Point2; bulge: number }[], closed: boolean) => {
    for (let i = 0; i + 1 < vertices.length; i++) addSegment((vertices[i] as { at: Point2 }).at, (vertices[i + 1] as { at: Point2 }).at, (vertices[i] as { bulge: number }).bulge);
    const last = vertices.at(-1);
    const head = vertices[0];
    if (closed && last && head && vertices.length > 2) addSegment(last.at, head.at, last.bulge);
  };

  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index] as RawEntity;
    switch (entity.type) {
      case 'LINE': {
        const a = at(entity, first(entity, 10), first(entity, 20));
        const b = at(entity, first(entity, 11), first(entity, 21));
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > tolerance) {
          builder.line(pointAt(a), pointAt(b));
          imported++;
        }
        break;
      }
      case 'CIRCLE': {
        const radius = first(entity, 40) * scale;
        if (radius > 0) {
          builder.circle(builder.freePoint(...at(entity, first(entity, 10), first(entity, 20))), radius);
          imported++;
        }
        break;
      }
      case 'ARC': {
        const radius = first(entity, 40) * scale;
        let [startDeg, endDeg] = [first(entity, 50), first(entity, 51)];
        if (mirrored(entity)) [startDeg, endDeg] = [180 - endDeg, 180 - startDeg];
        if (radius > 0) {
          addArc(at(entity, first(entity, 10), first(entity, 20)), radius, startDeg, endDeg);
          imported++;
        }
        break;
      }
      case 'POINT':
        pointAt(at(entity, first(entity, 10), first(entity, 20)));
        imported++;
        break;
      case 'SPLINE': {
        // Splines through fit points become sketch splines; splines given only by control points are skipped.
        const xs = values(entity, 11);
        const ys = values(entity, 21);
        if (xs.length < 2 || xs.length !== ys.length || xs.length > 1000) {
          skipped.SPLINE = (skipped.SPLINE ?? 0) + 1;
          break;
        }
        builder.spline(xs.map((x, i) => pointAt(at(entity, x, ys[i] as number))));
        imported++;
        break;
      }
      case 'ELLIPSE': {
        // Center, end of the major axis relative to it, ratio of the axes; elliptical arcs are not supported.
        const sweep = first(entity, 42, 2 * Math.PI) - first(entity, 41, 0);
        const ratio = first(entity, 40);
        if (Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-6 || !(ratio > 0)) {
          skipped.ELLIPSE = (skipped.ELLIPSE ?? 0) + 1;
          break;
        }
        const center = at(entity, first(entity, 10), first(entity, 20));
        const [mx, my] = [first(entity, 11) * scale * (mirrored(entity) ? -1 : 1), first(entity, 21) * scale];
        if (Math.hypot(mx, my) <= tolerance) break;
        builder.ellipse(builder.freePoint(...center), builder.freePoint(center[0] + mx, center[1] + my), builder.freePoint(center[0] - my * ratio, center[1] + mx * ratio));
        imported++;
        break;
      }
      case 'LWPOLYLINE': {
        const vertices: { at: Point2; bulge: number }[] = [];
        for (const [code, value] of entity.codes) {
          if (code === 10) vertices.push({ at: [Number(value), 0], bulge: 0 });
          else if (code === 20 && vertices.length > 0) (vertices.at(-1) as { at: Point2 }).at = at(entity, (vertices.at(-1) as { at: Point2 }).at[0], Number(value));
          else if (code === 42 && vertices.length > 0) (vertices.at(-1) as { bulge: number }).bulge = Number(value) * (mirrored(entity) ? -1 : 1);
        }
        addPolyline(vertices, (first(entity, 70) & 1) === 1);
        imported++;
        break;
      }
      case 'POLYLINE': {
        // R12: VERTEX entities follow until SEQEND.
        const vertices: { at: Point2; bulge: number }[] = [];
        while (entities[index + 1]?.type === 'VERTEX') {
          index++;
          const vertex = entities[index] as RawEntity;
          vertices.push({ at: at(entity, first(vertex, 10), first(vertex, 20)), bulge: first(vertex, 42) * (mirrored(entity) ? -1 : 1) });
        }
        if (entities[index + 1]?.type === 'SEQEND') index++;
        addPolyline(vertices, (first(entity, 70) & 1) === 1);
        imported++;
        break;
      }
      default:
        skipped[entity.type] = (skipped[entity.type] ?? 0) + 1;
    }
  }
  return { sketch: builder.build(), imported, skipped };
}

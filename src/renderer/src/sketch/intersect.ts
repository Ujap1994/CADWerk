/**
 * Where sketch curves cross or touch each other, as positions along a curve: the parameter t
 * runs from 0 to 1 along a line (p1 → p2) or an arc (start → end, counterclockwise), and around a
 * circle from angle 0 (t = 0) once counterclockwise (t = 1); around an ellipse from its major
 * axis point towards its minor axis point.
 */

import type { SketchCurve, SketchData } from '../../../shared/model/sketch.ts';
import { arcGeometry, ellipseOf, ellipseParameter, ellipsePoint, isCurve, pointPositions, type EllipseGeometry, type Point2 } from './geometry.ts';

type Positions = ReadonlyMap<string, Point2>;

/** A curve in a form that is easy to intersect. */
export type CurveShape =
  | { kind: 'segment'; a: Point2; b: Point2 }
  | { kind: 'circle'; center: Point2; radius: number; startAngle: number; sweep: number; closed: boolean }
  | { kind: 'ellipse'; ellipse: EllipseGeometry; closed: true };

export function shapeOf(curve: SketchCurve, positions: Positions): CurveShape | null {
  if (curve.type === 'line') {
    const a = positions.get(curve.p1);
    const b = positions.get(curve.p2);
    return a && b ? { kind: 'segment', a, b } : null;
  }
  if (curve.type === 'ellipse') {
    const ellipse = ellipseOf(curve, positions);
    return ellipse ? { kind: 'ellipse', ellipse, closed: true } : null;
  }
  const center = positions.get(curve.center);
  if (!center) return null;
  if (curve.type === 'circle') return { kind: 'circle', center, radius: curve.radius, startAngle: 0, sweep: 2 * Math.PI, closed: true };
  const start = positions.get(curve.start);
  const end = positions.get(curve.end);
  if (!start || !end) return null;
  const arc = arcGeometry(center, start, end);
  return { kind: 'circle', center, radius: arc.radius, startAngle: arc.startAngle, sweep: arc.sweep, closed: false };
}

/** Parameter of a point on (or projected onto) a shape; may lie outside 0…1 (beyond the ends). */
export function parameterOf(shape: CurveShape, point: Point2): number {
  if (shape.kind === 'segment') {
    const dx = shape.b[0] - shape.a[0];
    const dy = shape.b[1] - shape.a[1];
    const lengthSquared = dx * dx + dy * dy;
    return lengthSquared > 0 ? ((point[0] - shape.a[0]) * dx + (point[1] - shape.a[1]) * dy) / lengthSquared : 0;
  }
  if (shape.kind === 'ellipse') {
    const angle = ellipseParameter(shape.ellipse, point);
    return (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
  }
  let angle = Math.atan2(point[1] - shape.center[1], point[0] - shape.center[0]) - shape.startAngle;
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle / shape.sweep;
}

export function pointAt(shape: CurveShape, t: number): Point2 {
  if (shape.kind === 'segment') return [shape.a[0] + (shape.b[0] - shape.a[0]) * t, shape.a[1] + (shape.b[1] - shape.a[1]) * t];
  if (shape.kind === 'ellipse') return ellipsePoint(shape.ellipse, 2 * Math.PI * t);
  const angle = shape.startAngle + shape.sweep * t;
  return [shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)];
}

/** Where the infinite line through a segment crosses an ellipse: a quadratic in the ellipse's frame. */
export function lineEllipse(segment: { a: Point2; b: Point2 }, e: EllipseGeometry): Point2[] {
  const local = (p: Point2): Point2 => {
    const [dx, dy] = [p[0] - e.center[0], p[1] - e.center[1]];
    return [(dx * e.axis[0] + dy * e.axis[1]) / e.a, (dx * e.normal[0] + dy * e.normal[1]) / e.b];
  };
  // In coordinates scaled by the semi-axes the ellipse is the unit circle.
  const [p, q] = [local(segment.a), local(segment.b)];
  const d: Point2 = [q[0] - p[0], q[1] - p[1]];
  const qa = d[0] * d[0] + d[1] * d[1];
  const qb = 2 * (p[0] * d[0] + p[1] * d[1]);
  const qc = p[0] * p[0] + p[1] * p[1] - 1;
  const discriminant = qb * qb - 4 * qa * qc;
  if (qa === 0 || discriminant < -1e-9 * qa) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const ts = root === 0 ? [-qb / (2 * qa)] : [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)];
  return ts.map((t) => [segment.a[0] + (segment.b[0] - segment.a[0]) * t, segment.a[1] + (segment.b[1] - segment.a[1]) * t]);
}

/**
 * Crossings of an ellipse with a circle or another ellipse: sign changes of the distance to the
 * other curve along the ellipse, refined by bisection.
 */
function ellipseCurve(e: EllipseGeometry, other: CurveShape): Point2[] {
  const signed = (p: Point2): number => {
    if (other.kind === 'circle') return Math.hypot(p[0] - other.center[0], p[1] - other.center[1]) - other.radius;
    if (other.kind === 'ellipse') {
      const o = other.ellipse;
      const [dx, dy] = [p[0] - o.center[0], p[1] - o.center[1]];
      const x = (dx * o.axis[0] + dy * o.axis[1]) / o.a;
      const y = (dx * o.normal[0] + dy * o.normal[1]) / o.b;
      return Math.hypot(x, y) - 1;
    }
    return NaN;
  };
  const steps = 256;
  const result: Point2[] = [];
  let previous = signed(ellipsePoint(e, 0));
  for (let i = 1; i <= steps; i++) {
    const t1 = (2 * Math.PI * i) / steps;
    const value = signed(ellipsePoint(e, t1));
    if (Math.sign(value) !== Math.sign(previous) && Number.isFinite(value) && Number.isFinite(previous)) {
      let [lo, hi, low] = [(2 * Math.PI * (i - 1)) / steps, t1, previous];
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        const v = signed(ellipsePoint(e, mid));
        if (Math.sign(v) === Math.sign(low)) [lo, low] = [mid, v];
        else hi = mid;
      }
      result.push(ellipsePoint(e, (lo + hi) / 2));
    }
    previous = value;
  }
  return result;
}

/** Crossing points of two shapes, treating segments as infinite lines and arcs as full circles. */
function crossings(a: CurveShape, b: CurveShape): Point2[] {
  if (a.kind === 'ellipse' && b.kind === 'segment') return lineEllipse(b, a.ellipse);
  if (a.kind === 'segment' && b.kind === 'ellipse') return lineEllipse(a, b.ellipse);
  if (a.kind === 'ellipse') return ellipseCurve(a.ellipse, b);
  if (b.kind === 'ellipse') return ellipseCurve(b.ellipse, a);
  if (a.kind === 'segment' && b.kind === 'segment') {
    const d1: Point2 = [a.b[0] - a.a[0], a.b[1] - a.a[1]];
    const d2: Point2 = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
    const denominator = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(denominator) < 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) return [];
    const t = ((b.a[0] - a.a[0]) * d2[1] - (b.a[1] - a.a[1]) * d2[0]) / denominator;
    return [[a.a[0] + d1[0] * t, a.a[1] + d1[1] * t]];
  }
  if (a.kind === 'circle' && b.kind === 'segment') return crossings(b, a);
  if (a.kind === 'segment' && b.kind === 'circle') {
    const d: Point2 = [a.b[0] - a.a[0], a.b[1] - a.a[1]];
    const f: Point2 = [a.a[0] - b.center[0], a.a[1] - b.center[1]];
    const qa = d[0] * d[0] + d[1] * d[1];
    const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
    const qc = f[0] * f[0] + f[1] * f[1] - b.radius * b.radius;
    const discriminant = qb * qb - 4 * qa * qc;
    if (qa === 0 || discriminant < -1e-9 * qa * b.radius * b.radius) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    const ts = root === 0 ? [-qb / (2 * qa)] : [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)];
    return ts.map((t) => [a.a[0] + d[0] * t, a.a[1] + d[1] * t]);
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = b.center[0] - a.center[0];
    const dy = b.center[1] - a.center[1];
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance > a.radius + b.radius + 1e-9 || distance < Math.abs(a.radius - b.radius) - 1e-9) return [];
    const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
    const base: Point2 = [a.center[0] + (dx * along) / distance, a.center[1] + (dy * along) / distance];
    if (height === 0) return [base];
    return [
      [base[0] - (dy * height) / distance, base[1] + (dx * height) / distance],
      [base[0] + (dy * height) / distance, base[1] - (dx * height) / distance],
    ];
  }
  return [];
}

export interface Boundary {
  /** Position along the curve. */
  t: number;
  at: Point2;
  /** The other curve crossing here, if the boundary comes from a crossing. */
  curve?: string;
  /** An existing point lying here (an end point of another curve, a sketch point). */
  point?: string;
}

/** Tolerance for "lies on" checks, relative to the size of the sketch. */
function toleranceOf(positions: Positions): number {
  let size = 1;
  for (const [x, y] of positions.values()) size = Math.max(size, Math.abs(x), Math.abs(y));
  return 1e-7 * size;
}

/**
 * Everything that splits a curve: crossings with other curves (also beyond their ends if
 * `extended`), and existing points that lie on it. Sorted by t; the curve's own ends excluded.
 */
export function boundaries(sketch: SketchData, curveId: string, options: { extended?: boolean } = {}): Boundary[] {
  const positions = pointPositions(sketch);
  const curve = sketch.entities.find((entity) => entity.id === curveId);
  if (!curve || !isCurve(curve)) return [];
  const shape = shapeOf(curve, positions);
  if (!shape) return [];
  const tolerance = toleranceOf(positions);
  const ownPoints = new Set(curve.type === 'line' ? [curve.p1, curve.p2] : curve.type === 'arc' ? [curve.start, curve.end] : []);
  const result: Boundary[] = [];
  const onShape = (shapeToTest: CurveShape, point: Point2, extended: boolean): boolean => {
    if (shapeToTest.kind === 'segment') {
      if (extended) return true;
      const t = parameterOf(shapeToTest, point);
      return t >= -1e-9 && t <= 1 + 1e-9;
    }
    if (shapeToTest.kind === 'ellipse' || shapeToTest.closed || extended) return true;
    const t = parameterOf(shapeToTest, point);
    return t <= 1 + 1e-9 || t >= (2 * Math.PI) / shapeToTest.sweep - 1e-9;
  };
  const add = (boundary: Boundary) => {
    const closed = shape.kind !== 'segment' && shape.closed;
    if (boundary.t <= 1e-9 && !closed) return;
    if (boundary.t >= 1 - 1e-9 && !closed) return;
    const near = result.find((other) => Math.hypot(other.at[0] - boundary.at[0], other.at[1] - boundary.at[1]) <= tolerance * 10);
    if (near) {
      near.point ??= boundary.point;
      near.curve ??= boundary.curve;
      return;
    }
    result.push(boundary);
  };

  // Existing points on the curve (not its own ends): ends of other curves and sketch points.
  // Centers of circles, arcs and ellipses only happen to lie there; they do not split the curve.
  const centers = new Set(sketch.entities.flatMap((entity) => (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse' ? [entity.center] : [])));
  for (const [id, at] of positions) {
    if (ownPoints.has(id) || centers.has(id)) continue;
    const t = parameterOf(shape, at);
    if (!onShape(shape, at, false)) continue;
    const projected = pointAt(shape, t);
    if (Math.hypot(projected[0] - at[0], projected[1] - at[1]) <= tolerance * 10) add({ t, at, point: id });
  }
  // Crossings with other curves.
  for (const other of sketch.entities) {
    if (!isCurve(other) || other.id === curveId) continue;
    const otherShape = shapeOf(other, positions);
    if (!otherShape) continue;
    for (const at of crossings(shape, otherShape)) {
      if (!onShape(shape, at, false) || !onShape(otherShape, at, options.extended === true)) continue;
      add({ t: parameterOf(shape, at), at, curve: other.id });
    }
  }
  return result.sort((x, y) => x.t - y.t);
}

/** Crossings of the extension of a curve beyond one end with other curves, nearest first. */
export function extensionTargets(sketch: SketchData, curveId: string, end: 'start' | 'end'): Boundary[] {
  const positions = pointPositions(sketch);
  const curve = sketch.entities.find((entity) => entity.id === curveId);
  if (!curve || !isCurve(curve) || curve.type === 'circle' || curve.type === 'ellipse') return [];
  const shape = shapeOf(curve, positions);
  if (!shape) return [];
  const result: Boundary[] = [];
  for (const other of sketch.entities) {
    if (!isCurve(other) || other.id === curveId) continue;
    const otherShape = shapeOf(other, positions);
    if (!otherShape) continue;
    for (const at of crossings(shape, otherShape)) {
      // Only real crossings with the other curve (not with its extension).
      const t = parameterOf(otherShape, at);
      const onOther = otherShape.kind === 'segment' ? t >= -1e-9 && t <= 1 + 1e-9 : otherShape.closed || t <= 1 + 1e-9;
      if (!onOther) continue;
      if (shape.kind === 'segment') {
        const along = parameterOf(shape, at);
        if ((end === 'end' && along > 1 + 1e-9) || (end === 'start' && along < -1e-9)) result.push({ t: along, at, curve: other.id });
      } else if (shape.kind === 'circle') {
        // Along the arc's circle beyond its end (counterclockwise) or before its start (clockwise).
        const tau = parameterOf(shape, at);
        if (tau > 1 + 1e-9) result.push({ t: end === 'end' ? tau : -(((2 * Math.PI) / shape.sweep) - tau), at, curve: other.id });
      }
    }
  }
  return result.sort((x, y) => (end === 'end' ? x.t - y.t : y.t - x.t));
}

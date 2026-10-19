/**
 * Snapping while drawing: the cursor jumps to existing points, line midpoints and curves, and
 * aligns horizontally or vertically with other points (inference lines). What it snapped to
 * decides which relation the new geometry gets.
 */

import { ORIGIN_ID, type SketchData } from '../../../shared/model/sketch.ts';
import { arcGeometry, closestOnEllipse, distanceToCurve, ellipseOf, isCurve, type Point2 } from './geometry.ts';
import { lineEllipse } from './intersect.ts';

export type SnapTarget =
  | { kind: 'point'; id: string }
  | { kind: 'midpoint'; line: string }
  | { kind: 'curve'; curve: string; curveType: 'line' | 'circle' | 'arc' | 'ellipse' | 'spline' }
  | { kind: 'none' };

/** An inference line: the cursor is aligned with `from` along an axis. */
export interface Alignment {
  axis: 'horizontal' | 'vertical';
  from: Point2;
  /** The alignment is with the anchor (the previous point of the geometry being drawn). */
  anchor: boolean;
}

export interface SnapResult {
  u: number;
  v: number;
  target: SnapTarget;
  alignments: Alignment[];
}

export interface SnapOptions {
  /** Distance (mm) within which the cursor snaps to points, midpoints and curves. */
  tolerance: number;
  /** Distance (mm) within which the cursor aligns with other points. */
  alignTolerance: number;
  /** The previous point of the geometry being drawn; alignment with it becomes a relation. */
  anchor?: Point2 | null;
  /** Entities that must not be snapped to (e.g. the point being placed). */
  exclude?: ReadonlySet<string>;
}

function projectOntoCurve(sketch: SketchData, positions: ReadonlyMap<string, Point2>, id: string, u: number, v: number): Point2 | null {
  const curve = sketch.entities.find((entity) => entity.id === id);
  if (!curve || !isCurve(curve)) return null;
  if (curve.type === 'line') {
    const a = positions.get(curve.p1);
    const b = positions.get(curve.p2);
    if (!a || !b) return null;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / lengthSquared)) : 0;
    return [a[0] + t * dx, a[1] + t * dy];
  }
  if (curve.type === 'spline') return null;
  if (curve.type === 'ellipse') {
    const ellipse = ellipseOf(curve, positions);
    return ellipse ? closestOnEllipse(ellipse, [u, v]).at : null;
  }
  const center = positions.get(curve.center);
  if (!center) return null;
  let radius: number;
  if (curve.type === 'circle') {
    radius = curve.radius;
  } else {
    const start = positions.get(curve.start);
    const end = positions.get(curve.end);
    if (!start || !end) return null;
    radius = arcGeometry(center, start, end).radius;
  }
  const angle = Math.atan2(v - center[1], u - center[0]);
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

/** Alignments of a fixed snap position (point, midpoint) with the anchor: only exact ones, so the relation holds as drawn. */
function exactAnchorAlignments(at: Point2, anchor: Point2 | null, tolerance: number): Alignment[] {
  if (!anchor) return [];
  const eps = 1e-9 * Math.max(1, Math.abs(at[0]), Math.abs(at[1]), tolerance);
  if (Math.hypot(at[0] - anchor[0], at[1] - anchor[1]) <= eps) return [];
  if (Math.abs(at[1] - anchor[1]) <= eps) return [{ axis: 'horizontal', from: anchor, anchor: true }];
  if (Math.abs(at[0] - anchor[0]) <= eps) return [{ axis: 'vertical', from: anchor, anchor: true }];
  return [];
}

export function snapCursor(sketch: SketchData, positions: ReadonlyMap<string, Point2>, u: number, v: number, options: SnapOptions): SnapResult {
  const exclude = options.exclude ?? new Set<string>();
  const { tolerance, alignTolerance } = options;
  const anchor = options.anchor ?? null;

  // 1. Existing points, including the sketch origin.
  let best: { id: string; distance: number; at: Point2 } | null = null;
  for (const [id, at] of positions) {
    if (exclude.has(id)) continue;
    const distance = Math.hypot(u - at[0], v - at[1]);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { id, distance, at };
  }
  if (best) return { u: best.at[0], v: best.at[1], target: { kind: 'point', id: best.id }, alignments: exactAnchorAlignments(best.at, anchor, tolerance) };

  // 2. Midpoints of lines.
  let midpoint: { line: string; distance: number; at: Point2 } | null = null;
  for (const entity of sketch.entities) {
    if (entity.type !== 'line' || exclude.has(entity.id)) continue;
    const a = positions.get(entity.p1);
    const b = positions.get(entity.p2);
    if (!a || !b) continue;
    const at: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = Math.hypot(u - at[0], v - at[1]);
    if (distance <= tolerance && (!midpoint || distance < midpoint.distance)) midpoint = { line: entity.id, distance, at };
  }
  if (midpoint) {
    return { u: midpoint.at[0], v: midpoint.at[1], target: { kind: 'midpoint', line: midpoint.line }, alignments: exactAnchorAlignments(midpoint.at, anchor, tolerance) };
  }

  // 3. Curves: the nearest point on the nearest curve; if the cursor is also aligned with the
  //    anchor, the point where the alignment crosses the curve (both relations apply).
  const anchorAlignment = (): Alignment | null => {
    if (!anchor) return null;
    if (Math.abs(v - anchor[1]) <= alignTolerance) return { axis: 'horizontal', from: anchor, anchor: true };
    if (Math.abs(u - anchor[0]) <= alignTolerance) return { axis: 'vertical', from: anchor, anchor: true };
    return null;
  };
  let curve: { id: string; type: 'line' | 'circle' | 'arc' | 'ellipse'; distance: number } | null = null;
  for (const entity of sketch.entities) {
    // Splines snap at their fit points only: no relation can keep a point on a spline yet.
    if (!isCurve(entity) || entity.type === 'spline' || exclude.has(entity.id)) continue;
    const distance = distanceToCurve(entity, positions, u, v);
    if (distance <= tolerance && (!curve || distance < curve.distance)) curve = { id: entity.id, type: entity.type, distance };
  }
  if (curve) {
    const target: SnapTarget = { kind: 'curve', curve: curve.id, curveType: curve.type };
    const alignment = anchorAlignment();
    const crossing = alignment ? crossCurve(sketch, positions, curve.id, alignment, u, v) : null;
    if (alignment && crossing && Math.hypot(crossing[0] - u, crossing[1] - v) <= tolerance) {
      return { u: crossing[0], v: crossing[1], target, alignments: [alignment] };
    }
    const at = projectOntoCurve(sketch, positions, curve.id, u, v);
    if (at) return { u: at[0], v: at[1], target, alignments: [] };
  }

  // 4. Alignment: with the anchor first (it becomes a horizontal or vertical relation), then with other points.
  let su = u;
  let sv = v;
  const alignments: Alignment[] = [];
  if (anchor && Math.abs(v - anchor[1]) <= alignTolerance) {
    sv = anchor[1];
    alignments.push({ axis: 'horizontal', from: anchor, anchor: true });
  }
  if (anchor && Math.abs(u - anchor[0]) <= alignTolerance) {
    su = anchor[0];
    alignments.push({ axis: 'vertical', from: anchor, anchor: true });
  }
  const aligned = (axis: 'horizontal' | 'vertical') => alignments.some((alignment) => alignment.axis === axis);
  let horizontal: { from: Point2; distance: number } | null = null;
  let vertical: { from: Point2; distance: number } | null = null;
  for (const [id, at] of positions) {
    if (exclude.has(id) || (anchor && at[0] === anchor[0] && at[1] === anchor[1])) continue;
    const dv = Math.abs(v - at[1]);
    const du = Math.abs(u - at[0]);
    if (!aligned('horizontal') && dv <= alignTolerance && (!horizontal || dv < horizontal.distance)) horizontal = { from: at, distance: dv };
    if (!aligned('vertical') && du <= alignTolerance && (!vertical || du < vertical.distance)) vertical = { from: at, distance: du };
  }
  if (horizontal) {
    sv = horizontal.from[1];
    alignments.push({ axis: 'horizontal', from: horizontal.from, anchor: false });
  }
  if (vertical) {
    su = vertical.from[0];
    alignments.push({ axis: 'vertical', from: vertical.from, anchor: false });
  }
  return { u: su, v: sv, target: { kind: 'none' }, alignments };
}

/** Where a horizontal or vertical line through the alignment's point crosses a curve, nearest to (u, v). */
function crossCurve(sketch: SketchData, positions: ReadonlyMap<string, Point2>, id: string, alignment: Alignment, u: number, v: number): Point2 | null {
  const curve = sketch.entities.find((entity) => entity.id === id);
  if (!curve || !isCurve(curve)) return null;
  const horizontal = alignment.axis === 'horizontal';
  const level = horizontal ? alignment.from[1] : alignment.from[0];
  // Swap coordinates for vertical alignments, so both cases solve "y = level".
  const swap = (p: Point2): Point2 => (horizontal ? p : [p[1], p[0]]);
  if (curve.type === 'line') {
    const a = positions.get(curve.p1);
    const b = positions.get(curve.p2);
    if (!a || !b) return null;
    const [ax, ay] = swap(a);
    const [bx, by] = swap(b);
    if (Math.abs(by - ay) < 1e-12) return null;
    const t = (level - ay) / (by - ay);
    if (t < 0 || t > 1) return null;
    return swap([ax + t * (bx - ax), level]);
  }
  if (curve.type === 'spline') return null;
  if (curve.type === 'ellipse') {
    const ellipse = ellipseOf(curve, positions);
    if (!ellipse) return null;
    const crossings = lineEllipse({ a: swap([0, level]), b: swap([1, level]) }, ellipse);
    return crossings.reduce<Point2 | null>((best, p) => (!best || Math.hypot(p[0] - u, p[1] - v) < Math.hypot(best[0] - u, best[1] - v) ? p : best), null);
  }
  const center = positions.get(curve.center);
  if (!center) return null;
  let radius: number;
  if (curve.type === 'circle') {
    radius = curve.radius;
  } else {
    const start = positions.get(curve.start);
    const end = positions.get(curve.end);
    if (!start || !end) return null;
    radius = arcGeometry(center, start, end).radius;
  }
  const [cx, cy] = swap(center);
  const dy = level - cy;
  if (Math.abs(dy) > radius) return null;
  const dx = Math.sqrt(radius * radius - dy * dy);
  const [cu] = swap([u, v]);
  return swap([Math.abs(cx + dx - cu) < Math.abs(cx - dx - cu) ? cx + dx : cx - dx, level]);
}

/** Whether a snap result is the sketch origin. */
export function isOrigin(target: SnapTarget): boolean {
  return target.kind === 'point' && target.id === ORIGIN_ID;
}

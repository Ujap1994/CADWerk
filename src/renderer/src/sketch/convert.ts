/**
 * Convert entities: model edges projected onto the sketch plane become sketch geometry. Lines stay
 * lines; circles and arcs parallel to the sketch stay circles and arcs; tilted circles become
 * ellipses; everything else becomes a spline through points of the edge. Converted points are fixed
 * (the geometry does not follow later model changes yet), and they connect to existing sketch points
 * at the same place, so converting the edges of a face gives a closed outline.
 */

import type { EdgeInfo } from '../../../kernel/protocol.ts';
import type { Vec3 } from '../../../shared/model/feature.ts';
import { toSketch, type SketchData, type SketchFrame } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { curvePoints, isCurve, pointPositions, type Point2 } from './geometry.ts';
import type { SketchEntity } from '../../../shared/model/sketch.ts';

const curvePointsOf = (entity: SketchEntity): string[] => (isCurve(entity) ? curvePoints(entity) : []);

/** A model edge to convert: its exact geometry and its display polyline (pairs of points). */
export interface ModelEdge {
  info: EdgeInfo;
  polyline: Float32Array;
}

export type ConvertResult = { ok: true; sketch: SketchData; added: number } | { ok: false; error: 'nothing-to-convert' | 'already-converted' };

/** Most fit points of a spline made from a curved edge. */
const MAX_SPLINE_POINTS = 48;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

export function convertEdges(sketch: SketchData, frame: SketchFrame, edges: readonly ModelEdge[]): ConvertResult {
  const builder = new SketchBuilder(sketch);
  const positions = pointPositions(sketch);
  let size = 1;
  for (const [x, y] of positions.values()) size = Math.max(size, Math.abs(x), Math.abs(y));
  for (const edge of edges) for (const v of edge.polyline) size = Math.max(size, Math.abs(v));
  const tolerance = 1e-7 * size;
  // Existing points and points made here, by position: touching edges share their ends.
  const known: { id: string; at: Point2 }[] = [...positions].map(([id, at]) => ({ id, at }));
  const fixed = new Set<string>();
  const pointAt = (at: Point2): string => {
    const existing = known.find((candidate) => Math.hypot(candidate.at[0] - at[0], candidate.at[1] - at[1]) <= tolerance * 10);
    if (existing) return existing.id;
    const id = builder.freePoint(...at);
    known.push({ id, at });
    return id;
  };
  for (const constraint of sketch.constraints) if (constraint.type === 'fix') fixed.add(constraint.point);
  const fix = (id: string) => {
    if (fixed.has(id) || id === 'origin') return;
    fixed.add(id);
    builder.relation({ type: 'fix', point: id });
  };
  const project = (p: Vec3): Point2 => toSketch(frame, p);
  let added = 0;
  let repeated = 0;
  // Converting the same edge twice must not stack identical curves.
  const exists = (type: string, points: readonly string[], radius?: number) => {
    const found = [...sketch.entities, ...builder.build().entities.slice(sketch.entities.length)].some((entity) => {
      if (entity.type !== type) return false;
      const own = curvePointsOf(entity);
      if (radius !== undefined && entity.type === 'circle' && Math.abs(entity.radius - radius) > tolerance * 10) return false;
      return own.length === points.length && (own.every((id, i) => id === points[i]) || own.every((id, i) => id === points[points.length - 1 - i]));
    });
    if (found) repeated++;
    return found;
  };

  for (const { info, polyline } of edges) {
    if (info.kind === 'line' && info.start && info.end) {
      const [a, b] = [project(info.start), project(info.end)];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= tolerance * 10) continue;
      const [pa, pb] = [pointAt(a), pointAt(b)];
      if (exists('line', [pa, pb])) continue;
      builder.line(pa, pb);
      fix(pa);
      fix(pb);
      added++;
      continue;
    }
    if (info.kind === 'circle' && info.start && info.end && info.center && info.axis && info.radius) {
      const facing = dot(norm(info.axis), frame.normal);
      const closed = Math.hypot(info.start[0] - info.end[0], info.start[1] - info.end[1], info.start[2] - info.end[2]) <= tolerance * 10;
      const center = project(info.center);
      if (Math.abs(Math.abs(facing) - 1) < 1e-9) {
        const c = pointAt(center);
        fix(c);
        if (closed) {
          if (exists('circle', [c], info.radius)) continue;
          // The radius is held by a fixed point on the circle.
          const circle = builder.circle(c, info.radius);
          const rim = pointAt(project(info.start));
          builder.relation({ type: 'pointOnCircle', point: rim, circle });
          fix(rim);
        } else {
          const [s, e] = [pointAt(project(info.start)), pointAt(project(info.end))];
          if (exists('arc', facing > 0 ? [c, s, e] : [c, e, s])) continue;
          // Counterclockwise around the axis; seen from the other side it runs the other way.
          if (facing > 0) builder.arc(c, s, e);
          else builder.arc(c, e, s);
          fix(s);
          fix(e);
        }
        added++;
        continue;
      }
      if (closed && Math.abs(facing) > 1e-6) {
        // A tilted circle projects to an ellipse: the full radius across the tilt, shortened along it.
        const across = norm(cross(frame.normal, info.axis));
        const along = norm(cross(frame.normal, across));
        const major: Vec3 = [info.center[0] + across[0] * info.radius, info.center[1] + across[1] * info.radius, info.center[2] + across[2] * info.radius];
        const minorLength = info.radius * Math.abs(facing);
        const minor: Vec3 = [info.center[0] + along[0] * minorLength, info.center[1] + along[1] * minorLength, info.center[2] + along[2] * minorLength];
        const c = pointAt(center);
        const [ma, mi] = [pointAt(project(major)), pointAt(project(minor))];
        if (exists('ellipse', [c, ma, mi])) continue;
        builder.ellipse(c, ma, mi);
        [c, ma, mi].forEach(fix);
        added++;
        continue;
      }
    }
    // Anything else: a spline through points of the edge (end points kept exactly).
    const points: Point2[] = [];
    for (let i = 0; i < polyline.length; i += 3) {
      const p = project([polyline[i] as number, polyline[i + 1] as number, polyline[i + 2] as number]);
      const last = points.at(-1);
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > tolerance * 10) points.push(p);
    }
    if (points.length < 2) continue;
    const step = Math.max(1, Math.ceil((points.length - 1) / (MAX_SPLINE_POINTS - 1)));
    const fit = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const ids = fit.map(pointAt);
    if (new Set(ids).size < 2 || exists('spline', ids)) continue;
    builder.spline(ids);
    ids.forEach(fix);
    added++;
  }
  if (added === 0) return { ok: false, error: repeated > 0 ? 'already-converted' : 'nothing-to-convert' };
  return { ok: true, sketch: builder.build(), added };
}

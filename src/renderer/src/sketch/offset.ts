/**
 * Offset: copies of selected lines, arcs and circles at a distance. Connected curves are offset
 * as chains that stay connected; lines stay parallel to their originals, arcs and circles share
 * the original center, and the first offset curve gets a dimension of the distance.
 */

import type { SketchArc, SketchCurve, SketchData, SketchLine } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { isCurve, pointPositions, type Point2 } from './geometry.ts';

type Positions = ReadonlyMap<string, Point2>;

/** A chain element: a line or arc, walked from `from` to `to`. */
interface Step {
  curve: SketchLine | SketchArc;
  from: string;
  to: string;
}

const ends = (curve: SketchLine | SketchArc): [string, string] => (curve.type === 'line' ? [curve.p1, curve.p2] : [curve.start, curve.end]);

/** Groups lines and arcs into chains connected end to end, each walked in one direction. */
export function chainsOf(curves: readonly (SketchLine | SketchArc)[]): { steps: Step[]; closed: boolean }[] {
  const remaining = new Set(curves);
  const chains: { steps: Step[]; closed: boolean }[] = [];
  const touching = (point: string, except: SketchLine | SketchArc) => [...remaining].filter((curve) => curve !== except && ends(curve).includes(point));
  while (remaining.size > 0) {
    const first = remaining.values().next().value as SketchLine | SketchArc;
    remaining.delete(first);
    const [a, b] = ends(first);
    const steps: Step[] = [{ curve: first, from: a, to: b }];
    // Grow forwards from the end, then backwards from the start.
    for (let next = touching(b, first)[0]; next; ) {
      remaining.delete(next);
      const last = steps.at(-1) as Step;
      const [na, nb] = ends(next);
      steps.push(na === last.to ? { curve: next, from: na, to: nb } : { curve: next, from: nb, to: na });
      next = touching((steps.at(-1) as Step).to, next)[0];
    }
    for (let previous = touching(a, first)[0]; previous; ) {
      remaining.delete(previous);
      const head = steps[0] as Step;
      const [pa, pb] = ends(previous);
      steps.unshift(pb === head.from ? { curve: previous, from: pa, to: pb } : { curve: previous, from: pb, to: pa });
      previous = touching((steps[0] as Step).from, previous)[0];
    }
    chains.push({ steps, closed: steps.length > 1 && (steps[0] as Step).from === (steps.at(-1) as Step).to });
  }
  return chains;
}

/** Offset of one step to the left of its walking direction by `distance` (negative: right). */
interface OffsetPiece {
  kind: 'line' | 'arc';
  start: Point2;
  end: Point2;
  center?: Point2;
  radius?: number;
}

function offsetStep(step: Step, positions: Positions, distance: number): OffsetPiece | null {
  const from = positions.get(step.from);
  const to = positions.get(step.to);
  if (!from || !to) return null;
  if (step.curve.type === 'line') {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) return null;
    const n: Point2 = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
    return { kind: 'line', start: [from[0] + n[0] * distance, from[1] + n[1] * distance], end: [to[0] + n[0] * distance, to[1] + n[1] * distance] };
  }
  const center = positions.get(step.curve.center);
  if (!center) return null;
  const radius = Math.hypot(from[0] - center[0], from[1] - center[1]);
  // Walking counterclockwise, left is towards the center.
  const counterclockwise = step.from === step.curve.start;
  const offsetRadius = counterclockwise ? radius - distance : radius + distance;
  if (offsetRadius <= 0) return null;
  const scale = (p: Point2): Point2 => [center[0] + ((p[0] - center[0]) * offsetRadius) / radius, center[1] + ((p[1] - center[1]) * offsetRadius) / radius];
  return { kind: 'arc', start: scale(from), end: scale(to), center, radius: offsetRadius };
}

/** Where two offset pieces meet: the crossing of their lines/circles nearest to `near`. */
function joint(a: OffsetPiece, b: OffsetPiece, near: Point2): Point2 {
  if (Math.hypot(a.end[0] - b.start[0], a.end[1] - b.start[1]) < 1e-9 * Math.max(1, Math.hypot(...near))) return a.end;
  const candidates: Point2[] = [];
  if (a.kind === 'line' && b.kind === 'line') {
    const d1: Point2 = [a.end[0] - a.start[0], a.end[1] - a.start[1]];
    const d2: Point2 = [b.end[0] - b.start[0], b.end[1] - b.start[1]];
    const denominator = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(denominator) > 1e-12) {
      const t = ((b.start[0] - a.start[0]) * d2[1] - (b.start[1] - a.start[1]) * d2[0]) / denominator;
      candidates.push([a.start[0] + d1[0] * t, a.start[1] + d1[1] * t]);
    }
  } else {
    const [line, circle] = a.kind === 'line' ? [a, b] : b.kind === 'line' ? [b, a] : [null, null];
    if (line && circle?.center && circle.radius) {
      const d: Point2 = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
      const f: Point2 = [line.start[0] - circle.center[0], line.start[1] - circle.center[1]];
      const qa = d[0] * d[0] + d[1] * d[1];
      const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
      const qc = f[0] * f[0] + f[1] * f[1] - circle.radius * circle.radius;
      const discriminant = qb * qb - 4 * qa * qc;
      if (discriminant >= 0) {
        for (const sign of [-1, 1]) {
          const t = (-qb + sign * Math.sqrt(discriminant)) / (2 * qa);
          candidates.push([line.start[0] + d[0] * t, line.start[1] + d[1] * t]);
        }
      }
    }
  }
  // Without a crossing (e.g. two arcs), the midpoint of the gap keeps the chain connected.
  if (candidates.length === 0) return [(a.end[0] + b.start[0]) / 2, (a.end[1] + b.start[1]) / 2];
  return candidates.reduce((best, p) => (Math.hypot(p[0] - near[0], p[1] - near[1]) < Math.hypot(best[0] - near[0], best[1] - near[1]) ? p : best));
}

export type OffsetResult = { ok: true; sketch: SketchData } | { ok: false; error: 'nothing-selected' | 'too-large' };

/** Signed area of a closed chain (positive when it runs counterclockwise); arcs count with their midpoints. */
function signedArea(steps: readonly Step[], positions: Positions): number {
  const outline: Point2[] = [];
  for (const step of steps) {
    const from = positions.get(step.from);
    if (from) outline.push(from);
    if (step.curve.type === 'arc') {
      const center = positions.get(step.curve.center);
      const start = positions.get(step.curve.start);
      const end = positions.get(step.curve.end);
      if (center && start && end) {
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        let sweep = Math.atan2(end[1] - center[1], end[0] - center[0]) - a0;
        while (sweep <= 0) sweep += 2 * Math.PI;
        const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
        outline.push([center[0] + radius * Math.cos(a0 + sweep / 2), center[1] + radius * Math.sin(a0 + sweep / 2)]);
      }
    }
  }
  let area = 0;
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length] as Point2;
    area += p[0] * q[1] - q[0] * p[1];
  });
  return area / 2;
}

/**
 * Offsets the selected curves by `distance`: closed chains and circles grow outwards (inwards
 * with `flip`); open chains move to the left of their direction (right with `flip`).
 */
export function offsetSelection(sketch: SketchData, ids: readonly string[], distance: number, flip = false): OffsetResult {
  const selected = new Set(ids);
  const curves = sketch.entities.filter((entity): entity is SketchCurve => isCurve(entity) && entity.type !== 'ellipse' && entity.type !== 'spline' && selected.has(entity.id));
  if (curves.length === 0 || !(distance > 0)) return { ok: false, error: 'nothing-selected' };
  const positions = pointPositions(sketch);
  const builder = new SketchBuilder(sketch);
  const signed = flip ? -distance : distance;
  let dimensioned = false;

  for (const circle of curves) {
    if (circle.type !== 'circle') continue;
    // Circles grow with the default side and shrink when flipped.
    const radius = circle.radius + (flip ? -distance : distance);
    if (radius <= 0) return { ok: false, error: 'too-large' };
    builder.circle(circle.center, radius, circle.construction === true);
  }

  // Ellipses have no ellipse at a constant distance; they are left out.
  const chained = curves.filter((curve): curve is SketchLine | SketchArc => curve.type === 'line' || curve.type === 'arc');
  for (const chain of chainsOf(chained)) {
    // Left of a counterclockwise loop is inside: going outwards means going right.
    const side = chain.closed && signedArea(chain.steps, positions) > 0 ? -signed : signed;
    const pieces = chain.steps.map((step) => offsetStep(step, positions, side));
    if (pieces.some((piece) => piece === null)) return { ok: false, error: 'too-large' };
    const offsets = pieces as OffsetPiece[];
    // Corner points: the joints between neighbors (and around a closed chain), or the free ends.
    const corners: Point2[] = [];
    for (let i = 0; i <= offsets.length; i++) {
      const before = i > 0 ? offsets[i - 1] : chain.closed ? offsets.at(-1) : undefined;
      const after = i < offsets.length ? offsets[i] : chain.closed ? offsets[0] : undefined;
      const original = positions.get(i < chain.steps.length ? (chain.steps[i] as Step).from : (chain.steps.at(-1) as Step).to) as Point2;
      if (before && after) corners.push(joint(before, after, original));
      else corners.push(before ? before.end : (after as OffsetPiece).start);
    }
    if (chain.closed) corners[offsets.length] = corners[0] as Point2;
    const pointIds = corners.map((corner, i) => (chain.closed && i === offsets.length ? undefined : builder.freePoint(...corner)));
    if (chain.closed) pointIds[offsets.length] = pointIds[0];
    chain.steps.forEach((step, i) => {
      const from = pointIds[i] as string;
      const to = pointIds[i + 1] as string;
      const construction = step.curve.construction === true;
      if (step.curve.type === 'line') {
        const line = builder.line(from, to, construction);
        builder.relation({ type: 'parallel', a: step.curve.id, b: line });
        if (!dimensioned) {
          builder.dimension({ type: 'distance', a: step.curve.id, b: line, value: distance, driving: true });
          dimensioned = true;
        }
      } else {
        // The offset arc shares the center; walking direction decides which end is its start.
        const counterclockwise = step.from === step.curve.start;
        if (counterclockwise) builder.arc(step.curve.center, from, to, construction);
        else builder.arc(step.curve.center, to, from, construction);
      }
    });
  }
  return { ok: true, sketch: builder.build() };
}

/**
 * Sketch dimensions for display and the dimension tool: which dimension a selection and a
 * placement mean, the current value of a dimension, and the lines and label position to draw.
 * All positions are sketch coordinates (mm); angles are radians.
 */

import type { SketchData, SketchDimension, SketchEntity } from '../../../shared/model/sketch.ts';
import { arcGeometry, pointPositions, type Point2 } from './geometry.ts';

/** A dimension without id, as the dimension tool proposes it. */
export type DimensionDraft = SketchDimension extends infer D ? (D extends SketchDimension ? Omit<D, 'id'> : never) : never;

type Positions = ReadonlyMap<string, Point2>;

const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point2, b: Point2): Point2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point2, s: number): Point2 => [a[0] * s, a[1] * s];
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const length = (a: Point2) => Math.hypot(a[0], a[1]);
const mid = (a: Point2, b: Point2): Point2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function unit(a: Point2, fallback: Point2 = [1, 0]): Point2 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : fallback;
}

function wrap(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function entityOf(sketch: SketchData, id: string): SketchEntity | undefined {
  return sketch.entities.find((entity) => entity.id === id);
}

function lineEnds(sketch: SketchData, positions: Positions, id: string): [Point2, Point2] | null {
  const line = entityOf(sketch, id);
  if (line?.type !== 'line') return null;
  const a = positions.get(line.p1);
  const b = positions.get(line.p2);
  return a && b ? [a, b] : null;
}

/** Center and radius of a circle or arc. */
function roundOf(sketch: SketchData, positions: Positions, id: string): { center: Point2; radius: number; centerId: string } | null {
  const entity = entityOf(sketch, id);
  if (entity?.type === 'circle') {
    const center = positions.get(entity.center);
    return center ? { center, radius: entity.radius, centerId: entity.center } : null;
  }
  if (entity?.type === 'arc') {
    const center = positions.get(entity.center);
    const start = positions.get(entity.start);
    const end = positions.get(entity.end);
    return center && start && end ? { center, radius: arcGeometry(center, start, end).radius, centerId: entity.center } : null;
  }
  return null;
}

function foot(point: Point2, a: Point2, b: Point2): Point2 {
  const d = unit(sub(b, a));
  return add(a, scale(d, dot(sub(point, a), d)));
}

/** Rays from the crossing point of two lines towards the middle of each line; the angle dimension spans them. */
export function angleRays(sketch: SketchData, positions: Positions, a: string, b: string): { origin: Point2; ra: Point2; rb: Point2; flipped: boolean } | null {
  const la = lineEnds(sketch, positions, a);
  const lb = lineEnds(sketch, positions, b);
  if (!la || !lb) return null;
  const da = sub(la[1], la[0]);
  const db = sub(lb[1], lb[0]);
  const denominator = cross(da, db);
  if (Math.abs(denominator) < 1e-12 * length(da) * length(db)) return null;
  const t = cross(sub(lb[0], la[0]), db) / denominator;
  const origin = add(la[0], scale(da, t));
  const ra = unit(sub(mid(...la), origin), unit(da));
  const rb = unit(sub(mid(...lb), origin), unit(db));
  // The solver measures the angle between the line directions p1→p2; the rays may point the other way.
  const flipped = dot(ra, da) * dot(rb, db) < 0;
  return { origin, ra, rb, flipped };
}

/** The current value of a dimension from the geometry (what a driven dimension shows). */
export function measure(sketch: SketchData, dimension: DimensionDraft, positions: Positions = pointPositions(sketch)): number | null {
  switch (dimension.type) {
    case 'distance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      if (pa && pb) return length(sub(pb, pa));
      const la = lineEnds(sketch, positions, dimension.a);
      const lb = lineEnds(sketch, positions, dimension.b);
      const point = pa ?? pb ?? (la && lb ? lb[0] : null);
      const line = pa || pb ? (la ?? lb) : la;
      if (!point || !line) return null;
      return length(sub(point, foot(point, ...line)));
    }
    case 'horizontalDistance':
    case 'verticalDistance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      if (!pa || !pb) return null;
      const axis = dimension.type === 'horizontalDistance' ? 0 : 1;
      return Math.abs(pb[axis] - pa[axis]);
    }
    case 'radius':
    case 'diameter': {
      const round = roundOf(sketch, positions, dimension.circle);
      return round ? round.radius * (dimension.type === 'diameter' ? 2 : 1) : null;
    }
    case 'angle': {
      const la = lineEnds(sketch, positions, dimension.a);
      const lb = lineEnds(sketch, positions, dimension.b);
      if (!la || !lb) return null;
      const da = sub(la[1], la[0]);
      const db = sub(lb[1], lb[0]);
      return Math.atan2(cross(da, db), dot(da, db));
    }
  }
}

/** The angle the user sees between the two rays (0 … π) for a stored, signed solver angle. */
export function visibleAngle(sketch: SketchData, dimension: Extract<DimensionDraft, { type: 'angle' }>, value: number, positions: Positions = pointPositions(sketch)): number {
  const rays = angleRays(sketch, positions, dimension.a, dimension.b);
  return Math.abs(rays?.flipped ? wrap(value - Math.PI) : value);
}

/** The signed solver angle for an angle the user typed (degrees converted to radians, 0 … π). */
export function storedAngle(sketch: SketchData, dimension: Extract<DimensionDraft, { type: 'angle' }>, visible: number, positions: Positions = pointPositions(sketch)): number {
  const rays = angleRays(sketch, positions, dimension.a, dimension.b);
  const current = measure(sketch, dimension, positions) ?? 0;
  const sign = (rays?.flipped ? wrap(current - Math.PI) : current) < 0 ? -1 : 1;
  return rays?.flipped ? wrap(sign * visible + Math.PI) : sign * visible;
}

/** The value shown on the label: lengths in mm, angles in degrees (always the visible angle). */
export function displayValue(sketch: SketchData, dimension: DimensionDraft, positions: Positions = pointPositions(sketch)): number | null {
  const value = dimension.driving ? dimension.value : measure(sketch, dimension, positions);
  if (value === null) return null;
  return dimension.type === 'angle' ? (visibleAngle(sketch, dimension, value, positions) * 180) / Math.PI : value;
}

/** The point the label offset is measured from. */
export function dimensionAnchor(sketch: SketchData, dimension: DimensionDraft, positions: Positions = pointPositions(sketch)): Point2 | null {
  switch (dimension.type) {
    case 'distance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      if (pa && pb) return mid(pa, pb);
      const la = lineEnds(sketch, positions, dimension.a);
      const lb = lineEnds(sketch, positions, dimension.b);
      const point = pa ?? pb ?? (la && lb ? lb[0] : null);
      const line = pa || pb ? (la ?? lb) : la;
      return point && line ? mid(point, foot(point, ...line)) : null;
    }
    case 'horizontalDistance':
    case 'verticalDistance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      return pa && pb ? mid(pa, pb) : null;
    }
    case 'radius':
    case 'diameter':
      return roundOf(sketch, positions, dimension.circle)?.center ?? null;
    case 'angle':
      return angleRays(sketch, positions, dimension.a, dimension.b)?.origin ?? null;
  }
}

/**
 * The dimension the tool proposes for the picked entities (in pick order) when the label is
 * placed at `placement`. Two points (or a line, or two centers) give a horizontal distance when
 * the label is above or below them, a vertical distance when it is beside them, and the direct
 * distance otherwise; circles give their diameter, arcs their radius, crossing lines their angle.
 */
export function proposeDimension(sketch: SketchData, picks: readonly string[], placement: Point2): DimensionDraft | null {
  const positions = pointPositions(sketch);
  const kindOf = (id: string) => (positions.has(id) ? 'point' : (entityOf(sketch, id)?.type ?? null));
  const centerOf = (id: string) => {
    const entity = entityOf(sketch, id);
    return entity?.type === 'circle' || entity?.type === 'arc' || entity?.type === 'ellipse' ? entity.center : null;
  };
  // Measures the draft and stores where the label goes, relative to the dimension's anchor.
  const complete = (draft: DimensionDraft): DimensionDraft => {
    const anchor = dimensionAnchor(sketch, draft, positions) ?? placement;
    return { ...draft, value: measure(sketch, draft, positions) ?? 0, offset: [placement[0] - anchor[0], placement[1] - anchor[1]] };
  };
  const betweenPoints = (a: string, b: string): DimensionDraft | null => {
    const pa = positions.get(a);
    const pb = positions.get(b);
    if (!pa || !pb || a === b) return null;
    const [dx, dy] = [Math.abs(pb[0] - pa[0]), Math.abs(pb[1] - pa[1])];
    const size = Math.max(dx, dy, 1e-9);
    let type: 'distance' | 'horizontalDistance' | 'verticalDistance' = 'distance';
    if (dx > 1e-9 * size && dy > 1e-9 * size) {
      const insideX = placement[0] >= Math.min(pa[0], pb[0]) && placement[0] <= Math.max(pa[0], pb[0]);
      const insideY = placement[1] >= Math.min(pa[1], pb[1]) && placement[1] <= Math.max(pa[1], pb[1]);
      if (insideX && !insideY) type = 'horizontalDistance';
      else if (insideY && !insideX) type = 'verticalDistance';
    }
    return complete({ type, a, b, value: 0, driving: true } as DimensionDraft);
  };

  const [first, second] = picks;
  if (!first) return null;
  const firstKind = kindOf(first);
  if (!second) {
    if (firstKind === 'circle') return complete({ type: 'diameter', circle: first, value: 0, driving: true });
    if (firstKind === 'arc') return complete({ type: 'radius', circle: first, value: 0, driving: true });
    if (firstKind === 'line') {
      const line = entityOf(sketch, first);
      return line?.type === 'line' ? betweenPoints(line.p1, line.p2) : null;
    }
    return null;
  }
  const secondKind = kindOf(second);
  // Circles, arcs and ellipses are dimensioned at their centers.
  const pointLike = (id: string, kind: string | null) => (kind === 'point' ? id : kind === 'circle' || kind === 'arc' || kind === 'ellipse' ? centerOf(id) : null);
  const p1 = pointLike(first, firstKind);
  const p2 = pointLike(second, secondKind);
  if (p1 && p2) return betweenPoints(p1, p2);
  if (p1 && secondKind === 'line') return complete({ type: 'distance', a: p1, b: second, value: 0, driving: true });
  if (p2 && firstKind === 'line') return complete({ type: 'distance', a: p2, b: first, value: 0, driving: true });
  if (firstKind === 'line' && secondKind === 'line') {
    return angleRays(sketch, positions, first, second)
      ? complete({ type: 'angle', a: first, b: second, value: 0, driving: true })
      : complete({ type: 'distance', a: first, b: second, value: 0, driving: true });
  }
  return null;
}

export interface DimensionGraphic {
  /** Extension and dimension lines. */
  lines: [Point2, Point2][];
  /** Arrow tips and the direction each arrow points to. */
  arrows: { tip: Point2; direction: Point2 }[];
  label: Point2;
}

/** Arrowheads as two short strokes, `size` long (mm). */
export function arrowStrokes(arrow: { tip: Point2; direction: Point2 }, size: number): [Point2, Point2][] {
  const back = scale(arrow.direction, -size);
  const side = scale([-arrow.direction[1], arrow.direction[0]], size * 0.35);
  return [
    [arrow.tip, add(add(arrow.tip, back), side)],
    [arrow.tip, sub(add(arrow.tip, back), side)],
  ];
}

/** Lines for a distance between two positions, drawn parallel to `axis` at the label's level. */
function linearGraphic(a: Point2, b: Point2, label: Point2, axis: Point2, overshoot: number): DimensionGraphic {
  const d = unit(axis);
  const n: Point2 = [-d[1], d[0]];
  const level = dot(sub(label, a), n);
  const levelB = dot(sub(label, b), n);
  const ea = add(a, scale(n, level));
  const eb = add(b, scale(n, levelB));
  const lines: [Point2, Point2][] = [];
  const sa = Math.sign(level) || 1;
  const sb = Math.sign(levelB) || 1;
  if (Math.abs(level) > 1e-12) lines.push([a, add(ea, scale(n, sa * overshoot))]);
  if (Math.abs(levelB) > 1e-12) lines.push([b, add(eb, scale(n, sb * overshoot))]);
  // The dimension line runs between the extension lines and on to the label if it sits outside.
  const ta = 0;
  const tb = dot(sub(eb, ea), d);
  const tl = dot(sub(label, ea), d);
  const from = add(ea, scale(d, Math.min(ta, tb, tl)));
  const to = add(ea, scale(d, Math.max(ta, tb, tl)));
  lines.push([from, to]);
  const inward = unit(sub(eb, ea), d);
  return { lines, arrows: [{ tip: ea, direction: scale(inward, -1) }, { tip: eb, direction: inward }], label };
}

/** What to draw for a dimension; null if its geometry is missing. */
export function dimensionGraphic(sketch: SketchData, dimension: DimensionDraft, mmPerPixel: number, positions: Positions = pointPositions(sketch)): DimensionGraphic | null {
  const anchor = dimensionAnchor(sketch, dimension, positions);
  if (!anchor) return null;
  const offset = dimension.offset ?? [0, 0];
  const label = add(anchor, offset as Point2);
  const overshoot = 4 * mmPerPixel;
  switch (dimension.type) {
    case 'distance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      if (pa && pb) return linearGraphic(pa, pb, label, sub(pb, pa), overshoot);
      const la = lineEnds(sketch, positions, dimension.a);
      const lb = lineEnds(sketch, positions, dimension.b);
      const point = pa ?? pb ?? (la && lb ? lb[0] : null);
      const line = pa || pb ? (la ?? lb) : la;
      if (!point || !line) return null;
      const f = foot(point, ...line);
      const graphic = linearGraphic(point, f, label, sub(f, point), overshoot);
      // Show where the foot lies on the extension of a line that is too short.
      const t = dot(sub(f, line[0]), unit(sub(line[1], line[0])));
      if (t < 0) graphic.lines.push([line[0], f]);
      else if (t > length(sub(line[1], line[0]))) graphic.lines.push([line[1], f]);
      return graphic;
    }
    case 'horizontalDistance':
    case 'verticalDistance': {
      const pa = positions.get(dimension.a);
      const pb = positions.get(dimension.b);
      if (!pa || !pb) return null;
      return linearGraphic(pa, pb, label, dimension.type === 'horizontalDistance' ? [1, 0] : [0, 1], overshoot);
    }
    case 'radius':
    case 'diameter': {
      const round = roundOf(sketch, positions, dimension.circle);
      if (!round) return null;
      const u = unit(sub(label, round.center), [Math.SQRT1_2, Math.SQRT1_2]);
      const rim = add(round.center, scale(u, round.radius));
      const far = dimension.type === 'diameter' ? sub(round.center, scale(u, round.radius)) : round.center;
      const reach = length(sub(label, round.center)) > round.radius ? label : rim;
      const arrows = [{ tip: rim, direction: u }];
      if (dimension.type === 'diameter') arrows.push({ tip: far, direction: scale(u, -1) });
      return { lines: [[far, reach]], arrows, label };
    }
    case 'angle': {
      const rays = angleRays(sketch, positions, dimension.a, dimension.b);
      if (!rays) return null;
      const radius = Math.max(length(sub(label, rays.origin)), 8 * mmPerPixel);
      const start = Math.atan2(rays.ra[1], rays.ra[0]);
      const sweep = wrap(Math.atan2(rays.rb[1], rays.rb[0]) - start);
      const steps = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 48)));
      const lines: [Point2, Point2][] = [];
      const at = (angle: number): Point2 => add(rays.origin, [radius * Math.cos(angle), radius * Math.sin(angle)]);
      for (let i = 0; i < steps; i++) lines.push([at(start + (sweep * i) / steps), at(start + (sweep * (i + 1)) / steps)]);
      // Extension lines along the lines out to the arc, where the arc lies beyond their ends.
      for (const [ray, id] of [[rays.ra, dimension.a], [rays.rb, dimension.b]] as const) {
        const ends = lineEnds(sketch, positions, id);
        const reach = ends ? Math.max(...ends.map((end) => dot(sub(end, rays.origin), ray)), 0) : 0;
        if (radius > reach) lines.push([add(rays.origin, scale(ray, reach)), add(rays.origin, scale(ray, radius + overshoot))]);
      }
      const tangent = (angle: number, direction: number): Point2 => [-Math.sin(angle) * direction, Math.cos(angle) * direction];
      const s = Math.sign(sweep) || 1;
      return {
        lines,
        arrows: [
          { tip: at(start), direction: tangent(start, -s) },
          { tip: at(start + sweep), direction: tangent(start + sweep, s) },
        ],
        label,
      };
    }
  }
}

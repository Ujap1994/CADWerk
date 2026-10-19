/**
 * 2D sketches: geometry and constraints in the sketch plane's own coordinates (mm).
 * The solver (src/sketch/solver) moves the geometry so all constraints hold.
 */

import type { Vec3 } from './feature.ts';

/** The fixed sketch origin; every sketch can constrain to it. */
export const ORIGIN_ID = 'origin';

export interface SketchPoint {
  id: string;
  type: 'point';
  x: number;
  y: number;
  construction?: boolean;
}

export interface SketchLine {
  id: string;
  type: 'line';
  p1: string;
  p2: string;
  construction?: boolean;
}

export interface SketchCircle {
  id: string;
  type: 'circle';
  center: string;
  radius: number;
  construction?: boolean;
}

/** Arc from start to end, counterclockwise around center; the radius follows from the points. */
export interface SketchArc {
  id: string;
  type: 'arc';
  center: string;
  start: string;
  end: string;
  construction?: boolean;
}

/**
 * Ellipse around center. `major` and `minor` are the ends of its two axes (their distances from
 * the center are the semi-axes); the solver keeps the axes perpendicular. Either axis may be the
 * longer one.
 */
export interface SketchEllipse {
  id: string;
  type: 'ellipse';
  center: string;
  major: string;
  minor: string;
  construction?: boolean;
}

/**
 * Spline through its fit points (at least two): a natural cubic spline parameterized by chord length.
 * The points are ordinary sketch points; the curve follows them.
 */
export interface SketchSpline {
  id: string;
  type: 'spline';
  points: string[];
  construction?: boolean;
}

/** Most fit points a spline may have (limits damaged or hostile files). */
export const MAX_SPLINE_POINTS = 1000;

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;
export type SketchCurve = SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;

interface ConstraintBase {
  id: string;
}

/** Geometric relations. */
export type SketchRelation =
  | (ConstraintBase & { type: 'coincident'; a: string; b: string })
  | (ConstraintBase & { type: 'horizontal'; line: string })
  | (ConstraintBase & { type: 'vertical'; line: string })
  | (ConstraintBase & { type: 'horizontalPoints'; a: string; b: string })
  | (ConstraintBase & { type: 'verticalPoints'; a: string; b: string })
  | (ConstraintBase & { type: 'parallel'; a: string; b: string })
  | (ConstraintBase & { type: 'perpendicular'; a: string; b: string })
  | (ConstraintBase & { type: 'collinear'; a: string; b: string })
  | (ConstraintBase & { type: 'tangent'; a: string; b: string; inner?: boolean })
  | (ConstraintBase & { type: 'equal'; a: string; b: string })
  | (ConstraintBase & { type: 'concentric'; a: string; b: string })
  | (ConstraintBase & { type: 'midpoint'; point: string; line: string })
  | (ConstraintBase & { type: 'pointOnLine'; point: string; line: string })
  /** A point on a circle, arc or ellipse. */
  | (ConstraintBase & { type: 'pointOnCircle'; point: string; circle: string })
  | (ConstraintBase & { type: 'symmetric'; a: string; b: string; line: string })
  | (ConstraintBase & { type: 'fix'; point: string });

/**
 * Dimensions. A driving dimension controls the geometry; a driven (reference) dimension
 * only displays the current value. `offset` positions the label in sketch coordinates,
 * relative to the dimension's anchor.
 */
export type SketchDimension =
  | (ConstraintBase & { type: 'distance'; a: string; b: string; value: number; driving: boolean; offset?: [number, number] })
  | (ConstraintBase & { type: 'horizontalDistance'; a: string; b: string; value: number; driving: boolean; offset?: [number, number] })
  | (ConstraintBase & { type: 'verticalDistance'; a: string; b: string; value: number; driving: boolean; offset?: [number, number] })
  | (ConstraintBase & { type: 'radius'; circle: string; value: number; driving: boolean; offset?: [number, number] })
  | (ConstraintBase & { type: 'diameter'; circle: string; value: number; driving: boolean; offset?: [number, number] })
  | (ConstraintBase & { type: 'angle'; a: string; b: string; value: number; driving: boolean; offset?: [number, number] });

export type SketchConstraint = SketchRelation | SketchDimension;

export type SketchConstraintType = SketchConstraint['type'];

export const DIMENSION_TYPES: ReadonlySet<SketchConstraintType> = new Set(['distance', 'horizontalDistance', 'verticalDistance', 'radius', 'diameter', 'angle']);

export function isDimension(constraint: SketchConstraint): constraint is SketchDimension {
  return DIMENSION_TYPES.has(constraint.type);
}

/** The three planes through the origin. */
export type StandardPlane = 'front' | 'top' | 'right';

export const STANDARD_PLANES: readonly StandardPlane[] = ['front', 'top', 'right'];

/** Where a sketch lies: a standard plane or a planar face of the body. */
export type SketchPlaneRef =
  | { kind: 'standard'; plane: StandardPlane }
  | { kind: 'face'; face: number; frame: SketchFrame };

/** A plane in model space: origin plus orthonormal axes (sketch x, sketch y, normal). */
export interface SketchFrame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

/** Standard planes for Z up (see docs/adr/0004-coordinate-system-and-units.md). */
export const STANDARD_FRAMES: Record<StandardPlane, SketchFrame> = {
  front: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
  top: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  right: { origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] },
};

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Sketch frame on an arbitrary plane (e.g. a planar face), given a point on it and the
 * normal pointing out of the material. The origin is the part origin projected onto the
 * plane; the axes follow the standard views: up is +Z, or ±Y when looking along Z, so a
 * face parallel to a standard plane gets the same axes as that plane.
 */
export function frameOnPlane(point: Vec3, normal: Vec3): SketchFrame {
  const n = normalize(normal);
  const up: Vec3 = Math.abs(n[2]) > 0.999 ? [0, n[2] > 0 ? 1 : -1, 0] : [0, 0, 1];
  const xDir = normalize(cross(up, n));
  const yDir = cross(n, xDir);
  const offset = point[0] * n[0] + point[1] * n[1] + point[2] * n[2];
  // Avoid -0 in stored files.
  const clean = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0];
  return { origin: clean([n[0] * offset, n[1] * offset, n[2] * offset]), xDir: clean(xDir), yDir: clean(yDir), normal: clean(n) };
}

export function frameOf(plane: SketchPlaneRef): SketchFrame {
  return plane.kind === 'standard' ? STANDARD_FRAMES[plane.plane] : plane.frame;
}

export interface SketchData {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

export function emptySketch(): SketchData {
  return { entities: [], constraints: [] };
}

/** Converts a point in sketch coordinates to model space. */
export function toModel(frame: SketchFrame, x: number, y: number): Vec3 {
  return [
    frame.origin[0] + frame.xDir[0] * x + frame.yDir[0] * y,
    frame.origin[1] + frame.xDir[1] * x + frame.yDir[1] * y,
    frame.origin[2] + frame.xDir[2] * x + frame.yDir[2] * y,
  ];
}

/** Projects a model-space point onto the sketch plane (sketch coordinates). */
export function toSketch(frame: SketchFrame, point: Vec3): [number, number] {
  const d: Vec3 = [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]];
  return [d[0] * frame.xDir[0] + d[1] * frame.xDir[1] + d[2] * frame.xDir[2], d[0] * frame.yDir[0] + d[1] * frame.yDir[1] + d[2] * frame.yDir[2]];
}

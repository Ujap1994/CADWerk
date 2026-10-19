/**
 * Drawing tools of the sketcher as plain state machines: they receive cursor positions in
 * sketch coordinates and return what to preview and, when a shape is finished, the new sketch.
 * The SketchController connects them to the mouse, the 3D view and the undo history.
 */

import type { SketchData, SketchSpline } from '../../../shared/model/sketch.ts';
import { SketchBuilder, type PlacedPoint } from './builder.ts';
import { chamferCorner, cornerAt, filletCorner, type CornerError } from './corners.ts';
import { extensionTargets } from './intersect.ts';
import { extendAt, nearerEnd, piecePolyline, trimAt, trimPiece, type TrimError } from './trim.ts';
import { proposeDimension, type DimensionDraft } from './dimensions.ts';
import { arcGeometry, distanceToCurve, hitTest, isCurve, pointPositions, type Point2 } from './geometry.ts';
import { snapCursor, type SnapResult } from './snap.ts';

export type SketchToolName =
  | 'line'
  | 'centerline'
  | 'cornerRectangle'
  | 'centerRectangle'
  | 'threePointRectangle'
  | 'parallelogram'
  | 'circle'
  | 'threePointCircle'
  | 'ellipse'
  | 'centerArc'
  | 'threePointArc'
  | 'tangentArc'
  | 'slot'
  | 'polygon'
  | 'point'
  | 'spline'
  | 'sketchFillet'
  | 'sketchChamfer'
  | 'trim'
  | 'extend'
  | 'convert'
  | 'dimension';

export const SKETCH_TOOLS: readonly SketchToolName[] = [
  'line',
  'centerline',
  'cornerRectangle',
  'centerRectangle',
  'threePointRectangle',
  'parallelogram',
  'circle',
  'threePointCircle',
  'ellipse',
  'centerArc',
  'threePointArc',
  'tangentArc',
  'slot',
  'polygon',
  'point',
  'spline',
  'sketchFillet',
  'sketchChamfer',
  'trim',
  'extend',
  'convert',
  'dimension',
];

/** Settings of tools that have them. */
export interface ToolOptions {
  polygonSides: number;
  filletRadius: number;
  chamferDistance: number;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = { polygonSides: 6, filletRadius: 5, chamferDistance: 3 };

export interface ToolEvent {
  u: number;
  v: number;
  /** Snap distance in mm (a few pixels at the current zoom). */
  tolerance: number;
  /** Alignment distance in mm. */
  alignTolerance: number;
}

/** Relations the finished shape will get from the current cursor position. */
export type ToolRelation = 'horizontal' | 'vertical' | 'coincident' | 'midpoint' | 'onCurve' | 'tangent';

export interface ToolInfo {
  length?: number;
  /** Degrees. */
  angle?: number;
  width?: number;
  height?: number;
  radius?: number;
  relations: ToolRelation[];
}

export interface ToolPreview {
  /** Temporary geometry in sketch coordinates. */
  geometry: SketchData;
  snap: SnapResult;
  info: ToolInfo | null;
  /** The dimension the dimension tool would place at the cursor. */
  dimension?: DimensionDraft;
  /** Entities the dimension tool has picked so far. */
  picks?: readonly string[];
  /** What a click would remove (trim), as a polyline. */
  remove?: readonly Point2[];
}

export interface ToolStep {
  /** The sketch with the finished shape, or null if the click only placed an intermediate point. */
  commit: SketchData | null;
  preview: ToolPreview;
  /** A dimension to add: the value is asked for next. */
  place?: DimensionDraft;
  /** Why the click did nothing (a key in sketch.messages). */
  message?: string;
}

export interface SketchTool {
  readonly name: SketchToolName;
  /** A shape has been started: Esc ends it instead of leaving the tool. */
  readonly busy: boolean;
  hover(sketch: SketchData, event: ToolEvent): ToolPreview;
  click(sketch: SketchData, event: ToolEvent): ToolStep;
  /** Ends the current shape or chain; false if nothing was in progress. */
  cancel(): boolean;
}

const EMPTY: SketchData = { entities: [], constraints: [] };
/** Shapes smaller than this (relative to the snap distance) are ignored as accidental clicks. */
const MIN_SIZE_FACTOR = 0.25;

/** Temporary geometry for previews; ids only need to be unique within the preview. */
class Preview {
  readonly entities: SketchData['entities'] = [];
  private count = 0;

  point(at: Point2): string {
    const id = `tmp${this.count++}`;
    this.entities.push({ id, type: 'point', x: at[0], y: at[1] });
    return id;
  }

  line(a: Point2, b: Point2, construction = false): void {
    this.entities.push({ id: `tmp${this.count++}`, type: 'line', p1: this.point(a), p2: this.point(b), ...(construction ? { construction } : {}) });
  }

  circle(center: Point2, radius: number, construction = false): void {
    this.entities.push({ id: `tmp${this.count++}`, type: 'circle', center: this.point(center), radius, ...(construction ? { construction } : {}) });
  }

  arc(center: Point2, start: Point2, end: Point2, construction = false): void {
    this.entities.push({ id: `tmp${this.count++}`, type: 'arc', center: this.point(center), start: this.point(start), end: this.point(end), ...(construction ? { construction } : {}) });
  }

  spline(points: readonly Point2[]): void {
    this.entities.push({ id: `tmp${this.count++}`, type: 'spline', points: points.map((p) => this.point(p)) });
  }

  ellipse(center: Point2, major: Point2, minor: Point2): void {
    this.entities.push({ id: `tmp${this.count++}`, type: 'ellipse', center: this.point(center), major: this.point(major), minor: this.point(minor) });
  }

  build(): SketchData {
    return { entities: this.entities, constraints: [] };
  }
}

function at(placed: { u: number; v: number }): Point2 {
  return [placed.u, placed.v];
}

function placed(snap: SnapResult): PlacedPoint {
  return { u: snap.u, v: snap.v, target: snap.target };
}

function snapRelations(snap: SnapResult, withAlignment: boolean): ToolRelation[] {
  const relations: ToolRelation[] = [];
  if (snap.target.kind === 'point') relations.push('coincident');
  if (snap.target.kind === 'midpoint') relations.push('midpoint');
  if (snap.target.kind === 'curve') relations.push('onCurve');
  if (withAlignment) for (const alignment of snap.alignments) if (alignment.anchor) relations.push(alignment.axis);
  return relations;
}

function snapAt(sketch: SketchData, event: ToolEvent, anchor: Point2 | null = null): SnapResult {
  return snapCursor(sketch, pointPositions(sketch), event.u, event.v, { tolerance: event.tolerance, alignTolerance: event.alignTolerance, anchor });
}

/** Lines drawn as a connected chain; a click on the start point closes it, Esc or a second click on the same spot ends it. */
export class LineTool implements SketchTool {
  readonly name: 'line' | 'centerline';
  private readonly construction: boolean;
  private start: PlacedPoint | null = null;
  private chainStart: string | null = null;

  constructor(name: 'line' | 'centerline') {
    this.name = name;
    this.construction = name === 'centerline';
  }

  get busy(): boolean {
    return this.start !== null;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const start = this.start;
    const snap = snapAt(sketch, event, start ? at(start) : null);
    if (!start) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const preview = new Preview();
    preview.line(at(start), at(snap), this.construction);
    const du = snap.u - start.u;
    const dv = snap.v - start.v;
    return {
      geometry: preview.build(),
      snap,
      info: { length: Math.hypot(du, dv), angle: (Math.atan2(dv, du) * 180) / Math.PI, relations: snapRelations(snap, true) },
    };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const start = this.start;
    const snap = snapAt(sketch, event, start ? at(start) : null);
    if (!start) {
      this.start = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const samePoint = snap.target.kind === 'point' && start.target.kind === 'point' && snap.target.id === start.target.id;
    if (samePoint || Math.hypot(snap.u - start.u, snap.v - start.v) < event.tolerance * MIN_SIZE_FACTOR) {
      // A second click on the same spot (or a double click) ends the chain.
      this.cancel();
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const builder = new SketchBuilder(sketch);
    const p1 = builder.point(start);
    const p2 = builder.point(placed(snap));
    const line = builder.line(p1, p2, this.construction);
    for (const alignment of snap.alignments) if (alignment.anchor) builder.relation({ type: alignment.axis, line });
    const closes = snap.target.kind === 'point' && snap.target.id === (this.chainStart ?? p1);
    this.chainStart ??= p1;
    if (closes) this.cancel();
    else this.start = { u: snap.u, v: snap.v, target: { kind: 'point', id: p2 } };
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.start = null;
    this.chainStart = null;
    return busy;
  }
}

/** Rectangles from two opposite corners, or from the center and a corner. */
export class RectangleTool implements SketchTool {
  readonly name: 'cornerRectangle' | 'centerRectangle';
  private first: PlacedPoint | null = null;

  constructor(name: 'cornerRectangle' | 'centerRectangle') {
    this.name = name;
  }

  get busy(): boolean {
    return this.first !== null;
  }

  /** The four corners (counterclockwise from the first corner of the bottom edge order) for a cursor position. */
  private corners(first: PlacedPoint, corner: Point2): [Point2, Point2, Point2, Point2] {
    if (this.name === 'cornerRectangle') return [at(first), [corner[0], first.v], corner, [first.u, corner[1]]];
    const opposite: Point2 = [2 * first.u - corner[0], 2 * first.v - corner[1]];
    return [opposite, [corner[0], opposite[1]], corner, [opposite[0], corner[1]]];
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const first = this.first;
    if (!first) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const corners = this.corners(first, at(snap));
    const preview = new Preview();
    for (let i = 0; i < 4; i++) preview.line(corners[i] as Point2, corners[(i + 1) % 4] as Point2);
    if (this.name === 'centerRectangle') {
      preview.line(corners[0], corners[2], true);
      preview.line(corners[1], corners[3], true);
    }
    return {
      geometry: preview.build(),
      snap,
      info: { width: Math.abs(corners[2][0] - corners[0][0]), height: Math.abs(corners[2][1] - corners[0][1]), relations: snapRelations(snap, false) },
    };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const first = this.first;
    if (!first) {
      this.first = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const corners = this.corners(first, at(snap));
    const minimum = event.tolerance * MIN_SIZE_FACTOR;
    if (Math.abs(corners[2][0] - corners[0][0]) < minimum || Math.abs(corners[2][1] - corners[0][1]) < minimum) {
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const builder = new SketchBuilder(sketch);
    let points: string[];
    if (this.name === 'cornerRectangle') {
      points = [builder.point(first), builder.freePoint(...corners[1]), builder.point(placed(snap)), builder.freePoint(...corners[3])];
    } else {
      points = [builder.freePoint(...corners[0]), builder.freePoint(...corners[1]), builder.point(placed(snap)), builder.freePoint(...corners[3])];
    }
    const sides = points.map((p, i) => builder.line(p, points[(i + 1) % 4] as string));
    sides.forEach((side, i) => builder.relation({ type: i % 2 === 0 ? 'horizontal' : 'vertical', line: side }));
    if (this.name === 'centerRectangle') {
      const center = builder.point(first);
      const diagonal = builder.line(points[0] as string, points[2] as string, true);
      builder.line(points[1] as string, points[3] as string, true);
      builder.relation({ type: 'midpoint', point: center, line: diagonal });
    }
    this.first = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.first = null;
    return busy;
  }
}

/** Circles from the center and a point on the circle. */
export class CircleTool implements SketchTool {
  readonly name = 'circle' as const;
  private center: PlacedPoint | null = null;

  get busy(): boolean {
    return this.center !== null;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const center = this.center;
    if (!center) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const radius = Math.hypot(snap.u - center.u, snap.v - center.v);
    const preview = new Preview();
    preview.circle(at(center), radius);
    preview.line(at(center), at(snap), true);
    return { geometry: preview.build(), snap, info: { radius, relations: snapRelations(snap, false) } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const center = this.center;
    if (!center) {
      this.center = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const radius = Math.hypot(snap.u - center.u, snap.v - center.v);
    if (radius < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const circle = builder.circle(builder.point(center), radius);
    // A circle through an existing point keeps passing through it.
    if (snap.target.kind === 'point') builder.relation({ type: 'pointOnCircle', point: snap.target.id, circle });
    this.center = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.center = null;
    return busy;
  }
}

/**
 * Splines through clicked points. From the second point on, every click adds a fit point to the
 * sketch (one undo step each, like a chain of lines); Esc or a second click on the last point ends the
 * spline, and so does a click on its first point (which closes it).
 */
export class SplineTool implements SketchTool {
  readonly name = 'spline' as const;
  private first: PlacedPoint | null = null;
  private spline: string | null = null;
  private last: Point2 | null = null;

  get busy(): boolean {
    return this.last !== null;
  }

  /** The spline being drawn, if it is still in the sketch (undo may have removed it). */
  private current(sketch: SketchData): SketchSpline | null {
    const entity = this.spline ? sketch.entities.find((candidate) => candidate.id === this.spline) : undefined;
    return entity?.type === 'spline' ? entity : null;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event, this.last);
    const last = this.last;
    if (!last) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const positions = pointPositions(sketch);
    const spline = this.current(sketch);
    const placedSoFar = spline ? spline.points.map((id) => positions.get(id)).filter((p): p is Point2 => p !== undefined) : this.first ? [at(this.first)] : [];
    const preview = new Preview();
    preview.spline([...placedSoFar, at(snap)]);
    return { geometry: preview.build(), snap, info: { length: Math.hypot(snap.u - last[0], snap.v - last[1]), relations: snapRelations(snap, true) } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event, this.last);
    let spline = this.current(sketch);
    if (this.spline && !spline) this.cancel();
    if (!this.last) {
      this.first = placed(snap);
      this.last = at(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const lastId = spline?.points.at(-1);
    const sameAsLast = snap.target.kind === 'point' && snap.target.id === lastId;
    if (sameAsLast || Math.hypot(snap.u - this.last[0], snap.v - this.last[1]) < event.tolerance * MIN_SIZE_FACTOR) {
      // A second click on the same spot (or a double click) ends the spline.
      this.cancel();
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const builder = new SketchBuilder(sketch);
    const point = builder.point(placed(snap));
    if (!spline) {
      this.spline = builder.spline([builder.point(this.first as PlacedPoint), point]);
    } else {
      builder.replace(spline.id, { ...spline, points: [...spline.points, point] });
      spline = { ...spline, points: [...spline.points, point] };
    }
    const closes = spline !== null && snap.target.kind === 'point' && snap.target.id === spline.points[0];
    if (closes) this.cancel();
    else this.last = at(snap);
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.first = null;
    this.spline = null;
    this.last = null;
    return busy;
  }
}

/**
 * Ellipses: the center, the end of one axis (it snaps and aligns with the center), then the other
 * semi-axis from the cursor's distance to the first axis.
 */
export class EllipseTool implements SketchTool {
  readonly name = 'ellipse' as const;
  private center: PlacedPoint | null = null;
  private major: SnapResult | null = null;

  get busy(): boolean {
    return this.center !== null;
  }

  /** The end of the second axis for a cursor position: perpendicular to the first, on the cursor's side. */
  private minorAt(center: Point2, major: Point2, cursor: Point2): Point2 {
    const d = unit(sub(major, center));
    const n: Point2 = [-d[1], d[0]];
    const b = dot(sub(cursor, center), n);
    return [center[0] + n[0] * b, center[1] + n[1] * b];
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const center = this.center;
    const major = this.major;
    const snap = snapAt(sketch, event, center && !major ? at(center) : null);
    if (!center) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const preview = new Preview();
    if (!major) {
      preview.line(at(center), at(snap), true);
      const du = snap.u - center.u;
      const dv = snap.v - center.v;
      return { geometry: preview.build(), snap, info: { length: Math.hypot(du, dv), angle: (Math.atan2(dv, du) * 180) / Math.PI, relations: snapRelations(snap, true) } };
    }
    const minor = this.minorAt(at(center), at(major), [event.u, event.v]);
    preview.ellipse(at(center), at(major), minor);
    preview.line(at(center), at(major), true);
    preview.line(at(center), minor, true);
    const a = Math.hypot(major.u - center.u, major.v - center.v);
    const b = Math.hypot(minor[0] - center.u, minor[1] - center.v);
    return { geometry: preview.build(), snap: { ...snap, target: { kind: 'none' }, alignments: [] }, info: { width: 2 * a, height: 2 * b, relations: [] } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const center = this.center;
    const snap = snapAt(sketch, event, center && !this.major ? at(center) : null);
    const minimum = event.tolerance * MIN_SIZE_FACTOR;
    if (!center) {
      this.center = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    if (!this.major) {
      if (Math.hypot(snap.u - center.u, snap.v - center.v) < minimum) return { commit: null, preview: this.hover(sketch, event) };
      this.major = snap;
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const major = this.major;
    const minor = this.minorAt(at(center), at(major), [event.u, event.v]);
    if (Math.hypot(minor[0] - center.u, minor[1] - center.v) < minimum) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const c = builder.point(center);
    const end = builder.point(placed(major));
    builder.ellipse(c, end, builder.freePoint(...minor));
    // An axis drawn horizontally or vertically keeps that direction.
    for (const alignment of major.alignments) {
      if (alignment.anchor) builder.relation({ type: alignment.axis === 'horizontal' ? 'horizontalPoints' : 'verticalPoints', a: c, b: end });
    }
    this.center = null;
    this.major = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.center = null;
    this.major = null;
    return busy;
  }
}

/** Arcs from the center, the start point and the end point; the direction follows the mouse. */
export class CenterArcTool implements SketchTool {
  readonly name = 'centerArc' as const;
  private center: PlacedPoint | null = null;
  private start: PlacedPoint | null = null;
  /** Signed sweep accumulated from the mouse movement (radians, counterclockwise positive). */
  private sweep = 0;
  private lastAngle: number | null = null;

  get busy(): boolean {
    return this.center !== null;
  }

  private track(u: number, v: number): void {
    if (!this.center) return;
    const angle = Math.atan2(v - this.center.v, u - this.center.u);
    if (this.lastAngle !== null) {
      let delta = angle - this.lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      this.sweep += delta;
    }
    this.lastAngle = angle;
  }

  /** The end point on the arc's circle in the cursor's direction. */
  private endAt(center: PlacedPoint, start: PlacedPoint, snap: SnapResult): Point2 {
    const radius = Math.hypot(start.u - center.u, start.v - center.v);
    const angle = Math.atan2(snap.v - center.v, snap.u - center.u);
    return [center.u + radius * Math.cos(angle), center.v + radius * Math.sin(angle)];
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const { center, start } = this;
    if (!center) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const preview = new Preview();
    if (!start) {
      preview.line(at(center), at(snap), true);
      return { geometry: preview.build(), snap, info: { radius: Math.hypot(snap.u - center.u, snap.v - center.v), relations: snapRelations(snap, false) } };
    }
    this.track(snap.u, snap.v);
    const end = this.endAt(center, start, snap);
    const counterclockwise = this.sweep >= 0;
    preview.arc(at(center), counterclockwise ? at(start) : end, counterclockwise ? end : at(start));
    preview.line(at(center), end, true);
    const arc = arcGeometry(at(center), counterclockwise ? at(start) : end, counterclockwise ? end : at(start));
    return { geometry: preview.build(), snap, info: { radius: arc.radius, angle: (arc.sweep * 180) / Math.PI, relations: [] } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const { center, start } = this;
    if (!center) {
      this.center = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    if (!start) {
      if (Math.hypot(snap.u - center.u, snap.v - center.v) < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
      this.start = placed(snap);
      this.sweep = 0;
      this.lastAngle = Math.atan2(snap.v - center.v, snap.u - center.u);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    this.track(snap.u, snap.v);
    const end = this.endAt(center, start, snap);
    const radius = Math.hypot(start.u - center.u, start.v - center.v);
    if (Math.hypot(end[0] - start.u, end[1] - start.v) < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const c = builder.point(center);
    const s = builder.point(start);
    // The end point snaps to an existing point only if that point lies on the arc's circle.
    const onCircle = snap.target.kind === 'point' && Math.abs(Math.hypot(snap.u - center.u, snap.v - center.v) - radius) <= event.tolerance;
    const e = onCircle ? builder.point(placed(snap)) : builder.freePoint(...end);
    if (this.sweep >= 0) builder.arc(c, s, e);
    else builder.arc(c, e, s);
    this.cancel();
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.center = null;
    this.start = null;
    this.sweep = 0;
    this.lastAngle = null;
    return busy;
  }
}

/** Center of the circle through three points, or null if they are (nearly) collinear. */
export function circumcenter(a: Point2, b: Point2, c: Point2): Point2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const scale = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]), 1e-12);
  if (Math.abs(d) < 1e-9 * scale * scale) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

/** Whether `through` lies on the counterclockwise arc from `start` to `end` around `center`. */
function onCounterclockwiseArc(center: Point2, start: Point2, end: Point2, through: Point2): boolean {
  const sweep = arcGeometry(center, start, end).sweep;
  return arcGeometry(center, start, through).sweep <= sweep;
}

/** Arcs from the start point, the end point and a third point that sets the curvature. */
export class ThreePointArcTool implements SketchTool {
  readonly name = 'threePointArc' as const;
  private start: PlacedPoint | null = null;
  private end: PlacedPoint | null = null;

  get busy(): boolean {
    return this.start !== null;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const { start, end } = this;
    if (!start) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const preview = new Preview();
    if (!end) {
      preview.line(at(start), at(snap), true);
      return { geometry: preview.build(), snap, info: { length: Math.hypot(snap.u - start.u, snap.v - start.v), relations: snapRelations(snap, false) } };
    }
    const center = circumcenter(at(start), at(end), at(snap));
    if (!center) {
      preview.line(at(start), at(end));
      return { geometry: preview.build(), snap, info: null };
    }
    const ccw = onCounterclockwiseArc(center, at(start), at(end), at(snap));
    const [s, e] = ccw ? [at(start), at(end)] : [at(end), at(start)];
    preview.arc(center, s, e);
    const arc = arcGeometry(center, s, e);
    return { geometry: preview.build(), snap, info: { radius: arc.radius, angle: (arc.sweep * 180) / Math.PI, relations: [] } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const { start, end } = this;
    const minimum = event.tolerance * MIN_SIZE_FACTOR;
    if (!start) {
      this.start = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    if (!end) {
      if (Math.hypot(snap.u - start.u, snap.v - start.v) < minimum) return { commit: null, preview: this.hover(sketch, event) };
      this.end = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const center = circumcenter(at(start), at(end), at(snap));
    if (!center) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const c = builder.freePoint(...center);
    const s = builder.point(start);
    const e = builder.point(end);
    if (onCounterclockwiseArc(center, at(start), at(end), at(snap))) builder.arc(c, s, e);
    else builder.arc(c, e, s);
    this.cancel();
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.start = null;
    this.end = null;
    return busy;
  }
}

/** Sketch points, e.g. for hole positions; on a curve or a midpoint they get the matching relation. */
export class PointTool implements SketchTool {
  readonly name = 'point' as const;
  readonly busy = false;

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    if (snap.target.kind === 'point') return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    builder.point(placed(snap));
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    return false;
  }
}

/**
 * Smart dimension: pick one or two entities, move the label to where it belongs and click.
 * What is dimensioned follows from the picks and from where the label goes (see proposeDimension).
 */
export class DimensionTool implements SketchTool {
  readonly name = 'dimension' as const;
  private picks: string[] = [];

  get busy(): boolean {
    return this.picks.length > 0;
  }

  private hit(sketch: SketchData, event: ToolEvent) {
    return hitTest(sketch, pointPositions(sketch), event.u, event.v, event.tolerance * 0.75);
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const hit = this.hit(sketch, event);
    const target: SnapResult['target'] = !hit
      ? { kind: 'none' }
      : hit.type === 'point'
        ? { kind: 'point', id: hit.id }
        : { kind: 'curve', curve: hit.id, curveType: hit.type };
    const draft = this.picks.length > 0 ? proposeDimension(sketch, this.picks, [event.u, event.v]) : null;
    return { geometry: EMPTY, snap: { u: event.u, v: event.v, target, alignments: [] }, info: null, picks: this.picks, ...(draft ? { dimension: draft } : {}) };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const hit = this.hit(sketch, event);
    if (hit) {
      const [first] = this.picks;
      if (!this.picks.includes(hit.id)) {
        // A second entity joins the first if the two can be dimensioned together; otherwise it starts over.
        this.picks = first && this.picks.length === 1 && proposeDimension(sketch, [first, hit.id], [event.u, event.v]) ? [first, hit.id] : [hit.id];
      }
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const draft = this.picks.length > 0 ? proposeDimension(sketch, this.picks, [event.u, event.v]) : null;
    this.picks = [];
    return { commit: null, preview: this.hover(sketch, event), ...(draft ? { place: draft } : {}) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.picks = [];
    return busy;
  }
}

const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
function unit(a: Point2): Point2 {
  const l = Math.hypot(a[0], a[1]);
  return l > 0 ? [a[0] / l, a[1] / l] : [1, 0];
}

/**
 * Where a curve that ends at `pointId` leaves that point: the direction to continue tangentially,
 * and the curve. The most recently drawn curve wins when several end there.
 */
export function tangentAt(sketch: SketchData, pointId: string): { direction: Point2; curve: string; center: Point2 | null } | null {
  const positions = pointPositions(sketch);
  const at = positions.get(pointId);
  if (!at) return null;
  for (let i = sketch.entities.length - 1; i >= 0; i--) {
    const entity = sketch.entities[i];
    if (!entity || !isCurve(entity) || entity.construction) continue;
    if (entity.type === 'line' && (entity.p1 === pointId || entity.p2 === pointId)) {
      const other = positions.get(entity.p1 === pointId ? entity.p2 : entity.p1);
      if (other) return { direction: unit(sub(at, other)), curve: entity.id, center: null };
    }
    if (entity.type === 'arc' && (entity.start === pointId || entity.end === pointId)) {
      const center = positions.get(entity.center);
      if (!center) continue;
      const [rx, ry] = sub(at, center);
      // Leaving the end of a counterclockwise arc turns left of the radius; leaving its start, right.
      return { direction: unit(entity.end === pointId ? [-ry, rx] : [ry, -rx]), curve: entity.id, center };
    }
  }
  return null;
}

/** The arc that starts at `start` in `direction` and ends at `end`; null if the end lies on the tangent. */
export function tangentArcThrough(start: Point2, direction: Point2, end: Point2): { center: Point2; radius: number; counterclockwise: boolean } | null {
  const normal: Point2 = [-direction[1], direction[0]];
  const chord = sub(start, end);
  const denominator = 2 * dot(normal, chord);
  if (Math.abs(denominator) < 1e-9 * Math.max(1, dot(chord, chord))) return null;
  const signed = -dot(chord, chord) / denominator;
  return { center: [start[0] + normal[0] * signed, start[1] + normal[1] * signed], radius: Math.abs(signed), counterclockwise: signed > 0 };
}

/** Arcs that continue a line or arc tangentially from its end point. */
export class TangentArcTool implements SketchTool {
  readonly name = 'tangentArc' as const;
  private start: { id: string; at: Point2; direction: Point2; curve: string; center: Point2 | null } | null = null;

  get busy(): boolean {
    return this.start !== null;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const start = this.start;
    if (!start) {
      const usable = snap.target.kind === 'point' && tangentAt(sketch, snap.target.id) !== null;
      return { geometry: EMPTY, snap: usable ? snap : { ...snap, target: { kind: 'none' } }, info: null };
    }
    const arc = tangentArcThrough(start.at, start.direction, at(snap));
    const preview = new Preview();
    if (!arc) {
      preview.line(start.at, at(snap));
      return { geometry: preview.build(), snap, info: null };
    }
    preview.arc(arc.center, arc.counterclockwise ? start.at : at(snap), arc.counterclockwise ? at(snap) : start.at);
    const geometry = arcGeometry(arc.center, arc.counterclockwise ? start.at : at(snap), arc.counterclockwise ? at(snap) : start.at);
    return { geometry: preview.build(), snap, info: { radius: arc.radius, angle: (geometry.sweep * 180) / Math.PI, relations: ['tangent', ...snapRelations(snap, false)] } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const start = this.start;
    if (!start) {
      const tangent = snap.target.kind === 'point' ? tangentAt(sketch, snap.target.id) : null;
      if (tangent && snap.target.kind === 'point') this.start = { id: snap.target.id, at: at(snap), ...tangent };
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const arc = tangentArcThrough(start.at, start.direction, at(snap));
    if (!arc || Math.hypot(snap.u - start.at[0], snap.v - start.at[1]) < event.tolerance * MIN_SIZE_FACTOR) {
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const builder = new SketchBuilder(sketch);
    const center = builder.freePoint(...arc.center);
    const end = builder.point(placed(snap));
    const id = arc.counterclockwise ? builder.arc(center, start.id, end) : builder.arc(center, end, start.id);
    // Two arcs touch from inside when their centers lie on the same side of the shared point.
    const inner = start.center !== null && dot(sub(start.center, start.at), sub(arc.center, start.at)) > 0;
    builder.relation(inner ? { type: 'tangent', a: start.curve, b: id, inner } : { type: 'tangent', a: start.curve, b: id });
    this.start = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.start = null;
    return busy;
  }
}

/**
 * Rectangles at any angle and parallelograms: the first two clicks set one side, the third the
 * other side (for the rectangle only its length counts, it stays perpendicular).
 */
export class SkewRectangleTool implements SketchTool {
  readonly name: 'threePointRectangle' | 'parallelogram';
  private first: PlacedPoint | null = null;
  private second: SnapResult | null = null;

  constructor(name: 'threePointRectangle' | 'parallelogram') {
    this.name = name;
  }

  get busy(): boolean {
    return this.first !== null;
  }

  /** The four corners for the third click: a, b, then the two corners of the opposite side. */
  private corners(a: Point2, b: Point2, third: Point2): [Point2, Point2, Point2, Point2] {
    if (this.name === 'parallelogram') return [a, b, third, [a[0] + third[0] - b[0], a[1] + third[1] - b[1]]];
    const d = unit(sub(b, a));
    const n: Point2 = [-d[1], d[0]];
    const width = dot(sub(third, b), n);
    return [a, b, [b[0] + n[0] * width, b[1] + n[1] * width], [a[0] + n[0] * width, a[1] + n[1] * width]];
  }

  private info(corners: [Point2, Point2, Point2, Point2]): ToolInfo {
    const [a, b, c] = corners;
    const side = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const other = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (this.name === 'threePointRectangle') return { width: side, height: other, relations: [] };
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(sub(a, b), sub(c, b)) / Math.max(1e-12, side * other))));
    return { length: other, angle: (angle * 180) / Math.PI, relations: [] };
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const first = this.first;
    const second = this.second;
    const snap = snapAt(sketch, event, first && !second ? at(first) : null);
    if (!first) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const preview = new Preview();
    if (!second) {
      preview.line(at(first), at(snap));
      const du = snap.u - first.u;
      const dv = snap.v - first.v;
      return { geometry: preview.build(), snap, info: { length: Math.hypot(du, dv), angle: (Math.atan2(dv, du) * 180) / Math.PI, relations: snapRelations(snap, true) } };
    }
    // The rectangle's third corner follows from the side and the distance, so only the parallelogram snaps.
    const third = this.name === 'parallelogram' ? at(snap) : [event.u, event.v] as Point2;
    const corners = this.corners(at(first), at(second), third);
    for (let i = 0; i < 4; i++) preview.line(corners[i] as Point2, corners[(i + 1) % 4] as Point2);
    const shownSnap = this.name === 'parallelogram' ? snap : { ...snap, target: { kind: 'none' as const }, alignments: [] };
    const info = this.info(corners);
    if (this.name === 'parallelogram') info.relations = snapRelations(snap, false);
    return { geometry: preview.build(), snap: shownSnap, info };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const first = this.first;
    const snap = snapAt(sketch, event, first && !this.second ? at(first) : null);
    const minimum = event.tolerance * MIN_SIZE_FACTOR;
    if (!first) {
      this.first = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    if (!this.second) {
      if (Math.hypot(snap.u - first.u, snap.v - first.v) < minimum) return { commit: null, preview: this.hover(sketch, event) };
      this.second = snap;
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const second = this.second;
    const third = this.name === 'parallelogram' ? at(snap) : [event.u, event.v] as Point2;
    const corners = this.corners(at(first), at(second), third);
    if (Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]) < minimum) return { commit: null, preview: this.hover(sketch, event) };
    // A parallelogram with its sides in line would collapse.
    const d = unit(sub(corners[1], corners[0]));
    if (Math.abs(dot(sub(corners[2], corners[1]), [-d[1], d[0]])) < minimum) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const points = [
      builder.point(first),
      builder.point(placed(second)),
      this.name === 'parallelogram' ? builder.point(placed(snap)) : builder.freePoint(...corners[2]),
      builder.freePoint(...corners[3]),
    ];
    const [s0, s1, s2, s3] = points.map((p, i) => builder.line(p, points[(i + 1) % 4] as string)) as [string, string, string, string];
    builder.relation({ type: 'parallel', a: s0, b: s2 });
    builder.relation({ type: 'parallel', a: s1, b: s3 });
    if (this.name === 'threePointRectangle') builder.relation({ type: 'perpendicular', a: s0, b: s1 });
    for (const alignment of second.alignments) if (alignment.anchor) builder.relation({ type: alignment.axis, line: s0 });
    this.first = null;
    this.second = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.first = null;
    this.second = null;
    return busy;
  }
}

/** Circles through three points. */
export class ThreePointCircleTool implements SketchTool {
  readonly name = 'threePointCircle' as const;
  private points: SnapResult[] = [];

  get busy(): boolean {
    return this.points.length > 0;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const [a, b] = this.points;
    const preview = new Preview();
    if (a && !b) preview.line(at(a), at(snap), true);
    if (a && b) {
      const center = circumcenter(at(a), at(b), at(snap));
      if (center) {
        const radius = Math.hypot(a.u - center[0], a.v - center[1]);
        preview.circle(center, radius);
        return { geometry: preview.build(), snap, info: { radius, relations: snapRelations(snap, false) } };
      }
      preview.line(at(a), at(b));
    }
    return { geometry: preview.build(), snap, info: { relations: snapRelations(snap, false) } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    const points = [...this.points, snap];
    const [a, b, c] = points;
    if (!a || !b || !c) {
      if (a && b && Math.hypot(b.u - a.u, b.v - a.v) < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
      this.points = points;
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const center = circumcenter(at(a), at(b), at(c));
    if (!center) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const circle = builder.circle(builder.freePoint(...center), Math.hypot(a.u - center[0], a.v - center[1]));
    // The circle keeps passing through the existing points it was drawn through.
    for (const point of points) if (point.target.kind === 'point') builder.relation({ type: 'pointOnCircle', point: point.target.id, circle });
    this.points = [];
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.points = [];
    return busy;
  }
}

/** Straight slots: the two arc centers, then the width. Lines and arcs are tangent and of equal radius. */
export class SlotTool implements SketchTool {
  readonly name = 'slot' as const;
  private first: PlacedPoint | null = null;
  private second: SnapResult | null = null;

  get busy(): boolean {
    return this.first !== null;
  }

  /** Corners of the slot: start and end of both straight sides. */
  private outline(a: Point2, b: Point2, radius: number): { normal: Point2; corners: [Point2, Point2, Point2, Point2] } {
    const d = unit(sub(b, a));
    const n: Point2 = [-d[1], d[0]];
    const off = (p: Point2, s: number): Point2 => [p[0] + n[0] * radius * s, p[1] + n[1] * radius * s];
    return { normal: n, corners: [off(a, 1), off(b, 1), off(b, -1), off(a, -1)] };
  }

  private radiusAt(a: Point2, b: Point2, cursor: Point2): number {
    const d = unit(sub(b, a));
    return Math.abs(dot(sub(cursor, a), [-d[1], d[0]]));
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const first = this.first;
    const snap = snapAt(sketch, event, first && !this.second ? at(first) : null);
    const preview = new Preview();
    if (first && !this.second) {
      preview.line(at(first), at(snap), true);
      return { geometry: preview.build(), snap, info: { length: Math.hypot(snap.u - first.u, snap.v - first.v), relations: snapRelations(snap, true) } };
    }
    if (first && this.second) {
      const radius = this.radiusAt(at(first), at(this.second), [event.u, event.v]);
      const { corners } = this.outline(at(first), at(this.second), radius);
      preview.line(corners[0], corners[1]);
      preview.line(corners[2], corners[3]);
      preview.arc(at(this.second), corners[2], corners[1]);
      preview.arc(at(first), corners[0], corners[3]);
      preview.line(at(first), at(this.second), true);
      return { geometry: preview.build(), snap: { ...snap, target: { kind: 'none' }, alignments: [] }, info: { radius, relations: [] } };
    }
    return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const first = this.first;
    const snap = snapAt(sketch, event, first && !this.second ? at(first) : null);
    if (!first) {
      this.first = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    if (!this.second) {
      if (Math.hypot(snap.u - first.u, snap.v - first.v) < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
      this.second = snap;
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const second = this.second;
    const radius = this.radiusAt(at(first), at(second), [event.u, event.v]);
    if (radius < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
    const { corners } = this.outline(at(first), at(second), radius);
    const builder = new SketchBuilder(sketch);
    const c1 = builder.point(first);
    const c2 = builder.point(placed(second));
    const [p0, p1, p2, p3] = corners.map((corner) => builder.freePoint(...corner)) as [string, string, string, string];
    const top = builder.line(p0, p1);
    const bottom = builder.line(p2, p3);
    // The end arcs run counterclockwise around the outside of the slot.
    const end = builder.arc(c2, p2, p1);
    const startArc = builder.arc(c1, p0, p3);
    const axis = builder.line(c1, c2, true);
    for (const [line, arc] of [[top, end], [top, startArc], [bottom, end], [bottom, startArc]] as const) builder.relation({ type: 'tangent', a: line, b: arc });
    builder.relation({ type: 'equal', a: startArc, b: end });
    for (const alignment of second.alignments) if (alignment.anchor) builder.relation({ type: alignment.axis, line: axis });
    this.first = null;
    this.second = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.first = null;
    this.second = null;
    return busy;
  }
}

/** Regular polygons from the center and one corner, around a construction circle. */
export class PolygonTool implements SketchTool {
  readonly name = 'polygon' as const;
  private readonly sides: number;
  private center: PlacedPoint | null = null;

  constructor(sides: number) {
    this.sides = Math.max(3, Math.min(64, Math.round(sides)));
  }

  get busy(): boolean {
    return this.center !== null;
  }

  private corners(center: Point2, corner: Point2): Point2[] {
    const radius = Math.hypot(corner[0] - center[0], corner[1] - center[1]);
    const start = Math.atan2(corner[1] - center[1], corner[0] - center[0]);
    return Array.from({ length: this.sides }, (_, i) => {
      const angle = start + (2 * Math.PI * i) / this.sides;
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)] as Point2;
    });
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const center = this.center;
    const snap = snapAt(sketch, event, center ? at(center) : null);
    if (!center) return { geometry: EMPTY, snap, info: { relations: snapRelations(snap, false) } };
    const corners = this.corners(at(center), at(snap));
    const preview = new Preview();
    corners.forEach((corner, i) => preview.line(corner, corners[(i + 1) % corners.length] as Point2));
    const radius = Math.hypot(snap.u - center.u, snap.v - center.v);
    preview.circle(at(center), radius, true);
    return { geometry: preview.build(), snap, info: { radius, relations: snapRelations(snap, true).filter((relation) => relation === 'horizontal' || relation === 'vertical') } };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const center = this.center;
    const snap = snapAt(sketch, event, center ? at(center) : null);
    if (!center) {
      this.center = placed(snap);
      return { commit: null, preview: this.hover(sketch, event) };
    }
    const radius = Math.hypot(snap.u - center.u, snap.v - center.v);
    if (radius < event.tolerance * MIN_SIZE_FACTOR) return { commit: null, preview: this.hover(sketch, event) };
    const builder = new SketchBuilder(sketch);
    const c = builder.point(center);
    const circle = builder.circle(c, radius, true);
    const points = this.corners(at(center), at(snap)).map((corner) => builder.freePoint(...corner));
    const sides = points.map((point, i) => builder.line(point, points[(i + 1) % points.length] as string));
    for (const point of points) builder.relation({ type: 'pointOnCircle', point, circle });
    for (const side of sides.slice(1)) builder.relation({ type: 'equal', a: sides[0] as string, b: side });
    // A corner placed level with or above the center keeps the polygon's orientation.
    for (const alignment of snap.alignments) {
      if (alignment.anchor) builder.relation({ type: alignment.axis === 'horizontal' ? 'horizontalPoints' : 'verticalPoints', a: c, b: points[0] as string });
    }
    this.center = null;
    const commit = builder.build();
    return { commit, preview: this.hover(commit, event) };
  }

  cancel(): boolean {
    const busy = this.busy;
    this.center = null;
    return busy;
  }
}

const CORNER_MESSAGES: Record<CornerError, string> = {
  'not-a-corner': 'cornerNotACorner',
  'too-large': 'cornerTooLarge',
  straight: 'cornerStraight',
};

/** Sketch fillet and chamfer: click a corner where two lines meet. */
export class CornerTool implements SketchTool {
  readonly name: 'sketchFillet' | 'sketchChamfer';
  readonly busy = false;
  private readonly size: number;

  constructor(name: 'sketchFillet' | 'sketchChamfer', size: number) {
    this.name = name;
    this.size = size;
  }

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const snap = snapAt(sketch, event);
    const corner = snap.target.kind === 'point' && cornerAt(sketch, snap.target.id) !== null;
    return { geometry: EMPTY, snap: corner ? { ...snap, alignments: [] } : { u: event.u, v: event.v, target: { kind: 'none' }, alignments: [] }, info: null };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const snap = snapAt(sketch, event);
    if (snap.target.kind !== 'point') return { commit: null, preview: this.hover(sketch, event), message: CORNER_MESSAGES['not-a-corner'] };
    const result = this.name === 'sketchFillet' ? filletCorner(sketch, snap.target.id, this.size) : chamferCorner(sketch, snap.target.id, this.size);
    if (!result.ok) return { commit: null, preview: this.hover(sketch, event), message: CORNER_MESSAGES[result.error] };
    return { commit: result.sketch, preview: this.hover(result.sketch, event) };
  }

  cancel(): boolean {
    return false;
  }
}

/** The curve under the cursor (points do not count here). */
function curveAt(sketch: SketchData, event: ToolEvent): string | null {
  const positions = pointPositions(sketch);
  let best: { id: string; distance: number } | null = null;
  for (const entity of sketch.entities) {
    if (!isCurve(entity)) continue;
    const distance = distanceToCurve(entity, positions, event.u, event.v);
    if (distance <= event.tolerance * 0.75 && (!best || distance < best.distance)) best = { id: entity.id, distance };
  }
  return best?.id ?? null;
}

const TRIM_MESSAGES: Record<TrimError, string> = {
  'not-a-curve': 'trimNotACurve',
  'no-target': 'extendNoTarget',
  connected: 'extendConnected',
  constrained: 'extendConstrained',
  ellipse: 'trimEllipse',
};

/** Trim: click the piece of a curve to remove; it ends at the neighboring crossings. */
export class TrimTool implements SketchTool {
  readonly name = 'trim' as const;
  readonly busy = false;

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const none: SnapResult = { u: event.u, v: event.v, target: { kind: 'none' }, alignments: [] };
    const curve = curveAt(sketch, event);
    const piece = curve ? trimPiece(sketch, curve, [event.u, event.v]) : null;
    return { geometry: EMPTY, snap: none, info: null, ...(piece ? { remove: piecePolyline(piece) } : {}) };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const curve = curveAt(sketch, event);
    if (!curve) return { commit: null, preview: this.hover(sketch, event) };
    const result = trimAt(sketch, curve, [event.u, event.v]);
    if (!result.ok) return { commit: null, preview: this.hover(sketch, event), message: TRIM_MESSAGES[result.error] };
    return { commit: result.sketch, preview: this.hover(result.sketch, event) };
  }

  cancel(): boolean {
    return false;
  }
}

/** Extend: click a line or arc near the end to lengthen; it grows up to the next curve. */
export class ExtendTool implements SketchTool {
  readonly name = 'extend' as const;
  readonly busy = false;

  hover(sketch: SketchData, event: ToolEvent): ToolPreview {
    const none: SnapResult = { u: event.u, v: event.v, target: { kind: 'none' }, alignments: [] };
    const curve = curveAt(sketch, event);
    const end = curve ? nearerEnd(sketch, curve, [event.u, event.v]) : null;
    const target = curve && end ? extensionTargets(sketch, curve, end)[0] : undefined;
    if (!curve || !end || !target) return { geometry: EMPTY, snap: none, info: null };
    const entity = sketch.entities.find((candidate) => candidate.id === curve);
    const positions = pointPositions(sketch);
    const preview = new Preview();
    if (entity?.type === 'line') {
      const from = positions.get(end === 'start' ? entity.p1 : entity.p2);
      if (from) preview.line(from, target.at, true);
    } else if (entity?.type === 'arc') {
      const center = positions.get(entity.center);
      const from = positions.get(end === 'start' ? entity.start : entity.end);
      if (center && from) {
        if (end === 'end') preview.arc(center, from, target.at, true);
        else preview.arc(center, target.at, from, true);
      }
    }
    // The ring marks where the curve will end; the curve it runs into is highlighted.
    const into = sketch.entities.find((candidate) => candidate.id === target.curve);
    const curveType = into?.type === 'circle' || into?.type === 'arc' ? into.type : 'line';
    return { geometry: preview.build(), snap: { ...none, target: { kind: 'curve', curve: target.curve ?? '', curveType }, u: target.at[0], v: target.at[1] }, info: null };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    const curve = curveAt(sketch, event);
    if (!curve) return { commit: null, preview: this.hover(sketch, event) };
    const result = extendAt(sketch, curve, [event.u, event.v]);
    if (!result.ok) return { commit: null, preview: this.hover(sketch, event), message: TRIM_MESSAGES[result.error] };
    return { commit: result.sketch, preview: this.hover(result.sketch, event) };
  }

  cancel(): boolean {
    return false;
  }
}

/**
 * Convert entities: picks model edges, not sketch geometry. The sketch controller asks the 3D view
 * for the edge under the cursor; this tool only keeps the sketch tool protocol.
 */
export class ConvertTool implements SketchTool {
  readonly name = 'convert' as const;
  readonly busy = false;

  hover(_sketch: SketchData, event: ToolEvent): ToolPreview {
    return { geometry: EMPTY, snap: { u: event.u, v: event.v, target: { kind: 'none' }, alignments: [] }, info: null };
  }

  click(sketch: SketchData, event: ToolEvent): ToolStep {
    return { commit: null, preview: this.hover(sketch, event) };
  }

  cancel(): boolean {
    return false;
  }
}

export function createTool(name: SketchToolName, options: ToolOptions = DEFAULT_TOOL_OPTIONS): SketchTool {
  switch (name) {
    case 'line':
    case 'centerline':
      return new LineTool(name);
    case 'cornerRectangle':
    case 'centerRectangle':
      return new RectangleTool(name);
    case 'threePointRectangle':
    case 'parallelogram':
      return new SkewRectangleTool(name);
    case 'circle':
      return new CircleTool();
    case 'threePointCircle':
      return new ThreePointCircleTool();
    case 'ellipse':
      return new EllipseTool();
    case 'tangentArc':
      return new TangentArcTool();
    case 'slot':
      return new SlotTool();
    case 'polygon':
      return new PolygonTool(options.polygonSides);
    case 'centerArc':
      return new CenterArcTool();
    case 'threePointArc':
      return new ThreePointArcTool();
    case 'point':
      return new PointTool();
    case 'spline':
      return new SplineTool();
    case 'sketchFillet':
      return new CornerTool(name, options.filletRadius);
    case 'sketchChamfer':
      return new CornerTool(name, options.chamferDistance);
    case 'trim':
      return new TrimTool();
    case 'extend':
      return new ExtendTool();
    case 'dimension':
      return new DimensionTool();
    case 'convert':
      return new ConvertTool();
  }
}

/**
 * Drawing tools of the sketcher as plain state machines: they receive cursor positions in
 * sketch coordinates and return what to preview and, when a shape is finished, the new sketch.
 * The SketchController connects them to the mouse, the 3D view and the undo history.
 */

import type { SketchData } from '../../../shared/model/sketch.ts';
import { SketchBuilder, type PlacedPoint } from './builder.ts';
import { arcGeometry, pointPositions, type Point2 } from './geometry.ts';
import { snapCursor, type SnapResult } from './snap.ts';

export type SketchToolName = 'line' | 'centerline' | 'cornerRectangle' | 'centerRectangle' | 'circle' | 'centerArc' | 'threePointArc' | 'point';

export const SKETCH_TOOLS: readonly SketchToolName[] = ['line', 'centerline', 'cornerRectangle', 'centerRectangle', 'circle', 'centerArc', 'threePointArc', 'point'];

export interface ToolEvent {
  u: number;
  v: number;
  /** Snap distance in mm (a few pixels at the current zoom). */
  tolerance: number;
  /** Alignment distance in mm. */
  alignTolerance: number;
}

/** Relations the finished shape will get from the current cursor position. */
export type ToolRelation = 'horizontal' | 'vertical' | 'coincident' | 'midpoint' | 'onCurve';

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
}

export interface ToolStep {
  /** The sketch with the finished shape, or null if the click only placed an intermediate point. */
  commit: SketchData | null;
  preview: ToolPreview;
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

export function createTool(name: SketchToolName): SketchTool {
  switch (name) {
    case 'line':
    case 'centerline':
      return new LineTool(name);
    case 'cornerRectangle':
    case 'centerRectangle':
      return new RectangleTool(name);
    case 'circle':
      return new CircleTool();
    case 'centerArc':
      return new CenterArcTool();
    case 'threePointArc':
      return new ThreePointArcTool();
    case 'point':
      return new PointTool();
  }
}

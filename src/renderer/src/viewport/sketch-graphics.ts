import { Box3, BufferAttribute, BufferGeometry, Color, Group, Matrix4, Points, ShaderMaterial, Vector3, type Vector2 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { isDimension, ORIGIN_ID, type SketchData, type SketchDimension, type SketchEntity, type SketchFrame } from '../../../shared/model/sketch.ts';
import type { DefinitionStatus } from '../../../sketch/solver/index.ts';
import { arrowStrokes, dimensionGraphic, displayValue } from '../sketch/dimensions.ts';
import { curvePointIds, curvePoints, curvePolyline, isCurve, pointPositions, type Point2 } from '../sketch/geometry.ts';
import type { ViewportPalette } from './palette.ts';

/** The open sketch is drawn on top of everything; other sketches are ordinary 3D geometry. */
export type SketchLook = 'active' | 'inactive';

export interface SketchHighlight {
  hovered: string | null;
  selected: readonly string[];
}

export const NO_HIGHLIGHT: SketchHighlight = { hovered: null, selected: [] };

/** Definition status of the open sketch's entities, from the solver's analysis. */
export type SketchStatusColors = Readonly<Record<string, DefinitionStatus>>;

const POINT_SIZE_PX = 6;
const HIGHLIGHT_POINT_SIZE_PX = 9;
const DASH_PX = 7;
const GAP_PX = 5;
/** Re-tessellate curves when the zoom has changed by more than this factor. */
const RETESSELLATE_FACTOR = 1.6;
/** Dimension arrows and gaps keep their size on screen within this factor. */
const DIMENSION_ZOOM_FACTOR = 1.15;
const ARROW_PX = 9;

/** Label text of a dimension: "25.4", "Ø20", "R5", "30°"; driven dimensions in parentheses. */
export type DimensionFormat = (dimension: SketchDimension, value: number) => string;

export function defaultDimensionFormat(language: string): DimensionFormat {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 2, useGrouping: false });
  return (dimension, value) => {
    const text = number.format(value);
    const shown = dimension.type === 'radius' ? `R${text}` : dimension.type === 'diameter' ? `Ø${text}` : dimension.type === 'angle' ? `${text}°` : text;
    return dimension.driving ? shown : `(${shown})`;
  };
}

const POINT_VERTEX = /* glsl */ `
attribute vec3 pointColor;
attribute float pointSize;
attribute float pointStyle;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vStyle;
void main() {
  vColor = pointColor;
  vStyle = pointStyle;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSize * uPixelRatio;
}
`;

// Round, anti-aliased dots (style 0) or rings (style 1, snap markers).
const POINT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vStyle;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float alpha = 1.0 - smoothstep(0.7, 1.0, r);
  if (vStyle > 0.5) alpha *= smoothstep(0.4, 0.6, r);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

/** Materials shared by all sketches; colors follow the theme, dashes and dots the zoom. */
export class SketchMaterials {
  readonly lines: Record<SketchLook, LineMaterial>;
  readonly construction: Record<SketchLook, LineMaterial>;
  readonly highlight: LineMaterial;
  /** Inference lines while drawing. */
  readonly guide: LineMaterial;
  /** Dimension lines and arrows (vertex colors). */
  readonly dimension: LineMaterial;
  format: DimensionFormat = defaultDimensionFormat('en');
  readonly points: Record<SketchLook, ShaderMaterial>;
  readonly colors = {
    active: new Color(),
    full: new Color(),
    over: new Color(),
    inactive: new Color(),
    hovered: new Color(),
    selected: new Color(),
    guide: new Color(),
    dimension: new Color(),
    dimensionDriven: new Color(),
  };

  constructor() {
    const line = (look: SketchLook, dashed: boolean) =>
      new LineMaterial({
        linewidth: look === 'active' ? 1.8 : 1.3,
        worldUnits: false,
        dashed,
        // Colors come per entity (definition status), so the material itself stays white.
        vertexColors: true,
        depthTest: look === 'inactive',
        transparent: look === 'active',
      });
    this.lines = { active: line('active', false), inactive: line('inactive', false) };
    this.construction = { active: line('active', true), inactive: line('inactive', true) };
    this.highlight = new LineMaterial({ linewidth: 3.2, worldUnits: false, vertexColors: true, depthTest: false, transparent: true });
    this.guide = new LineMaterial({ linewidth: 1, worldUnits: false, dashed: true, depthTest: false, transparent: true, opacity: 0.85 });
    this.dimension = new LineMaterial({ linewidth: 1.1, worldUnits: false, vertexColors: true, depthTest: false, transparent: true });
    const points = (look: SketchLook) =>
      new ShaderMaterial({
        vertexShader: POINT_VERTEX,
        fragmentShader: POINT_FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 } },
        transparent: true,
        depthTest: look === 'inactive',
        depthWrite: false,
      });
    this.points = { active: points('active'), inactive: points('inactive') };
  }

  setPalette(palette: ViewportPalette): void {
    this.colors.active.setHex(palette.sketch);
    this.colors.full.setHex(palette.sketchFull);
    this.colors.over.setHex(palette.sketchOver);
    this.colors.inactive.setHex(palette.sketchInactive);
    this.colors.hovered.setHex(palette.hover);
    this.colors.selected.setHex(palette.selected);
    this.colors.guide.setHex(palette.guide);
    this.colors.dimension.setHex(palette.dimension);
    this.colors.dimensionDriven.setHex(palette.dimensionDriven);
    this.guide.color.copy(this.colors.guide);
  }

  setResolution(resolution: Vector2, pixelRatio: number): void {
    for (const material of [...Object.values(this.lines), ...Object.values(this.construction), this.highlight, this.guide, this.dimension]) {
      material.resolution.copy(resolution);
    }
    for (const material of Object.values(this.points)) (material.uniforms.uPixelRatio as { value: number }).value = pixelRatio;
  }

  /** Dashes keep their length on screen. */
  setZoom(mmPerPixel: number): void {
    for (const material of Object.values(this.construction)) {
      material.dashSize = DASH_PX * mmPerPixel;
      material.gapSize = GAP_PX * mmPerPixel;
    }
    this.guide.dashSize = 3 * mmPerPixel;
    this.guide.gapSize = 4 * mmPerPixel;
  }

  dispose(): void {
    for (const material of [...Object.values(this.lines), ...Object.values(this.construction), this.highlight, this.guide, this.dimension, ...Object.values(this.points)]) {
      material.dispose();
    }
  }
}

function segmentsOf(polyline: readonly Point2[], out: number[]): void {
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1] as Point2;
    const b = polyline[i] as Point2;
    out.push(a[0], a[1], 0, b[0], b[1], 0);
  }
}

/** One sketch drawn in the 3D view, in the coordinates of its plane. */
export class SketchGraphics {
  readonly group = new Group();
  private readonly materials: SketchMaterials;
  private look: SketchLook;
  private readonly lines: LineSegments2;
  private readonly construction: LineSegments2;
  private readonly highlight: LineSegments2;
  private readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly dimensionLines: LineSegments2;
  private readonly labels = new Map<string, CSS2DObject>();
  private dimensionsAt = 0;
  private sketch: SketchData | null = null;
  private highlightState: SketchHighlight = NO_HIGHLIGHT;
  private status: SketchStatusColors | null = null;
  private tessellatedAt = 0;
  private readonly localBounds = new Box3();

  constructor(materials: SketchMaterials, look: SketchLook) {
    this.materials = materials;
    this.look = look;
    this.lines = new LineSegments2(new LineSegmentsGeometry(), materials.lines[look]);
    this.construction = new LineSegments2(new LineSegmentsGeometry(), materials.construction[look]);
    this.highlight = new LineSegments2(new LineSegmentsGeometry(), materials.highlight);
    this.points = new Points(new BufferGeometry(), materials.points[look]);
    this.dimensionLines = new LineSegments2(new LineSegmentsGeometry(), materials.dimension);
    const order = look === 'active' ? 30 : 5;
    [this.construction, this.lines, this.highlight, this.points, this.dimensionLines].forEach((object, i) => {
      object.renderOrder = order + i;
      object.frustumCulled = false;
      object.raycast = () => undefined;
      this.group.add(object);
    });
    this.group.matrixAutoUpdate = false;
  }

  setFrame(frame: SketchFrame): void {
    this.group.matrix.copy(frameMatrix(frame));
    this.group.updateMatrixWorld(true);
  }

  get data(): SketchData | null {
    return this.sketch;
  }

  /** Shows `sketch`; curves are tessellated for the given zoom level. */
  update(sketch: SketchData, highlight: SketchHighlight, mmPerPixel: number, status: SketchStatusColors | null = null): void {
    this.sketch = sketch;
    this.highlightState = highlight;
    this.status = status;
    this.tessellatedAt = mmPerPixel;
    this.rebuild();
  }

  setHighlight(highlight: SketchHighlight): void {
    if (highlight === this.highlightState) return;
    this.highlightState = highlight;
    this.rebuild();
  }

  /** Rebuilds with the current colors (after a theme change). */
  refresh(): void {
    this.rebuild();
  }

  /** Re-tessellates after a large zoom change; returns whether anything changed. */
  ensureResolution(mmPerPixel: number): boolean {
    if (!this.sketch || this.tessellatedAt <= 0) return false;
    // Dimension arrows keep their size on screen.
    if (this.labels.size > 0) {
      const zoom = mmPerPixel / this.dimensionsAt;
      if (zoom > DIMENSION_ZOOM_FACTOR || zoom < 1 / DIMENSION_ZOOM_FACTOR) {
        this.tessellatedAt = mmPerPixel;
        this.rebuild();
        return true;
      }
    }
    const ratio = mmPerPixel / this.tessellatedAt;
    if (ratio < RETESSELLATE_FACTOR && ratio > 1 / RETESSELLATE_FACTOR) return false;
    if (!this.sketch.entities.some((entity) => entity.type === 'circle' || entity.type === 'arc')) {
      this.tessellatedAt = mmPerPixel;
      return false;
    }
    this.tessellatedAt = mmPerPixel;
    this.rebuild();
    return true;
  }

  /** Bounding box in model space, or null for an empty sketch. */
  worldBounds(): Box3 | null {
    if (this.localBounds.isEmpty()) return null;
    return this.localBounds.clone().applyMatrix4(this.group.matrix);
  }

  /** The label element of a dimension (for editing its value). */
  dimensionLabel(id: string): HTMLElement | null {
    return this.labels.get(id)?.element ?? null;
  }

  /** Label elements by dimension id (for hit testing). */
  get dimensionLabels(): ReadonlyMap<string, CSS2DObject> {
    return this.labels;
  }

  dispose(): void {
    for (const object of [this.lines, this.construction, this.highlight, this.dimensionLines]) object.geometry.dispose();
    this.points.geometry.dispose();
    for (const label of this.labels.values()) this.group.remove(label);
    this.labels.clear();
  }

  /** Dimension lines, arrows and labels; only the open sketch shows dimensions. */
  private rebuildDimensions(sketch: SketchData, positions: ReturnType<typeof pointPositions>, hovered: string | null, selected: ReadonlySet<string>): void {
    const lines: number[] = [];
    const colors: number[] = [];
    const shown = new Set<string>();
    const mmPerPixel = this.tessellatedAt;
    this.dimensionsAt = mmPerPixel;
    if (this.look === 'active') {
      for (const constraint of sketch.constraints) {
        if (!isDimension(constraint)) continue;
        const graphic = dimensionGraphic(sketch, constraint, mmPerPixel, positions);
        const value = displayValue(sketch, constraint, positions);
        if (!graphic || value === null) continue;
        const conflict = this.status?.[constraint.id] === 'over';
        const color =
          constraint.id === hovered
            ? this.materials.colors.hovered
            : selected.has(constraint.id)
              ? this.materials.colors.selected
              : conflict
                ? this.materials.colors.over
                : constraint.driving
                  ? this.materials.colors.dimension
                  : this.materials.colors.dimensionDriven;
        const strokes = [...graphic.lines, ...graphic.arrows.flatMap((arrow) => arrowStrokes(arrow, ARROW_PX * mmPerPixel))];
        for (const [a, b] of strokes) {
          lines.push(a[0], a[1], 0, b[0], b[1], 0);
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
        shown.add(constraint.id);
        let label = this.labels.get(constraint.id);
        if (!label) {
          const element = document.createElement('div');
          element.className = 'dimension-label';
          element.dataset.dimensionId = constraint.id;
          label = new CSS2DObject(element);
          this.labels.set(constraint.id, label);
          this.group.add(label);
        }
        label.position.set(graphic.label[0], graphic.label[1], 0);
        const element = label.element;
        element.textContent = this.materials.format(constraint, value);
        element.classList.toggle('is-driven', !constraint.driving);
        element.classList.toggle('is-conflict', conflict);
        element.classList.toggle('is-hovered', constraint.id === hovered);
        element.classList.toggle('is-selected', selected.has(constraint.id));
      }
    }
    setSegments(this.dimensionLines, lines, colors);
    for (const [id, label] of this.labels) {
      if (shown.has(id)) continue;
      this.group.remove(label);
      this.labels.delete(id);
    }
  }

  /** Blue while an entity can still move, dark when fully defined, red when over-defined. */
  private colorOf(entity: SketchEntity): Color {
    if (this.look === 'inactive') return this.materials.colors.inactive;
    const status = this.status?.[entity.id];
    // A curve through an over-defined point is part of the conflict, too.
    const over = status === 'over' || (isCurve(entity) && curvePoints(entity).some((id) => this.status?.[id] === 'over'));
    return over ? this.materials.colors.over : status === 'full' ? this.materials.colors.full : this.materials.colors.active;
  }

  private rebuild(): void {
    const sketch = this.sketch;
    if (!sketch) return;
    const positions = pointPositions(sketch);
    const { hovered, selected } = this.highlightState;
    const selectedSet = new Set(selected);
    const lines: number[] = [];
    const lineColors: number[] = [];
    const construction: number[] = [];
    const constructionColors: number[] = [];
    const highlight: number[] = [];
    const highlightColors: number[] = [];
    this.localBounds.makeEmpty();

    for (const entity of sketch.entities) {
      if (!isCurve(entity)) continue;
      const polyline = curvePolyline(entity, positions, this.tessellatedAt);
      if (!polyline) continue;
      for (const [x, y] of polyline) this.localBounds.expandByPoint(new Vector3(x, y, 0));
      const [target, targetColors] = entity.construction ? [construction, constructionColors] : [lines, lineColors];
      const start = target.length;
      segmentsOf(polyline, target);
      const own = this.colorOf(entity);
      for (let i = start; i < target.length; i += 3) targetColors.push(own.r, own.g, own.b);
      const color = entity.id === hovered ? this.materials.colors.hovered : selectedSet.has(entity.id) ? this.materials.colors.selected : null;
      if (color) {
        const start = highlight.length;
        segmentsOf(polyline, highlight);
        for (let i = start; i < highlight.length; i += 3) highlightColors.push(color.r, color.g, color.b);
      }
    }
    setSegments(this.lines, lines, lineColors);
    setSegments(this.construction, construction, constructionColors);
    if (this.construction.visible) this.construction.computeLineDistances();
    setSegments(this.highlight, highlight, highlightColors);

    this.rebuildDimensions(sketch, positions, hovered, selectedSet);

    // The open sketch shows every point; other sketches only their stand-alone points.
    const owned = this.look === 'inactive' ? curvePointIds(sketch) : null;
    const pointPositionsOut: number[] = [];
    const pointColors: number[] = [];
    const pointSizes: number[] = [];
    for (const entity of sketch.entities) {
      if (entity.type !== 'point' || owned?.has(entity.id)) continue;
      this.localBounds.expandByPoint(new Vector3(entity.x, entity.y, 0));
      const emphasized = entity.id === hovered ? this.materials.colors.hovered : selectedSet.has(entity.id) ? this.materials.colors.selected : null;
      const color = emphasized ?? this.colorOf(entity);
      pointPositionsOut.push(entity.x, entity.y, 0);
      pointColors.push(color.r, color.g, color.b);
      pointSizes.push(emphasized ? HIGHLIGHT_POINT_SIZE_PX : POINT_SIZE_PX);
    }
    // The origin is shown by its arrows; it only gets a dot while hovered or selected.
    const origin = hovered === ORIGIN_ID ? this.materials.colors.hovered : selectedSet.has(ORIGIN_ID) ? this.materials.colors.selected : null;
    if (origin && this.look === 'active') {
      pointPositionsOut.push(0, 0, 0);
      pointColors.push(origin.r, origin.g, origin.b);
      pointSizes.push(HIGHLIGHT_POINT_SIZE_PX);
    }
    const geometry = this.points.geometry;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pointPositionsOut), 3));
    geometry.setAttribute('pointColor', new BufferAttribute(new Float32Array(pointColors), 3));
    geometry.setAttribute('pointSize', new BufferAttribute(new Float32Array(pointSizes), 1));
    geometry.setAttribute('pointStyle', new BufferAttribute(new Float32Array(pointSizes.length), 1));
    this.points.visible = pointPositionsOut.length > 0;
  }
}

export function setSegments(object: LineSegments2, positions: number[], colors?: number[]): void {
  object.visible = positions.length > 0;
  if (!object.visible) return;
  // A fresh geometry per update: LineSegmentsGeometry cannot shrink its instanced buffers in place.
  object.geometry.dispose();
  const geometry = new LineSegmentsGeometry().setPositions(positions);
  if (colors) geometry.setColors(colors);
  object.geometry = geometry;
}

/** From sketch coordinates to model space. */
export function frameMatrix(frame: SketchFrame): Matrix4 {
  return new Matrix4()
    .makeBasis(new Vector3(...frame.xDir), new Vector3(...frame.yDir), new Vector3(...frame.normal))
    .setPosition(new Vector3(...frame.origin));
}

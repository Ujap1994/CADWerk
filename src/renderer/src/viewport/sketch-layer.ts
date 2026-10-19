import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Matrix4, Mesh, PlaneGeometry, Points, ShaderMaterial, Vector2, type Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { toSketch, type SketchData, type SketchFrame } from '../../../shared/model/sketch.ts';
import { gridSpacing } from './grid.ts';
import type { ViewportPalette } from './palette.ts';
import type { Point2 } from '../sketch/geometry.ts';
import { frameMatrix, NO_HIGHLIGHT, setSegments, SketchGraphics, type SketchHighlight, type SketchMaterials, type SketchStatusColors } from './sketch-graphics.ts';

/** What a drawing tool shows: the shape being drawn, where the cursor snapped and inference lines. */
export interface SketchToolDisplay {
  geometry: SketchData;
  /** Snap marker: a filled dot on points, a ring on midpoints and curves. */
  marker: { u: number; v: number; ring: boolean } | null;
  guides: readonly (readonly [Point2, Point2])[];
}

const MARKER_SIZE_PX = 12;

const ORIGIN_ARROW_PX = 34;

/** Visible part of the view, for sizing the grid. */
export interface SketchViewInfo {
  target: Vector3;
  /** Visible world height in mm. */
  height: number;
  aspect: number;
  viewportHeightPx: number;
}

const GRID_VERTEX = /* glsl */ `
uniform vec2 uCenter;
uniform float uSize;
varying vec2 vLocal;
void main() {
  vLocal = uCenter + position.xy * uSize;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vLocal, 0.0, 1.0);
}
`;

// Anti-aliased lines one pixel wide from screen-space derivatives; minor, major (10x) and
// the two sketch axes, fading out towards the border of the grid square.
const GRID_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uMinor;
uniform float uMinorAlpha;
uniform float uMajorAlpha;
uniform float uAxisAlpha;
uniform vec2 uCenter;
uniform float uSize;
varying vec2 vLocal;

float lineMask(vec2 coord, float widthPx) {
  vec2 width = max(fwidth(coord) * widthPx, vec2(1e-9));
  vec2 distance = abs(fract(coord - 0.5) - 0.5) / width;
  return 1.0 - min(min(distance.x, distance.y), 1.0);
}

void main() {
  float minor = lineMask(vLocal / uMinor, 1.0) * uMinorAlpha;
  float major = lineMask(vLocal / (uMinor * 10.0), 1.0) * uMajorAlpha;
  vec2 axisWidth = max(fwidth(vLocal) * 1.4, vec2(1e-9));
  vec2 axisDistance = abs(vLocal) / axisWidth;
  float axis = (1.0 - min(min(axisDistance.x, axisDistance.y), 1.0)) * uAxisAlpha;
  float alpha = max(max(minor, major), axis);
  alpha *= 1.0 - smoothstep(0.65, 1.0, length(vLocal - uCenter) / uSize);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// Arrows along the sketch x and y axes, one unit long (scaled to a constant screen size).
const ORIGIN_ARROWS = [
  [0, 0, 0, 1, 0, 0],
  [1, 0, 0, 0.78, 0.09, 0],
  [1, 0, 0, 0.78, -0.09, 0],
  [0, 0, 0, 0, 1, 0],
  [0, 1, 0, 0.09, 0.78, 0],
  [0, 1, 0, -0.09, 0.78, 0],
].flat();

/** What sketch mode draws in the 3D view: the grid on the sketch plane, the sketch origin and the open sketch. */
export class SketchLayer {
  readonly group = new Group();
  private frame: SketchFrame | null = null;
  private readonly basis = new Matrix4();
  private readonly uniforms = {
    uCenter: { value: new Vector2() },
    uSize: { value: 100 },
    uMinor: { value: 10 },
    uColor: { value: new Color() },
    uMinorAlpha: { value: 0.15 },
    uMajorAlpha: { value: 0.3 },
    uAxisAlpha: { value: 0.45 },
  };
  private readonly grid: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly origin: LineSegments2;
  private readonly originMaterial: LineMaterial;
  private readonly graphics: SketchGraphics;
  private readonly materials: SketchMaterials;
  private readonly preview: SketchGraphics;
  private readonly toolGroup = new Group();
  private readonly marker: Points<BufferGeometry, ShaderMaterial>;
  private readonly guides: LineSegments2;
  private mmPerPixel = 1;

  constructor(materials: SketchMaterials) {
    this.materials = materials;
    this.graphics = new SketchGraphics(materials, 'active');
    this.preview = new SketchGraphics(materials, 'active');
    this.marker = new Points(new BufferGeometry(), materials.points.active);
    this.guides = new LineSegments2(new LineSegmentsGeometry(), materials.guide);
    for (const object of [this.marker, this.guides]) {
      object.frustumCulled = false;
      object.raycast = () => undefined;
      object.visible = false;
    }
    this.marker.renderOrder = 40;
    this.guides.renderOrder = 29;
    this.toolGroup.matrixAutoUpdate = false;
    this.toolGroup.add(this.guides, this.marker);
    this.grid = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: GRID_VERTEX,
        fragmentShader: GRID_FRAGMENT,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    // The vertex shader places the square around the view, so the geometry's own bounds mean nothing.
    this.grid.frustumCulled = false;
    this.grid.matrixAutoUpdate = false;
    this.grid.renderOrder = 2;
    this.grid.raycast = () => undefined;

    this.originMaterial = new LineMaterial({ linewidth: 2, worldUnits: false, vertexColors: true, depthTest: false });
    const geometry = new LineSegmentsGeometry().setPositions(ORIGIN_ARROWS);
    this.origin = new LineSegments2(geometry, this.originMaterial);
    this.origin.matrixAutoUpdate = false;
    this.origin.renderOrder = 20;
    this.origin.raycast = () => undefined;

    this.group.add(this.grid, this.origin, this.graphics.group, this.preview.group, this.toolGroup);
    this.group.visible = false;
  }

  get active(): boolean {
    return this.frame !== null;
  }

  get sketchFrame(): SketchFrame | null {
    return this.frame;
  }

  setFrame(frame: SketchFrame | null): void {
    this.frame = frame;
    this.group.visible = frame !== null;
    if (!frame) return;
    this.basis.copy(frameMatrix(frame));
    this.grid.matrix.copy(this.basis);
    this.grid.updateMatrixWorld(true);
    this.graphics.setFrame(frame);
    this.preview.setFrame(frame);
    this.toolGroup.matrix.copy(this.basis);
    this.toolGroup.updateMatrixWorld(true);
  }

  /** Shows what the active drawing tool is doing, or nothing. */
  setToolDisplay(display: SketchToolDisplay | null): void {
    this.preview.group.visible = display !== null && display.geometry.entities.length > 0;
    if (display && this.preview.group.visible) this.preview.update(display.geometry, NO_HIGHLIGHT, this.mmPerPixel);
    const marker = display?.marker ?? null;
    this.marker.visible = marker !== null;
    if (marker) {
      const color = this.materials.colors.hovered;
      const geometry = this.marker.geometry;
      geometry.setAttribute('position', new BufferAttribute(new Float32Array([marker.u, marker.v, 0]), 3));
      geometry.setAttribute('pointColor', new BufferAttribute(new Float32Array([color.r, color.g, color.b]), 3));
      geometry.setAttribute('pointSize', new BufferAttribute(new Float32Array([MARKER_SIZE_PX]), 1));
      geometry.setAttribute('pointStyle', new BufferAttribute(new Float32Array([marker.ring ? 1 : 0]), 1));
    }
    const guides = display?.guides ?? [];
    setSegments(this.guides, guides.flatMap(([a, b]) => [a[0], a[1], 0, b[0], b[1], 0]));
    if (this.guides.visible) this.guides.computeLineDistances();
  }

  /** Shows the geometry of the open sketch (also intermediate states while dragging). */
  setSketch(sketch: SketchData, highlight: SketchHighlight = NO_HIGHLIGHT, status: SketchStatusColors | null = null): void {
    this.graphics.update(sketch, highlight, this.mmPerPixel, status);
  }

  setHighlight(highlight: SketchHighlight): void {
    this.graphics.setHighlight(highlight);
  }

  get sketch(): SketchData | null {
    return this.graphics.data;
  }

  dimensionLabel(id: string): HTMLElement | null {
    return this.graphics.dimensionLabel(id);
  }

  dimensionLabelElements(): IterableIterator<[string, HTMLElement]> {
    const labels = this.graphics.dimensionLabels;
    return (function* () {
      for (const [id, label] of labels) yield [id, label.element] as [string, HTMLElement];
    })();
  }

  refresh(): void {
    if (this.graphics.data) this.graphics.refresh();
  }

  worldBounds() {
    return this.frame ? this.graphics.worldBounds() : null;
  }

  setPalette(palette: ViewportPalette): void {
    this.uniforms.uColor.value.setHex(palette.grid);
    const colors = new Float32Array(ORIGIN_ARROWS.length);
    const x = new Color(palette.axisX);
    const y = new Color(palette.axisY);
    for (let segment = 0; segment < 6; segment++) {
      const color = segment < 3 ? x : y;
      for (let end = 0; end < 2; end++) colors.set([color.r, color.g, color.b], segment * 6 + end * 3);
    }
    (this.origin.geometry as LineSegmentsGeometry).setColors(colors);
  }

  setResolution(resolution: Vector2): void {
    this.originMaterial.resolution.copy(resolution);
  }

  /** Adapts the grid spacing and the origin arrows to the current zoom; called before each frame. */
  update(view: SketchViewInfo): void {
    const frame = this.frame;
    if (!frame) return;
    const mmPerPixel = view.height / Math.max(1, view.viewportHeightPx);
    this.mmPerPixel = mmPerPixel;
    this.graphics.ensureResolution(mmPerPixel);
    const { minor, minorStrength } = gridSpacing(mmPerPixel);
    const uniforms = this.uniforms;
    const [cx, cy] = toSketch(frame, [view.target.x, view.target.y, view.target.z]);
    uniforms.uCenter.value.set(cx, cy);
    // Far larger than the visible area, so the border fade only shows in oblique views.
    uniforms.uSize.value = 2.5 * Math.max(view.height * view.aspect, view.height);
    uniforms.uMinor.value = minor;
    uniforms.uMinorAlpha.value = 0.16 * minorStrength;
    uniforms.uMajorAlpha.value = 0.16 + 0.16 * minorStrength;

    const arrow = ORIGIN_ARROW_PX * mmPerPixel;
    this.origin.matrix.copy(this.basis).multiply(new Matrix4().makeScale(arrow, arrow, arrow));
    this.origin.updateMatrixWorld(true);
  }

  dispose(): void {
    this.graphics.dispose();
    this.preview.dispose();
    this.marker.geometry.dispose();
    this.guides.geometry.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.origin.geometry.dispose();
    this.originMaterial.dispose();
  }
}

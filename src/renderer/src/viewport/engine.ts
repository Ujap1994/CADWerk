import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { MeshPayload } from '../../../kernel/protocol.ts';
import { toSketch, type SketchData, type SketchFrame } from '../../../shared/model/sketch.ts';
import type { NavigationPreset, Projection } from '../../../shared/settings.ts';
import type { FrameStats, Pick } from '../state/store.ts';
import { CameraController } from './camera-controller.ts';
import { AxisTriad } from './axis-triad.ts';
import { palettes, type ViewportPalette } from './palette.ts';
import { disposeOverlay, PartModel } from './part-model.ts';
import { ReferencePlanes, type PlaneDisplay } from './reference-planes.ts';
import { NO_HIGHLIGHT, SketchGraphics, SketchMaterials, type SketchHighlight } from './sketch-graphics.ts';
import { SketchLayer, type SketchToolDisplay } from './sketch-layer.ts';
import { createSyntheticAssembly, type SyntheticAssembly } from './synthetic-scene.ts';
import { ViewCube, type CubeFace } from './view-cube.ts';
import { VIEW_DIRECTIONS, viewQuaternion, type StandardView } from './views.ts';

/** What a click can pick: everything, only edges (fillet, chamfer), planes and planar faces (choosing a sketch plane) or nothing. */
export type PickFilter = 'all' | 'edges' | 'planes' | 'none';

/** Pointer position in sketch mode: CSS pixels on the canvas and sketch coordinates on the sketch plane. */
export interface SketchPointer {
  x: number;
  y: number;
  u: number;
  v: number;
  mmPerPixel: number;
  additive: boolean;
}

/** Receives the left-button input while a sketch is open (see sketch/controller.ts). */
export interface SketchInput {
  hover(pointer: SketchPointer | null): void;
  down(pointer: SketchPointer): void;
  move(pointer: SketchPointer): void;
  up(pointer: SketchPointer, moved: boolean): void;
}

/** A sketch shown in the 3D view while it is not open. */
export interface InactiveSketch {
  id: string;
  frame: SketchFrame;
  data: SketchData;
}

export interface ViewportCallbacks {
  onHover(pick: Pick | null): void;
  onPick(pick: Pick | null, additive: boolean): void;
  onFrameStats(stats: FrameStats): void;
}

export interface BenchmarkResult {
  frames: number;
  fps: number;
  frameMsMedian: number;
  frameMsP95: number;
  cpuMsMedian: number;
  triangles: number;
  drawCalls: number;
}

type DragMode = 'rotate' | 'pan' | 'select' | 'cube' | 'sketch';

interface DragState {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  button: number;
  pivot: Vector3;
}

const CLICK_TOLERANCE_PX = 4;
const EDGE_PICK_THRESHOLD_PX = 5;
/** Smallest half side length of the standard planes, in mm. */
const MIN_PLANE_HALF_SIZE = 40;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.index === b.index);
}

/** Renders parts, handles navigation and picking. Lives outside React for predictable performance. */
export class ViewportEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: ViewportCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly overlays = new Group();
  private readonly ortho = new OrthographicCamera();
  private readonly perspective = new PerspectiveCamera();
  private readonly controller = new CameraController();
  private readonly hemisphere: HemisphereLight;
  private readonly headlight = new DirectionalLight(0xffffff, 2.1);
  private readonly raycaster = new Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly viewCube: ViewCube;
  private readonly triad = new AxisTriad();
  private readonly referencePlanes = new ReferencePlanes();
  private readonly sketchMaterials = new SketchMaterials();
  private readonly sketchLayer = new SketchLayer(this.sketchMaterials);
  private readonly inactiveSketches = new Map<string, SketchGraphics>();
  private readonly inactiveSketchGroup = new Group();
  private sketchInput: SketchInput | null = null;
  private lastSketchPointer: SketchPointer | null = null;
  private readonly pivotMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  private palette: ViewportPalette = palettes.light;
  private readonly materials: {
    face: MeshStandardMaterial;
    edge: LineMaterial;
    hoverFace: MeshStandardMaterial;
    hoverEdge: LineMaterial;
    selectedFace: MeshStandardMaterial;
    selectedEdge: LineMaterial;
    referenceEdge: LineMaterial;
  };

  private projection: Projection = 'orthographic';
  private navigation: NavigationPreset = 'mouse';
  private body: PartModel | null = null;
  private preview: PartModel | null = null;
  private bench: SyntheticAssembly | null = null;
  private bodyPickable = true;
  private pickFilter: PickFilter = 'all';
  private selection: Pick[] = [];
  private hover: Pick | null = null;
  private selectionOverlays: (Mesh | LineSegments2)[] = [];
  private hoverOverlay: Mesh | LineSegments2 | null = null;
  private bounds = new Sphere(new Vector3(0, 0, 20), 120);
  private fitOnNextBody = true;

  private width = 1;
  private height = 1;
  private frameRequested = false;
  private continuousRequests = 0;
  private drag: DragState | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private hoverQueued = false;
  private wheelPivot: { point: Vector3; time: number } | null = null;
  private disposed = false;

  private statsEnabled = false;
  private lastFrameTime = 0;
  private frameIntervals: number[] = [];
  private cpuTimes: number[] = [];
  private lastStatsEmit = 0;
  private frameListener: ((interval: number, cpu: number, total: number) => void) | null = null;
  private readonly syncPixel = new Uint8Array(4);

  constructor(container: HTMLElement, callbacks: ViewportCallbacks, labels: Record<CubeFace, string>) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;

    this.materials = {
      face: new MeshStandardMaterial({ metalness: 0.08, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      edge: new LineMaterial({ linewidth: 1.3, worldUnits: false }),
      hoverFace: new MeshStandardMaterial({ metalness: 0.05, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 }),
      hoverEdge: new LineMaterial({ linewidth: 3.5, worldUnits: false }),
      selectedFace: new MeshStandardMaterial({ metalness: 0.05, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 }),
      selectedEdge: new LineMaterial({ linewidth: 3.5, worldUnits: false }),
      referenceEdge: new LineMaterial({ linewidth: 1.6, worldUnits: false }),
    };

    this.hemisphere = new HemisphereLight(0xffffff, 0x888888, 1.9);
    this.scene.add(
      this.hemisphere,
      this.headlight,
      this.headlight.target,
      this.overlays,
      this.referencePlanes.group,
      this.inactiveSketchGroup,
      this.sketchLayer.group,
    );

    this.pivotMarker = new Mesh(new SphereGeometry(1, 16, 12), new MeshBasicMaterial({ depthTest: false }));
    this.pivotMarker.renderOrder = 10;
    this.pivotMarker.visible = false;
    this.scene.add(this.pivotMarker);

    this.viewCube = new ViewCube(this.palette, labels);
    this.setTheme('light');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindEvents();
    this.requestRender();
  }

  // ---------------------------------------------------------------- content

  setBody(payload: MeshPayload | null, pickable: boolean): void {
    this.bodyPickable = pickable;
    if (payload?.key === this.body?.key) return;
    this.clearHover();
    this.clearSelectionOverlays();
    if (this.body) {
      this.scene.remove(this.body.group);
      this.body.dispose();
      this.body = null;
    }
    if (payload) {
      this.body = new PartModel(payload, this.materials.face, this.materials.edge);
      this.scene.add(this.body.group);
    }
    this.updateBounds();
    if (this.body && this.fitOnNextBody) {
      this.fitOnNextBody = false;
      this.zoomToFit(false);
    }
    this.applyPreviewMode();
    this.rebuildSelectionOverlays();
    this.requestRender();
  }

  /**
   * Shows the result of the feature being edited. The body before the feature
   * stays pickable: its faces are hidden (but still hit-tested) and its edges are
   * drawn as reference lines on top of the result.
   */
  setPreview(payload: MeshPayload | null): void {
    if (payload?.key !== this.preview?.key) {
      if (this.preview) {
        this.scene.remove(this.preview.group);
        this.preview.dispose();
        this.preview = null;
      }
      if (payload) {
        this.preview = new PartModel(payload, this.materials.face, this.materials.edge);
        this.preview.mesh.raycast = () => undefined;
        this.preview.edges.raycast = () => undefined;
        this.scene.add(this.preview.group);
      }
    }
    this.applyPreviewMode();
    this.requestRender();
  }

  private applyPreviewMode(): void {
    if (!this.body) return;
    const previewing = this.preview !== null;
    // Raycasting ignores visibility, so the hidden faces still occlude and pick.
    this.body.mesh.visible = !previewing;
    this.body.edges.material = previewing ? this.materials.referenceEdge : this.materials.edge;
    this.body.edges.renderOrder = previewing ? 4 : 1;
  }

  setSelection(picks: Pick[]): void {
    this.selection = picks;
    this.rebuildSelectionOverlays();
    this.requestRender();
  }

  setPickFilter(filter: PickFilter): void {
    this.pickFilter = filter;
    if (filter === 'none') this.clearHover();
  }

  setReferencePlanes(display: PlaneDisplay): void {
    const wasVisible = this.referencePlanes.anyVisible;
    this.referencePlanes.setDisplay(display);
    if (wasVisible !== this.referencePlanes.anyVisible) this.updateBounds();
    this.requestRender();
  }

  /** Enters (frame) or leaves (null) sketch mode; `orient` turns the view normal to the sketch plane. */
  setSketchFrame(frame: SketchFrame | null, orient = false): void {
    this.sketchLayer.setFrame(frame);
    this.updateBounds();
    if (frame && orient) this.lookAtFrame(frame);
    this.requestRender();
  }

  /** Geometry of the open sketch, or of an intermediate state while dragging. */
  setActiveSketch(sketch: SketchData, highlight: SketchHighlight): void {
    this.sketchLayer.setSketch(sketch, highlight);
    this.updateBounds();
    this.requestRender();
  }

  setSketchToolDisplay(display: SketchToolDisplay | null): void {
    this.sketchLayer.setToolDisplay(display);
    this.requestRender();
  }

  setSketchHighlight(highlight: SketchHighlight): void {
    this.sketchLayer.setHighlight(highlight);
    this.requestRender();
  }

  /** The sketches shown while they are not open; unchanged ones are kept as they are. */
  setInactiveSketches(sketches: readonly InactiveSketch[]): void {
    const shown = new Set<string>();
    for (const sketch of sketches) {
      shown.add(sketch.id);
      let graphics = this.inactiveSketches.get(sketch.id);
      if (!graphics) {
        graphics = new SketchGraphics(this.sketchMaterials, 'inactive');
        this.inactiveSketches.set(sketch.id, graphics);
        this.inactiveSketchGroup.add(graphics.group);
      }
      graphics.setFrame(sketch.frame);
      if (graphics.data !== sketch.data) graphics.update(sketch.data, NO_HIGHLIGHT, this.mmPerPixel());
    }
    for (const [id, graphics] of this.inactiveSketches) {
      if (shown.has(id)) continue;
      this.inactiveSketchGroup.remove(graphics.group);
      graphics.dispose();
      this.inactiveSketches.delete(id);
    }
    this.updateBounds();
    this.requestRender();
  }

  setSketchInput(input: SketchInput | null): void {
    this.sketchInput = input;
  }

  setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  /** The next body that appears is framed automatically (new or opened document). */
  requestFitOnNextBody(): void {
    this.fitOnNextBody = true;
  }

  // ---------------------------------------------------------------- appearance

  setTheme(theme: 'light' | 'dark'): void {
    this.palette = palettes[theme];
    const p = this.palette;
    this.materials.face.color.setHex(p.body);
    this.materials.edge.color.setHex(p.edge);
    this.materials.hoverFace.color.setHex(p.hover);
    this.materials.hoverEdge.color.setHex(p.hover);
    this.materials.selectedFace.color.setHex(p.selected);
    this.materials.selectedEdge.color.setHex(p.selected);
    this.materials.referenceEdge.color.setHex(p.referenceEdge);
    this.pivotMarker.material.color.setHex(p.pivot);
    this.referencePlanes.setPalette(p);
    this.sketchLayer.setPalette(p);
    this.sketchMaterials.setPalette(p);
    this.sketchLayer.refresh();
    for (const graphics of this.inactiveSketches.values()) graphics.refresh();
    this.hemisphere.color = new Color(p.hemisphereSky);
    this.hemisphere.groundColor = new Color(p.hemisphereGround);
    this.viewCube.setPalette(p);
    this.requestRender();
  }

  setCubeLabels(labels: Record<CubeFace, string>): void {
    this.viewCube.refreshLabels(labels);
    this.requestRender();
  }

  setProjection(projection: Projection): void {
    this.projection = projection;
    this.requestRender();
  }

  setNavigation(navigation: NavigationPreset): void {
    this.navigation = navigation;
  }

  // ---------------------------------------------------------------- views

  zoomToFit(animate = true): void {
    this.updateBounds();
    const target = this.controller.fitState(this.bounds, this.aspect());
    this.controller.animateTo(target, animate ? 320 : 0);
    this.requestRender();
  }

  setStandardView(view: StandardView): void {
    this.setViewDirection(VIEW_DIRECTIONS[view]);
  }

  setViewDirection(direction: Vector3): void {
    this.updateBounds();
    const target = this.controller.fitState(this.bounds, this.aspect(), viewQuaternion(direction));
    this.controller.animateTo(target);
    this.requestRender();
  }

  /** Looks straight at a plane with its x axis pointing right ("normal to"). */
  lookAtFrame(frame: SketchFrame): void {
    this.updateBounds();
    const basis = new Matrix4().makeBasis(new Vector3(...frame.xDir), new Vector3(...frame.yDir), new Vector3(...frame.normal));
    const target = this.controller.fitState(this.bounds, this.aspect(), new Quaternion().setFromRotationMatrix(basis));
    this.controller.animateTo(target);
    this.requestRender();
  }

  // ---------------------------------------------------------------- statistics and benchmarks

  setFrameStatsEnabled(enabled: boolean): void {
    this.statsEnabled = enabled;
    this.frameIntervals = [];
    this.cpuTimes = [];
  }

  loadBenchmarkScene(components: number, instanced: boolean): { triangles: number; drawCalls: number } {
    this.clearBenchmarkScene();
    this.bench = createSyntheticAssembly(components, instanced);
    this.scene.add(this.bench.group);
    this.updateBounds();
    this.zoomToFit(false);
    return { triangles: this.bench.triangles, drawCalls: this.bench.drawCalls };
  }

  clearBenchmarkScene(): void {
    if (!this.bench) return;
    this.scene.remove(this.bench.group);
    this.bench.dispose();
    this.bench = null;
    this.updateBounds();
    this.requestRender();
  }

  /**
   * Orbits the camera for `frames` frames and reports GPU-synchronized frame times
   * (CPU work plus GPU completion of each frame).
   */
  runOrbitBenchmark(frames = 240): Promise<BenchmarkResult> {
    return new Promise((resolve) => {
      const totals: number[] = [];
      const cpu: number[] = [];
      let triangles = 0;
      let drawCalls = 0;
      this.continuousRequests += 1;
      this.frameListener = (_interval, cpuMs, totalMs) => {
        this.controller.rotate(6, 1.5, this.bounds.center);
        totals.push(totalMs);
        cpu.push(cpuMs);
        triangles = this.renderer.info.render.triangles;
        drawCalls = this.renderer.info.render.calls;
        if (totals.length >= frames) {
          this.frameListener = null;
          this.continuousRequests -= 1;
          const frameMsMedian = percentile(totals, 50);
          resolve({
            frames: totals.length,
            fps: frameMsMedian > 0 ? 1000 / frameMsMedian : 0,
            frameMsMedian,
            frameMsP95: percentile(totals, 95),
            cpuMsMedian: percentile(cpu, 50),
            triangles,
            drawCalls,
          });
        }
      };
      this.requestRender();
    });
  }

  /** Renders one frame right away and waits for the GPU; returns the time in ms (benchmarks). */
  renderSynchronously(): number {
    const start = performance.now();
    this.controller.update(start);
    this.renderNow();
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
    return performance.now() - start;
  }

  debugInfo(): { triangles: number; drawCalls: number; geometries: number; textures: number } {
    return {
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }

  /** Screen position (CSS pixels, relative to the canvas) of a world point; used by tests. */
  project(point: Vector3): { x: number; y: number } {
    const camera = this.camera();
    camera.updateMatrixWorld();
    const ndc = point.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * this.width, y: ((1 - ndc.y) / 2) * this.height };
  }

  // ---------------------------------------------------------------- rendering

  requestRender(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameRequested = false;
    if (this.disposed) return;
    const animating = this.controller.update(now);
    const cpuStart = performance.now();
    this.renderNow();
    const cpuMs = performance.now() - cpuStart;

    const interval = this.lastFrameTime > 0 && now - this.lastFrameTime < 250 ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;
    if (this.frameListener) {
      // Benchmarks wait for the GPU to finish the frame; otherwise frame intervals only measure the CPU side.
      const gl = this.renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
      this.frameListener(interval, cpuMs, performance.now() - cpuStart);
    }
    if (this.statsEnabled) this.collectStats(interval, cpuMs, now);

    if (animating || this.drag !== null || this.continuousRequests > 0) this.requestRender();
  };

  private renderNow(): void {
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    this.updateHeadlight();
    this.updatePivotMarkerScale();
    const mmPerPixel = this.mmPerPixel();
    this.sketchMaterials.setZoom(mmPerPixel);
    for (const graphics of this.inactiveSketches.values()) graphics.ensureResolution(mmPerPixel);
    if (this.sketchLayer.active) {
      const { target, height } = this.controller.state;
      this.sketchLayer.update({ target, height, aspect: this.aspect(), viewportHeightPx: this.height });
    }

    this.renderer.info.reset();
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, camera);
    this.viewCube.render(this.renderer, this.width, this.height, this.controller.state.quaternion);
    this.triad.render(this.renderer, this.height, this.controller.state.quaternion);
  }

  private collectStats(interval: number, cpuMs: number, now: number): void {
    if (interval > 0) this.frameIntervals.push(interval);
    this.cpuTimes.push(cpuMs);
    if (now - this.lastStatsEmit < 500 || this.frameIntervals.length < 5) return;
    this.lastStatsEmit = now;
    const median = percentile(this.frameIntervals, 50);
    this.callbacks.onFrameStats({ fps: median > 0 ? Math.round(1000 / median) : 0, frameMs: Math.round(percentile(this.cpuTimes, 50) * 10) / 10 });
    this.frameIntervals = [];
    this.cpuTimes = [];
  }

  private camera(): Camera {
    return this.projection === 'perspective' ? this.perspective : this.ortho;
  }

  private aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  private mmPerPixel(): number {
    return this.controller.state.height / Math.max(1, this.height);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    const resolution = new Vector2(this.width, this.height);
    for (const material of [this.materials.edge, this.materials.hoverEdge, this.materials.selectedEdge, this.materials.referenceEdge]) {
      material.resolution.copy(resolution);
    }
    this.referencePlanes.setResolution(resolution);
    this.sketchLayer.setResolution(resolution);
    this.sketchMaterials.setResolution(resolution, this.renderer.getPixelRatio());
    this.requestRender();
  }

  private updateHeadlight(): void {
    const camera = this.camera();
    const offset = this.controller.up().multiplyScalar(0.6).add(this.controller.right().multiplyScalar(-0.35));
    this.headlight.position.copy(camera.position).addScaledVector(offset, this.controller.state.height);
    this.headlight.target.position.copy(this.controller.state.target);
    this.headlight.target.updateMatrixWorld();
  }

  private updatePivotMarkerScale(): void {
    if (!this.pivotMarker.visible) return;
    this.pivotMarker.scale.setScalar((this.controller.state.height / this.height) * 4);
  }

  private updateBounds(): void {
    const box = new Box3();
    for (const model of [this.body, this.preview]) {
      if (model?.mesh.geometry.boundingBox) box.union(model.mesh.geometry.boundingBox);
    }
    if (this.bench) {
      this.bounds = this.bench.bounds.clone();
      return;
    }
    // The standard planes reach a little beyond the body in every direction from the origin.
    const reach = box.isEmpty() ? 0 : Math.max(...box.min.toArray().map(Math.abs), ...box.max.toArray().map(Math.abs));
    this.referencePlanes.setHalfSize(Math.max(MIN_PLANE_HALF_SIZE, Math.ceil((reach * 1.15) / 10) * 10));
    const planes = this.referencePlanes.visibleBounds();
    if (planes) box.union(planes);
    for (const sketch of [this.sketchLayer.worldBounds(), ...[...this.inactiveSketches.values()].map((graphics) => graphics.worldBounds())]) {
      if (sketch) box.union(sketch);
    }
    // The sketch plane must stay inside the camera's depth range.
    const frame = this.sketchLayer.sketchFrame;
    if (frame && !box.isEmpty()) box.expandByPoint(new Vector3(...frame.origin));
    if (box.isEmpty()) {
      this.bounds = new Sphere(new Vector3(0, 0, 20), 120);
      return;
    }
    box.getBoundingSphere(this.bounds);
  }

  // ---------------------------------------------------------------- picking and highlighting

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }

  private pickAt(x: number, y: number): Pick | null {
    if (this.pickFilter === 'none') return null;
    const body = this.bodyPickable ? this.body : null;
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    this.raycaster.params.Line2 = { threshold: EDGE_PICK_THRESHOLD_PX };
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

    body?.ensureBvh();
    // Faces always occlude what lies behind them, even when they cannot be picked themselves.
    const faceHit = body ? this.raycaster.intersectObject(body.mesh, false)[0] : undefined;
    const edgeHit = body && this.pickFilter !== 'planes' ? this.raycaster.intersectObject(body.edges, false)[0] : undefined;
    const planeHit = this.pickFilter === 'edges' ? null : this.referencePlanes.intersect(this.raycaster);
    const worldPerPixel = this.controller.state.height / this.height;
    const tolerance = worldPerPixel * 8;

    if (body && edgeHit && edgeHit.faceIndex !== undefined && edgeHit.faceIndex !== null && (!faceHit || edgeHit.distance <= faceHit.distance + tolerance)) {
      return { kind: 'edge', index: body.edgeOfSegment(edgeHit.faceIndex) };
    }
    // A pickable face wins over a translucent plane in front of it: the face is what one sees and aims at,
    // and planes stay pickable where they extend beyond the part (and in the feature tree).
    if (body && faceHit && faceHit.faceIndex !== undefined && faceHit.faceIndex !== null) {
      const face = body.faceOfTriangle(faceHit.faceIndex);
      if (this.pickFilter === 'all' || (this.pickFilter === 'planes' && body.isPlanarFace(face))) return { kind: 'face', index: face };
    }
    if (planeHit && (!faceHit || planeHit.distance < faceHit.distance)) return { kind: 'plane', index: planeHit.index };
    return null;
  }

  /** Where the cursor meets the sketch plane, in sketch coordinates. */
  private sketchPointer(x: number, y: number, additive: boolean): SketchPointer | null {
    const frame = this.sketchLayer.sketchFrame;
    if (!frame) return null;
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    const normal = new Vector3(...frame.normal);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...frame.origin));
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return null;
    const [u, v] = toSketch(frame, [hit.x, hit.y, hit.z]);
    this.lastSketchPointer = { x, y, u, v, mmPerPixel: this.mmPerPixel(), additive };
    return this.lastSketchPointer;
  }

  /** Surface point under the cursor, used as rotation pivot. */
  private surfacePointAt(x: number, y: number): Vector3 | null {
    const targets = [this.body?.mesh, this.bench?.group].filter((object) => object !== undefined);
    if (targets.length === 0) return null;
    this.body?.ensureBvh();
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return hit ? hit.point.clone() : null;
  }

  private setHoverPick(pick: Pick | null): void {
    if (samePick(pick, this.hover)) return;
    this.hover = pick;
    if (this.hoverOverlay) {
      this.overlays.remove(this.hoverOverlay);
      disposeOverlay(this.hoverOverlay);
      this.hoverOverlay = null;
    }
    const alreadySelected = pick !== null && this.selection.some((s) => samePick(s, pick));
    // Planes show their hover state through setReferencePlanes.
    if (pick && pick.kind !== 'plane' && this.body && !alreadySelected) {
      this.hoverOverlay =
        pick.kind === 'face'
          ? this.body.faceOverlay(pick.index, this.materials.hoverFace)
          : this.body.edgeOverlay(pick.index, this.materials.hoverEdge);
      if (this.hoverOverlay) this.overlays.add(this.hoverOverlay);
    }
    this.canvas.style.cursor = pick ? 'pointer' : '';
    this.callbacks.onHover(pick);
    this.requestRender();
  }

  private clearHover(): void {
    this.setHoverPick(null);
  }

  private clearSelectionOverlays(): void {
    for (const overlay of this.selectionOverlays) {
      this.overlays.remove(overlay);
      disposeOverlay(overlay);
    }
    this.selectionOverlays = [];
  }

  private rebuildSelectionOverlays(): void {
    this.clearSelectionOverlays();
    const body = this.body;
    if (!body) return;
    for (const pick of this.selection) {
      if (pick.kind === 'plane') continue;
      if (pick.kind === 'face' && pick.index >= body.faceCount) continue;
      if (pick.kind === 'edge' && pick.index >= body.edgeCount) continue;
      const overlay =
        pick.kind === 'face'
          ? body.faceOverlay(pick.index, this.materials.selectedFace)
          : body.edgeOverlay(pick.index, this.materials.selectedEdge);
      if (overlay) {
        this.selectionOverlays.push(overlay);
        this.overlays.add(overlay);
      }
    }
  }

  private queueHover(): void {
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.disposed || this.drag || !this.lastPointer) return;
      const { x, y } = this.lastPointer;
      const cubeDirection = this.viewCube.hitTest(x, y, this.width, this.controller.state.quaternion);
      if (this.viewCube.setHover(cubeDirection)) this.requestRender();
      if (cubeDirection) {
        this.setHoverPick(null);
        this.sketchInput?.hover(null);
        this.canvas.style.cursor = 'pointer';
        return;
      }
      if (this.sketchLayer.active && this.sketchInput) {
        this.sketchInput.hover(this.sketchPointer(x, y, false));
        return;
      }
      this.setHoverPick(this.pickAt(x, y));
    });
  }

  // ---------------------------------------------------------------- input

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dragModeFor(event: PointerEvent): DragMode {
    const { x, y } = this.local(event);
    if (event.button === 0 && this.viewCube.contains(x, y, this.width)) return 'cube';
    if (event.button === 1) return event.shiftKey || event.ctrlKey ? 'pan' : 'rotate';
    if (event.button === 2) return 'pan';
    if (event.button === 0 && event.altKey) return event.shiftKey ? 'pan' : 'rotate';
    return 'select';
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    // Prevent the browser's auto-scroll on middle click.
    canvas.addEventListener('mousedown', this.onMouseDown);
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.drag) return;
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.local(event);
    let mode = this.dragModeFor(event);
    if (mode === 'select' && this.sketchLayer.active && this.sketchInput) {
      const pointer = this.sketchPointer(x, y, event.ctrlKey || event.metaKey || event.shiftKey);
      if (pointer) {
        mode = 'sketch';
        this.sketchInput.down(pointer);
      }
    }
    let pivot = this.bounds.center.clone();
    if (mode === 'rotate') {
      pivot = this.surfacePointAt(x, y) ?? this.controller.state.target.clone();
      this.pivotMarker.position.copy(pivot);
      this.pivotMarker.visible = true;
    }
    this.drag = { mode, pointerId: event.pointerId, startX: x, startY: y, lastX: x, lastY: y, moved: false, button: event.button, pivot };
    this.canvas.setPointerCapture(event.pointerId);
    if (mode === 'rotate' || mode === 'pan') this.setHoverPick(null);
    this.requestRender();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.local(event);
    this.lastPointer = point;
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      this.queueHover();
      return;
    }
    const dx = point.x - drag.lastX;
    const dy = point.y - drag.lastY;
    drag.lastX = point.x;
    drag.lastY = point.y;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > CLICK_TOLERANCE_PX) drag.moved = true;
    if (drag.mode === 'rotate') this.controller.rotate(dx, dy, drag.pivot);
    else if (drag.mode === 'pan' && drag.moved) this.controller.pan(dx, dy, this.height);
    else if (drag.mode === 'sketch') {
      const pointer = this.sketchPointer(point.x, point.y, event.ctrlKey || event.metaKey || event.shiftKey);
      if (pointer) this.sketchInput?.move(pointer);
    }
    this.requestRender();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.pivotMarker.visible = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const { x, y } = this.local(event);
    if (drag.mode === 'sketch') {
      // Seen exactly edge-on the plane has no intersection: finish where the pointer was last.
      const pointer = this.sketchPointer(x, y, event.ctrlKey || event.metaKey || event.shiftKey) ?? this.lastSketchPointer;
      if (pointer) this.sketchInput?.up(pointer, drag.moved);
    } else if (!drag.moved && drag.mode === 'cube') {
      const direction = this.viewCube.hitTest(x, y, this.width, this.controller.state.quaternion);
      if (direction) this.setViewDirection(direction);
    } else if (!drag.moved && drag.mode === 'select') {
      this.callbacks.onPick(this.pickAt(x, y), event.ctrlKey || event.metaKey || event.shiftKey);
    }
    this.requestRender();
  };

  private readonly onPointerLeave = (): void => {
    this.lastPointer = null;
    if (this.viewCube.setHover(null)) this.requestRender();
    if (!this.drag) {
      this.setHoverPick(null);
      this.sketchInput?.hover(null);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const { x, y } = this.local(event);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    const dx = event.deltaX * scale;
    const dy = event.deltaY * scale;
    const ndc = this.ndc(x, y);

    if (event.ctrlKey) {
      // Pinch gesture on a trackpad (reported as ctrl + wheel).
      this.controller.zoomAt(Math.exp(dy * 0.01), ndc.x, ndc.y, this.aspect());
    } else if (this.navigation === 'trackpad') {
      if (event.shiftKey) {
        this.controller.pan(-dx, -dy, this.height);
      } else {
        const now = performance.now();
        if (!this.wheelPivot || now - this.wheelPivot.time > 250) {
          this.wheelPivot = { point: this.surfacePointAt(x, y) ?? this.controller.state.target.clone(), time: now };
        }
        this.wheelPivot.time = now;
        this.controller.rotate(-dx, -dy, this.wheelPivot.point);
      }
    } else {
      this.controller.zoomAt(Math.exp(dy * 0.0015), ndc.x, ndc.y, this.aspect());
    }
    this.requestRender();
  };

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.clearSelectionOverlays();
    if (this.hoverOverlay) disposeOverlay(this.hoverOverlay);
    this.body?.dispose();
    this.preview?.dispose();
    this.bench?.dispose();
    this.viewCube.dispose();
    this.triad.dispose();
    this.referencePlanes.dispose();
    this.sketchLayer.dispose();
    for (const graphics of this.inactiveSketches.values()) graphics.dispose();
    this.sketchMaterials.dispose();
    this.pivotMarker.geometry.dispose();
    this.pivotMarker.material.dispose();
    Object.values(this.materials).forEach((material) => material.dispose());
    this.renderer.dispose();
    this.canvas.remove();
  }
}

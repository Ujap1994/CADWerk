import { Box3, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Raycaster, type Vector2 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { STANDARD_FRAMES, STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import type { ViewportPalette } from './palette.ts';

/** Which standard planes are shown and how (indices into STANDARD_PLANES). */
export interface PlaneDisplay {
  visible: readonly boolean[];
  hovered: number | null;
  selected: readonly number[];
}

type PlaneStyle = 'normal' | 'hovered' | 'selected';

const SQUARE = [-1, -1, 0, 1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, 1, 0, -1, -1, 0];

interface PlaneObjects {
  basis: Matrix4;
  fill: Mesh<PlaneGeometry, MeshBasicMaterial>;
  outline: LineSegments2;
}

/** The Front, Top and Right planes through the origin, drawn as translucent squares. */
export class ReferencePlanes {
  readonly group = new Group();
  private readonly planes: PlaneObjects[];
  private readonly fills: Record<PlaneStyle, MeshBasicMaterial>;
  private readonly outlines: Record<PlaneStyle, LineMaterial>;
  private halfSize = 60;

  constructor() {
    const fill = (opacity: number) => new MeshBasicMaterial({ transparent: true, opacity, side: DoubleSide, depthWrite: false });
    this.fills = { normal: fill(0.05), hovered: fill(0.14), selected: fill(0.14) };
    const outline = (linewidth: number, opacity: number) => new LineMaterial({ linewidth, worldUnits: false, transparent: true, opacity, depthWrite: false });
    this.outlines = { normal: outline(1.2, 0.6), hovered: outline(2.4, 1), selected: outline(2.4, 1) };

    const outlineGeometry = new LineSegmentsGeometry().setPositions(SQUARE);
    this.planes = STANDARD_PLANES.map((plane) => {
      const frame = STANDARD_FRAMES[plane];
      const basis = new Matrix4().makeBasis(new Vector3(...frame.xDir), new Vector3(...frame.yDir), new Vector3(...frame.normal));
      const fillMesh = new Mesh(new PlaneGeometry(2, 2), this.fills.normal);
      const outlineLines = new LineSegments2(outlineGeometry, this.outlines.normal);
      for (const object of [fillMesh, outlineLines]) {
        object.matrixAutoUpdate = false;
        object.renderOrder = 3;
        object.visible = false;
      }
      // The outline is drawn but never picked; the fill is the pick target.
      outlineLines.raycast = () => undefined;
      this.group.add(fillMesh, outlineLines);
      return { basis, fill: fillMesh, outline: outlineLines };
    });
    this.updateMatrices();
  }

  /** Half the side length of each plane square, in mm. */
  setHalfSize(halfSize: number): void {
    if (halfSize === this.halfSize) return;
    this.halfSize = halfSize;
    this.updateMatrices();
  }

  setDisplay(display: PlaneDisplay): void {
    this.planes.forEach((plane, index) => {
      const visible = display.visible[index] === true || display.selected.includes(index) || display.hovered === index;
      const style: PlaneStyle = display.hovered === index ? 'hovered' : display.selected.includes(index) ? 'selected' : 'normal';
      plane.fill.visible = visible;
      plane.outline.visible = visible;
      plane.fill.material = this.fills[style];
      plane.outline.material = this.outlines[style];
    });
  }

  get anyVisible(): boolean {
    return this.planes.some((plane) => plane.fill.visible);
  }

  setPalette(palette: ViewportPalette): void {
    this.fills.normal.color.setHex(palette.plane);
    this.outlines.normal.color.setHex(palette.plane);
    this.fills.hovered.color.setHex(palette.hover);
    this.outlines.hovered.color.setHex(palette.hover);
    this.fills.selected.color.setHex(palette.selected);
    this.outlines.selected.color.setHex(palette.selected);
  }

  setResolution(resolution: Vector2): void {
    for (const material of Object.values(this.outlines)) material.resolution.copy(resolution);
  }

  /** Nearest visible plane under the ray. */
  intersect(raycaster: Raycaster): { index: number; distance: number } | null {
    let best: { index: number; distance: number } | null = null;
    for (const [index, plane] of this.planes.entries()) {
      if (!plane.fill.visible) continue;
      const hit = raycaster.intersectObject(plane.fill, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { index, distance: hit.distance };
    }
    return best;
  }

  /** Extent of the visible planes, so the camera's depth range includes them. */
  visibleBounds(): Box3 | null {
    if (!this.anyVisible) return null;
    return new Box3(new Vector3(-1, -1, -1).multiplyScalar(this.halfSize), new Vector3(1, 1, 1).multiplyScalar(this.halfSize));
  }

  dispose(): void {
    this.planes[0]?.outline.geometry.dispose();
    for (const plane of this.planes) plane.fill.geometry.dispose();
    for (const material of [...Object.values(this.fills), ...Object.values(this.outlines)]) material.dispose();
  }

  private updateMatrices(): void {
    const scale = new Matrix4().makeScale(this.halfSize, this.halfSize, 1);
    for (const plane of this.planes) {
      for (const object of [plane.fill, plane.outline]) {
        object.matrix.copy(plane.basis).multiply(scale);
        object.updateMatrixWorld(true);
      }
    }
  }
}

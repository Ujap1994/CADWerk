import type {
  Quaternion} from 'three';
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { ViewportPalette } from './palette.ts';
import { viewQuaternion } from './views.ts';

export type CubeFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const FACE_NORMALS: Record<CubeFace, Vector3> = {
  front: new Vector3(0, -1, 0),
  back: new Vector3(0, 1, 0),
  left: new Vector3(-1, 0, 0),
  right: new Vector3(1, 0, 0),
  top: new Vector3(0, 0, 1),
  bottom: new Vector3(0, 0, -1),
};

/** Thickness of edge and corner regions (cube size is 1). */
const BAND = 0.22;
const SIZE_PX = 110;
const MARGIN_PX = 14;

function labelTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 256, 256);
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    let fontSize = 64;
    const family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    context.font = `600 ${fontSize}px ${family}`;
    while (context.measureText(text).width > 200 && fontSize > 28) {
      fontSize -= 4;
      context.font = `600 ${fontSize}px ${family}`;
    }
    context.fillText(text, 128, 132);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Navigation cube in the top-right corner. Clicking a face, edge or corner
 * turns the view to look from that direction.
 */
export class ViewCube {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 10);
  private readonly cube = new Group();
  private readonly regions: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  private readonly labels = new Map<CubeFace, Mesh<PlaneGeometry, MeshBasicMaterial>>();
  private readonly raycaster = new Raycaster();
  private hovered: Mesh<BoxGeometry, MeshBasicMaterial> | null = null;
  private palette: ViewportPalette;

  constructor(palette: ViewportPalette, labels: Record<CubeFace, string>) {
    this.palette = palette;
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 0, 1]) {
        for (const z of [-1, 0, 1]) {
          if (x === 0 && y === 0 && z === 0) continue;
          const direction = new Vector3(x, y, z);
          const size = (v: number) => (v === 0 ? 1 - 2 * BAND : BAND);
          const center = (v: number) => v * (0.5 - BAND / 2);
          const region = new Mesh(new BoxGeometry(size(x), size(y), size(z)), new MeshBasicMaterial());
          region.position.set(center(x), center(y), center(z));
          region.userData.direction = direction;
          region.userData.isFace = Math.abs(x) + Math.abs(y) + Math.abs(z) === 1;
          this.regions.push(region);
          this.cube.add(region);
        }
      }
    }
    for (const face of Object.keys(FACE_NORMALS) as CubeFace[]) {
      const normal = FACE_NORMALS[face];
      const plane = new Mesh(new PlaneGeometry(1 - BAND, 1 - BAND), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
      plane.quaternion.copy(viewQuaternion(normal));
      plane.position.copy(normal).multiplyScalar(0.502);
      plane.renderOrder = 1;
      this.labels.set(face, plane);
      this.cube.add(plane);
    }
    this.scene.add(this.cube);
    this.setPalette(palette);
    this.setLabels(labels);
  }

  setPalette(palette: ViewportPalette): void {
    this.palette = palette;
    for (const region of this.regions) {
      region.material.color.setHex(region === this.hovered ? palette.cubeFaceHover : region.userData.isFace ? palette.cubeFace : palette.cubeEdge);
    }
  }

  setLabels(labels: Record<CubeFace, string>): void {
    for (const [face, plane] of this.labels) {
      plane.material.map?.dispose();
      plane.material.map = labelTexture(labels[face], this.palette.cubeText);
      plane.material.needsUpdate = true;
    }
  }

  /** Re-renders the labels in the current palette text color. */
  refreshLabels(labels: Record<CubeFace, string>): void {
    this.setLabels(labels);
  }

  /** Corner rectangle in CSS pixels (origin top-left). */
  private rect(canvasWidth: number): { x: number; y: number; size: number } {
    return { x: canvasWidth - SIZE_PX - MARGIN_PX, y: MARGIN_PX, size: SIZE_PX };
  }

  contains(x: number, y: number, canvasWidth: number): boolean {
    const r = this.rect(canvasWidth);
    return x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size;
  }

  /** Direction of the region under the cursor (in CSS pixels relative to the canvas), or null. */
  hitTest(x: number, y: number, canvasWidth: number, orientation: Quaternion): Vector3 | null {
    if (!this.contains(x, y, canvasWidth)) return null;
    const r = this.rect(canvasWidth);
    this.sync(orientation);
    const ndc = new Vector2(((x - r.x) / r.size) * 2 - 1, -(((y - r.y) / r.size) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.regions, false)[0];
    return hit ? (hit.object.userData.direction as Vector3).clone() : null;
  }

  /** Highlights the region with the given direction; returns true when the highlight changed. */
  setHover(direction: Vector3 | null): boolean {
    const region = direction ? (this.regions.find((r) => (r.userData.direction as Vector3).equals(direction)) ?? null) : null;
    if (region === this.hovered) return false;
    this.hovered = region;
    this.setPalette(this.palette);
    return true;
  }

  private sync(orientation: Quaternion): void {
    this.camera.position.set(0, 0, 3).applyQuaternion(orientation);
    this.camera.quaternion.copy(orientation);
    this.camera.updateMatrixWorld();
  }

  render(renderer: WebGLRenderer, canvasWidth: number, canvasHeight: number, orientation: Quaternion): void {
    const r = this.rect(canvasWidth);
    this.sync(orientation);
    renderer.setViewport(r.x, canvasHeight - r.y - r.size, r.size, r.size);
    renderer.setScissor(r.x, canvasHeight - r.y - r.size, r.size, r.size);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }

  dispose(): void {
    for (const region of this.regions) {
      region.geometry.dispose();
      region.material.dispose();
    }
    for (const plane of this.labels.values()) {
      plane.material.map?.dispose();
      plane.geometry.dispose();
      plane.material.dispose();
    }
  }
}

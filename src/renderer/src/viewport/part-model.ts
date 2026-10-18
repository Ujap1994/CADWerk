import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { MeshPayload } from '../../../kernel/protocol.ts';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Index of the last range whose start is <= value ([start, count] pairs). */
function rangeIndexOf(ranges: Uint32Array, value: number): number {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((ranges[mid * 2] as number) <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** A tessellated B-Rep body: shaded faces plus edges, with lookups from triangles/segments to topology. */
export class PartModel {
  readonly key: string;
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly edges: LineSegments2;
  readonly faceCount: number;
  readonly edgeCount: number;
  private readonly payload: MeshPayload;
  private bvhReady = false;

  constructor(payload: MeshPayload, faceMaterial: Material, edgeMaterial: LineMaterial) {
    this.key = payload.key;
    this.payload = payload;
    this.faceCount = payload.faceRanges.length / 2;
    this.edgeCount = payload.edgeRanges.length / 2;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(payload.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(payload.normals, 3));
    geometry.setIndex(new BufferAttribute(payload.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.mesh = new Mesh(geometry, faceMaterial);

    const edgeGeometry = new LineSegmentsGeometry();
    if (payload.edgePositions.length > 0) edgeGeometry.setPositions(payload.edgePositions);
    this.edges = new LineSegments2(edgeGeometry, edgeMaterial);
    this.edges.renderOrder = 1;

    this.group.add(this.mesh, this.edges);
  }

  /** Builds the picking acceleration structure on first use, so loading stays fast. */
  ensureBvh(): void {
    if (this.bvhReady) return;
    this.mesh.geometry.computeBoundsTree();
    this.bvhReady = true;
  }

  faceOfTriangle(triangle: number): number {
    return rangeIndexOf(this.payload.faceRanges, triangle * 3);
  }

  edgeOfSegment(segment: number): number {
    return rangeIndexOf(this.payload.edgeRanges, segment * 2);
  }

  /** A mesh that draws only one face (shares the vertex buffers). */
  faceOverlay(face: number, material: Material): Mesh | null {
    const start = this.payload.faceRanges[face * 2];
    const count = this.payload.faceRanges[face * 2 + 1];
    if (start === undefined || count === undefined) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.mesh.geometry.getAttribute('position'));
    geometry.setAttribute('normal', this.mesh.geometry.getAttribute('normal'));
    geometry.setIndex(new BufferAttribute(this.payload.indices.subarray(start, start + count), 1));
    const overlay = new Mesh(geometry, material);
    overlay.renderOrder = 2;
    overlay.raycast = () => undefined;
    return overlay;
  }

  /** Thick lines for one edge. */
  edgeOverlay(edge: number, material: LineMaterial): LineSegments2 | null {
    const start = this.payload.edgeRanges[edge * 2];
    const count = this.payload.edgeRanges[edge * 2 + 1];
    if (start === undefined || count === undefined || count === 0) return null;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(this.payload.edgePositions.subarray(start * 3, (start + count) * 3));
    const overlay = new LineSegments2(geometry, material);
    overlay.renderOrder = 3;
    overlay.raycast = () => undefined;
    return overlay;
  }

  dispose(): void {
    if (this.bvhReady) this.mesh.geometry.disposeBoundsTree();
    this.mesh.geometry.dispose();
    this.edges.geometry.dispose();
  }
}

/**
 * Disposes an overlay created by faceOverlay/edgeOverlay.
 *
 * Face overlays share the body's vertex buffers; disposing their geometry as-is
 * would also free those buffers on the GPU and force a re-upload of the whole
 * body on every hover change. Detach the shared attributes first.
 */
export function disposeOverlay(object: Mesh | LineSegments2): void {
  if (!(object instanceof LineSegments2)) {
    object.geometry.deleteAttribute('position');
    object.geometry.deleteAttribute('normal');
  }
  object.geometry.dispose();
}

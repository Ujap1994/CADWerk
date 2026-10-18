import type { Feature } from '../../shared/model/feature.ts';
import type { GeometryBackend, ShapeHandle } from '../backend.ts';
import { applyFeature } from '../features.ts';
import { extractMesh } from '../mesh.ts';
import type { MeshQuality } from '../mesh-quality.ts';
import { Arena, describeError, loadOpenCascade, type OC, type TopoDS_Shape } from '../occt.ts';
import { boundingBox, massProperties } from '../properties.ts';
import { exportStep, importStep } from '../step.ts';
import { countSubShapes } from '../topology.ts';

/**
 * Backend on the prebuilt `replicad-opencascadejs` WebAssembly build (Phase 0 spike).
 * Kept for comparison benchmarks; see docs/adr/0001-geometry-kernel.md.
 */
export class ReplicadBackend implements GeometryBackend {
  readonly name = 'replicad';
  readonly oc: OC;

  private constructor(oc: OC) {
    this.oc = oc;
  }

  static async create(wasmUrl?: string): Promise<ReplicadBackend> {
    return new ReplicadBackend(await loadOpenCascade(wasmUrl));
  }

  private shape(handle: ShapeHandle): TopoDS_Shape {
    return handle as unknown as TopoDS_Shape;
  }

  applyFeature(body: ShapeHandle | null, feature: Feature): ShapeHandle {
    return applyFeature(this.oc, body ? this.shape(body) : null, feature) as unknown as ShapeHandle;
  }

  release(handle: ShapeHandle): void {
    this.shape(handle).delete();
  }

  counts(handle: ShapeHandle) {
    using arena = new Arena();
    const shape = this.shape(handle);
    return {
      faces: countSubShapes(this.oc, arena, shape, 'face'),
      edges: countSubShapes(this.oc, arena, shape, 'edge'),
      solids: countSubShapes(this.oc, arena, shape, 'solid'),
    };
  }

  boundingBox(handle: ShapeHandle) {
    return boundingBox(this.oc, this.shape(handle));
  }

  massProperties(handle: ShapeHandle) {
    return massProperties(this.oc, this.shape(handle));
  }

  mesh(handle: ShapeHandle, quality: MeshQuality, key: string) {
    return extractMesh(this.oc, this.shape(handle), quality, key);
  }

  exportMesh(handle: ShapeHandle, quality: MeshQuality) {
    const shape = this.shape(handle);
    const mesh = extractMesh(this.oc, shape, quality, 'export', { withEdges: false });
    // Drop the fine triangulation again so the 3D view keeps its lighter display mesh.
    this.oc.BRepTools.Clean(shape, true);
    return { positions: mesh.positions, indices: mesh.indices };
  }

  exportStep(handle: ShapeHandle) {
    return exportStep(this.oc, this.shape(handle));
  }

  importStep(bytes: Uint8Array): ShapeHandle {
    return importStep(this.oc, bytes) as unknown as ShapeHandle;
  }

  heapBytes(): number {
    return this.oc.wasmMemory.buffer.byteLength;
  }

  describeError(error: unknown): string {
    return describeError(this.oc, error);
  }
}

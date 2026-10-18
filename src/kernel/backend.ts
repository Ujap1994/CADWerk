import type { Feature, Vec3 } from '../shared/model/feature.ts';
import type { MassProperties, MeshPayload } from './protocol.ts';
import type { MeshQuality } from './mesh-quality.ts';

/** Opaque reference to a shape owned by a backend. */
export type ShapeHandle = { readonly __shape: unique symbol };

/**
 * A geometry kernel implementation. The rebuild logic, caching and the worker
 * protocol are shared; backends only provide the geometric operations.
 * See docs/adr/0001-geometry-kernel.md.
 */
export interface GeometryBackend {
  readonly name: 'parawerk' | 'replicad';
  /** Builds the body after `feature`; throws FeatureError. The caller owns the result. */
  applyFeature(body: ShapeHandle | null, feature: Feature): ShapeHandle;
  release(shape: ShapeHandle): void;
  counts(shape: ShapeHandle): { faces: number; edges: number; solids: number };
  boundingBox(shape: ShapeHandle): { min: Vec3; max: Vec3 };
  massProperties(shape: ShapeHandle): MassProperties;
  /** Display mesh with edges and exact face/edge information. */
  mesh(shape: ShapeHandle, quality: MeshQuality, key: string): MeshPayload;
  /** Fine mesh for STL export; does not change the display triangulation. */
  exportMesh(shape: ShapeHandle, quality: MeshQuality): { positions: Float32Array; indices: Uint32Array };
  exportStep(shape: ShapeHandle): Uint8Array;
  importStep(bytes: Uint8Array): ShapeHandle;
  heapBytes(): number;
  describeError(error: unknown): string;
}

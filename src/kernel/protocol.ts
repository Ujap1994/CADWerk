import type { Feature, Vec3 } from '../shared/model/feature.ts';

/** Triangulated body ready for rendering. All buffers are transferable. */
export interface MeshPayload {
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** [start, count] per B-Rep face, in units of `indices`. Face i is topological face index i. */
  faceRanges: Uint32Array;
  /** Line segments (pairs of points) for all edges. */
  edgePositions: Float32Array;
  /** [start, count] per B-Rep edge, in points of `edgePositions`. Edge i is topological edge index i. */
  edgeRanges: Uint32Array;
}

export type FeatureErrorCode =
  | 'no-body'
  | 'no-edges'
  | 'edge-missing'
  | 'empty-result'
  | 'first-must-add'
  | 'operation-failed'
  | 'unknown';

export interface FeatureResult {
  id: string;
  status: 'ok' | 'error' | 'suppressed';
  error?: { code: FeatureErrorCode; detail?: string };
  /** Time spent on this feature in the last rebuild (0 when it came from the cache). */
  timeMs: number;
  cached: boolean;
}

export interface MassProperties {
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  center: Vec3;
  bboxMin: Vec3;
  bboxMax: Vec3;
}

/** The state of the body after a given feature, as requested by `RebuildRequest.captures`. */
export interface CapturedState {
  /** Feature index; -1 means "before the first feature". */
  index: number;
  /** Null when there is no body at this point. */
  meshKey: string | null;
  /** Omitted when the client already holds the mesh (see `knownMeshKeys`). */
  mesh?: MeshPayload;
  properties: MassProperties | null;
  faceCount: number;
  edgeCount: number;
}

export interface RebuildRequest {
  features: Feature[];
  captures: number[];
  knownMeshKeys: string[];
  withProperties: boolean;
}

export interface RebuildResult {
  features: FeatureResult[];
  captures: CapturedState[];
  timings: { totalMs: number; rebuiltFeatures: number; meshMs: number };
}

export type ExportFormat = 'step' | 'stl';

export interface ExportRequest {
  features: Feature[];
  format: ExportFormat;
}

export interface MemoryStats {
  wasmHeapBytes: number;
  cachedShapes: number;
}

export type KernelRequest =
  | { type: 'rebuild'; payload: RebuildRequest }
  | { type: 'export'; payload: ExportRequest }
  | { type: 'memory' };

export type KernelRequestMessage = KernelRequest & { id: number };

export type KernelResponseMessage =
  | { kind: 'reply'; id: number; ok: true; result: unknown }
  | { kind: 'reply'; id: number; ok: false; error: string }
  | { kind: 'ready'; initMs: number }
  | { kind: 'warm'; warmUpMs: number }
  | { kind: 'fatal'; error: string };

import createParaWerkKernel from '../../../vendor/parawerk-kernel/parawerk-kernel.js';
import type { SolidModelingFeature, Vec3 } from '../../shared/model/feature.ts';
import type { GeometryBackend, ShapeHandle } from '../backend.ts';
import { FeatureError } from '../feature-error.ts';
import { axisDirection } from '../feature-geometry.ts';
import type { MeshQuality } from '../mesh-quality.ts';
import type { CurveKind, EdgeInfo, FaceInfo, FeatureErrorCode, MassProperties, MeshPayload, SurfaceKind } from '../protocol.ts';

type KernelModule = Awaited<ReturnType<typeof createParaWerkKernel>>;

type IdResult = { ok: true; id: number } | { ok: false; code: string; message: string };
type Failure = { ok: false; code: string; message: string };

interface RawMesh {
  ok: true;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceRanges: Uint32Array;
  edgePositions: Float32Array;
  edgeRanges: Uint32Array;
  faceKinds: Uint8Array;
  faceAreas: Float64Array;
  faceRadii: Float64Array;
  edgeKinds: Uint8Array;
  edgeLengths: Float64Array;
  edgeRadii: Float64Array;
}

/** Must match SurfaceKindCode / CurveKindCode in native/kernel/src/kernel.cpp. */
const SURFACE_KINDS: SurfaceKind[] = ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bspline', 'revolution', 'extrusion', 'other'];
const CURVE_KINDS: CurveKind[] = ['line', 'circle', 'ellipse', 'bspline', 'other'];

const FEATURE_ERROR_CODES = new Set<FeatureErrorCode>(['no-body', 'no-edges', 'edge-missing', 'empty-result', 'first-must-add', 'operation-failed', 'unknown']);

class KernelCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelCallError';
  }
}

function check<T extends { ok: boolean }>(result: T | Failure): T {
  if (!result.ok) throw new KernelCallError((result as Failure).message);
  return result as T;
}

/**
 * Backend on ParaWerk's own OCCT 8 WebAssembly build (native/kernel). Shapes stay in
 * C++ and are referenced by integer ids; every call returns plain data.
 */
export class ParaWerkBackend implements GeometryBackend {
  readonly name = 'parawerk';
  private readonly kernel: KernelModule;

  private constructor(kernel: KernelModule) {
    this.kernel = kernel;
  }

  static async create(wasmUrl?: string): Promise<ParaWerkBackend> {
    const kernel = await createParaWerkKernel(wasmUrl === undefined ? {} : { locateFile: () => wasmUrl });
    return new ParaWerkBackend(kernel);
  }

  get version(): string {
    return this.kernel.version();
  }

  get liveShapes(): number {
    return this.kernel.shapeCount();
  }

  private id(handle: ShapeHandle): number {
    return handle as unknown as number;
  }

  private handle(result: unknown): ShapeHandle {
    const value = result as IdResult;
    if (!value.ok) {
      const code = FEATURE_ERROR_CODES.has(value.code as FeatureErrorCode) ? (value.code as FeatureErrorCode) : 'operation-failed';
      throw new FeatureError(code, value.message);
    }
    return value.id as unknown as ShapeHandle;
  }

  applyFeature(body: ShapeHandle | null, feature: SolidModelingFeature): ShapeHandle {
    const k = this.kernel;
    switch (feature.type) {
      case 'box':
      case 'cylinder': {
        const [x, y, z] = feature.position;
        let tool: ShapeHandle;
        if (feature.type === 'box') {
          tool = this.handle(k.makeBox(x - feature.width / 2, y - feature.depth / 2, z, feature.width, feature.depth, feature.height));
        } else {
          const [dx, dy, dz] = axisDirection(feature.axis);
          tool = this.handle(k.makeCylinder(x, y, z, dx, dy, dz, feature.radius, feature.height));
        }
        if (body === null) {
          if (feature.operation === 'cut') {
            this.release(tool);
            throw new FeatureError('first-must-add');
          }
          return tool;
        }
        try {
          return this.handle(k.booleanOperation(this.id(body), this.id(tool), feature.operation === 'add' ? 0 : 1));
        } finally {
          this.release(tool);
        }
      }
      case 'fillet':
      case 'chamfer': {
        if (body === null) throw new FeatureError('no-body');
        if (feature.edges.length === 0) throw new FeatureError('no-edges');
        const edges = feature.edges.map((ref) => ref.index);
        return feature.type === 'fillet'
          ? this.handle(k.fillet(this.id(body), edges, feature.radius))
          : this.handle(k.chamfer(this.id(body), edges, feature.distance));
      }
    }
  }

  release(handle: ShapeHandle): void {
    this.kernel.release(this.id(handle));
  }

  counts(handle: ShapeHandle) {
    const result = check(this.kernel.counts(this.id(handle)) as { ok: true; faces: number; edges: number; solids: number } | Failure);
    return { faces: result.faces, edges: result.edges, solids: result.solids };
  }

  boundingBox(handle: ShapeHandle): { min: Vec3; max: Vec3 } {
    const result = check(this.kernel.boundingBox(this.id(handle)) as { ok: true; min: Vec3; max: Vec3 } | Failure);
    return { min: result.min, max: result.max };
  }

  massProperties(handle: ShapeHandle): MassProperties {
    const props = check(this.kernel.massProperties(this.id(handle)) as { ok: true; volume: number; area: number; center: Vec3 } | Failure);
    const bbox = this.boundingBox(handle);
    return { volume: props.volume, area: props.area, center: props.center, bboxMin: bbox.min, bboxMax: bbox.max };
  }

  mesh(handle: ShapeHandle, quality: MeshQuality, key: string): MeshPayload {
    const raw = check(this.kernel.mesh(this.id(handle), quality.linear, quality.angular) as RawMesh | Failure);
    const faceInfo: FaceInfo[] = Array.from(raw.faceKinds, (kind, i) => {
      const info: FaceInfo = { kind: SURFACE_KINDS[kind] ?? 'other', area: raw.faceAreas[i] ?? 0 };
      const radius = raw.faceRadii[i];
      if (radius !== undefined && !Number.isNaN(radius)) info.radius = radius;
      return info;
    });
    const edgeInfo: EdgeInfo[] = Array.from(raw.edgeKinds, (kind, i) => {
      const info: EdgeInfo = { kind: CURVE_KINDS[kind] ?? 'other', length: raw.edgeLengths[i] ?? 0 };
      const radius = raw.edgeRadii[i];
      if (radius !== undefined && !Number.isNaN(radius)) info.radius = radius;
      return info;
    });
    return {
      key,
      positions: raw.positions,
      normals: raw.normals,
      indices: raw.indices,
      faceRanges: raw.faceRanges,
      edgePositions: raw.edgePositions,
      edgeRanges: raw.edgeRanges,
      faceInfo,
      edgeInfo,
    };
  }

  exportMesh(handle: ShapeHandle, quality: MeshQuality) {
    const raw = check(this.kernel.exportMesh(this.id(handle), quality.linear, quality.angular) as RawMesh | Failure);
    return { positions: raw.positions, indices: raw.indices };
  }

  exportStep(handle: ShapeHandle): Uint8Array {
    return check(this.kernel.exportStep(this.id(handle)) as { ok: true; data: Uint8Array } | Failure).data;
  }

  importStep(bytes: Uint8Array): ShapeHandle {
    const result = this.kernel.importStep(bytes) as IdResult;
    if (!result.ok) throw new KernelCallError(result.message);
    return result.id as unknown as ShapeHandle;
  }

  heapBytes(): number {
    return this.kernel.wasmMemory.buffer.byteLength;
  }

  describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

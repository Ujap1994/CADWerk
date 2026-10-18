import type { Feature } from '../shared/model/feature.ts';
import type { GeometryBackend, ShapeHandle } from './backend.ts';
import { meshTransferables } from './mesh-transfer.ts';
import { displayQuality, exportQuality, qualityTag } from './mesh-quality.ts';
import type {
  CapturedState,
  ExportRequest,
  MassProperties,
  MemoryStats,
  RebuildRequest,
  RebuildResult,
} from './protocol.ts';
import { Rebuilder } from './rebuild.ts';
import { writeBinaryStl } from './stl.ts';

interface ShapeInfo {
  diagonal: number;
  faceCount: number;
  edgeCount: number;
  properties?: MassProperties;
}

/** Number of shape summaries kept; old entries are evicted first. */
const SHAPE_INFO_LIMIT = 64;

export class NothingToExportError extends Error {
  constructor() {
    super('There is no body to export.');
    this.name = 'NothingToExportError';
  }
}

function diagonalOf(bbox: { min: number[]; max: number[] }): number {
  const [x0 = 0, y0 = 0, z0 = 0] = bbox.min;
  const [x1 = 0, y1 = 0, z1 = 0] = bbox.max;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

export type BackendName = GeometryBackend['name'];

/**
 * Environment-independent geometry kernel: used by the Web Worker in the app
 * and directly by integration tests and benchmarks in Node. The geometric
 * operations come from a backend (docs/adr/0001-geometry-kernel.md).
 */
export class Kernel implements Disposable {
  readonly backend: GeometryBackend;
  private readonly rebuilder: Rebuilder;
  private readonly shapeInfo = new Map<string, ShapeInfo>();

  constructor(backend: GeometryBackend) {
    this.backend = backend;
    this.rebuilder = new Rebuilder(backend);
  }

  rebuild(request: RebuildRequest): { result: RebuildResult; transfer: ArrayBuffer[] } {
    const start = performance.now();
    const { results, rebuilt } = this.rebuilder.rebuild(request.features);
    const known = new Set(request.knownMeshKeys);
    const transfer: ArrayBuffer[] = [];
    let meshMs = 0;

    const last = request.features.length - 1;
    const indices = [...new Set(request.captures.map((index) => Math.max(-1, Math.min(last, index))))];
    const captures: CapturedState[] = indices.map((index) => {
      const shape = this.rebuilder.shapeAfter(index);
      if (!shape) return { index, meshKey: null, properties: null, faceCount: 0, edgeCount: 0 };

      const shapeKey = this.rebuilder.shapeKeyAfter(index);
      const info = this.infoFor(shapeKey, shape, request.withProperties);
      const quality = displayQuality(info.diagonal);
      const meshKey = `${shapeKey}@${qualityTag(quality)}`;
      const state: CapturedState = {
        index,
        meshKey,
        properties: request.withProperties ? (info.properties ?? null) : null,
        faceCount: info.faceCount,
        edgeCount: info.edgeCount,
      };
      if (!known.has(meshKey)) {
        const meshStart = performance.now();
        state.mesh = this.backend.mesh(shape, quality, meshKey);
        meshMs += performance.now() - meshStart;
        transfer.push(...meshTransferables(state.mesh));
      }
      return state;
    });

    return {
      result: {
        features: results,
        captures,
        timings: { totalMs: performance.now() - start, rebuiltFeatures: rebuilt, meshMs },
      },
      transfer,
    };
  }

  exportModel(request: ExportRequest): Uint8Array {
    this.rebuilder.rebuild(request.features);
    const shape = this.rebuilder.shapeAfter(request.features.length - 1);
    if (!shape) throw new NothingToExportError();
    if (request.format === 'step') return this.backend.exportStep(shape);
    const mesh = this.backend.exportMesh(shape, exportQuality(diagonalOf(this.backend.boundingBox(shape))));
    return writeBinaryStl(mesh.positions, mesh.indices);
  }

  /**
   * Runs representative operations once so WebAssembly compiles their code paths
   * before the user needs them.
   */
  warmUp(): number {
    const start = performance.now();
    const features: Feature[] = [
      { id: 'warm-box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      { id: 'warm-hole', type: 'cylinder', operation: 'cut', radius: 8, height: 100, axis: 'z', position: [0, 0, -10] },
      { id: 'warm-fillet', type: 'fillet', radius: 4, edges: [{ kind: 'edge-index', index: 0 }] },
      { id: 'warm-chamfer', type: 'chamfer', distance: 2, edges: [{ kind: 'edge-index', index: 1 }] },
    ];
    using rebuilder = new Rebuilder(this.backend);
    rebuilder.rebuild(features);
    const shape = rebuilder.shapeAfter(features.length - 1);
    if (shape) {
      this.backend.mesh(shape, displayQuality(200), 'warm');
      this.backend.massProperties(shape);
    }
    return performance.now() - start;
  }

  memoryStats(): MemoryStats {
    return { wasmHeapBytes: this.backend.heapBytes(), cachedShapes: this.rebuilder.cachedShapes };
  }

  private infoFor(shapeKey: string, shape: ShapeHandle, withProperties: boolean): ShapeInfo {
    let info = this.shapeInfo.get(shapeKey);
    if (!info) {
      const counts = this.backend.counts(shape);
      info = { diagonal: diagonalOf(this.backend.boundingBox(shape)), faceCount: counts.faces, edgeCount: counts.edges };
      this.shapeInfo.set(shapeKey, info);
      if (this.shapeInfo.size > SHAPE_INFO_LIMIT) {
        const oldest = this.shapeInfo.keys().next().value;
        if (oldest !== undefined) this.shapeInfo.delete(oldest);
      }
    }
    if (withProperties && !info.properties) info.properties = this.backend.massProperties(shape);
    return info;
  }

  [Symbol.dispose](): void {
    this.rebuilder[Symbol.dispose]();
    this.shapeInfo.clear();
  }
}

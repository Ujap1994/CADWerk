import type { Feature } from '../shared/model/feature.ts';
import { displayQuality, exportQuality, extractMesh, meshTransferables, qualityTag } from './mesh.ts';
import { Arena, loadOpenCascade, type OC, type TopoDS_Shape } from './occt.ts';
import { boundingBox, diagonalOf, massProperties } from './properties.ts';
import type {
  CapturedState,
  ExportRequest,
  MassProperties,
  MemoryStats,
  RebuildRequest,
  RebuildResult,
} from './protocol.ts';
import { Rebuilder } from './rebuild.ts';
import { exportStep } from './step.ts';
import { writeBinaryStl } from './stl.ts';
import { countSubShapes } from './topology.ts';

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

/**
 * Environment-independent geometry kernel: used by the Web Worker in the app
 * and directly by integration tests and benchmarks in Node.
 */
export class Kernel implements Disposable {
  readonly oc: OC;
  private readonly rebuilder: Rebuilder;
  private readonly shapeInfo = new Map<string, ShapeInfo>();

  private constructor(oc: OC) {
    this.oc = oc;
    this.rebuilder = new Rebuilder(oc);
  }

  static async create(wasmUrl?: string): Promise<Kernel> {
    return new Kernel(await loadOpenCascade(wasmUrl));
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
        state.mesh = extractMesh(this.oc, shape, quality, meshKey);
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
    if (request.format === 'step') return exportStep(this.oc, shape);

    const diagonal = diagonalOf(boundingBox(this.oc, shape));
    const mesh = extractMesh(this.oc, shape, exportQuality(diagonal), 'export');
    // Drop the fine triangulation again so the 3D view keeps its lighter display mesh.
    this.oc.BRepTools.Clean(shape, true);
    return writeBinaryStl(mesh.positions, mesh.indices);
  }

  /**
   * Runs representative operations once so WebAssembly compiles their code paths
   * before the user needs them (the first fillet otherwise takes about a second).
   */
  warmUp(): number {
    const start = performance.now();
    const box: Feature = { id: 'warm-box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    const hole: Feature = { id: 'warm-hole', type: 'cylinder', operation: 'cut', radius: 8, height: 100, axis: 'z', position: [0, 0, -10] };
    const fillet: Feature = { id: 'warm-fillet', type: 'fillet', radius: 4, edges: [{ kind: 'edge-index', index: 0 }] };
    const chamfer: Feature = { id: 'warm-chamfer', type: 'chamfer', distance: 2, edges: [{ kind: 'edge-index', index: 1 }] };
    using rebuilder = new Rebuilder(this.oc);
    rebuilder.rebuild([box, hole, fillet, chamfer]);
    const shape = rebuilder.shapeAfter(3);
    if (shape) {
      extractMesh(this.oc, shape, displayQuality(200), 'warm');
      massProperties(this.oc, shape);
    }
    return performance.now() - start;
  }

  memoryStats(): MemoryStats {
    return { wasmHeapBytes: this.oc.wasmMemory.buffer.byteLength, cachedShapes: this.rebuilder.cachedShapes };
  }

  private infoFor(shapeKey: string, shape: TopoDS_Shape, withProperties: boolean): ShapeInfo {
    let info = this.shapeInfo.get(shapeKey);
    if (!info) {
      using arena = new Arena();
      info = {
        diagonal: diagonalOf(boundingBox(this.oc, shape)),
        faceCount: countSubShapes(this.oc, arena, shape, 'face'),
        edgeCount: countSubShapes(this.oc, arena, shape, 'edge'),
      };
      this.shapeInfo.set(shapeKey, info);
      if (this.shapeInfo.size > SHAPE_INFO_LIMIT) {
        const oldest = this.shapeInfo.keys().next().value;
        if (oldest !== undefined) this.shapeInfo.delete(oldest);
      }
    }
    if (withProperties && !info.properties) info.properties = massProperties(this.oc, shape);
    return info;
  }

  [Symbol.dispose](): void {
    this.rebuilder[Symbol.dispose]();
    this.shapeInfo.clear();
  }
}

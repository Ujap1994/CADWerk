import type { OC, TopoDS_Shape } from './occt.ts';
import type { MeshPayload } from './protocol.ts';

export interface MeshQuality {
  /** Maximum chordal deviation in mm. */
  linear: number;
  /** Maximum angle between neighboring facets in radians. */
  angular: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tessellation for the 3D view, relative to the part size so small and large parts look equally smooth. */
export function displayQuality(diagonal: number): MeshQuality {
  return { linear: clamp(diagonal * 5e-4, 0.002, 2), angular: 0.3 };
}

/** Finer tessellation for STL export. */
export function exportQuality(diagonal: number): MeshQuality {
  return { linear: clamp(diagonal * 1e-4, 0.001, 0.1), angular: 0.15 };
}

export function qualityTag(quality: MeshQuality): string {
  return `${quality.linear.toPrecision(3)}/${quality.angular}`;
}

/** Converts [start, count, hash] triples from the extractor into [start, count] pairs. */
function triplesToRanges(triples: Int32Array): Uint32Array {
  const ranges = new Uint32Array((triples.length / 3) * 2);
  for (let i = 0, j = 0; i < triples.length; i += 3, j += 2) {
    ranges[j] = triples[i] as number;
    ranges[j + 1] = triples[i + 1] as number;
  }
  return ranges;
}

/**
 * Tessellates a shape and copies the result out of WebAssembly memory.
 *
 * Triangulation and edge discretization run in C++ in one call each, which is
 * far faster than walking the triangulation through the bindings.
 */
export function extractMesh(oc: OC, shape: TopoDS_Shape, quality: MeshQuality, key: string): MeshPayload {
  const faces = oc.ReplicadMeshExtractor.extract(shape, quality.linear, quality.angular, false);
  let positions: Float32Array;
  let normals: Float32Array;
  let indices: Uint32Array;
  let faceRanges: Uint32Array;
  try {
    // Read the buffer only after the call: WebAssembly memory may have grown and been replaced.
    const memory = oc.wasmMemory.buffer;
    positions = new Float32Array(memory, faces.getVerticesPtr(), faces.getVerticesSize()).slice();
    normals = new Float32Array(memory, faces.getNormalsPtr(), faces.getNormalsSize()).slice();
    indices = new Uint32Array(memory, faces.getTrianglesPtr(), faces.getTrianglesSize()).slice();
    faceRanges = triplesToRanges(new Int32Array(memory, faces.getFaceGroupsPtr(), faces.getFaceGroupsSize()));
  } finally {
    faces.delete();
  }

  const edges = oc.ReplicadEdgeMeshExtractor.extract(shape, quality.linear, quality.angular);
  let edgePositions: Float32Array;
  let edgeRanges: Uint32Array;
  try {
    const memory = oc.wasmMemory.buffer;
    edgePositions = new Float32Array(memory, edges.getLinesPtr(), edges.getLinesSize()).slice();
    edgeRanges = triplesToRanges(new Int32Array(memory, edges.getEdgeGroupsPtr(), edges.getEdgeGroupsSize()));
  } finally {
    edges.delete();
  }

  return { key, positions, normals, indices, faceRanges, edgePositions, edgeRanges };
}

export function meshTransferables(mesh: MeshPayload): ArrayBuffer[] {
  return [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePositions, mesh.edgeRanges].map(
    (array) => array.buffer as ArrayBuffer,
  );
}

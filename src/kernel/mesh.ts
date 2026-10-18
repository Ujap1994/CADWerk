import { Arena, type OC, type TopoDS_Shape } from './occt.ts';
import type { MeshPayload } from './protocol.ts';
import { uniqueSubShapes } from './topology.ts';

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
export function extractMesh(oc: OC, shape: TopoDS_Shape, quality: MeshQuality, key: string, { withEdges = true } = {}): MeshPayload {
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

  if (!withEdges) {
    return { key, positions, normals, indices, faceRanges, edgePositions: new Float32Array(0), edgeRanges: new Uint32Array(0) };
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

  const hidden = hiddenEdges(oc, shape);
  if (hidden.size > 0) ({ edgePositions, edgeRanges } = withoutEdges(edgePositions, edgeRanges, hidden));

  return { key, positions, normals, indices, faceRanges, edgePositions, edgeRanges };
}

/**
 * Edges that should not be drawn: seams (where a closed surface such as a
 * cylinder meets itself) and degenerated edges (sphere poles). They are not
 * real boundaries, so showing them only adds noise.
 */
export function hiddenEdges(oc: OC, shape: TopoDS_Shape): Set<number> {
  using arena = new Arena();
  const edges = uniqueSubShapes(oc, arena, shape, 'edge');
  const indexOf = (edge: TopoDS_Shape) => edges.findIndex((candidate) => candidate.IsSame(edge));
  const hidden = new Set<number>();
  edges.forEach((edge, index) => {
    if (oc.BRep_Tool.Degenerated(arena.track(oc.TopoDS.Edge(edge)))) hidden.add(index);
  });
  for (const face of uniqueSubShapes(oc, arena, shape, 'face')) {
    const typedFace = arena.track(oc.TopoDS.Face(face));
    for (const edge of uniqueSubShapes(oc, arena, face, 'edge')) {
      if (oc.BRep_Tool.IsClosed(arena.track(oc.TopoDS.Edge(edge)), typedFace)) {
        const index = indexOf(edge);
        if (index >= 0) hidden.add(index);
      }
    }
  }
  return hidden;
}

/** Removes the segments of hidden edges; their ranges keep their index but get a count of 0. */
function withoutEdges(positions: Float32Array, ranges: Uint32Array, hidden: Set<number>) {
  const kept: number[] = [];
  const nextRanges = new Uint32Array(ranges.length);
  let cursor = 0;
  for (let edge = 0; edge < ranges.length / 2; edge++) {
    const start = ranges[edge * 2] as number;
    const count = ranges[edge * 2 + 1] as number;
    nextRanges[edge * 2] = cursor;
    if (hidden.has(edge)) {
      nextRanges[edge * 2 + 1] = 0;
      continue;
    }
    for (let i = start * 3; i < (start + count) * 3; i++) kept.push(positions[i] as number);
    nextRanges[edge * 2 + 1] = count;
    cursor += count;
  }
  return { edgePositions: new Float32Array(kept), edgeRanges: nextRanges };
}

export function meshTransferables(mesh: MeshPayload): ArrayBuffer[] {
  return [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePositions, mesh.edgeRanges].map(
    (array) => array.buffer as ArrayBuffer,
  );
}

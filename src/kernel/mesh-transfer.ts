import type { MeshPayload } from './protocol.ts';

export function meshTransferables(mesh: MeshPayload): ArrayBuffer[] {
  return [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePositions, mesh.edgeRanges].map(
    (array) => array.buffer as ArrayBuffer,
  );
}

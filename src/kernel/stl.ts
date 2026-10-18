/**
 * Writes a binary STL file from an indexed triangle mesh.
 *
 * Layout: 80-byte header, uint32 triangle count, then per triangle a normal,
 * three vertices (float32 little-endian) and a uint16 attribute.
 */
export function writeBinaryStl(positions: Float32Array, indices: Uint32Array, header = 'ParaWerk binary STL'): Uint8Array {
  const triangleCount = Math.floor(indices.length / 3);
  const bytes = new Uint8Array(84 + triangleCount * 50);
  const view = new DataView(bytes.buffer);

  const headerBytes = new TextEncoder().encode(header.slice(0, 80));
  bytes.set(headerBytes, 0);
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const a = (indices[t * 3] as number) * 3;
    const b = (indices[t * 3 + 1] as number) * 3;
    const c = (indices[t * 3 + 2] as number) * 3;
    const ax = positions[a] as number, ay = positions[a + 1] as number, az = positions[a + 2] as number;
    const bx = positions[b] as number, by = positions[b + 1] as number, bz = positions[b + 2] as number;
    const cx = positions[c] as number, cy = positions[c + 1] as number, cz = positions[c + 2] as number;

    // Facet normal from the winding order (right-hand rule).
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    const values = [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz];
    for (const value of values) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return bytes;
}

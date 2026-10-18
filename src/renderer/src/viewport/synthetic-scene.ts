import type {
  BufferGeometry} from 'three';
import {
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  Quaternion,
  Shape,
  Sphere,
  TorusKnotGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Synthetic assemblies for render benchmarks: a mix of part types with
 * triangle counts similar to tessellated CAD parts (plates with holes, bolts,
 * nuts, brackets, shafts and a dense freeform part).
 */

export interface SyntheticAssembly {
  group: Group;
  components: number;
  triangles: number;
  drawCalls: number;
  bounds: Sphere;
  dispose(): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(width: number, height: number, radius: number): Shape {
  const shape = new Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.absarc(w - radius, -h + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(w, h - radius);
  shape.absarc(w - radius, h - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-w + radius, h);
  shape.absarc(-w + radius, h - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, -h + radius);
  shape.absarc(-w + radius, -h + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function circleHole(x: number, y: number, r: number): Path {
  const path = new Path();
  path.absarc(x, y, r, 0, Math.PI * 2, true);
  return path;
}

function partGeometries(): { name: string; geometry: BufferGeometry; color: number }[] {
  const plate = roundedRect(60, 40, 5);
  for (const [x, y] of [[-22, -12], [22, -12], [-22, 12], [22, 12]] as const) plate.holes.push(circleHole(x, y, 3.3));
  plate.holes.push(circleHole(0, 0, 9));
  const plateGeometry = new ExtrudeGeometry(plate, { depth: 6, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2, curveSegments: 24 });

  const head = new CylinderGeometry(6.5, 6.5, 5.3, 6);
  head.translate(0, 15 + 2.65, 0);
  const shank = new CylinderGeometry(4, 4, 30, 40, 6);
  const boltGeometry = mergeGeometries([head.toNonIndexed(), shank.toNonIndexed()]) ?? shank;

  const nut = new Shape();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const point = new Vector2(Math.cos(angle) * 7.5, Math.sin(angle) * 7.5);
    if (i === 0) nut.moveTo(point.x, point.y);
    else nut.lineTo(point.x, point.y);
  }
  nut.holes.push(circleHole(0, 0, 4));
  const nutGeometry = new ExtrudeGeometry(nut, { depth: 6.5, bevelEnabled: true, bevelSize: 0.4, bevelThickness: 0.4, bevelSegments: 2, curveSegments: 32 });

  const bracket = new Shape();
  bracket.moveTo(0, 0);
  bracket.lineTo(50, 0);
  bracket.lineTo(50, 6);
  bracket.lineTo(12, 6);
  bracket.absarc(12, 12, 6, -Math.PI / 2, Math.PI, true);
  bracket.lineTo(6, 45);
  bracket.lineTo(0, 45);
  bracket.lineTo(0, 0);
  const bracketGeometry = new ExtrudeGeometry(bracket, { depth: 30, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 3, curveSegments: 32 });

  const profile = [
    [0, 0], [8, 0], [8, 18], [10, 18], [10, 40], [7, 40], [7, 60], [5, 60], [5, 72], [0, 72],
  ].map(([x, y]) => new Vector2(x, y));
  const shaftGeometry = new LatheGeometry(profile, 64);

  const freeform = new TorusKnotGeometry(12, 3.5, 240, 24);

  return [
    { name: 'plate', geometry: plateGeometry, color: 0xb7c4d6 },
    { name: 'bolt', geometry: boltGeometry, color: 0x8d98a8 },
    { name: 'nut', geometry: nutGeometry, color: 0x9aa5b4 },
    { name: 'bracket', geometry: bracketGeometry, color: 0xc9b38f },
    { name: 'shaft', geometry: shaftGeometry, color: 0xa8b8a0 },
    { name: 'freeform', geometry: freeform, color: 0xc6a3a3 },
  ];
}

function triangleCount(geometry: BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
}

/** Relative frequency of each part type (fasteners dominate real assemblies). */
const MIX = [0.18, 0.32, 0.25, 0.1, 0.1, 0.05];

export function createSyntheticAssembly(components: number, instanced: boolean, seed = 1): SyntheticAssembly {
  const random = mulberry32(seed);
  const types = partGeometries();
  const materials = types.map((type) => new MeshStandardMaterial({ color: type.color, metalness: 0.15, roughness: 0.55 }));
  const group = new Group();

  const side = Math.ceil(Math.cbrt(components));
  const spacing = 90;
  const assignments: number[] = [];
  for (let i = 0; i < components; i++) {
    let r = random();
    let type = 0;
    while (type < MIX.length - 1 && r > (MIX[type] as number)) {
      r -= MIX[type] as number;
      type++;
    }
    assignments.push(type);
  }

  const matrices: Matrix4[] = [];
  for (let i = 0; i < components; i++) {
    const x = (i % side) - side / 2;
    const y = (Math.floor(i / side) % side) - side / 2;
    const z = Math.floor(i / (side * side));
    const position = new Vector3(x * spacing, y * spacing, z * spacing);
    const rotation = new Quaternion().setFromEuler(new Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
    matrices.push(new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)));
  }

  let triangles = 0;
  let drawCalls = 0;
  types.forEach((type, typeIndex) => {
    const indices = assignments.flatMap((assigned, i) => (assigned === typeIndex ? [i] : []));
    if (indices.length === 0) return;
    triangles += triangleCount(type.geometry) * indices.length;
    const material = materials[typeIndex] as MeshStandardMaterial;
    if (instanced) {
      const mesh = new InstancedMesh(type.geometry, material, indices.length);
      indices.forEach((componentIndex, i) => mesh.setMatrixAt(i, matrices[componentIndex] as Matrix4));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      drawCalls += 1;
    } else {
      for (const componentIndex of indices) {
        const mesh = new Mesh(type.geometry, material);
        mesh.applyMatrix4(matrices[componentIndex] as Matrix4);
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
      drawCalls += indices.length;
    }
  });

  const extent = (side * spacing) / 2;
  const height = Math.ceil(components / (side * side)) * spacing;
  const bounds = new Sphere(new Vector3(-spacing / 2, -spacing / 2, height / 2 - spacing / 2), Math.hypot(extent, extent, height / 2) + spacing);

  return {
    group,
    components,
    triangles,
    drawCalls,
    bounds,
    dispose() {
      types.forEach((type) => type.geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}

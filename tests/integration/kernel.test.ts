import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '../../src/kernel/kernel.ts';
import { importStep } from '../../src/kernel/step.ts';
import { massProperties } from '../../src/kernel/properties.ts';
import type { RebuildRequest } from '../../src/kernel/protocol.ts';
import type { BoxFeature, CylinderFeature, Feature, FilletFeature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await Kernel.create();
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const allEdges = Array.from({ length: 12 }, (_, index) => ({ kind: 'edge-index' as const, index }));

function request(features: Feature[], overrides: Partial<RebuildRequest> = {}): RebuildRequest {
  return { features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true, ...overrides };
}

function finalState(features: Feature[], overrides: Partial<RebuildRequest> = {}) {
  const { result } = kernel.rebuild(request(features, overrides));
  const state = result.captures[0];
  if (!state) throw new Error('no capture');
  return { result, state };
}

/** Volume of a box whose 12 edges are rounded with radius r (including the spherical corners). */
function roundedBoxVolume(a: number, b: number, c: number, r: number): number {
  const [x, y, z] = [a - 2 * r, b - 2 * r, c - 2 * r];
  return x * y * z + 2 * r * (x * y + x * z + y * z) + Math.PI * r * r * (x + y + z) + (4 / 3) * Math.PI * r ** 3;
}

describe('geometry', () => {
  it('builds a box with exact volume, area and topology', () => {
    const { state } = finalState([box]);
    expect(state.properties?.volume).toBeCloseTo(240_000, 6);
    expect(state.properties?.area).toBeCloseTo(24_800, 6);
    expect(state.properties?.center).toEqual([0, 0, 20].map((v) => expect.closeTo(v, 9)));
    expect(state.faceCount).toBe(6);
    expect(state.edgeCount).toBe(12);
    expect(state.mesh?.faceRanges.length).toBe(12);
    expect(state.mesh?.edgeRanges.length).toBe(24);
  });

  it('rounds all edges of a box to the analytic volume', () => {
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
    const { state } = finalState([box, fillet]);
    expect(state.properties?.volume).toBeCloseTo(roundedBoxVolume(100, 60, 40, 5), 2);
    expect(state.faceCount).toBe(26);
  });

  it('cuts and adds cylinders', () => {
    const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 10, height: 60, axis: 'z', position: [0, 0, -10] };
    const boss: CylinderFeature = { id: 'boss', type: 'cylinder', operation: 'add', radius: 10, height: 20, axis: 'z', position: [30, 0, 40] };
    const cut = finalState([box, hole]).state;
    expect(cut.properties?.volume).toBeCloseTo(240_000 - Math.PI * 100 * 40, 4);
    const both = finalState([box, hole, boss]).state;
    expect(both.properties?.volume).toBeCloseTo(240_000 - Math.PI * 100 * 40 + Math.PI * 100 * 20, 4);
  });

  it('chamfers edges', () => {
    const chamfer: Feature = { id: 'chamfer', type: 'chamfer', distance: 2, edges: [{ kind: 'edge-index', index: 0 }] };
    const { state, result } = finalState([box, chamfer]);
    expect(result.features[1]?.status).toBe('ok');
    // A 45° chamfer removes a triangular prism along the edge.
    const edgeLength = [100, 60, 40].find((length) => Math.abs(state.properties!.volume - (240_000 - 2 * length)) < 1e-6);
    expect(edgeLength).toBeDefined();
  });
});

describe('incremental rebuild', () => {
  it('reuses cached features and recomputes from the first change', () => {
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
    kernel.rebuild(request([box, fillet]));
    const again = kernel.rebuild(request([box, fillet])).result;
    expect(again.timings.rebuiltFeatures).toBe(0);
    expect(again.features.every((f) => f.cached)).toBe(true);

    const changed = kernel.rebuild(request([box, { ...fillet, radius: 4 }])).result;
    expect(changed.timings.rebuiltFeatures).toBe(1);
    expect(changed.features[0]?.cached).toBe(true);
  });

  it('does not rebuild when only a name changes', () => {
    kernel.rebuild(request([box]));
    const renamed = kernel.rebuild(request([{ ...box, name: 'Base plate' }])).result;
    expect(renamed.timings.rebuiltFeatures).toBe(0);
  });

  it('skips mesh payloads the client already has', () => {
    const first = finalState([box]).state;
    expect(first.mesh).toBeDefined();
    const second = finalState([box], { knownMeshKeys: [first.meshKey!] }).state;
    expect(second.mesh).toBeUndefined();
    expect(second.meshKey).toBe(first.meshKey);
  });

  it('passes the body through suppressed features', () => {
    const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 10, height: 60, axis: 'z', position: [0, 0, -10], suppressed: true };
    const { state, result } = finalState([box, hole]);
    expect(result.features[1]?.status).toBe('suppressed');
    expect(state.properties?.volume).toBeCloseTo(240_000, 6);
  });

  it('captures intermediate states', () => {
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
    const { result } = kernel.rebuild(request([box, fillet], { captures: [-1, 0, 1] }));
    expect(result.captures.map((c) => c.index)).toEqual([-1, 0, 1]);
    expect(result.captures[0]?.meshKey).toBeNull();
    expect(result.captures[1]?.faceCount).toBe(6);
    expect(result.captures[2]?.faceCount).toBe(26);
  });
});

describe('feature errors never crash the rebuild', () => {
  it('reports a cut as first feature', () => {
    const { result, state } = finalState([{ ...box, operation: 'cut' }]);
    expect(result.features[0]?.error?.code).toBe('first-must-add');
    expect(state.meshKey).toBeNull();
  });

  it('reports missing and invalid edge selections', () => {
    const noEdges = finalState([box, { id: 'f', type: 'fillet', radius: 2, edges: [] }]).result;
    expect(noEdges.features[1]?.error?.code).toBe('no-edges');
    const missing = finalState([box, { id: 'f', type: 'fillet', radius: 2, edges: [{ kind: 'edge-index', index: 99 }] }]).result;
    expect(missing.features[1]?.error?.code).toBe('edge-missing');
  });

  it('keeps the previous body when a fillet is too large', () => {
    const { result, state } = finalState([box, { id: 'f', type: 'fillet', radius: 50, edges: allEdges }]);
    expect(result.features[1]?.status).toBe('error');
    expect(result.features[1]?.error?.code).toBe('operation-failed');
    expect(state.properties?.volume).toBeCloseTo(240_000, 6);
  });

  it('reports a cut that removes everything', () => {
    const big: BoxFeature = { ...box, id: 'big', operation: 'cut', width: 200, depth: 200, height: 200, position: [0, 0, -50] };
    const { result } = finalState([box, big]);
    expect(result.features[1]?.error?.code).toBe('empty-result');
  });
});

describe('export', () => {
  const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };

  it('writes STEP that reads back with the same volume', () => {
    const bytes = kernel.exportModel({ features: [box, fillet], format: 'step' });
    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');
    const shape = importStep(kernel.oc, bytes);
    try {
      expect(massProperties(kernel.oc, shape).volume).toBeCloseTo(roundedBoxVolume(100, 60, 40, 5), 1);
    } finally {
      shape.delete();
    }
  });

  it('writes a consistent binary STL', () => {
    const bytes = kernel.exportModel({ features: [box, fillet], format: 'stl' });
    const triangles = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
    expect(triangles).toBeGreaterThan(1000);
    expect(bytes.length).toBe(84 + 50 * triangles);
  });

  it('refuses to export an empty document', () => {
    expect(() => kernel.exportModel({ features: [], format: 'step' })).toThrow();
  });
});

describe('memory', () => {
  // WebAssembly memory never shrinks, so steady growth over many rebuilds means a leak.
  // Growth happens in large steps; the budget allows one step but not a trend.
  const budget = 8 * 1024 * 1024;

  function growth(runs: number, features: (i: number) => Feature[]): number {
    for (let i = 0; i < 20; i++) kernel.rebuild(request(features(i)));
    const before = kernel.memoryStats().wasmHeapBytes;
    for (let i = 0; i < runs; i++) kernel.rebuild(request(features(i)));
    return kernel.memoryStats().wasmHeapBytes - before;
  }

  it('does not leak in boolean operations', () => {
    const hole = (i: number): CylinderFeature => ({ id: 'hole', type: 'cylinder', operation: 'cut', radius: 5 + (i % 7), height: 60, axis: 'z', position: [20, 0, -10] });
    expect(growth(300, (i) => [box, hole(i)])).toBeLessThanOrEqual(budget);
  });

  it('does not leak in fillets, meshing and mass properties', () => {
    const fillet = (i: number): FilletFeature => ({ id: 'fillet', type: 'fillet', radius: 2 + (i % 5) * 0.5, edges: allEdges });
    expect(growth(150, (i) => [box, fillet(i)])).toBeLessThanOrEqual(budget);
  });
});

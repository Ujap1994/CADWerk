/**
 * Geometry kernel benchmarks (Node, OCCT WebAssembly).
 * Run: npm run bench:kernel   Results: bench/results/kernel-<platform>-<arch>.json
 */
import { Kernel } from '../../src/kernel/kernel.ts';
import { displayQuality, extractMesh } from '../../src/kernel/mesh.ts';
import { massProperties } from '../../src/kernel/properties.ts';
import type { RebuildRequest } from '../../src/kernel/protocol.ts';
import type { Feature } from '../../src/shared/model/feature.ts';
import type { TopoDS_Shape } from '../../src/kernel/occt.ts';
import { calibration, measure, meta, printReport, summarize, writeReport, type BenchReport, type CaseResult } from '../lib.ts';

const cases: Record<string, CaseResult> = {};
cases['calibration'] = calibration();

const initStart = performance.now();
const kernel = await Kernel.create();
cases['kernel.init'] = summarize([performance.now() - initStart]);
cases['kernel.warmUp'] = summarize([kernel.warmUp()]);

const request = (features: Feature[], withProperties = false): RebuildRequest => ({
  features,
  captures: [features.length - 1],
  knownMeshKeys: [],
  withProperties,
});

const box = (width: number): Feature => ({ id: 'base', type: 'box', operation: 'add', width, depth: 60, height: 40, position: [0, 0, 0] });

/** A plate with a grid of `holes` drilled holes, one feature per hole. */
function plate(holes: number, width = 400): Feature[] {
  const side = Math.ceil(Math.sqrt(holes));
  const pitch = 360 / side;
  const features: Feature[] = [{ id: 'plate', type: 'box', operation: 'add', width, depth: 400, height: 12, position: [0, 0, 0] }];
  for (let i = 0; i < holes; i++) {
    features.push({
      id: `hole${i}`,
      type: 'cylinder',
      operation: 'cut',
      radius: 4,
      height: 20,
      axis: 'z',
      position: [-180 + pitch / 2 + (i % side) * pitch, -180 + pitch / 2 + Math.floor(i / side) * pitch, -4],
    });
  }
  return features;
}

cases['box.rebuild'] = measure((i) => kernel.rebuild(request([box(100 + i)])), { iterations: 30 });

const allEdges = Array.from({ length: 12 }, (_, index) => ({ kind: 'edge-index' as const, index }));
cases['fillet.12edges.rebuild'] = measure(
  (i) => kernel.rebuild(request([box(100), { id: 'f', type: 'fillet', radius: 3 + (i % 5) * 0.25, edges: allEdges }])),
  { iterations: 20 },
);

for (const holes of [10, 50, 100]) {
  const features = plate(holes);
  cases[`plate.${holes}holes.fullRebuild`] = {
    ...measure((i) => kernel.rebuild(request(plate(holes, 400 + (i + 3) * 0.01))), { iterations: holes >= 100 ? 3 : 5, warmup: 1 }),
    info: { features: features.length },
  };
}

// Editing the last feature of a 101-feature part must only rebuild that feature.
const big = plate(100);
kernel.rebuild(request(big));
cases['plate.100holes.editLast'] = measure((i) => {
  const edited = [...big];
  const last = big[big.length - 1] as Extract<Feature, { type: 'cylinder' }>;
  edited[edited.length - 1] = { ...last, radius: 3 + (i % 5) * 0.2 };
  kernel.rebuild(request(edited));
}, { iterations: 10 });

kernel.rebuild(request(big));
const shape = (kernel as unknown as { rebuilder: { shapeAfter(i: number): TopoDS_Shape | null } }).rebuilder.shapeAfter(big.length - 1);
if (shape) {
  let triangles = 0;
  cases['plate.100holes.mesh'] = measure(() => {
    const mesh = extractMesh(kernel.oc, shape, displayQuality(560), 'bench');
    triangles = mesh.indices.length / 3;
  }, { iterations: 10 });
  cases['plate.100holes.mesh'].info = { triangles };
  cases['plate.100holes.massProperties'] = measure(() => massProperties(kernel.oc, shape), { iterations: 10 });
}
cases['plate.100holes.exportStep'] = measure(() => kernel.exportModel({ features: big, format: 'step' }), { iterations: 5, warmup: 1 });
cases['plate.100holes.exportStl'] = measure(() => kernel.exportModel({ features: big, format: 'stl' }), { iterations: 5, warmup: 1 });
cases['memory.wasmHeapMb'] = { ...summarize([0]), info: { mb: Math.round(kernel.memoryStats().wasmHeapBytes / 1048576) } };

const report: BenchReport = { suite: 'kernel', meta: meta(), cases };
printReport(report);
console.log(`Results written to ${writeReport(report)}`);

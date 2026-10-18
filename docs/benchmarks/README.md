# Performance benchmarks

ParaWerk measures performance from the first commit. Every phase raises the **scale ladder**
([roadmap, section 6](../../ROADMAP.md#6-performance-and-scale-testing)); earlier rungs stay in the
suite as regression tests.

## How to run

```bash
npm run bench:kernel   # geometry kernel (Node, OCCT WebAssembly)
npm run bench:solver   # 2D constraint solver candidate (PlaneGCS)
npm run build && npm run bench:render   # 3D view: orbiting synthetic assemblies (uses your GPU)
npm run bench:compare  # compare bench/results with bench/baselines
```

Results are written to `bench/results/<suite>-<platform>-<arch>.json`. In CI the suites run on Windows,
macOS and Linux for every push; large slowdowns against the stored baselines fail the build. CI runners
have no GPU, so render numbers from CI are only compared relative to each other.

## Reference results – Phase 0 (Apple M3, 16 GB, macOS)

### Geometry kernel

| Case | Median |
|---|---|
| Kernel start (load WebAssembly) | 128 ms |
| Background warm-up | 310 ms |
| Box rebuild | 0.9 ms |
| Fillet of all 12 box edges | 32 ms |
| Plate with 10 holes, full rebuild (11 features) | 94 ms |
| Plate with 50 holes, full rebuild (51 features) | 774 ms |
| Plate with 100 holes, full rebuild (101 features) | 2,264 ms |
| Plate with 100 holes, edit last feature | 463 ms |
| Tessellation of the 100-hole plate (17,212 triangles) | 422 ms |
| Mass properties of the 100-hole plate | 38 ms |
| STEP export of the 100-hole plate | 45 ms |
| STL export of the 100-hole plate (fine tessellation) | 1,410 ms |

### 2D constraint solver (PlaneGCS, one connected sketch)

| Constraints | Median |
|---|---|
| 55 | < 1 ms |
| 251 | 7.5 ms |
| 503 | 44 ms |
| ≈ 1,000 | out of memory (see [ADR 0005](../adr/0005-sketch-solver.md)) |

### 3D view (1600 × 1000 window, Retina, GPU-synchronized frame times)

| Synthetic assembly | Triangles | Draw calls | Frames per second |
|---|---|---|---|
| 10 components, instanced | 44,336 | 45 | 178 |
| 100 components, instanced | 248,188 | 47 | 130 |
| 1,000 components, instanced | 2,258,212 | 47 | 118 |
| 10,000 components, instanced | 21,536,672 | 47 | 32 |
| 50,000 components, instanced | 107,424,080 | 47 | 8 |
| 100 components, individual meshes | 248,188 | 141 | 155 |
| 1,000 components, individual meshes | 2,258,212 | 1,041 | 78 |
| 5,000 components, individual meshes | 10,667,348 | 5,041 | 30 |

Draw calls include the view cube and the axis indicator (about 41).

## What the numbers tell us

- Small and medium parts rebuild well within interactive limits; the incremental cache makes edits
  independent of the number of features before the edited one.
- Tessellation of large faces with many holes is the slowest step today. The prebuilt kernel
  re-triangulates the whole body on every change; the planned custom kernel build keeps the
  triangulation of unchanged faces and meshes in parallel ([ADR 0001](../adr/0001-geometry-kernel.md)).
- Instancing keeps assemblies with thousands of identical parts fast. Beyond about 10,000 components,
  level of detail and culling are needed to reach the v1.0 target of 30 fps for 50,000 instances.
- The sketch solver needs decomposition or a sparse solver before Phase 1 can reach its targets.

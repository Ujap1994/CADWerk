# 0005 – 2D constraint solver

**Status:** open; decided at the start of Phase 1.

## Context

The sketcher needs a geometric constraint solver with interactive performance (dragging at 60 fps),
degree-of-freedom analysis (under-, fully, over-defined) and conflict diagnosis.

## Phase 0 evaluation: PlaneGCS (FreeCAD's solver) compiled to WebAssembly

Package `@salusoft89/planegcs` (LGPL-2.0-or-later). Benchmark: chains of fully dimensioned rectangles,
all constraints in one connected system (Apple M3):

| Constraints | Solve time (median) |
|---|---|
| 55 | < 1 ms |
| 251 | 7.5 ms |
| 503 | 44 ms |
| ≈ 1,000 | aborts: out of memory |

PlaneGCS solves one dense system (QR decomposition), so time grows roughly with the cube of the size
and the WebAssembly build runs out of memory at about 1,000 connected constraints.

## Options for Phase 1

1. **PlaneGCS plus decomposition:** split sketches into independent connected components and, while
   dragging, solve only the component being dragged. Fast to deliver; large connected sketches stay
   limited.
2. **Own solver with sparse linear algebra:** Levenberg–Marquardt or Gauss–Newton with a sparse
   factorization, written in TypeScript or compiled from C++/Rust. Scales close to linearly for typical
   sketches; more work up front.
3. Combination: start with option 1, replace the numeric core with option 2 when Phase 1 benchmarks
   reach their limits.

**Recommendation:** option 3. The Phase 1 targets (500 entities, 1,000 relations, dragging at 60 fps)
are part of the benchmark ladder and decide when the switch is needed.

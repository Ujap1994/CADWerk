# 0001 – Geometry kernel: Open CASCADE Technology in WebAssembly

**Status:** accepted for Phase 0 and Phase 1; a custom build is the top Gate 1 action item.

## Context

ParaWerk needs a boundary-representation (B-Rep) kernel with booleans, fillets, chamfers, shelling,
sweeps, lofts, tessellation, hidden-line removal and STEP/IGES exchange. Writing such a kernel is a
multi-decade effort. Open CASCADE Technology (OCCT) is the only mature open-source option and is used
by FreeCAD and many other tools. It is licensed under LGPL-2.1 with an exception, which is compatible
with ParaWerk's GPL-3.0-or-later license.

## Decision

- Use OCCT compiled to WebAssembly. Phase 0 uses the prebuilt `replicad-opencascadejs` package
  (embind bindings plus fast C++ mesh extractors).
- Run the kernel in a dedicated **Web Worker**, so the UI never blocks.
- Hide the kernel behind ParaWerk's own `Kernel` class and message protocol
  (`src/kernel/protocol.ts`). The rest of the app never touches OCCT objects, so the kernel can be
  replaced (custom WebAssembly build or native add-on) without UI changes.
- Keep the document in the UI process. The worker only holds caches, so a crashed or recycled worker
  is restarted transparently and the document is rebuilt.
- Rebuild incrementally: the body after each feature is cached under a key that hashes the feature's
  parameters and everything before it.

## Measured findings (Phase 0, Apple M3)

| Operation | Median |
|---|---|
| Kernel start (load and compile WebAssembly) | 128 ms |
| Warm-up of booleans, fillets, meshing | 310 ms (runs in the background after start) |
| Box rebuild | 0.9 ms |
| Fillet of 12 box edges | 32 ms |
| Plate with 100 holes, full rebuild (101 features) | 2.3 s |
| Same plate, edit last feature (incremental) | 463 ms |
| Tessellation of that plate (17,212 triangles) | 422 ms |
| STEP export of that plate | 45 ms |

Full numbers: [docs/benchmarks](../benchmarks/README.md).

### Issues found in the prebuilt WebAssembly build

1. **Memory leak in booleans.** `delete()` on `BRepAlgoAPI_*` objects does not release their internal
   data (about 200 KB per boolean). Calling `Clear()` before `delete()` fixes it completely
   (`Arena.trackAlgorithm`). A regression test guards this.
2. **`BRepCheck_Analyzer` leaks** on every use. It is not used in the rebuild path; fillet results get
   a cheap solid check instead.
3. **Re-tessellation on every call.** The mesh extractor triangulates the whole shape again even when
   a triangulation exists, which dominates the cost of editing large parts.
4. **Dynamic code generation.** Embind creates glue code with `new Function`, so the kernel worker
   alone needs `'unsafe-eval'` in its content security policy (the UI keeps a strict policy).
5. **Single-threaded.** Booleans and meshing do not use more than one core.

As a safety net, the client restarts the worker when its WebAssembly heap exceeds 1.5 GB, because
WebAssembly memory never shrinks.

## Consequences and next steps (Gate 1)

Build OCCT ourselves with Emscripten and a thin C++ facade that exposes ParaWerk's operations
(features, tessellation, export) instead of thousands of raw classes:

- RAII inside C++, so no embind object lifetimes leak into JavaScript;
- `-sDYNAMIC_EXECUTION=0` (no `'unsafe-eval'`), pthreads for parallel meshing and booleans,
  optional Memory64 for very large models;
- incremental tessellation that keeps triangulations of unchanged faces;
- the same facade compiled natively as a Node add-on in an Electron utility process, if WebAssembly
  stays too slow for large assemblies.

## Revisit when

The custom build is ready, or benchmarks show that the WebAssembly route cannot meet the v1.0 budgets.

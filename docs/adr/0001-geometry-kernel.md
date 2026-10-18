# 0001 – Geometry kernel: Open CASCADE Technology in WebAssembly

**Status:** accepted. Since 2026-10-19 ParaWerk uses its own OCCT 8.0.1 WebAssembly build with a thin
C++ facade (`native/kernel`). The prebuilt `replicad-opencascadejs` build of Phase 0 remains only as a
comparison backend in tests and benchmarks.

## Context

ParaWerk needs a boundary-representation (B-Rep) kernel with booleans, fillets, chamfers, shelling,
sweeps, lofts, tessellation, hidden-line removal and STEP/IGES exchange. Writing such a kernel is a
multi-decade effort. Open CASCADE Technology (OCCT) is the only mature open-source option and is used
by FreeCAD and many other tools. It is licensed under LGPL-2.1 with an exception, which is compatible
with ParaWerk's GPL-3.0-or-later license.

## Decision

- **OCCT 8.0.1 compiled to WebAssembly** with Emscripten (`scripts/build-occt.sh`), static libraries,
  native WebAssembly exceptions.
- **Own C++ facade** (`native/kernel/src` (`core.cpp`: OCCT logic, `bindings.cpp`: WebAssembly bindings), built by `scripts/build-kernel.sh`):
  - shapes live only in C++ and are referenced from JavaScript by integer ids, so no binding object can
    leak;
  - every call returns plain data (numbers, objects, copies of typed arrays) and turns OCCT exceptions
    into error codes;
  - tessellation, edge polylines, seam detection and exact face/edge geometry are computed in one C++
    call;
  - built with `-sDYNAMIC_EXECUTION=0`, so no `'unsafe-eval'` is needed in the content security policy.
- **Kernel in a Web Worker** behind ParaWerk's `GeometryBackend` interface (`src/kernel/backend.ts`);
  the document stays in the UI process, a crashed worker is restarted transparently.
- **Incremental rebuild**: the body after each feature is cached; meshing keeps the triangulation of
  faces that did not change.
- **Tessellation**: the 3D view uses OCCT's Delabella triangulator (fast for large planar faces with
  many holes), STL export uses the default Watson algorithm (Delabella is far slower at the fine export
  tolerance).
- The prebuilt binary is committed in `vendor/parawerk-kernel` with a manifest (versions, SHA-256);
  CI verifies the checksums (`npm run kernel:verify`).

## Measured comparison (Apple M3, median)

| Operation | Prebuilt build (Phase 0) | ParaWerk kernel |
|---|---|---|
| Kernel start | 114 ms | 51 ms |
| Box rebuild | 1.1 ms | 0.7 ms |
| Fillet of 12 box edges | 24 ms | 34 ms (includes a validity check of every result) |
| Plate with 100 holes, full rebuild (101 features) | 1,822 ms | 1,657 ms |
| Same plate, edit last feature | 495 ms | 218 ms |
| Mesh of an unchanged body | 421 ms | 60 ms |
| STEP export | 43 ms | 46 ms |
| STL export (fine tessellation) | 774 ms | 795 ms |
| WebAssembly heap after the benchmark | 199 MB | 92 MB |
| Memory growth over 400 fillet rebuilds | leaks ≈ 150–250 KB per rebuild | none (test budget 8 MB) |
| Size of the WebAssembly module | 23.0 MB | 15.2 MB |

## Problems of the prebuilt build that led to the decision

1. `delete()` on `BRepAlgoAPI_*` objects did not release internal data (≈ 200 KB per boolean);
   worked around with `Clear()`.
2. `BRepCheck_Analyzer` and fillet results leaked memory on every use.
3. The mesh extractor re-triangulated whole bodies on every call.
4. Embind needed `new Function`, forcing an `'unsafe-eval'` exception for the kernel worker.

## Lessons from building OCCT for WebAssembly

OCCT's CMake adds `-fexceptions` (Emscripten's JavaScript exception model) and enables signal conversion
with `setjmp`/`longjmp` on all non-MSVC compilers. Combined with native WebAssembly exceptions this
produced invalid WebAssembly ("br_table: label arity inconsistent"). The build script disables both for
Emscripten; WebAssembly has no signals to convert.

## Next steps

- Multi-threaded meshing and booleans (`-pthread`, OCCT's thread pool; cross-origin isolation is already
  enabled).
- Comparison with native OCCT to decide whether large assemblies need a native add-on.
- History tracking in the facade for persistent naming (ADR 0002).

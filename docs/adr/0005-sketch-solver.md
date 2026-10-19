# 0005 – 2D constraint solver

**Status:** accepted (2026-10-19): ParaWerk uses its own sparse solver (`src/sketch/solver`).

## Context

The sketcher needs a geometric constraint solver with interactive performance (dragging at 60 fps),
per-entity definition status (under-, fully, over-defined) and detection of conflicting or redundant
constraints.

## Options evaluated

**PlaneGCS** (FreeCAD's solver, WebAssembly port `@salusoft89/planegcs`) solves one dense system with QR
decomposition. On a connected chain of dimensioned rectangles (Apple M3): 55 constraints < 1 ms,
251 constraints 6 ms, 503 constraints 34–40 ms, and the WebAssembly build runs out of memory at about
1,000 constraints. It reports conflicting and redundant constraints but not which entities are still
free, so the familiar "blue = under-defined, black = fully defined" display is not possible with it.

## Decision: own solver in TypeScript

- **Model:** points (x, y) and circle radii are parameters; arcs derive their radius from center and start
  point with an implicit equal-distance rule. Every relation and dimension becomes one or two residual
  equations over at most eight parameters; derivatives by central differences.
- **Solving:** weighted minimum-norm Gauss–Newton steps Δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ + μI)⁻¹ r with backtracking and
  adaptive damping. The result is the smallest change that satisfies all constraints. Dragged parameters
  get a high weight, so under-defined geometry follows the cursor and fully defined geometry springs back.
  Conflicts leave the geometry unchanged and are reported.
- **Decomposition:** parameters connected by equations form components that are solved independently;
  satisfied components are skipped.
- **Linear algebra:** JW⁻¹Jᵀ is sparse and, because constraints connect neighboring geometry, has a small
  bandwidth after Reverse Cuthill–McKee reordering. An envelope (skyline) Cholesky factorization solves it
  in close to linear time; small systems use dense Cholesky, pathological cases conjugate gradients.
- **Definition status:** a parameter is free exactly when the null space of J moves it. Two random vectors
  projected onto the null space reveal every free parameter (probability 1). Entities with free parameters
  are under-defined; entities of unsatisfiable constraints are over-defined.
- **Redundancy check:** before adding a dimension, the solver checks whether its Jacobian rows lie in the
  row space of the existing ones; redundant dimensions are offered as driven (reference) dimensions.

## Results (Apple M3, same chain sketches as for PlaneGCS)

| Constraints | PlaneGCS | ParaWerk solver |
|---|---|---|
| 55 | 0.6 ms | 0.4 ms |
| 251 | 6 ms | 1.2 ms |
| 503 | 34–40 ms | 2.0 ms |
| 1,001 | out of memory | 4.7 ms |
| 2,002 | out of memory | 9.7 ms |
| Drag in a 1,000-constraint sketch | – | 3.0 ms per update |
| Definition analysis, 1,000 constraints | – | 4.0 ms |

`npm run bench:solver` runs both. PlaneGCS stays a development dependency for this comparison only.

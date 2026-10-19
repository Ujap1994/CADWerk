# Changelog

All notable changes to ParaWerk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Splines (key S): smooth curves through fit points (natural cubic splines), drawn point by point with
  snapping; the fit points are ordinary sketch points that can be dragged, dimensioned and related;
  move, copy, mirror and patterns; DXF export as polylines and import of fit-point splines.

- Scale the selection by a factor around the origin or a selected point, in place (dimensions within the
  selection scale along) or as a scaled copy.

- Convert entities: edges of the part become fixed sketch geometry on the sketch plane (lines, circles
  and arcs; tilted circles become ellipses, other curves splines); touching edges stay connected. The
  geometry kernel now reports the exact end points, centers and axes of edges.

### Changed
- *Line* and *Centerline* share one button with a variant menu (**L** starts the last one used), which
  makes room for *Spline* in the command bar.

## [0.2.0-alpha.0] - 2026-10-19

Second technical preview: the **2D sketcher** (Phase 1). Sketches can be drawn, constrained, fully
defined, edited and exchanged as DXF. Turning them into solids (extrude, revolve) follows in Phase 2.
Not ready for productive use; see the disclaimer in the README.

### Added – sketch mode
- The front, top and right planes in the feature tree and, while choosing a sketch plane, in the 3D view;
  sketches on planar faces of the part, placed exactly on the face's B-Rep plane.
- The **Sketch** command: the view turns normal to the sketch plane; adaptive grid and sketch origin;
  command bar tabs *Features* and *Sketch*.
- Undo and redo step by step inside a sketch; the whole session becomes one step of the part history;
  **✓** keeps, **✕** discards (after asking); existing sketches are edited from the feature tree, with
  later features rolled back.
- Sketch geometry in the 3D view: the open sketch on top of the part with points and dashed construction
  geometry, other sketches on their planes; hover with exact sizes in the status bar, click and
  Shift/Ctrl/⌘-click selection, deleting with dependent relations.
- Dragging under-defined geometry with live solving in a background worker (about 7 ms per step with
  2,000 entities, Apple M3).

### Added – drawing tools
- Line chains and centerlines; corner, center and 3-point rectangles and parallelograms; circles from
  center and radius or through three points; ellipses; center, 3-point and tangent arcs; straight slots;
  regular polygons (3 to 64 sides); points; construction geometry toggle.
- Snapping to end points, midpoints and curves (also where an inference line crosses a curve) and
  inference lines; the matching relations (coincident, midpoint, on curve, horizontal, vertical) are added
  automatically.
- Measurements next to the cursor; drawing by clicking or by press-drag-release; keyboard shortcuts
  (L, R, C, A, P, D, T); tool variants in drop-down menus that remember the last variant.
- Ellipses: center and two axis points, axes kept perpendicular by the solver and dimensioned from the
  center; points on ellipses and lines tangent to them.

### Added – relations and dimensions
- Relations for the selection (horizontal, vertical, coincident, on curve, midpoint, parallel,
  perpendicular, collinear, equal, tangent, concentric, symmetric, fix), offered according to what is
  selected and checked by the solver first: over-defining or contradicting relations are refused with a
  message. The relations of the selection are listed and can be deleted.
- Relation symbols next to the geometry (H, V, ∥, ⊥, =, …), outside closed outlines, one symbol per
  tangent joint, at a constant distance on screen. Pointing at a symbol highlights the related geometry,
  clicking selects the relation, Delete removes it; conflicting relations are red. A view toolbar button,
  the View menu and the settings hide and show them.
- Smart dimension (D): lengths, horizontal and vertical distances, point-to-line and parallel-line
  distances, diameters, radii and angles, inferred from the picked geometry and where the value is
  placed; values typed right at the dimension; double-click to change, drag to move, Delete to remove.
  Dimensions that would over-define the sketch become reference dimensions in parentheses.
- Definition status: under-defined geometry is blue, fully defined dark, over-defined red; the status is
  shown in the side panel, the status bar and the feature tree; conflicting relations and dimensions are
  listed and can be deleted. The solver analyzes every change in the background.
- Own sparse 2D constraint solver in a worker ([ADR 0005](docs/adr/0005-sketch-solver.md)), with
  well-conditioned tangency at shared end points so tangent arcs and fillets count as fully defined.

### Added – editing tools
- Trim (T) removes the piece of a curve between its crossings (red preview under the cursor; middle
  pieces leave collinear lines or equal arcs, circles become arcs); extend lengthens a line or arc up to
  the next curve. New ends stay on the crossing curve.
- Sketch fillet and chamfer round or bevel the corner of two lines; the corner stays as a virtual sharp
  so dimensions to it keep working.
- Offset of lines, arcs and circles: connected chains stay connected, closed outlines grow outwards or
  inwards.
- Mirror (with symmetric relations), linear and circular patterns (equal radii for copies), move (keeping
  relations) and copy of the selection.

### Added – DXF exchange
- DXF import into the open sketch: lines, circles, arcs, full ellipses, points and polylines with arc
  segments; units converted to millimeters; coinciding ends joined; unsupported entities listed.
- DXF export of the sketch (R12, millimeters, without construction geometry); ellipses become closed
  polylines within 0.005 mm.

### Added – interface, quality and documentation
- The command bar adapts to the window width (tighter buttons, then icons only) without changing its
  height; its variant menus are never cut off.
- End-to-end test of the Phase 1 exit criterion: an L-shaped bracket with two holes is drawn and fully
  defined with mouse and keyboard only, in the smallest window, in at most 64 clicks and key presses.
- Sketch benchmarks for dragging and drawing in sketches of 50, 500 and 2,000 entities.
- User guide chapter on sketches with a step-by-step example and screenshots of every tool.

### Changed
- New geometry kernel: Open CASCADE Technology 8.0.1 compiled to WebAssembly with ParaWerk's own C++
  facade. Editing large parts is about twice as fast, the kernel uses half the memory, starts faster,
  and the memory leaks of the previous prebuilt build are gone.
- Curved faces are tessellated with a fast Delaunay triangulator for the 3D view.

### Security
- The content security policy no longer allows `'unsafe-eval'` anywhere (the new kernel does not
  generate code at run time).

## [0.1.0-alpha.0] - 2026-10-19

First technical preview (Phase 0). Not ready for productive use; see the disclaimer in the README.

### Added – Phase 0 preview
- Electron desktop application with secure defaults (sandboxed renderer, context isolation, strict
  content security policy, custom `app://` protocol), single instance and clean shutdown.
- Geometry kernel based on Open CASCADE Technology (WebAssembly) in a background worker: box and
  cylinder (add or remove material), fillet, chamfer, incremental rebuild, exact mass properties,
  automatic recovery after kernel crashes.
- 3D view with view cube, axis indicator, standard views, orthographic and perspective projection,
  rotation around the point under the cursor, zoom to cursor, mouse and trackpad presets, face and edge
  highlighting and picking.
- Feature tree and property panels with live preview, rollback while editing, suppress, delete, undo
  and redo, and readable error messages.
- Native `.pwpart` file format; STEP and binary STL export.
- English and German user interface (switchable at runtime, system language by default); light and
  dark theme; own icon set.
- Automated unit, integration and end-to-end tests; kernel, solver and rendering benchmarks; CI on
  Windows, macOS and Linux; release workflow for all desktop packages.
- User guide with screenshots, architecture decision records and benchmark results.
- The status bar shows the exact type and size of the face or edge under the cursor or selected
  (for example "Face 7 · Cylinder Ø 44 mm · 4,838.1 mm²"), computed from the B-Rep, not from the mesh.
- `--self-test` command-line option that checks an installation (3D graphics, geometry kernel, modeling
  accuracy, STEP export); the release pipeline runs it on every package.

### Added – planning
- Project vision, README with disclaimer and planned feature overview.
- Detailed roadmap with effort estimates, architecture, performance targets, risks and decision gates.
- Project icon (SVG) and roadmap timeline graphic.
- GPL-3.0-or-later license.

### Changed
- The project is now called **ParaWerk** (formerly the working title CADWerk). The repository moved to
  `Ujap1994/ParaWerk`; GitHub redirects the old address.

### Removed
- DWG from the planned formats, because it is a closed, proprietary format. DXF covers 2D exchange.

[Unreleased]: https://github.com/Ujap1994/ParaWerk/compare/v0.2.0-alpha.0...HEAD
[0.2.0-alpha.0]: https://github.com/Ujap1994/ParaWerk/compare/v0.1.0-alpha.0...v0.2.0-alpha.0
[0.1.0-alpha.0]: https://github.com/Ujap1994/ParaWerk/releases/tag/v0.1.0-alpha.0

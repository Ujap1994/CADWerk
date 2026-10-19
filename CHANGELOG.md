# Changelog

All notable changes to ParaWerk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Sketch mode (Phase 1, first part): the front, top and right planes in the feature tree and, while
  choosing a sketch plane, in the 3D view; sketches on planar faces, placed exactly on the face's B-Rep
  plane; the **Sketch** command; the view turns normal to the sketch
  plane; adaptive grid and sketch origin; undo and redo step by step inside a sketch, with the whole
  session as one step of the part history; editing existing sketches with rollback of later features.
- Sketch geometry in the 3D view: open sketches on top of the part with points and dashed construction
  geometry, other sketches on their planes; hover with exact sizes in the status bar, click selection,
  dragging with live solving in the background (about 7 ms per step with 2,000 entities), deleting with
  dependent relations.
- Drawing tools: line chains, centerline, corner and center rectangle, circle, center and 3-point arc,
  point; snapping to points, midpoints and curves, inference lines, automatic coincident, midpoint,
  on-curve, horizontal and vertical relations; measurements next to the cursor; drawing by clicking or
  dragging; keyboard shortcuts; construction geometry toggle.
- Relations for selected sketch geometry (horizontal, vertical, coincident, on curve, midpoint, parallel,
  perpendicular, collinear, equal, tangent, concentric, symmetric, fix), offered according to the
  selection and checked by the solver: over-defining or conflicting relations are refused with a
  message; existing relations of the selection are listed and can be deleted.
- Smart dimension (key D): lengths, horizontal and vertical distances, point-to-line and parallel-line
  distances, diameters, radii and angles, chosen from the picked geometry and where the value is placed;
  values typed right at the dimension; dimensions that would over-define the sketch become reference
  dimensions; double-click to change, drag to move, Delete to remove.
- Mirror (with symmetric relations), linear and circular patterns (equal radii for copied circles and
  arcs), move (keeping relations, like a drag) and copy of selected sketch geometry, from the side panel.
- Trim and extend: remove the piece of a curve between its crossings (red preview under the cursor;
  middle pieces leave collinear lines or equal arcs, circles become arcs) or lengthen a line or arc up to
  the next curve (dashed preview), keeping new ends on the crossing curve.
- Sketch fillet and chamfer: round or bevel the corner of two lines; lines are shortened, the arc is
  tangent and dimensioned, the corner stays as a virtual sharp so dimensions to it keep working.
- Tangency at a shared end point uses a well-conditioned equation, so tangent arcs and fillets are
  correctly reported as fully defined.
- More drawing tools: tangent arc (continues a line or arc from its end point), 3-point circle, straight
  slot (tangent sides, equal end arcs) and regular polygon (3 to 64 sides, on a construction circle).
- Definition status of sketches: under-defined geometry is blue, fully defined dark, over-defined red;
  status in the side panel, the status bar and the feature tree; conflicting relations and dimensions are
  listed (and shown in red) and can be deleted. The solver analyzes sketches in the background after
  every change.
- The command bar adapts to the available width: tighter buttons, then icons only (the names stay in the
  tooltips). Its height stays the same, so the 3D view never jumps, and the layout never grows wider than
  the window.
- Command bar tabs *Features* and *Sketch*.
- Own sparse 2D constraint solver running in a worker (the basis for relations and dimensions).

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

[Unreleased]: https://github.com/Ujap1994/ParaWerk/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/Ujap1994/ParaWerk/releases/tag/v0.1.0-alpha.0

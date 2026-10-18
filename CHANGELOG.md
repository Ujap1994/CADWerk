# Changelog

All notable changes to ParaWerk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

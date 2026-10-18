# Changelog

All notable changes to ParaWerk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

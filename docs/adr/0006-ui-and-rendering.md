# 0006 – UI stack and rendering

**Status:** accepted.

## Decision

- **UI shell:** React 19 with a small zustand store. All application logic lives in plain modules
  (`commands.ts`, `state/*`), so components stay thin and testable.
- **3D viewport:** a three.js engine (`src/renderer/src/viewport/engine.ts`) that lives outside React.
  It renders **on demand** (only when something changes), which keeps idle CPU and GPU use at zero.
- **Picking:** bounding volume hierarchy (three-mesh-bvh) built lazily on first hover; edges are wide
  lines with a pixel tolerance; occluded edges are not pickable.
- **Highlighting:** overlays share the body's vertex buffers, so hover and selection never re-upload
  geometry.
- **Large assemblies:** identical components are drawn with GPU instancing. Measured on an Apple M3:
  1,000 instanced components (2.3 M triangles) at 118 fps, 10,000 (21.5 M triangles) at 32 fps,
  50,000 (107 M triangles) at 8 fps, so level of detail and culling are required before v1.0
  (Phase 8). The same 1,000 components as individual meshes reach 78 fps.
- **Own visual identity:** design tokens for light and dark themes, an own icon set, and no assets or
  layouts from other CAD products.

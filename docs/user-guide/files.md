# Files, import and export

## ParaWerk parts (.pwpart)

**Save** (Ctrl/⌘ + S) stores the complete feature history in a `.pwpart` file, so every feature stays
editable after reopening. **Save as** stores a copy under a new name. The window title shows a dot (•)
while there are unsaved changes; ParaWerk asks before discarding them.

Double-clicking a `.pwpart` file opens it in ParaWerk. If ParaWerk is already running, the file opens in
the existing window.

The format is documented in [ADR 0003](../adr/0003-native-file-format.md).

## Export

| Format | Use | Details |
|---|---|---|
| **STEP** (`.step`) | Exchange with other CAD systems | AP214, millimeters, exact B-Rep geometry |
| **STL** (`.stl`) | 3D printing | Binary STL in millimeters; tessellation is finer than in the 3D view and adapts to the part size |

## Sketches as DXF

In sketch mode, the **DXF** group of the *Sketch* tab exchanges sketch geometry with 2D CAD, laser
cutting and CNC software:

- **Export** saves the open sketch as a DXF file (R12, millimeters) with its lines, circles and arcs.
  R12 has no ellipses and splines, so they are written as polylines that stay within 0.005 mm of the true
  shape. Construction geometry and sketch points are left out, so only the real outline gets cut.
- **Import** adds the geometry of a DXF file to the open sketch, at its coordinates: lines, circles,
  arcs, points and polylines (also with arc segments). End points that coincide are joined, so imported
  outlines are connected. Drawings in inches, centimeters or meters are converted to millimeters (from
  the file's unit setting). Full ellipses become sketch ellipses and splines given by fit points become
  sketch splines. Texts, dimensions, splines given only by control points, elliptical arcs, hatches and
  blocks are not imported; a message lists what was left out.

More formats (3MF, PDF, IGES, glTF) and STEP import follow according to the
[roadmap](../../ROADMAP.md).

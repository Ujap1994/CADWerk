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

More formats (3MF, DXF, PDF, IGES, glTF) and STEP import follow according to the
[roadmap](../../ROADMAP.md).

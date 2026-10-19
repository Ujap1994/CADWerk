# ParaWerk user guide

> [!CAUTION]
> ParaWerk is under active development. This guide describes the current preview (Phase 0, with the
> Phase 1 sketcher in progress). Check every result before you manufacture anything.

![ParaWerk main window](../images/screenshots/main-window.png)

## Contents

1. [Getting started](getting-started.md): install ParaWerk and build your first part
2. [The interface](interface.md): command bar, feature tree, property panel, 3D view, status bar
3. [Navigating the 3D view](navigation.md): rotate, pan, zoom, view cube and standard views
4. [Sketches](sketches.md): planes, sketch mode, drawing tools, snapping, selecting and dragging geometry
5. [Modeling features](features.md): box, cylinder, fillet, chamfer, editing and undo
6. [Files, import and export](files.md): `.pwpart` files, STEP and STL
7. [Settings](settings.md): language, theme, navigation and projection
8. [Troubleshooting](troubleshooting.md): self-test, logs and known limitations

## What the preview can do

| Area | Available now |
|---|---|
| Modeling | Box and cylinder (add or remove material), fillet and chamfer on edges picked in the 3D view |
| Sketching (in progress) | Sketches on the front, top and right plane and on planar faces; sketch mode with view normal to the plane, adaptive grid and its own undo history; drawing tools with snapping and automatic relations; relations checked by the solver; selecting, dragging (live solving) and deleting sketch geometry |
| Feature tree | Edit, suppress and delete features; rollback while editing; undo and redo |
| Evaluation | Exact volume and surface area, face and edge information under the cursor |
| Files | Save and open `.pwpart`, export STEP (AP214) and binary STL |
| Interface | English and German, light and dark theme, mouse and trackpad navigation |

Drawing tools, relations and dimensions are being added to the sketcher now (Phase 1); sketch-based
features such as extrude and revolve follow in Phase 2. See the [roadmap](../../ROADMAP.md).

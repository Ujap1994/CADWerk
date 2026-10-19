# Sketches

> [!NOTE]
> The sketcher is being built in Phase 1. This page describes what works today: choosing a sketch plane
> or planar face, sketch mode with its grid and its own undo history, and editing existing sketches. Drawing tools,
> relations and dimensions follow in the next updates; the page grows with them.

A sketch is a 2D drawing on a plane. Sketches are the starting point of most features: in a typical
workflow you sketch a profile, fully define it with relations and dimensions, and then extrude or
revolve it into a solid.

## Planes

Every part has three standard planes through the origin. They are listed in the feature tree below
**Origin**:

| Plane | Contains | Looks along |
|---|---|---|
| **Front plane** | X and Z | +Y (the front view) |
| **Top plane** | X and Y | −Z (the top view) |
| **Right plane** | Y and Z | −X (the right view) |

Hover over a plane in the feature tree to show it in the 3D view. Click it to select it; it stays visible
while it is selected. Planes are hidden otherwise, so they never get in the way.

## Planar faces

Any flat face of the part can carry a sketch, for example the top of a plate or the bottom of a pocket.
The sketch lies exactly in the face's plane (ParaWerk takes the plane from the exact B-Rep geometry, not
from the triangles of the display), and you look at it from outside the material.

- **Sketch origin on a face:** the part origin projected onto the face's plane, as for any plane through
  the part.
- **Sketch axes on a face:** chosen like the standard views, so a face parallel to the front, top or right
  plane gets the same axes as that plane, and on all other faces the sketch's y axis points as close to
  upwards (+Z) as the face allows.
- In this preview a sketch keeps the position of the face at the time it was created; it does not yet
  move along when the face moves because earlier features change. Following the face is part of the
  persistent naming work ([ADR 0002](../adr/0002-persistent-naming.md)).

## Starting a sketch

There are several ways to start a sketch; use whichever fits your hand:

- Click **Sketch** (in the *Features* or the *Sketch* tab of the command bar). The three planes appear in
  the 3D view and the side panel asks for a plane. Click a plane or a planar face in the 3D view, a plane
  in the feature tree or one of the buttons in the panel. What is under the cursor is highlighted in
  orange and named in the status bar; curved faces cannot be picked.
- Select a plane (in the feature tree) or a planar face (in the 3D view) first, then click **Sketch**:
  the sketch opens there at once.
- Hover over a plane in the feature tree and click its **Sketch on this plane** button.

When a translucent plane lies in front of a face, a click picks the face: you see the face through the
plane, so that is what you aim at. Click a plane where it extends beyond the part, or pick it in the
feature tree or the panel.

**Esc** or **✕** cancels the plane choice.

| Choosing a standard plane | Choosing a planar face |
|---|---|
| ![Choosing a sketch plane](../images/screenshots/sketch-choose-plane.png) | ![Choosing a planar face](../images/screenshots/sketch-choose-face.png) |

## Sketch mode

When the sketch opens, the view turns to look straight at the sketch plane, with the sketch's x axis to
the right and its y axis up. The command bar switches to the *Sketch* tab.

![Sketch mode on the front plane](../images/screenshots/sketch-mode.png)

- **Grid:** the sketch plane shows a grid with major lines every ten minor lines. The spacing adapts to
  the zoom level in powers of ten (0.1, 1, 10, 100 mm, ...); finer lines fade in smoothly as you zoom in.
  The two sketch axes are drawn a little stronger. Where the plane runs inside the part, the part hides
  the grid.
- **Sketch origin:** the red (x) and green (y) arrows mark the origin of the sketch. They keep their size
  on screen at every zoom level.
- **Navigation** works as usual: you can rotate, pan and zoom freely. Use the view cube or the standard
  views to look at the sketch from any side.
- **Rolled-back model:** while you edit a sketch, the part is shown as it was *before* the sketch;
  features below the sketch appear faded in the feature tree and are rebuilt when you leave sketch mode.
- **Side panel:** shows the sketch's name, its plane and what it contains. The feature tree stays visible
  below it, but other features cannot be edited, suppressed or deleted until you leave the sketch.

### Undo and redo in sketch mode

Inside a sketch, **Undo** (Ctrl+Z / ⌘Z) and **Redo** (Ctrl+Y / ⌘⇧Z) step through the operations of the
sketch one by one. When you leave the sketch, the whole sketch session becomes a *single* step of the
part's history: one undo afterwards removes (or restores) everything you did in that session.

### Leaving sketch mode

| Action | Result |
|---|---|
| **✓** in the side panel, or **Exit sketch** in the *Sketch* tab | Keeps the sketch. A new sketch is added at the end of the feature tree. A new sketch that is still empty is not added at all. |
| **✕** in the side panel | Discards the changes of this session. If there are changes, ParaWerk asks first. |

Saving (Ctrl+S / ⌘S) while a sketch is open stores the sketch in the file and keeps you in sketch mode.

## Editing a sketch

Double-click a sketch in the feature tree, or hover over it and click **Edit feature**. The sketch opens
in sketch mode on its plane, and everything after it in the feature tree is rolled back until you leave
sketch mode.

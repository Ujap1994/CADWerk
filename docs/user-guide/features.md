# Modeling features

A part is a list of features applied from top to bottom. Every feature can be edited later; the part is
rebuilt automatically and only from the first changed feature onwards.

## Box

Adds or removes a box. *Width* (X), *Depth* (Y) and *Height* (Z) are in millimeters; *Position* is the
center of the bottom face. The first feature of a part always adds material.

## Cylinder

Adds or removes a cylinder with *Radius*, *Height* and *Axis* (X, Y or Z). *Position* is the center of
the base circle. Use **Remove material** to drill holes; make the cylinder longer than the part so it
cuts through.

## Fillet

Rounds edges with a constant *Radius*. Click edges in the 3D view to add or remove them (selected edges
are orange). While you edit, the 3D view shows the result and draws the original edges as thin blue lines,
so you can keep picking.

![Fillet preview](../images/screenshots/fillet-preview.png)

## Chamfer

Bevels edges with an equal *Distance* on both faces. Edge selection works like for fillets.

## Editing features

- **Edit:** double-click a feature in the tree or use the pencil icon. Features below it are rolled back
  (dimmed) while you edit.
- **Suppress:** the eye icon temporarily removes a feature from the part without deleting it.
- **Delete:** the trash icon removes the feature.
- **Undo / Redo:** every change can be undone (up to 200 steps).

## When a feature fails

If the kernel cannot build a feature, for example because a fillet radius is larger than the adjacent
faces allow, the feature is marked in red in the tree and the property panel explains why. The rest of
the part stays intact: the failed feature is skipped until you fix it.

# 0004 – Coordinate system, units and standard views

**Status:** accepted.

- **Units:** millimeters internally and in files. Display units become configurable later; the model
  stays in millimeters.
- **Axes:** right-handed, **Z up**. This matches 3D printing (3MF/STL), most CNC conventions and STEP
  exchange without conversion.
- **Standard views** follow ISO naming with first-angle projection in drawings (ISO 5456-2):
  front looks along +Y, top looks down along −Z with +Y up on screen, right looks along −X.
  Isometric looks from (+1, −1, +1).
- **Navigation:** free rotation around the screen axes through the point under the cursor; zoom
  towards the cursor; orthographic projection by default, perspective optional.

import { Matrix4, Quaternion, Vector3 } from 'three';

export type StandardView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

export const STANDARD_VIEWS: readonly StandardView[] = ['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric'];

/**
 * Direction from the target towards the camera for each standard view.
 * Z is up; the front view looks along +Y (first-angle naming, ISO 5456-2).
 */
export const VIEW_DIRECTIONS: Record<StandardView, Vector3> = {
  front: new Vector3(0, -1, 0),
  back: new Vector3(0, 1, 0),
  left: new Vector3(-1, 0, 0),
  right: new Vector3(1, 0, 0),
  top: new Vector3(0, 0, 1),
  bottom: new Vector3(0, 0, -1),
  isometric: new Vector3(1, -1, 1).normalize(),
};

/**
 * Camera orientation looking from `direction` towards the target.
 * Screen-up follows +Z, except for views straight from above or below,
 * where +Y (top) or -Y (bottom) points up so the front stays at the bottom edge.
 */
export function viewQuaternion(direction: Vector3): Quaternion {
  const z = direction.clone().normalize();
  const upHint = Math.abs(z.z) > 0.999 ? new Vector3(0, z.z > 0 ? 1 : -1, 0) : new Vector3(0, 0, 1);
  const x = new Vector3().crossVectors(upHint, z).normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

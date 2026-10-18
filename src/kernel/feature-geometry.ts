import type { Axis, Vec3 } from '../shared/model/feature.ts';

export function axisDirection(axis: Axis): Vec3 {
  switch (axis) {
    case 'x':
      return [1, 0, 0];
    case 'y':
      return [0, 1, 0];
    case 'z':
      return [0, 0, 1];
  }
}

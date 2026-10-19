import type { SketchData } from '../../../shared/model/sketch.ts';
import type { DragTarget } from '../../../sketch/solver/index.ts';
import { pointPositions, type SketchHit } from './geometry.ts';

/** Where a drag started and where the pointer is now, in sketch coordinates. */
export interface DragPositions {
  u: number;
  v: number;
}

/**
 * Where the dragged geometry should go: points follow the cursor by the distance it moved
 * (no jump to the cursor), lines and arcs move as a whole, circles grabbed at their edge
 * change their radius.
 */
export function dragTarget(base: SketchData, hit: SketchHit, start: DragPositions, pointer: DragPositions): DragTarget | null {
  const du = pointer.u - start.u;
  const dv = pointer.v - start.v;
  const positions = pointPositions(base);
  const moved = (id: string) => {
    const position = positions.get(id);
    return position ? { id, x: position[0] + du, y: position[1] + dv } : null;
  };
  const entity = base.entities.find((candidate) => candidate.id === hit.id);
  switch (entity?.type) {
    case 'point':
      return { kind: 'point', ...(moved(entity.id) ?? { id: entity.id, x: pointer.u, y: pointer.v }) };
    case 'line':
    case 'arc': {
      const ids = entity.type === 'line' ? [entity.p1, entity.p2] : [entity.center, entity.start, entity.end];
      const points = ids.map(moved).filter((point) => point !== null);
      return points.length === ids.length ? { kind: 'points', points } : null;
    }
    case 'circle': {
      const center = positions.get(entity.center);
      if (!center) return null;
      const grabbed = Math.hypot(start.u - center[0], start.v - center[1]);
      const now = Math.hypot(pointer.u - center[0], pointer.v - center[1]);
      return { kind: 'radius', id: entity.id, radius: Math.max(1e-6, entity.radius + now - grabbed) };
    }
    default:
      return null;
  }
}

/** Whether two sketches have the same point positions and radii (within floating-point noise). */
export function sameGeometry(a: SketchData, b: SketchData): boolean {
  if (a.entities.length !== b.entities.length) return false;
  return a.entities.every((entity, i) => {
    const other = b.entities[i];
    if (!other || other.id !== entity.id) return false;
    if (entity.type === 'point' && other.type === 'point') return Math.abs(entity.x - other.x) < 1e-9 && Math.abs(entity.y - other.y) < 1e-9;
    if (entity.type === 'circle' && other.type === 'circle') return Math.abs(entity.radius - other.radius) < 1e-9;
    return true;
  });
}

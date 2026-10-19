import type { SketchConstraint, SketchData, SketchEntity, SketchRelation } from '../../../shared/model/sketch.ts';
import type { DimensionDraft } from './dimensions.ts';
import type { SnapTarget } from './snap.ts';

/** A point placed by a drawing tool: where it is and what it snapped to. */
export interface PlacedPoint {
  u: number;
  v: number;
  target: SnapTarget;
}

type RelationInput = SketchRelation extends infer R ? (R extends SketchRelation ? Omit<R, 'id'> : never) : never;

/**
 * Adds new geometry to a sketch with readable, unique ids ("p12", "l4", ...). Points that
 * snapped to an existing point reuse it (connected geometry shares its points, which keeps
 * sketches small and fast to solve); snaps to midpoints and curves become relations.
 */
export class SketchBuilder {
  private readonly base: SketchData;
  private readonly entities: SketchEntity[] = [];
  private readonly constraints: SketchConstraint[] = [];
  private readonly replaced = new Map<string, SketchEntity>();
  private readonly next = new Map<string, number>();

  constructor(base: SketchData) {
    this.base = base;
    for (const item of [...base.entities, ...base.constraints]) {
      const match = /^([a-z]+)(\d+)$/.exec(item.id);
      if (match) this.next.set(match[1] as string, Math.max(this.next.get(match[1] as string) ?? 1, Number(match[2]) + 1));
    }
  }

  private id(prefix: string): string {
    const number = this.next.get(prefix) ?? 1;
    this.next.set(prefix, number + 1);
    return `${prefix}${number}`;
  }

  /** The id of the point at `placed`: an existing point it snapped to, or a new one with its relation. */
  point(placed: PlacedPoint): string {
    if (placed.target.kind === 'point') return placed.target.id;
    const id = this.id('p');
    this.entities.push({ id, type: 'point', x: placed.u, y: placed.v });
    if (placed.target.kind === 'midpoint') this.relation({ type: 'midpoint', point: id, line: placed.target.line });
    if (placed.target.kind === 'curve') {
      this.relation(
        placed.target.curveType === 'line'
          ? { type: 'pointOnLine', point: id, line: placed.target.curve }
          : { type: 'pointOnCircle', point: id, circle: placed.target.curve },
      );
    }
    return id;
  }

  /** A new free point (no snapping), e.g. the computed corner of a rectangle. */
  freePoint(u: number, v: number): string {
    return this.point({ u, v, target: { kind: 'none' } });
  }

  line(p1: string, p2: string, construction = false): string {
    const id = this.id('l');
    this.entities.push({ id, type: 'line', p1, p2, ...(construction ? { construction } : {}) });
    return id;
  }

  circle(center: string, radius: number, construction = false): string {
    const id = this.id('c');
    this.entities.push({ id, type: 'circle', center, radius, ...(construction ? { construction } : {}) });
    return id;
  }

  /** Counterclockwise arc from start to end. */
  arc(center: string, start: string, end: string, construction = false): string {
    const id = this.id('a');
    this.entities.push({ id, type: 'arc', center, start, end, ...(construction ? { construction } : {}) });
    return id;
  }

  relation(relation: RelationInput): string {
    const id = this.id('r');
    this.constraints.push({ ...relation, id } as SketchConstraint);
    return id;
  }

  dimension(draft: DimensionDraft): string {
    const id = this.id('d');
    this.constraints.push({ ...draft, id } as SketchConstraint);
    return id;
  }

  /** Changes an existing entity (e.g. a line that now ends at another point). */
  replace(id: string, entity: SketchEntity): void {
    this.replaced.set(id, entity);
  }

  get changed(): boolean {
    return this.entities.length > 0 || this.constraints.length > 0 || this.replaced.size > 0;
  }

  build(): SketchData {
    if (!this.changed) return this.base;
    const existing = this.replaced.size > 0 ? this.base.entities.map((entity) => this.replaced.get(entity.id) ?? entity) : this.base.entities;
    return { entities: [...existing, ...this.entities], constraints: [...this.base.constraints, ...this.constraints] };
  }
}

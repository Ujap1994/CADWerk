import { describe, expect, it } from 'vitest';
import { applySketchSession, hasSketchChanges, openSketchSession, recordSketch, redoSketch, undoSketch } from '../../src/renderer/src/sketch/session.ts';
import { HISTORY_LIMIT, rebuildPlan } from '../../src/renderer/src/state/document.ts';
import { FULL_GRID_PX, gridSpacing, MIN_GRID_PX } from '../../src/renderer/src/viewport/grid.ts';
import { defaultFeature, type Feature, type SketchFeature } from '../../src/shared/model/feature.ts';
import type { SketchData } from '../../src/shared/model/sketch.ts';

const box = defaultFeature('box', 'b');
const cylinder = defaultFeature('cylinder', 'c');
const sketch = defaultFeature('sketch', 's') as SketchFeature;

function withPoints(count: number): SketchData {
  return {
    entities: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, type: 'point' as const, x: i, y: 0 })),
    constraints: [],
  };
}

describe('sketch session undo', () => {
  it('records operations as undo steps and redoes them', () => {
    let session = openSketchSession('create', 1, sketch);
    const one = withPoints(1);
    const two = withPoints(2);
    session = recordSketch(session, one);
    session = recordSketch(session, two);
    expect(session.draft.sketch).toBe(two);
    session = undoSketch(session);
    expect(session.draft.sketch).toBe(one);
    session = undoSketch(undoSketch(session));
    expect(session.draft.sketch.entities).toHaveLength(0);
    expect(session.past).toHaveLength(0);
    session = redoSketch(redoSketch(session));
    expect(session.draft.sketch).toBe(two);
    expect(redoSketch(session)).toBe(session);
  });

  it('drops the redo steps on a new operation, ignores no-ops and bounds the history', () => {
    let session = recordSketch(recordSketch(openSketchSession('create', 0, sketch), withPoints(1)), withPoints(2));
    session = recordSketch(undoSketch(session), withPoints(3));
    expect(session.future).toHaveLength(0);
    expect(recordSketch(session, session.draft.sketch)).toBe(session);
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) session = recordSketch(session, withPoints(i % 4));
    expect(session.past).toHaveLength(HISTORY_LIMIT);
  });

  it('keeps the plane and id of the sketch through all steps', () => {
    const front: SketchFeature = { ...sketch, plane: { kind: 'standard', plane: 'front' } };
    const session = undoSketch(recordSketch(openSketchSession('create', 0, front), withPoints(1)));
    expect(session.draft.plane).toBe(front.plane);
    expect(session.draft.id).toBe('s');
  });
});

describe('leaving sketch mode', () => {
  const features: Feature[] = [box, sketch, cylinder];

  it('drops an empty new sketch and inserts a drawn one at its position', () => {
    const empty = openSketchSession('create', 2, { ...sketch, id: 'new' });
    expect(hasSketchChanges(empty, features)).toBe(false);
    expect(applySketchSession(features, empty)).toBeNull();
    const drawn = recordSketch(empty, withPoints(1));
    expect(hasSketchChanges(drawn, features)).toBe(true);
    expect(applySketchSession(features, drawn)?.map((f) => f.id)).toEqual(['b', 's', 'new', 'c']);
  });

  it('keeps an unchanged edited sketch and replaces a changed one', () => {
    const opened = openSketchSession('edit', 1, sketch);
    expect(applySketchSession(features, opened)).toBeNull();
    const changed = recordSketch(opened, withPoints(2));
    const next = applySketchSession(features, changed);
    expect(next?.map((f) => f.id)).toEqual(['b', 's', 'c']);
    expect((next?.[1] as SketchFeature).sketch.entities).toHaveLength(2);
    // Undoing every step counts as unchanged again.
    expect(hasSketchChanges(undoSketch(changed), features)).toBe(false);
    expect(applySketchSession(features, undoSketch(changed))).toBeNull();
  });

  it('rolls the model back to the sketch', () => {
    const plan = rebuildPlan(features, null, 1);
    expect(plan.features.map((f) => f.id)).toEqual(['b']);
    expect(plan.captures).toEqual([0]);
    expect(rebuildPlan(features, null, 0)).toEqual({ features: [], captures: [-1] });
  });
});

describe('sketch grid', () => {
  it('uses powers of ten at least the minimum screen spacing apart', () => {
    for (const mmPerPixel of [0.001, 0.0173, 0.1, 0.5, 2.7, 40]) {
      const { minor } = gridSpacing(mmPerPixel);
      expect(Math.log10(minor) % 1).toBeCloseTo(0, 9);
      expect(minor / mmPerPixel).toBeGreaterThanOrEqual(MIN_GRID_PX - 1e-9);
      expect(minor / mmPerPixel).toBeLessThan(MIN_GRID_PX * 10 + 1e-9);
    }
  });

  it('fades minor lines in smoothly while zooming', () => {
    // 1 mm lines: 12 px apart at 1/12 mm per pixel (just visible), 40 px apart at 1/40 (full strength).
    expect(gridSpacing(1 / MIN_GRID_PX).minorStrength).toBeCloseTo(0, 6);
    expect(gridSpacing(1 / FULL_GRID_PX).minorStrength).toBeCloseTo(1, 6);
    const strengths = [12.5, 16, 20, 25, 30, 35].map((px) => gridSpacing(1 / px).minorStrength);
    for (let i = 1; i < strengths.length; i++) expect(strengths[i]).toBeGreaterThan(strengths[i - 1] as number);
  });
});

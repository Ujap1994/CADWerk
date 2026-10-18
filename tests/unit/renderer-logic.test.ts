import { describe, expect, it } from 'vitest';
import { applyEdit, commit, emptyHistory, featureOrdinal, hasBodyBefore, HISTORY_LIMIT, rebuildPlan, redo, undo } from '../../src/renderer/src/state/document.ts';
import { parseNumber } from '../../src/renderer/src/format.ts';
import { defaultFeature, type Feature } from '../../src/shared/model/feature.ts';

const box = defaultFeature('box', 'b');
const fillet = defaultFeature('fillet', 'f');
const cylinder = defaultFeature('cylinder', 'c');

describe('undo history', () => {
  it('undoes and redoes commits', () => {
    let history = emptyHistory();
    history = commit(history, [box]);
    history = commit(history, [box, fillet]);
    history = undo(history);
    expect(history.features).toEqual([box]);
    history = redo(history);
    expect(history.features).toEqual([box, fillet]);
    expect(undo(emptyHistory())).toEqual(emptyHistory());
  });

  it('clears redo on a new commit and keeps a bounded history', () => {
    let history = commit(commit(emptyHistory(), [box]), [box, fillet]);
    history = commit(undo(history), [box, cylinder]);
    expect(history.future).toHaveLength(0);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) history = commit(history, [box]);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('edits', () => {
  const features: Feature[] = [box, cylinder, fillet];

  it('rolls back later features while editing', () => {
    const plan = rebuildPlan(features, { mode: 'edit', index: 1, draft: { ...cylinder, radius: 3 } as Feature });
    expect(plan.features.map((f) => f.id)).toEqual(['b', 'c']);
    expect(plan.captures).toEqual([0, 1]);
  });

  it('builds everything when nothing is edited', () => {
    expect(rebuildPlan(features, null)).toEqual({ features, captures: [2] });
  });

  it('inserts created features and replaces edited ones', () => {
    expect(applyEdit([box], { mode: 'create', index: 1, draft: fillet }).map((f) => f.id)).toEqual(['b', 'f']);
    const edited = applyEdit(features, { mode: 'edit', index: 0, draft: { ...box, width: 5 } as Feature });
    expect(edited[0]).toMatchObject({ width: 5 });
    expect(edited).toHaveLength(3);
  });

  it('numbers features per type and knows when a body exists', () => {
    const list = [box, cylinder, { ...box, id: 'b2' }];
    expect(featureOrdinal(list, 2)).toBe(2);
    expect(featureOrdinal(list, 1)).toBe(1);
    expect(hasBodyBefore(list, 0)).toBe(false);
    expect(hasBodyBefore([{ ...box, suppressed: true }, fillet], 1)).toBe(false);
    expect(hasBodyBefore(list, 1)).toBe(true);
  });
});

describe('number input', () => {
  it.each([
    ['2.5', 2.5],
    ['2,5', 2.5],
    [' 10 ', 10],
    ['-3', -3],
    ['.5', 0.5],
    ['1e3', null],
    ['abc', null],
    ['', null],
    ['1,2,3', null],
  ])('parses %j', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

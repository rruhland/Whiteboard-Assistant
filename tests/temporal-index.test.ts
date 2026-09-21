import { describe, expect, test } from 'vitest';
import { buildTemporalIndex, projectHistory } from '../src/temporal';
import { activeLabels, documentWithAddEraseUndo, documentWithMergeAndSplit, emptyDocument, fixtureDocument, positionOf } from './temporal-fixtures';

describe('temporal index', () => {
  test('dependency-merges source logs and places ink first on equal timestamps', () => {
    const index = buildTemporalIndex(fixtureDocument({ inkTimes: [10, 50], associationTimes: [5, 50], associationStrokeIds: ['stroke-1', 'stroke-2'] }));
    expect(index.entries.map(({ id }) => id)).toEqual(['ink:add-1', 'association:assoc-1', 'ink:add-2', 'association:assoc-2']);
    expect(index.entries.map(({ inkEventCount, associationEventCount }) => [inkEventCount, associationEventCount])).toEqual([[1, 0], [1, 1], [2, 1], [2, 2]]);
  });

  test('starts a segment only after a positive gap greater than thirty seconds', () => {
    const index = buildTemporalIndex(fixtureDocument({ inkTimes: [0, 30_000, 60_001] }));
    expect(index.segments.map(({ startPosition, endPosition }) => [startPosition, endPosition])).toEqual([[1, 2], [3, 3]]);
  });

  test('keeps source order when timestamps regress', () => {
    expect(buildTemporalIndex(fixtureDocument({ inkTimes: [20, 10] })).entries.map(({ eventId }) => eventId)).toEqual(['add-1', 'add-2']);
  });

  test('rejects association events with unmet dependencies', () => {
    expect(() => buildTemporalIndex(fixtureDocument({ inkTimes: [], associationTimes: [1], associationStrokeIds: ['missing'] }))).toThrow(/unmet ink dependencies/);
  });
});

describe('historical projection', () => {
  test('projects start, erased, and restored states without mutating the document', () => {
    const document = documentWithAddEraseUndo();
    const original = structuredClone(document);
    const index = buildTemporalIndex(document);
    expect(projectHistory(document, index, 0).board.strokes).toEqual([]);
    expect(projectHistory(document, index, positionOf(index, 'ink:erase-1')).board.strokes).toEqual([]);
    expect(projectHistory(document, index, positionOf(index, 'ink:undo-1')).board.strokes.map(({ id }) => id)).toEqual(['stroke-1']);
    expect(document).toEqual(original);
  });

  test('projects merge and split lineage at their exact positions', () => {
    const document = documentWithMergeAndSplit();
    const index = buildTemporalIndex(document);
    expect(activeLabels(projectHistory(document, index, positionOf(index, 'association:merge')).associations)).toEqual(['C']);
    expect(activeLabels(projectHistory(document, index, positionOf(index, 'association:split')).associations)).toEqual(['D', 'E']);
  });

  test.each([-1, 4.5, 999])('rejects invalid position %s', (position) => {
    expect(() => projectHistory(emptyDocument, buildTemporalIndex(emptyDocument), position)).toThrow(/position/i);
  });
});

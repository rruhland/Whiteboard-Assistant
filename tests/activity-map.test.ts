import { describe, expect, test } from 'vitest';
import type { AssociationEvent } from '../src/association';
import type { BoardDocumentV2 } from '../src/document';
import { buildActivitySamples, buildTemporalIndex } from '../src/temporal';
import { fixtureDocument, positionOf, stroke } from './temporal-fixtures';

const viewport = { x: 0, y: 0, zoom: 1 };

describe('activity map', () => {
  test('resamples changed ink at sixteen world-unit spacing with ten-second half-life', () => {
    const document = fixtureDocument({ inkTimes: [0, 10_000] });
    document.events[1].changes[0].after!.points = [{ x: 0, y: 20, pressure: 0.5, time: 0 }, { x: 32, y: 20, pressure: 0.5, time: 0 }];
    const index = buildTemporalIndex(document);
    const samples = buildActivitySamples(document, index, index.entries.length);
    expect(samples.filter(({ y }) => y === 0).map(({ x }) => x)).toEqual([0, 16, 32]);
    expect(samples.find(({ x, y }) => x === 0 && y === 0)?.intensity).toBeCloseTo(0.5);
    expect(Math.max(...samples.filter(({ y }) => y === 20).map(({ intensity }) => intensity))).toBeCloseTo(1);
  });

  test('uses before geometry for erase and produces no heat for association-only selection', () => {
    const erased = stroke('erased', 0);
    const eraseDocument: BoardDocumentV2 = { version: 2, viewport, associationEvents: [], events: [
      { id: 'add', time: 0, actor: 'user', kind: 'add', changes: [{ before: null, after: erased }] },
      { id: 'erase', time: 1, actor: 'user', kind: 'erase', changes: [{ before: erased, after: null }] },
    ] };
    const eraseIndex = buildTemporalIndex(eraseDocument);
    expect(buildActivitySamples(eraseDocument, eraseIndex, positionOf(eraseIndex, 'ink:erase')).length).toBeGreaterThan(0);

    const base = fixtureDocument({ inkTimes: [0] });
    const association: AssociationEvent = { id: 'late-association', time: 40_000, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: { id: 'object', label: 'A', strokeIds: ['stroke-1'], createdAt: 40_000, lastAssociatedAt: 40_000, status: 'active', parentIds: [] } }] };
    const associationDocument = { ...base, associationEvents: [association] };
    const associationIndex = buildTemporalIndex(associationDocument);
    expect(buildActivitySamples(associationDocument, associationIndex, associationIndex.entries.length)).toEqual([]);
  });

  test('clamps regressing timestamp age to zero and excludes prior segments', () => {
    const document = fixtureDocument({ inkTimes: [0, 40_000, 30_000] });
    document.events[0].changes[0].after!.points[0].x = 999;
    const index = buildTemporalIndex(document);
    const samples = buildActivitySamples(document, index, index.entries.length);
    expect(samples.every(({ intensity }) => Number.isFinite(intensity) && intensity > 0 && intensity <= 1)).toBe(true);
    expect(samples.some(({ x }) => x === 999)).toBe(false);
  });
});

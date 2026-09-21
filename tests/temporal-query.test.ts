import { describe, expect, test } from 'vitest';
import { getCurrentContext, queryChanges, queryObjectHistory, queryRegionHistory } from '../src/temporal';
import { objectRegionFixture, segmentedFixture } from './temporal-fixtures';

describe('temporal queries', () => {
  test('current context stays in the current segment and honors sincePosition', () => {
    const { document, index } = segmentedFixture();
    const context = getCurrentContext(document, index, index.entries.length - 2);
    expect(context.position).toBe(index.entries.length);
    expect(context.segmentId).toBe(index.segments.at(-1)?.id);
    expect(context.recentEntries.map(({ id }) => id)).toEqual(index.entries.slice(-1).map(({ id }) => id));
    expect(context.visibleStrokeIds).not.toContain('erased-stroke');
  });

  test('change query returns ordered affected IDs without geometry by default', () => {
    const { document, index } = segmentedFixture();
    const result = queryChanges(document, index, 0, index.entries.length);
    expect(result.affectedStrokeIds).toEqual(['erased-stroke', 'recent-stroke']);
    expect(result.entries.map(({ id }) => id)).toEqual(index.entries.map(({ id }) => id));
    expect(result).not.toHaveProperty('strokes');
  });

  test('object query follows ancestors and descendants through the selected prefix', () => {
    const fixture = objectRegionFixture();
    const result = queryObjectHistory(fixture.document, fixture.index, fixture.mergedParentId, { detail: 'geometry' });
    expect(result.lineageObjectIds).toEqual(expect.arrayContaining([fixture.mergedParentId, fixture.mergeChildId, fixture.splitChildId]));
    expect(result.entries.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['manual-merge', 'manual-split']));
    expect(result.objects?.every((object) => object !== fixture.document.associationEvents[0].changes[0].after)).toBe(true);
  });

  test('region query excludes erased strokes unless explicitly requested', () => {
    const fixture = objectRegionFixture();
    const ordinary = queryRegionHistory(fixture.document, fixture.index, fixture.region);
    expect(ordinary.strokeIds).not.toContain(fixture.erasedId);
    expect(ordinary.erasedStrokeIds).toEqual([]);
    const withErased = queryRegionHistory(fixture.document, fixture.index, fixture.region, { includeErased: true, detail: 'geometry' });
    expect(withErased.erasedStrokeIds).toContain(fixture.erasedId);
    expect(withErased.strokes?.map(({ id }) => id)).toContain(fixture.erasedId);
  });

  test('unknown object returns an empty result with the requested ID', () => {
    const fixture = objectRegionFixture();
    expect(queryObjectHistory(fixture.document, fixture.index, 'missing')).toEqual({ objectId: 'missing', throughPosition: fixture.index.entries.length, entries: [], lineageObjectIds: [], memberStrokeIds: [] });
  });

  test('returned geometry and entries are defensive', () => {
    const fixture = objectRegionFixture();
    const first = queryRegionHistory(fixture.document, fixture.index, fixture.region, { includeErased: true, detail: 'geometry' });
    first.entries[0].id = 'changed';
    if (first.strokes?.[0]) first.strokes[0].points[0].x = 999;
    const second = queryRegionHistory(fixture.document, fixture.index, fixture.region, { includeErased: true, detail: 'geometry' });
    expect(second.entries[0].id).not.toBe('changed');
    expect(second.strokes?.[0].points[0].x).not.toBe(999);
  });
});

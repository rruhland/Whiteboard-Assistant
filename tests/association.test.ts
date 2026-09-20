import { describe, expect, test } from 'vitest';
import {
  AssociationModel,
  getObjectBounds,
  getUnassignedVisibleStrokes,
  migrateVersion1,
  projectGraph,
  type AssociationEvent,
  type WorkObject,
} from '../src/association';
import type { Stroke } from '../src/board';

function stroke(id: string, x: number, y: number, createdAt: number, width = 2): Stroke {
  return { id, createdAt, author: 'user', color: '#000', width, points: [{ x, y, pressure: 0.5, time: createdAt }] };
}

const all = [stroke('a', 0, 0, 0), stroke('b', 20, 0, 60_000), stroke('c', 70, 0, 61_000), stroke('d', 200, 0, 62_000)];
const ids = new Set(all.map(({ id }) => id));

describe('AssociationModel', () => {
  test('grows a nearby object after a long gap and a recent object within the wider radius', () => {
    const model = new AssociationModel([], ids);
    const firstId = model.associateStroke(all[0], all.slice(0, 1));
    expect(model.associateStroke(all[1], all.slice(0, 2))).toBe(firstId);
    expect(model.associateStroke(all[2], all.slice(0, 3))).toBe(firstId);
    expect(model.associateStroke(all[3], all)).not.toBe(firstId);
    expect(model.objects.filter(({ status }) => status === 'active').map(({ label }) => label)).toEqual(['A', 'B']);
  });

  test('breaks equal candidates by distance, recency, then stable ID', () => {
    const objects: WorkObject[] = [
      { id: 'work-b', label: 'B', strokeIds: ['a'], createdAt: 0, lastAssociatedAt: 10, status: 'active', parentIds: [] },
      { id: 'work-a', label: 'A', strokeIds: ['b'], createdAt: 0, lastAssociatedAt: 10, status: 'active', parentIds: [] },
    ];
    const event: AssociationEvent = {
      id: 'seed', time: 10, actor: 'system', kind: 'auto-create', reason: 'seed',
      changes: objects.map((after) => ({ before: null, after })),
    };
    const model = new AssociationModel([event], ids);
    expect(model.associateStroke(stroke('c', 10, 0, 11), all.slice(0, 3))).toBe('work-a');
  });

  test('merge supersedes parents and creates one active child with both memberships', () => {
    const model = new AssociationModel([], ids);
    const leftId = model.associateStroke(all[0], [all[0]]);
    const rightId = model.associateStroke(all[3], [all[0], all[3]]);

    const childId = model.mergeObjects([leftId, rightId]);
    const child = model.objects.find(({ id }) => id === childId)!;

    expect(child.parentIds).toEqual([leftId, rightId].sort());
    expect(child.strokeIds).toEqual(['a', 'd']);
    expect(model.objects.filter(({ status }) => status === 'active').map(({ id }) => id)).toEqual([childId]);
  });

  test('failed split is atomic and a valid split records two children', () => {
    const model = new AssociationModel([], ids);
    const singletonId = model.associateStroke(all[0], [all[0]]);
    const before = JSON.stringify(model.events);
    expect(() => model.splitObject(singletonId, 'a')).toThrow(/two member strokes/i);
    expect(JSON.stringify(model.events)).toBe(before);

    model.associateStroke(all[1], all.slice(0, 2));
    const children = model.splitObject(singletonId, 'a');
    expect(children).toHaveLength(2);
    expect(model.objects.filter(({ status }) => status === 'active').map(({ strokeIds }) => strokeIds)).toEqual([['a'], ['b']]);
  });

  test('rejects duplicate active membership and unknown strokes during replay', () => {
    const object = (id: string, strokeId: string): WorkObject => ({ id, label: id, strokeIds: [strokeId], createdAt: 0, lastAssociatedAt: 0, status: 'active', parentIds: [] });
    const duplicate: AssociationEvent = { id: 'e', time: 0, actor: 'system', kind: 'auto-create', reason: '', changes: [
      { before: null, after: object('one', 'a') }, { before: null, after: object('two', 'a') },
    ] };
    expect(() => new AssociationModel([duplicate], ids)).toThrow(/active membership/i);
    expect(() => new AssociationModel([{ ...duplicate, changes: [{ before: null, after: object('one', 'missing') }] }], ids)).toThrow(/unknown stroke/i);
  });

  test('tracks unassigned strokes, bounds, migration, near edges, and lineage', () => {
    const migrated = migrateVersion1([all[1], all[0], all[3]], ids);
    expect(migrated.events[0].id).toBe('assoc-v1-a');
    expect(migrated.objects[0].id).toBe('work-v1-a');
    expect(getUnassignedVisibleStrokes(migrated, all)).toEqual([all[2]]);
    expect(getObjectBounds(migrated.objects[0], all)).toEqual({ minX: -1, minY: -1, maxX: 21, maxY: 1 });

    const active = migrated.objects.filter(({ status }) => status === 'active');
    const child = migrated.mergeObjects(active.map(({ id }) => id));
    const graph = projectGraph(migrated, all);
    expect(graph.edges).toEqual(expect.arrayContaining(active.map(({ id }) => ({ type: 'derived-from', sourceId: child, targetId: id }))));
  });
});

import { describe, expect, test } from 'vitest';
import {
  AssociationModel,
  getObjectBounds,
  getUnassignedVisibleStrokes,
  migrateVersion1,
  projectGraph,
  type AssociationEvent,
  type AnnotationObject,
  type ContentObject,
  type WorkObject,
} from '../src/association';
import type { Stroke } from '../src/board';

function stroke(id: string, x: number, y: number, createdAt: number, width = 2): Stroke {
  return { id, createdAt, author: 'user', color: '#000', width, points: [{ x, y, pressure: 0.5, time: createdAt }] };
}

const all = [stroke('a', 0, 0, 0), stroke('b', 20, 0, 60_000), stroke('c', 70, 0, 61_000), stroke('d', 200, 0, 62_000)];
const ids = new Set(all.map(({ id }) => id));

function contentObject(id: string, strokeIds: string[]): ContentObject {
  return { id, objectType: 'content', label: id, strokeIds, createdAt: 0, lastAssociatedAt: 0, status: 'active', parentIds: [] };
}

function annotationObject(id: string, strokeIds: string[], options: { kind: 'circle' | 'arrow'; relation: 'annotates' | 'points-to'; targetObjectId: string }): AnnotationObject {
  return {
    id, objectType: 'annotation', label: id, strokeIds, createdAt: 1, lastAssociatedAt: 1, status: 'active', parentIds: [],
    annotationKind: options.kind, links: [{ type: options.relation, targetObjectId: options.targetObjectId }],
    proposalId: `proposal-${id}`, contextPosition: 0, createdBy: 'assistant', approvedAt: 1,
  };
}

function createEvent(id: string, kind: AssociationEvent['kind'], changes: AssociationEvent['changes']): AssociationEvent {
  return { id, time: kind === 'assistant-annotation' ? 1 : 0, actor: kind === 'assistant-annotation' ? 'user' : 'system', kind, reason: 'test', changes };
}

describe('AssociationModel', () => {
  test('creates an annotation linked to an active content object', () => {
    const target = contentObject('target', ['a']);
    const annotation = annotationObject('note', ['b', 'c'], { kind: 'arrow', relation: 'points-to', targetObjectId: target.id });
    const model = new AssociationModel([
      createEvent('content', 'auto-create', [{ before: null, after: target }]),
      createEvent('annotation', 'assistant-annotation', [{ before: null, after: annotation }]),
    ], ids);
    expect(projectGraph(model, all).edges).toContainEqual({ type: 'points-to', sourceId: 'note', targetId: 'target' });
  });

  test('rejects annotation links to missing or annotation targets', () => {
    const missing = annotationObject('note', ['b'], { kind: 'circle', relation: 'annotates', targetObjectId: 'missing' });
    expect(() => new AssociationModel([createEvent('annotation', 'assistant-annotation', [{ before: null, after: missing }])], ids)).toThrow(/target/i);
    const target = annotationObject('target-note', ['a'], { kind: 'circle', relation: 'annotates', targetObjectId: 'content' });
    const source = annotationObject('source-note', ['b'], { kind: 'arrow', relation: 'points-to', targetObjectId: target.id });
    const content = contentObject('content', ['c']);
    expect(() => new AssociationModel([
      createEvent('content', 'auto-create', [{ before: null, after: content }]),
      createEvent('target', 'assistant-annotation', [{ before: null, after: target }]),
      createEvent('source', 'assistant-annotation', [{ before: null, after: source }]),
    ], ids)).toThrow(/content object/i);
  });

  test('content correction operations never accept annotation objects', () => {
    const left = contentObject('content-a', ['a']);
    const right = contentObject('content-b', ['b']);
    const annotation = annotationObject('annotation-a', ['c'], { kind: 'circle', relation: 'annotates', targetObjectId: left.id });
    const model = new AssociationModel([
      createEvent('left', 'auto-create', [{ before: null, after: left }]),
      createEvent('right', 'auto-create', [{ before: null, after: right }]),
      createEvent('annotation', 'assistant-annotation', [{ before: null, after: annotation }]),
    ], ids);
    expect(() => model.mergeObjects(['content-a', 'annotation-a'])).toThrow(/content/i);
    expect(() => model.splitObject('annotation-a', 'c')).toThrow(/content/i);
    expect(() => model.assignStroke('d', 'annotation-a')).toThrow(/content/i);
  });

  test('projects annotation links and derives erased visibility from member strokes', () => {
    const target = contentObject('target', ['a']);
    const annotation = annotationObject('note', ['b'], { kind: 'circle', relation: 'annotates', targetObjectId: target.id });
    const model = new AssociationModel([
      createEvent('content', 'auto-create', [{ before: null, after: target }]),
      createEvent('annotation', 'assistant-annotation', [{ before: null, after: annotation }]),
    ], ids);
    const graph = projectGraph(model, all.filter(({ id }) => id !== 'b'));
    expect(graph.edges).toContainEqual({ type: 'annotates', sourceId: annotation.id, targetId: target.id });
    expect(graph.nodes.find(({ id }) => id === annotation.id)).toMatchObject({ objectType: 'annotation', visibleStrokeCount: 0 });
  });

  test('does not create near edges from annotation nodes', () => {
    const target = contentObject('target', ['a']);
    const annotation = annotationObject('annotation', ['b'], { kind: 'circle', relation: 'annotates', targetObjectId: target.id });
    const model = new AssociationModel([
      createEvent('content', 'auto-create', [{ before: null, after: target }]),
      createEvent('annotation-event', 'assistant-annotation', [{ before: null, after: annotation }]),
    ], ids);
    expect(projectGraph(model, all).edges.filter(({ type }) => type === 'near').every(({ sourceId, targetId }) => ![sourceId, targetId].includes('annotation'))).toBe(true);
  });

  test('keeps annotation links on the original stable target after content merge', () => {
    const target = contentObject('target', ['a']);
    const other = contentObject('other', ['c']);
    const annotation = annotationObject('note', ['b'], { kind: 'circle', relation: 'annotates', targetObjectId: target.id });
    const model = new AssociationModel([
      createEvent('content', 'auto-create', [{ before: null, after: target }]),
      createEvent('other', 'auto-create', [{ before: null, after: other }]),
      createEvent('annotation', 'assistant-annotation', [{ before: null, after: annotation }]),
    ], ids);
    const childId = model.mergeObjects([target.id, other.id]);
    const edge = projectGraph(model, all).edges.find(({ sourceId, type }) => sourceId === annotation.id && type === 'annotates');
    expect(edge?.targetId).toBe(target.id);
    expect(edge?.targetId).not.toBe(childId);
  });
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
      { objectType: 'content', id: 'work-b', label: 'B', strokeIds: ['a'], createdAt: 10, lastAssociatedAt: 10, status: 'active', parentIds: [] },
      { objectType: 'content', id: 'work-a', label: 'A', strokeIds: ['b'], createdAt: 10, lastAssociatedAt: 10, status: 'active', parentIds: [] },
    ];
    const events: AssociationEvent[] = objects.map((after, index) => ({
      id: `seed-${index}`, time: 10, actor: 'system', kind: 'auto-create', reason: 'seed', changes: [{ before: null, after }],
    }));
    const model = new AssociationModel(events, ids);
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
    const object = (id: string, strokeId: string): WorkObject => ({ objectType: 'content', id, label: id, strokeIds: [strokeId], createdAt: 0, lastAssociatedAt: 0, status: 'active', parentIds: [] });
    const first: AssociationEvent = { id: 'e1', time: 0, actor: 'system', kind: 'auto-create', reason: '', changes: [{ before: null, after: object('one', 'a') }] };
    const duplicate: AssociationEvent = { id: 'e2', time: 0, actor: 'system', kind: 'auto-create', reason: '', changes: [{ before: null, after: object('two', 'a') }] };
    expect(() => new AssociationModel([first, duplicate], ids)).toThrow(/active membership/i);
    expect(() => new AssociationModel([{ ...first, changes: [{ before: null, after: object('one', 'missing') }] }], ids)).toThrow(/unknown stroke/i);
  });

  test('rejects structurally possible transitions that violate their event kind', () => {
    const before: WorkObject = { objectType: 'content', id: 'one', label: 'A', strokeIds: ['a'], createdAt: 0, lastAssociatedAt: 0, status: 'active', parentIds: [] };
    const seed: AssociationEvent = { id: 'seed', time: 0, actor: 'system', kind: 'auto-create', reason: '', changes: [{ before: null, after: before }] };
    const impossible: AssociationEvent = { id: 'bad', time: 1, actor: 'system', kind: 'auto-append', reason: '', changes: [{ before, after: null }] };
    expect(() => new AssociationModel([seed, impossible], ids)).toThrow(/auto-append/i);
  });

  test('accepts an equivalent before snapshot with reordered object keys', () => {
    const before: WorkObject = { objectType: 'content', id: 'one', label: 'A', strokeIds: ['a'], createdAt: 0, lastAssociatedAt: 0, status: 'active', parentIds: [] };
    const reordered = { parentIds: [], status: 'active' as const, lastAssociatedAt: 0, createdAt: 0, strokeIds: ['a'], label: 'A', id: 'one', objectType: 'content' as const };
    const after: WorkObject = { ...before, strokeIds: ['a', 'b'], lastAssociatedAt: 1 };
    expect(() => new AssociationModel([
      { id: 'seed', time: 0, actor: 'system', kind: 'auto-create', reason: '', changes: [{ before: null, after: before }] },
      { id: 'append', time: 1, actor: 'system', kind: 'auto-append', reason: '', changes: [{ before: reordered, after }] },
    ], ids)).not.toThrow();
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

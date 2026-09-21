import type { AnnotationObject, AssociationEvent, AssociationModel, Bounds, ContentObject, WorkObject } from '../src/association';
import type { BoardEvent, Stroke } from '../src/board';
import type { BoardDocumentV3 } from '../src/document';
import type { TemporalIndex } from '../src/temporal';
import { buildTemporalIndex } from '../src/temporal';

const viewport = { x: 0, y: 0, zoom: 1 };
const point = (x: number, y = 0) => ({ x, y, pressure: 0.5, time: 0 });
export const stroke = (id: string, createdAt: number, x = 0, y = 0): Stroke => ({ id, createdAt, author: 'user', color: '#111', width: 2, points: [point(x, y), point(x + 32, y)] });
const object = (id: string, label: string, strokeIds: string[], time: number, status: WorkObject['status'] = 'active', parentIds: string[] = []): WorkObject => ({ objectType: 'content', id, label, strokeIds, createdAt: time, lastAssociatedAt: time, status, parentIds });

export const emptyDocument: BoardDocumentV3 = { version: 3, events: [], associationEvents: [], viewport };

export function fixtureDocument(options: { inkTimes: number[]; associationTimes?: number[]; associationStrokeIds?: string[] }): BoardDocumentV3 {
  const events = options.inkTimes.map((time, index): BoardEvent => {
    const value = stroke(`stroke-${index + 1}`, time, index * 50);
    return { id: `add-${index + 1}`, time, actor: 'user', kind: 'add', changes: [{ before: null, after: value }] };
  });
  const associationEvents = (options.associationTimes ?? []).map((time, index): AssociationEvent => {
    const strokeId = options.associationStrokeIds?.[index] ?? `stroke-${index + 1}`;
    return { id: `assoc-${index + 1}`, time, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: object(`object-${index + 1}`, String.fromCharCode(65 + index), [strokeId], time) }] };
  });
  return { version: 3, events, associationEvents, viewport };
}

export function documentWithAddEraseUndo(): BoardDocumentV3 {
  const value = stroke('stroke-1', 1);
  return { version: 3, viewport, associationEvents: [], events: [
    { id: 'add-1', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: value }] },
    { id: 'erase-1', time: 2, actor: 'user', kind: 'erase', changes: [{ before: value, after: null }] },
    { id: 'undo-1', time: 3, actor: 'user', kind: 'undo', targetId: 'erase-1', changes: [{ before: null, after: value }] },
  ] };
}

export function documentWithMergeAndSplit(): BoardDocumentV3 {
  const a = stroke('stroke-a', 1, 0);
  const b = stroke('stroke-b', 2, 50);
  const A = object('A', 'A', [a.id], 1);
  const B = object('B', 'B', [b.id], 2);
  const As = { ...A, status: 'superseded' as const };
  const Bs = { ...B, status: 'superseded' as const };
  const C = object('C', 'C', [a.id, b.id], 3, 'active', ['A', 'B']);
  const Cs = { ...C, status: 'superseded' as const };
  const D = object('D', 'D', [a.id], 4, 'active', ['C']);
  const E = object('E', 'E', [b.id], 4, 'active', ['C']);
  return { version: 3, viewport, events: [
    { id: 'add-a', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: a }] },
    { id: 'add-b', time: 2, actor: 'user', kind: 'add', changes: [{ before: null, after: b }] },
  ], associationEvents: [
    { id: 'create-a', time: 1, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: A }] },
    { id: 'create-b', time: 2, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: B }] },
    { id: 'merge', time: 3, actor: 'user', kind: 'manual-merge', reason: 'fixture', changes: [{ before: A, after: As }, { before: B, after: Bs }, { before: null, after: C }] },
    { id: 'split', time: 4, actor: 'user', kind: 'manual-split', reason: 'fixture', changes: [{ before: C, after: Cs }, { before: null, after: D }, { before: null, after: E }] },
  ] };
}

export function positionOf(index: TemporalIndex, id: string): number {
  const position = index.entries.findIndex((entry) => entry.id === id) + 1;
  if (!position) throw new Error(`Missing timeline entry ${id}`);
  return position;
}

export function activeLabels(model: AssociationModel): string[] {
  return model.objects.filter(({ status }) => status === 'active').map(({ label }) => label).sort();
}

export type ObjectRegionFixture = { document: BoardDocumentV3; index: TemporalIndex; mergedParentId: string; mergeChildId: string; splitChildId: string; erasedId: string; region: Bounds };

export function segmentedFixture(): { document: BoardDocumentV3; index: TemporalIndex; erasedId: string } {
  const erasedId = 'erased-stroke';
  const erased = stroke(erasedId, 0, 0);
  const recent = stroke('recent-stroke', 40_001, 100);
  const document: BoardDocumentV3 = { version: 3, viewport, associationEvents: [], events: [
    { id: 'add-old', time: 0, actor: 'user', kind: 'add', changes: [{ before: null, after: erased }] },
    { id: 'erase-old', time: 1, actor: 'user', kind: 'erase', changes: [{ before: erased, after: null }] },
    { id: 'add-recent', time: 40_001, actor: 'user', kind: 'add', changes: [{ before: null, after: recent }] },
  ] };
  return { document, index: buildTemporalIndex(document), erasedId };
}

export function objectRegionFixture(): ObjectRegionFixture {
  const base = documentWithMergeAndSplit();
  const erasedId = 'erased-region';
  const erased = stroke(erasedId, 5, 8, 8);
  const document: BoardDocumentV3 = { ...base, events: [...base.events,
    { id: 'add-erased', time: 5, actor: 'user', kind: 'add', changes: [{ before: null, after: erased }] },
    { id: 'erase-region', time: 6, actor: 'user', kind: 'erase', changes: [{ before: erased, after: null }] },
  ] };
  return { document, index: buildTemporalIndex(document), mergedParentId: 'A', mergeChildId: 'C', splitChildId: 'D', erasedId, region: { minX: -5, minY: -5, maxX: 45, maxY: 15 } };
}

export function version3AnnotationFixture(options: { associationTime?: number; inkTime?: number } = {}): BoardDocumentV3 {
  const targetStroke = stroke('target-stroke', -1, 0);
  const assistantStrokes = [0, 1, 2].map((index): Stroke => ({ ...stroke(`assistant-${index}`, options.inkTime ?? 10, 80 + index * 12), author: 'assistant' }));
  const target: ContentObject = { objectType: 'content', id: 'target', label: 'Target', strokeIds: [targetStroke.id], createdAt: -1, lastAssociatedAt: -1, status: 'active', parentIds: [] };
  const annotation: AnnotationObject = { objectType: 'annotation', id: 'annotation', label: 'Assistant arrow', strokeIds: assistantStrokes.map(({ id }) => id), createdAt: options.associationTime ?? 10, lastAssociatedAt: options.associationTime ?? 10, status: 'active', parentIds: [], annotationKind: 'arrow', links: [{ type: 'points-to', targetObjectId: target.id }], proposalId: 'proposal', contextPosition: 2, createdBy: 'assistant', approvedAt: options.associationTime ?? 10 };
  return { version: 3, viewport, events: [
    { id: 'target-add', time: -1, actor: 'user', kind: 'add', changes: [{ before: null, after: targetStroke }] },
    { id: 'assistant-add', time: options.inkTime ?? 10, actor: 'assistant', kind: 'add', changes: assistantStrokes.map((after) => ({ before: null, after })) },
  ], associationEvents: [
    { id: 'target-create', time: -1, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: target }] },
    { id: 'annotation-create', time: options.associationTime ?? 10, actor: 'user', kind: 'assistant-annotation', reason: 'approved', changes: [{ before: null, after: annotation }] },
  ] };
}

export function annotationLifecycleFixture() {
  const base = version3AnnotationFixture();
  const assistant = base.events[1].changes.map(({ after }) => after as Stroke);
  const partial = { id: 'partial-erase', time: 20, actor: 'user' as const, kind: 'erase' as const, changes: [{ before: assistant[2], after: null }] };
  const deletion = { id: 'delete-annotation', time: 30, actor: 'user' as const, kind: 'erase' as const, changes: assistant.slice(0, 2).map((before) => ({ before, after: null })) };
  const undo = { id: 'undo-delete', time: 40, actor: 'user' as const, kind: 'undo' as const, targetId: deletion.id, changes: deletion.changes.map(({ before }) => ({ before: null, after: before })) };
  const document: BoardDocumentV3 = { ...base, events: [...base.events, partial, deletion, undo] };
  const index = buildTemporalIndex(document);
  return { document, index, positions: { approved: positionOf(index, 'association:annotation-create'), partialErase: positionOf(index, 'ink:partial-erase'), deleted: positionOf(index, 'ink:delete-annotation'), undoDelete: positionOf(index, 'ink:undo-delete') } };
}

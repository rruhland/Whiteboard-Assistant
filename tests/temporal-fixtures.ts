import type { AssociationEvent, AssociationModel, Bounds, WorkObject } from '../src/association';
import type { BoardEvent, Stroke } from '../src/board';
import type { BoardDocumentV2 } from '../src/document';
import type { TemporalIndex } from '../src/temporal';
import { buildTemporalIndex } from '../src/temporal';

const viewport = { x: 0, y: 0, zoom: 1 };
const point = (x: number, y = 0) => ({ x, y, pressure: 0.5, time: 0 });
export const stroke = (id: string, createdAt: number, x = 0, y = 0): Stroke => ({ id, createdAt, author: 'user', color: '#111', width: 2, points: [point(x, y), point(x + 32, y)] });
const object = (id: string, label: string, strokeIds: string[], time: number, status: WorkObject['status'] = 'active', parentIds: string[] = []): WorkObject => ({ id, label, strokeIds, createdAt: time, lastAssociatedAt: time, status, parentIds });

export const emptyDocument: BoardDocumentV2 = { version: 2, events: [], associationEvents: [], viewport };

export function fixtureDocument(options: { inkTimes: number[]; associationTimes?: number[]; associationStrokeIds?: string[] }): BoardDocumentV2 {
  const events = options.inkTimes.map((time, index): BoardEvent => {
    const value = stroke(`stroke-${index + 1}`, time, index * 50);
    return { id: `add-${index + 1}`, time, actor: 'user', kind: 'add', changes: [{ before: null, after: value }] };
  });
  const associationEvents = (options.associationTimes ?? []).map((time, index): AssociationEvent => {
    const strokeId = options.associationStrokeIds?.[index] ?? `stroke-${index + 1}`;
    return { id: `assoc-${index + 1}`, time, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: object(`object-${index + 1}`, String.fromCharCode(65 + index), [strokeId], time) }] };
  });
  return { version: 2, events, associationEvents, viewport };
}

export function documentWithAddEraseUndo(): BoardDocumentV2 {
  const value = stroke('stroke-1', 1);
  return { version: 2, viewport, associationEvents: [], events: [
    { id: 'add-1', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: value }] },
    { id: 'erase-1', time: 2, actor: 'user', kind: 'erase', changes: [{ before: value, after: null }] },
    { id: 'undo-1', time: 3, actor: 'user', kind: 'undo', targetId: 'erase-1', changes: [{ before: null, after: value }] },
  ] };
}

export function documentWithMergeAndSplit(): BoardDocumentV2 {
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
  return { version: 2, viewport, events: [
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

export type ObjectRegionFixture = { document: BoardDocumentV2; index: TemporalIndex; mergedParentId: string; mergeChildId: string; splitChildId: string; erasedId: string; region: Bounds };

export function segmentedFixture(): { document: BoardDocumentV2; index: TemporalIndex; erasedId: string } {
  const erasedId = 'erased-stroke';
  const erased = stroke(erasedId, 0, 0);
  const recent = stroke('recent-stroke', 40_001, 100);
  const document: BoardDocumentV2 = { version: 2, viewport, associationEvents: [], events: [
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
  const document: BoardDocumentV2 = { ...base, events: [...base.events,
    { id: 'add-erased', time: 5, actor: 'user', kind: 'add', changes: [{ before: null, after: erased }] },
    { id: 'erase-region', time: 6, actor: 'user', kind: 'erase', changes: [{ before: erased, after: null }] },
  ] };
  return { document, index: buildTemporalIndex(document), mergedParentId: 'A', mergeChildId: 'C', splitChildId: 'D', erasedId, region: { minX: -5, minY: -5, maxX: 45, maxY: 15 } };
}

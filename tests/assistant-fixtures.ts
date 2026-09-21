import { AssociationModel, type AssociationEvent, type ContentObject } from '../src/association';
import type { BoardEvent, Stroke } from '../src/board';
import type { BoardDocumentV3 } from '../src/document';
import { buildTemporalIndex, type TemporalIndex } from '../src/temporal';

export type PlannerFixture = { document: BoardDocumentV3; index: TemporalIndex; associations: AssociationModel };

const viewport = { x: 0, y: 0, zoom: 1 };
const makeStroke = (id: string, x: number, y: number, time: number, author: Stroke['author'] = 'user', points?: Stroke['points']): Stroke => ({
  id, createdAt: time, author, color: '#111', width: 2,
  points: points ?? [{ x, y, pressure: 0.5, time }, { x: x + 20, y: y + 10, pressure: 0.5, time }],
});

function fixture(strokes: Stroke[], content: Array<{ id: string; strokeId: string; time: number }>): PlannerFixture {
  const events: BoardEvent[] = strokes.map((value, index) => ({ id: `add-${value.id}`, time: value.createdAt, actor: value.author, kind: 'add', changes: [{ before: null, after: value }] }));
  const associationEvents: AssociationEvent[] = content.map(({ id, strokeId, time }, index) => {
    const object: ContentObject = { objectType: 'content', id, label: `Object ${index + 1}`, strokeIds: [strokeId], createdAt: time, lastAssociatedAt: time, status: 'active', parentIds: [] };
    return { id: `assoc-${id}`, time, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: object }] };
  });
  const document: BoardDocumentV3 = { version: 3, events, associationEvents, viewport };
  return { document, index: buildTemporalIndex(document), associations: new AssociationModel(associationEvents, new Set(strokes.map(({ id }) => id))) };
}

export function plannerFixture(options: { currentSegmentStrokeOrder?: string[]; bounds?: { minX: number; minY: number; maxX: number; maxY: number } } = {}): PlannerFixture {
  if (options.bounds) {
    const { minX, minY, maxX, maxY } = options.bounds;
    const value = makeStroke('recent-object-stroke', minX, minY, 10, 'user', [{ x: minX, y: minY, pressure: 0.5, time: 10 }, { x: maxX, y: maxY, pressure: 0.5, time: 10 }]);
    return fixture([value], [{ id: 'recent-object', strokeId: value.id, time: 10 }]);
  }
  const order = options.currentSegmentStrokeOrder ?? ['old-object-stroke', 'recent-object-stroke'];
  const values = order.map((id, index) => makeStroke(id, index * 100, 0, 10 + index));
  return fixture(values, values.map((value) => ({ id: value.id.replace('-stroke', ''), strokeId: value.id, time: value.createdAt })));
}

export const emptyPlannerFixture = (): PlannerFixture => fixture([], []);

export function annotationOnlyFixture(): PlannerFixture {
  const erased = makeStroke('content-stroke', 0, 0, 1);
  const assistant = makeStroke('annotation-stroke', 40, 0, 3, 'assistant');
  const base = fixture([erased, assistant], [{ id: 'erased-content', strokeId: erased.id, time: 1 }]);
  base.document.events.push({ id: 'erase-content', time: 2, actor: 'user', kind: 'erase', changes: [{ before: erased, after: null }] });
  base.index = buildTemporalIndex(base.document);
  return base;
}

export function annotationDominatedFixture(): PlannerFixture {
  const content = makeStroke('content-stroke', 0, 0, 1);
  const assistant = makeStroke('annotation-stroke', 60, 0, 2, 'assistant');
  return fixture([content, assistant], [{ id: 'content-latest', strokeId: content.id, time: 1 }]);
}

export function regressingPlannerFixture(options: { firstTime: number; secondTime: number }): PlannerFixture {
  const first = makeStroke('first-stroke', 0, 0, options.firstTime);
  const second = makeStroke('second-stroke', 100, 0, options.secondTime);
  return fixture([first, second], [
    { id: 'first-source-entry-object', strokeId: first.id, time: options.firstTime },
    { id: 'second-source-entry-object', strokeId: second.id, time: options.secondTime },
  ]);
}

function withBlockers(blockers: Stroke[]): PlannerFixture {
  const target = makeStroke('target-stroke', 0, 0, 1);
  return fixture([target, ...blockers], [{ id: 'target', strokeId: target.id, time: 1 }]);
}

export const clearBoardFixture = (): PlannerFixture => withBlockers([]);
export const rightBlockedFixture = (): PlannerFixture => withBlockers([
  makeStroke('right-block', 25, -30, 2, 'user', [{ x: 25, y: -30, pressure: 0.5, time: 2 }, { x: 90, y: 40, pressure: 0.5, time: 2 }]),
]);
export const crowdedFixture = (): PlannerFixture => withBlockers([
  makeStroke('right-block', 25, -50, 2, 'user', [{ x: 25, y: -50, pressure: 0.5, time: 2 }, { x: 100, y: 60, pressure: 0.5, time: 2 }]),
  makeStroke('left-block', -100, -50, 3, 'user', [{ x: -100, y: -50, pressure: 0.5, time: 3 }, { x: 0, y: 60, pressure: 0.5, time: 3 }]),
  makeStroke('vertical-block', -30, -100, 4, 'user', [{ x: -30, y: -100, pressure: 0.5, time: 4 }, { x: 50, y: 100, pressure: 0.5, time: 4 }]),
]);

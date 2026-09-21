import { AssociationModel, type AssociationEvent, type AssociationEventKind, type Bounds, type WorkObject } from './association';
import { BoardModel, type BoardEvent, type BoardEventKind, type Stroke } from './board';
import type { BoardDocumentV2 } from './document';

export type TimelineSource = 'ink' | 'association';
export type TimelineEntry = {
  id: string;
  source: TimelineSource;
  eventId: string;
  kind: BoardEventKind | AssociationEventKind;
  time: number;
  inkEventCount: number;
  associationEventCount: number;
  segmentId: string;
};
export type ActivitySegment = {
  id: string;
  startPosition: number;
  endPosition: number;
  startedAt: number;
  endedAt: number;
  inkEventCount: number;
  associationEventCount: number;
};
export type TemporalIndex = {
  entries: TimelineEntry[];
  segments: ActivitySegment[];
  totalInkEvents: number;
  totalAssociationEvents: number;
};
export type HistoricalProjection = {
  position: number;
  entry: TimelineEntry | null;
  segment: ActivitySegment | null;
  board: BoardModel;
  associations: AssociationModel;
};
export type TemporalDetail = 'summary' | 'geometry';
export type CurrentContext = {
  position: number;
  segmentId: string | null;
  visibleStrokeCount: number;
  activeObjectCount: number;
  visibleStrokeIds: string[];
  activeObjectIds: string[];
  recentEntries: TimelineEntry[];
};
export type TemporalChangeResult = {
  fromPosition: number;
  toPosition: number;
  entries: TimelineEntry[];
  affectedStrokeIds: string[];
  affectedObjectIds: string[];
  strokes?: Stroke[];
};
export type TemporalObjectResult = {
  objectId: string;
  throughPosition: number;
  entries: TimelineEntry[];
  lineageObjectIds: string[];
  memberStrokeIds: string[];
  objects?: WorkObject[];
  strokes?: Stroke[];
};
export type TemporalRegionResult = {
  bounds: Bounds;
  throughPosition: number;
  entries: TimelineEntry[];
  strokeIds: string[];
  erasedStrokeIds: string[];
  strokes?: Stroke[];
};
export type ActivitySample = { x: number; y: number; intensity: number };

function strokeIds(event: BoardEvent | AssociationEvent): string[] {
  return event.changes.flatMap(({ before, after }) => {
    if ('strokeIds' in (after ?? before ?? {})) {
      const object = after ?? before;
      return object && 'strokeIds' in object ? object.strokeIds : [];
    }
    const stroke = after ?? before;
    return stroke && 'id' in stroke ? [stroke.id] : [];
  });
}

export function buildTemporalIndex(document: BoardDocumentV2): TemporalIndex {
  const entries: TimelineEntry[] = [];
  const seenStrokes = new Set<string>();
  let inkEventCount = 0;
  let associationEventCount = 0;

  const consumeInk = (event: BoardEvent) => {
    inkEventCount += 1;
    strokeIds(event).forEach((id) => seenStrokes.add(id));
    entries.push({ id: `ink:${event.id}`, source: 'ink', eventId: event.id, kind: event.kind, time: event.time, inkEventCount, associationEventCount, segmentId: '' });
  };
  const consumeAssociation = (event: AssociationEvent) => {
    associationEventCount += 1;
    entries.push({ id: `association:${event.id}`, source: 'association', eventId: event.id, kind: event.kind, time: event.time, inkEventCount, associationEventCount, segmentId: '' });
  };

  while (inkEventCount < document.events.length || associationEventCount < document.associationEvents.length) {
    const ink = document.events[inkEventCount];
    const association = document.associationEvents[associationEventCount];
    if (!association) {
      consumeInk(ink);
      continue;
    }
    const eligible = strokeIds(association).every((id) => seenStrokes.has(id));
    if (!eligible) {
      if (!ink) throw new Error(`Association event ${association.id} has unmet ink dependencies`);
      consumeInk(ink);
      continue;
    }
    if (!ink || association.time < ink.time) consumeAssociation(association);
    else consumeInk(ink);
  }

  const segments: ActivitySegment[] = [];
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    const startsSegment = !previous || (entry.time > previous.time && entry.time - previous.time > 30_000);
    if (startsSegment) {
      segments.push({
        id: `segment-${segments.length + 1}`,
        startPosition: index + 1,
        endPosition: index + 1,
        startedAt: entry.time,
        endedAt: entry.time,
        inkEventCount: 0,
        associationEventCount: 0,
      });
    }
    const segment = segments.at(-1) as ActivitySegment;
    entry.segmentId = segment.id;
    segment.endPosition = index + 1;
    segment.endedAt = entry.time;
    if (entry.source === 'ink') segment.inkEventCount += 1;
    else segment.associationEventCount += 1;
  }

  return { entries, segments, totalInkEvents: document.events.length, totalAssociationEvents: document.associationEvents.length };
}

export function projectHistory(document: BoardDocumentV2, index: TemporalIndex, position: number): HistoricalProjection {
  if (!Number.isInteger(position) || position < 0 || position > index.entries.length) {
    throw new Error(`History position must be an integer from 0 to ${index.entries.length}`);
  }
  const entry = position === 0 ? null : index.entries[position - 1];
  if (entry && (entry.inkEventCount < 0 || entry.inkEventCount > document.events.length || entry.associationEventCount < 0 || entry.associationEventCount > document.associationEvents.length)) {
    throw new Error(`History position ${position} has invalid prefix counts`);
  }
  const inkEvents = document.events.slice(0, entry?.inkEventCount ?? 0);
  const associationEvents = document.associationEvents.slice(0, entry?.associationEventCount ?? 0);
  const knownStrokeIds = new Set(inkEvents.flatMap(strokeIds));
  const segment = entry ? index.segments.find(({ id }) => id === entry.segmentId) ?? null : null;
  return {
    position,
    entry: entry ? structuredClone(entry) : null,
    segment: segment ? structuredClone(segment) : null,
    board: new BoardModel({ events: inkEvents }),
    associations: new AssociationModel(associationEvents, knownStrokeIds),
  };
}

function validatePosition(index: TemporalIndex, position: number, label = 'position'): void {
  if (!Number.isInteger(position) || position < 0 || position > index.entries.length) {
    throw new Error(`${label} must be an integer from 0 to ${index.entries.length}`);
  }
}

function inkEvent(document: BoardDocumentV2, entry: TimelineEntry): BoardEvent | undefined {
  return entry.source === 'ink' ? document.events[entry.inkEventCount - 1] : undefined;
}

function associationEvent(document: BoardDocumentV2, entry: TimelineEntry): AssociationEvent | undefined {
  return entry.source === 'association' ? document.associationEvents[entry.associationEventCount - 1] : undefined;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function cloneEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return structuredClone(entries);
}

export function getCurrentContext(document: BoardDocumentV2, index: TemporalIndex, sincePosition?: number): CurrentContext {
  const position = index.entries.length;
  if (sincePosition !== undefined) validatePosition(index, sincePosition, 'sincePosition');
  const projection = projectHistory(document, index, position);
  const segment = index.segments.at(-1) ?? null;
  const start = Math.max(segment ? segment.startPosition - 1 : position, sincePosition ?? 0);
  const visibleStrokeIds = projection.board.strokes.map(({ id }) => id);
  const activeObjectIds = projection.associations.objects.filter(({ status }) => status === 'active').map(({ id }) => id);
  return {
    position,
    segmentId: segment?.id ?? null,
    visibleStrokeCount: visibleStrokeIds.length,
    activeObjectCount: activeObjectIds.length,
    visibleStrokeIds,
    activeObjectIds,
    recentEntries: cloneEntries(index.entries.slice(start)),
  };
}

export function queryChanges(
  document: BoardDocumentV2,
  index: TemporalIndex,
  fromPosition: number,
  toPosition: number,
  options: { detail?: TemporalDetail } = {},
): TemporalChangeResult {
  validatePosition(index, fromPosition, 'fromPosition');
  validatePosition(index, toPosition, 'toPosition');
  if (fromPosition > toPosition) throw new Error('fromPosition must not exceed toPosition');
  const entries = index.entries.slice(fromPosition, toPosition);
  const strokeIds: string[] = [];
  const objectIds: string[] = [];
  const snapshots = new Map<string, Stroke>();
  for (const entry of entries) {
    const ink = inkEvent(document, entry);
    if (ink) for (const change of ink.changes) {
      const value = change.after ?? change.before;
      if (!value) continue;
      strokeIds.push(value.id);
      snapshots.set(value.id, structuredClone(value));
    }
    const association = associationEvent(document, entry);
    if (association) for (const change of association.changes) {
      const value = change.after ?? change.before;
      if (value) objectIds.push(value.id);
    }
  }
  return {
    fromPosition,
    toPosition,
    entries: cloneEntries(entries),
    affectedStrokeIds: uniqueSorted(strokeIds),
    affectedObjectIds: uniqueSorted(objectIds),
    ...(options.detail === 'geometry' ? { strokes: [...snapshots.values()].map((stroke) => structuredClone(stroke)) } : {}),
  };
}

export function queryObjectHistory(
  document: BoardDocumentV2,
  index: TemporalIndex,
  objectId: string,
  options: { throughPosition?: number; detail?: TemporalDetail } = {},
): TemporalObjectResult {
  const throughPosition = options.throughPosition ?? index.entries.length;
  validatePosition(index, throughPosition, 'throughPosition');
  const prefix = index.entries.slice(0, throughPosition);
  const objects = new Map<string, WorkObject>();
  for (const entry of prefix) {
    const event = associationEvent(document, entry);
    event?.changes.forEach(({ before, after }) => {
      if (before) objects.set(before.id, structuredClone(before));
      if (after) objects.set(after.id, structuredClone(after));
    });
  }
  if (!objects.has(objectId)) return { objectId, throughPosition, entries: [], lineageObjectIds: [], memberStrokeIds: [] };
  const lineage = new Set([objectId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of objects.values()) {
      if (lineage.has(object.id) || object.parentIds.some((id) => lineage.has(id))) {
        if (!lineage.has(object.id)) { lineage.add(object.id); changed = true; }
        for (const parentId of object.parentIds) if (!lineage.has(parentId)) { lineage.add(parentId); changed = true; }
      }
    }
  }
  const entries = prefix.filter((entry) => associationEvent(document, entry)?.changes.some(({ before, after }) => lineage.has((after ?? before)?.id ?? '')));
  const selectedObjects = [...objects.values()].filter(({ id }) => lineage.has(id));
  const memberStrokeIds = uniqueSorted(selectedObjects.flatMap(({ strokeIds }) => strokeIds));
  const strokeSnapshots = new Map<string, Stroke>();
  for (const event of document.events.slice(0, prefix.at(-1)?.inkEventCount ?? 0)) for (const change of event.changes) {
    const value = change.after ?? change.before;
    if (value && memberStrokeIds.includes(value.id)) strokeSnapshots.set(value.id, structuredClone(value));
  }
  return {
    objectId,
    throughPosition,
    entries: cloneEntries(entries),
    lineageObjectIds: uniqueSorted(lineage),
    memberStrokeIds,
    ...(options.detail === 'geometry' ? { objects: structuredClone(selectedObjects), strokes: [...strokeSnapshots.values()] } : {}),
  };
}

function assertBounds(bounds: Bounds): void {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new Error('bounds must contain finite ordered coordinates');
  }
}

function intersects(stroke: Stroke, bounds: Bounds): boolean {
  const radius = stroke.width / 2;
  const xs = stroke.points.map(({ x }) => x);
  const ys = stroke.points.map(({ y }) => y);
  const strokeBounds = { minX: Math.min(...xs) - radius, minY: Math.min(...ys) - radius, maxX: Math.max(...xs) + radius, maxY: Math.max(...ys) + radius };
  return strokeBounds.minX <= bounds.maxX && strokeBounds.maxX >= bounds.minX && strokeBounds.minY <= bounds.maxY && strokeBounds.maxY >= bounds.minY;
}

export function queryRegionHistory(
  document: BoardDocumentV2,
  index: TemporalIndex,
  bounds: Bounds,
  options: { throughPosition?: number; detail?: TemporalDetail; includeErased?: boolean } = {},
): TemporalRegionResult {
  assertBounds(bounds);
  const throughPosition = options.throughPosition ?? index.entries.length;
  validatePosition(index, throughPosition, 'throughPosition');
  const prefix = index.entries.slice(0, throughPosition);
  const projection = projectHistory(document, index, throughPosition);
  const visible = new Set(projection.board.strokes.map(({ id }) => id));
  const snapshots = new Map<string, Stroke>();
  const matchingEntries: TimelineEntry[] = [];
  for (const entry of prefix) {
    const event = inkEvent(document, entry);
    let matches = false;
    for (const change of event?.changes ?? []) {
      const value = change.after ?? change.before;
      if (value && intersects(value, bounds) && (options.includeErased || visible.has(value.id))) {
        snapshots.set(value.id, structuredClone(value));
        matches = true;
      }
    }
    if (matches) matchingEntries.push(entry);
  }
  const allMatches = [...snapshots.keys()];
  const erasedStrokeIds = options.includeErased ? uniqueSorted(allMatches.filter((id) => !visible.has(id))) : [];
  const strokeIds = uniqueSorted(allMatches.filter((id) => visible.has(id) || options.includeErased));
  return {
    bounds: structuredClone(bounds),
    throughPosition,
    entries: cloneEntries(matchingEntries),
    strokeIds,
    erasedStrokeIds,
    ...(options.detail === 'geometry' ? { strokes: strokeIds.map((id) => structuredClone(snapshots.get(id) as Stroke)) } : {}),
  };
}

function sampleStroke(stroke: Stroke, intensity: number): ActivitySample[] {
  if (stroke.points.length === 1) return [{ x: stroke.points[0].x, y: stroke.points[0].y, intensity }];
  const samples: ActivitySample[] = [];
  let nextDistance = 0;
  let traversed = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const from = stroke.points[index - 1];
    const to = stroke.points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    while (nextDistance <= traversed + length) {
      const amount = (nextDistance - traversed) / length;
      samples.push({ x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount, intensity });
      nextDistance += 16;
    }
    traversed += length;
  }
  const last = stroke.points.at(-1) as Stroke['points'][number];
  const previous = samples.at(-1);
  if (!previous || previous.x !== last.x || previous.y !== last.y) samples.push({ x: last.x, y: last.y, intensity });
  return samples;
}

export function buildActivitySamples(document: BoardDocumentV2, index: TemporalIndex, position: number): ActivitySample[] {
  validatePosition(index, position);
  if (position === 0) return [];
  const selected = index.entries[position - 1];
  const segment = index.segments.find(({ id }) => id === selected.segmentId);
  if (!segment) return [];
  const samples: ActivitySample[] = [];
  for (const entry of index.entries.slice(segment.startPosition - 1, position)) {
    const event = inkEvent(document, entry);
    if (!event) continue;
    const intensity = 2 ** (-Math.max(0, selected.time - event.time) / 10_000);
    for (const change of event.changes) {
      const value = change.after ?? change.before;
      if (value) samples.push(...sampleStroke(value, intensity));
    }
  }
  return samples;
}

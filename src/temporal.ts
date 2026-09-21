import { AssociationModel, type AssociationEvent, type AssociationEventKind } from './association';
import { BoardModel, type BoardEvent, type BoardEventKind } from './board';
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

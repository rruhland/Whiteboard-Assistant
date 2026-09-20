import { BoardModel, BOARD_ZOOM_LIMITS, type BoardEvent, type Viewport } from './board';
import { AssociationModel, type AssociationEvent, type WorkObject } from './association';

export type BoardDocumentV1 = {
  version: 1;
  events: BoardEvent[];
  viewport: Viewport;
};

export type BoardDocumentV2 = {
  version: 2;
  events: BoardEvent[];
  associationEvents: AssociationEvent[];
  viewport: Viewport;
};

export type ParsedBoard =
  | { sourceVersion: 1; document: BoardDocumentV1 }
  | { sourceVersion: 2; document: BoardDocumentV2 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateViewport(value: unknown): Viewport {
  if (!isRecord(value)) throw new Error('viewport must be an object');
  assertFinite(value.x, 'viewport.x');
  assertFinite(value.y, 'viewport.y');
  assertFinite(value.zoom, 'viewport.zoom');
  if (value.zoom < BOARD_ZOOM_LIMITS.min || value.zoom > BOARD_ZOOM_LIMITS.max) {
    throw new Error(`viewport.zoom must be between ${BOARD_ZOOM_LIMITS.min} and ${BOARD_ZOOM_LIMITS.max}`);
  }
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function validateWorkObject(value: unknown, label: string): WorkObject {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertString(value.id, `${label}.id`);
  assertString(value.label, `${label}.label`);
  if (!Array.isArray(value.strokeIds) || !value.strokeIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error(`${label}.strokeIds must be an array of IDs`);
  }
  assertFinite(value.createdAt, `${label}.createdAt`);
  assertFinite(value.lastAssociatedAt, `${label}.lastAssociatedAt`);
  if (value.status !== 'active' && value.status !== 'superseded') throw new Error(`${label}.status is unsupported`);
  if (!Array.isArray(value.parentIds) || !value.parentIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error(`${label}.parentIds must be an array of IDs`);
  }
  return clone(value as WorkObject);
}

function validateAssociationEvents(value: unknown): AssociationEvent[] {
  if (!Array.isArray(value)) throw new Error('Board document associationEvents must be an array');
  return value.map((event, eventIndex) => {
    const label = `associationEvents[${eventIndex}]`;
    if (!isRecord(event)) throw new Error(`${label} must be an object`);
    assertString(event.id, `${label}.id`);
    assertFinite(event.time, `${label}.time`);
    if (event.actor !== 'system' && event.actor !== 'user') throw new Error(`${label}.actor is unsupported`);
    if (!['auto-create', 'auto-append', 'manual-assign', 'manual-merge', 'manual-split'].includes(event.kind as string)) {
      throw new Error(`${label}.kind is unsupported`);
    }
    if (typeof event.reason !== 'string') throw new Error(`${label}.reason must be a string`);
    if (!Array.isArray(event.changes) || event.changes.length === 0) throw new Error(`${label}.changes must not be empty`);
    const changes = event.changes.map((change, changeIndex) => {
      const changeLabel = `${label}.changes[${changeIndex}]`;
      if (!isRecord(change) || !('before' in change) || !('after' in change)) throw new Error(`${changeLabel} must include before and after`);
      return {
        before: change.before === null ? null : validateWorkObject(change.before, `${changeLabel}.before`),
        after: change.after === null ? null : validateWorkObject(change.after, `${changeLabel}.after`),
      };
    });
    return { id: event.id, time: event.time, actor: event.actor, kind: event.kind, reason: event.reason, changes } as AssociationEvent;
  });
}

function validateInk(events: unknown): BoardEvent[] {
  if (!Array.isArray(events)) throw new Error('Board document events must be an array');
  return new BoardModel({ events: events as BoardEvent[] }).events;
}

export function parseBoard(json: string): ParsedBoard {
  if (typeof json !== 'string') throw new Error('Board JSON must be a string');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid board JSON: ${error instanceof Error ? error.message : 'parse error'}`);
  }
  if (!isRecord(value)) throw new Error('Board document must be an object');
  const events = validateInk(value.events);
  const viewport = validateViewport(value.viewport);
  if (value.version === 1) return { sourceVersion: 1, document: { version: 1, events, viewport } };
  if (value.version === 2) {
    const associationEvents = validateAssociationEvents(value.associationEvents);
    const knownStrokeIds = new Set(events.flatMap(({ changes }) => changes.flatMap(({ before, after }) => [before?.id, after?.id].filter((id): id is string => id !== undefined))));
    const validatedAssociations = new AssociationModel(associationEvents, knownStrokeIds).events;
    return { sourceVersion: 2, document: { version: 2, events, associationEvents: validatedAssociations, viewport } };
  }
  throw new Error('Unsupported board document version');
}

export function serializeBoard(document: BoardDocumentV2): string {
  const parsed = parseBoard(JSON.stringify(document));
  if (parsed.sourceVersion !== 2) throw new Error('Only version 2 board documents can be serialized');
  return JSON.stringify(parsed.document);
}

export function composeBoardDocument(
  board: BoardModel,
  associations: { readonly events: AssociationEvent[] },
  viewport: Viewport,
): BoardDocumentV2 {
  return parseBoard(JSON.stringify({ version: 2, events: board.events, associationEvents: associations.events, viewport })).document as BoardDocumentV2;
}

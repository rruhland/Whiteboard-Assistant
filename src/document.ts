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

export type BoardDocumentV3 = {
  version: 3;
  events: BoardEvent[];
  associationEvents: AssociationEvent[];
  viewport: Viewport;
};

export type ParsedBoard =
  | { sourceVersion: 1; document: BoardDocumentV1 }
  | { sourceVersion: 2; document: BoardDocumentV2 }
  | { sourceVersion: 3; document: BoardDocumentV3 };

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

function validateWorkObject(value: unknown, label: string, version: 2 | 3): WorkObject {
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
  if (version === 2) {
    if (value.objectType !== undefined && value.objectType !== 'content') throw new Error(`${label} legacy object must be content`);
    return clone({ ...value, objectType: 'content' } as WorkObject);
  }
  if (value.objectType !== 'content' && value.objectType !== 'annotation') throw new Error(`${label}.objectType is unsupported`);
  return clone(value as WorkObject);
}

function validateAssociationEvents(value: unknown, version: 2 | 3): AssociationEvent[] {
  if (!Array.isArray(value)) throw new Error('Board document associationEvents must be an array');
  return value.map((event, eventIndex) => {
    const label = `associationEvents[${eventIndex}]`;
    if (!isRecord(event)) throw new Error(`${label} must be an object`);
    assertString(event.id, `${label}.id`);
    assertFinite(event.time, `${label}.time`);
    if (event.actor !== 'system' && event.actor !== 'user') throw new Error(`${label}.actor is unsupported`);
    const kinds = version === 2
      ? ['auto-create', 'auto-append', 'manual-assign', 'manual-merge', 'manual-split']
      : ['auto-create', 'auto-append', 'manual-assign', 'manual-merge', 'manual-split', 'assistant-annotation'];
    if (!kinds.includes(event.kind as string)) {
      throw new Error(`${label}.kind is unsupported`);
    }
    if (typeof event.reason !== 'string') throw new Error(`${label}.reason must be a string`);
    if (!Array.isArray(event.changes) || event.changes.length === 0) throw new Error(`${label}.changes must not be empty`);
    const changes = event.changes.map((change, changeIndex) => {
      const changeLabel = `${label}.changes[${changeIndex}]`;
      if (!isRecord(change) || !('before' in change) || !('after' in change)) throw new Error(`${changeLabel} must include before and after`);
      return {
        before: change.before === null ? null : validateWorkObject(change.before, `${changeLabel}.before`, version),
        after: change.after === null ? null : validateWorkObject(change.after, `${changeLabel}.after`, version),
      };
    });
    return { id: event.id, time: event.time, actor: event.actor, kind: event.kind, reason: event.reason, changes } as AssociationEvent;
  });
}

function validateInk(events: unknown): BoardEvent[] {
  if (!Array.isArray(events)) throw new Error('Board document events must be an array');
  return new BoardModel({ events: events as BoardEvent[] }).events;
}

function validateLegacyInk(events: unknown): void {
  if (!Array.isArray(events)) throw new Error('Board document events must be an array');
  for (const event of events) {
    if (!isRecord(event) || event.actor !== 'user') throw new Error('Legacy ink events must be user-authored');
    if (!Array.isArray(event.changes) || event.changes.length !== 1) throw new Error('Legacy ink events must contain a single change');
    for (const change of event.changes) {
      if (!isRecord(change)) continue;
      for (const stroke of [change.before, change.after]) {
        if (stroke !== null && isRecord(stroke) && stroke.author !== 'user') throw new Error('Legacy strokes must be user-authored');
      }
    }
  }
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
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new Error('Unsupported board document version');
  if (value.version !== 3) validateLegacyInk(value.events);
  const events = validateInk(value.events);
  const viewport = validateViewport(value.viewport);
  if (value.version === 1) return { sourceVersion: 1, document: { version: 1, events, viewport } };
  if (value.version === 2) {
    const associationEvents = validateAssociationEvents(value.associationEvents, 2);
    const knownStrokeIds = new Set(events.flatMap(({ changes }) => changes.flatMap(({ before, after }) => [before?.id, after?.id].filter((id): id is string => id !== undefined))));
    const validatedAssociations = new AssociationModel(associationEvents, knownStrokeIds).events;
    return { sourceVersion: 2, document: { version: 2, events, associationEvents: validatedAssociations, viewport } };
  }
  const associationEvents = validateAssociationEvents(value.associationEvents, 3);
  const knownStrokeIds = new Set(events.flatMap(({ changes }) => changes.flatMap(({ before, after }) => [before?.id, after?.id].filter((id): id is string => id !== undefined))));
  const validatedAssociations = new AssociationModel(associationEvents, knownStrokeIds).events;
  return { sourceVersion: 3, document: { version: 3, events, associationEvents: validatedAssociations, viewport } };
}

export function serializeBoard(document: BoardDocumentV3): string {
  const parsed = parseBoard(JSON.stringify(document));
  if (parsed.sourceVersion !== 3) throw new Error('Only version 3 board documents can be serialized');
  return JSON.stringify(parsed.document);
}

export function composeBoardDocument(
  board: BoardModel,
  associations: { readonly events: AssociationEvent[] },
  viewport: Viewport,
): BoardDocumentV3 {
  return parseBoard(JSON.stringify({ version: 3, events: board.events, associationEvents: associations.events, viewport })).document as BoardDocumentV3;
}

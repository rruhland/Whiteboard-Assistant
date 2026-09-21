export type Point = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type StrokeAuthor = 'user' | 'assistant';

export type Stroke = {
  id: string;
  createdAt: number;
  author: StrokeAuthor;
  color: string;
  width: number;
  points: Point[];
};

export type BoardEventKind = 'add' | 'move' | 'erase' | 'undo' | 'redo';
export type BoardActor = 'user' | 'assistant';
export type EventIdentity = { id: string; time: number };

export type StrokeChange = {
  before: Stroke | null;
  after: Stroke | null;
};

export type BoardEvent = {
  id: string;
  time: number;
  actor: BoardActor;
  kind: BoardEventKind;
  changes: StrokeChange[];
  targetId?: string;
};

export type BoardDocument = {
  version: 1;
  events: BoardEvent[];
  viewport: Viewport;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function clonePoint(point: Point): Point {
  return { ...point };
}

function cloneStroke(stroke: Stroke): Stroke {
  return { ...stroke, points: stroke.points.map(clonePoint) };
}

function cloneChange(change: StrokeChange): StrokeChange {
  return {
    before: change.before ? cloneStroke(change.before) : null,
    after: change.after ? cloneStroke(change.after) : null,
  };
}

function cloneEvent(event: BoardEvent): BoardEvent {
  return {
    ...event,
    changes: event.changes.map(cloneChange),
  };
}

function cloneViewport(viewport: Viewport): Viewport {
  return { ...viewport };
}

function cloneDocument(document: BoardDocument): BoardDocument {
  return {
    version: 1,
    events: document.events.map(cloneEvent),
    viewport: cloneViewport(document.viewport),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertPoint(value: unknown, label: string): asserts value is Point {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.pressure, `${label}.pressure`);
  assertFinite(value.time, `${label}.time`);
}

function assertStroke(value: unknown, label: string): asserts value is Stroke {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error(`${label}.id must be a non-empty string`);
  assertFinite(value.createdAt, `${label}.createdAt`);
  if (value.author !== 'user' && value.author !== 'assistant') throw new Error(`${label}.author is unsupported`);
  if (typeof value.color !== 'string' || value.color.length === 0) throw new Error(`${label}.color must be a non-empty string`);
  assertFinite(value.width, `${label}.width`);
  if (value.width <= 0) throw new Error(`${label}.width must be positive`);
  if (!Array.isArray(value.points) || value.points.length === 0) throw new Error(`${label}.points must contain a point`);
  value.points.forEach((point, index) => assertPoint(point, `${label}.points[${index}]`));
}

function assertViewport(value: unknown): asserts value is Viewport {
  if (!isRecord(value)) throw new Error('viewport must be an object');
  assertFinite(value.x, 'viewport.x');
  assertFinite(value.y, 'viewport.y');
  assertFinite(value.zoom, 'viewport.zoom');
  if (value.zoom < MIN_ZOOM || value.zoom > MAX_ZOOM) throw new Error('viewport.zoom must be between 0.1 and 4');
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && sameValue(left[key], right[key]));
  }
  return false;
}

function idFor(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  return randomUuid ? `${prefix}-${randomUuid.call(globalThis.crypto)}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function inverseChanges(changes: StrokeChange[]): StrokeChange[] {
  return changes.map(({ before, after }) => ({
    before: after ? cloneStroke(after) : null,
    after: before ? cloneStroke(before) : null,
  }));
}

type ReplayState = {
  strokes: Map<string, Stroke>;
  strokeOrder: string[];
  orderRanks: Map<string, number>;
  nextOrderRank: number;
  events: BoardEvent[];
  undoStack: BoardEvent[];
  redoStack: BoardEvent[];
  eventById: Map<string, BoardEvent>;
};

function assertChange(value: unknown, label: string): asserts value is StrokeChange {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (value.before !== null && value.before !== undefined) assertStroke(value.before, `${label}.before`);
  if (value.after !== null && value.after !== undefined) assertStroke(value.after, `${label}.after`);
  if (value.before === undefined || value.after === undefined) throw new Error(`${label} must include before and after`);
  if (value.before && value.after && value.before.id !== value.after.id) throw new Error(`${label} changes must preserve stroke ID`);
}

function assertEventShape(value: unknown, label: string): asserts value is BoardEvent {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error(`${label}.id must be a non-empty string`);
  assertFinite(value.time, `${label}.time`);
  if (value.actor !== 'user' && value.actor !== 'assistant') throw new Error(`${label}.actor is unsupported`);
  if (!['add', 'move', 'erase', 'undo', 'redo'].includes(value.kind as string)) throw new Error(`${label}.kind is unsupported`);
  if (!Array.isArray(value.changes) || value.changes.length === 0) throw new Error(`${label}.changes must not be empty`);
  value.changes.forEach((change, index) => assertChange(change, `${label}.changes[${index}]`));
  const ids = value.changes.map((change) => change.after?.id ?? change.before?.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}.changes contains duplicate stroke IDs`);
  if (value.targetId !== undefined && (typeof value.targetId !== 'string' || value.targetId.length === 0)) {
    throw new Error(`${label}.targetId must be a non-empty string`);
  }
}

function applyChanges(state: ReplayState, event: BoardEvent): void {
  const changes = event.changes;
  for (const change of changes) {
    const id = change.after?.id ?? change.before?.id;
    if (!id) throw new Error(`Event ${event.id} has an empty change`);
    const actual = state.strokes.get(id);
    if (change.before === null) {
      if (actual) throw new Error(`Event ${event.id} has a duplicate stroke ID ${id}`);
    } else if (!actual || !sameValue(actual, change.before)) {
      throw new Error(`Event ${event.id} has an invalid before state for stroke ${id}`);
    }
  }
  for (const change of changes) {
    const id = change.after?.id ?? change.before?.id;
    if (!id) continue;
    if (change.after === null) {
      state.strokes.delete(id);
      const orderIndex = state.strokeOrder.indexOf(id);
      if (orderIndex >= 0) state.strokeOrder.splice(orderIndex, 1);
    } else {
      if (!state.orderRanks.has(id)) {
        state.orderRanks.set(id, state.nextOrderRank);
        state.nextOrderRank += 1;
      }
      state.strokes.set(id, cloneStroke(change.after));
      if (!state.strokeOrder.includes(id)) {
        const rank = state.orderRanks.get(id) as number;
        const insertionIndex = state.strokeOrder.findIndex((existingId) => (state.orderRanks.get(existingId) as number) > rank);
        if (insertionIndex < 0) state.strokeOrder.push(id);
        else state.strokeOrder.splice(insertionIndex, 0, id);
      }
    }
  }
}

function replay(document: BoardDocument): ReplayState {
  const state: ReplayState = {
    strokes: new Map(),
    strokeOrder: [],
    orderRanks: new Map(),
    nextOrderRank: 0,
    events: [],
    undoStack: [],
    redoStack: [],
    eventById: new Map(),
  };
  document.events.forEach((event, index) => {
    assertEventShape(event, `events[${index}]`);
    if (state.eventById.has(event.id)) throw new Error(`Duplicate event ID ${event.id}`);
    const cloned = cloneEvent(event);
    if (cloned.kind === 'add') {
      if (cloned.changes.some(({ before, after }) => before !== null || after === null)) throw new Error(`Event ${cloned.id} is not a valid add`);
      if (cloned.changes.some(({ after }) => after?.author !== cloned.actor)) throw new Error(`Event ${cloned.id} add provenance does not match its actor`);
      applyChanges(state, cloned);
      state.undoStack.push(cloned);
      state.redoStack = [];
    } else if (cloned.kind === 'move') {
      if (cloned.actor !== 'user' || cloned.changes.some(({ before, after }) => !before || !after)) throw new Error(`Event ${cloned.id} is not a valid move`);
      applyChanges(state, cloned);
      state.undoStack.push(cloned);
      state.redoStack = [];
    } else if (cloned.kind === 'erase') {
      if (cloned.actor !== 'user' || cloned.changes.some(({ before, after }) => before === null || after !== null)) throw new Error(`Event ${cloned.id} is not a valid erase`);
      applyChanges(state, cloned);
      state.undoStack.push(cloned);
      state.redoStack = [];
    } else if (cloned.kind === 'undo') {
      if (cloned.actor !== 'user') throw new Error(`Undo event ${cloned.id} must be user-authored`);
      if (!cloned.targetId) throw new Error(`Undo event ${cloned.id} requires a target reference`);
      const target = state.eventById.get(cloned.targetId);
      if (!target || !['add', 'move', 'erase'].includes(target.kind) || state.undoStack.at(-1)?.id !== target.id) throw new Error(`Undo event ${cloned.id} has an invalid target reference`);
      if (!sameValue(cloned.changes, inverseChanges(target.changes))) throw new Error(`Undo event ${cloned.id} does not compensate its target`);
      applyChanges(state, cloned);
      state.undoStack.pop();
      state.redoStack.push(target);
    } else {
      if (cloned.actor !== 'user') throw new Error(`Redo event ${cloned.id} must be user-authored`);
      if (!cloned.targetId) throw new Error(`Redo event ${cloned.id} requires a target reference`);
      const target = state.eventById.get(cloned.targetId);
      if (!target || !['add', 'move', 'erase'].includes(target.kind) || state.redoStack.at(-1)?.id !== target.id) throw new Error(`Redo event ${cloned.id} has an invalid target reference`);
      if (!sameValue(cloned.changes, target.changes)) throw new Error(`Redo event ${cloned.id} does not repeat its target`);
      applyChanges(state, cloned);
      state.redoStack.pop();
      state.undoStack.push(target);
    }
    state.events.push(cloned);
    state.eventById.set(cloned.id, cloned);
  });
  return state;
}

function validateDocument(value: unknown): BoardDocument {
  if (!isRecord(value)) throw new Error('Board document must be an object');
  if (value.version !== 1) throw new Error('Unsupported board document version');
  if (!Array.isArray(value.events)) throw new Error('Board document events must be an array');
  assertViewport(value.viewport);
  const document: BoardDocument = {
    version: 1,
    events: value.events as BoardEvent[],
    viewport: cloneViewport(value.viewport),
  };
  replay(document);
  return cloneDocument(document);
}

function emptyDocument(): BoardDocument {
  return { version: 1, events: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

export class BoardModel {
  private readonly eventLog: BoardEvent[];
  private readonly strokeMap: Map<string, Stroke>;
  private readonly strokeOrder: string[];
  private readonly orderRanks: Map<string, number>;
  private nextOrderRank: number;
  private undoStack: BoardEvent[];
  private redoStack: BoardEvent[];

  constructor(document: { events: BoardEvent[] } = emptyDocument()) {
    const validated = validateDocument({ version: 1, events: document.events, viewport: { x: 0, y: 0, zoom: 1 } });
    const state = replay(validated);
    this.eventLog = state.events;
    this.strokeMap = state.strokes;
    this.strokeOrder = state.strokeOrder;
    this.orderRanks = state.orderRanks;
    this.nextOrderRank = state.nextOrderRank;
    this.undoStack = state.undoStack;
    this.redoStack = state.redoStack;
  }

  get strokes(): Stroke[] {
    return this.strokeOrder.map((id) => this.strokeMap.get(id)).filter((stroke): stroke is Stroke => stroke !== undefined).map(cloneStroke);
  }

  get events(): BoardEvent[] {
    return this.eventLog.map(cloneEvent);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  addStroke(points: Point[], color: string, width: number): string {
    const stroke: Stroke = { id: idFor('stroke'), createdAt: Date.now(), author: 'user', color, width, points: points.map(clonePoint) };
    assertStroke(stroke, 'stroke');
    this.commit({ id: idFor('event'), time: Date.now(), actor: 'user', kind: 'add', changes: [{ before: null, after: stroke }] });
    return stroke.id;
  }

  moveStroke(id: string, dx: number, dy: number): void {
    assertFinite(dx, 'dx');
    assertFinite(dy, 'dy');
    const before = this.strokeMap.get(id);
    if (!before) return;
    const after = cloneStroke(before);
    after.points = after.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
    this.updateStrokes([after]);
  }

  updateStrokes(after: readonly Stroke[]): void {
    const unique = new Map(after.map((stroke) => [stroke.id, cloneStroke(stroke)]));
    const changes = [...unique.values()].flatMap((next) => {
      const before = this.strokeMap.get(next.id);
      return before ? [{ before: cloneStroke(before), after: next }] : [];
    });
    if (changes.length) this.commit({ id: idFor('event'), time: Date.now(), actor: 'user', kind: 'move', changes });
  }

  eraseStroke(id: string): void {
    this.eraseStrokes([id]);
  }

  eraseStrokes(ids: readonly string[]): void {
    const strokes = [...new Set(ids)].flatMap((id) => {
      const value = this.strokeMap.get(id);
      return value ? [value] : [];
    });
    if (strokes.length) this.commit(createEraseEvent(strokes, { id: idFor('event'), time: Date.now() }));
  }

  undo(): void {
    const target = this.undoStack.at(-1);
    if (!target) return;
    this.commitCompensating('undo', target);
  }

  redo(): void {
    const target = this.redoStack.at(-1);
    if (!target) return;
    this.commitCompensating('redo', target);
  }

  toDocument(viewport: Viewport): BoardDocument {
    assertViewport(viewport);
    return { version: 1, events: this.events, viewport: cloneViewport(viewport) };
  }

  private commit(event: BoardEvent): void {
    applyChanges({ strokes: this.strokeMap, strokeOrder: this.strokeOrder, orderRanks: this.orderRanks, nextOrderRank: this.nextOrderRank, events: this.eventLog, undoStack: this.undoStack, redoStack: this.redoStack, eventById: new Map() }, event);
    this.nextOrderRank = Math.max(...this.orderRanks.values(), -1) + 1;
    this.eventLog.push(cloneEvent(event));
    this.undoStack.push(cloneEvent(event));
    this.redoStack = [];
  }

  private commitCompensating(kind: 'undo' | 'redo', target: BoardEvent): void {
    const event: BoardEvent = {
      id: idFor('event'),
      time: Date.now(),
      actor: 'user',
      kind,
      targetId: target.id,
      changes: kind === 'undo' ? inverseChanges(target.changes) : target.changes.map(cloneChange),
    };
    applyChanges({ strokes: this.strokeMap, strokeOrder: this.strokeOrder, orderRanks: this.orderRanks, nextOrderRank: this.nextOrderRank, events: this.eventLog, undoStack: this.undoStack, redoStack: this.redoStack, eventById: new Map() }, event);
    this.nextOrderRank = Math.max(...this.orderRanks.values(), -1) + 1;
    this.eventLog.push(cloneEvent(event));
    if (kind === 'undo') {
      this.undoStack.pop();
      this.redoStack.push(target);
    } else {
      this.redoStack.pop();
      this.undoStack.push(target);
    }
  }
}

export const BOARD_ZOOM_LIMITS = { min: MIN_ZOOM, max: MAX_ZOOM } as const;

export function createAddEvent(strokes: readonly Stroke[], actor: BoardActor, identity: EventIdentity): BoardEvent {
  return {
    id: identity.id,
    time: identity.time,
    actor,
    kind: 'add',
    changes: strokes.map((stroke) => ({ before: null, after: cloneStroke(stroke) })),
  };
}

export function createEraseEvent(strokes: readonly Stroke[], identity: EventIdentity): BoardEvent {
  return {
    id: identity.id,
    time: identity.time,
    actor: 'user',
    kind: 'erase',
    changes: strokes.map((stroke) => ({ before: cloneStroke(stroke), after: null })),
  };
}

import type { Stroke } from './board';

export type WorkObject = {
  id: string;
  label: string;
  strokeIds: string[];
  createdAt: number;
  lastAssociatedAt: number;
  status: 'active' | 'superseded';
  parentIds: string[];
};

export type AssociationEventKind = 'auto-create' | 'auto-append' | 'manual-assign' | 'manual-merge' | 'manual-split';

export type ObjectChange = {
  before: WorkObject | null;
  after: WorkObject | null;
};

export type AssociationEvent = {
  id: string;
  time: number;
  actor: 'system' | 'user';
  kind: AssociationEventKind;
  reason: string;
  changes: ObjectChange[];
};

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GraphNode = WorkObject & { bounds?: Bounds; visibleStrokeCount: number };
export type GraphEdge = { type: 'near' | 'derived-from'; sourceId: string; targetId: string };

const CLOSE_DISTANCE = 24;
const RECENT_DISTANCE = 80;
const RECENT_WINDOW = 12_000;
const NEAR_DISTANCE = 120;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => same(value, right[index]));
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in rightRecord && same(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function idFor(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID;
  return uuid ? `${prefix}-${uuid.call(globalThis.crypto)}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function labelFor(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

function strokeBounds(stroke: Stroke): Bounds {
  const radius = stroke.width / 2;
  return {
    minX: Math.min(...stroke.points.map(({ x }) => x)) - radius,
    minY: Math.min(...stroke.points.map(({ y }) => y)) - radius,
    maxX: Math.max(...stroke.points.map(({ x }) => x)) + radius,
    maxY: Math.max(...stroke.points.map(({ y }) => y)) + radius,
  };
}

function unionBounds(bounds: readonly Bounds[]): Bounds | undefined {
  if (bounds.length === 0) return undefined;
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

function boundsDistance(left: Bounds, right: Bounds): number {
  const dx = Math.max(left.minX - right.maxX, right.minX - left.maxX, 0);
  const dy = Math.max(left.minY - right.maxY, right.minY - left.maxY, 0);
  return Math.hypot(dx, dy);
}

export function getObjectBounds(object: WorkObject, visible: readonly Stroke[]): Bounds | undefined {
  const members = new Set(object.strokeIds);
  return unionBounds(visible.filter(({ id }) => members.has(id)).map(strokeBounds));
}

type ReplayResult = { objects: Map<string, WorkObject>; creationCount: number };

function assertObject(object: WorkObject, knownStrokeIds: ReadonlySet<string>, label: string): void {
  if (!object.id || !object.label) throw new Error(`${label} requires IDs and a label`);
  if (!Number.isFinite(object.createdAt) || !Number.isFinite(object.lastAssociatedAt)) throw new Error(`${label} timestamps must be finite`);
  if (object.status !== 'active' && object.status !== 'superseded') throw new Error(`${label} status is unsupported`);
  if (new Set(object.strokeIds).size !== object.strokeIds.length) throw new Error(`${label} has duplicate stroke IDs`);
  if (new Set(object.parentIds).size !== object.parentIds.length) throw new Error(`${label} has duplicate parent IDs`);
  for (const strokeId of object.strokeIds) if (!knownStrokeIds.has(strokeId)) throw new Error(`${label} references unknown stroke ${strokeId}`);
}

function validateLineage(objects: Map<string, WorkObject>): void {
  for (const object of objects.values()) {
    for (const parentId of object.parentIds) {
      if (!objects.has(parentId)) throw new Error(`Object ${object.id} has unknown parent ${parentId}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Association lineage contains a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parentId of objects.get(id)?.parentIds ?? []) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of objects.keys()) visit(id);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
}

function assertNewObject(change: ObjectChange, event: AssociationEvent): WorkObject {
  if (change.before !== null || !change.after || change.after.status !== 'active' || change.after.parentIds.length !== 0 || change.after.strokeIds.length !== 1) {
    throw new Error(`${event.kind} event ${event.id} must create one active single-stroke object`);
  }
  if (change.after.createdAt !== event.time || change.after.lastAssociatedAt !== event.time) {
    throw new Error(`${event.kind} event ${event.id} must use its event time`);
  }
  return change.after;
}

function assertAppend(change: ObjectChange, event: AssociationEvent): void {
  const { before, after } = change;
  if (!before || !after || before.status !== 'active' || after.status !== 'active' || after.strokeIds.length !== before.strokeIds.length + 1) {
    throw new Error(`${event.kind} event ${event.id} must append one stroke to an active object`);
  }
  const expected = { ...clone(before), strokeIds: [...before.strokeIds, after.strokeIds.at(-1) as string], lastAssociatedAt: event.time };
  if (!same(after, expected)) throw new Error(`${event.kind} event ${event.id} changes fields other than membership and activity time`);
}

function validateEventSemantics(event: AssociationEvent): void {
  if (event.kind === 'auto-create') {
    if (event.actor !== 'system' || event.changes.length !== 1) throw new Error(`auto-create event ${event.id} requires one system change`);
    assertNewObject(event.changes[0], event);
    return;
  }
  if (event.kind === 'auto-append') {
    if (event.actor !== 'system' || event.changes.length !== 1) throw new Error(`auto-append event ${event.id} requires one system change`);
    assertAppend(event.changes[0], event);
    return;
  }
  if (event.kind === 'manual-assign') {
    if (event.actor !== 'user' || event.changes.length !== 1) throw new Error(`manual-assign event ${event.id} requires one user change`);
    if (event.changes[0].before === null) assertNewObject(event.changes[0], event);
    else assertAppend(event.changes[0], event);
    return;
  }
  if (event.actor !== 'user') throw new Error(`${event.kind} event ${event.id} must be performed by a user`);
  const updates = event.changes.filter((change): change is { before: WorkObject; after: WorkObject } => change.before !== null && change.after !== null);
  const creations = event.changes.filter((change): change is { before: null; after: WorkObject } => change.before === null && change.after !== null);
  if (updates.length + creations.length !== event.changes.length) throw new Error(`${event.kind} event ${event.id} cannot delete objects`);
  for (const { before, after } of updates) {
    if (before.status !== 'active' || !same(after, { ...clone(before), status: 'superseded' })) {
      throw new Error(`${event.kind} event ${event.id} must supersede its active parent objects`);
    }
  }
  if (event.kind === 'manual-merge') {
    if (updates.length < 2 || creations.length !== 1) throw new Error(`manual-merge event ${event.id} requires at least two parents and one child`);
    const child = creations[0].after;
    const parentIds = updates.map(({ before }) => before.id).sort();
    const memberIds = [...new Set(updates.flatMap(({ before }) => before.strokeIds))];
    if (child.status !== 'active' || !same(child.parentIds, parentIds) || !sameMembers(child.strokeIds, memberIds) || child.createdAt !== event.time || child.lastAssociatedAt !== event.time) {
      throw new Error(`manual-merge event ${event.id} has invalid child lineage or membership`);
    }
    return;
  }
  if (updates.length !== 1 || creations.length !== 2) throw new Error(`manual-split event ${event.id} requires one parent and two children`);
  const parent = updates[0].before;
  const childMembers = creations.flatMap(({ after }) => after.strokeIds);
  if (creations.some(({ after }) => after.status !== 'active' || !same(after.parentIds, [parent.id]) || after.strokeIds.length === 0 || after.createdAt !== event.time || after.lastAssociatedAt !== event.time)
    || !sameMembers(childMembers, parent.strokeIds)) {
    throw new Error(`manual-split event ${event.id} has invalid child lineage or membership`);
  }
}

function replay(events: readonly AssociationEvent[], knownStrokeIds: ReadonlySet<string>): ReplayResult {
  const objects = new Map<string, WorkObject>();
  const eventIds = new Set<string>();
  let creationCount = 0;
  events.forEach((event, eventIndex) => {
    if (!event.id || eventIds.has(event.id)) throw new Error(`Duplicate association event ID ${event.id}`);
    if (!Number.isFinite(event.time) || (event.actor !== 'system' && event.actor !== 'user')) throw new Error(`Invalid association event ${event.id}`);
    if (!['auto-create', 'auto-append', 'manual-assign', 'manual-merge', 'manual-split'].includes(event.kind)) throw new Error(`Unsupported association event kind at ${eventIndex}`);
    if (!Array.isArray(event.changes) || event.changes.length === 0) throw new Error(`Association event ${event.id} must contain changes`);
    const changedIds = new Set<string>();
    for (const [changeIndex, change] of event.changes.entries()) {
      const id = change.after?.id ?? change.before?.id;
      if (!id || changedIds.has(id)) throw new Error(`Association event ${event.id} has duplicate object changes`);
      changedIds.add(id);
      if (change.before) assertObject(change.before, knownStrokeIds, `event ${eventIndex} change ${changeIndex} before`);
      if (change.after) assertObject(change.after, knownStrokeIds, `event ${eventIndex} change ${changeIndex} after`);
      if (change.before && change.after && change.before.id !== change.after.id) throw new Error(`Association event ${event.id} changes object identity`);
      const actual = objects.get(id);
      if (change.before === null) {
        if (actual) throw new Error(`Association event ${event.id} duplicates object ${id}`);
      } else if (!actual || !same(actual, change.before)) {
        throw new Error(`Association event ${event.id} has wrong before state for ${id}`);
      }
    }
    validateEventSemantics(event);
    for (const change of event.changes) {
      const id = change.after?.id ?? change.before?.id as string;
      if (change.after) {
        if (change.before === null) creationCount += 1;
        objects.set(id, clone(change.after));
      } else objects.delete(id);
    }
    const memberships = new Map<string, string>();
    for (const object of objects.values()) {
      if (object.status !== 'active') continue;
      for (const strokeId of object.strokeIds) {
        const owner = memberships.get(strokeId);
        if (owner) throw new Error(`Stroke ${strokeId} has duplicate active membership in ${owner} and ${object.id}`);
        memberships.set(strokeId, object.id);
      }
    }
    validateLineage(objects);
    eventIds.add(event.id);
  });
  return { objects, creationCount };
}

function proposedObject(stroke: Stroke, objects: readonly WorkObject[], visible: readonly Stroke[]): WorkObject | undefined {
  const bounds = strokeBounds(stroke);
  return objects
    .filter(({ status }) => status === 'active')
    .map((object) => ({ object, objectBounds: getObjectBounds(object, visible) }))
    .filter((candidate): candidate is { object: WorkObject; objectBounds: Bounds } => candidate.objectBounds !== undefined)
    .map(({ object, objectBounds }) => ({ object, distance: boundsDistance(bounds, objectBounds) }))
    .filter(({ object, distance }) => distance <= CLOSE_DISTANCE || (stroke.createdAt - object.lastAssociatedAt <= RECENT_WINDOW && distance <= RECENT_DISTANCE))
    .sort((left, right) => left.distance - right.distance || right.object.lastAssociatedAt - left.object.lastAssociatedAt || left.object.id.localeCompare(right.object.id))[0]?.object;
}

export class AssociationModel {
  private eventLog: AssociationEvent[];
  private objectMap: Map<string, WorkObject>;
  private creationCount: number;
  private readonly knownStrokeIds: Set<string>;

  constructor(events: AssociationEvent[], knownStrokeIds: ReadonlySet<string>) {
    this.knownStrokeIds = new Set(knownStrokeIds);
    const state = replay(events, this.knownStrokeIds);
    this.eventLog = clone(events);
    this.objectMap = state.objects;
    this.creationCount = state.creationCount;
  }

  get events(): AssociationEvent[] { return clone(this.eventLog); }
  get objects(): WorkObject[] { return [...this.objectMap.values()].map(clone); }

  associateStroke(stroke: Stroke, visibleStrokes: readonly Stroke[]): string {
    this.knownStrokeIds.add(stroke.id);
    if (this.activeOwner(stroke.id)) throw new Error(`Stroke ${stroke.id} already has an active membership`);
    const target = proposedObject(stroke, this.objects, visibleStrokes);
    const time = stroke.createdAt;
    if (!target) return this.createObject(stroke.id, time, 'system', 'auto-create', 'No eligible nearby object');
    const after = clone(target);
    after.strokeIds.push(stroke.id);
    after.lastAssociatedAt = time;
    this.append({ id: idFor('assoc'), time, actor: 'system', kind: 'auto-append', reason: 'Nearest eligible object', changes: [{ before: target, after }] });
    return target.id;
  }

  assignStroke(strokeId: string, objectId?: string): string {
    if (!this.knownStrokeIds.has(strokeId)) throw new Error(`Cannot assign unknown stroke ${strokeId}`);
    if (this.activeOwner(strokeId)) throw new Error(`Stroke ${strokeId} already has an active membership`);
    const time = Date.now();
    if (!objectId) return this.createObject(strokeId, time, 'user', 'manual-assign', 'Assigned to a new object');
    const before = this.objectMap.get(objectId);
    if (!before || before.status !== 'active') throw new Error(`Object ${objectId} is not active`);
    const after = clone(before);
    after.strokeIds.push(strokeId);
    after.lastAssociatedAt = time;
    this.append({ id: idFor('assoc'), time, actor: 'user', kind: 'manual-assign', reason: 'Assigned by user', changes: [{ before, after }] });
    return objectId;
  }

  mergeObjects(objectIds: readonly string[]): string {
    const uniqueIds = [...new Set(objectIds)];
    if (uniqueIds.length < 2) throw new Error('Merge requires at least two distinct active objects');
    const parents = uniqueIds.map((id) => this.objectMap.get(id));
    if (parents.some((object) => !object || object.status !== 'active')) throw new Error('Merge requires active objects');
    const activeParents = parents as WorkObject[];
    const time = Date.now();
    const child: WorkObject = {
      id: idFor('work'), label: labelFor(this.creationCount),
      strokeIds: [...new Set(activeParents.flatMap(({ strokeIds }) => strokeIds))],
      createdAt: time, lastAssociatedAt: time, status: 'active', parentIds: [...uniqueIds].sort(),
    };
    const changes: ObjectChange[] = activeParents.map((before) => ({ before, after: { ...clone(before), status: 'superseded' as const } }));
    changes.push({ before: null, after: child });
    this.append({ id: idFor('assoc'), time, actor: 'user', kind: 'manual-merge', reason: 'Merged by user', changes });
    return child.id;
  }

  splitObject(objectId: string, selectedStrokeId: string): readonly [string, string] {
    const parent = this.objectMap.get(objectId);
    if (!parent || parent.status !== 'active') throw new Error(`Object ${objectId} is not active`);
    if (parent.strokeIds.length < 2) throw new Error('Split requires at least two member strokes');
    if (!parent.strokeIds.includes(selectedStrokeId)) throw new Error(`Stroke ${selectedStrokeId} is not a member of ${objectId}`);
    const time = Date.now();
    const makeChild = (strokeIds: string[], offset: number): WorkObject => ({
      id: idFor('work'), label: labelFor(this.creationCount + offset), strokeIds,
      createdAt: time, lastAssociatedAt: time, status: 'active', parentIds: [parent.id],
    });
    const selected = makeChild([selectedStrokeId], 0);
    const rest = makeChild(parent.strokeIds.filter((id) => id !== selectedStrokeId), 1);
    this.append({ id: idFor('assoc'), time, actor: 'user', kind: 'manual-split', reason: 'Split by user', changes: [
      { before: parent, after: { ...clone(parent), status: 'superseded' } }, { before: null, after: selected }, { before: null, after: rest },
    ] });
    return [selected.id, rest.id];
  }

  private activeOwner(strokeId: string): WorkObject | undefined {
    return [...this.objectMap.values()].find((object) => object.status === 'active' && object.strokeIds.includes(strokeId));
  }

  private createObject(strokeId: string, time: number, actor: 'system' | 'user', kind: 'auto-create' | 'manual-assign', reason: string, ids?: { object: string; event: string }): string {
    const object: WorkObject = {
      id: ids?.object ?? idFor('work'), label: labelFor(this.creationCount), strokeIds: [strokeId],
      createdAt: time, lastAssociatedAt: time, status: 'active', parentIds: [],
    };
    this.append({ id: ids?.event ?? idFor('assoc'), time, actor, kind, reason, changes: [{ before: null, after: object }] });
    return object.id;
  }

  private append(event: AssociationEvent): void {
    const candidate = [...this.eventLog, clone(event)];
    const state = replay(candidate, this.knownStrokeIds);
    this.eventLog = candidate;
    this.objectMap = state.objects;
    this.creationCount = state.creationCount;
  }
}

export function getUnassignedVisibleStrokes(model: AssociationModel, visible: readonly Stroke[]): Stroke[] {
  const assigned = new Set(model.objects.filter(({ status }) => status === 'active').flatMap(({ strokeIds }) => strokeIds));
  return visible.filter(({ id }) => !assigned.has(id)).map(clone);
}

export function migrateVersion1(strokes: readonly Stroke[], knownStrokeIds: ReadonlySet<string>): AssociationModel {
  const ordered = [...strokes].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  let model = new AssociationModel([], knownStrokeIds);
  for (const stroke of ordered) {
    const target = proposedObject(stroke, model.objects, ordered.filter((candidate) => candidate.createdAt <= stroke.createdAt));
    const eventId = `assoc-v1-${stroke.id}`;
    if (target) {
      const after = clone(target);
      after.strokeIds.push(stroke.id);
      after.lastAssociatedAt = stroke.createdAt;
      model = new AssociationModel([...model.events, { id: eventId, time: stroke.createdAt, actor: 'system', kind: 'auto-append', reason: 'Migrated from version 1', changes: [{ before: target, after }] }], knownStrokeIds);
    } else {
      const object: WorkObject = { id: `work-v1-${stroke.id}`, label: labelFor(model.objects.length), strokeIds: [stroke.id], createdAt: stroke.createdAt, lastAssociatedAt: stroke.createdAt, status: 'active', parentIds: [] };
      model = new AssociationModel([...model.events, { id: eventId, time: stroke.createdAt, actor: 'system', kind: 'auto-create', reason: 'Migrated from version 1', changes: [{ before: null, after: object }] }], knownStrokeIds);
    }
  }
  return model;
}

export function projectGraph(model: AssociationModel, visible: readonly Stroke[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = model.objects.map((object) => {
    const visibleIds = new Set(visible.map(({ id }) => id));
    const bounds = getObjectBounds(object, visible);
    return { ...object, ...(bounds ? { bounds } : {}), visibleStrokeCount: object.strokeIds.filter((id) => visibleIds.has(id)).length };
  });
  const edges: GraphEdge[] = [];
  for (const node of nodes) for (const parentId of node.parentIds) edges.push({ type: 'derived-from', sourceId: node.id, targetId: parentId });
  const active = nodes.filter((node) => node.status === 'active' && node.bounds);
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      if (boundsDistance(left.bounds as Bounds, right.bounds as Bounds) <= NEAR_DISTANCE) {
        const [sourceId, targetId] = [left.id, right.id].sort();
        edges.push({ type: 'near', sourceId, targetId });
      }
    }
  }
  return { nodes, edges };
}

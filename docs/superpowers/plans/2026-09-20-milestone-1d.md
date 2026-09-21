# Milestone 1D Scripted Assistant Insertions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, user-approved assistant proposal flow that can circle active work and place an arrow beside recent work as persistent, graph-linked annotations on the live canvas.

**Architecture:** Version 3 extends the append-only canvas and association logs with assistant provenance, batched ink events, annotation graph objects, and typed edges. A pure planner consumes the 1C temporal/query layer and emits ephemeral circle/arrow proposals; a session layer owns rejection memory and performs validate-then-commit approval transactions. Native DOM panels and Canvas previews expose independent approve/reject/regenerate flows without letting previews enter persistence or history.

**Tech Stack:** TypeScript, native Canvas and Pointer Events, native DOM/SVG, Vite, Vitest, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-09-20-milestone-1d-design.md`

## Global Constraints

- No learned model, visual model, OCR, network call, untrusted script execution, or natural-language generation.
- Generate and approve proposals only at live Now; historical projections remain observational.
- Preview and rejection never mutate the document, autosave, undo/redo, temporal index, or graph.
- Circle and arrow decisions remain independent; approval revalidates and rebases the sibling from the same generation.
- Rejection memory is browser-session-only and clears on reload or board replacement.
- Existing versions 1 and 2 migrate deterministically; every new save/export emits version 3.
- Assistant annotations are first-class graph objects but never content-association targets.
- Ordinary erasing remains stroke-by-stroke; whole-annotation deletion is a batched undoable erase.
- Keep the implementation local-first with no new runtime dependencies or server.

## Review Focus

- A failed approval must leave both the ink and association logs byte-for-byte unchanged, including when the stroke batch validates but the annotation link does not.
- Approving one proposal must not silently discard, approve, or change the geometry of its independently generated sibling; only revision rebasing is allowed.
- Undoing and redoing batch approval/deletion must produce correct annotation visibility even though the immutable graph node remains in association history.
- Legacy files must not gain assistant provenance or batch-event semantics accidentally; version-1/version-2 validation stays strict before migration.
- Collision scoring must remain finite and deterministic for point strokes, zero-area bounds, fully occupied boards, equal scores, and regressing event timestamps.

---

### Task 1: Batched assistant-authored canvas events

**Files:**
- Modify: `src/board.ts`
- Modify: `src/document.ts`
- Modify: `tests/core.test.ts`
- Modify: `tests/document.test.ts`

**Interfaces:**
- Produces:

```ts
export type StrokeAuthor = 'user' | 'assistant';
export type BoardActor = 'user' | 'assistant';
export type EventIdentity = { id: string; time: number };
export function createAddEvent(strokes: readonly Stroke[], actor: BoardActor, identity: EventIdentity): BoardEvent;
export function createEraseEvent(strokes: readonly Stroke[], identity: EventIdentity): BoardEvent;
```

`Stroke.author` becomes `StrokeAuthor`; `BoardEvent.actor` becomes `BoardActor`. `BoardModel` accepts one-or-more changes for `add` and `erase`, while `move` remains exactly one change. Undo/redo compensates or repeats the full target batch.

- [ ] **Step 1: Write failing batch replay tests**

Add fixed assistant strokes and explicit event identities to `tests/core.test.ts`:

```ts
test('replays assistant batch add as one undoable operation', () => {
  const strokes = [stroke('assistant-1', 0, 'assistant'), stroke('assistant-2', 20, 'assistant')];
  const model = new BoardModel({ events: [createAddEvent(strokes, 'assistant', { id: 'assistant-add', time: 10 })] });
  expect(model.strokes.map(({ id }) => id)).toEqual(['assistant-1', 'assistant-2']);
  model.undo();
  expect(model.strokes).toEqual([]);
  expect(model.events.at(-1)).toMatchObject({ kind: 'undo', targetId: 'assistant-add', changes: [{ after: null }, { after: null }] });
  model.redo();
  expect(model.strokes.map(({ id }) => id)).toEqual(['assistant-1', 'assistant-2']);
});

test('batch erase removes only supplied visible strokes and undoes together', () => {
  const values = [stroke('one', 0), stroke('two', 20), stroke('three', 40)];
  const add = createAddEvent(values, 'user', { id: 'add-all', time: 1 });
  const erase = createEraseEvent(values.slice(0, 2), { id: 'erase-two', time: 2 });
  const model = new BoardModel({ events: [add, erase] });
  expect(model.strokes.map(({ id }) => id)).toEqual(['three']);
  model.undo();
  expect(model.strokes.map(({ id }) => id)).toEqual(['one', 'two', 'three']);
});
```

Extend the local `stroke` test helper with `author: StrokeAuthor = 'user'`.

- [ ] **Step 2: Verify the new tests fail**

Run: `npm test -- --run tests/core.test.ts`

Expected: FAIL because provenance types and event factories do not exist and replay rejects multi-change add/erase.

- [ ] **Step 3: Implement event factories and batch replay**

In `src/board.ts`:

- accept both authors/actors in shape validation;
- require non-empty, unique-ID change arrays;
- require every add change to be `null -> stroke` and every erase change to be `stroke -> null`;
- require every added stroke author to equal the add event actor;
- keep move actor/user-only and one-change;
- keep undo/redo actor user and validate full inverse/equality arrays;
- have `createAddEvent` and `createEraseEvent` clone all inputs and reject empty batches through normal `BoardModel` validation.

Do not add public mutation methods yet; later approval constructs candidate models from complete event arrays before replacing live state.

- [ ] **Step 4: Pin strict legacy validation**

In `tests/document.test.ts`, add:

```ts
test.each([1, 2])('legacy version %s rejects assistant and batch ink', (version) => {
  const assistant = legacyDocument(version, [createAddEvent([stroke('a', 0, 'assistant')], 'assistant', { id: 'a', time: 1 })]);
  expect(() => parseBoard(JSON.stringify(assistant))).toThrow(/legacy|user|single/i);
  const batch = legacyDocument(version, [createAddEvent([stroke('a', 0), stroke('b', 10)], 'user', { id: 'batch', time: 1 })]);
  expect(() => parseBoard(JSON.stringify(batch))).toThrow(/legacy|single/i);
});
```

Refactor `parseBoard` just enough to inspect `version` before ink validation and apply a `validateLegacyInk` guard for versions 1 and 2. Version-3 parsing is added in Task 3.

- [ ] **Step 5: Verify and commit batched canvas events**

Run: `npm test -- --run tests/core.test.ts tests/document.test.ts tests/gesture.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/board.ts src/document.ts tests/core.test.ts tests/document.test.ts
git commit -m "feat: add batched assistant canvas events"
```

---

### Task 2: Annotation objects and typed graph edges

**Files:**
- Modify: `src/association.ts`
- Modify: `tests/association.test.ts`
- Modify: `tests/temporal-fixtures.ts`
- Modify: `tests/object-panel.test.ts`

**Interfaces:**
- Produces:

```ts
export type WorkObjectBase = {
  id: string;
  label: string;
  strokeIds: string[];
  createdAt: number;
  lastAssociatedAt: number;
  status: 'active' | 'superseded';
  parentIds: string[];
};
export type ContentObject = WorkObjectBase & { objectType: 'content' };
export type GraphLink = { type: 'annotates' | 'points-to'; targetObjectId: string };
export type AnnotationObject = WorkObjectBase & {
  objectType: 'annotation';
  annotationKind: 'circle' | 'arrow';
  links: GraphLink[];
  proposalId: string;
  contextPosition: number;
  createdBy: 'assistant';
  approvedAt: number;
};
export type WorkObject = ContentObject | AnnotationObject;
```

`AssociationEventKind` gains `'assistant-annotation'`. `GraphEdge['type']` gains `'annotates' | 'points-to'`.

- [ ] **Step 1: Update explicit content fixtures and write failing annotation tests**

Add `objectType: 'content'` to every existing object fixture. Add `contentObject(id: string, strokeIds: string[]): ContentObject` and `annotationObject(id: string, strokeIds: string[], options: { kind: 'circle' | 'arrow'; relation: 'annotates' | 'points-to'; targetObjectId: string }): AnnotationObject` rather than repeating the union fields.

Add to `tests/association.test.ts`:

```ts
test('creates an annotation linked to an active content object', () => {
  const target = contentObject('target', ['user-stroke']);
  const annotation = annotationObject('note', ['assistant-shaft', 'assistant-head'], {
    kind: 'arrow', relation: 'points-to', targetObjectId: target.id,
  });
  const model = new AssociationModel([
    createEvent('content', 'auto-create', [{ before: null, after: target }]),
    createEvent('annotation', 'assistant-annotation', [{ before: null, after: annotation }]),
  ], new Set(['user-stroke', 'assistant-shaft', 'assistant-head']));
  expect(projectGraph(model, visibleStrokes()).edges).toContainEqual({ type: 'points-to', sourceId: 'note', targetId: 'target' });
});

test('rejects annotation links to missing or annotation targets', () => {
  expect(() => modelFor(annotationObject('note', ['assistant'], { targetObjectId: 'missing' }))).toThrow(/target/i);
  expect(() => modelForAnnotationChain()).toThrow(/content object/i);
});

test('content correction operations never accept annotation objects', () => {
  const model = modelWithContentAndAnnotation();
  expect(() => model.mergeObjects(['content-a', 'annotation-a'])).toThrow(/content/i);
  expect(() => model.splitObject('annotation-a', 'assistant-stroke')).toThrow(/content/i);
  expect(() => model.assignStroke('loose', 'annotation-a')).toThrow(/content/i);
});
```

- [ ] **Step 2: Run association tests and verify RED**

Run: `npm test -- --run tests/association.test.ts tests/object-panel.test.ts`

Expected: FAIL because the discriminated objects, event kind, and edge kinds are missing.

- [ ] **Step 3: Implement graph union validation**

Update association replay to:

- validate the common base first;
- require content objects to omit annotation-only fields;
- require annotation objects to have one-or-more member strokes, one link, finite non-negative integer `contextPosition`, non-empty proposal ID, assistant creator, and finite approval time;
- accept `assistant-annotation` only as a user-actor event with one `null -> annotation` change;
- require its target to be an existing active content object at that event prefix;
- reject annotation membership in auto-create/append/assign/merge/split operations;
- limit proximity and auto-association candidates to active content objects.

Update every object constructor inside `AssociationModel` and `migrateVersion1` to emit `objectType: 'content'`.

- [ ] **Step 4: Add graph projection and visibility tests**

```ts
test('projects annotation links and derives erased visibility from member strokes', () => {
  const { model, annotation, visibleWithoutAnnotation } = annotationGraphFixture();
  const graph = projectGraph(model, visibleWithoutAnnotation);
  expect(graph.edges).toContainEqual({ type: 'annotates', sourceId: annotation.id, targetId: 'target' });
  expect(graph.nodes.find(({ id }) => id === annotation.id)).toMatchObject({ objectType: 'annotation', visibleStrokeCount: 0 });
});

test('does not create near edges from annotation nodes', () => {
  const fixture = nearAnnotationFixture();
  const graph = projectGraph(fixture.model, fixture.visible);
  expect(graph.edges.filter(({ type }) => type === 'near').every(({ sourceId, targetId }) => ![sourceId, targetId].includes('annotation'))).toBe(true);
});

test('keeps annotation links on the original stable target after content merge', () => {
  const fixture = annotationThenMergeFixture();
  const edge = projectGraph(fixture.model, fixture.visible).edges.find(({ sourceId, type }) => sourceId === fixture.annotationId && type === 'annotates');
  expect(edge?.targetId).toBe(fixture.originalTargetId);
  expect(edge?.targetId).not.toBe(fixture.mergeChildId);
});
```

- [ ] **Step 5: Verify and commit graph annotations**

Run: `npm test -- --run tests/association.test.ts tests/object-panel.test.ts tests/temporal-index.test.ts tests/temporal-query.test.ts`

Run: `npm test`

```powershell
git add src/association.ts tests/association.test.ts tests/temporal-fixtures.ts tests/object-panel.test.ts
git commit -m "feat: add assistant annotation graph objects"
```

---

### Task 3: Version-3 parsing, migration, and temporal replay

**Files:**
- Modify: `src/document.ts`
- Modify: `src/workspace.ts`
- Modify: `src/storage.ts`
- Modify: `src/temporal.ts`
- Modify: `tests/document.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/workspace.test.ts`
- Modify: `tests/temporal-index.test.ts`
- Modify: `tests/temporal-query.test.ts`

**Interfaces:**
- Produces:

```ts
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
export function workspaceDocument(state: WorkspaceState): BoardDocumentV3;
```

`Temporal` functions consume `BoardDocumentV3`. `WorkspaceState` replaces `migratedFromVersion1` with `migratedFromVersion: 1 | 2 | null`.

`queryObjectHistory` extends its options with `includeAnnotationLinks?: boolean`. When true it adds `linkedAnnotationIds: string[]` and includes matching annotation-creation entries; omission preserves content-lineage-only behavior.

- [ ] **Step 1: Write failing migration and round-trip tests**

```ts
test.each([1, 2])('migrates version %s to version 3 without changing legacy replay', (sourceVersion) => {
  const parsed = parseBoard(JSON.stringify(legacyFixture(sourceVersion)));
  const state = loadWorkspace(parsed);
  const migrated = workspaceDocument(state);
  expect(migrated.version).toBe(3);
  expect(migrated.events.every(({ actor, changes }) => actor === 'user' && changes.every(({ before, after }) => (after ?? before)?.author === 'user'))).toBe(true);
  expect(migrated.associationEvents.flatMap(({ changes }) => changes.map(({ before, after }) => after ?? before)).every((object) => object?.objectType === 'content')).toBe(true);
  expect(state.migratedFromVersion).toBe(sourceVersion);
});

test('round-trips version 3 assistant batches and annotations exactly', () => {
  const document = version3AnnotationFixture();
  const parsed = parseBoard(serializeBoard(document));
  expect(parsed).toEqual({ sourceVersion: 3, document });
});
```

- [ ] **Step 2: Verify document tests fail**

Run: `npm test -- --run tests/document.test.ts tests/workspace.test.ts tests/storage.test.ts`

Expected: FAIL because version 3 is unsupported.

- [ ] **Step 3: Implement version-3 validation and migration**

In `document.ts`:

- keep strict version-1/version-2 validators;
- add version-3 ink validation through `BoardModel` plus explicit actor/author consistency;
- validate the content/annotation union and new association kind;
- validate the association model against every stroke ID ever appearing in ink history;
- serialize only validated version-3 documents.

In `workspace.ts`:

- load version 1 using existing deterministic association migration, now producing content objects;
- load version 2 by mapping every object snapshot to `objectType: 'content'` before `AssociationModel` construction;
- load version 3 without rewriting event data;
- always compose version 3.

Update storage/open result types and user-facing migration flags without changing the storage key, so existing autosaves are discovered and upgraded in place.

- [ ] **Step 4: Extend temporal dependency and erased-geometry tests**

```ts
test('orders annotation creation after every assistant member stroke', () => {
  const document = version3AnnotationFixture({ associationTime: 0, inkTime: 10 });
  const index = buildTemporalIndex(document);
  expect(index.entries.map(({ id }) => id)).toEqual(['ink:assistant-add', 'association:annotation-create']);
});

test('annotation history reconstructs approval, partial erase, batch delete, and undo', () => {
  const { document, positions } = annotationLifecycleFixture();
  const index = buildTemporalIndex(document);
  expect(projectHistory(document, index, positions.approved).board.strokes).toHaveLength(3);
  expect(projectHistory(document, index, positions.partialErase).board.strokes).toHaveLength(2);
  expect(projectHistory(document, index, positions.deleted).board.strokes).toHaveLength(0);
  expect(projectHistory(document, index, positions.undoDelete).board.strokes).toHaveLength(2);
});

test('ordinary region queries do not expose erased assistant IDs, entries, or geometry', () => {
  const fixture = erasedAssistantRegionFixture();
  expect(queryRegionHistory(fixture.document, fixture.index, fixture.region)).toMatchObject({ entries: [], strokeIds: [], erasedStrokeIds: [] });
});

test('object history follows annotation links only when explicitly requested', () => {
  const fixture = linkedAnnotationHistoryFixture();
  expect(queryObjectHistory(fixture.document, fixture.index, fixture.targetId).entries.map(({ eventId }) => eventId)).not.toContain('annotation-create');
  expect(queryObjectHistory(fixture.document, fixture.index, fixture.targetId, { includeAnnotationLinks: true })).toMatchObject({ linkedAnnotationIds: [fixture.annotationId] });
});
```

- [ ] **Step 5: Verify and commit version 3**

Run: `npm test -- --run tests/document.test.ts tests/storage.test.ts tests/workspace.test.ts tests/temporal-index.test.ts tests/temporal-query.test.ts`

Run: `npm run build`

```powershell
git add src/document.ts src/workspace.ts src/storage.ts src/temporal.ts tests/document.test.ts tests/storage.test.ts tests/workspace.test.ts tests/temporal-index.test.ts tests/temporal-query.test.ts
git commit -m "feat: migrate boards to document version 3"
```

---

### Task 4: Pure scripted proposal planner

**Files:**
- Create: `src/assistant-planner.ts`
- Create: `tests/assistant-planner.test.ts`
- Create: `tests/assistant-fixtures.ts`

**Interfaces:**
- Consumes: `BoardDocumentV3`, `TemporalIndex`, `AssociationModel`, `Bounds`, `Stroke`, and the 1C query functions.
- Produces:

```ts
export type ProposalKind = 'active-area-circle' | 'recent-work-arrow';
export type ProposalState = 'proposed' | 'approved' | 'rejected' | 'unavailable' | 'stale';
export type ProposalRevision = { inkEventCount: number; associationEventCount: number };
export type AssistantProposal = {
  id: string;
  generationId: string;
  fingerprint: string;
  kind: ProposalKind;
  state: ProposalState;
  targetObjectId: string;
  relation: 'annotates' | 'points-to';
  contextPosition: number;
  revision: ProposalRevision;
  candidateIndex: number;
  explanation: string;
  strokes: Stroke[];
  visible: boolean;
};
export type ProposalSlot = { kind: ProposalKind; proposal: AssistantProposal | null; message: string };
export type ProposalSet = { generationId: string; circle: ProposalSlot; arrow: ProposalSlot };
export type ProposalFingerprintInput = {
  kind: ProposalKind;
  targetObjectId: string;
  contextPosition: number;
  revision: ProposalRevision;
  candidateIndex: number;
  strokes: Array<Pick<Stroke, 'color' | 'width' | 'points'>>;
};
export function revisionOf(document: BoardDocumentV3): ProposalRevision;
export function generateProposalSet(document: BoardDocumentV3, index: TemporalIndex, associations: AssociationModel, rejected: ReadonlySet<string>): ProposalSet;
export function regenerateProposal(kind: ProposalKind, document: BoardDocumentV3, index: TemporalIndex, associations: AssociationModel, rejected: ReadonlySet<string>, afterCandidateIndex: number): ProposalSlot;
export function proposalFingerprint(input: ProposalFingerprintInput): string;
```

`tests/assistant-fixtures.ts` exports `PlannerFixture = { document: BoardDocumentV3; index: TemporalIndex; associations: AssociationModel }` plus the named fixtures used below. Tests pass those three fields explicitly; fixture creation uses only fixed IDs and timestamps.

- [ ] **Step 1: Write failing target-selection tests**

```ts
test('targets the content object owning the most recently changed visible user stroke', () => {
  const fixture = plannerFixture({ currentSegmentStrokeOrder: ['old-object-stroke', 'recent-object-stroke'] });
  const proposals = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
  expect(proposals.circle.proposal?.targetObjectId).toBe('recent-object');
  expect(proposals.arrow.proposal?.targetObjectId).toBe('recent-object');
});

test('ignores assistant annotations and falls back deterministically to visible content', () => {
  const fixture = annotationDominatedFixture();
  const proposals = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
  expect(proposals.circle.proposal?.targetObjectId).toBe('content-latest');
});

test('returns unavailable slots for an empty or annotation-only board', () => {
  for (const fixture of [emptyPlannerFixture(), annotationOnlyFixture()]) {
    const result = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
    expect([result.circle, result.arrow].every(({ proposal, message }) => proposal === null && message === 'Draw something first')).toBe(true);
  }
});

test('uses timeline order rather than the largest timestamp when source times regress', () => {
  const fixture = regressingPlannerFixture({ firstTime: 20_000, secondTime: 10_000 });
  const proposals = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
  expect(proposals.circle.proposal?.targetObjectId).toBe('second-source-entry-object');
});
```

- [ ] **Step 2: Verify target tests fail**

Run: `npm test -- --run tests/assistant-planner.test.ts`

Expected: FAIL because `assistant-planner.ts` is missing.

- [ ] **Step 3: Implement deterministic target selection**

Use the current segment's entry range with `queryChanges`, inspect ink changes newest-first, discard non-user snapshots and invisible IDs, and resolve active content ownership. Fallback sorting is descending `lastAssociatedAt`, then ascending ID. Derive the generation ID from canonical current revision plus target ID. Derive the proposal ID from the fingerprint, then derive member stroke IDs from proposal ID plus member index; fingerprint geometry deliberately excludes IDs and timestamps so this ordering is not circular.

- [ ] **Step 4: Add circle geometry and fingerprint tests**

```ts
test.each([
  [{ minX: 10, minY: 20, maxX: 10, maxY: 20 }, 18],
  [{ minX: -30, minY: -10, maxX: 50, maxY: 30 }, 28],
])('builds a closed finite ellipse for bounds %o and padding %s', (bounds, padding) => {
  const proposal = circleProposalFor(bounds, padding);
  const points = proposal.strokes[0].points;
  expect(points.at(-1)).toEqual(points[0]);
  expect(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  expect(proposal.fingerprint).toBe(circleProposalFor(bounds, padding).fingerprint);
});

test('circle regeneration skips rejected padding variants and exhausts cleanly', () => {
  const fixture = plannerFixture();
  const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).circle.proposal!;
  const second = regenerateProposal('active-area-circle', fixture.document, fixture.index, fixture.associations, new Set([first.fingerprint]), first.candidateIndex);
  expect(second.proposal?.candidateIndex).toBeGreaterThan(first.candidateIndex);
  expect(exhaustCircleCandidates(fixture).message).toMatch(/unused circle/i);
});
```

Implement ellipse sampling with minimum radii, paddings `[18, 28, 38]`, fixed angular steps, repeated closure point, assistant provenance, and canonical numeric serialization for fingerprints.

- [ ] **Step 5: Add arrow collision and stability tests**

```ts
test('chooses clear right placement before equally clear alternatives', () => {
  expect(generateArrow(clearBoardFixture()).candidateIndex).toBe(candidateIndex('right', 0));
});

test('moves to the lowest-collision side and skips rejected fingerprints', () => {
  const fixture = rightBlockedFixture();
  const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
  expect(arrowDirection(first)).toBe('left');
  const next = regenerateProposal('recent-work-arrow', fixture.document, fixture.index, fixture.associations, new Set([first.fingerprint]), first.candidateIndex);
  expect(next.proposal?.fingerprint).not.toBe(first.fingerprint);
});

test('returns a finite stable candidate on a fully occupied board', () => {
  const fixture = crowdedFixture();
  const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
  const second = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
  expect(second).toEqual(first);
  expect(first.strokes.flatMap(({ points }) => points).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  expect(first.explanation).toMatch(/crowded/i);
});
```

Implement direction/offset candidate enumeration, inclusive intersection scoring, target-tip allowance, stable tuple sorting, and three strokes per arrow.

- [ ] **Step 6: Verify and commit the planner**

Run: `npm test -- --run tests/assistant-planner.test.ts tests/temporal-query.test.ts`

Run: `npm test`

```powershell
git add src/assistant-planner.ts tests/assistant-planner.test.ts tests/assistant-fixtures.ts
git commit -m "feat: generate deterministic assistant proposals"
```

---

### Task 5: Assistant session and atomic workspace transactions

**Files:**
- Create: `src/assistant-session.ts`
- Create: `tests/assistant-session.test.ts`
- Modify: `src/workspace.ts`
- Modify: `tests/workspace.test.ts`

**Interfaces:**
- Produces:

```ts
export type AssistantSession = {
  proposals: ProposalSet | null;
  rejectedFingerprints: Set<string>;
};
export function createAssistantSession(): AssistantSession;
export function generateAssistantSession(workspace: WorkspaceState, history: HistorySession, session: AssistantSession): AssistantSession;
export function rejectAssistantProposal(session: AssistantSession, kind: ProposalKind): AssistantSession;
export function regenerateAssistantSlot(workspace: WorkspaceState, history: HistorySession, session: AssistantSession, kind: ProposalKind): AssistantSession;
export function setProposalVisibility(session: AssistantSession, kind: ProposalKind, visible: boolean): AssistantSession;
export function invalidateAssistantSession(session: AssistantSession, message?: string): AssistantSession;
export function approveAssistantProposal(workspace: WorkspaceState, history: HistorySession, session: AssistantSession, kind: ProposalKind, time: number): { session: AssistantSession; annotationId: string };
export function deleteAnnotation(workspace: WorkspaceState, history: HistorySession, annotationId: string, identity: EventIdentity): string | null;
```

- [ ] **Step 1: Write failing ephemeral-session tests**

```ts
test('preview generation and rejection do not mutate the document', () => {
  const workspace = assistantWorkspaceFixture();
  const history = createHistorySession(workspace);
  const before = serializeBoard(workspaceDocument(workspace));
  let session = generateAssistantSession(workspace, history, createAssistantSession());
  const rejected = session.proposals!.circle.proposal!.fingerprint;
  session = rejectAssistantProposal(session, 'active-area-circle');
  expect(session.rejectedFingerprints.has(rejected)).toBe(true);
  expect(serializeBoard(workspaceDocument(workspace))).toBe(before);
});

test('regeneration changes only the requested slot and never repeats a rejected fingerprint', () => {
  const fixture = assistantSessionFixture();
  const arrowBefore = fixture.session.proposals!.arrow.proposal;
  const rejectedCircle = fixture.session.proposals!.circle.proposal!.fingerprint;
  let session = rejectAssistantProposal(fixture.session, 'active-area-circle');
  session = regenerateAssistantSlot(fixture.workspace, fixture.history, session, 'active-area-circle');
  expect(session.proposals!.circle.proposal?.fingerprint).not.toBe(rejectedCircle);
  expect(session.proposals!.arrow.proposal).toEqual(arrowBefore);
});
```

- [ ] **Step 2: Implement immutable session transitions**

Clone sets and proposal data on every transition. Generation must reject historical sessions. Rejection changes only the selected slot. Regeneration passes the selected slot's candidate index and shared rejection set to the planner. Invalidation removes all preview strokes, retains rejected fingerprints, and marks existing cards stale with the supplied message.

- [ ] **Step 3: Write failing atomic approval tests**

```ts
test('approval atomically appends one assistant batch and one annotation object', () => {
  const fixture = assistantSessionFixture();
  const result = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'recent-work-arrow', 50_000);
  const document = workspaceDocument(fixture.workspace);
  expect(document.events.at(-1)).toMatchObject({ actor: 'assistant', kind: 'add', changes: [{ before: null }, { before: null }, { before: null }] });
  expect(document.associationEvents.at(-1)).toMatchObject({ actor: 'user', kind: 'assistant-annotation' });
  expect(fixture.workspace.associations.objects.find(({ id }) => id === result.annotationId)).toMatchObject({ objectType: 'annotation', annotationKind: 'arrow' });
});

test.each(['stale revision', 'missing target', 'duplicate stroke ID', 'non-finite geometry'])('failed approval for %s leaves both logs unchanged', (fault) => {
  const fixture = brokenApprovalFixture(fault);
  const before = serializeBoard(workspaceDocument(fixture.workspace));
  expect(() => approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, fixture.kind, 50_000)).toThrow();
  expect(serializeBoard(workspaceDocument(fixture.workspace))).toBe(before);
});

test('approval preserves same-generation sibling geometry and rebases only its revision', () => {
  const fixture = assistantSessionFixture();
  const arrowBefore = structuredClone(fixture.session.proposals!.arrow.proposal!);
  const result = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'active-area-circle', 50_000);
  const arrowAfter = result.session.proposals!.arrow.proposal!;
  expect(arrowAfter.strokes).toEqual(arrowBefore.strokes);
  expect(arrowAfter.fingerprint).toBe(arrowBefore.fingerprint);
  expect(arrowAfter.revision).toEqual(revisionOf(workspaceDocument(fixture.workspace)));
});
```

- [ ] **Step 4: Implement validate-then-commit approval**

Build stable IDs from the proposal (`event:${proposal.id}`, `annotation:${proposal.id}`, `association:${proposal.id}`). Verify current revision, live history, target state, rejection set, geometry, and all ID namespaces. Construct candidate `BoardModel` and candidate `AssociationModel` from copied event arrays. Only after both constructors succeed assign both candidates to `WorkspaceState`.

Keep the approved card in session with `state: 'approved'` and `visible: false`, so the panel can acknowledge the decision without rendering preview geometry. For the same-generation sibling, recheck target visibility, finite geometry, and non-collision of IDs, then update only its revision counts. Mark it stale if revalidation fails. Invalidate unrelated generations.

- [ ] **Step 5: Add annotation deletion and undo tests**

```ts
test('deletes only currently visible annotation members as one batch', () => {
  const fixture = partiallyErasedArrowFixture();
  const eventId = deleteAnnotation(fixture.workspace, fixture.history, fixture.annotationId, { id: 'delete-arrow', time: 60_000 });
  expect(eventId).toBe('delete-arrow');
  expect(fixture.workspace.board.events.at(-1)?.changes).toHaveLength(2);
  expect(annotationVisibility(fixture.workspace, fixture.annotationId)).toBe(0);
  fixture.workspace.board.undo();
  expect(annotationVisibility(fixture.workspace, fixture.annotationId)).toBe(2);
  expect(fixture.workspace.board.strokes.map(({ id }) => id)).not.toContain(fixture.previouslyErasedId);
});

test('deletion rejects content objects, historical mode, and empty annotations', () => {
  expect(() => deleteAnnotation(contentWorkspace(), liveHistory(), 'content', identity)).toThrow(/annotation/i);
  expect(() => deleteAnnotation(annotationWorkspace(), historicalHistory(), 'annotation', identity)).toThrow(/historical|now/i);
  expect(deleteAnnotation(emptyAnnotationWorkspace(), liveHistory(), 'annotation', identity)).toBeNull();
});
```

Build the erase event from visible member snapshots and replace the board only after candidate replay passes. The UI supplies the historical-mode guard; the exported function still validates object type and visibility.

- [ ] **Step 6: Verify and commit assistant transactions**

Run: `npm test -- --run tests/assistant-session.test.ts tests/workspace.test.ts tests/history-session.test.ts`

Run: `npm test`

```powershell
git add src/assistant-session.ts src/workspace.ts tests/assistant-session.test.ts tests/workspace.test.ts
git commit -m "feat: add approved assistant insertion transactions"
```

---

### Task 6: Proposal panel, preview rendering, and annotation controls

**Files:**
- Create: `src/assistant-panel.ts`
- Create: `tests/assistant-panel.test.ts`
- Modify: `src/canvas.ts`
- Modify: `src/object-panel.ts`
- Modify: `tests/object-panel.test.ts`
- Modify: `src/main.ts` only for temporary compile-safe call-site fields

**Interfaces:**
- Produces:

```ts
export type AssistantPanelState = {
  open: boolean;
  proposals: ProposalSet | null;
  readOnly: boolean;
};
export type AssistantPanelActions = {
  onClose(): void;
  onGenerate(): void;
  onApprove(kind: ProposalKind): void;
  onReject(kind: ProposalKind): void;
  onRegenerate(kind: ProposalKind): void;
  onTogglePreview(kind: ProposalKind, visible: boolean): void;
};
export class AssistantPanel {
  constructor(root: HTMLElement, actions: AssistantPanelActions);
  render(state: AssistantPanelState): void;
  focusHeading(): void;
}
```

`RenderState` gains `assistantPreviewStrokes: Stroke[]`. `derivePanelControls` gains `canDeleteSelectedAnnotation`; `ObjectPanelActions` gains `onDeleteSelectedAnnotation()`. Export `visiblePreviewStrokes(proposals: ProposalSet | null): Stroke[]` from `assistant-panel.ts`.

- [ ] **Step 1: Write failing proposal-card view-model tests**

Expose a pure `deriveAssistantPanelCards(state)` and test:

```ts
test('derives independent controls for proposed, rejected, approved, unavailable, stale, and read-only cards', () => {
  expect(cardFor('proposed')).toMatchObject({ canApprove: true, canReject: true, canRegenerate: false, canToggle: true });
  expect(cardFor('rejected')).toMatchObject({ canApprove: false, canReject: false, canRegenerate: true, canToggle: false });
  expect(cardFor('stale')).toMatchObject({ canRegenerate: true, canApprove: false });
  expect(cardFor('unavailable')).toMatchObject({ canApprove: false, canRegenerate: false });
  expect(cardFor('proposed', { readOnly: true })).toMatchObject({ canApprove: false, canReject: false, canRegenerate: false });
});

test('renders target, explanation, provenance, and accessible preview state without raw IDs as primary copy', () => {
  const card = deriveAssistantPanelCards(panelState()).find(({ kind }) => kind === 'recent-work-arrow')!;
  expect(card.title).toBe('Recent-work arrow');
  expect(card.explanation).toMatch(/clearest nearby space/i);
  expect(card.previewLabel).toMatch(/arrow preview/i);
});
```

- [ ] **Step 2: Implement stable native panel controls**

Follow the stable-DOM approach in `timeline-panel.ts`: rebuild card markup only when proposal IDs change, store the latest state on the class, and update disabled/state text without replacing focused controls. Render a Generate button for an empty session and separate cards with preview checkbox, Approve, Reject, and Regenerate.

- [ ] **Step 3: Write preview rendering tests around pure render state**

No pixel-snapshot test is required. Add a pure `visiblePreviewStrokes(proposals)` helper and test defensive filtering:

```ts
test('returns defensive strokes only from proposed visible cards', () => {
  const proposals = mixedProposalSet();
  const strokes = visiblePreviewStrokes(proposals);
  expect(strokes.map(({ id }) => id)).toEqual(['visible-circle']);
  strokes[0].points[0].x = 999;
  expect(visiblePreviewStrokes(proposals)[0].points[0].x).not.toBe(999);
});
```

In `CanvasRenderer.render`, draw preview strokes after committed ink/heat and before selection/object overlays. Use a violet dashed line, fixed screen-space dash/halo widths converted by zoom, `globalAlpha < 1`, and no hit-test path. Skip preview work when the array is empty.

- [ ] **Step 4: Add annotation-aware object controls**

```ts
test('content corrections exclude checked annotation nodes', () => {
  const result = derivePanelControls(stateWithCheckedContentAndAnnotation());
  expect(result.canMerge).toBe(false);
});

test('enables whole-annotation deletion only for a live selected annotation with visible members', () => {
  expect(derivePanelControls(annotationState({ visibleStrokeCount: 2 }))).toMatchObject({ canDeleteSelectedAnnotation: true });
  expect(derivePanelControls(annotationState({ visibleStrokeCount: 0 }))).toMatchObject({ canDeleteSelectedAnnotation: false });
  expect(derivePanelControls(annotationState({ readOnly: true, visibleStrokeCount: 2 }))).toMatchObject({ canDeleteSelectedAnnotation: false });
});
```

Add annotation badges, kind/link details, distinct graph classes, and **Delete annotation**. Preserve selection and inspection in history while disabling deletion.

- [ ] **Step 5: Verify and commit UI components**

Temporarily pass `assistantPreviewStrokes: []` and a no-op guarded deletion action from `main.ts`; Task 7 replaces them.

Run: `npm test -- --run tests/assistant-panel.test.ts tests/object-panel.test.ts`

Run: `npm run typecheck`

```powershell
git add src/assistant-panel.ts src/canvas.ts src/object-panel.ts src/main.ts tests/assistant-panel.test.ts tests/object-panel.test.ts
git commit -m "feat: add assistant proposal preview controls"
```

---

### Task 7: Browser coordination, documentation, and acceptance

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-20-milestone-1d.md`
- Create: `docs/milestone-1d-verification.md`
- Create: `tests/assistant-coordination.test.ts`

**Interfaces:**
- Consumes every earlier interface and makes no new persistent model abstraction.

- [ ] **Step 1: Write failing coordination policy tests**

Move mutation-to-invalidation decisions into a pure helper in `assistant-session.ts`:

```ts
export type WorkspaceMutation = 'ink' | 'undo' | 'redo' | 'association' | 'import' | 'assistant-approval' | 'partial-erase' | 'annotation-delete' | 'viewport';
export function afterWorkspaceMutation(session: AssistantSession, mutation: WorkspaceMutation, approvedGenerationId?: string): AssistantSession;
```

Test every class:

```ts
test.each(['ink', 'undo', 'redo', 'association', 'import', 'partial-erase', 'annotation-delete'] as const)('%s invalidates previews but retains rejection memory', (mutation) => {
  const next = afterWorkspaceMutation(sessionWithProposalsAndRejections(), mutation);
  expect(visiblePreviewStrokes(next.proposals)).toEqual([]);
  expect(next.rejectedFingerprints).toEqual(new Set(['rejected-fingerprint']));
});

test('viewport preserves proposals and assistant approval preserves only a valid same-generation sibling', () => {
  expect(afterWorkspaceMutation(sessionWithProposals(), 'viewport')).toEqual(sessionWithProposals());
  expect(afterWorkspaceMutation(sessionWithProposals(), 'assistant-approval', 'generation-1').proposals?.arrow.proposal?.generationId).toBe('generation-1');
});
```

- [ ] **Step 2: Add markup and panel coordination**

Add `#assistant-toggle`, `#assistant-panel`, and any narrow-screen backdrop hooks. In `main.ts`:

- create one `AssistantSession` next to `HistorySession`;
- generate only at Now and focus the panel heading;
- render visible proposal strokes through Canvas;
- guard approve/reject/regenerate/delete actions again outside DOM disabled state;
- call `afterWorkspaceMutation` after every ink, undo, redo, association correction, import, partial erase, annotation delete, and approval path;
- preserve proposals through pan/zoom;
- on entering history, discard previews without recording rejection and close Assistant;
- reset assistant state on board replacement;
- persist once after approval/deletion and rebuild temporal history;
- preserve live selection and object-panel behavior;
- make Assistant, Objects, and History mutually exclusive below 760px;
- implement Escape close/focus restoration for Assistant without breaking History's two-stage Escape.

- [ ] **Step 3: Add responsive and provenance styles**

Desktop cards must fit without reducing the canvas below its usable minimum. Below 760px, use a bottom overlay no taller than 58vh with every action reachable at 500px. Style dashed violet previews, annotation graph nodes, badges, card states, and read-only controls. Do not rely on color alone.

- [ ] **Step 4: Update product documentation**

Document in README:

- the explicit suggestion/preview/approval flow;
- circle and arrow benchmark logic;
- session-only rejection memory;
- version-3 provenance and migration;
- independent approval, per-stroke erase, whole-annotation deletion, and undo;
- annotation graph links and historical behavior;
- deferred model, text, and rewrite scope.

- [ ] **Step 5: Run the complete automated gate**

Run: `npm test`

Expected: every test passes.

Run: `npm run build`

Expected: TypeScript and Vite production bundling pass.

Run: `npm audit --audit-level=moderate`

Expected: zero moderate-or-higher vulnerabilities.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Run production-browser acceptance with Playwright CLI**

Use an isolated session against `npm run preview`; save ignored evidence under `output/playwright/`. Exercise:

1. Empty board: Assistant opens, both slots say **Draw something first**, and no document data changes.
2. Recent-work targeting: create two content objects with activity in different segments; both proposals target the current/recent eligible object.
3. Preview isolation: toggle circle/arrow previews independently and assert exact serialized autosave equality, unchanged event counts, unchanged graph, and unchanged undo state.
4. Independent decisions: reject circle, approve arrow, confirm arrow persists and circle can regenerate without repeating its fingerprint; reverse the order in a fresh session.
5. Placement: block the right side, confirm the arrow selects the next lowest-collision side, stays aligned through pan/zoom, and shows crowded copy when every side intersects.
6. Stale protection: generate proposals, then exercise ink, undo, redo, grouping correction, partial erase, and import mutations; approval must refuse every stale proposal. Pan/zoom must preserve it.
7. Annotation editing: erase one arrowhead, verify two visible members remain, delete the annotation, then undo/redo the batch and verify graph visibility at each state.
8. History: scrub through assistant batch add, annotation creation, partial erase, deletion, and undo; every historical position remains read-only and unapproved previews never appear.
9. Migration/reload: open fixed version-1 and version-2 files, verify deterministic version-3 output, approve an annotation, reload, and compare event IDs, provenance, graph links, and temporal order.
10. Persistence failure: force `localStorage.setItem` to throw during approval, verify the annotation remains in memory, the status says it was not saved locally, and **Save file** remains enabled.
11. Accessibility/responsive: repeated keyboard actions retain focus, Escape returns focus to Assistant, panels exclude each other at 500px, 2x canvas sizing remains correct, and console/page errors are zero.

- [ ] **Step 7: Record evidence and request one whole-branch review**

Write `docs/milestone-1d-verification.md` with exact test counts, build/audit results, browser evidence, migration results, review findings/corrections, and physical/cross-browser limits.

Ask one fresh reviewer to inspect `origin/main..HEAD` against the spec and this plan, concentrating on atomic dual-log commits, provenance/migration, same-generation sibling rebasing, session-only rejection isolation, content/annotation separation, batch undo/redo, temporal dependency order, and historical write guards. Fix every Critical/Important finding with regression tests and rerun affected browser scenarios.

- [ ] **Step 8: Commit, push, and open the pull request**

```powershell
git add index.html src/main.ts src/style.css src/assistant-session.ts README.md docs/milestone-1d-verification.md docs/superpowers/plans/2026-09-20-milestone-1d.md tests/assistant-coordination.test.ts
git commit -m "feat: add approved assistant annotation flow"
git push -u origin feat/milestone-1d
```

Create a pull request against `main`, attach it to the Codex task, and verify the remote head SHA and GitHub `verify` check before reporting completion.

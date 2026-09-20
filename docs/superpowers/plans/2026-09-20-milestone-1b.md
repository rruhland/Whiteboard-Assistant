# Milestone 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn native ink into persistent, correctable work objects and expose their spatial/temporal graph without adding learned perception.

**Architecture:** Keep `BoardModel` authoritative for ink and add a pure `AssociationModel` with its own append-only event history. A version-2 document composes both histories; the browser coordinator associates completed strokes, while a dedicated inspector and optional canvas overlays expose and correct the graph.

**Tech Stack:** TypeScript, native Canvas and Pointer Events, native DOM/SVG, Vite, Vitest, Playwright CLI for browser acceptance.

**Spec:** `docs/superpowers/specs/2026-09-20-milestone-1b-design.md`

**Execution status:** Implemented through Task 5 on `feat/milestone-1b`. Automated and production-browser evidence is recorded in `docs/milestone-1b-verification.md`.

## Global Constraints

- Preserve every 1A ink event, stroke ID, world coordinate, undo/redo behavior, viewport, autosave, and portable-file behavior.
- Accept version-1 files and always emit validated version-2 files.
- Association is deterministic geometry/time infrastructure. Do not add semantic inference, OCR, models, a graph database, occupancy maps, references, or assistant drawing.
- Bounds are optional debug overlays and never become drawing regions or canvas hit targets.
- Manual merge/split creates lineage and never rewrites prior association history.
- Board undo/redo continues to affect ink only; 1B does not add grouping undo/redo.
- Keep the app framework-free and retain accessible keyboard behavior and narrow-layout support.

## Review Focus

- Undoing or redoing an ink add/erase must change visibility and bounds without changing the stroke's object membership.
- A version-2 file with intentionally unassigned visible strokes must remain unassigned after load; only version-1 migration automatically proposes groups.
- Superseded parents may share member IDs with descendants, while two active objects must never claim the same stroke.
- Split/merge failures must leave the association event log byte-for-byte unchanged.
- Drawing while the inspector is open, panning/zooming, high-DPI rendering, and a narrow viewport must preserve world geometry and usable controls.

---

### Task 1: Versioned document boundary

**Files:**
- Create: `src/association.ts`
- Create: `src/document.ts`
- Modify: `src/board.ts`
- Modify: `src/storage.ts`
- Modify: `tests/core.test.ts`
- Modify: `tests/storage.test.ts`
- Create: `tests/document.test.ts`

**Interfaces:**
- Consumes: existing `BoardEvent`, `BoardModel`, and `Viewport` from `src/board.ts`.
- Produces the shared association event schema and versioned document boundary:

```ts
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
export type ObjectChange = { before: WorkObject | null; after: WorkObject | null };
export type AssociationEvent = {
  id: string;
  time: number;
  actor: 'system' | 'user';
  kind: AssociationEventKind;
  reason: string;
  changes: ObjectChange[];
};

export type ParsedBoard =
  | { sourceVersion: 1; document: BoardDocumentV1 }
  | { sourceVersion: 2; document: BoardDocumentV2 };

export function parseBoard(json: string): ParsedBoard;
export function serializeBoard(document: BoardDocumentV2): string;
export function composeBoardDocument(
  board: BoardModel,
  associations: { readonly events: AssociationEvent[] },
  viewport: Viewport,
): BoardDocumentV2;
```

- `BoardModel` constructor accepts `{ events: BoardEvent[] }`; its existing `events` getter remains the defensive ink-history boundary. Document composition leaves `BoardModel` unaware of associations.

- [ ] **Step 1: Add failing version-boundary tests**

```ts
test('distinguishes version 1 from version 2 without auto-grouping version 2', () => {
  expect(parseBoard(JSON.stringify(v1)).sourceVersion).toBe(1);
  const parsed = parseBoard(JSON.stringify({ ...v1, version: 2, associationEvents: [] }));
  expect(parsed).toEqual({ sourceVersion: 2, document: { ...v1, version: 2, associationEvents: [] } });
});

test('compose preserves the exact ink log and adds association history', () => {
  const associations = { events: [] as AssociationEvent[] };
  const result = composeBoardDocument(board, associations, viewport);
  expect(result.events).toEqual(board.events);
  expect(result.associationEvents).toEqual(associations.events);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run tests/document.test.ts tests/storage.test.ts tests/core.test.ts`

Expected: imports from `src/document.ts` fail because the document boundary does not exist.

- [ ] **Step 3: Extract document parsing and composition**

Define the work-object and association-event data types in `association.ts`. Implement strict version discrimination and retain the existing ink-event replay validation by constructing `BoardModel`; Task 2 adds semantic replay validation for association events. Update storage helpers to operate on `BoardDocumentV2`; `readPortableBoard` returns the `ParsedBoard` so the coordinator alone decides whether migration is required.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- --run tests/document.test.ts tests/storage.test.ts tests/core.test.ts`

Expected: all focused tests pass.

Run: `npm test`

Expected: the full 1A suite passes with adapted imports and no behavior changes.

- [ ] **Step 5: Commit the versioned boundary**

```powershell
git add src/association.ts src/board.ts src/document.ts src/storage.ts tests/core.test.ts tests/storage.test.ts tests/document.test.ts
git commit -m "refactor: add versioned board document boundary"
```

---

### Task 2: Association replay, proposal policy, commands, and graph projection

**Files:**
- Modify: `src/association.ts`
- Create: `tests/association.test.ts`
- Modify: `src/document.ts`
- Modify: `tests/document.test.ts`

**Interfaces:**
- Consumes: `Stroke` and all known stroke IDs extracted from ink add events.
- Completes the Task 1 association types with:

```ts
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GraphNode = WorkObject & { bounds?: Bounds; visibleStrokeCount: number };
export type GraphEdge = { type: 'near' | 'derived-from'; sourceId: string; targetId: string };

export class AssociationModel {
  constructor(events: AssociationEvent[], knownStrokeIds: ReadonlySet<string>);
  get events(): AssociationEvent[];
  get objects(): WorkObject[];
  associateStroke(stroke: Stroke, visibleStrokes: readonly Stroke[]): string;
  assignStroke(strokeId: string, objectId?: string): string;
  mergeObjects(objectIds: readonly string[]): string;
  splitObject(objectId: string, selectedStrokeId: string): readonly [string, string];
}

export function migrateVersion1(strokes: readonly Stroke[], knownStrokeIds: ReadonlySet<string>): AssociationModel;
export function getUnassignedVisibleStrokes(model: AssociationModel, visible: readonly Stroke[]): Stroke[];
export function getObjectBounds(object: WorkObject, visible: readonly Stroke[]): Bounds | undefined;
export function projectGraph(model: AssociationModel, visible: readonly Stroke[]): { nodes: GraphNode[]; edges: GraphEdge[] };
```

- [ ] **Step 1: Add failing proposal-policy tests**

```ts
test('grows a nearby object after a long gap and a recent object within the wider radius', () => {
  const model = new AssociationModel([], ids);
  const firstId = model.associateStroke(stroke('a', 0, 0, 0), [stroke('a', 0, 0, 0)]);
  expect(model.associateStroke(stroke('b', 20, 0, 60_000), visibleAB)).toBe(firstId);
  expect(model.associateStroke(stroke('c', 70, 0, 61_000), visibleABC)).toBe(firstId);
  expect(model.associateStroke(stroke('d', 200, 0, 62_000), visibleABCD)).not.toBe(firstId);
});

test('breaks equal candidates by distance, recency, then stable ID', () => {
  expect(proposedObjectId).toBe(expectedStableWinner);
});
```

- [ ] **Step 2: Verify proposal tests fail for the missing module**

Run: `npm test -- --run tests/association.test.ts`

Expected: FAIL because `src/association.ts` does not exist.

- [ ] **Step 3: Implement bounds and automatic association**

Use point extents expanded by half stroke width. Compute rectangle gap with Euclidean distance. Apply exact thresholds `24`, `80`, and `12_000` milliseconds and deterministic tie-breaking. Generate labels `A` through `Z`, then `AA`, `AB`, and so on from creation order. Return the chosen object ID from every successful command.

- [ ] **Step 4: Add failing replay and atomic-command tests**

```ts
test('merge supersedes parents and creates one active child with both memberships', () => {
  const childId = model.mergeObjects([leftId, rightId]);
  const child = model.objects.find(({ id }) => id === childId)!;
  expect(child.parentIds).toEqual([leftId, rightId]);
  expect(child.strokeIds).toEqual([leftStrokeId, rightStrokeId]);
  expect(activeIds(model)).toEqual([childId]);
});

test('failed split is atomic', () => {
  const before = JSON.stringify(model.events);
  expect(() => model.splitObject(singletonId, onlyStrokeId)).toThrow(/two member strokes/i);
  expect(JSON.stringify(model.events)).toBe(before);
});
```

- [ ] **Step 5: Implement validated append-only commands**

Build complete event changes in local values, validate them by replay against cloned state, then append only after replay succeeds. Merge requires at least two distinct active objects. Split requires one active object with at least two total members and creates selected/rest children. Assignment rejects strokes already claimed by an active object. Historical parent memberships remain valid; active membership is unique.

- [ ] **Step 6: Add failing invalid-history and graph tests**

```ts
test.each([
  ['unknown stroke', unknownStrokeEvents],
  ['duplicate event', duplicateEventEvents],
  ['wrong before state', wrongBeforeEvents],
  ['duplicate active membership', duplicateMembershipEvents],
  ['lineage cycle', cyclicEvents],
])('rejects %s', (_name, events) => expect(() => new AssociationModel(events, ids)).toThrow());

test('projects current near edges and historical lineage edges', () => {
  const graph = projectGraph(model, visible);
  expect(graph.edges).toEqual(expect.arrayContaining([
    { type: 'near', sourceId: nearbyA, targetId: nearbyB },
    { type: 'derived-from', sourceId: child, targetId: parent },
  ]));
});
```

- [ ] **Step 7: Implement replay, migration, and graph projection**

Migration sorts current visible strokes by `createdAt`, then stroke ID, uses deterministic IDs `work-v1-<first-stroke-id>` and `assoc-v1-<stroke-id>`, and applies the same proposal thresholds. `projectGraph` creates one canonical undirected `near` edge per active pair within 120 world units and directed child-to-parent lineage edges.

- [ ] **Step 8: Verify core and document integration**

Run: `npm test -- --run tests/association.test.ts tests/document.test.ts`

Expected: proposal, replay, migration, command, graph, and round-trip tests all pass.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 9: Commit the association core**

```powershell
git add src/association.ts src/document.ts tests/association.test.ts tests/document.test.ts
git commit -m "feat: add persistent work object graph"
```

---

### Task 3: Coordinate ink and associations

**Files:**
- Modify: `src/main.ts`
- Modify: `src/storage.ts`
- Create: `src/workspace.ts`
- Create: `tests/workspace.test.ts`

**Interfaces:**
- Consumes: `BoardModel`, `AssociationModel`, parsed version metadata, and existing storage helpers.
- Produces:

```ts
export type WorkspaceState = {
  board: BoardModel;
  associations: AssociationModel;
  viewport: Viewport;
  migratedFromVersion1: boolean;
};

export function loadWorkspace(parsed: ParsedBoard): WorkspaceState;
export function commitStroke(
  state: WorkspaceState,
  points: Point[],
  color: string,
  width: number,
): { strokeId: string; objectId?: string; associationError?: string };
export function workspaceDocument(state: WorkspaceState): BoardDocumentV2;
```

- `BoardModel.addStroke(...)` returns the created stroke ID without changing its existing event behavior.

- [ ] **Step 1: Add failing coordinator tests**

```ts
test('commits ink and association before producing an autosave document', () => {
  const result = commitStroke(state, [point(1, 1)], '#000', 4);
  const saved = workspaceDocument(state);
  expect(saved.events.at(-1)?.changes[0].after?.id).toBe(result.strokeId);
  expect(saved.associationEvents.at(-1)?.changes[0].after?.strokeIds).toContain(result.strokeId);
});

test('keeps committed ink visible when association throws', () => {
  vi.spyOn(state.associations, 'associateStroke').mockImplementation(() => { throw new Error('association failed'); });
  const result = commitStroke(state, [point(1, 1)], '#000', 4);
  expect(state.board.strokes.map(({ id }) => id)).toContain(result.strokeId);
  expect(result.associationError).toBeTruthy();
});

test('ink undo and redo change visibility without changing membership', () => {
  const result = commitStroke(state, [point(1, 1)], '#000', 4);
  const objectId = result.objectId!;
  state.board.undo();
  expect(state.associations.objects.find(({ id }) => id === objectId)?.strokeIds).toContain(result.strokeId);
  state.board.redo();
  expect(state.associations.objects.find(({ id }) => id === objectId)?.strokeIds).toContain(result.strokeId);
});

test('version 2 load preserves an intentionally unassigned visible stroke', () => {
  const loaded = loadWorkspace({ sourceVersion: 2, document: version2WithInkAndNoAssociations });
  expect(getUnassignedVisibleStrokes(loaded.associations, loaded.board.strokes)).toHaveLength(1);
});
```

- [ ] **Step 2: Verify coordinator tests fail**

Run: `npm test -- --run tests/workspace.test.ts`

Expected: FAIL because `src/workspace.ts` and the stroke-ID return value do not exist.

- [ ] **Step 3: Implement load, migration, coordinated commit, and composition**

Version 1 loads `BoardModel`, migrates only current visible strokes, and marks the workspace migrated. Version 2 replays its association log exactly and never silently assigns unassigned strokes. `commitStroke` catches only association failures after ink commit and reports them to the caller.

- [ ] **Step 4: Wire the browser coordinator**

Replace separate board/document assumptions in `main.ts` with one `WorkspaceState`. After ink edits, moves, erase, undo, and redo, refresh current graph projections without reclassifying membership. Autosave and file export call `workspaceDocument`. Import constructs the complete new workspace before replacing the current one.

- [ ] **Step 5: Verify integration tests and the full suite**

Run: `npm test -- --run tests/workspace.test.ts tests/storage.test.ts`

Expected: all coordinator and persistence tests pass.

Run: `npm test`

Expected: full suite passes.

- [ ] **Step 6: Commit the coordinator**

```powershell
git add src/board.ts src/main.ts src/storage.ts src/workspace.ts tests/workspace.test.ts tests/storage.test.ts
git commit -m "feat: coordinate ink with work object history"
```

---

### Task 4: Object inspector, graph map, and overlays

**Files:**
- Create: `src/object-panel.ts`
- Modify: `src/canvas.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `index.html`
- Create: `tests/object-panel.test.ts`

**Interfaces:**
- Consumes: `GraphNode[]`, `GraphEdge[]`, selected canvas stroke ID, selected object checkboxes, and callbacks from `main.ts`.
- Produces:

```ts
export type ObjectPanelState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedStrokeId: string | null;
  checkedObjectIds: ReadonlySet<string>;
  overlayEnabled: boolean;
  unassignedStrokeIds: string[];
};

export type ObjectPanelActions = {
  onClose(): void;
  onToggleOverlay(enabled: boolean): void;
  onCheckedObjectsChange(ids: ReadonlySet<string>): void;
  onMerge(ids: readonly string[]): void;
  onSplitSelectedStroke(): void;
  onAssignSelectedStroke(objectId?: string): void;
  onSelectObject(id: string): void;
};

export class ObjectPanel {
  constructor(root: HTMLElement, actions: ObjectPanelActions);
  render(state: ObjectPanelState): void;
}

export type ObjectOverlay = { id: string; label: string; bounds: Bounds; selected: boolean; color: string };
```

- [ ] **Step 1: Add failing pure view-model tests**

Test exported helpers rather than browser mocks:

```ts
test('enables merge for two checked active nodes and split for a selected member of a multi-stroke active node', () => {
  const controls = derivePanelControls(state);
  expect(controls.canMerge).toBe(true);
  expect(controls.canSplit).toBe(true);
});

test('normalizes graph coordinates for negative and zero-size bounds', () => {
  expect(layoutGraph(nodes, 280, 160).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
});
```

- [ ] **Step 2: Verify panel tests fail**

Run: `npm test -- --run tests/object-panel.test.ts`

Expected: FAIL because panel view-model functions do not exist.

- [ ] **Step 3: Implement panel markup and pure SVG layout**

Add the closed-by-default Objects button, panel heading/close control, overview counts, overlay checkbox, graph SVG with a legend, list checkboxes, details, and correction buttons. Use native buttons/inputs and `aria-live` for correction results. At widths below 760px render the panel as an overlay with a backdrop; retain a reachable close control and do not resize the canvas underneath.

- [ ] **Step 4: Render noninteractive canvas overlays**

Extend `CanvasRenderer.render` with `objectOverlays` and `selectedObjectStrokeIds`. Draw selected-object stroke accents below ordinary selected-stroke accents, then dashed bounds and labels after ink. Scale line widths and label padding by inverse zoom. Overlay drawing must not alter hit testing or document coordinates.

- [ ] **Step 5: Wire corrections atomically**

Merge checked active nodes, split the selected stroke from its active object, and assign an unassigned selected stroke to one checked active object or a new object. Catch command errors, retain the prior graph, update the panel status, autosave successful corrections, and clear obsolete checkbox selections after supersession.

- [ ] **Step 6: Verify panel helpers and full build**

Run: `npm test -- --run tests/object-panel.test.ts tests/association.test.ts tests/workspace.test.ts`

Expected: all focused tests pass.

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: strict TypeScript and the Vite production bundle pass.

- [ ] **Step 7: Commit the user-facing graph proof**

```powershell
git add index.html src/canvas.ts src/main.ts src/object-panel.ts src/style.css tests/object-panel.test.ts
git commit -m "feat: add work object graph inspector"
```

---

### Task 5: Documentation and browser acceptance

**Files:**
- Modify: `README.md`
- Create: `docs/milestone-1b-verification.md`
- Modify: `docs/superpowers/plans/2026-09-20-milestone-1b.md`

**Interfaces:**
- Consumes: the complete version-2 app.
- Produces: user-facing controls/persistence documentation and reproducible verification evidence.

- [ ] **Step 1: Update product documentation**

Document the Objects panel, proposal constants, overlays, merge/split/assignment behavior, lineage, version-1 migration, version-2 portability, and the fact that grouping corrections are not part of board undo. Preserve and update the explicit deferred-scope list.

- [ ] **Step 2: Run the full automated gate**

Run: `npm test`

Expected: all tests pass with zero failures.

Run: `npm run build`

Expected: TypeScript and production bundling exit 0.

Run: `npm audit --audit-level=moderate`

Expected: zero moderate-or-higher vulnerabilities.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Run browser acceptance against the production preview**

Use Playwright CLI with an isolated session. Save ignored scripts/screenshots under `output/playwright/`. Assert the eight browser scenarios in the spec, including exact graph IDs and histories before/after reload, malformed-import retention, keyboard access, 500px layout, 2x DPR, and zero console/page errors.

- [ ] **Step 4: Record evidence and limitations**

Write `docs/milestone-1b-verification.md` with exact command counts, browser scenarios, review corrections, and the continuing absence of physical stylus/cross-browser testing unless those checks were actually performed.

- [ ] **Step 5: Request one independent whole-branch review**

Provide the reviewer the spec, this plan, final diff, test/build evidence, and browser acceptance script. Fix every Critical/Important finding with a regression test and rerun affected browser scenarios. Use one reviewer and one consolidated fix pass to conserve usage.

- [ ] **Step 6: Commit final documentation**

```powershell
git add README.md docs/milestone-1b-verification.md docs/superpowers/plans/2026-09-20-milestone-1b.md
git commit -m "docs: record milestone 1B verification"
```

- [ ] **Step 7: Push and open a pull request**

Push `feat/milestone-1b`, create a pull request against `main`, attach it to the Codex task, and verify the remote head SHA and GitHub CI result before reporting completion.

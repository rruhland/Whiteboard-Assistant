# Milestone 1C Temporal Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, assistant-ready temporal query layer over the existing histories and prove it with a read-only timeline and recent-activity heatmap.

**Architecture:** A pure `temporal.ts` module dependency-merges the version-2 ink and association logs, reconstructs prefix states, answers compact structured queries, and derives heat samples. A native `timeline-panel.ts` renders the human inspection controls; `main.ts` switches display data between the untouched live workspace and read-only projections while `canvas.ts` renders optional world-coordinate heat behind ink.

**Tech Stack:** TypeScript, native Canvas and Pointer Events, native DOM, Vite, Vitest, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-09-20-milestone-1c-design.md`

**Implementation status:** Completed on `feat/milestone-1c`; automated and production-browser evidence is recorded in `docs/milestone-1c-verification.md`.

## Global Constraints

- Keep the portable board format at version 2; all temporal indexes, projections, query summaries, and heat samples are derived and never serialized.
- Preserve each source log's internal order. Choose between source heads by timestamp, ink first on ties, and hold association events until referenced strokes have appeared.
- Position `0` is the empty board; position `n` is the state after entry `n - 1`; “Now” remains a separate live UI state.
- Start a new activity segment only after a positive timestamp gap greater than `30_000` milliseconds.
- Default assistant context stays current and compact. Erased geometry is available only through an explicit targeted query.
- Historical display is read-only. It must never modify autosave, undo/redo, live models, live selection, or live viewport.
- Do not add playback, snapshots, document version 3, timeline branching/restoration, model calls, semantic summaries, or assistant drawing.

## Review Focus

- Association events whose timestamps precede their stroke add must wait for the ink dependency while both source logs retain their original order.
- Scrubbing to the latest historical position must still be read-only even though it looks like now; only **Return to now** restores editing.
- Erased geometry must remain absent from current context and ordinary region queries, yet appear before erase and through `includeErased: true` queries.
- Failed historical projection must preserve the live document and return the UI to now with a visible error.
- Opening, scrubbing, panning, zooming, and closing history must leave serialized live data and the live viewport byte-for-byte unchanged.

---

### Task 1: Deterministic temporal index and prefix projection

**Files:**
- Create: `src/temporal.ts`
- Create: `tests/temporal-fixtures.ts`
- Create: `tests/temporal-index.test.ts`

**Interfaces:**
- Consumes: `BoardEvent`, `BoardEventKind`, `Stroke` from `src/board.ts`; `AssociationEvent`, `AssociationEventKind` from `src/association.ts`; `BoardDocumentV2` from `src/document.ts`.
- Produces:

```ts
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
export function buildTemporalIndex(document: BoardDocumentV2): TemporalIndex;
export function projectHistory(document: BoardDocumentV2, index: TemporalIndex, position: number): HistoricalProjection;
```

The shared test fixture module exports valid, explicit histories used throughout this plan:

```ts
export const emptyDocument: BoardDocumentV2;
export function fixtureDocument(options: {
  inkTimes: number[];
  associationTimes?: number[];
  associationStrokeIds?: string[];
}): BoardDocumentV2;
export function documentWithAddEraseUndo(): BoardDocumentV2;
export function documentWithMergeAndSplit(): BoardDocumentV2;
export function positionOf(index: TemporalIndex, id: string): number;
export function activeLabels(model: AssociationModel): string[];
```

`fixtureDocument` creates one valid add event per `inkTimes` entry with IDs `add-1`, `add-2`, strokes `stroke-1`, `stroke-2`, and corresponding valid `auto-create` association events `assoc-1`, `assoc-2` when association times are supplied. `documentWithAddEraseUndo` uses fixed IDs `add-1`, `erase-1`, `undo-1`. `documentWithMergeAndSplit` creates two objects A/B, merge child C, and split children D/E with fully valid before/after snapshots. `positionOf` returns the one-based entry position and throws when absent.

- [ ] **Step 1: Write failing merge and segmentation tests**

Create fixtures with explicit event IDs and times rather than using `Date.now()`. Pin equal timestamps, regressing source timestamps, delayed association dependencies, and the exact 30-second boundary.

```ts
test('dependency-merges source logs and places ink first on equal timestamps', () => {
  const document = fixtureDocument({
    inkTimes: [10, 50],
    associationTimes: [5, 50],
    associationStrokeIds: ['stroke-1', 'stroke-2'],
  });
  const index = buildTemporalIndex(document);
  expect(index.entries.map(({ id }) => id)).toEqual([
    'ink:add-1',
    'association:assoc-1',
    'ink:add-2',
    'association:assoc-2',
  ]);
  expect(index.entries.map(({ inkEventCount, associationEventCount }) => [inkEventCount, associationEventCount])).toEqual([
    [1, 0], [1, 1], [2, 1], [2, 2],
  ]);
});

test('starts a segment only after a positive gap greater than thirty seconds', () => {
  const index = buildTemporalIndex(fixtureDocument({ inkTimes: [0, 30_000, 60_001] }));
  expect(index.segments.map(({ startPosition, endPosition }) => [startPosition, endPosition])).toEqual([[1, 2], [3, 3]]);
});

test('keeps source order when timestamps regress', () => {
  const index = buildTemporalIndex(fixtureDocument({ inkTimes: [20, 10] }));
  expect(index.entries.map(({ eventId }) => eventId)).toEqual(['add-1', 'add-2']);
});
```

- [ ] **Step 2: Run the index tests and verify RED**

Run: `npm test -- --run tests/temporal-index.test.ts`

Expected: FAIL because `src/temporal.ts` does not exist.

- [ ] **Step 3: Implement dependency-preserving indexing**

Implement a two-head merge. Extract every stroke ID from each association change's before/after object. An association head is eligible only when all referenced IDs are in the consumed ink-prefix ID set. When it is blocked, consume the next ink event regardless of timestamps. If no ink remains, throw `Association event <id> has unmet ink dependencies`. Assign entry IDs from source plus event ID, prefix counts after consumption, and stable segment IDs `segment-1`, `segment-2`, and so on.

Build segments in a second pass so each entry receives its final segment ID. Segment positions are one-based timeline positions. Empty documents return no entries and no segments.

- [ ] **Step 4: Write failing projection tests**

```ts
test('projects start, erased, and restored states without mutating the document', () => {
  const document = documentWithAddEraseUndo();
  const original = structuredClone(document);
  const index = buildTemporalIndex(document);
  expect(projectHistory(document, index, 0).board.strokes).toEqual([]);
  expect(projectHistory(document, index, positionOf(index, 'ink:erase-1')).board.strokes).toEqual([]);
  expect(projectHistory(document, index, positionOf(index, 'ink:undo-1')).board.strokes.map(({ id }) => id)).toEqual(['stroke-1']);
  expect(document).toEqual(original);
});

test('projects merge and split lineage at their exact positions', () => {
  const document = documentWithMergeAndSplit();
  const index = buildTemporalIndex(document);
  expect(activeLabels(projectHistory(document, index, positionOf(index, 'association:merge')).associations)).toEqual(['C']);
  expect(activeLabels(projectHistory(document, index, positionOf(index, 'association:split')).associations)).toEqual(['D', 'E']);
});

test.each([-1, 4.5, 999])('rejects invalid position %s', (position) => {
  expect(() => projectHistory(emptyDocument, buildTemporalIndex(emptyDocument), position)).toThrow(/position/i);
});
```

- [ ] **Step 5: Implement immutable prefix projection**

At position zero construct empty models. Otherwise slice the two source logs using the selected entry's prefix counts. Derive known stroke IDs from the ink prefix's before/after changes, construct `BoardModel` and `AssociationModel`, and return defensive model instances plus the selected entry and its segment. Validate that `position` is a finite integer in `0..entries.length`.

- [ ] **Step 6: Verify and commit the temporal foundation**

Run: `npm test -- --run tests/temporal-index.test.ts tests/document.test.ts tests/association.test.ts`

Expected: all focused tests pass.

Run: `npm test`

Expected: the complete suite passes.

```powershell
git add src/temporal.ts tests/temporal-fixtures.ts tests/temporal-index.test.ts
git commit -m "feat: add deterministic temporal projections"
```

---

### Task 2: Compact assistant-facing history queries

**Files:**
- Modify: `src/temporal.ts`
- Create: `tests/temporal-query.test.ts`

**Interfaces:**
- Consumes: `TemporalIndex` and `projectHistory` from Task 1; `Bounds`, `WorkObject` from `src/association.ts`; `Stroke` from `src/board.ts`.
- Produces:

```ts
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
export function getCurrentContext(document: BoardDocumentV2, index: TemporalIndex, sincePosition?: number): CurrentContext;
export function queryChanges(document: BoardDocumentV2, index: TemporalIndex, fromPosition: number, toPosition: number, options?: { detail?: TemporalDetail }): TemporalChangeResult;
export function queryObjectHistory(document: BoardDocumentV2, index: TemporalIndex, objectId: string, options?: { throughPosition?: number; detail?: TemporalDetail }): TemporalObjectResult;
export function queryRegionHistory(document: BoardDocumentV2, index: TemporalIndex, bounds: Bounds, options?: { throughPosition?: number; detail?: TemporalDetail; includeErased?: boolean }): TemporalRegionResult;
```

Extend `tests/temporal-fixtures.ts` with:

```ts
export function segmentedFixture(): { document: BoardDocumentV2; index: TemporalIndex; erasedId: string };
export function objectRegionFixture(): {
  document: BoardDocumentV2;
  index: TemporalIndex;
  mergedParentId: string;
  mergeChildId: string;
  splitChildId: string;
  erasedId: string;
  region: Bounds;
};
```

- [ ] **Step 1: Write failing current-context and change-range tests**

```ts
test('current context stays in the current segment and honors sincePosition', () => {
  const { document, index } = segmentedFixture();
  const context = getCurrentContext(document, index, index.entries.length - 2);
  expect(context.position).toBe(index.entries.length);
  expect(context.segmentId).toBe(index.segments.at(-1)?.id);
  expect(context.recentEntries.map(({ id }) => id)).toEqual(index.entries.slice(-1).map(({ id }) => id));
  expect(context.visibleStrokeIds).not.toContain('erased-stroke');
});

test('change query returns ordered affected IDs without geometry by default', () => {
  const { document, index } = segmentedFixture();
  const result = queryChanges(document, index, 0, 3);
  expect(result.entries.map(({ id }) => id)).toEqual(index.entries.slice(0, 3).map(({ id }) => id));
  expect(result.affectedStrokeIds).toEqual(['stroke-1', 'stroke-2']);
  expect(result.strokes).toBeUndefined();
});
```

- [ ] **Step 2: Verify the compact query tests fail**

Run: `npm test -- --run tests/temporal-query.test.ts`

Expected: FAIL because query exports are missing.

- [ ] **Step 3: Implement current context and range queries**

Use the latest projection for current context. Recent entries begin after `max(sincePosition ?? segment.startPosition - 1, segment.startPosition - 1)`. Validate `sincePosition`, range positions, and every `throughPosition` as finite integers in `0..entries.length`; require `fromPosition <= toPosition`. Collect affected IDs in first-seen order. For `detail: 'geometry'`, collect defensive stroke copies from each ink change, preferring `after` and falling back to `before`, deduplicated by ID using the latest encountered snapshot.

- [ ] **Step 4: Write failing object-lineage and region tests**

```ts
test('object query follows ancestors and descendants through the selected prefix', () => {
  const fixture = objectRegionFixture();
  const result = queryObjectHistory(fixture.document, fixture.index, fixture.mergedParentId, { detail: 'geometry' });
  expect(result.lineageObjectIds).toEqual(expect.arrayContaining([fixture.mergedParentId, fixture.mergeChildId, fixture.splitChildId]));
  expect(result.entries.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['manual-merge', 'manual-split']));
  expect(result.objects?.every((object) => object !== fixture.document.associationEvents[0].changes[0].after)).toBe(true);
});

test('region query excludes erased strokes unless explicitly requested', () => {
  const fixture = objectRegionFixture();
  expect(queryRegionHistory(fixture.document, fixture.index, fixture.region).strokeIds).not.toContain(fixture.erasedId);
  const withErased = queryRegionHistory(fixture.document, fixture.index, fixture.region, { includeErased: true, detail: 'geometry' });
  expect(withErased.erasedStrokeIds).toContain(fixture.erasedId);
  expect(withErased.strokes?.map(({ id }) => id)).toContain(fixture.erasedId);
});

test('unknown object returns an empty result with the requested ID', () => {
  const fixture = objectRegionFixture();
  expect(queryObjectHistory(fixture.document, fixture.index, 'missing')).toEqual({
    objectId: 'missing', throughPosition: fixture.index.entries.length, entries: [], lineageObjectIds: [], memberStrokeIds: [],
  });
});
```

- [ ] **Step 5: Implement object and region retrieval**

Project through the requested position. Build an object map from association change snapshots in the selected prefix, traverse parent IDs in both directions, then collect entries affecting any lineage ID. Region queries inspect ink changes in the selected prefix, compute stroke bounds including half-width, and use inclusive rectangle intersection. When `includeErased` is false, filter matches against the projection's visible stroke IDs. Validate every bounds coordinate as finite and require `minX <= maxX` and `minY <= maxY`.

- [ ] **Step 6: Verify defensive results and commit queries**

Mutate returned entries, strokes, and objects in tests and assert a repeated query is unchanged.

Run: `npm test -- --run tests/temporal-query.test.ts tests/temporal-index.test.ts`

Expected: all temporal tests pass.

Run: `npm test`

Expected: the complete suite passes.

```powershell
git add src/temporal.ts tests/temporal-fixtures.ts tests/temporal-query.test.ts
git commit -m "feat: add structured temporal context queries"
```

---

### Task 3: Recent-activity heatmap derivation and rendering

**Files:**
- Modify: `src/temporal.ts`
- Modify: `src/canvas.ts`
- Modify: `src/main.ts`
- Create: `tests/activity-map.test.ts`

**Interfaces:**
- Consumes: timeline segments and ink events from Tasks 1–2; existing `CanvasRenderer` render state.
- Produces:

```ts
export type ActivitySample = { x: number; y: number; intensity: number };
export function buildActivitySamples(document: BoardDocumentV2, index: TemporalIndex, position: number): ActivitySample[];
```

Extend `tests/temporal-fixtures.ts` with `activityFixture`, `eraseActivityFixture`, `associationOnlyFixture`, and `regressingActivityFixture`. Each returns `{ document, index, selectedPosition }`; the regressing fixture also returns `priorSegmentX`.

`RenderState` gains `activitySamples: ActivitySample[]`. The renderer treats the array as optional display data and never includes it in hit testing.

- [ ] **Step 1: Write failing resampling and decay tests**

```ts
test('resamples changed ink at sixteen world-unit spacing with ten-second half-life', () => {
  const { document, index, selectedPosition } = activityFixture({ eventTimes: [0, 10_000] });
  const samples = buildActivitySamples(document, index, selectedPosition);
  expect(samples.filter(({ y }) => y === 0).map(({ x }) => x)).toEqual([0, 16, 32]);
  expect(samples.find(({ x, y }) => x === 0 && y === 0)?.intensity).toBeCloseTo(0.5);
  expect(Math.max(...samples.filter(({ y }) => y === 20).map(({ intensity }) => intensity))).toBeCloseTo(1);
});

test('uses before geometry for erase and produces no heat for association-only selection', () => {
  const erased = eraseActivityFixture();
  const associationOnly = associationOnlyFixture();
  expect(buildActivitySamples(erased.document, erased.index, erased.selectedPosition).length).toBeGreaterThan(0);
  expect(buildActivitySamples(associationOnly.document, associationOnly.index, associationOnly.selectedPosition)).toEqual([]);
});

test('clamps regressing timestamp age to zero and excludes prior segments', () => {
  const fixture = regressingActivityFixture();
  const samples = buildActivitySamples(fixture.document, fixture.index, fixture.selectedPosition);
  expect(samples.every(({ intensity }) => Number.isFinite(intensity) && intensity > 0 && intensity <= 1)).toBe(true);
  expect(samples.some(({ x }) => x === fixture.priorSegmentX)).toBe(false);
});
```

- [ ] **Step 2: Verify activity tests fail**

Run: `npm test -- --run tests/activity-map.test.ts`

Expected: FAIL because `buildActivitySamples` is missing.

- [ ] **Step 3: Implement pure activity sampling**

Use the selected entry's segment start through selected position. Ignore association entries. For every ink change use `after ?? before`, resample every polyline segment at 16-unit world intervals without duplicating shared endpoints, and always include dot/single-point strokes and final endpoints. Apply `2 ** (-Math.max(0, selectedTime - event.time) / 10_000)`. Return defensive plain objects in timeline order. Position zero and segments without ink return an empty array.

- [ ] **Step 4: Render heat behind committed ink**

In `CanvasRenderer.render`, after the grid and before stroke accents and ink, draw samples into a reusable offscreen canvas using the same device-pixel-ratio and world transform as the main canvas. Use radial gradients with a 36-world-unit radius and warm amber/red stops. Composite the completed heat layer onto the main canvas with `globalAlpha = 0.28`; this caps the final field opacity even where gradients overlap. Normalize each sample against the largest input intensity, scale entirely in world coordinates, and skip all offscreen work for an empty array. Update the existing `main.ts` render call to pass `activitySamples: []` until Task 5 supplies historical samples.

- [ ] **Step 5: Verify and commit activity visualization**

Run: `npm test -- --run tests/activity-map.test.ts tests/core.test.ts`

Expected: all focused tests pass.

Run: `npm run build`

Expected: strict TypeScript and Vite bundling pass.

```powershell
git add src/temporal.ts src/canvas.ts src/main.ts tests/activity-map.test.ts
git commit -m "feat: derive recent activity heatmaps"
```

---

### Task 4: Timeline panel and historical read-only controls

**Files:**
- Create: `src/timeline-panel.ts`
- Create: `tests/timeline-panel.test.ts`
- Modify: `src/object-panel.ts`
- Modify: `tests/object-panel.test.ts`

**Interfaces:**
- Consumes: `TemporalIndex`, `TimelineEntry`, and `ActivitySegment` from `src/temporal.ts`.
- Produces:

```ts
export type TimelinePanelState = {
  index: TemporalIndex;
  open: boolean;
  position: number | null; // null means Now
  heatmapEnabled: boolean;
};
export type TimelinePanelActions = {
  onClose(): void;
  onSelectPosition(position: number): void;
  onReturnToNow(): void;
  onToggleHeatmap(enabled: boolean): void;
};
export type TimelineControls = {
  canPrevious: boolean;
  canNext: boolean;
  isHistorical: boolean;
  displayPosition: number;
  eventDescription: string;
  segmentDescription: string;
};
export function deriveTimelineControls(state: TimelinePanelState): TimelineControls;
export class TimelinePanel {
  constructor(root: HTMLElement, actions: TimelinePanelActions);
  render(state: TimelinePanelState): void;
}
```

In `tests/timeline-panel.test.ts`, define `state(overrides)` around a four-entry fixed index and `stateAt(id)` by looking up that entry's one-based position. The fixed entries cover `add`, `erase`, `manual-merge`, and `manual-split`, with two activity segments.

`ObjectPanelState` gains `readOnly: boolean`. `derivePanelControls` returns every correction capability as false when read-only, and rendered correction controls carry `disabled` plus the title `Return to now to correct grouping`.

- [ ] **Step 1: Write failing timeline view-model tests**

```ts
test('derives controls at start, middle, latest history, and now', () => {
  expect(deriveTimelineControls(state({ position: 0 }))).toMatchObject({ canPrevious: false, canNext: true, isHistorical: true, displayPosition: 0 });
  expect(deriveTimelineControls(state({ position: 2 }))).toMatchObject({ canPrevious: true, canNext: true, isHistorical: true });
  expect(deriveTimelineControls(state({ position: 4 }))).toMatchObject({ canPrevious: true, canNext: false, isHistorical: true });
  expect(deriveTimelineControls(state({ position: null }))).toMatchObject({ canPrevious: true, canNext: false, isHistorical: false, displayPosition: 4 });
});

test('describes ink and association events without exposing raw implementation copy', () => {
  expect(deriveTimelineControls(stateAt('ink:erase')).eventDescription).toBe('Stroke erased');
  expect(deriveTimelineControls(stateAt('association:merge')).eventDescription).toBe('Objects merged');
});
```

- [ ] **Step 2: Write failing read-only object-panel tests**

```ts
test('disables every correction in historical mode', () => {
  expect(derivePanelControls(state({ readOnly: true }))).toEqual({
    canMerge: false, canSplit: false, canAssignToChecked: false, canCreateObject: false,
  });
});
```

- [ ] **Step 3: Run panel tests and verify RED**

Run: `npm test -- --run tests/timeline-panel.test.ts tests/object-panel.test.ts`

Expected: FAIL because the timeline panel and read-only state are missing.

- [ ] **Step 4: Implement pure control derivation and accessible panel markup**

Render a heading focus target, previous/next native buttons, range input with `min="0"` and `max="entries.length"`, an event marker strip keyed by source, selected event/time/segment text, heatmap checkbox, read-only status, and **Return to now**. At position zero describe `Start of board`; at now describe `Current board`. Use the exact event labels from the spec. Range `input` calls `onSelectPosition(Number(value))`. From now, Previous selects `entries.length` so the latest event can be inspected; from a historical position it selects `position - 1`. Next clamps to the latest historical position and never silently returns to now.

- [ ] **Step 5: Enforce read-only object correction state**

Add `readOnly` to every `ObjectPanelState` construction and derive all four correction booleans from it. Disable object checkboxes in read-only mode while preserving row selection and details. Guard correction callbacks in `main.ts` again during Task 5 so DOM state is never the sole protection.

- [ ] **Step 6: Verify and commit the panel components**

Run: `npm test -- --run tests/timeline-panel.test.ts tests/object-panel.test.ts`

Expected: all panel tests pass.

Run: `npm run typecheck`

Expected: TypeScript passes after temporary call-site adaptations use `readOnly: false`.

```powershell
git add src/timeline-panel.ts src/object-panel.ts src/main.ts tests/timeline-panel.test.ts tests/object-panel.test.ts
git commit -m "feat: add read-only timeline controls"
```

---

### Task 5: Browser coordination, documentation, and acceptance

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `src/workspace.ts`
- Modify: `README.md`
- Create: `docs/milestone-1c-verification.md`
- Modify: `docs/superpowers/plans/2026-09-20-milestone-1c.md`
- Create: `tests/history-session.test.ts`

**Interfaces:**
- Consumes: all earlier temporal, panel, workspace, canvas, and object-panel interfaces.
- Produces a small pure session helper in `src/workspace.ts`:

```ts
export type HistorySession = {
  index: TemporalIndex;
  position: number | null;
  projection: HistoricalProjection | null;
  liveViewport: Viewport;
  historicalViewport: Viewport;
  heatmapEnabled: boolean;
};
export function createHistorySession(state: WorkspaceState): HistorySession;
export function selectHistoryPosition(state: WorkspaceState, session: HistorySession, position: number): HistorySession;
export function returnToNow(state: WorkspaceState, session: HistorySession): HistorySession;
export function rebuildHistorySession(state: WorkspaceState, session: HistorySession): HistorySession;
```

- [ ] **Step 1: Write failing session-isolation tests**

```ts
test('history selection never mutates the live document or viewport', () => {
  const state = historyWorkspaceFixture();
  const before = serializeBoard(workspaceDocument(state));
  const session = selectHistoryPosition(state, createHistorySession(state), 1);
  session.historicalViewport.x = 999;
  expect(serializeBoard(workspaceDocument(state))).toBe(before);
  expect(state.viewport).toEqual({ x: 4, y: 8, zoom: 1.5 });
});

test('return to now restores live display and rebuild follows new live edits', () => {
  const state = historyWorkspaceFixture();
  let session = selectHistoryPosition(state, createHistorySession(state), 0);
  session = returnToNow(state, session);
  commitStroke(state, [point(3, 3)], '#000', 2);
  session = rebuildHistorySession(state, session);
  expect(session.position).toBeNull();
  expect(session.index.totalInkEvents).toBe(state.board.events.length);
  expect(session.projection).toBeNull();
});

test('failed projection leaves session at now', () => {
  const state = historyWorkspaceFixture();
  const corruptedSession = { ...createHistorySession(state), index: { ...createHistorySession(state).index, entries: [{ ...createHistorySession(state).index.entries[0], inkEventCount: 999 }] } };
  expect(() => selectHistoryPosition(state, corruptedSession, 1)).toThrow();
  expect(corruptedSession.position).toBeNull();
  expect(corruptedSession.projection).toBeNull();
});
```

Define `historyWorkspaceFixture()` in `tests/history-session.test.ts` by loading a fixed version-2 document with viewport `{ x: 4, y: 8, zoom: 1.5 }`, one associated stroke, and explicit timestamps. Define the local `point(x, y)` helper as `{ x, y, pressure: 0.5, time: 1 }`.

- [ ] **Step 2: Implement immutable history-session transitions**

`createHistorySession` builds from `workspaceDocument(state)` and copies the live viewport twice. `selectHistoryPosition` computes the projection before returning a new session, so failure cannot mutate the prior session. `returnToNow` returns null position/projection and refreshes viewport copies from live state. `rebuildHistorySession` always rebuilds the index; when historical, reproject the smaller of the old position and new entry length, otherwise remain at now.

- [ ] **Step 3: Add browser markup and coordination**

Add `#history-toggle`, `#timeline-panel`, and `#historical-status` to `index.html`. In `main.ts`:

- maintain one `HistorySession` beside the live `WorkspaceState`;
- derive displayed board, associations, viewport, and heat samples from the session;
- rebuild the index after successful ink edits, undo/redo, association corrections, import, and migration;
- block pen/select/eraser pointer starts, delete, undo/redo, file open/save, and correction callbacks whenever `position !== null`;
- allow hand pan and zoom to update only `historicalViewport` while historical;
- clear display selection on historical entry without modifying the saved live selection and restore it at now;
- on projection error, retain the live workspace, return to now, and show `History unavailable: <message>`;
- implement the two-stage `Escape` behavior;
- on widths below 760px, opening one panel closes the other while retaining historical position.

All persistence functions continue to call `workspaceDocument(workspace)` and never compose from projected models.

- [ ] **Step 4: Add responsive styles**

At desktop widths, render the timeline as a bottom dock that reduces available canvas height and may coexist with the right Objects inspector. At widths below 760px, render it as a bottom overlay with a backdrop and a maximum height of 52vh. Style ink markers in teal, association markers in amber, the selected marker distinctly, and the historical status in a persistent high-contrast bar. Ensure the range control, buttons, and **Return to now** remain reachable at 500px width.

- [ ] **Step 5: Update product documentation**

Document the assistant-facing query strategy first, then History controls, event-by-event read-only behavior, 30-second segments, ten-second heat half-life, version-2 derivation, and the fact that erased geometry requires an explicit query. Preserve the deferred model/prompt/retrieval-policy scope.

- [ ] **Step 6: Run the complete automated gate**

Run: `npm test`

Expected: every test passes.

Run: `npm run build`

Expected: TypeScript and the production bundle pass.

Run: `npm audit --audit-level=moderate`

Expected: zero moderate-or-higher vulnerabilities.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Run production-browser acceptance with Playwright CLI**

Use an isolated session against `npm run preview`. Save ignored evidence under `output/playwright/`. Exercise all eight spec scenarios:

1. create add/erase/undo/redo plus merge/split history and verify every visible-count/lineage transition;
2. capture serialized live JSON before opening History and assert exact equality after scrub, historical pan/zoom, and close;
3. prove erased ink is visible before erase, absent after erase, and absent at now;
4. verify segment heat changes at the 30-second boundary and remains aligned through temporary pan/zoom;
5. assert editing, corrections, and file controls are disabled at position zero, a middle position, and the latest historical position, then restored at now;
6. compare timeline entry IDs and segment boundaries across reload and a version-1 migration;
7. verify empty board, keyboard stepping/two-stage Escape/focus, 500px layout, and `Desktop Chrome HiDPI` 2x canvas sizing;
8. assert zero console and page errors.

- [ ] **Step 8: Record evidence and request one whole-branch review**

Write `docs/milestone-1c-verification.md` with exact test counts, build/audit results, browser scenarios, review findings and corrections, and untested physical/cross-browser limits. Ask one fresh reviewer to assess `origin/main..HEAD` against the spec and plan, concentrating on history isolation, erased-data opt-in, projection ordering, query defensiveness, and read-only enforcement. Fix every Critical/Important finding in one consolidated pass with regression tests, then rerun affected browser scenarios.

- [ ] **Step 9: Commit, push, and open the pull request**

```powershell
git add index.html src/main.ts src/style.css src/workspace.ts README.md docs/milestone-1c-verification.md docs/superpowers/plans/2026-09-20-milestone-1c.md tests/history-session.test.ts
git commit -m "feat: add temporal context timeline"
git push -u origin feat/milestone-1c
```

Create a pull request against `main`, attach it to the Codex task, and verify the remote head SHA and GitHub `verify` check before reporting completion.

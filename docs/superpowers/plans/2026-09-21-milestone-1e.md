# Milestone 1E Whiteboard Quality-of-Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Metapen shortcuts, touch-only navigation, marquee-based multi-selection with group transforms, destructive page reset, and an independently autosaved local canvas library.

**Architecture:** Pure input, touch-navigation, and selection modules compute effective tools, viewports, selected IDs, handles, and transformed stroke previews without touching DOM or persistence. `BoardModel` commits multi-stroke transforms and deletes atomically. A versioned local-storage catalog wraps complete version-3 documents by stable canvas ID, while a native DOM modal and `main.ts` coordinate transient state, rendering, confirmations, and active-canvas switching.

**Tech Stack:** TypeScript, native Canvas and Pointer Events, native DOM, browser `localStorage`, Vite, Vitest, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-09-21-milestone-1e-design.md`

## Global Constraints

- Preserve the version-3 portable board format; canvas-library metadata never enters portable JSON.
- Keep the implementation local-first with no new runtime dependencies, server, account, or network call.
- Pen tip means draw, lower/eraser signal means erase, and upper/barrel signal means select; eraser wins conflicting masks.
- Mouse follows the persistent toolbar tool; touch is navigation-only and never edits board content.
- Do not navigate by touch while a pen edit contact is active, and do not support simultaneous pen editing and touch navigation.
- Marquee containment includes half the stroke width; Shift adds, while a normal selection replaces.
- Corner resize preserves aspect ratio, edge resize changes one axis, transforms never flip, and stroke widths never scale.
- Group move, resize, rotate, and delete each append exactly one undoable board event.
- Reset and canvas deletion require confirmation; reset is intentionally not undoable.
- The Canvases modal opens only from its toolbar button and never automatically at launch.

## Review Focus

- A pen event that reports both eraser and barrel masks must erase, and its release must restore drawing for the next contact; Task 3 tests both branches.
- Removing one finger from a pinch must rebase to a one-finger pan without a viewport jump; Task 3 pins the transition.
- Point-like and one-dimensional selections must resize to finite geometry without crossing their anchors or changing stroke widths; Task 2 covers those bounds.
- A batched transform/delete must replay, serialize, undo, and redo as one event while preserving every non-coordinate stroke field; Task 1 exercises the complete contract.
- A failed staged catalog write must not make the UI switch canvases or publish new catalog state, even when a document key was written first; Task 5 injects failures at each write boundary.

---

### Task 1: Atomic multi-stroke board mutations

**Files:**
- Modify: `src/board.ts`
- Modify: `tests/core.test.ts`
- Modify: `tests/document.test.ts`
- Modify: `tests/temporal.test.ts`

**Interfaces:**
- Produces:

```ts
export class BoardModel {
  updateStrokes(after: readonly Stroke[]): void;
  eraseStrokes(ids: readonly string[]): void;
}
```

`moveStroke` and `eraseStroke` remain compatibility wrappers. A `move` event accepts one-or-more unique `before -> after` changes with stable IDs and user actor. An `erase` event keeps its existing batch rules.

- [ ] **Step 1: Write failing atomic mutation tests**

Add to `tests/core.test.ts`, using the existing `point` and `stroke` helpers:

```ts
test('updates a selected group in one event and preserves stroke metadata through undo and redo', () => {
  const first = stroke('first', 0);
  const second = { ...stroke('second', 10), width: 7, color: '#456', points: [point(10, 0), point(12, 4)] };
  const model = new BoardModel({ events: [createAddEvent([first, second], 'user', { id: 'add', time: 1 })] });
  const transformed = model.strokes.map((value) => ({
    ...value,
    points: value.points.map((sample) => ({ ...sample, x: sample.x + 5, y: sample.y - 3 })),
  }));

  model.updateStrokes(transformed);

  expect(model.events.at(-1)).toMatchObject({ kind: 'move', changes: [{ before: { id: 'first' }, after: { id: 'first' } }, { before: { id: 'second' }, after: { id: 'second' } }] });
  expect(model.strokes[1]).toMatchObject({ id: 'second', width: 7, color: '#456', author: 'user', createdAt: 1 });
  model.undo();
  expect(model.strokes).toEqual([first, second]);
  model.redo();
  expect(model.strokes).toEqual(transformed);
});

test('erases a selected group as one undoable event and ignores missing IDs', () => {
  const values = [stroke('first', 0), stroke('second', 10), stroke('third', 20)];
  const model = new BoardModel({ events: [createAddEvent(values, 'user', { id: 'add', time: 1 })] });

  model.eraseStrokes(['first', 'missing', 'second', 'first']);

  expect(model.events.at(-1)).toMatchObject({ kind: 'erase', changes: [{ before: { id: 'first' } }, { before: { id: 'second' } }] });
  expect(model.strokes.map(({ id }) => id)).toEqual(['third']);
  model.undo();
  expect(model.strokes).toEqual(values);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run tests/core.test.ts`

Expected: FAIL because `updateStrokes` and `eraseStrokes` do not exist.

- [ ] **Step 3: Implement the minimal batch APIs and move validation**

In `src/board.ts`, implement the public methods using cloned live `before` values and one call to `commit`:

```ts
updateStrokes(after: readonly Stroke[]): void {
  const unique = new Map(after.map((stroke) => [stroke.id, cloneStroke(stroke)]));
  const changes = [...unique.values()].flatMap((next) => {
    const before = this.strokeMap.get(next.id);
    return before ? [{ before: cloneStroke(before), after: next }] : [];
  });
  if (changes.length) this.commit({ id: idFor('event'), time: Date.now(), actor: 'user', kind: 'move', changes });
}

eraseStrokes(ids: readonly string[]): void {
  const strokes = [...new Set(ids)].flatMap((id) => {
    const value = this.strokeMap.get(id);
    return value ? [value] : [];
  });
  if (strokes.length) this.commit(createEraseEvent(strokes, { id: idFor('event'), time: Date.now() }));
}
```

Have `moveStroke` build its translated stroke and call `updateStrokes([after])`; have `eraseStroke` call `eraseStrokes([id])`. In event-shape validation, require move events to be user-authored, non-empty, unique-ID, non-null on both sides, and ID-preserving; remove the old exactly-one-change restriction for version 3.

- [ ] **Step 4: Pin serialization and temporal replay of batched moves**

Add a version-3 document containing one two-change move to `tests/document.test.ts` and assert exact `parseBoard(serializeBoard(document))` equality. Add to `tests/temporal.test.ts`:

```ts
test('projects every stroke in an atomic group transform at the same position', () => {
  const document = groupTransformDocument();
  const index = buildTemporalIndex(document);
  const before = projectHistory(document, index, 1).board.strokes;
  const after = projectHistory(document, index, 2).board.strokes;
  expect(before.map(({ points }) => points[0].x)).toEqual([0, 10]);
  expect(after.map(({ points }) => points[0].x)).toEqual([5, 15]);
});
```

Define `groupTransformDocument` in that test file with literal events and literal expected coordinates so the expectation does not reuse production transform logic.

- [ ] **Step 5: Run board/document/temporal tests and commit**

Run: `npm test -- --run tests/core.test.ts tests/document.test.ts tests/temporal.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/board.ts tests/core.test.ts tests/document.test.ts tests/temporal.test.ts
git commit -m "feat: add atomic group board edits"
```

---

### Task 2: Pure marquee, handles, and transform geometry

**Files:**
- Create: `src/selection.ts`
- Create: `tests/selection.test.ts`

**Interfaces:**
- Produces:

```ts
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type SelectionHandle = ResizeHandle | 'rotate';
export type SelectionOperation =
  | { type: 'move'; origin: Point }
  | { type: 'resize'; handle: ResizeHandle; origin: Point }
  | { type: 'rotate'; originAngle: number };

export function renderedStrokeBounds(stroke: Stroke): Bounds;
export function selectionBounds(strokes: readonly Stroke[]): Bounds | null;
export function containedStrokeIds(strokes: readonly Stroke[], start: Point, end: Point): string[];
export function mergeSelection(current: ReadonlySet<string>, enclosed: readonly string[], additive: boolean): Set<string>;
export function selectionHandlePoints(bounds: Bounds, zoom: number): Record<SelectionHandle, { x: number; y: number }>;
export function hitSelectionHandle(point: Point, bounds: Bounds, zoom: number): SelectionHandle | null;
export function transformSelection(strokes: readonly Stroke[], bounds: Bounds, operation: SelectionOperation, current: Point): Stroke[];
```

- [ ] **Step 1: Write failing containment and additive-selection tests**

Create `tests/selection.test.ts` with literal strokes and these assertions:

```ts
test('selects only strokes whose rendered bounds are fully contained in either drag direction', () => {
  const inside = line('inside', 2, 2, 8, 8, 2);
  const widthCrosses = line('width-crosses', 0.5, 4, 8, 4, 2);
  const endpointCrosses = line('endpoint-crosses', 3, 3, 11, 3, 1);
  expect(containedStrokeIds([inside, widthCrosses, endpointCrosses], point(0, 0), point(10, 10))).toEqual(['inside']);
  expect(containedStrokeIds([inside], point(10, 10), point(0, 0))).toEqual(['inside']);
});

test('normal selection replaces while Shift selection only adds', () => {
  expect(mergeSelection(new Set(['old']), ['new'], false)).toEqual(new Set(['new']));
  expect(mergeSelection(new Set(['old']), ['old', 'new'], true)).toEqual(new Set(['old', 'new']));
  expect(mergeSelection(new Set(['old']), [], true)).toEqual(new Set(['old']));
  expect(mergeSelection(new Set(['old']), [], false)).toEqual(new Set());
});
```

Use local `point` and `line` helpers that return complete `Point` and `Stroke` values.

- [ ] **Step 2: Run the selection tests and verify RED**

Run: `npm test -- --run tests/selection.test.ts`

Expected: FAIL because `src/selection.ts` does not exist.

- [ ] **Step 3: Implement bounds, marquee, and selection merge**

Normalize rectangle corners with `Math.min`/`Math.max`. Expand stroke point bounds by `stroke.width / 2`. Preserve source stroke order in `containedStrokeIds`. Return new sets from `mergeSelection`; do not mutate caller-owned sets.

- [ ] **Step 4: Write failing handle and transform tests**

Add tests with hand-derived expected points:

```ts
test('keeps handle hit areas constant in screen pixels', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  expect(hitSelectionHandle(point(104, 25), bounds, 1)).toBe('e');
  expect(hitSelectionHandle(point(102, 25), bounds, 2)).toBe('e');
  expect(selectionHandlePoints(bounds, 2).rotate.y).toBe(-14);
});

test('edge resize changes one axis and preserves stroke width and metadata', () => {
  const source = line('a', 0, 0, 10, 10, 6);
  const [after] = transformSelection([source], renderedStrokeBounds(source), { type: 'resize', handle: 'e', origin: point(13, 5) }, point(23, 5));
  expect(after.width).toBe(6);
  expect(after).toMatchObject({ id: 'a', author: 'user', createdAt: 1, color: '#000' });
  expect(after.points.map(({ y }) => y)).toEqual([0, 10]);
  expect(after.points[1].x).toBeGreaterThan(10);
});

test('corner resize uses one positive scale for both axes without flipping', () => {
  const source = line('a', 0, 0, 10, 20, 2);
  const bounds = renderedStrokeBounds(source);
  const [after] = transformSelection([source], bounds, { type: 'resize', handle: 'se', origin: point(bounds.maxX, bounds.maxY) }, point(bounds.maxX + 12, bounds.maxY + 1));
  const xRatio = (after.points[1].x - after.points[0].x) / 10;
  const yRatio = (after.points[1].y - after.points[0].y) / 20;
  expect(xRatio).toBeCloseTo(yRatio);
  expect(xRatio).toBeGreaterThan(0);
});

test('rotates around the selection center from an immutable snapshot', () => {
  const source = line('a', 0, 0, 10, 0, 3);
  const bounds = renderedStrokeBounds(source);
  const once = transformSelection([source], bounds, { type: 'rotate', originAngle: -Math.PI / 2 }, point(11.5, 0));
  const repeated = transformSelection([source], bounds, { type: 'rotate', originAngle: -Math.PI / 2 }, point(11.5, 0));
  expect(repeated).toEqual(once);
  expect(once[0].width).toBe(3);
});

test('resizes point and one-dimensional selections to finite nonflipped geometry', () => {
  for (const source of [dot('dot', 5, 5), line('vertical', 5, 0, 5, 10, 4)]) {
    const bounds = selectionBounds([source])!;
    const result = transformSelection([source], bounds, { type: 'resize', handle: 'nw', origin: point(bounds.minX, bounds.minY) }, point(999, 999));
    expect(result[0].points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(result[0].width).toBe(source.width);
  }
});
```

- [ ] **Step 5: Implement handle geometry and transforms**

Use visible handle size `8 / zoom`, hit radius `12 / zoom`, rotation offset `28 / zoom`, and a minimum transformed dimension of `1` world unit. Clone strokes and points for every preview. For rotation, compute the current angle from the fixed bounds center and apply the delta to the original points. For resize, derive scale from the fixed opposite anchor and clamp before it crosses that anchor.

- [ ] **Step 6: Run selection tests and commit**

Run: `npm test -- --run tests/selection.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/selection.ts tests/selection.test.ts
git commit -m "feat: add group selection geometry"
```

---

### Task 3: Pen routing and touch navigation state

**Files:**
- Modify: `src/input.ts`
- Create: `src/touch-navigation.ts`
- Modify: `tests/input.test.ts`
- Create: `tests/touch-navigation.test.ts`

**Interfaces:**
- Produces:

```ts
export type Tool = 'pen' | 'select' | 'eraser' | 'hand';
export type PointerDescriptor = { pointerType: string; button: number; buttons: number };
export function effectivePointerTool(pointer: PointerDescriptor, activeTool: Tool, spacePressed: boolean): Tool | 'touch' | null;

export type TouchNavigation = {
  contacts: ReadonlyMap<number, { x: number; y: number }>;
  originContacts: ReadonlyMap<number, { x: number; y: number }>;
  originViewport: Viewport;
};
export function beginTouch(state: TouchNavigation | null, pointerId: number, screen: ScreenPoint, viewport: Viewport): TouchNavigation;
export function updateTouch(state: TouchNavigation, pointerId: number, screen: ScreenPoint): TouchNavigation;
export function endTouch(state: TouchNavigation, pointerId: number): TouchNavigation | null;
export function touchViewport(state: TouchNavigation): Viewport;
```

- [ ] **Step 1: Write failing pen and mouse routing tests**

Extend `tests/input.test.ts`:

```ts
test('routes pen tip, barrel, eraser, and conflicting masks by native button state', () => {
  expect(effectivePointerTool({ pointerType: 'pen', button: 0, buttons: 1 }, 'hand', false)).toBe('pen');
  expect(effectivePointerTool({ pointerType: 'pen', button: 2, buttons: 2 }, 'pen', false)).toBe('select');
  expect(effectivePointerTool({ pointerType: 'pen', button: 5, buttons: 32 }, 'select', false)).toBe('eraser');
  expect(effectivePointerTool({ pointerType: 'pen', button: 5, buttons: 34 }, 'pen', false)).toBe('eraser');
  expect(effectivePointerTool({ pointerType: 'pen', button: 0, buttons: 1 }, 'eraser', false)).toBe('pen');
});

test('routes touch to navigation and keeps mouse toolbar and temporary hand behavior', () => {
  expect(effectivePointerTool({ pointerType: 'touch', button: 0, buttons: 1 }, 'eraser', false)).toBe('touch');
  expect(effectivePointerTool({ pointerType: 'mouse', button: 0, buttons: 1 }, 'select', false)).toBe('select');
  expect(effectivePointerTool({ pointerType: 'mouse', button: 1, buttons: 4 }, 'pen', false)).toBe('hand');
  expect(effectivePointerTool({ pointerType: 'mouse', button: 0, buttons: 1 }, 'pen', true)).toBe('hand');
});
```

- [ ] **Step 2: Run input tests and verify RED**

Run: `npm test -- --run tests/input.test.ts`

Expected: FAIL because `effectivePointerTool` and exported `Tool` are missing.

- [ ] **Step 3: Implement input classification**

Check pen masks before generic button handling. Return `null` for unsupported mouse buttons. Keep `isSpacePanTarget` unchanged.

- [ ] **Step 4: Write failing one- and two-finger navigation tests**

Create `tests/touch-navigation.test.ts`:

```ts
test('pans with one finger from the captured origin viewport', () => {
  let state = beginTouch(null, 1, { x: 10, y: 20 }, { x: 4, y: 8, zoom: 2 });
  state = updateTouch(state, 1, { x: 25, y: 14 });
  expect(touchViewport(state)).toEqual({ x: 19, y: 2, zoom: 2 });
});

test('pinches around the starting midpoint while translating that midpoint', () => {
  let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 10, y: 20, zoom: 1 });
  state = beginTouch(state, 2, { x: 100, y: 0 }, touchViewport(state));
  state = updateTouch(state, 1, { x: 0, y: 10 });
  state = updateTouch(state, 2, { x: 200, y: 10 });
  expect(touchViewport(state)).toEqual({ x: 20, y: 50, zoom: 2 });
});

test('rebases when one pinch finger lifts without jumping', () => {
  let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 0, y: 0, zoom: 1 });
  state = beginTouch(state, 2, { x: 100, y: 0 }, touchViewport(state));
  state = updateTouch(state, 2, { x: 200, y: 0 });
  const before = touchViewport(state);
  state = endTouch(state, 1)!;
  expect(touchViewport(state)).toEqual(before);
  state = updateTouch(state, 2, { x: 210, y: 5 });
  expect(touchViewport(state)).toEqual({ ...before, x: before.x + 10, y: before.y + 5 });
});

test('clamps pinch zoom to board limits and ignores a third finger in calculation', () => {
  let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 0, y: 0, zoom: 3 });
  state = beginTouch(state, 2, { x: 10, y: 0 }, touchViewport(state));
  state = beginTouch(state, 3, { x: 999, y: 999 }, touchViewport(state));
  state = updateTouch(state, 2, { x: 100, y: 0 });
  expect(touchViewport(state).zoom).toBe(4);
});
```

- [ ] **Step 5: Implement immutable touch navigation state**

Preserve insertion order in cloned `Map` instances and calculate from the first two contacts. Rebase `originContacts` and `originViewport` whenever the contact count changes. Use `BOARD_ZOOM_LIMITS` for pinch clamping and the same midpoint/world-anchor calculation as `zoomAt`, plus current-midpoint translation.

- [ ] **Step 6: Run input/navigation tests and commit**

Run: `npm test -- --run tests/input.test.ts tests/touch-navigation.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/input.ts src/touch-navigation.ts tests/input.test.ts tests/touch-navigation.test.ts
git commit -m "feat: route pen and touch input"
```

---

### Task 4: Selection gestures, previews, and canvas rendering

**Files:**
- Modify: `src/gesture.ts`
- Modify: `src/canvas.ts`
- Modify: `src/main.ts`
- Modify: `src/object-panel.ts`
- Modify: `tests/gesture.test.ts`
- Modify: `tests/object-panel.test.ts`

**Interfaces:**
- Consumes: `effectivePointerTool`, touch-navigation functions, all selection geometry functions, `BoardModel.updateStrokes`, and `BoardModel.eraseStrokes`.
- Produces:

```ts
export type MarqueeGesture = { type: 'marquee'; pointerId: number; origin: Point; current: Point; additive: boolean };
export type TransformGesture = {
  type: 'transform';
  pointerId: number;
  bounds: Bounds;
  originals: Stroke[];
  operation: SelectionOperation;
  current: Point;
};
```

`RenderState` gains `selectedIds: ReadonlySet<string>` and derives selection bounds, marquee, handles, and transform preview from the gesture.

- [ ] **Step 1: Write failing marquee and transform gesture tests**

Extend `tests/gesture.test.ts`:

```ts
test('updates and commits a reverse-direction additive marquee', () => {
  let gesture: Gesture = { type: 'marquee', pointerId: 7, origin: point(20, 30), current: point(20, 30), additive: true };
  gesture = updateGesture(gesture, 7, { world: point(2, 4) });
  expect(finishGesture(gesture, 7)).toEqual({ type: 'marquee', start: point(20, 30), end: point(2, 4), additive: true });
});

test('commits transformed preview strokes from the original snapshot', () => {
  const originals = [stroke('a', 0), stroke('b', 10)];
  let gesture: Gesture = {
    type: 'transform', pointerId: 8, bounds: selectionBounds(originals)!, originals,
    operation: { type: 'move', origin: point(0, 0) }, current: point(0, 0),
  };
  gesture = updateGesture(gesture, 8, { world: point(5, 3) });
  const commit = finishGesture(gesture, 8);
  expect(commit?.type).toBe('transform');
  expect(commit?.type === 'transform' && commit.strokes.map(({ points }) => points[0])).toEqual([point(5, 3), point(15, 3)]);
});
```

Add complete local stroke fixtures and import `selectionBounds`.

- [ ] **Step 2: Run gesture tests and verify RED**

Run: `npm test -- --run tests/gesture.test.ts`

Expected: FAIL because marquee and transform gesture variants are missing.

- [ ] **Step 3: Extend gesture state and commit types**

Have `updateGesture` update `current` for both new variants. Have `finishGesture` return normalized input data for marquee and use `transformSelection` for transforms. Existing ink, erase, and pan behavior remains unchanged.

- [ ] **Step 4: Replace single selection orchestration in `main.ts`**

Replace `selectedId` with `selectedIds`. Add a helper used by object-panel state:

```ts
function singleSelectedId(): string | null {
  return selectedIds.size === 1 ? selectedIds.values().next().value ?? null : null;
}
```

Route pointer-down by `effectivePointerTool`. For select input, check rotation/resize handles first, then a selected stroke for group move, otherwise start a marquee. On marquee commit call `containedStrokeIds` and `mergeSelection`. On transform commit call `workspace.board.updateStrokes`. Delete/Backspace calls `eraseStrokes([...selectedIds])` once. Prune selection after every edit.

Track touch pointers outside `activeGesture`. Start/update/end touch navigation only when no pen edit is active; cancel touch navigation when a pen edit begins; ignore new touch contacts until all contacts lift after pen suppression. Apply touch preview to rendering and commit its viewport once the final finger lifts.

- [ ] **Step 5: Update renderer for group selection and overlays**

In `src/canvas.ts`, draw all selected strokes with teal emphasis, omit original strokes represented by transform preview, then draw preview strokes. Add private drawing methods for the marquee rectangle, selection bounds, eight square handles, connector, and circular rotation handle. Set dashes and widths in world coordinates divided by zoom so they remain constant in screen pixels.

- [ ] **Step 6: Pin single-stroke object-panel eligibility**

In `tests/object-panel.test.ts`, add:

```ts
test('stroke-specific corrections require exactly one selected stroke from canvas state', () => {
  expect(derivePanelControls(state({ selectedStrokeId: null }))).toMatchObject({ canSplit: false, canAssignToChecked: false, canCreateObject: false });
  expect(derivePanelControls(state({ selectedStrokeId: 'one' }))).toMatchObject({ canSplit: true });
});
```

Pass `singleSelectedId()` into the unchanged `ObjectPanelState.selectedStrokeId` interface so the panel needs no multi-selection knowledge.

- [ ] **Step 7: Run gesture/panel tests, full suite, and commit**

Run: `npm test -- --run tests/gesture.test.ts tests/object-panel.test.ts tests/selection.test.ts tests/input.test.ts tests/touch-navigation.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/gesture.ts src/canvas.ts src/main.ts src/object-panel.ts tests/gesture.test.ts tests/object-panel.test.ts
git commit -m "feat: add marquee and group transforms"
```

---

### Task 5: Versioned local canvas catalog

**Files:**
- Rewrite: `src/storage.ts`
- Rewrite: `tests/storage.test.ts`

**Interfaces:**
- Produces:

```ts
export const LEGACY_AUTOSAVE_KEY = 'whiteboard-assistant.board.v1';
export const CANVAS_CATALOG_KEY = 'whiteboard-assistant.canvases.v1';
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CanvasSummary = { id: string; name: string; createdAt: number; updatedAt: number };
export type CanvasCatalogV1 = { version: 1; activeCanvasId: string; canvases: CanvasSummary[] };
export type CanvasLibrary = { catalog: CanvasCatalogV1; activeDocument: BoardDocumentV3; notice?: string };

export function canvasDocumentKey(id: string): string;
export function initializeCanvasLibrary(storage: StorageLike, identity: { id: string; now: number }): CanvasLibrary;
export function saveActiveCanvas(storage: StorageLike, catalog: CanvasCatalogV1, document: BoardDocumentV3, now: number): { ok: true; catalog: CanvasCatalogV1 } | { ok: false; error: string };
export function createCanvas(storage: StorageLike, catalog: CanvasCatalogV1, name: string, identity: { id: string; now: number }): { catalog: CanvasCatalogV1; document: BoardDocumentV3 };
export function renameCanvas(storage: StorageLike, catalog: CanvasCatalogV1, id: string, name: string, now: number): CanvasCatalogV1;
export function openCanvas(storage: StorageLike, catalog: CanvasCatalogV1, id: string): { catalog: CanvasCatalogV1; document: BoardDocumentV3 };
export function deleteCanvas(storage: StorageLike, catalog: CanvasCatalogV1, id: string, replacement: { id: string; now: number }): { catalog: CanvasCatalogV1; document?: BoardDocumentV3; activeChanged: boolean };
```

- [ ] **Step 1: Build a keyed in-memory storage test double**

In `tests/storage.test.ts`, replace the single-value helper with:

```ts
function memoryStorage(initial: Record<string, string> = {}, failOnSet = Infinity): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      if (writes === failOnSet) throw new Error('quota exceeded');
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
}
```

- [ ] **Step 2: Write failing initialization and isolation tests**

```ts
test('migrates the legacy autosave once into an Untitled canvas', () => {
  const storage = memoryStorage({ [LEGACY_AUTOSAVE_KEY]: JSON.stringify(filledDocument) });
  const first = initializeCanvasLibrary(storage, { id: 'canvas-a', now: 100 });
  expect(first.catalog).toEqual({ version: 1, activeCanvasId: 'canvas-a', canvases: [{ id: 'canvas-a', name: 'Untitled canvas', createdAt: 100, updatedAt: 100 }] });
  expect(first.activeDocument).toEqual(filledDocument);
  const second = initializeCanvasLibrary(storage, { id: 'unused', now: 200 });
  expect(second.catalog).toEqual(first.catalog);
  expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).not.toBeNull();
});

test('keeps documents isolated while create, save, and open update the catalog', () => {
  const storage = memoryStorage();
  const initial = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
  const created = createCanvas(storage, initial.catalog, '  Second  ', { id: 'b', now: 2 });
  const saved = saveActiveCanvas(storage, created.catalog, filledDocument, 3);
  expect(saved.ok).toBe(true);
  const reopened = openCanvas(storage, saved.ok ? saved.catalog : created.catalog, 'a');
  expect(reopened.document.events).toEqual([]);
  expect(openCanvas(storage, reopened.catalog, 'b').document).toEqual(filledDocument);
  expect(created.catalog.canvases.find(({ id }) => id === 'b')?.name).toBe('Second');
});
```

- [ ] **Step 3: Run storage tests and verify RED**

Run: `npm test -- --run tests/storage.test.ts`

Expected: FAIL because the catalog API and keyed storage contract do not exist.

- [ ] **Step 4: Implement validation, migration, and document isolation**

Use `parseBoard` for every document read and `serializeBoard` for every write. Catalog validation rejects unsupported versions, missing active IDs, duplicate/empty IDs, blank names, and non-finite timestamps. Create a blank document with `{ version: 3, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } }`.

Sort returned catalog summaries by `updatedAt` descending, then `createdAt`, then ID. Accept duplicate trimmed names. Write a new or migrated document before the catalog. Do not remove the legacy key.

- [ ] **Step 5: Write failing CRUD, reset-equivalent save, corruption, and staged-failure tests**

```ts
test('renames duplicate names, deletes inactive and active canvases, and replaces the last canvas', () => {
  const storage = memoryStorage();
  let library = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
  const second = createCanvas(storage, library.catalog, 'Same', { id: 'b', now: 2 });
  const renamed = renameCanvas(storage, second.catalog, 'a', 'Same', 3);
  expect(renamed.canvases.map(({ name }) => name)).toEqual(['Same', 'Same']);
  const withoutA = deleteCanvas(storage, renamed, 'a', { id: 'unused', now: 4 });
  expect(withoutA.activeChanged).toBe(false);
  const replacement = deleteCanvas(storage, withoutA.catalog, 'b', { id: 'c', now: 5 });
  expect(replacement.activeChanged).toBe(true);
  expect(replacement.catalog.canvases).toEqual([{ id: 'c', name: 'Untitled canvas', createdAt: 5, updatedAt: 5 }]);
  expect(replacement.document?.events).toEqual([]);
});

test('rejects blank names and malformed target documents without changing the active catalog', () => {
  const storage = memoryStorage();
  const library = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
  expect(() => createCanvas(storage, library.catalog, '   ', { id: 'b', now: 2 })).toThrow(/name/i);
  storage.setItem(canvasDocumentKey('broken'), '{broken');
  const catalog = { ...library.catalog, canvases: [...library.catalog.canvases, { id: 'broken', name: 'Broken', createdAt: 2, updatedAt: 2 }] };
  expect(() => openCanvas(storage, catalog, 'broken')).toThrow(/parse|JSON|document/i);
  expect(catalog.activeCanvasId).toBe('a');
});

test('recovers to an in-memory blank canvas without overwriting a malformed catalog', () => {
  const storage = memoryStorage({ [CANVAS_CATALOG_KEY]: '{broken' });
  const result = initializeCanvasLibrary(storage, { id: 'recovery', now: 9 });
  expect(result.catalog.activeCanvasId).toBe('recovery');
  expect(result.activeDocument.events).toEqual([]);
  expect(result.notice).toMatch(/could not be loaded/i);
  expect(storage.getItem(CANVAS_CATALOG_KEY)).toBe('{broken');
});

test.each([1, 2])('does not publish created catalog state when staged write %s fails', (failOnSet) => {
  const storage = memoryStorage({}, failOnSet);
  const original: CanvasCatalogV1 = { version: 1, activeCanvasId: 'a', canvases: [{ id: 'a', name: 'A', createdAt: 1, updatedAt: 1 }] };
  expect(() => createCanvas(storage, original, 'B', { id: 'b', now: 2 })).toThrow(/quota/i);
  expect(original).toEqual({ version: 1, activeCanvasId: 'a', canvases: [{ id: 'a', name: 'A', createdAt: 1, updatedAt: 1 }] });
});
```

Use fresh storage per failure case and seed the active document directly when the tested operation requires it.

- [ ] **Step 6: Implement CRUD and failure-safe returned state**

Construct cloned candidate catalogs and return them only after required writes succeed. Create writes document then catalog. Rename writes catalog once. Open parses the document before writing the candidate active-ID catalog. Delete writes the surviving/replacement catalog before removing the deleted document key; deletion of the final entry first writes the replacement blank document.

Keep compatibility `saveAutosave`, `loadAutosave`, and `openPortableBoard` wrappers only until Task 6 switches `main.ts`; then remove wrappers and update remaining imports.

- [ ] **Step 7: Run storage and full tests, then commit**

Run: `npm test -- --run tests/storage.test.ts tests/document.test.ts`

Run: `npm test`

Expected: all tests pass.

```powershell
git add src/storage.ts tests/storage.test.ts
git commit -m "feat: add local canvas catalog"
```

---

### Task 6: Canvases modal, reset, and active-canvas integration

**Files:**
- Create: `src/canvas-library-panel.ts`
- Create: `tests/canvas-library-panel.test.ts`
- Modify: `src/main.ts`
- Modify: `index.html`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: the Task 5 catalog API and existing workspace/document APIs.
- Produces:

```ts
export type CanvasLibraryPanelState = { open: boolean; activeCanvasId: string; canvases: CanvasSummary[]; status: string };
export type CanvasLibraryPanelActions = {
  onClose(): void;
  onCreate(name: string): void;
  onOpen(id: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
};
export function orderedCanvasSummaries(values: readonly CanvasSummary[]): CanvasSummary[];
export class CanvasLibraryPanel {
  constructor(root: HTMLElement, actions: CanvasLibraryPanelActions);
  render(state: CanvasLibraryPanelState): void;
  focusEntry(): void;
}
```

- [ ] **Step 1: Write failing panel view-model tests**

Create `tests/canvas-library-panel.test.ts`:

```ts
test('orders canvases by recent update, creation time, then stable ID without mutating input', () => {
  const input = [
    { id: 'b', name: 'B', createdAt: 1, updatedAt: 3 },
    { id: 'a', name: 'A', createdAt: 1, updatedAt: 3 },
    { id: 'c', name: 'C', createdAt: 2, updatedAt: 2 },
  ];
  expect(orderedCanvasSummaries(input).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  expect(input.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
});
```

- [ ] **Step 2: Run panel tests and verify RED**

Run: `npm test -- --run tests/canvas-library-panel.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the modal component and markup**

Add `#canvases-toggle` to the file-actions group and `#reset-page` beside it. Add a modal backdrop and `<section id="canvas-library" role="dialog" aria-modal="true" aria-labelledby="canvas-library-title" hidden>` after the canvas workspace. Render escaped names, active markers, `<time>` labels, and explicit Open/Rename/Delete buttons. Bind create on form submit and rename through a row-local text input, not `prompt`, so names are keyboard-accessible. Delete confirmation remains in `main.ts`.

- [ ] **Step 4: Integrate startup, autosave, switching, and portable open in `main.ts`**

Initialize `CanvasLibrary` once after acquiring `window.localStorage`, then load its `activeDocument`. Replace `persist()` with `saveActiveCanvas`; on success update the in-memory catalog and render the modal if open.

Add one workspace-replacement helper:

```ts
function replaceWorkspace(document: BoardDocumentV3): void {
  cancelActiveGesture();
  touchNavigation = null;
  workspace = loadWorkspace({ sourceVersion: 3, document });
  selectedIds.clear();
  selectedObjectId = null;
  historicalSelectedObjectId = null;
  checkedObjectIds.clear();
  historySession = createHistorySession(workspace);
  assistantSession = createAssistantSession();
  objectPanelOpen = false;
  timelinePanelOpen = false;
  assistantPanelOpen = false;
  refreshCachedMetadata();
  updateControls();
  scheduleRender();
}
```

Canvas create/open/delete handlers call storage first and publish returned catalog/workspace only on success. Portable Open parses with `readPortableBoard`, then calls `replaceWorkspace` and `persist`; it never modifies catalog identity.

- [ ] **Step 5: Implement confirmed reset and delete behavior**

Reset uses:

```ts
const blankDocument = (): BoardDocumentV3 => ({
  version: 3,
  events: [],
  associationEvents: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
```

Call `window.confirm` with the active canvas name before reset and with the target name before deletion. On reset confirmation call `replaceWorkspace(blankDocument())`, then `persist()` once. On canceled confirmation do not cancel a gesture or mutate UI state. Deleting the active canvas calls `replaceWorkspace` with the document returned by `deleteCanvas`; deleting an inactive canvas leaves the workspace untouched.

- [ ] **Step 6: Style the modal and responsive toolbar**

Add fixed centered dialog styles with maximum width `680px`, maximum height `min(720px, calc(100vh - 32px))`, scrolling list rows, visible active state, and a backdrop above every side panel. At `max-width: 650px`, stack each canvas row's metadata and actions without horizontal overflow. Reuse existing button colors and focus-visible treatment.

- [ ] **Step 7: Run tests and build, then commit**

Run: `npm test -- --run tests/canvas-library-panel.test.ts tests/storage.test.ts tests/input.test.ts tests/gesture.test.ts tests/selection.test.ts`

Run: `npm test`

Run: `npm run build`

Expected: all tests pass and Vite produces `dist/` with no TypeScript errors.

```powershell
git add src/canvas-library-panel.ts tests/canvas-library-panel.test.ts src/main.ts index.html src/style.css src/storage.ts
git commit -m "feat: add canvas library and reset"
```

---

### Task 7: Documentation and production-browser acceptance

**Files:**
- Modify: `README.md`
- Create: `docs/milestone-1e-verification.md`

**Interfaces:**
- Consumes: the complete milestone implementation.
- Produces: user-facing controls and verification evidence; no production API.

- [ ] **Step 1: Update the user-facing controls and scope**

Update `README.md` to document:

- pen tip/lower-button/upper-button behavior;
- one-finger pan and two-finger pinch;
- marquee, Shift-add, group move/delete, resize, and rotation;
- Canvases modal operations and independent autosaves;
- confirmed Reset page behavior;
- active-canvas portable Open/Save semantics;
- localStorage limitations and deferred IndexedDB migration.

Remove the old statements that selection is single-stroke and touch pinch is not guaranteed.

- [ ] **Step 2: Run complete automated verification**

Run: `npm test`

Run: `npm run build`

Expected: all tests pass; build completes with no TypeScript or Vite errors.

- [ ] **Step 3: Run browser acceptance at desktop and narrow widths**

Start the app with `npm run dev`. Use Playwright CLI at `1280x800` and `500x800` to verify:

1. Mouse draw, reverse marquee, Shift-add, group move, Delete, undo, redo.
2. Each edge and corner resize handle, unchanged visible stroke thickness, and rotation.
3. Canvases opens only from its button; create, rename, open, inactive delete, active delete, and last-canvas replacement work.
4. Reset Cancel preserves the board; Reset OK clears strokes, objects, history, selection, and viewport.
5. Reload restores the active canvas and switching proves document isolation.
6. Portable Save and Open affect only the active canvas.
7. The 500-pixel layout has no horizontal overflow and keyboard focus returns to Canvases after Escape.
8. Console and page-error collections remain empty.

Browser automation cannot synthesize trusted Windows pen hardware reliably. On the physical ScreenPad Plus, manually verify pen tip drawing, lower-button erasing, upper-button marquee, one-finger pan, two-finger pinch, and palm contact during an active pen stroke.

- [ ] **Step 4: Record exact verification evidence**

Write `docs/milestone-1e-verification.md` with dated command outputs, browser viewport results, any browser-automation limitations, and a clearly separated physical-device checklist. Do not mark the Metapen checks passed unless they were actually performed on the device.

- [ ] **Step 5: Commit documentation and verification**

```powershell
git add README.md docs/milestone-1e-verification.md
git commit -m "docs: verify milestone 1e"
```

- [ ] **Step 6: Inspect final repository state**

Run: `git status --short`

Run: `git log --oneline -8`

Expected: no uncommitted milestone files remain and the milestone commits appear after the approved design and plan commits.

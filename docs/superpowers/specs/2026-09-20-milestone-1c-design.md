# Milestone 1C Temporal Context Design

## Purpose

Milestone 1C turns the append-only ink and association histories from Milestones 1A and 1B into a queryable temporal context layer. Its primary consumer is a future assistant that should focus on the current canvas while selectively consulting history to decide where, when, and what to draw. A human-facing timeline and activity heatmap prove that the same historical projections are correct and make the data inspectable during development.

History remains evidence, not a writable canvas. Scrubbing is observational only. A future assistant may write on top of the current board through a later insertion API, but 1C never restores an old state, branches the document, or reintroduces erased ink into the live board.

## Product principles

- The current visible canvas and active work-object graph are the default context.
- Complete history remains available through structured queries without being placed wholesale into model context.
- Erased strokes may be inspected when a targeted query needs them, but they are excluded from the default current-context result.
- Historical projections are derived from the authoritative version-2 event logs. The timeline UI is a consumer, not a storage mechanism.
- Every historical state is explainable as a prefix of the ink and association histories.
- No learned model, natural-language summarizer, assistant drawing, or semantic classification is added in 1C.

## Document and persistence boundary

The portable document remains version 2. The existing `events` and `associationEvents` arrays already contain the complete durable history needed by this milestone. Temporal entries, activity segments, heat samples, summaries, and historical projections are derived in memory and are never serialized.

Autosave and file export continue to write only the live `WorkspaceState`. Entering history, moving the historical cursor, changing the heatmap toggle, and panning or zooming a historical view do not write to autosave or affect board undo/redo.

## Deterministic temporal index

Create a pure temporal module that consumes the two validated event arrays and produces a `TemporalIndex`.

```ts
export type TimelineSource = 'ink' | 'association';

export type TimelineEntry = {
  id: string; // `ink:<event-id>` or `association:<event-id>`
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
```

The index is a dependency-preserving merge of the two logs:

1. Preserve the original order within each source log. Undo/redo references and association before-states therefore remain replayable even if imported timestamps regress.
2. Compare only the next unconsumed event from each log. Choose the earlier timestamp.
3. When timestamps are equal, choose the ink event first.
4. Hold an association event until every stroke ID it references has appeared in the consumed ink prefix. Ink dependencies take priority over timestamp order.
5. Entry prefix counts describe the state immediately after that entry.

Timeline position `0` represents the empty board before any event. Position `n` represents the state after `entries[n - 1]`. The valid range is `0..entries.length`. “Now” is a separate UI state backed directly by the live workspace, even when the latest historical position is visually equivalent.

An activity segment starts at the first entry and after any positive timestamp gap greater than `30_000` milliseconds. Negative or zero deltas never create a segment. Association events participate in gap detection and receive segment IDs, while only ink events contribute spatial heat.

## Historical projection

```ts
export type HistoricalProjection = {
  position: number;
  entry: TimelineEntry | null;
  segment: ActivitySegment | null;
  board: BoardModel;
  associations: AssociationModel;
};

export function projectHistory(
  document: BoardDocumentV2,
  index: TemporalIndex,
  position: number,
): HistoricalProjection;
```

Projection uses the entry’s prefix counts to replay an ink-log prefix and association-log prefix through the existing validated models. Known stroke IDs come only from the selected ink prefix. Position zero produces empty models. Invalid positions are rejected by the pure API; the UI clamps its controls before calling it.

Projection never mutates the live models. A failure leaves the current board untouched, exits historical display, and reports a visible error.

## Assistant-facing query layer

The temporal module exposes structured queries rather than prose. Results default to compact metadata. Exact point geometry is included only when `detail: 'geometry'` is requested.

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

export type TemporalQueryOptions = {
  throughPosition?: number;
  detail?: TemporalDetail;
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

export function getCurrentContext(
  document: BoardDocumentV2,
  index: TemporalIndex,
  sincePosition?: number,
): CurrentContext;

export function queryChanges(
  document: BoardDocumentV2,
  index: TemporalIndex,
  fromPosition: number,
  toPosition: number,
  options?: Pick<TemporalQueryOptions, 'detail'>,
): TemporalChangeResult;

export function queryObjectHistory(
  document: BoardDocumentV2,
  index: TemporalIndex,
  objectId: string,
  options?: TemporalQueryOptions,
): TemporalObjectResult;

export function queryRegionHistory(
  document: BoardDocumentV2,
  index: TemporalIndex,
  bounds: Bounds,
  options?: TemporalQueryOptions & { includeErased?: boolean },
): TemporalRegionResult;
```

`getCurrentContext` returns the current visible and active IDs, the current activity segment, and entries after the greater of `sincePosition` or the current segment's start. It never includes erased-stroke geometry. `queryChanges` reports entries in the inclusive position interval after `fromPosition` through `toPosition` and their affected stroke/object IDs. `queryObjectHistory` follows direct object changes plus every ancestor and descendant reachable through parent IDs at `throughPosition`. `queryRegionHistory` matches changed stroke geometry intersecting the requested world-coordinate bounds through `throughPosition`; with `includeErased: false`, it returns only strokes visible at that position. Erased IDs and their historical geometry appear only when `includeErased` is true. Omitted `throughPosition` means `entries.length`, and omitted `detail` means `summary`. Summary results contain the fields shown above. Geometry results additionally contain defensive `Stroke` and `WorkObject` copies.

These deterministic queries are the proof-of-concept context substrate. Decisions about prompt construction, retrieval ranking, token budgets, and how often a future assistant should consult older history remain later work.

## Recent-activity heatmap

Heat is computed for the selected entry’s activity segment through the selected position. Association events never create heat because they have no intrinsic canvas location.

For each ink event in that range, use each change’s `after` stroke, or its `before` stroke when the event removes geometry. Resample the stroke at regular 16-world-unit spacing, including endpoints. Each sample receives recency weight:

```text
weight = 2 ^ (-(selectedEventTime - eventTime) / 10_000)
```

Clamp negative ages to zero. This gives activity a ten-second half-life within the segment. The renderer draws a noninteractive, screen-independent field behind ink using world-coordinate samples and a fixed 36-world-unit radius. Opacity is normalized by the maximum sample density in the selected map and capped so ink remains legible. Empty segments and association-only positions produce no heat samples.

The heatmap is a derived attention visualization. It is not an occupancy grid, collision map, semantic region, or persisted model input.

## Timeline interface

Add a closed-by-default **History** button. It opens a bottom timeline dock containing:

- previous-event and next-event buttons;
- a range scrubber spanning position `0` through `entries.length`;
- source/kind markers for ink and association events;
- selected position, timestamp, event description, and activity-segment position;
- a heatmap checkbox, enabled by default while viewing history;
- a prominent **Return to now** button.

Automatic playback is outside 1C. Exact stepping and scrubbing are sufficient for inspection.

Selecting positions `0..entries.length` enters historical mode and shows a persistent **Historical view · read only** indicator. The canvas uses the historical projection, and the Objects inspector uses the projected association model. Drawing, moving, erasing, board undo/redo, merge, split, and assignment are disabled. File open and save controls are also disabled until the user returns to now so their effects cannot be mistaken for historical edits.

Pan, wheel zoom, and zoom buttons remain available through a temporary historical viewport copied from the live viewport on entry. Historical navigation is not persisted. **Return to now** restores the live board, live graph, selection state, and unchanged live viewport.

On narrow screens the timeline becomes a bottom overlay that does not resize the canvas. Opening History closes the Objects overlay; users may reopen Objects to inspect the selected historical graph, which closes the History overlay. Desktop widths allow the bottom dock and right Objects inspector to coexist.

## Integration boundaries

- `temporal.ts` owns indexing, prefix projection, segmentation, query results, and heatmap samples. It is pure and has no DOM or storage access.
- `timeline-panel.ts` owns timeline view-model derivation and accessible DOM rendering.
- `workspace.ts` remains the live composition boundary and gains only helpers for producing a current version-2 document for temporal queries.
- `canvas.ts` accepts optional heat samples and renders them behind ink without changing hit testing.
- `main.ts` coordinates live versus historical display state, temporary viewport state, control enablement, and panel interactions.
- `object-panel.ts` accepts a read-only flag so historical graph inspection cannot invoke correction commands.

After every live ink or association edit, successful import, and version-1 migration, rebuild the in-memory temporal index. Do not incrementally patch the index in 1C; full derivation keeps one correctness path and is adequate for the current local proof of concept.

## Accessibility and interaction details

- Timeline controls use native buttons, range input, and checkboxes with explicit labels.
- Arrow buttons and the range input support keyboard event stepping.
- Focus moves to the timeline heading when History opens and returns to the History button when it closes.
- From a historical position, the first `Escape` returns to now and leaves the dock open. At now, `Escape` closes the dock and returns focus to the History button.
- Disabled editing controls retain explanatory titles indicating that history is read-only.
- Event descriptions use visible text such as “Stroke added,” “Stroke erased,” “Objects merged,” and “Object split”; internal IDs remain available in details.
- The historical indicator and projection errors use `role="status"` with polite announcements.

## Failure handling

- A temporal index or projection failure must not replace or mutate the live workspace.
- A query for an unknown object returns an empty result with the requested ID rather than guessing lineage.
- Region bounds and positions must be finite and valid; invalid pure-query inputs throw descriptive errors.
- Empty boards expose position zero, an empty current context, disabled step controls, and no heatmap.
- Equal and regressing timestamps remain deterministic because source-log dependencies outrank chronological display order.
- Import validation remains owned by the version-2 document boundary before any temporal index is built.

## Verification

Unit tests must cover:

- deterministic dependency-preserving merge, equal timestamps, and regressing timestamps;
- 30-second segment boundaries and association participation in gaps;
- prefix projections at start, ink, erase, undo/redo, merge, and split positions;
- current-context results with and without `sincePosition`;
- object lineage, region intersection, erased-content opt-in, summary versus geometry detail, and defensive copies;
- activity resampling, half-life weighting, association-only selections, and negative timestamp deltas;
- timeline control states at start, middle, latest history, and now;
- read-only object-panel controls and historical/live viewport separation.

Production-browser acceptance must demonstrate:

1. Draw, erase, undo/redo, merge, and split; step through every resulting state and compare visible counts and graph lineage.
2. Confirm history interaction leaves the serialized live document byte-for-byte unchanged.
3. Confirm erased ink appears before its erase event and disappears after it without becoming live ink.
4. Confirm the heatmap follows the selected segment and stays aligned through historical pan and zoom.
5. Confirm all editing, correction, and file controls are disabled in history and restored at now.
6. Confirm version-1 migration and version-2 reload rebuild the same timeline entry IDs and segment boundaries.
7. Confirm empty-board, 500px layout, keyboard focus/escape, and 2x device-pixel-ratio behavior.
8. Confirm zero console and page errors.

## Deferred scope

Milestone 1C does not add automatic playback, persistent snapshots, timeline branching, state restoration, assistant/model calls, prompt construction, retrieval ranking, natural-language history summaries, semantic labels, occupancy maps, collision avoidance, reference imports, collaboration, or autonomous drawing. Milestone 1D may use this query layer while adding scripted assistant insertions only onto the current canvas.

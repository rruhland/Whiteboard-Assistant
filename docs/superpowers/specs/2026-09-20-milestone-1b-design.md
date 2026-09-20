# Milestone 1B — Work-object association and graph proof

## Intent

Milestone 1B proves that native whiteboard ink can become a persistent, correctable spatial-temporal graph before any vision or language model is added. The board remains a freeform canvas. Invisible work objects are computational handles around related strokes; optional overlays and an inspector make those handles visible for development and correction.

The approved milestone succeeds when nearby drawing grows an existing object, separate drawing creates another object, returning to old work preserves its identity, and mistaken proposals can be split or merged without losing their ancestry. Ink events remain the authoritative record of what the user drew.

## Scope

### Automatic proposals

Every newly committed stroke is assigned immediately to one active work object. The deterministic association policy considers only native facts: stroke geometry, distance to visible member strokes, and elapsed time since an object's last addition.

- Join the nearest active object when the new stroke is within 24 world units of its visible bounds, regardless of elapsed time. This supports returning to an existing piece of work.
- Join the nearest active object within 80 world units when that object received ink in the preceding 12 seconds. This supports ordinary multi-stroke writing.
- Otherwise create a new object.
- Resolve equal candidates by distance, then most recent activity, then stable object ID. The result must not depend on array iteration accidents.
- Moving or erasing strokes does not silently reclassify them. Bounds are derived from current visible member strokes, so they move with ink and disappear when no members are visible. Undo/redo restores visibility without changing membership.

These constants are intentionally transparent first-pass heuristics, not claims about semantics. Arbitrary arrow/connector recognition, intent inference, and trained clustering are deferred.

### Persistent temporal graph

Upgrade portable documents to schema version 2. Version 2 retains the 1A ink event log and adds an append-only `associationEvents` log. Each event has a stable ID, timestamp, actor, kind, object changes, and reason. Replaying it reconstructs every work object and validates before/after state.

An object records:

- stable ID and short display label;
- all assigned stroke IDs, including currently erased strokes;
- creation and last-association timestamps;
- status (`active` or `superseded`);
- zero or more parent object IDs.

Automatic creation and growth preserve an object's ID. Manual merge creates one new active child whose parents are every merged object and supersedes the parents. Manual split creates two active children with the original as their parent and supersedes the original. This gives later milestones explicit lineage rather than overwritten grouping state.

Graph projections are derived rather than stored:

- `contains`: active or historical work object to its member stroke IDs;
- `derived-from`: child object to each parent;
- `near`: between active objects with visible bounds no more than 120 world units apart.

No semantic edge such as “explains,” “causes,” or “points to” is inferred in 1B.

### Compatibility and reconciliation

Version 1 files remain importable. They are upgraded in memory to version 2 and current visible strokes are deterministically grouped in creation order. The upgraded document is saved on the next autosave or portable export. Existing version 2 identities and association history must round-trip unchanged.

Association validation rejects duplicate event/object IDs, impossible before states, unknown stroke references, invalid lineage, cycles, and active objects that claim the same stroke. A failed import leaves the current board and graph unchanged.

Newly added strokes must be associated in the same completed user operation before autosave. If association fails, the ink edit remains usable, the stroke is reported as unassigned, and the status shows the error. The inspector offers `Assign selected stroke` so recovery does not require editing JSON.

## User experience

Add an **Objects** control that opens a right-side inspector without covering the canvas. The board continues to open with the inspector closed. At narrow widths the inspector becomes an overlay panel with an explicit close button.

The inspector contains:

1. **Overview** — active object count, unassigned visible stroke count, and an `Object bounds` overlay toggle.
2. **Graph map** — a compact SVG projection positioned from current object centroids. Active objects are colored nodes, superseded lineage nodes are muted, `near` edges are dashed, and `derived-from` edges are solid. It is a diagnostic view, not a force-directed editor.
3. **Object list** — display label, active/superseded state, visible/total member counts, last activity, and merge checkboxes. Selecting a row highlights that object's visible strokes and centers its details in the panel; it does not move the viewport.
4. **Correction controls** — merge two or more checked active objects; split the currently selected canvas stroke out of its active object. Split is enabled only when its object contains at least two member strokes. For a two-way split, one child receives the selected stroke and the other receives all remaining strokes. An unassigned selected stroke can be assigned to one checked active object or made into a new object.
5. **Details** — object ID, member stroke IDs, parents, creation time, last activity, and bounds. IDs are copyable text; internal debug metadata is not placed in the normal toolbar.

When overlays are enabled, draw thin dashed colored bounds and compact labels in world space. They are debug decoration only: no hit target, no clipping region, and no restriction on drawing inside, across, or outside them. The selected object's strokes receive a subtle secondary highlight in addition to ordinary single-stroke selection.

Manual corrections are durable and recorded, but 1B does not add grouping undo/redo. A mistaken correction can be corrected by another split/merge, and the prior lineage remains inspectable. Board Ctrl/Cmd+Z continues to affect ink edits only; the UI labels correction actions clearly to avoid implying otherwise.

## Architecture

Add a pure `association.ts` module containing document types, validation/replay, the deterministic proposal policy, manual merge/split/assignment commands, bounds, and graph projection. It depends on exported `Stroke` data but not DOM or canvas APIs.

`BoardDocument` becomes a validated versioned union on input and a version-2 document on output. `BoardModel` remains responsible only for ink state. `AssociationModel` owns association history and current work objects. A small coordinator in `main.ts` commits ink first, associates the returned stroke ID, reconciles visible/unassigned strokes after load, and persists one combined document.

`CanvasRenderer` receives optional object-overlay render data and remains unaware of association policy. A dedicated `object-panel.ts` renders the panel and emits typed callbacks for selection and corrections. Keep the UI framework-free and use native SVG for the graph map.

No graph database, backend, collaboration, OCR, model call, occupancy grid, PDF/image reference, semantic labeling, timeline scrubber, or autonomous drawing is added.

## Error handling

- Import validates the complete ink and association histories before replacing either current model.
- Association command preconditions fail without partially changing the graph.
- Autosave failures retain the existing visible warning and portable export path.
- An association failure never discards a successfully committed ink stroke; it becomes visibly unassigned until repaired.
- Inspector actions disabled by current selection explain their requirement with nearby copy or a tooltip.

## Verification

Unit tests must cover:

- near/recent/far proposal thresholds, ties, negative coordinates, dots, and erased members;
- stable growth identity and deterministic version-1 migration;
- merge/split lineage, supersession, unique membership, and invalid command atomicity;
- association replay/import rejection for duplicate IDs, unknown strokes, invalid before states, duplicate active membership, and lineage cycles;
- bounds after move/erase/undo and `near` graph edges;
- version-1 import and version-2 JSON round trips without changing 1A ink history.

Browser checks must demonstrate:

1. Draw one multi-stroke cluster and a distant cluster: two active nodes appear.
2. Return to the first cluster after working elsewhere: it grows without changing ID.
3. Toggle overlays, pan, zoom, move, erase, undo, and redo: bounds and visible counts follow current ink while memberships remain stable.
4. Merge two objects, then split one selected stroke: new child IDs and lineage appear in the graph map.
5. Reload and export/open: graph IDs, events, memberships, lineage, viewport, and ink are unchanged.
6. Open a version-1 board: current strokes receive deterministic proposals and save as version 2.
7. Try malformed association JSON: the open board remains intact and an error is visible.
8. Verify keyboard access, narrow layout, 2x device-pixel-ratio rendering, and no console errors.

The full unit suite, strict TypeScript build, dependency audit, and GitHub CI must pass.

## Deferred to later milestones

Milestone 1C exposes activity maps and a timeline over the histories established here. Milestone 1D adds scripted assistant insertions through the same substrate. Visual/OCR models and semantic graph contributions follow only after these deterministic structures are reliable.

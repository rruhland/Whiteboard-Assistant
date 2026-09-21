# Milestone 1E Whiteboard Quality-of-Life Design

## Purpose

Milestone 1E makes the whiteboard comfortable for daily pen use on a Windows pen-and-touch device. A Metapen M1 should draw with its tip, temporarily erase with the lower side button, and temporarily select with the upper side button. Fingers should navigate rather than create ink. Selection should work on groups through a marquee and direct-manipulation handles. The browser should also hold a small library of independently autosaved, named canvases.

This remains a local-first, browser-only milestone. It preserves the version-3 portable document format and the existing temporal and object models. Multi-canvas organization is a storage concern around complete documents, not a fourth document version or a shared cross-canvas history.

## Success Criteria

- An unmodified pen tip draws, the lower Metapen button erases while held, and the upper button selects while held.
- Mouse input continues to follow the selected toolbar tool; touch input never draws, selects, or erases.
- One finger pans and two fingers pinch-zoom between pen strokes without changing the persistent tool.
- Select mode presents a dashed marquee and selects only strokes whose complete rendered bounds lie inside it.
- Shift-marquee adds to the selection; a normal marquee replaces it; an outside click or empty normal marquee clears it.
- A selected group can move, resize from edge or corner handles, rotate, and delete as atomic undoable edits.
- Corner resize preserves aspect ratio, edge resize changes one axis, and neither operation changes stroke width.
- Resetting the active page requires confirmation and replaces its document with a completely fresh board.
- A user-invoked Canvases modal can create, open, rename, and delete independently autosaved canvases.
- The existing single autosave migrates once into the first canvas without losing history, objects, or viewport.

## Scope

### Included

- Native Pointer Events routing for mouse, pen, and touch.
- Metapen lower-button eraser and upper/right-click select overrides.
- One-finger pan and two-finger pinch-zoom.
- Multi-stroke marquee selection with Shift-add behavior.
- Group move, horizontal or vertical resize, proportional resize, rotation, and deletion.
- Dashed marquee, persistent selection bounds, eight resize handles, and one rotation handle.
- Atomic multi-stroke transform and erase events using the existing version-3 event shape.
- A versioned local canvas catalog and one storage key per complete version-3 document.
- Current-autosave migration, named-canvas CRUD, destructive confirmations, and reset.
- Preservation of existing portable open/save behavior for the active canvas.

### Deferred

- IndexedDB, server storage, accounts, sync, collaboration, or shared canvas links.
- Cross-canvas search, folders, thumbnails, duplication, templates, and import-as-new-canvas.
- Partial-stroke erasing, lasso selection, resize flipping, skewing, snapping, alignment guides, and transform numerics.
- Shift-toggle removal, Ctrl/Cmd selection semantics, and selection of graph objects as units.
- Configurable pen-button mappings or support for drivers that do not expose standard Pointer Events button values.
- Palm classification beyond refusing touch navigation while the pen tip is actively editing.
- Simultaneous pen editing and touch navigation.

## Input Routing

Input behavior is derived from `pointerType`, `button`, and `buttons`, not from compatibility mouse events. For a pen pointer, tip contact with no side control uses `pen`; the standard eraser signal (`button === 5` or the `buttons & 32` mask) uses `eraser`; and the barrel/right-click signal (`button === 2` or the `buttons & 2` mask) uses `select`. Eraser wins if a driver reports both masks. The effective pen tool is chosen when contact begins and remains fixed for that contact. Releasing a side button restores tip drawing for the next contact. Context-menu defaults are suppressed over the canvas.

Pen input deliberately ignores the persistent toolbar tool. This gives the physical stylus a stable tip/lower/upper contract. Mouse primary input uses the persistent `pen`, `select`, `eraser`, or `hand` tool. Middle-button and Space-drag remain temporary mouse hand gestures. Existing keyboard tool shortcuts remain unchanged.

Touch pointers are tracked separately and never enter ink, erase, selection, or transform gestures. The first finger begins a pan from the live viewport. A second finger upgrades the interaction to pinch-zoom, preserving the world point under the fingers' starting midpoint while applying both midpoint translation and distance-ratio zoom. Lifting back to one finger rebases the remaining pan so the viewport does not jump. Extra fingers are tracked but do not alter the first-two-finger calculation.

Touch navigation may begin only when no pen edit contact is active. A pen contact cancels an in-progress touch navigation before starting its edit. Touch contacts arriving during a pen edit are ignored until every touch pointer lifts. This narrow arbitration prevents a palm from shifting the canvas during a stroke while allowing finger navigation between strokes regardless of the selected toolbar tool.

Historical mode keeps its existing read-only rule. Pen and mouse edits remain blocked there, while finger, middle-button, Space, and hand-tool navigation continue to manipulate only the historical viewport.

## Selection State and Marquee

Live selection is a `Set<string>` of visible stroke IDs rather than a single ID. Any workspace replacement, reset, canvas switch, or transition into history clears it. After board mutations, IDs that are no longer visible are removed.

Pressing on empty canvas in select mode starts a world-coordinate marquee. The renderer draws its normalized rectangle with a dashed outline from the initial corner to the current pointer. On completion, a stroke qualifies only when its complete rendered bounds, expanded by half its line width, are contained within the normalized rectangle. Bounds use every point in the stroke; selection does not depend on hitting the stroke centerline.

A normal marquee replaces the current set with the qualifying IDs. A Shift-marquee unions qualifying IDs into the current set and never removes an ID. A zero-area click outside the current selection and an empty completed normal marquee clear selection. Shift-click on empty space leaves the current set unchanged. Starting any new non-Shift marquee visually replaces the old selection only when the gesture commits, avoiding a flash if the gesture is canceled.

The Objects panel continues to operate on graph objects independently. Actions that require one selected stroke—split and assignment—are enabled only when the canvas selection contains exactly one visible stroke. Selection highlighting includes every selected stroke, while an independently selected graph object retains its existing orange highlight.

## Selection Handles and Hit Priority

A non-empty selection displays a dashed bounds rectangle around the union of the selected strokes' rendered bounds. Eight square resize handles sit at the four corners and four edge midpoints. A line above the top edge leads to a circular rotation handle. Handle and hit target sizes remain constant in screen pixels at every zoom level.

Pointer-down hit priority in select mode is:

1. Rotation handle.
2. Resize handles.
3. A selected stroke for group move.
4. Empty space for a new marquee.

Unselected strokes do not become selected through a direct centerline click. The marquee is the only way to add strokes. Clicking outside the selection without dragging clears it. Clicking or dragging a selected stroke preserves the set and starts a group move.

The transform gesture snapshots each selected stroke and the union bounds at pointer-down. Preview geometry is derived from that immutable snapshot on every move, so sampling frequency does not accumulate drift. Canceling a gesture restores the unchanged live document.

## Group Transforms

Group move applies the pointer's world-coordinate delta to every point of every selected stroke.

An edge resize anchors the opposite edge and scales point positions on one axis only. A corner resize anchors the opposite corner and uses a uniform positive scale. The uniform scale is derived from the dragged corner's dominant normalized axis change, preserving the original aspect ratio even when pointer motion is uneven. Degenerate zero-width or zero-height bounds use a stable minimum source extent for scale calculation.

Resize stops at a small positive world-size threshold and never crosses the anchor, so this milestone does not flip geometry. Stroke `width`, `id`, `createdAt`, `author`, color, point pressure, and point time remain unchanged; only point `x` and/or `y` coordinates change.

Rotation uses the selection bounds center as its fixed pivot. The angular delta is the difference between the pointer-down angle and current pointer angle. Every selected point is rotated by that delta. Rotation has no snapping modifier in this milestone because Shift is reserved for additive marquee selection.

Move, resize, and rotation each commit one user-authored `move` board event containing one before/after change for every selected stroke. Group deletion commits one user-authored `erase` event with the same batch property. Existing version-3 event validation already permits multiple changes; its move validation is extended from one to one-or-more changes. One undo or redo therefore applies the whole user gesture. Association membership remains stable because transforms preserve stroke IDs.

## Rendering

The canvas renderer receives the selection set and optional marquee or transform preview. During a transform preview, it suppresses the live copies of affected strokes and draws the preview copies once. Selected strokes receive the existing teal emphasis without obscuring their original color.

Marquee and selection bounds use distinct dash patterns from object-bound overlays. Handles use an opaque high-contrast fill and border, with larger transparent hit targets supplied by geometry rather than visible size. The rotation connector and handle render above stroke selection highlighting and below modal or panel UI. None of these overlays participate in export, autosave, temporal history, object association, or assistant context.

Canvas touch handling uses `touch-action: none` so the browser does not scroll or zoom the page instead of delivering pointer events. All drawing and handle sizes account for the viewport zoom and device pixel ratio.

## Canvas Catalog and Per-Canvas Storage

The storage layer introduces a versioned catalog under a new key and complete version-3 documents under ID-specific keys.

```ts
type CanvasCatalogV1 = {
  version: 1;
  activeCanvasId: string;
  canvases: CanvasSummary[];
};

type CanvasSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};
```

Canvas IDs are stable generated identifiers and are the source of identity. Names are trimmed, must contain at least one non-space character, and need not be unique. Catalog order is derived by descending `updatedAt`, then `createdAt`, then stable ID; writes need not keep the array sorted.

On first load with no catalog, the app checks the legacy `whiteboard-assistant.board.v1` autosave. A valid legacy document becomes a canvas named **Untitled canvas**, retaining its complete history, association history, and viewport. With no legacy autosave, the app creates the same named canvas with a blank version-3 document. The new catalog and document are written before the legacy key is left unused; later launches read only the catalog, making migration idempotent without destructively deleting the recoverable old value.

Every successful board mutation or viewport save writes only the active canvas document and updates its catalog `updatedAt`. Catalog metadata and documents are separate because `localStorage` has no transaction. Create writes the new document before adding its summary to the catalog. Delete writes the updated catalog before removing the old document key. Rename changes only catalog metadata. If any write fails, the storage API reports failure and the UI keeps its pre-operation catalog and current in-memory workspace.

Opening another canvas first cancels gestures and clears selection, historical inspection, graph selection, checked objects, panels, and assistant proposals. It then parses the target document completely before replacing the active workspace and persists the new active ID. A missing or malformed target leaves the current workspace active and reports an error; other catalog entries remain available.

## Canvases Modal

A **Canvases** toolbar button is the only automatic entry point; the modal does not appear on launch. The modal contains a heading, a new-canvas name field and action, and a list sorted by recent update. Each row shows the name, last-updated time, an active marker, and Open, Rename, and Delete controls as applicable.

Creating a canvas validates the trimmed name, creates a blank document at the default viewport, adds the catalog entry, makes it active, and closes the modal. Opening an existing canvas makes it active and closes the modal. Rename stays in the modal and preserves ID, document, and timestamps other than `updatedAt`. Delete requires native confirmation naming the canvas.

Deleting a non-active canvas leaves the current workspace untouched. Deleting the active canvas opens the most recently updated remaining canvas. Deleting the final canvas creates and opens a blank **Untitled canvas** so the app always has one active canvas. Escape and the backdrop close the modal without changing the active canvas. Focus enters at the heading or new-canvas field and returns to the Canvases button when closed.

Portable **Open** continues to validate and replace only the active canvas document; it does not create a second library entry. **Save file** exports only the active document. Both retain the current version-3 portable format, so library metadata never leaks into portable files.

## Reset Page

A **Reset page** toolbar button is enabled only at live Now. Activation shows a native confirmation that the active canvas's ink, objects, and complete undo/history log will be permanently cleared. Cancel changes nothing.

Confirmation replaces the active document with a blank version-3 document containing empty ink and association events and viewport `{ x: 0, y: 0, zoom: 1 }`. It preserves the canvas ID, name, and creation time, updates `updatedAt`, clears every transient session state listed for canvas switching, and persists once. Reset is not undoable because its contract explicitly clears history.

## Consistency and Error Handling

Document mutation remains in memory first, followed by autosave. An ordinary autosave failure leaves the edit usable and reports that it is not saved; portable export remains available. Catalog mutations use staged copies and update visible state only after their required writes succeed.

Catalog parsing validates the version, active ID, non-empty unique IDs, names, and finite timestamps. A malformed catalog does not overwrite its raw value. The app starts one recoverable in-memory blank canvas and reports that the canvas library could not be loaded. A malformed individual canvas does not replace the current board and does not prevent other entries from opening or being deleted.

Pointer cancellation, lost capture, window blur, history entry, modal opening, canvas switching, and reset cancel active edit and transform previews without committing them. Touch pointer loss rebases or ends navigation without a viewport jump. No failure path may leave stale pointer capture or a half-applied multi-stroke event.

## Verification

Automated tests must cover:

- Pen tip, eraser mask, barrel mask, conflicting masks, mouse toolbar routing, and touch routing.
- Release/next-contact behavior and suppression of edits in historical mode.
- One-finger pan, two-finger midpoint translation and zoom, finger removal rebasing, zoom clamps, and pen/touch arbitration.
- Full rendered-bounds containment, reverse-direction marquee, zero-area marquee, Shift union, normal replacement, and selection pruning after erasure.
- Handle hit priority and constant-screen-size hit regions across zoom levels.
- Group movement from an immutable snapshot.
- Horizontal and vertical edge resize, proportional corner resize, degenerate bounds, minimum size, no flipping, and unchanged stroke widths and metadata.
- Rotation around selection center and no accumulated sampling drift.
- Atomic multi-change move/delete replay, undo, redo, validation, serialization, temporal projection, and association stability.
- Legacy autosave migration, idempotent catalog startup, document isolation, sorting, create, open, rename, active and inactive delete, last-canvas replacement, and reset.
- Blank-name refusal, duplicate-name acceptance, malformed catalog/document recovery, and write failures at every staged storage operation.
- Portable open/save remaining scoped to the active canvas.

Production-browser acceptance must exercise both Metapen buttons, mouse tools, one- and two-finger navigation on the ScreenPad Plus, palm contact during a pen stroke, reverse marquee, Shift-add, group move/delete/undo, all eight resize handles, rotation, reset confirmation/cancel, every modal action, reload persistence, legacy migration, corrupt-entry recovery, keyboard focus, narrow layout, device-pixel-ratio rendering, and zero console/page errors.

# Whiteboard Assistant

A local-first browser whiteboard for fast freehand capture. Milestone 1D adds deterministic, user-approved assistant annotations over the structured canvas and temporal context established in earlier milestones. It uses native TypeScript, Canvas, DOM, and SVG, with no UI framework, model call, or server.

## Run locally

Node.js 24 is used in CI.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Other useful commands:

```sh
npm test          # run the Vitest suite once
npm run build     # type-check and create dist/
npm run preview   # serve the production build locally
```

## Controls

| Action | Control |
| --- | --- |
| Draw | Pen button or `P`, then pointer-drag; a click creates a dot |
| Select or move one stroke | Select button or `V`, then click or drag a stroke |
| Delete the selection | `Delete` or `Backspace` |
| Erase whole strokes | Eraser button or `E`, then click or drag across strokes |
| Pan | Hand button or `H`; middle-button drag; or hold `Space` while dragging |
| Zoom | Mouse wheel at the pointer, zoom −/+, or Reset |
| Undo | `Ctrl/Cmd+Z` |
| Redo | `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` |
| Portable file | **Save file** downloads JSON; **Open** validates and replaces the board |
| Inspect structure | **Objects** opens the graph inspector; `Escape` closes it |
| Inspect history | **History** opens the event timeline; Previous/Next, the range, markers, and arrow keys select an event |
| Leave history | **Return to now**, or press `Escape` once; a second `Escape` closes History |
| Preview assistant work | **Assistant suggestions** creates independent circle and arrow previews; approve, reject, hide, or regenerate each one |

The color and width controls apply to new ink. Keyboard shortcuts are ignored while an editable control has focus.

## Data and persistence

Completed edits and viewport changes autosave to this browser's `localStorage`. Autosave makes reloads convenient, but it is tied to the current browser and origin. **Save file** produces a portable, versioned JSON document for backup or transfer. If browser storage fails, the status bar says the board is not saved and file export remains available. A malformed autosave starts an empty usable board with an explanation; a malformed imported file leaves the current board unchanged.

The version-3 document stores separate append-only ink and association histories plus the viewport. Each stroke retains its stable ID, user or assistant author, creation time, color, width, world-coordinate samples, pressure, and timestamps. Add and erase events can contain a batch of strokes, so approving or deleting one assistant annotation remains a single undoable operation. Undo and redo append compensating ink events, and pan and zoom do not change ink coordinates.

Version-1 and version-2 files remain supported. On load, their user-authored ink and content objects migrate deterministically, and the next save emits version 3. Version-2 files retain their association history exactly, including intentionally unassigned strokes.

## Work objects

Every newly committed stroke is proposed for the nearest active work object. It joins an object within 24 world units regardless of time, or within 80 world units when that object received ink during the previous 12 seconds. Otherwise the app creates a new object. Equal candidates are resolved by distance, most recent activity, then stable ID, so replay remains deterministic.

The **Objects** panel shows active and superseded objects, visible and total member counts, unassigned ink, a spatial graph, lineage, and exact object details. Dashed **Bounds** overlays are optional and remain aligned while ink moves, disappears, reappears, pans, or zooms. The graph uses dashed edges for currently near active objects and solid edges from merge/split children to their historical parents.

To correct grouping, select active objects with their checkboxes and merge them, select a member stroke on the canvas and split it from a multi-stroke object, or select unassigned ink and assign it to one checked object or a new object. Merge and split preserve superseded parents and create new child IDs. These grouping corrections persist immediately and are intentionally separate from board undo/redo, which continues to affect ink edits only.

## Temporal context

The assistant-facing temporal layer is derived from the version-3 document rather than stored beside it. It dependency-merges the ink and association logs, reconstructs any event prefix, and exposes compact queries for the current context, a change range, object lineage, annotation links, or a spatial region. Current context emphasizes visible ink, active content objects, the current activity segment, and changes since a prior observation. Exact stroke geometry is opt-in. Erased geometry is returned only when a targeted region query explicitly sets `includeErased`.

The **History** dock is the human inspection surface for the same derived timeline. Position zero is the empty board; every later position is the state after one event. Events more than 30 seconds after the preceding event begin a new activity segment. The optional heatmap samples changed ink in the selected segment and decays activity with a ten-second half-life. Association corrections appear as markers but do not create spatial heat.

Historical positions are observational and read-only, including the latest event. Drawing, moving, erasing, undo/redo, grouping corrections, assistant actions, and file open/save stay disabled until **Return to now**. Historical pan and zoom use a temporary viewport, and autosave/export always read the untouched live workspace. On narrow screens, Assistant, History, and Objects use mutually exclusive overlays while retaining the selected historical position.

## Scripted assistant proof of concept

**Assistant suggestions** runs a deterministic in-browser planner against current work objects and the recent event segment. It does not inspect canvas pixels. The circle surrounds the active content bounds to benchmark drawing over relevant work. The arrow points back from the clearest nearby side to benchmark locating free space beside that work. Both are dashed violet previews that stay outside autosave, export, undo, history, hit testing, and the object graph until approved.

Circle and arrow decisions are independent. Rejecting one remembers its exact fingerprint for this browser session, so **Regenerate** advances that card without repeating it; reload or board replacement clears that memory. Approving a card creates assistant-authored geometry and a separately editable annotation object. Circles link with `annotates`; arrows link with `points-to`. The user approval and assistant provenance remain explicit in version 3 and in historical replay.

The normal eraser removes individual annotation strokes, including either arrowhead. **Delete annotation** removes every remaining visible member in one batch, and undo/redo restores or removes that batch together. An erased annotation remains in graph history with zero visible members, while its link continues to reference the original stable content object.

## Current scope

Erasing removes an entire stroke, and selection operates on one stroke at a time. Touch drawing uses pointer events, but touch pinch gestures and palm rejection are not guaranteed. This milestone does not include partial-stroke erasing, image/PDF import, OCR, learned vision or language models, generated text, rewriting user strokes, semantic labeling, a graph database, accounts, collaboration, or a server.

Follow-on work can replace the deterministic planner with visual and language models while keeping the same preview, approval, provenance, graph, and temporal contracts. Later rewrite operations may join existing content objects; assistant notes remain separately identifiable annotation objects.

# Whiteboard Assistant

A local-first browser whiteboard for fast freehand capture. Milestone 1C adds deterministic temporal context over the append-only ink and work-object histories while retaining the compact drawing, grouping, autosave, and portable-file experience. It uses native TypeScript, Canvas, DOM, and SVG, with no UI framework or server.

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

The color and width controls apply to new ink. Keyboard shortcuts are ignored while an editable control has focus.

## Data and persistence

Completed edits and viewport changes autosave to this browser's `localStorage`. Autosave makes reloads convenient, but it is tied to the current browser and origin. **Save file** produces a portable, versioned JSON document for backup or transfer. If browser storage fails, the status bar says the board is not saved and file export remains available. A malformed autosave starts an empty usable board with an explanation; a malformed imported file leaves the current board unchanged.

The version-2 document stores separate append-only ink and association histories plus the viewport. Each stroke retains its stable ID, author, creation time, color, width, world-coordinate samples, pressure, and timestamps. Undo and redo append compensating ink events, so the edit history remains available rather than being rewritten. Pan and zoom do not change ink coordinates.

Version-1 files remain supported. On load, their currently visible strokes are grouped deterministically and the next save emits version 2. Version-2 files replay their association history exactly, including intentionally unassigned strokes.

## Work objects

Every newly committed stroke is proposed for the nearest active work object. It joins an object within 24 world units regardless of time, or within 80 world units when that object received ink during the previous 12 seconds. Otherwise the app creates a new object. Equal candidates are resolved by distance, most recent activity, then stable ID, so replay remains deterministic.

The **Objects** panel shows active and superseded objects, visible and total member counts, unassigned ink, a spatial graph, lineage, and exact object details. Dashed **Bounds** overlays are optional and remain aligned while ink moves, disappears, reappears, pans, or zooms. The graph uses dashed edges for currently near active objects and solid edges from merge/split children to their historical parents.

To correct grouping, select active objects with their checkboxes and merge them, select a member stroke on the canvas and split it from a multi-stroke object, or select unassigned ink and assign it to one checked object or a new object. Merge and split preserve superseded parents and create new child IDs. These grouping corrections persist immediately and are intentionally separate from board undo/redo, which continues to affect ink edits only.

## Temporal context

The assistant-facing temporal layer is derived from the version-2 document rather than stored beside it. It dependency-merges the ink and association logs, reconstructs any event prefix, and exposes compact queries for the current context, a change range, object lineage, or a spatial region. Current context emphasizes visible ink, active objects, the current activity segment, and changes since a prior observation. Exact stroke geometry is opt-in. Erased geometry is returned only when a targeted region query explicitly sets `includeErased`.

The **History** dock is the human inspection surface for the same derived timeline. Position zero is the empty board; every later position is the state after one event. Events more than 30 seconds after the preceding event begin a new activity segment. The optional heatmap samples changed ink in the selected segment and decays activity with a ten-second half-life. Association corrections appear as markers but do not create spatial heat.

Historical positions are observational and read-only, including the latest event. Drawing, moving, erasing, undo/redo, grouping corrections, and file open/save stay disabled until **Return to now**. Historical pan and zoom use a temporary viewport, and autosave/export always read the untouched live workspace. On narrow screens, History and Objects use mutually exclusive overlays while retaining the selected historical position.

## Current scope

Erasing removes an entire stroke, and selection operates on one stroke at a time. Touch drawing uses pointer events, but touch pinch gestures and palm rejection are not guaranteed. This milestone does not include partial-stroke erasing, image/PDF import, OCR, learned vision or language models, semantic labeling, a graph database, accounts, collaboration, or a server.

Planned follow-on work will decide how an assistant chooses between compact current context and targeted history retrieval. Milestone 1D can then demonstrate scripted assistant insertion and inspection, writing only on top of the current canvas while using history as observational context. Visual-model integration follows Milestone 1; it can consume stable work objects, lineage, and temporal queries instead of interpreting an undifferentiated bitmap.

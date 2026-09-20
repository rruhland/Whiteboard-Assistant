# Whiteboard Assistant

A local-first browser whiteboard for fast freehand capture. Milestone 1B turns each committed stroke into a persistent, correctable work-object graph while retaining the compact pen, selection, eraser, pan, zoom, undo/redo, autosave, and portable-file experience. It uses native TypeScript, Canvas, DOM, and SVG, with no UI framework or server.

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

The color and width controls apply to new ink. Keyboard shortcuts are ignored while an editable control has focus.

## Data and persistence

Completed edits and viewport changes autosave to this browser's `localStorage`. Autosave makes reloads convenient, but it is tied to the current browser and origin. **Save file** produces a portable, versioned JSON document for backup or transfer. If browser storage fails, the status bar says the board is not saved and file export remains available. A malformed autosave starts an empty usable board with an explanation; a malformed imported file leaves the current board unchanged.

The version-2 document stores separate append-only ink and association histories plus the viewport. Each stroke retains its stable ID, author, creation time, color, width, world-coordinate samples, pressure, and timestamps. Undo and redo append compensating ink events, so the edit history remains available rather than being rewritten. Pan and zoom do not change ink coordinates.

Version-1 files remain supported. On load, their currently visible strokes are grouped deterministically and the next save emits version 2. Version-2 files replay their association history exactly, including intentionally unassigned strokes.

## Work objects

Every newly committed stroke is proposed for the nearest active work object. It joins an object within 24 world units regardless of time, or within 80 world units when that object received ink during the previous 12 seconds. Otherwise the app creates a new object. Equal candidates are resolved by distance, most recent activity, then stable ID, so replay remains deterministic.

The **Objects** panel shows active and superseded objects, visible and total member counts, unassigned ink, a spatial graph, lineage, and exact object details. Dashed **Bounds** overlays are optional and remain aligned while ink moves, disappears, reappears, pans, or zooms. The graph uses dashed edges for currently near active objects and solid edges from merge/split children to their historical parents.

To correct grouping, select active objects with their checkboxes and merge them, select a member stroke on the canvas and split it from a multi-stroke object, or select unassigned ink and assign it to one checked object or a new object. Merge and split preserve superseded parents and create new child IDs. These grouping corrections persist immediately and are intentionally separate from board undo/redo, which continues to affect ink edits only.

## Current scope

Erasing removes an entire stroke, and selection operates on one stroke at a time. Touch drawing uses pointer events, but touch pinch gestures and palm rejection are not guaranteed. This milestone does not include partial-stroke erasing, image/PDF import, OCR, learned vision or language models, semantic labeling, a graph database, accounts, collaboration, or a server.

Planned follow-on milestones build on the retained spatial and temporal data: 1C adds timeline/activity views, and 1D demonstrates scripted assistant insertion and inspection. Visual-model integration follows Milestone 1; it can consume stable work objects and lineage instead of interpreting an undifferentiated bitmap.

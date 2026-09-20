# Whiteboard Assistant

A local-first browser whiteboard for fast freehand capture. Milestone 1A provides a compact canvas with pen, selection and movement, whole-stroke erasing, pan and zoom, undo/redo, autosave, and portable JSON files. It uses native TypeScript and the Canvas API, with no UI framework or server.

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

The color and width controls apply to new ink. Keyboard shortcuts are ignored while an editable control has focus.

## Data and persistence

Completed edits and viewport changes autosave to this browser's `localStorage`. Autosave makes reloads convenient, but it is tied to the current browser and origin. **Save file** produces a portable, versioned JSON document for backup or transfer. If browser storage fails, the status bar says the board is not saved and file export remains available. A malformed autosave starts an empty usable board with an explanation; a malformed imported file leaves the current board unchanged.

The document stores an ordered event history and viewport. Each stroke retains its stable ID, author, creation time, color, width, world-coordinate samples, pressure, and timestamps. Undo and redo append compensating events, so the edit history remains available rather than being rewritten. Pan and zoom do not change ink coordinates.

## Current scope

Erasing removes an entire stroke, and selection operates on one stroke at a time. Touch drawing uses pointer events, but touch pinch gestures and palm rejection are not guaranteed. This milestone does not include partial-stroke erasing, image/PDF import, OCR, graph or model features, accounts, collaboration, or a server.

Planned follow-on milestones build on the retained spatial and temporal data: 1B adds derived grouping and graph inspection, 1C adds timeline/activity views, and 1D demonstrates scripted assistant insertion and inspection. Visual model integration follows Milestone 1. Those features are intentionally absent from 1A.

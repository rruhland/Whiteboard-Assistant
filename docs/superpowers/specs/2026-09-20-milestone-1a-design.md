# Milestone 1A — Capture

## Approved intent
Build the first usable local whiteboard foundation for a future spatial/temporal graph and AI collaborator. User approved the milestone discussion and explicitly requested implementation, smaller-model delegation, and connection to https://github.com/rruhland/Whiteboard-Assistant. This document records that scope; milestones 1B–1D are not part of this implementation.

## Product
A desktop-first browser app with an unrestricted canvas, mouse/pen freehand input, pen color and width, pan and anchored zoom, single-stroke selection/movement, whole-stroke eraser, undo/redo, local autosave, and JSON download/open. Drawing must remain responsive. A small status area reports stroke/event counts, zoom, and save/error status. The empty board gives brief control instructions. Controls have accessible names and keyboard focus states. Use an understated light canvas and a compact toolbar, with ample drawing space and no graph/model UI.

## Representation
Store stroke samples in canvas/world coordinates, separate from the viewport transform. Each stroke has a stable UUID, timestamp, author, color, width, and samples (x, y, pressure, timestamp). Preserve pressure for future work; constant-width rendering is sufficient now. A tap is a valid dot. Movement preserves identity. Coordinates may be negative. Erasing removes an entire hit stroke.

Record completed edits as ordered, timestamped events with before/after stroke changes. Undo and redo append compensating events rather than destroying history. Replaying events reconstructs current strokes. Navigation changes the viewport only and does not create ink edits. Keep a versioned JSON document with events and viewport; reconstruct current strokes on load. Preserve IDs, samples, authors, event order and viewport across serialization. Validate imports before replacing the open board. A failed import leaves current work intact. Autosave failures are visible and JSON export remains usable.

## Architecture and choices
Use TypeScript, native canvas/Pointer Events, Vite, and Vitest. No UI framework, server, database, accounts, graph database, OCR or model calls. Separate a pure document/geometry layer from browser rendering and input. Use pointer capture, handle cancellation and high-DPI display, and avoid changing the viewport during an active edit gesture. Commit an edit at gesture end. Single active pointer is sufficient; touch pinch and palm rejection are not promised. Keep the browser tab local; no deployment is requested.

Use a feature branch in this otherwise empty checkout; there is no existing work to isolate or overwrite. Bootstrap main with planning documents, then publish implementation on a feature branch and open a reviewable pull request if credentials allow.

## Acceptance
1. Draw a line and a dot, select/move and erase strokes, undo/redo edits.
2. Pan/zoom and draw again: stored world coordinates remain correct; old ink is unchanged by navigation.
3. Download/open and reload autosave: IDs, geometry and edit history are retained.
4. Reject malformed files without damaging the current board; show persistence errors honestly.
5. Unit tests cover replay, undo branching, roundtrip validation, hit tests, and coordinate/zoom transforms. Browser smoke checks cover the actual controls, pointer gestures, reload and import/export.
6. Type checking and production build pass. Document startup, controls, storage and scope.

## Deferred
Dynamic grouping, graph inspection, timeline UI, occupancy/activity maps, references/PDF import, model semantics, assistant insertion, collaboration, partial-stroke erasing and sophisticated pen smoothing.

# Milestone 1A Task 1 — Document and geometry core

Implemented the Vite/TypeScript/Vitest project shell and pure capture core. `BoardModel` records add, move, erase, undo, and redo as an append-only event log; replay validates every transition and reconstructs current strokes plus undo/redo availability. Stroke IDs, point samples, authors, and event order survive serialization. Model getters and document serialization clone data so caller mutations cannot alter stored history. Invalid versions, nonfinite values, duplicate live stroke IDs, malformed changes, and impossible undo/redo references are rejected before use.

`geometry.ts` provides world/screen transforms, anchored zoom clamped to 0.1–4, segment/dot hit testing, and topmost-first selection. Coordinates support negative offsets and zoom without changing stored world samples.

Verification:

- `npm test` — 10 tests passed.
- `npm run typecheck` — passed.
- `npm audit --audit-level=moderate` — 0 vulnerabilities.
- `npm run build` — TypeScript passed, then Vite stopped because Task 2 has not added the required `index.html` entry yet.

Concern: the production build is intentionally incomplete until the canvas UI task adds `index.html`; no UI files were added in this task.

# Milestone 1B verification

Verified on 2026-09-20 against the production Vite preview on Windows with Chromium.

## Automated gates

- `npm test`: 8 test files, 46 tests passed.
- `npm run build`: TypeScript checking and the Vite production build passed.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- `git diff --check`: no whitespace errors.

The tests cover version discrimination, event-log preservation, defensive parsing, deterministic association thresholds and tie-breaking, atomic merge/split behavior, invalid history rejection, migration IDs, graph projection, workspace failure containment, undo/redo membership stability, and panel view-model/layout rules.

## Production browser acceptance

Playwright CLI drove `npm run preview -- --port 4173` in an isolated Chromium session. Artifacts are ignored under `output/playwright/`; the inspected desktop capture is `output/playwright/milestone-1b-desktop.png`.

1. Drew two nearby strokes, one remote stroke, then returned to the first cluster. The inspector reported two active objects with memberships `3/3` and `1/1`, demonstrating the close-distance rule after activity elsewhere.
2. Kept bounds visible while moving ink, erasing and undoing the erase, panning, and zooming to 135%. The ink log ended with `move`, `erase`, and compensating `undo`; four strokes were visible, association history stayed at six events, and viewport coordinates persisted.
3. Checked two active objects and merged them. Both parents became superseded and one active child retained all four strokes. Selecting a canvas stroke then splitting produced two active children with `1/1` and `3/3` visible membership and child-to-parent lineage.
4. Reloaded after merge, split, undo, and redo. The serialized local document was byte-for-byte equal before and after reload. It remained version 2 with six ink events and six association events; the final association event was `manual-split`.
5. Opened a syntactically valid version-2 file whose association history referenced an unknown stroke. The current local document remained byte-for-byte unchanged and the status reported the validation failure.
6. Temporarily loaded a version-1 document. Startup emitted version 2 with deterministic `work-v1-<stroke-id>` and `assoc-v1-<stroke-id>` identifiers and preserved the `{-12, 8, 1.5}` viewport.
7. At a 500×700 viewport, the inspector rendered as a 360px overlay with a visible backdrop while the canvas retained its 500px width. `Escape` closed the panel and returned focus to the Objects button.
8. A separate `Desktop Chrome HiDPI` session reported device pixel ratio 2. The 1280×631 CSS canvas used a 2560×1262 bitmap. Both sessions reported zero console errors and zero warnings.

## Independent review corrections

The whole-branch reviewer reported no Critical findings and three Important findings. The final pass now validates the allowed transition shape for every association event kind, compares replay snapshots structurally so JSON key order is irrelevant, and keeps **New object** available for unassigned ink independently of checked targets. Regression tests cover all three corrections.

## Limits of this pass

This pass did not include physical stylus hardware, palm rejection, touch pinch gestures, Firefox, WebKit, or long-running storage endurance. Those remain appropriate cross-device checks before treating the canvas input layer as production-ready.

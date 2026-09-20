# Milestone 1A verification

Verified locally on Windows with Node.js 24 and Chromium. The project targets desktop mouse/pen input. Physical stylus hardware and cross-browser compatibility have not been tested.

## Automated checks

- `npm test`: 27 passing tests for document lifecycle/replay, undo branching, restored stacking order, JSON validation/roundtrip, world/screen transforms, point and swept-path hit testing, gesture ownership and commits, keyboard input ownership, and autosave/import failure behavior.
- `npm run build`: strict TypeScript check and Vite production bundle.
- `npm audit --audit-level=moderate`: no reported vulnerabilities at verification time.
- GitHub Actions runs `npm ci`, `npm test`, and `npm run build` with Node.js 24.

## Browser checks

Real mouse events were used for the main flow. Portable JSON was downloaded and reopened through the file input; assertions compared IDs, points, full event logs and viewport values.

- Draw a line and a dot; verify distinct stroke IDs and canvas coordinates.
- Pan and cursor-anchored zoom leave stored ink/history unchanged.
- Drawing after navigation uses the inverse viewport transform.
- Select and move preserves stroke ID and translates geometry correctly.
- Delete, undo and redo append edit events. New ink after undo disables redo.
- Canceling an active stroke does not add an event.
- Save/open and autosave reload preserve the complete document.
- Invalid import reports an error and retains the open board.
- Returning from the width slider to drawing restores keyboard undo.
- A 2x device-pixel-ratio context uses correct canvas backing dimensions and world coordinates.
- Resizing to a 500px-wide viewport retains usable controls and unchanged ink.
- Pointer capture completes a stroke released outside the canvas.
- Space-drag pans without ink edits; the eraser removes hit strokes.
- A simulated storage quota failure stays visible after import. The imported board remains usable and file export succeeds.
- The production build loads, draws and autosaves without console errors.
- Fast eraser movement crossing ink between pointer samples removes the crossed stroke.
- Continued erasing reaches strokes revealed beneath overlapping erased previews.
- An unrelated pointer cancellation does not discard the active stroke (synthetic event test).
- Space activates focused toolbar buttons while retaining canvas Space-drag panning.

## Review corrections

Independent core review found that undoing an erase could change overlapping strokes' drawing order. Stable internal draw-order ranks and a regression test now preserve order both live and after reload.

Browser checks found a false success message after importing with unavailable storage, and a focus bug that suppressed keyboard undo after using the width slider. Both were reproduced and corrected before final review.

Whole-branch review reproduced four further input issues: sparse eraser samples missing crossed ink, pending erasures shielding overlapping ink, cancellation from an unrelated pointer, and Space overriding native button activation. A single correction batch addressed all four, with unit regressions and a successful rerun of the exact browser reproductions on the production build.

## Scope limits

Whole-stroke erasing and single-stroke selection are intentional. Local autosave belongs to this browser/origin and is subject to browser storage limits; use portable JSON for backups. Partial erasing, touch pinch/palm rejection, graph grouping, timeline UI and models remain future work.

# Task 2 report — Canvas application

## Implementation

- Added the native TypeScript canvas application with a responsive toolbar, light world-aligned grid, compact footer, empty-board hint, focus states, accessible labels, shortcut tooltips, and pressed/disabled control states.
- Added pointer-driven pen, one-stroke selection/movement, whole-stroke drag erasing, hand/middle-button/Space panning, pointer-anchored wheel zoom, zoom controls, and reset view.
- Kept ink, move, erase, and pan gestures in preview state until pointer-up. Only one captured pointer is accepted; pointer cancel, lost capture, and window blur discard previews without touching the board model.
- Added undo/redo buttons and keyboard shortcuts, selection deletion, JSON download/open, validated replacement, initial autosave restore, viewport persistence, and honest storage/import error status.
- Added high-DPI canvas sizing and rendering while preserving all samples in world coordinates.
- Added README usage, controls, persistence model, limitations, and future milestone notes, plus Node 24 CI for install/test/build.

## Test-first evidence

The first focused run failed before implementation because `src/gesture.ts` and `src/storage.ts` did not exist:

```text
npm test -- --run tests/gesture.test.ts tests/storage.test.ts
Test Files  2 failed (2)
Error: Cannot find module '../src/gesture'
Error: Cannot find module '../src/storage'
```

After the minimal pure gesture and persistence modules were implemented:

```text
npm test -- --run tests/gesture.test.ts tests/storage.test.ts
Test Files  2 passed (2)
Tests      10 passed (10)
```

Covered behavior includes single active pointer ownership, dot commits, pointer-specific completion, preview-only movement deltas, de-duplicated drag erasing, drift-free pan previews, autosave round trips with viewport, visible storage failure, corrupt autosave handling, failed-import retention, and valid portable replacement.

A browser review found that a valid import could overwrite a failed autosave message. A regression was added first and failed with `TypeError: openPortableBoard is not a function`; the import-and-autosave boundary was then implemented and the focused storage suite passed 6/6. The open handler now replaces the document while preserving an honest `Not saved` status when storage fails.

## Verification

Fresh final commands after all code changes:

```text
npm test
Test Files  3 passed (3)
Tests      22 passed (22)

npm run build
tsc --noEmit && vite build
10 modules transformed
dist/index.html                  4.23 kB
dist/assets/index-BVP3DNBm.css   4.05 kB
dist/assets/index-DhT3K7iC.js   19.17 kB
exit 0

git diff --check
exit 0
```

Browser smoke on the live Vite app covered drawing, dots, pan/zoom world-coordinate mapping, select/move/delete, undo branching, canceled ink, export/open/reload, and invalid-import retention. Those checks passed. A separate focus check first reproduced ignored undo after using the width slider; accepted pointer gestures now focus the canvas before capture, and the same browser check passed on rerun.

The browser reliability pass also covered 2× DPR backing resolution and world coordinates, a 500 px-wide toolbar, resize with retained ink, captured pointer-up outside the canvas, Space-pan without ink edits, drag erasing, and a simulated quota failure during import. The imported board remained open, the visible status stayed `Not saved`, export still worked, and the page produced no runtime errors.

## Known limits

The documented Milestone 1A scope remains: erasing is whole-stroke, selection is one stroke, touch pinch and palm rejection are not guaranteed, and graph/model/import features beyond board JSON are deferred.

# Milestone 1E verification

## Automated gate

- `npm test`: 20 files, 159 tests passed.
- `npm run build`: TypeScript checking and Vite production bundling passed.
- `git diff --check`: no whitespace errors.

## Browser evidence

The acceptance pass ran in an isolated Playwright Chromium session against the Vite development server.

- The canvas library remained closed on launch and opened only from **Canvases**.
- Creating, opening, renaming, and deleting canvases worked; deleting the final canvas created a fresh **Untitled canvas**.
- Two canvases retained independent ink and history while switching between them.
- A marquee selected multiple dots only when their complete rendered bounds were inside the box.
- Deleting the selected group created one edit, and one undo restored the complete group.
- Cancelling **Reset page** preserved the active board; confirming it cleared ink and history.
- No page or console errors or warnings were recorded.

At a 500 by 800 pixel viewport, the document and canvas-library dialog had no horizontal overflow. Escape closed the dialog and returned focus to the **Canvases** button.

A correction pass also confirmed that Delete cannot reach selected board ink while the canvas-library modal is open, Tab and Shift+Tab remain within the dialog, and its heading receives initial focus.

## Automated behavior coverage

Unit tests cover pen-button routing and release back to drawing, touch-only navigation arbitration, one-finger pan, two-finger pinch and pinch rebasing, exact marquee containment, additive Shift selection, grouped move/resize/rotation geometry, unchanged stroke widths, atomic group history, catalog migration, independent canvas documents, staged catalog updates, deletion replacement, and malformed-storage recovery. Portable open/save is covered at the document and storage boundary; the browser download and file-picker UI were not automated.

## Physical hardware checklist

The following checks require the target Metapen M1 and Zenbook Pro Duo ScreenPad Plus and remain for a physical-device pass:

- Pen tip draws without pressing a side button.
- Holding the lower side button erases, and releasing it immediately restores drawing.
- Holding the upper side button selects, and releasing it immediately restores drawing.
- One finger pans and two fingers pinch-zoom without creating ink.
- A resting palm does not move the viewport while the pen is actively editing.
- Removing one finger during a pinch continues as a one-finger pan without a viewport jump.

## Scope note

This milestone intentionally stores named canvases in versioned `localStorage`. IndexedDB remains a later migration if real board size or browser quota makes it necessary.

## Whole-branch review

A fresh-context review reproduced two catalog-preservation bugs and four input/interaction bugs. The correction pass now preserves healthy catalog entries when one document is malformed, rejects saves over an unreadable catalog, merges mutations against the latest same-origin catalog, ends pen gestures when the tip lifts even if a barrel button remains held, resolves overlapping handles by proximity, contains modal keyboard input and focus, and abandons historical touch navigation before returning to the live board. Each correction has regression coverage; the full suite and build pass after the fixes.

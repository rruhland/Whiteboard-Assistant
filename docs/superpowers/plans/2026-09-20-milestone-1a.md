# Milestone 1A Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The user selected orchestrated execution with smaller models. Proceed through implementation and review without additional permission gates.

**Goal:** Deliver a usable whiteboard with persistent stroke identity, world coordinates, and recorded edits.

**Architecture:** A pure TypeScript document and geometry core feeds a native canvas UI. JSON is the portable source of truth; browser localStorage is the convenient local autosave.

**Tech Stack:** TypeScript, Vite, Vitest, browser Canvas and Pointer Events.

**Spec:** docs/superpowers/specs/2026-09-20-milestone-1a-design.md

## Global Constraints
- Implement milestone 1A only. No graph, AI, backend, reference import, or deployment.
- Preserve stroke IDs and world geometry across navigation, edits, undo/redo and saves.
- Record undo/redo as events. Validate external JSON before replacing current work.
- Desktop mouse/pen is the target. Whole-stroke erase and single-stroke selection.
- Keep code small, typed and separated by responsibility; avoid speculative abstractions.

## Review Focus
- A dot and an offset/zoomed stroke both remain selectable and serializable.
- Undo followed by a new edit clears redo without deleting recorded events.
- Corrupt JSON and unavailable storage leave current work usable with an honest status.
- Pointer cancellation, leaving the canvas, or toolbar actions during a drag cannot create phantom edits.
- Browser resizing and display pixel ratio cannot move world coordinates.

## Task 1 — Document and geometry core
- [ ] Read the spec, configure TypeScript/Vite/Vitest and write failing behavior tests.
- [ ] Implement src/board.ts with Point, Stroke, Viewport, BoardDocument, BoardModel, serializeBoard and parseBoard.
- [ ] Implement src/geometry.ts with screenToWorld, worldToScreen, zoomAt and hitTestStroke.
- [ ] Verify core tests, typecheck, and commit; write implementation report.
- [ ] Independent task review and any fixes.

### Core interface
```ts
type Point = { x: number; y: number; pressure: number; time: number };
type Viewport = { x: number; y: number; zoom: number };
type Stroke = { id: string; createdAt: number; author: 'user'; color: string; width: number; points: Point[] };
// BoardDocument: version:1, events:BoardEvent[], viewport:Viewport.
// BoardEvent: id, time, actor:'user', kind, changes:{before:Stroke|null,after:Stroke|null}[], optional targetId.
class BoardModel {
  constructor(document?: BoardDocument);
  readonly strokes: Stroke[];
  readonly events: BoardEvent[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  addStroke(points: Point[], color: string, width: number): void;
  moveStroke(id: string, dx: number, dy: number): void;
  eraseStroke(id: string): void;
  undo(): void;
  redo(): void;
  toDocument(viewport: Viewport): BoardDocument;
}
// serializeBoard(document:BoardDocument):string
// parseBoard(json:string):BoardDocument (throws descriptive error)
// screenToWorld(point:{x:number,y:number}, viewport:Viewport):{x:number,y:number}
// worldToScreen(point:{x:number,y:number}, viewport:Viewport):{x:number,y:number}
// zoomAt(viewport:Viewport, screen:{x:number,y:number}, factor:number):Viewport; clamp 0.1..4
// hitTestStroke(strokes:Stroke[], world:{x:number,y:number}, tolerance:number):Stroke|undefined; topmost first
```

Test examples: add then move preserves ID; erase then undo restores original geometry; undo/add disables redo but retains old events; serialize/parse roundtrip; unsupported version/nonfinite geometry/duplicate IDs/invalid event references rejected; transforms invert at negative offsets; zoom holds cursor world point fixed; hit-testing segments and dots respects width/tolerance.

## Task 2 — Canvas application
- [ ] Read core API and write failing tests for gesture/storage logic where behavior is nontrivial.
- [ ] Implement index.html, src/main.ts, src/canvas.ts, src/style.css and small storage/gesture modules as needed.
- [ ] Render on requestAnimationFrame, respecting devicePixelRatio; keep preview edits outside document until pointerup.
- [ ] Connect accessible Pen/Select/Eraser/Hand, color/width, undo/redo, zoom/reset view, Save file/Open file controls.
- [ ] Implement one active pointer with capture, cancellation, space/middle-button pan, wheel zoom, click/drag selection, and keyboard undo/redo/delete.
- [ ] Use validated local autosave and file import/export. Ignore shortcuts while editing native input controls. Show errors; never erase current work after a failed import.
- [ ] Write README, add GitHub Actions npm ci/test/build, verify full test suite and build, commit and report.
- [ ] Independent task review and browser smoke verification, then fixes if required.

Browser verification: draw a line and dot, pan, zoom, draw under new transform, move/erase, undo/redo, export and inspect JSON, reopen/reload, import malformed data, exercise pointer cancellation and a resized viewport. Save screenshots under ignored output/playwright.

## Delivery
- [ ] Whole-branch review for correctness and milestone scope.
- [ ] Final npm test and npm run build on final code, with browser checks covering any changed paths.
- [ ] Push feature branch, open and attach PR, confirm git status and remote refs.
- [ ] Show the app locally and report delivered behavior, verification and limitations.

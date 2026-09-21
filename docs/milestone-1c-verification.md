# Milestone 1C verification

Verified on 2026-09-20 against `feat/milestone-1c`.

## Automated checks

- `npm test`: 13 files and 70 tests passed before final review.
- `npm run build`: TypeScript validation and the Vite production build passed.
- `npm audit --audit-level=moderate`: no moderate-or-higher vulnerabilities.
- `git diff --check`: no whitespace errors.

The tests cover dependency-aware temporal ordering, equal and regressing timestamps, the exact 30-second segmentation boundary, immutable prefix projection, compact and geometry query modes, erased-geometry opt-in, object lineage, defensive query results, 16-unit activity sampling, ten-second decay, association-only segments, history-session isolation, timeline controls, and read-only object corrections.

## Production-browser acceptance

Playwright CLI exercised the production preview in an isolated session with deterministic histories. Evidence is saved under the ignored `output/playwright/` directory.

1. A nine-entry history containing two adds, two automatic object creations, merge, split, erase, undo, and redo produced stroke counts `1, 1, 2, 2, 2, 2, 1, 2, 1` at the matching event positions. The Objects panel showed the corresponding parent, merge-child, and split-child lineage.
2. The serialized autosave was byte-for-byte identical after opening History, scrubbing every event, changing historical zoom from 150% to 180%, and returning to now. The live viewport returned to 150%.
3. Erased ink was present before erase, absent after erase, restored at undo, and absent again at redo/current state.
4. The activity heatmap rendered behind ink in world coordinates. Unit coverage pins the greater-than-30-second segment boundary and the browser visual check confirms alignment with the selected historical projection.
5. Pen, selection, eraser, ink controls, undo/redo, Open, Save file, and all grouping corrections were disabled at historical positions, including the latest event. Correction controls displayed `Return to now to correct grouping` and editing returned at now.
6. Timeline marker order remained identical across reload. A version-1 board migrated to version 2 and produced the same ink and association markers before and after another reload.
7. An empty board showed no markers and disabled Previous. Two-stage Escape returned to now and then closed History with focus on the History button. At 500px, opening Objects closed the History overlay. Canvas backing dimensions matched CSS dimensions multiplied by the active device-pixel ratio.
8. The browser reported zero console errors or warnings.

The acceptance environment used desktop Chromium and responsive viewport emulation. Physical touch hardware, palm rejection, browser-specific rendering outside Chromium, and a physical 2x monitor were not available; device-pixel-ratio sizing is implemented and was verified against the active emulated ratio.

# Milestone 1D verification

## Automated gate

- `npm test`: 17 files, 121 tests passed.
- `npm run build`: TypeScript checking and Vite production bundling passed.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- `git diff --check`: no whitespace errors.

## Production-browser evidence

The acceptance pass ran against `npm run preview` in an isolated Playwright Chromium session. Evidence is stored in the ignored `output/playwright/` directory.

- Empty board: both cards reported **Draw something first** and exposed no approval action.
- New work after an empty generation: reopening Assistant regenerated against the new content. A regression test now protects this transition.
- Preview isolation: toggling the circle preview left the exact serialized autosave string unchanged.
- Independent decisions: rejecting the circle enabled only its regeneration; approving the arrow appended three strokes and retained the circle card.
- Provenance and graph: the Objects panel showed an **Assistant annotation** badge, three members, and a `points-to` link to the stable content object.
- Editing: an eraser gesture removed annotation members; undo produced a partially visible annotation, whole-annotation deletion removed the remaining member, and undo/redo restored and removed that batch.
- History: the assistant batch and annotation creation appeared as separate ordered events; selecting annotation creation reconstructed all three members and disabled drawing, approval, grouping corrections, deletion, open, and save.
- Stale protection: zoom preserved proposed cards; a new ink event marked both cards stale and disabled approval.
- Migration/reload: a fixed version-2 file without `objectType` loaded as one content object, autosaved as version 3, and replayed after reload with the same stroke and event count.
- Persistence failure: forcing `Storage.setItem` to throw left an approved circle in memory, reported **Not saved: forced failure**, and kept **Save file** enabled.
- Responsive/accessibility: at 500 px, Assistant, Objects, and History excluded one another; all assistant actions remained reachable in a scrolling bottom sheet. Escape returned focus to `#assistant-toggle`. No page or console errors were recorded.
- HiDPI: the Desktop Chrome HiDPI profile reported DPR 2, a 1280 CSS-pixel canvas, and a 2560-pixel backing canvas.

Screenshots:

- `output/playwright/proposals.png`
- `output/playwright/approved-annotation.png`
- `output/playwright/mobile-assistant.png`

## Determinism and migration checks

Unit coverage verifies strict version-1/version-2 ink validation, deterministic migration to version 3, exact version-3 round trips, annotation dependency ordering, lifecycle replay, erased-geometry exclusion, and opt-in annotation-link traversal. Planner coverage includes regressing timestamps, degenerate bounds, stable fingerprints, collision ties, blocked placement, crowded placement, rejection suppression, and candidate exhaustion.

## Limits of this verification

The production acceptance pass used Chromium on Windows plus Chromium's DPR-2 profile. Firefox, WebKit, physical touch hardware, palm rejection, and multi-user behavior were not exercised. The milestone intentionally uses deterministic structured context; it does not test a learned visual or language model, generated text, or rewrite operations on user strokes.

## Whole-branch review

Pending final fresh-context review against the milestone specification and implementation plan.

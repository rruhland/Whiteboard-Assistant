# Milestone 1D Scripted Assistant Insertions Design

## Purpose

Milestone 1D proves that an assistant can inspect the structured current and historical context established in Milestones 1A–1C, generate useful spatial work, show it without mutating the board, and append it to the live canvas only after explicit user approval.

The proof uses a deterministic in-browser script rather than a learned model. It generates two independent suggestions: a circle around the active work area and an arrow placed beside recent work that points back to it. The circle benchmarks drawing over relevant current work. The arrow benchmarks finding clear space outside that work while preserving an explicit graph relationship to its target.

The assistant never writes into a historical projection. It does not rewrite or edit user strokes in this milestone. Approved assistant notes are first-class annotation objects linked to content objects; later rewrite operations may target existing content objects directly.

## Success Criteria

- The user explicitly invokes proposal generation with an **Assistant suggestions** button.
- The script selects a current content object from recent structured context without reading pixels.
- Circle and arrow proposals appear as non-persistent previews and can be approved, rejected, hidden, or regenerated independently.
- Preview and rejection never change autosave, undo/redo, temporal history, or the graph.
- Approval appends assistant-authored strokes and one linked annotation object as a single undoable action.
- Rejected proposal fingerprints suppress identical suggestions for the remainder of the browser session.
- The eraser can remove individual annotation strokes, while **Delete annotation** removes every remaining visible member as one undoable action.
- Historical inspection reconstructs approval, partial erasure, full deletion, and undo without allowing writes.
- Versions 1 and 2 migrate deterministically to version 3, and portable version-3 files replay exactly.

## Scope

### Included

- Version-3 document schema and deterministic version-1/version-2 migration.
- Explicit user/assistant stroke provenance.
- Batch add and erase events with matching undo/redo behavior.
- Content and assistant-annotation object variants in the graph.
- Typed `annotates` and `points-to` edges.
- Pure context selection, circle geometry, arrow placement, collision scoring, and proposal fingerprinting.
- Session-scoped rejection memory and explicit regeneration.
- Preview rendering, proposal controls, annotation inspection, and whole-annotation deletion.
- Temporal indexing and query compatibility with approved annotations.

### Deferred

- Learned model, visual model, OCR, language-model, or network calls.
- Natural-language note or text objects.
- Rewriting, moving, or otherwise editing user strokes.
- Automatic proposal generation or autonomous approval.
- Persistent rejection learning across reloads.
- Semantic inference beyond existing graph structure and deterministic geometry.
- Collaboration, accounts, server persistence, branching, or historical restoration.
- General-purpose plugin or untrusted script execution.

## Document Version 3

Version 3 retains the append-only `events`, `associationEvents`, and `viewport` fields. It extends their value types rather than adding a competing sidecar history.

```ts
export type StrokeAuthor = 'user' | 'assistant';

export type Stroke = {
  id: string;
  createdAt: number;
  author: StrokeAuthor;
  color: string;
  width: number;
  points: Point[];
};

export type BoardActor = 'user' | 'assistant';

export type BoardEvent = {
  id: string;
  time: number;
  actor: BoardActor;
  kind: 'add' | 'move' | 'erase' | 'undo' | 'redo';
  changes: StrokeChange[];
  targetId?: string;
};

export type BoardDocumentV3 = {
  version: 3;
  events: BoardEvent[];
  associationEvents: AssociationEvent[];
  viewport: Viewport;
};
```

Version-3 `add` and `erase` events may contain one or more changes. Every `add` change must have `before: null` and a non-null `after`; every `erase` change must have a non-null `before` and `after: null`. `move` remains a single-stroke user operation. Undo and redo compensate or repeat every change in their target event, so an approved annotation or whole-annotation deletion is one undoable operation. Version-1 and version-2 parsers retain their legacy single-change validation.

An assistant approval creates a batch `add` event with `actor: 'assistant'`. A whole-annotation deletion creates a batch `erase` event with `actor: 'user'`. Ordinary eraser gestures continue to append one erase event per affected stroke, preserving stroke-by-stroke editing.

Version-1 and version-2 migration preserves IDs, timestamps, event order, geometry, and association history. Existing strokes and events become user-authored. Existing work objects become content objects. The next autosave or export emits version 3.

## Graph Object Model

The graph holds a discriminated union of content and annotation objects. Common identity, membership, time, status, and lineage fields remain compatible with current work objects.

```ts
type GraphLink = {
  type: 'annotates' | 'points-to';
  targetObjectId: string;
};

type ContentObject = WorkObjectBase & {
  objectType: 'content';
};

type AnnotationObject = WorkObjectBase & {
  objectType: 'annotation';
  annotationKind: 'circle' | 'arrow';
  links: GraphLink[];
  proposalId: string;
  contextPosition: number;
  createdBy: 'assistant';
  approvedAt: number;
};

type WorkObject = ContentObject | AnnotationObject;
```

Approval appends an `assistant-annotation` association event whose actor is `user`: the assistant authored the geometry, while the user authorized its insertion. Circle annotations use an `annotates` edge. Arrow annotations use a `points-to` edge. The association event is dependency-held in the temporal merge until every member stroke has appeared in the ink prefix.

Annotation objects do not join content-object association heuristics. New user ink is never automatically appended to them, and planner target selection filters them out. Current annotation visibility is derived from visible member strokes. An annotation with zero visible members remains in historical graph data and is presented as erased in current inspection. Undoing its deletion restores visibility without requiring a second lifecycle log.

Graph projection adds typed annotation edges alongside the existing `near` and `derived-from` edges. Annotation edges never participate in content lineage traversal unless a query explicitly asks for annotation links.

## Proposal Contract

Proposals are session data and are never serialized.

```ts
type ProposalKind = 'active-area-circle' | 'recent-work-arrow';
type ProposalState = 'proposed' | 'approved' | 'rejected' | 'unavailable' | 'stale';

type AssistantProposal = {
  id: string;
  generationId: string;
  fingerprint: string;
  kind: ProposalKind;
  state: ProposalState;
  targetObjectId: string;
  relation: 'annotates' | 'points-to';
  contextPosition: number;
  revision: { inkEventCount: number; associationEventCount: number };
  candidateIndex: number;
  explanation: string;
  strokes: Stroke[];
  visible: boolean;
};
```

Proposal strokes use assistant provenance and stable IDs derived from the proposal ID and member index. A canonical fingerprint covers proposal kind, target ID, context position, candidate index, and generated geometry. Fingerprinting is deterministic and contains no random or wall-clock component.

The session owns independent circle and arrow slots plus a set of rejected fingerprints. Rejecting a proposal removes its preview and adds its fingerprint to the set. **Regenerate** advances only that slot through deterministic unused candidates. It never runs automatically. When no unused candidate remains, the slot becomes unavailable with an explanatory message. Reloading or replacing the board clears proposals and rejection memory.

## Context and Target Selection

Generation is allowed only at live Now. It calls the 1C current-context and change-query APIs against the live version-3 document.

Target selection is deterministic:

1. Inspect visible user-authored strokes changed in the current 30-second activity segment.
2. Choose the active content object that owns the most recently changed eligible stroke.
3. Resolve ties by later `lastAssociatedAt`, then stable object ID.
4. If no current-segment stroke maps to an active content object, choose the visible active content object with the latest `lastAssociatedAt`, then stable ID.
5. If no visible active content object exists, return two unavailable slots with “Draw something first.”

Approved assistant strokes may appear in current temporal context, but they cannot become planner targets. Historical data may inform current queries, but the script does not restore erased strokes or generate against a historical projection.

## Circle Geometry

The circle uses the target content object's current visible bounds. Candidate variants apply world-coordinate padding of 18, 28, and 38 units. Each is an ellipse centered on the bounds, sampled at a fixed angular interval with a repeated final point to close the stroke. Degenerate one-dimensional or point bounds receive a minimum radius before padding.

Circle regeneration advances through padding candidates and skips rejected fingerprints. The circle may overlay the target by design; collision scoring does not reject that overlap.

## Arrow Geometry and Placement

The arrow considers right, left, below, and above placements in that stable tie order. Each direction has offset variants so regeneration can find another location. A candidate uses a fixed gap from target bounds, a fixed shaft length, and two separate arrowhead strokes that converge on the target's nearest edge.

Scoring uses world-coordinate bounds for all visible strokes, active content objects, and visible annotation objects. It penalizes stroke intersections first, object-bound intersections second, then total overlap area and travel distance. Target-bound contact at the arrow tip is allowed. Equal scores use direction order, offset index, then canonical geometry order.

The first non-rejected lowest-score candidate is proposed even when the board is crowded, but its explanation states when no collision-free placement exists. Exhaustion means every deterministic candidate fingerprint for that revision and target was rejected.

## Preview and Approval

The toolbar gains **Assistant suggestions**. It opens a proposal panel and generates both slots when no valid proposals exist. Each card shows its type, explanation, target label, preview toggle, and state-dependent actions.

- **Approve** validates and commits only that proposal.
- **Reject** records only that fingerprint and removes only that preview.
- **Regenerate** advances only that proposal through unused candidates.
- Preview visibility affects rendering only.

Unapproved strokes render as dashed violet overlays above committed ink and below selection/object handles. They are excluded from hit testing, association, autosave, export, undo/redo, temporal history, and all assistant queries.

Approval revalidates the proposal before mutation:

- The session revision matches current ink and association event counts.
- The app is at live Now.
- The target remains an active visible content object.
- Every generated point and stroke property is finite and valid.
- IDs do not collide with existing events, strokes, objects, or proposals.
- The fingerprint has not been rejected.

The workspace validates the complete batch and annotation event before appending either. A validation failure leaves both logs unchanged and marks the proposal stale or unavailable with a visible error. Successful approval appends the batch add and annotation creation, persists once, and clears that preview. Its independently generated sibling remains available: the session revalidates its target and geometry, then rebases its revision to the new event counts. If that narrow revalidation fails, the sibling becomes stale rather than committing outdated geometry.

## Editing Approved Annotations

The normal eraser operates on assistant strokes exactly as it does on user strokes. Removing one shaft or arrowhead stroke leaves the annotation object and its remaining visible members intact. Board undo/redo restores or removes that one stroke.

The Objects panel distinguishes annotation nodes with an **Assistant annotation** badge, shows annotation kind and linked target, and preserves ordinary selection/highlighting. **Delete annotation** collects every currently visible member and commits one batch erase. It is disabled when no member is visible or while viewing history. Undo/redo treats the batch as one action.

Content merge, split, and assignment controls never accept annotation nodes. Annotation links survive content supersession and continue to reference the stable historical target ID; the graph can show the target's descendants separately without silently retargeting the annotation.

## Temporal Behavior

The temporal index continues to merge ink and association heads with dependency gating. The new association kind and batched ink changes require no third history. Approved annotation creation appears immediately after its batch add when timestamps tie because ink remains first on ties.

Prefix projection must show:

- No annotation before approval.
- All approved member strokes immediately after the batch add.
- The graph node and typed edge after annotation creation.
- Reduced visible membership after partial erasure.
- Zero visible membership after whole deletion.
- Restored membership after undo.

Current-context and region queries exclude erased assistant geometry under the same opt-in rules as user geometry. Object-history queries can follow content lineage or annotation links explicitly without conflating the two.

Entering historical mode discards all unapproved previews without treating them as rejections, closes the proposal panel, and preserves session rejection fingerprints. Generation, approval, rejection, regeneration, and annotation deletion are unavailable at every historical position, including the latest event.

## Interface and Responsive Behavior

The proposal panel uses the existing native DOM patterns and accessible controls. Desktop may display it beside either History or Objects only when space permits; the implementation should favor a focused single-panel flow over shrinking the canvas excessively. Below 760 pixels, Assistant, Objects, and History panels are mutually exclusive overlays.

Keyboard focus moves to the proposal heading when opened. Stable controls retain focus through proposal-state updates. Escape closes the proposal panel; if a proposal action reports an error, focus remains on the originating card. Status and preview visibility are announced without moving focus.

Assistant preview and committed colors must be distinguishable from selection, object bounds, activity heat, and user ink. Provenance cannot rely on color alone: badges, labels, graph node classes, and accessible descriptions identify assistant content.

## Consistency and Error Handling

The proposal revision is the pair of current ink and association event counts. Ink edits, undo/redo, grouping corrections, file import, partial erasure, and annotation deletion invalidate remaining proposals. Approval invalidates proposals from other generations. The independently generated sibling from the same generation is the sole exception: it is revalidated and rebased as described above so circle and arrow decisions remain independent. Viewport changes do not invalidate proposals because geometry is stored in world coordinates.

Invalidation removes preview geometry and marks cards stale until explicit regeneration. It never auto-approves, auto-regenerates, or records a rejection. Opening a different board resets the whole assistant session.

In-memory approval precedes autosave, matching existing local-first behavior. An autosave failure reports that the annotation is present but not saved locally; portable export remains available. Import validation is all-or-nothing and leaves the current workspace untouched on a malformed version-3 file.

## Verification

Automated tests must cover:

- Legacy migration, version-3 parsing, serialization, and exact replay.
- Multi-change add/erase validation and batch undo/redo.
- Assistant provenance and content/annotation union validation.
- Annotation dependency ordering and typed graph projection.
- Current-segment target selection, fallback, empty board, and stable ties.
- Circle sampling, degenerate bounds, padding variants, and fingerprints.
- Arrow direction/offset candidates, collision scoring, stable ties, crowded boards, and exhaustion.
- Independent card approval, rejection, visibility, and regeneration.
- Rejection suppression without document mutation or persistence.
- Revision invalidation for every live mutation class and no invalidation on pan/zoom.
- Atomic approval failure, duplicate IDs, non-finite geometry, and stale targets.
- Partial erasure, whole deletion, undo/redo, and temporal prefix reconstruction.
- Content corrections excluding annotation nodes.
- Defensive query results and erased-geometry opt-in for assistant strokes.

Production-browser acceptance must exercise a complete circle and arrow flow, independent decisions, rejection/regeneration, preview/autosave isolation, stale-proposal refusal, partial arrow erasure, whole annotation deletion, undo/redo, history inspection, reload, version-2 migration, keyboard focus, a 500-pixel layout, device-pixel-ratio rendering, and zero console/page errors.

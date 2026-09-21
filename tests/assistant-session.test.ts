import { describe, expect, test } from 'vitest';
import { approveAssistantProposal, createAssistantSession, deleteAnnotation, generateAssistantSession, regenerateAssistantSlot, rejectAssistantProposal } from '../src/assistant-session';
import { revisionOf, type ProposalKind } from '../src/assistant-planner';
import { serializeBoard } from '../src/document';
import { createHistorySession, loadWorkspace, selectHistoryPosition, workspaceDocument } from '../src/workspace';
import { plannerFixture } from './assistant-fixtures';

function assistantWorkspaceFixture() {
  const fixture = plannerFixture();
  return loadWorkspace({ sourceVersion: 3, document: fixture.document });
}

function assistantSessionFixture() {
  const workspace = assistantWorkspaceFixture();
  const history = createHistorySession(workspace);
  const session = generateAssistantSession(workspace, history, createAssistantSession());
  return { workspace, history, session };
}

describe('assistant session', () => {
  test('preview generation and rejection do not mutate the document', () => {
    const workspace = assistantWorkspaceFixture();
    const history = createHistorySession(workspace);
    const before = serializeBoard(workspaceDocument(workspace));
    let session = generateAssistantSession(workspace, history, createAssistantSession());
    const rejected = session.proposals!.circle.proposal!.fingerprint;
    session = rejectAssistantProposal(session, 'active-area-circle');
    expect(session.rejectedFingerprints.has(rejected)).toBe(true);
    expect(serializeBoard(workspaceDocument(workspace))).toBe(before);
  });

  test('regeneration changes only the requested slot and never repeats a rejected fingerprint', () => {
    const fixture = assistantSessionFixture();
    const arrowBefore = fixture.session.proposals!.arrow.proposal;
    const rejectedCircle = fixture.session.proposals!.circle.proposal!.fingerprint;
    let session = rejectAssistantProposal(fixture.session, 'active-area-circle');
    session = regenerateAssistantSlot(fixture.workspace, fixture.history, session, 'active-area-circle');
    expect(session.proposals!.circle.proposal?.fingerprint).not.toBe(rejectedCircle);
    expect(session.proposals!.arrow.proposal).toEqual(arrowBefore);
  });

  test('approval atomically appends one assistant batch and one annotation object', () => {
    const fixture = assistantSessionFixture();
    const result = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'recent-work-arrow', 50_000);
    const document = workspaceDocument(fixture.workspace);
    expect(document.events.at(-1)).toMatchObject({ actor: 'assistant', kind: 'add', changes: [{ before: null }, { before: null }, { before: null }] });
    expect(document.associationEvents.at(-1)).toMatchObject({ actor: 'user', kind: 'assistant-annotation' });
    expect(fixture.workspace.associations.objects.find(({ id }) => id === result.annotationId)).toMatchObject({ objectType: 'annotation', annotationKind: 'arrow' });
  });

  test.each(['stale revision', 'missing target', 'duplicate stroke ID', 'non-finite geometry'] as const)('failed approval for %s leaves both logs unchanged', (fault) => {
    const fixture = assistantSessionFixture();
    const kind: ProposalKind = 'recent-work-arrow';
    const proposal = fixture.session.proposals!.arrow.proposal!;
    if (fault === 'stale revision') proposal.revision.inkEventCount += 1;
    if (fault === 'missing target') proposal.targetObjectId = 'missing';
    if (fault === 'duplicate stroke ID') proposal.strokes[0].id = fixture.workspace.board.strokes[0].id;
    if (fault === 'non-finite geometry') proposal.strokes[0].points[0].x = Number.NaN;
    const before = serializeBoard(workspaceDocument(fixture.workspace));
    expect(() => approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, kind, 50_000)).toThrow();
    expect(serializeBoard(workspaceDocument(fixture.workspace))).toBe(before);
  });

  test('approval preserves same-generation sibling geometry and rebases only its revision', () => {
    const fixture = assistantSessionFixture();
    const arrowBefore = structuredClone(fixture.session.proposals!.arrow.proposal!);
    const result = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'active-area-circle', 50_000);
    const arrowAfter = result.session.proposals!.arrow.proposal!;
    expect(arrowAfter.strokes).toEqual(arrowBefore.strokes);
    expect(arrowAfter.fingerprint).toBe(arrowBefore.fingerprint);
    expect(arrowAfter.revision).toEqual(revisionOf(workspaceDocument(fixture.workspace)));
  });

  test('deletes only currently visible annotation members as one batch and undo restores that batch', () => {
    const fixture = assistantSessionFixture();
    const approved = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'recent-work-arrow', 50_000);
    const annotation = fixture.workspace.associations.objects.find(({ id }) => id === approved.annotationId)!;
    const previouslyErasedId = annotation.strokeIds[0];
    fixture.workspace.board.eraseStroke(previouslyErasedId);
    const eventId = deleteAnnotation(fixture.workspace, createHistorySession(fixture.workspace), approved.annotationId, { id: 'delete-arrow', time: 60_000 });
    expect(eventId).toBe('delete-arrow');
    expect(fixture.workspace.board.events.at(-1)?.changes).toHaveLength(2);
    expect(fixture.workspace.board.strokes.filter(({ id }) => annotation.strokeIds.includes(id))).toHaveLength(0);
    fixture.workspace.board.undo();
    expect(fixture.workspace.board.strokes.filter(({ id }) => annotation.strokeIds.includes(id))).toHaveLength(2);
    expect(fixture.workspace.board.strokes.map(({ id }) => id)).not.toContain(previouslyErasedId);
  });

  test('deletion rejects content objects and historical mode, and empty annotations need no event', () => {
    const fixture = assistantSessionFixture();
    expect(() => deleteAnnotation(fixture.workspace, fixture.history, 'old-object', { id: 'bad', time: 1 })).toThrow(/annotation/i);
    const approved = approveAssistantProposal(fixture.workspace, fixture.history, fixture.session, 'active-area-circle', 50_000);
    const currentHistory = createHistorySession(fixture.workspace);
    expect(() => deleteAnnotation(fixture.workspace, selectHistoryPosition(fixture.workspace, currentHistory, 1), approved.annotationId, { id: 'historical', time: 2 })).toThrow(/historical|now/i);
    const annotation = fixture.workspace.associations.objects.find(({ id }) => id === approved.annotationId)!;
    for (const id of annotation.strokeIds) fixture.workspace.board.eraseStroke(id);
    expect(deleteAnnotation(fixture.workspace, createHistorySession(fixture.workspace), approved.annotationId, { id: 'empty', time: 3 })).toBeNull();
  });
});

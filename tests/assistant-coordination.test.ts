import { describe, expect, test } from 'vitest';
import { afterWorkspaceMutation, approveAssistantProposal, createAssistantSession, generateAssistantSession, hasAssistantCandidate, regenerateAssistantSlot, rejectAssistantProposal, type AssistantSession } from '../src/assistant-session';
import { visiblePreviewStrokes } from '../src/assistant-panel';
import { createHistorySession, loadWorkspace, rebuildHistorySession } from '../src/workspace';
import { plannerFixture } from './assistant-fixtures';

function sessionWithProposals(): AssistantSession {
  const fixture = plannerFixture();
  const workspace = loadWorkspace({ sourceVersion: 3, document: fixture.document });
  return generateAssistantSession(workspace, createHistorySession(workspace), createAssistantSession());
}

function sessionWithProposalsAndRejections(): AssistantSession {
  const session = sessionWithProposals();
  session.rejectedFingerprints.add('rejected-fingerprint');
  return session;
}

describe('assistant mutation coordination', () => {
  test('an unavailable empty-board generation does not count as a reusable candidate', () => {
    const fixture = plannerFixture();
    const empty = loadWorkspace({ sourceVersion: 3, document: { version: 3, events: [], associationEvents: [], viewport: fixture.document.viewport } });
    expect(hasAssistantCandidate(generateAssistantSession(empty, createHistorySession(empty), createAssistantSession()))).toBe(false);
    expect(hasAssistantCandidate(sessionWithProposals())).toBe(true);
  });

  test.each(['ink', 'undo', 'redo', 'association', 'import', 'partial-erase', 'annotation-delete'] as const)('%s invalidates previews but retains rejection memory', (mutation) => {
    const next = afterWorkspaceMutation(sessionWithProposalsAndRejections(), mutation);
    expect(visiblePreviewStrokes(next.proposals)).toEqual([]);
    expect(next.rejectedFingerprints).toEqual(new Set(['rejected-fingerprint']));
  });

  test('viewport preserves proposals and assistant approval preserves only a same-generation sibling', () => {
    const session = sessionWithProposals();
    expect(afterWorkspaceMutation(session, 'viewport')).toEqual(session);
    const generationId = session.proposals!.generationId;
    expect(afterWorkspaceMutation(session, 'assistant-approval', generationId).proposals?.arrow.proposal?.generationId).toBe(generationId);
  });

  test('approval after regenerating both stale slots keeps the approved card and sibling usable', () => {
    const fixture = plannerFixture();
    const workspace = loadWorkspace({ sourceVersion: 3, document: fixture.document });
    let history = createHistorySession(workspace);
    let session = generateAssistantSession(workspace, history, createAssistantSession());
    workspace.board.moveStroke('recent-object-stroke', 5, 0);
    session = afterWorkspaceMutation(session, 'ink');
    history = rebuildHistorySession(workspace, history);
    session = regenerateAssistantSlot(workspace, history, session, 'active-area-circle');
    session = regenerateAssistantSlot(workspace, history, session, 'recent-work-arrow');

    const approvedGenerationId = session.proposals!.circle.proposal!.generationId;
    const result = approveAssistantProposal(workspace, history, session, 'active-area-circle', 50_000);
    session = afterWorkspaceMutation(result.session, 'assistant-approval', session.proposals!.generationId);

    expect(session.proposals!.circle.proposal).toMatchObject({ state: 'approved', generationId: approvedGenerationId });
    expect(session.proposals!.arrow.proposal).toMatchObject({ state: 'proposed', generationId: approvedGenerationId });
  });

  test('approval preserves an independently rejected card from an older generation', () => {
    const fixture = plannerFixture();
    const workspace = loadWorkspace({ sourceVersion: 3, document: fixture.document });
    let history = createHistorySession(workspace);
    let session = rejectAssistantProposal(generateAssistantSession(workspace, history, createAssistantSession()), 'active-area-circle');
    workspace.board.moveStroke('recent-object-stroke', 5, 0);
    session = afterWorkspaceMutation(session, 'ink');
    history = rebuildHistorySession(workspace, history);
    session = regenerateAssistantSlot(workspace, history, session, 'recent-work-arrow');

    const approvedGenerationId = session.proposals!.arrow.proposal!.generationId;
    const result = approveAssistantProposal(workspace, history, session, 'recent-work-arrow', 50_000);
    session = afterWorkspaceMutation(result.session, 'assistant-approval', approvedGenerationId);

    expect(session.proposals!.circle.proposal?.state).toBe('rejected');
    expect(session.proposals!.arrow.proposal?.state).toBe('approved');
  });
});

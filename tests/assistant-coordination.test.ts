import { describe, expect, test } from 'vitest';
import { afterWorkspaceMutation, createAssistantSession, generateAssistantSession, hasAssistantCandidate, type AssistantSession } from '../src/assistant-session';
import { visiblePreviewStrokes } from '../src/assistant-panel';
import { createHistorySession, loadWorkspace } from '../src/workspace';
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
});
